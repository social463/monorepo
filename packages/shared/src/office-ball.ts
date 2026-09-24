import { ballDistance, ballRadius, kickBodyBall, type BodyBallState } from './body-ball'
import { DIRECTION_DELTAS } from './office'
import type { Direction } from './index'

/**
 * Bola chutável do escritório. Como o kart (`OfficeKart`), nasce de um
 * `tile-object` do sheet funcional publicado no mapa e vive só em memória no
 * hub — publicação nova reposiciona todas as bolas no lugar de origem.
 *
 * Diferente do kart, a bola NÃO bloqueia passagem: quem chega em cima dela
 * chuta na direção que está encarando. Bola sólida obrigaria a mexer na regra
 * de colisão (`isMapTileWalkable`) e, com ela, na predição do cliente e no
 * pathfinding — custo alto para o que o objeto é: um brinquedo.
 */
export interface OfficeBall extends BodyBallState {
  /** Id do `tile-object` que ancora a peça (o primeiro slice, no caso das de 2×2). */
  id: string
  /**
   * Tamanho em tiles. Ausente = 1×1, que é a esmagadora maioria — só a bola
   * de pilates ocupa 2×2. Quem lê precisa considerar a PEGADA inteira: uma
   * bola grande não passa por vão de um tile e é alcançável de mais longe.
   */
  w?: number
  h?: number
  /**
   * Slices que desenham a bola, na ordem do documento. Um só nas bolas de um
   * tile; quatro na de pilates — é o que permite ao cliente mover a peça
   * inteira junto, sem redescobrir o agrupamento.
   */
  memberIds?: string[]
}

/** Pegada da bola em tiles, com o default de 1×1 aplicado. */
export function ballFootprint(ball: OfficeBall): { w: number; h: number } {
  return { w: ball.w ?? 1, h: ball.h ?? 1 }
}

/**
 * Distância da SUPERFÍCIE da bola até um ponto, em pixel — 0 quando o ponto
 * está em cima dela.
 *
 * Descontar o raio é o que faz a bola de pilates continuar alcançável pelos
 * quatro lados, e não só a partir do centro: ela é grande, e medir do centro
 * exigiria enfiar o personagem dentro dela.
 *
 * Era Chebyshev em tiles até o movimento livre; virou euclidiana em pixel pelo
 * mesmo motivo que todo o resto virou — quem pergunta agora é um corpo contínuo.
 */
export function ballDistanceFrom(ball: OfficeBall, from: { x: number; y: number }): number {
  return Math.max(0, ballDistance(ball, from) - ballRadius(ball))
}

/**
 * Alcance do pé, em PIXEL, medido da superfície da bola.
 *
 * Ancorado no que ele sempre significou — "um tile" —, agora que a pergunta é
 * de um corpo contínuo.
 */
export const BALL_REACH_PX = 32

/** Se dá para tocar/chutar a bola a partir daqui. */
export function isBallInReach(ball: OfficeBall, from: { x: number; y: number }): boolean {
  return ballDistanceFrom(ball, from) <= BALL_REACH_PX
}

/**
 * Toque (empurrãozinho com o pé), chute rasteiro, chute alto — o que sobe e
 * passa POR CIMA do que estiver no caminho — e a condução, que é o empurrão
 * automático de quem ANDA por cima da bola.
 */
export type OfficeBallPower = 'touch' | 'kick' | 'lob' | 'dribble'

/**
 * Só os gestos que o CLIENTE pode pedir. A condução não entra: ela nasce do
 * passo (`OfficeHub.move`), e aceitar `dribble` vindo do socket deixaria
 * qualquer um empurrar a bola sem andar.
 */
export function isOfficeBallPower(value: unknown): value is OfficeBallPower {
  return value === 'touch' || value === 'kick' || value === 'lob'
}



/** Quantos tiles cada gesto empurra a bola, antes dos modificadores. */
export const BALL_TOUCH_TILES = 1
export const BALL_KICK_TILES = 5

/**
 * O pé não pegou limpo: a bola estava na diagonal, ou o personagem estava
 * encarando outro lado. Sai mais fraco — é o que dá ao chute uma "pegada"
 * variável sem depender de sorteio, que faria o mesmo gesto render coisas
 * diferentes sem o jogador entender por quê.
 */
export const BALL_GRAZE_FACTOR = 0.55

/** Chute com corrida (Shift segurado) vai mais longe. */
export const BALL_SPRINT_FACTOR = 1.5

/** Quanto sobra da força ao bater numa parede/pessoa e voltar. */
export const BALL_BOUNCE_FACTOR = 0.5

/** Teto de rebatidas por chute — evita bola quicando de parede em parede sem fim. */
export const BALL_MAX_BOUNCES = 2

/**
 * Alcance do chute alto. Menor que o rasteiro de propósito: passar por cima da
 * mesa é a vantagem dele, e ir longe TAMBÉM seria vantagem demais.
 */
export const BALL_LOB_TILES = 4

/**
 * Duração do empurrão da condução. Casada com o passo do personagem
 * (`STEP_MS`, 150 ms, e metade disso correndo) — se a bola demorasse mais que
 * o passo, ela ficaria para trás de quem conduz e o efeito de "levar a bola no
 * pé" se perderia.
 */
export const BALL_DRIBBLE_TILE_MS = 150
export const BALL_DRIBBLE_SPRINT_TILE_MS = 75

/** Tempo por tile percorrido; o toque rola devagar, o chute corre, o alto flutua. */
export const BALL_TOUCH_TILE_MS = 150
export const BALL_KICK_TILE_MS = 80
export const BALL_LOB_TILE_MS = 110

/**
 * Quanto tempo a bola do chute alto passa NO AR, em ms.
 *
 * Era medido em tiles (`BALL_LOB_TILES`), porque a trajetória inteira era
 * resolvida de uma vez sobre a grade. No contínuo não há trajetória resolvida —
 * há física —, então o que sobrevive do chute alto é o PRAZO em que a bola
 * ignora parede e mobília (`BodyBallState.airborneMs`).
 */
export const BALL_LOB_AIRBORNE_MS = 700

/**
 * Piso do voo do chute alto carregável — o toque rápido em C. Mesma ideia do
 * piso de força (`BODY_BALL_KICK_MIN_SPEED`): `BALL_LOB_AIRBORNE_MS` virou o
 * teto (tecla segurada até o fim), não mais um valor fixo.
 */
export const BALL_LOB_MIN_AIRBORNE_MS = 250

/**
 * Chuta a bola do escritório.
 *
 * O GESTO vem do cliente — qual tecla ele apertou — e agora também a CARGA:
 * quanto tempo ela segurou X ou C, de 0 (toque rápido) a 1 (segurou até o
 * teto). A direção sai do FACING autoritativo, e a força de `kickBodyBall`: o
 * escritório nunca teve mira de mouse, e não é a migração para pixel que vai
 * dar uma. O toque (Z) ignora a carga — ele já era o gesto fraco e fixo, e
 * carregar um toque não faria sentido.
 *
 * Devolve `null` quando a bola está fora do alcance, para o chamador não
 * precisar medir antes.
 */
export function officeKickBall(options: {
  ball: OfficeBall
  kicker: { x: number; y: number; dir: Direction }
  power: OfficeBallPower
  sprint?: boolean
  /** 0 a 1. Padrão 1 — força cheia, para quem não manda carga nenhuma. */
  charge?: number
}): BodyBallState | null {
  const { ball, kicker, power, sprint, charge = 1 } = options
  if (!isBallInReach(ball, kicker)) return null
  const angle = Math.atan2(DIRECTION_DELTAS[kicker.dir].y, DIRECTION_DELTAS[kicker.dir].x)
  const carga = Number.isFinite(charge) ? Math.max(0, Math.min(1, charge)) : 1
  return kickBodyBall({
    ball,
    kicker,
    angle,
    sprint,
    charge: carga,
    // Do CENTRO, somando o raio: `isBallInReach` já mediu da superfície, e sem
    // isto a segunda checagem recusaria toda bola grande.
    reach: BALL_REACH_PX + ballRadius(ball),
    // O toque é o passe; chute e chute alto saem com a força do chute — o que
    // distingue o alto é o voo, não a potência.
    power: power === 'touch' ? 'passe' : 'chute',
    ...(power === 'lob'
      ? { airborneMs: BALL_LOB_MIN_AIRBORNE_MS + (BALL_LOB_AIRBORNE_MS - BALL_LOB_MIN_AIRBORNE_MS) * carga }
      : {}),
  })
}
