# Edição de mapa por membros + tilesets default — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que usuários não-admin editem decoração do escritório (mobília, chão, áreas de silêncio/chamada, links, action points, collision, door) direto na cena viva via um side drawer, com "Salvar" propagando para todos por um refresh suave; e embutir os tilesets do LimeZu Modern Interiors como defaults categorizados nos dois editores.

**Architecture:** Três fases independentes e testáveis. (A) Catálogo de tilesets bundled em `@legends/shared` + resolução de assets `builtin:` na API, consumido por um `TilesetPalette` compartilhado. (B) Guard `assertOnlyDecorationChanged` no shared + superfície de rotas `/office/map/edit/*` (só `authenticate`) + evento socket `map-decor-updated` para refresh sem reload. (C) Camada de edição imperativa na `OfficeScene` + hook `useOfficeMapEditing` + `OfficeEditDrawer` + botão "Editar mapa".

**Tech Stack:** TypeScript ESM, Fastify 4, Prisma 5, Zod, React 18 + React Query, Phaser 3, Vitest, `sharp` (script de vendor), pnpm workspaces.

## Global Constraints

- Node ≥ 20; pnpm 9.7. Rodar comandos da raiz do monorepo. **Em dev o shell pode estar no Node 18** — use Node 20 (`nvm use 20` ou equivalente) antes de `pnpm dev`/`pnpm test`, senão o proxy do Vite quebra com ECONNREFUSED ::1.
- Testes da API batem em **Postgres real** — suba com `pnpm db:up` antes de `pnpm test`. `test/setup.ts` trunca as tabelas em `beforeEach`; `fileParallelism: false`.
- Contrato api⇄web muda **primeiro em `@legends/shared`**; barril em `packages/shared/src/index.ts` usa `export * from './modulo'`.
- Mensagens ao usuário em **português**. TypeScript strict, ESM puro.
- Rotas finas → service → Prisma. Erros de domínio são classes com `status` HTTP (`OfficeMapError`).
- Fronteira decoração×estrutura (spec `docs/superpowers/specs/2026-07-17-escritorio-membros-editam-mapa-design.md`):
  - **Decoração** (membro+admin): tiles em `floor`/`objects`; `tile-object`; objetos `private-zone`, `meeting-room`, `link`, `action-point`, `collision`, `door`.
  - **Estrutura** (só admin): `map.width/height/tileWidth/tileHeight/backgroundColor`; add/remove/reorder/tipo/zIndex/props de layers; tiles em `walls`; objetos `spawn-point`.
- Assets bundled só da **versão full** do LimeZu (asset-1/3/4). **asset-2 (free, não-comercial) fica de fora.** Créditos obrigatórios (limezu.itch.io).
- Assets `builtin:` **não** têm linha em `OfficeMapAsset`; são resolvidos em memória a partir do catálogo. `id` = `assetId` = `builtin:office/<slug>`.

---

# FASE A — Tilesets default bundled

Entrega: catálogo de tilesets embutido, resolvido pela API, e um palette categorizado usado hoje pelo editor admin (e reutilizável na Fase C).

### Task A1: Script de vendor dos tilesets

**Files:**
- Create: `scripts/vendor-tilesets.mjs`
- Create (gerado ao rodar): `packages/shared/src/office-tileset-catalog.json`
- Create (gerado ao rodar): `apps/web/public/office/tilesets/*.png` e `apps/web/public/office/tilesets/CREDITS.txt`

**Interfaces:**
- Produces: JSON `OfficeTilesetCatalogRaw[]` = `Array<{ id: string; assetId: string; name: string; category: string; url: string; tileWidth: 48; tileHeight: 48; columns: number; tileCount: number; width: number; height: number }>`. `id` e `assetId` iguais, no formato `builtin:office/<slug>`. `url` = `/office/tilesets/<slug>.png`.

Este script roda **manualmente** (não entra em `package.json`), espelhando `scripts/vendor-lpc.mjs`. Ele lê os 3 zips full direto (usa `unzip` do sistema para extrair só os PNGs necessários para uma pasta temporária), copia cada spritesheet escolhido para `apps/web/public/office/tilesets/<slug>.png`, mede as dimensões com `sharp`, e escreve o catálogo + créditos.

- [ ] **Step 1: Escrever o script**

```js
// scripts/vendor-tilesets.mjs
// Uso: node scripts/vendor-tilesets.mjs <dir-com-os-zips>
// Ex.: node scripts/vendor-tilesets.mjs ~/Downloads
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

const TILE = 48

// Curadoria (versão full apenas). Cada entrada é um spritesheet -> um tileset.
// category vira o grupo no palette. slug vira o nome do arquivo e o id builtin.
const SOURCES = [
  { zip: 'asset-1.zip', entry: 'Modern_Office_48x48.png', slug: 'modern-office', name: 'Escritório moderno', category: 'Escritório' },
  { zip: 'asset-1.zip', entry: '1_Room_Builder_Office/Room_Builder_Office_48x48.png', slug: 'room-builder-office', name: 'Room Builder (piso/parede)', category: 'Estrutura' },
]

// Temas de interiores do asset-4 que fazem sentido para um escritório.
const ASSET4_THEMES = [
  '1_Generic', '2_LivingRoom', '3_Bathroom', '5_Classroom_and_library',
  '6_Music_and_sport', '7_Art', '8_Gym', '13_Conference_Hall',
  '20_Japanese_interiors', '26_Condominium',
]
for (const theme of ASSET4_THEMES) {
  const label = theme.replace(/^\d+_/, '').replaceAll('_', ' ')
  SOURCES.push({
    zip: 'asset-4.zip',
    entry: `1_Interiors/48x48/Theme_Sorter_48x48/${theme}_48x48.png`,
    slug: theme.replace(/^\d+_/, '').replaceAll('_', '-').toLowerCase(),
    name: label.charAt(0).toUpperCase() + label.slice(1),
    category: 'Interiores',
  })
}

const zipsDir = process.argv[2]
if (!zipsDir) { console.error('Informe o diretório com os zips'); process.exit(1) }

const cwd = process.cwd()
const outDir = join(cwd, 'apps/web/public/office/tilesets')
const catalogPath = join(cwd, 'packages/shared/src/office-tileset-catalog.json')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'legends-tilesets-'))

const catalog = []
for (const src of SOURCES) {
  const zipPath = join(zipsDir, src.zip)
  if (!existsSync(zipPath)) { console.warn(`Zip ausente, pulando: ${src.zip}`); continue }
  // extrai só a entrada desejada para o tmp
  execFileSync('unzip', ['-o', '-j', zipPath, src.entry, '-d', tmp], { stdio: 'ignore' })
  const extracted = join(tmp, basename(src.entry))
  if (!existsSync(extracted)) { console.warn(`Entrada ausente: ${src.entry}`); continue }
  const destPng = join(outDir, `${src.slug}.png`)
  const meta = await sharp(extracted).metadata()
  const columns = Math.floor(meta.width / TILE)
  const rows = Math.floor(meta.height / TILE)
  // recorta para múltiplo exato do tile (a API valida columns = floor(w/tile))
  await sharp(extracted).extract({ left: 0, top: 0, width: columns * TILE, height: rows * TILE }).png({ compressionLevel: 9 }).toFile(destPng)
  catalog.push({
    id: `builtin:office/${src.slug}`,
    assetId: `builtin:office/${src.slug}`,
    name: src.name,
    category: src.category,
    url: `/office/tilesets/${src.slug}.png`,
    tileWidth: TILE,
    tileHeight: TILE,
    columns,
    tileCount: columns * rows,
    width: columns * TILE,
    height: rows * TILE,
  })
  console.log(`ok ${src.slug} ${columns}x${rows}`)
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n')
writeFileSync(join(outDir, 'CREDITS.txt'),
  'Tilesets: LimeZu — Modern Interiors (versão full).\n' +
  'https://limezu.itch.io/moderninteriors\n' +
  'Uso permitido em projeto comercial; redistribuição do asset proibida. Créditos obrigatórios.\n')
rmSync(tmp, { recursive: true, force: true })
console.log(`Catálogo com ${catalog.length} tilesets em ${catalogPath}`)
```

- [ ] **Step 2: Rodar o script**

Run: `node scripts/vendor-tilesets.mjs ~/Downloads`
Expected: imprime `ok <slug> CxR` para cada tileset e `Catálogo com N tilesets ...`; cria os PNGs em `apps/web/public/office/tilesets/` e o JSON.

- [ ] **Step 3: Conferir o JSON gerado**

Run: `node -e "const c=require('./packages/shared/src/office-tileset-catalog.json'); console.log(c.length, c[0])"`
Expected: número > 0 e um objeto com `id` começando por `builtin:office/`, `columns`/`tileCount`/`width`/`height` numéricos.

- [ ] **Step 4: Commit**

```bash
git add scripts/vendor-tilesets.mjs packages/shared/src/office-tileset-catalog.json apps/web/public/office/tilesets
git commit -m "feat(office): script de vendor + catálogo de tilesets default (LimeZu)"
```

### Task A2: Módulo tipado do catálogo em `@legends/shared`

**Files:**
- Create: `packages/shared/src/office-tileset-catalog.ts`
- Test: `packages/shared/src/office-tileset-catalog.test.ts`
- Modify: `packages/shared/src/index.ts` (adicionar `export * from './office-tileset-catalog'`)

**Interfaces:**
- Consumes: `office-tileset-catalog.json` (Task A1); `OfficeMapAssetDTO` de `./office-map`.
- Produces:
  - `interface OfficeTilesetCatalogEntry { id: string; assetId: string; name: string; category: string; url: string; tileWidth: number; tileHeight: number; columns: number; tileCount: number; width: number; height: number }`
  - `const OFFICE_TILESET_CATALOG: OfficeTilesetCatalogEntry[]`
  - `const OFFICE_TILESET_BY_ASSET_ID: Map<string, OfficeTilesetCatalogEntry>`
  - `function isBuiltinTilesetAssetId(assetId: string): boolean` — `assetId.startsWith('builtin:office/')`
  - `function builtinTilesetAsset(assetId: string): OfficeTilesetCatalogEntry | null`
  - `function officeTilesetCategories(): { category: string; entries: OfficeTilesetCatalogEntry[] }[]`
  - `function builtinAssetToDTO(entry: OfficeTilesetCatalogEntry): OfficeMapAssetDTO` — DTO sintético `{ id, fileName, mimeType:'image/png', sizeBytes:0, width, height, checksum:entry.id, url }`

- [ ] **Step 1: Escrever o teste**

```ts
// packages/shared/src/office-tileset-catalog.test.ts
import { describe, expect, it } from 'vitest'
import {
  OFFICE_TILESET_CATALOG, isBuiltinTilesetAssetId, builtinTilesetAsset,
  officeTilesetCategories, builtinAssetToDTO,
} from './office-tileset-catalog'

describe('office tileset catalog', () => {
  it('expõe entradas builtin com id/assetId iguais', () => {
    expect(OFFICE_TILESET_CATALOG.length).toBeGreaterThan(0)
    for (const e of OFFICE_TILESET_CATALOG) {
      expect(e.id).toBe(e.assetId)
      expect(isBuiltinTilesetAssetId(e.assetId)).toBe(true)
      expect(e.columns * Math.floor(e.height / e.tileHeight)).toBe(e.tileCount)
    }
  })
  it('resolve por assetId e agrupa por categoria', () => {
    const first = OFFICE_TILESET_CATALOG[0]
    expect(builtinTilesetAsset(first.assetId)?.id).toBe(first.id)
    expect(builtinTilesetAsset('builtin:office/inexistente')).toBeNull()
    expect(isBuiltinTilesetAssetId('outro-asset')).toBe(false)
    const groups = officeTilesetCategories()
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(OFFICE_TILESET_CATALOG.length)
  })
  it('gera DTO sintético de asset', () => {
    const dto = builtinAssetToDTO(OFFICE_TILESET_CATALOG[0])
    expect(dto.sizeBytes).toBe(0)
    expect(dto.url).toMatch(/^\/office\/tilesets\//)
  })
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/shared test -- office-tileset-catalog`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o módulo**

```ts
// packages/shared/src/office-tileset-catalog.ts
import rawCatalog from './office-tileset-catalog.json'
import type { OfficeMapAssetDTO } from './office-map'

export interface OfficeTilesetCatalogEntry {
  id: string
  assetId: string
  name: string
  category: string
  url: string
  tileWidth: number
  tileHeight: number
  columns: number
  tileCount: number
  width: number
  height: number
}

export const OFFICE_TILESET_CATALOG = rawCatalog as OfficeTilesetCatalogEntry[]

export const OFFICE_TILESET_BY_ASSET_ID: Map<string, OfficeTilesetCatalogEntry> =
  new Map(OFFICE_TILESET_CATALOG.map((entry) => [entry.assetId, entry]))

export function isBuiltinTilesetAssetId(assetId: string): boolean {
  return assetId.startsWith('builtin:office/')
}

export function builtinTilesetAsset(assetId: string): OfficeTilesetCatalogEntry | null {
  return OFFICE_TILESET_BY_ASSET_ID.get(assetId) ?? null
}

export function officeTilesetCategories(): { category: string; entries: OfficeTilesetCatalogEntry[] }[] {
  const byCategory = new Map<string, OfficeTilesetCatalogEntry[]>()
  for (const entry of OFFICE_TILESET_CATALOG) {
    const list = byCategory.get(entry.category) ?? []
    list.push(entry)
    byCategory.set(entry.category, list)
  }
  return [...byCategory.entries()].map(([category, entries]) => ({ category, entries }))
}

export function builtinAssetToDTO(entry: OfficeTilesetCatalogEntry): OfficeMapAssetDTO {
  return {
    id: entry.id,
    fileName: `${entry.name}.png`,
    mimeType: 'image/png',
    sizeBytes: 0,
    width: entry.width,
    height: entry.height,
    checksum: entry.id,
    url: entry.url,
  }
}
```

- [ ] **Step 4: Exportar no barril**

Em `packages/shared/src/index.ts`, adicionar após a linha `export * from './office-map-runtime'`:
```ts
export * from './office-tileset-catalog'
```

- [ ] **Step 5: Rodar o teste (passa) + typecheck**

Run: `pnpm --filter @legends/shared test -- office-tileset-catalog && pnpm --filter @legends/shared build`
Expected: PASS e build sem erros (garante `resolveJsonModule`/tipos ok).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/office-tileset-catalog.ts packages/shared/src/office-tileset-catalog.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): módulo tipado do catálogo de tilesets builtin"
```

### Task A3: Resolução de assets builtin na API

**Files:**
- Modify: `packages/shared/src/office-map.ts` (schema de `assetId` do tileset — ver Step 0)
- Modify: `apps/api/src/services/office-map-service.ts` (`assetUrl`, `validateDocument`, `getActiveOfficeMap`, `getOfficeMapPublication`)
- Test: `packages/shared/src/office-map-tileset-assetid.test.ts` (novo — Step 0)
- Test: `apps/api/src/services/office-map-service.test.ts` (criar se não existir; senão adicionar casos)

**Interfaces:**
- Consumes: `builtinTilesetAsset`, `builtinAssetToDTO`, `isBuiltinTilesetAssetId`, `OFFICE_TILESET_CATALOG` de `@legends/shared`.
- Produces: `MapTilesetAssetIdSchema` (aceita identificador normal **ou** `builtin:office/<slug>`); `validateDocument` aceita tilesets com `assetId` builtin sem linha em `OfficeMapAsset`, validando dimensões pelo catálogo; `getActiveOfficeMap`/`getOfficeMapPublication` incluem os assets builtin referenciados no array `assets` do DTO.

**Pré-requisito (bug de plano descoberto na execução):** `MapTilesetV1Schema.assetId` usa `MapIdentifierSchema`, cujo regex `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` **rejeita `:` e `/`**. Como os ids builtin são `builtin:office/<slug>`, qualquer documento com tileset builtin falha na validação **estrutural** (`MapDocumentV1StructuralSchema.safeParse`) antes de `validateDocument` rodar. O Step 0 relaxa **apenas** o campo `assetId` do tileset (blast radius mínimo — `MapIdentifierSchema` segue intacto nos ~10 outros campos).

- [ ] **Step 0: Relaxar o schema do `assetId` do tileset (shared, TDD)**

Escrever o teste `packages/shared/src/office-map-tileset-assetid.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MapTilesetV1Schema, OFFICE_TILESET_CATALOG } from './index'

const baseTileset = (assetId: string) => ({
  id: 'ts1', assetId, name: 'X', tileWidth: 48, tileHeight: 48, columns: 4, tileCount: 8,
})

describe('MapTilesetV1Schema.assetId', () => {
  it('aceita identificador normal (asset enviado)', () => {
    expect(MapTilesetV1Schema.safeParse(baseTileset('abc-123')).success).toBe(true)
  })
  it('aceita assetId builtin com dois-pontos e barra', () => {
    expect(MapTilesetV1Schema.safeParse(baseTileset(OFFICE_TILESET_CATALOG[0].assetId)).success).toBe(true)
    expect(MapTilesetV1Schema.safeParse(baseTileset('builtin:office/modern-office')).success).toBe(true)
  })
  it('rejeita assetId com caractere fora do padrão', () => {
    expect(MapTilesetV1Schema.safeParse(baseTileset('espaço inválido')).success).toBe(false)
    expect(MapTilesetV1Schema.safeParse(baseTileset('builtin:other/x')).success).toBe(false)
  })
})
```
Rodar (falha): `pnpm --filter @legends/shared test -- office-map-tileset-assetid` → FAIL (o assetId builtin é rejeitado hoje).

Em `packages/shared/src/office-map.ts`, **antes** de `MapTilesetV1Schema` (perto de `MapIdentifierSchema`, ~L69-83), adicionar e exportar:
```ts
export const MapTilesetAssetIdSchema = z.union([
  MapIdentifierSchema,
  z.string().regex(/^builtin:office\/[a-z0-9-]+$/, "Asset builtin inválido"),
]);
```
E em `MapTilesetV1Schema` (~L112-122) trocar `assetId: MapIdentifierSchema,` por `assetId: MapTilesetAssetIdSchema,`. Não mexer em nenhum outro uso de `MapIdentifierSchema`.

Rodar (passa): `pnpm --filter @legends/shared test -- office-map-tileset-assetid` → PASS. Typecheck: `npx tsc -p packages/shared/tsconfig.json --noEmit` → 0 erros.

- [ ] **Step 1: Escrever o teste (integração, Postgres real)**

```ts
// apps/api/src/services/office-map-service.test.ts (adicionar)
import { describe, expect, it } from 'vitest'
import { OFFICE_TILESET_CATALOG, createEmptyMapDocumentV1 } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createOfficeMap, acquireOfficeMapLock, saveOfficeMapDraft, publishOfficeMap, getActiveOfficeMap } from './office-map-service'

async function admin() {
  return prisma.user.create({ data: { name: 'Admin', email: `a${Date.now()}@x.dev`, passwordHash: 'x', role: 'ADMIN' } })
}

describe('builtin tilesets', () => {
  it('valida e publica documento usando tileset builtin sem linha em OfficeMapAsset', async () => {
    const user = await admin()
    const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, user.id)
    const builtin = OFFICE_TILESET_CATALOG[0]
    const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
    doc.tilesets.push({
      id: 'ts1', assetId: builtin.assetId, name: builtin.name,
      tileWidth: builtin.tileWidth, tileHeight: builtin.tileHeight,
      columns: builtin.columns, tileCount: builtin.tileCount,
    })
    const objectsLayer = doc.layers.find((l) => l.key === 'objects')
    if (objectsLayer?.type === 'tile') objectsLayer.data[0] = 'ts1:0'
    const lock = await acquireOfficeMapLock(mapId, user.id)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
    const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, user.id, lock.lockToken)
    const pub = await publishOfficeMap(mapId, saved.revision, user.id, true)
    expect(pub.activated).toBe(true)
    const active = await getActiveOfficeMap(user.id)
    expect(active.assets.some((a) => a.id === builtin.assetId && a.url === builtin.url)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm db:up && pnpm --filter @legends/api test -- office-map-service`
Expected: FAIL — `validateDocument` reporta `ASSET_NOT_FOUND` para o assetId builtin, ou `active.assets` não contém o builtin.

- [ ] **Step 3: Implementar a resolução builtin**

Em `apps/api/src/services/office-map-service.ts`, adicionar aos imports de `@legends/shared`:
```ts
  builtinTilesetAsset,
  builtinAssetToDTO,
  isBuiltinTilesetAssetId,
```

Trocar `assetUrl` para reconhecer builtin:
```ts
function assetUrl(storageKey: string): string {
  if (storageKey === 'builtin:legacy-office-tileset') return '/office/legacy-office-tileset.svg'
  const builtin = builtinTilesetAsset(storageKey)
  if (builtin) return builtin.url
  const cfg = s3Config()
  if (!cfg) return ''
  return publicUrlFor(storageKey, cfg)
}
```

Em `validateDocument`, separar assetIds builtin dos de banco (substituir o bloco `const ids = ...` até o fim do `forEach`):
```ts
  const allIds = [...new Set(structural.data.tilesets.map((tileset) => tileset.assetId))]
  const dbIds = allIds.filter((id) => !isBuiltinTilesetAssetId(id))
  const assets = dbIds.length
    ? await db.officeMapAsset.findMany({ where: { mapId, id: { in: dbIds } } })
    : []
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  structural.data.tilesets.forEach((tileset, index) => {
    const builtin = builtinTilesetAsset(tileset.assetId)
    const dims = builtin
      ? { width: builtin.width, height: builtin.height }
      : byId.get(tileset.assetId)
    if (!dims) {
      errors.push({ code: 'ASSET_NOT_FOUND', path: `tilesets[${index}].assetId`, message: 'O asset do tileset não pertence a este mapa' })
      return
    }
    const columns = Math.floor(dims.width / tileset.tileWidth)
    const rows = Math.floor(dims.height / tileset.tileHeight)
    if (columns !== tileset.columns || columns * rows !== tileset.tileCount) {
      errors.push({ code: 'ASSET_DIMENSIONS_INVALID', path: `tilesets[${index}]`, message: 'A grade do tileset não corresponde às dimensões da imagem' })
    }
  })
  return { valid: errors.length === 0, errors, document: structural.data, assets }
```
(Nota: `assets` retornado segue só com as linhas de banco — os builtin não geram `OfficeMapPublicationAsset`, o que é correto pois não têm FK.)

Adicionar um helper para anexar assets builtin ao DTO e usá-lo em `getActiveOfficeMap` e `getOfficeMapPublication`:
```ts
function withBuiltinAssets(document: MapDocumentV1, assets: OfficeMapAssetDTO[]): OfficeMapAssetDTO[] {
  const present = new Set(assets.map((asset) => asset.id))
  const extra: OfficeMapAssetDTO[] = []
  for (const tileset of document.tilesets) {
    const builtin = builtinTilesetAsset(tileset.assetId)
    if (builtin && !present.has(builtin.assetId)) {
      present.add(builtin.assetId)
      extra.push(builtinAssetToDTO(builtin))
    }
  }
  return extra.length ? [...assets, ...extra] : assets
}
```

Em `getActiveOfficeMap`, trocar a montagem de `assets` no return:
```ts
  const document = publication.mapData as unknown as MapDocumentV1
  const dbAssets = publication.assetLinks.map(({ asset }) => asAsset(asset))
  return {
    map: publication.map,
    publication: asPublication(publication, publication.id),
    document,
    assets: withBuiltinAssets(document, dbAssets),
    rooms,
  }
```
Em `getOfficeMapPublication`, análogo: `document: publication.mapData as ...`; `assets: withBuiltinAssets(document, publication.assetLinks.map(({ asset }) => asAsset(asset)))`.

- [ ] **Step 4: Rodar o teste (passa)**

Run: `pnpm --filter @legends/api test -- office-map-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office-map.ts packages/shared/src/office-map-tileset-assetid.test.ts apps/api/src/services/office-map-service.ts apps/api/src/services/office-map-service.test.ts
git commit -m "feat(api): resolver tilesets builtin sem linha em OfficeMapAsset"
```

### Task A4: Componente `TilesetPalette` compartilhado (catálogo + assets do mapa, por categoria)

**Files:**
- Create: `apps/web/src/office/editor/TilesetPalette.tsx`
- Test: `apps/web/src/office/editor/TilesetPalette.test.tsx`

**Interfaces:**
- Consumes: `OFFICE_TILESET_CATALOG`, `officeTilesetCategories`, `builtinAssetToDTO`, `isBuiltinTilesetAssetId` de `@legends/shared`; `OfficeMapAssetDTO`, `MapTilesetV1`.
- Produces:
  - `interface TilesetPaletteProps { mapAssets: OfficeMapAssetDTO[]; mapTilesets: MapTilesetV1[]; selected: { tilesetId: string; tileIndex: number } | null; onSelectTile: (pick: { entry: OfficeTilesetCatalogEntry | OfficeMapAssetDTO; isBuiltin: boolean; tileIndex: number }) => void }`
  - `default export function TilesetPalette(props): JSX.Element` — renderiza grupos colapsáveis: "Tilesets padrão" (por categoria, do catálogo) + "Assets do mapa" (uploads). Cada célula 44px usa `background-image: url(asset.url)` + `background-position` calculado por `tileIndex`.

Componente **apresentacional**: recebe assets/tilesets já resolvidos e emite a seleção; o consumidor (editor admin na A5, drawer na Fase C) decide como materializar o tileset no documento.

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/office/editor/TilesetPalette.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OFFICE_TILESET_CATALOG } from '@legends/shared'
import TilesetPalette from './TilesetPalette'

describe('TilesetPalette', () => {
  it('mostra grupo de tilesets padrão e emite seleção builtin', () => {
    const onSelectTile = vi.fn()
    render(<TilesetPalette mapAssets={[]} mapTilesets={[]} selected={null} onSelectTile={onSelectTile} />)
    // expande primeiro grupo do catálogo
    const first = OFFICE_TILESET_CATALOG[0]
    fireEvent.click(screen.getByText(first.name))
    const cell = screen.getAllByTestId('tileset-cell')[0]
    fireEvent.click(cell)
    expect(onSelectTile).toHaveBeenCalledWith(expect.objectContaining({ isBuiltin: true, tileIndex: 0 }))
  })
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/web test -- TilesetPalette`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar o componente**

```tsx
// apps/web/src/office/editor/TilesetPalette.tsx
import { useState } from 'react'
import {
  OFFICE_TILESET_CATALOG, officeTilesetCategories,
  type OfficeMapAssetDTO, type MapTilesetV1, type OfficeTilesetCatalogEntry,
} from '@legends/shared'

const CELL = 44

export interface TilesetPaletteProps {
  mapAssets: OfficeMapAssetDTO[]
  mapTilesets: MapTilesetV1[]
  selected: { tilesetId: string; tileIndex: number } | null
  onSelectTile: (pick: { entry: OfficeTilesetCatalogEntry | OfficeMapAssetDTO; isBuiltin: boolean; tileIndex: number }) => void
}

function TileGrid(props: {
  url: string; columns: number; tileCount: number; tileWidth: number; tileHeight: number
  onPick: (tileIndex: number) => void
}) {
  const { url, columns, tileCount, tileWidth, tileHeight, onPick } = props
  const scaleW = (CELL / tileWidth) * columns * tileWidth
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, ${CELL}px)`, gap: 1 }}>
      {Array.from({ length: tileCount }, (_, i) => {
        const col = i % columns
        const row = Math.floor(i / columns)
        return (
          <button
            key={i}
            type="button"
            data-testid="tileset-cell"
            onClick={() => onPick(i)}
            style={{
              width: CELL, height: CELL,
              backgroundImage: `url(${url})`,
              backgroundSize: `${scaleW}px auto`,
              backgroundPosition: `-${col * CELL}px -${row * CELL}px`,
              imageRendering: 'pixelated', border: '1px solid #2b3350',
            }}
          />
        )
      })}
    </div>
  )
}

export default function TilesetPalette({ mapAssets, mapTilesets, onSelectTile }: TilesetPaletteProps) {
  const [open, setOpen] = useState<string | null>(null)
  const catalogGroups = officeTilesetCategories()
  return (
    <div className="tileset-palette">
      <h4>Tilesets padrão</h4>
      {catalogGroups.map((group) => (
        <div key={group.category}>
          <strong>{group.category}</strong>
          {group.entries.map((entry) => (
            <section key={entry.id}>
              <button type="button" onClick={() => setOpen(open === entry.id ? null : entry.id)}>{entry.name}</button>
              {open === entry.id && (
                <TileGrid
                  url={entry.url} columns={entry.columns} tileCount={entry.tileCount}
                  tileWidth={entry.tileWidth} tileHeight={entry.tileHeight}
                  onPick={(tileIndex) => onSelectTile({ entry, isBuiltin: true, tileIndex })}
                />
              )}
            </section>
          ))}
        </div>
      ))}
      {mapAssets.length > 0 && (
        <>
          <h4>Assets do mapa</h4>
          {mapAssets.map((asset) => {
            const ts = mapTilesets.find((t) => t.assetId === asset.id)
            const columns = ts?.columns ?? Math.max(1, Math.floor(asset.width / 32))
            const tileCount = ts?.tileCount ?? columns * Math.floor(asset.height / 32)
            return (
              <section key={asset.id}>
                <button type="button" onClick={() => setOpen(open === asset.id ? null : asset.id)}>{asset.fileName}</button>
                {open === asset.id && (
                  <TileGrid
                    url={asset.url} columns={columns} tileCount={tileCount}
                    tileWidth={ts?.tileWidth ?? 32} tileHeight={ts?.tileHeight ?? 32}
                    onPick={(tileIndex) => onSelectTile({ entry: asset, isBuiltin: false, tileIndex })}
                  />
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste (passa)**

Run: `pnpm --filter @legends/web test -- TilesetPalette`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editor/TilesetPalette.tsx apps/web/src/office/editor/TilesetPalette.test.tsx
git commit -m "feat(web): palette de tilesets compartilhado (catálogo + assets por categoria)"
```

### Task A5: Ligar o palette no editor admin

**Files:**
- Modify: `apps/web/src/office/editor/MapEditor.tsx` (adicionar `ensureBuiltinTileset`, guardar `removeAsset`, e injetar `<TilesetPalette>` no `TilesetsPanel`)

**Interfaces:**
- Consumes: `TilesetPalette` (A4); `builtinTilesetAsset`, `builtinAssetToDTO`, `isBuiltinTilesetAssetId` de `@legends/shared`.
- Produces: ao escolher um tile builtin do catálogo, o editor injeta o asset builtin sintético em `assets` (para o canvas resolver a URL), garante um `MapTilesetV1` no documento e seleciona `{ tilesetId, tileIndex }` com brush.

**Padrões reais do `MapEditor.tsx` (confirmados na leitura — use estes nomes, NÃO os genéricos):**
- Estado do documento: `const [document, setDocument] = useState<MapDocumentV1 | null>(null)` (L269). Edições do usuário mutam via `const next = cloneDocument(document)` → mutação → `commitDocument(next, "Rótulo")` (undo/redo-aware) — ver `uploadAsset` L856-873 e `removeAsset` L898-913 como exemplos canônicos. NÃO use `setDocument` direto para edição do usuário.
- Assets: `const [assets, setAssets] = useState<MapAsset[]>([])` (L274). `type MapAsset` (L44-53) é **estruturalmente idêntico** a `OfficeMapAssetDTO` — `builtinAssetToDTO(entry)` produz um objeto compatível.
- Seleção: `setSelectedTilesetId` / `setSelectedTileIndex`; troca de ferramenta: `setTool('brush')`; painel: `setPanel('tilesets')`.
- O canvas (`MapCanvas`) resolve tiles a partir de `props.assets` por `asset.url` (MapCanvas.tsx L354-365). Por isso um tileset builtin no documento só renderiza no canvas se o asset builtin também estiver em `assets`.
- `TilesetsPanel` (L1477) já renderiza `document.tilesets` (com remover) e o upload. Vamos ADICIONAR uma seção de catálogo, sem remover a existente.

- [ ] **Step 1: `ensureBuiltinTileset` + guard de remoção no `MapEditor`**

Adicionar aos imports de `@legends/shared` no topo: `builtinTilesetAsset`, `builtinAssetToDTO`, `isBuiltinTilesetAssetId`.

Dentro do componente (junto de `uploadAsset`/`removeAsset`), adicionar:
```ts
function ensureBuiltinTileset(assetId: string): string | null {
  if (!document) return null;
  const builtin = builtinTilesetAsset(assetId);
  if (!builtin) return null;
  // 1) injeta o asset builtin sintético em `assets` para o canvas resolver a URL
  setAssets((items) =>
    items.some((item) => item.id === assetId) ? items : [builtinAssetToDTO(builtin), ...items],
  );
  // 2) garante o tileset no documento (via clone/commit, padrão do editor)
  const existing = document.tilesets.find((t) => t.assetId === assetId);
  if (existing) return existing.id;
  const tilesetId = uniqueId(
    `builtin-${assetId.split("/").pop()}`,
    document.tilesets.map((t) => t.id),
  );
  const next = cloneDocument(document);
  next.tilesets.push({
    id: tilesetId,
    assetId,
    name: builtin.name,
    tileWidth: builtin.tileWidth,
    tileHeight: builtin.tileHeight,
    columns: builtin.columns,
    tileCount: builtin.tileCount,
  });
  commitDocument(next, "Adicionar tileset padrão");
  return tilesetId;
}
```
(`uniqueId`, `cloneDocument`, `commitDocument` já existem no arquivo — confirme e reutilize.)

Guardar `removeAsset` (L885) para não bater na API em asset builtin — logo no início:
```ts
async function removeAsset(asset: MapAsset) {
  if (!session || !document || !confirm(`Excluir ${asset.fileName}?`)) return;
  const builtin = isBuiltinTilesetAssetId(asset.id);
  try {
    if (!builtin) {
      await apiRequest(`admin/office-maps/${mapId}/assets/${asset.id}`, { method: "DELETE" }, session.accessToken);
    }
    // ... resto do cleanup local existente (removedTilesets, cloneDocument, filtra tilesets/layers/objects, setAssets) permanece igual ...
```
(Só embrulhe a chamada `apiRequest` DELETE no `if (!builtin)`; o cleanup local do documento roda para ambos.)

- [ ] **Step 2: Injetar o catálogo no `TilesetsPanel`**

`TilesetPalette` renderiza a seção "Assets do mapa" apenas quando `mapAssets.length > 0`; passando `mapAssets={[]}` ele mostra **só** o catálogo ("Tilesets padrão") — evitando duplicar a lista de assets que o `TilesetsPanel` já tem.

Adicionar uma prop `onSelectBuiltin: (assetId: string, tileIndex: number) => void` ao `TilesetsPanel` (na assinatura de props L1487-1497 e no destructuring L1477-1486). Renderizar, dentro do `TilesetsPanel` (ex. após a seção de assets, antes do fechamento), o catálogo:
```tsx
<section className="map-editor-panel-section">
  <TilesetPalette
    mapAssets={[]}
    mapTilesets={document.tilesets}
    selected={selectedTilesetId ? { tilesetId: selectedTilesetId, tileIndex: selectedIndex } : null}
    onSelectTile={({ entry, isBuiltin, tileIndex }) => {
      if (isBuiltin) onSelectBuiltin((entry as { assetId: string }).assetId, tileIndex);
    }}
  />
</section>
```
E, no ponto de uso do `TilesetsPanel` (L1385), passar:
```tsx
onSelectBuiltin={(assetId, tileIndex) => {
  const tilesetId = ensureBuiltinTileset(assetId);
  if (!tilesetId) return;
  setSelectedTilesetId(tilesetId);
  setSelectedTileIndex(tileIndex);
  setTool("brush");
}}
```
Importar `TilesetPalette` no topo do arquivo. Não remover a seção de assets/upload existente.

- [ ] **Step 3: Typecheck + testes web + smoke**

Run: `pnpm --filter @legends/web test -- "TilesetPalette|MapEditor" ` (os existentes seguem verdes) e o typecheck do web (script `tsc --noEmit` do `apps/web` — confira `apps/web/package.json`).
Expected: verde; sem erros de tipo. Se não houver teste de `MapEditor`, apenas o typecheck + `TilesetPalette` verde já cobrem a integração (a verificação funcional vem no smoke manual da Fase C).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/office/editor/MapEditor.tsx
git commit -m "feat(web): editor admin usa palette de tilesets padrão"
```

---

# FASE B — Guard de decoração + API de membro + refresh suave

Entrega: endpoints `/office/map/edit/*` que deixam não-admin salvar/publicar mudanças decoração-only no mapa ativo, com trava no servidor e evento socket leve.

### Task B1: `assertOnlyDecorationChanged` no shared

**Files:**
- Modify: `packages/shared/src/office-map.ts` (adicionar guard + tipos ao fim, antes dos aliases finais)
- Test: `packages/shared/src/office-map-decoration.test.ts`
- Barril: já exportado por `export * from './office-map'`.

**Interfaces:**
- Consumes: `MapDocumentV1`, `MapObjectV1`, `MapLayerV1`, `RESERVED_MAP_LAYERS`.
- Produces:
  - `interface MapStructuralViolation { code: string; message: string; path: string }`
  - `type DecorationGuardResult = { ok: true } | { ok: false; violations: MapStructuralViolation[] }`
  - `const STRUCTURAL_LAYER_KEYS = ['walls'] as const` e `const STRUCTURAL_OBJECT_TYPES = ['spawn-point'] as const`
  - `function assertOnlyDecorationChanged(previous: MapDocumentV1, next: MapDocumentV1): DecorationGuardResult`

Regra: `next` só pode diferir de `previous` em decoração. São **estruturais** (violação se mudarem): qualquer campo de `map`; o conjunto de layers por `key`/`type`/`zIndex`/`name`/ordem; os `data[]` da layer `walls`; e os objetos `spawn-point`. Tiles em `floor`/`objects` e objetos de tipos de decoração podem mudar livremente. `collision` e `door` são decoração (não entram no diff estrutural).

- [ ] **Step 1: Escrever o teste**

```ts
// packages/shared/src/office-map-decoration.test.ts
import { describe, expect, it } from 'vitest'
import { createEmptyMapDocumentV1, assertOnlyDecorationChanged, type MapDocumentV1 } from './index'

function clone(doc: MapDocumentV1): MapDocumentV1 { return JSON.parse(JSON.stringify(doc)) }
const base = () => createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })

describe('assertOnlyDecorationChanged', () => {
  it('aceita pintura em objects e floor', () => {
    const prev = base(); const next = clone(prev)
    for (const key of ['objects', 'floor']) {
      const layer = next.layers.find((l) => l.key === key)
      if (layer?.type === 'tile') layer.data[0] = 'ts:0'
    }
    expect(assertOnlyDecorationChanged(prev, next)).toEqual({ ok: true })
  })
  it('aceita adicionar collision, door, private-zone, link, action-point e tile-object', () => {
    const prev = base(); const next = clone(prev)
    next.objects.push({ id: 'c1', layerKey: 'collision', type: 'collision', geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 }, properties: {} })
    next.objects.push({ id: 'z1', layerKey: 'private-zones', type: 'private-zone', geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 }, properties: { name: 'Silêncio', accessPolicy: 'OPEN' } })
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
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/shared test -- office-map-decoration`
Expected: FAIL — `assertOnlyDecorationChanged` não existe.

- [ ] **Step 3: Implementar o guard**

Adicionar em `packages/shared/src/office-map.ts` (antes de `export const MapV1Schema`):
```ts
export interface MapStructuralViolation { code: string; message: string; path: string }
export type DecorationGuardResult = { ok: true } | { ok: false; violations: MapStructuralViolation[] }

export const STRUCTURAL_LAYER_KEYS = ['walls'] as const
export const STRUCTURAL_OBJECT_TYPES = ['spawn-point'] as const

function layerSignature(layer: MapLayerV1) {
  return JSON.stringify({ id: layer.id, key: layer.key, name: layer.name, type: layer.type, zIndex: layer.zIndex })
}
function structuralObjectsSignature(objects: MapObjectV1[]) {
  return JSON.stringify(
    objects
      .filter((object) => (STRUCTURAL_OBJECT_TYPES as readonly string[]).includes(object.type))
      .map((object) => ({ id: object.id, type: object.type, layerKey: object.layerKey, geometry: object.geometry, properties: object.properties }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
}
function wallsData(document: MapDocumentV1) {
  const walls = document.layers.find((layer) => layer.key === 'walls')
  return walls && walls.type === 'tile' ? JSON.stringify(walls.data) : '[]'
}

export function assertOnlyDecorationChanged(previous: MapDocumentV1, next: MapDocumentV1): DecorationGuardResult {
  const violations: MapStructuralViolation[] = []
  if (JSON.stringify(previous.map) !== JSON.stringify(next.map)) {
    violations.push({ code: 'MAP_METADATA_CHANGED', message: 'Dimensões, tile ou cor de fundo são estruturais', path: 'map' })
  }
  const prevLayers = previous.layers.map(layerSignature)
  const nextLayers = next.layers.map(layerSignature)
  if (JSON.stringify(prevLayers) !== JSON.stringify(nextLayers)) {
    violations.push({ code: 'LAYER_TOPOLOGY_CHANGED', message: 'Adicionar, remover, reordenar ou alterar layers é estrutural', path: 'layers' })
  }
  if (wallsData(previous) !== wallsData(next)) {
    violations.push({ code: 'WALLS_CHANGED', message: 'A layer de paredes é estrutural', path: 'layers.walls.data' })
  }
  if (structuralObjectsSignature(previous.objects) !== structuralObjectsSignature(next.objects)) {
    violations.push({ code: 'SPAWN_CHANGED', message: 'Pontos de entrada são estruturais', path: 'objects.spawn-point' })
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
```

- [ ] **Step 4: Rodar o teste (passa)**

Run: `pnpm --filter @legends/shared test -- office-map-decoration && pnpm --filter @legends/shared build`
Expected: PASS + build ok.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office-map.ts packages/shared/src/office-map-decoration.test.ts
git commit -m "feat(shared): guard assertOnlyDecorationChanged (decoração vs estrutura)"
```

### Task B2: Evento socket `map-decor-updated`

**Files:**
- Modify: `packages/shared/src/office.ts` (`OfficeServerMessage` ~L173-227)
- Modify: `apps/api/src/lib/office-hub.ts` (novo método `broadcastMapDecorUpdated`)
- Modify: `apps/web/src/office/session/OfficeSessionContext.tsx` (tratar o evento sem reload)
- Test: `apps/web/src/office/session/OfficeSessionContext.test.tsx` (criar; testa só o handler puro — ver abaixo)

**Interfaces:**
- Consumes: `OfficeServerMessage` union.
- Produces:
  - Novo membro da union: `{ type: 'map-decor-updated'; publicationId: string }`
  - `officeHub.broadcastMapDecorUpdated(publicationId: string): void`
  - Cliente: ao receber `map-decor-updated`, invalida a query `['office','active-map']` (refetch) — sem `window.location.reload()`.

- [ ] **Step 1: Adicionar o tipo na union (shared)**

Em `packages/shared/src/office.ts`, no `OfficeServerMessage`, após o membro `{ type: "map-changed"; publicationId: string }` adicionar:
```ts
  | { type: "map-decor-updated"; publicationId: string }
```

- [ ] **Step 2: Broadcast no hub**

Em `apps/api/src/lib/office-hub.ts`, adicionar método público (perto de `configure`):
```ts
  broadcastMapDecorUpdated(publicationId: string): void {
    this.broadcast({ type: 'map-decor-updated', publicationId })
  }
```
(NÃO limpa `this.entries` nem reposiciona — é só um aviso de refresh.)

- [ ] **Step 3: Tratar no cliente (invalidar query, sem reload)**

Em `apps/web/src/office/session/OfficeSessionContext.tsx`, no `useEffect` que já escuta `bridge.onServerMessage` para `map-changed`, adicionar o novo caso (usando o `queryClient` já disponível via `useQueryClient()`; se não houver, importe e crie):
```ts
useEffect(() => bridge.onServerMessage((message) => {
  if (message.type === 'map-changed') {
    if (window.location.pathname === '/escritorio') window.location.reload()
    else leaveOffice()
    return
  }
  if (message.type === 'map-decor-updated') {
    queryClient.invalidateQueries({ queryKey: ['office', 'active-map'] })
  }
}), [bridge, leaveOffice, queryClient])
```

- [ ] **Step 4: Escrever teste do handler**

Extrair a decisão para uma função pura testável em um novo `apps/web/src/office/session/mapMessage.ts`:
```ts
// apps/web/src/office/session/mapMessage.ts
import type { OfficeServerMessage } from '@legends/shared'
export type MapMessageEffect = 'reload' | 'leave' | 'refetch' | 'ignore'
export function mapMessageEffect(message: OfficeServerMessage, onOfficePage: boolean): MapMessageEffect {
  if (message.type === 'map-changed') return onOfficePage ? 'reload' : 'leave'
  if (message.type === 'map-decor-updated') return 'refetch'
  return 'ignore'
}
```
Usar `mapMessageEffect` dentro do `useEffect` acima. Teste:
```ts
// apps/web/src/office/session/mapMessage.test.ts
import { describe, expect, it } from 'vitest'
import { mapMessageEffect } from './mapMessage'
describe('mapMessageEffect', () => {
  it('map-changed recarrega no escritório, sai fora dele', () => {
    expect(mapMessageEffect({ type: 'map-changed', publicationId: 'p' }, true)).toBe('reload')
    expect(mapMessageEffect({ type: 'map-changed', publicationId: 'p' }, false)).toBe('leave')
  })
  it('map-decor-updated apenas refaz o fetch', () => {
    expect(mapMessageEffect({ type: 'map-decor-updated', publicationId: 'p' }, true)).toBe('refetch')
  })
})
```

- [ ] **Step 5: Rodar testes + build shared**

Run: `pnpm --filter @legends/shared build && pnpm --filter @legends/web test -- mapMessage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/office.ts apps/api/src/lib/office-hub.ts apps/web/src/office/session/OfficeSessionContext.tsx apps/web/src/office/session/mapMessage.ts apps/web/src/office/session/mapMessage.test.ts
git commit -m "feat(office): evento map-decor-updated com refresh suave (sem reload)"
```

### Task B3: Serviço de decoração por membro

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts` (novas funções)
- Test: `apps/api/src/services/office-map-service.test.ts`

**Interfaces:**
- Consumes: `assertOnlyDecorationChanged`, `getActiveOfficeMap`, `acquireOfficeMapLock`, `saveOfficeMapDraft`, `publishOfficeMap`, `officeHub`.
- Produces:
  - `async function getActiveMapIdForEditing(): Promise<string>` — resolve o `mapId` do publication ativo (404 `ACTIVE_MAP_NOT_FOUND` se não houver).
  - `async function saveOfficeDecorationDraft(input: { revision: number; document: unknown }, userId: string, lockToken: string): Promise<...>` — resolve o mapa ativo; roda o guard contra o **documento ativo publicado**; se violar, 403 `STRUCTURAL_EDIT_FORBIDDEN` com `{ violations }`; senão delega a `saveOfficeMapDraft`.
  - `async function publishOfficeDecoration(revision: number, userId: string): Promise<...>` — resolve o mapa ativo; roda o guard sobre o **draft** vs publicação ativa; publica com `activate: true` mas via caminho **suave**: em vez de `officeHub.configure(..., true)`, chama a lógica de publicação sem disconnect e emite `broadcastMapDecorUpdated`.

Para o caminho suave, refatorar `publishOfficeMap` para aceitar um modo. Adicionar parâmetro opcional `options?: { soft?: boolean }`; quando `soft`, ao final trocar `officeHub.configure(await getActiveOfficeMap(), true)` por `officeHub.configure(await getActiveOfficeMap(), false)` seguido de `officeHub.broadcastMapDecorUpdated(result.publication.id)`.

- [ ] **Step 1: Escrever o teste**

```ts
// apps/api/src/services/office-map-service.test.ts (adicionar)
import { getActiveMapIdForEditing, saveOfficeDecorationDraft, publishOfficeDecoration } from './office-map-service'
import { OfficeMapError } from './office-map-service'

describe('edição de decoração por membro', () => {
  it('rejeita delta estrutural com 403', async () => {
    // (setup: cria mapa, publica ativo — reutilize helper do teste builtin)
    const { user, mapId, activeDoc, revision } = await seedActiveMap()
    const bad = JSON.parse(JSON.stringify(activeDoc)); bad.map.width += 1
    const lock = await acquireOfficeMapLock(mapId, user.id)
    await expect(saveOfficeDecorationDraft({ revision, document: bad }, user.id, lock.lockToken))
      .rejects.toMatchObject({ status: 403, code: 'STRUCTURAL_EDIT_FORBIDDEN' })
  })
  it('aceita decoração e publica pelo caminho suave', async () => {
    const { user, mapId, activeDoc, revision } = await seedActiveMap()
    const good = JSON.parse(JSON.stringify(activeDoc))
    const objects = good.layers.find((l: any) => l.key === 'objects')
    if (objects) objects.data[0] = null // mudança inócua de decoração (segue válido)
    const lock = await acquireOfficeMapLock(mapId, user.id)
    const saved = await saveOfficeDecorationDraft({ revision, document: good }, user.id, lock.lockToken)
    const pub = await publishOfficeDecoration(saved.revision, user.id)
    expect(pub.activated).toBe(true)
  })
})
```
(Implemente `seedActiveMap()` no arquivo de teste reutilizando o fluxo do teste da Task A3: cria admin, mapa, adiciona um tileset builtin, publica ativo, e devolve `{ user, mapId, activeDoc, revision }` onde `activeDoc` = documento publicado e `revision` = revisão atual do draft.)

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/api test -- office-map-service`
Expected: FAIL — funções não existem.

- [ ] **Step 3: Implementar as funções + modo soft**

Adicionar imports: `assertOnlyDecorationChanged` de `@legends/shared`.
```ts
export async function getActiveMapIdForEditing(): Promise<string> {
  const setting = await prisma.officeSetting.findUnique({
    where: { id: 1 },
    select: { activeMapPublication: { select: { mapId: true } } },
  })
  const mapId = setting?.activeMapPublication?.mapId
  if (!mapId) fail('Nenhum mapa foi publicado para o escritório', 404, 'ACTIVE_MAP_NOT_FOUND')
  return mapId
}

async function activeDocument(): Promise<MapDocumentV1> {
  const active = await getActiveOfficeMap()
  return active.document
}

export async function saveOfficeDecorationDraft(
  input: { revision: number; document: unknown },
  userId: string,
  lockToken: string,
) {
  const mapId = await getActiveMapIdForEditing()
  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    const validation = validateMapDocumentV1(input.document)
    fail('A estrutura do documento é inválida', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
  }
  const guard = assertOnlyDecorationChanged(await activeDocument(), structural.data)
  if (!guard.ok) fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
  return saveOfficeMapDraft(mapId, { revision: input.revision, document: structural.data }, userId, lockToken)
}

export async function publishOfficeDecoration(revision: number, userId: string) {
  const mapId = await getActiveMapIdForEditing()
  const draft = await prisma.officeMapDraft.findUnique({ where: { mapId } })
  if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
  const guard = assertOnlyDecorationChanged(await activeDocument(), draft.document as unknown as MapDocumentV1)
  if (!guard.ok) fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
  return publishOfficeMap(mapId, revision, userId, true, { soft: true })
}
```
Alterar a assinatura de `publishOfficeMap`:
```ts
export async function publishOfficeMap(mapId: string, revision: number, userId: string, activate: boolean, options: { soft?: boolean } = {}) {
  // ... corpo idêntico até o final ...
  if (activate) {
    if (options.soft) {
      officeHub.configure(await getActiveOfficeMap(), false)
      officeHub.broadcastMapDecorUpdated(result.publication.id)
    } else {
      officeHub.configure(await getActiveOfficeMap(), true)
    }
  }
  return result
}
```

- [ ] **Step 4: Rodar o teste (passa)**

Run: `pnpm --filter @legends/api test -- office-map-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/office-map-service.ts apps/api/src/services/office-map-service.test.ts
git commit -m "feat(api): serviço de decoração por membro (guard + publish suave)"
```

### Task B4: Rotas `/office/map/edit/*`

**Files:**
- Modify: `apps/api/src/routes/office-maps.ts` (adicionar rotas de membro no fim de `officeMapRoutes`)
- Test: `apps/api/src/routes/office-maps.test.ts` (criar se não existir; testa via `buildApp` + token não-admin)

**Interfaces:**
- Consumes: `acquireOfficeMapLock`, `heartbeatOfficeMapLock`, `releaseOfficeMapLock`, `getActiveMapIdForEditing`, `getOfficeMapDraft`, `saveOfficeDecorationDraft`, `publishOfficeDecoration`.
- Produces (todas com `onRequest: [app.authenticate]`, **sem** `requireAdmin`):
  - `GET /office/map/edit/draft` → draft do mapa ativo (`getOfficeMapDraft(await getActiveMapIdForEditing())`)
  - `POST /office/map/edit/lock` (+ `/heartbeat`, + `DELETE /office/map/edit/lock`) sobre o mapa ativo
  - `PUT /office/map/edit/draft` → `saveOfficeDecorationDraft` (body `{ revision, document }`, header `x-map-lock-token`)
  - `POST /office/map/edit/publish` → `publishOfficeDecoration` (body `{ revision }`)

- [ ] **Step 1: Escrever o teste**

```ts
// apps/api/src/routes/office-maps.test.ts
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
// helpers de auth: criar usuário MEMBER, publicar mapa ativo (via service), gerar JWT.
describe('rotas de decoração por membro', () => {
  it('membro adquire lock e salva decoração, mas 403 em delta estrutural', async () => {
    const app = await buildApp()
    const { token, mapId, activeDoc, revision } = await seedMemberAndActiveMap(app)
    const lock = await app.inject({ method: 'POST', url: '/office/map/edit/lock', headers: { authorization: `Bearer ${token}` } })
    expect(lock.statusCode).toBe(200)
    const lockToken = lock.json().lockToken
    const bad = JSON.parse(JSON.stringify(activeDoc)); bad.map.height += 1
    const res = await app.inject({
      method: 'PUT', url: '/office/map/edit/draft',
      headers: { authorization: `Bearer ${token}`, 'x-map-lock-token': lockToken },
      payload: { revision, document: bad },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('STRUCTURAL_EDIT_FORBIDDEN')
    await app.close()
  })
})
```
(Implemente `seedMemberAndActiveMap` reaproveitando os helpers de outros testes de rota do repo para criar usuário `MEMBER`, emitir JWT via `app.jwt.sign({ sub, role })`, e publicar um mapa ativo pelo service.)

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/api test -- office-maps`
Expected: FAIL — rotas não existem (404).

- [ ] **Step 3: Implementar as rotas**

Em `apps/api/src/routes/office-maps.ts`, importar as novas funções do service e adicionar antes da linha final `app.get('/office/map', ...)`:
```ts
  const member = { onRequest: [app.authenticate] }
  const decorSaveSchema = z.object({ revision: z.number().int().nonnegative(), document: z.unknown() })
  const decorPublishSchema = z.object({ revision: z.number().int().nonnegative() })

  app.get('/office/map/edit/draft', member, async () =>
    getOfficeMapDraft(await getActiveMapIdForEditing()))

  app.post('/office/map/edit/lock', member, async (request) =>
    acquireOfficeMapLock(await getActiveMapIdForEditing(), request.user.sub))

  app.post('/office/map/edit/lock/heartbeat', member, async (request) =>
    heartbeatOfficeMapLock(await getActiveMapIdForEditing(), request.user.sub, lockToken(request.headers)))

  app.delete('/office/map/edit/lock', member, async (request, reply) => {
    await releaseOfficeMapLock(await getActiveMapIdForEditing(), request.user.sub, lockToken(request.headers))
    return reply.code(204).send()
  })

  app.put('/office/map/edit/draft', member, async (request, reply) => {
    const body = decorSaveSchema.safeParse(request.body)
    if (!body.success) return badInput(reply, body.error)
    return saveOfficeDecorationDraft(
      { revision: body.data.revision, document: (request.body as { document: unknown }).document },
      request.user.sub,
      lockToken(request.headers),
    )
  })

  app.post('/office/map/edit/publish', member, async (request, reply) => {
    const body = decorPublishSchema.safeParse(request.body)
    if (!body.success) return badInput(reply, body.error)
    return publishOfficeDecoration(body.data.revision, request.user.sub)
  })
```
Adicionar aos imports do topo: `getActiveMapIdForEditing`, `saveOfficeDecorationDraft`, `publishOfficeDecoration`.

- [ ] **Step 4: Rodar o teste (passa)**

Run: `pnpm --filter @legends/api test -- office-maps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/office-maps.ts apps/api/src/routes/office-maps.test.ts
git commit -m "feat(api): rotas /office/map/edit para decoração por membro"
```

---

# FASE C — UI de edição in-place

Entrega: botão "Editar mapa" no escritório, drawer de edição, e camada imperativa na `OfficeScene` que estampa tiles e desenha áreas sobre a cena viva; Salvar publica pelo caminho suave.

### Task C1: Cliente de API de decoração (web)

**Files:**
- Create: `apps/web/src/office/editing/decorationApi.ts`
- Test: `apps/web/src/office/editing/decorationApi.test.ts`

**Interfaces:**
- Consumes: `apiFetch` de `src/lib/api.ts`; tipos `MapDocumentV1`, `OfficeMapDraftDTO`, `OfficeMapLockDTO` de `@legends/shared`.
- Produces:
  - `getDecorationDraft(): Promise<OfficeMapDraftDTO>`
  - `acquireDecorationLock(): Promise<OfficeMapLockDTO>`
  - `heartbeatDecorationLock(lockToken: string): Promise<{ expiresAt: string }>`
  - `releaseDecorationLock(lockToken: string): Promise<void>`
  - `saveDecorationDraft(input: { revision: number; document: MapDocumentV1; lockToken: string }): Promise<{ revision: number; savedAt: string; validationSummary: { valid: boolean; errorCount: number } }>`
  - `publishDecoration(revision: number): Promise<{ activated: boolean }>`

- [ ] **Step 1: Escrever o teste (mock de apiFetch)**

```ts
// apps/web/src/office/editing/decorationApi.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../../lib/api'
import { saveDecorationDraft, publishDecoration, acquireDecorationLock } from './decorationApi'

describe('decorationApi', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset())
  it('envia lock token no header ao salvar', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ revision: 2, savedAt: 'x', validationSummary: { valid: true, errorCount: 0 } })
    await saveDecorationDraft({ revision: 1, document: {} as any, lockToken: 'tok' })
    expect(apiFetch).toHaveBeenCalledWith('/office/map/edit/draft', expect.objectContaining({
      method: 'PUT', headers: expect.objectContaining({ 'x-map-lock-token': 'tok' }),
    }))
  })
  it('publica com a revisão', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ activated: true })
    const r = await publishDecoration(2)
    expect(r.activated).toBe(true)
    expect(apiFetch).toHaveBeenCalledWith('/office/map/edit/publish', expect.objectContaining({ method: 'POST' }))
  })
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/web test -- decorationApi`
Expected: FAIL.

- [ ] **Step 3: Implementar o cliente**

```ts
// apps/web/src/office/editing/decorationApi.ts
import { apiFetch } from '../../lib/api'
import type { MapDocumentV1, OfficeMapDraftDTO, OfficeMapLockDTO } from '@legends/shared'

export function getDecorationDraft() {
  return apiFetch<OfficeMapDraftDTO>('/office/map/edit/draft')
}
export function acquireDecorationLock() {
  return apiFetch<OfficeMapLockDTO>('/office/map/edit/lock', { method: 'POST' })
}
export function heartbeatDecorationLock(lockToken: string) {
  return apiFetch<{ expiresAt: string }>('/office/map/edit/lock/heartbeat', { method: 'POST', headers: { 'x-map-lock-token': lockToken } })
}
export function releaseDecorationLock(lockToken: string) {
  return apiFetch<void>('/office/map/edit/lock', { method: 'DELETE', headers: { 'x-map-lock-token': lockToken } })
}
export function saveDecorationDraft(input: { revision: number; document: MapDocumentV1; lockToken: string }) {
  return apiFetch<{ revision: number; savedAt: string; validationSummary: { valid: boolean; errorCount: number } }>(
    '/office/map/edit/draft',
    { method: 'PUT', headers: { 'x-map-lock-token': input.lockToken }, body: JSON.stringify({ revision: input.revision, document: input.document }) },
  )
}
export function publishDecoration(revision: number) {
  return apiFetch<{ activated: boolean }>('/office/map/edit/publish', { method: 'POST', body: JSON.stringify({ revision }) })
}
```
(Confirme a assinatura de `apiFetch` no repo — se ele já serializa `body` e injeta `Content-Type`, ajuste para passar `body` como objeto conforme o padrão vizinho.)

- [ ] **Step 4: Rodar o teste (passa)**

Run: `pnpm --filter @legends/web test -- decorationApi`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editing/decorationApi.ts apps/web/src/office/editing/decorationApi.test.ts
git commit -m "feat(web): cliente de API de decoração do escritório"
```

### Task C2: Mutadores puros do documento de decoração

**Files:**
- Create: `apps/web/src/office/editing/decorationDoc.ts`
- Test: `apps/web/src/office/editing/decorationDoc.test.ts`

**Interfaces:**
- Consumes: `MapDocumentV1`, `MapTilesetV1`, `builtinTilesetAsset` de `@legends/shared`.
- Produces (funções puras, imutáveis, retornam novo documento):
  - `stampTile(doc, layerKey: 'floor'|'objects', col: number, row: number, ref: string | null): MapDocumentV1`
  - `ensureBuiltinTileset(doc, assetId: string): { doc: MapDocumentV1; tilesetId: string }`
  - `addRectObject(doc, object: MapObjectV1): MapDocumentV1`
  - `removeObjectAt(doc, layerKey: string, x: number, y: number): MapDocumentV1` — remove o objeto de decoração cujo bbox contém o ponto (para a borracha de áreas)
  - `tileIndex(doc, col, row): number` = `row * doc.map.width + col`

- [ ] **Step 1: Escrever o teste**

```ts
// apps/web/src/office/editing/decorationDoc.test.ts
import { describe, expect, it } from 'vitest'
import { createEmptyMapDocumentV1, OFFICE_TILESET_CATALOG } from '@legends/shared'
import { stampTile, ensureBuiltinTileset, addRectObject, tileIndex } from './decorationDoc'

const base = () => createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 })

describe('decorationDoc', () => {
  it('estampa e apaga tile na layer objects', () => {
    const d1 = stampTile(base(), 'objects', 2, 3, 'ts:5')
    const layer = d1.layers.find((l) => l.key === 'objects')
    expect(layer?.type === 'tile' && layer.data[tileIndex(d1, 2, 3)]).toBe('ts:5')
    const d2 = stampTile(d1, 'objects', 2, 3, null)
    const layer2 = d2.layers.find((l) => l.key === 'objects')
    expect(layer2?.type === 'tile' && layer2.data[tileIndex(d2, 2, 3)]).toBeNull()
  })
  it('cria tileset builtin uma única vez', () => {
    const a = ensureBuiltinTileset(base(), OFFICE_TILESET_CATALOG[0].assetId)
    const b = ensureBuiltinTileset(a.doc, OFFICE_TILESET_CATALOG[0].assetId)
    expect(b.doc.tilesets.length).toBe(1)
    expect(b.tilesetId).toBe(a.tilesetId)
  })
  it('adiciona objeto de área', () => {
    const d = addRectObject(base(), { id: 'z1', layerKey: 'private-zones', type: 'private-zone', geometry: { kind: 'rectangle', x: 0, y: 0, width: 96, height: 96 }, properties: { name: 'Silêncio', accessPolicy: 'OPEN' } })
    expect(d.objects.some((o) => o.id === 'z1')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/web test -- decorationDoc`
Expected: FAIL.

- [ ] **Step 3: Implementar os mutadores**

```ts
// apps/web/src/office/editing/decorationDoc.ts
import { builtinTilesetAsset, type MapDocumentV1, type MapObjectV1 } from '@legends/shared'

export function tileIndex(doc: MapDocumentV1, col: number, row: number): number {
  return row * doc.map.width + col
}

export function stampTile(doc: MapDocumentV1, layerKey: 'floor' | 'objects', col: number, row: number, ref: string | null): MapDocumentV1 {
  const index = tileIndex(doc, col, row)
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.key !== layerKey || layer.type !== 'tile') return layer
      const data = layer.data.slice()
      data[index] = ref
      return { ...layer, data }
    }),
  }
}

export function ensureBuiltinTileset(doc: MapDocumentV1, assetId: string): { doc: MapDocumentV1; tilesetId: string } {
  const existing = doc.tilesets.find((t) => t.assetId === assetId)
  if (existing) return { doc, tilesetId: existing.id }
  const builtin = builtinTilesetAsset(assetId)
  if (!builtin) throw new Error('Tileset builtin desconhecido')
  const tilesetId = `builtin-${assetId.split('/').pop()}`
  return {
    doc: { ...doc, tilesets: [...doc.tilesets, {
      id: tilesetId, assetId, name: builtin.name,
      tileWidth: builtin.tileWidth, tileHeight: builtin.tileHeight,
      columns: builtin.columns, tileCount: builtin.tileCount,
    }] },
    tilesetId,
  }
}

export function addRectObject(doc: MapDocumentV1, object: MapObjectV1): MapDocumentV1 {
  return { ...doc, objects: [...doc.objects, object] }
}

function bboxContains(object: MapObjectV1, x: number, y: number): boolean {
  const g = object.geometry
  if (g.kind === 'rectangle') return x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height
  if (g.kind === 'point') return Math.abs(g.x - x) < 24 && Math.abs(g.y - y) < 24
  return false
}

export function removeObjectAt(doc: MapDocumentV1, layerKey: string, x: number, y: number): MapDocumentV1 {
  const idx = [...doc.objects].reverse().findIndex((o) => o.layerKey === layerKey && bboxContains(o, x, y))
  if (idx === -1) return doc
  const realIndex = doc.objects.length - 1 - idx
  return { ...doc, objects: doc.objects.filter((_, i) => i !== realIndex) }
}
```

- [ ] **Step 4: Rodar o teste (passa)**

Run: `pnpm --filter @legends/web test -- decorationDoc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editing/decorationDoc.ts apps/web/src/office/editing/decorationDoc.test.ts
git commit -m "feat(web): mutadores puros do documento de decoração"
```

### Task C3: Camada de edição imperativa na `OfficeScene`

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`
- Modify: `apps/web/src/office/OfficeCanvas.tsx` (expor a cena via `useImperativeHandle`)

**Interfaces:**
- Consumes: `officeMapTileFrame` (`officeMapTiles.ts`); `MapDocumentV1`, `OfficeMapAssetDTO`.
- Produces (novos métodos públicos na cena):
  - `setEditing(enabled: boolean, callbacks?: { onTilePaint?: (col: number, row: number) => void; onTileErase?: (col: number, row: number) => void }): void` — trava movimento/cliques de personagem, liga/desliga `this.input.on('pointerdown'/'pointermove')`.
  - `applyTileStamp(layerKey: string, col: number, row: number, textureKey: string, frameKey: string | null): void` — adiciona/atualiza/remove a `Phaser.Image` de edição naquele cell (mantém um `Map<string, Phaser.GameObjects.Image>` keyed por `${layerKey}:${index}`).
  - `registerBuiltinAsset(assetId: string, url: string): Promise<void>` — carrega em runtime uma textura `office-map-asset-${assetId}` se ainda não existir (para tiles builtin não pré-carregados).
  - `setZonePreview(rect: { x: number; y: number; width: number; height: number } | null): void` — desenha/limpa o retângulo tracejado de preview.
- `OfficeCanvasHandle` ganha `getScene(): OfficeScene | null`.

Observação-chave: **não** trocar a prop `document` (isso remonta o Phaser). A edição desenha por cima via estes métodos imperativos; a fonte de verdade do documento vive no hook React (C4).

- [ ] **Step 1: Adicionar os métodos à cena**

Em `OfficeScene.ts`, adicionar campos e métodos (seguindo o padrão de render de `create()` L191-231 relatado no design):
```ts
private editing = false
private editImages = new Map<string, Phaser.GameObjects.Image>()
private zonePreview: Phaser.GameObjects.Rectangle | null = null
private editCallbacks: { onTilePaint?: (c: number, r: number) => void; onTileErase?: (c: number, r: number) => void } = {}

setEditing(enabled: boolean, callbacks: { onTilePaint?: (c: number, r: number) => void; onTileErase?: (c: number, r: number) => void } = {}) {
  this.editing = enabled
  this.editCallbacks = callbacks
  this.setInputLocked(enabled) // reaproveita a trava de movimento existente
  if (enabled) {
    this.input.on('pointerdown', this.handleEditPointer, this)
    this.input.on('pointermove', this.handleEditPointerMove, this)
  } else {
    this.input.off('pointerdown', this.handleEditPointer, this)
    this.input.off('pointermove', this.handleEditPointerMove, this)
    this.setZonePreview(null)
  }
}

private pointerToCell(pointer: Phaser.Input.Pointer): { col: number; row: number } {
  const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
  return {
    col: Math.floor(world.x / this.document.map.tileWidth),
    row: Math.floor(world.y / this.document.map.tileHeight),
  }
}

private handleEditPointer(pointer: Phaser.Input.Pointer) {
  if (!this.editing) return
  const { col, row } = this.pointerToCell(pointer)
  if (col < 0 || row < 0 || col >= this.document.map.width || row >= this.document.map.height) return
  if (pointer.rightButtonDown()) this.editCallbacks.onTileErase?.(col, row)
  else this.editCallbacks.onTilePaint?.(col, row)
}
private handleEditPointerMove(pointer: Phaser.Input.Pointer) {
  if (!this.editing || !pointer.isDown) return
  this.handleEditPointer(pointer)
}

async registerBuiltinAsset(assetId: string, url: string): Promise<void> {
  const key = `office-map-asset-${assetId}`
  if (this.textures.exists(key)) return
  await new Promise<void>((resolve) => {
    this.load.image(key, url)
    this.load.once('complete', () => resolve())
    this.load.start()
  })
}

applyTileStamp(layerKey: string, col: number, row: number, textureKey: string, frameKey: string | null) {
  const index = row * this.document.map.width + col
  const mapKey = `${layerKey}:${index}`
  const existing = this.editImages.get(mapKey)
  if (existing) { existing.destroy(); this.editImages.delete(mapKey) }
  if (!frameKey) return
  const px = col * this.document.map.tileWidth + this.document.map.tileWidth / 2
  const py = row * this.document.map.tileHeight + this.document.map.tileHeight / 2
  const image = this.add.image(px, py, textureKey, frameKey)
    .setDisplaySize(this.document.map.tileWidth, this.document.map.tileHeight)
    .setDepth(layerKey === 'floor' ? 1 : 21)
  this.editImages.set(mapKey, image)
}

setZonePreview(rect: { x: number; y: number; width: number; height: number } | null) {
  if (this.zonePreview) { this.zonePreview.destroy(); this.zonePreview = null }
  if (!rect) return
  this.zonePreview = this.add.rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, 0x7de3a0, 0.15)
    .setStrokeStyle(2, 0x7de3a0).setDepth(200)
}
```
No handler de `DESTROY` (L297-312), também: `this.editImages.forEach((i) => i.destroy()); this.editImages.clear(); this.setZonePreview(null)`.
Para registrar o frame de um tile builtin antes de `applyTileStamp`, exponha um helper que espelha o registro lazy de frame de `create()` usando `officeMapTileFrame(tileset, tileIndex)` — reutilize a mesma lógica `texture.add(frame.key, 0, frame.x, frame.y, frame.width, frame.height)`.

- [ ] **Step 2: Expor a cena no OfficeCanvas**

Em `apps/web/src/office/OfficeCanvas.tsx`, no `useImperativeHandle` (L41-47), adicionar:
```ts
getScene: () => sceneRef.current,
```
E no tipo `OfficeCanvasHandle` (L6-9):
```ts
getScene: () => OfficeScene | null
```

- [ ] **Step 3: Typecheck/build**

Run: `pnpm --filter @legends/web build`
Expected: build sem erros de tipo. (Sem teste unitário de Phaser — a cobertura funcional vem do smoke manual na Task C6.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/OfficeCanvas.tsx
git commit -m "feat(web): camada de edição imperativa na OfficeScene"
```

### Task C4: Hook `useOfficeMapEditing`

**Files:**
- Create: `apps/web/src/office/editing/useOfficeMapEditing.ts`
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `decorationApi` (C1); `decorationDoc` (C2); `MapDocumentV1`; catálogo shared; `OfficeCanvasHandle.getScene()`.
- Produces:
  - `type EditTool = 'brush' | 'eraser' | 'silence-zone' | 'call-zone' | 'link' | 'action-point' | 'collision' | 'door'`
  - `interface OfficeMapEditingState { active: boolean; tool: EditTool; selectedTile: { assetId: string; tileIndex: number } | null; dirty: boolean; saving: boolean; lockError: string | null }`
  - `function useOfficeMapEditing(canvasRef: RefObject<OfficeCanvasHandle>): { state; enter(): Promise<void>; cancel(): void; save(): Promise<void>; setTool(t: EditTool): void; selectTile(pick): void }`

Comportamento: `enter()` adquire lock + carrega draft do mapa ativo, entra no modo de edição da cena com callbacks de paint/erase que chamam `stampTile`/`applyTileStamp`, inicia heartbeat (30s). `save()` chama `saveDecorationDraft` → `publishDecoration`, solta lock, sai do modo. `cancel()` descarta doc local, solta lock, sai. Mantém `documentRef` (working copy) e `revisionRef`.

- [ ] **Step 1: Escrever o teste (lógica de estado, mock de api + canvas)**

```ts
// apps/web/src/office/editing/useOfficeMapEditing.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
vi.mock('./decorationApi')
import * as api from './decorationApi'
import { useOfficeMapEditing } from './useOfficeMapEditing'
import { createEmptyMapDocumentV1 } from '@legends/shared'

const scene = { setEditing: vi.fn(), applyTileStamp: vi.fn(), registerBuiltinAsset: vi.fn().mockResolvedValue(undefined), setZonePreview: vi.fn() }
const canvasRef = { current: { getScene: () => scene, getScreenPosition: () => null } } as any

describe('useOfficeMapEditing', () => {
  beforeEach(() => vi.resetAllMocks())
  it('entra adquirindo lock e carregando draft', async () => {
    vi.mocked(api.acquireDecorationLock).mockResolvedValue({ lockToken: 't', expiresAt: 'x', owner: { id: 'u', name: 'U' } })
    vi.mocked(api.getDecorationDraft).mockResolvedValue({ map: { id: 'm', name: 'M' }, revision: 3, document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }), savedAt: 'x', updatedBy: null } as any)
    const { result } = renderHook(() => useOfficeMapEditing(canvasRef))
    await act(async () => { await result.current.enter() })
    expect(api.acquireDecorationLock).toHaveBeenCalled()
    expect(scene.setEditing).toHaveBeenCalledWith(true, expect.any(Object))
    expect(result.current.state.active).toBe(true)
  })
  it('save publica e sai do modo', async () => {
    vi.mocked(api.acquireDecorationLock).mockResolvedValue({ lockToken: 't', expiresAt: 'x', owner: { id: 'u', name: 'U' } })
    vi.mocked(api.getDecorationDraft).mockResolvedValue({ map: { id: 'm', name: 'M' }, revision: 3, document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 48 }), savedAt: 'x', updatedBy: null } as any)
    vi.mocked(api.saveDecorationDraft).mockResolvedValue({ revision: 4, savedAt: 'x', validationSummary: { valid: true, errorCount: 0 } })
    vi.mocked(api.publishDecoration).mockResolvedValue({ activated: true })
    vi.mocked(api.releaseDecorationLock).mockResolvedValue(undefined)
    const { result } = renderHook(() => useOfficeMapEditing(canvasRef))
    await act(async () => { await result.current.enter() })
    await act(async () => { await result.current.save() })
    expect(api.publishDecoration).toHaveBeenCalledWith(4)
    expect(scene.setEditing).toHaveBeenLastCalledWith(false)
    expect(result.current.state.active).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: FAIL.

- [ ] **Step 3: Implementar o hook**

```ts
// apps/web/src/office/editing/useOfficeMapEditing.ts
import { useCallback, useRef, useState, type RefObject } from 'react'
import { builtinTilesetAsset, type MapDocumentV1 } from '@legends/shared'
import type { OfficeCanvasHandle } from '../OfficeCanvas'
import { officeMapTileFrame } from '../scenes/officeMapTiles'
import { stampTile, ensureBuiltinTileset } from './decorationDoc'
import * as api from './decorationApi'

export type EditTool = 'brush' | 'eraser' | 'silence-zone' | 'call-zone' | 'link' | 'action-point' | 'collision' | 'door'

export interface OfficeMapEditingState {
  active: boolean
  tool: EditTool
  selectedTile: { assetId: string; tileIndex: number } | null
  dirty: boolean
  saving: boolean
  lockError: string | null
}

export function useOfficeMapEditing(canvasRef: RefObject<OfficeCanvasHandle>) {
  const [state, setState] = useState<OfficeMapEditingState>({ active: false, tool: 'brush', selectedTile: null, dirty: false, saving: false, lockError: null })
  const docRef = useRef<MapDocumentV1 | null>(null)
  const revisionRef = useRef(0)
  const lockRef = useRef<string | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const toolRef = useRef<EditTool>('brush')
  const tileRef = useRef<{ assetId: string; tileIndex: number } | null>(null)

  const paintAt = useCallback(async (col: number, row: number) => {
    const scene = canvasRef.current?.getScene()
    const doc = docRef.current
    if (!scene || !doc || !tileRef.current) return
    const { assetId, tileIndex: ti } = tileRef.current
    const builtin = builtinTilesetAsset(assetId)
    if (!builtin) return
    await scene.registerBuiltinAsset(assetId, builtin.url)
    const ensured = ensureBuiltinTileset(doc, assetId)
    docRef.current = stampTile(ensured.doc, 'objects', col, row, `${ensured.tilesetId}:${ti}`)
    const frame = officeMapTileFrame({ id: ensured.tilesetId, assetId, name: builtin.name, tileWidth: builtin.tileWidth, tileHeight: builtin.tileHeight, columns: builtin.columns, tileCount: builtin.tileCount }, ti)
    scene.applyTileStamp('objects', col, row, `office-map-asset-${assetId}`, frame?.key ?? null)
    setState((s) => ({ ...s, dirty: true }))
  }, [canvasRef])

  const eraseAt = useCallback((col: number, row: number) => {
    const scene = canvasRef.current?.getScene()
    const doc = docRef.current
    if (!scene || !doc) return
    docRef.current = stampTile(doc, 'objects', col, row, null)
    scene.applyTileStamp('objects', col, row, '', null)
    setState((s) => ({ ...s, dirty: true }))
  }, [canvasRef])

  const enter = useCallback(async () => {
    try {
      const lock = await api.acquireDecorationLock()
      lockRef.current = lock.lockToken
      const draft = await api.getDecorationDraft()
      docRef.current = draft.document
      revisionRef.current = draft.revision
      canvasRef.current?.getScene()?.setEditing(true, {
        onTilePaint: (c, r) => { if (toolRef.current === 'brush') void paintAt(c, r); else if (toolRef.current === 'eraser') eraseAt(c, r) },
        onTileErase: (c, r) => eraseAt(c, r),
      })
      heartbeatRef.current = setInterval(() => { if (lockRef.current) void api.heartbeatDecorationLock(lockRef.current) }, 30_000)
      setState((s) => ({ ...s, active: true, dirty: false, lockError: null }))
    } catch (error) {
      setState((s) => ({ ...s, lockError: error instanceof Error ? error.message : 'Mapa em edição por outra pessoa' }))
    }
  }, [canvasRef, paintAt, eraseAt])

  const cleanup = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    heartbeatRef.current = null
    canvasRef.current?.getScene()?.setEditing(false)
  }, [canvasRef])

  const cancel = useCallback(() => {
    cleanup()
    if (lockRef.current) void api.releaseDecorationLock(lockRef.current)
    lockRef.current = null
    docRef.current = null
    setState((s) => ({ ...s, active: false, dirty: false }))
  }, [cleanup])

  const save = useCallback(async () => {
    if (!docRef.current || !lockRef.current) return
    setState((s) => ({ ...s, saving: true }))
    try {
      const saved = await api.saveDecorationDraft({ revision: revisionRef.current, document: docRef.current, lockToken: lockRef.current })
      await api.publishDecoration(saved.revision)
      cleanup()
      await api.releaseDecorationLock(lockRef.current)
      lockRef.current = null
      docRef.current = null
      setState((s) => ({ ...s, active: false, dirty: false, saving: false }))
    } catch (error) {
      setState((s) => ({ ...s, saving: false, lockError: error instanceof Error ? error.message : 'Falha ao salvar' }))
    }
  }, [cleanup])

  const setTool = useCallback((tool: EditTool) => { toolRef.current = tool; setState((s) => ({ ...s, tool })) }, [])
  const selectTile = useCallback((pick: { assetId: string; tileIndex: number }) => { tileRef.current = pick; toolRef.current = 'brush'; setState((s) => ({ ...s, selectedTile: pick, tool: 'brush' })) }, [])

  return { state, enter, cancel, save, setTool, selectTile }
}
```
(A borracha via botão direito e o toolRef mantêm o comportamento sem re-render por pincelada. Áreas/link/action-point/collision/door via clique são adicionados na C5 usando `addRectObject`/`setZonePreview`; para este passo, o teste cobre enter/save/lock — os desenhos de área são ligados na Task C5.)

- [ ] **Step 4: Rodar o teste (passa)**

Run: `pnpm --filter @legends/web test -- useOfficeMapEditing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts
git commit -m "feat(web): hook de estado de edição de decoração in-place"
```

### Task C5: Drawer `OfficeEditDrawer` + desenho de áreas

**Files:**
- Create: `apps/web/src/office/editing/OfficeEditDrawer.tsx`
- Test: `apps/web/src/office/editing/OfficeEditDrawer.test.tsx`
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts` (ligar tools de área via clique/drag)

**Interfaces:**
- Consumes: `TilesetPalette` (A4); o retorno de `useOfficeMapEditing` (C4).
- Produces:
  - `interface OfficeEditDrawerProps { editing: ReturnType<typeof useOfficeMapEditing>; mapAssets: OfficeMapAssetDTO[]; mapTilesets: MapTilesetV1[] }`
  - `default function OfficeEditDrawer(props): JSX.Element` — painel à direita com: seletor de ferramentas (Mobília/Borracha/Área de silêncio/Área de chamada/Link/Action point/Colisão/Porta), o `TilesetPalette` (quando tool = mobília), e botões **Salvar** / **Cancelar** (Salvar desabilitado se `!dirty`).

Para áreas (silence/call/collision) o desenho é por drag: no modo de área, `setEditing` recebe callbacks de início/fim de retângulo (estender a assinatura de `setEditing` para incluir `onRectStart/onRectEnd` ou reaproveitar pointerdown/up). Em `onRectEnd`, o hook chama `addRectObject` com o tipo apropriado e um `externalKey` gerado; link/action-point/door são pontos com um pequeno formulário (prompt simples para `label`/`url`/`actionKey`).

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/office/editing/OfficeEditDrawer.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OfficeEditDrawer from './OfficeEditDrawer'

const editing = {
  state: { active: true, tool: 'brush', selectedTile: null, dirty: true, saving: false, lockError: null },
  enter: vi.fn(), cancel: vi.fn(), save: vi.fn(), setTool: vi.fn(), selectTile: vi.fn(),
} as any

describe('OfficeEditDrawer', () => {
  it('mostra ferramentas e dispara salvar', () => {
    render(<OfficeEditDrawer editing={editing} mapAssets={[]} mapTilesets={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /área de silêncio/i }))
    expect(editing.setTool).toHaveBeenCalledWith('silence-zone')
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    expect(editing.save).toHaveBeenCalled()
  })
  it('desabilita salvar quando não há alterações', () => {
    const clean = { ...editing, state: { ...editing.state, dirty: false } }
    render(<OfficeEditDrawer editing={clean} mapAssets={[]} mapTilesets={[]} />)
    expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm --filter @legends/web test -- OfficeEditDrawer`
Expected: FAIL.

- [ ] **Step 3: Implementar o drawer**

```tsx
// apps/web/src/office/editing/OfficeEditDrawer.tsx
import type { OfficeMapAssetDTO, MapTilesetV1 } from '@legends/shared'
import TilesetPalette from '../editor/TilesetPalette'
import type { useOfficeMapEditing, EditTool } from './useOfficeMapEditing'

const TOOLS: { tool: EditTool; label: string }[] = [
  { tool: 'brush', label: 'Mobília' },
  { tool: 'eraser', label: 'Borracha' },
  { tool: 'silence-zone', label: 'Área de silêncio' },
  { tool: 'call-zone', label: 'Área de chamada' },
  { tool: 'link', label: 'Link' },
  { tool: 'action-point', label: 'Action point' },
  { tool: 'collision', label: 'Colisão' },
  { tool: 'door', label: 'Porta' },
]

export interface OfficeEditDrawerProps {
  editing: ReturnType<typeof useOfficeMapEditing>
  mapAssets: OfficeMapAssetDTO[]
  mapTilesets: MapTilesetV1[]
}

export default function OfficeEditDrawer({ editing, mapAssets, mapTilesets }: OfficeEditDrawerProps) {
  const { state, setTool, selectTile, save, cancel } = editing
  return (
    <aside className="office-edit-drawer" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 320, background: '#0f1424', color: '#e6e9f5', zIndex: 70, overflowY: 'auto', padding: 12 }}>
      <h3>Editar mapa</h3>
      {state.lockError && <p style={{ color: '#ff9a9a' }}>{state.lockError}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {TOOLS.map((t) => (
          <button key={t.tool} type="button" aria-pressed={state.tool === t.tool} onClick={() => setTool(t.tool)}
            style={{ padding: 8, background: state.tool === t.tool ? '#2b3f78' : '#1a2138' }}>{t.label}</button>
        ))}
      </div>
      {state.tool === 'brush' && (
        <TilesetPalette
          mapAssets={mapAssets} mapTilesets={mapTilesets} selected={null}
          onSelectTile={({ entry, isBuiltin, tileIndex }) => {
            if (isBuiltin) selectTile({ assetId: (entry as { assetId: string }).assetId, tileIndex })
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={() => void save()} disabled={!state.dirty || state.saving}>Salvar</button>
        <button type="button" onClick={cancel}>Cancelar</button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Ligar tools de área no hook**

Em `useOfficeMapEditing.ts`, estender `setEditing` (na cena, Task C3) para aceitar `onRectEnd?: (rect) => void` e, no `enter()`, passar um callback que, conforme `toolRef.current`, cria o objeto correto via `addRectObject`:
```ts
onRectEnd: (rect) => {
  const doc = docRef.current
  if (!doc) return
  const id = `obj-${Date.now().toString(36)}`
  if (toolRef.current === 'silence-zone') docRef.current = addRectObject(doc, { id, layerKey: 'private-zones', type: 'private-zone', geometry: { kind: 'rectangle', ...rect }, properties: { name: 'Área de silêncio', accessPolicy: 'OPEN' } })
  else if (toolRef.current === 'call-zone') docRef.current = addRectObject(doc, { id, layerKey: 'meeting-rooms', type: 'meeting-room', geometry: { kind: 'rectangle', ...rect }, properties: { externalKey: id, name: 'Sala de chamada', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' } })
  else if (toolRef.current === 'collision') docRef.current = addRectObject(doc, { id, layerKey: 'collision', type: 'collision', geometry: { kind: 'rectangle', ...rect }, properties: {} })
  if (docRef.current !== doc) setState((s) => ({ ...s, dirty: true }))
},
```
(`Date.now()` é permitido no runtime do navegador — a restrição de `Date.now` vale só para scripts de Workflow.) Adicionar ao `setEditing` da cena a captura de retângulo: em `pointerdown` guarda o cell inicial; em `pointerup` calcula `{ x, y, width, height }` em pixels e chama `onRectEnd`; durante `pointermove` chama `setZonePreview`.

- [ ] **Step 5: Rodar testes (passa)**

Run: `pnpm --filter @legends/web test -- OfficeEditDrawer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/editing/OfficeEditDrawer.tsx apps/web/src/office/editing/OfficeEditDrawer.test.tsx apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(web): drawer de edição in-place + desenho de áreas"
```

### Task C6: Botão "Editar mapa" e montagem no `OfficePage`

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`

**Interfaces:**
- Consumes: `useOfficeMapEditing` (C4), `OfficeEditDrawer` (C5), `useOfficeSession()` (para `activeMap.assets`/`document.tilesets`), o `canvasRef` já existente (`OfficeCanvasHandle`).
- Produces: botão "Editar mapa" (ícone) na área top-right/próximo ao pill de zoom, visível a **todo autenticado**; ao clicar chama `editing.enter()`; enquanto `editing.state.active`, renderiza `<OfficeEditDrawer>`.

- [ ] **Step 1: Montar o hook, botão e drawer**

Em `OfficePage.tsx`:
```tsx
const editing = useOfficeMapEditing(canvasRef)
const { activeMap } = useOfficeSession()
// ...no bloco top-right de botões (perto do grid_view ~L406):
<button type="button" title="Editar mapa" onClick={() => void editing.enter()} className={toolButtonCls}>
  <Icon name="edit" />
</button>
// ...ao final do <section>, condicional:
{editing.state.active && activeMap && (
  <OfficeEditDrawer editing={editing} mapAssets={activeMap.assets} mapTilesets={activeMap.document.tilesets} />
)}
```
(Use o nome de ícone existente no set do projeto — confira `Icon` para o glifo de edição, ex. `mode_edit`.)

- [ ] **Step 2: Build + smoke manual**

Run: `pnpm --filter @legends/web build`
Expected: build ok.

Smoke manual (skill `verify`): `nvm use 20 && pnpm db:up && pnpm dev`; logar como usuário **MEMBER**; abrir `/escritorio`; clicar "Editar mapa"; escolher um tileset padrão; pintar mobília; desenhar uma área de silêncio; clicar Salvar; confirmar que **outra aba** (outro usuário) recebe o `map-decor-updated` e re-renderiza **sem** recarregar/reconectar. Tentar (via devtools) enviar um PUT com `map.width` alterado e confirmar `403 STRUCTURAL_EDIT_FORBIDDEN`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx
git commit -m "feat(web): botão Editar mapa e drawer in-place no escritório"
```

### Task C7: Validação final e suíte completa

**Files:** nenhuma nova.

- [ ] **Step 1: Suíte completa**

Run: `nvm use 20 && pnpm db:up && pnpm test`
Expected: todos os workspaces verdes.

- [ ] **Step 2: Build completo**

Run: `pnpm build`
Expected: build de api + web + shared sem erros.

- [ ] **Step 3: Commit final (se houver ajustes)**

```bash
git add -A && git commit -m "test(office): suíte verde para edição de mapa por membros"
```

---

## Notas de execução

- **Concorrência:** lock único por mapa (2 min + heartbeat). Se um membro/admin já edita, `enter()` mostra `lockError` (423). É o comportamento esperado no v1 (sem colaboração simultânea).
- **`collision`/`door`/`floor` são decoração** (membro edita); `walls`/`spawn`/dims/`backgroundColor`/topologia de layers são estrutura (só admin, via editor admin).
- **Editor admin intacto:** as rotas `/admin/office-maps/*` não mudam de autorização; só ganham o palette categorizado (A5) e a resolução builtin (A3).
- **Assets builtin sem FK:** não entram em `OfficeMapPublicationAsset`; são anexados ao DTO em memória (A3). Uploads por-mapId seguem iguais.
