# Personagem LPC Customizável — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o avatar open-peeps e a geração de sprite via OpenAI por um personagem LPC customizável (corpo, pele, cabelo, barba, roupa, calça, sapato, óculos, chapéu), composto 100% no cliente, com walk cycle real no escritório.

**Architecture:** Assets LPC curados são pré-fatiados (só linhas de walk: 9 frames × 4 direções de 64px) e commitados em `apps/web/public/lpc/`. Um catálogo em `@legends/shared` é a fonte única de ids/cores/z-order para o editor (web) e a validação zod (api). Tudo renderiza on-the-fly de `User.avatarOptions` — retrato no perfil (crop da cabeça), spritesheet no Phaser. Nenhum PNG persiste no servidor; o pipeline OpenAI é deletado.

**Tech Stack:** TypeScript ESM, pnpm workspaces, Fastify+Prisma+zod (api), React 18+Vite (web), Phaser (escritório), pngjs (script de vendoring), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-personagem-lpc-customizavel-design.md`

## Global Constraints

- Node ≥ 20 (o shell de dev pode estar em 18 — rode `nvm use 20` antes de qualquer comando).
- Testes da API batem em Postgres real: rode `pnpm db:up` antes de `pnpm test`.
- Mensagens ao usuário em **português**; código segue o padrão da camada vizinha.
- Route fina → service → Prisma; contrato em `@legends/shared` muda ANTES dos dois lados.
- Nunca editar migration aplicada (este plano não cria migration nenhuma — reusa colunas existentes).
- Licença dos assets: só CC-BY-SA 3.0 / OGA-BY 3.0; a página de créditos é requisito de release.
- `pnpm test` verde ao final de CADA task (estado funcional intermediário entre tasks pode ser inconsistente — ex.: picker antigo salva num schema que a API já não aceita — mas os testes nunca quebram).

## Fatos verificados do gerador LPC (não re-derivar)

Verificados contra clone real de `sanderfrenken/Universal-LPC-Spritesheet-Character-Generator` em 2026-07-15:

- Sheets "universal" são 832×1344 (13 col × 21 linhas de 64px); sheets de body/head são 832×2944 (animações extras anexadas ABAIXO — o topo mantém o layout universal).
- **Linhas de walk: y=512, altura 256** (4 direções × 64px, ordem `up, left, down, right`), **9 frames** (x=0..575). Frame 0 de cada direção = pose parada. Verificado visualmente com composição de 6 camadas.
- Cabeça é camada SEPARADA do corpo (`spritesheets/head/heads/human/{male,female}/<skin>.png`).
- Variantes no JSON usam espaço (`"light brown"`); arquivos usam underscore (`light_brown.png`).
- Todos os 41 sheet_definitions curados abaixo têm **exatamente 1 layer** (`layer_1`).
- zPos por item: body 10 · feet 15 (boots **25**) · legs 20 · torso 35 · head 100 · beard 110 (bigstache/french/horseshoe/mustache 111) · glasses 115 · hair 120 · hat bandana 120, bowler/tophat 130.
- Curadoria 100% validada (todo def + toda variante + todo arquivo por body type existem):
  - `body` (male/female × 7 skins), `heads_human_male`, `heads_human_female` (7 skins)
  - hair (14, male+female): `hair_afro, hair_bangs, hair_bangslong, hair_bob, hair_braid, hair_buzzcut, hair_cornrows, hair_curly_long, hair_curly_short, hair_dreadlocks_short, hair_plain, hair_ponytail, hair_spiked, hair_twists_fade` — 10 cores: `black, dark brown, light brown, chestnut, blonde, ash, ginger, carrot, dark gray, white`
  - beards (5, unissex — mesmo path p/ male e female): `beards_beard, beards_bigstache, beards_french, beards_horseshoe, beards_mustache` — 10 cores de cabelo
  - torso (3, male+female): `torso_clothes_shortsleeve, torso_clothes_longsleeve, torso_clothes_sleeveless` — 12 cores: `black, blue, bluegray, brown, charcoal, forest, gray, green, lavender, leather, maroon, navy`
  - legs (5, male+female): `legs_pants, legs_pants2, legs_shorts, legs_skirts_plain, legs_leggings` — 12 cores
  - feet (4, male+female): `feet_shoes, feet_boots, feet_sandals, feet_slippers` — 12 cores
  - glasses (4, unissex, path `adult/`): `facial_glasses, facial_glasses_round, facial_glasses_nerd` (12 cores) + `facial_glasses_sunglasses` (só `black`)
  - hat (3, unissex, path `adult/`): `hat_bandana` (`black, blue, red, white`), `hat_formal_bowler`, `hat_formal_tophat` (`black, brown, navy`)
- `hair_twists_fade` usa path `adult/` (unissex) — o script duplica para `male/` e `female/` na saída para manter path uniforme de hair.
- Skirts femininas de `legs_pants` vêm de `legs/pants/thin/` (o def resolve isso; sempre resolver paths PELO def, nunca chutar).
- Créditos: cada def tem array `credits` (`file, notes, authors, licenses, urls`).

## Decisão registrada (gap do spec)

**MoodOfDay** (`apps/web/src/pages/profile/MoodOfDay.tsx`) usa 5 feições do open-peeps como seletor de humor. LPC não tem expressões faciais. Decisão: o seletor passa a usar **5 emojis** (😞 🙁 😐 🙂 😄) no lugar dos avatares com feição — feature preservada, dependência do DiceBear removida. (Task 5.)

## File Structure (visão geral)

```
scripts/vendor-lpc.mjs                       CRIAR  script de curadoria/fatiamento (commitado)
apps/web/public/lpc/**                       CRIAR  ~700 PNGs 576×256 + CREDITS.txt (gerados, commitados)
packages/shared/src/character.ts             CRIAR  catálogo, CharacterOptions, layers, default, hash
packages/shared/src/character.test.ts        CRIAR
packages/shared/src/avatar.ts                MODIFICAR  +'lpc' (Task 2); só lpc + remove open-peeps (Task 9)
packages/shared/src/office.ts                MODIFICAR  avatar-updated; depois remove spriteUrl/officeColors
apps/api/src/routes/auth.ts                  MODIFICAR  schema lpc, remove trigger OpenAI, broadcast
apps/api/src/lib/office-hub.ts               MODIFICAR  updateAvatar no lugar de updateSprite
apps/api/src/routes/office-ws.ts             MODIFICAR  sem spriteUrl/backfill
apps/api/src/app.ts                          MODIFICAR  remove static /office-sprites/
apps/api/src/services/office-sprite-service* DELETAR
apps/api/src/lib/sprite-sheet*               DELETAR
apps/api/src/lib/office-avatar-png*          DELETAR
apps/api/assets/office-sprite-style/         DELETAR
apps/web/src/lib/character.ts                CRIAR  composição canvas + retrato + cache
apps/web/src/lib/character.test.ts           CRIAR
apps/web/src/hooks/useCharacterPortrait.ts   CRIAR
apps/web/src/components/Avatar.tsx           MODIFICAR  retrato LPC → photoUrl → iniciais
apps/web/src/components/AvatarPicker.tsx     REESCREVER  editor LPC (mesmo nome/modal)
apps/web/src/components/CharacterPreview.tsx CRIAR  preview animado (walk cycle)
apps/web/src/pages/profile/MoodOfDay.tsx     MODIFICAR  emojis
apps/web/src/office/officeAvatar.ts          REESCREVER  occupant → CharacterOptions
apps/web/src/office/scenes/OfficeScene.ts    MODIFICAR  spritesheet composto + anims
apps/web/src/office/OfficeBridge.ts          MODIFICAR  avatar-updated
apps/web/src/lib/avatar.ts                   DELETAR (Task 9)
nginx/default.conf                           MODIFICAR  remove /office-sprites/
apps/api/.env.example                        MODIFICAR  remove OPENAI_*
package.json (raiz)                          MODIFICAR  devDep pngjs
```

---

### Task 1: Vendoring dos assets LPC (script + PNGs + créditos)

**Files:**
- Create: `scripts/vendor-lpc.mjs`
- Create (gerados): `apps/web/public/lpc/**/*.png`, `apps/web/public/lpc/CREDITS.txt`
- Modify: `package.json` (raiz — devDependency `pngjs`)

**Interfaces:**
- Produces: árvore `apps/web/public/lpc/<layerPath>` onde `<layerPath>` são exatamente os paths que `characterLayers()` (Task 2) retorna:
  - `body/{male|female}/{skin}.png` · `head/{male|female}/{skin}.png`
  - `hair/{style}/{male|female}/{color}.png` · `beard/{style}/{color}.png`
  - `torso/{item}/{male|female}/{color}.png` · `legs/{item}/{male|female}/{color}.png` · `feet/{item}/{male|female}/{color}.png`
  - `glasses/{item}/{color}.png` · `hat/{item}/{color}.png`
  - Todos 576×256 (9 frames × 4 direções de 64px, linhas `up, left, down, right`, frame 0 = parado).

- [ ] **Step 1: Adicionar pngjs como devDependency da raiz**

```bash
pnpm add -D -w pngjs@^7.0.0
```

- [ ] **Step 2: Escrever `scripts/vendor-lpc.mjs`**

O script é a curadoria executável: valida tudo contra o clone do gerador e falha alto em qualquer ausência. Conteúdo completo:

```js
// Curadoria de assets do Universal LPC Spritesheet Character Generator.
// Uso: node scripts/vendor-lpc.mjs <path-do-clone-do-gerador>
// Fatia só as linhas de walk (y=512, 4 direções × 9 frames de 64px) de cada
// camada curada e grava em apps/web/public/lpc/, junto com CREDITS.txt.
// Fonte única dos ids/cores é o catálogo em @legends/shared — mantenha os dois
// em sincronia (o teste de catálogo da Task 2 confere path por path).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { PNG } from 'pngjs'

const WALK_Y = 512
const SHEET_W = 576
const SHEET_H = 256

const generatorRoot = process.argv[2]
if (!generatorRoot || !existsSync(join(generatorRoot, 'sheet_definitions'))) {
  console.error('Uso: node scripts/vendor-lpc.mjs <path-do-clone-do-Universal-LPC-Spritesheet-Character-Generator>')
  process.exit(1)
}
const outRoot = join(process.cwd(), 'apps', 'web', 'public', 'lpc')

const SKIN = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown', 'black']
const HAIR = ['black', 'dark brown', 'light brown', 'chestnut', 'blonde', 'ash', 'ginger', 'carrot', 'dark gray', 'white']
const CLOTH = ['black', 'blue', 'bluegray', 'brown', 'charcoal', 'forest', 'gray', 'green', 'lavender', 'leather', 'maroon', 'navy']

// def: nome do sheet_definition; out: subpasta de saída; perBody: gera male/ e
// female/ (para unissex com perBody, duplica a mesma origem nos dois).
const CURATED = [
  { def: 'body', out: 'body', perBody: true, variants: SKIN },
  { def: 'heads_human_male', out: 'head/male', only: 'male', variants: SKIN },
  { def: 'heads_human_female', out: 'head/female', only: 'female', variants: SKIN },
  ...['afro', 'bangs', 'bangslong', 'bob', 'braid', 'buzzcut', 'cornrows', 'curly_long', 'curly_short', 'dreadlocks_short', 'plain', 'ponytail', 'spiked', 'twists_fade']
    .map((s) => ({ def: `hair_${s}`, out: `hair/${s}`, perBody: true, variants: HAIR })),
  ...['beard', 'bigstache', 'french', 'horseshoe', 'mustache']
    .map((s) => ({ def: `beards_${s}`, out: `beard/${s}`, variants: HAIR })),
  ...['shortsleeve', 'longsleeve', 'sleeveless']
    .map((s) => ({ def: `torso_clothes_${s}`, out: `torso/${s}`, perBody: true, variants: CLOTH })),
  ...[['pants', 'legs_pants'], ['pants2', 'legs_pants2'], ['shorts', 'legs_shorts'], ['skirts_plain', 'legs_skirts_plain'], ['leggings', 'legs_leggings']]
    .map(([id, def]) => ({ def, out: `legs/${id}`, perBody: true, variants: CLOTH })),
  ...['shoes', 'boots', 'sandals', 'slippers']
    .map((s) => ({ def: `feet_${s}`, out: `feet/${s}`, perBody: true, variants: CLOTH })),
  { def: 'facial_glasses', out: 'glasses/glasses', variants: CLOTH },
  { def: 'facial_glasses_round', out: 'glasses/round', variants: CLOTH },
  { def: 'facial_glasses_nerd', out: 'glasses/nerd', variants: CLOTH },
  { def: 'facial_glasses_sunglasses', out: 'glasses/sunglasses', variants: ['black'] },
  { def: 'hat_bandana', out: 'hat/bandana', variants: ['black', 'blue', 'red', 'white'] },
  { def: 'hat_formal_bowler', out: 'hat/bowler', variants: ['black', 'brown', 'navy'] },
  { def: 'hat_formal_tophat', out: 'hat/tophat', variants: ['black', 'brown', 'navy'] },
]

function sliceWalk(srcPath, destPath) {
  const src = PNG.sync.read(readFileSync(srcPath))
  if (src.width < SHEET_W || src.height < WALK_Y + SHEET_H) {
    throw new Error(`${srcPath}: ${src.width}x${src.height} não contém a região de walk (esperado >= 576x768)`)
  }
  const out = new PNG({ width: SHEET_W, height: SHEET_H })
  PNG.bitblt(src, out, 0, WALK_Y, SHEET_W, SHEET_H, 0, 0)
  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, PNG.sync.write(out))
}

const creditsBlocks = new Map() // dedup por def
let files = 0

for (const entry of CURATED) {
  const defPath = join(generatorRoot, 'sheet_definitions', `${entry.def}.json`)
  if (!existsSync(defPath)) throw new Error(`sheet_definition ausente: ${entry.def}`)
  const def = JSON.parse(readFileSync(defPath, 'utf8'))
  const layers = Object.keys(def).filter((k) => k.startsWith('layer_'))
  if (layers.length !== 1) throw new Error(`${entry.def}: esperado 1 layer, achei ${layers.length}`)
  const layer = def.layer_1

  const bodyTypes = entry.only ? [entry.only] : entry.perBody ? ['male', 'female'] : ['unisex']
  for (const bt of bodyTypes) {
    const srcFolder = bt === 'unisex' ? (layer.male ?? layer.adult) : (layer[bt] ?? layer.adult)
    if (!srcFolder) throw new Error(`${entry.def}: sem path para ${bt}`)
    for (const variant of entry.variants) {
      if (!def.variants.includes(variant)) throw new Error(`${entry.def}: variante desconhecida "${variant}"`)
      const file = `${variant.replace(/ /g, '_')}.png`
      const src = join(generatorRoot, 'spritesheets', srcFolder, file)
      if (!existsSync(src)) throw new Error(`arquivo ausente: ${src}`)
      const outDir = entry.perBody && !entry.only ? join(outRoot, entry.out, bt) : join(outRoot, entry.out)
      sliceWalk(src, join(outDir, file))
      files += 1
    }
  }

  for (const credit of def.credits ?? []) {
    const key = `${entry.def}:${credit.file}`
    if (creditsBlocks.has(key)) continue
    const urls = Object.entries(credit).filter(([k, v]) => k.startsWith('url') && v).map(([, v]) => `  ${v}`)
    creditsBlocks.set(key, [
      `## ${def.name} (${entry.def})`,
      `- Arquivo-fonte: ${credit.file}`,
      `- Autores: ${(credit.authors ?? []).join(', ')}`,
      `- Licenças: ${(credit.licenses ?? []).join(', ')}`,
      ...(credit.notes ? [`- Notas: ${credit.notes}`] : []),
      ...(urls.length ? ['- Links:', ...urls] : []),
      '',
    ].join('\n'))
  }
}

const header = [
  '# Créditos — arte do personagem (Liberated Pixel Cup)',
  '',
  'Os sprites do personagem são derivados do Universal LPC Spritesheet',
  'Character Generator (https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator),',
  'fatiados para conter apenas a animação de caminhada.',
  '',
  'Licenças: CC-BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/)',
  'e/ou OGA-BY 3.0 (https://static.opengameart.org/OGA-BY-3.0.txt), por item abaixo.',
  '',
].join('\n')
writeFileSync(join(outRoot, 'CREDITS.txt'), header + [...creditsBlocks.values()].join('\n'))

function du(dir) {
  let total = 0
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    total += f.isDirectory() ? du(p) : statSync(p).size
  }
  return total
}
console.log(`ok: ${files} PNGs gerados em apps/web/public/lpc (${(du(outRoot) / 1024 / 1024).toFixed(1)} MB)`)
```

- [ ] **Step 3: Clonar o gerador e rodar o script**

```bash
git clone --depth 1 https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator.git /tmp/lpc-generator
node scripts/vendor-lpc.mjs /tmp/lpc-generator
```

Expected: `ok: ~700 PNGs gerados em apps/web/public/lpc (N MB)` — sem exceção. Se N > 8 MB, reduza cores da curadoria (corte `lavender`/`leather` de CLOTH) e rode de novo.

- [ ] **Step 4: Conferir visualmente 2 amostras**

Abra `apps/web/public/lpc/body/male/light.png` e `apps/web/public/lpc/hair/afro/female/black.png` (Preview/Read): devem ser tiras 576×256 com 4 linhas (up/left/down/right) × 9 frames.

- [ ] **Step 5: Conferir CREDITS.txt**

`apps/web/public/lpc/CREDITS.txt` deve listar autores/licenças por item, sem blocos vazios.

- [ ] **Step 6: Commit**

```bash
git add scripts/vendor-lpc.mjs apps/web/public/lpc package.json pnpm-lock.yaml
git commit -m "feat(web): assets LPC curados (walk-only) + script de vendoring e créditos"
```

---

### Task 2: Catálogo do personagem em `@legends/shared`

**Files:**
- Create: `packages/shared/src/character.ts`
- Test: `packages/shared/src/character.test.ts`
- Modify: `packages/shared/src/avatar.ts` (adiciona `'lpc'` ao lado de `'open-peeps'`; `UpdateProfileRequest.avatarOptions` vira união)
- Modify: `packages/shared/src/index.ts` (exporta `./character`)

**Interfaces:**
- Produces (consumido por TODAS as tasks seguintes):
  - `type CharacterOptions` — `{ bodyType, skinTone, hair, beard, torso, legs, feet, glasses, hat }`
  - `characterLayers(options): { path: string; zPos: number }[]` — paths relativos a `/lpc/`, ordenados para desenho
  - `defaultCharacterFromSeed(seed: string): CharacterOptions` — determinística e válida
  - `isCharacterOptions(value: unknown): value is CharacterOptions` — guarda p/ dados legados (open-peeps) no banco
  - `characterSignature(options): string` e `characterHash(value: string): number` — chave de cache/textura
  - Constantes: `LPC_STYLE`, `BODY_TYPES`, `SKIN_TONES`, `HAIR_STYLES`, `HAIR_COLORS`, `BEARD_STYLES`, `TORSO_ITEMS`, `LEGS_ITEMS`, `FEET_ITEMS`, `GLASSES_ITEMS`, `GLASSES_COLORS`, `HAT_ITEMS`, `HAT_COLORS`, `CLOTH_COLORS`, `CHARACTER_FRAME_SIZE=64`, `CHARACTER_WALK_COLUMNS=9`, `CHARACTER_SHEET_WIDTH=576`, `CHARACTER_SHEET_HEIGHT=256`, `CHARACTER_ROW_BY_DIRECTION`, `characterIdleFrame(dir)`, `characterWalkFrames(dir)`
  - Metadados de UI (padrão `OPEN_PEEPS_VARIANT_COMPONENTS`): labels pt-BR por item e swatches hex aproximados (`SKIN_TONE_SWATCHES`, `HAIR_COLOR_SWATCHES`, `CLOTH_COLOR_SWATCHES`)

- [ ] **Step 1: Escrever os testes que falham**

`packages/shared/src/character.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BODY_TYPES,
  CHARACTER_ROW_BY_DIRECTION,
  characterIdleFrame,
  characterLayers,
  characterSignature,
  characterWalkFrames,
  defaultCharacterFromSeed,
  isCharacterOptions,
  type CharacterOptions,
} from './character'

const FULL: CharacterOptions = {
  bodyType: 'male',
  skinTone: 'bronze',
  hair: { style: 'afro', color: 'black' },
  beard: { style: 'beard', color: 'black' },
  torso: { item: 'shortsleeve', color: 'blue' },
  legs: { item: 'pants', color: 'navy' },
  feet: { item: 'boots', color: 'brown' },
  glasses: { item: 'sunglasses', color: 'black' },
  hat: { item: 'bowler', color: 'black' },
}

describe('characterLayers', () => {
  it('gera paths por bodyType em ordem de zPos (boots por cima da calça)', () => {
    const paths = characterLayers(FULL).map((l) => l.path)
    expect(paths).toEqual([
      'body/male/bronze.png',
      'legs/pants/male/navy.png',
      'feet/boots/male/brown.png', // boots zPos 25 > legs 20
      'torso/shortsleeve/male/blue.png',
      'head/male/bronze.png',
      'beard/beard/black.png',
      'glasses/sunglasses/black.png',
      'hair/afro/male/black.png',
      'hat/bowler/black.png',
    ])
  })

  it('omite camadas opcionais nulas', () => {
    const paths = characterLayers({ ...FULL, hair: null, beard: null, glasses: null, hat: null }).map((l) => l.path)
    expect(paths).toEqual([
      'body/male/bronze.png',
      'legs/pants/male/navy.png',
      'feet/boots/male/brown.png',
      'torso/shortsleeve/male/blue.png',
      'head/male/bronze.png',
    ])
  })
})

describe('defaultCharacterFromSeed', () => {
  it('é determinística', () => {
    expect(defaultCharacterFromSeed('ana')).toEqual(defaultCharacterFromSeed('ana'))
  })
  it('varia com a seed e é sempre válida', () => {
    const seeds = ['ana', 'bruno', 'carla', 'diego', 'elisa', 'fabio']
    const chars = seeds.map(defaultCharacterFromSeed)
    expect(new Set(chars.map(characterSignature)).size).toBeGreaterThan(1)
    for (const c of chars) expect(isCharacterOptions(c)).toBe(true)
  })
})

describe('isCharacterOptions', () => {
  it('aceita options completas', () => {
    expect(isCharacterOptions(FULL)).toBe(true)
  })
  it('rejeita open-peeps legado, null e lixo', () => {
    expect(isCharacterOptions({ head: 'short1', face: 'smile', skinColor: 'edb98a' })).toBe(false)
    expect(isCharacterOptions(null)).toBe(false)
    expect(isCharacterOptions({ ...FULL, skinTone: 'roxo' })).toBe(false)
    expect(isCharacterOptions({ ...FULL, hat: { item: 'bowler', color: 'lavender' } })).toBe(false) // cor fora da paleta do item
  })
})

describe('frames', () => {
  it('mapeia direções para linhas e frames do sheet 9x4', () => {
    expect(CHARACTER_ROW_BY_DIRECTION).toEqual({ up: 0, left: 1, down: 2, right: 3 })
    expect(characterIdleFrame('down')).toBe(18)
    expect(characterWalkFrames('down')).toEqual([19, 20, 21, 22, 23, 24, 25, 26])
    expect(characterWalkFrames('up')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('characterSignature', () => {
  it('é estável e distingue options diferentes', () => {
    expect(characterSignature(FULL)).toBe(characterSignature({ ...FULL }))
    expect(characterSignature(FULL)).not.toBe(characterSignature({ ...FULL, skinTone: 'light' }))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared test -- run character`
Expected: FAIL (módulo `./character` não existe)

- [ ] **Step 3: Implementar `packages/shared/src/character.ts`**

```ts
/**
 * Personagem LPC (Liberated Pixel Cup) — catálogo curado.
 * Fonte única de ids/cores/z-order: o editor (web) monta a UI daqui, a API
 * valida contra estas listas e o script de vendoring (scripts/vendor-lpc.mjs)
 * gera exatamente os arquivos que characterLayers() referencia.
 * Arte CC-BY-SA/OGA-BY — créditos em /lpc/CREDITS.txt (obrigatório manter).
 */
export const LPC_STYLE = "lpc" as const;

export const BODY_TYPES = ["male", "female"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const SKIN_TONES = [
  "light", "amber", "olive", "taupe", "bronze", "brown", "black",
] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

export const HAIR_STYLES = [
  "afro", "bangs", "bangslong", "bob", "braid", "buzzcut", "cornrows",
  "curly_long", "curly_short", "dreadlocks_short", "plain", "ponytail",
  "spiked", "twists_fade",
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const HAIR_COLORS = [
  "black", "dark_brown", "light_brown", "chestnut", "blonde", "ash",
  "ginger", "carrot", "dark_gray", "white",
] as const;
export type HairColor = (typeof HAIR_COLORS)[number];

export const BEARD_STYLES = ["beard", "bigstache", "french", "horseshoe", "mustache"] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];

export const CLOTH_COLORS = [
  "black", "blue", "bluegray", "brown", "charcoal", "forest", "gray",
  "green", "lavender", "leather", "maroon", "navy",
] as const;
export type ClothColor = (typeof CLOTH_COLORS)[number];

export const TORSO_ITEMS = ["shortsleeve", "longsleeve", "sleeveless"] as const;
export type TorsoItem = (typeof TORSO_ITEMS)[number];

export const LEGS_ITEMS = ["pants", "pants2", "shorts", "skirts_plain", "leggings"] as const;
export type LegsItem = (typeof LEGS_ITEMS)[number];

export const FEET_ITEMS = ["shoes", "boots", "sandals", "slippers"] as const;
export type FeetItem = (typeof FEET_ITEMS)[number];

export const GLASSES_ITEMS = ["glasses", "round", "nerd", "sunglasses"] as const;
export type GlassesItem = (typeof GLASSES_ITEMS)[number];
/** Cores válidas POR item (sunglasses só existe em preto). */
export const GLASSES_COLORS: Record<GlassesItem, readonly string[]> = {
  glasses: CLOTH_COLORS,
  round: CLOTH_COLORS,
  nerd: CLOTH_COLORS,
  sunglasses: ["black"],
};

export const HAT_ITEMS = ["bandana", "bowler", "tophat"] as const;
export type HatItem = (typeof HAT_ITEMS)[number];
export const HAT_COLORS: Record<HatItem, readonly string[]> = {
  bandana: ["black", "blue", "red", "white"],
  bowler: ["black", "brown", "navy"],
  tophat: ["black", "brown", "navy"],
};

/** Escolhas completas do personagem. `null` nos opcionais = "nenhum". */
export interface CharacterOptions {
  bodyType: BodyType;
  skinTone: SkinTone;
  hair: { style: HairStyle; color: HairColor } | null;
  beard: { style: BeardStyle; color: HairColor } | null;
  torso: { item: TorsoItem; color: ClothColor };
  legs: { item: LegsItem; color: ClothColor };
  feet: { item: FeetItem; color: ClothColor };
  glasses: { item: GlassesItem; color: string } | null;
  hat: { item: HatItem; color: string } | null;
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

// ── camadas ──────────────────────────────────────────────────────────────────
/** zPos dos sheet_definitions do LPC — NÃO reordenar sem checar o gerador. */
const Z = {
  body: 10, shoes: 15, sandals: 15, slippers: 15, legs: 20, boots: 25,
  torso: 35, head: 100, beard: 110, beardOther: 111, glasses: 115,
  hair: 120, bandana: 120, bowler: 130, tophat: 130,
} as const;

export interface CharacterLayer {
  path: string; // relativo a /lpc/
  zPos: number;
}

/**
 * Camadas do personagem em ordem de desenho (zPos asc; empate mantém a ordem
 * de inserção: body, legs/feet, torso, head, beard, glasses, hair, hat).
 */
export function characterLayers(options: CharacterOptions): CharacterLayer[] {
  const bt = options.bodyType;
  const layers: CharacterLayer[] = [
    { path: `body/${bt}/${options.skinTone}.png`, zPos: Z.body },
    { path: `legs/${options.legs.item}/${bt}/${options.legs.color}.png`, zPos: Z.legs },
    {
      path: `feet/${options.feet.item}/${bt}/${options.feet.color}.png`,
      zPos: options.feet.item === "boots" ? Z.boots : Z.shoes,
    },
    { path: `torso/${options.torso.item}/${bt}/${options.torso.color}.png`, zPos: Z.torso },
    { path: `head/${bt}/${options.skinTone}.png`, zPos: Z.head },
  ];
  if (options.beard) {
    layers.push({
      path: `beard/${options.beard.style}/${options.beard.color}.png`,
      zPos: options.beard.style === "beard" ? Z.beard : Z.beardOther,
    });
  }
  if (options.glasses) {
    layers.push({ path: `glasses/${options.glasses.item}/${options.glasses.color}.png`, zPos: Z.glasses });
  }
  if (options.hair) {
    layers.push({ path: `hair/${options.hair.style}/${bt}/${options.hair.color}.png`, zPos: Z.hair });
  }
  if (options.hat) {
    layers.push({ path: `hat/${options.hat.item}/${options.hat.color}.png`, zPos: Z[options.hat.item] });
  }
  // sort estável do V8 preserva a ordem de inserção nos empates de zPos
  return layers.sort((a, b) => a.zPos - b.zPos);
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
  return [
    options.bodyType,
    options.skinTone,
    options.hair ? `${options.hair.style}:${options.hair.color}` : "-",
    options.beard ? `${options.beard.style}:${options.beard.color}` : "-",
    `${options.torso.item}:${options.torso.color}`,
    `${options.legs.item}:${options.legs.color}`,
    `${options.feet.item}:${options.feet.color}`,
    options.glasses ? `${options.glasses.item}:${options.glasses.color}` : "-",
    options.hat ? `${options.hat.item}:${options.hat.color}` : "-",
  ].join("|");
}

// ── validação (dados vêm de Json no banco — pode haver open-peeps legado) ────
function inList(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

export function isCharacterOptions(value: unknown): value is CharacterOptions {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!inList(BODY_TYPES, v.bodyType) || !inList(SKIN_TONES, v.skinTone)) return false;
  const pair = (entry: unknown, items: readonly string[], colors: (item: string) => readonly string[], key: "style" | "item") => {
    if (entry === null) return true;
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return inList(items, e[key]) && inList(colors(e[key] as string), e.color);
  };
  if (!pair(v.hair, HAIR_STYLES, () => HAIR_COLORS, "style")) return false;
  if (!pair(v.beard, BEARD_STYLES, () => HAIR_COLORS, "style")) return false;
  if (v.torso === null || !pair(v.torso, TORSO_ITEMS, () => CLOTH_COLORS, "item")) return false;
  if (v.legs === null || !pair(v.legs, LEGS_ITEMS, () => CLOTH_COLORS, "item")) return false;
  if (v.feet === null || !pair(v.feet, FEET_ITEMS, () => CLOTH_COLORS, "item")) return false;
  if (!pair(v.glasses, GLASSES_ITEMS, (i) => GLASSES_COLORS[i as GlassesItem], "item")) return false;
  if (!pair(v.hat, HAT_ITEMS, (i) => HAT_COLORS[i as HatItem], "item")) return false;
  return true;
}

// ── personagem padrão (migração implícita de quem nunca escolheu) ────────────
function pickBy<T>(list: readonly T[], hash: number): T {
  return list[hash % list.length];
}

/** Determinística: mesma seed → mesmo personagem. Sempre passa em isCharacterOptions. */
export function defaultCharacterFromSeed(seed: string): CharacterOptions {
  const h = characterHash(seed);
  const bodyType = pickBy(BODY_TYPES, h);
  return {
    bodyType,
    skinTone: pickBy(SKIN_TONES, h >>> 3),
    hair: { style: pickBy(HAIR_STYLES, h >>> 6), color: pickBy(HAIR_COLORS, h >>> 9) },
    beard: null,
    torso: { item: pickBy(TORSO_ITEMS, h >>> 12), color: pickBy(CLOTH_COLORS, h >>> 15) },
    legs: { item: pickBy(LEGS_ITEMS, h >>> 18), color: pickBy(CLOTH_COLORS, h >>> 21) },
    feet: { item: pickBy(FEET_ITEMS, h >>> 24), color: pickBy(CLOTH_COLORS, h >>> 27) },
    glasses: null,
    hat: null,
  };
}

// ── metadados de UI do editor (labels pt-BR, swatches aproximados) ───────────
export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  afro: "Afro", bangs: "Franja", bangslong: "Franja longa", bob: "Chanel",
  braid: "Trança", buzzcut: "Raspado", cornrows: "Tranças nagô",
  curly_long: "Cacheado longo", curly_short: "Cacheado curto",
  dreadlocks_short: "Dreads", plain: "Liso", ponytail: "Rabo de cavalo",
  spiked: "Espetado", twists_fade: "Twists",
};
export const BEARD_STYLE_LABELS: Record<BeardStyle, string> = {
  beard: "Barba cheia", bigstache: "Bigodão", french: "Barba francesa",
  horseshoe: "Ferradura", mustache: "Bigode",
};
export const TORSO_ITEM_LABELS: Record<TorsoItem, string> = {
  shortsleeve: "Camiseta", longsleeve: "Manga longa", sleeveless: "Regata",
};
export const LEGS_ITEM_LABELS: Record<LegsItem, string> = {
  pants: "Calça", pants2: "Calça social", shorts: "Bermuda",
  skirts_plain: "Saia", leggings: "Legging",
};
export const FEET_ITEM_LABELS: Record<FeetItem, string> = {
  shoes: "Sapato", boots: "Bota", sandals: "Sandália", slippers: "Chinelo",
};
export const GLASSES_ITEM_LABELS: Record<GlassesItem, string> = {
  glasses: "Óculos", round: "Redondos", nerd: "Nerd", sunglasses: "Escuros",
};
export const HAT_ITEM_LABELS: Record<HatItem, string> = {
  bandana: "Bandana", bowler: "Chapéu-coco", tophat: "Cartola",
};
export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  male: "Tipo 1", female: "Tipo 2",
};

/** Hex aproximado só para os botões de swatch — a cor real está no PNG. */
export const SKIN_TONE_SWATCHES: Record<SkinTone, string> = {
  light: "#f9d3ab", amber: "#e7b476", olive: "#c9a06a", taupe: "#b08e6a",
  bronze: "#a56f43", brown: "#8d5524", black: "#5a3a22",
};
export const HAIR_COLOR_SWATCHES: Record<HairColor, string> = {
  black: "#23201d", dark_brown: "#4b3625", light_brown: "#7a5836",
  chestnut: "#8b5a2b", blonde: "#d8b86a", ash: "#cbb7a0", ginger: "#b5502a",
  carrot: "#d2701e", dark_gray: "#6e6e6e", white: "#e8e8e8",
};
export const CLOTH_COLOR_SWATCHES: Record<ClothColor, string> = {
  black: "#26262b", blue: "#3d6db5", bluegray: "#6b7f99", brown: "#7a5230",
  charcoal: "#45454b", forest: "#2e5d34", gray: "#9a9a9a", green: "#3f8f3f",
  lavender: "#9a86c2", leather: "#a0703c", maroon: "#7c2b33", navy: "#2b3a67",
};
```

- [ ] **Step 4: Registrar o estilo e exportar**

Em `packages/shared/src/avatar.ts`, mude apenas (open-peeps continua até a Task 9):

```ts
export const OPEN_PEEPS_STYLE = "open-peeps" as const;
export const LPC_AVATAR_STYLE = "lpc" as const;

/** Every value the `avatarStyle` field may hold. */
export const ALL_AVATAR_STYLE_KEYS = [OPEN_PEEPS_STYLE, LPC_AVATAR_STYLE] as const;
```

E o `UpdateProfileRequest` (mesmo arquivo) passa a aceitar as duas formas durante a transição:

```ts
import type { CharacterOptions } from "./character";

/** Body for PATCH /auth/me. `null` clears the field. */
export interface UpdateProfileRequest {
  avatarStyle?: AvatarStyleKey | null;
  avatarSeed?: string | null;
  avatarOptions?: CharacterOptions | AvatarOptions | null;
}
```

Em `packages/shared/src/index.ts`, adicione `export * from "./character";` na posição alfabética junto aos demais barris.

- [ ] **Step 5: Rodar os testes do shared**

Run: `pnpm --filter @legends/shared test -- run`
Expected: PASS (novos + antigos)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/character.ts packages/shared/src/character.test.ts packages/shared/src/avatar.ts packages/shared/src/index.ts
git commit -m "feat(shared): catálogo do personagem LPC (CharacterOptions, camadas, default por seed)"
```

---

### Task 3: API — PATCH /auth/me aceita `lpc` e avisa o escritório

**Files:**
- Modify: `packages/shared/src/office.ts` (mensagem `avatar-updated`; occupant tipa `CharacterOptions`)
- Modify: `apps/api/src/lib/office-hub.ts` (`updateAvatar` no lugar de `updateSprite` — `updateSprite` FICA até a Task 8)
- Modify: `apps/api/src/routes/auth.ts` (schema novo, remove trigger de sprite, broadcast)
- Test: `apps/api/src/routes/auth.test.ts` (reescreve os 4 casos de avatar), `apps/api/src/lib/office-hub.test.ts` (novo caso)

**Interfaces:**
- Consumes: `LPC_STYLE`, `isCharacterOptions`, enums do catálogo (Task 2)
- Produces:
  - WS server message `{ type: 'avatar-updated'; userId: string; avatarSeed: string | null; avatarOptions: CharacterOptions | null }`
  - `officeHub.updateAvatar(userId, avatarSeed, avatarOptions): void` — atualiza occupant e faz broadcast
  - `PATCH /auth/me` aceita somente `avatarStyle: 'lpc'` para escrita de options

- [ ] **Step 1: Contrato no shared**

Em `packages/shared/src/office.ts`:

1. No import do topo, adicione `type CharacterOptions` de `"./character"`.
2. Em `OfficeOccupant`, troque o tipo do campo:

```ts
  /** Personagem LPC do perfil (CharacterOptions); legado open-peeps é ignorado pelo cliente via isCharacterOptions. */
  avatarOptions?: CharacterOptions | null;
```

3. Em `OfficeServerMessage`, adicione a variante (deixe `sprite-updated` no lugar até a Task 8):

```ts
  /** O avatar de alguém mudou — os clientes recompõem o personagem ao vivo. */
  | {
      type: "avatar-updated";
      userId: string;
      avatarSeed: string | null;
      avatarOptions: CharacterOptions | null;
    }
```

4. `officeColors` deixa de compilar (recebia `AvatarOptions` open-peeps). Troque a assinatura para aceitar o novo tipo mantendo o comportamento de fallback por id — implementação temporária até a remoção na Task 8:

```ts
export function officeColors(
  userId: string,
  options: CharacterOptions | null,
): { skinColor: string; clothingColor: string } {
  const hash = officeHash(userId);
  void options;
  return {
    skinColor: OPEN_PEEPS_SKIN_COLORS[hash % OPEN_PEEPS_SKIN_COLORS.length],
    clothingColor:
      OPEN_PEEPS_CLOTHING_COLORS[(hash >>> 8) % OPEN_PEEPS_CLOTHING_COLORS.length],
  };
}
```

(Os campos `skinColor`/`clothingColor` do occupant não têm nenhum consumidor no web — somem de vez na Task 8; aqui só mantemos compilando.)

5. `OfficeUser` em `apps/api/src/lib/office-hub.ts`: troque `avatarOptions: AvatarOptions | null` por `avatarOptions: CharacterOptions | null` (ajuste o import). Em `apps/api/src/routes/office-ws.ts`, troque o cast `as AvatarOptions | null` por `as CharacterOptions | null` (import de `@legends/shared`) — nas DUAS ocorrências (preValidation e backfill).
6. Atualize o teste de contrato `packages/shared/src/office.test.ts` se ele referenciar `AvatarOptions` em fixtures de occupant (rode e veja).

- [ ] **Step 2: Teste do hub (falha primeiro)**

Em `apps/api/src/lib/office-hub.test.ts`, adicione (siga o padrão dos testes existentes de `updateSprite`, que continuam passando):

```ts
it('updateAvatar atualiza o occupant e faz broadcast de avatar-updated', () => {
  const a = fakeSocket()
  const b = fakeSocket()
  hub.join(a, user('ana'))
  hub.join(b, user('bia'))
  a.sent.length = 0
  b.sent.length = 0

  const options = defaultCharacterFromSeed('ana-novo')
  hub.updateAvatar('ana', 'ana-novo', options)

  const msg = JSON.parse(b.sent[0]) as { type: string; userId: string; avatarSeed: string; avatarOptions: unknown }
  expect(msg.type).toBe('avatar-updated')
  expect(msg.userId).toBe('ana')
  expect(msg.avatarSeed).toBe('ana-novo')
  expect(msg.avatarOptions).toEqual(options)
  expect(hub.occupantOf('ana')?.avatarOptions).toEqual(options)
  expect(hub.occupantOf('ana')?.avatarSeed).toBe('ana-novo')
})

it('updateAvatar é no-op para quem não está no escritório', () => {
  expect(() => hub.updateAvatar('ninguem', null, null)).not.toThrow()
})
```

(Adapte `fakeSocket()`/`user()` aos helpers reais do arquivo; importe `defaultCharacterFromSeed` de `@legends/shared`.)

Run: `pnpm --filter @legends/api test -- run office-hub`
Expected: FAIL (`updateAvatar` não existe)

- [ ] **Step 3: Implementar `updateAvatar` no hub**

Em `apps/api/src/lib/office-hub.ts`, logo após `updateSprite`:

```ts
  /**
   * O avatar de um usuário mudou (PATCH /auth/me): atualiza o occupant e avisa
   * todo mundo (inclusive o próprio) — o personagem troca ao vivo, sem reentrar.
   * No-op se a pessoa não está no escritório.
   */
  updateAvatar(userId: string, avatarSeed: string | null, avatarOptions: CharacterOptions | null): void {
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.occupant.avatarSeed = avatarSeed
    entry.occupant.avatarOptions = avatarOptions
    this.broadcast({ type: 'avatar-updated', userId, avatarSeed, avatarOptions })
  }
```

Run: `pnpm --filter @legends/api test -- run office-hub` → PASS

- [ ] **Step 4: Testes da rota (reescrever os casos de avatar)**

Em `apps/api/src/routes/auth.test.ts`, localize os casos existentes: `payload: { avatarStyle: 'avataaars', ... }` (linha ~142), `'saves open-peeps custom options...'` (~159), `'rejects open-peeps options with an unknown variant (400)'` (~196) e `'rejects open-peeps without options (400)'` (~227). Substitua os três de open-peeps por (mesmo estilo de setup/inject dos atuais):

```ts
it('saves lpc character options via PATCH /auth/me', async () => {
  const options = defaultCharacterFromSeed('felix')
  const res = await app.inject({
    method: 'PATCH',
    url: '/auth/me',
    headers: authHeader,
    payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: options },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().user.avatarStyle).toBe('lpc')
  expect(res.json().user.avatarOptions).toEqual(options)
})

it('rejects lpc options with an unknown item (400)', async () => {
  const options = { ...defaultCharacterFromSeed('felix'), torso: { item: 'jaqueta-inventada', color: 'blue' } }
  const res = await app.inject({
    method: 'PATCH',
    url: '/auth/me',
    headers: authHeader,
    payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: options },
  })
  expect(res.statusCode).toBe(400)
})

it('rejects lpc options with a color outside the item palette (400)', async () => {
  const options = { ...defaultCharacterFromSeed('felix'), hat: { item: 'bowler', color: 'lavender' } }
  const res = await app.inject({
    method: 'PATCH',
    url: '/auth/me',
    headers: authHeader,
    payload: { avatarStyle: 'lpc', avatarSeed: 'felix', avatarOptions: options },
  })
  expect(res.statusCode).toBe(400)
})

it('rejects lpc without options (400)', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/auth/me',
    headers: authHeader,
    payload: { avatarStyle: 'lpc', avatarSeed: 'felix' },
  })
  expect(res.statusCode).toBe(400)
})

it('rejects open-peeps writes after the migration (400)', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/auth/me',
    headers: authHeader,
    payload: { avatarStyle: 'open-peeps', avatarSeed: 'x', avatarOptions: null },
  })
  expect(res.statusCode).toBe(400)
})
```

(O caso `avataaars` existente já espera 400 — mantenha.) Importe `defaultCharacterFromSeed` de `@legends/shared`; adapte `authHeader` ao helper real do arquivo.

Run: `pnpm --filter @legends/api test -- run routes/auth` → FAIL

- [ ] **Step 5: Reescrever o bloco de avatar da rota**

Em `apps/api/src/routes/auth.ts`:

1. Troque o bloco de imports do shared por:

```ts
import { LPC_STYLE, isCharacterOptions, type CharacterOptions } from '@legends/shared'
```

(Remova `ALL_AVATAR_STYLE_KEYS`, todos os `OPEN_PEEPS_*` e `AvatarOptions`; remova `import { ensureOfficeSprite } ...`.)

2. Delete `avatarOptionsSchema` (o zod de open-peeps, linhas ~67-76) e troque `updateMeSchema` por:

```ts
const characterOptionsSchema = z.custom<CharacterOptions>(isCharacterOptions, {
  message: 'Personagem inválido',
})

const updateMeSchema = z.object({
  avatarStyle: z.literal(LPC_STYLE).nullable().optional(),
  avatarSeed: z.string().min(1).max(64).nullable().optional(),
  avatarOptions: characterOptionsSchema.nullable().optional(),
})
```

3. No handler do PATCH, troque o miolo (linhas ~187-218) por:

```ts
    const { avatarStyle, avatarSeed, avatarOptions } = parsed.data
    const data: Prisma.UserUpdateInput = {}
    if (avatarStyle !== undefined) data.avatarStyle = avatarStyle
    if (avatarSeed !== undefined) data.avatarSeed = avatarSeed

    if (avatarStyle === LPC_STYLE) {
      if (!avatarOptions) {
        return reply.code(400).send({ message: 'Dados inválidos' })
      }
      data.avatarOptions = avatarOptions as Prisma.InputJsonValue
    } else if (avatarStyle !== undefined) {
      // limpou o estilo: limpa as escolhas junto
      data.avatarOptions = Prisma.DbNull
    } else if (avatarOptions !== undefined) {
      data.avatarOptions =
        avatarOptions === null ? Prisma.DbNull : (avatarOptions as Prisma.InputJsonValue)
    }

    const user = await prisma.user.update({ where: { id: request.user.sub }, data })

    // Se a pessoa está no escritório, o personagem troca ao vivo.
    if (data.avatarSeed !== undefined || data.avatarOptions !== undefined) {
      const options = (user.avatarOptions as CharacterOptions | null) ?? null
      officeHub.updateAvatar(user.id, user.avatarSeed ?? null, isCharacterOptions(options) ? options : null)
    }

    return reply.send({ user: toPublicUser(user) })
```

- [ ] **Step 6: Rodar testes da API**

Run: `pnpm db:up && pnpm --filter @legends/api test -- run`
Expected: PASS geral, EXCETO possivelmente `office-ws.test.ts`/`office-sprite-service.test.ts` se referirem tipos alterados — se falharem por tipo do `avatarOptions` em fixtures, ajuste o fixture para `defaultCharacterFromSeed('x')` ou `null` (a remoção de verdade vem nas Tasks 8).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/office.ts apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts apps/api/src/routes/auth.ts apps/api/src/routes/auth.test.ts apps/api/src/routes/office-ws.ts packages/shared/src/office.test.ts
git commit -m "feat(api): PATCH /auth/me salva personagem lpc e faz broadcast de avatar-updated"
```

---

### Task 4: Web — composição do personagem em canvas (`lib/character.ts`)

**Files:**
- Create: `apps/web/src/lib/character.ts`
- Test: `apps/web/src/lib/character.test.ts`

**Interfaces:**
- Consumes: `characterLayers`, `characterSignature`, constantes de geometria (Task 2); PNGs de `/lpc/` (Task 1)
- Produces:
  - `characterAssetUrl(path: string): string` — `/lpc/<path>`
  - `composeCharacterSheet(options, deps?): Promise<HTMLCanvasElement>` — sheet 576×256 composto, cache por assinatura
  - `characterSheetDataUri(options): Promise<string>`
  - `characterPortraitDataUri(options): Promise<string>` — retrato 128×128 (cabeça do frame frontal parado), cache
  - `CHARACTER_PORTRAIT_CROP` — retângulo do recorte (ajustável em um lugar só)

- [ ] **Step 1: Testes (falham primeiro)**

`apps/web/src/lib/character.test.ts` — jsdom não desenha canvas, então `deps` injetáveis são o contrato do teste:

```ts
import { describe, expect, it, vi } from 'vitest'
import { defaultCharacterFromSeed } from '@legends/shared'
import {
  characterAssetUrl,
  composeCharacterSheet,
  characterPortraitDataUri,
  __clearCharacterCaches,
} from './character'

function fakeDeps() {
  const drawn: { src: string; args: number[] }[] = []
  const ctx = {
    imageSmoothingEnabled: true,
    clearRect: vi.fn(),
    drawImage: vi.fn((img: { src: string }, ...args: number[]) => drawn.push({ src: img.src, args })),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,fake',
  } as unknown as HTMLCanvasElement
  return {
    drawn,
    deps: {
      createCanvas: () => canvas,
      loadImage: (src: string) => Promise.resolve({ src } as HTMLImageElement),
    },
  }
}

describe('characterAssetUrl', () => {
  it('prefixa /lpc/', () => {
    expect(characterAssetUrl('body/male/light.png')).toBe('/lpc/body/male/light.png')
  })
})

describe('composeCharacterSheet', () => {
  it('desenha as camadas na ordem de zPos', async () => {
    __clearCharacterCaches()
    const { drawn, deps } = fakeDeps()
    const options = { ...defaultCharacterFromSeed('ana'), feet: { item: 'boots', color: 'brown' } as const }
    await composeCharacterSheet(options, deps)
    const srcs = drawn.map((d) => d.src)
    expect(srcs[0]).toContain('/lpc/body/')
    expect(srcs.indexOf(srcs.find((s) => s.includes('/feet/'))!)).toBeGreaterThan(
      srcs.indexOf(srcs.find((s) => s.includes('/legs/'))!),
    ) // boots por cima da calça
    expect(srcs.at(-1)).toContain('/hair/') // sem chapéu: cabelo é a última camada
  })

  it('cacheia por assinatura das options', async () => {
    __clearCharacterCaches()
    const { deps } = fakeDeps()
    const loadSpy = vi.spyOn(deps, 'loadImage')
    const options = defaultCharacterFromSeed('ana')
    const first = await composeCharacterSheet(options, deps)
    const second = await composeCharacterSheet({ ...options }, deps)
    expect(second).toBe(first)
    expect(loadSpy).toHaveBeenCalledTimes(5) // body, legs, feet, torso, head, (hair) — default tem hair: 6
  })
})

describe('characterPortraitDataUri', () => {
  it('recorta a cabeça do frame frontal parado', async () => {
    __clearCharacterCaches()
    const { drawn, deps } = fakeDeps()
    await characterPortraitDataUri(defaultCharacterFromSeed('ana'), deps)
    const portraitDraw = drawn.at(-1)!
    // sy dentro da linha "down" (y 128..191) do sheet composto
    expect(portraitDraw.args[1]).toBeGreaterThanOrEqual(128)
    expect(portraitDraw.args[1]).toBeLessThan(192)
  })
})
```

(Ajuste o número exato do `toHaveBeenCalledTimes` ao rodar: default tem hair ⇒ 6 camadas.)

Run: `pnpm --filter @legends/web test -- run lib/character`
Expected: FAIL (módulo não existe)

- [ ] **Step 2: Implementar `apps/web/src/lib/character.ts`**

```ts
import {
  CHARACTER_FRAME_SIZE,
  CHARACTER_ROW_BY_DIRECTION,
  CHARACTER_SHEET_HEIGHT,
  CHARACTER_SHEET_WIDTH,
  characterLayers,
  characterSignature,
  type CharacterOptions,
} from '@legends/shared'

/** Onde os PNGs curados vivem (ver scripts/vendor-lpc.mjs). */
export function characterAssetUrl(path: string): string {
  return `/lpc/${path}`
}

/** Recorte do retrato: cabeça do frame frontal parado (linha down, col 0). */
export const CHARACTER_PORTRAIT_CROP = {
  x: 16,
  y: CHARACTER_ROW_BY_DIRECTION.down * CHARACTER_FRAME_SIZE + 4,
  size: 32,
  scale: 4, // 32px * 4 = retrato 128×128
} as const

export interface CharacterRenderDeps {
  createCanvas: () => HTMLCanvasElement
  loadImage: (src: string) => Promise<HTMLImageElement>
}

const defaultDeps: CharacterRenderDeps = {
  createCanvas: () => document.createElement('canvas'),
  loadImage: (src) =>
    new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`falha ao carregar ${src}`))
      img.src = src
    }),
}

// Cache por assinatura das options: composição é derivada e determinística.
const sheetCache = new Map<string, Promise<HTMLCanvasElement>>()
const portraitCache = new Map<string, Promise<string>>()

/** Só para testes. */
export function __clearCharacterCaches(): void {
  sheetCache.clear()
  portraitCache.clear()
}

/**
 * Compõe o spritesheet do personagem (576×256, 9 frames × 4 direções):
 * desenha cada camada LPC em ordem de zPos num canvas. Cacheado por opções.
 */
export function composeCharacterSheet(
  options: CharacterOptions,
  deps: CharacterRenderDeps = defaultDeps,
): Promise<HTMLCanvasElement> {
  const key = characterSignature(options)
  const cached = sheetCache.get(key)
  if (cached) return cached

  const promise = (async () => {
    const layers = characterLayers(options)
    const images = await Promise.all(layers.map((l) => deps.loadImage(characterAssetUrl(l.path))))
    const canvas = deps.createCanvas()
    canvas.width = CHARACTER_SHEET_WIDTH
    canvas.height = CHARACTER_SHEET_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d indisponível')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const img of images) ctx.drawImage(img, 0, 0)
    return canvas
  })()
  // Falha (404 de camada, etc.): não envenena o cache — a próxima chamada tenta de novo.
  promise.catch(() => sheetCache.delete(key))
  sheetCache.set(key, promise)
  return promise
}

export async function characterSheetDataUri(
  options: CharacterOptions,
  deps: CharacterRenderDeps = defaultDeps,
): Promise<string> {
  const sheet = await composeCharacterSheet(options, deps)
  return sheet.toDataURL('image/png')
}

/** Retrato 128×128: recorte da cabeça, nearest-neighbor (pixel-art). */
export function characterPortraitDataUri(
  options: CharacterOptions,
  deps: CharacterRenderDeps = defaultDeps,
): Promise<string> {
  const key = characterSignature(options)
  const cached = portraitCache.get(key)
  if (cached) return cached

  const promise = (async () => {
    const sheet = await composeCharacterSheet(options, deps)
    const { x, y, size, scale } = CHARACTER_PORTRAIT_CROP
    const canvas = deps.createCanvas()
    canvas.width = size * scale
    canvas.height = size * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d indisponível')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(sheet, x, y, size, size, 0, 0, size * scale, size * scale)
    return canvas.toDataURL('image/png')
  })()
  promise.catch(() => portraitCache.delete(key))
  portraitCache.set(key, promise)
  return promise
}
```

- [ ] **Step 3: Rodar e ajustar o teste**

Run: `pnpm --filter @legends/web test -- run lib/character`
Expected: PASS (corrija o `toHaveBeenCalledTimes` para o valor real de camadas do default: 6 com cabelo)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/character.ts apps/web/src/lib/character.test.ts
git commit -m "feat(web): composição do personagem LPC em canvas (sheet + retrato, com cache)"
```

---

### Task 5: Web — `Avatar.tsx` com retrato LPC e `MoodOfDay` com emojis

**Files:**
- Create: `apps/web/src/hooks/useCharacterPortrait.ts`
- Modify: `apps/web/src/components/Avatar.tsx`
- Modify: `apps/web/src/pages/profile/MoodOfDay.tsx`
- Test: `apps/web/src/components/Avatar.test.tsx`, teste de MoodOfDay se existir (`apps/web/src/pages/profile/MoodOfDay.test.tsx` — verifique)

**Interfaces:**
- Consumes: `characterPortraitDataUri` (Task 4), `isCharacterOptions`, `defaultCharacterFromSeed`, `LPC_STYLE` (Task 2)
- Produces:
  - `useCharacterPortrait(source: AvatarSource): string | null` — data URI do retrato ou null enquanto compõe
  - Resolução do `Avatar`: personagem (lpc salvo, OU legado open-peeps ⇒ default da seed) → `photoUrl` → iniciais

- [ ] **Step 1: Atualizar os testes do Avatar (falham primeiro)**

Em `apps/web/src/components/Avatar.test.tsx`, mocke a lib e cubra a nova cadeia (substitua os mocks de dicebear existentes):

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultCharacterFromSeed } from '@legends/shared'
import { Avatar } from './Avatar'

vi.mock('../lib/character', () => ({
  characterPortraitDataUri: vi.fn(() => Promise.resolve('data:image/png;base64,retrato')),
}))

describe('Avatar', () => {
  it('renderiza o retrato quando avatarStyle é lpc', async () => {
    render(
      <Avatar
        user={{
          name: 'Ana Souza',
          avatarStyle: 'lpc',
          avatarSeed: 'ana',
          avatarOptions: defaultCharacterFromSeed('ana'),
        }}
      />,
    )
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,retrato'))
  })

  it('legado open-peeps ganha o personagem padrão da seed', async () => {
    render(<Avatar user={{ name: 'Ana', avatarStyle: 'open-peeps', avatarSeed: 'ana', avatarOptions: null }} />)
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument())
  })

  it('sem estilo cai para photoUrl', () => {
    render(<Avatar user={{ name: 'Ana', photoUrl: 'https://x/foto.jpg' }} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/foto.jpg')
  })

  it('sem nada cai para iniciais', () => {
    render(<Avatar user={{ name: 'Ana Souza' }} />)
    expect(screen.getByText('AS')).toBeInTheDocument()
  })
})
```

Run: `pnpm --filter @legends/web test -- run components/Avatar` → FAIL

- [ ] **Step 2: Hook `useCharacterPortrait`**

`apps/web/src/hooks/useCharacterPortrait.ts`:

```ts
import { useEffect, useMemo, useState } from 'react'
import {
  defaultCharacterFromSeed,
  isCharacterOptions,
  characterSignature,
  type CharacterOptions,
} from '@legends/shared'
import { characterPortraitDataUri } from '../lib/character'

export interface CharacterSource {
  name: string
  avatarStyle?: string | null
  avatarSeed?: string | null
  avatarOptions?: unknown
}

/**
 * Resolve as options do personagem de alguém: lpc salvo usa as escolhas;
 * legado open-peeps (que tinha avatar gerado) vira o personagem padrão da
 * seed; sem estilo nenhum retorna null (Avatar cai para foto/iniciais).
 */
export function resolveCharacterOptions(source: CharacterSource): CharacterOptions | null {
  if (source.avatarStyle === 'lpc' && isCharacterOptions(source.avatarOptions)) {
    return source.avatarOptions
  }
  if (source.avatarStyle === 'open-peeps') {
    return defaultCharacterFromSeed(source.avatarSeed ?? source.name)
  }
  return null
}

/** Data URI do retrato (128×128) ou null enquanto compõe / sem personagem. */
export function useCharacterPortrait(source: CharacterSource): string | null {
  const options = useMemo(() => resolveCharacterOptions(source), [
    source.avatarStyle,
    source.avatarSeed,
    source.avatarOptions,
    source.name,
  ])
  const key = options ? characterSignature(options) : null
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    if (!options) {
      setUri(null)
      return
    }
    let alive = true
    characterPortraitDataUri(options)
      .then((u) => alive && setUri(u))
      .catch(() => alive && setUri(null)) // 404 de camada: cai para foto/iniciais
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return uri
}
```

- [ ] **Step 3: Reescrever `Avatar.tsx`**

```tsx
import { useCharacterPortrait, type CharacterSource } from '../hooks/useCharacterPortrait'

export interface AvatarSource extends CharacterSource {
  photoUrl?: string | null
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
}

/**
 * Inner avatar content (image or initials). Callers provide their own wrapper
 * element for sizing/borders. Resolução: personagem LPC → photoUrl → iniciais.
 */
export function Avatar({
  user,
  initialsClassName = 'font-label text-label-sm font-bold text-primary',
  imgClassName = '',
}: {
  user: AvatarSource
  initialsClassName?: string
  imgClassName?: string
}) {
  const portrait = useCharacterPortrait(user)
  const src = portrait ?? user.photoUrl ?? null

  if (src) {
    return <img src={src} alt={user.name} className={`h-full w-full object-cover ${imgClassName}`.trim()} />
  }
  return <span className={initialsClassName}>{initials(user.name)}</span>
}
```

Nota: enquanto o retrato compõe (1º render), quem tem `photoUrl` mostra a foto e troca — aceitável; quem não tem mostra iniciais por um instante.

- [ ] **Step 4: MoodOfDay com emojis**

Em `apps/web/src/pages/profile/MoodOfDay.tsx`:

1. Remova os imports de `AvatarOptions`, `DEFAULT_OPEN_PEEPS_OPTIONS` e `customAvatarDataUri`; remova `MOOD_FACE` e o `useMemo` de `faces`.
2. Adicione o mapa de emojis e simplifique o corpo (o componente não precisa mais do prop `user` — remova o prop e ajuste o call site em `ProfilePage.tsx`):

```tsx
// Cada humor é um emoji fixo — o seletor não altera o avatar salvo.
const MOOD_EMOJI: Record<MoodLevel, string> = {
  HARD: "😞",
  LOW: "🙁",
  NEUTRAL: "😐",
  GOOD: "🙂",
  GREAT: "😄",
};
```

3. No JSX, troque o `<img src={option.src} …/>` (e o span do círculo) pelo emoji, mantendo layout/aria:

```tsx
<button
  type="button"
  aria-label={option.label}
  aria-pressed={active}
  disabled={setMood.isPending}
  onClick={() => setSelected(option.value)}
  className={`flex h-20 w-20 items-center justify-center rounded-full text-5xl transition-all disabled:opacity-50 md:h-24 md:w-24 md:text-6xl ${
    active ? "ring-2 ring-primary bg-surface-container-highest" : "opacity-60 hover:opacity-100"
  }`}
>
  <span aria-hidden>{MOOD_EMOJI[option.value]}</span>
</button>
```

4. `faces.map` vira `MOOD_OPTIONS.map((option) => …)`.
5. Se existir `MoodOfDay.test.tsx`, atualize os asserts de `<img>` para os emojis/aria-labels.

- [ ] **Step 5: Rodar testes do web**

Run: `pnpm --filter @legends/web test -- run`
Expected: PASS nos arquivos tocados; anote (sem corrigir ainda) falhas de arquivos que só a Task 9 limpa — não deve haver: `lib/avatar.ts` continua existindo até lá.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useCharacterPortrait.ts apps/web/src/components/Avatar.tsx apps/web/src/components/Avatar.test.tsx apps/web/src/pages/profile/MoodOfDay.tsx apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(web): retrato do personagem LPC no Avatar e humor do dia com emojis"
```

---

### Task 6: Web — editor de personagem (AvatarPicker) + créditos

**Files:**
- Create: `apps/web/src/components/CharacterPreview.tsx`
- Rewrite: `apps/web/src/components/AvatarPicker.tsx` (mesmo nome — ProfilePage não muda)
- Test: `apps/web/src/components/AvatarPicker.test.tsx`

**Interfaces:**
- Consumes: catálogo + labels + swatches (Task 2), `characterSheetDataUri`/`characterPortraitDataUri` (Task 4), `apiFetch`, `useAuth`
- Produces: `PATCH /auth/me` com `{ avatarStyle: 'lpc', avatarSeed, avatarOptions: CharacterOptions }`; link para `/lpc/CREDITS.txt`

- [ ] **Step 1: Reescrever os testes do picker (falham primeiro)**

`apps/web/src/components/AvatarPicker.test.tsx` — siga a estrutura de mocks do arquivo atual (AuthContext, apiFetch, react-query wrapper), trocando os asserts:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AvatarPicker } from './AvatarPicker'

vi.mock('../lib/character', () => ({
  characterSheetDataUri: vi.fn(() => Promise.resolve('data:image/png;base64,sheet')),
  characterPortraitDataUri: vi.fn(() => Promise.resolve('data:image/png;base64,retrato')),
  characterAssetUrl: (p: string) => `/lpc/${p}`,
}))

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', () => ({ apiFetch, ApiError: class extends Error {} }))
// ... mock de useAuth como no arquivo atual (user com avatarSeed 'ana', setUser espião)

describe('AvatarPicker (editor LPC)', () => {
  beforeEach(() => apiFetch.mockReset())

  it('mostra os dois modos e abas de categoria no Personalizar', () => {
    render(<AvatarPicker onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Personalizar' }))
    for (const aba of ['Corpo', 'Cabelo', 'Barba', 'Camisa', 'Calça', 'Sapatos', 'Óculos', 'Chapéu']) {
      expect(screen.getByRole('button', { name: aba })).toBeInTheDocument()
    }
  })

  it('salva com avatarStyle lpc e options válidas', async () => {
    apiFetch.mockResolvedValue({ user: { id: 'u1' } })
    render(<AvatarPicker onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Personalizar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const body = JSON.parse((apiFetch.mock.calls[0][1] as { body: string }).body)
    expect(body.avatarStyle).toBe('lpc')
    expect(body.avatarOptions.bodyType).toBeDefined()
    expect(body.avatarOptions.torso).toBeDefined()
  })

  it('exige seleção no modo Prontos antes de salvar', async () => {
    render(<AvatarPicker onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Escolha um personagem antes de salvar.')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('linka os créditos da arte LPC', () => {
    render(<AvatarPicker onClose={() => {}} />)
    const link = screen.getByRole('link', { name: /créditos/i })
    expect(link).toHaveAttribute('href', '/lpc/CREDITS.txt')
  })
})
```

Run: `pnpm --filter @legends/web test -- run AvatarPicker` → FAIL

- [ ] **Step 2: `CharacterPreview.tsx` (preview animado)**

```tsx
import { useEffect, useRef, useState } from 'react'
import {
  CHARACTER_FRAME_SIZE,
  characterIdleFrame,
  characterWalkFrames,
  characterSignature,
  type CharacterOptions,
} from '@legends/shared'
import { composeCharacterSheet } from '../lib/character'

const DIRECTIONS = ['down', 'left', 'up', 'right'] as const
type PreviewDirection = (typeof DIRECTIONS)[number]
const WALK_FPS = 8

/**
 * Personagem de corpo inteiro tocando o walk cycle num <canvas>, com botão
 * para girar a direção — mostra exatamente o que anda no escritório.
 */
export function CharacterPreview({ options, size = 160 }: { options: CharacterOptions; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dirIndex, setDirIndex] = useState(0)
  const dir: PreviewDirection = DIRECTIONS[dirIndex]

  useEffect(() => {
    let alive = true
    let raf = 0
    void composeCharacterSheet(options).then((sheet) => {
      if (!alive) return
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.imageSmoothingEnabled = false
      const frames = [characterIdleFrame(dir), ...characterWalkFrames(dir)]
      const start = performance.now()
      const draw = (now: number) => {
        const step = Math.floor(((now - start) / 1000) * WALK_FPS)
        const frame = frames[1 + (step % (frames.length - 1))] // anima só os frames de passo
        const sx = (frame % 9) * CHARACTER_FRAME_SIZE
        const sy = Math.floor(frame / 9) * CHARACTER_FRAME_SIZE
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(sheet, sx, sy, CHARACTER_FRAME_SIZE, CHARACTER_FRAME_SIZE, 0, 0, canvas.width, canvas.height)
        raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [characterSignature(options), dir])

  return (
    <div className="flex flex-col items-center gap-sm">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ imageRendering: 'pixelated' }}
        className="rounded-lg bg-surface-container-highest"
        aria-label="Prévia do personagem"
      />
      <button
        type="button"
        onClick={() => setDirIndex((i) => (i + 1) % DIRECTIONS.length)}
        className="rounded-md border border-outline-variant/50 px-md py-xs font-label text-label-sm text-on-surface hover:border-primary"
      >
        Girar
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Reescrever `AvatarPicker.tsx`**

Mesma casca de modal/modos do arquivo atual (dialog, toggle Prontos/Personalizar, Cancelar/Salvar, tratamento de erro). Substitua todo o miolo open-peeps:

```tsx
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BODY_TYPES,
  BODY_TYPE_LABELS,
  BEARD_STYLES,
  BEARD_STYLE_LABELS,
  CLOTH_COLORS,
  CLOTH_COLOR_SWATCHES,
  FEET_ITEMS,
  FEET_ITEM_LABELS,
  GLASSES_COLORS,
  GLASSES_ITEMS,
  GLASSES_ITEM_LABELS,
  HAIR_COLORS,
  HAIR_COLOR_SWATCHES,
  HAIR_STYLES,
  HAIR_STYLE_LABELS,
  HAT_COLORS,
  HAT_ITEMS,
  HAT_ITEM_LABELS,
  LEGS_ITEMS,
  LEGS_ITEM_LABELS,
  SKIN_TONES,
  SKIN_TONE_SWATCHES,
  TORSO_ITEMS,
  TORSO_ITEM_LABELS,
  defaultCharacterFromSeed,
  type CharacterOptions,
  type PublicUser,
} from '@legends/shared'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { characterPortraitDataUri } from '../lib/character'
import { resolveCharacterOptions } from '../hooks/useCharacterPortrait'
import { CharacterPreview } from './CharacterPreview'
import { Icon } from './Icon'

type Mode = 'ready' | 'custom'
type Tab = 'body' | 'hair' | 'beard' | 'torso' | 'legs' | 'feet' | 'glasses' | 'hat'

const TABS: { key: Tab; label: string }[] = [
  { key: 'body', label: 'Corpo' },
  { key: 'hair', label: 'Cabelo' },
  { key: 'beard', label: 'Barba' },
  { key: 'torso', label: 'Camisa' },
  { key: 'legs', label: 'Calça' },
  { key: 'feet', label: 'Sapatos' },
  { key: 'glasses', label: 'Óculos' },
  { key: 'hat', label: 'Chapéu' },
]

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Personagem aleatório: base determinística da seed + acessórios sorteados. */
function randomCharacter(): CharacterOptions {
  const base = defaultCharacterFromSeed(randomSeed())
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]
  return {
    ...base,
    beard: base.bodyType === 'male' && Math.random() < 0.3
      ? { style: pick(BEARD_STYLES), color: base.hair?.color ?? 'black' }
      : null,
    glasses: Math.random() < 0.2
      ? { item: pick(GLASSES_ITEMS), color: 'black' }
      : null,
    hat: Math.random() < 0.1
      ? { item: pick(HAT_ITEMS), color: pick(HAT_COLORS[pick(HAT_ITEMS)] as readonly string[]) }
      : null,
  }
}
```

Estado e save:

```tsx
export function AvatarPicker({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuth()
  const queryClient = useQueryClient()

  const initial = useMemo(
    () => (user ? resolveCharacterOptions(user) : null) ?? defaultCharacterFromSeed(user?.avatarSeed ?? 'preview'),
    [user],
  )
  const [mode, setMode] = useState<Mode>('custom')
  const [tab, setTab] = useState<Tab>('body')
  const [options, setOptions] = useState<CharacterOptions>(initial)

  const [sets, setSets] = useState<CharacterOptions[]>(() => Array.from({ length: 12 }, randomCharacter))
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const chosen = mode === 'ready' ? (selectedIdx !== null ? sets[selectedIdx] : null) : options
    if (!chosen) {
      setError('Escolha um personagem antes de salvar.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch<{ user: PublicUser }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          avatarStyle: 'lpc' as const,
          avatarSeed: user?.avatarSeed ?? randomSeed(),
          avatarOptions: chosen,
        }),
      })
      setUser(res.user)
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }
  // ... JSX
}
```

JSX do modo **Prontos**: grid 4×3 como hoje, mas cada célula usa um componente `PortraitImg` local que resolve `characterPortraitDataUri(set)` num `useEffect` (mesmo padrão do hook; pode reusar `useCharacterPortrait` passando `{ name: 'preview', avatarStyle: 'lpc', avatarOptions: set }`) + botão Embaralhar que refaz `sets`.

JSX do modo **Personalizar**:
- `<CharacterPreview options={options} />` no topo.
- Barra de abas (botões com `TABS`, estado `tab`).
- Conteúdo por aba — todos seguem dois blocos reutilizáveis no arquivo:

```tsx
function CycleRow({ label, value, display, onPrev, onNext }: {
  label: string; value: string | null; display: string
  onPrev: () => void; onNext: () => void
}) { /* mesma linha de setas do editor atual (chevron_left / valor / chevron_right) */ }

function SwatchRow({ label, palette, value, onPick }: {
  label: string; palette: readonly { id: string; hex: string }[]
  value: string | null; onPick: (id: string) => void
}) { /* mesma linha de bolinhas de cor do editor atual */ }
```

  - **Corpo**: `CycleRow` de `bodyType` (labels `BODY_TYPE_LABELS`) + `SwatchRow` de `skinTone` com `SKIN_TONE_SWATCHES`.
  - **Cabelo**: `CycleRow` sobre `[null, ...HAIR_STYLES]` (null = "Nenhum", labels `HAIR_STYLE_LABELS`) + `SwatchRow` `HAIR_COLOR_SWATCHES` (visível só com estilo escolhido). Ao escolher estilo com hair null, use cor `'black'`.
  - **Barba**: idem cabelo com `BEARD_STYLES`/`BEARD_STYLE_LABELS`, cores de cabelo.
  - **Camisa / Calça / Sapatos**: `CycleRow` (sem "nenhum") + `SwatchRow` com `CLOTH_COLORS`/`CLOTH_COLOR_SWATCHES`.
  - **Óculos / Chapéu**: `CycleRow` com "Nenhum" + `SwatchRow` com as cores DO item (`GLASSES_COLORS[item]` / `HAT_COLORS[item]`, hex de `CLOTH_COLOR_SWATCHES` com fallback `#888` para `red`/`white`: adicione um mapa local `EXTRA_SWATCHES = { red: '#c0392b', white: '#f4f4f4' }`). Ao trocar de item, se a cor atual não existe na paleta do novo item, troque para a primeira.
- Botão "Aleatório" (`setOptions(randomCharacter())`).
- Rodapé com o link de créditos (sempre visível, nos dois modos):

```tsx
<a
  href="/lpc/CREDITS.txt"
  target="_blank"
  rel="noreferrer"
  className="font-label text-label-sm text-on-surface-variant underline hover:text-primary"
>
  Arte: Liberated Pixel Cup — créditos
</a>
```

- Título do modal: "Escolher personagem"; mensagem de erro de seleção: `'Escolha um personagem antes de salvar.'`.

- [ ] **Step 4: Rodar os testes**

Run: `pnpm --filter @legends/web test -- run AvatarPicker`
Expected: PASS

- [ ] **Step 5: Smoke manual no browser**

`pnpm dev` → perfil → "Escolher personagem": abas funcionam, preview anda e gira, Prontos embaralha, salvar persiste (recarregue e confira o retrato no header/perfil).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AvatarPicker.tsx apps/web/src/components/AvatarPicker.test.tsx apps/web/src/components/CharacterPreview.tsx
git commit -m "feat(web): editor de personagem LPC com preview animado e créditos"
```

---

### Task 7: Web — escritório com walk cycle e troca ao vivo

**Files:**
- Rewrite: `apps/web/src/office/officeAvatar.ts`
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`
- Modify: `apps/web/src/office/OfficeBridge.ts`
- Test: `apps/web/src/office/officeAvatar.test.ts`, `apps/web/src/office/OfficeBridge.test.ts`

**Interfaces:**
- Consumes: `composeCharacterSheet` (Task 4), `resolveCharacterOptions`-like p/ occupant, `characterSignature`, `characterIdleFrame`/`characterWalkFrames`, mensagem `avatar-updated` (Task 3)
- Produces:
  - `occupantCharacterOptions(occupant): CharacterOptions` — NUNCA null (default por `avatarSeed ?? userId`)
  - `occupantTextureKey(occupant): string` — `char-<userId>-<hash da assinatura>`
  - Personagem no mapa: sprite Phaser 64×64 exibido a 48px, anims `walk-{dir}`, idle = frame parado

- [ ] **Step 1: Reescrever `officeAvatar.ts` + teste (falha primeiro)**

`apps/web/src/office/officeAvatar.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defaultCharacterFromSeed, isCharacterOptions } from '@legends/shared'
import { occupantCharacterOptions, occupantTextureKey } from './officeAvatar'

const base = { userId: 'u1', avatarStyle: null, avatarSeed: null, avatarOptions: null }

describe('occupantCharacterOptions', () => {
  it('usa as options lpc quando válidas', () => {
    const options = defaultCharacterFromSeed('x')
    expect(occupantCharacterOptions({ ...base, avatarStyle: 'lpc', avatarOptions: options })).toEqual(options)
  })
  it('deriva da seed quando não há personagem salvo (ninguém fica sem boneco)', () => {
    const derived = occupantCharacterOptions({ ...base, avatarSeed: 'ana' })
    expect(isCharacterOptions(derived)).toBe(true)
    expect(derived).toEqual(defaultCharacterFromSeed('ana'))
  })
  it('ignora avatarOptions legado (open-peeps) e cai para a seed', () => {
    const legacy = { head: 'short1', face: 'smile' }
    expect(occupantCharacterOptions({ ...base, avatarStyle: 'open-peeps', avatarOptions: legacy as never, avatarSeed: 'ana' }))
      .toEqual(defaultCharacterFromSeed('ana'))
  })
  it('cai para o userId sem seed', () => {
    expect(occupantCharacterOptions(base)).toEqual(defaultCharacterFromSeed('u1'))
  })
})

describe('occupantTextureKey', () => {
  it('muda quando o personagem muda', () => {
    const a = occupantTextureKey({ ...base, avatarSeed: 'ana' })
    const b = occupantTextureKey({ ...base, avatarSeed: 'outra' })
    expect(a).not.toBe(b)
    expect(a).toContain('u1')
  })
})
```

`apps/web/src/office/officeAvatar.ts`:

```ts
import {
  characterHash,
  characterSignature,
  defaultCharacterFromSeed,
  isCharacterOptions,
  type CharacterOptions,
  type OfficeOccupant,
} from '@legends/shared'

type OccupantAvatar = Pick<OfficeOccupant, 'userId' | 'avatarStyle' | 'avatarSeed' | 'avatarOptions'>

/**
 * Personagem de um occupant: options lpc válidas quando existem; senão,
 * determinístico por seed → userId (diferente do componente Avatar, que cai
 * para foto/iniciais — no mapa ninguém fica sem boneco).
 */
export function occupantCharacterOptions(occupant: OccupantAvatar): CharacterOptions {
  if (isCharacterOptions(occupant.avatarOptions)) return occupant.avatarOptions
  return defaultCharacterFromSeed(occupant.avatarSeed ?? occupant.userId)
}

/** Key de textura estável por personagem — trocar o avatar troca a key. */
export function occupantTextureKey(occupant: OccupantAvatar): string {
  const signature = characterSignature(occupantCharacterOptions(occupant))
  return `char-${occupant.userId}-${characterHash(signature)}`
}
```

Run: `pnpm --filter @legends/web test -- run officeAvatar` → PASS

- [ ] **Step 2: `OfficeBridge.ts` — tratar `avatar-updated`**

No switch de mensagens (junto do case `sprite-updated`, que continua até a Task 8), adicione:

```ts
      case 'avatar-updated': {
        const occupant = this.occupants.get(message.userId)
        if (occupant) {
          this.occupants.set(message.userId, {
            ...occupant,
            avatarSeed: message.avatarSeed,
            avatarOptions: message.avatarOptions,
          })
        }
        break
      }
```

Teste em `OfficeBridge.test.ts` (padrão do teste de `sprite-updated` existente):

```ts
it('avatar-updated atualiza seed e options do occupant', () => {
  // join com occupant 'ana', então:
  emitServer({ type: 'avatar-updated', userId: 'ana', avatarSeed: 'nova', avatarOptions: defaultCharacterFromSeed('nova') })
  const occupant = bridge.snapshot().occupants.find((o) => o.userId === 'ana')
  expect(occupant?.avatarSeed).toBe('nova')
  expect(occupant?.avatarOptions).toEqual(defaultCharacterFromSeed('nova'))
})
```

- [ ] **Step 3: `OfficeScene.ts` — personagem composto com anims**

Mudanças (o arquivo é grande; toque só nestes pontos):

1. **Imports**: adicione `composeCharacterSheet` de `'../../lib/character'`; `characterIdleFrame`, `characterWalkFrames`, `CHARACTER_FRAME_SIZE` de `'@legends/shared'`; troque o import de `resolveOfficeAvatar` por `{ occupantCharacterOptions, occupantTextureKey }`.
2. **Constantes**: substitua `AVATAR_HEIGHT`, `AVATAR_BASE_Y`, `PIXEL_HEIGHT`, `PIXEL_BASE_Y`, `PIXEL_FRAMES` e `SPRITE_LOADING_FALLBACK_MS` por:

```ts
/** Altura do personagem na tela (frame LPC de 64px exibido a 1.5 tile). */
const CHARACTER_DISPLAY = 48
/** y local do pé do personagem (borda de baixo do tile é +16; label em +18). */
const CHARACTER_BASE_Y = 16
const WALK_FRAME_RATE = 10
```

3. **CharacterView**: campo `body` vira `Phaser.GameObjects.Image | Phaser.GameObjects.Sprite`; remova `fallbackTimer` e `hasPixel`; adicione `textureKey?: string`.
4. **spawn()**: mantenha o spinner `char-loading` + label + container + hit area como estão; troque o fim por:

```ts
    this.characters.set(occupant.userId, view)
    this.loadCharacterSprite(occupant, view)
    if (occupant.thoughtText) this.showNearbyBubble(occupant.userId, occupant.thoughtText, 'thought')
```

(sem `fallbackTimer`, sem `if (occupant.spriteUrl)`).

5. **Substitua** `loadAvatarSprite`, `applyAvatarSprite`, `loadPixelSprite` e `applyPixelSprite` por:

```ts
  /**
   * Compõe o spritesheet LPC do occupant (camadas de /lpc/ em canvas) e assume
   * o personagem quando pronto. Composição é local e rápida (~centenas de ms);
   * em falha (404 de camada) o spinner fica — sem rede não há o que mostrar.
   */
  private loadCharacterSprite(occupant: OfficeOccupant, view: CharacterView): void {
    const textureKey = occupantTextureKey(occupant)
    if (this.textures.exists(textureKey)) {
      this.applyCharacterSprite(view, textureKey)
      return
    }
    const options = occupantCharacterOptions(occupant)
    void composeCharacterSheet(options)
      .then((sheet) => {
        if (this.characters.get(occupant.userId) !== view) return
        if (!this.textures.exists(textureKey)) {
          this.textures.addSpriteSheet(textureKey, undefined, {
            frameWidth: CHARACTER_FRAME_SIZE,
            frameHeight: CHARACTER_FRAME_SIZE,
          }, this.textures.addCanvas(`${textureKey}-src`, sheet).getSourceImage() as HTMLImageElement)
        }
        this.applyCharacterSprite(view, textureKey)
      })
      .catch(() => {})
  }
```

**Atenção (verificar na implementação):** a forma de registrar um canvas como spritesheet varia com a versão do Phaser. Caminho preferido:

```ts
this.textures.addSpriteSheet(textureKey, sheet as unknown as HTMLImageElement, {
  frameWidth: CHARACTER_FRAME_SIZE,
  frameHeight: CHARACTER_FRAME_SIZE,
})
```

`addSpriteSheet` aceita `HTMLCanvasElement` como source em Phaser 3.60+; se a versão do repo recusar, converta com `sheet.toDataURL()` + `Image` (mesmo padrão do `loadPixelSprite` antigo). Decida pelo que compilar/funcionar e apague o outro caminho.

```ts
  private applyCharacterSprite(view: CharacterView, textureKey: string): void {
    view.bobTween?.stop()
    view.spinTween?.stop()
    view.spinTween = undefined
    view.body.destroy()

    const sprite = this.add.sprite(0, CHARACTER_BASE_Y, textureKey, characterIdleFrame(view.lastDir))
    sprite.setOrigin(0.5, 1)
    sprite.setDisplaySize(CHARACTER_DISPLAY, CHARACTER_DISPLAY)
    this.ensureWalkAnimations(textureKey)

    view.container.addAt(sprite, 0)
    view.body = sprite
    view.bodyBaseY = CHARACTER_BASE_Y
    view.hasAvatar = true
    view.textureKey = textureKey

    const hit = view.container.input?.hitArea as Phaser.Geom.Rectangle | undefined
    hit?.setTo(-CHARACTER_DISPLAY / 2, CHARACTER_BASE_Y - CHARACTER_DISPLAY, CHARACTER_DISPLAY, CHARACTER_DISPLAY)

    this.face(view, view.lastDir)
  }

  /** Uma animação de walk por direção e por textura (idempotente). */
  private ensureWalkAnimations(textureKey: string): void {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const key = `${textureKey}-walk-${dir}`
      if (this.anims.exists(key)) continue
      this.anims.create({
        key,
        frames: characterWalkFrames(dir).map((frame) => ({ key: textureKey, frame })),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      })
    }
  }
```

6. **handle()**: troque o case `sprite-updated` por:

```ts
      case 'avatar-updated': {
        const view = this.characters.get(message.userId)
        if (view) {
          this.loadCharacterSprite(
            { userId: message.userId, avatarSeed: message.avatarSeed, avatarOptions: message.avatarOptions } as OfficeOccupant,
            view,
          )
        }
        break
      }
```

7. **step()**: no lugar do bob (mantenha o tween de posição), toque a animação:

```ts
    if (view.textureKey && 'play' in view.body) {
      const sprite = view.body as Phaser.GameObjects.Sprite
      sprite.play(`${view.textureKey}-walk-${dir}`, true)
      view.tween = this.tweens.add({
        targets: view.container,
        x: px,
        y: py,
        duration: STEP_MS,
        ease: 'Linear',
        onComplete: () => {
          view.container.setDepth(y)
          sprite.stop()
          sprite.setFrame(characterIdleFrame(view.lastDir))
        },
      })
      return
    }
    // spinner ainda de pé: mantém o tween + bob antigos
```

(Deixe o bloco antigo de tween+bob como fallback do spinner; remova a atribuição duplicada de `view.tween` — reorganize para um único `this.tweens.add` com o `onComplete` condicionado, se ficar mais limpo.)

8. **face()**: vira:

```ts
  private face(view: CharacterView, dir: Direction): void {
    view.lastDir = dir
    if (!view.textureKey || !('anims' in view.body)) return
    const sprite = view.body as Phaser.GameObjects.Sprite
    if (sprite.anims.isPlaying) {
      sprite.play(`${view.textureKey}-walk-${dir}`, true)
    } else {
      sprite.setFrame(characterIdleFrame(dir))
    }
  }
```

9. **destroyCharacter()**: remova `view.fallbackTimer?.remove()`.

- [ ] **Step 4: Rodar os testes do web**

Run: `pnpm --filter @legends/web test -- run`
Expected: PASS (ajuste fixtures de occupant nos testes de office que usarem `avatarOptions` open-peeps: troque por `null` ou `defaultCharacterFromSeed('x')`)

- [ ] **Step 5: Verificação manual no escritório**

`pnpm dev`, duas janelas logadas com usuários diferentes:
- personagens aparecem compostos (sem spinner de 60s), andam com walk cycle nas 4 direções;
- trocar o avatar no perfil com o escritório aberto troca o personagem ao vivo nas duas janelas;
- usuário sem avatar salvo aparece com personagem padrão estável.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office
git commit -m "feat(web): personagem LPC composto no escritório com walk cycle e troca ao vivo"
```

---

### Task 8: Remoção do pipeline OpenAI e do spriteUrl

**Files:**
- Delete: `apps/api/src/services/office-sprite-service.ts` + `.test.ts`, `apps/api/src/lib/sprite-sheet.ts` + `.test.ts` (se existir), `apps/api/src/lib/office-avatar-png.ts` + `.test.ts`, `apps/api/assets/office-sprite-style/`
- Modify: `apps/api/src/app.ts`, `apps/api/src/routes/office-ws.ts`, `apps/api/src/lib/office-hub.ts`, `packages/shared/src/office.ts`, `apps/api/.env.example`, `nginx/default.conf`, `apps/web/src/office/OfficeBridge.ts`, fixtures de testes web/api
- Test: os que referenciam `spriteUrl`/`sprite-updated`/`officeColors`

**Interfaces:**
- Consumes: nada novo
- Produces: contrato sem `spriteUrl`, sem `sprite-updated`, sem `officeColors`/`skinColor`/`clothingColor`, API sem OpenAI

- [ ] **Step 1: Deletar o pipeline na API**

```bash
git rm apps/api/src/services/office-sprite-service.ts apps/api/src/services/office-sprite-service.test.ts
git rm apps/api/src/lib/office-avatar-png.ts apps/api/src/lib/office-avatar-png.test.ts
git rm -r apps/api/assets/office-sprite-style
ls apps/api/src/lib/sprite-sheet* 2>/dev/null && git rm apps/api/src/lib/sprite-sheet*
```

- [ ] **Step 2: Limpar as referências**

1. `apps/api/src/routes/office-ws.ts`: remova o import de `ensureOfficeSprite, spriteUrlFor`; no preValidation, monte o `_officeUser` sem `spriteUrl` (o objeto `spriteUser` intermediário deixa de existir); remova o bloco inteiro de backfill (`if (!user.spriteUrl) { ... }`).
2. `apps/api/src/lib/office-hub.ts`: remova `spriteUrl` de `OfficeUser` e do occupant montado no `join`; delete o método `updateSprite`; remova `officeColors` do import e as linhas `skinColor/clothingColor` do occupant.
3. `packages/shared/src/office.ts`: remova `spriteUrl` e `skinColor`/`clothingColor` de `OfficeOccupant`; remova a variante `sprite-updated` de `OfficeServerMessage`; delete a função `officeColors` e os imports `OPEN_PEEPS_SKIN_COLORS`/`OPEN_PEEPS_CLOTHING_COLORS`.
4. `apps/api/src/app.ts`: delete o bloco do static `/office-sprites/` (linhas ~67-72) — o import de `fastifyStatic` fica (highlights usa).
5. `apps/web/src/office/OfficeBridge.ts`: delete o case `sprite-updated`.
6. `apps/api/.env.example`: delete o bloco `# Sprite pixel-art do escritório...` até `# OPENAI_IMAGE_QUALITY="medium"` (linhas ~12-19).
7. `nginx/default.conf`: delete o `location /office-sprites/ { ... }` (linhas ~32-34).
8. Confirme que nada sobrou:

```bash
grep -rn 'office-sprite\|spriteUrl\|sprite-updated\|OPENAI\|officeColors' apps packages nginx docker appspec.yml --include='*.*' | grep -v node_modules
```

Expected: só matches em testes que o Step 3 corrige (e nos docs/superpowers antigos, que ficam como histórico).

- [ ] **Step 3: Corrigir os testes**

Remova `spriteUrl`/`skinColor`/`clothingColor` das fixtures e casos: `apps/api/src/routes/office-ws.test.ts` (asserts de spriteUrl/backfill saem), `apps/api/src/lib/office-hub.test.ts` (casos de `updateSprite` saem; `officeColors` idem), `packages/shared/src/office.test.ts` (casos de `officeColors` saem), e no web: `useOfficeSocket.test.ts`, `OfficeBridge.test.ts` (caso `sprite-updated` sai), `useOfficeInteractions.test.tsx`, `PeopleList.test.tsx`, `useOfficeMedia.test.ts`, `OfficePage.test.tsx`, `office-media.test.ts` — apenas deletar a linha `spriteUrl: null,` das fixtures na maioria.

- [ ] **Step 4: Rodar TUDO**

Run: `pnpm build && pnpm test`
Expected: build limpo, testes verdes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove geração de sprite via OpenAI e todo o fluxo de spriteUrl"
```

---

### Task 9: Remoção do open-peeps e do DiceBear

**Files:**
- Modify: `packages/shared/src/avatar.ts` (só lpc), `packages/shared/src/avatar.test.ts`, `packages/shared/src/{auth,squad-mood,review,retro}.ts` (tipo do campo)
- Delete: `apps/web/src/lib/avatar.ts` + `avatar.test.ts`
- Modify: `apps/web/package.json`, `apps/api/package.json` (remover `@dicebear/*`)
- Test: `pnpm test` geral

- [ ] **Step 1: Encolher `packages/shared/src/avatar.ts` para o conteúdo final**

```ts
import type { CharacterOptions } from "./character";

/**
 * O avatar é o personagem LPC customizável (ver ./character.ts).
 * 'lpc' é o único estilo gravável; valores antigos ('open-peeps') podem
 * existir no banco e são tratados como "sem personagem salvo" (o cliente
 * deriva um padrão da seed — defaultCharacterFromSeed).
 */
export const LPC_AVATAR_STYLE = "lpc" as const;

export const ALL_AVATAR_STYLE_KEYS = [LPC_AVATAR_STYLE] as const;

export type AvatarStyleKey = (typeof ALL_AVATAR_STYLE_KEYS)[number];

/** Body for PATCH /auth/me. `null` clears the field. */
export interface UpdateProfileRequest {
  avatarStyle?: AvatarStyleKey | null;
  avatarSeed?: string | null;
  avatarOptions?: CharacterOptions | null;
}
```

Atenção: campos `avatarStyle` de `PublicUser`/occupants tipados como `AvatarStyleKey | null` continuam válidos — mas o VALOR `'open-peeps'` vindo do banco não é mais representável no tipo. Onde o serialize/route faz cast (`user.avatarStyle as AvatarStyleKey | null`), o cast continua compilando (string → união); os consumidores web só reagem a `'lpc'`. Confirme com `grep -rn "'open-peeps'" apps packages --include='*.ts*' | grep -v test | grep -v docs` → devem restar só os fallbacks intencionais (`useCharacterPortrait.ts` trata `'open-peeps'` como legado — troque a comparação para string literal solta: o hook recebe `avatarStyle?: string | null`, então segue compilando).

- [ ] **Step 2: Repontar os tipos de `avatarOptions`**

Em `packages/shared/src/auth.ts` (linha ~15), `squad-mood.ts` (~17), `review.ts` (~36): troque `AvatarOptions | null` por `CharacterOptions | null` (ajuste imports). `retro.ts` usa `Pick<PublicUser, ...>` — segue automático.

- [ ] **Step 3: Limpar `packages/shared/src/avatar.test.ts`**

Remova os casos de open-peeps/`openPeepsProps`; deixe (ou crie) um caso mínimo:

```ts
import { describe, expect, it } from 'vitest'
import { ALL_AVATAR_STYLE_KEYS } from './avatar'

describe('avatar styles', () => {
  it('só o estilo lpc é gravável', () => {
    expect(ALL_AVATAR_STYLE_KEYS).toEqual(['lpc'])
  })
})
```

- [ ] **Step 4: Deletar a lib DiceBear do web e as dependências**

```bash
git rm apps/web/src/lib/avatar.ts apps/web/src/lib/avatar.test.ts
```

Remova `"@dicebear/collection"` e `"@dicebear/core"` de `apps/web/package.json` e `apps/api/package.json`, depois:

```bash
pnpm install
grep -rn 'dicebear\|customAvatarDataUri\|avatarDataUri\|OPEN_PEEPS\|openPeepsProps\|DEFAULT_OPEN_PEEPS' apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Expected: nenhum match (se sobrar consumidor esquecido — ex. algum componente de perfil — migre-o para `useCharacterPortrait`/`Avatar` no ato).

- [ ] **Step 5: Rodar TUDO**

Run: `pnpm build && pnpm test`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove open-peeps e DiceBear — personagem LPC é o único avatar"
```

---

### Task 10: Verificação final

- [ ] **Step 1: Suíte completa do zero**

```bash
pnpm db:up && pnpm build && pnpm test
```

Expected: tudo verde.

- [ ] **Step 2: Fluxo manual completo (usar a skill `verify` / browser)**

1. Login → perfil: usuário legado (com open-peeps no banco) mostra personagem padrão derivado da seed (não iniciais).
2. "Escolher personagem" → Personalizar: trocar corpo/pele/cabelo/roupa/óculos/chapéu com preview andando; Salvar.
3. Retrato atualiza no header/perfil/listas de voto.
4. Escritório com 2 sessões: walk cycle 4 direções; trocar avatar numa sessão troca ao vivo na outra; personagens estáveis após reconexão.
5. Humor do dia: emojis funcionam e registram.
6. Créditos: link no editor abre `/lpc/CREDITS.txt` com a lista de autores.
7. `grep -rn 'OPENAI' apps packages` → vazio.

- [ ] **Step 3: Atualizar docs**

- `AGENTS.md`: na seção do frontend, troque "avatares via **DiceBear** (`@dicebear/*`)" por "personagem pixel-art **LPC** (assets curados em `apps/web/public/lpc`, catálogo em `@legends/shared`, créditos obrigatórios em `/lpc/CREDITS.txt`)". Em Gotchas, remova menções ao sprite IA se houver.
- Commit: `docs: AGENTS.md reflete o personagem LPC no lugar de DiceBear/OpenAI`

- [ ] **Step 4: Encerramento**

Use a skill `superpowers:finishing-a-development-branch` para decidir merge/PR.

---

## Self-review (feito na escrita)

- **Cobertura do spec:** assets/catálogo (T1-T2), modelo de dados sem migration + default por seed (T2, T5, T7), renderização cliente + retrato + walk cycle + avatar-updated (T4-T7), editor 2 modos + preview + créditos (T6), remoção OpenAI completa incl. nginx/env (T8), remoção open-peeps/DiceBear (T9), testes por camada (todas), verificação manual (T10). Gap do spec (MoodOfDay) decidido e registrado.
- **Sem placeholders:** todo step de código tem o código; os dois pontos genuinamente dependentes de verificação em runtime (API do Phaser p/ canvas-spritesheet; contagem exata de `loadImage` no teste de cache) estão marcados com a decisão a tomar e o critério.
- **Consistência de nomes:** `characterLayers`, `characterSignature`, `characterHash`, `defaultCharacterFromSeed`, `isCharacterOptions`, `occupantCharacterOptions`, `occupantTextureKey`, `composeCharacterSheet`, `characterPortraitDataUri`, `updateAvatar`, mensagem `avatar-updated` — usados com a mesma grafia em todas as tasks.
