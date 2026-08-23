import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { RemoteAudioTrack } from 'livekit-client'
import type { OfficeOccupant } from '@legends/shared'
import { SpatialRemoteAudio } from './SpatialRemoteAudio'

const disposeMock = vi.fn()
const updateMock = vi.fn()
const setUserVolumeMock = vi.fn()
const createSpatialAudioGraphMock = vi.fn()
vi.mock('./spatialAudio', () => ({
  createSpatialAudioGraph: (...args: unknown[]) => createSpatialAudioGraphMock(...args),
}))
vi.mock('./RemoteAudio', () => ({
  RemoteAudio: () => <div data-testid="remote-audio-fallback" />,
}))

function occupant(userId: string, x: number, y: number): OfficeOccupant {
  return { userId, name: userId, x, y, dir: 'down', avatarSeed: null, avatarOptions: null } as OfficeOccupant
}

function fakeTrack(): RemoteAudioTrack {
  return { mediaStreamTrack: {} } as unknown as RemoteAudioTrack
}

describe('SpatialRemoteAudio', () => {
  beforeEach(() => {
    disposeMock.mockClear()
    updateMock.mockClear()
    setUserVolumeMock.mockClear()
    createSpatialAudioGraphMock.mockReset()
  })

  it('monta o grafo, atualiza pela posição relativa e não renderiza <audio>', () => {
    createSpatialAudioGraphMock.mockReturnValue({ update: updateMock, dispose: disposeMock, setOutputDevice: vi.fn(), setUserVolume: setUserVolumeMock })
    const track = fakeTrack()
    const { container, rerender } = render(
      <SpatialRemoteAudio track={track} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce()
    expect(updateMock).toHaveBeenLastCalledWith(1, 0)
    expect(container).toBeEmptyDOMElement()

    rerender(<SpatialRemoteAudio track={track} you={occupant('you', 10, 10)} occupant={occupant('ana', 12, 10)} />)

    expect(updateMock).toHaveBeenLastCalledWith(2, 0)
    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce() // não recria o grafo só por causa da posição
  })

  it('passa o outputDeviceId pro createSpatialAudioGraph e chama setOutputDevice quando ele muda, sem recriar o grafo', () => {
    const setOutputDeviceMock = vi.fn()
    createSpatialAudioGraphMock.mockReturnValue({
      update: updateMock,
      dispose: disposeMock,
      setOutputDevice: setOutputDeviceMock,
      setUserVolume: setUserVolumeMock,
    })
    const track = fakeTrack()
    const { rerender } = render(
      <SpatialRemoteAudio
        track={track}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 11, 10)}
        outputDeviceId="out-1"
      />,
    )

    expect(createSpatialAudioGraphMock).toHaveBeenCalledWith(track.mediaStreamTrack, 'out-1')

    rerender(
      <SpatialRemoteAudio
        track={track}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 11, 10)}
        outputDeviceId="out-2"
      />,
    )

    expect(setOutputDeviceMock).toHaveBeenCalledWith('out-2')
    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce() // não recria o grafo só por causa da saída
  })

  it('aplica volume de usuário no grafo sem recriar', () => {
    createSpatialAudioGraphMock.mockReturnValue({
      update: updateMock,
      dispose: disposeMock,
      setOutputDevice: vi.fn(),
      setUserVolume: setUserVolumeMock,
    })
    const track = fakeTrack()
    const { rerender } = render(
      <SpatialRemoteAudio
        track={track}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 11, 10)}
        volume={0.4}
      />,
    )

    expect(setUserVolumeMock).toHaveBeenLastCalledWith(0.4)

    rerender(
      <SpatialRemoteAudio
        track={track}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 11, 10)}
        volume={0}
      />,
    )

    expect(setUserVolumeMock).toHaveBeenLastCalledWith(0)
    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce()
  })

  it('cai para RemoteAudio quando o navegador não tem Web Audio API', () => {
    createSpatialAudioGraphMock.mockReturnValue(null)
    const { getByTestId } = render(
      <SpatialRemoteAudio track={fakeTrack()} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    expect(getByTestId('remote-audio-fallback')).toBeTruthy()
  })

  it('desconecta o grafo ao desmontar', () => {
    createSpatialAudioGraphMock.mockReturnValue({ update: updateMock, dispose: disposeMock, setOutputDevice: vi.fn(), setUserVolume: setUserVolumeMock })
    const { unmount } = render(
      <SpatialRemoteAudio track={fakeTrack()} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    unmount()

    expect(disposeMock).toHaveBeenCalledOnce()
  })
})
