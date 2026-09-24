import type Phaser from 'phaser'
import type { Direction } from '@legends/shared'

/**
 * O confete — a partícula, as cores e as duas formas de soltá-lo.
 *
 * Fora da `OfficeScene` pelo mesmo motivo da tinta (`paintSprites.ts`): a arena
 * usa os mesmos, e importar a cena do escritório inteira para ganhar seis cores
 * arrastaria ~3.000 linhas (e as dependências delas) para dentro do pedaço da
 * arena. Festa é festa: duas cópias acabariam divergindo no visual da mesma
 * comemoração.
 */

export const CONFETTI_TEXTURE = 'office-confetti'

/** Seis cores, sorteadas por partícula pelo `tint`. */
export const CONFETTI_COLORS = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x8338ec, 0xff9f1c]

/** Vida de uma partícula do canhão de confete (não da chuva de comemoração). */
export const CONFETTI_LAUNCH_LIFESPAN = 900

/** Comemoração acima de tudo (banner e burst fixos na câmera). */
export const CELEBRATION_DEPTH = 20_000
export const CONFETTI_BURST_COUNT = 140
export const CONFETTI_BURST_LIFESPAN = 2200

/** Partícula de confete: quadradinho branco 4×4 (a cor vem do tint por partícula). */
export function createConfettiTexture(
  scene: Phaser.Scene,
  graphics: Phaser.GameObjects.Graphics,
): void {
  if (scene.textures.exists(CONFETTI_TEXTURE)) return
  graphics.clear()
  graphics.fillStyle(0xffffff, 1)
  graphics.fillRect(0, 0, 4, 4)
  graphics.generateTexture(CONFETTI_TEXTURE, 4, 4)
}

/**
 * Centro do cone de confete por direção (ângulo de Phaser: 0=direita,
 * 90=baixo, -90=cima, 180=esquerda — sistema y-para-baixo). Spread de ±30°
 * em torno do centro, igual ao leque original (que era fixo pra cima).
 */
function confettiAngleForDirection(dir: Direction): { min: number; max: number } {
  const center = { up: -90, down: 90, left: 180, right: 0 }[dir]
  return { min: center - 30, max: center + 30 }
}

/** Config de LANÇAMENTO (canhão de festa saindo do personagem, na direção que ele está de frente), não chuva de cima. */
export function confettiLaunchConfig(
  dir: Direction = 'up',
): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  return {
    angle: confettiAngleForDirection(dir),
    speed: { min: 120, max: 260 },
    gravityY: 260,
    lifespan: CONFETTI_LAUNCH_LIFESPAN,
    quantity: 2,
    frequency: 35,
    scale: { start: 1, end: 0.3 },
    rotate: { start: 0, end: 360 },
    tint: CONFETTI_COLORS,
  }
}

/** Burst único de tela cheia: linha no topo da viewport, caindo pela largura. */
export function confettiBurstConfig(
  width: number,
): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  return {
    x: { min: 0, max: width },
    y: 0,
    angle: { min: 60, max: 120 },
    speed: { min: 160, max: 340 },
    gravityY: 320,
    lifespan: CONFETTI_BURST_LIFESPAN,
    scale: { start: 1, end: 0.4 },
    rotate: { start: 0, end: 360 },
    tint: CONFETTI_COLORS,
    emitting: false,
  }
}
