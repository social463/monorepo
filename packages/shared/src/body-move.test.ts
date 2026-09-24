import { describe, expect, it } from 'vitest'
import type { MapDocumentV1 } from './index'
import {
  BODY_HALF_WIDTH,
  BODY_COLLISION_SUB,
  BODY_MAX_STEP_MS,
  BODY_SPAWN_CLEARANCE,
  BODY_SPAWN_SPACING,
  BODY_SPEED,
  BODY_SPRINT_FACTOR,
  bodyBlockedAt,
  bodySpawnPoint,
  bodyCollisionGrid,
  createEmptyMapDocumentV1,
  stepBody,
  stepBodyAmongBlockers,
  type BodyInput,
  type BodyState,
} from './index'

const TILE = 32

function room(): MapDocumentV1 {
  return createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: TILE })
}

/** Colisão em PIXEL, para poder cobrir meio tile. */
function wall(document: MapDocumentV1, x: number, y: number, width: number, height: number): void {
  document.objects.push({
    id: `wall-${x}-${y}-${width}-${height}`,
    layerKey: 'collision',
    type: 'collision',
    geometry: { kind: 'rectangle', x, y, width, height },
    properties: {},
  })
}

const at = (x: number, y: number): BodyState => ({ x, y, dir: 'down' })
const input = (dx: number, dy: number, dtMs = 16): BodyInput => ({ seq: 1, dx, dy, dtMs })

describe('bodyCollisionGrid', () => {
  // A regressão que justifica o arquivo existir: a grade do escritório amostra
  // o CENTRO do tile, e uma parede de meia célula deixa esse centro livre —
  // corpo contínuo atravessaria.
  it('pega parede que cobre só metade do tile (o centro do tile fica livre)', () => {
    const document = room()
    // Metade DIREITA do tile (5,5): x de 5*32+16 até 6*32.
    wall(document, 5 * TILE + TILE / 2, 5 * TILE, TILE / 2, TILE)
    const grid = bodyCollisionGrid(document)

    expect(bodyBlockedAt(grid, 5 * TILE + 24, 5 * TILE + 16)).toBe(true)
    // …e a metade esquerda do mesmo tile continua livre.
    expect(bodyBlockedAt(grid, 5 * TILE + 8, 5 * TILE + 16)).toBe(false)
  })

  it('fora do mapa é bloqueado — quem chama não checa limites', () => {
    const grid = bodyCollisionGrid(room())
    expect(bodyBlockedAt(grid, -1, 10)).toBe(true)
    expect(bodyBlockedAt(grid, 10, -1)).toBe(true)
    expect(bodyBlockedAt(grid, 20 * TILE + 1, 10)).toBe(true)
  })

  it('a resolução é a prometida: sub células por lado de tile', () => {
    const grid = bodyCollisionGrid(room())
    expect(grid.width).toBe(20 * BODY_COLLISION_SUB)
    expect(grid.cellWidth).toBe(TILE / BODY_COLLISION_SUB)
  })

  it('reusa a grade enquanto o array de objetos for o mesmo', () => {
    const document = room()
    expect(bodyCollisionGrid(document)).toBe(bodyCollisionGrid(document))
  })
})

describe('stepBody', () => {
  it('anda na velocidade combinada, e a pose segue a intenção', () => {
    const grid = bodyCollisionGrid(room())
    // `dt` dentro do teto: acima dele o passo é cortado de propósito (ver o
    // teste de tunneling), então medir velocidade com 1s mediria o teto.
    const next = stepBody(at(100, 100), input(1, 0, BODY_MAX_STEP_MS), grid)

    expect(next.x).toBeCloseTo(100 + (BODY_SPEED * BODY_MAX_STEP_MS) / 1000, 5)
    expect(next.y).toBe(100)
    expect(next.dir).toBe('right')
  })

  // Sem normalizar, a diagonal anda √2 (41%) mais rápido que o reto — o bug
  // clássico de oito direções, o mesmo que DIAGONAL_STEP_FACTOR trata na grade.
  it('a diagonal não anda mais rápido que o reto', () => {
    const grid = bodyCollisionGrid(room())
    const reto = stepBody(at(100, 100), input(1, 0, 100), grid)
    const torto = stepBody(at(100, 100), input(1, 1, 100), grid)

    const dReto = Math.hypot(reto.x - 100, reto.y - 100)
    const dTorto = Math.hypot(torto.x - 100, torto.y - 100)
    expect(dTorto).toBeCloseTo(dReto, 5)
  })

  it('desliza na parede em vez de grudar', () => {
    const document = room()
    wall(document, 6 * TILE, 0, TILE, 20 * TILE) // parede vertical inteira
    const grid = bodyCollisionGrid(document)

    // Encostado nela, andando na diagonal para baixo-direita: o X trava, o Y anda.
    const encostado = at(6 * TILE - BODY_HALF_WIDTH - 1, 100)
    const next = stepBody(encostado, input(1, 1, 100), grid)

    expect(next.x).toBeCloseTo(encostado.x, 5)
    expect(next.y).toBeGreaterThan(encostado.y)
  })

  it('não atravessa a parede com dt gigante (aba voltando do background)', () => {
    const document = room()
    wall(document, 6 * TILE, 0, TILE, 20 * TILE)
    const grid = bodyCollisionGrid(document)
    const antes = at(3 * TILE, 100)

    const next = stepBody(antes, { seq: 1, dx: 1, dy: 0, dtMs: 60_000 }, grid)

    // O teto do passo é o que impede o salto; o corpo para ANTES da parede.
    expect(next.x).toBeLessThan(6 * TILE)
    expect(next.x - antes.x).toBeLessThanOrEqual((BODY_SPEED * BODY_MAX_STEP_MS) / 1000 + 0.001)
  })

  it('não passa por vão mais estreito que o corpo', () => {
    const document = room()
    // Parede com uma fresta de 4px na altura y=100.
    wall(document, 6 * TILE, 0, TILE, 100 - 2)
    wall(document, 6 * TILE, 100 + 2, TILE, 20 * TILE)
    const grid = bodyCollisionGrid(document)

    let state = at(5 * TILE, 100)
    for (let i = 0; i < 60; i += 1) state = stepBody(state, input(1, 0, 16), grid)

    expect(state.x).toBeLessThan(6 * TILE)
  })

  // É esta propriedade que faz a reconciliação convergir: o cliente reexecuta
  // os inputs pendentes e tem que cair exatamente onde o servidor cairia.
  it('é determinística: mesma sequência de inputs, mesmo estado final', () => {
    const document = room()
    wall(document, 8 * TILE, 0, TILE, 12 * TILE)
    const grid = bodyCollisionGrid(document)
    const inputs: BodyInput[] = Array.from({ length: 40 }, (_, i) => ({
      seq: i + 1,
      dx: i % 3 === 0 ? 1 : 0.4,
      dy: i % 2 === 0 ? -1 : 0.8,
      dtMs: 16,
    }))
    const run = () => inputs.reduce((state, next) => stepBody(state, next, grid), at(100, 200))

    expect(run()).toEqual(run())
  })

  it('input parado não move nem troca a pose', () => {
    const grid = bodyCollisionGrid(room())
    const parado = { x: 100, y: 100, dir: 'left' as const }

    expect(stepBody(parado, input(0, 0), grid)).toEqual(parado)
  })

  // A corrida viaja no INPUT, e não como ajuste local: se o cliente corresse e
  // o servidor não, a reconciliação puxaria o personagem para trás a cada
  // snapshot — rubber-banding sempre que alguém segurasse Shift.
  it('Shift corre, e corre igual dos dois lados', () => {
    const grid = bodyCollisionGrid(room())
    const andando = stepBody(at(100, 100), { seq: 1, dx: 1, dy: 0, dtMs: 40 }, grid)
    const correndo = stepBody(at(100, 100), { seq: 1, dx: 1, dy: 0, dtMs: 40, sprint: true }, grid)

    expect(correndo.x - 100).toBeCloseTo((andando.x - 100) * BODY_SPRINT_FACTOR, 5)
  })

  it('a corrida também respeita a parede', () => {
    const document = room()
    wall(document, 6 * TILE, 0, TILE, 20 * TILE)
    const grid = bodyCollisionGrid(document)

    let state = at(5 * TILE, 100)
    for (let i = 0; i < 40; i += 1) {
      state = stepBody(state, { seq: i, dx: 1, dy: 0, dtMs: 16, sprint: true }, grid)
    }

    expect(state.x).toBeLessThan(6 * TILE)
  })

  // A arena não pode parecer arrastada em comparação com o escritório, que é
  // de onde a pessoa acabou de sair: lá o passo é um tile (32px) a cada 150ms.
  it('anda na mesma cadência do escritório', () => {
    // Inteiro, então bate a menos de 1 px/s do valor exato (213,33 e 426,67).
    expect(Math.abs(BODY_SPEED - 32 / 0.15)).toBeLessThanOrEqual(1)
    expect(Math.abs(BODY_SPEED * BODY_SPRINT_FACTOR - 32 / 0.075)).toBeLessThanOrEqual(1)
  })

  it('a velocidade é parâmetro da simulação, não constante escondida', () => {
    const grid = bodyCollisionGrid(room())
    const rapido = stepBody(at(100, 100), input(1, 0, 40), grid, { speed: BODY_SPEED * 2 })
    const normal = stepBody(at(100, 100), input(1, 0, 40), grid)

    expect(rapido.x - 100).toBeCloseTo((normal.x - 100) * 2, 5)
  })

  it('dt negativo não anda para trás', () => {
    const grid = bodyCollisionGrid(room())
    expect(stepBody(at(100, 100), { seq: 1, dx: 1, dy: 0, dtMs: -500 }, grid).x).toBe(100)
  })
})

describe('bodySpawnPoint', () => {
  // O spawn de um mapa desenhado para a GRADE costuma ser um vão de um tile
  // (porta, nicho). Confortável para quem anda centrado no tile; para um corpo
  // contínuo, é nascer entalado.
  it('sai do vão de um tile e acha folga perto', () => {
    const document = room()
    // Corredor vertical de UM tile em x=5, paredes dos dois lados.
    wall(document, 4 * TILE, 0, TILE, 20 * TILE)
    wall(document, 6 * TILE, 0, TILE, 20 * TILE)
    const grid = bodyCollisionGrid(document)

    const spawn = bodySpawnPoint(document, grid, { x: 5, y: 5 })

    // Saiu do corredor de um tile (qualquer lado serve — o que importa é a
    // folga, não a direção)…
    expect(spawn.x < 4 * TILE || spawn.x > 7 * TILE).toBe(true)
    // …e tem folga de verdade nos quatro sentidos.
    for (const d of [-1, 1]) {
      expect(bodyBlockedAt(grid, spawn.x + d * BODY_SPAWN_CLEARANCE, spawn.y)).toBe(false)
      expect(bodyBlockedAt(grid, spawn.x, spawn.y + d * BODY_SPAWN_CLEARANCE)).toBe(false)
    }
  })

  it('dentro do anel, escolhe o mais próximo — não a quina da varredura', () => {
    const document = room()
    // Só a coluna de tiles x=5 é livre em y=5; tudo mais no anel de raio 2 é
    // parede. O candidato lateral (7,5) e o da quina (7,3) estão no mesmo
    // anel, e o lateral é o mais perto.
    wall(document, 0, 0, 20 * TILE, 3 * TILE)
    const grid = bodyCollisionGrid(document)

    const spawn = bodySpawnPoint(document, grid, { x: 5, y: 4 })

    // O ponto escolhido não pode estar mais longe que qualquer vizinho válido.
    expect(spawn.y).toBeGreaterThanOrEqual(4 * TILE)
  })

  it('mapa aberto: respeita o spawn desenhado, sem procurar outro', () => {
    const document = room()
    const grid = bodyCollisionGrid(document)

    expect(bodySpawnPoint(document, grid, { x: 10, y: 10 })).toEqual({
      x: 10 * TILE + TILE / 2,
      y: 10 * TILE + TILE / 2,
    })
  })

  // Todo mundo nascendo no mesmo pixel deixa os personagens empilhados — e
  // quem entra jura que o outro não está lá.
  it('não nasce em cima de quem já está em campo', () => {
    const document = room()
    const grid = bodyCollisionGrid(document)
    const primeiro = bodySpawnPoint(document, grid, { x: 10, y: 10 })

    const segundo = bodySpawnPoint(document, grid, { x: 10, y: 10 }, [primeiro])

    expect(Math.hypot(segundo.x - primeiro.x, segundo.y - primeiro.y)).toBeGreaterThanOrEqual(
      BODY_SPAWN_SPACING,
    )
  })

  it('vários entrando em sequência ficam todos separados', () => {
    const document = room()
    const grid = bodyCollisionGrid(document)
    const pontos: { x: number; y: number }[] = []
    for (let i = 0; i < 6; i += 1) pontos.push(bodySpawnPoint(document, grid, { x: 10, y: 10 }, pontos))

    for (let i = 0; i < pontos.length; i += 1) {
      for (let k = i + 1; k < pontos.length; k += 1) {
        expect(Math.hypot(pontos[i].x - pontos[k].x, pontos[i].y - pontos[k].y)).toBeGreaterThanOrEqual(
          BODY_SPAWN_SPACING,
        )
      }
    }
  })

  it('o ponto escolhido é sempre um lugar onde o corpo cabe', () => {
    const document = room()
    wall(document, 0, 0, 9 * TILE, 20 * TILE)
    const grid = bodyCollisionGrid(document)

    const spawn = bodySpawnPoint(document, grid, { x: 2, y: 5 })

    expect(stepBody({ ...spawn, dir: 'down' }, input(0, 0), grid)).toMatchObject(spawn)
    expect(bodyBlockedAt(grid, spawn.x, spawn.y)).toBe(false)
  })
})

describe('stepBodyAmongBlockers', () => {
  const gradeLivre = () => bodyCollisionGrid(room())

  /** Um kart estacionado, como caixa de um tile. */
  const kart = (x: number, y: number) => ({ x, y, halfWidth: 16, halfHeight: 16 })

  it('sem bloqueio dinâmico, é exatamente o passo normal', () => {
    const grid = gradeLivre()
    const estado = { x: 100, y: 100, dir: 'right' as const }
    const entrada = { seq: 1, dx: 1, dy: 0, dtMs: 40 }
    expect(stepBodyAmongBlockers(estado, entrada, grid, [])).toEqual(
      stepBody(estado, entrada, grid),
    )
  })

  it('não atravessa um kart estacionado', () => {
    // A grade de colisão é rasterizada do documento PUBLICADO e memoizada — um
    // kart que alguém acabou de estacionar não está nela. Se o cliente não
    // soubesse dele, a predição atravessaria e o servidor puxaria de volta.
    const grid = gradeLivre()
    let estado: BodyState = { x: 100, y: 100, dir: 'right' }
    for (let seq = 1; seq <= 20; seq += 1) {
      estado = stepBodyAmongBlockers(estado, { seq, dx: 1, dy: 0, dtMs: 40 }, grid, [kart(160, 100)])
    }
    expect(estado.x).toBeLessThan(160 - 16)
  })

  it('desliza no kart em vez de grudar', () => {
    // Bater num kart tem de deslizar como bater numa parede: sem a retomada por
    // eixo ele vira armadilha, e quem só estava passando ao lado não entende
    // por que parou.
    const grid = gradeLivre()
    const antes = { x: 130, y: 100, dir: 'right' as const }
    const depois = stepBodyAmongBlockers(
      antes,
      { seq: 1, dx: 1, dy: 1, dtMs: 40 },
      grid,
      [kart(160, 100)],
    )
    expect(depois.y).toBeGreaterThan(antes.y)
  })

  it('encostado nos dois eixos, só a pose responde', () => {
    const grid = gradeLivre()
    const antes = { x: 130, y: 130, dir: 'down' as const }
    const depois = stepBodyAmongBlockers(
      antes,
      { seq: 1, dx: 1, dy: 1, dtMs: 40 },
      grid,
      [kart(155, 130), kart(130, 155)],
    )
    expect(depois.x).toBe(antes.x)
    expect(depois.y).toBe(antes.y)
    expect(depois.dir).toBe('right')
  })
})

describe('sair de dentro de um bloqueio', () => {
  const kart = (x: number, y: number) => ({ x, y, halfWidth: 16, halfHeight: 16 })

  it('quem está EM CIMA do bloqueio consegue sair', () => {
    // É a armadilha de desmontar: o kart estaciona exatamente onde o piloto
    // estava, as caixas se sobrepõem, e sem a guarda TODO passo seria recusado —
    // a pessoa ficaria presa em cima do próprio veículo.
    const grid = bodyCollisionGrid(room())
    const emCima = { x: 160, y: 160, dir: 'right' as const }
    const depois = stepBodyAmongBlockers(emCima, { seq: 1, dx: 1, dy: 0, dtMs: 40 }, grid, [kart(160, 160)])
    expect(depois.x).toBeGreaterThan(emCima.x)
  })

  it('…mas quem está FORA não entra: encosta e para', () => {
    // Sair é permitido; entrar, não — senão a guarda viraria licença para
    // atravessar kart. Aproximar-se é legítimo: o que não pode é as caixas se
    // sobreporem.
    const grid = bodyCollisionGrid(room())
    let corpo: BodyState = { x: 240, y: 160, dir: 'left' }
    for (let seq = 1; seq <= 20; seq += 1) {
      corpo = stepBodyAmongBlockers(corpo, { seq, dx: -1, dy: 0, dtMs: 40 }, grid, [kart(160, 160)])
    }
    // Borda direita do kart (176) mais a meia-largura do corpo (7).
    expect(corpo.x).toBeGreaterThanOrEqual(176 + BODY_HALF_WIDTH)
  })
})
