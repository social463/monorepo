/**
 * Aplauso da comemoração. Toca um mp3 curto (CC0) servido em
 * `/sounds/applause.mp3` — a síntese via Web Audio soava como chiado, então
 * aqui é um sample real. Chamado sob um gesto do usuário (segurar F conta), o
 * que satisfaz a política de autoplay dos browsers.
 *
 * Reaproveita um único `HTMLAudioElement` (o browser cacheia o arquivo) e o
 * rebobina a cada disparo; a comemoração tem cooldown de 4s no servidor, então
 * não há empilhamento. Falha de play é engolida: som é opcional, nunca deve
 * quebrar a comemoração.
 *
 * Quem não quiser o aplauso desliga em Escritório › Configurações › Preferências;
 * a comemoração (confete, animação) continua acontecendo, só o som some.
 */
import { isOfficeSilenced } from '../../lib/office-silence'

const APPLAUSE_SRC = '/sounds/applause.mp3'
/** Bem baixo de propósito — é ambiente, não protagonista. */
const APPLAUSE_VOLUME = 0.2
const MUTED_KEY = 'office:applause-muted'

let audio: HTMLAudioElement | null = null
/** `null` = ainda não lido do storage. */
let muted: boolean | null = null

/**
 * A preferência mora aqui, e não num estado do React, porque quem dispara o
 * aplauso é a `OfficeScene` (Phaser, fora da árvore de componentes). Assim o
 * painel de configurações e a cena leem a mesma fonte.
 */
export function isApplauseMuted(): boolean {
  if (muted === null) {
    try {
      muted = localStorage.getItem(MUTED_KEY) === '1'
    } catch {
      // storage bloqueado (Safari privado): sem preferência, o som fica ligado
      muted = false
    }
  }
  return muted
}

export function setApplauseMuted(next: boolean): void {
  muted = next
  try {
    localStorage.setItem(MUTED_KEY, next ? '1' : '0')
  } catch {
    // preferência não persiste, mas vale para a sessão atual
  }
}

export function playApplauseSound(): void {
  if (typeof Audio === 'undefined') return
  // Dois motivos independentes para calar: a preferência da pessoa (toggle nas
  // configurações) e a sala de silêncio (vale para todo som do escritório).
  if (isApplauseMuted()) return
  if (isOfficeSilenced()) return
  try {
    if (!audio) audio = new Audio(APPLAUSE_SRC)
    // Setado a CADA disparo (não só na criação): o elemento é reaproveitado,
    // então ajustar só uma vez deixaria o volume "preso" no primeiro valor.
    audio.volume = APPLAUSE_VOLUME
    audio.currentTime = 0
    void audio.play().catch(() => {})
  } catch {
    // som é opcional: nunca deixar o áudio quebrar a comemoração
  }
}
