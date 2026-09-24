import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

class FakeTrack {
  isMuted = false
  async mute() { this.isMuted = true; return this }
  async unmute() { this.isMuted = false; return this }
}
const createLocalAudioTrackMock = vi.fn(async (..._args: unknown[]) => new FakeTrack())

class FakeLocalParticipant {
  identity = 'you'
  published: FakeTrack[] = []
  async publishTrack(track: FakeTrack) { this.published.push(track) }
  async setCameraEnabled() {}
}

interface FakePub {
  isSubscribed: boolean
  source: string
  track: unknown
  isMuted?: boolean
  setSubscribed: ReturnType<typeof vi.fn>
}
class FakeParticipant {
  trackPublications = new Map<string, FakePub>()
  constructor(public identity: string, public name: string) {}
}

// `vi.hoisted`: mesma necessidade de `useOfficeMedia.test.ts` — o import do
// hook resolve `livekit-client` antes do corpo deste arquivo rodar.
const { FakeRoom } = vi.hoisted(() => {
  class FakeRoom {
    static instances: FakeRoom[] = []
    handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    remoteParticipants = new Map<string, FakeParticipant>()
    localParticipant = new FakeLocalParticipant()
    connectCalls: Array<{ url: string; token: string }> = []
    disconnected = false
    constructor() { FakeRoom.instances.push(this) }
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = this.handlers.get(event) ?? []
      list.push(handler)
      this.handlers.set(event, list)
      return this
    }
    emit(event: string, ...args: unknown[]) { for (const h of this.handlers.get(event) ?? []) h(...args) }
    async connect(url: string, token: string) { this.connectCalls.push({ url, token }) }
    async disconnect() { this.disconnected = true }
    async switchActiveDevice() { return true }
  }
  return { FakeRoom }
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
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected',
  },
  Track: { Source: { Microphone: 'microphone', Camera: 'camera' } },
  createLocalAudioTrack: (...args: unknown[]) => createLocalAudioTrackMock(...args),
}))

import { useArenaMedia } from './useArenaMedia'

beforeEach(() => {
  vi.useFakeTimers()
  FakeRoom.instances = []
  apiFetchMock.mockReset()
  createLocalAudioTrackMock.mockClear()
  apiFetchMock.mockResolvedValue({ token: 'tk', url: 'ws://livekit.test' })
})
afterEach(() => {
  vi.useRealTimers()
})

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useArenaMedia', () => {
  it('RoomEvent.Reconnected resincroniza remotes — reproduz o grid travado após queda de rede', async () => {
    // Mesma causa raiz do escritório (ver useOfficeMedia.test.ts): o LiveKit
    // reconecta sozinho sem emitir os eventos de track perdidos durante a
    // queda; sem escutar `Reconnected`, `remotes` fica preso vazio.
    const { result } = renderHook(() => useArenaMedia({ arenaId: 'arena-1', spatial: false }))
    await settle()
    const room = FakeRoom.instances.at(-1)!

    const bob = new FakeParticipant('bob', 'Bob')
    const cameraTrack = { id: 'cam-1' }
    const camPub: FakePub = { isSubscribed: true, source: 'camera', track: cameraTrack, isMuted: false, setSubscribed: vi.fn() }
    bob.trackPublications.set('cam', camPub)
    room.remoteParticipants.set('bob', bob)

    expect(result.current.remotes).toHaveLength(0)

    act(() => room.emit('reconnected'))

    expect(result.current.remotes[0]?.cameraTrack).toBe(cameraTrack)
  })

  it('RoomEvent.Disconnected reconecta sozinho quando a Room desiste da recuperação automática', async () => {
    const { result } = renderHook(() => useArenaMedia({ arenaId: 'arena-1', spatial: false }))
    await settle()
    expect(result.current.status).toBe('connected')
    expect(FakeRoom.instances).toHaveLength(1)
    const room = FakeRoom.instances.at(-1)!

    act(() => room.emit('disconnected'))
    await settle()

    expect(FakeRoom.instances).toHaveLength(2)
    expect(result.current.status).toBe('connected')
  })

  it('desconexão da PRÓPRIA troca de arena não dispara reconexão duplicada via RoomEvent.Disconnected', async () => {
    const { rerender } = renderHook(({ arenaId }) => useArenaMedia({ arenaId, spatial: false }), {
      initialProps: { arenaId: 'arena-1' as string | null },
    })
    await settle()
    const first = FakeRoom.instances.at(-1)!

    rerender({ arenaId: 'arena-2' })
    await settle()
    expect(FakeRoom.instances).toHaveLength(2)

    act(() => first.emit('disconnected')) // evento tardio da sala antiga
    await settle()

    expect(FakeRoom.instances).toHaveLength(2)
  })
})
