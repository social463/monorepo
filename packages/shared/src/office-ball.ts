import type { Direction, MapDocumentV1, TilePosition } from './index'
import { DIRECTION_DELTAS } from './office'
import { isMapTileWalkable } from './office-map-runtime'

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
export interface OfficeBall {
  /** Id do `tile-object` que ancora a peça (o primeiro slice, no caso das de 2×2). */
  id: string
  /** Tile do canto superior-esquerdo da bola. */
  x: number
  y: number
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
 * Distância (Chebyshev) de um tile até a PEGADA da bola — 0 quando o tile está
 * em cima dela. É o que faz a bola de pilates ser alcançável pelos quatro
 * lados dela, e não só a partir do canto que a ancora.
 */
export function ballDistanceFrom(ball: OfficeBall, tile: TilePosition): number {
  const { w, h } = ballFootprint(ball)
  const dx = Math.max(ball.x - tile.x, tile.x - (ball.x + w - 1), 0)
  const dy = Math.max(ball.y - tile.y, tile.y - (ball.y + h - 1), 0)
  return Math.max(dx, dy)
}

/** Se dá para tocar/chutar a bola a partir deste tile. */
export function isBallInReach(ball: OfficeBall, tile: TilePosition): boolean {
  return ballDistanceFrom(ball, tile) <= BALL_REACH
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

/** Distância (Chebyshev) de onde ainda dá pra alcançar a bola — inclui diagonais. */
export const BALL_REACH = 1

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

/** Resultado de um chute: a trajetória INTEIRA, calculada de uma vez. */
export interface OfficeBallKick {
  ballId: string
  /**
   * Tiles por onde a bola passa, em ordem, sem o tile de origem. O último é
   * onde ela para — e é a posição autoritativa assim que o hub responde.
   */
  path: TilePosition[]
  /** Duração total da rolagem, em ms; o cliente só interpola. */
  durationMs: number
  power: OfficeBallPower
  /** `true` quando o pé pegou de raspão (diagonal ou de costas). */
  grazed: boolean
  /**
   * Quantas vezes a bola bateu e voltou no caminho. Sempre 0 no chute alto: no
   * ar não há em que bater, e ao cair ela para.
   */
  bounces: number
}

function stepFor(from: TilePosition, ball: OfficeBall, dir: Direction): { sx: number; sy: number } {
  const { w, h } = ballFootprint(ball)
  // Contato medido contra a FAIXA que a peça ocupa em cada eixo, não contra um
  // ponto: quem está ao lado de uma bola de 2×2 fica alinhado com ela naquele
  // eixo (componente 0) e o chute sai reto. Comparar com o centro faria toda
  // batida numa peça de lado par sair na diagonal, porque nenhum tile cai
  // exatamente no meio.
  const sx = from.x < ball.x ? 1 : from.x > ball.x + w - 1 ? -1 : 0
  const sy = from.y < ball.y ? 1 : from.y > ball.y + h - 1 ? -1 : 0
  // Em cima da própria bola não há vetor de contato: vale a direção encarada.
  if (sx === 0 && sy === 0) {
    const delta = DIRECTION_DELTAS[dir]
    return { sx: delta.x, sy: delta.y }
  }
  return { sx, sy }
}

/**
 * Chute limpo é o que sai na direção que o personagem encara, sem diagonal.
 * Qualquer outro contato (bola na diagonal, bola atrás de quem chuta) pega de
 * raspão.
 */
function isCleanContact(step: { sx: number; sy: number }, dir: Direction): boolean {
  if (step.sx !== 0 && step.sy !== 0) return false
  const delta = DIRECTION_DELTAS[dir]
  return step.sx === delta.x && step.sy === delta.y
}

export interface KickBallOptions {
  document: MapDocumentV1
  ball: OfficeBall
  kicker: TilePosition & { dir: Direction }
  power: OfficeBallPower
  /** Shift segurado no momento do chute. */
  sprint?: boolean
  /** Tiles que também param a bola — as pessoas presentes, tirando quem chuta. */
  obstacles?: readonly TilePosition[]
  /**
   * Vetor do empurrão, quando quem chuta não está usando o pé "de frente":
   * a condução passa o vetor do PASSO, que numa diagonal não é o mesmo que a
   * pose encarada (ver `facingForMove`).
   */
  pushDirection?: { x: number; y: number }
}

/**
 * Calcula a trajetória inteira do chute de uma vez, em vez de simular a bola
 * quadro a quadro no servidor. O hub é orientado a evento (não tem loop de
 * tick) e a posição final é o que importa para o estado autoritativo: o
 * cliente recebe o caminho e anima a rolagem, do mesmo jeito que já anima o
 * passo de quem anda.
 *
 * Devolve `null` quando a bola está fora do alcance (o chamador não precisa
 * checar distância antes).
 */
export function kickBall({
  document,
  ball,
  kicker,
  power,
  sprint = false,
  obstacles = [],
  pushDirection,
}: KickBallOptions): OfficeBallKick | null {
  if (!isBallInReach(ball, kicker)) return null

  const { w, h } = ballFootprint(ball)
  const blocked = new Set(obstacles.map((tile) => `${tile.x},${tile.y}`))
  // A bola inteira precisa caber: a de pilates não passa por vão de um tile.
  const passable = (x: number, y: number) => {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        if (!isMapTileWalkable(document, x + dx, y + dy)) return false
        if (blocked.has(`${x + dx},${y + dy}`)) return false
      }
    }
    return true
  }

  let { sx, sy } = pushDirection
    ? { sx: Math.sign(pushDirection.x), sy: Math.sign(pushDirection.y) }
    : stepFor(kicker, ball, kicker.dir)
  const grazed = pushDirection ? false : !isCleanContact({ sx, sy }, kicker.dir)

  // Condução: um tile na direção do passo, e só. Sem rebatida (a bola apenas
  // não sai do lugar quando não há para onde) e sem raspão — quem conduz não
  // está chutando, está empurrando com o pé a cada passo.
  if (power === 'dribble') {
    const target = { x: ball.x + sx, y: ball.y + sy }
    return {
      ballId: ball.id,
      path: passable(target.x, target.y) ? [target] : [],
      durationMs: sprint ? BALL_DRIBBLE_SPRINT_TILE_MS : BALL_DRIBBLE_TILE_MS,
      power,
      grazed: false,
      bounces: 0,
    }
  }

  const withModifiers = (base: number) => {
    let tiles = base
    if (grazed) tiles *= BALL_GRAZE_FACTOR
    if (sprint) tiles *= BALL_SPRINT_FACTOR
    return Math.max(1, Math.round(tiles))
  }

  // Chute alto: o caminho é reto e os tiles do meio são SOBREVOADOS — mesa,
  // planta e gente no meio não param nada. O que precisa estar livre é o
  // POUSO; se não estiver, a bola cai antes, no último tile livre da linha.
  // (É por isso que ele não é só um chute com a colisão desligada: quem
  // recebe a bola em cima de uma mesa precisaria buscá-la lá.)
  if (power === 'lob') {
    const reach = withModifiers(BALL_LOB_TILES)
    for (let distance = reach; distance >= 1; distance -= 1) {
      if (!passable(ball.x + sx * distance, ball.y + sy * distance)) continue
      const path: TilePosition[] = []
      for (let step = 1; step <= distance; step += 1) {
        path.push({ x: ball.x + sx * step, y: ball.y + sy * step })
      }
      return {
        ballId: ball.id,
        path,
        durationMs: path.length * BALL_LOB_TILE_MS,
        power,
        grazed,
        bounces: 0,
      }
    }
    // Nenhum pouso livre na linha (bola contra a parede): não sai do lugar.
    return { ballId: ball.id, path: [], durationMs: 0, power, grazed, bounces: 0 }
  }

  let remaining = BALL_TOUCH_TILES
  if (power === 'kick') remaining = withModifiers(BALL_KICK_TILES)

  const path: TilePosition[] = []
  let x = ball.x
  let y = ball.y
  let bounces = 0

  while (remaining > 0) {
    const nx = x + sx
    const ny = y + sy
    // Na diagonal a bola não passa por fresta entre dois cantos: exige ao
    // menos um dos ortogonais livre, a mesma regra do personagem.
    const diagonalSqueeze = sx !== 0 && sy !== 0 && !passable(x + sx, y) && !passable(x, y + sy)
    if (passable(nx, ny) && !diagonalSqueeze) {
      x = nx
      y = ny
      path.push({ x, y })
      remaining -= 1
      continue
    }
    if (bounces >= BALL_MAX_BOUNCES) break
    // Rebate: inverte só o eixo que encontrou o obstáculo (canto inverte os dois).
    if (sx !== 0 && sy !== 0) {
      const blockedX = !passable(x + sx, y)
      const blockedY = !passable(x, y + sy)
      if (blockedX) sx = -sx
      if (blockedY) sy = -sy
      if (!blockedX && !blockedY) {
        sx = -sx
        sy = -sy
      }
    } else if (sx !== 0) {
      sx = -sx
    } else {
      sy = -sy
    }
    bounces += 1
    remaining = Math.floor(remaining * BALL_BOUNCE_FACTOR)
    // Sem saída pelos dois lados (bola entalada): para onde estava.
    if (!passable(x + sx, y + sy)) break
  }

  const tileMs = power === 'touch' ? BALL_TOUCH_TILE_MS : BALL_KICK_TILE_MS
  return {
    ballId: ball.id,
    path,
    durationMs: path.length * tileMs,
    power,
    grazed,
    bounces,
  }
}
