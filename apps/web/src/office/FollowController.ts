import {
  BODY_INPUT_HZ,
  BODY_SPEED,
  DIRECTION_DELTAS,
  TILE_SIZE,
  tileOfPixel,
  type Direction,
  type MoveDirection,
  type TilePosition,
} from '@legends/shared'

/**
 * Raio, em PIXEL, para dar um waypoint por alcançado.
 *
 * Tem de ser maior que o deslocamento de UMA amostra de input
 * (`BODY_SPEED / BODY_INPUT_HZ` ≈ 7px), senão o corpo passa por cima do centro
 * do tile entre duas amostras, nunca "chega", e fica orbitando o waypoint.
 */
const WAYPOINT_RADIUS = Math.ceil(BODY_SPEED / BODY_INPUT_HZ) + 3

/**
 * Zona morta MÍNIMA do esterço: abaixo disso o eixo já conta como alinhado.
 *
 * O piso é mínimo porque a zona morta real acompanha o quanto o corpo anda por
 * amostra (ver `deadzone`): um alvo perseguido com passo maior que a tolerância
 * é sempre ultrapassado, e o corpo passa a tremer em volta do centro do
 * corredor a 30Hz, corrigindo para um lado e para o outro sem nunca acertar.
 */
const STEER_DEADZONE = 2

/** O que conta como "andou de fato" entre duas amostras (ver `stuckTicks`). */
const PROGRESS_EPSILON = 1.5

/**
 * Quanto tempo parado, ainda com a "tecla segurada", até dar o waypoint por
 * recusado. É o que substitui o `sync` do movimento de grade: no contínuo o
 * servidor não avisa mais passo a passo que recusou — ele só não deixa o corpo
 * passar, e quem anda descobre por não sair do lugar.
 */
const STUCK_MS = 600
const STUCK_TICKS = Math.ceil(STUCK_MS / (1000 / BODY_INPUT_HZ))

/**
 * Quantos waypoints podem ser recusados numa mesma caminhada antes de desistir.
 *
 * O recálculo já tira o tile recusado do grafo, então o normal é a rota nova
 * resolver na primeira ou segunda vez. Este teto existe para o caso em que o
 * grafo não tem como saber (kart que acabou de estacionar, corpo que não cabe
 * num tile cujo CENTRO está livre): sem ele, o personagem alternaria entre duas
 * rotas ruins para sempre.
 */
const MAX_REFUSALS = 8

export interface FollowPathRequest {
  /** `true` = terminar no próprio tile-alvo; `false` = parar adjacente. */
  exact: boolean
  /**
   * Tiles que o servidor recusou nesta caminhada. O cliente não conhece as
   * regras de entrada de sala (trancada, lotada, allowlist) — ele descobre
   * batendo —, então o que já foi recusado sai do grafo no próximo recálculo.
   */
  blocked: readonly TilePosition[]
  /** Alvo inalcançável: parar no tile alcançável mais próximo em vez de desistir. */
  fallback: 'none' | 'closest'
}

export interface FollowOptions {
  pathfinder?: (from: TilePosition, to: TilePosition, request: FollowPathRequest) => Direction[] | null
  /**
   * Segura (ou solta, com `null`) a "tecla" da caminhada automática.
   *
   * O Seguir não manda passo: no movimento contínuo não há passo, há intenção.
   * Quem transforma isto em deslocamento é a mesma amostragem de input do
   * teclado, na cena — um caminho só até o servidor, e ele passa pela predição.
   */
  steer: (dir: MoveDirection | null) => void
  /** Chegou adjacente ao alvo; `facing` é a direção para encará-lo. */
  onArrived: (facing: Direction) => void
  /** Não foi possível concluir (alvo saiu, sem caminho). */
  onFailed: (reason: 'target-left' | 'no-path') => void
  /** Lado do tile em pixel — a conversão pixel↔tile mora aqui dentro. */
  tileSize?: number
}

interface Ids {
  selfId: string
  targetId: string
}

interface Point {
  x: number
  y: number
}

/** A mesma composição de nome que o teclado faz em `OfficeScene.pressedMove`. */
function moveFor(dx: number, dy: number, deadzone: number): MoveDirection | null {
  const vertical = Math.abs(dy) <= deadzone ? '' : dy < 0 ? 'up' : 'down'
  const horizontal = Math.abs(dx) <= deadzone ? '' : dx < 0 ? 'left' : 'right'
  if (vertical && horizontal) return `${vertical}-${horizontal}` as MoveDirection
  return (vertical || horizontal || null) as MoveDirection | null
}

/**
 * Orquestra a caminhada automática (Seguir alguém, aceitar chamada, clique
 * direito, Ctrl/Cmd+D) até uma pessoa, uma mesa ou um ponto do mapa.
 *
 * O CAMINHO continua sendo Dijkstra sobre a grade de tiles — o mapa é de tiles,
 * e a grade é boa. O que mudou com o movimento livre é o que se faz com ele: em
 * vez de emitir um passo e esperar a confirmação de cada tile, o controlador
 * persegue os tiles do caminho como **waypoints**, esterçando o corpo para o
 * centro do próximo (`steer`) como se estivesse segurando a tecla.
 *
 * Ele raciocina em PIXEL de propósito: quem decide quando virar a esquina é a
 * posição contínua, não o tile. Posição do próprio vem da PREDIÇÃO local
 * (`onSelfBody`, na cadência do input) e não do snapshot: a predição é o que o
 * corpo está fazendo agora, e o snapshot chega um round-trip atrasado — esterçar
 * por ele faria o personagem virar depois da esquina. A dos OUTROS vem do
 * snapshot (`onOccupantMoved`), que é a única fonte que existe para eles.
 *
 * Classe pura: sem Phaser, sem React e sem relógio — o "tempo" é a própria
 * cadência de `onSelfBody`, que só corre enquanto a cena corre. Caminhada que
 * fica sem heartbeat (aba escondida, entrada travada, cena desmontada) apenas
 * para, em vez de seguir recalculando sozinha num timer.
 */
export class FollowController {
  private ids: Ids | null = null
  private self: Point = { x: 0, y: 0 }
  private target: Point = { x: 0, y: 0 }
  /** Tiles do caminho, em ordem — o último é onde a caminhada termina. */
  private path: TilePosition[] = []
  private index = 0
  /** `true` = anda até o próprio tile-alvo (clique no mapa); `false` = para adjacente (seguir pessoa/mesa). */
  private exact = false
  private fallback: FollowPathRequest['fallback'] = 'none'
  /** Tiles recusados pelo servidor nesta caminhada (ver `FollowPathRequest.blocked`). */
  private refused: TilePosition[] = []
  private refusedKeys = new Set<string>()
  /** Onde o corpo estava da última vez que andou de fato (ver `PROGRESS_EPSILON`). */
  private progressAnchor: Point = { x: 0, y: 0 }
  /** Quanto o corpo andou na última amostra — a base da zona morta (ver `deadzone`). */
  private lastStep = 0
  private stuckTicks = 0
  /** Recusas desta caminhada, CONTADAS (não as distintas): é o teto de insistência. */
  private refusals = 0
  /** Se algum trecho desta caminhada saiu do lugar — ver `fallback: 'closest'`. */
  private progressed = false
  /** Última direção entregue ao `steer`, para não repetir o mesmo pedido. */
  private steering: MoveDirection | null = null
  private tileSize: number

  constructor(private readonly opts: FollowOptions) {
    this.tileSize = opts.tileSize ?? TILE_SIZE
  }

  isActive(): boolean {
    return this.ids !== null
  }

  /**
   * Pathfinder e tamanho do tile chegam juntos porque vêm do mesmo lugar: o
   * documento do mapa, que carrega depois do primeiro render e pode ser trocado
   * (publicação, edição) no meio de uma caminhada.
   */
  configure(options: { pathfinder?: FollowOptions['pathfinder']; tileSize?: number }): void {
    this.opts.pathfinder = options.pathfinder
    this.tileSize = options.tileSize ?? TILE_SIZE
    if (this.ids) this.recalculate()
  }

  /**
   * Começa a caminhada. `self` e `target` são PIXEL — a unidade em que o
   * escritório fala desde o movimento livre (`OfficeOccupant.x/y`). Quem tem um
   * tile na mão (clique direito, mesa) manda o CENTRO dele.
   */
  start(
    ids: Ids,
    self: Point,
    target: Point,
    options: { exact?: boolean; fallback?: FollowPathRequest['fallback'] } = {},
  ): void {
    this.ids = ids
    this.self = { x: self.x, y: self.y }
    this.target = { x: target.x, y: target.y }
    this.exact = options.exact ?? false
    this.fallback = options.fallback ?? 'none'
    // O que foi recusado vale por caminhada: a sala pode ter destrancado, e a
    // próxima tentativa merece o mapa inteiro de novo.
    this.refused = []
    this.refusedKeys.clear()
    this.progressAnchor = { x: self.x, y: self.y }
    this.lastStep = 0
    this.stuckTicks = 0
    this.refusals = 0
    this.progressed = false
    this.recalculate()
  }

  /**
   * Posição PREVISTA do próprio, na cadência do input (`BODY_INPUT_HZ`).
   *
   * É o coração do controlador: cada chamada mede o progresso, avança os
   * waypoints já alcançados e reesterça. Também é o único "relógio" — é por
   * contagem de amostras sem progresso que a recusa do servidor é descoberta.
   */
  onSelfBody(x: number, y: number): void {
    if (!this.ids) return
    this.lastStep = distance(this.self, { x, y })
    this.self = { x, y }

    if (distance(this.self, this.progressAnchor) > PROGRESS_EPSILON) {
      this.progressAnchor = { x, y }
      this.stuckTicks = 0
      this.progressed = true
    } else {
      this.stuckTicks += 1
    }

    if (this.atTarget()) return this.arrive()

    // Parado com a tecla segurada: o corpo não passa por ali. Pode ser porta de
    // sala recusada (o servidor não avisa mais passo a passo), kart que acabou
    // de estacionar, ou um tile que o Dijkstra deu por livre porque só olha o
    // CENTRO e o corpo, que tem largura, não cabe. Nos três casos a resposta é a
    // mesma: aquele waypoint sai do grafo e a rota se refaz.
    if (this.stuckTicks >= STUCK_TICKS) {
      const waypoint = this.path[this.index]
      this.stuckTicks = 0
      if (waypoint) return this.refuse(waypoint)
      return this.recalculate()
    }

    this.advanceWaypoints()
    if (this.index >= this.path.length) return this.recalculate()
    this.steerToward(this.path[this.index]!)
  }

  /**
   * Snapshot: alguém andou. Só o ALVO interessa — a posição do próprio vem da
   * predição (`onSelfBody`), que é a mesma que o corpo está desenhando.
   *
   * Recalcula apenas quando o alvo troca de TILE: o caminho é de tiles, e
   * refazer Dijkstra a cada snapshot (20Hz) devolveria sempre a mesma rota.
   */
  onOccupantMoved(userId: string, x: number, y: number): void {
    if (!this.ids || userId !== this.ids.targetId) return
    const before = this.tileOf(this.target)
    this.target = { x, y }
    const after = this.tileOf(this.target)
    if (before.x !== after.x || before.y !== after.y) this.recalculate()
  }

  /**
   * O servidor recusou a entrada num tile (sala trancada, lotada, allowlist).
   *
   * Chega por `room-entry-denied`, que é o único aviso de recusa que sobreviveu
   * ao movimento livre — e é PRECISO, ao contrário do detector de travamento,
   * que precisa esperar `STUCK_MS` para concluir a mesma coisa.
   */
  refuseTile(tile: TilePosition): void {
    if (!this.ids) return
    this.refuse(tile)
  }

  onTargetLeft(userId: string): void {
    if (this.ids && userId === this.ids.targetId) {
      this.fail('target-left')
    }
  }

  /** Encerra a caminhada e SOLTA a tecla — sem isso o personagem seguiria andando. */
  cancel(): void {
    this.ids = null
    this.path = []
    this.index = 0
    this.stuckTicks = 0
    this.steer(null)
  }

  private refuse(tile: TilePosition): void {
    const key = `${tile.x},${tile.y}`
    if (!this.refusedKeys.has(key)) {
      this.refusedKeys.add(key)
      this.refused.push(tile)
    }
    // Conta a RECUSA, não o tile distinto: quando o mapa não tem como saber que
    // aquele tile é proibido, o recálculo devolve a mesma rota e a mesma porta
    // seria recusada para sempre. É o teto que transforma insistência em aviso.
    this.refusals += 1
    if (this.refusals > MAX_REFUSALS) return this.fail('no-path')
    this.recalculate()
  }

  /**
   * Consome os waypoints que o corpo já alcançou.
   *
   * Alcançar é chegar perto do CENTRO, não entrar no tile: quem vira a esquina
   * na borda raspa a quina, e o esterço diagonal a partir da borda empurraria o
   * corpo contra ela. Andar pelo meio do corredor é o que o caminho de tiles
   * quer dizer.
   *
   * A exceção é ter passado batido — o corpo já está no tile SEGUINTE do
   * caminho. Aí insistir no centro do anterior seria mandar voltar.
   */
  private advanceWaypoints(): void {
    const tile = this.tileOf(this.self)
    while (this.index < this.path.length) {
      const waypoint = this.path[this.index]!
      const next = this.path[this.index + 1]
      const reached = distance(this.self, this.centerOf(waypoint)) <= WAYPOINT_RADIUS
      const passed = next !== undefined && tile.x === next.x && tile.y === next.y
      if (!reached && !passed) break
      this.index += 1
    }
  }

  private recalculate(): void {
    if (!this.ids) return
    if (this.atTarget()) return this.arrive()
    const from = this.tileOf(this.self)
    const directions =
      this.opts.pathfinder?.(from, this.tileOf(this.target), {
        exact: this.exact,
        blocked: this.refused,
        fallback: this.fallback,
      }) ?? null
    if (directions === null) {
      // Com `fallback: 'closest'` o pathfinder já entregou o tile alcançável
      // mais perto; quando não há mais nada mais próximo E a pessoa saiu do
      // lugar, isso é chegada (foi o mais perto que dava), não falha.
      if (this.fallback === 'closest' && this.progressed) return this.arrive()
      return this.fail('no-path')
    }
    if (directions.length === 0) return this.arrive()
    this.path = tilesOfPath(from, directions)
    this.index = 0
    // Recalcular do tile em que já se está devolve o próprio tile como partida:
    // os waypoints alcançados saem agora, senão o esterço mandaria o corpo
    // VOLTAR ao centro do tile de onde acabou de sair.
    this.advanceWaypoints()
    if (this.index >= this.path.length) return this.arrive()
    this.steerToward(this.path[this.index]!)
  }

  private steerToward(tile: TilePosition): void {
    const center = this.centerOf(tile)
    this.steer(moveFor(center.x - this.self.x, center.y - this.self.y, this.deadzone()))
  }

  /**
   * Tolerância de alinhamento: nunca menor que o passo da última amostra.
   *
   * Sai medida, e não cravada, porque o passo muda — corrida (`sprint`), quadro
   * longo, aba que voltou do background. Cravada em pixel, bastaria correr para
   * o corpo voltar a tremer em volta do centro.
   */
  private deadzone(): number {
    return Math.max(STEER_DEADZONE, this.lastStep)
  }

  private steer(dir: MoveDirection | null): void {
    if (dir === this.steering) return
    this.steering = dir
    this.opts.steer(dir)
  }

  private atTarget(): boolean {
    const self = this.tileOf(this.self)
    const target = this.tileOf(this.target)
    if (this.exact) return self.x === target.x && self.y === target.y
    return Math.abs(self.x - target.x) + Math.abs(self.y - target.y) === 1
  }

  private arrive(): void {
    const facing = this.facingTarget()
    this.cancel()
    if (facing) this.opts.onArrived(facing)
  }

  private facingTarget(): Direction | null {
    const self = this.tileOf(this.self)
    const target = this.tileOf(this.target)
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      if (self.x + DIRECTION_DELTAS[dir].x === target.x && self.y + DIRECTION_DELTAS[dir].y === target.y) {
        return dir
      }
    }
    return null
  }

  private fail(reason: 'target-left' | 'no-path'): void {
    this.cancel()
    this.opts.onFailed(reason)
  }

  private tileOf(point: Point): TilePosition {
    return tileOfPixel(point, this.tileSize)
  }

  private centerOf(tile: TilePosition): Point {
    return { x: (tile.x + 0.5) * this.tileSize, y: (tile.y + 0.5) * this.tileSize }
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Direções do Dijkstra → tiles absolutos, que é o que o esterço persegue. */
function tilesOfPath(from: TilePosition, directions: readonly Direction[]): TilePosition[] {
  const tiles: TilePosition[] = []
  let current = from
  for (const dir of directions) {
    current = { x: current.x + DIRECTION_DELTAS[dir].x, y: current.y + DIRECTION_DELTAS[dir].y }
    tiles.push(current)
  }
  return tiles
}
