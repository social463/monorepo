import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MAP_LIMITS, OFFICE_TILESET_CATALOG } from '@legends/shared'
import { renderHook, act } from '@testing-library/react'
vi.mock('./decorationApi')
import * as api from './decorationApi'
import { useOfficeMapEditing } from './useOfficeMapEditing'
import { createEmptyMapDocumentV1 } from '@legends/shared'
import { ApiError } from '../../lib/api'

const scene = {
  setEditing: vi.fn(),
  setEditMode: vi.fn(),
  applyTileStamp: vi.fn(),
  applyTileObjectStamp: vi.fn(),
  removeTileObjectStamp: vi.fn(),
  markTileObjectErased: vi.fn(),
  registerBuiltinAsset: vi.fn().mockResolvedValue(undefined),
  registerTileFrame: vi.fn(),
  eraseTileStamp: vi.fn(),
  setZonePreview: vi.fn(),
  setRectPreviewColor: vi.fn(),
  addEditZoneOverlay: vi.fn(),
  setPublishedAreaOverlays: vi.fn(),
  removeEditZoneOverlay: vi.fn(),
  eraseAreaMarker: vi.fn(),
  discardLocalEdits: vi.fn(),
  setSelectionOverlay: vi.fn(),
  setPublishedObjectVisible: vi.fn(),
  resetPublishedObjectsVisibility: vi.fn(),
  setEraseHover: vi.fn(),
  setPlacementPreview: vi.fn(),
  hidePublishedObject: vi.fn(),
  restoreHiddenPublishedObjects: vi.fn(),
  syncTileObjectOrder: vi.fn(),
}
const canvasRef = { current: { getScene: () => scene, getScreenPosition: () => null } } as any

/**
 * A maioria dos testes deste arquivo exercita o pipeline de pintura/borracha
 * sem se importar com quem é o ator — usar o admin como padrão preserva o
 * comportamento pré-Task-4 (admin nunca é bloqueado por `isProtectedFromActor`).
 * Os testes de proteção abaixo passam `MEMBER_ACTOR` explicitamente.
 */
const ADMIN_ACTOR = { id: 'admin-1', isAdmin: true }
const MEMBER_ACTOR = { id: 'bob', isAdmin: false }

/** Documento com mobília JÁ PUBLICADA nas células dadas (tiles de 16px). */
function docWithFurniture(cells: [number, number][]) {
  const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 16 })
  doc.tilesets = [
    { id: 'ts', assetId: OFFICE_TILESET_CATALOG[0].assetId, name: 'T', tileWidth: 16, tileHeight: 16, columns: 8, tileCount: 64 },
  ]
  doc.objects = cells.map(([col, row]) => ({
    id: `pub-${col}-${row}`,
    layerKey: 'objects',
    type: 'tile-object',
    geometry: { kind: 'rectangle', x: col * 16, y: row * 16, width: 16, height: 16 },
    properties: { tilesetId: 'ts', tileIndex: 0 },
  }))
  return doc
}

describe('useOfficeMapEditing', () => {
  beforeEach(() => vi.resetAllMocks())

  /** `ActiveOfficeMapDTO` mínimo (Task 9: `enter()` semeia daqui, sem lock). */
  function activeMapFor(document: any, decorRevision = 3) {
    return {
      map: { id: 'm', name: 'M' },
      publication: { id: 'p1', version: 1, schemaVersion: '1.0.0', createdAt: 'x', createdBy: null, active: true },
      decorRevision,
      document,
      assets: [],
      rooms: [],
      desks: [],
    } as any
  }

  /** Entra em edição com um documento dado e devolve os callbacks que a cena recebeu. */
  async function enterSession(document: any, decorRevision = 3, actor: typeof ADMIN_ACTOR | typeof MEMBER_ACTOR | null = ADMIN_ACTOR) {
    vi.mocked(api.getActiveMapForEditing).mockResolvedValue(activeMapFor(document, decorRevision))
    // Merge-publish "default": ecoa o documento pristino da sessão avançando
    // uma revisão — testes que precisam de um resultado diferente sobrescrevem
    // com `mockResolvedValueOnce`/`mockResolvedValue` antes de chamar `save()`.
    vi.mocked(api.mergePublish).mockResolvedValue({ decorRevision: decorRevision + 1, document })
    const { result, unmount } = renderHook(() => useOfficeMapEditing(canvasRef, actor))
    await act(async () => {
      await result.current.enter()
    })
    const callbacks = scene.setEditing.mock.calls[0][1]
    return { result, callbacks, unmount }
  }

  /** Uma pincelada: `onStrokeStart` (abre o passo de desfazer) + N células. */
  async function stroke(callbacks: any, cells: [number, number][]) {
    await act(async () => {
      callbacks.onStrokeStart()
      for (const [col, row] of cells) callbacks.onTilePaint(col, row)
    })
  }

  const pickTile = (result: any) =>
    act(() => {
      result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' })
    })

  it('pincel empilha: peças DIFERENTES na mesma célula viram dois tile-objects', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    act(() => {
      result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' })
    })
    await stroke(callbacks, [[2, 3]])
    // Troca o tile selecionado antes da segunda pincelada — peça diferente
    // sobre peça diferente continua empilhando normalmente.
    act(() => {
      result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 1, row: 0, cols: 1, rows: 1, category: 'Mesa' })
    })
    await stroke(callbacks, [[2, 3]])
    await act(async () => {
      await result.current.save()
    })
    const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    const stacked = sent.objects.filter((o: any) => o.type === 'tile-object')
    expect(stacked).toHaveLength(2)
    expect(stacked.every((o: any) => o.geometry.x === 96 && o.geometry.y === 144)).toBe(true)
    expect(new Set(stacked.map((o: any) => o.properties.tileIndex)).size).toBe(2)
    expect(scene.applyTileObjectStamp).toHaveBeenCalledTimes(2)
  })

  it('pincelada arrastada não perde células por causa da corrida no await de registerBuiltinAsset (re-review Critical A)', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    // `stroke` despacha `onTilePaint` num laço SÍNCRONO — cada célula chama
    // `paintAt`, que só rende o controle no primeiro `await` (registro do
    // asset builtin). As 3 chamadas ficam empilhadas aguardando a mesma
    // promise antes de qualquer uma delas gravar `documentRef.current`,
    // reproduzindo a corrida sem precisar mockar timing.
    await stroke(callbacks, [
      [1, 1],
      [2, 1],
      [3, 1],
    ])
    await act(async () => {
      await result.current.save()
    })
    const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(3)
    expect(scene.applyTileObjectStamp).toHaveBeenCalledTimes(3)
  })

  it('pincelada arrastada com textura fria não perde células (todas as chamadas em voo)', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)

    // Textura FRIA: `registerBuiltinAsset` só resolve quando o teste mandar.
    // O mock padrão do arquivo (`mockResolvedValue`) resolve num único
    // microtask e não reproduz a janela real de concorrência — com uma
    // promise adiada, as 5 chamadas de `paintAt` abaixo ficam TODAS
    // suspensas no mesmo `await`, com o MESMO `documentRef.current` pré-await
    // capturado por todas, antes de qualquer uma gravar de volta.
    let liberar!: () => void
    const carregando = new Promise<void>((res) => {
      liberar = () => res()
    })
    scene.registerBuiltinAsset.mockReturnValue(carregando)

    // Despacha as 5 células da pincelada SEM aguardar `paintAt` terminar —
    // `onTilePaint` chama `void paintAt(...)`, então o laço síncrono só
    // dispara as 5 chamadas até o primeiro `await` de cada uma.
    await act(async () => {
      callbacks.onStrokeStart()
      for (let col = 1; col <= 5; col++) callbacks.onTilePaint(col, 3)
    })

    // Só agora libera a textura e dá tempo às 5 continuações de drenar.
    await act(async () => {
      liberar()
      await carregando
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.save()
    })
    const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    const painted = sent.objects.filter((o: any) => o.type === 'tile-object')
    expect(painted).toHaveLength(5)
    expect(new Set(painted.map((o: any) => o.geometry.x)).size).toBe(5)
    expect(scene.applyTileObjectStamp).toHaveBeenCalledTimes(5)
  })

  it('pincel no MESMO tile na mesma célula não empilha: repintar é no-op', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    await stroke(callbacks, [[2, 3]])
    expect(result.current.state.canUndo).toBe(true)
    scene.applyTileObjectStamp.mockClear()

    // Repintar o MESMO sprite sobre a mesma célula não deve gerar nova
    // estampa nem novo passo de desfazer.
    await stroke(callbacks, [[2, 3]])
    expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()

    // Um único Ctrl+Z volta ao estado pristino — prova que a segunda
    // pincelada (no-op) não abriu um segundo passo de desfazer.
    await act(async () => {
      await result.current.undo()
    })
    expect(result.current.state.canUndo).toBe(false)
    expect(result.current.state.dirty).toBe(false)

    await act(async () => {
      await result.current.save()
    })
    const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(0)
  })

  it('recusa a pincelada que estouraria o teto de objetos do mapa', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
    doc.objects = Array.from({ length: MAP_LIMITS.maxObjects }, (_, i) => ({
      id: `filler-${i}`,
      layerKey: 'objects',
      type: 'tile-object',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
      properties: { tilesetId: 'ts', tileIndex: 0 },
    }))
    const { result, callbacks } = await enterSession(doc)
    pickTile(result)
    await stroke(callbacks, [[1, 1]])
    expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()
    expect(result.current.state.limitError).toMatch(/limite/i)
    expect(result.current.state.dirty).toBe(false)
  })

  it('aceita a pincelada que cabe exatamente no teto de objetos do mapa', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
    // Preenche até o teto menos um: spawn-point original + artificiais deixa exatamente 1 vaga
    const fillers = Array.from({ length: MAP_LIMITS.maxObjects - 2 }, (_, i) => ({
      id: `filler-${i}`,
      layerKey: 'objects',
      type: 'tile-object',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
      properties: { tilesetId: 'ts', tileIndex: 0 },
    }))
    doc.objects = [...doc.objects, ...fillers]
    const { result, callbacks } = await enterSession(doc)
    pickTile(result)
    await stroke(callbacks, [[1, 1]])
    expect(scene.applyTileObjectStamp).toHaveBeenCalled()
    expect(result.current.state.limitError).toBeNull()
    expect(result.current.state.dirty).toBe(true)
  })

  /**
   * Documento no teto de FOLHAS de mobília (`maxTilesets`), nenhuma delas a
   * folha que os testes abaixo escolhem na paleta — trazer a peça exigiria um
   * tileset a mais.
   */
  function docAtTilesetLimit() {
    const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
    doc.tilesets = OFFICE_TILESET_CATALOG.slice(1, 1 + MAP_LIMITS.maxTilesets).map((entry, index) => ({
      id: `ts-${index}`,
      assetId: entry.assetId,
      name: `T${index}`,
      tileWidth: 48,
      tileHeight: 48,
      columns: 4,
      tileCount: 16,
    }))
    return doc
  }

  it('recusa a pincelada de uma folha nova quando o mapa já está no teto de tilesets', async () => {
    // Regressão (HML): o mapa ativo estava em 20/20 folhas e a peça de uma
    // folha nova entrava no documento de trabalho sem aviso — só o servidor
    // reprovava, com um 400 "Documento inválido" depois de toda a decoração
    // feita. O teto tem que barrar na hora, com mensagem.
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(docAtTilesetLimit())
    pickTile(result)
    await stroke(callbacks, [[1, 1]])
    expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()
    expect(result.current.state.limitError).toMatch(/conjuntos de mobília/i)
    expect(result.current.state.dirty).toBe(false)
  })

  it('recusa a colocação livre de uma folha nova quando o mapa já está no teto de tilesets', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(docAtTilesetLimit())
    pickTile(result)
    await act(async () => {
      await callbacks.onObjectPointerDown(300, 300)
    })
    expect(result.current.state.limitError).toMatch(/conjuntos de mobília/i)
    expect(result.current.state.dirty).toBe(false)
  })

  it('a folha JÁ presente no documento no teto continua pintando', async () => {
    // O teto conta folhas, não peças: repor mobília de uma folha que o mapa já
    // usa não precisa de tileset novo e não pode ser barrada.
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const doc = docAtTilesetLimit()
    const { result, callbacks } = await enterSession(doc)
    act(() => {
      result.current.selectTile({ assetId: doc.tilesets[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' })
    })
    await stroke(callbacks, [[1, 1]])
    expect(scene.applyTileObjectStamp).toHaveBeenCalled()
    expect(result.current.state.limitError).toBeNull()
    expect(result.current.state.dirty).toBe(true)
  })

  it('borracha tira só a peça de cima, mantendo a de baixo', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    await stroke(callbacks, [[2, 3]])
    // Peça diferente por cima, para formar uma pilha de verdade (repintar o
    // mesmo tile é no-op — Critical 1 do review C4).
    act(() => {
      result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 1, row: 0, cols: 1, rows: 1, category: 'Mesa' })
    })
    await stroke(callbacks, [[2, 3]])
    await act(async () => {
      callbacks.onTileErase(2, 3)
    })
    await act(async () => {
      await result.current.save()
    })
    const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    const remaining = sent.objects.filter((o: any) => o.type === 'tile-object')
    expect(remaining).toHaveLength(1)
    // A peça que sobrou é a de BAIXO (tileIndex 0, pintada primeiro) — a de
    // cima (tileIndex 1) é a que a borracha removeu. Sem esta asserção, uma
    // regressão que apagasse a peça errada (a de baixo) passaria mesmo assim,
    // já que ambas as pilhas têm tamanho 1.
    expect(remaining[0].properties.tileIndex).toBe(0)
    expect(scene.removeTileObjectStamp).toHaveBeenCalledTimes(1)
    // Peça colocada nesta sessão: nada de marca vermelha (nada publicado saiu).
    expect(scene.markTileObjectErased).not.toHaveBeenCalled()
  })

  it('borracha marca em vermelho a remoção de mobília já publicada', async () => {
    const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
    doc.objects = [{
      id: 'publicada-1',
      layerKey: 'objects',
      type: 'tile-object',
      geometry: { kind: 'rectangle', x: 96, y: 144, width: 48, height: 48 },
      properties: { tilesetId: 'ts', tileIndex: 0 },
    }]
    const { result, callbacks } = await enterSession(doc)
    await act(async () => {
      callbacks.onTileErase(2, 3)
    })
    expect(scene.markTileObjectErased).toHaveBeenCalledWith('publicada-1', { x: 96, y: 144, width: 48, height: 48 })
    expect(result.current.state.dirty).toBe(true)
  })

  it('borracha: cenário misto — a pilha tem precedência sobre o tile legado', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    // Monta um documento que tem um tile legado na célula (2, 3), e depois adiciona
    // um tile-object nesta sessão (novo, não publicado).
    const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
    // Adiciona APENAS tile legado: modifica a layer `objects` (tipo `'tile'`)
    const objectsLayer = doc.layers.find((l: any) => l.key === 'objects')
    if (objectsLayer && objectsLayer.type === 'tile') {
      const index = 3 * 10 + 2 // row * width + col
      objectsLayer.data[index] = 'ts:0'
    }

    const { result, callbacks } = await enterSession(doc)
    // Pincel: adiciona um tile-object nesta sessão (novo, não publicado)
    pickTile(result)
    await stroke(callbacks, [[2, 3]])

    // Primeira borrachada: remove apenas o tile-object do topo (novo, chama removeTileObjectStamp)
    await act(async () => {
      callbacks.onTileErase(2, 3)
    })
    // Segunda borrachada: remove o tile legado (chama eraseTileStamp)
    await act(async () => {
      callbacks.onTileErase(2, 3)
    })

    await act(async () => {
      await result.current.save()
    })
    const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    // Verificar que não há mais tile-objects
    expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(0)
    // Verificar que o tile legado foi limpo
    const objectsLayerAfter = sent.layers.find((l: any) => l.key === 'objects')
    const indexAfter = 3 * 10 + 2
    expect((objectsLayerAfter as any).data[indexAfter]).toBeNull()
    // Verificar chamadas: removeTileObjectStamp uma vez (primeira borrachada),
    // eraseTileStamp uma vez (segunda borrachada)
    expect(scene.removeTileObjectStamp).toHaveBeenCalledTimes(1)
    expect(scene.eraseTileStamp).toHaveBeenCalledTimes(1)
  })

  it('borracha: célula vazia é no-op', async () => {
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    // Borracha numa célula vazia (sem tile legado, sem tile-object)
    await act(async () => {
      callbacks.onTileErase(5, 5)
    })
    expect(result.current.state.dirty).toBe(false)
    expect(result.current.state.canUndo).toBe(false)
    expect(scene.removeTileObjectStamp).not.toHaveBeenCalled()
    expect(scene.markTileObjectErased).not.toHaveBeenCalled()
  })

  describe('eraser respeita objeto protegido (Task 4)', () => {
    it('comum não apaga mobília do admin (peça publicada) — objeto permanece e limitError é setado', async () => {
      const doc = docWithFurniture([[0, 0]])
      // Carimba a peça publicada como criada pelo admin — é a base publicada
      // (`baseDocRef`) que decide a proteção, não um carimbo local.
      doc.objects[0].createdBy = { id: 'admin-1', role: 'ADMIN' }
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      act(() => result.current.setTool('eraser'))
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })

      expect(result.current.state.limitError).toBe('Essa peça foi criada pelo admin e não pode ser apagada.')
      expect(result.current.state.dirty).toBe(false)
      expect(scene.hidePublishedObject).not.toHaveBeenCalled()
      expect(scene.removeTileObjectStamp).not.toHaveBeenCalled()

      // O objeto continua no documento de trabalho — nada foi removido.
      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'pub-0-0')).toBe(true)
    })

    it('comum apaga a própria mobília recém-colocada nesta sessão (fora da base publicada)', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(
        createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }),
        3,
        MEMBER_ACTOR,
      )
      act(() => {
        result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' })
      })
      await act(async () => callbacks.onObjectPointerDown(200, 200))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      act(() => callbacks.onObjectPointerUp())
      expect(result.current.state.dirty).toBe(true)

      act(() => result.current.setTool('eraser'))
      act(() => {
        callbacks.onObjectPointerDown(200, 200)
      })

      expect(result.current.state.limitError).toBeNull()
      expect(scene.removeTileObjectStamp).toHaveBeenCalled()

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(0)
    })

    it('admin apaga mobília do admin (peça publicada)', async () => {
      const doc = docWithFurniture([[0, 0]])
      doc.objects[0].createdBy = { id: 'admin-1', role: 'ADMIN' }
      const { result, callbacks } = await enterSession(doc, 3, ADMIN_ACTOR)

      act(() => result.current.setTool('eraser'))
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })

      expect(result.current.state.limitError).toBeNull()
      expect(scene.hidePublishedObject).toHaveBeenCalledWith('pub-0-0')
      expect(result.current.state.dirty).toBe(true)

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'pub-0-0')).toBe(false)
    })

    it('comum não apaga peça do admin via eraseAt (célula/borracha por tile)', async () => {
      const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
      doc.objects = [
        {
          id: 'admin-tile-1',
          layerKey: 'objects',
          type: 'tile-object',
          geometry: { kind: 'rectangle', x: 96, y: 144, width: 48, height: 48 },
          properties: { tilesetId: 'ts', tileIndex: 0 },
          createdBy: { id: 'admin-1', role: 'ADMIN' },
        },
      ]
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      await act(async () => {
        callbacks.onTileErase(2, 3)
      })

      expect(result.current.state.limitError).toBe('Essa peça foi criada pelo admin e não pode ser apagada.')
      expect(result.current.state.dirty).toBe(false)
      expect(scene.markTileObjectErased).not.toHaveBeenCalled()

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'admin-tile-1')).toBe(true)
    })
  })

  describe('ferramenta "Apagar colisão"', () => {
    /** Documento com uma colisão avulsa (48×48 na origem) do autor indicado. */
    function docWithCollision(createdBy: { id: string; role: string } | undefined) {
      const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
      doc.objects = [
        {
          id: 'col-1',
          layerKey: 'collision',
          type: 'collision',
          geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
          properties: {},
          ...(createdBy ? { createdBy } : {}),
        },
      ]
      return doc
    }

    it('comum apaga a colisão que ele mesmo publicou', async () => {
      const doc = docWithCollision({ id: 'bob', role: 'LEGEND' })
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      act(() => result.current.setTool('collision-eraser'))
      await act(async () => callbacks.onObjectPointerDown(24, 24))

      expect(result.current.state.dirty).toBe(true)
      expect(scene.eraseAreaMarker).toHaveBeenCalledWith('col-1', { x: 0, y: 0, width: 48, height: 48 })

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'col-1')).toBe(false)
    })

    it('comum NÃO apaga colisão do admin — e o documento fica intacto', async () => {
      const doc = docWithCollision({ id: 'admin-1', role: 'ADMIN' })
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      act(() => result.current.setTool('collision-eraser'))
      await act(async () => callbacks.onObjectPointerDown(24, 24))

      expect(result.current.state.limitError).toMatch(/criada pelo admin/i)
      expect(result.current.state.dirty).toBe(false)
      expect(scene.eraseAreaMarker).not.toHaveBeenCalledWith('col-1', expect.anything())
    })

    // Peça LEGADA (publicada antes do carimbo de autoria existir): continua
    // intocável para o comum, com a mensagem que explica o porquê.
    it('comum NÃO apaga colisão sem autor registrado', async () => {
      const doc = docWithCollision(undefined)
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      act(() => result.current.setTool('collision-eraser'))
      await act(async () => callbacks.onObjectPointerDown(24, 24))

      expect(result.current.state.limitError).toMatch(/não tem autor registrado/i)
      expect(result.current.state.dirty).toBe(false)
    })

    it('admin apaga colisão de qualquer autor', async () => {
      const doc = docWithCollision({ id: 'admin-1', role: 'ADMIN' })
      const { result, callbacks } = await enterSession(doc, 3, ADMIN_ACTOR)

      act(() => result.current.setTool('collision-eraser'))
      await act(async () => callbacks.onObjectPointerDown(24, 24))

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'col-1')).toBe(false)
    })

    // É o motivo da ferramenta existir: a borracha comum acha o móvel primeiro,
    // então a colisão desenhada por cima dele era inalcançável.
    it('tira a colisão e deixa o móvel que está embaixo', async () => {
      const doc = docWithFurniture([[0, 0]])
      doc.objects.push({
        id: 'col-sobre-movel',
        layerKey: 'collision',
        type: 'collision',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 16, height: 16 },
        properties: {},
        createdBy: { id: 'bob', role: 'LEGEND' },
      })
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      act(() => result.current.setTool('collision-eraser'))
      await act(async () => callbacks.onObjectPointerDown(8, 8))

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'col-sobre-movel')).toBe(false)
      expect(sent.objects.some((o: any) => o.id === 'pub-0-0')).toBe(true)
    })

    it('clique fora de qualquer colisão não mexe no documento', async () => {
      const doc = docWithCollision({ id: 'bob', role: 'LEGEND' })
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      act(() => result.current.setTool('collision-eraser'))
      await act(async () => callbacks.onObjectPointerDown(300, 300))

      expect(result.current.state.dirty).toBe(false)
    })
  })

  describe('proteção em massa e mover/girar (Task 5)', () => {
    it('borracha em retângulo preserva objeto do admin e remove o do comum', async () => {
      const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
      doc.objects = [
        {
          id: 'admin-col',
          layerKey: 'collision',
          type: 'collision',
          geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
          properties: {},
          createdBy: { id: 'admin-1', role: 'ADMIN' },
        },
        {
          id: 'member-col',
          layerKey: 'collision',
          type: 'collision',
          geometry: { kind: 'rectangle', x: 48, y: 0, width: 48, height: 48 },
          properties: {},
          createdBy: { id: 'bob', role: 'LEGEND' },
        },
      ]
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      act(() => result.current.setTool('eraser'))
      act(() => {
        callbacks.onRectEnd({ x: 0, y: 0, width: 96, height: 48 })
      })

      expect(scene.eraseAreaMarker).toHaveBeenCalledWith('member-col', { x: 48, y: 0, width: 48, height: 48 })
      expect(scene.eraseAreaMarker).not.toHaveBeenCalledWith('admin-col', expect.anything())
      expect(result.current.state.dirty).toBe(true)

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'admin-col')).toBe(true)
      expect(sent.objects.some((o: any) => o.id === 'member-col')).toBe(false)
    })

    it('admin apaga os dois objetos do mesmo retângulo (nenhum protegido dele mesmo)', async () => {
      const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
      doc.objects = [
        {
          id: 'admin-col',
          layerKey: 'collision',
          type: 'collision',
          geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
          properties: {},
          createdBy: { id: 'admin-1', role: 'ADMIN' },
        },
        {
          id: 'member-col',
          layerKey: 'collision',
          type: 'collision',
          geometry: { kind: 'rectangle', x: 48, y: 0, width: 48, height: 48 },
          properties: {},
          createdBy: { id: 'bob', role: 'LEGEND' },
        },
      ]
      const { result, callbacks } = await enterSession(doc, 3, ADMIN_ACTOR)

      act(() => result.current.setTool('eraser'))
      act(() => {
        callbacks.onRectEnd({ x: 0, y: 0, width: 96, height: 48 })
      })

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'admin-col')).toBe(false)
      expect(sent.objects.some((o: any) => o.id === 'member-col')).toBe(false)
    })

    it('comum não seleciona/gira grupo do admin', async () => {
      const doc = docWithFurniture([[0, 0]])
      doc.objects[0].createdBy = { id: 'admin-1', role: 'ADMIN' }
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      act(() => result.current.setTool('select'))
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })

      expect(result.current.state.selection).toBeNull()
      expect(result.current.state.limitError).toBe('Essa peça foi criada pelo admin e não pode ser movida.')
      expect(scene.setSelectionOverlay).not.toHaveBeenCalled()
    })

    it('comum não arrasta mobília do admin pelo pincel/mover (bloqueia no grab, antes de mutar o documento)', async () => {
      const doc = docWithFurniture([[0, 0]])
      doc.objects[0].createdBy = { id: 'admin-1', role: 'ADMIN' }
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      // Tool padrão é 'brush' sem asset selecionado — clicar em cima da
      // mobília existente tenta AGARRAR o grupo pra arrastar.
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })
      expect(result.current.state.limitError).toBe('Essa peça foi criada pelo admin e não pode ser movida.')
      expect(result.current.state.dirty).toBe(false)
      expect(scene.hidePublishedObject).not.toHaveBeenCalled()

      // Sem o grab, o "arraste" que segue é no-op: nada muda mesmo movendo o
      // cursor com o botão pressionado, e soltar não commita nem seleciona.
      act(() => {
        callbacks.onObjectPointerMove(40, 40, true)
      })
      act(() => {
        callbacks.onObjectPointerUp()
      })
      expect(result.current.state.dirty).toBe(false)
      expect(result.current.state.selection).toBeNull()

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const moved = sent.objects.find((o: any) => o.id === 'pub-0-0')
      // Continua na posição original (0,0) — nada foi arrastado.
      expect(moved.geometry.x).toBe(0)
      expect(moved.geometry.y).toBe(0)
    })

    it('admin arrasta mobília do admin pelo pincel/mover (controle — não bloqueado)', async () => {
      const doc = docWithFurniture([[0, 0]])
      doc.objects[0].createdBy = { id: 'admin-1', role: 'ADMIN' }
      const { result, callbacks } = await enterSession(doc, 3, ADMIN_ACTOR)

      act(() => callbacks.onObjectPointerDown(8, 8))
      act(() => callbacks.onObjectPointerMove(40, 40, true))
      act(() => callbacks.onObjectPointerUp())

      expect(result.current.state.limitError).toBeNull()
      expect(result.current.state.dirty).toBe(true)

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const moved = sent.objects.find((o: any) => o.id === 'pub-0-0')
      expect(moved.geometry.x).not.toBe(0)
    })

    it('"Limpar tudo" preserva tile-object protegido do comum, remove só a mobília da sessão', async () => {
      // `clearAllFurniture` já era restrito a peças fora da base publicada
      // (nunca toca no que foi salvo); este teste cobre a mesma garantia
      // agora também explícita via `isProtectedFromActor` — a peça publicada
      // pelo admin permanece intacta quando quem limpa é o comum.
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const withPublishedAdminPiece: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
      withPublishedAdminPiece.tilesets = [{ id: 'ts', assetId: 'a', name: 'X', tileWidth: 48, tileHeight: 48, columns: 4, tileCount: 16 }]
      withPublishedAdminPiece.objects = [
        {
          id: 'pub-admin',
          layerKey: 'objects',
          type: 'tile-object',
          geometry: { kind: 'rectangle', x: 96, y: 96, width: 48, height: 48 },
          properties: { tilesetId: 'ts', tileIndex: 5 },
          createdBy: { id: 'admin-1', role: 'ADMIN' },
        },
      ]
      const { result, callbacks } = await enterSession(withPublishedAdminPiece, 3, MEMBER_ACTOR)
      act(() => {
        result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' })
      })
      await act(async () => callbacks.onObjectPointerDown(300, 300))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      act(() => callbacks.onObjectPointerUp())

      act(() => result.current.clearAllFurniture())
      expect(scene.hidePublishedObject).not.toHaveBeenCalled()
      expect(scene.removeTileObjectStamp).toHaveBeenCalled()

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const furniture = sent.objects.filter((o: any) => o.type === 'tile-object')
      expect(furniture.map((o: any) => o.id)).toEqual(['pub-admin'])
    })
  })

  it('desfazer remove a estampa da peça empilhada, sem desenhar overlay de área', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    await stroke(callbacks, [[2, 3]])
    // Peça diferente por cima, para formar uma pilha de verdade (repintar o
    // mesmo tile é no-op — Critical 1 do review C4).
    act(() => {
      result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 1, row: 0, cols: 1, rows: 1, category: 'Mesa' })
    })
    await stroke(callbacks, [[2, 3]])
    scene.applyTileObjectStamp.mockClear()
    scene.addEditZoneOverlay.mockClear()
    scene.registerTileFrame.mockClear()
    await act(async () => {
      await result.current.undo()
    })
    // Repintou a pilha remanescente (1 peça) e nenhum retângulo de área.
    expect(scene.applyTileObjectStamp).toHaveBeenCalledTimes(1)
    expect(scene.addEditZoneOverlay).not.toHaveBeenCalled()
    // A peça repintada é a de BAIXO (tileIndex 0, do primeiro stroke) — a de
    // CIMA (tileIndex 1, do segundo stroke) é a que o Ctrl+Z desfez. Sem
    // esta asserção, uma regressão que restaurasse a peça errada passaria
    // (ambas resultam em 1 chamada a `applyTileObjectStamp`).
    expect(scene.registerTileFrame).toHaveBeenCalledWith(expect.objectContaining({ assetId: OFFICE_TILESET_CATALOG[0].assetId }), 0)
  })

  describe('áreas já publicadas (#22167)', () => {
    /** Documento publicado com uma sala de chamada e uma área de silêncio. */
    function docWithAreas() {
      const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
      doc.objects = [
        {
          id: 'sala-1',
          layerKey: 'meeting-rooms',
          type: 'meeting-room',
          geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 48 },
          properties: { externalKey: 'sala-1', name: 'Sala de chamada', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
        },
        {
          id: 'silencio-1',
          layerKey: 'private-zones',
          type: 'private-zone',
          geometry: { kind: 'rectangle', x: 144, y: 0, width: 48, height: 48 },
          properties: { name: 'Área de silêncio', accessPolicy: 'OPEN' },
        },
      ]
      return doc
    }

    it('desenha as áreas do mapa publicado ao entrar na Decoração', async () => {
      await enterSession(docWithAreas())
      expect(scene.setPublishedAreaOverlays).toHaveBeenCalledWith([
        { id: 'sala-1', rect: { x: 0, y: 0, width: 96, height: 48 }, color: 0x8ab4f8 },
        { id: 'silencio-1', rect: { x: 144, y: 0, width: 48, height: 48 }, color: 0xff5d5d },
      ])
    })

    it('não repinta como publicada a área criada nesta sessão — senão sairia overlay em dobro', async () => {
      const { result, callbacks } = await enterSession(docWithAreas())
      act(() => result.current.setTool('call-zone'))
      // Duas áreas novas: o undo derruba só a segunda, então a primeira ainda
      // está no documento na hora do repaint — é ela que não pode voltar pela
      // via de "área publicada" (o laço de diff já a redesenha).
      await act(async () => {
        callbacks.onRectEnd({ x: 240, y: 240, width: 96, height: 48 })
      })
      await act(async () => {
        callbacks.onRectEnd({ x: 240, y: 144, width: 96, height: 48 })
      })
      scene.setPublishedAreaOverlays.mockClear()
      scene.addEditZoneOverlay.mockClear()
      await act(async () => {
        await result.current.undo()
      })
      const [areas] = scene.setPublishedAreaOverlays.mock.calls.at(-1) ?? [[]]
      expect(areas.map((area: { id: string }) => area.id)).toEqual(['sala-1', 'silencio-1'])
      // A área remanescente da sessão é redesenhada pelo caminho normal.
      expect(scene.addEditZoneOverlay).toHaveBeenCalledTimes(1)
    })
  })

  it('entra carregando o mapa ativo publicado, sem adquirir lock (Task 9)', async () => {
    vi.mocked(api.getActiveMapForEditing).mockResolvedValue(
      activeMapFor(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })),
    )
    const { result } = renderHook(() => useOfficeMapEditing(canvasRef, ADMIN_ACTOR))
    await act(async () => {
      await result.current.enter()
    })
    expect(api.getActiveMapForEditing).toHaveBeenCalled()
    expect(api.acquireDecorationLock).not.toHaveBeenCalled()
    expect(scene.setEditing).toHaveBeenCalledWith(true, expect.any(Object))
    expect(result.current.state.active).toBe(true)
  })

  it('save() chama mergePublish com o baseRevision carregado e re-ancora na revisão/documento devolvidos', async () => {
    const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    await act(async () => {
      await result.current.save()
    })
    // `basePublicationId` viaja junto: sozinho, o `baseRevision` não identifica
    // a base (publicação nova nasce com decorRevision 0 e colidiria com uma
    // âncora antiga, fazendo este save reverter o publish do admin).
    expect(api.mergePublish).toHaveBeenCalledWith({
      baseRevision: 3,
      basePublicationId: 'p1',
      document: expect.anything(),
    })
    expect(api.acquireDecorationLock).not.toHaveBeenCalled()
    expect(result.current.state.active).toBe(true)
    expect(result.current.state.dirty).toBe(false)
    expect(result.current.state.canUndo).toBe(false)
    // Salvar não sai da cena — dá pra continuar editando.
    expect(scene.setEditing).not.toHaveBeenCalledWith(false)
  })

  it('salvar duas vezes seguidas usa o decorRevision devolvido pelo merge-publish anterior', async () => {
    const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    vi.mocked(api.mergePublish)
      .mockResolvedValueOnce({ decorRevision: 4, document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }) })
      .mockResolvedValueOnce({ decorRevision: 5, document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }) })
    await act(async () => {
      await result.current.save()
    })
    await act(async () => {
      await result.current.save()
    })
    expect(vi.mocked(api.mergePublish).mock.calls[0][0].baseRevision).toBe(3)
    expect(vi.mocked(api.mergePublish).mock.calls[1][0].baseRevision).toBe(4)
  })

  it('save() re-ancora no documento DEVOLVIDO pelo servidor, não no doc que este editor mandou (Task 9 — garantia central da colaboração)', async () => {
    const { result } = await enterSession(docWithFurniture([[0, 0]]), 3)

    // Simula outro editor: o mergePublish devolve um documento com um objeto
    // EXTRA (mesclado no servidor) que não estava no `doc` que ESTE editor
    // mandou.
    const merged = docWithFurniture([[0, 0]])
    const extraObject = {
      id: 'server-added-1',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 500, y: 500, width: 16, height: 16 },
      properties: {},
    }
    merged.objects = [...merged.objects, extraObject]
    vi.mocked(api.mergePublish).mockResolvedValueOnce({ decorRevision: 4, document: merged })

    await act(async () => {
      await result.current.save()
    })

    // Confirma a premissa: o `doc` enviado no PRIMEIRO save não tinha o
    // objeto extra — ele só existe na resposta do servidor.
    const firstSent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    expect(firstSent.objects.some((o: any) => o.id === 'server-added-1')).toBe(false)

    // Segundo save, sem edição local nova: se `save()` tivesse re-ancorado
    // `documentRef.current`/`baseDocRef.current` no `doc` que ELE mandou (a
    // regressão), o objeto acrescentado pelo servidor desapareceria para
    // sempre deste editor. Re-ancorando corretamente em `result.document`
    // (o comportamento real), o objeto extra sobrevive no documento de
    // trabalho e é reenviado neste segundo round-trip.
    await act(async () => {
      await result.current.save()
    })
    const secondSent = vi.mocked(api.mergePublish).mock.calls[1][0]
    expect(secondSent.baseRevision).toBe(4)
    expect((secondSent.document as any).objects.some((o: any) => o.id === 'server-added-1')).toBe(true)
  })

  it('bloqueia pintura enquanto o save está em voo (evita perder dirty/undo — review C4 Important 2)', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    await stroke(callbacks, [[2, 3]])

    // Controla quando o `mergePublish` resolve, para pintar durante o voo
    // antes de deixá-lo terminar.
    let resolveSave!: (value: { decorRevision: number; document: any }) => void
    vi.mocked(api.mergePublish).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )

    let savePromise!: Promise<void>
    act(() => {
      savePromise = result.current.save()
    })

    scene.applyTileObjectStamp.mockClear()
    // Tenta pintar durante o voo do save: deve ser ignorado.
    await stroke(callbacks, [[5, 5]])
    expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()

    await act(async () => {
      resolveSave({ decorRevision: 4, document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }) })
      await savePromise
    })

    // Só a peça pintada ANTES do save foi enviada — a tentativa durante o
    // voo não deixou rastro no documento salvo.
    const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(1)
  })

  it('Ctrl+Z durante um save em voo não altera o documento salvo nem o histórico (re-review Important C)', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    await stroke(callbacks, [[2, 3]])
    expect(result.current.state.canUndo).toBe(true)

    // Controla quando o `mergePublish` resolve, para tentar desfazer durante
    // o voo antes de deixá-lo terminar.
    let resolveSave!: (value: { decorRevision: number; document: any }) => void
    vi.mocked(api.mergePublish).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )

    let savePromise!: Promise<void>
    act(() => {
      savePromise = result.current.save()
    })

    // Ctrl+Z enquanto "Salvando…" está em voo: `undo()` é alcançável pelo
    // teclado mesmo com o botão Desfazer `disabled` — precisa ser um no-op.
    await act(async () => {
      await result.current.undo()
    })
    // O passo de desfazer continua de pé (não foi consumido pelo undo bloqueado).
    expect(result.current.state.canUndo).toBe(true)

    await act(async () => {
      resolveSave({ decorRevision: 4, document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }) })
      await savePromise
    })

    // O save publicou a peça pintada — o Ctrl+Z bloqueado não a reverteu.
    const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
    expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(1)
    // Save concluído com sucesso re-ancora normalmente: sem passo de desfazer
    // pendente e nada "sujo" (a defesa por identidade NÃO deveria ter sido
    // acionada, já que o undo bloqueado não tocou em `documentRef.current`).
    expect(result.current.state.canUndo).toBe(false)
    expect(result.current.state.dirty).toBe(false)
  })

  it('se mergePublish falhar, save() NÃO propaga (não vira unhandled rejection) e define saveError; o baseRevision NÃO avança (a próxima tentativa reusa o mesmo)', async () => {
    const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    vi.mocked(api.mergePublish).mockRejectedValueOnce(new Error('falha ao publicar'))

    // Task 11b: `save()` não relança mais — o único chamador (`OfficeEditDrawer`)
    // dispara com `void save()`, então uma rejeição não capturada aqui viraria
    // uma unhandled rejection silenciosa. A falha vira estado (`saveError`).
    await act(async () => {
      await result.current.save()
    })
    // Erro genérico (não-`ApiError`, ex.: falha de rede): mensagem de fallback.
    expect(result.current.state.saveError).toBe('Não foi possível salvar o mapa. Tente novamente.')
    expect(result.current.state.saving).toBe(false)

    vi.mocked(api.mergePublish).mockResolvedValueOnce({
      decorRevision: 4,
      document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }),
    })
    await act(async () => {
      await result.current.save()
    })

    // Uma tentativa bem-sucedida limpa o aviso.
    expect(result.current.state.saveError).toBeNull()

    // A segunda tentativa manda o MESMO baseRevision (3) — o merge-publish
    // anterior falhou por inteiro, nada foi persistido no servidor.
    expect(vi.mocked(api.mergePublish).mock.calls[0][0].baseRevision).toBe(3)
    expect(vi.mocked(api.mergePublish).mock.calls[1][0].baseRevision).toBe(3)
  })

  it('quando o erro é um ApiError (ex.: 403 STRUCTURAL_EDIT_FORBIDDEN), saveError usa a mensagem do servidor', async () => {
    const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    vi.mocked(api.mergePublish).mockRejectedValueOnce(
      new ApiError(403, 'Alterações estruturais não são permitidas', { code: 'STRUCTURAL_EDIT_FORBIDDEN' }),
    )

    await act(async () => {
      await result.current.save()
    })

    expect(result.current.state.saveError).toBe('Alterações estruturais não são permitidas')
    expect(result.current.state.saving).toBe(false)
    // baseRevision não avançou.
    vi.mocked(api.mergePublish).mockResolvedValueOnce({
      decorRevision: 4,
      document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }),
    })
    await act(async () => {
      await result.current.save()
    })
    expect(vi.mocked(api.mergePublish).mock.calls[1][0].baseRevision).toBe(3)
  })

  it('cancelar encerra a sessão de edição (sem lock a liberar — Task 9)', async () => {
    const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    act(() => {
      result.current.cancel()
    })
    expect(result.current.state.active).toBe(false)
    expect(scene.setEditing).toHaveBeenLastCalledWith(false)
    expect(api.releaseDecorationLock).not.toHaveBeenCalled()
  })

  it('enter() falhando ao carregar o mapa ativo mantém a sessão fechada e não entra em modo de edição', async () => {
    vi.mocked(api.getActiveMapForEditing).mockRejectedValueOnce(new Error('falha de rede'))
    const { result } = renderHook(() => useOfficeMapEditing(canvasRef, ADMIN_ACTOR))
    await act(async () => {
      await result.current.enter()
    })
    expect(result.current.state.active).toBe(false)
    expect(scene.setEditing).not.toHaveBeenCalledWith(true, expect.any(Object))
  })

  it('sai do modo de edição da cena ao desmontar com uma edição ativa', async () => {
    const { result, unmount } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    expect(result.current.state.active).toBe(true)

    unmount()

    expect(scene.setEditing).toHaveBeenLastCalledWith(false)
  })

  it('setTool escolhe o modo da cena por ferramenta: link → point, área → rect, mobília/borracha → object', () => {
    const { result } = renderHook(() => useOfficeMapEditing(canvasRef, ADMIN_ACTOR))

    act(() => result.current.setTool('link'))
    expect(scene.setEditMode).toHaveBeenLastCalledWith('point')

    act(() => result.current.setTool('silence-zone'))
    expect(scene.setEditMode).toHaveBeenLastCalledWith('rect')

    act(() => result.current.setTool('brush'))
    expect(scene.setEditMode).toHaveBeenLastCalledWith('object')

    act(() => result.current.setTool('eraser'))
    expect(scene.setEditMode).toHaveBeenLastCalledWith('object')
  })

  it('link coloca via onPointPlace (single-shot), não via onTilePaint (bugfix double-fire)', async () => {
    vi.mocked(api.getActiveMapForEditing).mockResolvedValue(
      activeMapFor(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })),
    )
    const { result } = renderHook(() => useOfficeMapEditing(canvasRef, ADMIN_ACTOR))
    await act(async () => {
      await result.current.enter()
    })
    act(() => result.current.setTool('link'))

    const callbacks = scene.setEditing.mock.calls[0][1]
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockReturnValueOnce('Rótulo')
      .mockReturnValueOnce('https://example.com')

    // `onTilePaint` repete no pointermove — não pode disparar o prompt do link.
    act(() => callbacks.onTilePaint(1, 1))
    expect(promptSpy).not.toHaveBeenCalled()
    expect(result.current.state.dirty).toBe(false)

    // `onPointPlace` é o caminho single-shot (chamado uma vez pelo pointerdown).
    act(() => callbacks.onPointPlace({ col: 1, row: 1 }))
    expect(promptSpy).toHaveBeenCalledTimes(2)
    expect(result.current.state.dirty).toBe(true)

    promptSpy.mockRestore()
  })

  describe('ferramenta de seleção', () => {
    it('clicar num objeto seleciona só o GRUPO clicado', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      act(() => {
        result.current.setTool('select')
      })
      // Clique dentro do tile (0,0) — que ocupa 0..16 em pixel neste documento.
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })

      expect(result.current.state.selection).toEqual({
        groupKey: 'pub-0-0',
        bounds: { x: 0, y: 0, width: 16, height: 16 },
        hasCollision: false,
      })
      expect(scene.setSelectionOverlay).toHaveBeenCalledWith({ x: 0, y: 0, width: 16, height: 16 })
    })

    it('clicar em outro objeto TROCA a seleção — nunca acumula os dois marcados', async () => {
      // Achado original: selecionar mais de um objeto deixava todos com o
      // destaque visual. A ferramenta agora só sabe selecionar um grupo por
      // vez — clicar no segundo objeto substitui a seleção do primeiro.
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0], [2, 2]]))
      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })
      expect(result.current.state.selection?.groupKey).toBe('pub-0-0')

      act(() => {
        callbacks.onObjectPointerDown(40, 40)
      })
      expect(result.current.state.selection).toEqual({
        groupKey: 'pub-2-2',
        bounds: { x: 32, y: 32, width: 16, height: 16 },
        hasCollision: false,
      })
      // O overlay da cena também trocou — não há um segundo overlay para o
      // objeto anterior, só a última chamada é o que fica de pé.
      expect(scene.setSelectionOverlay).toHaveBeenLastCalledWith({ x: 32, y: 32, width: 16, height: 16 })
    })

    it('clicar em espaço vazio limpa a seleção', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })
      expect(result.current.state.selection).not.toBeNull()

      act(() => {
        callbacks.onObjectPointerDown(140, 140)
      })
      expect(result.current.state.selection).toBeNull()
      expect(scene.setSelectionOverlay).toHaveBeenLastCalledWith(null)
    })

    it('limpar a seleção apaga o overlay da cena', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })
      act(() => {
        result.current.clearSelection()
      })
      expect(result.current.state.selection).toBeNull()
      expect(scene.setSelectionOverlay).toHaveBeenLastCalledWith(null)
    })

    it('selecionar não abre passo de desfazer nem suja a sessão', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })
      expect(result.current.state.dirty).toBe(false)
      expect(result.current.state.canUndo).toBe(false)
    })

    it('sobrevive ao desfazer: repaintOverlays redesenha a seleção em vez de deixá-la sumir com discardLocalEdits', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))

      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })
      expect(result.current.state.selection).toEqual({
        groupKey: 'pub-0-0',
        bounds: { x: 0, y: 0, width: 16, height: 16 },
        hasCollision: false,
      })

      // Faz outra edição qualquer que abra um passo de desfazer (pintar).
      pickTile(result)
      await stroke(callbacks, [[5, 5]])
      expect(result.current.state.canUndo).toBe(true)

      // `repaintOverlays` começa chamando `discardLocalEdits`, que apaga TODOS
      // os overlays da cena — inclusive o retângulo de seleção. Limpa o mock
      // aqui para provar que, DEPOIS do undo, a seleção é redesenhada de
      // verdade, e não que a chamada original acima ainda está "pendurada".
      scene.setSelectionOverlay.mockClear()

      await act(async () => {
        await result.current.undo()
      })

      // A seleção continua ativa no estado do hook...
      expect(result.current.state.selection).toEqual({
        groupKey: 'pub-0-0',
        bounds: { x: 0, y: 0, width: 16, height: 16 },
        hasCollision: false,
      })
      // ...e o overlay foi redesenhado por último com a bbox da seleção — não
      // ficou `null` (apagado por `discardLocalEdits` e nunca redesenhado).
      expect(scene.setSelectionOverlay).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 16, height: 16 })
    })
  })

  describe('girar e espelhar', () => {
    /** Documento com um GRUPO de mobília JÁ PUBLICADO (ids `<groupId>__dc-dr`, tiles de 16px). */
    function docWithGroup(groupId: string, originCol: number, originRow: number, cells: [number, number][]) {
      const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 16 })
      doc.tilesets = [
        { id: 'ts', assetId: OFFICE_TILESET_CATALOG[0].assetId, name: 'T', tileWidth: 16, tileHeight: 16, columns: 8, tileCount: 64 },
      ]
      doc.objects = cells.map(([dc, dr]) => ({
        id: `${groupId}__${dc}-${dr}`,
        layerKey: 'objects',
        type: 'tile-object',
        geometry: { kind: 'rectangle', x: (originCol + dc) * 16, y: (originRow + dr) * 16, width: 16, height: 16 },
        properties: { tilesetId: 'ts', tileIndex: 0 },
      }))
      return doc
    }

    function selectAt(callbacks: any, result: any, x: number, y: number) {
      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(x, y)
      })
    }

    it('gira o objeto selecionado, redesenha o sprite e esconde o publicado antigo', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))

      selectAt(callbacks, result, 8, 8)
      act(() => {
        result.current.rotateSelection('cw')
      })

      expect(scene.setPublishedObjectVisible).not.toHaveBeenCalled()
      expect(scene.hidePublishedObject).toHaveBeenCalledWith('pub-0-0')
      const stamp = scene.applyTileObjectStamp.mock.calls.at(-1)
      expect(stamp?.[0]).toBe('pub-0-0')
      expect(stamp?.[4]).toEqual({ rotation: 90, flipX: false })
    })

    it('recusa na borda com mensagem e não suja a sessão', async () => {
      // Grupo 1×4 encostado na coluna 0 giraria para 4×1 começando em x=-24.
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const doc = docWithGroup('grp-a', 0, 0, [[0, 0], [0, 1], [0, 2], [0, 3]])
      const { result, callbacks } = await enterSession(doc)

      selectAt(callbacks, result, 8, 8)
      act(() => {
        result.current.rotateSelection('cw')
      })

      expect(result.current.state.limitError).toBe('Não há espaço para girar aqui.')
      expect(result.current.state.dirty).toBe(false)
    })

    it('reancora a seleção na nova bbox depois de girar', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const doc = docWithGroup('grp-a', 2, 2, [[0, 0], [1, 0]])
      const { result, callbacks } = await enterSession(doc)

      selectAt(callbacks, result, 40, 40)
      expect(result.current.state.selection?.bounds).toEqual({ x: 32, y: 32, width: 32, height: 16 })

      act(() => {
        result.current.rotateSelection('cw')
      })

      // Bbox 32×16 gira para 16×32 em torno do mesmo centro (48, 40):
      // nova origem (48-8, 40-16) = (40, 24) — mesma matemática do
      // `rotateGroupInPlace` (ver decorationDoc.test.ts).
      expect(result.current.state.selection).toEqual({
        groupKey: 'grp-a',
        bounds: { x: 40, y: 24, width: 16, height: 32 },
        hasCollision: false,
      })
      expect(result.current.state.dirty).toBe(true)
      expect(result.current.state.canUndo).toBe(true)
    })

    it('duas rotações seguidas (R apertado duas vezes) aplicam as DUAS — não há mais corrida de await entre elas', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const doc = docWithGroup('grp-a', 2, 2, [[0, 0], [1, 0]])
      const { result, callbacks } = await enterSession(doc)

      selectAt(callbacks, result, 40, 40)
      act(() => {
        result.current.rotateSelection('cw')
        result.current.rotateSelection('cw')
      })

      // Duas rotações de um grupo 2×1 = 180°, e a bbox volta à original.
      expect(result.current.state.selection?.bounds).toEqual({ x: 32, y: 32, width: 32, height: 16 })

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const byId = Object.fromEntries(sent.objects.map((o: any) => [o.id, o]))
      expect(byId['grp-a__0-0'].properties.rotation).toBe(180)
      expect(byId['grp-a__1-0'].properties.rotation).toBe(180)
    })

    it('espelhar um grupo que sumiu (apagado por outra sessão) é no-op silencioso', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))

      selectAt(callbacks, result, 8, 8)
      expect(result.current.state.selection).not.toBeNull()

      // Apaga a mesma peça por outra ferramenta — a seleção não é limpa
      // automaticamente (o objeto pode ter sido removido por outro editor
      // colaborativo), então `flipSelection` precisa lidar com a referência
      // órfã em silêncio, em vez de quebrar.
      act(() => {
        result.current.setTool('eraser')
      })
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })
      expect(result.current.state.dirty).toBe(true)
      const dirtyAfterErase = result.current.state.dirty

      act(() => {
        result.current.flipSelection('horizontal')
      })
      expect(result.current.state.dirty).toBe(dirtyAfterErase)
      expect(result.current.state.limitError).toBeNull()
    })

    it('salvar limpa a seleção mas mantém a sessão de edição aberta', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const doc = docWithGroup('grp-a', 2, 2, [[0, 0], [1, 0]])
      const { result, callbacks } = await enterSession(doc)

      selectAt(callbacks, result, 40, 40)
      act(() => {
        result.current.rotateSelection('cw')
      })
      expect(result.current.state.selection).not.toBeNull()

      await act(async () => {
        await result.current.save()
      })

      // Seleção some (estado + overlay da cena) depois de um save bem-sucedido...
      expect(result.current.state.selection).toBeNull()
      expect(scene.setSelectionOverlay).toHaveBeenLastCalledWith(null)
      // ...mas a sessão de edição continua ativa: salvar não fecha o editor.
      expect(result.current.state.active).toBe(true)
    })
  })

  describe('ordem de camadas da mobília', () => {
    function selectAt(callbacks: any, result: any, x: number, y: number) {
      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(x, y)
      })
    }

    it('manda a peça selecionada para trás, sincroniza o preview e persiste a nova ordem', async () => {
      const doc = docWithFurniture([[0, 0], [0, 0]])
      doc.objects[0].id = 'tapete'
      doc.objects[1].id = 'mesa'
      const { result, callbacks } = await enterSession(doc)

      // O hit-test pega o topo da célula: "mesa", último item do documento.
      selectAt(callbacks, result, 8, 8)
      expect(result.current.state.selection?.groupKey).toBe('mesa')

      act(() => {
        result.current.reorderSelection('back')
      })

      expect(result.current.state.dirty).toBe(true)
      expect(result.current.state.canUndo).toBe(true)
      expect(scene.syncTileObjectOrder).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'mesa' }),
        expect.objectContaining({ id: 'tapete' }),
      ])

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document
      expect(sent.objects.filter((object) => object.type === 'tile-object').map((object) => object.id)).toEqual([
        'mesa',
        'tapete',
      ])
    })

    it('desfazer restaura a ordem anterior também no preview', async () => {
      const doc = docWithFurniture([[0, 0], [1, 0], [2, 0]])
      const { result, callbacks } = await enterSession(doc)
      selectAt(callbacks, result, 8, 8)

      act(() => {
        result.current.reorderSelection('front')
      })
      await act(async () => {
        await result.current.undo()
      })

      expect(result.current.state.dirty).toBe(false)
      expect(scene.syncTileObjectOrder).toHaveBeenLastCalledWith(doc.objects)
    })

    it('não suja a sessão nem cria undo quando a peça já está no extremo pedido', async () => {
      const doc = docWithFurniture([[0, 0], [1, 0]])
      const { result, callbacks } = await enterSession(doc)
      selectAt(callbacks, result, 8, 8)

      act(() => {
        result.current.reorderSelection('back')
      })

      expect(result.current.state.dirty).toBe(false)
      expect(result.current.state.canUndo).toBe(false)
      expect(scene.syncTileObjectOrder).not.toHaveBeenCalled()
    })
  })

  describe('removeSelectionCollision (remover colisão da mobília selecionada)', () => {
    /**
     * Documento com um GRUPO de mobília + colisão pareada (id `<groupId>__collision`).
     * `furnitureCreatedBy`/`collisionCreatedBy` são independentes de propósito: os
     * testes de proteção precisam que a mobília seja selecionável (`selectGroup`
     * só olha os `tile-object`) enquanto só a COLISÃO fica protegida — ou vice-versa.
     */
    function docWithGroupAndCollision(
      groupId: string,
      originCol: number,
      originRow: number,
      cells: [number, number][],
      collisionCreatedBy: { id: string; role: string } | null = null,
      furnitureCreatedBy: { id: string; role: string } | null = { id: 'bob', role: 'LEGEND' },
    ) {
      const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 16 })
      doc.tilesets = [
        { id: 'ts', assetId: OFFICE_TILESET_CATALOG[0].assetId, name: 'T', tileWidth: 16, tileHeight: 16, columns: 8, tileCount: 64 },
      ]
      const cols = Math.max(...cells.map(([dc]) => dc)) + 1
      const rows = Math.max(...cells.map(([, dr]) => dr)) + 1
      doc.objects = [
        ...cells.map(([dc, dr]) => ({
          id: `${groupId}__${dc}-${dr}`,
          layerKey: 'objects',
          type: 'tile-object',
          geometry: { kind: 'rectangle', x: (originCol + dc) * 16, y: (originRow + dr) * 16, width: 16, height: 16 },
          properties: { tilesetId: 'ts', tileIndex: 0 },
          createdBy: furnitureCreatedBy,
        })),
        {
          id: `${groupId}__collision`,
          layerKey: 'collision',
          type: 'collision',
          geometry: { kind: 'rectangle', x: originCol * 16, y: originRow * 16, width: cols * 16, height: rows * 16 },
          properties: {},
          createdBy: collisionCreatedBy,
        },
      ]
      return doc
    }

    function selectAt(callbacks: any, result: any, x: number, y: number) {
      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(x, y)
      })
    }

    it('marca a seleção com hasCollision quando o grupo tem colisão pareada', async () => {
      const doc = docWithGroupAndCollision('grp-a', 0, 0, [[0, 0]], { id: 'bob', role: 'LEGEND' })
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      selectAt(callbacks, result, 8, 8)
      expect(result.current.state.selection?.hasCollision).toBe(true)
    })

    it('remove só a colisão pareada, mantendo os tile-objects visuais', async () => {
      const doc = docWithGroupAndCollision('grp-a', 0, 0, [[0, 0]], { id: 'bob', role: 'LEGEND' })
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      selectAt(callbacks, result, 8, 8)
      act(() => {
        result.current.removeSelectionCollision()
      })

      expect(result.current.state.selection).toEqual({
        groupKey: 'grp-a',
        bounds: { x: 0, y: 0, width: 16, height: 16 },
        hasCollision: false,
      })
      expect(result.current.state.dirty).toBe(true)
      expect(result.current.state.limitError).toBeNull()

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.type === 'collision')).toBe(false)
      expect(sent.objects.some((o: any) => o.id === 'grp-a__0-0')).toBe(true)
    })

    it('comum: recusa remover colisão protegida (legada, sem createdBy) e não muda o documento', async () => {
      const doc = docWithGroupAndCollision('grp-a', 0, 0, [[0, 0]], null)
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      selectAt(callbacks, result, 8, 8)
      act(() => {
        result.current.removeSelectionCollision()
      })

      expect(result.current.state.limitError).toBe(
        'Essa peça não tem autor registrado (foi adicionada antes deste controle) e por segurança não pode ter a colisão removida.',
      )
      expect(result.current.state.selection?.hasCollision).toBe(true)
      expect(result.current.state.dirty).toBe(false)
    })

    it('comum: recusa remover colisão de peça carimbada como do admin', async () => {
      const doc = docWithGroupAndCollision('grp-a', 0, 0, [[0, 0]], { id: 'admin-1', role: 'ADMIN' })
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      selectAt(callbacks, result, 8, 8)
      act(() => {
        result.current.removeSelectionCollision()
      })

      expect(result.current.state.limitError).toBe('Essa peça foi criada pelo admin e não pode ter a colisão removida.')
      expect(result.current.state.selection?.hasCollision).toBe(true)
    })

    it('admin: remove colisão legada (sem createdBy) sem restrição', async () => {
      const doc = docWithGroupAndCollision('grp-a', 0, 0, [[0, 0]], null)
      const { result, callbacks } = await enterSession(doc, 3, ADMIN_ACTOR)

      selectAt(callbacks, result, 8, 8)
      act(() => {
        result.current.removeSelectionCollision()
      })

      expect(result.current.state.selection?.hasCollision).toBe(false)
      expect(result.current.state.dirty).toBe(true)
    })

    it('sem colisão pareada, é no-op silencioso', async () => {
      const doc = docWithGroupAndCollision('grp-a', 0, 0, [[0, 0]])
      doc.objects = doc.objects.filter((o: any) => o.type !== 'collision')
      const { result, callbacks } = await enterSession(doc, 3, MEMBER_ACTOR)

      selectAt(callbacks, result, 8, 8)
      expect(result.current.state.selection?.hasCollision).toBe(false)
      act(() => {
        result.current.removeSelectionCollision()
      })

      expect(result.current.state.dirty).toBe(false)
      expect(result.current.state.limitError).toBeNull()
    })
  })

  describe('desfazer', () => {
    const PRISTINE = () => createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })

    async function enterEditing() {
      vi.mocked(api.getActiveMapForEditing).mockResolvedValue(activeMapFor(PRISTINE()))
      const { result } = renderHook(() => useOfficeMapEditing(canvasRef, ADMIN_ACTOR))
      await act(async () => {
        await result.current.enter()
      })
      const callbacks = scene.setEditing.mock.calls[0][1]
      return { result, callbacks }
    }

    /** Pincela um traço arrastado: um `onStrokeStart` seguido de N células. */
    async function paintStroke(callbacks: any, cells: [number, number][]) {
      await act(async () => {
        callbacks.onStrokeStart()
        for (const [col, row] of cells) callbacks.onTilePaint(col, row)
      })
    }

    it('agrupa a pincelada arrastada num único passo — um desfazer limpa o traço inteiro', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterEditing()
      act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' }))

      await paintStroke(callbacks, [
        [1, 1],
        [1, 2],
        [1, 3],
      ])
      expect(result.current.state.dirty).toBe(true)
      expect(result.current.state.canUndo).toBe(true)

      // UM desfazer volta ao estado inicial: as 3 células do arraste são um só passo.
      await act(async () => {
        await result.current.undo()
      })
      expect(result.current.state.canUndo).toBe(false)
      expect(result.current.state.dirty).toBe(false)
      // Os overlays são recalculados por diff, não desfeitos operação a operação.
      expect(scene.discardLocalEdits).toHaveBeenCalled()
    })

    it('desfaz traços independentes na ordem inversa', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterEditing()
      act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' }))

      await paintStroke(callbacks, [[1, 1]])
      await paintStroke(callbacks, [[2, 2]])

      await act(async () => {
        await result.current.undo()
      })
      // Ainda resta o primeiro traço.
      expect(result.current.state.canUndo).toBe(true)
      expect(result.current.state.dirty).toBe(true)

      await act(async () => {
        await result.current.undo()
      })
      expect(result.current.state.canUndo).toBe(false)
      expect(result.current.state.dirty).toBe(false)
    })

    it('restaura o documento de verdade: salvar após desfazer publica o documento pristino', async () => {
      vi.mocked(api.mergePublish).mockResolvedValue({ decorRevision: 4, document: PRISTINE() })
      const { result, callbacks } = await enterEditing()
      act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' }))

      await paintStroke(callbacks, [[1, 1]])
      await act(async () => {
        await result.current.undo()
      })
      await act(async () => {
        await result.current.save()
      })

      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document
      const objects = sent.layers.find((l) => l.key === 'objects')
      expect(objects?.type).toBe('tile')
      expect((objects as { data: (string | null)[] }).data.every((cell) => cell === null)).toBe(true)
    })

    it('um clique que não pinta nada não vira passo de desfazer', async () => {
      const { result, callbacks } = await enterEditing()
      // Sem tile escolhido no palette, `paintAt` sai cedo e nada muda.
      await paintStroke(callbacks, [[1, 1]])
      expect(result.current.state.canUndo).toBe(false)
      expect(result.current.state.dirty).toBe(false)
    })

    it('Ctrl+Z desfaz enquanto a edição está ativa', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterEditing()
      act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' }))
      await paintStroke(callbacks, [[1, 1]])
      expect(result.current.state.canUndo).toBe(true)

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
      })
      expect(result.current.state.canUndo).toBe(false)
    })

    it('não sequestra Ctrl+Z fora do modo de edição', async () => {
      const { result } = renderHook(() => useOfficeMapEditing(canvasRef, ADMIN_ACTOR))
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
      })
      expect(scene.discardLocalEdits).not.toHaveBeenCalled()
      expect(result.current.state.canUndo).toBe(false)
    })
  })

  // Achado Important (cobertura): R/Shift+R/H/V/Esc só tinham testes chamando
  // `rotateSelection`/`flipSelection` diretamente — o guard de foco (INPUT/
  // TEXTAREA/contentEditable) e o guard de modificadores (Ctrl/Cmd/Alt) nunca
  // eram exercitados por um `KeyboardEvent` de verdade. Segue o mesmo padrão
  // dos testes de Ctrl+Z acima (`window.dispatchEvent`).
  describe('atalhos de teclado da seleção (R/Shift+R/H/V/Esc)', () => {
    const selectFirstAt = async (result: any, callbacks: any) => {
      act(() => {
        result.current.setTool('select')
      })
      act(() => {
        callbacks.onObjectPointerDown(8, 8)
      })
    }

    it('R com seleção ativa gira a mobília (muda de orientação) SEM precisar segurar o mouse', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)

      // Nenhum pointerdown/pointermove de mobília em voo — só o clique de
      // seleção acima, já solto. R sozinho precisa bastar.
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
      })

      const stamp = scene.applyTileObjectStamp.mock.calls.at(-1)
      expect(stamp?.[0]).toBe('pub-0-0')
      expect(stamp?.[4]).toEqual({ rotation: 90, flipX: false })
    })

    it('Shift+R gira no sentido oposto ao de R', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }))
      })

      const stamp = scene.applyTileObjectStamp.mock.calls.at(-1)
      expect(stamp?.[4]).toEqual({ rotation: 270, flipX: false })
    })

    it('Esc limpa a seleção', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)
      expect(result.current.state.selection).not.toBeNull()

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })

      expect(result.current.state.selection).toBeNull()
      expect(scene.setSelectionOverlay).toHaveBeenLastCalledWith(null)
    })

    it('Del apaga o objeto selecionado (publicado esconde o sprite) e limpa a seleção', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
      })

      expect(scene.hidePublishedObject).toHaveBeenCalledWith('pub-0-0')
      expect(result.current.state.selection).toBeNull()
      expect(result.current.state.dirty).toBe(true)

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'pub-0-0')).toBe(false)
    })

    it('Backspace faz o mesmo que Del', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }))
      })

      expect(scene.hidePublishedObject).toHaveBeenCalledWith('pub-0-0')
      expect(result.current.state.selection).toBeNull()
    })

    it('não dispara a operação quando o foco está num INPUT (a paleta do drawer tem campos)', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      try {
        await act(async () => {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
        })
        expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()
        // A seleção continua a mesma — o atalho nem chegou a rodar.
        expect(result.current.state.selection?.groupKey).toBe('pub-0-0')
      } finally {
        document.body.removeChild(input)
      }
    })

    it('Ctrl+R não dispara a rotação — colidiria com o atalho de desfazer', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }))
      })

      expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()
      expect(result.current.state.selection?.groupKey).toBe('pub-0-0')
    })

    it('Cmd+R (metaKey, o modificador do macOS) não dispara a rotação', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', metaKey: true }))
      })

      expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()
      expect(result.current.state.selection?.groupKey).toBe('pub-0-0')
    })

    it('Alt+R não dispara a rotação', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(docWithFurniture([[0, 0]]))
      await selectFirstAt(result, callbacks)

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', altKey: true }))
      })

      expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()
      expect(result.current.state.selection?.groupKey).toBe('pub-0-0')
    })
  })

  describe('mobília livre (modo object)', () => {
    // Placement é assíncrono (carrega o asset builtin) — drena os microtasks.
    const flush = () => act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    /** Mapa 10x10 tile48 com uma peça JÁ PUBLICADA (id `pub1`) em (96,96). */
    const withPublished = () => {
      const d = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
      return {
        ...d,
        tilesets: [{ id: 'ts', assetId: 'a', name: 'X', tileWidth: 48, tileHeight: 48, columns: 4, tileCount: 16 }],
        objects: [
          ...d.objects,
          {
            id: 'pub1',
            layerKey: 'objects',
            type: 'tile-object',
            geometry: { kind: 'rectangle', x: 96, y: 96, width: 48, height: 48 },
            properties: { tilesetId: 'ts', tileIndex: 5 },
          },
        ],
      } as any
    }

    it('coloca a peça no pixel do cursor (fora da grade) e a arrasta no mesmo gesto', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
      pickTile(result)

      // Down em área vazia coloca uma peça centrada no cursor e já a agarra.
      await act(async () => callbacks.onObjectPointerDown(200, 200))
      await flush()
      expect(scene.applyTileObjectStamp).toHaveBeenCalled()
      expect(result.current.state.dirty).toBe(true)

      // Arrasta para um ponto que NÃO cai na grade e solta.
      act(() => callbacks.onObjectPointerMove(241, 259, true))
      act(() => callbacks.onObjectPointerUp())

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const pieces = sent.objects.filter((o: any) => o.type === 'tile-object')
      expect(pieces).toHaveLength(1)
      const g = pieces[0].geometry
      // O centro da peça segue o cursor…
      expect(g.x + g.width / 2).toBe(241)
      expect(g.y + g.height / 2).toBe(259)
      // …e a posição resultante não está alinhada ao tile (posição livre).
      expect(g.x % sent.map.tileWidth).not.toBe(0)
    })

    it('arrastar uma peça JÁ PUBLICADA esconde o sprite antigo e a reposiciona', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(withPublished())

      // Agarra a peça publicada (110,110 cai dentro de 96..144) e arrasta.
      act(() => callbacks.onObjectPointerDown(110, 110))
      act(() => callbacks.onObjectPointerMove(130, 130, true))
      act(() => callbacks.onObjectPointerUp())

      expect(scene.hidePublishedObject).toHaveBeenCalledWith('pub1')

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const moved = sent.objects.find((o: any) => o.id === 'pub1')
      // O arraste preserva o offset do grab: cursor moveu +20 (110→130), então a
      // peça (centro original 120) vai para 140 em cada eixo.
      expect(moved.geometry.x + moved.geometry.width / 2).toBe(140)
      expect(moved.geometry.y + moved.geometry.height / 2).toBe(140)
    })

    it('borracha por objeto: hover realça o item, clique exclui a peça publicada', async () => {
      const { result, callbacks } = await enterSession(withPublished())
      act(() => result.current.setTool('eraser'))

      // Hover sobre a peça: realça o bbox dela; hover no vazio: limpa.
      act(() => callbacks.onObjectPointerMove(110, 110, false))
      expect(scene.setEraseHover).toHaveBeenLastCalledWith({ x: 96, y: 96, width: 48, height: 48 })
      act(() => callbacks.onObjectPointerMove(400, 400, false))
      expect(scene.setEraseHover).toHaveBeenLastCalledWith(null)

      // Clique exclui a peça publicada — esconde o sprite e some do documento.
      act(() => callbacks.onObjectPointerDown(110, 110))
      expect(scene.hidePublishedObject).toHaveBeenCalledWith('pub1')
      expect(result.current.state.dirty).toBe(true)

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.some((o: any) => o.id === 'pub1')).toBe(false)
    })

    it('borracha por objeto: peça colocada NESTA sessão some pela estampa (não esconde publicada)', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
      pickTile(result)
      await act(async () => callbacks.onObjectPointerDown(200, 200))
      await flush()
      act(() => callbacks.onObjectPointerUp())

      act(() => result.current.setTool('eraser'))
      scene.hidePublishedObject.mockClear()
      act(() => callbacks.onObjectPointerDown(200, 200))

      expect(scene.removeTileObjectStamp).toHaveBeenCalled()
      expect(scene.hidePublishedObject).not.toHaveBeenCalled()

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(0)
    })

    it('"Limpar tudo" remove só a mobília da sessão; a publicada permanece', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      // Draft já com uma peça publicada (pub1) + uma colocada nesta sessão.
      const { result, callbacks } = await enterSession(withPublished())
      act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' }))
      await act(async () => callbacks.onObjectPointerDown(300, 300))
      await flush()
      act(() => callbacks.onObjectPointerUp())

      act(() => result.current.clearAllFurniture())
      // Um passo de desfazer; a publicada NÃO é tocada (só a estampa da sessão sai).
      expect(scene.hidePublishedObject).not.toHaveBeenCalled()
      expect(scene.removeTileObjectStamp).toHaveBeenCalled()
      expect(result.current.state.canUndo).toBe(true)
      expect(result.current.state.dirty).toBe(true)

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const furniture = sent.objects.filter((o: any) => o.type === 'tile-object')
      // Só a peça publicada sobrou; a da sessão foi limpa.
      expect(furniture.map((o: any) => o.id)).toEqual(['pub1'])
    })

    it('mostra o fantasma do asset ao selecionar e o remove ao trocar pra borracha', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))

      await act(async () => {
        result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' })
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(scene.setPlacementPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slices: expect.arrayContaining([expect.objectContaining({ textureKey: 'tex', frameKey: 'f' })]),
        }),
      )

      scene.setPlacementPreview.mockClear()
      await act(async () => {
        result.current.setTool('eraser')
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(scene.setPlacementPreview).toHaveBeenLastCalledWith(null)
    })

    it('asset fatiado (1x2) coloca os slices alinhados como grupo e arrasta junto', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
      // Seleção 1x2: duas fatias verticais (encosto + assento).
      act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 2, category: 'Mesa' }))

      await act(async () => callbacks.onObjectPointerDown(200, 200))
      await flush()
      act(() => callbacks.onObjectPointerMove(250, 270, true))
      act(() => callbacks.onObjectPointerUp())

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const pieces = sent.objects.filter((o: any) => o.type === 'tile-object')
      expect(pieces).toHaveLength(2)
      // Mesmo grupo (id `<grupo>:<dc>-<dr>`).
      expect(new Set(pieces.map((o: any) => o.id.split('__')[0])).size).toBe(1)
      // Alinhados: mesmo x, y separados por exatamente um tile — o arraste
      // preservou o offset interno (não desalinhou).
      const [top, bottom] = [...pieces].sort((a: any, b: any) => a.geometry.y - b.geometry.y)
      expect(top.geometry.x).toBe(bottom.geometry.x)
      expect(bottom.geometry.y - top.geometry.y).toBe(top.geometry.height)
    })

    it('borracha apaga o asset fatiado inteiro ao clicar em qualquer slice', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
      act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 2, category: 'Mesa' }))
      await act(async () => callbacks.onObjectPointerDown(200, 200))
      await flush()
      act(() => callbacks.onObjectPointerUp())

      act(() => result.current.setTool('eraser'))
      // Clica no slice de baixo — o grupo inteiro (2 slices) some.
      act(() => callbacks.onObjectPointerDown(200, 205))

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(0)
    })

    it('desfazer o arraste devolve a peça à posição de colocação', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
      pickTile(result)

      await act(async () => callbacks.onObjectPointerDown(200, 200))
      await flush()
      act(() => callbacks.onObjectPointerMove(241, 259, true))
      act(() => callbacks.onObjectPointerUp())

      // Um desfazer reverte só o arraste — a colocação (centro 200,200) permanece.
      await act(async () => {
        await result.current.undo()
      })
      expect(result.current.state.canUndo).toBe(true)

      await act(async () => {
        await result.current.save()
      })
      const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
      const pieces = sent.objects.filter((o: any) => o.type === 'tile-object')
      expect(pieces).toHaveLength(1)
      expect(pieces[0].geometry.x + pieces[0].geometry.width / 2).toBe(200)
      expect(pieces[0].geometry.y + pieces[0].geometry.height / 2).toBe(200)
    })

    // Review PR 10555 (mobília livre) — itens do gabriel.serrano.
    describe('review PR 10555', () => {
      it('com asset selecionado, clicar sobre mobília existente EMPILHA em vez de agarrar (item "sobrepor")', async () => {
        scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
        const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
        pickTile(result)
        // Coloca a primeira peça (ex.: mesa) e solta.
        await act(async () => callbacks.onObjectPointerDown(200, 200))
        await flush()
        act(() => callbacks.onObjectPointerUp())

        // Escolhe outro asset (ex.: monitor) e clica EM CIMA da peça recém-colocada.
        act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 1, row: 0, cols: 1, rows: 1, category: 'Mesa' }))
        await act(async () => callbacks.onObjectPointerDown(200, 200))
        await flush()
        act(() => callbacks.onObjectPointerUp())

        await act(async () => {
          await result.current.save()
        })
        const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
        const pieces = sent.objects.filter((o: any) => o.type === 'tile-object')
        // Duas peças distintas na mesma posição — a segunda empilhou por cima,
        // em vez de "roubar" o clique para arrastar a primeira.
        expect(pieces).toHaveLength(2)
      })

      it('Esc solta o asset selecionado — volta o clique ao modo "mover" (item "cursor normal")', async () => {
        const { result, callbacks } = await enterSession(withPublished())
        pickTile(result)
        expect(result.current.state.selectedTile).not.toBeNull()

        act(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        })
        expect(result.current.state.selectedTile).toBeNull()

        // Com nada selecionado, clicar sobre a peça publicada AGARRA (não
        // coloca uma nova) — só `hidePublishedObject` no grab, sem estampa nova.
        scene.applyTileObjectStamp.mockClear()
        act(() => callbacks.onObjectPointerDown(110, 110))
        expect(scene.applyTileObjectStamp).not.toHaveBeenCalled()
      })

      it('clearSelectedTile zera a seleção e o fantasma de colocação', async () => {
        const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
        pickTile(result)
        act(() => result.current.clearSelectedTile())
        expect(result.current.state.selectedTile).toBeNull()
        expect(scene.setPlacementPreview).toHaveBeenLastCalledWith(null)
      })

      it('colocar mobília de categoria bloqueante gera um objeto collision pareado (item "colisão")', async () => {
        scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
        const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
        act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' }))
        await act(async () => callbacks.onObjectPointerDown(200, 200))
        await flush()
        act(() => callbacks.onObjectPointerUp())

        await act(async () => {
          await result.current.save()
        })
        const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
        expect(sent.objects.some((o: any) => o.type === 'collision')).toBe(true)
      })

      it('colocar mobília de categoria "pra sentar/deitar/pisar" (Cadeira) NÃO gera collision — dá pra ocupar o tile dela', async () => {
        scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
        const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
        act(() =>
          result.current.selectTile({
            assetId: OFFICE_TILESET_CATALOG[0].assetId,
            col: 0,
            row: 0,
            cols: 1,
            rows: 2,
            category: 'Cadeira',
          }),
        )
        await act(async () => callbacks.onObjectPointerDown(200, 200))
        await flush()
        act(() => callbacks.onObjectPointerUp())

        await act(async () => {
          await result.current.save()
        })
        const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
        expect(sent.objects.some((o: any) => o.type === 'collision')).toBe(false)
      })

      it('colocar mobília de categoria não-bloqueante (Tapete) NÃO gera collision', async () => {
        scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
        const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
        act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Tapete' }))
        await act(async () => callbacks.onObjectPointerDown(200, 200))
        await flush()
        act(() => callbacks.onObjectPointerUp())

        await act(async () => {
          await result.current.save()
        })
        const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
        expect(sent.objects.some((o: any) => o.type === 'collision')).toBe(false)
      })

      it('"Limpar tudo" também remove a collision pareada da mobília da sessão', async () => {
        scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
        const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
        act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1, category: 'Mesa' }))
        await act(async () => callbacks.onObjectPointerDown(200, 200))
        await flush()
        act(() => callbacks.onObjectPointerUp())

        act(() => result.current.clearAllFurniture())

        await act(async () => {
          await result.current.save()
        })
        const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
        expect(sent.objects.some((o: any) => o.type === 'tile-object' || o.type === 'collision')).toBe(false)
      })

      it('R gira o grupo agarrado durante o arraste (item "rotação no R")', async () => {
        scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
        const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
        // Asset fatiado 1x2 — dá pra ver a bbox trocar de forma (48x96 → 96x48).
        act(() => result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 2, category: 'Mesa' }))

        await act(async () => callbacks.onObjectPointerDown(200, 200))
        await flush()
        // Ainda "segurando" o grupo (a colocação já agarra para o mesmo gesto).
        act(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
        })
        act(() => callbacks.onObjectPointerUp())

        await act(async () => {
          await result.current.save()
        })
        const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
        const pieces = sent.objects.filter((o: any) => o.type === 'tile-object')
        expect(pieces).toHaveLength(2)
        for (const piece of pieces) expect(piece.properties.rotation).toBe(90)
      })

      it('clicar numa peça (ferramenta padrão, sem precisar de "Girar") seleciona no soltar — R gira na hora', async () => {
        scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
        const { result, callbacks } = await enterSession(withPublished())

        // Clique solto (down + up), sem trocar de ferramenta — o tool segue 'brush'.
        act(() => callbacks.onObjectPointerDown(110, 110))
        expect(result.current.state.selection).toBeNull() // ainda arrastando, overlay não acompanha
        act(() => callbacks.onObjectPointerUp())
        expect(result.current.state.selection).toEqual({
          groupKey: 'pub1',
          bounds: { x: 96, y: 96, width: 48, height: 48 },
          hasCollision: false,
        })

        await act(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
        })

        const stamp = scene.applyTileObjectStamp.mock.calls.at(-1)
        expect(stamp?.[0]).toBe('pub1')
        expect(stamp?.[4]).toEqual({ rotation: 90, flipX: false })
      })

      it('clicar em espaço vazio (ferramenta padrão) limpa a seleção ativa', async () => {
        const { result, callbacks } = await enterSession(withPublished())
        act(() => callbacks.onObjectPointerDown(110, 110))
        act(() => callbacks.onObjectPointerUp())
        expect(result.current.state.selection).not.toBeNull()

        act(() => callbacks.onObjectPointerDown(400, 400))
        expect(result.current.state.selection).toBeNull()
        expect(scene.setSelectionOverlay).toHaveBeenLastCalledWith(null)
      })

      it('R durante o arraste de uma peça NÃO gira também a seleção anterior (guarda contra giro duplicado)', async () => {
        scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
        const { result, callbacks } = await enterSession(docWithFurniture([[0, 0], [5, 5]]))

        // Seleciona a primeira peça com um clique solto — fica uma seleção "antiga" viva.
        act(() => callbacks.onObjectPointerDown(8, 8))
        act(() => callbacks.onObjectPointerUp())
        expect(result.current.state.selection?.groupKey).toBe('pub-0-0')

        // Agarra a SEGUNDA peça e gira ainda segurando — o atalho genérico de
        // seleção (que ainda vê a peça ANTIGA) precisa ficar de fora, senão as
        // duas peças girariam ao mesmo tempo com um único R.
        act(() => callbacks.onObjectPointerDown(88, 88))
        act(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
        })
        act(() => callbacks.onObjectPointerUp())

        await act(async () => {
          await result.current.save()
        })
        const sent = vi.mocked(api.mergePublish).mock.calls[0][0].document as any
        const byId = Object.fromEntries(sent.objects.map((o: any) => [o.id, o]))
        // A peça arrastada girou uma única vez (90°, não 180° de um disparo duplo).
        expect(byId['pub-5-5'].properties.rotation).toBe(90)
        // A peça selecionada antes do arraste ficou intocada.
        expect(byId['pub-0-0'].properties.rotation ?? 0).toBe(0)
      })
    })
  })

  describe('review PR 10555 — cancelar depois de Salvar não some com a mobília', () => {
    it('sem mudanças pendentes (logo após um Salvar), cancelar NÃO descarta as estampas locais', async () => {
      const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
      vi.mocked(api.releaseDecorationLock).mockResolvedValue(undefined)
      await act(async () => {
        await result.current.save()
      })
      expect(result.current.state.dirty).toBe(false)

      scene.discardLocalEdits.mockClear()
      act(() => result.current.cancel())
      // `!dirty` significa que tudo visível já é a verdade publicada — não há
      // nada "local" pra descartar. Descartar aqui apagaria a mobília
      // recém-salva da tela antes do WS (`map-decor-updated`) confirmar,
      // exigindo F5 pra reaparecer — exatamente o bug reportado no review.
      expect(scene.discardLocalEdits).not.toHaveBeenCalled()
      expect(result.current.state.active).toBe(false)
    })

    it('com mudanças pendentes, cancelar continua descartando as estampas locais', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
      pickTile(result)
      await stroke(callbacks, [[2, 3]])
      expect(result.current.state.dirty).toBe(true)

      scene.discardLocalEdits.mockClear()
      act(() => result.current.cancel())
      expect(scene.discardLocalEdits).toHaveBeenCalled()
    })
  })
})
