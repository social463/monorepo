# Sprite pixel-art chibi gerado por IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada usuário do escritório vira um sprite pixel-art chibi (4 direções) gerado por IA a partir do avatar DiceBear dele, com cache em disco e fallback no personagem atual.

**Architecture:** A API renderiza o avatar open-peeps em PNG (DiceBear em Node + resvg), pede ao Gemini uma imagem única com grade 2×2 (4 direções) sobre fundo chroma, pós-processa em JS puro (pngjs) num spritesheet 4×1 e salva em `storage/office-sprites/` (cache por arquivo, sem migration). O occupant ganha `spriteUrl`; a mensagem `sprite-updated` avisa o mapa quando uma geração termina. A cena Phaser troca frame por direção; fallback: sprite IA → busto+perninhas → placeholder.

**Tech Stack:** `@google/genai` (já na API), `@resvg/resvg-js` (já na API), `@dicebear/core`+`@dicebear/collection` (novos na API), `pngjs` (novo), Fastify static, Phaser 3.

**Spec:** `docs/superpowers/specs/2026-07-15-escritorio-sprite-pixel-ia-design.md`

## Global Constraints

- Node ≥ 20 (`nvm use 20` antes de qualquer pnpm — shell padrão usa 18).
- Testes da API exigem Postgres: `pnpm db:up` antes.
- Mensagens/comentários em português, estilo da camada vizinha.
- Contrato muda primeiro em `@legends/shared`.
- Nenhuma migration; cache é arquivo em `storage/office-sprites/<userId>-<hash>.png`, `hash = officeHash(JSON.stringify({ seed, options }))`.
- Sem `GEMINI_API_KEY` o serviço é inerte (fallback permanente, zero erro por request).
- Falha pré-existente conhecida: 2 testes de `apps/web/src/pages/ProfilePage.test.tsx` já falham na main — não é responsabilidade deste plano.

---

### Task 1: Contrato + hub — `spriteUrl` e `sprite-updated`

**Files:**
- Modify: `packages/shared/src/office.ts` (interface `OfficeOccupant` ~linha 123; union `OfficeServerMessage` ~linha 140)
- Modify: `apps/api/src/lib/office-hub.ts` (`OfficeUser`, `join`, método novo `updateSprite`)
- Modify: `apps/api/src/routes/office-ws.ts` (monta `OfficeUser` com `spriteUrl: null` por ora — a Task 5 liga o valor real)
- Test: `apps/api/src/lib/office-hub.test.ts`
- Modify (fixtures de occupant que quebram com campo novo — procure `avatarSeed: null` para achá-las): `apps/web/src/office/useOfficeSocket.test.ts`, `apps/web/src/office/useOfficeInteractions.test.tsx`, `apps/web/src/office/PeopleList.test.tsx`, `apps/web/src/office/OfficeBridge.test.ts`, `apps/web/src/office/media/useOfficeMedia.test.ts`, `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `OfficeOccupant`/`OfficeServerMessage` atuais.
- Produces: `OfficeOccupant.spriteUrl: string | null`; mensagem `{ type: "sprite-updated"; userId: string; spriteUrl: string }`; `OfficeUser.spriteUrl: string | null`; `OfficeHub.updateSprite(userId: string, spriteUrl: string): void` — Tasks 5 e 6 dependem desses nomes exatos.

- [ ] **Step 1: Testes que falham no hub**

Em `apps/api/src/lib/office-hub.test.ts`, num `describe('updateSprite')` novo:

```ts
describe('updateSprite', () => {
  it('atualiza o occupant e faz broadcast para todos (inclusive o próprio)', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    hub.updateSprite('ana', '/office-sprites/ana-123.png')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.spriteUrl).toBe(
      '/office-sprites/ana-123.png',
    )
    const expected = { type: 'sprite-updated', userId: 'ana', spriteUrl: '/office-sprites/ana-123.png' }
    expect(a.sent).toContainEqual(expected)
    expect(b.sent).toContainEqual(expected)
  })

  it('é no-op para quem não está no mapa', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)

    hub.updateSprite('zoe', '/office-sprites/zoe-1.png')

    expect(a.sent.some((m) => m.type === 'sprite-updated')).toBe(false)
  })
})
```

E as fixtures existentes ganham o campo (senão o TS rejeita o `OfficeUser`):

```ts
const ana = { id: 'ana', name: 'Ana', avatarSeed: null, avatarOptions: null, spriteUrl: null }
const bruno = { id: 'bruno', name: 'Bruno', avatarSeed: null, avatarOptions: null, spriteUrl: null }
// idem carol (~linha 166) e carla (mantém avatarSeed/avatarOptions dela + spriteUrl: null)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- office-hub`
Expected: FAIL — `updateSprite` não existe.

- [ ] **Step 3: Implementar contrato + hub + rota**

`packages/shared/src/office.ts` — na interface `OfficeOccupant`, após `avatarOptions`:

```ts
  /** Spritesheet pixel-art gerado por IA (4 direções, ordem down/up/left/right), quando pronto. */
  spriteUrl: string | null;
```

No union `OfficeServerMessage`, após `nearby-message`:

```ts
  /** O spritesheet pixel-art de alguém ficou pronto — o personagem troca ao vivo. */
  | { type: "sprite-updated"; userId: string; spriteUrl: string };
```

`apps/api/src/lib/office-hub.ts` — `OfficeUser` ganha `spriteUrl: string | null`; o occupant do `join` ganha `spriteUrl: user.spriteUrl`; método público novo (junto de `sendToUser`):

```ts
  /**
   * Marca o spritesheet pixel-art de um usuário como pronto e avisa todo mundo
   * (inclusive o próprio) — o personagem "vira" pixel-art sem reentrar.
   * No-op se a pessoa já saiu do mapa (o arquivo fica para a próxima visita).
   */
  updateSprite(userId: string, spriteUrl: string): void {
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.occupant.spriteUrl = spriteUrl
    this.broadcast({ type: 'sprite-updated', userId, spriteUrl })
  }
```

`apps/api/src/routes/office-ws.ts` — no `_officeUser`, adicionar `spriteUrl: null` (comentário: `// Task 5 liga o valor real via office-sprite-service`).

- [ ] **Step 4: Fixtures do web**

Todo literal de occupant nos 6 arquivos listados ganha `spriteUrl: null` (mesmo padrão da mudança anterior de `avatarSeed`).

- [ ] **Step 5: Testes + build**

Run: `pnpm db:up && pnpm --filter @legends/api test` → PASS.
Run: `pnpm --filter @legends/web test` → PASS (só as 2 pré-existentes).
Run: `pnpm build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/api apps/web
git commit -m "feat(office): contrato do sprite pixel-art — spriteUrl + sprite-updated"
```

---

### Task 2: Pós-processamento `sprite-sheet.ts` (pngjs, JS puro)

**Files:**
- Create: `apps/api/src/lib/sprite-sheet.ts`
- Test: `apps/api/src/lib/sprite-sheet.test.ts`
- Modify: `apps/api/package.json` (deps novas)

**Interfaces:**
- Consumes: nada do projeto (lib pura).
- Produces: `buildSpriteSheet(generatedPng: Buffer): { sheet: Buffer; frameWidth: number; frameHeight: number } | null` — a Task 4 chama exatamente isso. Exporta também `FRAME_HEIGHT = 48` e helpers testáveis (`chromaKey`, `trim`).

- [ ] **Step 1: Instalar deps**

```bash
pnpm --filter @legends/api add pngjs
pnpm --filter @legends/api add -D @types/pngjs
```

- [ ] **Step 2: Testes que falham**

Criar `apps/api/src/lib/sprite-sheet.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { buildSpriteSheet, chromaKey, trim, FRAME_HEIGHT } from './sprite-sheet'

/** PNG sintético: fundo verde-chroma com um retângulo colorido em cada quadrante. */
function syntheticGrid(opts?: { skipQuadrant?: number }): Buffer {
  const size = 200
  const png = new PNG({ width: size, height: size })
  for (let i = 0; i < size * size; i += 1) {
    png.data[i * 4] = 0
    png.data[i * 4 + 1] = 255
    png.data[i * 4 + 2] = 0
    png.data[i * 4 + 3] = 255
  }
  // Um "personagem" 40x60 centralizado em cada quadrante, cor única por quadrante.
  const colors: [number, number, number][] = [
    [200, 50, 50],
    [50, 50, 200],
    [50, 200, 200],
    [200, 200, 50],
  ]
  const centers = [
    [50, 50],
    [150, 50],
    [50, 150],
    [150, 150],
  ]
  centers.forEach(([cx, cy], q) => {
    if (opts?.skipQuadrant === q) return
    for (let y = cy - 30; y < cy + 30; y += 1) {
      for (let x = cx - 20; x < cx + 20; x += 1) {
        const i = (y * size + x) * 4
        png.data[i] = colors[q][0]
        png.data[i + 1] = colors[q][1]
        png.data[i + 2] = colors[q][2]
        png.data[i + 3] = 255
      }
    }
  })
  return PNG.sync.write(png)
}

describe('chromaKey', () => {
  it('zera o alpha do fundo verde e preserva o resto', () => {
    const img = chromaKey(decode(syntheticGrid()))
    const corner = 0 // pixel (0,0) é fundo
    expect(img.data[corner * 4 + 3]).toBe(0)
    const inside = (50 * 200 + 50) * 4 // centro do quadrante TL
    expect(img.data[inside + 3]).toBe(255)
  })
})

function decode(buf: Buffer) {
  const png = PNG.sync.read(buf)
  return { width: png.width, height: png.height, data: png.data }
}

describe('trim', () => {
  it('retorna null para imagem toda transparente', () => {
    const empty = { width: 10, height: 10, data: Buffer.alloc(400) }
    expect(trim(empty)).toBeNull()
  })
})

describe('buildSpriteSheet', () => {
  it('gera sheet 4x1 com frames uniformes de FRAME_HEIGHT', () => {
    const result = buildSpriteSheet(syntheticGrid())
    expect(result).not.toBeNull()
    const sheet = PNG.sync.read(result!.sheet)
    expect(result!.frameHeight).toBe(FRAME_HEIGHT)
    expect(sheet.height).toBe(FRAME_HEIGHT)
    expect(sheet.width).toBe(result!.frameWidth * 4)
  })

  it('ordena os frames down, up, left, right (TL, TR, BL, BR)', () => {
    const result = buildSpriteSheet(syntheticGrid())!
    const sheet = PNG.sync.read(result.sheet)
    // centro de cada frame deve ter a cor do quadrante correspondente
    const sample = (frame: number) => {
      const x = frame * result.frameWidth + Math.floor(result.frameWidth / 2)
      const y = Math.floor(FRAME_HEIGHT / 2)
      const i = (y * sheet.width + x) * 4
      return [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2]]
    }
    expect(sample(0)).toEqual([200, 50, 50]) // TL = down
    expect(sample(1)).toEqual([50, 50, 200]) // TR = up
    expect(sample(2)).toEqual([50, 200, 200]) // BL = left
    expect(sample(3)).toEqual([200, 200, 50]) // BR = right
  })

  it('quadrante vazio invalida a geração (retorna null)', () => {
    expect(buildSpriteSheet(syntheticGrid({ skipQuadrant: 1 }))).toBeNull()
  })

  it('PNG inválido retorna null em vez de lançar', () => {
    expect(buildSpriteSheet(Buffer.from('nada a ver'))).toBeNull()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- sprite-sheet`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar**

Criar `apps/api/src/lib/sprite-sheet.ts`:

```ts
import { PNG } from 'pngjs'

/**
 * Pós-processamento do spritesheet gerado por IA: a imagem chega como uma
 * grade 2x2 (TL=frente, TR=costas, BL=esquerda, BR=direita) sobre fundo
 * verde-chroma; sai como um sheet 4x1 transparente com frames uniformes,
 * na ordem down/up/left/right que a cena Phaser espera.
 * Tudo em JS puro (pngjs) — sem dependência nativa além do que o repo já tem.
 */

export const FRAME_HEIGHT = 48
/** Distância euclidiana RGB máxima para um pixel contar como fundo. */
const CHROMA_TOLERANCE = 120
const CHROMA = { r: 0, g: 255, b: 0 }

export interface RawImage {
  width: number
  height: number
  data: Buffer
}

export function chromaKey(img: RawImage): RawImage {
  const out = Buffer.from(img.data)
  for (let i = 0; i < img.width * img.height; i += 1) {
    const r = out[i * 4]
    const g = out[i * 4 + 1]
    const b = out[i * 4 + 2]
    const dist = Math.sqrt((r - CHROMA.r) ** 2 + (g - CHROMA.g) ** 2 + (b - CHROMA.b) ** 2)
    if (dist <= CHROMA_TOLERANCE) out[i * 4 + 3] = 0
  }
  return { width: img.width, height: img.height, data: out }
}

function crop(img: RawImage, x0: number, y0: number, w: number, h: number): RawImage {
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    const srcStart = ((y0 + y) * img.width + x0) * 4
    img.data.copy(data, y * w * 4, srcStart, srcStart + w * 4)
  }
  return { width: w, height: h, data }
}

/** Apara bordas totalmente transparentes; null se a imagem inteira for vazia. */
export function trim(img: RawImage): RawImage | null {
  let minX = img.width
  let minY = img.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return crop(img, minX, minY, maxX - minX + 1, maxY - minY + 1)
}

/** Nearest-neighbor para a altura alvo, preservando proporção. */
function scaleToHeight(img: RawImage, targetH: number): RawImage {
  const targetW = Math.max(1, Math.round((img.width / img.height) * targetH))
  const data = Buffer.alloc(targetW * targetH * 4)
  for (let y = 0; y < targetH; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor((y / targetH) * img.height))
    for (let x = 0; x < targetW; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor((x / targetW) * img.width))
      img.data.copy(data, (y * targetW + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4)
    }
  }
  return { width: targetW, height: targetH, data }
}

/**
 * Valida um frame aparado: precisa ocupar uma fração razoável do quadrante e
 * ter proporção de personagem (nem risco horizontal, nem coluna de 2px).
 */
function frameLooksValid(frame: RawImage, quadrantH: number): boolean {
  const ratio = frame.width / frame.height
  return frame.height >= quadrantH * 0.25 && ratio >= 0.25 && ratio <= 1.5
}

export function buildSpriteSheet(
  generatedPng: Buffer,
): { sheet: Buffer; frameWidth: number; frameHeight: number } | null {
  let png: PNG
  try {
    png = PNG.sync.read(generatedPng)
  } catch {
    return null
  }
  const keyed = chromaKey({ width: png.width, height: png.height, data: png.data })

  const halfW = Math.floor(keyed.width / 2)
  const halfH = Math.floor(keyed.height / 2)
  // Ordem down, up, left, right ← TL, TR, BL, BR.
  const quadrants = [
    crop(keyed, 0, 0, halfW, halfH),
    crop(keyed, halfW, 0, halfW, halfH),
    crop(keyed, 0, halfH, halfW, halfH),
    crop(keyed, halfW, halfH, halfW, halfH),
  ]

  const frames: RawImage[] = []
  for (const quadrant of quadrants) {
    const trimmed = trim(quadrant)
    if (!trimmed || !frameLooksValid(trimmed, halfH)) return null
    frames.push(scaleToHeight(trimmed, FRAME_HEIGHT))
  }

  const frameWidth = Math.max(...frames.map((f) => f.width))
  const sheet = new PNG({ width: frameWidth * 4, height: FRAME_HEIGHT })
  frames.forEach((frame, index) => {
    const offsetX = index * frameWidth + Math.floor((frameWidth - frame.width) / 2)
    for (let y = 0; y < frame.height; y += 1) {
      frame.data.copy(
        sheet.data,
        (y * sheet.width + offsetX) * 4,
        y * frame.width * 4,
        (y + 1) * frame.width * 4,
      )
    }
  })

  return { sheet: PNG.sync.write(sheet), frameWidth, frameHeight: FRAME_HEIGHT }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- sprite-sheet`
Expected: PASS (6 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/sprite-sheet.ts apps/api/src/lib/sprite-sheet.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): sprite-sheet — chroma-key, fatiamento 2x2 e sheet 4x1"
```

---

### Task 3: Avatar em PNG no servidor (+ builder compartilhado)

**Files:**
- Modify: `packages/shared/src/avatar.ts` (função nova `openPeepsProps`)
- Test: `packages/shared/src/avatar.test.ts` (criar se não existir; se existir, adicionar describe)
- Modify: `apps/web/src/lib/avatar.ts` (usa o builder compartilhado — remove duplicação)
- Create: `apps/api/src/lib/office-avatar-png.ts`
- Test: `apps/api/src/lib/office-avatar-png.test.ts`
- Modify: `apps/api/package.json` (deps `@dicebear/core@^9.4.2`, `@dicebear/collection@^9.4.2`)

**Interfaces:**
- Consumes: `AvatarOptions`, `DEFAULT_OPEN_PEEPS_OPTIONS` (shared).
- Produces: `openPeepsProps(seed: string, options: AvatarOptions | null): Record<string, unknown>` (shared); `renderAvatarPng(seed: string, options: AvatarOptions | null): Buffer` (api) — a Task 4 chama `renderAvatarPng` exatamente assim.

- [ ] **Step 1: Instalar deps**

```bash
pnpm --filter @legends/api add @dicebear/core@^9.4.2 @dicebear/collection@^9.4.2
```

- [ ] **Step 2: Testes que falham**

Em `packages/shared/src/avatar.test.ts` (crie com este conteúdo se o arquivo não existir; senão adicione o describe):

```ts
import { describe, it, expect } from 'vitest'
import { openPeepsProps, DEFAULT_OPEN_PEEPS_OPTIONS } from './avatar'

describe('openPeepsProps', () => {
  it('sem options retorna só seed e size', () => {
    expect(openPeepsProps('mimi', null)).toEqual({ seed: 'mimi', size: 128 })
  })

  it('força cada escolha via array de 1 elemento', () => {
    const props = openPeepsProps('mimi', { ...DEFAULT_OPEN_PEEPS_OPTIONS })
    expect(props.head).toEqual([DEFAULT_OPEN_PEEPS_OPTIONS.head])
    expect(props.skinColor).toEqual([DEFAULT_OPEN_PEEPS_OPTIONS.skinColor])
  })

  it('componente opcional ausente zera a probabilidade; presente força 100', () => {
    const sem = openPeepsProps('m', { ...DEFAULT_OPEN_PEEPS_OPTIONS, facialHair: null })
    expect(sem.facialHairProbability).toBe(0)
    const com = openPeepsProps('m', { ...DEFAULT_OPEN_PEEPS_OPTIONS, facialHair: 'chin' })
    expect(com.facialHair).toEqual(['chin'])
    expect(com.facialHairProbability).toBe(100)
  })
})
```

Em `apps/api/src/lib/office-avatar-png.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_OPEN_PEEPS_OPTIONS } from '@legends/shared'
import { renderAvatarPng } from './office-avatar-png'

describe('renderAvatarPng', () => {
  it('produz um PNG válido e determinístico', () => {
    const a = renderAvatarPng('mimi', { ...DEFAULT_OPEN_PEEPS_OPTIONS })
    const b = renderAvatarPng('mimi', { ...DEFAULT_OPEN_PEEPS_OPTIONS })
    // assinatura PNG: 89 50 4E 47
    expect(a.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(a.equals(b)).toBe(true)
  })

  it('avatares diferentes produzem PNGs diferentes', () => {
    const a = renderAvatarPng('mimi', null)
    const b = renderAvatarPng('outro-seed', null)
    expect(a.equals(b)).toBe(false)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared test -- avatar && pnpm --filter @legends/api test -- office-avatar-png`
Expected: FAIL — funções não existem.

- [ ] **Step 4: Implementar**

`packages/shared/src/avatar.ts` — adicionar ao final (é o mesmo algoritmo que hoje vive em `customAvatarDataUri` do web):

```ts
/**
 * Props do DiceBear open-peeps que forçam exatamente as escolhas do usuário:
 * cada componente vira array de 1 elemento; opcionais usam *Probability
 * 100 (escolhido) / 0 (nenhum). Compartilhado entre web (data URI) e api
 * (render server-side do sprite do escritório).
 */
export function openPeepsProps(
  seed: string,
  options: AvatarOptions | null,
): Record<string, unknown> {
  if (!options) return { seed, size: 128 };
  const built: Record<string, unknown> = {
    seed,
    size: 128,
    head: [options.head],
    face: [options.face],
    skinColor: [options.skinColor],
    clothingColor: [options.clothingColor],
    headContrastColor: [options.headContrastColor],
  };
  if (options.facialHair) {
    built.facialHair = [options.facialHair];
    built.facialHairProbability = 100;
  } else {
    built.facialHairProbability = 0;
  }
  if (options.accessories) {
    built.accessories = [options.accessories];
    built.accessoriesProbability = 100;
  } else {
    built.accessoriesProbability = 0;
  }
  if (options.mask) {
    built.mask = [options.mask];
    built.maskProbability = 100;
  } else {
    built.maskProbability = 0;
  }
  return built;
}
```

`apps/web/src/lib/avatar.ts` — `customAvatarDataUri` passa a delegar (o corpo duplicado morre):

```ts
import { openPeepsProps } from '@legends/shared'

export function customAvatarDataUri(seed: string, options: AvatarOptions): string {
  return createAvatar(STYLE_MAP['open-peeps'], openPeepsProps(seed, options)).toDataUri()
}
```

`apps/api/src/lib/office-avatar-png.ts`:

```ts
import { createAvatar, type Style } from '@dicebear/core'
import { openPeeps } from '@dicebear/collection'
import { Resvg } from '@resvg/resvg-js'
import { openPeepsProps, type AvatarOptions } from '@legends/shared'

/**
 * Renderiza o avatar open-peeps da pessoa em PNG no servidor — vira a
 * referência de identidade (cabelo, pele, roupa, acessórios) no prompt do
 * Gemini. Mesma resolução visual do web: openPeepsProps compartilhado.
 */
export function renderAvatarPng(seed: string, options: AvatarOptions | null): Buffer {
  const svg = createAvatar(
    openPeeps as Style<Record<string, unknown>>,
    openPeepsProps(seed, options),
  ).toString()
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } })
  return resvg.render().asPng()
}
```

- [ ] **Step 5: Rodar e ver passar (+ suite web, pois `avatar.ts` mudou)**

Run: `pnpm --filter @legends/shared test && pnpm --filter @legends/api test -- office-avatar-png && pnpm --filter @legends/web test -- avatar`
Expected: PASS (o teste existente de determinismo do web cobre a regressão da delegação).

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/web/src/lib/avatar.ts apps/api/src/lib/office-avatar-png.ts apps/api/src/lib/office-avatar-png.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): renderAvatarPng server-side + openPeepsProps compartilhado"
```

---

### Task 4: `office-sprite-service` — geração, cache, dedupe, `.failed`

**Files:**
- Create: `apps/api/src/services/office-sprite-service.ts`
- Test: `apps/api/src/services/office-sprite-service.test.ts`

**Interfaces:**
- Consumes: `renderAvatarPng` (Task 3), `buildSpriteSheet` (Task 2), `officeHash` (shared).
- Produces (a Task 5 usa exatamente estes):
  - `spriteFileName(user: SpriteUser): string`
  - `spriteUrlFor(user: SpriteUser, dir?: string): string | null`
  - `ensureOfficeSprite(user: SpriteUser, deps?: EnsureDeps): Promise<string | null>`
  - `interface SpriteUser { id: string; avatarSeed: string | null; avatarOptions: AvatarOptions | null }`
  - `interface EnsureDeps { dir?: string; generate?: SpriteGenerator; onReady?: (userId: string, spriteUrl: string) => void; env?: NodeJS.ProcessEnv; log?: (err: unknown) => void }`

- [ ] **Step 1: Testes que falham**

Criar `apps/api/src/services/office-sprite-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, writeFile, readdir, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import {
  ensureOfficeSprite,
  spriteFileName,
  spriteUrlFor,
  type SpriteUser,
} from './office-sprite-service'

const ana: SpriteUser = { id: 'ana', avatarSeed: 'mimi', avatarOptions: null }

/** Grade 2x2 válida (mesma forma do teste do sprite-sheet). */
function validGridPng(): Buffer {
  const size = 200
  const png = new PNG({ width: size, height: size })
  for (let i = 0; i < size * size; i += 1) {
    png.data[i * 4 + 1] = 255
    png.data[i * 4 + 3] = 255
  }
  for (const [cx, cy] of [
    [50, 50],
    [150, 50],
    [50, 150],
    [150, 150],
  ]) {
    for (let y = cy - 30; y < cy + 30; y += 1) {
      for (let x = cx - 20; x < cx + 20; x += 1) {
        const i = (y * size + x) * 4
        png.data[i] = 180
        png.data[i + 1] = 90
        png.data[i + 2] = 90
      }
    }
  }
  return PNG.sync.write(png)
}

const env = { GEMINI_API_KEY: 'test-key' } as NodeJS.ProcessEnv

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'office-sprites-'))
})

describe('ensureOfficeSprite', () => {
  it('gera, salva o sheet e chama onReady com a URL pública', async () => {
    const ready: string[] = []
    const url = await ensureOfficeSprite(ana, {
      dir,
      env,
      generate: async () => validGridPng(),
      onReady: (userId, spriteUrl) => ready.push(`${userId}:${spriteUrl}`),
    })
    expect(url).toBe(`/office-sprites/${spriteFileName(ana)}`)
    expect(ready).toEqual([`ana:${url}`])
    expect(spriteUrlFor(ana, dir)).toBe(url)
  })

  it('cache hit não chama o generator', async () => {
    let calls = 0
    const generate = async () => {
      calls += 1
      return validGridPng()
    }
    await ensureOfficeSprite(ana, { dir, env, generate })
    const again = await ensureOfficeSprite(ana, { dir, env, generate })
    expect(again).toBe(`/office-sprites/${spriteFileName(ana)}`)
    expect(calls).toBe(1)
  })

  it('dedupe: chamadas concorrentes disparam UMA geração', async () => {
    let calls = 0
    const generate = async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 20))
      return validGridPng()
    }
    const [a, b] = await Promise.all([
      ensureOfficeSprite(ana, { dir, env, generate }),
      ensureOfficeSprite(ana, { dir, env, generate }),
    ])
    expect(a).toBe(b)
    expect(calls).toBe(1)
  })

  it('geração inválida 2x marca .failed e não tenta de novo dentro do TTL', async () => {
    let calls = 0
    const generate = async () => {
      calls += 1
      return Buffer.from('lixo')
    }
    const url = await ensureOfficeSprite(ana, { dir, env, generate, log: () => {} })
    expect(url).toBeNull()
    expect(calls).toBe(2) // tentativa + retry
    const files = await readdir(dir)
    expect(files).toContain(`${spriteFileName(ana)}.failed`)

    const second = await ensureOfficeSprite(ana, { dir, env, generate, log: () => {} })
    expect(second).toBeNull()
    expect(calls).toBe(2) // .failed fresco bloqueia
  })

  it('.failed expirado permite tentar de novo', async () => {
    const failedPath = join(dir, `${spriteFileName(ana)}.failed`)
    await writeFile(failedPath, '')
    const old = new Date(Date.now() - 11 * 60_000)
    await utimes(failedPath, old, old)

    const url = await ensureOfficeSprite(ana, { dir, env, generate: async () => validGridPng() })
    expect(url).toBe(`/office-sprites/${spriteFileName(ana)}`)
  })

  it('sem GEMINI_API_KEY é inerte', async () => {
    let calls = 0
    const url = await ensureOfficeSprite(ana, {
      dir,
      env: {} as NodeJS.ProcessEnv,
      generate: async () => {
        calls += 1
        return validGridPng()
      },
    })
    expect(url).toBeNull()
    expect(calls).toBe(0)
  })

  it('hash muda quando o avatar muda', () => {
    expect(spriteFileName(ana)).not.toBe(spriteFileName({ ...ana, avatarSeed: 'outro' }))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- office-sprite-service`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `apps/api/src/services/office-sprite-service.ts`:

```ts
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GoogleGenAI } from '@google/genai'
import { officeHash, type AvatarOptions } from '@legends/shared'
import { renderAvatarPng } from '../lib/office-avatar-png'
import { buildSpriteSheet } from '../lib/sprite-sheet'

/**
 * Sprite pixel-art do escritório, gerado por IA a partir do avatar da pessoa.
 * Cache por arquivo em storage/office-sprites (sem banco): o nome embute o
 * hash do avatar — trocar o avatar gera arquivo novo. Falha definitiva vira
 * marcador `.failed` com TTL, para não martelar a API do Gemini a cada join.
 * Tudo best-effort: quem chama nunca depende do resultado (fallback na cena).
 */

export const OFFICE_SPRITES_DIR = join(process.cwd(), 'storage', 'office-sprites')
const STYLE_REFS_DIR = join(process.cwd(), 'assets', 'office-sprite-style')
export const FAILED_TTL_MS = 10 * 60_000
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'

export interface SpriteUser {
  id: string
  avatarSeed: string | null
  avatarOptions: AvatarOptions | null
}

/** attempt 2 = retry com prompt reforçado após uma geração fora do layout. */
export type SpriteGenerator = (
  avatarPng: Buffer,
  styleRefs: Buffer[],
  attempt: 1 | 2,
) => Promise<Buffer>

export interface EnsureDeps {
  dir?: string
  generate?: SpriteGenerator
  onReady?: (userId: string, spriteUrl: string) => void
  env?: NodeJS.ProcessEnv
  log?: (err: unknown) => void
}

export function spriteFileName(user: SpriteUser): string {
  const seed = user.avatarSeed ?? user.id
  const hash = officeHash(JSON.stringify({ seed, options: user.avatarOptions }))
  return `${user.id}-${hash}.png`
}

/** URL pública se o sheet já foi gerado; null caso contrário. */
export function spriteUrlFor(user: SpriteUser, dir: string = OFFICE_SPRITES_DIR): string | null {
  const name = spriteFileName(user)
  return existsSync(join(dir, name)) ? `/office-sprites/${name}` : null
}

const PROMPT = [
  'Crie UM ÚNICO spritesheet de pixel art no estilo chibi de RPG (cabeça grande,',
  '~60% da altura do personagem, sombreamento suave) para o personagem da',
  'primeira imagem (avatar de referência — preserve fielmente cor de pele,',
  'cabelo, roupa e acessórios como óculos, barba ou máscara).',
  'Layout OBRIGATÓRIO: grade 2x2 com o MESMO personagem em 4 vistas, mesma escala:',
  '- quadrante superior esquerdo: de FRENTE',
  '- quadrante superior direito: de COSTAS',
  '- quadrante inferior esquerdo: virado para a ESQUERDA (perfil)',
  '- quadrante inferior direito: virado para a DIREITA (perfil)',
  'Fundo: verde puro sólido (#00FF00) em TODA a imagem. Sem sombra no chão,',
  'sem texto, sem bordas, sem linhas de grade desenhadas.',
  'As demais imagens anexadas são referência de ESTILO de pixel art — siga esse traço.',
].join('\n')

const RETRY_SUFFIX = [
  '',
  'ATENÇÃO: a geração anterior violou o layout. Reforce: exatamente 4 vistas do',
  'personagem em grade 2x2, fundo #00FF00 uniforme, nada além dos 4 sprites.',
].join('\n')

/** Generator real: Gemini de imagem via SDK (mesmo padrão do gemini-client). */
export function geminiSpriteGenerator(env: NodeJS.ProcessEnv = process.env): SpriteGenerator {
  return async (avatarPng, styleRefs, attempt) => {
    const apiKey = env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY não configurada')
    const model = env.GEMINI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL
    const ai = new GoogleGenAI({ apiKey })
    const parts: Array<Record<string, unknown>> = [
      { text: attempt === 1 ? PROMPT : PROMPT + RETRY_SUFFIX },
      { inlineData: { mimeType: 'image/png', data: avatarPng.toString('base64') } },
      ...styleRefs.map((ref) => ({
        inlineData: { mimeType: 'image/png', data: ref.toString('base64') },
      })),
    ]
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
    })
    const image = res.candidates?.[0]?.content?.parts?.find(
      (part) => (part as { inlineData?: { data?: string } }).inlineData?.data,
    ) as { inlineData: { data: string } } | undefined
    if (!image) throw new Error('O Gemini não retornou imagem para o sprite.')
    return Buffer.from(image.inlineData.data, 'base64')
  }
}

async function loadStyleRefs(): Promise<Buffer[]> {
  try {
    const files = (await readdir(STYLE_REFS_DIR)).filter((f) => f.endsWith('.png')).sort()
    return await Promise.all(files.map((f) => readFile(join(STYLE_REFS_DIR, f))))
  } catch {
    return []
  }
}

function failedIsFresh(failedPath: string): boolean {
  try {
    return Date.now() - statSync(failedPath).mtimeMs < FAILED_TTL_MS
  } catch {
    return false
  }
}

/** Gerações em voo por usuário — join + save simultâneos disparam UMA geração. */
const inFlight = new Map<string, Promise<string | null>>()

export async function ensureOfficeSprite(
  user: SpriteUser,
  deps: EnsureDeps = {},
): Promise<string | null> {
  const env = deps.env ?? process.env
  if (!env.GEMINI_API_KEY) return null

  const dir = deps.dir ?? OFFICE_SPRITES_DIR
  const name = spriteFileName(user)
  const filePath = join(dir, name)
  if (existsSync(filePath)) return `/office-sprites/${name}`
  if (failedIsFresh(`${filePath}.failed`)) return null

  const running = inFlight.get(user.id)
  if (running) return running

  const log = deps.log ?? ((err: unknown) => console.error('[office-sprite]', err))
  const generate = deps.generate ?? geminiSpriteGenerator(env)

  const job = (async (): Promise<string | null> => {
    try {
      await mkdir(dir, { recursive: true })
      const avatarPng = renderAvatarPng(user.avatarSeed ?? user.id, user.avatarOptions)
      const styleRefs = await loadStyleRefs()

      for (const attempt of [1, 2] as const) {
        try {
          const generated = await generate(avatarPng, styleRefs, attempt)
          const built = buildSpriteSheet(generated)
          if (!built) continue
          await writeFile(filePath, built.sheet)
          await rm(`${filePath}.failed`, { force: true })
          const url = `/office-sprites/${name}`
          deps.onReady?.(user.id, url)
          return url
        } catch (err) {
          log(err)
        }
      }
      await writeFile(`${filePath}.failed`, '')
      return null
    } catch (err) {
      log(err)
      return null
    } finally {
      inFlight.delete(user.id)
    }
  })()

  inFlight.set(user.id, job)
  return job
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- office-sprite-service`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/office-sprite-service.ts apps/api/src/services/office-sprite-service.test.ts
git commit -m "feat(api): office-sprite-service — geração IA com cache, dedupe e .failed"
```

---

### Task 5: Costura — serving estático, gatilhos e proxies

**Files:**
- Modify: `apps/api/src/app.ts` (~linhas 59-65, segundo bloco `fastifyStatic`)
- Modify: `apps/api/src/routes/office-ws.ts` (resolve `spriteUrl` real + backfill pós-join)
- Modify: `apps/api/src/routes/auth.ts` (gatilho best-effort pós PATCH /me, entre o `prisma.user.update` e o `reply.send`)
- Modify: `nginx/default.conf` (location `/office-sprites/`)
- Modify: `apps/web/vite.config.ts` (proxy `/office-sprites` em dev)
- Modify: `apps/api/.env.example` (documentar `GEMINI_IMAGE_MODEL`)
- Test: `apps/api/src/routes/office-ws.test.ts`

**Interfaces:**
- Consumes: `spriteUrlFor`, `ensureOfficeSprite`, `spriteFileName`, `OFFICE_SPRITES_DIR` (Task 4); `officeHub.updateSprite` (Task 1).
- Produces: nada novo — liga as pontas.

- [ ] **Step 1: Teste que falha (occupant com spriteUrl real no welcome)**

Em `apps/api/src/routes/office-ws.test.ts` (usa o padrão existente do arquivo: usuário via `prisma.user.create`, token via `app.jwt.sign`, WS real, helpers `waitOpen`/`delay`):

```ts
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  OFFICE_SPRITES_DIR,
  spriteFileName,
} from '../services/office-sprite-service'

it('welcome traz spriteUrl quando o sheet já existe no disco', async () => {
  const ana = await prisma.user.create({
    data: { name: 'Ana Sprite', email: 'ana-sprite@x.com', passwordHash: 'x', role: 'LEGEND' },
  })
  const name = spriteFileName({ id: ana.id, avatarSeed: null, avatarOptions: null })
  await mkdir(OFFICE_SPRITES_DIR, { recursive: true })
  await writeFile(join(OFFICE_SPRITES_DIR, name), 'png-fake')
  try {
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    const msgs: OfficeServerMessage[] = []
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())))
    await waitOpen(ws)
    await delay(50)
    const welcome = msgs.find((m) => m.type === 'welcome') as Extract<
      OfficeServerMessage,
      { type: 'welcome' }
    >
    expect(welcome.occupants[0].spriteUrl).toBe(`/office-sprites/${name}`)
    ws.close()
  } finally {
    await rm(join(OFFICE_SPRITES_DIR, name), { force: true })
  }
})
```

(Adapte nomes de variáveis `app`/`port` ao setup real do arquivo.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- office-ws`
Expected: FAIL — `spriteUrl` vem `null` (a rota ainda passa o placeholder da Task 1).

- [ ] **Step 3: Implementar a costura**

`apps/api/src/routes/office-ws.ts` — no preValidation, trocar o placeholder:

```ts
import { ensureOfficeSprite, spriteUrlFor } from '../services/office-sprite-service'
import { officeHub, type OfficeUser } from '../lib/office-hub'

// no preValidation, ao montar _officeUser:
        const spriteUser = {
          id: user.id,
          avatarSeed: user.avatarSeed ?? null,
          avatarOptions: (user.avatarOptions as AvatarOptions | null) ?? null,
        }
        ;(request as OfficeRequest)._officeUser = {
          ...spriteUser,
          name: user.name,
          spriteUrl: spriteUrlFor(spriteUser),
        }
```

E no handler da conexão, logo após `officeHub.join(ws, user)`:

```ts
      // Backfill best-effort: quem entrou sem sheet dispara a geração; quando
      // terminar, o hub avisa o mapa (sprite-updated) — sem segurar o join.
      if (!user.spriteUrl) {
        void ensureOfficeSprite(
          { id: user.id, avatarSeed: user.avatarSeed, avatarOptions: user.avatarOptions },
          { onReady: (userId, url) => officeHub.updateSprite(userId, url) },
        ).catch((err) => request.log.error(err))
      }
```

`apps/api/src/routes/auth.ts` — entre `const user = await prisma.user.update(...)` e o `return reply.send(...)` do PATCH /me (padrão best-effort de `votes.ts`):

```ts
    // Sprite do escritório é derivado do avatar: mudou o avatar, regenera em
    // background (best-effort — falha não afeta o save do perfil).
    if (data.avatarStyle !== undefined || data.avatarSeed !== undefined || data.avatarOptions !== undefined) {
      void ensureOfficeSprite(
        {
          id: user.id,
          avatarSeed: user.avatarSeed ?? null,
          avatarOptions: (user.avatarOptions as AvatarOptions | null) ?? null,
        },
        { onReady: (userId, url) => officeHub.updateSprite(userId, url) },
      ).catch((err) => request.log.error(err))
    }
```

(Imports: `ensureOfficeSprite` do service, `officeHub` do lib, `AvatarOptions` de `@legends/shared`.)

`apps/api/src/app.ts` — logo após o bloco dos highlights (mesmo padrão):

```ts
  const officeSpritesRoot = join(process.cwd(), 'storage', 'office-sprites')
  mkdirSync(officeSpritesRoot, { recursive: true })
  app.register(fastifyStatic, {
    root: officeSpritesRoot,
    prefix: '/office-sprites/',
    decorateReply: false,
  })
```

`nginx/default.conf` — após o bloco `/highlights/`:

```
  location /office-sprites/ {
    proxy_pass http://127.0.0.1:3333/office-sprites/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
```

`apps/web/vite.config.ts` — no objeto `proxy`, entrada nova (sem rewrite — o backend serve nesse prefixo):

```ts
      '/office-sprites': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
```

`apps/api/.env.example` — junto das linhas do GEMINI:

```
# Modelo de IMAGEM para o sprite pixel-art do escritório (opcional)
# GEMINI_IMAGE_MODEL="gemini-2.5-flash-image"
```

- [ ] **Step 4: Testes + build**

Run: `pnpm --filter @legends/api test` → PASS (o teste novo passa; o PATCH /me existente continua verde — sem `GEMINI_API_KEY` no ambiente de teste o `ensureOfficeSprite` retorna `null` na primeira linha).
Run: `pnpm build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api nginx/default.conf apps/web/vite.config.ts
git commit -m "feat(api): costura do sprite IA — serving, backfill no join e gatilho no perfil"
```

---

### Task 6: Web — bridge + cena trocam para o sprite pixel-art

**Files:**
- Modify: `apps/web/src/office/OfficeBridge.ts` (`applyToSnapshot` ganha o caso `sprite-updated`)
- Test: `apps/web/src/office/OfficeBridge.test.ts`
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`

**Interfaces:**
- Consumes: `OfficeOccupant.spriteUrl`, mensagem `sprite-updated` (Task 1); spritesheet 4×1 com frames na ordem down/up/left/right e `frameHeight = 48` (Task 2).
- Produces: nada — ponta final, verificação manual.

- [ ] **Step 1: Teste que falha no bridge**

Em `apps/web/src/office/OfficeBridge.test.ts`:

```ts
it('sprite-updated atualiza o occupant no snapshot (replay tardio recebe a URL)', () => {
  const bridge = new OfficeBridge()
  bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [makeOccupant('ana')] })
  bridge.emitServerMessage({
    type: 'sprite-updated',
    userId: 'ana',
    spriteUrl: '/office-sprites/ana-1.png',
  })
  expect(bridge.snapshot().occupants[0].spriteUrl).toBe('/office-sprites/ana-1.png')
})
```

(`makeOccupant` é o helper existente do arquivo — já produz `spriteUrl: null` desde a Task 1.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- OfficeBridge`
Expected: FAIL — snapshot fica com `spriteUrl: null`.

- [ ] **Step 3: Bridge**

No `switch` de `applyToSnapshot` em `apps/web/src/office/OfficeBridge.ts`:

```ts
      case 'sprite-updated': {
        const occupant = this.occupants.get(message.userId)
        if (occupant) occupant.spriteUrl = message.spriteUrl
        break
      }
```

Run: `pnpm --filter @legends/web test -- OfficeBridge` → PASS.

- [ ] **Step 4: Cena — carregar o spritesheet e trocar frame por direção**

Em `apps/web/src/office/scenes/OfficeScene.ts`:

Constantes novas (junto das de avatar):

```ts
/** Altura do sprite pixel-art na tela (~1.4 tile, proporção das referências). */
const PIXEL_HEIGHT = 44
/** y local do pé do sprite pixel-art (borda de baixo do tile é +16; label em +18). */
const PIXEL_BASE_Y = 14
/** Ordem dos frames no sheet 4x1 gerado pela API. */
const PIXEL_FRAMES: Record<Direction, number> = { down: 0, up: 1, left: 2, right: 3 }
```

`CharacterView` ganha:

```ts
  /** true depois que o spritesheet pixel-art (IA) assumiu o personagem. */
  hasPixel?: boolean
```

No `handle()`, caso novo:

```ts
      case 'sprite-updated': {
        const view = this.characters.get(message.userId)
        if (view) this.loadPixelSprite(message.userId, message.spriteUrl, view)
        break
      }
```

No `spawn()`, depois de `this.loadAvatarSprite(occupant, view)`:

```ts
    if (occupant.spriteUrl) this.loadPixelSprite(occupant.userId, occupant.spriteUrl, view)
```

**Guarda de corrida (obrigatória):** busto e sprite pixel carregam em paralelo no
spawn (data URI vs HTTP) — se o busto terminar DEPOIS, ele não pode desfazer o
pixel já aplicado. Primeira linha de `applyAvatarSprite` ganha:

```ts
    if (view.hasPixel) return // o sprite pixel-art já assumiu; o busto é só fallback
```

Métodos novos (depois de `applyAvatarSprite`):

```ts
  /**
   * Spritesheet pixel-art gerado por IA (4x1: down/up/left/right). Carrega em
   * background e assume o personagem quando pronto — por cima do busto ou do
   * placeholder, o que estiver de pé. 404/erro deixa o fallback como está.
   */
  private loadPixelSprite(userId: string, spriteUrl: string, view: CharacterView): void {
    const textureKey = `pixel-${spriteUrl}`
    if (this.textures.exists(textureKey)) {
      this.applyPixelSprite(view, textureKey)
      return
    }
    const img = new Image()
    img.onload = () => {
      if (this.characters.get(userId) !== view) return
      if (!this.textures.exists(textureKey)) {
        this.textures.addSpriteSheet(textureKey, img, {
          frameWidth: Math.floor(img.width / 4),
          frameHeight: img.height,
        })
      }
      this.applyPixelSprite(view, textureKey)
    }
    img.onerror = () => {}
    img.src = spriteUrl
  }

  private applyPixelSprite(view: CharacterView, textureKey: string): void {
    // Pixel-art de verdade: fica no NEAREST global (nada de filtro linear aqui).
    view.bobTween?.stop()
    view.legTween?.stop()
    view.head?.destroy()
    view.head = undefined
    view.legs?.forEach((leg) => leg.destroy())
    view.legs = undefined
    view.body.destroy()

    const frame = this.textures.get(textureKey).get(0)
    const width = (frame.width / frame.height) * PIXEL_HEIGHT
    const sprite = this.add.image(0, PIXEL_BASE_Y, textureKey, 0)
    sprite.setOrigin(0.5, 1)
    sprite.setDisplaySize(width, PIXEL_HEIGHT)

    view.container.addAt(sprite, 0)
    view.body = sprite
    view.bodyBaseY = PIXEL_BASE_Y
    view.hasAvatar = true
    view.hasPixel = true

    const hit = view.container.input?.hitArea as Phaser.Geom.Rectangle | undefined
    hit?.setTo(-width / 2, PIXEL_BASE_Y - PIXEL_HEIGHT, width, PIXEL_HEIGHT)

    this.face(view, view.lastDir)
  }
```

`face()` ganha o ramo do pixel (antes do ramo `hasAvatar`):

```ts
  private face(view: CharacterView, dir: Direction): void {
    view.lastDir = dir
    if (view.hasPixel) {
      view.body.setFrame(PIXEL_FRAMES[dir])
      return
    }
    if (view.hasAvatar) {
      if (dir === 'left') view.body.setFlipX(true)
      if (dir === 'right') view.body.setFlipX(false)
      return
    }
    const offsetX = dir === 'left' ? -3 : dir === 'right' ? 3 : 0
    const offsetY = dir === 'up' ? -12 : -10
    view.head?.setPosition(offsetX, offsetY)
  }
```

(O `step()` não muda: o bob usa `bodyBaseY`, e o bloco das perninhas já é guardado por `if (view.legs)` — que vira `undefined` no swap.)

- [ ] **Step 5: Suites + build**

Run: `pnpm --filter @legends/web test` → PASS (2 pré-existentes).
Run: `pnpm build` → PASS.

- [ ] **Step 6: Verificação manual no browser (controller)**

Pré-requisitos: Postgres de pé, `nvm use 20`, e **exportar `GEMINI_API_KEY` no shell** antes do `pnpm dev` (a API NÃO carrega `apps/api/.env` — gotcha conhecido do repo). Opcional: `GEMINI_IMAGE_MODEL`.

1. Login (usuário do seed com avatar custom — diego tem no banco dev), `/escritorio`.
2. Primeira visita: personagem entra como busto+perninhas → em segundos vira o sprite pixel-art (evento `sprite-updated` ao vivo).
3. Andar nas 4 direções ("Seguir" ou teclado real): frame muda (frente/costas/perfis), bob continua.
4. Segundo usuário sem avatar custom também ganha sprite (determinístico do userId).
5. Clique no sprite abre o CharacterCard; reload → personagem já entra pixel-art (cache).
6. `storage/office-sprites/` contém `<userId>-<hash>.png`; parar a chave (unset) → tudo segue com fallback.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office
git commit -m "feat(web): personagem troca para o sprite pixel-art gerado por IA"
```
