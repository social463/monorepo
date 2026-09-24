import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  TILE_SIZE,
  tileOfPixel,
  mapZoneAtTile,
  meetingRoomEntryTile,
  officeZoneDisplayName,
  type MapDocumentV1,
  type OfficeDeskDTO,
  type OfficeDeskReminderDetailDTO,
  type OfficeDeskReminderSummaryDTO,
} from '@legends/shared'
import { Icon } from '../components/Icon'
import { OfficeNavRail } from '../office/nav/OfficeNavRail'
import { OfficeSettingsPanel } from '../office/settings/OfficeSettingsPanel'
import { useOfficeInviteToasts } from '../office/notifications/useOfficeInviteToasts'
import { InviteToastStack } from '../office/notifications/InviteToastStack'
import { useOfficeSession } from '../office/session/OfficeSessionContext'
import { OfficeCanvas, type OfficeCanvasHandle } from '../office/OfficeCanvas'
import { useCharacterScreenPositions } from '../office/media/useCharacterScreenPositions'
import { CharacterOverlay } from '../office/media/CharacterOverlay'
import { MediaBar } from '../office/media/MediaBar'
import { MediaTiles } from '../office/media/MediaTiles'
import { RoomChatPreview } from '../office/media/RoomChatPreview'
import { useRoomChatAlerts } from '../office/media/useRoomChatAlerts'
import { ProximityRadar } from '../office/media/ProximityRadar'
import { BroadcastBanner } from '../office/media/BroadcastBanner'
import { useOfficeInteractions } from '../office/useOfficeInteractions'
import { useOfficeLinks } from '../office/useOfficeLinks'
import { useOfficeBall } from '../office/useOfficeBall'
import { BallChargeBar } from '../office/BallChargeBar'
import { useOfficePaintball } from '../office/useOfficePaintball'
import { useOfficeKarts } from '../office/useOfficeKarts'
import { CharacterCard } from '../office/CharacterCard'
import { DeskActionPanel } from '../office/DeskActionPanel'
import { DeskHoverCard } from '../office/DeskHoverCard'
import { useDeskScreenPosition } from '../office/useDeskScreenPosition'
import { IncomingCallPopup } from '../office/IncomingCallPopup'
import { RoomLockedPopup } from '../office/media/RoomLockedPopup'
import { KnockRequestModal } from '../office/media/KnockRequestModal'
import { ScheduleMeetingModal } from '../office/meetings/ScheduleMeetingModal'
import { RoomAudioModal } from '../office/media/RoomAudioModal'
import { PeopleList } from '../office/PeopleList'
import { RaiseHandQueue } from '../office/media/RaiseHandQueue'
import { nearbyRemotesForGrid } from '../office/nearbyRemotesForGrid'
import { useOfficeFloatingReactions } from '../office/useOfficeFloatingReactions'
import { OfficeFloatingReactions } from '../office/OfficeFloatingReactions'
import { useOfficeMapEditing } from '../office/editing/useOfficeMapEditing'
import OfficeEditDrawer from '../office/editing/OfficeEditDrawer'
import SelectionToolbar from '../office/editing/SelectionToolbar'
import { EditorsPresence } from '../office/editing/EditorsPresence'
import { useScreenAnnotations } from '../office/annotation/useScreenAnnotations'
import { lockedZonesByExternalKey } from '../office/lockedZones'
import { useAuth } from '../auth/AuthContext'
import { createOfficeDeskReminder, getOfficeDeskReminder, markOfficeDeskReminderRead } from '../lib/office-desk-reminder-api'

/**
 * Piso de segurança até a cena reportar o mínimo de verdade (poucos ms depois
 * do boot, ver `onMinZoomChange`). Não é limite de produto: quem manda é
 * `computeMinCameraZoom`, que sabe quanto ESTE mapa ainda tem pra afastar
 * antes de caber inteiro na tela. O antigo piso fixo de 60% travava o
 * afastamento no mapa grande, onde dá pra ir bem além disso.
 */
const MIN_ZOOM_FALLBACK = 0.25
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.1
/** Zoom padrão mais afastado, estilo Gather — antes nascia em 1 (100%). */
const INITIAL_ZOOM = 0.7
/** Fallback ESTÁVEL de mesas (ver o call site de `useOfficeInteractions`). */
const NO_DESKS: OfficeDeskDTO[] = []
const NO_DESK_REMINDERS: OfficeDeskReminderSummaryDTO[] = []

function clampZoom(value: number, minZoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(minZoom, Number(value.toFixed(2))))
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function deskObjectBounds(document: MapDocumentV1, externalKey: string) {
  const object = document.objects.find(
    (candidate) => candidate.type === 'desk' && candidate.properties.externalKey === externalKey,
  )
  if (!object || object.type !== 'desk') return null
  return object.geometry
}

export function OfficePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    status,
    enterOffice,
    bridge,
    activeMap,
    activeMapLoading,
    occupants,
    karts,
    balls,
    youId,
    connected,
    editorUserIds,
    isGuest,
    media,
    broadcast,
    canBroadcast,
    cameraBackground,
    roomChat,
    raisedHands,
    roomLock,
    roomModeration,
    roomAudio,
    setUserStatus,
    setCharacterName,
    leaveOffice,
    devices,
    audioOutputDeviceId,
    setAudioOutputDevice,
    remoteUserVolumes,
  } = useOfficeSession()

  const inviteToasts = useOfficeInviteToasts()

  // Montar a página ativa (ou re-ativa) a sessão. Desmontar NÃO encerra —
  // sair da rota é minimizar (PiP); quem encerra é o X do PiP (leaveOffice).
  useEffect(() => {
    enterOffice()
  }, [enterOffice])

  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [minZoom, setMinZoom] = useState(MIN_ZOOM_FALLBACK)
  const [nearbyChatOpen, setNearbyChatOpen] = useState(false)
  const [peopleSidebarOpen, setPeopleSidebarOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [peopleSearch, setPeopleSearch] = useState('')
  const [camerasExpanded, setCamerasExpanded] = useState(false)
  // Espelho do estado de "riscar" — o botão mora na MediaBar, mas só
  // `MediaTiles` sabe se dá pra riscar (tela em destaque na grade?), daí o
  // report via `onAnnotateStateChange`.
  const [annotateState, setAnnotateState] = useState<{ canAnnotate: boolean; annotating: boolean; toggle: () => void }>({
    canAnnotate: false,
    annotating: false,
    toggle: () => {},
  })
  const [roomPanel, setRoomPanel] = useState<'chat' | 'people' | null>(null)
  const [seenRoomChatCount, setSeenRoomChatCount] = useState(0)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [roomAudioOpen, setRoomAudioOpen] = useState(false)
  const [reminderDeskId, setReminderDeskId] = useState<string | null>(null)
  const [reminderMessage, setReminderMessage] = useState('')
  const [reminderPlacement, setReminderPlacement] = useState<{ desk: OfficeDeskDTO; message: string } | null>(null)
  const [reminderSaving, setReminderSaving] = useState(false)
  const [reminderError, setReminderError] = useState<string | null>(null)
  const [reminderDetail, setReminderDetail] = useState<OfficeDeskReminderDetailDTO | null>(null)
  const [reminderLoading, setReminderLoading] = useState(false)
  const canvasRef = useRef<OfficeCanvasHandle>(null)
  const { user } = useAuth()
  const editing = useOfficeMapEditing(canvasRef, user ? { id: user.id, isAdmin: user.role === 'ADMIN' } : null)

  // Presença de edição colaborativa (Task 11): avisa os demais quando o
  // próprio modo de edição liga/desliga, e mantém a flag "edição-suja" no
  // bridge em dia — é o que `mapMessageEffect` (Task 10) lê para suprimir um
  // refetch de mapa que apagaria trabalho não salvo.
  useEffect(() => {
    bridge.emitClientMessage({ type: 'set-editing', editing: editing.state.active })
    // `connected` nas deps: reemite ao reconectar — o hub derruba o editor de
    // `editingActive` na desconexão, e sem isto os demais só voltam a ver
    // este editor se ele alternar o modo de edição manualmente.
  }, [bridge, editing.state.active, connected])

  useEffect(() => {
    bridge.setEditingDirty(editing.state.active && editing.state.dirty)
  }, [bridge, editing.state.active, editing.state.dirty])

  const you = occupants.find((o) => o.userId === youId) ?? null
  // A régua de pixel→tile é sempre a do mapa ATIVO — radar, grade de câmeras,
  // reações e zona medem todos por ela. `TILE_SIZE` só cobre o instante antes
  // de o mapa chegar.
  const tileSize = activeMap?.document.map.tileWidth ?? TILE_SIZE
  // `mapZoneAtTile` recebe TILE; o occupant fala pixel desde o movimento livre.
  const youTile = you ? tileOfPixel(you, tileSize) : null
  const zone = youTile && activeMap ? mapZoneAtTile(activeMap.document, youTile.x, youTile.y) : null
  const inMeetingRoom = zone?.type === 'meeting-room'
  const inSilenceZone = zone?.type === 'private-zone'
  const zoneOccupantIds =
    zone && activeMap
      ? new Set(
          occupants
            .filter(
              (o) => {
                const tile = tileOfPixel(o, tileSize)
                return (
                  mapZoneAtTile(activeMap.document, tile.x, tile.y)?.properties.externalKey ===
                  zone.properties.externalKey
                )
              },
            )
            .map((o) => o.userId),
        )
      : null
  const floatingReactions = useOfficeFloatingReactions(
    bridge,
    occupants,
    you,
    zoneOccupantIds,
    tileSize,
    camerasExpanded,
  )
  const annotations = useScreenAnnotations(bridge, youId)
  const kartAction = useOfficeKarts(bridge, you, karts, !editing.state.active)
  const ballAction = useOfficeBall(bridge, you, balls, !editing.state.active)
  const paintball = useOfficePaintball(bridge, you, !editing.state.active)
  const { nearbyLink } = useOfficeLinks(
    you,
    activeMap?.document,
    !editing.state.active && !kartAction.canInteract,
  )

  // Área de silêncio: mic desligado. Hoje o `useOfficeMedia` já nem entra em
  // sala de voz aqui (nada é publicado), mas manter o mute explícito deixa o
  // estado da UI coerente e correto ao sair. O botão fica bloqueado (ver
  // `micLocked` na MediaBar). Ao sair, não religa sozinho — o usuário decide.
  useEffect(() => {
    if (inSilenceZone) void media.applyMicEnabled(false)
  }, [inSilenceZone, media])
  // O modal de áudio da sala fecha na CONFIRMAÇÃO, não no clique: enquanto a
  // faixa não entra no ar, ele fica aberto mostrando o que o servidor recusou
  // (sala ocupada, cooldown, saiu da sala no meio do caminho).
  useEffect(() => {
    if (roomAudio.isMine) setRoomAudioOpen(false)
  }, [roomAudio.isMine])
  const roomOccupants =
    inMeetingRoom && zoneOccupantIds ? occupants.filter((o) => zoneOccupantIds.has(o.userId)) : []
  const selfCamera =
    media.cameraEnabled && media.localCameraTrack
      ? { track: media.localCameraTrack, name: you?.name ?? 'Você' }
      : null
  // `local` não depende mais de `inMeetingRoom`: a grade (MediaTiles) só
  // renderiza algo quando `expanded`, e `showAllPresent=false` fora de sala
  // já evita que um tile de avatar sozinho force a grade a abrir sozinha —
  // ver comentário em MediaTiles sobre `hasVisible`.
  const local = you
    ? {
        name: you.name,
        track: selfCamera?.track ?? null,
        screenTrack: media.localScreenTrack,
        photoUrl: you.photoUrl,
        avatarStyle: you.avatarStyle,
        avatarSeed: you.avatarSeed,
        avatarOptions: you.avatarOptions,
        micEnabled: media.micEnabled,
        speaking: media.localSpeaking,
      }
    : null

  const roomOccupantCount = (local ? 1 : 0) + media.remotes.length
  const anyScreenShared = media.localScreenTrack != null || media.remotes.some((r) => r.screenTrack)

  // Um quadrado por personagem (badge de nome/status, câmera ou tela
  // compartilhada — prioridade nessa ordem). Tela só conta fora de sala de
  // reunião formal: dentro dela, a própria grade (MediaTiles) já é a UI de
  // tela compartilhada, e o quadradinho voltaria a mostrar câmera/badge.
  const characterOverlays = useMemo(() => {
    return occupants.map((o) => {
      if (o.userId === youId) {
        return {
          userId: o.userId,
          name: o.characterName ?? o.name,
          isGuest: o.isGuest,
          status: o.status,
          cameraTrack: selfCamera?.track ?? null,
          screenTrack: inMeetingRoom ? null : media.localScreenTrack,
          mirrored: true,
        }
      }
      const remote = media.remotes.find((r) => r.userId === o.userId)
      return {
        userId: o.userId,
        name: o.characterName ?? o.name,
        isGuest: o.isGuest,
        status: o.status,
        cameraTrack: remote?.cameraTrack ?? null,
        screenTrack: inMeetingRoom ? null : (remote?.screenTrack ?? null),
        mirrored: false,
      }
    })
  }, [occupants, youId, selfCamera, media.localScreenTrack, media.remotes, inMeetingRoom])
  const characterOverlayUserIds = useMemo(() => characterOverlays.map((o) => o.userId), [characterOverlays])

  /**
   * Salas que aparecem trancadas no mapa. As duas fontes vivem aqui: a lista
   * viva de trancas da sessão (`roomLock.lockedRoomIds`, que o hub manda pro
   * escritório inteiro) e o `status` do cadastro. A cena só recebe o
   * resultado, por `externalKey` — ela não conhece id de `OfficeRoom`.
   */
  const lockedZones = useMemo(
    () => lockedZonesByExternalKey(activeMap?.rooms ?? [], roomLock.lockedRoomIds),
    [activeMap?.rooms, roomLock.lockedRoomIds],
  )
  const characterOverlayPositions = useCharacterScreenPositions(canvasRef, characterOverlayUserIds)

  // `NO_DESKS` em vez de `?? []`: o literal criaria um array novo a cada render
  // enquanto `activeMap` não carrega, e o hook espelha `desks` num efeito que
  // depende da identidade do array (ver `sameDesks`).
  // `karts` entra porque um kart estacionado bloqueia o tile no servidor: sem
  // ele aqui, a caminhada automática traça rota por cima do veículo e cada
  // passo é recusado.
  const interactions = useOfficeInteractions(
    bridge,
    occupants,
    youId,
    activeMap?.document,
    activeMap?.desks ?? NO_DESKS,
    activeMap?.deskReminders ?? NO_DESK_REMINDERS,
    karts,
  )
  const deskReminders = interactions.deskReminders ?? NO_DESK_REMINDERS
  const hoveredDeskPosition = useDeskScreenPosition(canvasRef, interactions.hoveredDesk?.externalKey ?? null)
  const reminderDesk = interactions.desks.find((desk) => desk.id === reminderDeskId) ?? null
  const nearbyDeskReminder = useMemo(() => {
    if (!you || !activeMap || editing.state.active) return null
    const tileWidth = activeMap.document.map.tileWidth
    const tileHeight = activeMap.document.map.tileHeight
    return (
      deskReminders
        .map((reminder) => {
          const bounds = deskObjectBounds(activeMap.document, reminder.deskExternalKey)
          if (!bounds) return null
          const col0 = Math.floor(bounds.x / tileWidth)
          const row0 = Math.floor(bounds.y / tileHeight)
          const col1 = Math.floor((bounds.x + bounds.width - 1) / tileWidth)
          const row1 = Math.floor((bounds.y + bounds.height - 1) / tileHeight)
          // A mesa é medida em COLUNA/LINHA; a pessoa, em pixel.
          const tile = tileOfPixel(you, tileWidth)
          const dx = Math.max(col0 - tile.x, 0, tile.x - col1)
          const dy = Math.max(row0 - tile.y, 0, tile.y - row1)
          const distance = Math.max(dx, dy)
          return distance <= 1 ? { reminder, distance } : null
        })
        .filter((item): item is { reminder: OfficeDeskReminderSummaryDTO; distance: number } => item !== null)
        .sort((a, b) => a.distance - b.distance || a.reminder.createdAt.localeCompare(b.reminder.createdAt))[0]?.reminder ?? null
    )
  }, [activeMap, deskReminders, editing.state.active, you])

  useEffect(() => {
    const reminder = interactions.selectedDeskReminder
    if (!reminder) return
    let cancelled = false
    setReminderLoading(true)
    setReminderError(null)
    setReminderDetail(null)
    void getOfficeDeskReminder(reminder.id)
      .then(({ reminder: detail }) => {
        if (cancelled) return
        setReminderDetail(detail)
        if (detail.canRead) {
          void markOfficeDeskReminderRead(detail.id)
            .then(() => interactions.removeDeskReminder(detail.id))
            .catch((cause) => {
              setReminderError(cause instanceof Error ? cause.message : 'Não foi possível marcar o lembrete como lido')
            })
        }
      })
      .catch((cause) => {
        if (cancelled) return
        const message = cause instanceof Error ? cause.message : 'Não foi possível abrir o presente'
        if (message.toLowerCase().includes('não encontrado')) interactions.removeDeskReminder(reminder.id)
        setReminderError(message)
      })
      .finally(() => {
        if (!cancelled) setReminderLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [interactions.selectedDeskReminder, interactions.removeDeskReminder])

  const closeReminderComposer = () => {
    setReminderDeskId(null)
    setReminderMessage('')
    setReminderError(null)
  }

  const cancelReminderPlacement = () => {
    canvasRef.current?.cancelDeskReminderPlacement()
    setReminderPlacement(null)
    setReminderSaving(false)
  }

  const saveReminder = () => {
    if (!reminderDesk) return
    const message = reminderMessage.trim()
    if (message.length === 0) return
    setReminderError(null)
    const desk = reminderDesk
    const started = canvasRef.current?.startDeskReminderPlacement(desk.externalKey, (giftPosition) => {
      setReminderPlacement(null)
      setReminderSaving(true)
      setReminderError(null)
      createOfficeDeskReminder(desk.id, message, giftPosition)
        .then(({ reminder }) => {
          interactions.addDeskReminder(reminder)
        })
        .catch((cause) => {
          setReminderPlacement(null)
          setReminderDeskId(desk.id)
          setReminderMessage(message)
          setReminderError(cause instanceof Error ? cause.message : 'Não foi possível salvar o lembrete')
        })
        .finally(() => setReminderSaving(false))
    })
    if (!started) {
      setReminderError('Não foi possível encontrar a área da mesa para posicionar o presente')
      return
    }
    setReminderPlacement({ desk, message })
    setReminderDeskId(null)
    setReminderMessage('')
  }

  const closeReminderReader = () => {
    interactions.closeDeskReminder()
    setReminderDetail(null)
    setReminderError(null)
  }

  useEffect(() => {
    if (!nearbyDeskReminder || reminderDesk || reminderDetail || reminderLoading) return
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== 'e' || isTextInputTarget(event.target)) return
      event.preventDefault()
      interactions.openDeskReminder(nearbyDeskReminder.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactions.openDeskReminder, nearbyDeskReminder, reminderDesk, reminderDetail, reminderLoading])

  useEffect(() => {
    if (!reminderPlacement) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelReminderPlacement()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reminderPlacement])

  // Sala com mesa reivindicada se apresenta como "Mesa de <dono>" — derivado
  // da lista viva de mesas do hook, não do documento publicado.
  const zoneName =
    zone && activeMap ? officeZoneDisplayName(activeMap.document, interactions.desks, zone) : null

  // Deep link do convite (/escritorio?sala=aurora): leva o personagem até a
  // sala assim que o mapa carrega e o "você" existe. O param é consumido uma
  // única vez — dependemos de `interactions.walkToTile`/`showToast`
  // especificamente, não do objeto `interactions` inteiro (ele é um literal
  // novo a cada render do hook): se dependêssemos dele, um re-render
  // qualquer entre a chamada de `setSearchParams` e o roteador de fato
  // remover `sala` da URL re-executaria o efeito e reiniciaria a caminhada.
  useEffect(() => {
    const salaKey = searchParams.get('sala')
    if (!salaKey || !activeMap || !you) return

    const target = meetingRoomEntryTile(activeMap.document, salaKey)
    if (target) {
      interactions.walkToTile(target)
    } else {
      interactions.showToast('Sala não encontrada no escritório')
    }

    const next = new URLSearchParams(searchParams)
    next.delete('sala')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, activeMap, you, interactions.walkToTile, interactions.showToast])

  function toggleRoomChat() {
    // O botão de chat da barra fica visível mesmo com a grade fechada (pra
    // dar pra ver mensagem nova sem abrir a grade) — abrir o chat a partir
    // daí precisa expandir a grade junto, senão o painel (que só existe
    // dentro do portal de `MediaTiles` quando `expanded`) não teria onde
    // aparecer.
    if (roomPanel === 'chat') {
      setRoomPanel(null)
      return
    }
    setCamerasExpanded(true)
    setRoomPanel('chat')
  }
  function toggleRoomPeople() {
    setRoomPanel((current) => (current === 'people' ? null : 'people'))
  }

  useEffect(() => {
    if (editing.state.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (isTextInputTarget(e.target)) return
      e.preventDefault()
      setNearbyChatOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing.state.active])

  useEffect(() => {
    if (!interactions.selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') interactions.closeCard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactions])

  // Ctrl/Cmd+D — anda até a própria mesa reivindicada. Sempre ativo (não só
  // com um card aberto); preventDefault pra não abrir o "adicionar aos
  // favoritos" do navegador.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        interactions.walkToMyDesk()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactions])

  // M — liga/desliga o microfone (mesmas travas do botão da MediaBar: sem
  // áudio conectado, alto-falante ligado ou zona de silêncio, não faz nada).
  // preventDefault pra não "clicar" um botão focado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'm' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (isTextInputTarget(e.target)) return
      if (media.status !== 'connected' || broadcast.speakerEnabled || inSilenceZone) return
      e.preventDefault()
      void media.toggleMic()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [media, broadcast.speakerEnabled, inSilenceZone])

  // Espaço — "segurar pra falar": mic abre enquanto a tecla está pressionada
  // e fecha ao soltar. `spaceHeldRef` (não estado — não precisa re-render)
  // rastreia se este listener foi quem abriu o mic, pra soltar no blur da
  // janela também (alt-tab segurando a barra deixaria o mic aberto pra
  // sempre, senão — o keyup nunca chega se o foco sai da página).
  const spaceHeldRef = useRef(false)
  useEffect(() => {
    const canPushToTalk = () => media.status === 'connected' && !broadcast.speakerEnabled && !inSilenceZone
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (isTextInputTarget(e.target)) return
      if (!canPushToTalk()) return
      e.preventDefault()
      spaceHeldRef.current = true
      void media.applyMicEnabled(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceHeldRef.current) return
      spaceHeldRef.current = false
      void media.applyMicEnabled(false)
    }
    const onBlur = () => {
      if (!spaceHeldRef.current) return
      spaceHeldRef.current = false
      void media.applyMicEnabled(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [media, broadcast.speakerEnabled, inSilenceZone])

  // L — tranca/destranca a sala atual (mesma trava do item "Trancar sala" da
  // MediaBar: só funciona onde `canLock` é true, ex. dentro de uma sala).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'l' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (isTextInputTarget(e.target)) return
      if (!roomLock.canLock) return
      e.preventDefault()
      roomLock.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [roomLock])

  // H — levanta/abaixa a mão quando a ação está disponível na sala ou zona
  // atual. Fica no React pelo mesmo motivo do L: a regra de disponibilidade e
  // a action já vivem em `raisedHands`.
  useEffect(() => {
    if (editing.state.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'h' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (isTextInputTarget(e.target)) return
      if (!raisedHands.canRaise) return
      e.preventDefault()
      raisedHands.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing.state.active, raisedHands])

  // Refs-espelho pra detectar BORDA de transição (entrou na sala agora /
  // compartilhamento começou agora) sem reforçar camerasExpanded=true a
  // cada render enquanto o mesmo estado continua — isso respeitaria um
  // fechamento manual do usuário caso não fosse por borda. Iniciam em
  // `false` (não no valor atual de `inMeetingRoom`/`anyScreenShared`) de
  // propósito: assim o primeiro render já conta como "borda" quando a sala/
  // compartilhamento já chegam ativos no mount (entrar numa sala com tela já
  // em curso).
  const prevInMeetingRoomRef = useRef(false)
  const prevAnyScreenSharedRef = useRef(false)

  useEffect(() => {
    const enteredRoom = inMeetingRoom && !prevInMeetingRoomRef.current
    const screenShareStarted = anyScreenShared && !prevAnyScreenSharedRef.current
    if (inMeetingRoom && anyScreenShared && (enteredRoom || screenShareStarted)) {
      setCamerasExpanded(true)
    }
    prevInMeetingRoomRef.current = inMeetingRoom
    prevAnyScreenSharedRef.current = anyScreenShared
  }, [inMeetingRoom, anyScreenShared])

  // A grade nasce sempre sem painel; o usuário escolhe chat/pessoas pelos
  // botões da barra. Ao fechar a grade, limpamos o painel aberto.
  useEffect(() => {
    if (!camerasExpanded) {
      setRoomPanel(null)
    }
  }, [camerasExpanded])

  useEffect(() => {
    if (roomChat.messages.length < seenRoomChatCount) setSeenRoomChatCount(roomChat.messages.length)
  }, [roomChat.messages.length, seenRoomChatCount])

  useEffect(() => {
    if (roomPanel === 'chat') setSeenRoomChatCount(roomChat.messages.length)
  }, [roomChat.messages.length, roomPanel])

  const unreadRoomChatCount = roomPanel === 'chat' ? 0 : Math.max(0, roomChat.messages.length - seenRoomChatCount)
  const hasUnreadRoomChatMessages = unreadRoomChatCount > 0
  const roomChatAlerts = useRoomChatAlerts({
    messages: roomChat.messages,
    youId,
    chatOpen: roomPanel === 'chat',
  })
  const previewOccupant = roomChatAlerts.preview
    ? roomOccupants.find((occupant) => occupant.userId === roomChatAlerts.preview?.userId)
    : undefined

  const count = occupants.length
  const countLabel =
    count === 1 ? '1 pessoa no escritório' : `${count} pessoas no escritório`

  if (status !== 'active' || activeMapLoading) {
    return <p className="p-xl text-on-surface-variant">Carregando mapa do escritório…</p>
  }
  if (!activeMap) {
    return <p className="p-xl text-error">Nenhum mapa ativo está disponível. Peça a um administrador para publicar um mapa.</p>
  }

  return (
    <section
      className="relative h-screen overflow-hidden bg-surface text-on-surface"
      onWheel={(event) => {
        event.preventDefault()
        // Ancorado no cursor (não no centro/canto do mapa) — o ponto do
        // mundo sob o mouse fica fixo, igual ao zoom do editor de mapas.
        const next = clampZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), minZoom)
        canvasRef.current?.zoomAtClientPoint(next, event.clientX, event.clientY)
        setZoom(next)
      }}
    >
      <OfficeCanvas
        ref={canvasRef}
        bridge={bridge}
        document={activeMap.document}
        assets={activeMap.assets}
        desks={activeMap.desks}
        deskReminders={deskReminders}
        lockedZones={lockedZones}
        zoom={zoom}
        onMinZoomChange={(next) => {
          setMinZoom(next)
          // Mapa que cabe na tela não tem o que afastar (mínimo = 100%): se o
          // zoom guardado estava abaixo disso, sobe junto em vez de ficar num
          // valor que a cena não aplica.
          setZoom((value) => clampZoom(value, next))
        }}
        inputLocked={nearbyChatOpen || reminderPlacement !== null}
        focusUserId={interactions.selected?.userId ?? null}
        floatingReactionsActive={camerasExpanded}
      />
      <BroadcastBanner speakers={broadcast.speakers} />

      <div className="pointer-events-none absolute inset-0 z-10">
        {characterOverlays.map((o) => (
          <CharacterOverlay
            key={o.userId}
            name={o.name}
            isGuest={o.isGuest}
            status={o.status}
            isRoomManager={o.userId === roomModeration.currentManager?.userId}
            cameraTrack={o.cameraTrack}
            screenTrack={o.screenTrack}
            mirrored={o.mirrored}
            position={characterOverlayPositions.get(o.userId) ?? null}
            onClickScreen={() => setCamerasExpanded(true)}
          />
        ))}
        {interactions.hoveredDesk && hoveredDeskPosition && (
          <DeskHoverCard desk={interactions.hoveredDesk} youId={youId} position={hoveredDeskPosition} />
        )}
      </div>

      {peopleSidebarOpen && (
        <div className="absolute inset-y-0 left-[68px] z-20 flex" onWheel={(event) => event.stopPropagation()}>
          <aside className="flex h-full w-[18.25rem] flex-col overflow-hidden border-r border-outline-variant/40 bg-surface-container/95 shadow-2xl backdrop-blur">
            <header className="border-b border-outline-variant/30 px-lg py-lg">
              <div className="mb-md flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <span className="font-label text-[11px] uppercase tracking-wide text-primary">Escritório virtual</span>
                  <h1 className="truncate font-headline text-headline-sm text-on-surface">Escritório</h1>
                  <p className="font-label text-label-sm text-on-surface-variant">
                    {connected ? countLabel : 'Conectando...'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Recolher pessoas online"
                  onClick={() => setPeopleSidebarOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                >
                  <Icon name="dock_to_left" className="text-[20px]" />
                </button>
              </div>
            </header>

            <div className="border-b border-outline-variant/20 px-lg py-md">
              <div className="flex items-center gap-sm rounded-lg bg-surface-container-high px-md py-sm text-on-surface-variant">
                <Icon name="search" className="text-[18px]" />
                <input
                  value={peopleSearch}
                  onChange={(event) => setPeopleSearch(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  onKeyUp={(event) => event.stopPropagation()}
                  placeholder="Buscar pessoas"
                  className="min-w-0 flex-1 bg-transparent font-body text-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
                />
              </div>
            </div>

            <PeopleList
              occupants={occupants}
              youId={youId}
              searchTerm={peopleSearch}
              onCall={interactions.call}
              onFollow={interactions.follow}
              onViewProfile={interactions.viewProfile}
              roomManagerId={roomModeration.currentManager?.userId ?? null}
              removableUserIds={roomOccupants.map((o) => o.userId)}
              onRemoveFromRoom={roomModeration.canRemove ? roomModeration.remove : undefined}
            />
          </aside>
        </div>
      )}

      {settingsOpen && (
        <div className="absolute inset-y-0 left-[68px] z-20 flex" onWheel={(event) => event.stopPropagation()}>
          <OfficeSettingsPanel onClose={() => setSettingsOpen(false)} />
        </div>
      )}

      <OfficeNavRail
        isGuest={isGuest}
        peopleOpen={peopleSidebarOpen}
        onTogglePeople={() => {
          setPeopleSidebarOpen((value) => !value)
          setNotificationsOpen(false)
          setSettingsOpen(false)
        }}
        canEditMap={!editing.state.active}
        onEditMap={() => {
          setSettingsOpen(false)
          void editing.enter()
        }}
        notificationsOpen={notificationsOpen}
        onNotificationsOpenChange={(open) => {
          setNotificationsOpen(open)
          if (open) setPeopleSidebarOpen(false)
          if (open) setSettingsOpen(false)
        }}
        settingsOpen={settingsOpen}
        onToggleSettings={() => {
          setSettingsOpen((value) => !value)
          setPeopleSidebarOpen(false)
          setNotificationsOpen(false)
        }}
        onSelectOffice={() => {
          setPeopleSidebarOpen(false)
          setNotificationsOpen(false)
          setSettingsOpen(false)
        }}
        inMeetingRoom={inMeetingRoom}
        camerasExpanded={camerasExpanded}
        onToggleCameras={() => setCamerasExpanded((value) => !value)}
        roomOccupantCount={roomOccupantCount}
      />

      <div
        className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container/95 px-2 py-1 shadow-lg backdrop-blur"
        onWheel={(event) => event.stopPropagation()}
      >
          <button
            type="button"
            aria-label="Centralizar zoom"
            onClick={() => setZoom(INITIAL_ZOOM)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="center_focus_strong" className="text-[20px]" />
          </button>
          <button
            type="button"
            aria-label="Diminuir zoom"
            onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP, minZoom))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-40"
            disabled={zoom <= minZoom}
          >
            <Icon name="zoom_out" className="text-[20px]" />
          </button>
          <span className="min-w-[3.5ch] text-center font-label text-label-sm text-on-surface">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Aumentar zoom"
            onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP, minZoom))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-40"
            disabled={zoom >= MAX_ZOOM}
          >
            <Icon name="zoom_in" className="text-[20px]" />
          </button>
      </div>

      {media.roomName !== null && media.roomName === media.openRoom && (
        <div className="absolute bottom-4 left-[calc(68px+1rem)] z-20">
          <ProximityRadar you={you} occupants={occupants} micEnabled={media.micEnabled} tileSize={tileSize} />
        </div>
      )}

      {/* `canRaise` já reflete "dentro de sala de reunião OU zona privada" —
          o contador/lista aparece nas duas modalidades, não só na sala. */}
      {raisedHands.canRaise && (
        <RaiseHandQueue queue={raisedHands.queue} occupants={occupants} raised={raisedHands.raised} />
      )}

      {!isGuest && <InviteToastStack queue={inviteToasts.queue} dismiss={inviteToasts.dismiss} />}

      {/* HTML puro, fora do canvas do Phaser — por isso fica por cima da
          grade expandida (z-50) e de qualquer outro overlay, diferente da
          bolha antiga desenhada dentro do canvas (ver OfficeFloatingReactions). */}
      {camerasExpanded && <OfficeFloatingReactions reactions={floatingReactions} />}

      {/* Grade de câmeras em tela cheia (Meet-style) — fora do modo
          expandido, este componente não renderiza nada visível. */}
      <MediaTiles
        remotes={nearbyRemotesForGrid(media.remotes, occupants, you, !!zone, tileSize)}
        local={local}
        expanded={camerasExpanded}
        onToggleExpanded={() => setCamerasExpanded((value) => !value)}
        showAllPresent={inMeetingRoom}
        screenShareOrder={media.screenShareOrder}
        roomPanel={roomPanel}
        roomChatMessages={roomChat.messages}
        canSendRoomChatMessage={roomChat.canSend}
        onSendRoomChatMessage={roomChat.sendMessage}
        roomOccupants={roomOccupants}
        onCloseRoomPanel={() => setRoomPanel(null)}
        raisedHandQueue={raisedHands.queue}
        youId={youId}
        remoteUserVolumes={remoteUserVolumes}
        removableUserIds={roomOccupants.map((o) => o.userId)}
        onRemoveFromRoom={roomModeration.canRemove ? roomModeration.remove : undefined}
        annotations={annotations}
        onAnnotateStateChange={setAnnotateState}
      />

      {/* Controles: barra fixa embaixo, sempre acessível independente do
          estado das câmeras — inclusive por cima da grade expandida
          (z-50 do overlay de MediaTiles), daí o z-[60] aqui. */}
      <div
        className="absolute bottom-3 left-1/2 z-[60] flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        {roomChatAlerts.preview && (
          <RoomChatPreview
            message={roomChatAlerts.preview}
            occupant={previewOccupant}
            onOpen={() => {
              roomChatAlerts.dismissPreview()
              toggleRoomChat()
            }}
            onDismiss={roomChatAlerts.dismissPreview}
          />
        )}
        <MediaBar
          media={media}
          zoneName={zoneName}
          silenced={inSilenceZone}
          removedFromRoomBy={roomModeration.removedFrom?.byName ?? null}
          micLocked={inSilenceZone}
          broadcast={broadcast}
          canBroadcast={canBroadcast}
          you={you}
          isGuest={isGuest}
          status={you?.status}
          onSetStatus={setUserStatus}
          characterName={you?.characterName ?? null}
          onSetCharacterName={setCharacterName}
          cameraBackground={cameraBackground}
          devices={devices}
          audioOutputDeviceId={audioOutputDeviceId}
          onSelectAudioOutput={setAudioOutputDevice}
          onLeave={() => {
            if (isGuest) {
              leaveOffice()
              navigate('/convidado/obrigado')
            } else {
              navigate('/')
            }
          }}
          onEditCharacter={isGuest ? undefined : () => navigate('/personagem')}
          nearbyChatOpen={nearbyChatOpen}
          onChatOpenChange={setNearbyChatOpen}
          onNearbyMessage={(text, kind) => {
            bridge.emitClientMessage({ type: 'nearby-message', text, kind })
          }}
          onReaction={(reaction) => {
            bridge.emitClientMessage({ type: 'nearby-message', text: reaction, kind: 'reaction' })
          }}
          showRoomControls={camerasExpanded && inMeetingRoom}
          roomPanel={roomPanel}
          roomChatUnread={hasUnreadRoomChatMessages}
          roomChatUnreadCount={unreadRoomChatCount}
          onToggleRoomChat={toggleRoomChat}
          onToggleRoomPeople={toggleRoomPeople}
          canRaiseHand={raisedHands.canRaise}
          raised={raisedHands.raised}
          onToggleRaiseHand={raisedHands.toggle}
          canLockRoom={roomLock.canLock}
          roomLocked={roomLock.locked}
          onToggleRoomLock={roomLock.toggle}
          roomAudio={
            inMeetingRoom && !isGuest
              ? {
                  canStart: roomAudio.canStart,
                  isMine: roomAudio.isMine,
                  startedByName: roomAudio.track?.startedByName ?? null,
                  onShare: () => {
                    // Mesmo motivo do agendamento: a grade em tela cheia
                    // disputa o nível do modal e o esconderia atrás dela.
                    setCamerasExpanded(false)
                    // A recusa da tentativa ANTERIOR não pode aparecer já na
                    // abertura, colada num link que ninguém digitou ainda.
                    roomAudio.clearError()
                    setRoomAudioOpen(true)
                  },
                  onStop: roomAudio.stop,
                }
              : undefined
          }
          onScheduleMeeting={
            inMeetingRoom && !isGuest && zone?.properties.externalKey
              ? () => {
                  // A grade em tela cheia (portal `fixed inset-0 z-50`) disputa
                  // o mesmo nível do modal — recolhe junto ao abrir, senão o
                  // agendamento nasce atrás das câmeras.
                  setCamerasExpanded(false)
                  setScheduleOpen(true)
                }
              : undefined
          }
          inMeetingRoom={inMeetingRoom}
          canAnnotate={annotateState.canAnnotate}
          annotating={annotateState.annotating}
          onToggleAnnotate={annotateState.toggle}
        />
      </div>

      {interactions.selected && (
        <div
          className="absolute right-3 top-3 z-30 w-[min(18rem,calc(100vw-1.5rem))] md:right-5 md:top-5"
          onWheel={(event) => event.stopPropagation()}
        >
          <CharacterCard
            occupant={interactions.selected}
            entry={interactions.selectedEntry}
            isSelf={interactions.selected.userId === youId}
            onCall={() => interactions.call(interactions.selected!.userId)}
            onFollow={() => interactions.follow(interactions.selected!.userId)}
            onViewProfile={() => interactions.viewProfile(interactions.selected!.userId)}
            onClose={interactions.closeCard}
            remoteUserVolumes={remoteUserVolumes}
          />
        </div>
      )}

      {interactions.selectedDesk && (
        <div
          className="absolute right-3 top-3 z-30 w-[min(18rem,calc(100vw-1.5rem))] md:right-5 md:top-5"
          onWheel={(event) => event.stopPropagation()}
        >
          <DeskActionPanel
            desk={interactions.selectedDesk}
            youId={youId}
            onClaim={interactions.claimSelectedDesk}
            onRelease={interactions.releaseSelectedDesk}
            onLeaveReminder={
              interactions.selectedDesk.claimedBy && interactions.selectedDesk.claimedBy.id !== youId
                ? () => {
                    setReminderDeskId(interactions.selectedDesk!.id)
                    setReminderMessage('')
                    setReminderError(null)
                    interactions.closeDeskCard()
                  }
                : undefined
            }
            onClose={interactions.closeDeskCard}
          />
        </div>
      )}

      {reminderDesk && (
        <div
          className="absolute right-3 top-3 z-40 w-[min(20rem,calc(100vw-1.5rem))] md:right-5 md:top-5"
          onWheel={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="rounded-lg border border-amber-300/60 bg-[#fff7bf] p-md shadow-2xl">
            <div className="mb-sm flex items-start justify-between gap-md">
              <div>
                <p className="font-label text-label-sm text-[#7c4a03]">Mesa de {reminderDesk.claimedBy?.name}</p>
                <h3 className="font-headline text-title-md text-[#3f2f05]">Deixar lembrete</h3>
              </div>
              <button type="button" aria-label="Fechar" onClick={closeReminderComposer} className="flex h-7 w-7 items-center justify-center rounded-md text-[#7c4a03] hover:bg-amber-200/60">
                <Icon name="close" className="text-[18px]" />
              </button>
            </div>
            <textarea
              value={reminderMessage}
              onChange={(event) => setReminderMessage(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
              maxLength={500}
              rows={5}
              autoFocus
              className="mb-sm w-full resize-none rounded-md border border-amber-300/70 bg-amber-50/80 px-sm py-sm font-body text-body-md text-[#3f2f05] outline-none placeholder:text-[#7c4a03]/60 focus:border-amber-500"
              placeholder="Escreva uma mensagem para a pessoa..."
            />
            {reminderError && <p className="mb-sm text-body-sm text-error">{reminderError}</p>}
            <button
              type="button"
              disabled={reminderSaving || reminderMessage.trim().length === 0}
              onClick={saveReminder}
              className="w-full rounded-md bg-primary px-md py-sm font-label text-label-sm font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {reminderSaving ? 'Salvando...' : 'Salvar lembrete'}
            </button>
          </div>
        </div>
      )}

      {(interactions.selectedDeskReminder || reminderDetail || reminderLoading || reminderError) && !reminderDesk && (
        <div
          className="absolute left-1/2 top-[44%] z-40 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2"
          onWheel={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="rounded-lg border border-outline-variant/40 bg-surface-container/95 p-md shadow-2xl backdrop-blur">
            <div className="mb-sm flex items-start justify-between gap-md">
              <div>
                <p className="font-label text-label-sm text-primary">Presente com lembrete</p>
                <h3 className="font-headline text-title-md text-on-surface">
                  {reminderDetail ? `De ${reminderDetail.sender.name}` : 'Abrindo presente'}
                </h3>
              </div>
              <button type="button" aria-label="Fechar" onClick={closeReminderReader} className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface">
                <Icon name="close" className="text-[18px]" />
              </button>
            </div>
            {reminderLoading && <p className="text-body-sm text-on-surface-variant">Carregando lembrete...</p>}
            {reminderError && <p className="text-body-sm text-error">{reminderError}</p>}
            {reminderDetail && !reminderLoading && (
              reminderDetail.canRead ? (
                <p className="whitespace-pre-wrap rounded-md bg-surface-container-high px-md py-sm font-body text-body-md text-on-surface">
                  {reminderDetail.message}
                </p>
              ) : (
                <p className="text-body-sm text-on-surface-variant">
                  {reminderDetail.sender.name} deixou este presente. Só o dono da mesa pode ler o conteúdo.
                </p>
              )
            )}
          </div>
        </div>
      )}

      {reminderPlacement && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-40 flex -translate-x-1/2 items-center gap-sm rounded-full border border-amber-300/60 bg-[#fff7bf]/95 px-lg py-sm font-label text-label-md text-[#3f2f05] shadow-lg backdrop-blur">
          <Icon name="redeem" className="text-[18px] text-[#7c4a03]" />
          <span>
            Clique na mesa de {reminderPlacement.desk.claimedBy?.name} para salvar. <kbd className="rounded bg-amber-200/80 px-1.5 py-0.5 font-label text-label-sm">Esc</kbd> cancela.
          </span>
        </div>
      )}

      {interactions.incomingCall && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2">
          <IncomingCallPopup
            name={interactions.incomingCall.name}
            onAccept={interactions.acceptCall}
            onRefuse={interactions.refuseCall}
          />
        </div>
      )}

      {/* Barrado numa sala trancada (lado de fora) e pedidos para entrar
          (lado de dentro) — nunca aparecem juntos na mesma tela, mas
          compartilham a faixa superior com o popup de chamada. */}
      {interactions.entryDenied && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2">
          <RoomLockedPopup
            roomName={interactions.entryDenied.roomName}
            waiting={interactions.entryDenied.waiting}
            onKnock={interactions.knockToEnter}
            onCancel={interactions.cancelEntryRequest}
          />
        </div>
      )}

      {roomLock.knocks.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2">
          <KnockRequestModal knocks={roomLock.knocks} occupants={occupants} onRespond={roomLock.respond} />
        </div>
      )}

      {scheduleOpen && youId && zone?.properties.externalKey && (
        <ScheduleMeetingModal
          roomExternalKey={zone.properties.externalKey}
          roomName={zoneName ?? zone.properties.name}
          youId={youId}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {roomAudioOpen && (
        <RoomAudioModal
          error={roomAudio.error}
          // Não fecha no submit: a recusa do servidor (`busy`, `cooldown`,
          // `not-in-room`) chega DEPOIS, e fechar aqui engoliria a mensagem.
          // Quem fecha o modal é a faixa entrando no ar (ver o efeito acima).
          onSubmit={(url) => roomAudio.start(url)}
          onClose={() => {
            roomAudio.clearError()
            setRoomAudioOpen(false)
          }}
        />
      )}

      {interactions.toast && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur">
          {interactions.toast}
        </div>
      )}

      {/*
        Avisos de ação ao alcance. Ficam TODOS numa coluna só, e não cada um
        com o seu `bottom`: dois deles podem estar na tela ao mesmo tempo (dá
        para andar armado até perto da bola), e afastar um do outro no olho
        rende exatamente o que rendeu — a diferença de `bottom` menor que a
        altura do chip, um por cima do outro. Aqui o `gap` resolve para
        qualquer combinação, agora e quando entrar o próximo aviso.
      */}
      {!editing.state.active && !reminderPlacement && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-sm">
          {/*
            Só quem está ARMADO vê o aviso: o `Q` que pega o marcador mora no
            painel de atalhos. Um chip permanente convidando o escritório
            inteiro a atirar é ruído para quem só quer trabalhar.
          */}
          {paintball.armed && (
            <div className="pointer-events-auto flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur">
              <Icon name="colorize" className="text-[18px] text-primary" />
              <button
                type="button"
                onClick={() => paintball.fire()}
                disabled={!paintball.canFire}
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 transition hover:bg-surface-container-highest disabled:opacity-40"
              >
                <kbd className="rounded bg-surface-container-highest px-1.5 py-0.5 font-label text-label-sm">V</kbd>
                atirar
              </button>
            </div>
          )}

          {ballAction.canKick && !kartAction.canInteract && (
            <div className="pointer-events-auto flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur">
              <Icon name="sports_soccer" className="text-[18px] text-primary" />
              <button type="button" onClick={() => ballAction.kick('touch')} className="flex items-center gap-1.5 rounded-full px-2 py-0.5 transition hover:bg-surface-container-highest">
                <kbd className="rounded bg-surface-container-highest px-1.5 py-0.5 font-label text-label-sm">Z</kbd>
                tocar
              </button>
              <span className="text-on-surface-variant">·</span>
              <button
                type="button"
                onClick={(event) => ballAction.kick('kick', event.shiftKey)}
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 transition hover:bg-surface-container-highest"
              >
                <kbd className="rounded bg-surface-container-highest px-1.5 py-0.5 font-label text-label-sm">X</kbd>
                chutar
              </button>
              <span className="text-on-surface-variant">·</span>
              <button
                type="button"
                onClick={(event) => ballAction.kick('lob', event.shiftKey)}
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 transition hover:bg-surface-container-highest"
              >
                <kbd className="rounded bg-surface-container-highest px-1.5 py-0.5 font-label text-label-sm">C</kbd>
                por cima
              </button>
            </div>
          )}

          {ballAction.charging && (
            <div className="pointer-events-none flex justify-center">
              <BallChargeBar charging={ballAction.charging} />
            </div>
          )}

          {kartAction.canInteract && (
            <div className="flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur">
              <Icon name="sports_motorsports" className="text-[18px] text-primary" />
              <span>
                Aperte <kbd className="rounded bg-surface-container-highest px-1.5 py-0.5 font-label text-label-sm">E</kbd> para {kartAction.riding ? 'estacionar' : 'dirigir'}
              </span>
            </div>
          )}

          {nearbyDeskReminder && !kartAction.canInteract && !ballAction.canKick && (
            <div className="flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur">
              <Icon name="redeem" className="text-[18px] text-primary" />
              <span>
                Aperte <kbd className="rounded bg-surface-container-highest px-1.5 py-0.5 font-label text-label-sm">E</kbd> para abrir o lembrete
              </span>
            </div>
          )}

          {nearbyLink && !kartAction.canInteract && !ballAction.canKick && !nearbyDeskReminder && (
            <div className="flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur">
              <Icon name="link" className="text-[18px] text-primary" />
              <span>
                Aperte <kbd className="rounded bg-surface-container-highest px-1.5 py-0.5 font-label text-label-sm">E</kbd> para abrir “{nearbyLink.label}”
              </span>
            </div>
          )}
        </div>
      )}

      {editing.state.active && (
        // Chip fora do drawer (Task 11) — colada à sua borda esquerda (o
        // drawer é `w-[22rem]` fixo em `right-0`) para não competir com o
        // cabeçalho "Editar mapa"/"Decoração" nem exigir alterar o layout
        // interno do OfficeEditDrawer só para acomodar um aviso raro.
        <div className="pointer-events-none absolute right-[23rem] top-3 z-[71] max-w-[calc(100vw-24rem)]">
          <EditorsPresence editorUserIds={editorUserIds} youId={youId} occupants={occupants} />
        </div>
      )}

      {editing.state.active && activeMap && (
        <OfficeEditDrawer editing={editing} mapTilesets={activeMap.document.tilesets} mapTileWidth={activeMap.document.map.tileWidth} />
      )}

      {editing.state.active && editing.state.selection && (
        <SelectionToolbar
          canvasRef={canvasRef}
          bounds={editing.state.selection.bounds}
          onRotate={(direction) => void editing.rotateSelection(direction)}
          onFlip={(axis) => void editing.flipSelection(axis)}
          onReorder={editing.reorderSelection}
          onClear={editing.clearSelection}
          hasCollision={editing.state.selection.hasCollision}
          onRemoveCollision={editing.removeSelectionCollision}
        />
      )}
    </section>
  )
}
