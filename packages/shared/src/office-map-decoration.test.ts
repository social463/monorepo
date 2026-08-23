import { describe, expect, it } from 'vitest'
import { createEmptyMapDocumentV1, assertOnlyDecorationChanged, type MapDocumentV1 } from './index'

function clone(doc: MapDocumentV1): MapDocumentV1 { return JSON.parse(JSON.stringify(doc)) }
const base = () => createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })

describe('assertOnlyDecorationChanged', () => {
  it('aceita pintura em objects', () => {
    const prev = base(); const next = clone(prev)
    const layer = next.layers.find((l) => l.key === 'objects')
    if (layer?.type === 'tile') layer.data[0] = 'ts:0'
    expect(assertOnlyDecorationChanged(prev, next)).toEqual({ ok: true })
  })
  it('rejeita pintura em floor (piso é estrutural)', () => {
    const prev = base(); const next = clone(prev)
    const layer = next.layers.find((l) => l.key === 'floor')
    if (layer?.type === 'tile') layer.data[0] = 'ts:0'
    expect(assertOnlyDecorationChanged(prev, next).ok).toBe(false)
  })
  it('rejeita pintura em floor com o code/path corretos (não pode dizer "paredes")', () => {
    const prev = base(); const next = clone(prev)
    const layer = next.layers.find((l) => l.key === 'floor')
    if (layer?.type === 'tile') layer.data[0] = 'ts:0'
    const r = assertOnlyDecorationChanged(prev, next)
    expect(r.ok).toBe(false)
    expect((r as any).violations).toContainEqual({
      code: 'FLOOR_CHANGED',
      message: 'A layer de piso é estrutural',
      path: 'layers.floor.data',
    })
  })
  it('rejeita pintura em walls com o code/path corretos', () => {
    const prev = base(); const next = clone(prev)
    const layer = next.layers.find((l) => l.key === 'walls')
    if (layer?.type === 'tile') layer.data[0] = 'ts:0'
    const r = assertOnlyDecorationChanged(prev, next)
    expect(r.ok).toBe(false)
    expect((r as any).violations).toContainEqual({
      code: 'WALLS_CHANGED',
      message: 'A layer de paredes é estrutural',
      path: 'layers.walls.data',
    })
  })
  it('rejeita mudança simultânea em floor e walls com DUAS violações distintas', () => {
    const prev = base(); const next = clone(prev)
    const floor = next.layers.find((l) => l.key === 'floor')
    if (floor?.type === 'tile') floor.data[0] = 'ts:0'
    const walls = next.layers.find((l) => l.key === 'walls')
    if (walls?.type === 'tile') walls.data[1] = 'ts:0'
    const r = assertOnlyDecorationChanged(prev, next)
    expect(r.ok).toBe(false)
    const codes = (r as any).violations.map((v: any) => v.code).sort()
    expect(codes).toEqual(['FLOOR_CHANGED', 'WALLS_CHANGED'])
  })
  it('aceita adicionar collision, door, private-zone, link, action-point e tile-object', () => {
    const prev = base(); const next = clone(prev)
    next.objects.push({ id: 'c1', layerKey: 'collision', type: 'collision', geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 }, properties: {} })
    next.objects.push({ id: 'z1', layerKey: 'private-zones', type: 'private-zone', geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 }, properties: { name: 'Silêncio', accessPolicy: 'OPEN' } })
    next.objects.push({ id: 'd1', layerKey: 'interactive-objects', type: 'door', geometry: { kind: 'point', x: 0, y: 0 }, properties: { key: 'door1' } })
    next.objects.push({ id: 'l1', layerKey: 'interactive-objects', type: 'link', geometry: { kind: 'point', x: 0, y: 0 }, properties: { key: 'link1', label: 'Link', url: 'https://example.com' } })
    next.objects.push({ id: 'a1', layerKey: 'interactive-objects', type: 'action-point', geometry: { kind: 'point', x: 0, y: 0 }, properties: { key: 'ap1', label: 'Ação', actionKey: 'do-something' } })
    next.objects.push({ id: 't1', layerKey: 'objects', type: 'tile-object', geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 }, properties: { tilesetId: 'ts', tileIndex: 0 } })
    expect(assertOnlyDecorationChanged(prev, next)).toEqual({ ok: true })
  })
  it('rejeita mudança de dimensões e backgroundColor', () => {
    const prev = base(); const next = clone(prev); next.map.width = 21
    const r1 = assertOnlyDecorationChanged(prev, next)
    expect(r1.ok).toBe(false)
    const next2 = clone(prev); next2.map.backgroundColor = '#ffffff'
    expect(assertOnlyDecorationChanged(prev, next2).ok).toBe(false)
  })
  it('rejeita pintura em walls', () => {
    const prev = base(); const next = clone(prev)
    const walls = next.layers.find((l) => l.key === 'walls')
    if (walls?.type === 'tile') walls.data[0] = 'ts:0'
    expect(assertOnlyDecorationChanged(prev, next).ok).toBe(false)
  })
  it('rejeita pintura em uma SEGUNDA layer chaveada como walls (bypass de layer duplicada)', () => {
    const prev = base()
    const walls = prev.layers.find((l) => l.key === 'walls')
    if (walls?.type !== 'tile') throw new Error('walls layer ausente no fixture')
    const wallsDuplicate = { ...walls, id: 'walls-dup', data: [...walls.data] }
    prev.layers.push(wallsDuplicate)
    const next = clone(prev)
    const nextDuplicate = next.layers.find((l) => l.id === 'walls-dup')
    if (nextDuplicate?.type === 'tile') nextDuplicate.data[0] = 'ts:0'
    expect(assertOnlyDecorationChanged(prev, next).ok).toBe(false)
  })
  it('rejeita pintura na PRIMEIRA layer chaveada como walls quando a duplicada no fim fica intocada', () => {
    // Guarda contra uma comparação por key que só olhasse a ÚLTIMA layer
    // duplicada: aqui é a original (primeira no array) que muda, e a
    // duplicada no fim permanece idêntica — precisa ser detectado do mesmo jeito.
    const prev = base()
    const walls = prev.layers.find((l) => l.key === 'walls')
    if (walls?.type !== 'tile') throw new Error('walls layer ausente no fixture')
    const wallsDuplicate = { ...walls, id: 'walls-dup', data: [...walls.data] }
    prev.layers.push(wallsDuplicate)
    const next = clone(prev)
    const nextOriginal = next.layers.find((l) => l.key === 'walls' && l.id !== 'walls-dup')
    if (nextOriginal?.type === 'tile') nextOriginal.data[0] = 'ts:0'
    expect(assertOnlyDecorationChanged(prev, next).ok).toBe(false)
  })
  it('rejeita mover/adicionar spawn-point', () => {
    const prev = base(); const next = clone(prev)
    const spawn = next.objects.find((o) => o.type === 'spawn-point')
    if (spawn?.geometry.kind === 'point') spawn.geometry.x += 48
    expect(assertOnlyDecorationChanged(prev, next).ok).toBe(false)
  })
  it('rejeita add/remove/reorder de layer', () => {
    const prev = base(); const next = clone(prev)
    next.layers.push({ id: 'x', key: 'extra', name: 'Extra', type: 'tile', zIndex: 5, visible: true, locked: false, opacity: 1, data: Array.from({ length: 400 }, () => null) })
    expect(assertOnlyDecorationChanged(prev, next).ok).toBe(false)
  })
  it('rejeita alternar visible da layer walls (sem tocar em data)', () => {
    const prev = base(); const next = clone(prev)
    const walls = next.layers.find((l) => l.key === 'walls')
    if (walls) walls.visible = false
    expect(assertOnlyDecorationChanged(prev, next)).toEqual({ ok: false, violations: expect.any(Array) })
  })
})

function docWith(objects: any[]) {
  const doc: any = createEmptyMapDocumentV1()
  doc.objects = objects
  return doc
}
const adminObj = {
  id: 'a1', layerKey: 'objects', type: 'collision',
  geometry: { kind: 'rectangle', x: 0, y: 0, width: 32, height: 32 },
  properties: {}, createdBy: { id: 'admin', role: 'ADMIN' },
}
const memberObj = {
  id: 'm1', layerKey: 'objects', type: 'collision',
  geometry: { kind: 'rectangle', x: 64, y: 64, width: 32, height: 32 },
  properties: {}, createdBy: { id: 'bob', role: 'LEGEND' },
}

describe('assertOnlyDecorationChanged com ator', () => {
  it('comum NÃO pode remover objeto do admin', () => {
    const prev = docWith([adminObj])
    const next = docWith([])
    const r = assertOnlyDecorationChanged(prev, next, { isAdmin: false })
    expect(r.ok).toBe(false)
    expect((r as any).violations[0].code).toBe('PROTECTED_OBJECT_REMOVED')
  })

  it('comum NÃO pode modificar objeto do admin', () => {
    const prev = docWith([adminObj])
    const next = docWith([{ ...adminObj, geometry: { kind: 'rectangle', x: 5, y: 5, width: 32, height: 32 } }])
    const r = assertOnlyDecorationChanged(prev, next, { isAdmin: false })
    expect(r.ok).toBe(false)
    expect((r as any).violations[0].code).toBe('PROTECTED_OBJECT_MODIFIED')
  })

  it('comum PODE remover objeto de outro comum', () => {
    const prev = docWith([memberObj])
    const next = docWith([])
    expect(assertOnlyDecorationChanged(prev, next, { isAdmin: false }).ok).toBe(true)
  })

  it('comum PODE adicionar objeto', () => {
    const prev = docWith([])
    const next = docWith([memberObj])
    expect(assertOnlyDecorationChanged(prev, next, { isAdmin: false }).ok).toBe(true)
  })

  it('admin PODE remover objeto do admin', () => {
    const prev = docWith([adminObj])
    const next = docWith([])
    expect(assertOnlyDecorationChanged(prev, next, { isAdmin: true }).ok).toBe(true)
  })

  it('sem ator mantém comportamento antigo (só estrutural)', () => {
    const prev = docWith([adminObj])
    const next = docWith([])
    expect(assertOnlyDecorationChanged(prev, next).ok).toBe(true)
  })
})

import { mergeAdminDraft, mergeDecoration } from './office-map'
import type { MapObjectV1 } from './office-map'

function tileObj(id: string, x: number, y: number, tileIndex = 0): MapObjectV1 {
  return {
    id,
    layerKey: 'objects',
    type: 'tile-object',
    geometry: { kind: 'rectangle', x, y, width: 32, height: 32 },
    properties: { tilesetId: 'builtin', tileIndex },
  } as MapObjectV1
}

function doc(objects: MapObjectV1[], objectsLayerData?: (string | null)[]): MapDocumentV1 {
  return {
    schemaVersion: '1',
    map: { width: 10, height: 10, tileWidth: 32, tileHeight: 32 },
    tilesets: [{ id: 'builtin', name: 'builtin', tileWidth: 32, tileHeight: 32, columns: 1, tileCount: 1, source: { kind: 'builtin', key: 'builtin' } }],
    layers: objectsLayerData
      ? [
          {
            id: 'layer-objects',
            key: 'objects',
            name: 'Objetos',
            type: 'tile',
            zIndex: 20,
            visible: true,
            locked: false,
            opacity: 1,
            data: objectsLayerData,
          },
        ]
      : [],
    objects,
  } as unknown as MapDocumentV1
}

describe('mergeDecoration', () => {
  it('mantém adições de ambos os editores (ids distintos coexistem)', () => {
    const base = doc([tileObj('a', 0, 0)])
    const mine = doc([tileObj('a', 0, 0), tileObj('mine-1', 32, 0)])
    const theirs = doc([tileObj('a', 0, 0), tileObj('their-1', 64, 0)])
    const merged = mergeDecoration(base, mine, theirs)
    const ids = merged.objects.map((o) => o.id)
    expect(ids).toEqual(['a', 'their-1', 'mine-1'])
  })

  it('aplica minha remoção sobre theirs', () => {
    const base = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])
    const mine = doc([tileObj('a', 0, 0)]) // removi 'b'
    const theirs = doc([tileObj('a', 0, 0), tileObj('b', 32, 0), tileObj('c', 64, 0)])
    const merged = mergeDecoration(base, mine, theirs)
    expect(merged.objects.map((o) => o.id)).toEqual(['a', 'c'])
  })

  it('minha alteração vence quando eu alterei o mesmo objeto (último a salvar)', () => {
    const base = doc([tileObj('a', 0, 0, 0)])
    const mine = doc([tileObj('a', 96, 0, 0)]) // movi 'a'
    const theirs = doc([tileObj('a', 0, 0, 5)]) // outro mudou o tileIndex de 'a'
    const merged = mergeDecoration(base, mine, theirs)
    const a = merged.objects.find((o) => o.id === 'a')!
    expect(a.geometry).toMatchObject({ x: 96 })
  })

  it('preserva objetos intocados por mim vindos de theirs', () => {
    const base = doc([tileObj('a', 0, 0)])
    const mine = doc([tileObj('a', 0, 0)])
    const theirs = doc([tileObj('a', 0, 0), tileObj('their-1', 32, 0)])
    const merged = mergeDecoration(base, mine, theirs)
    expect(merged.objects.map((o) => o.id)).toContain('their-1')
  })

  it('persiste minha reordenação visual de objetos existentes', () => {
    const base = doc([tileObj('tapete', 0, 0), tileObj('mesa', 0, 0)])
    const mine = doc([tileObj('mesa', 0, 0), tileObj('tapete', 0, 0)])
    const theirs = doc([tileObj('tapete', 0, 0), tileObj('mesa', 0, 0)])

    const merged = mergeDecoration(base, mine, theirs)

    expect(merged.objects.map((o) => o.id)).toEqual(['mesa', 'tapete'])
  })

  it('preserva adição concorrente de theirs ao aplicar minha reordenação', () => {
    const base = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])
    const mine = doc([tileObj('b', 32, 0), tileObj('a', 0, 0)])
    const theirs = doc([tileObj('a', 0, 0), tileObj('b', 32, 0), tileObj('their-1', 64, 0)])

    const merged = mergeDecoration(base, mine, theirs)

    expect(merged.objects.map((o) => o.id)).toEqual(['b', 'a', 'their-1'])
  })

  it('não desfaz uma reordenação de theirs quando mine manteve a ordem base', () => {
    const base = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])
    const mine = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])
    const theirs = doc([tileObj('b', 32, 0), tileObj('a', 0, 0)])

    const merged = mergeDecoration(base, mine, theirs)

    expect(merged.objects.map((o) => o.id)).toEqual(['b', 'a'])
  })

  it('persiste objeto novo que foi enviado para trás antes do primeiro save', () => {
    const base = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])
    const mine = doc([tileObj('novo', 64, 0), tileObj('a', 0, 0), tileObj('b', 32, 0)])
    const theirs = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])

    const merged = mergeDecoration(base, mine, theirs)

    expect(merged.objects.map((o) => o.id)).toEqual(['novo', 'a', 'b'])
  })

  it('usa estrutura (map/layers) de theirs e une tilesets', () => {
    const base = doc([])
    const mine = { ...doc([]), tilesets: [...doc([]).tilesets, { id: 'extra', name: 'extra', tileWidth: 32, tileHeight: 32, columns: 1, tileCount: 1, source: { kind: 'builtin', key: 'extra' } }] } as MapDocumentV1
    const theirs = { ...doc([]), map: { width: 20, height: 20, tileWidth: 32, tileHeight: 32 } } as MapDocumentV1
    const merged = mergeDecoration(base, mine, theirs)
    expect(merged.map.width).toBe(20)
    expect(merged.tilesets.map((t) => t.id).sort()).toEqual(['builtin', 'extra'])
  })

  it('preserva a borrachada de um tile legado na tile layer (caminho eraseAt sem mobília empilhada)', () => {
    // Célula 5 tinha um tile legado ('builtin:0'); eu apaguei -> null.
    // theirs não mudou nada nessa célula (== base).
    const layerData = Array.from({ length: 100 }, () => null as string | null)
    layerData[5] = 'builtin:0'
    const base = doc([], layerData)
    const mineData = layerData.slice()
    mineData[5] = null
    const mine = doc([], mineData)
    const theirs = doc([], layerData)
    const merged = mergeDecoration(base, mine, theirs)
    const objectsLayer = merged.layers.find((l) => l.key === 'objects')
    expect(objectsLayer?.type).toBe('tile')
    expect((objectsLayer as { data: (string | null)[] }).data[5]).toBeNull()
  })

  it('concorrência: minha borrachada de tile (layer) e o objeto novo de outro editor sobrevivem juntos', () => {
    const layerData = Array.from({ length: 100 }, () => null as string | null)
    layerData[7] = 'builtin:0'
    const base = doc([], layerData)
    const mineData = layerData.slice()
    mineData[7] = null
    const mine = doc([], mineData) // eu apaguei a célula 7
    const theirs = doc([tileObj('their-1', 64, 0)], layerData) // outro editor adicionou um objeto
    const merged = mergeDecoration(base, mine, theirs)
    const objectsLayer = merged.layers.find((l) => l.key === 'objects')
    expect((objectsLayer as { data: (string | null)[] }).data[7]).toBeNull()
    expect(merged.objects.map((o) => o.id)).toContain('their-1')
  })

  it('mantém o valor de theirs numa célula que só theirs alterou (mine == base)', () => {
    const layerData = Array.from({ length: 100 }, () => null as string | null)
    const base = doc([], layerData)
    const mine = doc([], layerData) // eu não mudei nada
    const theirsData = layerData.slice()
    theirsData[9] = 'builtin:0' // outro editor pintou a célula 9
    const theirs = doc([], theirsData)
    const merged = mergeDecoration(base, mine, theirs)
    const objectsLayer = merged.layers.find((l) => l.key === 'objects')
    expect((objectsLayer as { data: (string | null)[] }).data[9]).toBe('builtin:0')
  })

  it('preserva createdBy dos objetos ao mesclar', () => {
    const base = docWith([])
    const mine = docWith([memberObj])
    const theirs = docWith([adminObj])
    const merged = mergeDecoration(base, mine, theirs)
    const m = merged.objects.find((o) => o.id === 'm1')
    const a = merged.objects.find((o) => o.id === 'a1')
    expect(m?.createdBy).toEqual({ id: 'bob', role: 'LEGEND' })
    expect(a?.createdBy).toEqual({ id: 'admin', role: 'ADMIN' })
  })

  // Modo aditivo: usado quando o servidor NÃO sabe contra o que o cliente
  // editou (âncora de outra publicação, ou base já podada do anel). Sem ele,
  // `base = theirs` faz todo objeto de theirs ausente em mine virar remoção —
  // é o que apagava o mapa recém-publicado pelo admin.
  describe('modo aditivo', () => {
    it('não aplica remoção quando a base é desconhecida', () => {
      const theirs = doc([tileObj('publicado-1', 0, 0), tileObj('publicado-2', 32, 0)])
      const mine = doc([tileObj('meu', 64, 0)]) // editei em cima de OUTRA publicação
      const merged = mergeDecoration(theirs, mine, theirs, { additive: true })
      expect(merged.objects.map((o) => o.id)).toEqual(['publicado-1', 'publicado-2', 'meu'])
    })

    it('continua aplicando minha alteração de objeto existente', () => {
      const base = doc([tileObj('a', 0, 0)])
      const mine = doc([tileObj('a', 96, 0)])
      const theirs = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])
      const merged = mergeDecoration(base, mine, theirs, { additive: true })
      expect(merged.objects.find((o) => o.id === 'a')!.geometry).toMatchObject({ x: 96 })
      expect(merged.objects.map((o) => o.id)).toContain('b')
    })
  })
})

describe('mergeAdminDraft', () => {
  it('preserva decoração feita no mapa depois que o draft foi aberto', () => {
    const base = doc([tileObj('estrutura', 0, 0)])
    const mine = doc([tileObj('estrutura', 0, 0), tileObj('admin-novo', 32, 0)])
    const theirs = doc([tileObj('estrutura', 0, 0), tileObj('decorado-no-mapa', 64, 0)])

    const merged = mergeAdminDraft(base, mine, theirs)

    expect(merged.objects.map((o) => o.id)).toEqual([
      'estrutura',
      'decorado-no-mapa',
      'admin-novo',
    ])
  })

  it('estrutura vem de mine — o admin é a autoridade sobre o tamanho do mapa', () => {
    const base = doc([])
    const mine = { ...doc([]), map: { width: 30, height: 30, tileWidth: 32, tileHeight: 32 } } as MapDocumentV1
    const theirs = { ...doc([]), map: { width: 10, height: 10, tileWidth: 32, tileHeight: 32 } } as MapDocumentV1

    expect(mergeAdminDraft(base, mine, theirs).map.width).toBe(30)
    // …ao contrário do merge de decoração, em que theirs manda.
    expect(mergeDecoration(base, mine, theirs).map.width).toBe(10)
  })

  it('aplica a remoção feita pelo admin', () => {
    const base = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])
    const mine = doc([tileObj('a', 0, 0)]) // admin apagou 'b'
    const theirs = doc([tileObj('a', 0, 0), tileObj('b', 32, 0), tileObj('c', 64, 0)])

    const merged = mergeAdminDraft(base, mine, theirs)

    expect(merged.objects.map((o) => o.id)).toEqual(['a', 'c'])
  })

  it('mantém a célula pintada no mapa onde o admin não mexeu', () => {
    const layerData = Array.from({ length: 100 }, () => null as string | null)
    const base = doc([], layerData)
    const mineData = layerData.slice()
    mineData[3] = 'builtin:1' // admin pintou a célula 3
    const theirsData = layerData.slice()
    theirsData[9] = 'builtin:0' // alguém pintou a célula 9 pelo mapa
    const merged = mergeAdminDraft(base, doc([], mineData), doc([], theirsData))

    const layer = merged.layers.find((l) => l.key === 'objects') as { data: (string | null)[] }
    expect(layer.data[3]).toBe('builtin:1')
    expect(layer.data[9]).toBe('builtin:0')
  })

  it('mapa redimensionado pelo admin mantém a layer dele (tamanhos incompatíveis)', () => {
    const base = doc([], Array.from({ length: 100 }, () => null as string | null))
    const mineData = Array.from({ length: 400 }, () => null as string | null)
    mineData[3] = 'builtin:1'
    const mine = { ...doc([], mineData), map: { width: 20, height: 20, tileWidth: 32, tileHeight: 32 } } as MapDocumentV1
    const theirsData = Array.from({ length: 100 }, () => null as string | null)
    theirsData[9] = 'builtin:0'

    const merged = mergeAdminDraft(base, mine, doc([], theirsData))

    const layer = merged.layers.find((l) => l.key === 'objects') as { data: (string | null)[] }
    expect(layer.data).toHaveLength(400)
    expect(layer.data[3]).toBe('builtin:1')
  })
})
