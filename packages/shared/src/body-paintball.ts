import { bodyBlockedAt, type BodyCollisionGrid } from './body-collision'
import { BODY_HALF_WIDTH } from './body-move'
import { PAINT_SPLAT_TTL_MS, paintballColorFor, type PaintSplat } from './office-paintball'

/**
 * O tiro de paintball da arena.
 *
 * Difere do tiro do escritório em uma coisa só, mas ela muda tudo: aqui a
 * direção é **livre**. No escritório o disparo sai no facing, que tem quatro
 * poses, e é medido em tiles; na arena ele sai no ângulo que o mouse aponta e
 * corre em pixels. Mirar por mouse na grade seria estranho — o tiro nasceria
 * preso a uma das quatro poses —, e é por isso que a mira livre é da arena.
 *
 * O resto do desenho é o mesmo, e de propósito: o servidor resolve o disparo
 * INTEIRO no instante em que ele acontece e o cliente só anima. Sem loop de
 * projétil, sem física no cliente.
 */

/** Alcance do disparo, em pixels (≈13 tiles). */
export const BODY_SHOT_RANGE = 420

/** Velocidade do projétil, só para a duração da animação. */
export const BODY_SHOT_SPEED = 900

/** Cadência do marcador na arena. */
export const BODY_SHOT_COOLDOWN_MS = 420

/**
 * Raio do corpo para efeito de ACERTO, um pouco maior que a meia-largura de
 * colisão. Acertar tem que ser mais fácil que encostar: mira exata demais num
 * alvo que se move com 100ms de interpolação vira frustração pura.
 */
export const BODY_HIT_RADIUS = 11

/**
 * Passo da varredura do raio, em pixels. Menor que a célula de colisão (8px)
 * para não pular uma parede fina, e menor que o raio de acerto para não passar
 * por dentro de alguém.
 */
const RAY_STEP = 4

/** De onde o tiro sai, em relação ao centro do corpo. */
export const BODY_MUZZLE_OFFSET = BODY_HALF_WIDTH + 2

export interface BodyShotTarget {
  userId: string
  x: number
  y: number
}

export interface BodyShot {
  shooterId: string
  /** Ponto de saída, já deslocado do centro do atirador. */
  from: { x: number; y: number }
  /** Onde o projétil estourou: parede, alvo, ou o fim do alcance. */
  to: { x: number; y: number }
  durationMs: number
  color: number
  /** A marca criada, ou `null` quando o tiro não achou ninguém. */
  splat: PaintSplat | null
}

export interface FireBodyShotOptions {
  grid: BodyCollisionGrid
  shooter: { userId: string; x: number; y: number }
  /** Radianos, 0 = para a direita. Vem do cliente: é a mira dele. */
  angle: number
  /** Todo mundo em campo; quem atira é ignorado sozinho. */
  targets: readonly BodyShotTarget[]
  now: number
}

/**
 * Resolve o disparo inteiro varrendo o raio.
 *
 * O ÂNGULO vem do cliente — não tem de onde mais vir, já que a mira é o mouse
 * dele. O que o servidor não delega é o resultado: alcance, parede e acerto
 * são decididos aqui, com a posição autoritativa de todo mundo. Cliente
 * adulterado escolhe para onde aponta, nunca em quem acerta.
 */
export function fireBodyShot({
  grid,
  shooter,
  angle,
  targets,
  now,
}: FireBodyShotOptions): BodyShot {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const color = paintballColorFor(shooter.userId)
  // Sai à frente do corpo: nascendo no centro, o próprio atirador entraria na
  // varredura e todo tiro acertaria ele mesmo.
  const from = {
    x: shooter.x + dx * BODY_MUZZLE_OFFSET,
    y: shooter.y + dy * BODY_MUZZLE_OFFSET,
  }
  const alvos = targets.filter((alvo) => alvo.userId !== shooter.userId)

  let acerto: BodyShotTarget | null = null
  let ponto = { ...from }

  for (let distancia = 0; distancia <= BODY_SHOT_RANGE; distancia += RAY_STEP) {
    const x = from.x + dx * distancia
    const y = from.y + dy * distancia
    // Parede primeiro: quem está atrás dela não é acertável, e é isso que faz
    // a cobertura do mapa valer alguma coisa.
    if (bodyBlockedAt(grid, x, y)) break
    ponto = { x, y }
    const atingido = alvos.find(
      (alvo) => Math.hypot(alvo.x - x, alvo.y - y) <= BODY_HIT_RADIUS,
    )
    if (atingido) {
      acerto = atingido
      break
    }
  }

  const distancia = Math.hypot(ponto.x - from.x, ponto.y - from.y)
  return {
    shooterId: shooter.userId,
    from,
    to: ponto,
    durationMs: Math.max(1, Math.round((distancia / BODY_SHOT_SPEED) * 1000)),
    color,
    splat: acerto
      ? {
          // Mesmo formato do escritório: o id é a semente do visual da mancha
          // (`paintSplatPlacement`), então ela cai no mesmo lugar em todas as
          // telas sem coordenada nenhuma no payload.
          id: `${shooter.userId}:${acerto.userId}:${now}`,
          userId: acerto.userId,
          byUserId: shooter.userId,
          color,
          ttlMs: PAINT_SPLAT_TTL_MS,
        }
      : null,
  }
}
