import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { ShortcutKeycap } from '../settings/ShortcutKeycap'
import { DeviceMenu } from './DeviceMenu'
import type { MediaDeviceOption } from './useMediaDevices'

/** O que o menu precisa saber do áudio da sala (ver `useRoomAudio`). */
export interface RoomAudioMenuState {
  /** Dá pra iniciar agora: nada tocando na sala e conexão de pé. */
  canStart: boolean
  /** A faixa no ar é sua — o item vira "Parar áudio". */
  isMine: boolean
  /** Quem iniciou a faixa no ar, ou `null` quando não há nenhuma. */
  startedByName: string | null
  onShare: () => void
  onStop: () => void
}

const rowCls = (active: boolean) =>
  `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-label text-label-md transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
    active
      ? 'bg-surface-container-highest/40 text-primary'
      : 'text-on-surface-variant hover:bg-surface-container-highest/40 hover:text-primary'
  }`

/**
 * Popover "Mais" da MediaBar: agrupa ações secundárias (reações, chat por perto,
 * levantar a mão, participantes, trancar sala, saída de áudio, alto-falante)
 * atrás de um único botão. Mesmo padrão de fechamento (Esc/outside-click) do
 * `DeviceMenu`/`CameraBackgroundMenu`. Clicar em qualquer ação fecha o menu —
 * exceto abrir a lista de saída de áudio, que expande inline.
 */
export function MediaBarMoreMenu({
  onClose,
  inMeetingRoom,
  showReactions,
  onToggleReactions,
  showChat,
  onToggleChat,
  canRaiseHand,
  raised,
  onToggleRaiseHand,
  showRoomControls,
  roomPanel,
  onToggleRoomPeople,
  canLockRoom,
  roomLocked,
  onToggleRoomLock,
  onScheduleMeeting,
  roomAudio,
  supportsAudioOutputSelection,
  audioOutputs,
  audioOutputDeviceId,
  onSelectAudioOutput,
  canBroadcast,
  broadcastAvailable,
  speakerEnabled,
  onToggleSpeaker,
}: {
  onClose: () => void
  /** Numa sala de reunião, "Reagir" ganha botão fixo na barra (ver MediaBar) e some daqui. */
  inMeetingRoom: boolean
  showReactions: boolean
  onToggleReactions: () => void
  showChat: boolean
  onToggleChat: () => void
  canRaiseHand: boolean
  raised: boolean
  onToggleRaiseHand?: () => void
  showRoomControls: boolean
  roomPanel: 'chat' | 'people' | null
  onToggleRoomPeople?: () => void
  canLockRoom: boolean
  roomLocked: boolean
  onToggleRoomLock?: () => void
  /**
   * Só dentro de sala de reunião e nunca para convidado (ver OfficePage) — é o
   * único gate do item "Agendar reunião", que independe da grade de câmeras.
   */
  onScheduleMeeting?: () => void
  /**
   * Áudio compartilhado da sala. Ausente fora de sala de reunião e para
   * convidado — quem não pode iniciar não vê o item.
   */
  roomAudio?: RoomAudioMenuState
  supportsAudioOutputSelection: boolean
  audioOutputs: MediaDeviceOption[]
  audioOutputDeviceId: string | null
  onSelectAudioOutput: (deviceId: string | null) => void
  canBroadcast: boolean
  broadcastAvailable: boolean
  speakerEnabled: boolean
  onToggleSpeaker?: () => void
}) {
  const [showAudioOutputMenu, setShowAudioOutputMenu] = useState(false)

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-more-menu-root]')) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  function runAndClose(action?: () => void) {
    return () => {
      action?.()
      onClose()
    }
  }

  const chatLabel = showChat ? 'Fechar chat por perto' : 'Abrir chat por perto'
  const raiseHandLabel = raised ? 'Abaixar a mão' : 'Levantar a mão'
  const roomPeopleLabel = roomPanel === 'people' ? 'Fechar pessoas da sala' : 'Abrir pessoas da sala'
  const lockLabel = roomLocked ? 'Destrancar sala' : 'Trancar sala'
  const speakerLabel = speakerEnabled ? 'Desligar alto-falante' : 'Ligar alto-falante'
  const roomAudioLabel = roomAudio?.isMine
    ? 'Parar áudio'
    : roomAudio?.startedByName
      ? `${roomAudio.startedByName} está tocando`
      : 'Compartilhar áudio'

  return (
    <div
      role="menu"
      aria-label="Mais opções"
      className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-20 w-52 -translate-x-1/2 rounded-xl border border-primary-container/20 bg-surface/95 p-2 shadow-2xl backdrop-blur-xl"
    >
      <div className="mb-1 border-b border-outline-variant/30 px-3 py-1.5">
        <span className="font-label text-[10px] uppercase tracking-widest text-primary">Mais opções</span>
      </div>
      <div className="flex flex-col gap-2">
        {!inMeetingRoom && (
          <button
            type="button"
            role="menuitem"
            aria-label="Reagir"
            aria-expanded={showReactions}
            className={rowCls(showReactions)}
            onClick={runAndClose(onToggleReactions)}
          >
            <Icon name="mood" className="text-[22px]" />
            <span className="min-w-0 flex-1 truncate">Reagir</span>
            <ShortcutKeycap keys="1-8" className="opacity-80" />
          </button>
        )}

        <button
          type="button"
          role="menuitem"
          aria-label={chatLabel}
          aria-expanded={showChat}
          className={rowCls(showChat)}
          onClick={runAndClose(onToggleChat)}
        >
          <Icon name="chat_bubble" className="text-[22px]" />
          <span className="min-w-0 flex-1 truncate">Chat por perto</span>
          <ShortcutKeycap keys="Enter" className="opacity-80" />
        </button>

        {canRaiseHand && (
          <button
            type="button"
            role="menuitem"
            aria-label={raiseHandLabel}
            aria-pressed={raised}
            className={rowCls(raised)}
            onClick={runAndClose(onToggleRaiseHand)}
          >
            <Icon name="back_hand" className="text-[22px]" />
            <span className="min-w-0 flex-1 truncate">{raiseHandLabel}</span>
            <ShortcutKeycap keys="H" className="opacity-80" />
          </button>
        )}

        {showRoomControls && (
          <button
            type="button"
            role="menuitem"
            aria-label={roomPeopleLabel}
            aria-expanded={roomPanel === 'people'}
            className={rowCls(roomPanel === 'people')}
            onClick={runAndClose(onToggleRoomPeople)}
          >
            <Icon name="group" className="text-[22px]" />
            <span className="min-w-0 flex-1 truncate">{roomPeopleLabel}</span>
          </button>
        )}

        {/*
          Como a mão e o cadeado, não depende de `showRoomControls` — marcar
          reunião não tem nada a ver com a grade de câmeras estar aberta (e ela
          nasce fechada, então o item ficava invisível ao entrar na sala).
          `onScheduleMeeting` já vem undefined fora de sala, para convidado e
          para sala sem externalKey: ele sozinho é o gate.
        */}
        {onScheduleMeeting && (
          <button
            type="button"
            role="menuitem"
            aria-label="Agendar reunião"
            className={rowCls(false)}
            onClick={runAndClose(onScheduleMeeting)}
          >
            <Icon name="calendar_month" className="text-[18px]" />
            Agendar reunião
          </button>
        )}

        {canLockRoom && (
          <button
            type="button"
            role="menuitem"
            aria-label={lockLabel}
            title={
              roomLocked
                ? 'Destrancar sala — qualquer pessoa volta a entrar'
                : 'Trancar sala — quem está fora precisa pedir para entrar'
            }
            aria-pressed={roomLocked}
            className={rowCls(roomLocked)}
            onClick={runAndClose(onToggleRoomLock)}
          >
            <Icon name={roomLocked ? 'lock' : 'lock_open'} className="text-[22px]" />
            <span className="min-w-0 flex-1 truncate">{lockLabel}</span>
            <ShortcutKeycap keys="L" className="opacity-80" />
          </button>
        )}

        {roomAudio && (
          <button
            type="button"
            role="menuitem"
            aria-label={roomAudioLabel}
            title={
              roomAudio.isMine
                ? 'Parar o áudio que você está tocando para a sala'
                : roomAudio.startedByName
                  ? `${roomAudio.startedByName} já está tocando um áudio nesta sala`
                  : 'Tocar o áudio de um vídeo do YouTube para a sala'
            }
            disabled={!roomAudio.isMine && !roomAudio.canStart}
            className={rowCls(roomAudio.isMine)}
            onClick={runAndClose(roomAudio.isMine ? roomAudio.onStop : roomAudio.onShare)}
          >
            <Icon name={roomAudio.isMine ? 'stop_circle' : 'music_note'} className="text-[22px]" />
            <span className="min-w-0 flex-1 truncate">{roomAudioLabel}</span>
          </button>
        )}

        {supportsAudioOutputSelection && (
          <div className="relative" data-audio-output-menu-root>
            <button
              type="button"
              role="menuitem"
              aria-label="Escolher saída de áudio"
              aria-haspopup="menu"
              aria-expanded={showAudioOutputMenu}
              className={rowCls(showAudioOutputMenu)}
              onClick={() => setShowAudioOutputMenu((current) => !current)}
            >
              <Icon name="volume_up" className="text-[22px]" />
              <span className="min-w-0 flex-1 truncate">Saída de áudio</span>
              <Icon name={showAudioOutputMenu ? 'expand_less' : 'expand_more'} className="text-[16px] text-on-surface-variant" />
            </button>
            {showAudioOutputMenu && (
              <DeviceMenu
                label="Escolher saída de áudio"
                devices={audioOutputs}
                selectedDeviceId={audioOutputDeviceId}
                onSelect={(deviceId) => {
                  onSelectAudioOutput(deviceId)
                  onClose()
                }}
                onClose={() => setShowAudioOutputMenu(false)}
                rootAttr="data-audio-output-menu-root"
              />
            )}
          </div>
        )}

        {canBroadcast && broadcastAvailable && (
          <button
            type="button"
            role="menuitem"
            aria-label={speakerLabel}
            aria-pressed={speakerEnabled}
            className={rowCls(speakerEnabled)}
            onClick={runAndClose(onToggleSpeaker)}
          >
            <Icon name={speakerEnabled ? 'campaign' : 'volume_up'} className="text-[22px]" />
            <span className="min-w-0 flex-1 truncate">{speakerLabel}</span>
          </button>
        )}
      </div>
      <div
        aria-hidden
        className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-primary-container/20 bg-surface-container"
      />
    </div>
  )
}
