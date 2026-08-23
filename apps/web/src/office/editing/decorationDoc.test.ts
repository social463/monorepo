import { describe, expect, it } from 'vitest'
import {
  createEmptyMapDocumentV1,
  MAP_LIMITS,
  MapDocumentV1StructuralSchema,
  OFFICE_TILESET_CATALOG,
  validateMapDocumentV1,
  type MapDocumentV1,
  type MapObjectV1,
  type TileObjectV1,
} from '@legends/shared'
import {
  addRectObject,
  addTileObject,
  areaOverlays,
  addTileObjectAtPixel,
  addTileObjectGroupAtPixel,
  clampObjectTopLeft,
  ensureBuiltinTileset,
  flipGroupInPlace,
  flipOrientation,
  furnitureCollisionId,
  groupBounds,
  groupKeyOf,
  moveGroupTo,
  moveTileObject,
  orientationOf,
  pruneUnusedTilesets,
  removeDecorationObjectsInRect,
  removeGroup,
  removeObjectAt,
  removeObjectById,
  removeTopTileObjectAt,
  reorderFurnitureGroup,
  rotateGroupInPlace,
  rotateOrientation,
  stampTile,
  tileIndex,
  topCollisionAtPixel,
  topErasableObjectAtPixel,
  topTileObjectAtPixel,
  type TileOrientation,
} from './decorationDoc'

const base = (): MapDocumentV1 => {
  const doc = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
  return { ...doc, objects: [] }
}

describe('decorationDoc', () => {
  it('estampa e apaga tile na layer objects', () => {
    const d0 = base()
    const d1 = stampTile(d0, 'objects', 2, 3, 'ts:5')
    const layer = d1.layers.find((l) => l.key === 'objects')
    expect(layer?.type === 'tile' && layer.data[tileIndex(d1, 2, 3)]).toBe('ts:5')
    const d2 = stampTile(d1, 'objects', 2, 3, null)
    const layer2 = d2.layers.find((l) => l.key === 'objects')
    expect(layer2?.type === 'tile' && layer2.data[tileIndex(d2, 2, 3)]).toBeNull()
  })

  it('não muta o documento original ao estampar', () => {
    const d0 = base()
    const originalLayer = d0.layers.find((l) => l.key === 'objects')
    const originalData = originalLayer?.type === 'tile' ? originalLayer.data.slice() : null
    stampTile(d0, 'objects', 2, 3, 'ts:5')
    const afterLayer = d0.layers.find((l) => l.key === 'objects')
    expect(afterLayer?.type === 'tile' && afterLayer.data).toEqual(originalData)
    expect(afterLayer?.type === 'tile' && afterLayer.data[tileIndex(d0, 2, 3)]).toBeNull()
  })

  it('cria tileset builtin uma única vez', () => {
    const a = ensureBuiltinTileset(base(), OFFICE_TILESET_CATALOG[0].assetId)
    const b = ensureBuiltinTileset(a.doc, OFFICE_TILESET_CATALOG[0].assetId)
    expect(b.doc.tilesets.length).toBe(1)
    expect(b.tilesetId).toBe(a.tilesetId)
  })

  it('adiciona objeto de área', () => {
    const d = addRectObject(base(), {
      id: 'z1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 },
      properties: { name: 'Silêncio', accessPolicy: 'OPEN' },
    })
    expect(d.objects.some((o) => o.id === 'z1')).toBe(true)
  })

  it('remove o objeto de decoração mais recente cujo bbox contém o ponto, mantendo os demais', () => {
    const d0 = addRectObject(
      addRectObject(base(), {
        id: 'z1',
        layerKey: 'private-zones',
        type: 'private-zone',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 },
        properties: { name: 'Silêncio', accessPolicy: 'OPEN' },
      }),
      {
        id: 'z2',
        layerKey: 'private-zones',
        type: 'private-zone',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 },
        properties: { name: 'Foco', accessPolicy: 'OPEN' },
      },
    )
    const d1 = removeObjectAt(d0, 'private-zones', 10, 10)
    expect(d1.objects.filter((o) => o.layerKey === 'private-zones').map((o) => o.id)).toEqual(['z1'])
    expect(d0.objects.filter((o) => o.layerKey === 'private-zones').map((o) => o.id)).toEqual(['z1', 'z2'])
  })

  it('não remove nada quando nenhum objeto contém o ponto', () => {
    const d0 = addRectObject(base(), {
      id: 'z1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 },
      properties: { name: 'Silêncio', accessPolicy: 'OPEN' },
    })
    const d1 = removeObjectAt(d0, 'private-zones', 500, 500)
    expect(d1.objects.filter((o) => o.layerKey === 'private-zones').map((o) => o.id)).toEqual(['z1'])
  })

  it('empilha mobília na mesma célula, preservando a de baixo e a ordem', () => {
    const d0 = base()
    const d1 = addTileObject(d0, { id: 'o1', col: 2, row: 3, tilesetId: 'ts', tileIndex: 5, tileWidth: 48, tileHeight: 48 })
    const d2 = addTileObject(d1, { id: 'o2', col: 2, row: 3, tilesetId: 'ts', tileIndex: 9, tileWidth: 48, tileHeight: 48 })
    expect(d2.objects.map((o) => o.id)).toEqual(['o1', 'o2'])
    const stacked = d2.objects.filter((o) => o.type === 'tile-object')
    expect(stacked).toHaveLength(2)
    expect(stacked[0].geometry).toEqual({ kind: 'rectangle', x: 96, y: 144, width: 48, height: 48 })
  })

  describe('reorderFurnitureGroup', () => {
    const furniture = (id: string, layerKey = 'objects'): TileObjectV1 => ({
      id,
      layerKey,
      type: 'tile-object',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
      properties: { tilesetId: 'ts', tileIndex: 0 },
    })

    const visualIds = (doc: MapDocumentV1, layerKey = 'objects') =>
      doc.objects
        .filter((object) => object.type === 'tile-object' && object.layerKey === layerKey)
        .map((object) => object.id)

    it('sobe e desce exatamente um grupo visual', () => {
      const doc = {
        ...base(),
        objects: [furniture('a'), furniture('b'), furniture('c')],
      }

      const forward = reorderFurnitureGroup(doc, 'a', 'forward')
      expect(forward.changed).toBe(true)
      expect(visualIds(forward.doc)).toEqual(['b', 'a', 'c'])

      const backward = reorderFurnitureGroup(forward.doc, 'a', 'backward')
      expect(backward.changed).toBe(true)
      expect(visualIds(backward.doc)).toEqual(['a', 'b', 'c'])
    })

    it('leva o grupo para a frente ou para trás de tudo', () => {
      const doc = {
        ...base(),
        objects: [furniture('a'), furniture('b'), furniture('c')],
      }

      expect(visualIds(reorderFurnitureGroup(doc, 'a', 'front').doc)).toEqual(['b', 'c', 'a'])
      expect(visualIds(reorderFurnitureGroup(doc, 'c', 'back').doc)).toEqual(['c', 'a', 'b'])
    })

    it('mantém todos os slices do grupo juntos e na ordem interna', () => {
      const doc = {
        ...base(),
        objects: [
          furniture('mesa__0-0'),
          furniture('tapete'),
          furniture('mesa__1-0'),
          furniture('cadeira'),
        ],
      }

      const result = reorderFurnitureGroup(doc, 'mesa', 'front')
      expect(visualIds(result.doc)).toEqual(['tapete', 'cadeira', 'mesa__0-0', 'mesa__1-0'])
    })

    it('não move colisão pareada nem objetos não visuais', () => {
      const collision: MapObjectV1 = {
        id: furnitureCollisionId('mesa'),
        layerKey: 'collision',
        type: 'collision',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
        properties: {},
      }
      const zone: MapObjectV1 = {
        id: 'zona',
        layerKey: 'private-zones',
        type: 'private-zone',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
        properties: { name: 'Foco', accessPolicy: 'OPEN' },
      }
      const doc = {
        ...base(),
        objects: [furniture('mesa'), collision, zone, furniture('tapete')],
      }

      const result = reorderFurnitureGroup(doc, 'mesa', 'front')
      expect(result.doc.objects[1]).toBe(collision)
      expect(result.doc.objects[2]).toBe(zone)
      expect(result.doc.objects.map((object) => object.id)).toEqual(['tapete', 'mesa__collision', 'zona', 'mesa'])
    })

    it('isola a ordem por layer visual', () => {
      const doc = {
        ...base(),
        objects: [furniture('a'), furniture('overlay', 'custom'), furniture('b')],
      }

      const result = reorderFurnitureGroup(doc, 'a', 'front')
      expect(visualIds(result.doc)).toEqual(['b', 'a'])
      expect(visualIds(result.doc, 'custom')).toEqual(['overlay'])
      expect(result.doc.objects[1].id).toBe('overlay')
    })

    it('é no-op nas extremidades ou quando o grupo não existe', () => {
      const doc = {
        ...base(),
        objects: [furniture('a'), furniture('b')],
      }

      expect(reorderFurnitureGroup(doc, 'a', 'back')).toEqual({ doc, changed: false })
      expect(reorderFurnitureGroup(doc, 'b', 'front')).toEqual({ doc, changed: false })
      expect(reorderFurnitureGroup(doc, 'inexistente', 'forward')).toEqual({ doc, changed: false })
    })
  })

  it('não muta o documento original ao empilhar', () => {
    const d0 = base()
    addTileObject(d0, { id: 'o1', col: 0, row: 0, tilesetId: 'ts', tileIndex: 1, tileWidth: 48, tileHeight: 48 })
    expect(d0.objects).toHaveLength(0)
  })

  it('remove só a mobília do topo da célula, mantendo a de baixo', () => {
    let doc = base()
    doc = addTileObject(doc, { id: 'o1', col: 2, row: 3, tilesetId: 'ts', tileIndex: 5, tileWidth: 48, tileHeight: 48 })
    doc = addTileObject(doc, { id: 'o2', col: 2, row: 3, tilesetId: 'ts', tileIndex: 9, tileWidth: 48, tileHeight: 48 })
    const { doc: after, removed } = removeTopTileObjectAt(doc, 2, 3)
    expect(removed?.id).toBe('o2')
    expect(after.objects.map((o) => o.id)).toEqual(['o1'])
  })

  it('não remove mobília de outra célula', () => {
    const doc = addTileObject(base(), { id: 'o1', col: 2, row: 3, tilesetId: 'ts', tileIndex: 5, tileWidth: 48, tileHeight: 48 })
    const { doc: after, removed } = removeTopTileObjectAt(doc, 4, 4)
    expect(removed).toBeNull()
    expect(after).toBe(doc)
    expect(after.objects.map((o) => o.id)).toEqual(['o1'])
  })

  it('ignora objetos que não são tile-object ao remover o topo', () => {
    let doc = addTileObject(base(), { id: 'o1', col: 0, row: 0, tilesetId: 'ts', tileIndex: 5, tileWidth: 48, tileHeight: 48 })
    doc = addRectObject(doc, {
      id: 'z1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
      properties: { name: 'Silêncio', accessPolicy: 'OPEN' },
    })
    const { removed } = removeTopTileObjectAt(doc, 0, 0)
    expect(removed?.id).toBe('o1')
  })

  it('preserva tileset referenciado apenas por tile-object', () => {
    const doc = addTileObject(base(), { id: 'o1', col: 0, row: 0, tilesetId: 'builtin-x', tileIndex: 5, tileWidth: 48, tileHeight: 48 })
    const withTileset: typeof doc = {
      ...doc,
      tilesets: [{ id: 'builtin-x', assetId: 'a', name: 'X', tileWidth: 48, tileHeight: 48, columns: 4, tileCount: 16 }],
    }
    expect(pruneUnusedTilesets(withTileset).tilesets).toHaveLength(1)
  })
})

describe('pruneUnusedTilesets — poda seletiva do editor do admin', () => {
  const builtin48 = OFFICE_TILESET_CATALOG.filter((entry) => entry.tileWidth === 48)

  it('preserva o tileset recém-escolhido (`keep`), que ainda não pintou nada', () => {
    const { doc, tilesetId } = ensureBuiltinTileset(base(), builtin48[0].assetId)
    expect(pruneUnusedTilesets(doc, { keep: [tilesetId] }).tilesets.map((t) => t.id)).toEqual([tilesetId])
    expect(pruneUnusedTilesets(doc).tilesets).toHaveLength(0)
  })

  it('com `onlyBuiltin`, não some com um asset importado que ainda não foi usado', () => {
    const doc = base()
    const withUpload: MapDocumentV1 = {
      ...doc,
      tilesets: [
        { id: 'tileset-meu-png', assetId: 'asset-123', name: 'Meu PNG', tileWidth: 48, tileHeight: 48, columns: 4, tileCount: 16 },
        { id: 'builtin-x', assetId: builtin48[0].assetId, name: 'X', tileWidth: 48, tileHeight: 48, columns: 4, tileCount: 16 },
      ],
    }
    expect(pruneUnusedTilesets(withUpload, { onlyBuiltin: true }).tilesets.map((t) => t.id)).toEqual(['tileset-meu-png'])
  })

  it('folhear o catálogo inteiro não estoura o teto de tilesets do documento', () => {
    // Regressão: o editor do admin grava um tileset por escolha na paleta e não
    // removia nenhum — passado o `maxTilesets`, TODO autosave morria em 422
    // "A estrutura do documento é inválida".
    //
    // O documento parte JÁ no teto, cheio de builtins órfãos de outro tamanho
    // de tile (o resto de quem folheou a paleta antes da poda existir), para o
    // teste não depender de o catálogo ser maior que o limite: a primeira
    // escolha aqui empurraria o documento a `maxTilesets + 1`, e a poda tem que
    // devolvê-lo a UM tileset — o recém-escolhido — a cada passo.
    const orphans = OFFICE_TILESET_CATALOG.filter((entry) => entry.tileWidth === 32)
    let doc: MapDocumentV1 = {
      ...base(),
      tilesets: Array.from({ length: MAP_LIMITS.maxTilesets }, (_, index) => ({
        id: `builtin-folheado-${index}`,
        assetId: orphans[index % orphans.length].assetId,
        name: `Folheado ${index}`,
        tileWidth: 32,
        tileHeight: 32,
        columns: 4,
        tileCount: 16,
      })),
    }
    expect(MapDocumentV1StructuralSchema.safeParse(doc).success).toBe(true)
    for (const entry of builtin48) {
      const ensured = ensureBuiltinTileset(doc, entry.assetId)
      doc = pruneUnusedTilesets(ensured.doc, { keep: [ensured.tilesetId], onlyBuiltin: true })
      expect(MapDocumentV1StructuralSchema.safeParse(doc).success).toBe(true)
    }
    expect(doc.tilesets).toHaveLength(1)
  })

  it('mantém os tilesets que foram pintados enquanto o admin folheia', () => {
    const first = ensureBuiltinTileset(base(), builtin48[0].assetId)
    const painted = stampTile(first.doc, 'floor', 1, 1, `${first.tilesetId}:0`)
    const second = ensureBuiltinTileset(painted, builtin48[1].assetId)
    const after = pruneUnusedTilesets(second.doc, { keep: [second.tilesetId], onlyBuiltin: true })
    expect(after.tilesets.map((t) => t.id)).toEqual([first.tilesetId, second.tilesetId])
  })
})

describe('removeDecorationObjectsInRect (Task 5 — proteção em massa)', () => {
  const collisionAt = (id: string, x: number): MapObjectV1 => ({
    id,
    layerKey: 'collision',
    type: 'collision',
    geometry: { kind: 'rectangle', x, y: 0, width: 48, height: 48 },
    properties: {},
  })

  it('sem predicado (retrocompat), remove todos os objetos elegíveis que o retângulo cobre', () => {
    const d0 = addRectObject(addRectObject(base(), collisionAt('c1', 0)), collisionAt('c2', 48))
    const { doc, removed } = removeDecorationObjectsInRect(d0, { x: 0, y: 0, width: 96, height: 48 })
    expect(removed.map((o) => o.id)).toEqual(['c1', 'c2'])
    expect(doc.objects).toHaveLength(0)
  })

  it('com predicado de proteção, preserva o objeto protegido e remove só o restante', () => {
    const d0 = addRectObject(addRectObject(base(), collisionAt('admin-c', 0)), collisionAt('member-c', 48))
    const isProtected = (o: MapObjectV1) => o.id === 'admin-c'
    const { doc, removed } = removeDecorationObjectsInRect(d0, { x: 0, y: 0, width: 96, height: 48 }, isProtected)
    expect(removed.map((o) => o.id)).toEqual(['member-c'])
    expect(doc.objects.map((o) => o.id)).toEqual(['admin-c'])
  })

  it('quando tudo dentro do retângulo é protegido, não muta o documento (removed vazio)', () => {
    const d0 = addRectObject(base(), collisionAt('admin-c', 0))
    const { doc, removed } = removeDecorationObjectsInRect(d0, { x: 0, y: 0, width: 48, height: 48 }, () => true)
    expect(removed).toHaveLength(0)
    expect(doc).toBe(d0)
  })
})

describe('composição de orientação', () => {
  const zero: TileOrientation = { rotation: 0, flipX: false }

  it('girar quatro vezes volta ao original', () => {
    let o = zero
    for (let i = 0; i < 4; i++) o = rotateOrientation(o, 'cw')
    expect(o).toEqual(zero)
  })

  it('girar cw e ccw se cancelam', () => {
    expect(rotateOrientation(rotateOrientation(zero, 'cw'), 'ccw')).toEqual(zero)
  })

  it('espelhar duas vezes no mesmo eixo volta ao original', () => {
    const once = flipOrientation(zero, 'horizontal')
    expect(once).toEqual({ rotation: 0, flipX: true })
    expect(flipOrientation(once, 'horizontal')).toEqual(zero)
  })

  it('espelhar na vertical equivale a espelhar na horizontal e girar 180', () => {
    const start: TileOrientation = { rotation: 90, flipX: false }
    const vertical = flipOrientation(start, 'vertical')
    const manual = rotateOrientation(
      rotateOrientation(flipOrientation(start, 'horizontal'), 'cw'),
      'cw',
    )
    expect(vertical).toEqual(manual)
  })

  it('espelhar inverte o ângulo de um tile já rotacionado', () => {
    expect(flipOrientation({ rotation: 90, flipX: false }, 'horizontal')).toEqual({
      rotation: 270,
      flipX: true,
    })
  })

  it('lê a orientação implícita de um objeto sem os campos', () => {
    const object = {
      id: 'a',
      layerKey: 'objects',
      type: 'tile-object',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 16, height: 16 },
      properties: { tilesetId: 't', tileIndex: 0 },
    } as TileObjectV1
    expect(orientationOf(object)).toEqual(zero)
  })
})

// Mapa 10x10 de tile 48 ⇒ 480x480 px. Usado nos testes de posição livre.
const freeInput = (id: string, x: number, y: number) => ({
  id,
  x,
  y,
  tilesetId: 'ts',
  tileIndex: 5,
  tileWidth: 48,
  tileHeight: 48,
})

describe('decorationDoc — posição livre', () => {
  it('clampObjectTopLeft mantém a peça inteira dentro do mapa', () => {
    const doc = base()
    expect(clampObjectTopLeft(doc, 137, 20, 48, 48)).toEqual({ x: 137, y: 20 })
    expect(clampObjectTopLeft(doc, 1000, -5, 48, 48)).toEqual({ x: 432, y: 0 })
    expect(clampObjectTopLeft(doc, 12.6, 8.4, 48, 48)).toEqual({ x: 13, y: 8 })
  })

  it('addTileObjectAtPixel grava a geometria no pixel pedido (sem grade)', () => {
    const doc = addTileObjectAtPixel(base(), freeInput('o1', 137, 20))
    const obj = doc.objects.find((o) => o.id === 'o1')
    expect(obj?.geometry).toEqual({ kind: 'rectangle', x: 137, y: 20, width: 48, height: 48 })
    expect(obj?.type).toBe('tile-object')
    expect(obj && obj.type === 'tile-object' && obj.properties).toEqual({ tilesetId: 'ts', tileIndex: 5 })
  })

  it('addTileObjectAtPixel clampeia nas bordas e não muta o original', () => {
    const d0 = base()
    const doc = addTileObjectAtPixel(d0, freeInput('o1', 1000, -5))
    expect(doc.objects.find((o) => o.id === 'o1')?.geometry).toMatchObject({ x: 432, y: 0 })
    expect(d0.objects).toHaveLength(0)
  })

  it('moveTileObject reposiciona a peça (clampeado)', () => {
    const d0 = addTileObjectAtPixel(base(), freeInput('o1', 100, 100))
    const d1 = moveTileObject(d0, 'o1', 137, 20)
    expect(d1.objects.find((o) => o.id === 'o1')?.geometry).toMatchObject({ x: 137, y: 20 })
    const d2 = moveTileObject(d1, 'o1', 1000, 1000)
    expect(d2.objects.find((o) => o.id === 'o1')?.geometry).toMatchObject({ x: 432, y: 432 })
  })

  it('moveTileObject é no-op por identidade quando a posição não muda', () => {
    const d0 = addTileObjectAtPixel(base(), freeInput('o1', 100, 100))
    expect(moveTileObject(d0, 'o1', 100, 100)).toBe(d0)
    expect(moveTileObject(d0, 'inexistente', 5, 5)).toBe(d0)
  })

  it('topTileObjectAtPixel devolve o topo da pilha e null fora de qualquer peça', () => {
    let doc = addTileObjectAtPixel(base(), freeInput('o1', 0, 0))
    doc = addTileObjectAtPixel(doc, freeInput('o2', 20, 20))
    // ponto na sobreposição (30,30) cai nas duas ⇒ ganha a de cima (o2, mais recente)
    expect(topTileObjectAtPixel(doc, 30, 30)?.id).toBe('o2')
    // ponto só na o1 (5,5)
    expect(topTileObjectAtPixel(doc, 5, 5)?.id).toBe('o1')
    // ponto fora de tudo
    expect(topTileObjectAtPixel(doc, 400, 400)).toBeNull()
  })

  it('topErasableObjectAtPixel prioriza mobília sobre a zona sob o mesmo ponto', () => {
    let doc = addRectObject(base(), {
      id: 'z1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 },
      properties: { name: 'Silêncio', accessPolicy: 'OPEN' },
    })
    doc = addTileObjectAtPixel(doc, freeInput('o1', 0, 0))
    expect(topErasableObjectAtPixel(doc, 10, 10)?.id).toBe('o1')
    // ponto só na zona (fora da mobília 0..48): pega a zona
    expect(topErasableObjectAtPixel(doc, 80, 80)?.id).toBe('z1')
    // fora de tudo
    expect(topErasableObjectAtPixel(doc, 400, 400)).toBeNull()
  })

  // A borracha comum acha o móvel primeiro (teste acima). `topCollisionAtPixel`
  // é o caminho da ferramenta "Apagar colisão": ignora o que não é bloqueio.
  it('topCollisionAtPixel enxerga a colisão mesmo com mobília por cima', () => {
    let doc = addRectObject(base(), {
      id: 'col-1',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 },
      properties: {},
    })
    doc = addTileObjectAtPixel(doc, freeInput('o1', 0, 0))

    expect(topErasableObjectAtPixel(doc, 10, 10)?.id).toBe('o1')
    expect(topCollisionAtPixel(doc, 10, 10)?.id).toBe('col-1')
    expect(topCollisionAtPixel(doc, 400, 400)).toBeNull()
  })

  it('topCollisionAtPixel devolve a colisão do topo quando há duas sobrepostas', () => {
    let doc = addRectObject(base(), {
      id: 'col-baixo',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 },
      properties: {},
    })
    doc = addRectObject(doc, {
      id: 'col-topo',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
      properties: {},
    })
    expect(topCollisionAtPixel(doc, 10, 10)?.id).toBe('col-topo')
    // Fora da de cima, ainda dentro da de baixo.
    expect(topCollisionAtPixel(doc, 80, 80)?.id).toBe('col-baixo')
  })

  it('removeObjectById remove por identidade e devolve o objeto', () => {
    const d0 = addTileObjectAtPixel(base(), freeInput('o1', 0, 0))
    const { doc: d1, removed } = removeObjectById(d0, 'o1')
    expect(removed?.id).toBe('o1')
    expect(d1.objects).toHaveLength(0)
    const miss = removeObjectById(d0, 'nope')
    expect(miss.removed).toBeNull()
    expect(miss.doc).toBe(d0)
  })
})

describe('decorationDoc — grupo atômico', () => {
  // Cadeira fatiada 1x2: encosto (dr=0) + assento (dr=1).
  const chairTiles = [
    { dc: 0, dr: 0, tileIndex: 5 },
    { dc: 0, dr: 1, tileIndex: 9 },
  ]
  const addChair = (doc: MapDocumentV1, groupId: string, x: number, y: number) =>
    addTileObjectGroupAtPixel(doc, { groupId, x, y, tilesetId: 'ts', tileWidth: 48, tileHeight: 48, tiles: chairTiles })

  it('groupKeyOf extrai a chave do grupo; id sem grupo é o próprio (singleton)', () => {
    expect(groupKeyOf('grp-a__0-1')).toBe('grp-a')
    expect(groupKeyOf('obj-123')).toBe('obj-123')
  })

  it('addTileObjectGroupAtPixel coloca todos os slices na origem com os offsets internos', () => {
    const doc = addChair(base(), 'grp-a', 100, 100)
    const members = doc.objects.filter((o) => o.type === 'tile-object')
    expect(members.map((o) => o.id)).toEqual(['grp-a__0-0', 'grp-a__0-1'])
    expect(members[0].geometry).toMatchObject({ x: 100, y: 100, width: 48, height: 48 })
    expect(members[1].geometry).toMatchObject({ x: 100, y: 148, width: 48, height: 48 })
  })

  it('addTileObjectGroupAtPixel clampeia a BBOX do grupo (não cada slice)', () => {
    // grupo 48x96; canto inferior-direito do mapa 480x480 ⇒ origem (432, 384).
    const doc = addChair(base(), 'g', 1000, 1000)
    const members = doc.objects.filter((o) => o.type === 'tile-object')
    expect(members[0].geometry).toMatchObject({ x: 432, y: 384 })
    expect(members[1].geometry).toMatchObject({ x: 432, y: 432 })
  })

  it('groupBounds devolve a união dos slices e null para grupo inexistente', () => {
    const doc = addChair(base(), 'grp-a', 100, 100)
    expect(groupBounds(doc, 'grp-a')).toEqual({ x: 100, y: 100, width: 48, height: 96 })
    expect(groupBounds(doc, 'nope')).toBeNull()
  })

  it('moveGroupTo desloca todos os slices juntos, clampeado, e é no-op por identidade', () => {
    const doc = addChair(base(), 'grp-a', 100, 100)
    const moved = moveGroupTo(doc, 'grp-a', 200, 50)
    const m = moved.objects.filter((o) => o.type === 'tile-object')
    expect(m[0].geometry).toMatchObject({ x: 200, y: 50 })
    expect(m[1].geometry).toMatchObject({ x: 200, y: 98 })
    // clamp pela bbox do grupo
    const clamped = moveGroupTo(doc, 'grp-a', 1000, 1000)
    const c = clamped.objects.filter((o) => o.type === 'tile-object')
    expect(c[0].geometry).toMatchObject({ x: 432, y: 384 })
    // identidade quando a origem não muda
    expect(moveGroupTo(doc, 'grp-a', 100, 100)).toBe(doc)
    expect(moveGroupTo(doc, 'nope', 5, 5)).toBe(doc)
  })

  it('removeGroup remove todos os slices do grupo e devolve os removidos', () => {
    let doc = addChair(base(), 'grp-a', 100, 100)
    doc = addChair(doc, 'grp-b', 0, 0)
    const { doc: after, removed } = removeGroup(doc, 'grp-a')
    expect(removed.map((o) => o.id)).toEqual(['grp-a__0-0', 'grp-a__0-1'])
    expect(after.objects.filter((o) => o.type === 'tile-object').map((o) => o.id)).toEqual(['grp-b__0-0', 'grp-b__0-1'])
    const miss = removeGroup(after, 'nope')
    expect(miss.removed).toEqual([])
    expect(miss.doc).toBe(after)
  })

  it('topTileObjectAtPixel + groupKeyOf: qualquer slice identifica o grupo', () => {
    const doc = addChair(base(), 'grp-a', 100, 100)
    // ponto no assento (dr=1, y 148..196)
    const hit = topTileObjectAtPixel(doc, 110, 160)
    expect(hit && groupKeyOf(hit.id)).toBe('grp-a')
  })

  it('um grupo colocado passa na validação ESTRUTURAL real (ids/coords válidos)', () => {
    // Guard contra a classe de bug em que o id do slice usa um caractere que o
    // `MapIdentifierSchema` reprova (ex.: `:`), derrubando o save com
    // "estrutura do documento é inválida". O mock de save não pega isso — só a
    // validação real do contrato pega.
    const doc0 = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
    const withTileset: MapDocumentV1 = {
      ...doc0,
      objects: doc0.objects,
      tilesets: [{ id: 'ts', assetId: 'builtin:office/x', name: 'X', tileWidth: 48, tileHeight: 48, columns: 4, tileCount: 16 }],
    }
    const placed = addTileObjectGroupAtPixel(withTileset, {
      groupId: 'grp-abc-1',
      x: 137,
      y: 100,
      tilesetId: 'ts',
      tileWidth: 48,
      tileHeight: 48,
      tiles: chairTiles,
    })
    const result = validateMapDocumentV1(placed)
    expect(result.valid).toBe(true)
  })

  describe('colisão pareada (review PR 10555 — item "colisão")', () => {
    const addChairCollidable = (doc: MapDocumentV1, groupId: string, x: number, y: number) =>
      addTileObjectGroupAtPixel(doc, { groupId, x, y, tilesetId: 'ts', tileWidth: 48, tileHeight: 48, tiles: chairTiles, collidable: true })

    it('collidable: true acrescenta um objeto collision cobrindo a bbox inteira do grupo', () => {
      const doc = addChairCollidable(base(), 'grp-a', 100, 100)
      const collision = doc.objects.find((o) => o.type === 'collision' && o.id === furnitureCollisionId('grp-a'))
      expect(collision).toMatchObject({ geometry: { x: 100, y: 100, width: 48, height: 96 } })
      // groupKeyOf reconhece a colisão como parte do MESMO grupo dos slices —
      // é o que faz moveGroupTo/removeGroup pegarem os dois juntos.
      expect(collision && groupKeyOf(collision.id)).toBe('grp-a')
    })

    it('sem collidable (padrão), nenhum objeto collision é criado', () => {
      const doc = addChair(base(), 'grp-a', 100, 100)
      expect(doc.objects.some((o) => o.type === 'collision')).toBe(false)
    })

    it('moveGroupTo desloca a colisão pareada junto com os slices visuais', () => {
      const doc = addChairCollidable(base(), 'grp-a', 100, 100)
      const moved = moveGroupTo(doc, 'grp-a', 200, 50)
      const collision = moved.objects.find((o) => o.type === 'collision')
      expect(collision).toMatchObject({ geometry: { x: 200, y: 50, width: 48, height: 96 } })
    })

    it('removeGroup remove a colisão pareada junto com os slices visuais', () => {
      const doc = addChairCollidable(base(), 'grp-a', 100, 100)
      const { doc: after, removed } = removeGroup(doc, 'grp-a')
      expect(after.objects.some((o) => o.type === 'collision')).toBe(false)
      expect(removed.some((o) => o.type === 'collision')).toBe(true)
      expect(removed).toHaveLength(3) // 2 slices + 1 colisão
    })

    it('rotateGroupInPlace redimensiona/reposiciona a colisão pareada para a nova bbox', () => {
      const doc = addChairCollidable(base(), 'grp-a', 101, 101)
      const result = rotateGroupInPlace(doc, 'grp-a', 'cw')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const collision = result.doc.objects.find((o) => o.type === 'collision')
      // Mesma bbox nova calculada para os slices visuais (96x48 em vez de 48x96).
      expect(collision).toMatchObject({ geometry: { x: 77, y: 125, width: 96, height: 48 } })
    })
  })

  describe('rotateGroupInPlace', () => {
    it('gira 90° em torno do centro da bbox, trocando largura×altura e reorientando cada slice', () => {
      // Cadeira 1x2 (48x96) em posição LIVRE (não alinhada à grade de 48): o
      // grupo pode estar em qualquer pixel, só os offsets internos entre
      // slices (múltiplos de 48) importam.
      const doc = addChair(base(), 'grp-a', 101, 101)
      const result = rotateGroupInPlace(doc, 'grp-a', 'cw')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const members = result.doc.objects.filter((o): o is TileObjectV1 => o.type === 'tile-object')
      // Bbox 48x96 gira para 96x48, centrada no mesmo ponto: centro original
      // (101+24, 101+48) = (125, 149) ⇒ nova origem (125-48, 149-24) = (77, 125).
      expect(groupBounds(result.doc, 'grp-a')).toEqual({ x: 77, y: 125, width: 96, height: 48 })
      for (const member of members) {
        expect(orientationOf(member)).toEqual({ rotation: 90, flipX: false })
      }
    })

    it('quatro giros seguidos voltam exatamente à posição e orientação originais', () => {
      let doc = addChair(base(), 'grp-a', 101, 101)
      const originalBounds = groupBounds(doc, 'grp-a')
      for (let i = 0; i < 4; i++) {
        const result = rotateGroupInPlace(doc, 'grp-a', 'cw')
        expect(result.ok).toBe(true)
        if (!result.ok) return
        doc = result.doc
      }
      expect(groupBounds(doc, 'grp-a')).toEqual(originalBounds)
      for (const member of doc.objects.filter((o): o is TileObjectV1 => o.type === 'tile-object')) {
        expect(orientationOf(member)).toEqual({ rotation: 0, flipX: false })
      }
    })

    it('recusa girar se o resultado sair do mapa', () => {
      // Mapa 480x480; grupo encostado na borda direita — girar estoura.
      const doc = addChair(base(), 'grp-a', 432, 0)
      expect(rotateGroupInPlace(doc, 'grp-a', 'cw')).toEqual({ ok: false, reason: 'out-of-bounds' })
    })

    it('devolve empty para um grupo inexistente', () => {
      expect(rotateGroupInPlace(base(), 'nope', 'cw')).toEqual({ ok: false, reason: 'empty' })
    })
  })

  describe('flipGroupInPlace', () => {
    // Mesa 2x1 (dois slices lado a lado), diferente da cadeira 1x2 — precisa
    // de largura > 1 slice pra exercitar a troca de posição do espelhamento.
    const deskTiles = [
      { dc: 0, dr: 0, tileIndex: 1 },
      { dc: 1, dr: 0, tileIndex: 2 },
    ]
    const addDesk = (doc: MapDocumentV1, groupId: string, x: number, y: number) =>
      addTileObjectGroupAtPixel(doc, { groupId, x, y, tilesetId: 'ts', tileWidth: 48, tileHeight: 48, tiles: deskTiles })

    it('espelha na horizontal: troca as posições dos slices e não muda a bbox', () => {
      const doc = addDesk(base(), 'grp-a', 100, 100)
      const result = flipGroupInPlace(doc, 'grp-a', 'horizontal')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(groupBounds(result.doc, 'grp-a')).toEqual({ x: 100, y: 100, width: 96, height: 48 })
      const left = result.doc.objects.find((o) => o.id === 'grp-a__0-0') as TileObjectV1
      const right = result.doc.objects.find((o) => o.id === 'grp-a__1-0') as TileObjectV1
      // O slice que nasceu à esquerda (dc=0) agora ocupa a posição da direita.
      expect(left.geometry).toMatchObject({ x: 148, y: 100 })
      expect(right.geometry).toMatchObject({ x: 100, y: 100 })
      expect(orientationOf(left)).toEqual({ rotation: 0, flipX: true })
    })

    it('espelha na vertical: troca dr e não mexe na largura', () => {
      const doc = addChair(base(), 'grp-a', 101, 101)
      const result = flipGroupInPlace(doc, 'grp-a', 'vertical')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(groupBounds(result.doc, 'grp-a')).toEqual({ x: 101, y: 101, width: 48, height: 96 })
      const top = result.doc.objects.find((o) => o.id === 'grp-a__0-0') as TileObjectV1
      const bottom = result.doc.objects.find((o) => o.id === 'grp-a__0-1') as TileObjectV1
      expect(top.geometry).toMatchObject({ x: 101, y: 149 })
      expect(bottom.geometry).toMatchObject({ x: 101, y: 101 })
      expect(orientationOf(top)).toEqual({ rotation: 180, flipX: true })
    })

    it('não mexe na colisão pareada (bbox não muda)', () => {
      const doc = addTileObjectGroupAtPixel(base(), {
        groupId: 'grp-a',
        x: 100,
        y: 100,
        tilesetId: 'ts',
        tileWidth: 48,
        tileHeight: 48,
        tiles: deskTiles,
        collidable: true,
      })
      const result = flipGroupInPlace(doc, 'grp-a', 'horizontal')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const collision = result.doc.objects.find((o) => o.type === 'collision')
      expect(collision).toMatchObject({ geometry: { x: 100, y: 100, width: 96, height: 48 } })
    })

    it('devolve empty para um grupo inexistente', () => {
      expect(flipGroupInPlace(base(), 'nope', 'horizontal')).toEqual({ ok: false, reason: 'empty' })
    })
  })

  describe('areaOverlays', () => {
    const rect = (x: number, y: number) => ({ kind: 'rectangle' as const, x, y, width: 96, height: 48 })
    const areaDeskTiles = [
      { dc: 0, dr: 0, tileIndex: 1 },
      { dc: 1, dr: 0, tileIndex: 2 },
    ]

    it('lista silêncio, chamada e colisão com os bounds da geometria', () => {
      let doc = addRectObject(base(), {
        id: 'a-1',
        layerKey: 'private-zones',
        type: 'private-zone',
        geometry: rect(0, 0),
        properties: { name: 'Área de silêncio', accessPolicy: 'OPEN' },
      })
      doc = addRectObject(doc, {
        id: 'a-2',
        layerKey: 'meeting-rooms',
        type: 'meeting-room',
        geometry: rect(96, 0),
        properties: { externalKey: 'a-2', name: 'Sala de chamada', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
      })
      doc = addRectObject(doc, {
        id: 'a-3',
        layerKey: 'collision',
        type: 'collision',
        geometry: rect(0, 48),
        properties: {},
      })

      expect(areaOverlays(doc)).toEqual([
        { id: 'a-1', type: 'private-zone', rect: { x: 0, y: 0, width: 96, height: 48 } },
        { id: 'a-2', type: 'meeting-room', rect: { x: 96, y: 0, width: 96, height: 48 } },
        { id: 'a-3', type: 'collision', rect: { x: 0, y: 48, width: 96, height: 48 } },
      ])
    })

    it('ignora a colisão pareada da mobília — o sprite já é o sinal visual', () => {
      const doc = addTileObjectGroupAtPixel(base(), {
        groupId: 'grp-a',
        x: 100,
        y: 100,
        tilesetId: 'ts',
        tileWidth: 48,
        tileHeight: 48,
        tiles: areaDeskTiles,
        collidable: true,
      })
      expect(doc.objects.some((o) => o.type === 'collision')).toBe(true)
      expect(areaOverlays(doc)).toEqual([])
    })

    it('ignora mobília e pontos de link — só áreas retangulares entram', () => {
      const doc = addRectObject(addChair(base(), 'grp-a', 0, 0), {
        id: 'l-1',
        layerKey: 'links',
        type: 'link',
        geometry: { kind: 'point', x: 240, y: 240 },
        properties: { key: 'wiki', label: 'Wiki', url: 'https://example.com' },
      })
      expect(areaOverlays(doc)).toEqual([])
    })
  })
})
