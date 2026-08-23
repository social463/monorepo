/**
 * Palma do high-five. Um mp3 curto (CC0) em `/sounds/high-five.mp3` — sample
 * real, não síntese (ver `applause-sound.ts`: Web Audio soava como chiado).
 * Sempre disparado sob gesto do usuário (acenar), o que satisfaz a política de
 * autoplay dos browsers.
 *
 * Reaproveita um único `HTMLAudioElement` e o rebobina a cada disparo; o
 * cooldown de 3s por par no servidor evita empilhamento. Falha de play é
 * engolida: som é opcional, nunca deve quebrar a animação.
 */
import { isOfficeSilenced } from '../../lib/office-silence'

const HIGH_FIVE_SRC = '/sounds/high-five.mp3'
/** Seco e discreto — é pontuação da animação, não protagonista. */
const HIGH_FIVE_VOLUME = 0.25
/**
 * A "palma perfeita" (#22252) — aquela em que as mãos se encontram no ponto
 * exato. Mesmo sample, bem mais alto: é o estalo que faz a mesa inteira virar
 * a cabeça. Quem sorteia é o servidor (`perfect` na mensagem `high-five`), pra
 * que os dois lados ouçam a mesma coisa.
 */
const PERFECT_HIGH_FIVE_VOLUME = 0.8

let audio: HTMLAudioElement | null = null

export function playHighFiveSound({ perfect = false }: { perfect?: boolean } = {}): void {
  if (typeof Audio === 'undefined') return
  if (isOfficeSilenced()) return
  try {
    if (!audio) audio = new Audio(HIGH_FIVE_SRC)
    // Setado a CADA disparo: o elemento é reaproveitado, então ajustar só na
    // criação deixaria o volume preso no primeiro valor — e a palma comum
    // seguinte herdaria o volume da perfeita anterior.
    audio.volume = perfect ? PERFECT_HIGH_FIVE_VOLUME : HIGH_FIVE_VOLUME
    audio.currentTime = 0
    void audio.play().catch(() => {})
  } catch {
    // som é opcional: nunca deixar o áudio quebrar o high-five
  }
}
