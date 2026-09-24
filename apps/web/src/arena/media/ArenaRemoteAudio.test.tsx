import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import type { RemoteAudioTrack } from 'livekit-client'
import { ArenaRemoteAudio } from './ArenaRemoteAudio'
import type { ArenaPresenceInfo } from '../ArenaScene'

const updateMock = vi.fn()
const disposeMock = vi.fn()
const createSpatialAudioGraphMock = vi.fn()
vi.mock('../../office/media/spatialAudio', () => ({
  createSpatialAudioGraph: (...args: unknown[]) => createSpatialAudioGraphMock(...args),
}))
vi.mock('../../office/media/RemoteAudio', () => ({
  RemoteAudio: () => <div data-testid="remote-audio-fallback" />,
}))

function fakeTrack(): RemoteAudioTrack {
  return { mediaStreamTrack: {} } as unknown as RemoteAudioTrack
}

function presence(youX: number, outroX: number): ArenaPresenceInfo {
  return {
    youId: 'you',
    you: { x: youX, y: 0 },
    outros: [{ userId: 'ana', x: outroX, y: 0 }],
  }
}

beforeEach(() => {
  updateMock.mockClear()
  disposeMock.mockClear()
  createSpatialAudioGraphMock.mockReset()
  createSpatialAudioGraphMock.mockReturnValue({
    update: updateMock,
    dispose: disposeMock,
    setOutputDevice: vi.fn(),
    setUserVolume: vi.fn(),
  })
})
afterEach(() => vi.useRealTimers())

describe('ArenaRemoteAudio', () => {
  it('em campo, atualiza ganho e pan pela distância PUXADA da cena', () => {
    vi.useFakeTimers()
    let posicoes = presence(10, 12)
    const { container } = render(
      <ArenaRemoteAudio track={fakeTrack()} userId="ana" readPresence={() => posicoes} />,
    )

    expect(updateMock).toHaveBeenLastCalledWith(2, 0)
    // Nada de <audio> próprio: quem toca é o grafo.
    expect(container).toBeEmptyDOMElement()

    // O personagem andou: a próxima leitura do relógio já traz a nova distância,
    // sem re-render nenhum (é o que mantém o quadro fora do React).
    posicoes = presence(10, 15)
    vi.advanceTimersByTime(200)
    expect(updateMock).toHaveBeenLastCalledWith(5, 0)
    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce()
  })

  it('sem posição ainda, toca no ganho máximo em vez de estrear mudo', () => {
    render(<ArenaRemoteAudio track={fakeTrack()} userId="ana" readPresence={() => null} />)
    expect(updateMock).toHaveBeenLastCalledWith(0, 0)
  })

  it('no saguão (sem posição nenhuma), toca por <audio> simples', () => {
    const { getByTestId } = render(<ArenaRemoteAudio track={fakeTrack()} userId="ana" />)
    expect(getByTestId('remote-audio-fallback')).toBeTruthy()
    expect(createSpatialAudioGraphMock).not.toHaveBeenCalled()
  })

  it('sem Web Audio disponível, cai para o <audio> — nunca os dois juntos', () => {
    createSpatialAudioGraphMock.mockReturnValue(null)
    const { getByTestId } = render(
      <ArenaRemoteAudio track={fakeTrack()} userId="ana" readPresence={() => presence(0, 1)} />,
    )
    expect(getByTestId('remote-audio-fallback')).toBeTruthy()
  })

  it('desmontar solta o grafo', () => {
    const { unmount } = render(
      <ArenaRemoteAudio track={fakeTrack()} userId="ana" readPresence={() => presence(0, 1)} />,
    )
    unmount()
    expect(disposeMock).toHaveBeenCalledOnce()
  })
})
