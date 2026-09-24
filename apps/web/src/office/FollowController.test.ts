import { describe, it, expect } from 'vitest'
import {
  BODY_INPUT_HZ,
  BODY_SPEED,
  MOVE_DIRECTION_DELTAS,
  createEmptyMapDocumentV1,
  findMapPath,
  officeWalkGrid,
  type Direction,
  type MapDocumentV1,
  type MoveDirection,
  type TilePosition,
} from '@legends/shared'
import { FollowController } from './FollowController'

const TILE = 32
/** O que o corpo anda em UMA amostra de input — a mesma conta do `stepBody`. */
const TICK_PX = BODY_SPEED / BODY_INPUT_HZ

const YOU = 'you'
const TARGET = 'alvo'

/** Centro do tile, que é a unidade em que o controlador fala (pixel). */
function center(tile: TilePosition): { x: number; y: number } {
  return { x: (tile.x + 0.5) * TILE, y: (tile.y + 0.5) * TILE }
}

function tileOf(point: { x: number; y: number }): TilePosition {
  return { x: Math.floor(point.x / TILE), y: Math.floor(point.y / TILE) }
}

/**
 * Um corpo de mentira que obedece ao esterço.
 *
 * Substitui o par `emitMove`/`onMoved` do movimento de grade: o controlador não
 * manda mais passo e não espera confirmação — ele segura uma direção, e é o
 * corpo andando (aqui, na mesma cadência e velocidade do `stepBody`) que
 * devolve a posição.
 */
function harness(
  start: TilePosition,
  options: { document?: MapDocumentV1; closed?: readonly TilePosition[] } = {},
) {
  const document = options.document ?? createEmptyMapDocumentV1({ width: 12, height: 12, tileSize: TILE })
  const closed = new Set((options.closed ?? []).map((tile) => `${tile.x},${tile.y}`))
  const steers: (MoveDirection | null)[] = []
  let steering: MoveDirection | null = null
  let arrived: Direction | null | undefined
  let failed: string | null = null
  const body = { ...center(start) }
  const grid = officeWalkGrid(document)

  const ctl = new FollowController({
    pathfinder: (from, to, request) => findMapPath(document, from, to, request),
    steer: (dir) => {
      steers.push(dir)
      steering = dir
    },
    onArrived: (facing) => {
      arrived = facing
    },
    onFailed: (reason) => {
      failed = reason
    },
    tileSize: TILE,
  })

  /** Um quadro: aplica o esterço ao corpo (com colisão) e devolve a posição. */
  function tick(): void {
    if (steering) {
      const delta = MOVE_DIRECTION_DELTAS[steering]
      // Diagonal normalizada, como o `stepBody` faz — senão andaria 41% mais.
      const scale = delta.x !== 0 && delta.y !== 0 ? TICK_PX / Math.SQRT2 : TICK_PX
      const next = { x: body.x + delta.x * scale, y: body.y + delta.y * scale }
      const tile = tileOf(next)
      const walkable =
        tile.x >= 0 &&
        tile.y >= 0 &&
        tile.x < document.map.width &&
        tile.y < document.map.height &&
        !closed.has(`${tile.x},${tile.y}`) &&
        grid.blocked[tile.y * grid.width + tile.x] === 0
      if (walkable) {
        body.x = next.x
        body.y = next.y
      }
    }
    ctl.onSelfBody(body.x, body.y)
  }

  return {
    ctl,
    body,
    steers,
    get steering() {
      return steering
    },
    get arrived() {
      return arrived
    },
    get failed() {
      return failed
    },
    tick,
    /** Anda até a caminhada terminar (ou até o teto, que é a rede contra loop). */
    walk(maxTicks = 400) {
      for (let i = 0; i < maxTicks && ctl.isActive(); i += 1) tick()
    },
    tileNow: () => tileOf(body),
  }
}

describe('FollowController: esterço', () => {
  it('segura a tecla ao iniciar, em vez de mandar passo', () => {
    const h = harness({ x: 3, y: 4 })
    h.ctl.start({ selfId: YOU, targetId: TARGET }, center({ x: 3, y: 4 }), center({ x: 8, y: 4 }))
    expect(h.steers).toEqual(['right'])
    // Andar não gera direção nova: a tecla já está segurada, e repetir o mesmo
    // pedido seria um pacote a mais por quadro.
    for (let i = 0; i < 5; i += 1) h.tick()
    expect(h.steers).toEqual(['right'])
  })

  it('chega adjacente ao alvo, SOLTA a tecla e encara-o', () => {
    const h = harness({ x: 3, y: 4 })
    h.ctl.start({ selfId: YOU, targetId: TARGET }, center({ x: 3, y: 4 }), center({ x: 8, y: 4 }))
    h.walk()
    expect(h.ctl.isActive()).toBe(false)
    expect(h.tileNow()).toEqual({ x: 7, y: 4 })
    // Soltar é o que impede o personagem de sair andando para sempre depois de
    // chegar — a "tecla" continuaria segurada.
    expect(h.steers[h.steers.length - 1]).toBeNull()
    expect(h.steering).toBeNull()
    expect(h.arrived).toBe('right')
  })

  it('já começa adjacente → não anda, encara e conclui sem nunca segurar a tecla', () => {
    const h = harness({ x: 7, y: 4 })
    h.ctl.start({ selfId: YOU, targetId: TARGET }, center({ x: 7, y: 4 }), center({ x: 8, y: 4 }))
    expect(h.steers).toEqual([])
    expect(h.ctl.isActive()).toBe(false)
    expect(h.arrived).toBe('right')
  })

  it('anda pelo MEIO do corredor: fora do centro, o esterço é diagonal até alinhar', () => {
    const h = harness({ x: 1, y: 5 })
    // Começa colado na borda de cima do tile, como quem parou de andar ali.
    const off = { x: center({ x: 1, y: 5 }).x, y: 5 * TILE + 3 }
    h.body.y = off.y
    h.ctl.start({ selfId: YOU, targetId: 'ponto:6,5' }, off, center({ x: 6, y: 5 }), { exact: true })
    expect(h.steers[0]).toBe('down-right')
    h.walk()
    // Alinhou no caminho: a última direção útil é reta, não diagonal.
    const uteis = h.steers.filter((dir): dir is MoveDirection => dir !== null)
    expect(uteis[uteis.length - 1]).toBe('right')
    expect(h.ctl.isActive()).toBe(false)
  })

  it('alvo andou → recalcula e termina adjacente à posição NOVA', () => {
    const h = harness({ x: 3, y: 4 })
    h.ctl.start({ selfId: YOU, targetId: TARGET }, center({ x: 3, y: 4 }), center({ x: 8, y: 4 }))
    for (let i = 0; i < 10; i += 1) h.tick()
    // O alvo subiu duas linhas; o snapshot é a única fonte da posição dele.
    h.ctl.onOccupantMoved(TARGET, center({ x: 8, y: 2 }).x, center({ x: 8, y: 2 }).y)
    h.walk()
    expect(h.ctl.isActive()).toBe(false)
    const tile = h.tileNow()
    expect(Math.abs(tile.x - 8) + Math.abs(tile.y - 2)).toBe(1)
  })

  it('snapshot do PRÓPRIO não move o alvo (a posição de quem anda vem da predição)', () => {
    const h = harness({ x: 3, y: 4 })
    h.ctl.start({ selfId: YOU, targetId: TARGET }, center({ x: 3, y: 4 }), center({ x: 8, y: 4 }))
    const antes = h.steers.length
    h.ctl.onOccupantMoved(YOU, 0, 0)
    expect(h.steers.length).toBe(antes)
    expect(h.ctl.isActive()).toBe(true)
  })

  it('alvo saiu do escritório → falha e solta a tecla', () => {
    const h = harness({ x: 3, y: 4 })
    h.ctl.start({ selfId: YOU, targetId: TARGET }, center({ x: 3, y: 4 }), center({ x: 8, y: 4 }))
    h.ctl.onTargetLeft(TARGET)
    expect(h.failed).toBe('target-left')
    expect(h.ctl.isActive()).toBe(false)
    expect(h.steers[h.steers.length - 1]).toBeNull()
  })

  it('cancel (tecla do humano) solta a tecla e ignora o que vier depois', () => {
    const h = harness({ x: 3, y: 4 })
    h.ctl.start({ selfId: YOU, targetId: TARGET }, center({ x: 3, y: 4 }), center({ x: 8, y: 4 }))
    h.ctl.cancel()
    expect(h.steers).toEqual(['right', null])
    expect(h.ctl.isActive()).toBe(false)
    h.ctl.onSelfBody(200, 144)
    expect(h.steers).toEqual(['right', null])
  })

  it('modo exato (clique direito): anda até o PRÓPRIO tile e não encara ninguém', () => {
    const h = harness({ x: 0, y: 0 })
    h.ctl.start({ selfId: YOU, targetId: 'ponto:4,0' }, center({ x: 0, y: 0 }), center({ x: 4, y: 0 }), {
      exact: true,
    })
    h.walk()
    expect(h.tileNow()).toEqual({ x: 4, y: 0 })
    expect(h.ctl.isActive()).toBe(false)
    // Em cima do alvo não há quem encarar: `onArrived` não dispara.
    expect(h.arrived).toBeUndefined()
    expect(h.steering).toBeNull()
  })

  it('modo exato falha de saída quando o tile-alvo está bloqueado', () => {
    const document = createEmptyMapDocumentV1({ width: 12, height: 12, tileSize: TILE })
    document.objects.push({
      id: 'collision-1',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 4 * TILE, y: 0, width: TILE, height: TILE },
      properties: {},
    })
    const h = harness({ x: 0, y: 0 }, { document })
    h.ctl.start({ selfId: YOU, targetId: 'ponto:4,0' }, center({ x: 0, y: 0 }), center({ x: 4, y: 0 }), {
      exact: true,
    })
    expect(h.failed).toBe('no-path')
    expect(h.ctl.isActive()).toBe(false)
  })

  it('clique em cima de um obstáculo caminha até o mais perto e considera chegada', () => {
    const document = createEmptyMapDocumentV1({ width: 12, height: 12, tileSize: TILE })
    document.objects.push({
      id: 'collision-alvo',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 5 * TILE, y: 5 * TILE, width: TILE, height: TILE },
      properties: {},
    })
    const h = harness({ x: 2, y: 5 }, { document })
    h.ctl.start({ selfId: YOU, targetId: 'ponto:5,5' }, center({ x: 2, y: 5 }), center({ x: 5, y: 5 }), {
      exact: true,
      fallback: 'closest',
    })
    h.walk()
    expect(h.failed).toBeNull()
    expect(h.ctl.isActive()).toBe(false)
    expect(h.tileNow()).toEqual({ x: 4, y: 5 })
  })
})

describe('FollowController: recusa do servidor', () => {
  /** Mapa 12×12 com uma parede na coluna 4 e duas passagens: (4,3) e (4,8). */
  function documentWithTwoDoors(): MapDocumentV1 {
    const document = createEmptyMapDocumentV1({ width: 12, height: 12, tileSize: TILE })
    const wall = (y: number, rows: number) => ({
      id: `collision-${y}`,
      layerKey: 'collision',
      type: 'collision' as const,
      geometry: { kind: 'rectangle' as const, x: 4 * TILE, y: y * TILE, width: TILE, height: rows * TILE },
      properties: {},
    })
    document.objects.push(wall(0, 3), wall(4, 4), wall(9, 3))
    return document
  }

  it('porta recusada: sem sair do lugar, o tile sai do grafo e a rota vai pela outra', () => {
    const document = documentWithTwoDoors()
    // O servidor deixa de fora a porta de cima (sala trancada) — o cliente não
    // tem como prever isso, e o `sync` que avisava passo a passo não existe mais.
    const h = harness({ x: 3, y: 3 }, { document, closed: [{ x: 4, y: 3 }] })
    h.ctl.start({ selfId: YOU, targetId: 'ponto:8,3' }, center({ x: 3, y: 3 }), center({ x: 8, y: 3 }), {
      exact: true,
    })
    expect(h.steers[0]).toBe('right')

    h.walk()
    // Chegou do outro lado, pela porta de baixo, sem ficar empurrando a de cima.
    expect(h.tileNow()).toEqual({ x: 8, y: 3 })
    expect(h.failed).toBeNull()
    expect(h.steers).toContain('down')
  })

  it('room-entry-denied replaneja na hora, sem esperar o detector de travamento', () => {
    const document = documentWithTwoDoors()
    const h = harness({ x: 3, y: 3 }, { document, closed: [{ x: 4, y: 3 }] })
    h.ctl.start({ selfId: YOU, targetId: 'ponto:8,3' }, center({ x: 3, y: 3 }), center({ x: 8, y: 3 }), {
      exact: true,
    })
    expect(h.steers).toEqual(['right'])

    h.ctl.refuseTile({ x: 4, y: 3 })
    // Uma mensagem só, e a rota já desce para a outra porta.
    expect(h.steers[h.steers.length - 1]).toBe('down')
    expect(h.ctl.isActive()).toBe(true)
  })

  it('recusa que nunca cede vira aviso, e a tecla é solta em vez de ficar presa', () => {
    const steers: (MoveDirection | null)[] = []
    let failed: string | null = null
    const ctl = new FollowController({
      // Pathfinder teimoso: sempre a mesma rota, como se o mapa não tivesse como
      // saber que aquele tile é proibido.
      pathfinder: () => ['right'],
      steer: (dir) => steers.push(dir),
      onArrived: () => {},
      onFailed: (reason) => {
        failed = reason
      },
      tileSize: TILE,
    })
    ctl.start({ selfId: YOU, targetId: 'ponto:9,1' }, center({ x: 1, y: 1 }), center({ x: 9, y: 1 }), {
      exact: true,
    })
    // Corpo travado: a posição nunca muda, por mais que a tecla siga segurada.
    const parado = center({ x: 1, y: 1 })
    for (let i = 0; i < 40 * BODY_INPUT_HZ && failed === null; i += 1) ctl.onSelfBody(parado.x, parado.y)

    expect(failed).toBe('no-path')
    expect(ctl.isActive()).toBe(false)
    expect(steers[steers.length - 1]).toBeNull()
  })
})
