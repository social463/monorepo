import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeGain, computePan } from './spatialAudio'
import { PROXIMITY_RADIUS } from '@legends/shared'

describe('computeGain', () => {
  it('gain 1 na mesma posição', () => {
    expect(computeGain(0, 0)).toBe(1)
  })
  it('gain 0 na borda do raio de queda (PROXIMITY_RADIUS * √2)', () => {
    expect(computeGain(PROXIMITY_RADIUS * Math.SQRT2, 0)).toBe(0)
  })
  it('gain nunca fica negativo além do raio', () => {
    expect(computeGain(PROXIMITY_RADIUS * Math.SQRT2 * 2, 0)).toBe(0)
  })
  it('cai pela metade a meio caminho do raio de queda', () => {
    expect(computeGain((PROXIMITY_RADIUS * Math.SQRT2) / 2, 0)).toBeCloseTo(0.5)
  })
  it('permanece audível (gain > 0) perto do pior caso diagonal do raio de proximidade (Chebyshev), onde o raio antigo já dava silêncio total', () => {
    // dx=2, dy=PROXIMITY_RADIUS(3): Chebyshev = max(2,3) = 3 — ainda dentro
    // do raio de proximidade (radar mostra bolinha, áudio fica assinado).
    // Com o raio de queda antigo (PROXIMITY_RADIUS, sem o fator √2), a
    // distância euclidiana aqui (√13 ≈ 3,606) já ultrapassava o raio de 3,
    // dando gain 0 (silêncio) apesar de "dentro do raio" nas outras duas
    // lógicas. Com `GAIN_FALLOFF_RADIUS = PROXIMITY_RADIUS * √2` (≈4,243) o
    // ganho volta a ser positivo.
    expect(computeGain(2, PROXIMITY_RADIUS)).toBeGreaterThan(0)
  })
})

describe('computePan', () => {
  it('pan 0 na mesma posição', () => {
    expect(computePan(0)).toBe(0)
  })
  it('pan positivo (direita) quando o outro está à direita', () => {
    expect(computePan(PROXIMITY_RADIUS)).toBe(1)
  })
  it('pan negativo (esquerda) quando o outro está à esquerda', () => {
    expect(computePan(-PROXIMITY_RADIUS)).toBe(-1)
  })
  it('clampa além do raio', () => {
    expect(computePan(PROXIMITY_RADIUS * 4)).toBe(1)
  })
})

function installFakeAudio() {
  const gainNode = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } }
  const pannerNode = { connect: vi.fn(), disconnect: vi.fn(), pan: { value: 0 } }
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() }
  const destinationNode = { stream: {} }
  const ctx = {
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createMediaStreamSource: vi.fn(() => sourceNode),
    createGain: vi.fn(() => gainNode),
    createStereoPanner: vi.fn(() => pannerNode),
    createMediaStreamDestination: vi.fn(() => destinationNode),
  }
  vi.stubGlobal('AudioContext', vi.fn(() => ctx))
  vi.stubGlobal('MediaStream', vi.fn((tracks: unknown[]) => ({ tracks })))
  return { ctx, gainNode, pannerNode, sourceNode, destinationNode }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  document.querySelectorAll('audio').forEach((el) => el.remove())
  delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
})

describe('createSpatialAudioGraph', () => {
  it('conecta fonte → ganho → pan → um destino de stream (não mais ctx.destination direto)', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)

    expect(graph).not.toBeNull()
    expect(fake.sourceNode.connect).toHaveBeenCalledWith(fake.gainNode)
    expect(fake.gainNode.connect).toHaveBeenCalledWith(fake.pannerNode)
    expect(fake.pannerNode.connect).toHaveBeenCalledWith(fake.destinationNode)
  })

  it('cria dois <audio>: um mutado (keep-alive da track bruta) e outro audível ligado ao stream processado', async () => {
    installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    createSpatialAudioGraph({} as MediaStreamTrack)

    const sinks = Array.from(document.getElementsByTagName('audio'))
    expect(sinks).toHaveLength(2)
    const [keepAlive, output] = sinks
    expect(keepAlive.muted).toBe(true)
    expect(keepAlive.srcObject).not.toBeNull()
    expect(output.muted).toBe(false)
    expect(output.srcObject).not.toBeNull()
  })

  it('update() ajusta gain.value e pan.value com as mesmas fórmulas de computeGain/computePan', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!

    graph.update(1, 0)

    expect(fake.gainNode.gain.value).toBeCloseTo(computeGain(1, 0))
    expect(fake.pannerNode.pan.value).toBeCloseTo(computePan(1))
  })

  it('setUserVolume multiplica o ganho espacial atual', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!

    graph.update(1, 0)
    graph.setUserVolume(0.25)

    expect(fake.gainNode.gain.value).toBeCloseTo(computeGain(1, 0) * 0.25)
  })

  it('setOutputDevice chama setSinkId só no <audio> de saída (não no keep-alive)', async () => {
    installFakeAudio()
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    ;(HTMLMediaElement.prototype as unknown as { setSinkId: typeof setSinkId }).setSinkId = setSinkId
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!
    setSinkId.mockClear()

    graph.setOutputDevice('out-1')
    await Promise.resolve()

    expect(setSinkId).toHaveBeenCalledTimes(1)
    expect(setSinkId).toHaveBeenCalledWith('out-1')
  })

  it('dispose() desconecta todos os nós e remove os dois <audio> do DOM', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!

    graph.dispose()

    expect(fake.sourceNode.disconnect).toHaveBeenCalledOnce()
    expect(fake.gainNode.disconnect).toHaveBeenCalledOnce()
    expect(fake.pannerNode.disconnect).toHaveBeenCalledOnce()
    expect(document.getElementsByTagName('audio')).toHaveLength(0)
  })

  it('retorna null sem Web Audio API no navegador', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { createSpatialAudioGraph } = await import('./spatialAudio')

    expect(createSpatialAudioGraph({} as MediaStreamTrack)).toBeNull()
  })
})
