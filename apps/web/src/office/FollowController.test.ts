import { describe, it, expect } from 'vitest'
import {
  DIRECTION_DELTAS,
  createEmptyMapDocumentV1,
  findMapPath,
  findPath,
  isWalkable,
  type Direction,
  type TilePosition,
} from '@legends/shared'
import { FollowController } from './FollowController'

/** Relógio + timer controláveis para dirigir a máquina passo a passo. */
function harness() {
  const emitted: Direction[] = []
  let arrived: Direction | null | undefined
  let failed = false
  let pendingTimer: (() => void) | null = null
  const ctl = new FollowController({
    pathfinder: findPath,
    emitMove: (dir) => emitted.push(dir),
    onArrived: (facing) => { arrived = facing },
    onFailed: () => { failed = true },
    setTimer: (cb) => { pendingTimer = cb; return 1 },
    clearTimer: () => { pendingTimer = null },
    stepTimeoutMs: 500,
  })
  return {
    ctl,
    emitted,
    get arrived() { return arrived },
    get failed() { return failed },
    fireTimeout() { const cb = pendingTimer; pendingTimer = null; cb?.() },
    hasTimer() { return pendingTimer !== null },
  }
}

const YOU = 'you'
const TARGET = 'alvo'

describe('FollowController', () => {
  it('emite o primeiro passo ao iniciar e NÃO o segundo até o moved confirmar', () => {
    const h = harness()
    // você em (3,4), alvo em (8,4): caminho para a direita, parada adjacente (7,4)
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    expect(h.emitted).toEqual(['right'])

    // moved de OUTRO usuário não avança
    h.ctl.onMoved('outro', 4, 4, 'right')
    expect(h.emitted).toEqual(['right'])

    // moved do próprio, confirmando (4,4), libera o próximo passo
    h.ctl.onMoved(YOU, 4, 4, 'right')
    expect(h.emitted).toEqual(['right', 'right'])
  })

  it('chega adjacente ao alvo, encara-o e chama onArrived', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 6, y: 4 }, { x: 8, y: 4 })
    // um passo: de (6,4) para (7,4), que já é adjacente a (8,4)
    expect(h.emitted).toEqual(['right'])
    h.ctl.onMoved(YOU, 7, 4, 'right')
    expect(h.ctl.isActive()).toBe(false)
    expect(h.arrived).toBe('right') // encara o alvo à direita
  })

  it('já começa adjacente → não anda, encara e conclui', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 7, y: 4 }, { x: 8, y: 4 })
    expect(h.emitted).toEqual([])
    expect(h.ctl.isActive()).toBe(false)
    expect(h.arrived).toBe('right')
  })

  it('sync (parede) re-ancora e recalcula o caminho do ponto real', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    expect(h.emitted).toEqual(['right'])
    // servidor recusou: continua em (3,4). Recalcula e reemite a partir dali.
    h.ctl.onSync(3, 4)
    expect(h.emitted).toEqual(['right', 'right'])
  })

  it('timeout sem moved reenvia o passo (drop silencioso do rate limit)', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    expect(h.emitted).toEqual(['right'])
    expect(h.hasTimer()).toBe(true)
    h.fireTimeout() // nada chegou em 500ms
    expect(h.emitted).toEqual(['right', 'right'])
  })

  it('alvo se moveu → recalcula o caminho a partir da posição atual do seguidor', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    h.ctl.onMoved(YOU, 4, 4, 'right') // você avançou
    expect(h.emitted).toEqual(['right', 'right'])
    // o ALVO andou para cima; o destino muda
    h.ctl.onMoved(TARGET, 8, 3, 'up')
    // próximo moved seu segue o caminho recalculado (ainda para a direita/cima)
    h.ctl.onMoved(YOU, 5, 4, 'right')
    expect(h.emitted.length).toBeGreaterThan(2)
    expect(h.ctl.isActive()).toBe(true)
  })

  it('alvo saiu do escritório → falha e encerra', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    h.ctl.onTargetLeft(TARGET)
    expect(h.failed).toBe(true)
    expect(h.ctl.isActive()).toBe(false)
  })

  it('confirmação atrasada do próprio passo, chegando após o alvo se mover, não desalinha índice/posição (regressão)', () => {
    const h = harness()
    // você em (6,8) indo até perto de (11,8): primeiro passo 'right', ainda sem confirmação
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 6, y: 8 }, { x: 11, y: 8 })
    expect(h.emitted).toEqual(['right'])

    // ANTES da confirmação do seu passo, o alvo se move para longe (evento rotineiro).
    // Isso recalcula o caminho a partir do self ainda "stale" (6,8) e emite um novo passo.
    h.ctl.onMoved(TARGET, 1, 1, 'up')
    expect(h.emitted.length).toBe(2)

    // Chega agora a confirmação ATRASADA do passo original: você realmente foi de
    // (6,8) para (7,8) com o 'right' emitido antes do recálculo do alvo.
    let trueSelf: TilePosition = { x: 7, y: 8 }
    h.ctl.onMoved(YOU, trueSelf.x, trueSelf.y, 'right')

    // Daqui em diante, simula um servidor permissivo: sempre confirma exatamente o
    // passo emitido, aplicado à posição REAL (trueSelf). Se o controller ficou com o
    // índice fora de sincronia com o self, o próximo passo emitido vai tentar
    // atravessar uma mesa/parede a partir da posição real — isso é o "hop" errado.
    for (let i = 0; i < 30 && h.ctl.isActive(); i += 1) {
      const dir = h.emitted[h.emitted.length - 1]
      const next = { x: trueSelf.x + DIRECTION_DELTAS[dir].x, y: trueSelf.y + DIRECTION_DELTAS[dir].y }
      expect(isWalkable(next.x, next.y)).toBe(true)
      trueSelf = next
      h.ctl.onMoved(YOU, trueSelf.x, trueSelf.y, dir)
    }

    expect(h.failed).toBe(false)
    expect(h.arrived).toBeTruthy()
    // terminou adjacente ao alvo (que ficou em (1,1))
    expect(Math.abs(trueSelf.x - 1) + Math.abs(trueSelf.y - 1)).toBe(1)
  })

  it('modo exato (clique no mapa): anda até o próprio tile-alvo, não fica adjacente', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    const emitted: Direction[] = []
    let arrived: Direction | null | undefined
    const ctl = new FollowController({
      pathfinder: (from, to, request) => findMapPath(document, from, to, request),
      emitMove: (dir) => emitted.push(dir),
      onArrived: (facing) => { arrived = facing },
      onFailed: () => {},
      setTimer: () => 1,
      clearTimer: () => {},
    })
    ctl.start({ selfId: YOU, targetId: 'ponto:2,0' }, { x: 0, y: 0 }, { x: 2, y: 0 }, { exact: true })
    expect(emitted).toEqual(['right'])
    ctl.onMoved(YOU, 1, 0, 'right')
    expect(emitted).toEqual(['right', 'right'])
    ctl.onMoved(YOU, 2, 0, 'right')
    expect(ctl.isActive()).toBe(false)
    // exato = já está em cima do alvo, sem "encarar" ninguém: onArrived não dispara.
    expect(arrived).toBeUndefined()
  })

  it('modo exato falha quando o tile-alvo em si está bloqueado', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    document.objects.push({
      id: 'collision-1', layerKey: 'collision', type: 'collision',
      geometry: { kind: 'rectangle', x: 64, y: 0, width: 32, height: 32 }, properties: {},
    })
    let failed = false
    const ctl = new FollowController({
      pathfinder: (from, to, request) => findMapPath(document, from, to, request),
      emitMove: () => {},
      onArrived: () => {},
      onFailed: () => { failed = true },
      setTimer: () => 1,
      clearTimer: () => {},
    })
    ctl.start({ selfId: YOU, targetId: 'ponto:2,0' }, { x: 0, y: 0 }, { x: 2, y: 0 }, { exact: true })
    expect(failed).toBe(true)
    expect(ctl.isActive()).toBe(false)
  })

  it('cancel encerra e limpa o timer', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    expect(h.hasTimer()).toBe(true)
    h.ctl.cancel()
    expect(h.ctl.isActive()).toBe(false)
    expect(h.hasTimer()).toBe(false)
    // eventos após cancel são ignorados
    h.ctl.onMoved(YOU, 4, 4, 'right')
    expect(h.emitted).toEqual(['right'])
  })
})

describe('FollowController: recusa do servidor e desistência', () => {
  /** Mapa 12×12 com uma parede na coluna 4 e duas passagens: (4,3) e (4,8). */
  function documentWithTwoDoors() {
    const document = createEmptyMapDocumentV1({ width: 12, height: 12, tileSize: 32 })
    const wall = (y: number, rows: number) => ({
      id: `collision-${y}`, layerKey: 'collision', type: 'collision' as const,
      geometry: { kind: 'rectangle' as const, x: 128, y: y * 32, width: 32, height: rows * 32 },
      properties: {},
    })
    document.objects.push(wall(0, 3), wall(4, 4), wall(9, 3))
    return document
  }

  it('passo recusado tira o tile do grafo e a rota sai pela outra porta', () => {
    const document = documentWithTwoDoors()
    const emitted: Direction[] = []
    let failed = false
    const ctl = new FollowController({
      pathfinder: (from, to, request) => findMapPath(document, from, to, request),
      emitMove: (dir) => emitted.push(dir),
      onArrived: () => {},
      onFailed: () => { failed = true },
      setTimer: () => 1,
      clearTimer: () => {},
    })
    // De (3,3) o caminho mais curto é atravessar a porta (4,3).
    ctl.start({ selfId: YOU, targetId: 'ponto:8,3' }, { x: 3, y: 3 }, { x: 8, y: 3 }, { exact: true })
    expect(emitted).toEqual(['right'])

    // O servidor recusa o passo (sala trancada): `sync` na MESMA posição.
    ctl.onSync(3, 3)

    // Insistir na mesma porta seria 'right' de novo; a rota nova desce para (4,8).
    expect(emitted[1]).toBe('down')
    expect(failed).toBe(false)
    expect(ctl.isActive()).toBe(true)
  })

  it('recusa que nunca cede vira aviso em vez de tentativa infinita', () => {
    const emitted: Direction[] = []
    let failed: string | null = null
    const ctl = new FollowController({
      // Pathfinder teimoso: sempre a mesma rota, como se o mapa não tivesse
      // como saber que aquele tile é proibido.
      pathfinder: () => ['right'],
      emitMove: (dir) => emitted.push(dir),
      onArrived: () => {},
      onFailed: (reason) => { failed = reason },
      setTimer: () => 1,
      clearTimer: () => {},
    })
    ctl.start({ selfId: YOU, targetId: 'ponto:9,1' }, { x: 1, y: 1 }, { x: 9, y: 1 }, { exact: true })
    for (let i = 0; i < 30 && failed === null; i += 1) ctl.onSync(1, 1)

    expect(failed).toBe('no-path')
    expect(ctl.isActive()).toBe(false)
    expect(emitted.length).toBeLessThanOrEqual(13)
  })

  it('clique em cima de um obstáculo caminha até o mais perto e considera chegada', () => {
    const document = createEmptyMapDocumentV1({ width: 12, height: 12, tileSize: 32 })
    document.objects.push({
      id: 'collision-alvo', layerKey: 'collision', type: 'collision',
      geometry: { kind: 'rectangle', x: 160, y: 160, width: 32, height: 32 }, properties: {},
    })
    const emitted: Direction[] = []
    let failed = false
    const ctl = new FollowController({
      pathfinder: (from, to, request) => findMapPath(document, from, to, request),
      emitMove: (dir) => emitted.push(dir),
      onArrived: () => {},
      onFailed: () => { failed = true },
      setTimer: () => 1,
      clearTimer: () => {},
    })
    // (5,5) é o tile bloqueado; sem o fallback, `start` já falharia sem sair do lugar.
    ctl.start({ selfId: YOU, targetId: 'ponto:5,5' }, { x: 2, y: 5 }, { x: 5, y: 5 }, {
      exact: true,
      fallback: 'closest',
    })
    ctl.onMoved(YOU, 3, 5, 'right')
    ctl.onMoved(YOU, 4, 5, 'right')

    expect(emitted).toEqual(['right', 'right'])
    expect(failed).toBe(false)
    expect(ctl.isActive()).toBe(false)
  })
})
