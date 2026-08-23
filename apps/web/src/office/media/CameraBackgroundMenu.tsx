import { useEffect, useRef, useState } from 'react'
import type { LocalVideoTrack } from 'livekit-client'
import { Icon } from '../../components/Icon'
import { CAMERA_BACKGROUNDS, type CameraBackgroundId } from './camera-backgrounds'
import { useCameraBackground, type CameraBackgroundState } from './useCameraBackground'
import { loadLiveKit } from './livekit-loader'
import type { MediaDeviceOption } from './useMediaDevices'

interface MenuOption {
  id: CameraBackgroundId
  label: string
  icon?: string
  src?: string
}

/**
 * Painel de efeitos de fundo da câmera. Renderizado dentro de um container
 * com `data-camera-bg-root` (split button da MediaBar); segue o padrão do
 * menu de modo do chat por perto: fecha em Esc/clique fora, não fecha ao
 * selecionar (dá para experimentar as opções vendo o próprio preview).
 * `videoDevices`/`onSelectVideoDevice` são opcionais: sem eles, só a lista de
 * fundos aparece (comportamento original, preservado para quem já usa este
 * componente sem escolha de câmera).
 */
export function CameraBackgroundMenu({
  state,
  onClose,
  localCameraTrack = null,
  videoDevices = [],
  selectedVideoDeviceId = null,
  onSelectVideoDevice,
}: {
  state: CameraBackgroundState
  onClose: () => void
  localCameraTrack?: LocalVideoTrack | null
  videoDevices?: MediaDeviceOption[]
  selectedVideoDeviceId?: string | null
  onSelectVideoDevice?: (deviceId: string | null) => void
}) {
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-camera-bg-root]')) onClose()
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

  const options: MenuOption[] = [
    { id: 'none', label: 'Nenhum', icon: 'block' },
    { id: 'blur-leve', label: 'Blur leve', icon: 'blur_on' },
    { id: 'blur-forte', label: 'Blur forte', icon: 'blur_on' },
    ...CAMERA_BACKGROUNDS.map((bg) => ({
      id: `img:${bg.id}` as CameraBackgroundId,
      label: bg.label,
      src: bg.src,
    })),
  ]

  return (
    <div
      role="menu"
      aria-label="Efeitos de fundo da câmera"
      className="absolute bottom-[calc(100%+0.35rem)] left-1/2 z-20 w-60 -translate-x-1/2 overflow-hidden rounded-xl border border-outline-variant bg-surface-container p-1 shadow-xl backdrop-blur"
    >
      <CameraPreview
        background={state.background}
        localCameraTrack={localCameraTrack}
        selectedVideoDeviceId={selectedVideoDeviceId}
      />
      {onSelectVideoDevice && (
        <>
          <p className="px-sm pb-1 pt-xs font-label text-[11px] uppercase tracking-wide text-on-surface-variant">Câmera</p>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selectedVideoDeviceId === null}
            onClick={() => onSelectVideoDevice(null)}
            className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
              selectedVideoDeviceId === null ? 'bg-primary/90 text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            <Icon name="settings_suggest" className="text-[18px]" />
            <span className="min-w-0 flex-1 truncate">Padrão do sistema</span>
            {selectedVideoDeviceId === null && <Icon name="check" className="text-[16px]" />}
          </button>
          {videoDevices.map((device) => {
            const active = selectedVideoDeviceId === device.deviceId
            return (
              <button
                key={device.deviceId}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => onSelectVideoDevice(device.deviceId)}
                className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
                  active ? 'bg-primary/90 text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{device.label}</span>
                {active && <Icon name="check" className="text-[16px]" />}
              </button>
            )
          })}
          <div className="my-1 h-px bg-surface-container-high" />
          <p className="px-sm pb-1 pt-1 font-label text-[11px] uppercase tracking-wide text-on-surface-variant">
            Fundo virtual
          </p>
        </>
      )}
      {options.map((option) => {
        const active = state.background === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => state.setBackground(option.id)}
            className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
              active ? 'bg-primary/90 text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {option.src ? (
              <img src={option.src} alt="" className="h-8 w-14 shrink-0 rounded object-cover" />
            ) : (
              <Icon name={option.icon ?? 'block'} className="text-[18px]" />
            )}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {active && <Icon name="check" className="text-[16px]" />}
          </button>
        )
      })}
    </div>
  )
}

function CameraPreview({
  background,
  localCameraTrack,
  selectedVideoDeviceId,
}: {
  background: CameraBackgroundId
  localCameraTrack: LocalVideoTrack | null
  selectedVideoDeviceId: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [previewTrack, setPreviewTrack] = useState<LocalVideoTrack | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [retry, setRetry] = useState(0)
  const track = localCameraTrack ?? previewTrack

  useCameraBackground(localCameraTrack ? null : previewTrack, background)

  useEffect(() => {
    if (localCameraTrack) {
      setPreviewTrack(null)
      setPermissionDenied(false)
      return
    }

    let cancelled = false
    let createdTrack: LocalVideoTrack | null = null
    setPermissionDenied(false)
    setPreviewTrack(null)

    void (async () => {
      try {
        const { createLocalVideoTrack } = await loadLiveKit()
        const nextTrack = await createLocalVideoTrack(
          selectedVideoDeviceId ? { deviceId: selectedVideoDeviceId } : undefined,
        )
        createdTrack = nextTrack
        if (cancelled) {
          nextTrack.stop()
          return
        }
        setPreviewTrack(nextTrack)
      } catch {
        if (!cancelled) setPermissionDenied(true)
      }
    })()

    return () => {
      cancelled = true
      createdTrack?.stop()
    }
  }, [localCameraTrack, retry, selectedVideoDeviceId])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !track) return
    track.attach(video)
    return () => {
      track.detach(video)
    }
  }, [track])

  return (
    <div className="p-1">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-black">
        {track ? (
          <video
            ref={videoRef}
            aria-label="Prévia da câmera"
            autoPlay
            muted
            playsInline
            className="h-full w-full scale-x-[-1] object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-xs px-sm text-center font-label text-label-sm text-on-surface-variant">
            <Icon name={permissionDenied ? 'videocam_off' : 'videocam'} className="text-[26px] text-on-surface-variant" />
            {permissionDenied ? (
              <>
                <span>Libere a câmera para ver a prévia.</span>
                <button
                  type="button"
                  onClick={() => setRetry((current) => current + 1)}
                  className="rounded-md bg-surface-container-high px-sm py-1 text-on-surface hover:bg-surface-container-high"
                >
                  Tentar novamente
                </button>
              </>
            ) : (
              <span>Solicitando acesso à câmera…</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
