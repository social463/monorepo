import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeviceMenu } from './DeviceMenu'

const onClose = vi.fn()
const onSelect = vi.fn()
const devices = [
  { deviceId: 'mic1', label: 'Microfone USB' },
  { deviceId: 'mic2', label: 'Microfone do notebook' },
]

beforeEach(() => vi.clearAllMocks())

describe('DeviceMenu', () => {
  it('lista "Padrão do sistema" + os dispositivos, com check na opção ativa', () => {
    render(
      <DeviceMenu
        label="Microfone"
        devices={devices}
        selectedDeviceId="mic2"
        onSelect={onSelect}
        onClose={onClose}
        rootAttr="data-mic-menu-root"
      />,
    )
    expect(screen.getByRole('menuitemradio', { name: /Padrão do sistema/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /Microfone do notebook/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemradio', { name: /Microfone USB/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('selecionar um dispositivo chama onSelect com o deviceId', () => {
    render(
      <DeviceMenu
        label="Microfone"
        devices={devices}
        selectedDeviceId={null}
        onSelect={onSelect}
        onClose={onClose}
        rootAttr="data-mic-menu-root"
      />,
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Microfone USB/ }))
    expect(onSelect).toHaveBeenCalledWith('mic1')
  })

  it('selecionar "Padrão do sistema" chama onSelect com null', () => {
    render(
      <DeviceMenu
        label="Microfone"
        devices={devices}
        selectedDeviceId="mic1"
        onSelect={onSelect}
        onClose={onClose}
        rootAttr="data-mic-menu-root"
      />,
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Padrão do sistema/ }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('Esc fecha o menu', () => {
    render(
      <DeviceMenu
        label="Microfone"
        devices={devices}
        selectedDeviceId={null}
        onSelect={onSelect}
        onClose={onClose}
        rootAttr="data-mic-menu-root"
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clique fora do container com rootAttr fecha o menu', () => {
    render(
      <div>
        <div data-mic-menu-root>
          <DeviceMenu
            label="Microfone"
            devices={devices}
            selectedDeviceId={null}
            onSelect={onSelect}
            onClose={onClose}
            rootAttr="data-mic-menu-root"
          />
        </div>
        <button type="button">fora</button>
      </div>,
    )
    fireEvent.mouseDown(screen.getByText('fora'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
