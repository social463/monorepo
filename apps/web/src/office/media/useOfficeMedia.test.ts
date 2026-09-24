import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createEmptyMapDocumentV1, type OfficeOccupant } from '@legends/shared'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

// ---- fake do livekit-client -------------------------------------------------
// `ops` registra a ORDEM real das operações (mute/publish) — usado para provar
// que o mic é mutado ANTES de publicado, não só que termina mutado (que também
// passaria se a ordem fosse invertida, já que é mutação por referência).
let ops: string[] = []

/**
 * Espelha o contrato real do `LocalAudioTrack`: com `stopOnMute`, o LiveKit
 * PARA a MediaStreamTrack no mute (é o que apaga o indicador de microfone do
 * sistema) e a reaquire no unmute. `capturing` representa esse estado do
 * dispositivo; `failUnmute` simula a reaquisição falhando (mic tomado por
 * outro app, permissão revogada).
 */
class FakeTrack {
  isMuted = false
  stopOnMute = false
  capturing = true
  failUnmute = false
  async mute() {
    this.isMuted = true
    if (this.stopOnMute) this.capturing = false
    ops.push('mute')
    return this
  }
  async unmute() {
    if (this.failUnmute) throw new Error('mic ocupado')
    this.isMuted = false
    this.capturing = true
    return this
  }
}
const createLocalAudioTrackMock = vi.fn(async (..._args: unknown[]) => new FakeTrack())
const setCameraEnabledMock = vi.fn(async (_enabled: boolean, _options?: unknown) => {})
const setScreenShareEnabledMock = vi.fn(async (_enabled: boolean, _options?: unknown) => {})

class FakeLocalParticipant {
  published: FakeTrack[] = []
  async publishTrack(track: FakeTrack) { this.published.push(track); ops.push('publish') }
  async setCameraEnabled(enabled: boolean, options?: unknown) { await setCameraEnabledMock(enabled, options) }
  async setScreenShareEnabled(enabled: boolean, options?: unknown) { await setScreenShareEnabledMock(enabled, options) }
}

// `vi.mock('livekit-client', ...)` é hoisted para antes desta declaração (o
// import de './useOfficeMedia' resolve 'livekit-client' antes do corpo deste
// arquivo rodar). Como o factory referencia `FakeRoom` diretamente (não via
// closure lazy como os `*Mock`), precisa estar dentro de `vi.hoisted` — senão
// dá TDZ ("Cannot access 'FakeRoom' before initialization").
const { FakeRoom } = vi.hoisted(() => {
  class FakeRoom {
    static instances: FakeRoom[] = []
    // Quando false, `connect()` fica pendurado até o teste chamar
    // `resolveConnectManually()` — permite orquestrar a ordem de resolução
    // entre duas conexões sobrepostas (testes de geração/unmount).
    static autoConnect = true
    handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    remoteParticipants = new Map<string, FakeParticipant>()
    localParticipant = new FakeLocalParticipant()
    connectCalls: Array<{ url: string; token: string; opts: { autoSubscribe: boolean } }> = []
    disconnected = false
    switchActiveDeviceCalls: Array<{ kind: string; deviceId: string }> = []
    private resolveConnect: (() => void) | null = null
    constructor() { FakeRoom.instances.push(this) }
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = this.handlers.get(event) ?? []
      list.push(handler)
      this.handlers.set(event, list)
      return this
    }
    emit(event: string, ...args: unknown[]) { for (const h of this.handlers.get(event) ?? []) h(...args) }
    async connect(url: string, token: string, opts: { autoSubscribe: boolean }) {
      this.connectCalls.push({ url, token, opts })
      if (FakeRoom.autoConnect) return
      await new Promise<void>((resolve) => { this.resolveConnect = resolve })
    }
    resolveConnectManually() {
      this.resolveConnect?.()
    }
    async disconnect() { this.disconnected = true }
    async switchActiveDevice(kind: string, deviceId: string) {
      this.switchActiveDeviceCalls.push({ kind, deviceId })
      return true
    }
  }
  return { FakeRoom }
})

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
  Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' } },
  createLocalAudioTrack: (...args: unknown[]) => createLocalAudioTrackMock(...args),
}))
// -----------------------------------------------------------------------------

import { useOfficeMedia as useOfficeMediaRuntime } from './useOfficeMedia'

const testDocument = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
testDocument.objects.push({
  id: 'room-reuniao-2',
  layerKey: 'meeting-rooms',
  type: 'meeting-room',
  geometry: { kind: 'rectangle', x: 17 * 32, y: 14 * 32, width: 7 * 32, height: 3 * 32 },
  properties: {
    externalKey: 'reuniao-2',
    name: 'Sala de Reunião 2',
    status: 'OPEN',
    voiceEnabled: true,
    accessPolicy: 'OPEN',
  },
})

/** Sala de silêncio nos tiles 2..4 dos dois eixos, longe da sala de reunião. */
testDocument.objects.push({
  id: 'zona-silencio',
  layerKey: 'private-zones',
  type: 'private-zone',
  geometry: { kind: 'rectangle', x: 2 * 32, y: 2 * 32, width: 3 * 32, height: 3 * 32 },
  properties: { name: 'Área de silêncio', accessPolicy: 'OPEN' },
})

function useOfficeMedia(occupants: OfficeOccupant[], youId: string | null, connected: boolean) {
  return useOfficeMediaRuntime(occupants, youId, connected, testDocument, 'test-publication')
}

/**
 * Recebe TILE e converte: é assim que se pensa o cenário ("ele está na sala
 * 2"). O occupant fala PIXEL desde o movimento livre.
 */
function occupant(userId: string, tileX: number, tileY: number, status?: OfficeOccupant['status']): OfficeOccupant {
  const x = tileX * 32 + 16
  const y = tileY * 32 + 16
  return {
    userId,
    name: userId,
    x,
    y,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
    status,
  }
}

/**
 * Render do hook com props ESTÁVEIS entre renders — preferir em teste NOVO.
 *
 * `renderHook(() => useOfficeMedia([occupant(...)], 'you', true))` recria o array
 * a cada render. Como `syncRemotes` roda num efeito que depende de `occupants`,
 * um `setState` incondicional lá dentro fecha um ciclo render→setState→render
 * que não falha como loop nem como timeout — só como heap estourado (foi o que
 * derrubava este arquivo inteiro). O hook agora compara antes de setar (ver
 * `sameRemotes`) e o worker tem teto de heap (`vite.config.ts`), mas o caminho
 * barato é não criar props novas: aqui `occ`/`conn` só mudam via
 * `rerender({ occ, conn })`.
 */
function renderOfficeMedia(occ: OfficeOccupant[], conn = true) {
  return renderHook(
    (props: { occ: OfficeOccupant[]; conn: boolean }) => useOfficeMedia(props.occ, 'you', props.conn),
    { initialProps: { occ, conn } },
  )
}

// Maior que o cap de backoff do hook (15s) — usado para varrer qualquer janela
// de retry possível nos testes de unmount/geração.
const MAX_RETRY_MS_FOR_TEST = 20000

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  FakeRoom.instances = []
  FakeRoom.autoConnect = true
  ops = []
  apiFetchMock.mockReset()
  createLocalAudioTrackMock.mockClear()
  setCameraEnabledMock.mockReset()
  setScreenShareEnabledMock.mockReset()
  apiFetchMock.mockImplementation(async (_path: string, opts: { body: string }) => ({
    token: `tk-${(JSON.parse(opts.body) as { room: string }).room}`,
    url: 'ws://livekit.test',
  }))
})
afterEach(() => {
  vi.useRealTimers()
})

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Drena a fila de microtarefas (promises encadeadas) sem mexer nos timers. */
async function flushMicrotasks(times = 10) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

describe('useOfficeMedia', () => {
  it('expõe a sala aberta do mapa atual em `openRoom`', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    expect(result.current.openRoom).toBe('office-map-test-publication-open')
  })

  it('na sala de silêncio não entra em sala de voz nenhuma', async () => {
    const { result, rerender } = renderOfficeMedia([occupant('you', 12, 14)]) // espaço aberto
    await settle(600)
    expect(result.current.roomName).toBe('office-map-test-publication-open')
    const aberta = FakeRoom.instances.at(-1)!

    rerender({ occ: [occupant('you', 3, 3)], conn: true }) // entra na sala de silêncio
    await settle(600)

    // Nada de sala: sem assinar o áudio dos outros e sem publicar o próprio mic.
    expect(result.current.roomName).toBeNull()
    expect(result.current.status).toBe('off')
    expect(aberta.disconnected).toBe(true)
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      '/office/media-token',
      expect.objectContaining({ body: expect.stringContaining('zona-silencio') }),
    )

    rerender({ occ: [occupant('you', 12, 14)], conn: true }) // sai da sala
    await settle(600)
    expect(result.current.roomName).toBe('office-map-test-publication-open')
  })

  it('conecta em office-open (autoSubscribe off) e publica o mic MUTADO', async () => {
    const occ = [occupant('you', 12, 14)] // spawn: espaço aberto
    renderHook(() => useOfficeMedia(occ, 'you', true))
    await settle(600)

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/office/media-token',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ room: 'office-map-test-publication-open' }) }),
    )
    const room = FakeRoom.instances.at(-1)!
    expect(room.connectCalls[0]).toMatchObject({ url: 'ws://livekit.test', token: 'tk-office-map-test-publication-open', opts: { autoSubscribe: false } })
    // mic pediu permissão, foi mutado ANTES de publicar, e está publicado
    expect(createLocalAudioTrackMock).toHaveBeenCalledOnce()
    expect(room.localParticipant.published).toHaveLength(1)
    expect(room.localParticipant.published[0].isMuted).toBe(true)
    // Assserção de ORDEM (não só de estado final): mute tem que acontecer antes
    // do publish — `isMuted === true` sozinho também passaria se a ordem fosse
    // invertida (mute depois do publish), já que é mutação por referência.
    expect(ops).toEqual(['mute', 'publish'])
  })

  it('cria o mic já com o deviceId preferido salvo em localStorage', async () => {
    localStorage.setItem('office:preferred-audio-input', 'mic-preferido')
    renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    expect(createLocalAudioTrackMock).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'mic-preferido' }))
  })

  it('setAudioInputDevice persiste a escolha e troca o dispositivo ativo via switchActiveDevice', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    await act(async () => {
      await result.current.setAudioInputDevice('mic-novo')
    })

    expect(localStorage.getItem('office:preferred-audio-input')).toBe('mic-novo')
    const room = FakeRoom.instances.at(-1)!
    expect(room.switchActiveDeviceCalls).toContainEqual({ kind: 'audioinput', deviceId: 'mic-novo' })
    expect(result.current.audioInputDeviceId).toBe('mic-novo')
  })

  it('setVideoInputDevice só troca o dispositivo ativo se a câmera já estiver ligada; sempre persiste', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!

    await act(async () => {
      await result.current.setVideoInputDevice('cam-nova')
    })
    expect(room.switchActiveDeviceCalls).toHaveLength(0) // câmera desligada: só persiste
    expect(localStorage.getItem('office:preferred-video-input')).toBe('cam-nova')

    await act(async () => {
      await result.current.toggleCamera()
    })
    expect(setCameraEnabledMock).toHaveBeenCalledWith(true, { deviceId: 'cam-nova' })
  })

  it('setAudioInputDevice não rejeita quando switchActiveDevice falha (dispositivo sumiu)', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.switchActiveDevice = async () => {
      throw new Error('device gone')
    }

    await expect(
      act(async () => {
        await result.current.setAudioInputDevice('mic-sumiu')
      }),
    ).resolves.not.toThrow()
    // preferência continua persistida mesmo com a troca ao vivo falhando
    expect(localStorage.getItem('office:preferred-audio-input')).toBe('mic-sumiu')
  })

  it('setVideoInputDevice não rejeita quando switchActiveDevice falha (dispositivo sumiu)', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    await act(async () => {
      await result.current.toggleCamera()
    })
    const room = FakeRoom.instances.at(-1)!
    room.switchActiveDevice = async () => {
      throw new Error('device gone')
    }

    await expect(
      act(async () => {
        await result.current.setVideoInputDevice('cam-sumiu')
      }),
    ).resolves.not.toThrow()
    expect(localStorage.getItem('office:preferred-video-input')).toBe('cam-sumiu')
  })

  it('troca para a sala da zona quando a posição fica estável dentro dela', async () => {
    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] },
    })
    await settle(600)
    const openRoom = FakeRoom.instances.at(-1)!

    rerender({ occ: [occupant('you', 18, 15)] }) // dentro da reuniao-2
    await settle(600)

    expect(openRoom.disconnected).toBe(true)
    const zoneRoom = FakeRoom.instances.at(-1)!
    expect(zoneRoom.connectCalls[0]).toMatchObject({ token: 'tk-office-map-test-publication-zone-reuniao-2', opts: { autoSubscribe: true } })
  })

  it('flap mais curto que a estabilidade não troca de sala', async () => {
    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] },
    })
    await settle(600)
    expect(FakeRoom.instances).toHaveLength(1)

    rerender({ occ: [occupant('you', 18, 15)] })  // pisa na sala…
    await settle(200)                              // …menos que 500 ms…
    rerender({ occ: [occupant('you', 12, 14)] })  // …e volta
    await settle(600)

    expect(FakeRoom.instances).toHaveLength(1) // nenhuma reconexão
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('no office-open assina quem está perto e desassina quem se afasta', async () => {
    const near = new FakeParticipant('bob', 'bob')
    const nearPub: FakePub = { isSubscribed: false, source: 'microphone', track: null, setSubscribed: vi.fn() }
    near.trackPublications.set('a', nearPub)

    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5), occupant('bob', 12, 5)] }, // dist 2 ≤ 3
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', near)
    act(() => room.emit('trackPublished'))
    expect(nearPub.setSubscribed).toHaveBeenLastCalledWith(true)

    nearPub.isSubscribed = true
    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 20, 5)] }) // dist 10 > 3
    expect(nearPub.setSubscribed).toHaveBeenLastCalledWith(false)
  })

  it('não assina áudio de quem está perto mas está ausente/volto logo', async () => {
    const near = new FakeParticipant('bob', 'bob')
    const nearPub: FakePub = { isSubscribed: false, source: 'microphone', track: null, setSubscribed: vi.fn() }
    near.trackPublications.set('a', nearPub)

    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5), occupant('bob', 12, 5, 'away')] }, // dist 2 ≤ 3, mas bob está away
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', near)
    act(() => room.emit('trackPublished'))
    expect(nearPub.setSubscribed).not.toHaveBeenCalledWith(true)

    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 12, 5, 'brb')] })
    expect(nearPub.setSubscribed).not.toHaveBeenCalledWith(true)
  })

  it('quem está ausente/volto logo não assina áudio de ninguém, mesmo perto', async () => {
    const near = new FakeParticipant('bob', 'bob')
    const nearPub: FakePub = { isSubscribed: false, source: 'microphone', track: null, setSubscribed: vi.fn() }
    near.trackPublications.set('a', nearPub)

    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5, 'away'), occupant('bob', 12, 5)] }, // dist 2 ≤ 3, mas "you" está away
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', near)
    act(() => room.emit('trackPublished'))
    expect(nearPub.setSubscribed).not.toHaveBeenCalledWith(true)

    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 12, 5)] }) // "you" volta a online
    expect(nearPub.setSubscribed).toHaveBeenLastCalledWith(true)
  })

  it('Ocupado corta o áudio DENTRO da sala de reunião, onde o autoSubscribe assinaria', async () => {
    const other = new FakeParticipant('bob', 'bob')
    const pub: FakePub = { isSubscribed: true, source: 'microphone', track: null, setSubscribed: vi.fn() }
    other.trackPublications.set('a', pub)

    // 18,15 é dentro da sala de reunião: assinatura é do LiveKit, não da proximidade.
    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 18, 15), occupant('bob', 19, 15)] },
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    expect(room.connectCalls[0]!.opts.autoSubscribe).toBe(true)
    room.remoteParticipants.set('bob', other)

    rerender({ occ: [occupant('you', 18, 15, 'busy'), occupant('bob', 19, 15)] })

    expect(pub.setSubscribed).toHaveBeenLastCalledWith(false)
  })

  it('não se ouve quem está Ocupado, nem dentro da sala', async () => {
    const other = new FakeParticipant('bob', 'bob')
    const pub: FakePub = { isSubscribed: true, source: 'microphone', track: null, setSubscribed: vi.fn() }
    other.trackPublications.set('a', pub)

    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 18, 15), occupant('bob', 19, 15)] },
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', other)

    rerender({ occ: [occupant('you', 18, 15), occupant('bob', 19, 15, 'busy')] })

    expect(pub.setSubscribed).toHaveBeenLastCalledWith(false)
  })

  it('sair de Ocupado devolve a assinatura dentro da sala', async () => {
    const other = new FakeParticipant('bob', 'bob')
    const pub: FakePub = { isSubscribed: false, source: 'microphone', track: null, setSubscribed: vi.fn() }
    pub.setSubscribed.mockImplementation((v: boolean) => { pub.isSubscribed = v })
    other.trackPublications.set('a', pub)

    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 18, 15, 'busy'), occupant('bob', 19, 15)] },
    })
    await settle(600)
    FakeRoom.instances.at(-1)!.remoteParticipants.set('bob', other)

    rerender({ occ: [occupant('you', 18, 15), occupant('bob', 19, 15)] })

    expect(pub.setSubscribed).toHaveBeenLastCalledWith(true)
  })

  it('Ocupado para o microfone, e sair devolve conforme a preferência', async () => {
    localStorage.setItem('office:mic-enabled', '1')
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 18, 15)] },
    })
    await settle(600)
    // Spawn nasce mutado; desmutar é a preferência do usuário nesta sessão.
    await act(async () => { await result.current.toggleMic() })
    const track = FakeRoom.instances.at(-1)!.localParticipant.published[0]
    expect(track.capturing).toBe(true)

    rerender({ occ: [occupant('you', 18, 15, 'busy')] })
    await act(async () => { await flushMicrotasks() })

    expect(track.isMuted).toBe(true)
    expect(track.capturing).toBe(false) // ninguém ouve, e o indicador do sistema apaga
    expect(result.current.micEnabled).toBe(false)

    rerender({ occ: [occupant('you', 18, 15)] })
    await act(async () => { await flushMicrotasks() })

    expect(result.current.micEnabled).toBe(true) // volta como estava
    expect(track.capturing).toBe(true)
  })

  it('desassinar por proximidade limpa `remotes` na hora, sem esperar outro evento de track', async () => {
    const audioTrack = {}
    const near = new FakeParticipant('bob', 'bob')
    const nearPub: FakePub = { isSubscribed: false, source: 'microphone', track: audioTrack, setSubscribed: vi.fn() }
    // Mimetiza o SDK real: `setSubscribed` já reflete em `isSubscribed` no mesmo tick.
    nearPub.setSubscribed.mockImplementation((v: boolean) => { nearPub.isSubscribed = v })
    near.trackPublications.set('a', nearPub)

    const { result, rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5), occupant('bob', 12, 5)] }, // dist 2 ≤ 3
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', near)
    act(() => room.emit('trackPublished'))
    expect(nearPub.setSubscribed).toHaveBeenLastCalledWith(true)
    act(() => room.emit('trackSubscribed'))
    expect(result.current.remotes.find((r) => r.userId === 'bob')?.audioTrack).toBe(audioTrack)

    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 20, 5)] }) // dist 10 > 3
    expect(nearPub.setSubscribed).toHaveBeenLastCalledWith(false)
    // SEM emitir 'trackUnsubscribed' — o áudio já deve sumir do state sozinho,
    // só por causa da mudança de posição.
    expect(result.current.remotes.find((r) => r.userId === 'bob')?.audioTrack).toBeNull()
  })

  it('permissão de mic negada não derruba a conexão (segue como ouvinte)', async () => {
    createLocalAudioTrackMock.mockRejectedValueOnce(new Error('NotAllowedError'))
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    expect(result.current.status).toBe('connected')
    expect(result.current.micError).toBe(true)
    expect(result.current.micEnabled).toBe(false)
  })

  it('permissão de câmera negada desliga a câmera e expõe o aviso', async () => {
    setCameraEnabledMock.mockRejectedValueOnce(new Error('NotAllowedError'))
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    await act(async () => {
      await result.current.toggleCamera()
    })

    expect(setCameraEnabledMock).toHaveBeenCalledWith(true, undefined)
    expect(result.current.cameraEnabled).toBe(false)
    expect(result.current.cameraError).toBe(true)
  })

  it('falha ao compartilhar tela desliga o estado e expõe o aviso', async () => {
    setScreenShareEnabledMock.mockRejectedValueOnce(new Error('NotAllowedError'))
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    await act(async () => {
      await result.current.toggleScreenShare()
    })

    expect(setScreenShareEnabledMock).toHaveBeenCalledWith(true, expect.anything())
    expect(result.current.screenShareEnabled).toBe(false)
    expect(result.current.screenShareError).toBe(true)
  })

  it('compartilha a tela pedindo áudio da aba e do sistema', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    await act(async () => {
      await result.current.toggleScreenShare()
    })

    expect(setScreenShareEnabledMock).toHaveBeenCalledWith(true, {
      audio: true,
      systemAudio: 'include',
    })
  })

  it('sincroniza o estado quando o compartilhamento local é encerrado pelo navegador', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!

    await act(async () => {
      room.emit('localTrackPublished', { source: 'screen_share' })
    })
    expect(result.current.screenShareEnabled).toBe(true)
    expect(result.current.screenShareError).toBe(false)

    await act(async () => {
      room.emit('localTrackUnpublished', { source: 'screen_share' })
    })
    expect(result.current.screenShareEnabled).toBe(false)
  })

  it('falha no token entra em erro e tenta de novo com backoff', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('LiveKit fora'))
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    expect(result.current.status).toBe('error')

    await settle(2100) // primeiro backoff (2s)
    expect(result.current.status).toBe('connected')
  })

  it('conexões sobrepostas: geração mais nova vence, a mais velha é descartada e desconectada', async () => {
    // `connect()` fica pendurado até resolvermos manualmente — assim conseguimos
    // ter DUAS conexões (A e B) em voo ao mesmo tempo e controlar a ordem em que
    // cada uma "chega" do servidor.
    FakeRoom.autoConnect = false
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] }, // espaço aberto
    })
    await settle(600) // stableRoom -> office-open; connectTo(A) chamado, connect() pendurado
    expect(FakeRoom.instances).toHaveLength(1)
    const roomA = FakeRoom.instances[0]!
    expect(roomA.connectCalls).toHaveLength(1)

    rerender({ occ: [occupant('you', 18, 15)] }) // dentro da reuniao-2
    await settle(600) // stableRoom -> zona; connectTo(B) chamado, connect() pendurado
    expect(FakeRoom.instances).toHaveLength(2)
    const roomB = FakeRoom.instances[1]!
    expect(roomB.connectCalls).toHaveLength(1)

    // B (a geração vigente) resolve primeiro...
    await act(async () => {
      roomB.resolveConnectManually()
      await flushMicrotasks()
    })
    // ...e só depois A (a geração superada) resolve.
    await act(async () => {
      roomA.resolveConnectManually()
      await flushMicrotasks()
    })

    // Sem guarda de geração, a continuação de A (que resolveu por último)
    // sobrescreve roomRef/estado com a sala superada — o hook fica "preso" em A.
    expect(result.current.roomName).toBe('office-map-test-publication-zone-reuniao-2')
    expect(roomA.disconnected).toBe(true)
  })

  it('unmount durante connect() pendente desconecta a sala criada e não deixa retry solto', async () => {
    FakeRoom.autoConnect = false
    const { unmount } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600) // stableRoom -> office-open; connectTo chamado, connect() pendurado
    expect(FakeRoom.instances).toHaveLength(1)
    const room = FakeRoom.instances[0]!
    expect(room.connectCalls).toHaveLength(1)

    unmount()

    // connect() só resolve DEPOIS do unmount — nada mais está de pé para
    // desconectar essa sala além da própria continuação de connectTo.
    await act(async () => {
      room.resolveConnectManually()
      await flushMicrotasks()
    })
    expect(room.disconnected).toBe(true)

    // Avança bem além do maior backoff possível: se um retry tivesse sido
    // agendado (caminho de erro) ou a conexão "pegasse" pós-unmount, veríamos
    // uma nova instância de Room aqui.
    await settle(MAX_RETRY_MS_FOR_TEST)
    expect(FakeRoom.instances).toHaveLength(1)
  })

  it('applyMicEnabled força mute/unmute do track local e é no-op sem track', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    const track = room.localParticipant.published[0]
    expect(track.isMuted).toBe(true)

    await act(async () => { await result.current.applyMicEnabled(true) })
    expect(track.isMuted).toBe(false)
    expect(result.current.micEnabled).toBe(true)

    await act(async () => { await result.current.applyMicEnabled(false) })
    expect(track.isMuted).toBe(true)
    expect(result.current.micEnabled).toBe(false)

    // idempotente: aplicar o estado atual não lança nem alterna
    await act(async () => { await result.current.applyMicEnabled(false) })
    expect(track.isMuted).toBe(true)
  })

  it('mic mutado para de capturar: no macOS o indicador do sistema apaga', async () => {
    const { result } = renderOfficeMedia([occupant('you', 12, 14)])
    await settle(600)

    // Spawn entra mutado, e é justamente aí que o indicador ficava aceso.
    const track = FakeRoom.instances.at(-1)!.localParticipant.published[0]
    expect(track.stopOnMute).toBe(true)
    expect(track.isMuted).toBe(true)
    expect(track.capturing).toBe(false)

    await act(async () => { await result.current.toggleMic() }) // desmuta: reabre o dispositivo
    expect(track.capturing).toBe(true)
    expect(result.current.micEnabled).toBe(true)

    await act(async () => { await result.current.toggleMic() }) // muta de novo
    expect(track.capturing).toBe(false)
    expect(result.current.micEnabled).toBe(false)
  })

  it('falha ao reabrir o microfone no unmute vira erro, não um botão mentiroso', async () => {
    const { result } = renderOfficeMedia([occupant('you', 12, 14)])
    await settle(600)
    const track = FakeRoom.instances.at(-1)!.localParticipant.published[0]
    track.failUnmute = true

    await act(async () => { await result.current.toggleMic() })

    expect(result.current.micEnabled).toBe(false)
    expect(result.current.micError).toBe(true)
    expect(track.isMuted).toBe(true)
    // A preferência não pode virar "desmutado": o mic nunca chegou a abrir.
    expect(localStorage.getItem('office:mic-enabled')).not.toBe('1')
  })

  it('alto-falante: falha ao restaurar o mic também vira erro', async () => {
    const { result } = renderOfficeMedia([occupant('you', 12, 14)])
    await settle(600)
    const track = FakeRoom.instances.at(-1)!.localParticipant.published[0]
    track.failUnmute = true

    await act(async () => { await result.current.applyMicEnabled(true) })

    expect(result.current.micEnabled).toBe(false)
    expect(result.current.micError).toBe(true)
  })

  it('preferência de mic (localStorage) sobrevive a troca de sala: desmutado continua desmutado', async () => {
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] }, // espaço aberto
    })
    await settle(600)
    expect(result.current.micEnabled).toBe(false) // sem preferência salva: nasce mutado

    await act(async () => { await result.current.toggleMic() })
    expect(result.current.micEnabled).toBe(true)
    expect(localStorage.getItem('office:mic-enabled')).toBe('1')

    ops = []
    rerender({ occ: [occupant('you', 18, 15)] }) // entra na sala de reunião: nova conexão
    await settle(600)

    expect(result.current.micEnabled).toBe(true)
    const room = FakeRoom.instances.at(-1)!
    const track = room.localParticipant.published[0]
    expect(track.isMuted).toBe(false)
    expect(ops).not.toContain('mute') // nasceu já desmutado, sem passar por mute()
  })

  it('preferência de mic persiste mutado entre reconexões', async () => {
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] },
    })
    await settle(600)

    await act(async () => { await result.current.toggleMic() }) // desmuta
    await act(async () => { await result.current.toggleMic() }) // muta de novo
    expect(result.current.micEnabled).toBe(false)
    expect(localStorage.getItem('office:mic-enabled')).toBe('0')

    rerender({ occ: [occupant('you', 18, 15)] })
    await settle(600)

    expect(result.current.micEnabled).toBe(false)
    const room = FakeRoom.instances.at(-1)!
    expect(room.localParticipant.published[0].isMuted).toBe(true)
  })

  it('spawn nasce mutado mesmo com preferência "desmutado" salva de outra sessão', async () => {
    localStorage.setItem('office:mic-enabled', '1') // sessão anterior terminou desmutada
    const { result } = renderOfficeMedia([occupant('you', 12, 14)])
    await settle(600)

    expect(result.current.micEnabled).toBe(false)
    const room = FakeRoom.instances.at(-1)!
    expect(room.localParticipant.published[0].isMuted).toBe(true)
    expect(ops).toEqual(['mute', 'publish']) // mutado ANTES de publicar: não vaza nem um frame de áudio
    // a preferência do usuário continua de pé para as trocas de sala seguintes
    expect(localStorage.getItem('office:mic-enabled')).toBe('1')
  })

  it('sair e voltar ao escritório é spawn novo: volta mutado mesmo tendo saído desmutado', async () => {
    const occ = [occupant('you', 12, 14)]
    const { rerender, result } = renderOfficeMedia(occ)
    await settle(600)
    await act(async () => { await result.current.toggleMic() })
    expect(result.current.micEnabled).toBe(true)

    rerender({ occ, conn: false }) // sai do escritório: sessão de mídia cai
    await settle(600)
    expect(result.current.status).toBe('off')

    ops = []
    rerender({ occ, conn: true }) // spawn de novo
    await settle(600)

    expect(result.current.micEnabled).toBe(false)
    const room = FakeRoom.instances.at(-1)!
    expect(room.localParticipant.published[0].isMuted).toBe(true)
    expect(ops).toEqual(['mute', 'publish'])
  })

  it('câmera nasce desligada em todo spawn, mesmo ligada antes de sair', async () => {
    const occ = [occupant('you', 12, 14)]
    const { rerender, result } = renderOfficeMedia(occ)
    await settle(600)
    await act(async () => { await result.current.toggleCamera() })
    const openRoom = FakeRoom.instances.at(-1)!
    await act(async () => {
      openRoom.emit('localTrackPublished', { source: 'camera', track: { attach: vi.fn(), detach: vi.fn() } })
    })
    expect(result.current.cameraEnabled).toBe(true)
    expect(result.current.localCameraTrack).not.toBeNull()

    rerender({ occ, conn: false })
    await settle(600)
    rerender({ occ, conn: true }) // spawn de novo
    await settle(600)

    expect(result.current.status).toBe('connected')
    expect(result.current.cameraEnabled).toBe(false)
    expect(result.current.localCameraTrack).toBeNull()
    // nenhuma câmera republicada sozinha: o único setCameraEnabled é o toggle manual
    expect(setCameraEnabledMock.mock.calls.filter(([enabled]) => enabled)).toHaveLength(1)
  })

  it('applyMicEnabled (força mute, ex. zona de silêncio) não sobrescreve a preferência salva', async () => {
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] },
    })
    await settle(600)
    await act(async () => { await result.current.toggleMic() }) // preferência: desmutado
    expect(localStorage.getItem('office:mic-enabled')).toBe('1')

    await act(async () => { await result.current.applyMicEnabled(false) }) // força mute (zona de silêncio)
    expect(result.current.micEnabled).toBe(false)
    // a preferência do usuário não muda por causa de um force externo
    expect(localStorage.getItem('office:mic-enabled')).toBe('1')

    rerender({ occ: [occupant('you', 18, 15)] }) // reconecta fora da zona
    await settle(600)

    expect(result.current.micEnabled).toBe(true) // volta a respeitar a preferência salva
  })

  it('rastreia o track local de câmera via LocalTrackPublished/Unpublished', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    const fakeTrack = { attach: vi.fn(), detach: vi.fn() }

    expect(result.current.localCameraTrack).toBeNull()

    await act(async () => {
      room.emit('localTrackPublished', { source: 'camera', track: fakeTrack })
    })
    expect(result.current.localCameraTrack).toBe(fakeTrack)

    await act(async () => {
      room.emit('localTrackUnpublished', { source: 'camera' })
    })
    expect(result.current.localCameraTrack).toBeNull()
  })

  it('troca de sala zera o track local de câmera imediatamente (evita frame congelado)', async () => {
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] }, // espaço aberto
    })
    await settle(600)
    const openRoom = FakeRoom.instances.at(-1)!
    await act(async () => {
      openRoom.emit('localTrackPublished', { source: 'camera', track: { attach: vi.fn(), detach: vi.fn() } })
    })
    expect(result.current.localCameraTrack).not.toBeNull()

    rerender({ occ: [occupant('you', 18, 15)] }) // entra na sala de reunião
    await settle(600)

    expect(result.current.localCameraTrack).toBeNull()
  })

  it('RemoteMedia carrega os campos de avatar do occupant correspondente', async () => {
    const bob: OfficeOccupant = {
      userId: 'bob',
      name: 'Bob',
      x: 12,
      y: 5,
      dir: 'down',
      photoUrl: 'https://example.com/bob.png',
      avatarStyle: 'lpc',
      avatarSeed: 'seed-bob',
    }
    const { result, rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5), bob] },
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    const bobParticipant = new FakeParticipant('bob', 'Bob')
    room.remoteParticipants.set('bob', bobParticipant)
    act(() => room.emit('participantConnected'))

    expect(result.current.remotes[0]).toMatchObject({
      userId: 'bob',
      photoUrl: 'https://example.com/bob.png',
      avatarStyle: 'lpc',
      avatarSeed: 'seed-bob',
    })

    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 12, 5)] }) // occupant sem avatar customizado
    act(() => room.emit('participantConnected'))
    expect(result.current.remotes[0]).toMatchObject({
      photoUrl: null,
      avatarStyle: null,
      avatarSeed: null,
      avatarOptions: null,
    })
  })

  it('sair do escritório zera o estado de mídia da sessão', async () => {
    const { rerender, result } = renderHook(({ connected }) => useOfficeMedia([occupant('you', 12, 14)], 'you', connected), {
      initialProps: { connected: true },
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!

    // Liga mic e câmera, e simula o track local de câmera chegando publicado
    // (como o LiveKit real faz via LocalTrackPublished).
    await act(async () => { await result.current.toggleMic() })
    await act(async () => { await result.current.toggleCamera() })
    await act(async () => {
      room.emit('localTrackPublished', { source: 'camera', track: { attach: vi.fn(), detach: vi.fn() } })
    })
    expect(result.current.micEnabled).toBe(true)
    expect(result.current.cameraEnabled).toBe(true)
    expect(result.current.localCameraTrack).not.toBeNull()

    // "Sair" de verdade (X do PiP): o provider global não desmonta o hook —
    // ele só zera os inputs (aqui, `connected: false`).
    rerender({ connected: false })
    await settle(600) // aguarda o debounce de estabilidade da sala (500ms)

    expect(result.current.status).toBe('off')
    expect(result.current.micEnabled).toBe(false)
    expect(result.current.cameraEnabled).toBe(false)
    expect(result.current.localCameraTrack).toBeNull()
  })

  it('câmera remota desligada (mute, não unpublish) some de remotes.cameraTrack — reproduz o balão preso', async () => {
    // `setCameraEnabled(false)` no livekit-client, depois da primeira
    // publicação, MUTA a track em vez de despublicá-la: a publicação
    // continua `isSubscribed`/com `track` não-nulo, só `isMuted` vira true.
    // Sem checar isMuted, cameraTrack nunca voltaria a null — o quadrado de
    // vídeo (CharacterOverlay) ficaria preso com a última imagem/quadro
    // preto em vez de sumir. Ver commit desta correção.
    const bob = new FakeParticipant('bob', 'Bob')
    const cameraTrack = { id: 'cam-1' }
    const camPub: FakePub = { isSubscribed: true, source: 'camera', track: cameraTrack, isMuted: false, setSubscribed: vi.fn() }
    bob.trackPublications.set('cam', camPub)

    const { result } = renderHook(() => useOfficeMedia([occupant('you', 10, 5), occupant('bob', 12, 5)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', bob)
    act(() => room.emit('trackPublished'))

    expect(result.current.remotes[0]?.cameraTrack).toBe(cameraTrack)

    // Bob desliga a câmera: LiveKit muta a publicação (não remove, não
    // limpa o track) e emite `trackMuted` — a publicação em si não muda de
    // forma nenhuma além do isMuted.
    camPub.isMuted = true
    act(() => room.emit('trackMuted'))

    expect(result.current.remotes[0]?.cameraTrack).toBeNull()
  })

  it('RoomEvent.Reconnected resincroniza remotes — reproduz o grid travado após queda de rede', async () => {
    // O LiveKit reconecta sozinho no nível de rede (ICE/WebRTC) sem que o app
    // faça nada. Durante a queda, nenhum evento de track é emitido — então o
    // participante que publicou câmera nesse intervalo só aparece em
    // `room.remoteParticipants`/`trackPublications`, sem `trackPublished`
    // correspondente. Sem escutar `Reconnected` para forçar um resync,
    // `remotes` fica preso vazio até algum evento não relacionado acontecer
    // por acaso — o refresh manual que os usuários relataram precisar dar.
    const bob = new FakeParticipant('bob', 'Bob')
    const cameraTrack = { id: 'cam-1' }
    const camPub: FakePub = { isSubscribed: true, source: 'camera', track: cameraTrack, isMuted: false, setSubscribed: vi.fn() }
    bob.trackPublications.set('cam', camPub)

    const { result } = renderHook(() => useOfficeMedia([occupant('you', 10, 5), occupant('bob', 12, 5)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', bob)

    expect(result.current.remotes).toHaveLength(0)

    act(() => room.emit('reconnected'))

    expect(result.current.remotes[0]?.cameraTrack).toBe(cameraTrack)
  })

  it('RoomEvent.Disconnected reconecta sozinho quando a Room desiste da recuperação automática', async () => {
    // Quando o LiveKit tenta reconectar sozinho e desiste de vez (rede caiu
    // por tempo demais), ele dispara `Disconnected` — sem escutar isto, o
    // hook ficava com `status: 'connected'` para sempre, sem tentar de
    // novo, só resolvendo com um refresh manual da página.
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 10, 5)], 'you', true))
    await settle(600)
    expect(result.current.status).toBe('connected')
    expect(FakeRoom.instances).toHaveLength(1)
    const room = FakeRoom.instances.at(-1)!

    act(() => room.emit('disconnected'))
    await settle(600)

    expect(FakeRoom.instances).toHaveLength(2) // reconectou sozinho, sem intervenção do usuário
    expect(result.current.status).toBe('connected')
  })

  it('desconexão da PRÓPRIA troca de sala não dispara reconexão duplicada via RoomEvent.Disconnected', async () => {
    // A `room.disconnect()` que o próprio `connectTo` chama ao trocar de
    // sala/desmontar também dispara `Disconnected` no LiveKit real. Sem a
    // guarda de `roomRef.current === room`, isso reconectaria a sala VELHA
    // por cima da nova.
    const { rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] },
    })
    await settle(600)
    const openRoom = FakeRoom.instances.at(-1)!

    rerender({ occ: [occupant('you', 18, 15)] }) // dentro da reuniao-2 → troca de sala
    await settle(600)
    expect(FakeRoom.instances).toHaveLength(2)

    act(() => openRoom.emit('disconnected')) // evento tardio da sala antiga
    await settle(600)

    expect(FakeRoom.instances).toHaveLength(2) // nenhuma reconexão extra
  })

  it('áudio da tela remota (ScreenShareAudio) vira screenAudioTrack; mutado/não-assinado é ignorado', async () => {
    const ana = new FakeParticipant('ana', 'Ana')
    const screenAudio = { id: 'sa-1' }
    const audioPub: FakePub = { isSubscribed: true, source: 'screen_share_audio', track: screenAudio, isMuted: false, setSubscribed: vi.fn() }
    ana.trackPublications.set('sa', audioPub)

    const { result } = renderHook(() => useOfficeMedia([occupant('you', 10, 5), occupant('ana', 12, 5)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('ana', ana)
    act(() => room.emit('trackPublished'))

    expect(result.current.remotes[0]?.screenAudioTrack).toBe(screenAudio)

    // muta (Track.setMuted no LiveKit real) → some, igual à regra de vídeo/câmera
    audioPub.isMuted = true
    act(() => room.emit('trackMuted'))
    expect(result.current.remotes[0]?.screenAudioTrack).toBeNull()
  })

  it('rastreia o track local de tela via LocalTrackPublished/Unpublished', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    const fakeTrack = { attach: vi.fn(), detach: vi.fn() }

    expect(result.current.localScreenTrack).toBeNull()

    await act(async () => {
      room.emit('localTrackPublished', { source: 'screen_share', track: fakeTrack })
    })
    expect(result.current.localScreenTrack).toBe(fakeTrack)

    await act(async () => {
      room.emit('localTrackUnpublished', { source: 'screen_share' })
    })
    expect(result.current.localScreenTrack).toBeNull()
  })

  it('screenShareOrder registra quem compartilhou primeiro (local e remoto) e some ao encerrar', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!

    await act(async () => {
      room.emit('localTrackPublished', { source: 'screen_share', track: { attach: vi.fn(), detach: vi.fn() } })
    })
    expect(result.current.screenShareOrder.get('local')).toBe(0)

    const remoteParticipant = { identity: 'ana' }
    await act(async () => {
      room.emit('trackPublished', { source: 'screen_share' }, remoteParticipant)
    })
    expect(result.current.screenShareOrder.get('ana')).toBe(1)
    // ordem não muda se o mesmo remoto "republicar" (ex: TrackPublished duplicado)
    await act(async () => {
      room.emit('trackPublished', { source: 'screen_share' }, remoteParticipant)
    })
    expect(result.current.screenShareOrder.get('ana')).toBe(1)

    await act(async () => {
      room.emit('trackUnpublished', { source: 'screen_share' }, remoteParticipant)
    })
    expect(result.current.screenShareOrder.has('ana')).toBe(false)

    await act(async () => {
      room.emit('localTrackUnpublished', { source: 'screen_share' })
    })
    expect(result.current.screenShareOrder.has('local')).toBe(false)
  })

  it('trocar de sala zera a track local de tela e a ordem de compartilhamento', async () => {
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] }, // espaço aberto
    })
    await settle(600)
    const openRoom = FakeRoom.instances.at(-1)!
    await act(async () => {
      openRoom.emit('localTrackPublished', { source: 'screen_share', track: { attach: vi.fn(), detach: vi.fn() } })
    })
    expect(result.current.localScreenTrack).not.toBeNull()
    expect(result.current.screenShareOrder.get('local')).toBe(0)

    rerender({ occ: [occupant('you', 18, 15)] }) // entra na zona reuniao-2
    await settle(600)

    expect(result.current.localScreenTrack).toBeNull()
    expect(result.current.screenShareOrder.has('local')).toBe(false)
  })

  it('ActiveSpeakersChanged marca localSpeaking e remotes[].speaking, booleano só (sem nível de volume)', async () => {
    const bob = new FakeParticipant('bob', 'Bob')
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 10, 5), occupant('bob', 12, 5)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', bob)
    act(() => room.emit('participantConnected'))

    expect(result.current.localSpeaking).toBe(false)
    expect(result.current.remotes[0]?.speaking).toBe(false)

    act(() => room.emit('activeSpeakersChanged', [{ identity: 'you' }, { identity: 'bob' }]))
    expect(result.current.localSpeaking).toBe(true)
    expect(result.current.remotes[0]?.speaking).toBe(true)

    act(() => room.emit('activeSpeakersChanged', [{ identity: 'bob' }]))
    expect(result.current.localSpeaking).toBe(false)
    expect(result.current.remotes[0]?.speaking).toBe(true)

    act(() => room.emit('activeSpeakersChanged', []))
    expect(result.current.remotes[0]?.speaking).toBe(false)
  })

  it('repassa só as TRANSIÇÕES de fala pro bridge, 100% local (nunca via emitClientMessage)', async () => {
    const { OfficeBridge } = await import('../OfficeBridge')
    const bridge = new OfficeBridge()
    const seenSpeaking: Array<{ userId: string; speaking: boolean }> = []
    const seenClient: unknown[] = []
    bridge.onSpeakingChanged((payload) => seenSpeaking.push(payload))
    bridge.onClientMessage((m) => seenClient.push(m))

    renderHook(() => useOfficeMediaRuntime([occupant('you', 12, 14)], 'you', true, testDocument, 'test-publication', bridge))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!

    act(() => room.emit('activeSpeakersChanged', [{ identity: 'you' }]))
    expect(seenSpeaking).toEqual([{ userId: 'you', speaking: true }])

    // Repetir o mesmo conjunto (sem transição) não deve reemitir nada.
    act(() => room.emit('activeSpeakersChanged', [{ identity: 'you' }]))
    expect(seenSpeaking).toEqual([{ userId: 'you', speaking: true }])

    act(() => room.emit('activeSpeakersChanged', []))
    expect(seenSpeaking).toEqual([
      { userId: 'you', speaking: true },
      { userId: 'you', speaking: false },
    ])
    expect(seenClient).toEqual([]) // nunca vaza pro canal cliente→servidor
  })

  it('mantém a mesma sala desejada quando a publicação muda mas o mapId não', async () => {
    const { result, rerender } = renderHook(
      ({ mapId }: { mapId: string }) =>
        useOfficeMediaRuntime([occupant('you', 12, 14)], 'you', true, testDocument, mapId),
      { initialProps: { mapId: 'map-1' } },
    )
    await settle(600)
    const room = result.current.roomName
    expect(room).not.toBeNull()

    // No mundo real, publicar uma decoração troca `publication.id` mas NÃO
    // `map.id` — simulado aqui como um rerender que mantém o mesmo mapId.
    rerender({ mapId: 'map-1' })
    await settle(600)

    expect(result.current.roomName).toBe(room)
    expect(FakeRoom.instances).toHaveLength(1) // nenhuma reconexão de LiveKit
  })

  it('micOpen reflete a publicação do mic remoto (mudo/aberto) independente de assinatura por proximidade', async () => {
    const bob = new FakeParticipant('bob', 'Bob')
    const micPub: FakePub = { isSubscribed: false, source: 'microphone', track: null, isMuted: true, setSubscribed: vi.fn() }
    bob.trackPublications.set('mic', micPub)

    const { result } = renderHook(() => useOfficeMedia([occupant('you', 10, 5), occupant('bob', 12, 5)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    room.remoteParticipants.set('bob', bob)
    act(() => room.emit('trackPublished'))

    // Mudo e não assinado (fora de proximidade): badge mostra mudo.
    expect(result.current.remotes[0]?.micOpen).toBe(false)

    // Mic aberto mas AINDA fora de proximidade (não assinado) — o badge deve
    // refletir "aberto" mesmo sem o áudio estar tocando aqui.
    micPub.isMuted = false
    act(() => room.emit('trackUnmuted'))
    expect(result.current.remotes[0]?.micOpen).toBe(true)
    expect(result.current.remotes[0]?.audioTrack).toBeNull()
  })
})
