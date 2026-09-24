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

/** Tile do mapa dos cenários. */
const TILE = 32

/**
 * Recebe TILE e converte, porque é assim que se pensa o cenário ("ela está um
 * tile à direita") — e porque o occupant fala PIXEL desde o movimento livre.
 * O fixture em tile puro é justamente o que deixou o bug passar: o teste
 * concordava com o grafo enquanto a produção mandava pixel.
 */
function occupant(userId: string, tileX: number, tileY: number, tile = TILE): OfficeOccupant {
  const x = tileX * tile + tile / 2
  const y = tileY * tile + tile / 2
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
      <SpatialRemoteAudio track={track} tileWidth={TILE} tileHeight={TILE} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce()
    expect(updateMock).toHaveBeenLastCalledWith(1, 0)
    expect(container).toBeEmptyDOMElement()

    rerender(<SpatialRemoteAudio track={track} tileWidth={TILE} tileHeight={TILE} you={occupant('you', 10, 10)} occupant={occupant('ana', 12, 10)} />)

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
        tileWidth={TILE}
        tileHeight={TILE}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 11, 10)}
        outputDeviceId="out-1"
      />,
    )

    expect(createSpatialAudioGraphMock).toHaveBeenCalledWith(track.mediaStreamTrack, 'out-1')

    rerender(
      <SpatialRemoteAudio
        track={track}
        tileWidth={TILE}
        tileHeight={TILE}
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
        tileWidth={TILE}
        tileHeight={TILE}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 11, 10)}
        volume={0.4}
      />,
    )

    expect(setUserVolumeMock).toHaveBeenLastCalledWith(0.4)

    rerender(
      <SpatialRemoteAudio
        track={track}
        tileWidth={TILE}
        tileHeight={TILE}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 11, 10)}
        volume={0}
      />,
    )

    expect(setUserVolumeMock).toHaveBeenLastCalledWith(0)
    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce()
  })

  it('grafo recriado por troca de track já nasce com a posição e o volume atuais', () => {
    createSpatialAudioGraphMock.mockReturnValue({
      update: updateMock,
      dispose: disposeMock,
      setOutputDevice: vi.fn(),
      setUserVolume: setUserVolumeMock,
    })
    const { rerender } = render(
      <SpatialRemoteAudio
        track={fakeTrack()}
        tileWidth={TILE}
        tileHeight={TILE}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 14, 10)}
        volume={0.2}
      />,
    )

    updateMock.mockClear()
    setUserVolumeMock.mockClear()

    // Track nova (republicou o mic, por exemplo): o grafo é recriado, e os
    // effects de posição e volume não rodam porque as deps deles não mudaram.
    rerender(
      <SpatialRemoteAudio
        track={fakeTrack()}
        tileWidth={TILE}
        tileHeight={TILE}
        you={occupant('you', 10, 10)}
        occupant={occupant('ana', 14, 10)}
        volume={0.2}
      />,
    )

    expect(createSpatialAudioGraphMock).toHaveBeenCalledTimes(2)
    expect(updateMock).toHaveBeenLastCalledWith(4, 0)
    expect(setUserVolumeMock).toHaveBeenLastCalledWith(0.2)
  })

  it('cai para RemoteAudio quando o navegador não tem Web Audio API', () => {
    createSpatialAudioGraphMock.mockReturnValue(null)
    const { getByTestId } = render(
      <SpatialRemoteAudio track={fakeTrack()} tileWidth={TILE} tileHeight={TILE} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    expect(getByTestId('remote-audio-fallback')).toBeTruthy()
  })

  it('desconecta o grafo ao desmontar', () => {
    createSpatialAudioGraphMock.mockReturnValue({ update: updateMock, dispose: disposeMock, setOutputDevice: vi.fn(), setUserVolume: setUserVolumeMock })
    const { unmount } = render(
      <SpatialRemoteAudio track={fakeTrack()} tileWidth={TILE} tileHeight={TILE} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    unmount()

    expect(disposeMock).toHaveBeenCalledOnce()
  })
})

describe('SpatialRemoteAudio e a unidade da distância', () => {
  it('converte o delta em PIXEL para TILE — um tile de distância é dx=1, não dx=32', () => {
    createSpatialAudioGraphMock.mockReturnValue({
      update: updateMock,
      dispose: disposeMock,
      setOutputDevice: vi.fn(),
      setUserVolume: setUserVolumeMock,
    })
    const track = fakeTrack()
    // Mapa de 48: os mesmos "um tile à direita" valem 48 pixels, e o grafo
    // continua recebendo 1. Sem a régua do mapa ativo, o ganho
    // (`computeGain`, que zera em ~4,24 tiles) sairia zerado e o colega ao lado
    // ficaria mudo — o bug que o movimento livre trouxe.
    render(
      <SpatialRemoteAudio
        track={track}
        tileWidth={48}
        tileHeight={48}
        you={occupant('you', 10, 10, 48)}
        occupant={occupant('ana', 11, 10, 48)}
      />,
    )

    expect(updateMock).toHaveBeenLastCalledWith(1, 0)
  })

  it('o delta é fracionário: meio tile andado move o pan sem esperar a virada de tile', () => {
    createSpatialAudioGraphMock.mockReturnValue({
      update: updateMock,
      dispose: disposeMock,
      setOutputDevice: vi.fn(),
      setUserVolume: setUserVolumeMock,
    })
    const track = fakeTrack()
    const you = occupant('you', 10, 10)
    render(
      <SpatialRemoteAudio
        track={track}
        tileWidth={TILE}
        tileHeight={TILE}
        you={you}
        occupant={{ ...you, userId: 'ana', x: you.x + TILE / 2 }}
      />,
    )

    expect(updateMock).toHaveBeenLastCalledWith(0.5, 0)
  })
})
