// apps/web/src/pages/RetroRoomPage.tsx
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { POSTIT_WIDTH, POSTIT_HEIGHT, RETRO_ACTION_REGION_IDS, RETRO_REGIONS, isLeaderRole, type CreateRetroCardRequest, type RetroCardColor, type RetroCardDTO, type RetroReactionEmoji, type RetroRoomDTO, type RetroTimerCommand } from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../lib/api'
import { useRetroSocket } from '../lib/useRetroSocket'
import {
  addRetroVote, advanceRetroPhase, createRetroCard, deleteRetroCard, getRetroCarryover, getRetroEdits, getRetroRoom,
  listInvitableUsers, removeRetroVote, setRetroCarryover, setRetroParticipants, toggleRetroAnonymous, toggleRetroReaction, updateRetroCard, updateRetroCardPosition, updateRetroTimer,
} from '../lib/retro-api'
import { useCanvasViewport } from './retro/use-canvas-viewport'
import { RegionsBackground } from './retro/RegionsBackground'
import { BoardToolbar, type RetroTool } from './retro/BoardToolbar'
import { REGION_CARD_COLOR_CLASS } from './retro/ColorPalette'
import { QuadrantPads } from './retro/QuadrantPads'
import { ShapeFlyout, type ShapePick } from './retro/ShapeFlyout'
import { ReactionFlyout, type ReactionStamp } from './retro/ReactionFlyout'
import { VoteFlyout, type VoteMode } from './retro/VoteFlyout'
import { PostIt, type ActionFormState } from './retro/PostIt'
import { LiveCursors } from './retro/LiveCursors'
import { BoardInstructions } from './retro/BoardInstructions'
import { ZoomControls } from './retro/ZoomControls'
import { FloatingReactions } from './retro/FloatingReactions'
import { FloatingReactionBar } from './retro/FloatingReactionBar'
import { ParticipantsPanel } from './retro/ParticipantsPanel'
import { CarryoverCard, type CarryoverAction } from './retro/CarryoverCard'
import { EditHistoryPanel } from './retro/EditHistoryPanel'
import { RetroTimerPanel } from './retro/RetroTimerPanel'

type Cached = { room: RetroRoomDTO }

// Texto inicial de um post-it recém-criado. Tratado como placeholder: é limpo ao entrar em edição.
const DEFAULT_CARD_TEXT = 'Novo ponto'

// Cor armazenada ao criar pelo pad do quadrante (a exibição é sobrescrita pela região;
// guardamos o valor de enum mais próximo — went_bad usa 'pink' por não haver 'red').
const REGION_DEFAULT_COLOR: Record<string, RetroCardColor> = {
  went_well: 'green',
  went_bad: 'pink',
  start: 'blue',
  stop: 'yellow',
}

// Limites do board no mundo (instruções no topo em y:0 + quadrantes/Ações). Usado para enquadrar.
const BOARD_BOUNDS = {
  x: 0,
  y: 0,
  w: Math.max(...RETRO_REGIONS.map((r) => r.x + r.w)),
  h: Math.max(...RETRO_REGIONS.map((r) => r.y + r.h)),
}

export function RetroRoomPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { user } = useAuth()
  const navigate = useNavigate()
  const roomQuery = useQuery({ queryKey: ['retro-room', id], queryFn: () => getRetroRoom(id), enabled: !!id })
  const socket = useRetroSocket(id, { onRoomDeleted: () => navigate('/retrospectivas') })
  const vp = useCanvasViewport()
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ cardId: string; startX: number; startY: number; offX: number; offY: number; moved: boolean; editOnly?: boolean; onClick: () => void } | null>(null)
  const dragPos = useRef<{ x: number; y: number } | null>(null)
  const resize = useRef<{ cardId: string; x: number; y: number; startWidth: number; startHeight: number; nextWidth: number; nextHeight: number } | null>(null)
  const panning = useRef<{ x: number; y: number } | null>(null)
  // Arrastar um novo card "puxado" do pad de um quadrante (cria só ao soltar).
  const padDrag = useRef<{ regionId: string; color: RetroCardColor; startX: number; startY: number; moved: boolean } | null>(null)
  const [padGhost, setPadGhost] = useState<{ x: number; y: number; regionId: string } | null>(null)
  const didFit = useRef(false)

  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [editsOpen, setEditsOpen] = useState(false)
  const [tool, setTool] = useState<RetroTool>('cursor')
  const [activeReaction, setActiveReaction] = useState<ReactionStamp | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [selectedMine, setSelectedMine] = useState(false)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [actionDraft, setActionDraft] = useState<ActionFormState>({ plan: '', responsible: '', dueDate: '' })
  const [voteMode, setVoteMode] = useState<VoteMode>('add')
  const [voteArmed, setVoteArmed] = useState(false)
  const [timerError, setTimerError] = useState<string | null>(null)

  const invitableQuery = useQuery({ queryKey: ['retro-invitable'], queryFn: listInvitableUsers, enabled: !!id })
  const carryoverQuery = useQuery({ queryKey: ['retro-carryover', id], queryFn: () => getRetroCarryover(id), enabled: !!id })
  const editsQuery = useQuery({ queryKey: ['retro-edits', id], queryFn: () => getRetroEdits(id), enabled: !!id && roomQuery.data?.room.status === 'CONCLUDED' })
  const carryoverM = useMutation({
    mutationFn: (v: { cardId: string; action: CarryoverAction; dueDate?: string }) => setRetroCarryover(id, v.cardId, v.action, v.dueDate),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['retro-carryover', id] }),
  })
  const canActCarryover = isLeaderRole(user?.role)

  // Responsáveis selecionáveis: o time (sem admins) + o próprio usuário (que pode se atribuir).
  // `/users` exclui o próprio usuário, então o adicionamos no topo.
  const actionUsers = [
    ...(user ? [{ id: user.id, name: `${user.name} (você)` }] : []),
    ...(invitableQuery.data?.users ?? []).map((u) => ({ id: u.id, name: u.name })),
  ]

  const patch = (fn: (c: Cached) => Cached) => qc.setQueryData<Cached>(['retro-room', id], (p) => (p ? fn(p) : p))

  const createM = useMutation({
    mutationFn: (body: CreateRetroCardRequest) => createRetroCard(id, body),
    onSuccess: ({ card }) => {
      patch((c) => ({ room: { ...c.room, cards: [...c.room.cards.filter((x) => x.id !== card.id), card] } }))
      setSelectedCardId(card.id)
      setSelectedMine(true)
    },
  })
  const editM = useMutation({
    mutationFn: (v: { cardId: string; text: string }) => updateRetroCard(id, v.cardId, { text: v.text }),
    onSuccess: ({ card }) => patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((x) => (x.id === card.id ? card : x)) } })),
  })
  const resizeM = useMutation({
    mutationFn: (v: { cardId: string; width: number; height: number }) => updateRetroCard(id, v.cardId, { width: v.width, height: v.height }),
    onSuccess: ({ card }) => patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((x) => (x.id === card.id ? card : x)) } })),
  })
  const actionM = useMutation({
    mutationFn: (v: { cardId: string; value: ActionFormState }) =>
      updateRetroCard(id, v.cardId, {
        actionPlan: v.value.plan,
        actionResponsible: v.value.responsible,
        actionDueDate: v.value.dueDate,
      }),
    onSuccess: ({ card, actionCard }) => patch((c) => ({
      room: {
        ...c.room,
        cards: [
          ...c.room.cards
            .map((x) => (x.id === card.id ? card : x))
            .filter((x) => x.id !== actionCard?.id),
          ...(actionCard ? [actionCard] : []),
        ],
      },
    })),
  })
  const deleteM = useMutation({
    mutationFn: (cardId: string) => deleteRetroCard(id, cardId),
    onSuccess: (_r, cardId) => patch((c) => ({ room: { ...c.room, cards: c.room.cards.filter((x) => x.id !== cardId) } })),
  })
  const voteM = useMutation({
    mutationFn: (v: { cardId: string; dir: 'add' | 'remove' }) => (v.dir === 'add' ? addRetroVote(id, v.cardId) : removeRetroVote(id, v.cardId)),
    onSuccess: (res, v) => patch((c) => ({
      room: {
        ...c.room,
        myRemainingVotes: res.myRemainingVotes,
        cards: c.room.cards.map((x) => (x.id === v.cardId ? { ...x, voteCount: res.voteCount, myVotes: Math.max(0, x.myVotes + (v.dir === 'add' ? 1 : -1)) } : x)),
      },
    })),
  })
  const reactM = useMutation({
    mutationFn: (v: { cardId: string; emoji: RetroReactionEmoji }) => toggleRetroReaction(id, v.cardId, v.emoji),
    onSuccess: (res, v) => patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((x) => (x.id === v.cardId ? { ...x, reactions: res.reactions } : x)) } })),
  })
  const concludeM = useMutation({
    mutationFn: () => advanceRetroPhase(id, 'conclude'),
    onSuccess: ({ room }) => patch((c) => ({ room: { ...c.room, status: room.status, concludedAt: room.concludedAt } })),
  })
  const toggleAnonM = useMutation({
    mutationFn: (anonymous: boolean) => toggleRetroAnonymous(id, anonymous),
    onSuccess: ({ room: r }) => patch((c) => ({ room: { ...c.room, anonymous: r.anonymous } })),
  })
  const timerM = useMutation({
    mutationFn: (command: RetroTimerCommand) => updateRetroTimer(id, command),
    onSuccess: ({ timer }) => {
      setTimerError(null)
      patch((c) => ({ room: { ...c.room, timer } }))
    },
    onError: (err) => setTimerError(err instanceof ApiError ? err.message : 'Erro ao atualizar o cronômetro.'),
  })
  const participantsM = useMutation({
    mutationFn: (ids: string[]) => setRetroParticipants(id, ids),
    onSuccess: ({ room: r }) => patch((c) => ({ room: { ...c.room, participants: r.participants, participantCount: r.participantCount } })),
  })

  // Listeners globais de arrasto/pan. Distingue clique (sem mover) de arrasto por limiar de 4px.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      if (padDrag.current) {
        const p = padDrag.current
        if (!p.moved && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < 4) return
        p.moved = true
        setPadGhost({ x: e.clientX, y: e.clientY, regionId: p.regionId })
        return
      }
      if (resize.current) {
        const r = resize.current
        const w = vp.toWorld(e.clientX, e.clientY, rect)
        const nextWidth = Math.max(44, Math.min(640, r.startWidth + (w.x - r.x)))
        const nextHeight = Math.max(32, Math.min(640, r.startHeight + (w.y - r.y)))
        r.nextWidth = nextWidth
        r.nextHeight = nextHeight
        patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((k) => (k.id === r.cardId ? { ...k, width: nextWidth, height: nextHeight } : k)) } }))
      } else if (drag.current) {
        const d = drag.current
        if (d.editOnly) return
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
          d.moved = true
          socket.grab(d.cardId)
        }
        const w = vp.toWorld(e.clientX, e.clientY, rect)
        const x = w.x - d.offX
        const y = w.y - d.offY
        dragPos.current = { x, y }
        patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((k) => (k.id === d.cardId ? { ...k, x, y } : k)) } }))
        socket.move(d.cardId, x, y)
      } else if (panning.current) {
        vp.panBy(e.clientX - panning.current.x, e.clientY - panning.current.y)
        panning.current = { x: e.clientX, y: e.clientY }
      } else {
        const w = vp.toWorld(e.clientX, e.clientY, rect)
        socket.sendCursor(w.x, w.y)
      }
    }
    function onUp(e: PointerEvent) {
      if (padDrag.current) {
        const p = padDrag.current
        padDrag.current = null
        setPadGhost(null)
        if (p.moved) {
          const r = containerRef.current?.getBoundingClientRect()
          if (r) {
            const w = vp.toWorld(e.clientX, e.clientY, r)
            createM.mutate({ text: DEFAULT_CARD_TEXT, color: p.color, x: w.x - POSTIT_WIDTH / 2, y: w.y - POSTIT_HEIGHT / 2 })
          }
        }
        return
      }
      if (resize.current) {
        const r = resize.current
        resizeM.mutate({ cardId: r.cardId, width: r.nextWidth, height: r.nextHeight })
        resize.current = null
      }
      if (drag.current) {
        const d = drag.current
        if (d.moved) {
          if (dragPos.current) updateRetroCardPosition(id, d.cardId, dragPos.current.x, dragPos.current.y).catch(() => {})
          socket.drop(d.cardId)
        } else {
          d.onClick()
        }
        drag.current = null
        dragPos.current = null
      }
      panning.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [id, vp, socket, qc])

  // Excluir o card selecionado com Del/Backspace (fora da edição).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (editingCardId) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (!selectedCardId || !selectedMine) return
      e.preventDefault()
      deleteM.mutate(selectedCardId)
      setSelectedCardId(null)
      setSelectedMine(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingCardId, selectedCardId, selectedMine])

  // Enquadra o board inteiro na primeira renderização com a sala carregada.
  useEffect(() => {
    if (didFit.current || !roomQuery.isSuccess) return
    const raf = requestAnimationFrame(() => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return
      didFit.current = true
      vp.fitTo(rect, BOARD_BOUNDS)
    })
    return () => cancelAnimationFrame(raf)
  }, [roomQuery.isSuccess, vp])

  if (roomQuery.isLoading) return <p className="p-xl text-center text-on-surface-variant">Carregando…</p>
  if (roomQuery.isError || !roomQuery.data) return <p className="p-xl text-center text-error">Sala indisponível.</p>
  const room = roomQuery.data.room
  const isFacilitator = room.myRole === 'FACILITATOR'
  const canWrite = room.myRole !== 'OBSERVER' && room.status === 'OPEN'
  const canEditConcludedActions = room.status === 'CONCLUDED' && isLeaderRole(user?.role)
  // Card-espelho no quadrante "Ações": a origem (que guarda os campos da ação) aponta para ele via actionCardId.
  const originOfMirror = (card: RetroCardDTO) => room.cards.find((c) => c.actionCardId === card.id)
  const isActionMirror = (card: RetroCardDTO) =>
    card.kind !== 'shape' && isInRegion(card, 'actions') && Boolean(originOfMirror(card))
  // Em sala concluída, o LEAD edita a ação pelo card do quadrante "Ações" (espelho) — que grava na origem.
  const canEditCard = (card: RetroCardDTO) =>
    (canWrite && card.mine && card.kind !== 'shape') || (canEditConcludedActions && isActionMirror(card))
  function actionFormFor(card: RetroCardDTO) {
    if (selectedCardId !== card.id || card.kind === 'shape') return undefined
    const base = { value: actionDraft, users: actionUsers, onChange: setActionDraft }
    // Sala aberta: o autor preenche a ação no próprio card de origem (ruim/começar/parar).
    if (canWrite && card.mine && RETRO_ACTION_REGION_IDS.some((rid) => isInRegion(card, rid))) {
      return { ...base, onCommit: (value: ActionFormState) => actionM.mutate({ cardId: card.id, value }) }
    }
    // Sala concluída: o LEAD edita pelo espelho, mas o commit vai para a origem.
    const origin = canEditConcludedActions ? originOfMirror(card) : undefined
    if (origin) return { ...base, onCommit: (value: ActionFormState) => actionM.mutate({ cardId: origin.id, value }) }
    return undefined
  }

  function endEdit() {
    const cardId = editingCardId
    if (!cardId) return
    const card = room.cards.find((c) => c.id === cardId)
    const next = editingText.trim()
    if (card && next && next !== card.text) editM.mutate({ cardId, text: next })
    setEditingCardId(null)
  }

  // Salva o rascunho do formulário de ação antes de trocar/desmarcar a seleção:
  // o campo "Plano" salva no blur, mas desmarcar desmonta o form antes do blur — então persistimos aqui.
  function commitActionDraft() {
    if (!selectedCardId) return
    const card = room.cards.find((c) => c.id === selectedCardId)
    if (!card) return
    const target = canEditConcludedActions ? originOfMirror(card) : canWrite && card.mine ? card : undefined
    if (!target) return
    const dirty =
      actionDraft.plan !== (target.actionPlan ?? '') ||
      actionDraft.responsible !== (target.actionResponsible ?? '') ||
      actionDraft.dueDate !== (target.actionDueDate ?? '')
    if (dirty) actionM.mutate({ cardId: target.id, value: actionDraft })
  }

  function handleCursorClick(card: RetroCardDTO) {
    if (editingCardId && editingCardId !== card.id) endEdit()
    if (selectedCardId && selectedCardId !== card.id) commitActionDraft()
    if (selectedCardId !== card.id) {
      setSelectedCardId(card.id)
      setSelectedMine(card.mine)
      setEditingCardId(null)
      const src = canEditConcludedActions ? originOfMirror(card) ?? card : card
      setActionDraft({
        plan: src.actionPlan ?? '',
        responsible: src.actionResponsible ?? '',
        dueDate: src.actionDueDate ?? '',
      })
    } else if (canWrite && card.mine && card.kind !== 'shape') {
      setEditingCardId(card.id)
      setEditingText(card.text === DEFAULT_CARD_TEXT ? '' : card.text)
    }
  }

  function selectTool(t: RetroTool) {
    setTool(t)
    setActiveReaction(null)
    setVoteArmed(false)
    if (editingCardId) endEdit()
  }

  function onCardPointerDown(e: ReactPointerEvent, card: RetroCardDTO) {
    if (!canWrite) {
      if (canEditConcludedActions && tool === 'cursor' && isActionMirror(card)) {
        drag.current = { cardId: card.id, startX: e.clientX, startY: e.clientY, offX: 0, offY: 0, moved: false, editOnly: true, onClick: () => handleCursorClick(card) }
      }
      return
    }
    if (card.kind === 'shape' && tool !== 'cursor') return
    if (tool === 'react' && activeReaction) {
      if ((e.target as HTMLElement).closest('button')) return
      if (activeReaction === 'eraser') {
        card.reactions.filter((r) => r.reactedByMe).forEach((r) => reactM.mutate({ cardId: card.id, emoji: r.emoji }))
      } else {
        reactM.mutate({ cardId: card.id, emoji: activeReaction })
      }
      return
    }
    if (tool === 'vote') {
      if (voteMode === 'add') {
        if (room.myRemainingVotes > 0) voteM.mutate({ cardId: card.id, dir: 'add' })
      } else if (card.myVotes > 0) {
        voteM.mutate({ cardId: card.id, dir: 'remove' })
      }
      return
    }
    if (tool !== 'cursor') return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const w = vp.toWorld(e.clientX, e.clientY, rect)
    drag.current = {
      cardId: card.id,
      startX: e.clientX,
      startY: e.clientY,
      offX: w.x - card.x,
      offY: w.y - card.y,
      moved: false,
      onClick: () => handleCursorClick(card),
    }
  }

  function onShapeResizePointerDown(e: ReactPointerEvent, card: RetroCardDTO) {
    if (!canWrite || !card.mine || card.kind !== 'shape') return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const w = vp.toWorld(e.clientX, e.clientY, rect)
    resize.current = {
      cardId: card.id,
      x: w.x,
      y: w.y,
      startWidth: card.width ?? 160,
      startHeight: card.height ?? 104,
      nextWidth: card.width ?? 160,
      nextHeight: card.height ?? 104,
    }
  }

  function onCanvasPointerDown(e: ReactPointerEvent) {
    // Pan em qualquer área do board, exceto sobre um card ou um controle (botão/campo de texto).
    const target = e.target as HTMLElement
    if (target.closest('[data-card]') || target.closest('button') || target.closest('textarea') || target.closest('input')) return
    if (editingCardId) endEdit()
    commitActionDraft()
    setSelectedCardId(null)
    setSelectedMine(false)
    setActionDraft({ plan: '', responsible: '', dueDate: '' })
    panning.current = { x: e.clientX, y: e.clientY }
  }

  function isInRegion(card: RetroCardDTO, regionId: string): boolean {
    const region = RETRO_REGIONS.find((r) => r.id === regionId)
    if (!region) return false
    const cx = card.x + POSTIT_WIDTH / 2
    const cy = card.y + POSTIT_HEIGHT / 2
    return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h
  }

  // Cor padronizada por quadrante (só notes; formas mantêm a própria cor).
  function regionColorClassFor(card: RetroCardDTO): string | undefined {
    if (card.kind === 'shape') return undefined
    const rid = Object.keys(REGION_CARD_COLOR_CLASS).find((r) => isInRegion(card, r))
    return rid ? REGION_CARD_COLOR_CLASS[rid] : undefined
  }

  function createAtPoint(body: Omit<CreateRetroCardRequest, 'x' | 'y'>, clientX: number, clientY: number) {
    const rect = viewportRect()
    const w = vp.toWorld(clientX, clientY, rect)
    const width = body.width ?? POSTIT_WIDTH
    const height = body.height ?? POSTIT_HEIGHT
    createM.mutate({ ...body, x: w.x - width / 2, y: w.y - height / 2 })
  }

  // Pad do quadrante: ao pressionar, começa a "puxar" um card; ele só é criado ao
  // soltar (arrasta-e-solta, igual ao Miro). A cor segue o quadrante.
  function startPadPull(regionId: string, clientX: number, clientY: number) {
    padDrag.current = { regionId, color: REGION_DEFAULT_COLOR[regionId] ?? 'yellow', startX: clientX, startY: clientY, moved: false }
  }

  function createShapeAtFlyout(shape: ShapePick) {
    const rect = viewportRect()
    createAtPoint({ kind: 'shape', text: '', ...shape }, rect.left + 230, rect.top + rect.height / 2)
    setTool('cursor')
  }

  function pickVote(m: VoteMode) {
    setVoteMode(m)
    setVoteArmed(true)
  }

  function viewportRect(): DOMRect {
    return containerRef.current?.getBoundingClientRect() ?? ({ left: 0, top: 0, width: 800, height: 600 } as DOMRect)
  }

  return (
    <section className="relative flex h-screen flex-col bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-md border-b border-outline-variant/40 px-lg py-sm">
        <div>
          <span className="font-label text-[11px] uppercase tracking-wide text-primary">{room.status === 'OPEN' ? 'Aberta' : 'Concluída'}</span>
          <h2 className="font-headline text-headline-md text-on-surface">{room.title}</h2>
        </div>
        <RetroTimerPanel
          timer={room.timer}
          canControl={isFacilitator && room.status === 'OPEN'}
          busy={timerM.isPending}
          error={timerError}
          onCommand={(command) => timerM.mutate(command)}
        />
        <div className="flex items-center gap-md">
          <span className="font-label text-label-sm text-on-surface-variant">{socket.presentUserIds.length} online</span>
          {room.status === 'OPEN' && <span className="font-label text-label-sm text-on-surface-variant">Votos: {room.myRemainingVotes}</span>}
          {room.anonymous && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-label text-label-sm text-primary">Anônimo</span>
          )}
          {isFacilitator && room.status === 'OPEN' && (
            <button
              type="button"
              aria-pressed={room.anonymous}
              onClick={() => toggleAnonM.mutate(!room.anonymous)}
              className="flex items-center gap-2 rounded-md px-2 py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
            >
              <span className="text-label-sm">Modo anônimo</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${room.anonymous ? 'bg-primary' : 'bg-outline-variant/50'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${room.anonymous ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </span>
            </button>
          )}
          {isFacilitator && room.status === 'OPEN' && (
            <button
              type="button"
              onClick={() => setParticipantsOpen(true)}
              className="rounded-md border border-outline-variant/40 px-lg py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
            >
              Participantes ({room.participants.length})
            </button>
          )}
          {isFacilitator && room.status === 'OPEN' && (
            <button type="button" onClick={() => concludeM.mutate()} className="rounded-md bg-primary px-lg py-sm font-label font-bold text-on-primary">Concluir</button>
          )}
          {(editsQuery.data?.edits.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setEditsOpen(true)}
              className="rounded-md border border-outline-variant/40 px-lg py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
            >
              Histórico ({editsQuery.data?.edits.length})
            </button>
          )}
          <button
            type="button"
            aria-label="Sair"
            onClick={() => navigate('/retrospectivas')}
            className="rounded-md border border-outline-variant/40 px-lg py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
          >
            Sair
          </button>
        </div>
      </header>

      <div
        ref={containerRef}
        data-world="true"
        onPointerDown={onCanvasPointerDown}
        onWheel={(e) => {
          const rect = containerRef.current?.getBoundingClientRect()
          if (rect) vp.zoomAt(e.clientX, e.clientY, rect, e.deltaY)
        }}
        className="relative flex-1 overflow-hidden bg-surface"
        style={{ cursor: (tool === 'react' && activeReaction) || tool === 'vote' ? 'crosshair' : 'grab', touchAction: 'none' }}
      >
        <div
          data-world="true"
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${vp.pan.x}px, ${vp.pan.y}px) scale(${vp.zoom})` }}
        >
          <BoardInstructions title={room.title} />
          <RegionsBackground />
          {canWrite && <QuadrantPads onPullStart={startPadPull} />}
          {room.cards.map((card) => {
            // No espelho, o carimbo "editado por" vem da origem (que é quem o backend marca).
            const origin = canEditConcludedActions ? originOfMirror(card) : undefined
            const display = origin ? { ...card, editedBy: origin.editedBy, editedAt: origin.editedAt } : card
            return (
              <PostIt
                key={card.id}
                card={display}
                readOnly={!canEditCard(card)}
                interactive={canWrite || (canEditConcludedActions && isActionMirror(card))}
                lockedBy={socket.lockOf(card.id)}
                selected={selectedCardId === card.id}
                editing={editingCardId === card.id}
                editingText={editingText}
                onPointerDown={(e) => onCardPointerDown(e, card)}
                onResizePointerDown={(e) => onShapeResizePointerDown(e, card)}
                onEditChange={setEditingText}
                onEndEdit={endEdit}
                wide={card.kind !== 'shape' && RETRO_ACTION_REGION_IDS.some((rid) => isInRegion(card, rid))}
                regionColorClass={regionColorClassFor(card)}
                actionForm={actionFormFor(card)}
              />
            )
          })}
          {(() => {
            const actionsRegion = RETRO_REGIONS.find((r) => r.id === 'actions')!
            // Carry-over é fixo no topo da região "Ações" (não arrastável); as ações próprias nascem abaixo da faixa reservada.
            const carry = [...(carryoverQuery.data?.overdue ?? []), ...(carryoverQuery.data?.toValidate ?? [])]
            return carry.map((it, i) => {
              const x = actionsRegion.x + 40 + (i % 4) * 240
              const y = actionsRegion.y + 80 + Math.floor(i / 4) * 240
              return (
                <div key={it.id} className="absolute" style={{ left: x, top: y }}>
                  <CarryoverCard item={it} canAct={canActCarryover} onAction={(cardId, action, dueDate) => carryoverM.mutate({ cardId, action, dueDate })} />
                </div>
              )
            })
          })()}
        </div>
        <LiveCursors cursors={socket.cursors} pan={vp.pan} zoom={vp.zoom} />
        <FloatingReactions reactions={socket.floatingReactions} participants={room.participants} />
        {canWrite && <FloatingReactionBar onReact={socket.sendReaction} />}
        <ZoomControls
          zoom={vp.zoom}
          onZoomIn={() => vp.zoomIn(viewportRect())}
          onZoomOut={() => vp.zoomOut(viewportRect())}
          onReset={() => vp.fitTo(viewportRect(), BOARD_BOUNDS)}
        />
      </div>

      {padGhost && (
        <div
          className={`pointer-events-none fixed z-50 rounded-lg border-2 shadow-xl ${REGION_CARD_COLOR_CLASS[padGhost.regionId] ?? ''}`}
          style={{
            left: padGhost.x,
            top: padGhost.y,
            width: POSTIT_WIDTH * vp.zoom,
            height: POSTIT_HEIGHT * vp.zoom,
            transform: 'translate(-50%, -50%) rotate(-3deg)',
          }}
        />
      )}

      {canWrite && (
        <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
          <div className="pointer-events-auto flex items-start gap-2">
            <BoardToolbar tool={tool} onSelectTool={selectTool} />
            {tool === 'shape' && <ShapeFlyout onPick={createShapeAtFlyout} disabled={createM.isPending} />}
            {tool === 'react' && activeReaction === null && <ReactionFlyout active={activeReaction} onSelect={setActiveReaction} />}
            {tool === 'vote' && !voteArmed && <VoteFlyout mode={voteMode} onSelect={pickVote} remaining={room.myRemainingVotes} />}
          </div>
        </div>
      )}
      {participantsOpen && isFacilitator && (
        <ParticipantsPanel
          participants={room.participants}
          invitable={(invitableQuery.data?.users ?? []).filter((u) => !room.participants.some((p) => p.user.id === u.id))}
          busy={participantsM.isPending}
          onAdd={(uid) => participantsM.mutate([...room.participants.map((p) => p.user.id), uid])}
          onRemove={(uid) => participantsM.mutate(room.participants.map((p) => p.user.id).filter((x) => x !== uid))}
          onClose={() => setParticipantsOpen(false)}
        />
      )}
      {editsOpen && (
        <EditHistoryPanel edits={editsQuery.data?.edits ?? []} onClose={() => setEditsOpen(false)} />
      )}
    </section>
  )
}
