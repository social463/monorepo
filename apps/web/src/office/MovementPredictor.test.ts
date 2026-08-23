import { describe, it, expect } from 'vitest'
import { createEmptyMapDocumentV1, type MapDocumentV1 } from '@legends/shared'
import { MovementPredictor } from './MovementPredictor'

const TILE_SIZE = 32

/**
 * Documento de mapa real (não o grid legado `OFFICE_MAP`) usado nos testes:
 * (1,1) é chão; (1,0) e (0,1) são parede (colisão); todo o resto é chão.
 */
function testMapDocument(): MapDocumentV1 {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: TILE_SIZE })
  document.objects = [
    {
      id: 'wall-1-0',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 1 * TILE_SIZE, y: 0 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE },
      properties: {},
    },
    {
      id: 'wall-0-1',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 0 * TILE_SIZE, y: 1 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE },
      properties: {},
    },
  ]
  return document
}

describe('MovementPredictor', () => {
  it("sem posição base (antes do welcome) → 'pass', sem estado novo", () => {
    const p = new MovementPredictor(testMapDocument())
    expect(p.predict('right')).toEqual({ kind: 'pass' })
    // Nada ficou pendente: um eco qualquer re-ancora em vez de "confirmar".
    expect(p.confirmMove(2, 1)).toBe(false)
  })

  it("passo andável → 'step' para o tile alvo, encadeando a partir do previsto", () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    expect(p.predict('right')).toEqual({ kind: 'step', x: 2, y: 1 })
    // O segundo passo parte do tile PREVISTO (2,1), não do confirmado (1,1).
    expect(p.predict('right')).toEqual({ kind: 'step', x: 3, y: 1 })
  })

  it('prevê o passo na diagonal', () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 5, y: 5 })

    expect(p.predict('down-right')).toEqual({ kind: 'step', x: 6, y: 6 })
  })

  // (1,0) e (0,1) são parede no mapa de teste: de (1,1) a diagonal para (0,0)
  // passaria raspando entre as duas. `canStepTo` exige as duas ortogonais, e a
  // predição precisa recusar igual ao servidor — senão o passo é previsto,
  // recusado, e a re-ancoragem vira teleporte.
  it("diagonal que cortaria quina → 'face', como no servidor", () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })

    expect(p.predict('up-left')).toEqual({ kind: 'face' })
    expect(p.predict('right')).toEqual({ kind: 'step', x: 2, y: 1 })
  })

  it("passo contra a parede → 'face', sem avançar a predição", () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    expect(p.predict('up')).toEqual({ kind: 'face' })
    // A parede não mudou a posição prevista: o próximo passo parte de (1,1).
    expect(p.predict('right')).toEqual({ kind: 'step', x: 2, y: 1 })
  })

  it('eco moved que confirma o passo previsto → true (cena não re-anima)', () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    p.predict('right')
    expect(p.confirmMove(2, 1)).toBe(true)
    // Confirmado vira a nova base.
    expect(p.predict('right')).toEqual({ kind: 'step', x: 3, y: 1 })
  })

  it('ecos confirmam em fila, um por passo previsto', () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    p.predict('right') // (2,1)
    p.predict('down') // (2,2)
    expect(p.confirmMove(2, 1)).toBe(true)
    expect(p.confirmMove(2, 2)).toBe(true)
  })

  it('eco moved fora da predição → false e re-ancora na posição do servidor', () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    p.predict('right') // previsto (2,1)
    // Servidor diz outra coisa (passo descartado antes, outra aba…).
    expect(p.confirmMove(1, 2)).toBe(false)
    // Predições pendentes foram descartadas; o próximo passo parte de (1,2).
    expect(p.predict('right')).toEqual({ kind: 'step', x: 2, y: 2 })
  })

  it("sync na posição confirmada → 'ignore', preservando passos ainda em voo", () => {
    // O cenário do glitch: encosta na parede (sync a caminho) e já anda para
    // um tile livre. O sync da parede NÃO pode desfazer o passo previsto.
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    expect(p.predict('up')).toEqual({ kind: 'face' }) // parede; o move ainda vai ao servidor
    p.predict('right') // passo previsto (2,1), em voo
    expect(p.confirmSync(1, 1)).toBe('ignore') // eco da parede: servidor ainda em (1,1)
    expect(p.confirmMove(2, 1)).toBe(true) // o passo em voo confirma normalmente
  })

  it("sync divergente → 'reanchor' e zera as predições", () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    p.predict('right') // previsto (2,1)
    expect(p.confirmSync(5, 5)).toBe('reanchor')
    // Base agora é a do servidor; (5,5) é chão e o passo parte dali.
    expect(p.predict('right')).toEqual({ kind: 'step', x: 6, y: 5 })
  })

  it("reset(null) volta ao estado sem base → 'pass'", () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    p.predict('right')
    p.reset(null)
    expect(p.predict('right')).toEqual({ kind: 'pass' })
  })

  it('kart estacionado à frente → \'face\' (mesma regra de colisão do servidor)', () => {
    // O bug: o servidor bloqueia o tile do kart, o cliente previa o passo e
    // andava "por cima" dele — a divergência acumulava até um snap de vários
    // tiles no primeiro eco divergente.
    const karts = new Map([['kart-1', { id: 'kart-1', x: 2, y: 1, dir: 'up' as const }]])
    const p = new MovementPredictor(testMapDocument(), { karts: () => [...karts.values()] })
    p.reset({ x: 1, y: 1 })

    expect(p.predict('right')).toEqual({ kind: 'face' })
    // Leitura VIVA: o kart sai (alguém montou) e o mesmo passo volta a valer.
    karts.set('kart-1', { id: 'kart-1', x: 2, y: 1, dir: 'up', riderUserId: 'ana' } as never)
    expect(p.predict('right')).toEqual({ kind: 'step', x: 2, y: 1 })
  })

  it("sync do passo recusado (mesmo seq) → 'reanchor', mesmo na posição base", () => {
    // Recusa que o cliente NÃO consegue prever (sala trancada, kart que chegou
    // no meio do caminho): sem o seq, `sync` na mesma posição parecia eco de
    // parede e o passo previsto ficava pendurado para sempre.
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    p.predict('right', 7)

    expect(p.confirmSync(1, 1, 7)).toBe('reanchor')
    // Predição descartada: o próximo passo parte de novo de (1,1).
    expect(p.predict('right', 8)).toEqual({ kind: 'step', x: 2, y: 1 })
  })

  it("sync de parede (seq sem predição) → 'ignore', preservando passos em voo", () => {
    const p = new MovementPredictor(testMapDocument())
    p.reset({ x: 1, y: 1 })
    expect(p.predict('up', 1)).toEqual({ kind: 'face' }) // parede: nada previsto
    p.predict('right', 2) // passo em voo

    expect(p.confirmSync(1, 1, 1)).toBe('ignore')
    expect(p.confirmMove(2, 1)).toBe(true)
  })

  it('predição sem confirmação expira e devolve a base para a cena re-ancorar', () => {
    // Rede de segurança do que some no caminho (passo descartado pelo rate
    // limit, pacote perdido): a divergência nunca acumula em silêncio.
    let now = 0
    const p = new MovementPredictor(testMapDocument(), { now: () => now })
    p.reset({ x: 1, y: 1 })
    p.predict('right')

    expect(p.pruneStale()).toBeNull() // ainda no ar
    now = 5_000
    expect(p.pruneStale()).toEqual({ x: 1, y: 1 })
    // Fila limpa: sem base velha pendurada e sem re-ancorar de novo.
    expect(p.pruneStale()).toBeNull()
    expect(p.predict('right')).toEqual({ kind: 'step', x: 2, y: 1 })
  })

  it('passo confirmado a tempo não expira', () => {
    let now = 0
    const p = new MovementPredictor(testMapDocument(), { now: () => now })
    p.reset({ x: 1, y: 1 })
    p.predict('right')
    p.confirmMove(2, 1)

    now = 5_000
    expect(p.pruneStale()).toBeNull()
  })

  it('usa o MapDocumentV1 real (não o grid legado OFFICE_MAP) para decidir colisão', () => {
    // (10,10) é parede NESTE documento (custom), mas seria chão no grid
    // legado — prova que a predição lê o mapa publicado, não o grid fixo.
    const document = testMapDocument()
    document.objects.push({
      id: 'wall-10-10',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 10 * TILE_SIZE, y: 10 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE },
      properties: {},
    })
    const p = new MovementPredictor(document)
    p.reset({ x: 9, y: 10 })
    expect(p.predict('right')).toEqual({ kind: 'face' })
  })
})
