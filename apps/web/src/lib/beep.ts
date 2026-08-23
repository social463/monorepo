import { isOfficeSilenced } from './office-silence'

/**
 * Avisos sonoros do escritório — bipes curtos via Web Audio, sem asset binário
 * (coerente com o escritório, que gera tudo em runtime). AudioContext é um
 * singleton lazy: navegadores exigem um gesto do usuário antes de tocar, então
 * o contexto pode nascer "suspended" (F5 direto na página sem interação) —
 * nesse caso tentamos `resume()` e falhamos em silêncio se ainda bloqueado.
 */
let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
  if (!Ctor) return null
  if (!ctx) {
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  return ctx
}

/** Um tom agendado: frequência, atraso relativo ao início, pico de ganho e duração (s). */
interface Tone {
  freq: number
  at: number
  gain: number
  dur: number
}

/**
 * Agenda uma sequência de tons; nunca lança (som é opcional). Os cinco bipes
 * passam por aqui, então é o único ponto que precisa consultar o portão de
 * silêncio — bipe novo já nasce respeitando a sala.
 */
function playTones(tones: Tone[]): void {
  if (isOfficeSilenced()) return
  const context = getContext()
  if (!context) return
  try {
    if (context.state === 'suspended') void context.resume()
    const now = context.currentTime
    for (const tone of tones) {
      const osc = context.createOscillator()
      const gain = context.createGain()
      osc.frequency.value = tone.freq
      osc.connect(gain)
      gain.connect(context.destination)
      const start = now + tone.at
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur - 0.01)
      osc.start(start)
      osc.stop(start + tone.dur)
    }
  } catch {
    // som é opcional: nunca deixar o áudio quebrar a interação
  }
}

const CALL_MOTIF = [880, 1046] // dois bipes curtos
const CALL_GAIN = 0.32 // mais alto que o antigo (0.2) para chamar atenção
const CALL_STEP = 0.18 // espaço entre os dois bipes do motivo
const CALL_CYCLE = 0.42 // duração de um motivo + folga, para as 3 repetições não colarem

/** Aviso de chamada recebida — mais alto e tocado 3x seguidas. */
export function playCallBeep(): void {
  const tones: Tone[] = []
  for (let rep = 0; rep < 3; rep += 1) {
    const base = rep * CALL_CYCLE
    for (const [i, freq] of CALL_MOTIF.entries()) {
      tones.push({ freq, at: base + i * CALL_STEP, gain: CALL_GAIN, dur: 0.16 })
    }
  }
  playTones(tones)
}

/** Alguém entrou na sala — chime curto ascendente, mais suave que a chamada. */
export function playEnterBeep(): void {
  playTones([
    { freq: 660, at: 0, gain: 0.15, dur: 0.14 },
    { freq: 880, at: 0.12, gain: 0.15, dur: 0.16 },
  ])
}

/** Alguém saiu da sala — chime curto descendente, mais suave que a chamada. */
export function playLeaveBeep(): void {
  playTones([
    { freq: 880, at: 0, gain: 0.15, dur: 0.14 },
    { freq: 660, at: 0.12, gain: 0.15, dur: 0.16 },
  ])
}

/**
 * Alguém pediu para entrar na sala trancada — três batidas graves e secas,
 * lidas como bater na porta. Grave de propósito: o aviso de chamada é agudo
 * (880/1046 Hz) e os dois nunca podem ser confundidos, já que exigem ações
 * diferentes de quem ouve.
 */
export function playKnockBeep(): void {
  playTones([
    { freq: 200, at: 0, gain: 0.5, dur: 0.07 },
    { freq: 190, at: 0.16, gain: 0.5, dur: 0.07 },
    { freq: 180, at: 0.32, gain: 0.5, dur: 0.07 },
  ])
}

/**
 * Chegou mensagem no chat da sala com o painel fechado — o mais discreto de
 * todos os avisos, de propósito: mensagem é frequente, e o aviso que incomoda
 * é o primeiro que a pessoa silencia. Curto, baixo e sem repetição, para não
 * competir com a chamada (aguda e 3x) nem com a mão levantada (988 Hz duplo).
 */
export function playChatMessageBeep(): void {
  playTones([
    { freq: 784, at: 0, gain: 0.12, dur: 0.08 },
    { freq: 1046, at: 0.07, gain: 0.1, dur: 0.09 },
  ])
}

/** Alguém levantou a mão numa sala de reunião — bipe duplo, forte e agudo. */
export function playRaiseHandBeep(): void {
  playTones([
    { freq: 988, at: 0, gain: 0.6, dur: 0.12 },
    { freq: 988, at: 0.14, gain: 0.6, dur: 0.12 },
  ])
}
