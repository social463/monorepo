import { bodyBoxBlocked, type BodyCollisionGrid } from './body-collision'
import { BODY_SPEED, BODY_SPRINT_FACTOR } from './body-move'

/**
 * A bola da arena.
 *
 * É a bola do escritório (`office-ball.ts`) traduzida para o mundo contínuo, e
 * a tradução muda a peça inteira. Lá o hub é orientado a EVENTO e não tem
 * relógio: por isso `kickBall` resolve a trajetória inteira de uma vez, em
 * tiles, e o cliente só interpola. Aqui já existe um loop a 40Hz, e o que faz
 * um futebol ser futebol é exatamente o que a resolução instantânea impede —
 * interceptar um chute no meio do caminho, dividir a bola, a bola bater em
 * alguém e sobrar para outro.
 *
 * Então a bola é SIMULADA, e as funções abaixo são puras e sem relógio (`dtMs`
 * entra por parâmetro), pelo mesmo motivo de `stepBody`: o servidor integra a
 * bola autoritativa e o cliente roda ESTAS funções entre snapshots. Duas
 * implementações da mesma física divergem sempre.
 */

/** Posição em px e velocidade em px/s. Nunca em tile: o ponto da arena é o pixel. */
export interface BodyBallState {
  x: number
  y: number
  vx: number
  vy: number
  /**
   * Enquanto for maior que zero, a bola está NO AR: ela ignora parede e
   * mobília, e o valor decresce com o tempo.
   *
   * Existe para o chute alto do escritório, que na grade era resolvido de uma
   * vez ("a trajetória passa por cima destes tiles"). No contínuo não há eixo
   * Z, e sem isto o chute alto viraria um chute rasteiro — a bola bateria na
   * primeira mesa, que é exatamente o que ele existe para evitar.
   */
  airborneMs?: number
  /**
   * Raio, em px. Ausente = `BODY_BALL_RADIUS`, que é a bola de futebol da arena.
   *
   * Existe por causa do escritório: lá a bola é um GRUPO de tile-objects
   * publicado no editor, e pode ocupar vários tiles — há bola de praia. Fixar o
   * raio faria uma bola de três tiles bater na parede a um tile e meio dela, ou
   * atravessar meia mesa, dependendo do lado do erro.
   */
  r?: number
}

/** O raio que vale para esta bola. */
export function ballRadius(ball: Pick<BodyBallState, 'r'>): number {
  return ball.r ?? BODY_BALL_RADIUS
}

/**
 * Raio da bola, em px.
 *
 * Menor que o meio-sprite de propósito: a arte tem um halo transparente em
 * volta do couro, e usar o raio de desenho faria a bola bater na parede antes
 * de encostar nela.
 */
export const BODY_BALL_RADIUS = 8

/**
 * Atrito do gramado: a velocidade decai `e^(−k·t)`, com DUAS faixas.
 *
 * Exponencial, e não subtração constante, porque é o que dá a sensação certa:
 * a bola perde muito no começo e vai morrendo devagar. O problema é que "vai
 * morrendo devagar" é ótimo para o chute e péssimo para a condução — com uma
 * faixa só, a bola que escapa do pé de quem para de andar ainda rola seis
 * tiles, e conduzir vira chutar para a frente e correr atrás.
 *
 * Então bola lenta (abaixo de `BODY_BALL_SLOW_SPEED`, que é mais ou menos o
 * que a condução imprime) pega um atrito bem maior. O chute atravessa essa
 * faixa no fim do percurso e perde uns três tiles; a bola solta morre em dois.
 * É a mesma ideia do gramado alto perto da linha, e o que sai dela é o que
 * importa: dá para levar a bola no pé.
 */
export const BODY_BALL_FRICTION = 1.15
export const BODY_BALL_SLOW_SPEED = 330
export const BODY_BALL_SLOW_FRICTION = 3.2

/** Abaixo disso a bola para de vez, em vez de deslizar para sempre. */
export const BODY_BALL_MIN_SPEED = 14

/** Chute normal e chute com corrida (Shift). Mesmo par de gestos do escritório. */
export const BODY_BALL_KICK_SPEED = 760
export const BODY_BALL_SPRINT_KICK_SPEED = 1_150

/**
 * Piso do chute carregável — o toque rápido na tecla, sem segurar nada.
 *
 * `BODY_BALL_KICK_SPEED`/`BODY_BALL_SPRINT_KICK_SPEED` viraram o TETO da carga
 * (tecla segurada até o fim), não mais um valor fixo: existe porque o chute
 * sem carga nenhuma estava forte demais para o escritório, e não porque a
 * arena precisasse de um chute fraco — a arena chuta sem carregar (`charge`
 * default 1) e continua na mesma força de sempre.
 */
export const BODY_BALL_KICK_MIN_SPEED = 300

/**
 * O passe: o toque curto do escritório (`BALL_TOUCH_TILES`) traduzido.
 *
 * Existe porque um jogo com um chute só é um jogo de chutão: a bola sempre
 * atravessa meio campo, e não há como deixá-la para o companheiro que está
 * três tiles ao lado. ~6 tiles, que é a distância de quem está por perto.
 */
export const BODY_BALL_PASS_SPEED = 430

/** Distância (px) do centro do corpo à bola para conseguir chutar. */
export const BODY_BALL_KICK_REACH = 26

/** Distância (px) em que o corpo toca a bola — condução ou rebatida. */
export const BODY_BALL_TOUCH_REACH = 17

/** Cadência do chute. Sem ela, segurar o clique vira turbina. */
export const BODY_BALL_KICK_COOLDOWN_MS = 320

/**
 * Quanto a condução empurra, em relação à velocidade de quem conduz.
 *
 * Um pouco MAIS rápido que o passo de propósito: com a bola exatamente na
 * velocidade do pé, quem conduz passa por cima dela a cada quadro e a bola
 * fica presa dentro do corpo. Com o excedente, ela anda meio passo à frente —
 * que é o que "levar a bola no pé" quer dizer. Mesmo cuidado que
 * `BALL_DRIBBLE_TILE_MS` toma no escritório, casando o empurrão com o passo.
 */
export const BODY_BALL_DRIBBLE_FACTOR = 1.18

/** Quanto sobra da velocidade ao bater na parede e no corpo de alguém. */
export const BODY_BALL_WALL_BOUNCE = 0.66
export const BODY_BALL_PLAYER_BOUNCE = 0.55

/**
 * Teto do passo de integração, menor que o do corpo (`BODY_MAX_STEP_MS`): a
 * bola é três vezes mais rápida que um jogador, e um passo grande demais a
 * faria atravessar a parede em vez de bater nela.
 */
export const BODY_BALL_MAX_STEP_MS = 16

/** Teto de subpassos por chamada — trava de aba que volta do background. */
const MAX_SUBSTEPS = 8

/** Bola parada no centro, do jeito que a saída de bola a deixa. */
export function restingBall(at: { x: number; y: number }): BodyBallState {
  return { x: at.x, y: at.y, vx: 0, vy: 0 }
}

function fits(grid: BodyCollisionGrid, x: number, y: number, radius: number): boolean {
  return !bodyBoxBlocked(grid, x, y, radius, radius)
}

/**
 * A bola cabe DENTRO do mapa aqui? Só os limites — mobília não conta.
 *
 * É o que a bola no ar ainda respeita. Voar por cima de uma mesa é a feature;
 * voar para fora do mapa é perder a bola para sempre, porque de lá ela não
 * volta e ninguém a alcança.
 */
function insideMap(grid: BodyCollisionGrid, x: number, y: number, radius: number): boolean {
  const width = grid.width * grid.cellWidth
  const height = grid.height * grid.cellHeight
  return x - radius >= 0 && y - radius >= 0 && x + radius <= width && y + radius <= height
}

/**
 * Integra a bola por `dtMs`: atrito e parede.
 *
 * Um eixo de cada vez, como `stepBody` — e aqui a razão é ainda mais visível:
 * a bola que bate numa parede vertical tem de continuar correndo no eixo
 * livre, senão ela para morta em cada quina.
 */
export function stepBodyBall(
  ball: BodyBallState,
  dtMs: number,
  grid: BodyCollisionGrid,
): BodyBallState {
  let { x, y, vx, vy } = ball
  if (vx === 0 && vy === 0) {
    // Parada no ar: ela POUSA. Sem isto o prazo nunca é descontado (o
    // decremento vive no laço de integração, que este atalho pula), e a bola
    // fica atravessando parede para sempre — foi assim que uma bola saiu do
    // mapa e não voltou.
    return ball.airborneMs ? { ...ball, airborneMs: undefined } : ball
  }
  const raio = ballRadius(ball)
  // No ar, nada bloqueia — nem parede, nem mobília. O prazo é descontado do
  // tempo INTEGRADO, e não do relógio: assim a bola pousa no mesmo lugar
  // independente de quantos quadros couberam no caminho.
  let noAr = Math.max(0, ball.airborneMs ?? 0)

  let restante = Math.max(0, dtMs)
  for (let i = 0; i < MAX_SUBSTEPS && restante > 0; i += 1) {
    const passo = Math.min(restante, BODY_BALL_MAX_STEP_MS)
    restante -= passo
    const dt = passo / 1000

    const atrito =
      Math.hypot(vx, vy) < BODY_BALL_SLOW_SPEED ? BODY_BALL_SLOW_FRICTION : BODY_BALL_FRICTION
    const decay = Math.exp(-atrito * dt)
    vx *= decay
    vy *= decay
    if (Math.hypot(vx, vy) < BODY_BALL_MIN_SPEED) {
      vx = 0
      vy = 0
      break
    }

    const nx = x + vx * dt
    const ny = y + vy * dt
    if (noAr > 0) {
      // Voando: passa por cima da MOBÍLIA, não do mapa. O limite continua
      // valendo, e bate nele como bateria no chão.
      if (insideMap(grid, nx, y, raio)) x = nx
      else vx = -vx * BODY_BALL_WALL_BOUNCE
      if (insideMap(grid, x, ny, raio)) y = ny
      else vy = -vy * BODY_BALL_WALL_BOUNCE
      noAr = Math.max(0, noAr - passo)
    } else {
      if (fits(grid, nx, y, raio)) x = nx
      else vx = -vx * BODY_BALL_WALL_BOUNCE
      if (fits(grid, x, ny, raio)) y = ny
      else vy = -vy * BODY_BALL_WALL_BOUNCE
    }
  }

  return {
    x,
    y,
    vx,
    vy,
    ...(ball.r === undefined ? {} : { r: ball.r }),
    ...(noAr > 0 ? { airborneMs: noAr } : {}),
  }
}

/** Distância do centro do corpo de alguém até a bola. */
export function ballDistance(ball: BodyBallState, from: { x: number; y: number }): number {
  return Math.hypot(ball.x - from.x, ball.y - from.y)
}

/**
 * Se dá para chutar a bola a partir daqui.
 *
 * O alcance é parâmetro porque não é o mesmo em todo lugar: a arena mede o pé
 * de um jogador até uma bola de futebol, e o escritório precisa somar o RAIO —
 * uma bola de pilates tem um tile de raio, e medir do centro dela exigiria
 * enfiar o personagem dentro da bola.
 */
export function isBallKickable(
  ball: BodyBallState,
  from: { x: number; y: number },
  reach: number = BODY_BALL_KICK_REACH,
): boolean {
  return ballDistance(ball, from) <= reach
}

/**
 * Os dois gestos de pé. O GESTO vem do cliente (é a tecla que a pessoa
 * apertou); a FORÇA de cada um é daqui — cliente não escolhe potência, escolhe
 * entre passar e chutar, que é uma decisão de jogo como qualquer outra.
 */
export type BodyKickPower = 'passe' | 'chute'

export interface KickBodyBallOptions {
  ball: BodyBallState
  kicker: { x: number; y: number }
  /** Radianos, 0 = para a direita. Vem do cliente: a mira é o mouse dele. */
  angle: number
  /**
   * Shift segurado. NÃO vem do fio: o servidor lê o `sprint` do último input
   * já processado daquele jogador. Aceitar a força do cliente seria aceitar um
   * chute de qualquer tamanho.
   */
  sprint?: boolean
  /** Passe (toque curto) ou chute. Padrão: chute. */
  power?: BodyKickPower
  /** Alcance do pé, em px do CENTRO da bola. Padrão `BODY_BALL_KICK_REACH`. */
  reach?: number
  /**
   * Manda a bola pelo AR por este tempo — ela ignora parede e mobília enquanto
   * durar. É o chute alto do escritório; a arena não usa.
   */
  airborneMs?: number
  /**
   * Quanto tempo a tecla ficou segurada, de 0 (toque rápido) a 1 (segurou até
   * o teto). Padrão 1 — chute cheio, o comportamento de sempre para quem não
   * carrega nada (a arena, por exemplo). Ignorado no passe: passe é sempre o
   * mesmo toque curto, carregar não faria sentido para ele.
   */
  charge?: number
}

/**
 * Chuta. Devolve `null` quando a bola está fora do alcance — o chamador não
 * precisa medir distância antes (mesma cortesia de `kickBall`).
 */
export function kickBodyBall({
  ball,
  kicker,
  angle,
  sprint = false,
  power = 'chute',
  airborneMs,
  reach,
  charge = 1,
}: KickBodyBallOptions): BodyBallState | null {
  if (!isBallKickable(ball, kicker, reach)) return null
  if (!Number.isFinite(angle)) return null
  const speed = bodyKickSpeed(power, sprint, charge)
  return {
    x: ball.x,
    y: ball.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    ...(ball.r === undefined ? {} : { r: ball.r }),
    ...(airborneMs ? { airborneMs } : {}),
  }
}

/**
 * A força de cada gesto. O passe ignora a corrida de propósito: passe curto
 * que vira chutão porque a pessoa estava com Shift apertado (e ela está quase
 * sempre) não seria mais um passe.
 *
 * O chute interpola entre `BODY_BALL_KICK_MIN_SPEED` (carga 0) e o teto do
 * gesto (carga 1) — `BODY_BALL_SPRINT_KICK_SPEED` correndo,
 * `BODY_BALL_KICK_SPEED` parado. Por isso a corrida sempre sai mais forte que
 * o chute parado na MESMA carga: os dois partem do mesmo piso e só o teto
 * muda.
 */
export function bodyKickSpeed(power: BodyKickPower, sprint: boolean, charge = 1): number {
  if (power === 'passe') return BODY_BALL_PASS_SPEED
  const teto = sprint ? BODY_BALL_SPRINT_KICK_SPEED : BODY_BALL_KICK_SPEED
  const carga = Number.isFinite(charge) ? Math.max(0, Math.min(1, charge)) : 1
  return BODY_BALL_KICK_MIN_SPEED + (teto - BODY_BALL_KICK_MIN_SPEED) * carga
}

/** Velocidade da condução de quem anda (ou corre) com a bola no pé. */
export function dribbleSpeed(sprint: boolean): number {
  return BODY_SPEED * (sprint ? BODY_SPRINT_FACTOR : 1) * BODY_BALL_DRIBBLE_FACTOR
}

export interface BallToucher {
  x: number
  y: number
  /** Intenção do passo, como veio no input (não normalizada). */
  dx: number
  dy: number
  sprint?: boolean
}

/**
 * O que o corpo de alguém faz com a bola que ele encosta.
 *
 * Duas coisas, e a diferença entre elas é o que dá função ao adversário sem
 * precisar de nenhuma regra de desarme:
 *
 * - **conduz** quem está ANDANDO e alcança uma bola que não está mais rápida
 *   que o próprio pé — a versão contínua do `dribble` do escritório;
 * - **rebate** todo o resto: quem está parado no caminho, e quem tenta
 *   conduzir uma bola que vem forte demais. Corpo no meio do campo é
 *   obstáculo, e é isso que faz marcar valer alguma coisa.
 *
 * Devolve `null` quando não houve toque, para o chamador saber que não precisa
 * substituir nada.
 */
export function touchBodyBall(ball: BodyBallState, player: BallToucher): BodyBallState | null {
  // O alcance cresce com o EXCEDENTE de raio, não com o raio inteiro.
  //
  // `BODY_BALL_TOUCH_REACH` foi calibrado medindo do centro de uma bola padrão
  // (raio 8), e é essa sensação que a arena tem hoje — somar o raio inteiro a
  // mudaria de graça. O que ele não previa é bola GRANDE: a do escritório tem
  // raio 16 e a de pilates 32, e aí 17px do centro exigiria estar dentro dela.
  // Somando só o que passa do padrão, a arena fica idêntica e a bola grande
  // ganha exatamente o tamanho a mais que ela tem.
  const alcance = BODY_BALL_TOUCH_REACH + (ballRadius(ball) - BODY_BALL_RADIUS)
  const distancia = ballDistance(ball, player)
  if (distancia > alcance) return null

  const andando = player.dx !== 0 || player.dy !== 0
  const conducao = dribbleSpeed(player.sprint === true)
  if (andando && Math.hypot(ball.vx, ball.vy) <= conducao) {
    const comprimento = Math.hypot(player.dx, player.dy) || 1
    return {
      x: ball.x,
      y: ball.y,
      vx: (player.dx / comprimento) * conducao,
      vy: (player.dy / comprimento) * conducao,
      ...(ball.r === undefined ? {} : { r: ball.r }),
    }
  }

  // Rebatida: reflete pela normal do contato. Bola exatamente em cima do corpo
  // não tem normal — sai para a frente de quem a encostou (ou para a direita,
  // se ele também estiver parado), em vez de virar NaN.
  let nx = ball.x - player.x
  let ny = ball.y - player.y
  const norma = Math.hypot(nx, ny)
  if (norma < 0.001) {
    const fallback = Math.hypot(player.dx, player.dy)
    nx = fallback > 0 ? player.dx / fallback : 1
    ny = fallback > 0 ? player.dy / fallback : 0
  } else {
    nx /= norma
    ny /= norma
  }

  const produto = ball.vx * nx + ball.vy * ny
  // Só rebate o que vem NA direção do corpo: bola que já está saindo seria
  // puxada de volta, e o efeito seria a bola grudando em quem ela passou.
  const vx = produto < 0 ? (ball.vx - 2 * produto * nx) * BODY_BALL_PLAYER_BOUNCE : ball.vx
  const vy = produto < 0 ? (ball.vy - 2 * produto * ny) * BODY_BALL_PLAYER_BOUNCE : ball.vy

  // Empurra para fora do corpo: sem isso a bola fica no alcance no quadro
  // seguinte e rebate de novo, tremendo no lugar.
  const fora = alcance + 0.5
  return {
    x: player.x + nx * fora,
    y: player.y + ny * fora,
    vx,
    vy,
    ...(ball.r === undefined ? {} : { r: ball.r }),
  }
}
