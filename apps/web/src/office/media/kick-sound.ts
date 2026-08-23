/**
 * A batida do pé na bola. Aqui é síntese (Web Audio), e não um sample como o
 * aplauso e o high-five: o som é um "poc" percussivo de ~120ms, que a síntese
 * faz bem — e assim o chute não depende de mais um arquivo no bundle.
 *
 * Toca sempre sob gesto do usuário (a tecla do chute), o que satisfaz a
 * política de autoplay. Falha de áudio é engolida: som é pontuação do gesto,
 * nunca deve quebrar a animação da bola.
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
 * `power` dá o corpo da batida (toque é abafado, chute estala) e `grazed`
 * tira um tanto do volume: pé que pega de raspão soa mais fraco, do mesmo
 * jeito que a bola anda menos.
 */
export function playKickSound({
  power = 'kick',
  grazed = false,
}: { power?: 'touch' | 'kick' | 'lob' | 'dribble'; grazed?: boolean } = {}): void {
  if (isOfficeSilenced()) return
  const ctx = audioContext()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const gain = ctx.createGain()
    const peak = (power === 'touch' ? 0.12 : 0.35) * (grazed ? 0.6 : 1)
    // O chute alto é mais "poc" que "pum": a bola sobe em vez de rasgar o chão.
    const decay = power === 'touch' ? 0.07 : power === 'lob' ? 0.1 : 0.13
    gain.gain.setValueAtTime(peak, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay)
    gain.connect(ctx.destination)

    // Corpo grave que cai de tom — é o que dá o "impacto" do couro.
    const thump = ctx.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(power === 'touch' ? 180 : power === 'lob' ? 340 : 260, now)
    thump.frequency.exponentialRampToValueAtTime(power === 'lob' ? 110 : 60, now + decay)
    thump.connect(gain)
    thump.start(now)
    thump.stop(now + decay)
  } catch {
    // som é opcional: nunca deixar o áudio quebrar o chute
  }
}
