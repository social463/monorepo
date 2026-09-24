/**
 * O tiro e o estouro do paintball. Como a batida do chute
 * (`kick-sound.ts`), é síntese (Web Audio) e não sample: são dois estalos de
 * ~100ms, que a síntese faz bem — e assim o paintball não põe mais nenhum
 * arquivo no bundle.
 *
 * Toca sempre sob gesto do usuário (a tecla do tiro, ou a chegada de um tiro
 * de outra pessoa numa aba que já teve gesto), o que satisfaz a política de
 * autoplay. Falha de áudio é engolida: som é pontuação do gesto e nunca deve
 * quebrar a animação.
 */
import { isOfficeSilenced } from '../../lib/office-silence'

let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!context) context = new Ctor()
  return context
}

/**
 * `hit` distingue os dois momentos do tiro. O disparo é um "pft" de ar
 * comprimido (ruído curto e agudo); o acerto é o "pluft" molhado da cápsula
 * estourando, mais grave e um tico mais longo — é ele que avisa, sem olhar,
 * que a tinta pegou em alguém.
 *
 * `volume` é a distância: quem decide é `officeSoundLevel` na cena, e aqui ele
 * só multiplica os picos. Zero não toca nada — tiro do outro lado do
 * escritório, ou tiro na área aberta ouvido de dentro de uma sala de chamada,
 * não chega.
 */
export function playPaintballSound({ hit = false, volume = 1 }: { hit?: boolean; volume?: number } = {}): void {
  if (isOfficeSilenced()) return
  const level = Math.max(0, Math.min(1, volume))
  if (level <= 0) return
  const ctx = audioContext()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const decay = hit ? 0.13 : 0.06

    // Corpo de ruído: o sopro do disparo e o esparramo da tinta são os dois
    // ruído filtrado — o que muda é a altura do filtro e a queda.
    const noise = ctx.createBufferSource()
    const frames = Math.max(1, Math.floor(ctx.sampleRate * decay))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Ruído decaindo dentro do próprio buffer: sem isso o filtro sozinho
    // deixaria uma cauda chiada depois do estouro.
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
    }
    noise.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = hit ? 'lowpass' : 'highpass'
    filter.frequency.setValueAtTime(hit ? 1400 : 1800, now)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime((hit ? 0.3 : 0.16) * level, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay)

    noise.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    noise.start(now)
    noise.stop(now + decay)

    // Só o acerto ganha o "plop" grave por baixo — é o que dá a sensação de
    // massa da tinta batendo, e o que separa acertar de errar no ouvido.
    if (hit) {
      const thump = ctx.createOscillator()
      const thumpGain = ctx.createGain()
      thumpGain.gain.setValueAtTime(0.22 * level, now)
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      thump.type = 'sine'
      thump.frequency.setValueAtTime(320, now)
      thump.frequency.exponentialRampToValueAtTime(90, now + decay)
      thump.connect(thumpGain)
      thumpGain.connect(ctx.destination)
      thump.start(now)
      thump.stop(now + decay)
    }
  } catch {
    // som é opcional: nunca deixar o áudio quebrar o tiro
  }
}
