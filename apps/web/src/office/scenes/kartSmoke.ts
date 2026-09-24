import {
  BODY_KART_BODY_HALF,
  BODY_KART_MAX_SPEED,
  BODY_KART_TURN_FULL_SPEED,
  BODY_KART_TURN_RATE,
  normalizeHeading,
  type BodyKartState,
} from '@legends/shared'
import type Phaser from 'phaser'

/**
 * Fumaça das rodas do kart na curva.
 *
 * Fora das cenas porque o kart é DOIS: o do escritório e o da corrida. Eles já
 * dividem a física (`stepBodyKart`); dividir também o efeito é o que impede a
 * mesma manobra de sair diferente em cada lugar.
 *
 * É puramente visual — nada aqui viaja no fio nem entra na simulação. O que o
 * efeito faz é dar RESPOSTA a uma regra que já existia e era invisível: o
 * esterço só morde com o kart andando, e é justamente aí que a fumaça aparece.
 */

export const KART_SMOKE_TEXTURE = 'kart-smoke'

/**
 * A nuvenzinha, um pixel por caractere — mesma convenção das máscaras de tinta,
 * e pelo mesmo motivo: o jogo roda com `pixelArt: true`, e um círculo desenhado
 * grande e depois encolhido chega na tela como serrilhado sem forma.
 */
const SMOKE_MASK: readonly string[] = ['.##.', '####', '####', '.##.']

/**
 * Velocidade a partir da qual a roda começa a fumaçar.
 *
 * `BODY_KART_TURN_FULL_SPEED` não é um número escolhido para caber: é a
 * velocidade em que o esterço passa a morder por inteiro. Abaixo dela o kart
 * mal vira, e fumaça ali prometeria uma curva que não está acontecendo.
 */
export const KART_SMOKE_MIN_SPEED = BODY_KART_TURN_FULL_SPEED

/** Quanto tempo cada nuvem vive. */
export const KART_SMOKE_LIFE_MS = 420

/** Intervalo entre duas nuvens da MESMA roda. */
export const KART_SMOKE_INTERVAL_MS = 45

/**
 * Onde as rodas de trás ficam, em relação ao centro do kart.
 *
 * Atrás (o eixo motriz é o que escorrega) e afastadas para os lados — fumaça
 * saindo do meio do veículo leria como fogo no motor, não como pneu cantando.
 */
const WHEEL_BACK = BODY_KART_BODY_HALF * 0.7
const WHEEL_SIDE = BODY_KART_BODY_HALF * 0.75

export interface KartSmoke {
  /** 0..1 — quanto a manobra está pedindo de fumaça. */
  intensity: number
  /** As duas rodas de trás, em coordenadas de MUNDO. */
  wheels: readonly [{ x: number; y: number }, { x: number; y: number }]
}

/**
 * Se esta manobra fumaça, e quanto.
 *
 * Pura e sem relógio, para poder ser exercitada sem cena — mesma escolha do
 * resto da mecânica do kart.
 *
 * Duas condições, e as duas importam. VELOCIDADE, porque pneu parado não canta.
 * E ESTERÇO (ou freio de mão), porque o que faz a roda escorregar é a curva —
 * sem isso, andar reto a 500 px/s viraria uma locomotiva soltando fumaça.
 */
export function kartSmoke(state: BodyKartState, steer: number, handbrake: boolean): KartSmoke | null {
  const velocidade = Math.abs(state.speed)
  if (velocidade < KART_SMOKE_MIN_SPEED) return null
  if (steer === 0 && !handbrake) return null

  // Cresce com a velocidade acima do mínimo, e o freio de mão sozinho já vale
  // bastante: derrapar de propósito é o gesto que mais pede o efeito.
  const faixa = Math.max(1, BODY_KART_MAX_SPEED - KART_SMOKE_MIN_SPEED)
  const porVelocidade = Math.min(1, (velocidade - KART_SMOKE_MIN_SPEED) / faixa)
  const intensity = Math.min(1, (handbrake ? 0.6 : 0.25) + porVelocidade * 0.5)

  const cos = Math.cos(state.heading)
  const sin = Math.sin(state.heading)
  // Perpendicular ao rumo: é o que separa as duas rodas.
  const lateralX = -sin
  const lateralY = cos
  const traseiraX = state.x - cos * WHEEL_BACK
  const traseiraY = state.y - sin * WHEEL_BACK

  return {
    intensity,
    wheels: [
      { x: traseiraX + lateralX * WHEEL_SIDE, y: traseiraY + lateralY * WHEEL_SIDE },
      { x: traseiraX - lateralX * WHEEL_SIDE, y: traseiraY - lateralY * WHEEL_SIDE },
    ],
  }
}

/** Gera a textura da fumaça. Idempotente, como as de tinta. */
export function createKartSmokeTexture(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics): void {
  if (scene.textures.exists(KART_SMOKE_TEXTURE)) return
  graphics.clear()
  graphics.fillStyle(0xffffff, 1)
  for (let y = 0; y < SMOKE_MASK.length; y += 1) {
    for (let x = 0; x < SMOKE_MASK[y].length; x += 1) {
      if (SMOKE_MASK[y][x] === '#') graphics.fillRect(x, y, 1, 1)
    }
  }
  graphics.generateTexture(KART_SMOKE_TEXTURE, SMOKE_MASK[0].length, SMOKE_MASK.length)
}

/**
 * Solta uma nuvem numa roda.
 *
 * Ela CRESCE e some no lugar, sem seguir o kart: fumaça que acompanha o veículo
 * não lê como fumaça, lê como enfeite preso nele. Ficar para trás é o que dá a
 * sensação de velocidade.
 */
export function puffKartSmoke(
  scene: Phaser.Scene,
  at: { x: number; y: number },
  intensity: number,
  depth: number,
): void {
  const nuvem = scene.add.image(at.x, at.y, KART_SMOKE_TEXTURE)
  nuvem.setDepth(depth)
  nuvem.setAlpha(0.15 + intensity * 0.35)
  nuvem.setScale(1)
  scene.tweens.add({
    targets: nuvem,
    alpha: 0,
    scale: 1.6 + intensity * 1.4,
    duration: KART_SMOKE_LIFE_MS,
    ease: 'Quad.easeOut',
    onComplete: () => nuvem.destroy(),
  })
}

/**
 * Menor taxa de giro, em rad/s, que conta como "está esterçando" para quem vê
 * o kart de FORA.
 *
 * Uma fração de `BODY_KART_TURN_RATE` porque é a mesma régua da simulação: o
 * esterço cheio gira a essa taxa vezes o grip, então um terço dela é curva de
 * verdade e não o tremor de um rumo que chega interpolado a 20 Hz.
 */
export const KART_SMOKE_REMOTE_TURN_RATE = BODY_KART_TURN_RATE * 0.35

/**
 * O esterço de um kart que não é o seu, MEDIDO pelo quanto o rumo girou.
 *
 * A intenção de esterço dos outros não viaja no fio — e não precisa. O rumo
 * viaja (`OfficeSnapshotPlayer.h`) e chega interpolado pelo arco curto, então a
 * taxa com que ele gira é observação, não adivinhação: quem canta pneu é a roda
 * que escorrega, e é exatamente isso que girar rápido em velocidade descreve.
 *
 * O SINAL é o do giro observado, não o da tecla: na ré o mesmo esterço gira o
 * kart para o outro lado, e de fora não há como distinguir os dois. Dá no
 * mesmo, porque `kartSmoke` só pergunta se o esterço é zero.
 *
 * Arco curto (`normalizeHeading`) porque o rumo vive em [−π, π): cruzar π sem
 * isso mediria uma volta inteira num quadro e poria fumaça em quem anda reto.
 */
export function remoteKartSteer(headingBefore: number, headingNow: number, dtMs: number): number {
  if (dtMs <= 0) return 0
  const rate = normalizeHeading(headingNow - headingBefore) / (dtMs / 1000)
  if (Math.abs(rate) < KART_SMOKE_REMOTE_TURN_RATE) return 0
  return Math.sign(rate)
}
