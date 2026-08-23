import { useEffect } from 'react'
import { Icon } from '../../components/Icon'
import type { MediaDeviceOption } from './useMediaDevices'

/**
 * Popover genérico de escolha de dispositivo (mic ou saída de áudio), mesmo
 * padrão do menu de fundo virtual da câmera (`CameraBackgroundMenu`): fecha
 * em Esc/clique fora do container marcado com `rootAttr`, `aria-checked` na
 * opção ativa.
 */
export function DeviceMenu({
  label,
  devices,
  selectedDeviceId,
  onSelect,
  onClose,
  rootAttr,
}: {
  label: string
  devices: MediaDeviceOption[]
  selectedDeviceId: string | null
  onSelect: (deviceId: string | null) => void
  onClose: () => void
  /** Atributo `data-*` do container que NÃO deve fechar o menu ao ser clicado (ex.: `data-mic-menu-root`). */
  rootAttr: string
}) {
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest(`[${rootAttr}]`)) onClose()
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
  }, [onClose, rootAttr])

  return (
    <div
      role="menu"
      aria-label={label}
      className="absolute bottom-[calc(100%+0.35rem)] left-1/2 z-20 w-60 -translate-x-1/2 overflow-hidden rounded-xl border border-outline-variant bg-surface-container p-1 shadow-xl backdrop-blur"
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selectedDeviceId === null}
        onClick={() => onSelect(null)}
        className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
          selectedDeviceId === null ? 'bg-primary/90 text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
        }`}
      >
        <Icon name="settings_suggest" className="text-[18px]" />
        <span className="min-w-0 flex-1 truncate">Padrão do sistema</span>
        {selectedDeviceId === null && <Icon name="check" className="text-[16px]" />}
      </button>
      {devices.map((device) => {
        const active = selectedDeviceId === device.deviceId
        return (
          <button
            key={device.deviceId}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => onSelect(device.deviceId)}
            className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
              active ? 'bg-primary/90 text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{device.label}</span>
            {active && <Icon name="check" className="text-[16px]" />}
          </button>
        )
      })}
    </div>
  )
}
