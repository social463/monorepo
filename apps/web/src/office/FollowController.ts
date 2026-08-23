import { DIRECTION_DELTAS, type Direction, type TilePosition } from '@legends/shared'

/**
 * Quantos passos podem ser emitidos sem NENHUMA confirmação de posição antes de
 * desistir. Passo confirmado (`moved`) zera a contagem, então isso só dispara
 * quando a caminhada realmente travou — e é o que impede o personagem de ficar
 * batendo na mesma porta pra sempre quando o servidor recusa por um motivo que
 * o cliente não consegue prever nem aprender. Com `stepTimeoutMs` de 500ms, dá
 * ~6s de insistência antes do aviso.
 */
const MAX_STEPS_WITHOUT_PROGRESS = 12

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
  /** Envia um passo ao servidor (via bridge.emitClientMessage move). */
  emitMove: (dir: Direction) => void
  /** Chegou adjacente ao alvo; `facing` é a direção para encará-lo. */
  onArrived: (facing: Direction) => void
  /** Não foi possível concluir (alvo saiu, sem caminho). */
  onFailed: (reason: 'target-left' | 'no-path') => void
  setTimer: (cb: () => void, ms: number) => number
  clearTimer: (id: number) => void
  /** Tempo sem `moved` até reenviar o passo. O rate limit descarta em silêncio. */
  stepTimeoutMs?: number
}

interface Ids {
  selfId: string
  targetId: string
}

/**
 * Orquestra a caminhada automática até outro personagem. Servidor-autoritativo:
 * emite UM passo, espera o `moved` do próprio confirmar a posição esperada, e
 * só então avança. `sync` (parede) ou timeout (drop silencioso do rate limit)
 * → recalcula/reenvia. Alvo que anda → recalcula. Classe pura: relógio e timer
 * são injetados, sem Phaser nem React.
 */
export class FollowController {
  private ids: Ids | null = null
  private self: TilePosition = { x: 0, y: 0 }
  private target: TilePosition = { x: 0, y: 0 }
  private path: Direction[] = []
  private index = 0
  /** `true` = anda até o próprio tile-alvo (clique no mapa); `false` = para adjacente (seguir pessoa/mesa). */
  private exact = false
  private fallback: FollowPathRequest['fallback'] = 'none'
  /** Tile em que o passo já emitido deveria cair — a chave para reconhecer a recusa no `sync`. */
  private pendingStep: TilePosition | null = null
  /** Tiles recusados pelo servidor nesta caminhada (ver `FollowPathRequest.blocked`). */
  private refused: TilePosition[] = []
  private refusedKeys = new Set<string>()
  private stepsWithoutProgress = 0
  /** Se algum passo desta caminhada chegou a ser confirmado — ver `fallback: 'closest'`. */
  private progressed = false
  private timer: number | null = null
  private readonly stepTimeoutMs: number

  constructor(private readonly opts: FollowOptions) {
    this.stepTimeoutMs = opts.stepTimeoutMs ?? 500
  }

  isActive(): boolean {
    return this.ids !== null
  }

  setPathfinder(pathfinder: FollowOptions['pathfinder']): void {
    this.opts.pathfinder = pathfinder
    if (this.ids) this.recalculateAndStep()
  }

  start(
    ids: Ids,
    self: TilePosition,
    target: TilePosition,
    options: { exact?: boolean; fallback?: FollowPathRequest['fallback'] } = {},
  ): void {
    this.ids = ids
    this.self = { ...self }
    this.target = { ...target }
    this.exact = options.exact ?? false
    this.fallback = options.fallback ?? 'none'
    // O que foi recusado vale por caminhada: a sala pode ter destrancado, e a
    // próxima tentativa merece o mapa inteiro de novo.
    this.refused = []
    this.refusedKeys.clear()
    this.pendingStep = null
    this.stepsWithoutProgress = 0
    this.progressed = false
    this.recalculateAndStep()
  }

  /** Recebe TODOS os `moved`; filtra pelo self e pelo target internamente. */
  onMoved(userId: string, x: number, y: number, _dir: Direction): void {
    if (!this.ids) return
    if (userId === this.ids.selfId) {
      // Só avança "no índice" se (x,y) for exatamente o tile esperado (self atual +
      // a direção já emitida). Uma confirmação atrasada/fora de ordem (ex.: chegou
      // depois de um recálculo disparado pelo alvo andando nesse meio-tempo) não
      // corresponde mais ao `path`/`index` atuais — nesse caso re-ancora o self e
      // recalcula do zero, em vez de indexar cegamente um array que assume outra
      // posição de partida.
      const dir = this.path[this.index]
      const expected = dir
        ? { x: this.self.x + DIRECTION_DELTAS[dir].x, y: this.self.y + DIRECTION_DELTAS[dir].y }
        : null
      // Andou de fato: a caminhada está progredindo, então o contador de
      // insistência volta a zero.
      this.stepsWithoutProgress = 0
      this.pendingStep = null
      this.progressed = true
      if (expected && expected.x === x && expected.y === y) {
        this.self = { x, y }
        this.advance()
      } else {
        this.self = { x, y }
        this.recalculateAndStep()
      }
    } else if (userId === this.ids.targetId) {
      this.target = { x, y }
      this.recalculateAndStep()
    }
  }

  /**
   * `sync` só chega quando o servidor RECUSOU o passo (parede, kart, ou porta
   * de sala que o cliente não tem como prever). Se a posição não mudou, o tile
   * que o passo mirava está fechado para esta pessoa: ele sai do grafo, e o
   * recálculo procura outro caminho em vez de devolver a mesma rota.
   */
  onSync(x: number, y: number): void {
    if (!this.ids) return
    const step = this.pendingStep
    if (step && this.self.x === x && this.self.y === y) this.refuse(step)
    this.pendingStep = null
    this.self = { x, y }
    this.recalculateAndStep()
  }

  private refuse(tile: TilePosition): void {
    const key = `${tile.x},${tile.y}`
    if (this.refusedKeys.has(key)) return
    this.refusedKeys.add(key)
    this.refused.push(tile)
  }

  onTargetLeft(userId: string): void {
    if (this.ids && userId === this.ids.targetId) {
      this.fail('target-left')
    }
  }

  cancel(): void {
    this.stopTimer()
    this.ids = null
    this.path = []
    this.index = 0
    this.pendingStep = null
  }

  /** Avança um passo do caminho já calculado após um `moved` confirmar. */
  private advance(): void {
    this.stopTimer()
    this.index += 1
    if (this.index >= this.path.length) {
      // Caminho terminou: se estamos adjacentes, chegou; senão recalcula.
      if (this.atTarget()) return this.arrive()
      return this.recalculateAndStep()
    }
    this.emitStep()
  }

  private recalculateAndStep(): void {
    this.stopTimer()
    if (!this.ids) return
    if (this.atTarget()) return this.arrive()
    const path =
      this.opts.pathfinder?.(this.self, this.target, {
        exact: this.exact,
        blocked: this.refused,
        fallback: this.fallback,
      }) ?? null
    if (path === null) {
      // Com `fallback: 'closest'` o pathfinder já entregou o tile alcançável
      // mais perto; quando não há mais nada mais próximo E a pessoa saiu do
      // lugar, isso é chegada (foi o mais perto que dava), não falha.
      if (this.fallback === 'closest' && this.progressed) return this.arrive()
      return this.fail('no-path')
    }
    if (path.length === 0) return this.arrive()
    this.path = path
    this.index = 0
    this.emitStep()
  }

  private emitStep(): void {
    const dir = this.path[this.index]
    this.stepsWithoutProgress += 1
    if (this.stepsWithoutProgress > MAX_STEPS_WITHOUT_PROGRESS) return this.fail('no-path')
    const delta = DIRECTION_DELTAS[dir]
    this.pendingStep = { x: this.self.x + delta.x, y: this.self.y + delta.y }
    this.opts.emitMove(dir)
    this.timer = this.opts.setTimer(() => {
      // Nenhum `moved` chegou: rate limit descartou. Recalcula do ponto atual.
      this.recalculateAndStep()
    }, this.stepTimeoutMs)
  }

  private atTarget(): boolean {
    if (this.exact) return this.self.x === this.target.x && this.self.y === this.target.y
    return Math.abs(this.self.x - this.target.x) + Math.abs(this.self.y - this.target.y) === 1
  }

  private arrive(): void {
    const facing = this.facingTarget()
    this.cancel()
    if (facing) this.opts.onArrived(facing)
  }

  private facingTarget(): Direction | null {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      if (this.self.x + DIRECTION_DELTAS[dir].x === this.target.x &&
          this.self.y + DIRECTION_DELTAS[dir].y === this.target.y) {
        return dir
      }
    }
    return null
  }

  private fail(reason: 'target-left' | 'no-path'): void {
    this.cancel()
    this.opts.onFailed(reason)
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.opts.clearTimer(this.timer)
      this.timer = null
    }
  }
}
