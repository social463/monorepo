import { describe, expect, it } from 'vitest'
import {
  BODY_MAX_UNACKED_INPUTS,
  BODY_SPEED,
  bodyCollisionGrid,
  createEmptyMapDocumentV1,
  stepBody,
  stepBodyKart,
  type BodyCollisionGrid,
  type BodyInput,
  type BodyKartState,
  type BodyState,
  type MapDocumentV1,
} from '@legends/shared'
import { ArenaPredictor } from './ArenaPredictor'

const TILE = 32
function room(): MapDocumentV1 {
  return createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: TILE })
}
function wall(document: MapDocumentV1, x: number, y: number, w: number, h: number): void {
  document.objects.push({
    id: `wall-${x}-${y}`,
    layerKey: 'collision',
    type: 'collision',
    geometry: { kind: 'rectangle', x, y, width: w, height: h },
    properties: {},
  })
}
const at = (x: number, y: number): BodyState => ({ x, y, dir: 'down' })

describe('ArenaPredictor', () => {
  it('anda na hora, sem esperar o servidor', () => {
    const grid = bodyCollisionGrid(room())
    const predictor = new ArenaPredictor(at(100, 100), grid)

    predictor.predict(1, 0, 16)

    expect(predictor.current().x).toBeGreaterThan(100)
    expect(predictor.pendingCount()).toBe(1)
  })

  // O caso NORMAL: o servidor concorda. Reancorar e reexecutar os pendentes
  // tem que cair exatamente onde o cliente já estava — é o que torna a
  // correção invisível quando não há nada a corrigir.
  it('reconciliação com servidor de acordo não mexe um pixel', () => {
    const grid = bodyCollisionGrid(room())
    const inicio = at(100, 100)
    const predictor = new ArenaPredictor(inicio, grid)

    // O cliente manda cinco inputs; o servidor processou os dois primeiros.
    const inputs = Array.from({ length: 5 }, () => predictor.predict(1, 0.5, 16)!)
    const previsto = predictor.current()

    let servidor = inicio
    for (const input of inputs.slice(0, 2)) servidor = stepBody(servidor, input, grid)
    predictor.reconcile(servidor, inputs[1].seq)

    expect(predictor.current().x).toBeCloseTo(previsto.x, 6)
    expect(predictor.current().y).toBeCloseTo(previsto.y, 6)
    expect(predictor.pendingCount()).toBe(3)
  })

  // …e o caso em que ela DEVE aparecer: o servidor discordou (parede que o
  // cliente não viu). Aí o personagem é puxado para a verdade.
  it('quando o servidor discorda, a posição autoritativa vence', () => {
    const grid = bodyCollisionGrid(room())
    const predictor = new ArenaPredictor(at(100, 100), grid)
    const input = predictor.predict(1, 0, 16)!

    predictor.reconcile(at(50, 50), input.seq)

    expect(predictor.current()).toMatchObject({ x: 50, y: 50 })
    expect(predictor.pendingCount()).toBe(0)
  })

  it('inputs confirmados saem da fila; os novos continuam sendo reexecutados', () => {
    const grid = bodyCollisionGrid(room())
    const predictor = new ArenaPredictor(at(100, 100), grid)
    const a = predictor.predict(1, 0, 16)!
    predictor.predict(1, 0, 16)
    predictor.predict(1, 0, 16)

    predictor.reconcile(at(100, 100), a.seq)

    expect(predictor.pendingCount()).toBe(2)
    // Os dois pendentes foram reexecutados sobre a posição autoritativa.
    expect(predictor.current().x).toBeGreaterThan(100)
  })

  it('snapshot atrasado não puxa o personagem para trás', () => {
    const grid = bodyCollisionGrid(room())
    const predictor = new ArenaPredictor(at(100, 100), grid)
    const inputs = Array.from({ length: 4 }, () => predictor.predict(1, 0, 16)!)
    predictor.reconcile(at(120, 100), inputs[3].seq)
    const depois = predictor.current()

    // Um snapshot velho chegando fora de ordem: os inputs dele já foram
    // descartados, então aplicá-lo teleportaria o personagem para o passado.
    predictor.reconcile(at(100, 100), inputs[0].seq)

    expect(predictor.current()).toEqual(depois)
  })

  it('reexecutar respeita a colisão — não atravessa parede na correção', () => {
    const document = room()
    wall(document, 8 * TILE, 0, TILE, 20 * TILE)
    const grid = bodyCollisionGrid(document)
    const predictor = new ArenaPredictor(at(7 * TILE, 100), grid)

    for (let i = 0; i < 30; i += 1) predictor.predict(1, 0, 16)
    predictor.reconcile(at(7 * TILE, 100), 0)

    expect(predictor.current().x).toBeLessThan(8 * TILE)
  })

  it('a velocidade usada é a mesma passada ao servidor', () => {
    const grid = bodyCollisionGrid(room())
    const rapido = new ArenaPredictor(at(100, 100), grid, { speed: BODY_SPEED * 2 })
    const normal = new ArenaPredictor(at(100, 100), grid)

    rapido.predict(1, 0, 20)
    normal.predict(1, 0, 20)

    expect(rapido.current().x - 100).toBeCloseTo((normal.current().x - 100) * 2, 6)
  })

  // Fila de não confirmados sem teto = personagem andando indefinidamente para
  // um lugar que o servidor nunca autorizou, e teleporte de volta quando a
  // rede retorna. Parar é mais honesto que andar em falso.
  it('para de prever quando ninguém confirma', () => {
    const grid = bodyCollisionGrid(room())
    const predictor = new ArenaPredictor(at(100, 100), grid)

    for (let i = 0; i < BODY_MAX_UNACKED_INPUTS + 50; i += 1) predictor.predict(1, 0, 16)

    expect(predictor.pendingCount()).toBe(BODY_MAX_UNACKED_INPUTS)
    expect(predictor.isStalled()).toBe(true)
    expect(predictor.predict(1, 0, 16)).toBeNull()
  })

  it('volta a prever assim que o servidor confirma', () => {
    const grid = bodyCollisionGrid(room())
    const predictor = new ArenaPredictor(at(100, 100), grid)
    for (let i = 0; i < BODY_MAX_UNACKED_INPUTS; i += 1) predictor.predict(1, 0, 16)
    expect(predictor.isStalled()).toBe(true)

    predictor.reconcile(predictor.current(), BODY_MAX_UNACKED_INPUTS)

    expect(predictor.isStalled()).toBe(false)
    expect(predictor.predict(1, 0, 16)).not.toBeNull()
  })
})

describe('predição do kart', () => {
  const grid = bodyCollisionGrid(room())
  const kart = (over: Partial<BodyKartState> = {}): BodyKartState => ({
    x: 100,
    y: 100,
    dir: 'right',
    heading: 0,
    speed: 0,
    ...over,
  })

  /** O mesmo passo que o servidor roda — é o que faz os dois convergirem. */
  const passoDeKart = (grade: BodyCollisionGrid) => (
    state: BodyKartState,
    input: BodyInput,
    g: BodyCollisionGrid,
  ) => stepBodyKart(state, input, g ?? grade)

  it('prevê com o passo injetado, e o estado carrega rumo e velocidade', () => {
    // A razão de o preditor ser genérico: a corrida reexecuta `stepBodyKart`,
    // não `stepBody` — e um segundo preditor divergiria do primeiro.
    const predictor = new ArenaPredictor<BodyKartState>(kart(), grid, {}, passoDeKart(grid))
    predictor.predict(0, -1, 40)

    expect(predictor.current().speed).toBeGreaterThan(0)
    expect(predictor.current().x).toBeGreaterThan(100)
  })

  it('reancora no rumo e na velocidade do servidor', () => {
    // Sem rumo e velocidade na reancoragem, reexecutar os pendentes partiria de
    // um kart apontado para outro lado — e a correção viria como um tranco.
    const predictor = new ArenaPredictor<BodyKartState>(kart(), grid, {}, passoDeKart(grid))
    predictor.predict(0, -1, 40)
    predictor.predict(0, -1, 40)

    // Confirma só o PRIMEIRO: é o segundo, ainda pendente, que precisa ser
    // reexecutado a partir do rumo autoritativo (π = para a esquerda).
    predictor.reconcile(kart({ x: 300, y: 300, heading: Math.PI, speed: 200 }), 1)

    expect(predictor.current().x).toBeLessThan(300)
    expect(predictor.current().y).toBeCloseTo(300, 5)
    // |π|: `normalizeHeading` devolve a faixa [−π, π), e −π é o MESMO rumo.
    expect(Math.abs(predictor.current().heading)).toBeCloseTo(Math.PI, 5)
  })

  it('reexecutar os pendentes dá o mesmo que o servidor teria dado', () => {
    // A propriedade que faz a correção ser invisível: reexecutar sobre a posição
    // autoritativa cai exatamente onde o cliente já estava.
    const inicial = kart()
    const predictor = new ArenaPredictor<BodyKartState>(inicial, grid, {}, passoDeKart(grid))
    const inputs = [predictor.predict(1, -1, 40), predictor.predict(0, -1, 40)]
    const previsto = predictor.current()

    // O servidor processou o primeiro; o cliente reancora e reexecuta o resto.
    const autoritativo = stepBodyKart(inicial, inputs[0] as BodyInput, grid)
    predictor.reconcile(autoritativo, (inputs[0] as BodyInput).seq)

    expect(predictor.current().x).toBeCloseTo(previsto.x, 6)
    expect(predictor.current().heading).toBeCloseTo(previsto.heading, 6)
  })
})

describe('retomar a numeração depois de uma reconexão', () => {
  const grid = bodyCollisionGrid(room())
  it('resumeAt faz os inputs seguintes saírem ACIMA do que o servidor já processou', () => {
    // Onde a presença sobrevive a uma queda (o escritório), reconectar cria um
    // preditor novo. Começando do zero, todo input chegaria com `seq` menor que
    // o já processado e seria descartado como atrasado — a pessoa não sairia
    // mais do lugar.
    const predictor = new ArenaPredictor(at(100, 100), grid)
    predictor.resumeAt(57)

    expect(predictor.predict(1, 0, 33)?.seq).toBe(58)
  })

  it('não anda para trás: um valor menor é ignorado', () => {
    // Retroceder convidaria a reprocessar input já confirmado.
    const predictor = new ArenaPredictor(at(100, 100), grid)
    predictor.predict(1, 0, 33)
    predictor.predict(1, 0, 33)
    predictor.resumeAt(1)

    expect(predictor.predict(1, 0, 33)?.seq).toBe(3)
  })

  it('o que ficou pendente antes do salto não volta a ser reexecutado', () => {
    // `resumeAt` também move o `ack`: sem isso, um snapshot antigo reancoraria
    // o personagem numa posição que já não é dele.
    const predictor = new ArenaPredictor(at(100, 100), grid)
    predictor.predict(1, 0, 33)
    predictor.resumeAt(57)

    expect(predictor.pendingCount()).toBe(1)
    predictor.reconcile(at(200, 200), 57)
    expect(predictor.pendingCount()).toBe(0)
  })
})
