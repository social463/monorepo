import type { Direction, MapDocumentV1, TilePosition } from './index'
import { bodyBoxBlocked, type BodyCollisionGrid } from './body-collision'

/**
 * O passo de um corpo contínuo — o movimento livre do produto.
 *
 * Nasceu na arena e hoje é de **dois** lugares: a arena e o escritório. Por isso
 * o nome deixou de dizer "arena": código de escritório chamando `stepArena`
 * sugeriria, a todo leitor futuro, que ali há algo de arena.
 *
 * Esta função roda nos DOIS lados de cada um: o servidor a usa para produzir o
 * estado autoritativo, e o cliente a usa para prever o próprio movimento e para
 * reexecutar os inputs ainda não confirmados na reconciliação.
 *
 * Não é reuso por economia — é o que impede predição e autoridade de
 * divergirem *por construção*. Duas implementações do mesmo movimento divergem
 * sempre; a pergunta é só em quantas semanas de caça a drift. É o mesmo papel
 * que `canStepTo` tem na grade do escritório ("a regra ÚNICA do movimento,
 * chamada pelo servidor e pela predição do cliente").
 *
 * Por isso ela é **pura e sem relógio**: `dtMs` entra por parâmetro. Ler o
 * tempo aqui dentro tornaria impossível reexecutar um input antigo — e
 * reexecutar é exatamente o que a reconciliação faz.
 */

/**
 * Velocidade de caminhada, em pixels por segundo.
 *
 * Não é chute: é a MESMA cadência que o escritório sempre teve, convertida. Lá
 * o passo era de um tile (32px) a cada `STEP_MS` (150ms) — 213 px/s — e a
 * corrida, o passo pela metade, 427 px/s.
 *
 * É por isso que trazer o movimento livre para o escritório não muda a
 * velocidade de ninguém: devolve exatamente a cadência que já existia, sem os
 * degraus.
 */
export const BODY_SPEED = 213

/** Corrida (Shift). 2×, para bater com o `SPRINT_STEP_MS` do escritório. */
export const BODY_SPRINT_FACTOR = 2

/**
 * Teto do passo de integração. Uma aba que volta do background entrega um
 * `dt` gigante, e integrar isso de uma vez atravessa parede (tunneling): o
 * corpo salta de um lado ao outro sem nunca ocupar o meio. Com teto, o pior
 * caso é andar menos do que deveria — visível e inofensivo.
 */
export const BODY_MAX_STEP_MS = 50

/** Meia-largura e meia-altura do corpo, em pixels. Mais estreito que um tile
 *  para caber em vão de um tile sem raspar. */
export const BODY_HALF_WIDTH = 7
export const BODY_HALF_HEIGHT = 6

export interface BodyState {
  /** Posição em PIXEL, não em tile — é o ponto da arena. */
  x: number
  y: number
  /** Pose do sprite. O personagem LPC tem quatro, como no escritório. */
  dir: Direction
}

export interface BodyInput {
  /** Monotônico por jogador. É por ele que o servidor diz "processei até aqui". */
  seq: number
  /** Intenção nos dois eixos, em −1..1. Nunca posição: cliente que manda
   *  posição é cliente que teleporta. */
  dx: number
  dy: number
  /** Quanto tempo este input vale. */
  dtMs: number
  /**
   * Shift segurado. Viaja no INPUT, e não como ajuste só do cliente, porque
   * velocidade é parte da simulação: se o cliente corresse e o servidor não,
   * a reconciliação puxaria o personagem para trás a cada snapshot. Mesmo
   * desenho do `sprint` no `move` do escritório.
   */
  sprint?: boolean
}

/**
 * Pose a partir da intenção. O horizontal ganha da vertical, como
 * `facingForMove` já faz na diagonal do escritório: as poses de lado do LPC
 * leem melhor de perfil.
 */
export function bodyFacing(dx: number, dy: number, current: Direction): Direction {
  if (dx === 0 && dy === 0) return current
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

/** Se o corpo cabe com o centro aqui. */
function fits(grid: BodyCollisionGrid, x: number, y: number): boolean {
  return !bodyBoxBlocked(grid, x, y, BODY_HALF_WIDTH, BODY_HALF_HEIGHT)
}

/**
 * Ajustes da simulação. Fazem parte dela: os dois lados precisam usar os
 * MESMOS valores, senão a predição do cliente diverge da autoridade do
 * servidor a cada passo. São parâmetro, e não constante lida aqui dentro, para
 * que dê para afinar a sensação sem editar código — e para que o servidor
 * possa impor os seus.
 */
export interface BodyStepOptions {
  /** Pixels por segundo. Padrão `BODY_SPEED`. */
  speed?: number
}

/**
 * Aplica um input e devolve o estado seguinte. Determinística: mesmo estado +
 * mesma sequência de inputs (+ mesmas opções) → mesmo resultado, em qualquer
 * máquina. É essa propriedade que faz a reconciliação convergir em vez de
 * brigar.
 */
export function stepBody(
  state: BodyState,
  input: BodyInput,
  grid: BodyCollisionGrid,
  options: BodyStepOptions = {},
): BodyState {
  const dt = Math.min(Math.max(input.dtMs, 0), BODY_MAX_STEP_MS) / 1000

  // Vetor normalizado: sem isto, a diagonal anda √2 mais rápido que o reto —
  // o bug clássico de oito direções, e o mesmo que `DIAGONAL_STEP_FACTOR`
  // resolve na grade.
  let { dx, dy } = { dx: input.dx, dy: input.dy }
  const length = Math.hypot(dx, dy)
  if (length > 1) {
    dx /= length
    dy /= length
  }

  const speed = (options.speed ?? BODY_SPEED) * (input.sprint ? BODY_SPRINT_FACTOR : 1)
  const dir = bodyFacing(dx, dy, state.dir)
  const stepX = dx * speed * dt
  const stepY = dy * speed * dt

  // Um eixo de cada vez. Testar o destino diagonal de uma vez faria o corpo
  // GRUDAR na parede ao andar torto contra ela; resolvendo separado, o eixo
  // livre continua andando e o personagem desliza.
  let { x, y } = state
  if (stepX !== 0 && fits(grid, x + stepX, y)) x += stepX
  if (stepY !== 0 && fits(grid, x, y + stepY)) y += stepY

  return { x, y, dir }
}

/**
 * Folga exigida em volta do ponto de nascimento, além do corpo. Nascer
 * encostado numa parede é tecnicamente válido e péssimo na prática: o primeiro
 * movimento em metade das direções não sai, e a sensação é de estar preso.
 */
export const BODY_SPAWN_CLEARANCE = 10

/** Distância mínima entre dois nascimentos, para ninguém nascer em cima de ninguém. */
export const BODY_SPAWN_SPACING = 28

/** Raio máximo da busca por um lugar com folga, em tiles. */
const SPAWN_SEARCH_TILES = 12

/**
 * Onde nascer: o tile de spawn do mapa se houver espaço, senão o ponto livre
 * mais próximo dele.
 *
 * Existe porque a arena roda, neste marco, num mapa desenhado para a GRADE — e
 * o spawn do escritório costuma ser um vão de um tile (porta, nicho). Para
 * quem anda em grade isso é confortável, porque a pessoa está sempre no centro
 * do tile; para um corpo contínuo, sobram poucos pixels para cada lado e o
 * jogador nasce praticamente entalado.
 *
 * A busca é em espiral por anéis, então o resultado é o ponto com folga mais
 * próximo do spawn desenhado — a intenção do mapa é preservada quando dá.
 */
export function bodySpawnPoint(
  document: MapDocumentV1,
  grid: BodyCollisionGrid,
  from: TilePosition,
  occupied: readonly { x: number; y: number }[] = [],
): { x: number; y: number } {
  const { tileWidth, tileHeight } = document.map
  const center = (tile: TilePosition) => ({
    x: tile.x * tileWidth + tileWidth / 2,
    y: tile.y * tileHeight + tileHeight / 2,
  })
  const roomy = (point: { x: number; y: number }) => {
    if (
      bodyBoxBlocked(
        grid,
        point.x,
        point.y,
        BODY_HALF_WIDTH + BODY_SPAWN_CLEARANCE,
        BODY_HALF_HEIGHT + BODY_SPAWN_CLEARANCE,
      )
    ) {
      return false
    }
    // Longe de quem já está em campo. Sem isto todo mundo nasce no MESMO
    // pixel e os personagens ficam empilhados — parecendo, para quem entrou,
    // que o outro simplesmente não está lá.
    return occupied.every(
      (other) => Math.hypot(other.x - point.x, other.y - point.y) >= BODY_SPAWN_SPACING,
    )
  }

  const origin = center(from)
  for (let radius = 0; radius <= SPAWN_SEARCH_TILES; radius += 1) {
    let best: { x: number; y: number } | null = null
    let bestDistance = Infinity
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        // Só a casca do anel: o miolo já foi visto nos raios anteriores.
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
        const point = center({ x: from.x + dx, y: from.y + dy })
        if (!roomy(point)) continue
        // O anel inteiro é avaliado antes de escolher: pegar o primeiro da
        // varredura entregaria sempre a quina de cima-à-esquerda, que pode
        // estar bem mais longe que um vizinho lateral do mesmo anel.
        const distance = Math.hypot(point.x - origin.x, point.y - origin.y)
        if (distance < bestDistance) {
          best = point
          bestDistance = distance
        }
      }
    }
    if (best) return best
  }
  // Nada folgado e livre no raio de busca: cai no spawn desenhado. Apertado e
  // possivelmente em cima de alguém — mas nascer em algum lugar é melhor do
  // que não nascer.
  return center(from)
}

/**
 * Uma caixa que bloqueia o passo além do cenário: kart estacionado, hoje.
 *
 * Em PIXEL e por caixa, e não por tile, pelo mesmo motivo do resto do módulo:
 * quem consulta é movimento contínuo, e converter para tile antes de perguntar
 * jogaria fora a resolução que a grade fina existe para ter.
 */
export interface BodyBlocker {
  x: number
  y: number
  halfWidth: number
  halfHeight: number
}

/** Duas caixas se sobrepõem? */
function overlaps(
  ax: number,
  ay: number,
  ahw: number,
  ahh: number,
  blocker: BodyBlocker,
): boolean {
  return (
    Math.abs(ax - blocker.x) < ahw + blocker.halfWidth &&
    Math.abs(ay - blocker.y) < ahh + blocker.halfHeight
  )
}

/**
 * O passo, respeitando também os bloqueios DINÂMICOS.
 *
 * Existe porque a grade de colisão é rasterizada do documento publicado e
 * memoizada pela identidade de `document.objects` — ela é estática por
 * construção, e um kart que alguém estacionou agora não está nela. Rasterizar
 * de novo a cada tick por causa de um kart seria pagar o mapa inteiro por um
 * objeto.
 *
 * A retomada por eixo repete a de `stepBody` de propósito: bater num kart tem
 * de deslizar como bater numa parede, senão o kart vira uma armadilha que gruda
 * — e quem está passando por ele não entende por que parou.
 *
 * Roda nos DOIS lados. Se só o servidor conhecesse os karts, a predição do
 * cliente atravessaria um e seria puxada de volta a cada snapshot.
 */
export function stepBodyAmongBlockers(
  state: BodyState,
  input: BodyInput,
  grid: BodyCollisionGrid,
  blockers: readonly BodyBlocker[],
  options: BodyStepOptions = {},
): BodyState {
  // Bloqueio em que o corpo JÁ ESTÁ não bloqueia — dá para sair de dentro dele.
  //
  // É o que impede a armadilha de desmontar: o kart estaciona exatamente onde o
  // piloto estava, as duas caixas se sobrepõem, e sem esta guarda TODO passo
  // seria recusado — a pessoa ficaria presa em cima do próprio veículo, sem
  // nada na tela explicando por quê.
  //
  // O modelo de grade não tinha o problema porque lá o kart bloqueava o tile de
  // DESTINO, nunca o que a pessoa ocupava. Ignorar os que já se sobrepõem
  // restaura essa semântica, e vale para qualquer bloqueio que apareça em cima
  // de alguém (uma publicação nova, alguém estacionando ali).
  const relevantes = blockers.filter(
    (blocker) => !overlaps(state.x, state.y, BODY_HALF_WIDTH, BODY_HALF_HEIGHT, blocker),
  )
  const livre = (x: number, y: number) =>
    !relevantes.some((blocker) => overlaps(x, y, BODY_HALF_WIDTH, BODY_HALF_HEIGHT, blocker))

  const cheio = stepBody(state, input, grid, options)
  if (relevantes.length === 0 || livre(cheio.x, cheio.y)) return cheio

  // Um eixo de cada vez, na mesma ordem de `stepBody`.
  const soX = stepBody(state, { ...input, dy: 0 }, grid, options)
  if (soX.x !== state.x && livre(soX.x, soX.y)) return { ...cheio, x: soX.x, y: state.y }
  const soY = stepBody(state, { ...input, dx: 0 }, grid, options)
  if (soY.y !== state.y && livre(soY.x, soY.y)) return { ...cheio, x: state.x, y: soY.y }

  // Encostado nos dois eixos: só a pose responde.
  return { ...state, dir: cheio.dir }
}
