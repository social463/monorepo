import { useEffect, useState, type ReactNode } from 'react'
import {
  OFFICE_CHARACTER_NAME_MAX_LENGTH,
  OFFICE_NEARBY_MESSAGE_MAX_LENGTH,
  type OfficeNearbyMessageKind,
  type OfficeUserStatus,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Avatar, type AvatarSource } from '../../components/Avatar'
import type { OfficeMediaState } from './useOfficeMedia'
import type { OfficeBroadcastState } from './useOfficeBroadcast'
import { CameraBackgroundMenu } from './CameraBackgroundMenu'
import type { CameraBackgroundState } from './useCameraBackground'
import { DeviceMenu } from './DeviceMenu'
import type { MediaDevicesState } from './useMediaDevices'
import { MediaBarMoreMenu, type RoomAudioMenuState } from './MediaBarMoreMenu'
import { presenceStatuses, presenceStatusLabel, presenceStatusDotCls, presenceStatusTextCls } from '../presence-status'

/*
 * Estado inativo em TOKEN, não em branco cravado.
 *
 * A barra é um pill cuja cor vem de `bg-surface` — num tenant de tema claro ela
 * fica branca, e o branco cravado que estava aqui desaparecia dentro dela. Ícone
 * de barra de mídia segue a superfície onde está, não presume fundo escuro.
 */
const toolButtonCls = (active: boolean) =>
  `office-toolbar-btn group relative flex h-11 w-11 items-center justify-center rounded-full border transition-all ${
    active
      ? 'border-primary/70 bg-primary/20 text-primary shadow-[0_0_0_1px_rgb(var(--color-primary)/0.15)]'
      : 'border-outline-variant bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
  }`

const highlightButtonCls = (active: boolean) =>
  `office-toolbar-btn group relative flex h-11 w-11 items-center justify-center rounded-full border transition-all ${
    active
      ? 'border-primary-container/40 bg-primary-container/20 text-primary shadow-[0_0_15px_rgb(var(--brand-primary,37 222 136)/0.3)]'
      : 'border-outline-variant bg-surface-container-high text-on-surface-variant hover:border-primary-container/30 hover:bg-primary-container/10 hover:text-primary'
  }`

/**
 * Tooltip da barra: só aparece no hover/focus do botão pai (`group` — todo
 * botão da barra já tem `group relative`). Substitui o `title` nativo (não
 * usar os dois juntos: o balão do navegador some sozinho por cima deste).
 * Mesmo padrão visual do `ProximityRadar`. Sempre centralizado no botão —
 * `w-max` (sem `max-w`) dimensiona a caixa exatamente pro texto, então o
 * fundo nunca corta antes do fim do texto mesmo nos avisos mais longos.
 */
function ToolbarTooltip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max -translate-x-1/2 whitespace-nowrap rounded-lg bg-inverse-surface px-sm py-1 text-center font-label text-label-sm text-inverse-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  )
}

const DEFAULT_REACTIONS = ['👋', '❤️', '🎉', '👍', '😂', '👏', '💯', '🔥'] as const
const REACTIONS_STORAGE_KEY = 'legends.office.reactions.v1'

function loadStoredReactions(): string[] {
  try {
    const stored = window.localStorage.getItem(REACTIONS_STORAGE_KEY)
    if (!stored) return [...DEFAULT_REACTIONS]
    const parsed: unknown = JSON.parse(stored)
    if (
      !Array.isArray(parsed)
      || parsed.length !== DEFAULT_REACTIONS.length
      || parsed.some((reaction) => typeof reaction !== 'string' || !reaction.trim())
    ) return [...DEFAULT_REACTIONS]
    return parsed.map((reaction) => reaction.trim())
  } catch {
    return [...DEFAULT_REACTIONS]
  }
}

type NearbyChatMode = Exclude<OfficeNearbyMessageKind, 'reaction'>
const nearbyModes: NearbyChatMode[] = ['speech', 'thought']
const nearbyModeLabel: Record<NearbyChatMode, string> = {
  speech: 'Falar',
  thought: 'Pensar',
}
const nearbyModeIcon: Record<NearbyChatMode, string> = {
  speech: 'chat_bubble',
  thought: 'psychology',
}

export function MediaBar({
  media,
  zoneName,
  silenced = false,
  micLocked = false,
  broadcast,
  canBroadcast,
  you,
  isGuest = false,
  status = 'online',
  onSetStatus,
  characterName,
  onSetCharacterName,
  onLeave,
  onEditCharacter,
  nearbyChatOpen,
  onChatOpenChange,
  onNearbyMessage,
  onReaction,
  showRoomControls = false,
  roomPanel = null,
  roomChatUnread = false,
  roomChatUnreadCount = 0,
  onToggleRoomChat,
  onToggleRoomPeople,
  canRaiseHand = false,
  raised = false,
  onToggleRaiseHand,
  canLockRoom = false,
  roomLocked = false,
  onToggleRoomLock,
  onScheduleMeeting,
  roomAudio,
  inMeetingRoom = false,
  canAnnotate = false,
  annotating = false,
  onToggleAnnotate,
  cameraBackground,
  devices,
  audioOutputDeviceId,
  onSelectAudioOutput,
}: {
  media: OfficeMediaState
  zoneName: string | null
  /** Você está na sala de silêncio: sem sala de voz, de propósito. */
  silenced?: boolean
  /** Área de silêncio: microfone forçado desligado e botão bloqueado. */
  micLocked?: boolean
  broadcast: OfficeBroadcastState
  canBroadcast: boolean
  you?: AvatarSource | null
  isGuest?: boolean
  /** Status de presença atual (bolinha do menu de identidade) — default 'online'. */
  status?: OfficeUserStatus
  onSetStatus?: (status: OfficeUserStatus) => void
  /** Alias exibido somente no rótulo do personagem no mapa. */
  characterName?: string | null
  onSetCharacterName?: (name: string) => void
  onLeave: () => void
  onEditCharacter?: () => void
  nearbyChatOpen?: boolean
  onChatOpenChange?: (open: boolean) => void
  onNearbyMessage?: (text: string, kind: OfficeNearbyMessageKind) => void
  onReaction?: (reaction: string) => void
  showRoomControls?: boolean
  roomPanel?: 'chat' | 'people' | null
  roomChatUnread?: boolean
  /** Quantas mensagens novas — vira o número do badge. 0 com `roomChatUnread` mostra só o ponto. */
  roomChatUnreadCount?: number
  onToggleRoomChat?: () => void
  onToggleRoomPeople?: () => void
  /** Independe de `showRoomControls` (que só liga com a grade de câmeras aberta) — o botão de mão vale sempre que está numa sala de reunião. */
  canRaiseHand?: boolean
  raised?: boolean
  onToggleRaiseHand?: () => void
  /** Como `canRaiseHand`, vale sempre que está numa sala de reunião — o cadeado independe da grade de câmeras. */
  canLockRoom?: boolean
  roomLocked?: boolean
  onToggleRoomLock?: () => void
  /** Só dentro de sala de reunião e nunca para convidado (ver OfficePage). */
  onScheduleMeeting?: () => void
  /** Áudio compartilhado da sala; ausente fora de sala e para convidado (ver `MediaBarMoreMenu`). */
  roomAudio?: RoomAudioMenuState
  /** Dentro de uma sala de reunião: promove Reações da menu "Mais" pra botão fixo na barra (e some de lá, ver `MediaBarMoreMenu`). */
  inMeetingRoom?: boolean
  /** Riscar na tela compartilhada em destaque na grade — vem de `MediaTiles` via `onAnnotateStateChange` (ver OfficePage). */
  canAnnotate?: boolean
  annotating?: boolean
  onToggleAnnotate?: () => void
  cameraBackground: CameraBackgroundState
  devices: MediaDevicesState
  audioOutputDeviceId: string | null
  onSelectAudioOutput: (deviceId: string | null) => void
}) {
  const [showReactions, setShowReactions] = useState(false)
  const [uncontrolledShowChat, setUncontrolledShowChat] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showBackgroundMenu, setShowBackgroundMenu] = useState(false)
  const [showMicMenu, setShowMicMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showIdentityMenu, setShowIdentityMenu] = useState(false)
  const [messageKind, setMessageKind] = useState<NearbyChatMode>('speech')
  const [message, setMessage] = useState('')
  const [reactions, setReactions] = useState(loadStoredReactions)
  const [editingReactionIndex, setEditingReactionIndex] = useState<number | null>(null)
  const [reactionDraft, setReactionDraft] = useState('')
  const [characterNameDraft, setCharacterNameDraft] = useState(characterName ?? '')

  // Na sala de silêncio não há sala de voz, então `media.status` é 'off' — o
  // rótulo padrão ("Áudio desligado" / "Entre no escritório") mentiria: a
  // pessoa ESTÁ no escritório, e o áudio está desligado de propósito.
  const statusLabel = silenced
    ? `${zoneName ?? 'Sala de silêncio'} — sem som`
    : media.status === 'connected'
      ? zoneName
        ? `Você está em: ${zoneName}`
        : 'Áudio por proximidade'
      : media.status === 'connecting'
        ? 'Conectando áudio…'
        : media.status === 'error'
          ? 'Sem áudio — tentando reconectar'
          : 'Áudio desligado'
  const mediaControlsDisabled = media.status !== 'connected'
  const mediaDisabledTitle = silenced
    ? 'Sala de silêncio: sem áudio nem vídeo enquanto você estiver aqui'
    : media.status === 'connecting'
      ? 'Conectando áudio e vídeo...'
      : media.status === 'error'
        ? 'Sem conexão de áudio e vídeo — tentando reconectar'
        : 'Entre no escritório para usar áudio e vídeo'
  const micDisabled = mediaControlsDisabled || broadcast.speakerEnabled || micLocked
  const showChat = nearbyChatOpen ?? uncontrolledShowChat
  const leaveLabel = isGuest ? 'Sair do escritório' : 'Voltar ao app — você continua no escritório'

  function setShowChat(open: boolean | ((current: boolean) => boolean)) {
    const next = typeof open === 'function' ? open(showChat) : open
    if (nearbyChatOpen === undefined) setUncontrolledShowChat(next)
    onChatOpenChange?.(next)
  }

  useEffect(() => {
    if (!showIdentityMenu) setCharacterNameDraft(characterName ?? '')
  }, [characterName, showIdentityMenu])

  useEffect(() => {
    const reactWithHotkey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return

      const target = event.target
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) return

      const reaction = reactions[Number(event.key) - 1]
      if (!reaction) return

      onReaction?.(reaction)
      setShowReactions(false)
      setEditingReactionIndex(null)
    }

    document.addEventListener('keydown', reactWithHotkey)
    return () => document.removeEventListener('keydown', reactWithHotkey)
  }, [onReaction, reactions])

  useEffect(() => {
    if (!showModeMenu) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-nearby-mode-root]')) {
        setShowModeMenu(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowModeMenu(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showModeMenu])

  useEffect(() => {
    if (!showIdentityMenu) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-identity-menu-root]')) {
        setShowIdentityMenu(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowIdentityMenu(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showIdentityMenu])

  useEffect(() => {
    if (!showChat) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowChat(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [showChat])

  useEffect(() => {
    if (!showReactions) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-reactions-root]')) {
        setShowReactions(false)
        setEditingReactionIndex(null)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowReactions(false)
        setEditingReactionIndex(null)
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showReactions])

  function sendNearbyMessage() {
    const trimmed = message.trim()
    if (!trimmed) {
      setShowChat(false)
      return
    }
    onNearbyMessage?.(trimmed, messageKind)
    setMessage('')
  }

  function pickReaction(reaction: string) {
    onReaction?.(reaction)
    setShowReactions(false)
    setEditingReactionIndex(null)
  }

  function startEditingReaction(index: number) {
    setEditingReactionIndex(index)
    setReactionDraft(reactions[index])
  }

  function saveReaction() {
    if (editingReactionIndex === null) return
    const reaction = reactionDraft.trim()
    if (!reaction) return

    const updated = reactions.map((current, index) => (
      index === editingReactionIndex ? reaction : current
    ))
    setReactions(updated)
    try {
      window.localStorage.setItem(REACTIONS_STORAGE_KEY, JSON.stringify(updated))
    } catch {
      // A personalização continua válida nesta sessão se o storage estiver indisponível.
    }
    setEditingReactionIndex(null)
  }

  function saveCharacterName() {
    onSetCharacterName?.(characterNameDraft)
    setShowIdentityMenu(false)
  }

  return (
    <div className="relative mx-auto flex w-max max-w-full flex-col items-center gap-sm">
      {showChat && (
        <div className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-outline-variant bg-surface-container text-on-surface shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-outline-variant px-md py-sm">
            <span className="flex-1 text-center font-label text-label-sm text-on-surface-variant">Chat por perto</span>
            <button
              type="button"
              aria-label="Fechar chat por perto"
              onClick={() => setShowChat(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="close" className="text-[18px]" />
            </button>
          </div>
          <div className="flex min-h-10 flex-col gap-xs px-md py-sm font-body text-body-sm">
            <p className="text-on-surface-variant">Sem mensagens por perto.</p>
          </div>
          <form
            className="px-md pb-sm"
            onSubmit={(event) => {
              event.preventDefault()
              sendNearbyMessage()
            }}
          >
            <div className="flex items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-high/70 px-xs py-xs text-on-surface-variant">
              <div className="relative shrink-0" data-nearby-mode-root>
                <button
                  type="button"
                  aria-label="Modo do chat por perto"
                  aria-haspopup="menu"
                  aria-expanded={showModeMenu}
                  onClick={() => setShowModeMenu((current) => !current)}
                  className="flex h-8 items-center gap-1 rounded-md px-xs font-label text-label-sm text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  <Icon name={nearbyModeIcon[messageKind]} className="text-[17px]" />
                  <span>{nearbyModeLabel[messageKind]}</span>
                  <Icon name="expand_more" className="text-[16px] text-on-surface-variant" />
                </button>
                {showModeMenu && (
                  <div className="absolute bottom-[calc(100%+0.35rem)] left-0 z-20 min-w-32 overflow-hidden rounded-lg border border-outline-variant bg-surface-container p-1 shadow-xl backdrop-blur">
                    {nearbyModes.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="menuitemradio"
                        aria-checked={messageKind === mode}
                        onClick={() => {
                          setMessageKind(mode)
                          setShowModeMenu(false)
                        }}
                        className={`flex w-full items-center gap-xs rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
                          messageKind === mode
                            ? 'bg-primary/90 text-on-primary'
                            : 'text-on-surface-variant hover:bg-surface-container-high'
                        }`}
                      >
                        <Icon
                          name={messageKind === mode ? 'check' : nearbyModeIcon[mode]}
                          className="text-[17px]"
                        />
                        <span>{nearbyModeLabel[mode]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                value={message}
                autoFocus
                maxLength={OFFICE_NEARBY_MESSAGE_MAX_LENGTH}
                onChange={(event) => {
                  setMessage([...event.target.value].slice(0, OFFICE_NEARBY_MESSAGE_MAX_LENGTH).join(''))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setShowChat(false)
                  event.stopPropagation()
                }}
                onKeyUp={(event) => event.stopPropagation()}
                placeholder="Mensagem..."
                className="min-w-0 flex-1 bg-transparent font-body text-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
              />
            </div>
          </form>
          <div className="flex items-center justify-between gap-sm px-md pb-sm font-label text-[11px] text-on-surface-variant">
            <span>Mensagens aqui não ficam salvas</span>
            <span aria-label="Caracteres da mensagem">{[...message].length}/{OFFICE_NEARBY_MESSAGE_MAX_LENGTH}</span>
          </div>
        </div>
      )}

      {showReactions && (
        <div
          data-reactions-root
          className="absolute bottom-[4.4rem] left-1/2 z-10 flex -translate-x-1/2 flex-col gap-sm rounded-xl border border-outline-variant bg-surface-container p-sm shadow-2xl backdrop-blur"
        >
          <div className="flex gap-xs">
            {reactions.map((reaction, index) => (
              <div key={index} className="relative pt-1">
                <button
                  type="button"
                  aria-label={`Reagir com ${reaction}`}
                  title={`Atalho: ${index + 1}`}
                  onClick={() => pickReaction(reaction)}
                  className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[20px] hover:bg-surface-container-high"
                >
                  {reaction}
                  <span className="absolute bottom-0.5 right-1 font-label text-[9px] leading-none text-on-surface-variant">
                    {index + 1}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Editar reação ${index + 1}`}
                  title={`Editar emoji do atalho ${index + 1}`}
                  onClick={() => startEditingReaction(index)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-outline-variant bg-surface-container-highest text-on-surface-variant shadow hover:bg-surface-container-high hover:text-on-surface"
                >
                  <Icon name="edit" className="text-[10px]" />
                </button>
              </div>
            ))}
          </div>

          {editingReactionIndex !== null && (
            <form
              className="flex items-center gap-xs border-t border-outline-variant pt-sm"
              onSubmit={(event) => {
                event.preventDefault()
                saveReaction()
              }}
            >
              <label htmlFor="office-reaction-editor" className="font-label text-[11px] text-on-surface-variant">
                Atalho {editingReactionIndex + 1}
              </label>
              <input
                id="office-reaction-editor"
                autoFocus
                value={reactionDraft}
                onChange={(event) => setReactionDraft(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                onKeyUp={(event) => event.stopPropagation()}
                aria-label={`Emoji do atalho ${editingReactionIndex + 1}`}
                className="h-8 w-16 rounded-md border border-outline-variant bg-surface-container-high px-xs text-center text-[18px] text-on-surface outline-none focus:border-primary/70"
              />
              <button
                type="submit"
                aria-label="Salvar reação"
                title="Salvar reação"
                disabled={!reactionDraft.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="check" className="text-[17px]" />
              </button>
              <button
                type="button"
                aria-label="Cancelar edição da reação"
                title="Cancelar"
                onClick={() => setEditingReactionIndex(null)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name="close" className="text-[17px]" />
              </button>
            </form>
          )}
        </div>
      )}

      <div className="flex max-w-full items-center gap-xs rounded-full border border-primary-container/20 bg-surface/70 p-sm shadow-2xl backdrop-blur-xl">
        <div className="mr-xs flex shrink-0 items-center gap-2 border-r border-outline-variant/30 py-1 pl-1 pr-3">
          <div className="relative" data-identity-menu-root>
            <button
              type="button"
              aria-label="Seu status e personagem"
              aria-haspopup="menu"
              aria-expanded={showIdentityMenu}
              onClick={() => setShowIdentityMenu((current) => !current)}
              className="group relative flex h-10 w-10 items-center justify-center rounded-full border border-primary-container/60 bg-surface-container-high p-0.5 font-label text-label-lg text-on-surface shadow-lg transition-transform hover:scale-105"
            >
              <ToolbarTooltip>Seu status e personagem</ToolbarTooltip>
              <div className="h-full w-full overflow-hidden rounded-full">
                <Avatar preferCharacter user={you ?? { name: 'L' }} initialsClassName="font-label text-label-lg text-on-surface" />
              </div>
              <span
                aria-hidden
                className={`absolute bottom-0 right-0 z-10 h-3 w-3 rounded-full border-2 border-surface ${presenceStatusDotCls[status]} ${
                  status === 'online' ? 'presence-online-pulse' : ''
                }`}
              />
            </button>
            {showIdentityMenu && (
              <div className="absolute bottom-[calc(100%+0.35rem)] left-0 z-20 min-w-40 overflow-hidden rounded-lg border border-outline-variant bg-surface-container p-1 shadow-xl backdrop-blur">
                {presenceStatuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={status === s}
                    onClick={() => {
                      onSetStatus?.(s)
                      setShowIdentityMenu(false)
                    }}
                    className={`flex w-full items-center gap-xs rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
                      status === s ? 'bg-primary/90 text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${presenceStatusDotCls[s]}`} />
                    <span>{presenceStatusLabel[s]}</span>
                  </button>
                ))}
                {!isGuest && (
                  <>
                    <div className="my-1 h-px bg-surface-container-high" />
                    <div className="px-sm py-xs">
                      <label className="mb-1 block font-label text-[11px] uppercase tracking-wide text-on-surface-variant">
                        Nome no mapa
                      </label>
                      <div className="flex items-center gap-xs">
                        <input
                          value={characterNameDraft}
                          maxLength={OFFICE_CHARACTER_NAME_MAX_LENGTH}
                          onChange={(event) => setCharacterNameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              saveCharacterName()
                            }
                          }}
                          onKeyUp={(event) => event.stopPropagation()}
                          placeholder={you?.name ?? 'Seu nome'}
                          className="min-w-0 flex-1 rounded-md border border-outline-variant bg-surface-container-high px-xs py-1 font-body text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary/70"
                        />
                        <button
                          type="button"
                          aria-label="Salvar nome no mapa"
                          onClick={saveCharacterName}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                        >
                          <Icon name="check" className="text-[17px]" />
                        </button>
                      </div>
                    </div>
                    <div className="my-1 h-px bg-surface-container-high" />
                    <button
                      type="button"
                      onClick={() => {
                        onEditCharacter?.()
                        setShowIdentityMenu(false)
                      }}
                      className="flex w-full items-center gap-xs rounded-md px-sm py-xs text-left font-label text-label-sm text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      <Icon name="edit" className="text-[17px]" />
                      <span>Editar personagem</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center leading-tight">
            <span className={`font-label text-label-sm uppercase tracking-wider ${presenceStatusTextCls[status]}`}>{presenceStatusLabel[status]}</span>
            <span className="max-w-24 truncate font-label text-[10px] uppercase text-on-surface-variant">
              {characterName || you?.name || 'Você'}
            </span>
          </div>
        </div>
        <span className="sr-only">{statusLabel}</span>

        <div className="relative flex items-center" data-mic-menu-root>
          <button
            type="button"
            aria-label={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
            className={`${
              !media.micEnabled && !micDisabled
                ? 'group relative flex h-11 w-11 items-center justify-center rounded-l-full border border-error/60 bg-error/20 text-error transition-all'
                : `${toolButtonCls(media.micEnabled)} rounded-r-none`
            } disabled:cursor-not-allowed disabled:opacity-45 ${media.localSpeaking ? 'mic-speaking' : ''}`}
            disabled={micDisabled}
            onClick={() => void media.toggleMic()}
          >
            <ToolbarTooltip>
              {micLocked ? 'Microfone desativado na área de silêncio' : mediaControlsDisabled ? mediaDisabledTitle : broadcast.speakerEnabled ? 'Silenciado enquanto o alto-falante está ligado' : media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
            </ToolbarTooltip>
            <Icon name={media.micEnabled ? 'mic' : 'mic_off'} className="text-[22px]" />
          </button>
          <button
            type="button"
            aria-label="Escolher microfone"
            aria-haspopup="menu"
            aria-expanded={showMicMenu}
            disabled={mediaControlsDisabled}
            onClick={() => setShowMicMenu((current) => !current)}
            className="group relative flex h-11 w-5 items-center justify-center rounded-r-full border border-l-0 border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ToolbarTooltip>Escolher microfone</ToolbarTooltip>
            <Icon name="expand_less" className="text-[16px]" />
          </button>
          {showMicMenu && (
            <DeviceMenu
              label="Escolher microfone"
              devices={devices.audioInputs}
              selectedDeviceId={media.audioInputDeviceId}
              onSelect={(id) => {
                void media.setAudioInputDevice(id)
                setShowMicMenu(false)
              }}
              onClose={() => setShowMicMenu(false)}
              rootAttr="data-mic-menu-root"
            />
          )}
        </div>
        <div className="relative flex items-center" data-camera-bg-root>
          <button
            type="button"
            aria-label={media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
            className={`${toolButtonCls(media.cameraEnabled)} rounded-r-none disabled:cursor-not-allowed disabled:opacity-45`}
            disabled={mediaControlsDisabled}
            onClick={() => void media.toggleCamera()}
          >
            <ToolbarTooltip>
              {mediaControlsDisabled ? mediaDisabledTitle : media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
            </ToolbarTooltip>
            <Icon name={media.cameraEnabled ? 'videocam' : 'videocam_off'} className="text-[22px]" />
          </button>
          <button
            type="button"
            aria-label="Efeitos de fundo da câmera"
            aria-haspopup="menu"
            aria-expanded={showBackgroundMenu}
            disabled={!cameraBackground.supported}
            onClick={() => setShowBackgroundMenu((current) => !current)}
            className="group relative flex h-11 w-5 items-center justify-center rounded-r-full border border-l-0 border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ToolbarTooltip>
              {cameraBackground.supported ? 'Efeitos de fundo da câmera' : 'Seu navegador não suporta efeitos de fundo'}
            </ToolbarTooltip>
            <Icon name="expand_less" className="text-[16px]" />
          </button>
          {showBackgroundMenu && (
            <CameraBackgroundMenu
              state={cameraBackground}
              onClose={() => setShowBackgroundMenu(false)}
              localCameraTrack={media.localCameraTrack}
              videoDevices={devices.videoInputs}
              selectedVideoDeviceId={media.videoInputDeviceId}
              onSelectVideoDevice={(id) => void media.setVideoInputDevice(id)}
            />
          )}
        </div>
        <button
          type="button"
          aria-label={media.screenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'}
          className={`${highlightButtonCls(media.screenShareEnabled)} disabled:cursor-not-allowed disabled:opacity-45`}
          disabled={mediaControlsDisabled}
          onClick={() => void media.toggleScreenShare()}
        >
          <ToolbarTooltip>
            {mediaControlsDisabled ? mediaDisabledTitle : media.screenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'}
          </ToolbarTooltip>
          <Icon name={media.screenShareEnabled ? 'stop_screen_share' : 'screen_share'} className="text-[22px]" />
        </button>
        {inMeetingRoom && (
          <button
            type="button"
            aria-label="Reagir"
            aria-expanded={showReactions}
            className={toolButtonCls(showReactions)}
            onClick={() => setShowReactions((current) => !current)}
          >
            <ToolbarTooltip>Reagir</ToolbarTooltip>
            <Icon name="mood" className="text-[22px]" />
          </button>
        )}
        {inMeetingRoom && (
          <button
            type="button"
            aria-label={roomPanel === 'chat' ? 'Fechar chat da sala' : 'Abrir chat da sala'}
            aria-expanded={roomPanel === 'chat'}
            className={toolButtonCls(roomPanel === 'chat')}
            onClick={onToggleRoomChat}
          >
            <ToolbarTooltip>Chat da sala</ToolbarTooltip>
            <Icon name="forum" className="text-[22px]" />
            {roomChatUnread && roomPanel !== 'chat' && (
              // Com contagem vira badge numérico (padrão do sino de
              // notificações); sem ela, continua o ponto. O `aria-label` do
              // botão prevalece sobre este texto, então o nome acessível não
              // muda ao aparecer o número.
              <span
                className={
                  roomChatUnreadCount > 0
                    ? 'absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-error px-1 font-label text-[10px] font-bold text-on-error'
                    : 'absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-error'
                }
              >
                {roomChatUnreadCount > 0 ? (roomChatUnreadCount > 9 ? '9+' : roomChatUnreadCount) : null}
              </span>
            )}
          </button>
        )}
        {canAnnotate && (
          <button
            type="button"
            aria-label={annotating ? 'Parar de riscar' : 'Riscar na tela'}
            aria-expanded={annotating}
            className={toolButtonCls(annotating)}
            onClick={onToggleAnnotate}
          >
            <ToolbarTooltip>{annotating ? 'Parar de riscar (P)' : 'Riscar na tela (P)'}</ToolbarTooltip>
            <Icon name="draw" className="text-[22px]" />
          </button>
        )}

        <div className="mx-1 h-6 w-px shrink-0 bg-outline-variant/30" />

        <div className="relative flex items-center" data-more-menu-root>
          <button
            type="button"
            aria-label="Mais opções"
            aria-haspopup="menu"
            aria-expanded={showMoreMenu}
            className={highlightButtonCls(showMoreMenu)}
            onClick={() => setShowMoreMenu((current) => !current)}
          >
            <ToolbarTooltip>Mais opções</ToolbarTooltip>
            <Icon name="apps" className="text-[22px]" />
          </button>
          {showMoreMenu && (
            <MediaBarMoreMenu
              onClose={() => setShowMoreMenu(false)}
              inMeetingRoom={inMeetingRoom}
              showReactions={showReactions}
              onToggleReactions={() => setShowReactions((current) => !current)}
              showChat={showChat}
              onToggleChat={() => setShowChat((current) => !current)}
              canRaiseHand={canRaiseHand}
              raised={raised}
              onToggleRaiseHand={onToggleRaiseHand}
              showRoomControls={showRoomControls}
              roomPanel={roomPanel}
              onToggleRoomPeople={onToggleRoomPeople}
              canLockRoom={canLockRoom}
              roomLocked={roomLocked}
              onToggleRoomLock={onToggleRoomLock}
              onScheduleMeeting={onScheduleMeeting}
              roomAudio={roomAudio}
              supportsAudioOutputSelection={devices.supportsAudioOutputSelection}
              audioOutputs={devices.audioOutputs}
              audioOutputDeviceId={audioOutputDeviceId}
              onSelectAudioOutput={onSelectAudioOutput}
              canBroadcast={canBroadcast}
              broadcastAvailable={broadcast.available}
              speakerEnabled={broadcast.speakerEnabled}
              onToggleSpeaker={() => void broadcast.toggleSpeaker()}
            />
          )}
        </div>

        <div className="mx-1 h-6 w-px shrink-0 bg-outline-variant/30" />

        <button
          type="button"
          aria-label={leaveLabel}
          className="group relative flex h-11 w-11 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error"
          onClick={onLeave}
        >
          <ToolbarTooltip>{leaveLabel}</ToolbarTooltip>
          <Icon name="logout" className="text-[22px]" />
        </button>
      </div>

      {media.micError && (
        <span className="rounded-full bg-surface-container px-sm py-xs font-label text-label-sm text-error shadow-lg">
          Permissão de microfone negada
        </span>
      )}
      {media.cameraError && (
        <span className="rounded-full bg-surface-container px-sm py-xs font-label text-label-sm text-error shadow-lg">
          Permissão de câmera negada
        </span>
      )}
      {cameraBackground.error && (
        <span className="rounded-full bg-surface-container px-sm py-xs font-label text-label-sm text-error shadow-lg">
          Não foi possível aplicar o fundo
        </span>
      )}
      {media.screenShareError && (
        <span className="rounded-full bg-surface-container px-sm py-xs font-label text-label-sm text-error shadow-lg">
          Não foi possível compartilhar a tela
        </span>
      )}
      {broadcast.speakerError && (
        <span className="rounded-full bg-surface-container px-sm py-xs font-label text-label-sm text-error shadow-lg">
          Não foi possível ligar o alto-falante
        </span>
      )}
    </div>
  )
}
