# Rotação de Mobília no Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir girar 90° e espelhar mobília já colocada no editor in-place do escritório, operando sobre uma seleção retangular.

**Architecture:** Dois campos opcionais (`rotation`, `flipX`) em `TileObjectV1.properties` cobrem as oito orientações de um tile. As transformações são funções puras `doc → doc` em `decorationDoc.ts`. A ferramenta de seleção reaproveita o modo `'rect'` que a cena Phaser já tem para a borracha e as áreas — nenhum modo de input novo. O redesenho reaproveita `repaintOverlays`, que ganha um terceiro laço para objetos **modificados** (hoje ele só enxerga adição e remoção). Backend: zero mudanças.

**Tech Stack:** TypeScript ESM strict, Zod, React 18, Phaser 3, Vitest + Testing Library, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-19-escritorio-mobilia-rotacao-design.md`

## Global Constraints

- **Node ≥ 20 obrigatório.** O shell padrão do usuário pode estar em 18; use `nvm use 20` antes de qualquer comando pnpm, senão o proxy do Vite quebra com `ECONNREFUSED ::1`.
- Mensagens voltadas ao usuário em **português** (o produto é pt-BR).
- TypeScript **strict**, ESM puro. Typecheck: use o binário direto (`pnpm --filter @legends/web exec tsc --noEmit`), nunca `npx tsc`.
- Rode apenas o(s) arquivo(s) de teste da task corrente. A suíte completa (`pnpm test`) é lenta e só entra como verificação final, se solicitada.
- Os testes de `@legends/api` precisam de Postgres (`pnpm db:up`) — **nenhuma task deste plano toca a API**, então não é necessário subir o banco.
- Camadas: DTO/contrato em `@legends/shared` primeiro, depois os dois lados. Não misture.
- `rotation` e `flipX` são **opcionais** em todo o plano. Um documento sem eles é válido e significa `{ rotation: 0, flipX: false }`.

---

### Task 1: Campos `rotation` e `flipX` no contrato

**Files:**
- Modify: `packages/shared/src/office-map.ts:353-365`
- Test: `packages/shared/src/office-map.test.ts`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: `TileObjectRotationV1Schema` (Zod), tipo `TileObjectRotationV1 = 0 | 90 | 180 | 270`, e as chaves opcionais `properties.rotation` / `properties.flipX` em `TileObjectV1`.

- [ ] **Step 1: Escreva o teste que falha**

Acrescente ao fim de `packages/shared/src/office-map.test.ts`. Reaproveite o helper de documento que o arquivo já usa se houver um; caso contrário, monte o objeto inline como abaixo.

```ts
describe('TileObjectV1Schema — orientação', () => {
  const base = {
    id: 'obj-1',
    layerKey: 'objects',
    type: 'tile-object' as const,
    geometry: { kind: 'rectangle' as const, x: 0, y: 0, width: 16, height: 16 },
    properties: { tilesetId: 'builtin-office', tileIndex: 3 },
  }

  it('aceita um tile-object sem orientação (retrocompatível)', () => {
    expect(TileObjectV1Schema.safeParse(base).success).toBe(true)
  })

  it('aceita rotation de 90 em 90 e flipX', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const parsed = TileObjectV1Schema.safeParse({
        ...base,
        properties: { ...base.properties, rotation, flipX: true },
      })
      expect(parsed.success).toBe(true)
    }
  })

  it('rejeita rotation fora dos múltiplos de 90', () => {
    const parsed = TileObjectV1Schema.safeParse({
      ...base,
      properties: { ...base.properties, rotation: 45 },
    })
    expect(parsed.success).toBe(false)
  })

  it('preserva a orientação num round-trip de parse', () => {
    const parsed = TileObjectV1Schema.parse({
      ...base,
      properties: { ...base.properties, rotation: 270, flipX: true },
    })
    expect(parsed.properties.rotation).toBe(270)
    expect(parsed.properties.flipX).toBe(true)
  })
})
```

Confira o topo do arquivo: se `TileObjectV1Schema` ainda não estiver no `import` de `./office-map.js`, acrescente-o.

- [ ] **Step 2: Rode o teste e confirme que falha**

```bash
pnpm --filter @legends/shared exec vitest run src/office-map.test.ts -t 'orientação'
```

Esperado: FAIL. O caso "aceita rotation de 90 em 90" falha porque `properties` é `.strict()` e ainda não conhece as chaves.

- [ ] **Step 3: Implemente**

Em `packages/shared/src/office-map.ts`, logo **antes** de `TileObjectV1Schema` (linha ~353):

```ts
/**
 * Orientação de uma peça de mobília. `rotation` + `flipX` cobrem as OITO
 * orientações possíveis de um tile (grupo diedral de ordem 8): espelhar na
 * vertical é "espelhar na horizontal + girar 180°", então um terceiro campo
 * seria redundante e permitiria representar o mesmo estado de duas formas.
 * Ambos são opcionais — ausente significa `rotation: 0, flipX: false`, o que
 * mantém válido todo mapa publicado antes desta feature.
 */
export const TileObjectRotationV1Schema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type TileObjectRotationV1 = z.infer<typeof TileObjectRotationV1Schema>;
```

E dentro de `TileObjectV1Schema.properties`:

```ts
    properties: z
      .object({
        tilesetId: MapIdentifierSchema,
        tileIndex: z.number().int().nonnegative(),
        rotation: TileObjectRotationV1Schema.optional(),
        flipX: z.boolean().optional(),
      })
      .strict(),
```

Não mexa na validação de `office-map.ts:1039` (`geometry.width/height` = tamanho do tile): os tiles são quadrados, girar não altera a geometria, e a regra continua correta.

- [ ] **Step 4: Rode o teste e confirme que passa**

```bash
pnpm --filter @legends/shared exec vitest run src/office-map.test.ts
```

Esperado: PASS, incluindo os testes que já existiam no arquivo.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office-map.ts packages/shared/src/office-map.test.ts
git commit -m "feat(escritório): campos opcionais de rotação no tile-object"
```

---

### Task 2: Composição de orientação (função pura)

**Files:**
- Modify: `apps/web/src/office/editing/decorationDoc.ts`
- Test: `apps/web/src/office/editing/decorationDoc.test.ts`

**Interfaces:**
- Consumes: `TileObjectRotationV1` de `@legends/shared` (Task 1).
- Produces:
  - `type TileOrientation = { rotation: TileObjectRotationV1; flipX: boolean }`
  - `orientationOf(object: TileObjectV1): TileOrientation`
  - `rotateOrientation(o: TileOrientation, direction: 'cw' | 'ccw'): TileOrientation`
  - `flipOrientation(o: TileOrientation, axis: 'horizontal' | 'vertical'): TileOrientation`

- [ ] **Step 1: Escreva o teste que falha**

Acrescente a `apps/web/src/office/editing/decorationDoc.test.ts`:

```ts
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
```

Acrescente ao `import` do topo do arquivo de teste: `orientationOf`, `rotateOrientation`, `flipOrientation` e o tipo `TileOrientation` de `./decorationDoc`. Importe `TileObjectV1` de `@legends/shared` se ainda não estiver lá.

- [ ] **Step 2: Rode o teste e confirme que falha**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/decorationDoc.test.ts -t 'composição de orientação'
```

Esperado: FAIL com erro de import — `rotateOrientation` não existe.

- [ ] **Step 3: Implemente**

Em `decorationDoc.ts`, logo depois de `addTileObject` (linha ~79). Acrescente `TileObjectRotationV1` ao import de `@legends/shared` no topo:

```ts
/**
 * Orientação de uma peça, já normalizada (os campos do documento são
 * opcionais). Ver `TileObjectRotationV1Schema` em `@legends/shared`.
 */
export type TileOrientation = { rotation: TileObjectRotationV1; flipX: boolean }

const ROTATIONS: TileObjectRotationV1[] = [0, 90, 180, 270]

function normalizeRotation(degrees: number): TileObjectRotationV1 {
  return ROTATIONS[(((degrees / 90) % 4) + 4) % 4]
}

export function orientationOf(object: TileObjectV1): TileOrientation {
  return { rotation: object.properties.rotation ?? 0, flipX: object.properties.flipX ?? false }
}

/** Gira a peça 90° no espaço do mundo. O flip local não muda. */
export function rotateOrientation(o: TileOrientation, direction: 'cw' | 'ccw'): TileOrientation {
  return { rotation: normalizeRotation(o.rotation + (direction === 'cw' ? 90 : 270)), flipX: o.flipX }
}

/**
 * Espelha a peça no espaço do MUNDO. Como o sprite é desenhado com o flip
 * local aplicado antes do ângulo, espelhar o mundo em torno do eixo vertical
 * equivale a inverter o ângulo e alternar o flip local: `H ∘ R(θ) = R(-θ) ∘ H`.
 * Espelhar na horizontal (⇅) é isso seguido de 180°.
 */
export function flipOrientation(o: TileOrientation, axis: 'horizontal' | 'vertical'): TileOrientation {
  const mirrored: TileOrientation = { rotation: normalizeRotation(-o.rotation), flipX: !o.flipX }
  if (axis === 'horizontal') return mirrored
  return { rotation: normalizeRotation(mirrored.rotation + 180), flipX: mirrored.flipX }
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/decorationDoc.test.ts
```

Esperado: PASS, incluindo os testes que já existiam.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editing/decorationDoc.ts apps/web/src/office/editing/decorationDoc.test.ts
git commit -m "feat(escritório): composição de orientação de tile"
```

---

### Task 3: `rotateBlock` e `flipBlock`

**Files:**
- Modify: `apps/web/src/office/editing/decorationDoc.ts`
- Test: `apps/web/src/office/editing/decorationDoc.test.ts`

**Interfaces:**
- Consumes: `TileOrientation`, `orientationOf`, `rotateOrientation`, `flipOrientation` (Task 2).
- Produces:
  - `type TileRect = { col: number; row: number; cols: number; rows: number }`
  - `type BlockTransformResult = { ok: true; doc: MapDocumentV1; rect: TileRect } | { ok: false; reason: 'out-of-bounds' | 'empty' }`
  - `rotateBlock(doc: MapDocumentV1, rect: TileRect, direction: 'cw' | 'ccw'): BlockTransformResult`
  - `flipBlock(doc: MapDocumentV1, rect: TileRect, axis: 'horizontal' | 'vertical'): BlockTransformResult`

`rect` é sempre em **coordenadas de tile**, não pixels. O `rect` devolvido em `ok: true` é a nova área ocupada — a UI reancora a seleção nele.

- [ ] **Step 1: Escreva o teste que falha**

Acrescente a `decorationDoc.test.ts`. O helper `docWith` monta um documento mínimo com os objetos dados; se o arquivo já tiver um helper equivalente, use o existente em vez de duplicar.

```ts
describe('rotateBlock / flipBlock', () => {
  function tileObject(id: string, col: number, row: number, orientation?: Partial<TileOrientation>): TileObjectV1 {
    return {
      id,
      layerKey: 'objects',
      type: 'tile-object',
      geometry: { kind: 'rectangle', x: col * 16, y: row * 16, width: 16, height: 16 },
      properties: {
        tilesetId: 'builtin-office',
        tileIndex: 1,
        ...(orientation?.rotation !== undefined ? { rotation: orientation.rotation } : {}),
        ...(orientation?.flipX !== undefined ? { flipX: orientation.flipX } : {}),
      },
    } as TileObjectV1
  }

  function docWith(objects: TileObjectV1[]): MapDocumentV1 {
    return {
      schemaVersion: 1,
      map: { width: 10, height: 10, tileWidth: 16, tileHeight: 16, backgroundColor: '#000000' },
      tilesets: [],
      layers: [],
      objects,
    } as unknown as MapDocumentV1
  }

  const at = (doc: MapDocumentV1, col: number, row: number) =>
    doc.objects.find((o) => o.geometry.kind === 'rectangle' && o.geometry.x === col * 16 && o.geometry.y === row * 16)

  it('gira um par horizontal para vertical e devolve o novo rect', () => {
    const doc = docWith([tileObject('a', 0, 0), tileObject('b', 1, 0)])
    const result = rotateBlock(doc, { col: 0, row: 0, cols: 2, rows: 1 }, 'cw')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rect).toEqual({ col: 1, row: 0, cols: 1, rows: 2 })
    expect(at(result.doc, 1, 0)?.id).toBe('a')
    expect(at(result.doc, 1, 1)?.id).toBe('b')
  })

  it('acumula a rotação em cada peça do bloco', () => {
    const doc = docWith([tileObject('a', 2, 2, { rotation: 90 })])
    const result = rotateBlock(doc, { col: 2, row: 2, cols: 1, rows: 1 }, 'cw')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(at(result.doc, 2, 2)?.properties.rotation).toBe(180)
  })

  it('girar quatro vezes um bloco quadrado restaura as posições', () => {
    const original = docWith([tileObject('a', 0, 0), tileObject('b', 1, 0), tileObject('c', 0, 1)])
    let doc = original
    let rect = { col: 0, row: 0, cols: 2, rows: 2 }
    for (let i = 0; i < 4; i++) {
      const result = rotateBlock(doc, rect, 'cw')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      doc = result.doc
      rect = result.rect
    }
    expect(at(doc, 0, 0)?.id).toBe('a')
    expect(at(doc, 1, 0)?.id).toBe('b')
    expect(at(doc, 0, 1)?.id).toBe('c')
  })

  it('recusa quando o resultado sai da borda do mapa e não altera o documento', () => {
    const doc = docWith([tileObject('a', 0, 0), tileObject('b', 0, 1), tileObject('c', 0, 2), tileObject('d', 0, 3)])
    const result = rotateBlock(doc, { col: 0, row: 0, cols: 1, rows: 4 }, 'cw')
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds' })
  })

  it('recusa uma seleção sem mobília', () => {
    const doc = docWith([])
    expect(rotateBlock(doc, { col: 0, row: 0, cols: 2, rows: 2 }, 'cw')).toEqual({ ok: false, reason: 'empty' })
  })

  it('espelha na horizontal sem mudar as dimensões do bloco', () => {
    const doc = docWith([tileObject('a', 0, 0), tileObject('b', 1, 0)])
    const result = flipBlock(doc, { col: 0, row: 0, cols: 2, rows: 1 }, 'horizontal')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rect).toEqual({ col: 0, row: 0, cols: 2, rows: 1 })
    expect(at(result.doc, 0, 0)?.id).toBe('b')
    expect(at(result.doc, 1, 0)?.id).toBe('a')
    expect(at(result.doc, 0, 0)?.properties.flipX).toBe(true)
  })

  it('não toca em objetos fora da seleção', () => {
    const doc = docWith([tileObject('dentro', 0, 0), tileObject('fora', 5, 5)])
    const result = flipBlock(doc, { col: 0, row: 0, cols: 1, rows: 1 }, 'horizontal')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(at(result.doc, 5, 5)?.properties.flipX).toBeUndefined()
  })

  it('preserva a ordem de empilhamento do array', () => {
    const doc = docWith([tileObject('baixo', 0, 0), tileObject('cima', 0, 0)])
    const result = flipBlock(doc, { col: 0, row: 0, cols: 1, rows: 1 }, 'horizontal')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.objects.map((o) => o.id)).toEqual(['baixo', 'cima'])
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/decorationDoc.test.ts -t 'rotateBlock'
```

Esperado: FAIL — `rotateBlock` não existe.

- [ ] **Step 3: Implemente**

Em `decorationDoc.ts`, depois das funções da Task 2:

```ts
/** Área retangular em coordenadas de TILE (a seleção do editor). */
export type TileRect = { col: number; row: number; cols: number; rows: number }

export type BlockTransformResult =
  | { ok: true; doc: MapDocumentV1; rect: TileRect }
  | { ok: false; reason: 'out-of-bounds' | 'empty' }

function tileCellOf(doc: MapDocumentV1, object: TileObjectV1): { col: number; row: number } {
  return { col: object.geometry.x / doc.map.tileWidth, row: object.geometry.y / doc.map.tileHeight }
}

function rectContains(rect: TileRect, cell: { col: number; row: number }): boolean {
  return (
    cell.col >= rect.col &&
    cell.col < rect.col + rect.cols &&
    cell.row >= rect.row &&
    cell.row < rect.row + rect.rows
  )
}

function rectFitsMap(doc: MapDocumentV1, rect: TileRect): boolean {
  return (
    rect.col >= 0 &&
    rect.row >= 0 &&
    rect.col + rect.cols <= doc.map.width &&
    rect.row + rect.rows <= doc.map.height
  )
}

/**
 * Aplica uma transformação de bloco: reposiciona cada `tile-object` dentro da
 * seleção e reorienta cada peça. `mapCell` recebe o offset local `(dc, dr)` no
 * bloco ORIGINAL e devolve o offset no bloco resultante; `reorient` compõe a
 * orientação de cada peça.
 *
 * Preserva a ordem do array `doc.objects` — que é o que define o empilhamento
 * (ver `addTileObject`). Peças fora da seleção passam intactas, inclusive
 * quando o bloco transformado cai por cima delas: mobília é empilhável, então
 * sobreposição é um resultado válido, não um conflito.
 */
function transformBlock(
  doc: MapDocumentV1,
  rect: TileRect,
  nextRect: TileRect,
  mapCell: (dc: number, dr: number) => { dc: number; dr: number },
  reorient: (o: TileOrientation) => TileOrientation,
): BlockTransformResult {
  if (!rectFitsMap(doc, nextRect)) return { ok: false, reason: 'out-of-bounds' }

  let touched = 0
  const objects = doc.objects.map((object) => {
    if (object.type !== 'tile-object' || object.layerKey !== 'objects') return object
    const cell = tileCellOf(doc, object)
    if (!rectContains(rect, cell)) return object
    touched += 1

    const mapped = mapCell(cell.col - rect.col, cell.row - rect.row)
    const orientation = reorient(orientationOf(object))
    return {
      ...object,
      geometry: {
        ...object.geometry,
        x: (nextRect.col + mapped.dc) * doc.map.tileWidth,
        y: (nextRect.row + mapped.dr) * doc.map.tileHeight,
      },
      properties: {
        ...object.properties,
        rotation: orientation.rotation,
        flipX: orientation.flipX,
      },
    }
  })

  if (touched === 0) return { ok: false, reason: 'empty' }
  return { ok: true, doc: { ...doc, objects }, rect: nextRect }
}

/**
 * Arredondamento simétrico em torno de zero (`f(-x) === -f(x)`). `Math.round`
 * NÃO tem essa propriedade — `Math.round(-0.5)` é `-0`, não `-1` —, e como os
 * deslocamentos de linha e coluna de uma rotação têm sinais opostos, usar
 * `Math.round` faz o erro de meio tile ACUMULAR em vez de cancelar: girar um
 * bloco 2×1 e desfazer o giro o movia uma célula na diagonal.
 */
function roundSymmetric(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

/**
 * Gira o bloco 90° em torno do CENTRO da seleção. Um bloco `N × M` vira
 * `M × N`; a nova origem é escolhida para preservar o centro, o que faz o
 * móvel girar "no lugar" em vez de saltar. Com `N - M` ímpar o centro cai em
 * meio tile: usamos `roundSymmetric` (não `Math.round`) porque os dois eixos
 * arredondam valores de sinal oposto — só um arredondamento simétrico em
 * torno de zero garante que os deslocamentos de meio tile se cancelem quando
 * rotações são compostas (girar e desfazer, ou quatro giros seguidos, voltam
 * exatamente à origem).
 *
 * Recusa se o retângulo resultante sair do mapa — girar não pode empurrar
 * mobília para fora da grade.
 */
export function rotateBlock(doc: MapDocumentV1, rect: TileRect, direction: 'cw' | 'ccw'): BlockTransformResult {
  const nextRect: TileRect = {
    col: rect.col + roundSymmetric((rect.cols - rect.rows) / 2),
    row: rect.row + roundSymmetric((rect.rows - rect.cols) / 2),
    cols: rect.rows,
    rows: rect.cols,
  }
  const mapCell =
    direction === 'cw'
      ? (dc: number, dr: number) => ({ dc: rect.rows - 1 - dr, dr: dc })
      : (dc: number, dr: number) => ({ dc: dr, dr: rect.cols - 1 - dc })
  return transformBlock(doc, rect, nextRect, mapCell, (o) => rotateOrientation(o, direction))
}

/** Espelha o bloco. Não altera as dimensões, então nunca sai da borda. */
export function flipBlock(doc: MapDocumentV1, rect: TileRect, axis: 'horizontal' | 'vertical'): BlockTransformResult {
  const mapCell =
    axis === 'horizontal'
      ? (dc: number, dr: number) => ({ dc: rect.cols - 1 - dc, dr })
      : (dc: number, dr: number) => ({ dc, dr: rect.rows - 1 - dr })
  return transformBlock(doc, rect, rect, mapCell, (o) => flipOrientation(o, axis))
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/decorationDoc.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editing/decorationDoc.ts apps/web/src/office/editing/decorationDoc.test.ts
git commit -m "feat(escritório): rotateBlock e flipBlock puros"
```

---

### Task 4: Cena desenha a orientação e indexa os sprites publicados

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts:176-178` (campo novo), `:629-648` (`applyTileObjectStamp`), `:812-836` (`renderDecoration`), `:880-896` (`applyMap`)

**Interfaces:**
- Consumes: `TileOrientation` de `../editing/decorationDoc` (Task 2).
- Produces:
  - `applyTileObjectStamp(objectId, bounds, textureKey, frameKey, orientation?: TileOrientation)` — parâmetro novo, **opcional**, para não quebrar as chamadas existentes.
  - `setPublishedObjectVisible(objectId: string, visible: boolean): void`
  - `resetPublishedObjectsVisibility(): void`

**Sobre testes nesta task:** `OfficeScene.test.ts` existe e testa métodos da cena chamando `OfficeScene.prototype.metodo.call(fakeScene, ...)` com um `this` falso — padrão que funciona para métodos que só leem campos simples (ver `getScreenPosition`, `OfficeScene.test.ts:103`). `renderDecoration` e `applyTileObjectStamp` **não** cabem nesse padrão: dependem de `this.add.image`, `this.textures` e do ciclo de vida de GameObjects do Phaser, que exigiriam um mock grande e frágil. Elas são verificadas manualmente na Task 8 (passos 5 e 6, que são exatamente os caminhos que as exercitam). O único método desta feature que ganha teste unitário é o `worldToScreen` da Task 8.

- [ ] **Step 1: Indexe os sprites publicados por id**

Junto da declaração de `mapObjects` (linha ~177):

```ts
  /**
   * Índice por id dos sprites de `tile-object` publicados desenhados por
   * `renderDecoration`. Existe para que a edição possa ESCONDER uma peça
   * publicada que foi modificada nesta sessão (girada, espelhada) enquanto o
   * preview desenha a versão nova por cima — sem isso o sprite antigo vaza por
   * baixo, já que tiles de mobília têm transparência.
   *
   * É um índice sobre um SUBCONJUNTO de `mapObjects`; os sprites continuam
   * sendo destruídos por `mapObjects` em `applyMap`, e este Map é limpo junto
   * (senão sobram referências a objetos destruídos).
   */
  private publishedObjectImages = new Map<string, Phaser.GameObjects.Image>()
```

- [ ] **Step 2: Aplique orientação e popule o índice em `renderDecoration`**

No laço de `tile-object` (linha ~827), troque a construção da imagem por:

```ts
      const image = this.add.image(
        object.geometry.x + object.geometry.width / 2,
        object.geometry.y + object.geometry.height / 2,
        textureKey,
        frame.key,
      ).setDisplaySize(object.geometry.width, object.geometry.height)
        .setAlpha(layer.opacity)
        .setDepth(layer.zIndex)
      // Flip é local ao sprite e o ângulo vem depois — é exatamente o modelo
      // assumido pela composição em `flipOrientation` (`H ∘ R(θ) = R(-θ) ∘ H`).
      image.setFlipX(object.properties.flipX ?? false)
      image.setAngle(object.properties.rotation ?? 0)
      this.mapObjects.push(image)
      this.publishedObjectImages.set(object.id, image)
```

- [ ] **Step 3: Limpe o índice em `applyMap`**

Em `applyMap` (linha ~887), logo depois de zerar `mapObjects`:

```ts
    this.mapObjects.forEach((object) => object.destroy())
    this.mapObjects = []
    this.publishedObjectImages.clear()
    this.renderDecoration()
```

- [ ] **Step 4: Aceite orientação no preview**

Troque a assinatura e o corpo de `applyTileObjectStamp` (linha ~629):

```ts
  applyTileObjectStamp(
    objectId: string,
    bounds: { x: number; y: number; width: number; height: number },
    textureKey: string,
    frameKey: string,
    orientation?: TileOrientation,
  ): void {
    this.removeTileObjectStamp(objectId)
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    const image = this.add
      .image(cx, cy, textureKey, frameKey)
      .setDisplaySize(bounds.width, bounds.height)
      .setDepth(21)
    image.setFlipX(orientation?.flipX ?? false)
    image.setAngle(orientation?.rotation ?? 0)
    this.editObjectImages.set(objectId, image)
    const marker = this.add
      .rectangle(cx, cy, bounds.width, bounds.height)
      .setStrokeStyle(2, 0x52fba2, 0.9)
      .setDepth(22)
    this.editObjectMarkers.set(objectId, marker)
  }
```

O marcador verde **não** gira: é um contorno de célula, e girá-lo junto não muda nada (a célula é quadrada) mas confundiria a leitura de "esta célula tem alteração pendente".

Acrescente ao topo do arquivo: `import type { TileOrientation } from '../editing/decorationDoc'`.

- [ ] **Step 5: Exponha o controle de visibilidade**

Logo depois de `markTileObjectErased` (linha ~681):

```ts
  /**
   * Esconde/mostra um sprite de mobília PUBLICADA. Usado quando a sessão de
   * edição modifica in-place uma peça já publicada (rotação): o preview
   * desenha a versão nova em depth 21 e o original em depth 20 precisa sumir,
   * porque tiles têm transparência e vazariam por baixo. No-op se o id não for
   * de uma peça publicada (peça criada nesta sessão não tem sprite publicado).
   */
  setPublishedObjectVisible(objectId: string, visible: boolean): void {
    this.publishedObjectImages.get(objectId)?.setVisible(visible)
  }

  /** Revela todos os sprites publicados — usado ao recalcular os overlays do zero. */
  resetPublishedObjectsVisibility(): void {
    this.publishedObjectImages.forEach((image) => image.setVisible(true))
  }
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Esperado: sem erros. (Use o binário direto — `npx tsc` é interceptado pelo proxy rtk e mente sobre o resultado.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(escritório): cena desenha rotação e indexa sprites publicados"
```

---

### Task 5: `repaintOverlays` enxerga objetos modificados

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts:480-540`
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `setPublishedObjectVisible`, `resetPublishedObjectsVisibility`, `applyTileObjectStamp(..., orientation)` (Task 4); `orientationOf` (Task 2).
- Produces: nenhuma API nova — corrige o comportamento de `repaintOverlays`, do qual as Tasks 6 e 7 dependem.

**Por que esta task existe:** `repaintOverlays` hoje compara **presença de id** (`useOfficeMapEditing.ts:513`: `if (pristineIds.has(object.id)) continue`). Um objeto presente nos dois lados é ignorado pelos dois laços, então uma mutação in-place como a rotação não seria redesenhada — e o sprite publicado continuaria na cena com a orientação antiga.

**Sobre TDD nesta task:** o comportamento novo só é observável através de `rotateSelection`, que nasce na Task 7 — não há como escrever um teste vermelho aqui que não dependa de API inexistente. Então esta task não tem teste próprio: ela prepara o terreno (fake de cena, helper de documento) e implementa; **o teste que a cobre está na Task 7, Step 1** (`redesenha peça publicada que mudou de orientação`). A rede desta task são os testes que já existem, que passam a exercitar o caminho novo de `repaintOverlays` e quebrariam se o fake de cena ficasse incompleto.

- [ ] **Step 1: Prepare o fake de cena e o helper de documento**

O arquivo tem um fake de cena em `const scene = {...}` no nível do módulo (`useOfficeMapEditing.test.ts:9`). Acrescente três `vi.fn()` a ele — `setSelectionOverlay`, `setPublishedObjectVisible`, `resetPublishedObjectsVisibility` (o `applyTileObjectStamp` já está lá). Sem isso os testes que já existem quebram, porque `repaintOverlays` passa a chamar `resetPublishedObjectsVisibility`.

Acrescente também este helper junto de `stroke` (`:51`), no estilo do documento montado em `:180` — as Tasks 6 e 7 o reutilizam:

```ts
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
```

O tileset precisa existir no documento: `repaintOverlays` faz `doc.tilesets.find(...)` e desiste da peça se não achar.

- [ ] **Step 2: Implemente o terceiro laço**

Em `repaintOverlays`, logo após `scene.discardLocalEdits()` (linha ~485):

```ts
      // Toda peça publicada volta a ficar visível antes de recalcular quais
      // devem sumir — os overlays são uma função pura do diff, sem histórico.
      scene.resetPublishedObjectsVisibility()
```

E logo **depois** do laço que trata `base.objects` removidos (linha ~544), acrescente:

```ts
      // Terceiro caso: id presente nos DOIS lados, com properties diferentes —
      // peça publicada modificada in-place nesta sessão (girada/espelhada).
      // Nenhum dos laços acima a alcança: o primeiro pula ids que já existiam
      // no base, o segundo só trata ids que sumiram. Sem isto, girar mobília
      // publicada não redesenha nada.
      const baseById = new Map(base.objects.map((object) => [object.id, object]))
      for (const object of doc.objects) {
        if (object.type !== 'tile-object') continue
        const pristine = baseById.get(object.id)
        if (!pristine || pristine.type !== 'tile-object') continue
        if (
          pristine.properties.rotation === object.properties.rotation &&
          pristine.properties.flipX === object.properties.flipX &&
          pristine.geometry.x === object.geometry.x &&
          pristine.geometry.y === object.geometry.y
        ) {
          continue
        }
        const tileset = doc.tilesets.find((t) => t.id === object.properties.tilesetId)
        if (!tileset) continue
        const builtin = builtinTilesetAsset(tileset.assetId)
        if (builtin) await scene.registerBuiltinAsset(tileset.assetId, builtin.url)
        const registered = scene.registerTileFrame(tileset, object.properties.tileIndex)
        if (!registered) continue
        // Esconde o publicado (depth 20, orientação antiga) e desenha a versão
        // atual como estampa pendente (depth 21).
        scene.setPublishedObjectVisible(object.id, false)
        scene.applyTileObjectStamp(
          object.id,
          geometryBounds(object.geometry),
          registered.textureKey,
          registered.frameKey,
          orientationOf(object),
        )
      }
```

Acrescente `orientationOf` ao import de `./decorationDoc` no topo do hook.

- [ ] **Step 3: Rode os testes que já existiam e confirme que continuam passando**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts
```

Esperado: PASS. Estes testes são a rede desta task: eles exercitam `repaintOverlays` (via desfazer) e quebrariam se o fake de cena estivesse incompleto ou se o laço novo lançasse. Se algum quebrar por `resetPublishedObjectsVisibility` indefinido, o `vi.fn()` do Step 1 faltou.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts
git commit -m "fix(escritório): repaintOverlays redesenha objeto modificado in-place"
```

---

### Task 6: Ferramenta de seleção

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts:23-48` (tool), `:59-81` (state), `:341-408` (`handleRectEnd`)
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (overlay de seleção)
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `TileRect` (Task 3).
- Produces:
  - `EditTool` ganha o membro `'select'`
  - `OfficeMapEditingState` ganha `selection: TileRect | null`
  - `selectRegion(rect: TileRect): void` e `clearSelection(): void` no retorno do hook
  - `OfficeScene.setSelectionOverlay(rect: { x, y, width, height } | null): void`

**Decisão de projeto:** a ferramenta reaproveita o `editMode: 'rect'` que a cena já tem (o mesmo do arraste da borracha e das áreas). Não há modo de input novo — `handleRectEnd` só passa a despachar mais um caso por `toolRef.current`. A seleção **é React state**, ao contrário do documento de trabalho: muda uma vez por arrasto, não por célula, e a UI precisa re-renderizar com ela.

- [ ] **Step 1: Escreva o teste que falha**

`enterSession` devolve `{ result, callbacks }` — `callbacks` são os handlers que o hook entregou à cena em `setEditing`, então simular o fim de um arraste é chamar `callbacks.onRectEnd(rect)` direto (mesmo padrão do helper `stroke`).

```ts
  describe('ferramenta de seleção', () => {
    it('arrastar guarda o retângulo em coordenadas de tile', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([]))

      act(() => {
        result.current.setTool('select')
      })
      // A cena entrega o retângulo em PIXELS (tiles de 16px neste documento).
      await act(async () => {
        callbacks.onRectEnd({ x: 32, y: 16, width: 32, height: 48 })
      })

      expect(result.current.state.selection).toEqual({ col: 2, row: 1, cols: 2, rows: 3 })
      expect(scene.setSelectionOverlay).toHaveBeenCalledWith({ x: 32, y: 16, width: 32, height: 48 })
    })

    it('limpar a seleção apaga o overlay da cena', async () => {
      const { result, callbacks } = await enterSession(docWithFurniture([]))
      act(() => {
        result.current.setTool('select')
      })
      await act(async () => {
        callbacks.onRectEnd({ x: 0, y: 0, width: 16, height: 16 })
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
      await act(async () => {
        callbacks.onRectEnd({ x: 0, y: 0, width: 16, height: 16 })
      })
      expect(result.current.state.dirty).toBe(false)
      expect(result.current.state.canUndo).toBe(false)
    })
  })
```

- [ ] **Step 2: Rode o teste e confirme que falha**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts -t 'ferramenta de seleção'
```

Esperado: FAIL — `'select'` não é um `EditTool` válido.

- [ ] **Step 3: Overlay de seleção na cena**

Em `OfficeScene.ts`, junto de `setZonePreview` (linha ~684):

```ts
  private selectionOverlay: Phaser.GameObjects.Rectangle | null = null

  /**
   * Retângulo da seleção ativa (ferramenta de rotação). Diferente do
   * `zonePreview`, que só existe durante o arraste, este fica até a seleção ser
   * limpa. Depth 23: acima das estampas (21) e dos marcadores (22).
   */
  setSelectionOverlay(rect: { x: number; y: number; width: number; height: number } | null): void {
    this.selectionOverlay?.destroy()
    this.selectionOverlay = null
    if (!rect) return
    this.selectionOverlay = this.add
      .rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, 0x6ab8ff, 0.12)
      .setStrokeStyle(2, 0x6ab8ff, 0.95)
      .setDepth(23)
  }
```

Acrescente a limpeza em `discardLocalEdits` (linha ~406, junto de `this.setZonePreview(null)`):

```ts
    this.setSelectionOverlay(null)
```

- [ ] **Step 4: Ferramenta e estado no hook**

Em `useOfficeMapEditing.ts`, no tipo `EditTool` (linha ~23), acrescente `| 'select'`.

Em `editModeForTool` (linha ~43), inclua `'select'` no caminho de retângulo:

```ts
function editModeForTool(tool: EditTool): 'paint' | 'rect' | 'point' {
  // A borracha e a seleção também usam arraste retangular.
  if (tool === 'eraser' || tool === 'select' || RECT_TOOLS.has(tool)) return 'rect'
  if (POINT_TOOLS.has(tool)) return 'point'
  return 'paint'
}
```

Em `OfficeMapEditingState` (linha ~59) acrescente o campo, e `selection: null` em `INITIAL_STATE`:

```ts
  /** Seleção retangular ativa (ferramenta de rotação), em coordenadas de tile. */
  selection: TileRect | null
```

Acrescente um ref espelho junto de `selectedTileRef` (linha ~120) — os callbacks da cena e os atalhos de teclado leem a seleção sem entrar no array de dependências:

```ts
  const selectionRef = useRef<TileRect | null>(null)
```

E os dois comandos, antes de `handleRectEnd`:

```ts
  const selectRegion = useCallback(
    (rect: TileRect) => {
      const doc = documentRef.current
      selectionRef.current = rect
      setState((s) => ({ ...s, selection: rect }))
      if (!doc) return
      canvasRef.current?.getScene()?.setSelectionOverlay({
        x: rect.col * doc.map.tileWidth,
        y: rect.row * doc.map.tileHeight,
        width: rect.cols * doc.map.tileWidth,
        height: rect.rows * doc.map.tileHeight,
      })
    },
    [canvasRef],
  )

  const clearSelection = useCallback(() => {
    selectionRef.current = null
    canvasRef.current?.getScene()?.setSelectionOverlay(null)
    setState((s) => (s.selection ? { ...s, selection: null } : s))
  }, [canvasRef])
```

- [ ] **Step 5: Despache a seleção em `handleRectEnd`**

No topo de `handleRectEnd` (linha ~343), **antes** do `beginOp()` — selecionar não é uma operação desfazível:

```ts
      if (toolRef.current === 'select') {
        const tw = doc.map.tileWidth
        const th = doc.map.tileHeight
        selectRegion({
          col: Math.floor(rect.x / tw),
          row: Math.floor(rect.y / th),
          cols: Math.max(1, Math.round(rect.width / tw)),
          rows: Math.max(1, Math.round(rect.height / th)),
        })
        return
      }
```

Acrescente `selectRegion` ao array de dependências de `handleRectEnd`.

Limpe a seleção junto do resto da sessão: acrescente `selectionRef.current = null` e `selection: null` ao `setState` de `cancel` (linha ~690) e de `enter` (linha ~653).

- [ ] **Step 6: Rode o teste e confirme que passa**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts
```

Esperado: PASS (o teste da Task 5 segue `it.skip`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts
git commit -m "feat(escritório): ferramenta de seleção retangular no editor"
```

---

### Task 7: Operações de rotação e atalhos

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts`
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `rotateBlock`, `flipBlock`, `BlockTransformResult` (Task 3); `selectRegion`, `clearSelection`, `selectionRef` (Task 6); `repaintOverlays` corrigido (Task 5).
- Produces:
  - `rotateSelection(direction: 'cw' | 'ccw'): Promise<void>`
  - `flipSelection(axis: 'horizontal' | 'vertical'): Promise<void>`

- [ ] **Step 1: Escreva os testes que falham**

O primeiro é o que cobre a Task 5 (o terceiro laço de `repaintOverlays`): só aqui ele consegue ser escrito verde-após-implementação, porque depende de `rotateSelection`.

```ts
  describe('girar e espelhar', () => {
    it('redesenha peça publicada que mudou de orientação e esconde o sprite antigo', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result } = await enterSession(docWithFurniture([[0, 0]]))

      act(() => {
        result.current.selectRegion({ col: 0, row: 0, cols: 1, rows: 1 })
      })
      await act(async () => {
        await result.current.rotateSelection('cw')
      })

      expect(scene.setPublishedObjectVisible).toHaveBeenCalledWith('pub-0-0', false)
      const stamp = scene.applyTileObjectStamp.mock.calls.at(-1)
      expect(stamp?.[0]).toBe('pub-0-0')
      expect(stamp?.[4]).toEqual({ rotation: 90, flipX: false })
    })

    it('recusa na borda com mensagem e não suja a sessão', async () => {
      // Bloco 1×4 encostado na coluna 0 giraria para 4×1 começando em col -1.
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result } = await enterSession(docWithFurniture([[0, 0], [0, 1], [0, 2], [0, 3]]))
      act(() => {
        result.current.selectRegion({ col: 0, row: 0, cols: 1, rows: 4 })
      })
      await act(async () => {
        await result.current.rotateSelection('cw')
      })

      expect(result.current.state.limitError).toBe('Não há espaço para girar aqui.')
      expect(result.current.state.dirty).toBe(false)
    })

    it('reancora a seleção no novo retângulo', async () => {
      scene.registerTileFrame.mockReturnValue({ textureKey: 'tex', frameKey: 'f' })
      const { result } = await enterSession(docWithFurniture([[2, 2], [3, 2]]))
      act(() => {
        result.current.selectRegion({ col: 2, row: 2, cols: 2, rows: 1 })
      })
      await act(async () => {
        await result.current.rotateSelection('cw')
      })

      expect(result.current.state.selection).toEqual({ col: 3, row: 2, cols: 1, rows: 2 })
      expect(result.current.state.dirty).toBe(true)
      expect(result.current.state.canUndo).toBe(true)
    })

    it('espelhar uma seleção sem mobília é no-op silencioso', async () => {
      const { result } = await enterSession(docWithFurniture([]))
      act(() => {
        result.current.selectRegion({ col: 0, row: 0, cols: 2, rows: 2 })
      })
      await act(async () => {
        await result.current.flipSelection('horizontal')
      })
      expect(result.current.state.dirty).toBe(false)
      expect(result.current.state.limitError).toBeNull()
    })
  })
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts -t 'girar'
```

Esperado: FAIL — `result.current.rotateSelection is not a function`.

- [ ] **Step 3: Implemente as operações**

Em `useOfficeMapEditing.ts`, depois de `clearSelection`. Acrescente `rotateBlock`, `flipBlock` e o tipo `BlockTransformResult` ao import de `./decorationDoc`:

```ts
  /**
   * Aplica uma transformação de bloco à seleção ativa: muta o documento de
   * trabalho, recalcula os overlays e reancora a seleção no retângulo
   * resultante (a peça continua selecionada, então dá para girar de novo).
   *
   * Um passo de desfazer por operação — `beginOp`/`commitOp` em volta, como a
   * pincelada. Recusa em silêncio quando não há seleção, quando um save está
   * em voo (mesma razão do `savingRef` nos callbacks da cena) ou quando a
   * seleção não cobre mobília nenhuma.
   */
  const applyBlockTransform = useCallback(
    async (transform: (doc: MapDocumentV1, rect: TileRect) => BlockTransformResult) => {
      if (savingRef.current) return
      const doc = documentRef.current
      const rect = selectionRef.current
      if (!doc || !rect) return

      const result = transform(doc, rect)
      if (!result.ok) {
        if (result.reason === 'out-of-bounds') {
          setState((s) => ({ ...s, limitError: 'Não há espaço para girar aqui.' }))
        }
        // `empty`: a seleção não cobria mobília — silêncio, não é erro.
        return
      }

      beginOp()
      commitOp()
      documentRef.current = result.doc
      await repaintOverlays(result.doc)
      selectRegion(result.rect)
      setState((s) => ({ ...s, dirty: true, limitError: null }))
    },
    [beginOp, commitOp, repaintOverlays, selectRegion],
  )

  const rotateSelection = useCallback(
    (direction: 'cw' | 'ccw') => applyBlockTransform((doc, rect) => rotateBlock(doc, rect, direction)),
    [applyBlockTransform],
  )

  const flipSelection = useCallback(
    (axis: 'horizontal' | 'vertical') => applyBlockTransform((doc, rect) => flipBlock(doc, rect, axis)),
    [applyBlockTransform],
  )
```

Atualize o comentário de `limitError` na declaração de `OfficeMapEditingState` (linha ~66), que agora carrega mais de um tipo de recusa:

```ts
  /** Recusa de uma operação (teto de objetos, giro sem espaço). Some na operação seguinte que der certo. */
  limitError: string | null
```

Acrescente os dois ao `return` do hook (linha ~817):

```ts
  return {
    state,
    enter,
    cancel,
    save,
    undo,
    setTool,
    selectTile,
    dismissLockError,
    selectRegion,
    clearSelection,
    rotateSelection,
    flipSelection,
  }
```

- [ ] **Step 4: Atalhos de teclado**

Logo depois do `useEffect` do Ctrl+Z (linha ~786):

```ts
  // Atalhos da seleção: R gira horário, Shift+R anti-horário, H/V espelham,
  // Esc limpa. Só com seleção ativa, e nunca sobre um campo de texto (a
  // paleta e o drawer têm inputs).
  useEffect(() => {
    if (!state.active || !state.selection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const key = event.key.toLowerCase()
      if (key === 'escape') {
        event.preventDefault()
        clearSelection()
        return
      }
      if (key === 'r') {
        event.preventDefault()
        void rotateSelection(event.shiftKey ? 'ccw' : 'cw')
        return
      }
      if (key === 'h') {
        event.preventDefault()
        void flipSelection('horizontal')
        return
      }
      if (key === 'v') {
        event.preventDefault()
        void flipSelection('vertical')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.active, state.selection, clearSelection, rotateSelection, flipSelection])
```

- [ ] **Step 5: Rode os testes e confirme que passam**

```bash
pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts src/office/editing/decorationDoc.test.ts
```

Esperado: PASS, incluindo o teste que cobre o terceiro laço da Task 5.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts
git commit -m "feat(escritório): girar e espelhar a seleção de mobília"
```

---

### Task 8: UI — botão no drawer e barra flutuante

**Files:**
- Create: `apps/web/src/office/editing/SelectionToolbar.tsx`
- Modify: `apps/web/src/office/editing/OfficeEditDrawer.tsx:8-32`
- Modify: `apps/web/src/pages/OfficePage.tsx:537-538`
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (conversão mundo→tela)

**Interfaces:**
- Consumes: `state.selection`, `rotateSelection`, `flipSelection`, `clearSelection` (Tasks 6 e 7).
- Produces: `OfficeScene.worldToScreen(x, y): { x: number; y: number }` e o componente `SelectionToolbar`.

- [ ] **Step 1: Conversão mundo→tela na cena (com teste)**

**Não reimplemente a matemática.** `computeScreenPosition` já existe (`OfficeScene.ts:94`), é pura, e resolve dois problemas que uma versão nova erraria: usa `cam.worldView.x/y` em vez de `scrollX/scrollY` (com câmera limitada por bounds + `startFollow`, `scrollX` fica com o valor não-clampado e descola a UI do alvo — bug real já corrigido, documentado em `OfficeScene.ts:277-285`) e devolve `null` fora do viewport.

Em `OfficeScene.ts`, junto de `getScreenPosition` (linha ~273):

```ts
  /**
   * Posição de tela de um ponto do MUNDO — usada para ancorar UI React (a
   * barra de ações da seleção) sobre um ponto do mapa. Mesma conversão de
   * `getScreenPosition`, sem depender de um personagem. `null` quando o ponto
   * está fora do viewport: a barra some junto.
   */
  worldToScreen(x: number, y: number): ScreenPosition | null {
    const cam = this.cameras.main
    return computeScreenPosition(
      x,
      y,
      { scrollX: cam.worldView.x, scrollY: cam.worldView.y, zoom: cam.zoom },
      { width: this.scale.width, height: this.scale.height },
    )
  }
```

Acrescente o teste a `apps/web/src/office/scenes/OfficeScene.test.ts`, no padrão `prototype.call` que o arquivo já usa (`:103`):

```ts
describe('OfficeScene.worldToScreen', () => {
  const fakeScene = {
    cameras: { main: { worldView: { x: 0, y: 152 }, zoom: 2 } },
    scale: { width: 800, height: 600 },
  }

  it('converte um ponto do mundo aplicando scroll e zoom da câmera', () => {
    expect(OfficeScene.prototype.worldToScreen.call(fakeScene, 100, 200)).toEqual({
      x: 200,
      y: 96,
      zoom: 2,
    })
  })

  it('devolve null para um ponto fora do viewport', () => {
    expect(OfficeScene.prototype.worldToScreen.call(fakeScene, 5000, 200)).toBeNull()
  })
})
```

Rode: `pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts` — esperado PASS.

- [ ] **Step 2: Ferramenta no drawer**

Em `OfficeEditDrawer.tsx`, no grupo Pintura de `TOOL_GROUPS` (linha ~11):

```ts
    tools: [
      { tool: 'brush', label: 'Mobília', icon: 'chair' },
      { tool: 'select', label: 'Girar', icon: 'rotate_right' },
      { tool: 'eraser', label: 'Borracha', icon: 'ink_eraser' },
    ],
```

O grid já é `grid-cols-3` — três itens preenchem a linha exata, sem mudança de layout.

- [ ] **Step 3: Componente da barra flutuante**

Crie `apps/web/src/office/editing/SelectionToolbar.tsx`:

```tsx
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Icon } from '../../components/Icon'
import type { OfficeCanvasHandle } from '../OfficeCanvas'
import type { TileRect } from './decorationDoc'

export interface SelectionToolbarProps {
  canvasRef: RefObject<OfficeCanvasHandle>
  selection: TileRect
  onRotate: (direction: 'cw' | 'ccw') => void
  onFlip: (axis: 'horizontal' | 'vertical') => void
  onClear: () => void
}

const ACTIONS: { icon: string; label: string; hint: string; run: (p: SelectionToolbarProps) => void }[] = [
  { icon: 'rotate_left', label: 'Girar à esquerda', hint: 'Shift+R', run: (p) => p.onRotate('ccw') },
  { icon: 'rotate_right', label: 'Girar à direita', hint: 'R', run: (p) => p.onRotate('cw') },
  { icon: 'swap_horiz', label: 'Espelhar na horizontal', hint: 'H', run: (p) => p.onFlip('horizontal') },
  { icon: 'swap_vert', label: 'Espelhar na vertical', hint: 'V', run: (p) => p.onFlip('vertical') },
  { icon: 'close', label: 'Limpar seleção', hint: 'Esc', run: (p) => p.onClear() },
]

/**
 * Barra de ações ancorada na seleção de mobília. Fica sobre o canvas, não no
 * drawer, para o olho não ir e voltar entre o móvel e o painel lateral.
 *
 * A posição é recalculada por `requestAnimationFrame` enquanto a barra existe:
 * a câmera do Phaser se move por scroll e zoom sem emitir um evento que dê
 * para assinar de fora, e a seleção é efêmera — o custo de um rAF durante a
 * edição é irrelevante perto do loop de render da cena que já roda.
 */
export default function SelectionToolbar(props: SelectionToolbarProps) {
  const { canvasRef, selection } = props
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const tick = () => {
      const scene = canvasRef.current?.getScene()
      if (scene) {
        const doc = scene.getDocument()
        const centerX = (selection.col + selection.cols / 2) * doc.map.tileWidth
        const topY = selection.row * doc.map.tileHeight
        // `null` (seleção rolou para fora do viewport) esconde a barra.
        setPosition(scene.worldToScreen(centerX, topY))
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [canvasRef, selection])

  if (!position) return null

  return (
    <div
      className="pointer-events-auto absolute z-[75] flex -translate-x-1/2 -translate-y-full items-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-highest/95 px-xs py-xs shadow-xl backdrop-blur"
      style={{ left: position.x, top: position.y - 12 }}
    >
      {ACTIONS.map((action) => (
        <button
          key={action.icon}
          type="button"
          aria-label={action.label}
          title={`${action.label} (${action.hint})`}
          onClick={() => action.run(props)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <Icon name={action.icon} className="text-[18px]" />
        </button>
      ))}
    </div>
  )
}
```

Se `OfficeScene` não expuser um getter público do documento, acrescente um junto de `worldToScreen`:

```ts
  /** Documento atualmente desenhado — leitura apenas (a UI React é dona dele). */
  getDocument(): MapDocumentV1 {
    return this.document
  }
```

- [ ] **Step 4: Monte a barra na página**

Em `OfficePage.tsx`, junto da montagem do `OfficeEditDrawer` (linha ~537), dentro do mesmo container relativo que envolve o canvas:

```tsx
        {editing.state.active && editing.state.selection && (
          <SelectionToolbar
            canvasRef={canvasRef}
            selection={editing.state.selection}
            onRotate={(direction) => void editing.rotateSelection(direction)}
            onFlip={(axis) => void editing.flipSelection(axis)}
            onClear={editing.clearSelection}
          />
        )}
```

Acrescente o import: `import SelectionToolbar from '../office/editing/SelectionToolbar'`.

- [ ] **Step 5: Typecheck e testes do que foi tocado**

```bash
pnpm --filter @legends/web exec tsc --noEmit
pnpm --filter @legends/web exec vitest run src/office/editing
```

Esperado: sem erros de tipo; testes PASS.

- [ ] **Step 6: Verificação manual no app**

Suba o app conforme o skill `verify` do repo (`nvm use 20` antes). No `/office`:

1. Entre no modo de edição (botão pincel) e pinte um móvel de 2×1 tiles.
2. Troque para a ferramenta **Girar** e arraste um retângulo sobre ele — o contorno azul aparece e a barra flutuante surge acima da seleção.
3. Clique ↻ — o bloco gira no lugar, a seleção reancora no novo retângulo, e a barra acompanha.
4. `Ctrl+Z` — volta à orientação anterior.
5. **Salvar.** Confirme que a peça girada continua girada depois da publicação (é o caminho `applyMap` → `renderDecoration`, onde o sprite publicado é redesenhado com `setAngle`).
6. Entre em edição de novo, gire uma peça **já publicada** e confirme que o sprite antigo some (não fica um fantasma não-girado por baixo).
7. Selecione um bloco vertical colado na borda esquerda e tente girar — a mensagem "Não há espaço para girar aqui." aparece e nada muda.

O passo 6 é o que valida a Task 4 + Task 5 juntas; é o único caminho que exercita `setPublishedObjectVisible`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/editing/SelectionToolbar.tsx apps/web/src/office/editing/OfficeEditDrawer.tsx apps/web/src/pages/OfficePage.tsx apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(escritório): barra de ações da seleção e ferramenta girar no drawer"
```

---

## Notas de execução

**Ordem obrigatória.** Task 1 → 2 → 3 são independentes de UI e podem ser revisadas em bloco. Task 4 e 5 são pré-requisito da 7 (sem elas, girar mobília publicada não desenha nada). A 8 fecha.

**A Task 5 não tem teste próprio.** O comportamento que ela implementa (redesenho de objeto modificado in-place) só é alcançável via `rotateSelection`, que nasce na Task 7 — o teste que a cobre está lá, no primeiro `it` de "girar e espelhar". A rede da Task 5 são os testes já existentes do hook.

**Não há mudança no backend.** Se em algum momento um save falhar com erro de validação de schema, o problema está na Task 1 (campo não aceito), não na API.

**Suíte completa** (`pnpm test`) só ao fim, e apenas se solicitado — os testes da API precisariam de Postgres (`pnpm db:up`) e nada neste plano os afeta.
