import { PROXIMITY_RADIUS } from '@legends/shared'

/** Raio de queda do ganho — maior que `PROXIMITY_RADIUS` de propósito: o
 * raio de proximidade (radar/assinatura de áudio) usa distância de
 * Chebyshev, cujo pior caso diagonal (dx=dy=PROXIMITY_RADIUS) fica a
 * `PROXIMITY_RADIUS * √2` de distância euclidiana. Sem esse fator, alguém
 * podia aparecer como bolinha verde no radar (dentro do raio Chebyshev) e
 * ficar em silêncio total (fora do raio euclidiano do ganho). */
const GAIN_FALLOFF_RADIUS = PROXIMITY_RADIUS * Math.SQRT2

/** Ganho por distância (euclidiana, em tiles): 1 perto, cai a 0 em
 * `GAIN_FALLOFF_RADIUS` — some suavemente, sem o "estalo" do corte binário
 * de assinatura que já existe em `useOfficeMedia.applyProximity`. */
export function computeGain(dx: number, dy: number): number {
  const dist = Math.hypot(dx, dy)
  return Math.min(1, Math.max(0, 1 - dist / GAIN_FALLOFF_RADIUS))
}

/** Pan estéreo pela posição horizontal relativa (em tiles), clampado em
 * [-1, 1]. Só a posição na tela importa — a câmera do escritório não gira,
 * então a direção que o avatar está olhando não entra na conta. */
export function computePan(dx: number): number {
  return Math.min(1, Math.max(-1, dx / PROXIMITY_RADIUS))
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return null
  if (!audioContext) audioContext = new AudioContextCtor()
  void audioContext.resume()
  return audioContext
}

import { applyAudioSink } from './audioSink'

export interface SpatialAudioGraph {
  /** `dx`/`dy` em tiles — mesma unidade de `computeGain`/`computePan`. */
  update(dx: number, dy: number): void
  /** Multiplicador local do usuario remoto, de 0 a 1. */
  setUserVolume(volume: number): void
  /** Troca a saída de áudio (alto-falante/fone) sem recriar o grafo. */
  setOutputDevice(deviceId: string | null): void
  dispose(): void
}

/**
 * Grafo fonte → ganho → pan → saída para uma track remota. `null` sem Web
 * Audio API disponível — quem chama cai de volta para `<audio>` simples
 * (ver `SpatialRemoteAudio`).
 */
export function createSpatialAudioGraph(
  mediaStreamTrack: MediaStreamTrack,
  outputDeviceId: string | null = null,
): SpatialAudioGraph | null {
  const ctx = getAudioContext()
  if (!ctx) return null

  const stream = new MediaStream([mediaStreamTrack])
  const source = ctx.createMediaStreamSource(stream)
  const gain = ctx.createGain()
  const panner = ctx.createStereoPanner()
  let spatialGain = 1
  let userVolume = 1
  const applyGain = () => {
    gain.gain.value = spatialGain * userVolume
  }
  // Destino em stream (não mais `ctx.destination` fixo no dispositivo padrão do
  // sistema) — é o que permite escolher a saída via `setSinkId` no <audio>
  // "outputSink" abaixo, sem perder o ganho/pan já aplicados no grafo.
  const destination = ctx.createMediaStreamDestination()
  source.connect(gain)
  gain.connect(panner)
  panner.connect(destination)

  // Track remota de WebRTC sem NENHUM elemento de mídia associado pode ficar
  // muda no Chrome (o pipeline só "bombeia" dados com um sink de mídia real
  // consumindo a track) — mesmo com o grafo Web Audio corretamente ligado.
  // Este <audio> mutado existe só para manter a track viva; fica escondido
  // no DOM e nunca toca som próprio (senão duplicava o áudio do grafo).
  const keepAliveSink = document.createElement('audio')
  keepAliveSink.srcObject = stream
  keepAliveSink.muted = true
  keepAliveSink.autoplay = true
  keepAliveSink.hidden = true
  document.body.appendChild(keepAliveSink)

  // Este <audio> é quem realmente toca (ganho + pan já aplicados no stream
  // processado) — e é nele que `setSinkId` escolhe o dispositivo de saída.
  const outputSink = document.createElement('audio')
  outputSink.srcObject = destination.stream
  outputSink.autoplay = true
  outputSink.hidden = true
  document.body.appendChild(outputSink)
  void applyAudioSink(outputSink, outputDeviceId)

  return {
    update(dx, dy) {
      spatialGain = computeGain(dx, dy)
      applyGain()
      panner.pan.value = computePan(dx)
    },
    setUserVolume(volume) {
      userVolume = Math.min(1, Math.max(0, volume))
      applyGain()
    },
    setOutputDevice(deviceId) {
      void applyAudioSink(outputSink, deviceId)
    },
    dispose() {
      source.disconnect()
      gain.disconnect()
      panner.disconnect()
      keepAliveSink.srcObject = null
      keepAliveSink.remove()
      outputSink.srcObject = null
      outputSink.remove()
    },
  }
}
