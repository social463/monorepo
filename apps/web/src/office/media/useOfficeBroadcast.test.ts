import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

const { FakeRoom, FakeParticipant, FakeTrack, createLocalAudioTrackMock } = vi.hoisted(() => {
  class FakeTrack {
    isMuted = false
    stopped = false
    async mute() { this.isMuted = true; return this }
    async unmute() { this.isMuted = false; return this }
    stop() { this.stopped = true }
  }
  class FakeLocalParticipant {
    published: FakeTrack[] = []
    async publishTrack(track: FakeTrack) {
      if (FakeRoom.rejectPublish) throw new Error('not allowed to publish')
      this.published.push(track)
    }
    async unpublishTrack(track: FakeTrack) {
      this.published = this.published.filter((t) => t !== track)
    }
  }
  class FakeParticipant {
    trackPublications = new Map<string, { source: string; isSubscribed: boolean; track: unknown }>()
    constructor(public identity: string, public name: string) {}
  }
  class FakeRoom {
    static instances: FakeRoom[] = []
    static rejectPublish = false
    handlers = new Map<string, Array<() => void>>()
    remoteParticipants = new Map<string, FakeParticipant>()
    localParticipant = new FakeLocalParticipant()
    connectCalls: Array<{ url: string; token: string; opts: { autoSubscribe: boolean } }> = []
    disconnected = false
    constructor() { FakeRoom.instances.push(this) }
    on(event: string, handler: () => void) {
      const list = this.handlers.get(event) ?? []
      list.push(handler)
      this.handlers.set(event, list)
      return this
    }
    emit(event: string) { for (const h of this.handlers.get(event) ?? []) h() }
    async connect(url: string, token: string, opts: { autoSubscribe: boolean }) {
      this.connectCalls.push({ url, token, opts })
    }
    async disconnect() { this.disconnected = true }
  }
  const createLocalAudioTrackMock = vi.fn(async (..._args: unknown[]) => new FakeTrack())
  return { FakeRoom, FakeParticipant, FakeTrack, createLocalAudioTrackMock }
})

vi.mock('livekit-client', () => ({
  Room: FakeRoom,
  RoomEvent: {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
  },
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share' } },
  createLocalAudioTrack: (...args: unknown[]) => createLocalAudioTrackMock(...args),
}))

import { useOfficeBroadcast } from './useOfficeBroadcast'

function makeOpts(overrides: Partial<Parameters<typeof useOfficeBroadcast>[0]> = {}) {
  return {
    enabled: true,
    micEnabled: false,
    setMicEnabled: vi.fn(async () => {}),
    youName: 'Você',
    ...overrides,
  }
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeRoom.instances = []
  FakeRoom.rejectPublish = false
  apiFetchMock.mockReset()
  createLocalAudioTrackMock.mockClear()
  apiFetchMock.mockResolvedValue({ token: 'tk-broadcast', url: 'ws://livekit.test' })
})
afterEach(() => { vi.useRealTimers() })

describe('useOfficeBroadcast', () => {
  it('desligado (flag/escritório), NÃO abre conexão nenhuma — é o interruptor de custo', async () => {
    renderHook(() => useOfficeBroadcast(makeOpts({ enabled: false })))
    await flush()
    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(FakeRoom.instances).toHaveLength(0)
  })

  it('ligado, conecta na sala de broadcast com autoSubscribe', async () => {
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/office/media-token',
      expect.objectContaining({ body: JSON.stringify({ room: 'office-broadcast' }) }),
    )
    const room = FakeRoom.instances.at(-1)!
    expect(room.connectCalls[0].opts.autoSubscribe).toBe(true)
    expect(result.current.available).toBe(true)
  })

  it('toggleSpeaker liga: publica desmutado no broadcast e silencia o mic local; desliga: restaura', async () => {
    const setMicEnabled = vi.fn(async () => {})
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts({ micEnabled: true, setMicEnabled })))
    await flush()
    const room = FakeRoom.instances.at(-1)!

    await act(async () => { await result.current.toggleSpeaker() })
    expect(room.localParticipant.published).toHaveLength(1)
    expect(room.localParticipant.published[0].isMuted).toBe(false)
    expect(setMicEnabled).toHaveBeenLastCalledWith(false)
    expect(result.current.speakerEnabled).toBe(true)
    expect(result.current.speakers).toContain('Você')

    await act(async () => { await result.current.toggleSpeaker() })
    expect(room.localParticipant.published).toHaveLength(0)
    expect(setMicEnabled).toHaveBeenLastCalledWith(true) // estava desmutado antes → restaura desmutado
    expect(result.current.speakerEnabled).toBe(false)
    expect(result.current.speakers).not.toContain('Você')
  })

  it('mic estava mutado antes → ao desligar o alto-falante, restaura MUTADO', async () => {
    const setMicEnabled = vi.fn(async () => {})
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts({ micEnabled: false, setMicEnabled })))
    await flush()
    await act(async () => { await result.current.toggleSpeaker() })
    await act(async () => { await result.current.toggleSpeaker() })
    expect(setMicEnabled).toHaveBeenLastCalledWith(false)
  })

  it('publicação rejeitada pelo servidor (sem canPublish) vira speakerError, sem mexer no mic', async () => {
    FakeRoom.rejectPublish = true
    const setMicEnabled = vi.fn(async () => {})
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts({ setMicEnabled })))
    await flush()
    await act(async () => { await result.current.toggleSpeaker() })
    expect(result.current.speakerError).toBe(true)
    expect(result.current.speakerEnabled).toBe(false)
    expect(setMicEnabled).not.toHaveBeenCalled()
  })

  it('speakers/broadcastTracks refletem participantes remotos com áudio publicado', async () => {
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    const room = FakeRoom.instances.at(-1)!
    const speaker = new FakeParticipant('lead-1', 'Guilherme')
    speaker.trackPublications.set('a', { source: 'microphone', isSubscribed: true, track: new FakeTrack() })
    room.remoteParticipants.set('lead-1', speaker)
    act(() => room.emit('trackPublished'))
    expect(result.current.speakers).toEqual(['Guilherme'])
    expect(result.current.broadcastTracks).toHaveLength(1)

    room.remoteParticipants.delete('lead-1')
    act(() => room.emit('participantDisconnected'))
    expect(result.current.speakers).toEqual([])
  })

  it('falha no token tenta de novo com backoff, sem afetar nada além do broadcast', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('flag desligado no meio do caminho'))
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    expect(result.current.available).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(result.current.available).toBe(true)
  })

  it('unmount desconecta e não deixa retry vivo', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('x'))
    const { unmount } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(FakeRoom.instances.every((r) => r.disconnected || r.connectCalls.length === 0)).toBe(true)
    expect(apiFetchMock).toHaveBeenCalledTimes(1) // nenhum retry pós-unmount
  })

  it('publicação rejeitada: libera a captura do microfone (track.stop) — senão o indicador de gravação fica aceso à toa', async () => {
    FakeRoom.rejectPublish = true
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    await act(async () => { await result.current.toggleSpeaker() })
    expect(createLocalAudioTrackMock).toHaveBeenCalledTimes(1)
    const track = await createLocalAudioTrackMock.mock.results[0]!.value
    expect(track.stopped).toBe(true)
  })

  it('duas chamadas de toggleSpeaker disparadas sem esperar a primeira: publica só UMA track', async () => {
    const { result } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    const room = FakeRoom.instances.at(-1)!
    await act(async () => {
      const p1 = result.current.toggleSpeaker()
      const p2 = result.current.toggleSpeaker()
      await Promise.all([p1, p2])
    })
    expect(room.localParticipant.published).toHaveLength(1)
    expect(result.current.speakerEnabled).toBe(true)
  })

  it('desmonta com o alto-falante ligado: para a track publicada (libera o mic)', async () => {
    const { result, unmount } = renderHook(() => useOfficeBroadcast(makeOpts()))
    await flush()
    await act(async () => { await result.current.toggleSpeaker() })
    const track = await createLocalAudioTrackMock.mock.results[0]!.value
    unmount()
    expect(track.stopped).toBe(true)
  })
})
