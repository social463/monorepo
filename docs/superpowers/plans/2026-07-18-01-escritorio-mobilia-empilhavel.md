# Mobília empilhável + salvar sem fechar a paleta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No editor in-place do mapa do escritório, colocar mobília sobre mobília passa a empilhar (a nova fica por cima, a de baixo permanece), e Salvar publica sem encerrar a sessão de edição.

**Architecture:** O pincel deixa de escrever na tile layer `objects` (um slot por célula, sobrescrita destrutiva) e passa a acrescentar objetos `tile-object` no array `document.objects`. Como `renderDecoration` desenha as tile layers e só depois percorre `objects` na ordem do array, o append já produz o empilhamento com o mais novo por cima — sem tocar em `zIndex`/`setDepth`. O preview da sessão de edição passa a ser indexado por id de objeto (hoje é um sprite por célula, que destrói o anterior). Em paralelo, `save()` re-ancora a sessão em vez de encerrá-la.

**Tech Stack:** TypeScript ESM strict, React 18 + hooks, Phaser 3, Zod (`@legends/shared`), Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-18-escritorio-mobilia-empilhavel-design.md`

## Global Constraints

- Branch de trabalho: `feat/escritorio-mobilia-empilhavel` (já criada, com o spec commitado).
- Mensagens voltadas ao usuário em **português**.
- TypeScript strict; nada de `any` novo no código de produção (os testes já usam `as any` nos mocks — seguir o padrão do arquivo).
- **Não editar `packages/shared/src/office-map.ts`.** O tipo `tile-object` e o limite `MAP_DOCUMENT_V1_LIMITS.maxObjects` (2000) já existem e são usados como estão.
- Nenhuma migration de banco e nenhuma mudança em `apps/api` — a mudança é toda no cliente, dentro do que o guard `assertOnlyDecorationChanged` já permite.
- Rodar testes com `pnpm --filter @legends/web test` (o web usa jsdom e **não** precisa do Postgres).
- Um commit por task.

---

### Task 1: Mutadores puros de `tile-object` em `decorationDoc`

Cria as duas funções puras que substituem `stampTile` no caminho do pincel. Nada mais consome elas ainda.

**Files:**
- Modify: `apps/web/src/office/editing/decorationDoc.ts`
- Test: `apps/web/src/office/editing/decorationDoc.test.ts`

**Interfaces:**
- Consumes: `MapDocumentV1`, `TileObjectV1` de `@legends/shared`.
- Produces:
  - `addTileObject(doc: MapDocumentV1, input: { id: string; col: number; row: number; tilesetId: string; tileIndex: number; tileWidth: number; tileHeight: number }): MapDocumentV1`
  - `removeTopTileObjectAt(doc: MapDocumentV1, col: number, row: number): { doc: MapDocumentV1; removed: TileObjectV1 | null }`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao fim do `describe('decorationDoc', ...)` em `apps/web/src/office/editing/decorationDoc.test.ts`:

```ts
  it('empilha mobília na mesma célula, preservando a de baixo e a ordem', () => {
    const d0 = base()
    const d1 = addTileObject(d0, { id: 'o1', col: 2, row: 3, tilesetId: 'ts', tileIndex: 5, tileWidth: 48, tileHeight: 48 })
    const d2 = addTileObject(d1, { id: 'o2', col: 2, row: 3, tilesetId: 'ts', tileIndex: 9, tileWidth: 48, tileHeight: 48 })
    expect(d2.objects.map((o) => o.id)).toEqual(['o1', 'o2'])
    const stacked = d2.objects.filter((o) => o.type === 'tile-object')
    expect(stacked).toHaveLength(2)
    expect(stacked[0].geometry).toEqual({ kind: 'rectangle', x: 96, y: 144, width: 48, height: 48 })
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
```

E troque a linha de import do topo do arquivo por:

```ts
import {
  addRectObject,
  addTileObject,
  ensureBuiltinTileset,
  pruneUnusedTilesets,
  removeObjectAt,
  removeTopTileObjectAt,
  stampTile,
  tileIndex,
} from './decorationDoc'
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @legends/web test -- decorationDoc`
Expected: FAIL — `addTileObject is not a function` / `removeTopTileObjectAt is not a function`.

- [ ] **Step 3: Implementar**

Em `apps/web/src/office/editing/decorationDoc.ts`, troque a linha 1 (import) por:

```ts
import { builtinTilesetAsset, type MapDocumentV1, type MapObjectV1, type MapTileSize, type TileObjectV1 } from '@legends/shared'
```

E acrescente logo abaixo de `stampTile` (após a linha 46):

```ts
/**
 * Acrescenta uma peça de mobília como `tile-object` no fim de `doc.objects`.
 *
 * É o que permite EMPILHAR: a tile layer `objects` tem um slot por célula
 * (`stampTile` sobrescreve), enquanto `doc.objects` é uma lista. Como
 * `renderDecoration` desenha as tile layers primeiro e depois percorre
 * `objects` na ordem do array, quem entra por último é desenhado por último —
 * ou seja, fica por cima. Sem mexer em `zIndex`/`setDepth`.
 *
 * `width`/`height` vêm do TILESET (não do mapa): a validação exige que a
 * geometria de um `tile-object` tenha exatamente o tamanho de um tile do seu
 * tileset. A posição usa o tile do MAPA, que é a grade em que o clique caiu.
 */
export function addTileObject(
  doc: MapDocumentV1,
  input: { id: string; col: number; row: number; tilesetId: string; tileIndex: number; tileWidth: number; tileHeight: number },
): MapDocumentV1 {
  const object: TileObjectV1 = {
    id: input.id,
    layerKey: 'objects',
    type: 'tile-object',
    geometry: {
      kind: 'rectangle',
      x: input.col * doc.map.tileWidth,
      y: input.row * doc.map.tileHeight,
      width: input.tileWidth,
      height: input.tileHeight,
    },
    properties: { tilesetId: input.tilesetId, tileIndex: input.tileIndex },
  }
  return { ...doc, objects: [...doc.objects, object] }
}

/**
 * Remove a peça de mobília do TOPO da célula (a acrescentada mais recentemente)
 * e devolve qual foi — a cena precisa do id para apagar a estampa certa e do
 * retângulo para marcar a remoção. Devolve `removed: null` (e o mesmo `doc`,
 * por identidade) quando não há `tile-object` naquela célula.
 */
export function removeTopTileObjectAt(
  doc: MapDocumentV1,
  col: number,
  row: number,
): { doc: MapDocumentV1; removed: TileObjectV1 | null } {
  const x = col * doc.map.tileWidth
  const y = row * doc.map.tileHeight
  for (let index = doc.objects.length - 1; index >= 0; index--) {
    const object = doc.objects[index]
    if (object.type !== 'tile-object' || object.layerKey !== 'objects') continue
    if (object.geometry.x !== x || object.geometry.y !== y) continue
    return { doc: { ...doc, objects: doc.objects.filter((_, i) => i !== index) }, removed: object }
  }
  return { doc, removed: null }
}
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm --filter @legends/web test -- decorationDoc`
Expected: PASS — todos os testes do arquivo, incluindo os antigos de `stampTile` (que continua existindo, servindo à borracha de tiles legados).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editing/decorationDoc.ts apps/web/src/office/editing/decorationDoc.test.ts
git commit -m "feat(escritório): mutadores puros de tile-object (empilhar/remover topo)"
```

---

### Task 2: Estampas de preview indexadas por id na cena

`applyTileStamp` é indexado por `layerKey:index` e destrói o sprite anterior da célula — incompatível com pilha. Entram três métodos irmãos indexados por id de objeto. Os antigos permanecem, servindo à borracha de tiles legados.

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`

**Interfaces:**
- Consumes: `addTileObject`/`removeTopTileObjectAt` (Task 1) — indiretamente, via quem chama.
- Produces (métodos públicos de `OfficeScene`):
  - `applyTileObjectStamp(objectId: string, bounds: { x: number; y: number; width: number; height: number }, textureKey: string, frameKey: string): void`
  - `removeTileObjectStamp(objectId: string): void`
  - `markTileObjectErased(objectId: string, bounds: { x: number; y: number; width: number; height: number }): void`

- [ ] **Step 1: Declarar os mapas de sprites**

Em `apps/web/src/office/scenes/OfficeScene.ts`, logo abaixo da declaração `private editing = false` (linha 195), acrescente:

```ts
  /**
   * Estampas pendentes de mobília desta sessão, indexadas por ID DO OBJETO —
   * não por célula. É o que permite empilhar: várias peças na mesma célula
   * coexistem porque cada uma tem sua própria chave. (`editImages`, indexado
   * por célula, continua servindo aos tiles legados da borracha.)
   */
  private editObjectImages = new Map<string, Phaser.GameObjects.Image>()
  private editObjectMarkers = new Map<string, Phaser.GameObjects.Rectangle>()
  /** Marcas vermelhas de mobília JÁ PUBLICADA removida nesta sessão, por id. */
  private editObjectEraseMarkers = new Map<string, Phaser.GameObjects.Rectangle>()
```

- [ ] **Step 2: Implementar os três métodos**

Acrescente logo após o fim de `eraseTileStamp` (depois da linha 588, antes de `setZonePreview`):

```ts
  /**
   * Estampa pendente de uma peça de mobília (`tile-object`) desta sessão.
   * Depth 21 (acima do mapa publicado, que é depth 20) e contorno verde, igual
   * à estampa de tile — a diferença é a chave: por id, para empilhar.
   */
  applyTileObjectStamp(
    objectId: string,
    bounds: { x: number; y: number; width: number; height: number },
    textureKey: string,
    frameKey: string,
  ): void {
    this.removeTileObjectStamp(objectId)
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    const image = this.add
      .image(cx, cy, textureKey, frameKey)
      .setDisplaySize(bounds.width, bounds.height)
      .setDepth(21)
    this.editObjectImages.set(objectId, image)
    const marker = this.add
      .rectangle(cx, cy, bounds.width, bounds.height)
      .setStrokeStyle(2, 0x52fba2, 0.9)
      .setDepth(22)
    this.editObjectMarkers.set(objectId, marker)
  }

  /** Remove a estampa pendente de uma peça colocada nesta sessão (borracha ou desfazer). */
  removeTileObjectStamp(objectId: string): void {
    const image = this.editObjectImages.get(objectId)
    if (image) {
      image.destroy()
      this.editObjectImages.delete(objectId)
    }
    const marker = this.editObjectMarkers.get(objectId)
    if (marker) {
      marker.destroy()
      this.editObjectMarkers.delete(objectId)
    }
    const erase = this.editObjectEraseMarkers.get(objectId)
    if (erase) {
      erase.destroy()
      this.editObjectEraseMarkers.delete(objectId)
    }
  }

  /**
   * Marca em vermelho a remoção pendente de uma peça JÁ PUBLICADA — o sprite
   * publicado só some no `applyMap` pós-save, então até lá a marca é o único
   * sinal de que ela saiu. Espelha o `hadTile` de `eraseTileStamp`.
   */
  markTileObjectErased(objectId: string, bounds: { x: number; y: number; width: number; height: number }): void {
    this.removeTileObjectStamp(objectId)
    const marker = this.add
      .rectangle(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width, bounds.height, 0xff5d5d, 0.18)
      .setStrokeStyle(2, 0xff5d5d, 0.9)
      .setDepth(22)
    this.editObjectEraseMarkers.set(objectId, marker)
  }
```

- [ ] **Step 3: Limpar os novos mapas em `discardLocalEdits`**

Em `discardLocalEdits` (linha 371), logo depois do bloco `this.eraseMarkers.forEach(...)/clear()`, acrescente:

```ts
    this.editObjectImages.forEach((image) => image.destroy())
    this.editObjectImages.clear()
    this.editObjectMarkers.forEach((marker) => marker.destroy())
    this.editObjectMarkers.clear()
    this.editObjectEraseMarkers.forEach((marker) => marker.destroy())
    this.editObjectEraseMarkers.clear()
```

- [ ] **Step 4: Verificar que compila**

Run: `pnpm --filter @legends/web exec tsc --noEmit -p tsconfig.json`
Expected: sem erros. (Se o projeto não tiver esse script de typecheck isolado, use `pnpm --filter @legends/web build` — o importante é o TypeScript aceitar os novos membros.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(escritório): estampas de edição indexadas por id de objeto (permite empilhar)"
```

---

### Task 3: Pincel passa a empilhar (`paintAt`) + teto de objetos

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts:144-200` (`paintAt`)
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `addTileObject` (Task 1); `applyTileObjectStamp` (Task 2); `nextObjectId()` já existente no hook (`useOfficeMapEditing.ts:111`); `MAP_DOCUMENT_V1_LIMITS.maxObjects` (= 2000), já importado no arquivo.
- Produces: `paintAt` com o mesmo contrato externo `(col: number, row: number) => Promise<void>`; novo campo em `OfficeMapEditingState`: `limitError: string | null`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao mock `scene` no topo de `apps/web/src/office/editing/useOfficeMapEditing.test.ts` (dentro do objeto, junto de `applyTileStamp`):

```ts
  applyTileObjectStamp: vi.fn(),
  removeTileObjectStamp: vi.fn(),
  markTileObjectErased: vi.fn(),
```

E acrescente estes testes ao `describe('useOfficeMapEditing', ...)`:

**Importante:** o hook **não** expõe `paintAt`/`eraseAt` (o retorno é
`{ state, enter, cancel, save, undo, setTool, selectTile, dismissLockError }`).
Pintar e apagar nos testes é pelos callbacks que o hook entrega à cena em
`setEditing(true, callbacks)` — é o padrão que o `describe('desfazer')` já usa
(`useOfficeMapEditing.test.ts:221-231`). Acrescente estes helpers no nível do
`describe('useOfficeMapEditing', ...)`, **antes** dos testes novos:

```ts
  /** Entra em edição com um documento dado e devolve os callbacks que a cena recebeu. */
  async function enterSession(document: any, revision = 3) {
    vi.mocked(api.acquireDecorationLock).mockResolvedValue({ lockToken: 't', expiresAt: 'x', owner: { id: 'u', name: 'U' } })
    vi.mocked(api.getDecorationDraft).mockResolvedValue({
      map: { id: 'm', name: 'M' },
      revision,
      document,
      savedAt: 'x',
      updatedBy: null,
    } as any)
    vi.mocked(api.saveDecorationDraft).mockResolvedValue({ revision: revision + 1, savedAt: 'x', validationSummary: { valid: true, errorCount: 0 } })
    vi.mocked(api.publishDecoration).mockResolvedValue({ activated: true })
    const { result } = renderHook(() => useOfficeMapEditing(canvasRef))
    await act(async () => {
      await result.current.enter()
    })
    const callbacks = scene.setEditing.mock.calls[0][1]
    return { result, callbacks }
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
      result.current.selectTile({ assetId: OFFICE_TILESET_CATALOG[0].assetId, col: 0, row: 0, cols: 1, rows: 1 })
    })

  it('pincel empilha: duas peças na mesma célula viram dois tile-objects', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    await stroke(callbacks, [[2, 3]])
    await stroke(callbacks, [[2, 3]])
    await act(async () => {
      await result.current.save()
    })
    const sent = vi.mocked(api.saveDecorationDraft).mock.calls[0][0].document as any
    const stacked = sent.objects.filter((o: any) => o.type === 'tile-object')
    expect(stacked).toHaveLength(2)
    expect(stacked.every((o: any) => o.geometry.x === 96 && o.geometry.y === 144)).toBe(true)
    expect(scene.applyTileObjectStamp).toHaveBeenCalledTimes(2)
  })

  it('recusa a pincelada que estouraria o teto de objetos do mapa', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const doc: any = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })
    doc.objects = Array.from({ length: 2000 }, (_, i) => ({
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
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: FAIL — `applyTileObjectStamp` nunca chamado (o pincel ainda estampa tile) e `state.limitError` é `undefined`.

- [ ] **Step 3: Acrescentar `limitError` ao estado**

Em `apps/web/src/office/editing/useOfficeMapEditing.ts`, na interface `OfficeMapEditingState` (linha 49), acrescente após `lockError`:

```ts
  /** Aviso de limite do documento (ex.: teto de objetos atingido). Some na pincelada seguinte que couber. */
  limitError: string | null
```

E em `INITIAL_STATE` (linha 60), acrescente:

```ts
  limitError: null,
```

- [ ] **Step 4: Reescrever `paintAt`**

Substitua o corpo do laço de estampagem em `paintAt` (linhas 178-197) por:

```ts
      // Cada célula do bloco vira UM `tile-object` acrescentado ao fim de
      // `doc.objects` — é isso que empilha (ver `addTileObject`). O antigo
      // `stampTile` sobrescrevia o slot único da célula e fazia a peça de
      // baixo desaparecer.
      let nextDoc = ensured.doc
      const cells: { col: number; row: number; tileIndex: number }[] = []
      for (let dr = 0; dr < picked.rows; dr++) {
        for (let dc = 0; dc < picked.cols; dc++) {
          const mapCol = col + dc
          const mapRow = row + dr
          if (mapCol >= nextDoc.map.width || mapRow >= nextDoc.map.height) continue
          cells.push({ col: mapCol, row: mapRow, tileIndex: (picked.row + dr) * builtin.columns + (picked.col + dc) })
        }
      }
      if (cells.length === 0) return

      // Teto do documento: recusa a pincelada inteira em vez de deixar o save
      // estourar na validação do servidor (`maxObjects`, hoje 2000 — dividido
      // com áreas, links e colisões).
      if (nextDoc.objects.length + cells.length > MAP_DOCUMENT_V1_LIMITS.maxObjects) {
        setState((s) => ({
          ...s,
          limitError: `Limite de ${MAP_DOCUMENT_V1_LIMITS.maxObjects} objetos do mapa atingido — apague algo antes de continuar.`,
        }))
        return
      }

      for (const cell of cells) {
        const id = nextObjectId()
        nextDoc = addTileObject(nextDoc, {
          id,
          col: cell.col,
          row: cell.row,
          tilesetId: ensured.tilesetId,
          tileIndex: cell.tileIndex,
          tileWidth: tileWidth.data,
          tileHeight: tileHeight.data,
        })
        const registered = scene.registerTileFrame(tilesetMeta, cell.tileIndex)
        if (registered) {
          scene.applyTileObjectStamp(
            id,
            { x: cell.col * nextDoc.map.tileWidth, y: cell.row * nextDoc.map.tileHeight, width: tileWidth.data, height: tileHeight.data },
            registered.textureKey,
            registered.frameKey,
          )
        }
      }
      commitOp()
      documentRef.current = nextDoc
      setState((s) => ({ ...s, dirty: true, limitError: null }))
```

Atualize o array de dependências do `useCallback` de `paintAt` (linha 199) para:

```ts
    [canvasRef, commitOp, nextObjectId],
```

E ajuste os imports (linha 10) para incluir os novos mutadores:

```ts
import {
  stampTile,
  ensureBuiltinTileset,
  addRectObject,
  addTileObject,
  removeTopTileObjectAt,
  pruneUnusedTilesets,
  removeDecorationObjectsInRect,
  geometryBounds,
} from './decorationDoc'
```

- [ ] **Step 5: Rodar para confirmar que passa**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: PASS nos dois testes novos. O teste antigo `'save publica e sai do modo'` ainda deve passar (Task 6 é que o altera).

- [ ] **Step 6: Mostrar o aviso de limite no drawer**

Em `apps/web/src/office/editing/OfficeEditDrawer.tsx`, logo abaixo do bloco `{state.lockError && (...)}` (linha 70-74), acrescente:

```tsx
      {state.limitError && (
        <div className="mx-lg mt-md rounded-lg bg-error-container/90 px-md py-sm font-label text-label-sm text-on-error-container">
          {state.limitError}
        </div>
      )}
```

- [ ] **Step 7: Rodar a suíte do drawer**

Run: `pnpm --filter @legends/web test -- OfficeEditDrawer`
Expected: PASS (o teste existente não conhece `limitError`, que é `null` por padrão — nada muda).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts apps/web/src/office/editing/OfficeEditDrawer.tsx
git commit -m "feat(escritório): pincel empilha mobília em vez de sobrescrever a célula"
```

---

### Task 4: Borracha remove a peça do topo

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts:202-217` (`eraseAt`)
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `removeTopTileObjectAt` (Task 1); `removeTileObjectStamp`/`markTileObjectErased` (Task 2); `baseDocRef` (já existe no hook, linha 109).
- Produces: `eraseAt(col: number, row: number): void` — mesmo contrato externo.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao `describe('useOfficeMapEditing', ...)`:

```ts
  it('borracha tira só a peça de cima, mantendo a de baixo', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    await stroke(callbacks, [[2, 3]])
    await stroke(callbacks, [[2, 3]])
    await act(async () => {
      callbacks.onTileErase(2, 3)
    })
    await act(async () => {
      await result.current.save()
    })
    const sent = vi.mocked(api.saveDecorationDraft).mock.calls[0][0].document as any
    expect(sent.objects.filter((o: any) => o.type === 'tile-object')).toHaveLength(1)
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
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: FAIL — `markTileObjectErased` nunca chamado; a borracha ainda só mexe na tile layer.

- [ ] **Step 3: Reescrever `eraseAt`**

Substitua a função inteira (linhas 202-217) por:

```ts
  const eraseAt = useCallback(
    (col: number, row: number) => {
      const scene = canvasRef.current?.getScene()
      const doc = documentRef.current
      if (!scene || !doc) return

      // Mobília primeiro: tira a peça do TOPO da pilha daquela célula. Uma
      // borrachada = uma camada, para dar pra corrigir a cadeira sem perder a
      // mesa embaixo.
      const { doc: withoutTop, removed } = removeTopTileObjectAt(doc, col, row)
      if (removed) {
        commitOp()
        documentRef.current = withoutTop
        // Peça já publicada some só no `applyMap` pós-save; até lá, marca
        // vermelha. Peça desta sessão: basta apagar a estampa pendente.
        const wasPublished = baseDocRef.current?.objects.some((object) => object.id === removed.id) ?? false
        if (wasPublished) scene.markTileObjectErased(removed.id, geometryBounds(removed.geometry))
        else scene.removeTileObjectStamp(removed.id)
        setState((s) => ({ ...s, dirty: true }))
        return
      }

      // Sem mobília empilhada: cai no caminho legado, que limpa o tile da
      // própria tile layer `objects` (mapas publicados antes do empilhamento).
      const objects = doc.layers.find((l) => l.key === 'objects')
      const index = row * doc.map.width + col
      const hadTile = objects?.type === 'tile' && objects.data[index] != null
      if (hadTile) commitOp()
      documentRef.current = stampTile(doc, 'objects', col, row, null)
      scene.eraseTileStamp('objects', col, row, hadTile)
      if (hadTile) setState((s) => ({ ...s, dirty: true }))
    },
    [canvasRef, commitOp],
  )
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: PASS nos dois testes novos, e os anteriores seguem verdes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts
git commit -m "feat(escritório): borracha remove a mobília do topo da pilha"
```

---

### Task 5: Desfazer redesenha as pilhas

`repaintOverlays` reconstrói os overlays por diff contra `baseDocRef`. Hoje ele manda todo objeto novo para `addEditZoneOverlay` (retângulo colorido de área) — o que desenharia um retângulo em vez da mobília. Passa a despachar por tipo.

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts:397-408` (o par de laços de diff de objetos em `repaintOverlays`)
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `applyTileObjectStamp`/`markTileObjectErased` (Task 2); `builtinTilesetAsset` e `scene.registerBuiltinAsset`/`registerTileFrame`, já usados no laço de tiles logo acima.
- Produces: nada de novo — só corrige o comportamento de `undo()`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
  it('desfazer remove a estampa da peça empilhada, sem desenhar overlay de área', async () => {
    scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
    const { result, callbacks } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    pickTile(result)
    await stroke(callbacks, [[2, 3]])
    await stroke(callbacks, [[2, 3]])
    scene.applyTileObjectStamp.mockClear()
    scene.addEditZoneOverlay.mockClear()
    await act(async () => {
      await result.current.undo()
    })
    // Repintou a pilha remanescente (1 peça) e nenhum retângulo de área.
    expect(scene.applyTileObjectStamp).toHaveBeenCalledTimes(1)
    expect(scene.addEditZoneOverlay).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: FAIL — `addEditZoneOverlay` chamado 1 vez e `applyTileObjectStamp` 0 vezes.

- [ ] **Step 3: Despachar por tipo no diff**

Em `repaintOverlays`, substitua os dois laços de diff de objetos (linhas 397-408, do `const pristineIds` até o fim da função) por:

```ts
      const pristineIds = new Set(base.objects.map((o) => o.id))
      const currentIds = new Set(doc.objects.map((o) => o.id))
      for (const object of doc.objects) {
        if (pristineIds.has(object.id)) continue
        // Mobília acrescentada nesta sessão: redesenha a estampa (não um
        // retângulo de área — `addEditZoneOverlay` é só para zonas/links).
        if (object.type === 'tile-object') {
          const tileset = doc.tilesets.find((t) => t.id === object.properties.tilesetId)
          if (!tileset) continue
          const builtin = builtinTilesetAsset(tileset.assetId)
          if (builtin) await scene.registerBuiltinAsset(tileset.assetId, builtin.url)
          const registered = scene.registerTileFrame(tileset, object.properties.tileIndex)
          if (registered) {
            scene.applyTileObjectStamp(object.id, geometryBounds(object.geometry), registered.textureKey, registered.frameKey)
          }
          continue
        }
        scene.addEditZoneOverlay(object.id, geometryBounds(object.geometry), OBJECT_OVERLAY_COLORS[object.type])
      }
      for (const object of base.objects) {
        if (currentIds.has(object.id)) continue
        // Mobília publicada removida: marca vermelha (o sprite publicado só
        // some no `applyMap` pós-save).
        if (object.type === 'tile-object') {
          scene.markTileObjectErased(object.id, geometryBounds(object.geometry))
          continue
        }
        scene.eraseAreaMarker(object.id, geometryBounds(object.geometry))
      }
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts
git commit -m "feat(escritório): desfazer redesenha pilhas de mobília em vez de overlay de área"
```

---

### Task 6: Salvar sem encerrar a sessão

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts:524-562` (`save`)
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts` (reescreve o teste `'save publica e sai do modo'`)

**Interfaces:**
- Consumes: nada novo.
- Produces: `save()` mantém `state.active === true`; lock e heartbeat seguem vivos; `baseDocRef`/`revisionRef` re-ancorados no documento publicado.

Contexto verificado no backend: `saveOfficeMapDraft` incrementa a revisão e devolve `input.revision + 1`; `publishOfficeDecoration` apenas **lê** essa revisão para detectar conflito, sem incrementá-la. Por isso `revisionRef = saved.revision` continua válido para o save seguinte.

- [ ] **Step 1: Reescrever o teste**

Em `apps/web/src/office/editing/useOfficeMapEditing.test.ts`, substitua o teste `'save publica e sai do modo'` inteiro por:

```ts
  it('save publica e MANTÉM a sessão de edição aberta (paleta não fecha)', async () => {
    const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    vi.mocked(api.releaseDecorationLock).mockResolvedValue(undefined)
    await act(async () => {
      await result.current.save()
    })
    expect(api.publishDecoration).toHaveBeenCalledWith(4)
    expect(result.current.state.active).toBe(true)
    expect(result.current.state.dirty).toBe(false)
    expect(result.current.state.canUndo).toBe(false)
    // Não sai da cena nem devolve o lock — dá pra continuar editando.
    expect(scene.setEditing).not.toHaveBeenCalledWith(false)
    expect(api.releaseDecorationLock).not.toHaveBeenCalled()
  })

  it('salvar duas vezes seguidas usa a revisão devolvida pelo save anterior', async () => {
    const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    vi.mocked(api.saveDecorationDraft)
      .mockResolvedValueOnce({ revision: 4, savedAt: 'x', validationSummary: { valid: true, errorCount: 0 } })
      .mockResolvedValueOnce({ revision: 5, savedAt: 'x', validationSummary: { valid: true, errorCount: 0 } })
    await act(async () => {
      await result.current.save()
    })
    await act(async () => {
      await result.current.save()
    })
    expect(vi.mocked(api.saveDecorationDraft).mock.calls[0][0].revision).toBe(3)
    expect(vi.mocked(api.saveDecorationDraft).mock.calls[1][0].revision).toBe(4)
    expect(api.publishDecoration).toHaveBeenLastCalledWith(5)
  })

  it('cancelar continua encerrando a sessão e liberando o lock', async () => {
    const { result } = await enterSession(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }))
    vi.mocked(api.releaseDecorationLock).mockResolvedValue(undefined)
    act(() => {
      result.current.cancel()
    })
    expect(result.current.state.active).toBe(false)
    expect(scene.setEditing).toHaveBeenLastCalledWith(false)
    expect(api.releaseDecorationLock).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: FAIL — `state.active` é `false` após o save, e o segundo save dispara com revisão errada.

- [ ] **Step 3: Reescrever o bloco de sucesso de `save`**

Em `save` (linha 524), substitua o `try` inteiro por:

```ts
    try {
      const saved = await api.saveDecorationDraft({ revision: revisionRef.current, document: doc, lockToken: token })
      await api.publishDecoration(saved.revision)
      // Salvar NÃO encerra a sessão: o drawer, a paleta, a ferramenta e o tile
      // selecionado continuam de pé para o usuário seguir decorando. O lock e o
      // heartbeat seguem vivos (só `cancel()`/unmount devolvem o lock), e a cena
      // permanece em modo de edição — `applyMap` não desliga `this.editing`,
      // então a publicação suave converte as estampas em sprites permanentes
      // sem remonte nem piscada.
      //
      // Re-ancoragem: o documento publicado vira a nova base do diff de
      // overlays, e o histórico zera — salvar é um marco, o que já foi
      // publicado não volta com um Ctrl+Z local.
      //
      // `publishDecoration` só LÊ a revisão do draft (checagem de conflito),
      // não a incrementa — por isso `saved.revision` segue sendo a revisão
      // corrente para o próximo save.
      baseDocRef.current = doc
      revisionRef.current = saved.revision
      resetHistory()
      setState((s) => ({ ...s, dirty: false, saving: false, canUndo: false, limitError: null }))
    } catch (error) {
```

(O bloco `catch` permanece exatamente como está — mantendo o lock de propósito.)

Atualize o array de dependências do `useCallback` de `save` para:

```ts
  }, [resetHistory])
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: PASS nos três testes.

- [ ] **Step 5: Verificar que `exitScene`/`releaseLock` continuam usados**

Run: `grep -n "exitScene\|releaseLock" apps/web/src/office/editing/useOfficeMapEditing.ts`
Expected: ambos ainda referenciados em `cancel()`. Se o TypeScript acusar variável não usada, é sinal de que `cancel` foi quebrado por engano — reveja.

- [ ] **Step 6: Rodar a suíte web inteira**

Run: `pnpm --filter @legends/web test`
Expected: PASS. Atenção especial a `OfficeEditDrawer.test.tsx` e a qualquer teste de `OfficePage` que assuma o drawer fechando após salvar — se algum quebrar, ajuste a expectativa para o novo contrato (salvar mantém aberto) e mencione no commit.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts
git commit -m "feat(escritório): salvar publica sem fechar o editor nem a paleta"
```

---

### Task 7: Verificação em runtime

Os testes cobrem documento e chamadas de cena, mas não provam o empilhamento visual no Phaser. Esta task é manual, com a skill `verify` do repo.

**Files:** nenhum (só verificação).

- [ ] **Step 1: Subir o ambiente**

Use a skill `verify` deste repo (`Skill: verify`) para levantar web + api e entrar no escritório. Requer Node 20 — se o shell estiver em 18, o proxy do Vite falha com `ECONNREFUSED ::1`.

- [ ] **Step 2: Roteiro de verificação**

1. Entrar no escritório, clicar no pincel (topo direito).
2. Escolher uma mobília na paleta e colocar numa célula vazia.
3. Escolher outra mobília e colocar **na mesma célula** → as duas aparecem, a nova por cima.
4. Clicar em **Salvar** → o drawer e a paleta **continuam abertos**, o botão Salvar fica desabilitado (`dirty: false`), Desfazer fica cinza.
5. Recarregar a página → as duas peças continuam lá, empilhadas na mesma ordem.
6. Voltar ao editor, borracha, um clique na célula → some só a de cima.
7. Colocar mais uma peça e apertar Ctrl+Z → some só ela, a pilha embaixo permanece.
8. Colocar mais uma, Salvar, e Salvar de novo depois de outra peça → o segundo save funciona (sem `DRAFT_REVISION_CONFLICT`).

- [ ] **Step 3: Registrar o resultado**

Se tudo passar, não há commit — a verificação é o gate para abrir o PR. Se algo falhar, use `superpowers:systematic-debugging` antes de qualquer correção.

---

## Notas de rollback

Todas as mudanças são no cliente e aditivas no documento: mapas gravados com `tile-object` continuam válidos pelo schema atual e são renderizados por qualquer versão do front que já suporte `tile-object` (`OfficeScene.ts:719`) — inclusive a atual. Reverter os commits desta branch não corrompe mapas já publicados; a mobília empilhada volta a ser não-editável pelo pincel, mas segue visível.
