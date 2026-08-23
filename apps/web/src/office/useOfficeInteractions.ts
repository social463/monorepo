import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  findMapPath,
  OFFICE_KNOCK_TIMEOUT_MS,
  type MapDocumentV1,
  type OfficeDeskDTO,
  type OfficeDeskReminderSummaryDTO,
  type OfficeKart,
  type OfficeOccupant,
  type OfficeRoomEntryDeniedReason,
  type ShowcaseEntry,
  type TilePosition,
} from '@legends/shared'
import { apiFetch } from '../lib/api'
import { playCallBeep, playEnterBeep, playLeaveBeep } from '../lib/beep'
import { claimOfficeDesk, releaseOfficeDesk } from '../lib/office-desk-api'
import type { OfficeBridge } from './OfficeBridge'
import { FollowController, type FollowOptions } from './FollowController'

const CALL_TIMEOUT_MS = 30_000
/**
 * Cadência mínima entre passos do Seguir/caminhar-até-a-mesa — mesmo valor do
 * `INPUT_COOLDOWN_MS` do teclado em `OfficeScene`. Sem isso, num round-trip
 * rápido a confirmação de `moved` libera o próximo passo antes da animação do
 * anterior terminar (mesma duração de tween do teclado, `STEP_MS`), e o
 * personagem "pula" de tile em tile em vez de andar no ritmo normal.
 */
const FOLLOW_STEP_INTERVAL_MS = 160
const NO_DESK_REMINDERS: OfficeDeskReminderSummaryDTO[] = []

/** Default estável — literal na assinatura nasceria novo a cada render (ver `sameDesks`). */
const NO_KARTS: readonly OfficeKart[] = []

/**
 * Compara mesas por conteúdo. O espelho `desks` → `deskState` roda num efeito
 * que depende da IDENTIDADE do array, e essa identidade muda a cada render
 * quando a origem é um literal: o default `desks = []` da própria assinatura, ou
 * um `activeMap?.desks ?? []` no call site enquanto o mapa não carregou. Setar o
 * estado nesse caso re-renderiza → o efeito roda de novo → seta de novo, um
 * loop render→setState→render que não aparece como erro: em teste, só como heap
 * estourado; em runtime, como CPU presa. Com a comparação, identidade nova sem
 * mudança de conteúdo é no-op.
 */
function sameDesks(a: readonly OfficeDeskDTO[], b: readonly OfficeDeskDTO[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.externalKey !== y.externalKey ||
      x.claimedBy?.id !== y.claimedBy?.id ||
      x.claimedBy?.name !== y.claimedBy?.name
    ) {
      return false
    }
  }
  return true
}

function sameDeskReminders(
  a: readonly OfficeDeskReminderSummaryDTO[],
  b: readonly OfficeDeskReminderSummaryDTO[],
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.deskId !== y.deskId ||
      x.deskExternalKey !== y.deskExternalKey ||
      x.sender.id !== y.sender.id ||
      x.sender.name !== y.sender.name ||
      x.recipientId !== y.recipientId ||
      x.createdAt !== y.createdAt
    ) {
      return false
    }
  }
  return true
}

/** Recusas sem a quem pedir viram só um aviso — ver `room-entry-denied`. */
function entryDeniedToast(reason: OfficeRoomEntryDeniedReason, roomName: string): string {
  if (reason === 'capacity') return `A sala ${roomName} está lotada.`
  if (reason === 'allowlist') return `Você não tem acesso à sala ${roomName}.`
  return `A sala ${roomName} está bloqueada.`
}

/** Sala trancada em que você esbarrou, e em que tile — ver `entryDenied`. */
export interface RoomEntryDenial {
  roomId: string
  roomName: string
  reason: OfficeRoomEntryDeniedReason
  x: number
  y: number
  /** true depois de "pedir para entrar", enquanto ninguém respondeu. */
  waiting: boolean
}

export interface OfficeInteractionsState {
  /** Lista viva das mesas (claim/release chegam por WS) — usada pra derivar o nome exibido da sala da mesa. */
  desks: OfficeDeskDTO[]
  /** Lembretes pendentes exibidos como presentes sobre as mesas. */
  deskReminders: OfficeDeskReminderSummaryDTO[]
  selected: OfficeOccupant | null
  selectedEntry: ShowcaseEntry | null
  selectedDesk: OfficeDeskDTO | null
  hoveredDesk: OfficeDeskDTO | null
  selectedDeskReminder: OfficeDeskReminderSummaryDTO | null
  incomingCall: { userId: string; name: string } | null
  /** Sala trancada que acabou de te barrar — dirige o popup "pedir para entrar". */
  entryDenied: RoomEntryDenial | null
  toast: string | null
  openCard: (userId: string) => void
  closeCard: () => void
  closeDeskCard: () => void
  claimSelectedDesk: () => void
  releaseSelectedDesk: () => void
  addDeskReminder: (reminder: OfficeDeskReminderSummaryDTO) => void
  removeDeskReminder: (reminderId: string) => void
  openDeskReminder: (reminderId: string) => void
  closeDeskReminder: () => void
  call: (userId: string) => void
  follow: (userId: string) => void
  walkToMyDesk: () => void
  walkToTile: (target: TilePosition) => void
  /** Dispara um aviso na faixa de toast da OfficePage (some sozinho). */
  showToast: (message: string) => void
  viewProfile: (userId: string) => void
  acceptCall: () => void
  refuseCall: () => void
  /** Pede para entrar na sala que te barrou. */
  knockToEnter: () => void
  /** Desiste do pedido (ou só fecha o popup, se ainda não pediu). */
  cancelEntryRequest: () => void
}

/**
 * Liga o Dijkstra do `@legends/shared` ao controlador da caminhada. Os karts
 * entram por ref (leitura viva) porque a lista chega nova a cada mensagem do
 * servidor, e as recusas aprendidas vêm do próprio controlador.
 */
function makePathfinder(
  document: MapDocumentV1 | null | undefined,
  kartsRef: { current: readonly OfficeKart[] },
): FollowOptions['pathfinder'] {
  if (!document) return undefined
  return (from, to, request) =>
    findMapPath(document, from, to, {
      exact: request.exact,
      karts: kartsRef.current,
      blocked: request.blocked,
      fallback: request.fallback,
    })
}

export function useOfficeInteractions(
  bridge: OfficeBridge,
  occupants: OfficeOccupant[],
  youId: string | null,
  document?: MapDocumentV1 | null,
  desks: OfficeDeskDTO[] = [],
  deskReminders: OfficeDeskReminderSummaryDTO[] = NO_DESK_REMINDERS,
  karts: readonly OfficeKart[] = NO_KARTS,
): OfficeInteractionsState {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [incomingCall, setIncomingCall] = useState<{ userId: string; name: string } | null>(null)
  const [entryDenied, setEntryDenied] = useState<RoomEntryDenial | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [deskState, setDeskState] = useState<OfficeDeskDTO[]>(desks)
  const [deskReminderState, setDeskReminderState] = useState<OfficeDeskReminderSummaryDTO[]>(deskReminders)
  const [selectedDeskExternalKey, setSelectedDeskExternalKey] = useState<string | null>(null)
  const [hoveredDeskExternalKey, setHoveredDeskExternalKey] = useState<string | null>(null)
  const [selectedDeskReminderId, setSelectedDeskReminderId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    setDeskState((current) => (sameDesks(current, desks) ? current : desks))
  }, [desks])

  useEffect(() => {
    setDeskReminderState((current) => (sameDeskReminders(current, deskReminders) ? current : deskReminders))
  }, [deskReminders])

  // Refs-espelho para os callbacks lerem o estado atual sem virar dependência.
  const occupantsRef = useRef(occupants)
  occupantsRef.current = occupants
  const youIdRef = useRef(youId)
  youIdRef.current = youId
  /**
   * Karts são obstáculo de verdade (o hub recusa o passo para o tile de um
   * kart estacionado), então a caminhada automática precisa contorná-los —
   * senão o Seguir insiste no mesmo tile até desistir. A ref mantém a leitura
   * viva dentro do pathfinder; a chave abaixo é o que dispara o recálculo.
   */
  const kartsRef = useRef(karts)
  kartsRef.current = karts
  const kartsKey = karts.map((kart) => `${kart.id}:${kart.x}:${kart.y}:${kart.riderUserId ?? ''}`).join('|')

  const { data: showcase } = useQuery({
    queryKey: ['showcase', 'ativas', 'all'],
    queryFn: () => apiFetch<{ entries: ShowcaseEntry[] }>('/users/showcase?sectorId=all'),
    staleTime: 60_000,
  })

  const selected = useMemo(
    () => occupants.find((o) => o.userId === selectedId) ?? null,
    [occupants, selectedId],
  )
  const selectedEntry = useMemo(
    () => showcase?.entries.find((e) => e.user.id === selectedId) ?? null,
    [showcase, selectedId],
  )
  const selectedDesk = useMemo(
    () => deskState.find((desk) => desk.externalKey === selectedDeskExternalKey) ?? null,
    [deskState, selectedDeskExternalKey],
  )
  const hoveredDesk = useMemo(
    () => deskState.find((desk) => desk.externalKey === hoveredDeskExternalKey) ?? null,
    [deskState, hoveredDeskExternalKey],
  )
  const selectedDeskReminder = useMemo(
    () => deskReminderState.find((reminder) => reminder.id === selectedDeskReminderId) ?? null,
    [deskReminderState, selectedDeskReminderId],
  )

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }, [])

  const closeDeskCard = useCallback(() => setSelectedDeskExternalKey(null), [])
  const closeDeskReminder = useCallback(() => setSelectedDeskReminderId(null), [])
  const openDeskReminder = useCallback((reminderId: string) => setSelectedDeskReminderId(reminderId), [])

  const addDeskReminder = useCallback((reminder: OfficeDeskReminderSummaryDTO) => {
    setDeskReminderState((current) => {
      const withoutSame = current.filter((item) => item.id !== reminder.id)
      return [...withoutSame, reminder]
    })
  }, [])

  const removeDeskReminder = useCallback((reminderId: string) => {
    setDeskReminderState((current) => current.filter((item) => item.id !== reminderId))
    setSelectedDeskReminderId((current) => (current === reminderId ? null : current))
  }, [])

  const claimSelectedDesk = useCallback(() => {
    if (!selectedDesk) return
    claimOfficeDesk(selectedDesk.id)
      .then(({ desk }) => setDeskState((current) => current.map((d) => (d.id === desk.id ? desk : d))))
      .catch((cause) => showToast(cause instanceof Error ? cause.message : 'Não foi possível reivindicar a mesa'))
  }, [selectedDesk, showToast])

  const releaseSelectedDesk = useCallback(() => {
    if (!selectedDesk) return
    releaseOfficeDesk(selectedDesk.id)
      .then(({ desk }) => setDeskState((current) => current.map((d) => (d.id === desk.id ? desk : d))))
      .catch((cause) => showToast(cause instanceof Error ? cause.message : 'Não foi possível abandonar a mesa'))
  }, [selectedDesk, showToast])

  // --- Follow ---------------------------------------------------------------
  const followRef = useRef<FollowController | null>(null)
  // `onFailed` não sabe qual era o alvo do `start()` em curso — esta ref
  // guarda se foi um follow de pessoa, uma caminhada até a própria mesa ou
  // até um tile clicado no mapa, pra escolher a mensagem de erro certa.
  const followKindRef = useRef<'person' | 'desk' | 'point'>('person')
  // Pacing do passo real (ver `FOLLOW_STEP_INTERVAL_MS`) — não mexe no
  // relógio interno do FollowController (a confirmação `moved` continua
  // liberando o próximo passo na hora); só atrasa o envio de fato pra
  // respeitar a mesma cadência visual do teclado.
  const pendingStepTimeoutRef = useRef<number | null>(null)
  /** Quando o último passo foi (ou será) de fato enviado — base da cadência. */
  const lastStepAtRef = useRef(0)
  const clearPendingStep = useCallback(() => {
    if (pendingStepTimeoutRef.current !== null) {
      window.clearTimeout(pendingStepTimeoutRef.current)
      pendingStepTimeoutRef.current = null
    }
  }, [])
  if (followRef.current === null) {
    followRef.current = new FollowController({
      emitMove: (dir) => {
        const now = Date.now()
        const sendAt = Math.max(now, lastStepAtRef.current + FOLLOW_STEP_INTERVAL_MS)
        // No máximo UM passo em voo. Cada recálculo (o alvo andou, o servidor
        // recusou o passo) SUBSTITUI o passo que ainda não saiu, em vez de
        // enfileirar mais um: a fila fazia o personagem executar direções de
        // uma rota que já tinha sido descartada — andar para o lado errado,
        // voltar, e nunca chegar. A cadência é preservada porque o substituto
        // herda o horário de envio do que foi descartado.
        clearPendingStep()
        lastStepAtRef.current = sendAt
        if (sendAt === now) {
          bridge.emitClientMessage({ type: 'move', dir })
          return
        }
        pendingStepTimeoutRef.current = window.setTimeout(() => {
          pendingStepTimeoutRef.current = null
          bridge.emitClientMessage({ type: 'move', dir })
        }, sendAt - now)
      },
      onArrived: () => {},
      onFailed: (reason) => {
        const kind = followKindRef.current
        if (reason === 'target-left') {
          showToast(kind === 'desk' ? 'Sua mesa não existe mais.' : 'A pessoa saiu do escritório.')
          return
        }
        if (kind === 'desk') showToast('Não foi possível chegar até sua mesa.')
        else if (kind === 'point') showToast('Não foi possível chegar até esse ponto.')
        else showToast('Não foi possível chegar até a pessoa.')
      },
      setTimer: (cb, ms) => window.setTimeout(cb, ms),
      clearTimer: (id) => window.clearTimeout(id),
      pathfinder: makePathfinder(document, kartsRef),
    })
  }
  useEffect(() => {
    followRef.current?.setPathfinder(makePathfinder(document, kartsRef))
    // `kartsKey` (conteúdo), não o array: a lista vem nova a cada mensagem do
    // servidor, e re-instalar o pathfinder recalcula a rota do Seguir em curso
    // — refazer isso a cada render seria um loop de passos.
  }, [document, kartsKey])
  const follow = useCallback(
    (userId: string) => {
      const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
      const target = occupantsRef.current.find((o) => o.userId === userId)
      if (!me || !target) return
      followKindRef.current = 'person'
      clearPendingStep()
      followRef.current!.start({ selfId: me.userId, targetId: userId }, me, target)
      setSelectedId(null)
    },
    [clearPendingStep],
  )

  /** Atalho Ctrl/Cmd+D — anda até a própria mesa reivindicada, se houver. */
  const walkToMyDesk = useCallback(() => {
    const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
    if (!me || !document) return
    const myDesk = deskState.find((d) => d.claimedBy?.id === youIdRef.current)
    if (!myDesk) {
      showToast('Você ainda não reivindicou uma mesa.')
      return
    }
    const object = document.objects.find(
      (candidate) => candidate.type === 'desk' && candidate.properties.externalKey === myDesk.externalKey,
    )
    if (!object || object.type !== 'desk') return
    const { x, y, width, height } = object.geometry
    const target = {
      x: Math.floor((x + width / 2) / document.map.tileWidth),
      y: Math.floor((y + height / 2) / document.map.tileHeight),
    }
    followKindRef.current = 'desk'
    clearPendingStep()
    followRef.current!.start({ selfId: me.userId, targetId: `desk:${myDesk.externalKey}` }, me, target)
  }, [deskState, document, showToast, clearPendingStep])

  /** Clique direito no mapa — anda até o próprio tile clicado (não só adjacente, diferente de seguir/mesa). */
  const walkToTile = useCallback(
    (target: TilePosition) => {
      const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
      if (!me || !document) return
      followKindRef.current = 'point'
      clearPendingStep()
      followRef.current!.start(
        { selfId: me.userId, targetId: `point:${target.x},${target.y}` },
        me,
        target,
        // Clicar em cima de uma mesa, de uma parede ou de uma sala fechada é
        // pedido legítimo: vai o mais perto que der em vez de não sair do lugar.
        { exact: true, fallback: 'closest' },
      )
    },
    [document, clearPendingStep],
  )

  // --- Ações do card --------------------------------------------------------
  const openCard = useCallback((userId: string) => setSelectedId(userId), [])
  const closeCard = useCallback(() => setSelectedId(null), [])
  const call = useCallback(
    (userId: string) => {
      bridge.emitClientMessage({ type: 'call', targetUserId: userId })
      setSelectedId(null)
    },
    [bridge],
  )
  const viewProfile = useCallback((userId: string) => {
    window.open(`/perfil/${userId}`, '_blank', 'noopener')
    setSelectedId(null)
  }, [])

  // --- Chamada recebida -----------------------------------------------------
  const callerIdRef = useRef<string | null>(null)
  const respond = useCallback(
    (accepted: boolean) => {
      const callerId = callerIdRef.current
      if (!callerId) return
      bridge.emitClientMessage({ type: 'call-response', callerId, accepted })
      // Aceitar = ir até o chamador (reusa o follow).
      if (accepted) {
        const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
        const caller = occupantsRef.current.find((o) => o.userId === callerId)
        // O tipo dirige a mensagem de erro; sem marcar aqui, uma falha ao ir
        // até quem chamou herdava o texto da última caminhada ("esse ponto").
        followKindRef.current = 'person'
        if (me && caller) followRef.current!.start({ selfId: me.userId, targetId: callerId }, me, caller)
      }
      callerIdRef.current = null
      setIncomingCall(null)
    },
    [bridge],
  )
  const acceptCall = useCallback(() => respond(true), [respond])
  const refuseCall = useCallback(() => respond(false), [respond])

  // --- Sala trancada (lado de fora) -----------------------------------------
  // Ref-espelho pelo mesmo motivo de `occupantsRef`: os callbacks e o handler
  // do servidor leem o estado atual sem virar dependência deles.
  const entryDeniedRef = useRef<RoomEntryDenial | null>(null)
  entryDeniedRef.current = entryDenied

  const knockToEnter = useCallback(() => {
    const current = entryDeniedRef.current
    if (!current || current.waiting) return
    bridge.emitClientMessage({ type: 'knock', roomId: current.roomId, active: true })
    setEntryDenied({ ...current, waiting: true })
  }, [bridge])

  const cancelEntryRequest = useCallback(() => {
    const current = entryDeniedRef.current
    if (!current) return
    // Só avisa o servidor se o pedido chegou a existir — fechar o popup antes
    // de pedir é decisão puramente local.
    if (current.waiting) bridge.emitClientMessage({ type: 'knock', roomId: current.roomId, active: false })
    setEntryDenied(null)
  }, [bridge])

  // Eventos do servidor + cancelamento do follow por teclado.
  useEffect(() => {
    const offMove = bridge.onMoveIntent(() => {
      followRef.current?.cancel()
      clearPendingStep()
      setSelectedId(null)
    })
    const offClick = bridge.onCharacterClick((userId) => setSelectedId(userId))
    const offDeskClick = bridge.onDeskClick((externalKey) => setSelectedDeskExternalKey(externalKey))
    const offDeskHover = bridge.onDeskHover((externalKey) => setHoveredDeskExternalKey(externalKey))
    const offDeskReminderClick = bridge.onDeskReminderClick((reminderId) => setSelectedDeskReminderId(reminderId))
    const offMapRightClick = bridge.onMapRightClick((tile) => walkToTile(tile))
    const offServer = bridge.onServerMessage((msg) => {
      const follow = followRef.current
      switch (msg.type) {
        case 'moved':
          follow?.onMoved(msg.userId, msg.x, msg.y, msg.dir)
          break
        case 'sync':
          follow?.onSync(msg.x, msg.y)
          break
        case 'left':
          follow?.onTargetLeft(msg.userId)
          break
        case 'incoming-call':
          callerIdRef.current = msg.from.userId
          setIncomingCall({ userId: msg.from.userId, name: msg.from.name })
          playCallBeep()
          break
        case 'room-presence':
          // O servidor só entrega isto a quem está na mesma sala (mais o
          // próprio ao sair andando), então é só tocar o sinal.
          if (msg.kind === 'enter') playEnterBeep()
          else playLeaveBeep()
          break
        case 'call-result':
          showToast(
            msg.accepted
              ? 'A pessoa aceitou — está indo até você.'
              : 'A pessoa não pôde atender agora.',
          )
          break
        case 'call-failed':
          showToast(
            msg.reason === 'offline'
              ? 'A pessoa não está mais no escritório.'
              : msg.reason === 'away'
                ? 'A pessoa está ausente no momento.'
                : 'Aguarde um momento antes de chamar de novo.',
          )
          break
        case 'room-entry-denied':
          // Só a tranca da sessão tem a quem pedir; o resto é informativo.
          if (msg.reason === 'locked') {
            setEntryDenied({
              roomId: msg.roomId,
              roomName: msg.roomName,
              reason: msg.reason,
              x: msg.x,
              y: msg.y,
              waiting: false,
            })
          } else {
            showToast(entryDeniedToast(msg.reason, msg.roomName))
          }
          break
        case 'knock-cleared':
          // O servidor manda isto pros dois lados; aqui só interessa quando o
          // pedido que caiu é o SEU (ex.: barrado pelo anti-spam).
          if (msg.userId !== youIdRef.current) break
          setEntryDenied((current) =>
            current && current.roomId === msg.roomId ? { ...current, waiting: false } : current,
          )
          break
        case 'knock-result': {
          const denial = entryDeniedRef.current
          setEntryDenied(null)
          if (!msg.accepted) {
            showToast(`${msg.byName} recusou seu pedido para entrar.`)
            break
          }
          showToast(`${msg.byName} liberou sua entrada.`)
          // O passe já está de pé no servidor: entra andando até o tile onde
          // tinha sido barrado.
          if (denial && denial.roomId === msg.roomId) walkToTile({ x: denial.x, y: denial.y })
          break
        }
        case 'desk-claimed':
          setDeskState((current) =>
            current.map((d) => (d.externalKey === msg.externalKey ? { ...d, claimedBy: msg.user } : d)),
          )
          break
        case 'desk-released':
          setDeskState((current) =>
            current.map((d) => (d.externalKey === msg.externalKey ? { ...d, claimedBy: null } : d)),
          )
          setDeskReminderState((current) => current.filter((reminder) => reminder.deskExternalKey !== msg.externalKey))
          break
        case 'desk-reminder-created':
          addDeskReminder(msg.reminder)
          if (msg.reminder.recipientId === youIdRef.current) {
            showToast(`${msg.reminder.sender.name} deixou um lembrete para você na sua mesa.`)
            void queryClient.invalidateQueries({ queryKey: ['notifications'] })
          }
          break
        case 'desk-reminder-read':
          removeDeskReminder(msg.reminderId)
          if (msg.senderId === youIdRef.current) void queryClient.invalidateQueries({ queryKey: ['notifications'] })
          break
      }
    })
    return () => {
      offMove()
      offClick()
      offDeskClick()
      offDeskHover()
      offDeskReminderClick()
      offMapRightClick()
      offServer()
    }
  }, [bridge, showToast, clearPendingStep, walkToTile, addDeskReminder, removeDeskReminder, queryClient])

  // Timeout de 30s do popup recebido → auto-recusa.
  useEffect(() => {
    if (!incomingCall) return
    const id = window.setTimeout(() => respond(false), CALL_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [incomingCall, respond])

  // Ninguém respondeu ao pedido de entrada: desiste sozinho, como o popup de
  // chamada recebida faz com a auto-recusa.
  useEffect(() => {
    if (!entryDenied?.waiting) return
    const roomId = entryDenied.roomId
    const id = window.setTimeout(() => {
      bridge.emitClientMessage({ type: 'knock', roomId, active: false })
      setEntryDenied(null)
      showToast('Ninguém respondeu ao seu pedido para entrar.')
    }, OFFICE_KNOCK_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [entryDenied, bridge, showToast])

  // Alvo do card saiu → fecha o card.
  useEffect(() => {
    if (selectedId && !occupants.some((o) => o.userId === selectedId)) setSelectedId(null)
  }, [occupants, selectedId])

  // Ao desmontar, encerra qualquer follow em andamento — senão o timer de passo
  // (500ms) segue recalculando o BFS para sempre, já que as confirmações de
  // `moved` deixam de chegar quando os handlers do bridge são desinscritos.
  useEffect(() => () => {
    followRef.current?.cancel()
    clearPendingStep()
  }, [clearPendingStep])

  return {
    // Lista viva das mesas (claim/release chegam por WS) — a página usa pra
    // derivar o nome exibido da sala da mesa.
    desks: deskState,
    deskReminders: deskReminderState,
    selected,
    selectedEntry,
    selectedDesk,
    hoveredDesk,
    selectedDeskReminder,
    incomingCall,
    entryDenied,
    toast,
    openCard,
    closeCard,
    closeDeskCard,
    claimSelectedDesk,
    releaseSelectedDesk,
    addDeskReminder,
    removeDeskReminder,
    openDeskReminder,
    closeDeskReminder,
    call,
    follow,
    walkToMyDesk,
    walkToTile,
    showToast,
    viewProfile,
    acceptCall,
    refuseCall,
    knockToEnter,
    cancelEntryRequest,
  }
}
