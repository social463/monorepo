# Guarda-roupa LPC completo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a curadoria de 41 definições LPC por TODAS as definições utilizáveis do gerador upstream (~603 de 614), com catálogo gerado, contrato genérico v2 e editor dirigido pelo catálogo.

**Architecture:** O `scripts/vendor-lpc.mjs` reescrito varre as 614 sheet_definitions do clone upstream, fatia o walk cycle de cada camada×corpo×variante e emite três artefatos commitados: os PNGs (`apps/web/public/lpc`), o catálogo (`packages/shared/src/lpc-catalog.json`) e relatórios (`CREDITS.txt`, `EXCLUDED.txt`). O shared expõe o catálogo tipado e o contrato `CharacterOptions` v2 (`{bodyType, items: Record<categoria, {item, variant}>}`) mantendo os MESMOS nomes de função exportados (`isCharacterOptions`, `sanitizeCharacterOptions`, `characterSignature`, `characterHash`, `characterLayers`, `defaultCharacterFromSeed`) — assim serialize/auth/office não mudam de chamada. Uma função nova `migrateCharacterOptions` aceita o shape v1 legado e converte para v2 nas bordas. O `AvatarPicker` é reconstruído dirigido pelo catálogo.

**Tech Stack:** Node ≥20, pnpm 9.7, sharp (vendoring), TypeScript strict ESM, Vitest, React 18, Phaser (intocado).

**Spec:** `docs/superpowers/specs/2026-07-16-lpc-guarda-roupa-completo-design.md` — leia antes.

## Global Constraints

- Branch de trabalho: `claude/avatar-creation-customization-419891` (worktree em `.claude/worktrees/avatar-creation-customization-419891`).
- Node ≥ 20 obrigatório (`nvm use 20` — o shell default é 18 e quebra o proxy do Vite).
- Clone upstream já existe em `/private/tmp/claude-501/-Users-waghnerreis-Documents-Projects-EMR-Legends/171d5621-c35d-4baa-87d2-e17ba72312e8/scratchpad/ulpc` (repo `sanderfrenken/Universal-LPC-Spritesheet-Character-Generator`). Se sumir: `git clone --depth 1 https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator.git <scratchpad>/ulpc`.
- Allowlist de licenças: `CC-BY-SA 3.0`, `CC-BY-SA 4.0`, `OGA-BY 3.0` (cobre `3.0+` por prefixo), `OGA-BY 4.0`, `CC-BY 3.0`, `CC-BY 4.0`, `CC0`. GPL-only fica de fora.
- Geometria intocada: walk em y=512 do sheet universal, fatia 576×256, frames 64px, linhas up/left/down/right.
- Mensagens de UI em português; labels de ITEM ficam em inglês (vêm do upstream), labels de CATEGORIA em pt-BR.
- Testes da API precisam de Postgres: `pnpm db:up` antes.
- NUNCA editar migration aplicada; este plano não cria migration nenhuma (avatarOptions é Json).
- Commits de assets gerados separados dos commits de código.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `scripts/vendor-lpc.mjs` | reescrever | varrer defs, fatiar PNGs, emitir catálogo+créditos+exclusões |
| `apps/web/public/lpc/**` | regenerar (~22k PNGs) | assets walk-only, layout espelha pastas upstream |
| `packages/shared/src/lpc-catalog.json` | gerar | catálogo: id, category, label, layers(zPos,paths), variants, bodyTypes |
| `packages/shared/src/lpc-catalog.ts` | criar | import tipado do JSON + índices + grupos/labels de categoria |
| `packages/shared/src/lpc-catalog.test.ts` | criar | integridade catálogo⇄disco |
| `packages/shared/src/character.ts` | reescrever | contrato v2, validação, sanitize, signature, layers, default, migração v1→v2 |
| `packages/shared/src/character.test.ts` | reescrever | testes do contrato v2 |
| `apps/api/src/lib/serialize.ts` | editar 1 função | `sanitizeAvatarOptions` → `migrateCharacterOptions` |
| `apps/web/src/hooks/useCharacterPortrait.ts` | editar 1 função | `resolveCharacterOptions` aceita legado via migração |
| `apps/web/src/office/officeAvatar.ts` | editar 1 função | `occupantCharacterOptions` aceita legado via migração |
| `apps/web/src/components/avatar-picker/catalogView.ts` | criar | helpers puros do editor (grupos, busca, defaults por corpo) |
| `apps/web/src/components/avatar-picker/catalogView.test.ts` | criar | testes dos helpers |
| `apps/web/src/components/avatar-picker/LayerThumb.tsx` | criar | thumbnail canvas lazy de item/variante |
| `apps/web/src/components/AvatarPicker.tsx` | reescrever | editor dirigido pelo catálogo |
| `apps/web/src/components/AvatarPicker.test.tsx` | reescrever | testes do editor |

Consumidores que NÃO mudam (usam a API opaca): `OfficeScene.ts`, `officeAvatar.occupantTextureKey`, `CharacterPreview.tsx`, `Avatar.tsx`, `apps/web/src/lib/character.ts` (compose), `auth.ts` (PATCH), `office-hub.ts`. Testes desses arquivos só quebram se construírem fixtures v1 à mão — os que fazem isso: `AvatarPicker.test.tsx` e `packages/shared/src/character.test.ts` (ambos reescritos aqui).

---

### Task 1: Reescrever o script de vendoring

**Files:**
- Modify: `scripts/vendor-lpc.mjs` (reescrita completa)

**Interfaces:**
- Consumes: clone upstream (`sheet_definitions/*.json`, `spritesheets/**`), sharp (já é dep).
- Produces (ao rodar, Task 2): `apps/web/public/lpc/<pasta-upstream>/<variante>.png`, `apps/web/public/lpc/CREDITS.txt`, `apps/web/public/lpc/EXCLUDED.txt`, `packages/shared/src/lpc-catalog.json` com entradas `{id, category, label, layers:[{zPos, paths:{<bodyType>: <pasta>}}], variants: string[], bodyTypes: string[]}`.

Regras de negócio do script (do spec):
1. Varre TODAS as `sheet_definitions/*.json` em ordem alfabética.
2. Exclui def inteira quando: (a) algum crédito não tem nenhuma licença do allowlist (cobre a GPL-only) → motivo `licenca-invalida`; (b) todas as camadas têm `custom_animation` → motivo `sem-walk`; (c) nenhuma variante sobra após checar arquivos → motivo `sem-arquivos`; (d) def sem `credits` (placeholder upstream) → exclusão registrada como sem-creditos.
3. Camadas `custom_animation` de defs mistas são simplesmente ignoradas.
4. `bodyTypes` do item = interseção dos corpos presentes em TODAS as camadas mantidas (corpos válidos: male, female, muscular, pregnant, teen, child).
5. Variante mantida somente se o arquivo existe em TODAS as pastas (camada×corpo) do item; variante com arquivo faltando é dropada e registrada no EXCLUDED (`def: variante X sem arquivo em <pasta>`).
6. IDs de variante normalizados: espaço → `_` (igual aos nomes de arquivo upstream).
7. Dedup de fatia por pasta de origem (corpos que compartilham pasta compartilham PNG).
8. Saída espelha o path upstream: pasta `hair/afro/male/` vira `apps/web/public/lpc/hair/afro/male/<variante>.png`.

- [ ] **Step 1: Reescrever o script**

Substituir TODO o conteúdo de `scripts/vendor-lpc.mjs` por:

```js
// Vendoring COMPLETO do Universal LPC Spritesheet Character Generator.
// Uso: node scripts/vendor-lpc.mjs <path-do-clone-do-gerador>
// Varre todas as sheet_definitions, fatia só as linhas de walk (y=512,
// 4 direções × 9 frames de 64px) de cada camada×corpo×variante e emite:
//   apps/web/public/lpc/<pasta-upstream>/<variante>.png   (fatias)
//   apps/web/public/lpc/CREDITS.txt                       (atribuição, obrigatória)
//   apps/web/public/lpc/EXCLUDED.txt                      (defs/variantes fora, com motivo)
//   packages/shared/src/lpc-catalog.json                  (catálogo consumido pelo shared)
// Exclusões: defs sem licença do allowlist (GPL-only fica fora), defs cujas
// camadas são todas custom_animation (não existem no walk) e variantes com
// arquivo ausente. Ver docs/superpowers/specs/2026-07-16-lpc-guarda-roupa-completo-design.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import sharp from 'sharp'

const WALK_Y = 512
const SHEET_W = 576
const SHEET_H = 256
const BODY_TYPES = ['male', 'female', 'muscular', 'pregnant', 'teen', 'child']
const ALLOWED_LICENSES = [
  'CC-BY-SA 3.0', 'CC-BY-SA 4.0', 'OGA-BY 3.0', 'OGA-BY 4.0',
  'CC-BY 3.0', 'CC-BY 4.0', 'CC0',
]

const generatorRoot = process.argv[2]
if (!generatorRoot || !existsSync(join(generatorRoot, 'sheet_definitions'))) {
  console.error('Uso: node scripts/vendor-lpc.mjs <path-do-clone-do-Universal-LPC-Spritesheet-Character-Generator>')
  process.exit(1)
}
const outRoot = join(process.cwd(), 'apps', 'web', 'public', 'lpc')
const catalogPath = join(process.cwd(), 'packages', 'shared', 'src', 'lpc-catalog.json')

const normFolder = (p) => p.replace(/\/+$/, '')
const variantFile = (v) => `${v.replace(/ /g, '_')}.png`

function licenseOk(credit) {
  return (credit.licenses ?? []).some((l) => ALLOWED_LICENSES.some((a) => l.trim().startsWith(a)))
}

async function sliceWalk(srcPath, destPath) {
  const meta = await sharp(srcPath).metadata()
  if ((meta.width ?? 0) < SHEET_W || (meta.height ?? 0) < WALK_Y + SHEET_H) {
    throw new Error(`${srcPath}: ${meta.width}x${meta.height} não contém a região de walk (esperado >= 576x768)`)
  }
  mkdirSync(dirname(destPath), { recursive: true })
  await sharp(srcPath)
    .extract({ left: 0, top: WALK_Y, width: SHEET_W, height: SHEET_H })
    .png({ palette: true, compressionLevel: 9 })
    .toFile(destPath)
}

const defs = readdirSync(join(generatorRoot, 'sheet_definitions'))
  .filter((f) => f.endsWith('.json'))
  .sort()

const catalog = []
const excluded = [] // linhas "def<TAB>motivo"
const creditsBlocks = new Map()
const sliced = new Set() // dedup: pasta/variante já fatiada
let files = 0

for (const defFile of defs) {
  const id = defFile.replace(/\.json$/, '')
  const def = JSON.parse(readFileSync(join(generatorRoot, 'sheet_definitions', defFile), 'utf8'))

  if (!def.credits?.length) throw new Error(`${id}: sem bloco credits — atribuição obrigatória`)
  const badCredit = def.credits.find((c) => !licenseOk(c))
  if (badCredit) {
    excluded.push(`${id}\tlicenca-invalida (${(badCredit.licenses ?? []).join(', ') || 'nenhuma'})`)
    continue
  }

  // camadas de walk = layer_N sem custom_animation, em ordem numérica
  const layerKeys = Object.keys(def)
    .filter((k) => /^layer_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
    .filter((k) => !def[k].custom_animation)
  if (layerKeys.length === 0) {
    excluded.push(`${id}\tsem-walk (todas as camadas são custom_animation)`)
    continue
  }

  // corpos disponíveis = interseção entre as camadas mantidas
  const bodyTypes = BODY_TYPES.filter((bt) => layerKeys.every((k) => typeof def[k][bt] === 'string'))
  if (bodyTypes.length === 0) {
    excluded.push(`${id}\tsem-corpo-suportado`)
    continue
  }

  // pastas únicas exigidas por variante (camada × corpo, dedup por pasta)
  const folders = [...new Set(layerKeys.flatMap((k) => bodyTypes.map((bt) => normFolder(def[k][bt]))))]

  const variants = []
  for (const rawVariant of def.variants ?? []) {
    const file = variantFile(rawVariant)
    const missing = folders.find((folder) => !existsSync(join(generatorRoot, 'spritesheets', folder, file)))
    if (missing) {
      excluded.push(`${id}\tvariante ${rawVariant} sem arquivo em ${missing}`)
      continue
    }
    variants.push(rawVariant.replace(/ /g, '_'))
  }
  if (variants.length === 0) {
    excluded.push(`${id}\tsem-arquivos (nenhuma variante completa)`)
    continue
  }

  for (const folder of folders) {
    for (const variant of variants) {
      const key = `${folder}/${variant}`
      if (sliced.has(key)) continue
      sliced.add(key)
      await sliceWalk(
        join(generatorRoot, 'spritesheets', folder, `${variant}.png`),
        join(outRoot, folder, `${variant}.png`),
      )
      files += 1
    }
  }

  catalog.push({
    id,
    category: def.type_name,
    label: def.name,
    layers: layerKeys.map((k) => ({
      zPos: def[k].zPos,
      paths: Object.fromEntries(bodyTypes.map((bt) => [bt, normFolder(def[k][bt])])),
    })),
    variants,
    bodyTypes,
  })

  for (const credit of def.credits) {
    const key = `${id}:${credit.file}`
    if (creditsBlocks.has(key)) continue
    const urls = Object.entries(credit).filter(([k, v]) => k.startsWith('url') && v).map(([, v]) => `  ${v}`)
    creditsBlocks.set(key, [
      `## ${def.name} (${id})`,
      `- Arquivo-fonte: ${credit.file}`,
      `- Autores: ${(credit.authors ?? []).join(', ')}`,
      `- Licenças: ${(credit.licenses ?? []).join(', ')}`,
      ...(credit.notes ? [`- Notas: ${credit.notes}`] : []),
      ...(urls.length ? ['- Links:', ...urls] : []),
      '',
    ].join('\n'))
  }
}

mkdirSync(outRoot, { recursive: true })
const header = [
  '# Créditos — arte do personagem (Liberated Pixel Cup)',
  '',
  'Os sprites do personagem são derivados do Universal LPC Spritesheet',
  'Character Generator (https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator),',
  'fatiados para conter apenas a animação de caminhada.',
  '',
  'Licenças (por item abaixo): CC-BY-SA 3.0/4.0 (https://creativecommons.org/licenses/by-sa/4.0/),',
  'OGA-BY 3.0/4.0 (https://static.opengameart.org/OGA-BY-3.0.txt),',
  'CC-BY 3.0/4.0 (https://creativecommons.org/licenses/by/4.0/)',
  'e/ou CC0 (https://creativecommons.org/publicdomain/zero/1.0/).',
  '',
].join('\n')
writeFileSync(join(outRoot, 'CREDITS.txt'), header + [...creditsBlocks.values()].join('\n'))
writeFileSync(join(outRoot, 'EXCLUDED.txt'), [
  '# Definições/variantes upstream fora do vendoring (def<TAB>motivo)',
  ...excluded,
  '',
].join('\n'))
writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n')

function du(dir) {
  let total = 0
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    total += f.isDirectory() ? du(p) : statSync(p).size
  }
  return total
}
console.log(`ok: ${catalog.length} defs no catálogo, ${files} PNGs (${(du(outRoot) / 1024 / 1024).toFixed(1)} MB), ${excluded.length} linhas de exclusão`)
```

- [ ] **Step 2: Checagem de sintaxe (sem rodar o vendoring inteiro)**

Run: `cd .claude/worktrees/avatar-creation-customization-419891 && node --check scripts/vendor-lpc.mjs && node scripts/vendor-lpc.mjs`
Expected: `node --check` sai limpo; a execução sem argumento imprime a linha `Uso: node scripts/vendor-lpc.mjs ...` e exit code 1.

- [ ] **Step 3: Commit**

```bash
git add scripts/vendor-lpc.mjs
git commit -m "feat(lpc): vendoring varre todas as sheet_definitions e emite catálogo"
```

---

### Task 2: Rodar o vendoring e commitar os artefatos gerados

**Files:**
- Delete+Create: `apps/web/public/lpc/**` (layout novo espelha pastas upstream)
- Create: `packages/shared/src/lpc-catalog.json`, `apps/web/public/lpc/CREDITS.txt`, `apps/web/public/lpc/EXCLUDED.txt`

**Interfaces:**
- Produces: os artefatos que TODAS as tasks seguintes consomem. Números esperados (validados na análise de 2026-07-16): ~590–605 entradas no catálogo, ~20.000–23.000 PNGs, 90–130MB, EXCLUDED com ≥11 defs (1 licença + 10 sem-walk) e mais linhas de variantes faltantes.

- [ ] **Step 1: Remover o layout antigo**

```bash
cd .claude/worktrees/avatar-creation-customization-419891
git rm -r --quiet apps/web/public/lpc
```

- [ ] **Step 2: Rodar o vendoring (demora alguns minutos — 22k fatias sharp)**

Run: `node scripts/vendor-lpc.mjs /private/tmp/claude-501/-Users-waghnerreis-Documents-Projects-EMR-Legends/171d5621-c35d-4baa-87d2-e17ba72312e8/scratchpad/ulpc`
Expected: linha final `ok: <N> defs no catálogo, <M> PNGs (<X> MB), <K> linhas de exclusão` com N entre 590 e 605, M entre 20000 e 23000, X entre 90 e 130.

Defs sem créditos (placeholders upstream, ex. tail_dragon) saem no EXCLUDED.txt como sem-creditos.

- [ ] **Step 3: Verificações pontuais**

```bash
find apps/web/public/lpc -name '*.png' | wc -l          # ≈ M do passo anterior
node -e "const c=require('./packages/shared/src/lpc-catalog.json');console.log(c.length, c.filter(e=>e.layers.length>1).length)"
grep -c 'licenca-invalida' apps/web/public/lpc/EXCLUDED.txt   # >= 1
grep -c 'sem-walk' apps/web/public/lpc/EXCLUDED.txt           # 10
ls apps/web/public/lpc/hair/afro/male/ | head -3              # blonde.png etc.
ls apps/web/public/lpc/backpack/basket/                        # fg/ e bg/ (multi-layer)
```
Expected: contagens coerentes; `hair/afro/male` e `backpack/basket/{fg,bg}` existem; segundo número do node (defs multi-layer) ≥ 100.

- [ ] **Step 4: Espiar 2 fatias visualmente**

Abrir `apps/web/public/lpc/body/bodies/male/light.png` e `apps/web/public/lpc/backpack/basket/bg/round.png` (tool Read) e confirmar: sheet 576×256 com 4 linhas de walk, transparente.

- [ ] **Step 5: Commit (só artefatos gerados)**

```bash
git add apps/web/public/lpc packages/shared/src/lpc-catalog.json
git commit -m "feat(lpc): assets walk-only e catálogo gerados de todas as definições do gerador"
```

---

### Task 3: Catálogo tipado no shared + teste de integridade catálogo⇄disco

**Files:**
- Create: `packages/shared/src/lpc-catalog.ts`
- Test: `packages/shared/src/lpc-catalog.test.ts`
- Modify: `packages/shared/src/index.ts` (adicionar `export * from "./lpc-catalog";` na posição alfabética junto aos exports existentes)

**Interfaces:**
- Consumes: `lpc-catalog.json` (Task 2).
- Produces (usados pelas Tasks 4–8):
  - `type LpcBodyType = 'male'|'female'|'muscular'|'pregnant'|'teen'|'child'`
  - `interface LpcCatalogLayer { zPos: number; paths: Partial<Record<LpcBodyType, string>> }`
  - `interface LpcCatalogEntry { id: string; category: string; label: string; layers: LpcCatalogLayer[]; variants: string[]; bodyTypes: LpcBodyType[] }`
  - `LPC_CATALOG: LpcCatalogEntry[]` · `CATALOG_BY_ID: Map<string, LpcCatalogEntry>`
  - `CATALOG_CATEGORIES: string[]` (ordenadas) · `itemsForCategory(category: string, bodyType: LpcBodyType): LpcCatalogEntry[]`
  - `CATEGORY_LABELS: Record<string, string>` (pt-BR, fallback = nome cru) · `categoryLabel(category: string): string`
  - `CATEGORY_GROUPS: { key: string; label: string; categories: string[] }[]` (o grupo `outros` é calculado com o que sobrar)

- [ ] **Step 1: Escrever o teste**

Criar `packages/shared/src/lpc-catalog.test.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_BY_ID,
  CATALOG_CATEGORIES,
  CATEGORY_GROUPS,
  LPC_CATALOG,
  categoryLabel,
  itemsForCategory,
} from "./lpc-catalog";

const LPC_ROOT = join(__dirname, "..", "..", "..", "apps", "web", "public", "lpc");

describe("lpc-catalog", () => {
  it("tem centenas de definições e índices coerentes", () => {
    expect(LPC_CATALOG.length).toBeGreaterThan(550);
    expect(CATALOG_BY_ID.size).toBe(LPC_CATALOG.length);
    expect(CATALOG_BY_ID.get("hair_afro")?.category).toBe("hair");
    expect(CATALOG_CATEGORIES).toContain("body");
    expect(CATALOG_CATEGORIES).toContain("weapon");
  });

  it("toda entrada é estruturalmente válida", () => {
    for (const entry of LPC_CATALOG) {
      expect(entry.layers.length, entry.id).toBeGreaterThan(0);
      expect(entry.variants.length, entry.id).toBeGreaterThan(0);
      expect(entry.bodyTypes.length, entry.id).toBeGreaterThan(0);
      for (const layer of entry.layers) {
        for (const bt of entry.bodyTypes) {
          expect(layer.paths[bt], `${entry.id}: camada sem path para ${bt}`).toBeTruthy();
        }
      }
    }
  });

  it("todo path×variante do catálogo existe em apps/web/public/lpc", () => {
    const missing: string[] = [];
    for (const entry of LPC_CATALOG) {
      const folders = new Set(entry.layers.flatMap((l) => Object.values(l.paths) as string[]));
      for (const folder of folders) {
        for (const variant of entry.variants) {
          if (!existsSync(join(LPC_ROOT, folder, `${variant}.png`))) {
            missing.push(`${entry.id}: ${folder}/${variant}.png`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("itemsForCategory filtra por corpo", () => {
    const childHair = itemsForCategory("hair", "child");
    const maleHair = itemsForCategory("hair", "male");
    expect(maleHair.length).toBeGreaterThan(childHair.length);
    expect(maleHair.every((e) => e.category === "hair")).toBe(true);
  });

  it("grupos cobrem as categorias e labels têm fallback", () => {
    const grouped = new Set(CATEGORY_GROUPS.flatMap((g) => g.categories));
    for (const cat of CATALOG_CATEGORIES) expect(grouped.has(cat), cat).toBe(true);
    expect(categoryLabel("hair")).toBe("Cabelo");
    expect(categoryLabel("categoria_inexistente")).toBe("categoria_inexistente");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared test -- lpc-catalog`
Expected: FAIL — módulo `./lpc-catalog` não existe.

- [ ] **Step 3: Implementar `packages/shared/src/lpc-catalog.ts`**

```ts
/**
 * Catálogo LPC completo — GERADO por scripts/vendor-lpc.mjs a partir das
 * sheet_definitions do Universal LPC Spritesheet Character Generator.
 * Não edite o JSON à mão; regenere com o script. Créditos em /lpc/CREDITS.txt.
 */
import rawCatalog from "./lpc-catalog.json";

export const LPC_BODY_TYPES = [
  "male", "female", "muscular", "pregnant", "teen", "child",
] as const;
export type LpcBodyType = (typeof LPC_BODY_TYPES)[number];

export interface LpcCatalogLayer {
  zPos: number;
  /** pasta relativa a /lpc/ (sem barra final) por tipo de corpo suportado */
  paths: Partial<Record<LpcBodyType, string>>;
}

export interface LpcCatalogEntry {
  id: string;
  category: string;
  label: string;
  layers: LpcCatalogLayer[];
  variants: string[];
  bodyTypes: LpcBodyType[];
}

export const LPC_CATALOG = rawCatalog as LpcCatalogEntry[];

export const CATALOG_BY_ID: Map<string, LpcCatalogEntry> = new Map(
  LPC_CATALOG.map((entry) => [entry.id, entry]),
);

export const CATALOG_CATEGORIES: string[] = [...new Set(LPC_CATALOG.map((e) => e.category))].sort();

export function itemsForCategory(category: string, bodyType: LpcBodyType): LpcCatalogEntry[] {
  return LPC_CATALOG.filter((e) => e.category === category && e.bodyTypes.includes(bodyType));
}

/** Labels pt-BR das categorias mais comuns; o resto cai no nome cru do upstream. */
export const CATEGORY_LABELS: Record<string, string> = {
  body: "Corpo", head: "Cabeça", eyes: "Olhos", eyebrows: "Sobrancelhas",
  nose: "Nariz", ears: "Orelhas", ears_inner: "Orelhas (interno)", wrinkes: "Rugas",
  hair: "Cabelo", hairextl: "Mecha (esq.)", hairextr: "Mecha (dir.)",
  ponytail: "Rabo de cavalo", hairtie: "Prendedor", beard: "Barba", mustache: "Bigode",
  facial_eyes: "Óculos", visor: "Viseira", facial_mask: "Máscara",
  earrings: "Brincos", earring_left: "Brinco (esq.)", earring_right: "Brinco (dir.)",
  clothes: "Camisa", jacket: "Jaqueta", vest: "Colete", dress: "Vestido",
  overalls: "Macacão", legs: "Calça", socks: "Meias", shoes: "Sapatos",
  belt: "Cinto", sash: "Faixa", apron: "Avental", cape: "Capa",
  shoulders: "Ombreiras", arms: "Braçadeiras", bracers: "Bráceres",
  gloves: "Luvas", wrists: "Punhos", armour: "Armadura", chainmail: "Cota de malha",
  bandages: "Bandagens", hat: "Chapéu", bandana: "Bandana", headcover: "Véu",
  neck: "Pescoço", necklace: "Colar", charm: "Amuleto", ring: "Anel",
  backpack: "Mochila", cargo: "Carga", weapon: "Arma", shield: "Escudo",
  shield_pattern: "Escudo (padrão)", shield_trim: "Escudo (borda)", shield_paint: "Escudo (pintura)",
  quiver: "Aljava", ammo: "Munição", bauldron: "Bainha",
  wings: "Asas", tail: "Cauda", horns: "Chifres", fins: "Barbatanas",
  furry_ears: "Orelhas furry", prosthesis_hand: "Prótese (mão)", prosthesis_leg: "Prótese (perna)",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

const GROUP_DEFS: { key: string; label: string; categories: string[] }[] = [
  { key: "corpo", label: "Corpo", categories: ["body", "head", "eyes", "eyebrows", "nose", "ears", "ears_inner", "wrinkes"] },
  { key: "rosto", label: "Rosto & Cabelo", categories: ["hair", "hairextl", "hairextr", "ponytail", "hairtie", "hairtie_rune", "beard", "mustache", "facial_eyes", "visor", "facial_mask", "facial_left", "facial_left_trim", "facial_right", "facial_right_trim", "earrings", "earring_left", "earring_right"] },
  { key: "roupas", label: "Roupas", categories: ["clothes", "jacket", "jacket_trim", "jacket_collar", "jacket_pockets", "vest", "dress", "dress_trim", "dress_sleeves", "dress_sleeves_trim", "overalls", "legs", "socks", "shoes", "shoes_plate", "belt", "buckles", "sash", "sash_obi", "sash_tie", "apron", "cape", "cape_trim", "shoulders", "arms", "bracers", "gloves", "wrists", "armour", "chainmail", "bandages"] },
  { key: "acessorios", label: "Acessórios", categories: ["hat", "hat_trim", "hat_accessory", "hat_overlay", "hat_buckle", "bandana", "bandana_overlay", "headcover", "headcover_rune", "neck", "necklace", "charm", "ring", "backpack", "backpack_straps", "cargo"] },
  { key: "equipamento", label: "Equipamento", categories: ["weapon", "weapon_magic_crystal", "shield", "shield_pattern", "shield_trim", "shield_paint", "quiver", "ammo", "bauldron"] },
  { key: "fantasia", label: "Fantasia", categories: ["wings", "wings_dots", "wings_edge", "tail", "horns", "fins", "furry_ears", "furry_ears_skin", "prosthesis_hand", "prosthesis_leg", "wound_arm", "wound_brain", "wound_eye", "wound_mouth", "wound_ribs"] },
];

/** Grupos do editor. Categorias do catálogo fora dos grupos caem em "Outros". */
export const CATEGORY_GROUPS: { key: string; label: string; categories: string[] }[] = (() => {
  const known = new Set(GROUP_DEFS.flatMap((g) => g.categories));
  const rest = CATALOG_CATEGORIES.filter((c) => !known.has(c));
  const groups = GROUP_DEFS.map((g) => ({
    ...g,
    categories: g.categories.filter((c) => CATALOG_CATEGORIES.includes(c)),
  }));
  return rest.length ? [...groups, { key: "outros", label: "Outros", categories: rest }] : groups;
})();
```

- [ ] **Step 4: Exportar no barril**

Em `packages/shared/src/index.ts`, adicionar `export * from "./lpc-catalog";` junto aos demais exports (ordem alfabética do arquivo).

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/shared test -- lpc-catalog`
Expected: PASS (5 testes). O teste de existência varre ~22k arquivos — até ~5s é normal.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/lpc-catalog.ts packages/shared/src/lpc-catalog.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): catálogo LPC tipado com grupos/labels e teste de integridade"
```

---

### Task 4: Contrato CharacterOptions v2 — tipos, validação, sanitize, assinatura

**Files:**
- Modify: `packages/shared/src/character.ts` (reescrita — manter nomes exportados)
- Test: `packages/shared/src/character.test.ts` (reescrita)

**Interfaces:**
- Consumes: `CATALOG_BY_ID`, `LpcBodyType`, `LPC_BODY_TYPES` (Task 3).
- Produces (mesmos nomes que os consumidores já importam — NÃO renomear):
  - `LPC_STYLE = "lpc"`
  - `BODY_TYPES: readonly LpcBodyType[]` (agora 6) · `type BodyType = LpcBodyType`
  - `interface CharacterItem { item: string; variant: string }`
  - `interface CharacterOptions { bodyType: BodyType; items: Record<string, CharacterItem> }` — `items.body` obrigatório; chave = categoria do catálogo
  - `isCharacterOptions(value: unknown): value is CharacterOptions`
  - `sanitizeCharacterOptions(options: CharacterOptions): CharacterOptions`
  - `characterSignature(options: CharacterOptions): string` · `characterHash(value: string): number`
  - Constantes de geometria inalteradas: `CHARACTER_FRAME_SIZE`, `CHARACTER_WALK_COLUMNS`, `CHARACTER_SHEET_WIDTH`, `CHARACTER_SHEET_HEIGHT`, `CHARACTER_ROW_BY_DIRECTION`, `characterIdleFrame`, `characterWalkFrames`
  - `BODY_TYPE_LABELS: Record<BodyType, string>`
- As partes de layers/default/migração entram na Task 5 (o arquivo é reescrito em duas etapas; nesta task, remover TODO o conteúdo v1 que não está listado aqui e deixar `characterLayers`/`defaultCharacterFromSeed`/labels v1 FORA — o typecheck do monorepo vai quebrar até a Task 5, tudo bem; os testes do workspace shared deste arquivo devem passar).

- [ ] **Step 1: Reescrever o teste do contrato**

Substituir `packages/shared/src/character.test.ts` por (a parte de layers/default/migração será ADICIONADA na Task 5 — deixe estes describes):

```ts
import { describe, expect, it } from "vitest";
import {
  BODY_TYPES,
  characterHash,
  characterSignature,
  isCharacterOptions,
  sanitizeCharacterOptions,
  type CharacterOptions,
} from "./character";

export const VALID_V2: CharacterOptions = {
  bodyType: "female",
  items: {
    body: { item: "body", variant: "olive" },
    head: { item: "heads_human_female", variant: "olive" },
    hair: { item: "hair_afro", variant: "blonde" },
    clothes: { item: "torso_clothes_shortsleeve", variant: "navy" },
    legs: { item: "legs_pants", variant: "black" },
    shoes: { item: "feet_shoes", variant: "brown" },
  },
};

describe("isCharacterOptions (v2)", () => {
  it("aceita options completas válidas", () => {
    expect(isCharacterOptions(VALID_V2)).toBe(true);
  });

  it("exige items.body", () => {
    const { body: _body, ...rest } = VALID_V2.items;
    expect(isCharacterOptions({ ...VALID_V2, items: rest })).toBe(false);
  });

  it("aceita os 6 corpos e rejeita corpo desconhecido", () => {
    expect(BODY_TYPES).toHaveLength(6);
    const minimal = { bodyType: "muscular", items: { body: { item: "body", variant: "light" } } };
    expect(isCharacterOptions(minimal)).toBe(true);
    expect(isCharacterOptions({ ...minimal, bodyType: "alien" })).toBe(false);
  });

  it("rejeita item fora da categoria, variante e corpo incompatíveis", () => {
    expect(isCharacterOptions({ ...VALID_V2, items: { ...VALID_V2.items, hair: { item: "legs_pants", variant: "black" } } })).toBe(false);
    expect(isCharacterOptions({ ...VALID_V2, items: { ...VALID_V2.items, hair: { item: "hair_afro", variant: "xadrez" } } })).toBe(false);
    // heads_human_female não suporta child? não garantido — usa um caso garantido:
    // body_skeleton só tem male/female; child é incompatível.
    expect(isCharacterOptions({ bodyType: "child", items: { body: { item: "body_skeleton", variant: "skeleton" } } })).toBe(false);
  });

  it("rejeita o shape v1 legado", () => {
    expect(isCharacterOptions({ bodyType: "male", skinTone: "light", hair: null, beard: null, torso: { item: "shortsleeve", color: "navy" }, legs: { item: "pants", color: "black" }, feet: { item: "shoes", color: "brown" }, glasses: null, hat: null })).toBe(false);
  });

  it("aceita corpos especiais (esqueleto/zumbi) e peles fantasia", () => {
    expect(isCharacterOptions({ bodyType: "male", items: { body: { item: "body_zombie", variant: "zombie" } } })).toBe(true);
    expect(isCharacterOptions({ bodyType: "male", items: { body: { item: "body", variant: "lavender" } } })).toBe(true);
  });
});

describe("sanitizeCharacterOptions", () => {
  it("descarta chaves extras e categorias com valor lixo", () => {
    const dirty = {
      ...VALID_V2,
      hacked: true,
      items: { ...VALID_V2.items, weapon: { item: "hair_afro", variant: "blonde" }, extra: "lixo" },
    } as unknown as CharacterOptions;
    const clean = sanitizeCharacterOptions(dirty);
    expect(Object.keys(clean)).toEqual(["bodyType", "items"]);
    expect(clean.items.weapon).toBeUndefined();
    expect((clean.items as Record<string, unknown>).extra).toBeUndefined();
    expect(clean.items.hair).toEqual({ item: "hair_afro", variant: "blonde" });
  });
});

describe("characterSignature", () => {
  it("é canônica e insensível à ordem das categorias", () => {
    const reordered: CharacterOptions = {
      bodyType: VALID_V2.bodyType,
      items: Object.fromEntries(Object.entries(VALID_V2.items).reverse()),
    };
    expect(characterSignature(reordered)).toBe(characterSignature(VALID_V2));
    expect(characterSignature(VALID_V2)).toContain("hair:hair_afro:blonde");
  });

  it("muda quando qualquer escolha muda", () => {
    const other = { ...VALID_V2, items: { ...VALID_V2.items, hair: { item: "hair_afro", variant: "ash" } } };
    expect(characterSignature(other)).not.toBe(characterSignature(VALID_V2));
  });
});

describe("characterHash", () => {
  it("é determinístico", () => {
    expect(characterHash("abc")).toBe(characterHash("abc"));
    expect(characterHash("abc")).not.toBe(characterHash("abd"));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared test -- src/character`
Expected: FAIL — v1 ainda no lugar (shape incompatível, `items` não existe).

- [ ] **Step 3: Reescrever `packages/shared/src/character.ts` (parte 1 — contrato)**

Substituir TODO o conteúdo por:

```ts
/**
 * Personagem LPC (Liberated Pixel Cup) — contrato v2, dirigido pelo catálogo
 * gerado (lpc-catalog.json). O editor monta a UI do catálogo, a API valida
 * contra ele e o vendoring (scripts/vendor-lpc.mjs) gera exatamente os
 * arquivos que characterLayers() referencia.
 * Arte CC-BY-SA/OGA-BY/CC-BY/CC0 — créditos em /lpc/CREDITS.txt (obrigatório manter).
 */
import { CATALOG_BY_ID, LPC_BODY_TYPES, type LpcBodyType } from "./lpc-catalog";

export const LPC_STYLE = "lpc" as const;

export const BODY_TYPES = LPC_BODY_TYPES;
export type BodyType = LpcBodyType;

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  male: "Tipo 1", female: "Tipo 2", muscular: "Musculoso",
  pregnant: "Gestante", teen: "Jovem", child: "Criança",
};

/** Uma escolha: item do catálogo + variante (cor). Chave do mapa = categoria. */
export interface CharacterItem {
  item: string;
  variant: string;
}

/** Escolhas do personagem. `items.body` é obrigatório; o resto é opcional. */
export interface CharacterOptions {
  bodyType: BodyType;
  items: Record<string, CharacterItem>;
}

// ── geometria do sheet (walk-only, fatiado pelo vendoring) ───────────────────
export const CHARACTER_FRAME_SIZE = 64;
export const CHARACTER_WALK_COLUMNS = 9; // frame 0 = parado, 1..8 = passos
export const CHARACTER_SHEET_WIDTH = 576;
export const CHARACTER_SHEET_HEIGHT = 256;
/** Ordem das linhas no sheet LPC universal. */
export const CHARACTER_ROW_BY_DIRECTION: Record<"up" | "left" | "down" | "right", number> = {
  up: 0, left: 1, down: 2, right: 3,
};

export function characterIdleFrame(dir: keyof typeof CHARACTER_ROW_BY_DIRECTION): number {
  return CHARACTER_ROW_BY_DIRECTION[dir] * CHARACTER_WALK_COLUMNS;
}

export function characterWalkFrames(dir: keyof typeof CHARACTER_ROW_BY_DIRECTION): number[] {
  const base = characterIdleFrame(dir);
  return Array.from({ length: CHARACTER_WALK_COLUMNS - 1 }, (_, i) => base + 1 + i);
}

// ── validação (dados vêm de Json no banco — pode haver v1/open-peeps legado) ─
function isValidItem(category: string, value: unknown, bodyType: BodyType): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.item !== "string" || typeof v.variant !== "string") return false;
  const entry = CATALOG_BY_ID.get(v.item);
  if (!entry || entry.category !== category) return false;
  return entry.bodyTypes.includes(bodyType) && entry.variants.includes(v.variant);
}

export function isCharacterOptions(value: unknown): value is CharacterOptions {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!BODY_TYPES.includes(v.bodyType as BodyType)) return false;
  if (typeof v.items !== "object" || v.items === null) return false;
  const items = v.items as Record<string, unknown>;
  if (!("body" in items)) return false;
  const bodyType = v.bodyType as BodyType;
  return Object.entries(items).every(([category, item]) => isValidItem(category, item, bodyType));
}

/**
 * Reconstrói o objeto canônico com SOMENTE os campos do contrato — z.custom
 * não descarta chaves desconhecidas como o z.object faria, então sem isto um
 * PATCH com chaves extras persistiria lixo e o retransmitiria em cada DTO/WS.
 * Entradas de categoria inválidas são dropadas (exceto body: chame após
 * validar com isCharacterOptions).
 */
export function sanitizeCharacterOptions(options: CharacterOptions): CharacterOptions {
  const items: Record<string, CharacterItem> = {};
  for (const category of Object.keys(options.items).sort()) {
    const value = options.items[category];
    if (isValidItem(category, value, options.bodyType)) {
      items[category] = { item: value.item, variant: value.variant };
    }
  }
  return { bodyType: options.bodyType, items };
}

// ── hash/assinatura (cache de textura e chave de composição) ─────────────────
/** djb2 — mesma família do officeHash; local para evitar import circular com office.ts. */
export function characterHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** String canônica das escolhas — igualdade estrutural vira igualdade de string. */
export function characterSignature(options: CharacterOptions): string {
  const parts = Object.keys(options.items)
    .sort()
    .map((category) => `${category}:${options.items[category].item}:${options.items[category].variant}`);
  return [options.bodyType, ...parts].join("|");
}
```

- [ ] **Step 4: Rodar e ver passar (só o workspace shared, só este arquivo)**

Run: `pnpm --filter @legends/shared test -- src/character`
Expected: PASS. (O typecheck/build do monorepo quebra até a Task 5 — esperado; não rode `pnpm build` agora.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/character.ts packages/shared/src/character.test.ts
git commit -m "feat(shared): contrato CharacterOptions v2 dirigido pelo catálogo"
```

---

### Task 5: characterLayers v2, personagem padrão civil e migração v1→v2

**Files:**
- Modify: `packages/shared/src/character.ts` (acrescentar ao arquivo da Task 4)
- Test: `packages/shared/src/character.test.ts` (acrescentar describes)

**Interfaces:**
- Consumes: contrato v2 (Task 4), `CATALOG_BY_ID` (Task 3).
- Produces:
  - `interface CharacterLayer { path: string; zPos: number }` (inalterada)
  - `characterLayers(options: CharacterOptions): CharacterLayer[]`
  - `defaultCharacterFromSeed(seed: string): CharacterOptions`
  - `defaultHeadFor(bodyType: BodyType): CharacterItem | null` — cabeça humana padrão (usada pela migração, pelo default e pelo editor)
  - `migrateCharacterOptions(value: unknown): CharacterOptions | null` — aceita v2 (sanitiza), v1 (converte), resto → null

- [ ] **Step 1: Acrescentar os testes**

Adicionar ao final de `packages/shared/src/character.test.ts`:

```ts
import {
  characterLayers,
  defaultCharacterFromSeed,
  defaultHeadFor,
  migrateCharacterOptions,
} from "./character";

describe("characterLayers (v2)", () => {
  it("expande multi-camadas com zPos próprios e ordena", () => {
    const withBackpack: CharacterOptions = {
      bodyType: "male",
      items: {
        body: { item: "body", variant: "light" },
        backpack: { item: "backpack_basket", variant: "round" },
      },
    };
    const layers = characterLayers(withBackpack);
    // basket tem fg (zPos 130) e bg (zPos 5) — bg vem ANTES do corpo (zPos 10)
    expect(layers.length).toBe(3);
    expect(layers[0].zPos).toBeLessThan(10);
    expect(layers[0].path).toMatch(/backpack\/basket\/bg\/round\.png$/);
    expect(layers.at(-1)!.path).toMatch(/backpack\/basket\/fg\/round\.png$/);
    expect(layers.map((l) => l.zPos)).toEqual([...layers.map((l) => l.zPos)].sort((a, b) => a - b));
  });

  it("resolve o path pelo tipo de corpo", () => {
    const layers = characterLayers(VALID_V2); // female
    expect(layers.find((l) => l.path.includes("bodies"))!.path).toBe("body/bodies/female/olive.png");
  });
});

describe("defaultCharacterFromSeed", () => {
  it("é determinístico, civil e válido", () => {
    const a = defaultCharacterFromSeed("waghner");
    expect(a).toEqual(defaultCharacterFromSeed("waghner"));
    expect(isCharacterOptions(a)).toBe(true);
    expect(a.items.body.item).toBe("body");
    expect(a.items.head).toBeTruthy();
    expect(a.items.weapon).toBeUndefined();
    expect(["male", "female"]).toContain(a.bodyType);
  });

  it("seeds diferentes variam o personagem", () => {
    expect(characterSignature(defaultCharacterFromSeed("a"))).not.toBe(
      characterSignature(defaultCharacterFromSeed("b")),
    );
  });
});

describe("migrateCharacterOptions", () => {
  const V1 = {
    bodyType: "male",
    skinTone: "bronze",
    hair: { style: "cornrows", color: "dark_brown" },
    beard: { style: "mustache", color: "dark_brown" },
    torso: { item: "longsleeve", color: "forest" },
    legs: { item: "pants2", color: "charcoal" },
    feet: { item: "boots", color: "leather" },
    glasses: { item: "sunglasses", color: "black" },
    hat: { item: "bandana", color: "red" },
  };

  it("converte o shape v1 completo para v2 válido", () => {
    const v2 = migrateCharacterOptions(V1);
    expect(v2).not.toBeNull();
    expect(isCharacterOptions(v2)).toBe(true);
    expect(v2!.items.body).toEqual({ item: "body", variant: "bronze" });
    expect(v2!.items.head).toEqual({ item: "heads_human_male", variant: "bronze" });
    expect(v2!.items.hair).toEqual({ item: "hair_cornrows", variant: "dark_brown" });
    expect(v2!.items.mustache).toEqual({ item: "beards_mustache", variant: "dark_brown" });
    expect(v2!.items.clothes).toEqual({ item: "torso_clothes_longsleeve", variant: "forest" });
    expect(v2!.items.legs).toEqual({ item: "legs_pants2", variant: "charcoal" });
    expect(v2!.items.shoes).toEqual({ item: "feet_boots", variant: "leather" });
    expect(v2!.items.facial_eyes).toEqual({ item: "facial_glasses_sunglasses", variant: "black" });
    expect(v2!.items.bandana).toEqual({ item: "hat_bandana", variant: "red" });
  });

  it("v1 com opcionais null vira v2 sem essas categorias", () => {
    const v2 = migrateCharacterOptions({ ...V1, hair: null, beard: null, glasses: null, hat: null });
    expect(v2).not.toBeNull();
    expect(v2!.items.hair).toBeUndefined();
    expect(v2!.items.facial_eyes).toBeUndefined();
  });

  it("v2 válido passa direto (sanitizado); lixo vira null", () => {
    expect(migrateCharacterOptions(VALID_V2)).toEqual(sanitizeCharacterOptions(VALID_V2));
    expect(migrateCharacterOptions(null)).toBeNull();
    expect(migrateCharacterOptions({ any: "junk" })).toBeNull();
    expect(migrateCharacterOptions("open-peeps-string")).toBeNull();
  });
});

describe("defaultHeadFor", () => {
  it("dá cabeça humana compatível por corpo", () => {
    expect(defaultHeadFor("male")).toEqual({ item: "heads_human_male", variant: "light" });
    expect(defaultHeadFor("female")).toEqual({ item: "heads_human_female", variant: "light" });
  });
});
```

Nota: o describe de migração assume que os testes do beard mapeiam `mustache`→categoria `mustache` (o upstream separa `beard` e `mustache`); se `beards_mustache` tiver `type_name` diferente no catálogo gerado, ajustar a EXPECTATIVA para a categoria real de `CATALOG_BY_ID.get("beards_mustache")!.category` — a implementação sempre deriva a categoria do catálogo, nunca hardcoda.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared test -- src/character`
Expected: FAIL — `characterLayers` etc. não exportados.

- [ ] **Step 3: Implementar (acrescentar ao final de `character.ts`)**

```ts
// ── camadas ──────────────────────────────────────────────────────────────────
export interface CharacterLayer {
  path: string; // relativo a /lpc/
  zPos: number;
}

/**
 * Camadas do personagem em ordem de desenho (zPos asc do catálogo; empate
 * mantém a ordem de inserção — categorias em ordem alfabética).
 */
export function characterLayers(options: CharacterOptions): CharacterLayer[] {
  const layers: CharacterLayer[] = [];
  for (const category of Object.keys(options.items).sort()) {
    const { item, variant } = options.items[category];
    const entry = CATALOG_BY_ID.get(item);
    if (!entry) continue;
    for (const layer of entry.layers) {
      const folder = layer.paths[options.bodyType];
      if (!folder) continue;
      layers.push({ path: `${folder}/${variant}.png`, zPos: layer.zPos });
    }
  }
  // sort estável do V8 preserva a ordem de inserção nos empates de zPos
  return layers.sort((a, b) => a.zPos - b.zPos);
}

// ── personagem padrão (migração implícita de quem nunca escolheu) ────────────
// Pool "civil": corpo humano + roupa básica — o mesmo visual da curadoria
// antiga. Ninguém spawna de zumbi armado por sorteio.
const DEFAULT_BODY_TYPES = ["male", "female"] as const;
const DEFAULT_SKINS = ["light", "amber", "olive", "taupe", "bronze", "brown", "black"];
const DEFAULT_HAIR = [
  "hair_afro", "hair_bangs", "hair_bangslong", "hair_bob", "hair_braid",
  "hair_buzzcut", "hair_cornrows", "hair_curly_long", "hair_curly_short",
  "hair_dreadlocks_short", "hair_plain", "hair_ponytail", "hair_spiked", "hair_twists_fade",
];
const DEFAULT_HAIR_COLORS = [
  "black", "dark_brown", "light_brown", "chestnut", "blonde", "ash",
  "ginger", "carrot", "dark_gray", "white",
];
const DEFAULT_CLOTHES = ["torso_clothes_shortsleeve", "torso_clothes_longsleeve", "torso_clothes_sleeveless"];
const DEFAULT_LEGS = ["legs_pants", "legs_pants2", "legs_shorts", "legs_skirts_plain", "legs_leggings"];
const DEFAULT_SHOES = ["feet_shoes", "feet_boots", "feet_sandals", "feet_slippers"];
const DEFAULT_CLOTH_COLORS = [
  "black", "blue", "bluegray", "brown", "charcoal", "forest", "gray",
  "green", "lavender", "leather", "maroon", "navy",
];

function pickBy<T>(list: readonly T[], hash: number): T {
  return list[hash % list.length];
}

/** Cabeça humana padrão do corpo (usada por default, migração e editor). */
export function defaultHeadFor(bodyType: BodyType, variant = "light"): CharacterItem | null {
  const preferred = ["female", "pregnant"].includes(bodyType) ? "heads_human_female" : "heads_human_male";
  const entry = CATALOG_BY_ID.get(preferred);
  if (entry?.bodyTypes.includes(bodyType) && entry.variants.includes(variant)) {
    return { item: preferred, variant };
  }
  return null;
}

/** Determinística: mesma seed → mesmo personagem. Sempre passa em isCharacterOptions. */
export function defaultCharacterFromSeed(seed: string): CharacterOptions {
  const h = characterHash(seed);
  const bodyType = pickBy(DEFAULT_BODY_TYPES, h);
  const skin = pickBy(DEFAULT_SKINS, h >>> 3);
  const items: Record<string, CharacterItem> = {
    body: { item: "body", variant: skin },
    hair: { item: pickBy(DEFAULT_HAIR, h >>> 6), variant: pickBy(DEFAULT_HAIR_COLORS, h >>> 9) },
    clothes: { item: pickBy(DEFAULT_CLOTHES, h >>> 12), variant: pickBy(DEFAULT_CLOTH_COLORS, h >>> 15) },
    legs: { item: pickBy(DEFAULT_LEGS, h >>> 18), variant: pickBy(DEFAULT_CLOTH_COLORS, h >>> 21) },
    shoes: { item: pickBy(DEFAULT_SHOES, h >>> 24), variant: pickBy(DEFAULT_CLOTH_COLORS, h >>> 27) },
  };
  const head = defaultHeadFor(bodyType, skin);
  if (head) items.head = head;
  return { bodyType, items };
}

// ── migração do shape v1 (curadoria antiga persistida em avatarOptions) ─────
const V1_ITEM_IDS: Record<string, Record<string, string>> = {
  hair: {
    afro: "hair_afro", bangs: "hair_bangs", bangslong: "hair_bangslong", bob: "hair_bob",
    braid: "hair_braid", buzzcut: "hair_buzzcut", cornrows: "hair_cornrows",
    curly_long: "hair_curly_long", curly_short: "hair_curly_short",
    dreadlocks_short: "hair_dreadlocks_short", plain: "hair_plain",
    ponytail: "hair_ponytail", spiked: "hair_spiked", twists_fade: "hair_twists_fade",
  },
  beard: {
    beard: "beards_beard", bigstache: "beards_bigstache", french: "beards_french",
    horseshoe: "beards_horseshoe", mustache: "beards_mustache",
  },
  torso: {
    shortsleeve: "torso_clothes_shortsleeve", longsleeve: "torso_clothes_longsleeve",
    sleeveless: "torso_clothes_sleeveless",
  },
  legs: {
    pants: "legs_pants", pants2: "legs_pants2", shorts: "legs_shorts",
    skirts_plain: "legs_skirts_plain", leggings: "legs_leggings",
  },
  feet: { shoes: "feet_shoes", boots: "feet_boots", sandals: "feet_sandals", slippers: "feet_slippers" },
  glasses: {
    glasses: "facial_glasses", round: "facial_glasses_round",
    nerd: "facial_glasses_nerd", sunglasses: "facial_glasses_sunglasses",
  },
  hat: { bandana: "hat_bandana", bowler: "hat_formal_bowler", tophat: "hat_formal_tophat" },
};

function migrateV1Entry(
  items: Record<string, CharacterItem>,
  bodyType: BodyType,
  slot: keyof typeof V1_ITEM_IDS,
  value: unknown,
  key: "style" | "item",
): void {
  if (typeof value !== "object" || value === null) return;
  const v = value as Record<string, unknown>;
  const id = V1_ITEM_IDS[slot][String(v[key])];
  const entry = id ? CATALOG_BY_ID.get(id) : undefined;
  if (!entry || !entry.bodyTypes.includes(bodyType)) return;
  const color = String(v.color ?? "");
  const variant = entry.variants.includes(color) ? color : entry.variants[0];
  // categoria vem do catálogo (hat_bandana é categoria "bandana", não "hat")
  items[entry.category] = { item: entry.id, variant };
}

/**
 * Aceita qualquer coisa vinda de Json persistido/WS: v2 válido é sanitizado,
 * o shape v1 da curadoria antiga é convertido, o resto vira null (open-peeps
 * legado, lixo). Use nas bordas (serialize, resolvers do web).
 */
export function migrateCharacterOptions(value: unknown): CharacterOptions | null {
  if (isCharacterOptions(value)) return sanitizeCharacterOptions(value);
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const isV1 =
    typeof v.skinTone === "string" &&
    typeof v.bodyType === "string" &&
    ["male", "female"].includes(v.bodyType) &&
    typeof v.torso === "object";
  if (!isV1) return null;
  const bodyType = v.bodyType as BodyType;
  const bodyEntry = CATALOG_BY_ID.get("body");
  if (!bodyEntry) return null;
  const skin = bodyEntry.variants.includes(v.skinTone as string) ? (v.skinTone as string) : bodyEntry.variants[0];
  const items: Record<string, CharacterItem> = { body: { item: "body", variant: skin } };
  const head = defaultHeadFor(bodyType, skin);
  if (head) items.head = head;
  migrateV1Entry(items, bodyType, "hair", v.hair, "style");
  migrateV1Entry(items, bodyType, "beard", v.beard, "style");
  migrateV1Entry(items, bodyType, "torso", v.torso, "item");
  migrateV1Entry(items, bodyType, "legs", v.legs, "item");
  migrateV1Entry(items, bodyType, "feet", v.feet, "item");
  migrateV1Entry(items, bodyType, "glasses", v.glasses, "item");
  migrateV1Entry(items, bodyType, "hat", v.hat, "item");
  const migrated: CharacterOptions = { bodyType, items };
  return isCharacterOptions(migrated) ? sanitizeCharacterOptions(migrated) : null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/shared test`
Expected: PASS em `character.test.ts` E `lpc-catalog.test.ts`. Se a expectativa de categoria do bigode falhar, conferir `CATALOG_BY_ID.get("beards_mustache").category` no JSON e corrigir O TESTE (a implementação deriva do catálogo).

Atenção: `defaultHeadFor` assume que `heads_human_*` tem variante `light` e suporta os corpos — se o teste acusar, inspecionar a entrada no JSON e ajustar o teste para a realidade do catálogo.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/character.ts packages/shared/src/character.test.ts
git commit -m "feat(shared): layers v2 multi-camada, default civil e migração v1→v2"
```

---

### Task 6: Borda da API — serialize com migração + fixtures dos testes

**Files:**
- Modify: `apps/api/src/lib/serialize.ts` (função `sanitizeAvatarOptions`, ~linha 73)
- Modify: fixtures v1 em `apps/api/src/lib/serialize.test.ts`, `apps/api/src/routes/auth.test.ts`, `apps/api/src/lib/office-hub.test.ts` (o que quebrar)

**Interfaces:**
- Consumes: `migrateCharacterOptions`, `isCharacterOptions` (Task 5).
- Produces: DTOs continuam expondo `avatarOptions: CharacterOptions | null` — agora sempre v2 (legado convertido na leitura).

- [ ] **Step 1: Ver o que quebra**

Run: `pnpm db:up && pnpm --filter @legends/api test 2>&1 | tail -30`
Expected: falhas nos testes que montam `avatarOptions` v1 à mão ou esperam shape v1 no DTO.

- [ ] **Step 2: Trocar a sanitização para migração**

Em `apps/api/src/lib/serialize.ts`, substituir o corpo de `sanitizeAvatarOptions`:

```ts
export function sanitizeAvatarOptions(value: unknown): CharacterOptions | null {
  // v2 é validado/sanitizado; o shape v1 da curadoria antiga persiste no banco
  // e é convertido aqui na borda de leitura; open-peeps legado vira null.
  return migrateCharacterOptions(value);
}
```

(ajustar o import no topo: `migrateCharacterOptions` no lugar de `isCharacterOptions`/`sanitizeCharacterOptions` se sobrarem sem uso).

- [ ] **Step 3: Atualizar fixtures**

Nos testes que falharam, substituir fixtures v1 por v2. Fixture padrão para reuso:

```ts
const CHARACTER_V2 = {
  bodyType: 'male' as const,
  items: {
    body: { item: 'body', variant: 'light' },
    head: { item: 'heads_human_male', variant: 'light' },
    clothes: { item: 'torso_clothes_shortsleeve', variant: 'navy' },
    legs: { item: 'legs_pants', variant: 'black' },
    shoes: { item: 'feet_shoes', variant: 'brown' },
  },
}
```

Casos a cobrir (adicionar se não existirem):
- `sanitizeAvatarOptions(CHARACTER_V2)` → igual (sanitizado).
- `sanitizeAvatarOptions(<fixture v1 completa>)` → v2 com `items.body.variant` = skinTone v1 (cobre a migração na borda).
- `sanitizeAvatarOptions({ dicebear: 'legacy' })` → null.
- PATCH `/auth/me` com `avatarOptions: CHARACTER_V2` → 200 e DTO com o mesmo objeto; com `{...CHARACTER_V2, hacked: true}` → chave extra não persiste; com shape v1 → 400 (o PATCH exige v2 — o editor novo só envia v2).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test`
Expected: PASS completo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): avatarOptions legado migra para v2 na borda do serialize"
```

---

### Task 7: Runtime web — resolvers com migração + fixtures

**Files:**
- Modify: `apps/web/src/hooks/useCharacterPortrait.ts` (função `resolveCharacterOptions`)
- Modify: `apps/web/src/office/officeAvatar.ts` (função `occupantCharacterOptions`)
- Modify: fixtures v1 nos testes web que quebrarem (`Avatar.test.tsx`, `officeAvatar.test.ts`, `OfficeBridge.test.tsx`, `PeopleList.test.tsx`, `apps/web/src/lib/character.test.ts`)

**Interfaces:**
- Consumes: `migrateCharacterOptions` (Task 5).
- Produces: assinaturas inalteradas — `resolveCharacterOptions(source: CharacterSource): CharacterOptions | null` e `occupantCharacterOptions(occupant): CharacterOptions`.

- [ ] **Step 1: Ver o que quebra**

Run: `pnpm --filter @legends/web test 2>&1 | tail -40`
Expected: falhas em testes com fixtures v1 e no `AvatarPicker.test.tsx` (que será reescrito na Task 8 — ignorar ele aqui).

- [ ] **Step 2: Migração nos resolvers**

Em `useCharacterPortrait.ts`:

```ts
export function resolveCharacterOptions(source: CharacterSource): CharacterOptions | null {
  if (source.avatarStyle === 'lpc') {
    // migrate cobre v2, o v1 da curadoria antiga (persistido) e payloads WS antigos
    const migrated = migrateCharacterOptions(source.avatarOptions)
    if (migrated) return migrated
  }
  if (source.avatarStyle === 'open-peeps') {
    return defaultCharacterFromSeed(source.avatarSeed ?? source.name)
  }
  return null
}
```

Em `officeAvatar.ts`:

```ts
export function occupantCharacterOptions(occupant: OccupantAvatar): CharacterOptions {
  const migrated = migrateCharacterOptions(occupant.avatarOptions)
  if (migrated) return migrated
  return defaultCharacterFromSeed(occupant.avatarSeed ?? occupant.userId)
}
```

(ajustar imports: `migrateCharacterOptions` entra, `isCharacterOptions` sai se ficar sem uso).

- [ ] **Step 3: Atualizar fixtures v1 → v2 nos testes que quebraram**

Usar a mesma fixture `CHARACTER_V2` da Task 6. Adicionar caso novo em `officeAvatar.test.ts`: occupant com `avatarOptions` no shape v1 completo → `occupantCharacterOptions` retorna o v2 migrado (não o default da seed).

- [ ] **Step 4: Rodar e ver passar (exceto AvatarPicker)**

Run: `pnpm --filter @legends/web test 2>&1 | tail -20`
Expected: só `AvatarPicker.test.tsx` falhando (vai na Task 8).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): resolvers de personagem migram options legadas para v2"
```

---

### Task 8: Editor novo — AvatarPicker dirigido pelo catálogo

**Files:**
- Create: `apps/web/src/components/avatar-picker/catalogView.ts`
- Test: `apps/web/src/components/avatar-picker/catalogView.test.ts`
- Create: `apps/web/src/components/avatar-picker/LayerThumb.tsx`
- Rewrite: `apps/web/src/components/AvatarPicker.tsx`
- Rewrite: `apps/web/src/components/AvatarPicker.test.tsx`

**Interfaces:**
- Consumes: `CATEGORY_GROUPS`, `categoryLabel`, `itemsForCategory`, `CATALOG_BY_ID`, `BODY_TYPES`, `BODY_TYPE_LABELS`, `defaultCharacterFromSeed`, `defaultHeadFor`, `sanitizeCharacterOptions`, `characterSignature` (shared); `characterAssetUrl`, `CHARACTER_ROW_BY_DIRECTION`, `CHARACTER_FRAME_SIZE` (web lib); `CharacterPreview`, `useCharacterPortrait`, `apiFetch` (inalterados).
- Produces:
  - `catalogView.ts`: `searchItems(entries: LpcCatalogEntry[], query: string): LpcCatalogEntry[]` (match case/acento-insensível no label e id), `applyBodyType(options: CharacterOptions, bodyType: BodyType): CharacterOptions` (troca corpo, dropa itens incompatíveis via sanitize, garante head padrão se a atual sumiu), `setItem(options, category, entry | null, variant?): CharacterOptions`, `randomCharacter(): CharacterOptions`.
  - `LayerThumb`: `<LayerThumb entry={LpcCatalogEntry} variant={string} bodyType={BodyType} />` — canvas 64×64 (frame idle-down, escala 2x nearest) das camadas do item isolado, carregado lazy via IntersectionObserver.

- [ ] **Step 1: Testes dos helpers puros**

Criar `apps/web/src/components/avatar-picker/catalogView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CATALOG_BY_ID, isCharacterOptions, type CharacterOptions } from '@legends/shared'
import { applyBodyType, randomCharacter, searchItems, setItem } from './catalogView'

const BASE: CharacterOptions = {
  bodyType: 'male',
  items: {
    body: { item: 'body', variant: 'light' },
    head: { item: 'heads_human_male', variant: 'light' },
  },
}

describe('searchItems', () => {
  it('filtra por label/id sem case e sem acento', () => {
    const hair = [CATALOG_BY_ID.get('hair_afro')!, CATALOG_BY_ID.get('hair_plain')!]
    expect(searchItems(hair, 'AFRO')).toEqual([CATALOG_BY_ID.get('hair_afro')])
    expect(searchItems(hair, '')).toEqual(hair)
  })
})

describe('setItem', () => {
  it('põe, troca variante e remove', () => {
    const withHair = setItem(BASE, 'hair', CATALOG_BY_ID.get('hair_afro')!, 'blonde')
    expect(withHair.items.hair).toEqual({ item: 'hair_afro', variant: 'blonde' })
    expect(setItem(withHair, 'hair', null).items.hair).toBeUndefined()
  })

  it('variante omitida usa a primeira do item', () => {
    const entry = CATALOG_BY_ID.get('hair_afro')!
    expect(setItem(BASE, 'hair', entry).items.hair!.variant).toBe(entry.variants[0])
  })
})

describe('applyBodyType', () => {
  it('dropa itens incompatíveis e mantém cabeça padrão', () => {
    const skeleton = setItem(BASE, 'body', CATALOG_BY_ID.get('body_skeleton')!)
    const asChild = applyBodyType(skeleton, 'child') // skeleton não suporta child
    expect(isCharacterOptions(asChild)).toBe(true)
    expect(asChild.items.body.item).toBe('body') // caiu para o corpo humano
    expect(asChild.bodyType).toBe('child')
  })
})

describe('randomCharacter', () => {
  it('gera personagem válido', () => {
    for (let i = 0; i < 20; i += 1) expect(isCharacterOptions(randomCharacter())).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- catalogView`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `catalogView.ts`**

```ts
import {
  BODY_TYPES,
  CATALOG_BY_ID,
  defaultCharacterFromSeed,
  defaultHeadFor,
  isCharacterOptions,
  sanitizeCharacterOptions,
  type BodyType,
  type CharacterOptions,
  type LpcCatalogEntry,
} from '@legends/shared'

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function searchItems(entries: LpcCatalogEntry[], query: string): LpcCatalogEntry[] {
  const q = fold(query.trim())
  if (!q) return entries
  return entries.filter((e) => fold(e.label).includes(q) || fold(e.id).includes(q))
}

/** Põe/troca/remove um item; variante omitida = primeira do catálogo. */
export function setItem(
  options: CharacterOptions,
  category: string,
  entry: LpcCatalogEntry | null,
  variant?: string,
): CharacterOptions {
  const items = { ...options.items }
  if (!entry) {
    delete items[category]
  } else {
    items[category] = {
      item: entry.id,
      variant: variant && entry.variants.includes(variant) ? variant : entry.variants[0],
    }
  }
  return { ...options, items }
}

/**
 * Troca o tipo de corpo preservando o que der: itens incompatíveis são
 * dropados pelo sanitize; corpo/cabeça caem para o humano padrão se sumirem.
 */
export function applyBodyType(options: CharacterOptions, bodyType: BodyType): CharacterOptions {
  const next = sanitizeCharacterOptions({ ...options, bodyType })
  if (!next.items.body) {
    const body = CATALOG_BY_ID.get('body')!
    const skin = options.items.body?.variant
    next.items.body = { item: 'body', variant: skin && body.variants.includes(skin) ? skin : body.variants[0] }
  }
  if (!next.items.head) {
    const head = defaultHeadFor(bodyType, next.items.body.variant)
    if (head) next.items.head = head
  }
  return next
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/** Personagem aleatório civil: base determinística da seed + acessórios sorteados. */
export function randomCharacter(): CharacterOptions {
  const seed = Math.random().toString(36).slice(2, 10)
  let options = defaultCharacterFromSeed(seed)
  if (Math.random() < 0.3) {
    const beards = ['beards_beard', 'beards_bigstache', 'beards_french', 'beards_horseshoe', 'beards_mustache']
      .map((id) => CATALOG_BY_ID.get(id))
      .filter((e): e is LpcCatalogEntry => Boolean(e?.bodyTypes.includes(options.bodyType)))
    if (beards.length) {
      const entry = pick(beards)
      options = setItem(options, entry.category, entry, options.items.hair?.variant)
    }
  }
  if (Math.random() < 0.2) {
    const entry = CATALOG_BY_ID.get('facial_glasses')
    if (entry?.bodyTypes.includes(options.bodyType)) options = setItem(options, entry.category, entry, 'black')
  }
  return isCharacterOptions(options) ? options : defaultCharacterFromSeed(seed)
}

export { BODY_TYPES }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- catalogView`
Expected: PASS.

- [ ] **Step 5: Implementar `LayerThumb.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import {
  CHARACTER_FRAME_SIZE,
  CHARACTER_ROW_BY_DIRECTION,
  type BodyType,
  type LpcCatalogEntry,
} from '@legends/shared'
import { characterAssetUrl } from '../../lib/character'

const SIZE = CHARACTER_FRAME_SIZE // frame idle-down em tamanho natural (64px, CSS escala)
const thumbCache = new Map<string, Promise<string>>()

function drawThumb(entry: LpcCatalogEntry, variant: string, bodyType: BodyType): Promise<string> {
  const key = `${entry.id}|${variant}|${bodyType}`
  const cached = thumbCache.get(key)
  if (cached) return cached
  const promise = (async () => {
    const folders = entry.layers
      .map((l) => l.paths[bodyType])
      .filter((f): f is string => Boolean(f))
    const images = await Promise.all(
      folders.map(
        (folder) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = () => reject(new Error(`falha ao carregar ${folder}/${variant}.png`))
            img.src = characterAssetUrl(`${folder}/${variant}.png`)
          }),
      ),
    )
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d indisponível')
    ctx.imageSmoothingEnabled = false
    const sy = CHARACTER_ROW_BY_DIRECTION.down * CHARACTER_FRAME_SIZE
    for (const img of images) ctx.drawImage(img, 0, sy, SIZE, SIZE, 0, 0, SIZE, SIZE)
    return canvas.toDataURL('image/png')
  })()
  promise.catch(() => thumbCache.delete(key))
  thumbCache.set(key, promise)
  return promise
}

/** Thumbnail do item isolado (frame parado de frente), carregado só quando visível. */
export function LayerThumb({
  entry,
  variant,
  bodyType,
}: {
  entry: LpcCatalogEntry
  variant: string
  bodyType: BodyType
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '128px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let alive = true
    drawThumb(entry, variant, bodyType)
      .then((u) => alive && setUri(u))
      .catch(() => alive && setUri(null))
    return () => {
      alive = false
    }
  }, [visible, entry, variant, bodyType])

  return (
    <div ref={ref} className="h-full w-full" style={{ imageRendering: 'pixelated' }}>
      {uri ? (
        <img src={uri} alt="" className="h-full w-full object-contain" />
      ) : (
        <div className="h-full w-full animate-pulse bg-surface-container-highest" />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Reescrever `AvatarPicker.tsx`**

Manter: shell do dialog, modos Prontos/Personalizar, grade de 12 presets com `PortraitImg`, botão Embaralhar, `CreditsLink`, fluxo `save()` (PATCH `/auth/me` com `avatarStyle:'lpc'`) e rodapé — copiar do arquivo atual. Substituir TODA a parte de customização (o antigo `TABS`/`CycleRow`/`SwatchRow`) por navegação de catálogo:

```tsx
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BODY_TYPES,
  BODY_TYPE_LABELS,
  CATALOG_BY_ID,
  CATEGORY_GROUPS,
  categoryLabel,
  defaultCharacterFromSeed,
  itemsForCategory,
  type BodyType,
  type CharacterOptions,
  type LpcCatalogEntry,
  type PublicUser,
} from '@legends/shared'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { resolveCharacterOptions, useCharacterPortrait } from '../hooks/useCharacterPortrait'
import { CharacterPreview } from './CharacterPreview'
import { Icon } from './Icon'
import { LayerThumb } from './avatar-picker/LayerThumb'
import { applyBodyType, randomCharacter, searchItems, setItem } from './avatar-picker/catalogView'

// … (PortraitImg, CreditsLink, randomSeed: copiar como estão hoje)

export function AvatarPicker({ onClose }: { onClose: () => void }) {
  // … estado atual (user, mode, options, sets, saving, error) igual ao de hoje
  const [group, setGroup] = useState(CATEGORY_GROUPS[0].key)
  const [category, setCategory] = useState<string>('body')
  const [query, setQuery] = useState('')

  const activeGroup = CATEGORY_GROUPS.find((g) => g.key === group) ?? CATEGORY_GROUPS[0]
  const availableItems = useMemo(
    () => searchItems(itemsForCategory(category, options.bodyType), query),
    [category, options.bodyType, query],
  )
  const selected = options.items[category] ?? null
  const selectedEntry = selected ? CATALOG_BY_ID.get(selected.item) ?? null : null

  // painel de customização (substitui o miolo antigo):
  // 1) linha de corpos: BODY_TYPES.map(bt => botão BODY_TYPE_LABELS[bt];
  //    onClick={() => setOptions(applyBodyType(options, bt))})
  // 2) abas de grupo: CATEGORY_GROUPS.map(g => botão g.label; ao trocar,
  //    setCategory(primeira categoria do grupo com itens p/ o corpo) e setQuery(''))
  // 3) chips de categoria do grupo ativo: activeGroup.categories
  //    .filter(c => itemsForCategory(c, options.bodyType).length > 0)
  //    .map(c => chip categoryLabel(c))
  // 4) busca: <input value={query} onChange placeholder="Buscar item…" aria-label="Buscar item" />
  // 5) grade de itens: botão "Nenhum" primeiro (exceto category === 'body'),
  //    onClick={() => setOptions(setItem(options, category, null))};
  //    depois availableItems.map(entry => botão com <LayerThumb entry variant={entry.variants[0]} bodyType={options.bodyType} />
  //    e label entry.label; onClick={() => setOptions(setItem(options, category, entry, selected?.item === entry.id ? selected.variant : undefined))})
  //    — se category === 'body', reaplicar defaultHeadFor via applyBodyType(options, options.bodyType) depois do setItem
  // 6) variantes do item selecionado: selectedEntry?.variants.map(v => botão 40×40 com
  //    <LayerThumb entry={selectedEntry} variant={v} bodyType={options.bodyType} /> e aria-label={`variante ${v}`};
  //    onClick={() => setOptions(setItem(options, category, selectedEntry, v))})
  // 7) <CharacterPreview options={options} /> e botão Aleatório → setOptions(randomCharacter())
}
```

O comentário numerado acima é o contrato de layout — implementar com o mesmo vocabulário visual do arquivo atual (mesmas classes Tailwind de chips/abas/botões que o `TABS` antigo usava). Grade: `grid grid-cols-4 sm:grid-cols-6 gap-sm max-h-72 overflow-y-auto` (o lazy do `LayerThumb` cuida do custo; a maior categoria tem 86 itens).

- [ ] **Step 7: Reescrever `AvatarPicker.test.tsx`**

Manter a infra do teste atual (mocks de `apiFetch`, `AuthContext`, e o mock de composição de canvas que o teste de hoje usa — conferir e reaproveitar). Casos:

```tsx
// 1) randomCharacter (agora importado de ./avatar-picker/catalogView) — já coberto lá; aqui só smoke:
it('abre no modo Personalizar para usuário lpc e mostra grupos', () => {
  render(<AvatarPicker onClose={() => {}} />)   // user mock com avatarStyle 'lpc'
  expect(screen.getByRole('dialog', { name: 'Escolher personagem' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Equipamento' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Fantasia' })).toBeInTheDocument()
})

it('busca filtra a grade de itens', async () => {
  render(<AvatarPicker onClose={() => {}} />)
  // ir para grupo Rosto & Cabelo / categoria Cabelo, digitar "afro"
  fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cabelo' }))
  fireEvent.change(screen.getByLabelText('Buscar item…'), { target: { value: 'afro' } })
  expect(await screen.findByRole('button', { name: /Afro/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Ponytail/ })).not.toBeInTheDocument()
})

it('salvar envia CharacterOptions v2', async () => {
  // clicar num item, salvar, inspecionar body do apiFetch mockado:
  // expect(body.avatarOptions.items.body).toBeTruthy() e avatarStyle 'lpc'
})
```

(jsdom não tem IntersectionObserver — o `LayerThumb` já cai para `visible=true`; mockar `HTMLCanvasElement.prototype.getContext`/`toDataURL` e `Image` como o teste atual de composição faz, ou stubar `LayerThumb` com `vi.mock` se o teste atual não tiver essa infra.)

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @legends/web test`
Expected: PASS completo do workspace web.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): editor de personagem dirigido pelo catálogo LPC completo"
```

---

### Task 9: Verificação integrada e runtime real

**Files:** nenhum novo (correções pontuais se algo falhar).

- [ ] **Step 1: Suite completa + build**

```bash
cd .claude/worktrees/avatar-creation-customization-419891
pnpm db:up && pnpm test && pnpm build
```
Expected: todos os workspaces passam; build limpo (o typecheck do web compila o editor novo).

- [ ] **Step 2: Subir o app e verificar no navegador**

Seguir a skill `verify` do projeto (Node 20; exportar `LIVEKIT_*` não é necessário para esta feature). Checklist manual no browser (via tool de Browser):
1. Login com usuário do seed; abrir o editor de personagem.
2. Grupo Corpo: trocar para `Musculoso` e `Gestante` — preview atualiza; pele fantasia (lavanda) aparece nas variantes do corpo.
3. Grupo Equipamento: equipar uma arma; grupo Fantasia: equipar asas — preview mostra as camadas na ordem certa (asa atrás do corpo).
4. Buscar "afro" em Cabelo; trocar variante por thumbnail.
5. Salvar → PATCH 200; retrato do header atualiza.
6. Abrir o escritório: personagem anda com o novo visual; segundo usuário (aba anônima) vê o avatar atualizado via WS.
7. Usuário `diego.barreto@...` (tem avatarOptions v1 no banco local): perfil renderiza o personagem migrado, sem erro no console.

- [ ] **Step 3: Ajustes que surgirem + commit final**

```bash
git add -A && git commit -m "fix(web): ajustes da verificação manual do guarda-roupa completo"
```
(somente se houver ajuste; senão, pular)

- [ ] **Step 4: Atualizar AGENTS.md (menção à curadoria) e progress ledger**

Em `AGENTS.md`, na seção do frontend, trocar "assets curados em `apps/web/public/lpc`" por "assets completos do gerador em `apps/web/public/lpc` (catálogo gerado em `@legends/shared`, `scripts/vendor-lpc.mjs`)". Registrar a execução em `.superpowers/sdd/progress.md` seguindo o formato existente.

```bash
git add AGENTS.md .superpowers/sdd/progress.md
git commit -m "docs: guarda-roupa LPC completo no contexto do repo"
```
