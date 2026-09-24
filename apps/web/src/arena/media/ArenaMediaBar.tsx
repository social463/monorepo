import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { DeviceMenu } from '../../office/media/DeviceMenu'
import { useMediaDevices } from '../../office/media/useMediaDevices'
import type { ArenaMediaState } from './useArenaMedia'

/**
 * Barra de voz, câmera e chat da arena.
 *
 * Enxuta ao lado da `MediaBar` do escritório porque a arena não tem o que a
 * torna grande: alto-falante, trava de sala, reunião, mão levantada, reações,
 * nome de personagem, tela compartilhada. Aqui são três controles — falar,
 * aparecer, escrever — e o escolhedor de dispositivo, que é o mesmo componente
 * do escritório (`DeviceMenu`).
 */
const botaoCls = (ativo: boolean) =>
  `group relative flex h-11 w-11 items-center justify-center rounded-full border transition-all ${
    ativo
      ? 'border-primary/70 bg-primary/20 text-primary'
      : 'border-outline-variant bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
  }`

function Dica({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max -translate-x-1/2 whitespace-nowrap rounded-lg bg-inverse-surface px-sm py-1 text-center font-label text-label-sm text-inverse-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  )
}

export function ArenaMediaBar({
  media,
  chatAberto,
  chatNaoLidas = 0,
  onToggleChat,
  pessoas,
  className = '',
}: {
  media: ArenaMediaState
  chatAberto: boolean
  /** Mensagens que chegaram com o painel fechado. */
  chatNaoLidas?: number
  onToggleChat: () => void
  /** Quantos estão nesta sala de voz, você incluído. */
  pessoas: number
  className?: string
}) {
  const devices = useMediaDevices()
  const [menu, setMenu] = useState<'mic' | 'camera' | null>(null)
  const conectando = media.status === 'connecting'

  return (
    <div
      className={`flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/85 px-md py-1.5 shadow-lg backdrop-blur ${className}`}
    >
      <div className="relative flex items-center" data-mic-menu-root>
        <button
          type="button"
          aria-label={media.micEnabled ? 'Desligar microfone' : 'Ligar microfone'}
          aria-pressed={media.micEnabled}
          disabled={conectando}
          onClick={() => void media.toggleMic()}
          className={`${botaoCls(media.micEnabled)} ${media.micError ? 'border-error text-error' : ''} disabled:opacity-50`}
        >
          <Icon name={media.micEnabled ? 'mic' : 'mic_off'} />
          <Dica>
            {media.micError
              ? 'Sem acesso ao microfone — clique para tentar de novo'
              : media.micEnabled
                ? 'Desligar microfone'
                : 'Ligar microfone'}
          </Dica>
        </button>
        <button
          type="button"
          aria-label="Escolher microfone"
          onClick={() => setMenu((atual) => (atual === 'mic' ? null : 'mic'))}
          className="ml-0.5 flex h-6 w-4 items-center justify-center rounded text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="expand_less" className="text-[16px]" />
        </button>
        {menu === 'mic' && (
          <DeviceMenu
            label="Microfone"
            devices={devices.audioInputs}
            selectedDeviceId={media.audioInputDeviceId}
            onSelect={(deviceId) => {
              void media.setAudioInputDevice(deviceId)
              setMenu(null)
            }}
            onClose={() => setMenu(null)}
            rootAttr="data-mic-menu-root"
          />
        )}
      </div>

      <div className="relative flex items-center" data-camera-menu-root>
        <button
          type="button"
          aria-label={media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          aria-pressed={media.cameraEnabled}
          disabled={conectando}
          onClick={() => void media.toggleCamera()}
          className={`${botaoCls(media.cameraEnabled)} ${media.cameraError ? 'border-error text-error' : ''} disabled:opacity-50`}
        >
          <Icon name={media.cameraEnabled ? 'videocam' : 'videocam_off'} />
          <Dica>
            {media.cameraError
              ? 'Sem acesso à câmera — clique para tentar de novo'
              : media.cameraEnabled
                ? 'Desligar câmera'
                : 'Ligar câmera'}
          </Dica>
        </button>
        <button
          type="button"
          aria-label="Escolher câmera"
          onClick={() => setMenu((atual) => (atual === 'camera' ? null : 'camera'))}
          className="ml-0.5 flex h-6 w-4 items-center justify-center rounded text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="expand_less" className="text-[16px]" />
        </button>
        {menu === 'camera' && (
          <DeviceMenu
            label="Câmera"
            devices={devices.videoInputs}
            selectedDeviceId={media.videoInputDeviceId}
            onSelect={(deviceId) => {
              void media.setVideoInputDevice(deviceId)
              setMenu(null)
            }}
            onClose={() => setMenu(null)}
            rootAttr="data-camera-menu-root"
          />
        )}
      </div>

      <button
        type="button"
        aria-label={chatAberto ? 'Fechar chat' : 'Abrir chat'}
        aria-pressed={chatAberto}
        onClick={onToggleChat}
        className={botaoCls(chatAberto)}
      >
        <Icon name="chat" />
        {chatNaoLidas > 0 && !chatAberto && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-label text-[10px] font-semibold text-on-primary">
            {chatNaoLidas > 9 ? '9+' : chatNaoLidas}
          </span>
        )}
        <Dica>{chatAberto ? 'Fechar chat' : 'Abrir chat'}</Dica>
      </button>

      <span className="flex items-center gap-1 border-l border-outline-variant/40 pl-md font-label text-label-sm text-on-surface-variant">
        <Icon name="group" className="text-[18px]" />
        {pessoas}
      </span>
    </div>
  )
}
