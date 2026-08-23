import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LocalVideoTrack } from 'livekit-client'
import type { CameraBackgroundState } from './useCameraBackground'
import { CameraBackgroundMenu } from './CameraBackgroundMenu'
import { loadLiveKit } from './livekit-loader'
import { loadTrackProcessors } from './track-processors-loader'

vi.mock('./livekit-loader', () => ({ loadLiveKit: vi.fn() }))
vi.mock('./track-processors-loader', () => ({ loadTrackProcessors: vi.fn() }))

const processorInstance = { kind: 'processor' }
const processorsMock = {
  BackgroundProcessor: vi.fn(() => processorInstance),
  supportsBackgroundProcessors: vi.fn(() => true),
}

function makeState(overrides: Partial<CameraBackgroundState> = {}): CameraBackgroundState {
  return {
    background: 'none',
    setBackground: vi.fn(),
    supported: true,
    error: false,
    ...overrides,
  }
}

const onClose = vi.fn()

function fakeTrack() {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
    stop: vi.fn(),
    setProcessor: vi.fn(async () => {}),
    stopProcessor: vi.fn(async () => {}),
  } as unknown as LocalVideoTrack
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadLiveKit).mockResolvedValue({ createLocalVideoTrack: vi.fn(async () => fakeTrack()) } as never)
  vi.mocked(loadTrackProcessors).mockResolvedValue(processorsMock as never)
})

describe('CameraBackgroundMenu', () => {
  it('lista Nenhum, os dois blurs e o fundo EMR, com check na opção ativa', () => {
    render(
      <CameraBackgroundMenu state={makeState({ background: 'blur-leve' })} onClose={onClose} localCameraTrack={fakeTrack()} />,
    )
    expect(screen.getByRole('menuitemradio', { name: /Nenhum/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Blur leve/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: /Blur forte/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /Fundo EMR/ })).toBeInTheDocument()
  })

  it('selecionar uma opção chama setBackground com o id', () => {
    const state = makeState()
    render(<CameraBackgroundMenu state={state} onClose={onClose} localCameraTrack={fakeTrack()} />)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fundo EMR/ }))
    expect(state.setBackground).toHaveBeenCalledWith('img:emr')
  })

  it('Esc fecha o menu', () => {
    render(<CameraBackgroundMenu state={makeState()} onClose={onClose} localCameraTrack={fakeTrack()} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clique fora do data-camera-bg-root fecha o menu', () => {
    render(
      <div>
        <div data-camera-bg-root>
          <CameraBackgroundMenu state={makeState()} onClose={onClose} localCameraTrack={fakeTrack()} />
        </div>
        <button type="button">fora</button>
      </div>,
    )
    fireEvent.mouseDown(screen.getByText('fora'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a miniatura do fundo EMR usa a imagem do catálogo', () => {
    const { container } = render(
      <CameraBackgroundMenu state={makeState()} onClose={onClose} localCameraTrack={fakeTrack()} />,
    )
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/office/camera-backgrounds/emr.jpg')
  })

  it('sem onSelectVideoDevice, não mostra seção de câmera (comportamento existente preservado)', () => {
    render(<CameraBackgroundMenu state={makeState()} onClose={onClose} localCameraTrack={fakeTrack()} />)
    expect(screen.queryByText('Câmera')).not.toBeInTheDocument()
  })

  it('com onSelectVideoDevice, lista os dispositivos de vídeo com "Padrão do sistema" e o item ativo marcado', () => {
    const onSelectVideoDevice = vi.fn()
    render(
      <CameraBackgroundMenu
        state={makeState()}
        onClose={onClose}
        localCameraTrack={fakeTrack()}
        videoDevices={[{ deviceId: 'cam1', label: 'Webcam USB' }]}
        selectedVideoDeviceId="cam1"
        onSelectVideoDevice={onSelectVideoDevice}
      />,
    )
    expect(screen.getByRole('menuitemradio', { name: /Webcam USB/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: /Padrão do sistema/ })).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Webcam USB/ }))
    expect(onSelectVideoDevice).toHaveBeenCalledWith('cam1')
  })

  it('solicita uma track local e mostra a prévia da câmera no painel', async () => {
    const track = fakeTrack()
    const createLocalVideoTrack = vi.fn(async () => track)
    vi.mocked(loadLiveKit).mockResolvedValue({ createLocalVideoTrack } as never)

    render(<CameraBackgroundMenu state={makeState()} onClose={onClose} />)

    await waitFor(() => expect(createLocalVideoTrack).toHaveBeenCalledWith(undefined))
    await waitFor(() => expect(track.attach).toHaveBeenCalled())
    expect(screen.getByLabelText('Prévia da câmera')).toBeInTheDocument()
  })

  it('usa a câmera selecionada para a track temporária do preview', async () => {
    const createLocalVideoTrack = vi.fn(async () => fakeTrack())
    vi.mocked(loadLiveKit).mockResolvedValue({ createLocalVideoTrack } as never)

    render(
      <CameraBackgroundMenu
        state={makeState()}
        onClose={onClose}
        selectedVideoDeviceId="cam1"
      />,
    )

    await waitFor(() => expect(createLocalVideoTrack).toHaveBeenCalledWith({ deviceId: 'cam1' }))
  })

  it('aplica o fundo escolhido na track temporária da prévia', async () => {
    const track = fakeTrack()
    vi.mocked(loadLiveKit).mockResolvedValue({ createLocalVideoTrack: vi.fn(async () => track) } as never)

    render(<CameraBackgroundMenu state={makeState({ background: 'blur-forte' })} onClose={onClose} />)

    await waitFor(() => expect(track.setProcessor).toHaveBeenCalledWith(processorInstance))
    expect(processorsMock.BackgroundProcessor).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'background-blur', blurRadius: 15 }),
    )
  })

  it('mostra ação de tentar novamente quando a permissão da câmera é negada', async () => {
    const createLocalVideoTrack = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    vi.mocked(loadLiveKit).mockResolvedValue({ createLocalVideoTrack } as never)

    render(<CameraBackgroundMenu state={makeState()} onClose={onClose} />)

    expect(await screen.findByText('Libere a câmera para ver a prévia.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(createLocalVideoTrack).toHaveBeenCalledTimes(2))
  })
})
