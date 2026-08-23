# Avatar open-peeps como personagem do escritório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O busto open-peeps do avatar de cada pessoa vira o personagem que anda pelo escritório (substituindo o placeholder geométrico tintado).

**Architecture:** O servidor passa a incluir `avatarSeed`/`avatarOptions` no `OfficeOccupant` (WS `welcome`/`joined`). No web, um helper puro resolve o data URI do SVG (options → seed → userId determinístico) e a cena Phaser rasteriza o SVG em textura em runtime, trocando o placeholder pelo sprite do busto (~40px, flip horizontal por direção, bob mantido).

**Tech Stack:** TypeScript ESM, Fastify (WS), Phaser 3, DiceBear open-peeps (`@dicebear/core` + `@dicebear/collection`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-escritorio-avatar-personagem-design.md`

## Global Constraints

- Node ≥ 20 (o shell padrão do dev usa 18 — rode `nvm use 20` antes de qualquer comando; ver memória "Node 20 obrigatório em dev").
- Testes da API exigem Postgres de pé: `pnpm db:up` antes de `pnpm --filter @legends/api test`.
- Mensagens ao usuário em português; comentários seguem o estilo da camada vizinha.
- Contrato muda primeiro em `@legends/shared`, depois os dois lados.
- Nenhum endpoint novo, nenhuma migration — o hub continua 100% em memória.

---

### Task 1: Contrato + backend — occupant carrega o avatar

**Files:**
- Modify: `packages/shared/src/office.ts` (interface `OfficeOccupant`, ~linha 123)
- Modify: `apps/api/src/lib/office-hub.ts` (`OfficeUser`, `join`)
- Modify: `apps/api/src/routes/office-ws.ts` (select do Prisma + montagem do `OfficeUser`)
- Test: `apps/api/src/lib/office-hub.test.ts`
- Modify (fixtures que quebram com o campo novo): `apps/web/src/office/useOfficeSocket.test.ts`, `apps/web/src/office/useOfficeInteractions.test.tsx`, `apps/web/src/office/PeopleList.test.tsx`, `apps/web/src/office/OfficeBridge.test.ts`, `apps/web/src/office/media/useOfficeMedia.test.ts`, `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `AvatarOptions`, `officeColors` (já existentes em `@legends/shared`).
- Produces: `OfficeOccupant` com `avatarSeed: string | null` e `avatarOptions: AvatarOptions | null` — a Task 2 e a Task 3 dependem desses dois campos exatamente com esses nomes/tipos.

- [ ] **Step 1: Escrever o teste que falha no hub**

Em `apps/api/src/lib/office-hub.test.ts`, junto das fixtures existentes (`ana`, `bruno`), adicione a importação e a fixture com avatar e o teste no `describe('join')`:

```ts
// no topo, junto aos imports existentes:
import { DEFAULT_OPEN_PEEPS_OPTIONS } from '@legends/shared'

// fixture nova, junto de ana/bruno:
const carla = {
  id: 'carla',
  name: 'Carla',
  avatarSeed: 'mimi',
  avatarOptions: { ...DEFAULT_OPEN_PEEPS_OPTIONS },
}
```

```ts
it('welcome e joined carregam avatarSeed/avatarOptions do usuário', () => {
  const a = fakeSocket()
  hub.join(a.socket, ana) // ana não tem avatar customizado

  const c = fakeSocket()
  hub.join(c.socket, carla)

  const welcome = c.sent.find((m) => m.type === 'welcome') as Extract<
    OfficeServerMessage,
    { type: 'welcome' }
  >
  expect(welcome.occupants.find((o) => o.userId === 'carla')).toMatchObject({
    avatarSeed: 'mimi',
    avatarOptions: carla.avatarOptions,
  })
  expect(welcome.occupants.find((o) => o.userId === 'ana')).toMatchObject({
    avatarSeed: null,
    avatarOptions: null,
  })

  expect(a.sent).toContainEqual(
    expect.objectContaining({
      type: 'joined',
      occupant: expect.objectContaining({ avatarSeed: 'mimi' }),
    }),
  )
})
```

As fixtures existentes do arquivo (`ana`, `bruno` e `carol`, ~linhas 12-13 e 165) ganham o campo novo (senão o TypeScript rejeita o `OfficeUser`):

```ts
const ana = { id: 'ana', name: 'Ana', avatarSeed: null, avatarOptions: null }
const bruno = { id: 'bruno', name: 'Bruno', avatarSeed: null, avatarOptions: null }
// ...
const carol = { id: 'carol', name: 'Carol', avatarSeed: null, avatarOptions: null }
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- office-hub`
Expected: FAIL — o novo teste quebra porque o occupant não tem `avatarSeed`/`avatarOptions` (toMatchObject não encontra as chaves).

- [ ] **Step 3: Implementar contrato + hub + rota**

Em `packages/shared/src/office.ts`, na interface `OfficeOccupant` (após `clothingColor`):

```ts
/** Uma pessoa presente no escritório. Existe só em memória, some ao desconectar. */
export interface OfficeOccupant {
  userId: string;
  name: string;
  x: number;
  y: number;
  dir: Direction;
  /** Hex sem `#`, derivado do avatar da pessoa (ver `officeColors`). */
  skinColor: string;
  clothingColor: string;
  /** Avatar open-peeps do perfil — o cliente rasteriza o busto como personagem. */
  avatarSeed: string | null;
  avatarOptions: AvatarOptions | null;
}
```

(Confira que `AvatarOptions` já é importado/re-exportado nesse arquivo; se não, importe de `./avatar`.)

Em `apps/api/src/lib/office-hub.ts`:

```ts
export interface OfficeUser {
  id: string
  name: string
  avatarSeed: string | null
  avatarOptions: AvatarOptions | null
}
```

E no `join`, o occupant novo inclui os campos:

```ts
      const occupant: OfficeOccupant = {
        userId: user.id,
        name: user.name,
        x: spawn.x,
        y: spawn.y,
        dir: 'down',
        skinColor,
        clothingColor,
        avatarSeed: user.avatarSeed,
        avatarOptions: user.avatarOptions,
      }
```

Em `apps/api/src/routes/office-ws.ts`, o `select` e a montagem do usuário (preValidation, ~linhas 34-46):

```ts
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, active: true, avatarSeed: true, avatarOptions: true },
        })
        if (!user || !user.active) {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        ;(request as OfficeRequest)._officeUser = {
          id: user.id,
          name: user.name,
          avatarSeed: user.avatarSeed ?? null,
          avatarOptions: (user.avatarOptions as AvatarOptions | null) ?? null,
        }
```

- [ ] **Step 4: Atualizar as fixtures do web que criam `OfficeOccupant`**

O campo novo é obrigatório no tipo, então todo literal de occupant em teste do web precisa de `avatarSeed: null, avatarOptions: null`. Locais (procure por `skinColor:` para confirmar que não surgiu outro):

- `apps/web/src/office/useOfficeSocket.test.ts` (~linha 55)
- `apps/web/src/office/useOfficeInteractions.test.tsx` (~linha 17)
- `apps/web/src/office/PeopleList.test.tsx` (~linha 12)
- `apps/web/src/office/OfficeBridge.test.ts` (~linhas 11 e 21)
- `apps/web/src/office/media/useOfficeMedia.test.ts` (~linha 100)
- `apps/web/src/pages/OfficePage.test.tsx` (~linhas 17-18)

Exemplo (padrão igual nos demais):

```ts
return { userId, name: userId, x, y, dir: 'down', skinColor: 'edb98a', clothingColor: '8fa7df', avatarSeed: null, avatarOptions: null }
```

- [ ] **Step 5: Rodar os testes e o build**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Expected: PASS (incluindo `office-ws.test.ts` — os campos são aditivos).

Run: `pnpm --filter @legends/web test`
Expected: PASS.

Run: `pnpm build`
Expected: PASS — o `tsc` pega qualquer literal de occupant esquecido.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/office.ts apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts apps/api/src/routes/office-ws.ts apps/web/src
git commit -m "feat(office): occupant carrega avatarSeed/avatarOptions no contrato"
```

---

### Task 2: Helper `resolveOfficeAvatar` (web, puro, testável sem Phaser)

**Files:**
- Create: `apps/web/src/office/officeAvatar.ts`
- Test: `apps/web/src/office/officeAvatar.test.ts`

**Interfaces:**
- Consumes: `OfficeOccupant.avatarSeed`/`avatarOptions` (Task 1); `avatarDataUri(style, seed)` e `customAvatarDataUri(seed, options)` de `apps/web/src/lib/avatar.ts`; `officeHash` de `@legends/shared`.
- Produces: `resolveOfficeAvatar(occupant: Pick<OfficeOccupant, 'userId' | 'avatarSeed' | 'avatarOptions'>): { textureKey: string; dataUri: string } | null` — a Task 3 chama exatamente essa assinatura.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/web/src/office/officeAvatar.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_OPEN_PEEPS_OPTIONS } from '@legends/shared'
import { customAvatarDataUri } from '../lib/avatar'
import { resolveOfficeAvatar } from './officeAvatar'

// Espia mantendo a implementação real: só o teste de fallback força um throw.
vi.mock('../lib/avatar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/avatar')>()
  return { ...actual, customAvatarDataUri: vi.fn(actual.customAvatarDataUri) }
})

const withOptions = {
  userId: 'ana',
  avatarSeed: 'mimi',
  avatarOptions: { ...DEFAULT_OPEN_PEEPS_OPTIONS },
}

describe('resolveOfficeAvatar', () => {
  it('com avatarOptions gera pelo custom e é determinístico', () => {
    const a = resolveOfficeAvatar(withOptions)
    const b = resolveOfficeAvatar(withOptions)
    expect(a).not.toBeNull()
    expect(a!.dataUri.startsWith('data:image/svg+xml')).toBe(true)
    expect(a).toEqual(b)
  })

  it('só com seed gera open-peeps pelo seed', () => {
    const result = resolveOfficeAvatar({ userId: 'ana', avatarSeed: 'mimi', avatarOptions: null })
    const sameSeed = resolveOfficeAvatar({ userId: 'outro', avatarSeed: 'mimi', avatarOptions: null })
    expect(result!.dataUri).toBe(sameSeed!.dataUri)
  })

  it('sem nada usa o userId como seed (todo mundo tem busto)', () => {
    const ana = resolveOfficeAvatar({ userId: 'ana', avatarSeed: null, avatarOptions: null })
    const bruno = resolveOfficeAvatar({ userId: 'bruno', avatarSeed: null, avatarOptions: null })
    expect(ana!.dataUri.startsWith('data:image/svg+xml')).toBe(true)
    expect(ana!.dataUri).not.toBe(bruno!.dataUri)
  })

  it('textureKey é estável para o mesmo avatar e muda quando o avatar muda', () => {
    const a = resolveOfficeAvatar(withOptions)
    const b = resolveOfficeAvatar(withOptions)
    const semOptions = resolveOfficeAvatar({ ...withOptions, avatarOptions: null })
    expect(a!.textureKey).toBe(b!.textureKey)
    expect(a!.textureKey).not.toBe(semOptions!.textureKey)
    expect(a!.textureKey.startsWith('avatar-ana-')).toBe(true)
  })

  it('options malformado (gerador lança) cai para o avatar por seed', () => {
    vi.mocked(customAvatarDataUri).mockImplementationOnce(() => {
      throw new Error('options inválidas')
    })
    const result = resolveOfficeAvatar(withOptions)
    const porSeed = resolveOfficeAvatar({ userId: 'ana', avatarSeed: 'mimi', avatarOptions: null })
    expect(result).toEqual(porSeed)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- officeAvatar`
Expected: FAIL — `./officeAvatar` não existe.

- [ ] **Step 3: Implementar o helper**

Criar `apps/web/src/office/officeAvatar.ts`:

```ts
import { officeHash, type OfficeOccupant } from '@legends/shared'
import { avatarDataUri, customAvatarDataUri } from '../lib/avatar'

export interface OfficeAvatarTexture {
  textureKey: string
  dataUri: string
}

type OccupantAvatar = Pick<OfficeOccupant, 'userId' | 'avatarSeed' | 'avatarOptions'>

/**
 * Resolve o busto open-peeps de um occupant, na mesma ordem do componente
 * `Avatar`: options → seed → determinístico pelo userId (ninguém fica sem
 * busto). O hash do data URI no textureKey garante que trocar o avatar e
 * reentrar na mesma sessão do browser não reaproveite textura velha.
 */
export function resolveOfficeAvatar(occupant: OccupantAvatar): OfficeAvatarTexture | null {
  const dataUri = buildDataUri(occupant)
  if (!dataUri) return null
  return { textureKey: `avatar-${occupant.userId}-${officeHash(dataUri)}`, dataUri }
}

function buildDataUri({ userId, avatarSeed, avatarOptions }: OccupantAvatar): string | null {
  const seed = avatarSeed ?? userId
  if (avatarOptions) {
    try {
      return customAvatarDataUri(seed, avatarOptions)
    } catch {
      // avatarOptions malformado no banco: cai para o avatar por seed.
    }
  }
  try {
    return avatarDataUri('open-peeps', seed)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- officeAvatar`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/officeAvatar.ts apps/web/src/office/officeAvatar.test.ts
git commit -m "feat(web): resolveOfficeAvatar — busto open-peeps do occupant"
```

---

### Task 3: Cena Phaser — busto substitui o placeholder

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`

**Interfaces:**
- Consumes: `resolveOfficeAvatar` (Task 2); `OfficeOccupant.avatarSeed`/`avatarOptions` (Task 1).
- Produces: nada consumido por outras tasks — mudança final, verificada manualmente (a cena não tem teste de render hoje; a lógica testável ficou no helper da Task 2).

- [ ] **Step 1: Alterar `CharacterView` e constantes**

Em `apps/web/src/office/scenes/OfficeScene.ts`, importar o helper e ajustar o view-model do personagem:

```ts
import { resolveOfficeAvatar } from '../officeAvatar'
```

```ts
/** Altura do busto na tela (~1.25 tile): transborda para cima, ancorado no pé. */
const AVATAR_HEIGHT = 40
/** y local do "pé" do busto dentro do container (borda de baixo do tile é +16; o label fica em +18). */
const AVATAR_BASE_Y = 14

interface CharacterView {
  container: Phaser.GameObjects.Container
  /** Placeholder (corpo tintado) até a textura carregar; depois, o sprite do busto. */
  body: Phaser.GameObjects.Image
  /** Cabeça tintada — só existe enquanto o placeholder está de pé. */
  head?: Phaser.GameObjects.Image
  /** y de repouso do body — o bob volta para cá (placeholder: 4; busto: AVATAR_BASE_Y). */
  bodyBaseY: number
  hasAvatar: boolean
  lastDir: Direction
  bubble?: Phaser.GameObjects.Container
  tween?: Phaser.Tweens.Tween
  bobTween?: Phaser.Tweens.Tween
}
```

- [ ] **Step 2: `spawn()` inicia o carregamento; `face()`/`step()` viram cientes do busto**

No `spawn()`, o view ganha os campos novos e dispara o load (o resto do método — label, hit area, depth, click — fica como está):

```ts
    const view: CharacterView = { container, body, head, bodyBaseY: 4, hasAvatar: false, lastDir: occupant.dir }
    this.face(view, occupant.dir)
    this.characters.set(occupant.userId, view)
    this.loadAvatarSprite(occupant, view)
```

`face()` — flip horizontal quando o busto está de pé; comportamento antigo (deslocar a cabeça) enquanto é placeholder:

```ts
  /** Busto: flip horizontal para esquerda/direita (cima/baixo não muda — é frontal). */
  private face(view: CharacterView, dir: Direction): void {
    view.lastDir = dir
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

No `step()`, o bob passa a respeitar o `bodyBaseY` (o resto do método fica igual):

```ts
    view.bobTween = this.tweens.add({
      targets: view.body,
      y: view.bodyBaseY - 2,
      duration: STEP_MS / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => view.body.setY(view.bodyBaseY),
    })
```

- [ ] **Step 3: Carregar a textura e trocar o placeholder**

Métodos novos na cena (depois do `spawn()`):

```ts
  /**
   * Rasteriza o busto open-peeps em textura e troca o placeholder. Roda em
   * background: enquanto a imagem carrega, o boneco tintado atual segura a
   * cena; se o raster falhar, ele simplesmente fica (comportamento antigo).
   */
  private loadAvatarSprite(occupant: OfficeOccupant, view: CharacterView): void {
    const resolved = resolveOfficeAvatar(occupant)
    if (!resolved) return

    if (this.textures.exists(resolved.textureKey)) {
      this.applyAvatarSprite(view, resolved.textureKey)
      return
    }

    const img = new Image()
    img.onload = () => {
      // O occupant pode ter saído (ou a cena morrido) durante o carregamento —
      // nesses casos o view registrado já não é este e nada deve acontecer.
      if (this.characters.get(occupant.userId) !== view) return
      if (!this.textures.exists(resolved.textureKey)) {
        this.textures.addImage(resolved.textureKey, img)
      }
      this.applyAvatarSprite(view, resolved.textureKey)
    }
    img.src = resolved.dataUri
  }

  private applyAvatarSprite(view: CharacterView, textureKey: string): void {
    // O SVG rasteriza a 128px e é exibido a 40px; o filtro linear é por textura
    // porque o `pixelArt: true` global usa NEAREST — que serrilharia o busto.
    this.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.LINEAR)

    view.bobTween?.stop()
    view.head?.destroy()
    view.head = undefined
    view.body.destroy()

    const sprite = this.add.image(0, AVATAR_BASE_Y, textureKey)
    sprite.setOrigin(0.5, 1)
    sprite.setDisplaySize(AVATAR_HEIGHT, AVATAR_HEIGHT)
    view.container.addAt(sprite, 0) // atrás do label (e de futuros balões)
    view.body = sprite
    view.bodyBaseY = AVATAR_BASE_Y
    view.hasAvatar = true

    // A hit area de clique cresce junto com o busto (coordenadas locais).
    const hit = view.container.input?.hitArea as Phaser.Geom.Rectangle | undefined
    hit?.setTo(-AVATAR_HEIGHT / 2, AVATAR_BASE_Y - AVATAR_HEIGHT, AVATAR_HEIGHT, AVATAR_HEIGHT)

    this.face(view, view.lastDir)
  }
```

- [ ] **Step 4: Testes + build**

Run: `pnpm --filter @legends/web test`
Expected: PASS (a cena não tem teste próprio; os testes existentes de OfficePage/bridge/socket não podem quebrar).

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Verificação manual no browser**

Run: `pnpm dev` (com Postgres de pé e seed aplicado; Node 20).

No escritório (`http://localhost:5173/escritorio` — rota protegida e `DevOnly`; faça login com um usuário do seed), verificar:

1. Seu personagem aparece como o busto do seu avatar do perfil (~40px, nome embaixo).
2. Usuário sem avatar customizado ganha um busto determinístico (não o boneco geométrico).
3. Andar para a esquerda espelha o busto; para a direita desespelha; cima/baixo mantém.
4. O bob de caminhada continua; clique no busto abre o `CharacterCard`; balão de fala aparece acima da cabeça.
5. Segunda aba/reconexão: personagens re-spawnam já com busto (textura em cache).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(web): busto open-peeps como personagem do escritório"
```

---

### Task 4: Corpo sob o busto (feedback pós-v1)

**Contexto:** o usuário viu o v1 e pediu corpo — o busto flutuando sozinho não
lê como personagem. Decisão aprovada (spec v1.1): busto ~34px sobre duas
perninhas procedurais tintadas com o `clothingColor` do occupant escurecido,
total ~44px, pés na borda de baixo do tile. Bob do busto mantido; perninhas
alternam uma elevação sutil por passo.

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`

**Interfaces:**
- Consumes: `resolveOfficeAvatar` (Task 2), `OfficeOccupant.clothingColor` (já
  existia no contrato).
- Produces: nada — mudança final de composição visual, verificação manual.

- [ ] **Step 1: Constantes e texture das perninhas**

Substituir as constantes do busto (linhas ~21-23):

```ts
/** Altura do busto na tela; com as perninhas o personagem fecha em ~44px. */
const AVATAR_HEIGHT = 34
/** y local do "quadril" — onde o busto (origin no pé) encontra as perninhas. */
const AVATAR_BASE_Y = 6
/** Perninhas procedurais: do quadril até a borda de baixo do tile (+16, label em +18). */
const LEG_TOP_Y = 5
const LEG_HEIGHT = 9
const LEG_OFFSET_X = 4
```

No `preload()`, junto das texturas `char-body`/`char-head`, gerar a perninha
branca (tintável):

```ts
    g.clear()
    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(0, 0, 5, LEG_HEIGHT, 2)
    g.generateTexture('char-leg', 5, LEG_HEIGHT)
```

Helper de cor no nível do módulo (junto de `tileCenter`):

```ts
/** Escurece um hex (sem `#`) — as "calças" destacam do tronco sem paleta nova. */
function darken(hex: string, factor: number): number {
  const n = Number.parseInt(hex, 16)
  const r = Math.round(((n >> 16) & 0xff) * factor)
  const g = Math.round(((n >> 8) & 0xff) * factor)
  const b = Math.round((n & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}
```

- [ ] **Step 2: `CharacterView` ganha as pernas e a alternância do passo**

```ts
  /** Perninhas do busto — só existem depois do swap (hasAvatar). */
  legs?: [Phaser.GameObjects.Image, Phaser.GameObjects.Image]
  /** Alterna qual perninha "dá o passo" a cada movimento. */
  stepLeft?: boolean
  legTween?: Phaser.Tweens.Tween
```

- [ ] **Step 3: `applyAvatarSprite` monta busto + perninhas**

O método passa a receber a cor da roupa — ajuste as DUAS chamadas em
`loadAvatarSprite` para `this.applyAvatarSprite(view, resolved.textureKey,
occupant.clothingColor)` — e monta o conjunto:

```ts
  private applyAvatarSprite(view: CharacterView, textureKey: string, clothingColor: string): void {
    // O SVG rasteriza a 128px e é exibido a 34px; o filtro linear é por textura
    // porque o `pixelArt: true` global usa NEAREST — que serrilharia o busto.
    this.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.LINEAR)

    view.bobTween?.stop()
    view.head?.destroy()
    view.head = undefined
    view.body.destroy()

    // Perninhas primeiro (ficam atrás do busto), depois o busto — tudo atrás
    // do label (e de futuros balões), por isso os addAt em 0/1/2.
    const pants = darken(clothingColor, 0.55)
    const legLeft = this.add.image(-LEG_OFFSET_X, LEG_TOP_Y, 'char-leg')
    const legRight = this.add.image(LEG_OFFSET_X, LEG_TOP_Y, 'char-leg')
    for (const leg of [legLeft, legRight]) {
      leg.setOrigin(0.5, 0)
      leg.setTint(pants)
    }

    const sprite = this.add.image(0, AVATAR_BASE_Y, textureKey)
    sprite.setOrigin(0.5, 1)
    sprite.setDisplaySize(AVATAR_HEIGHT, AVATAR_HEIGHT)

    view.container.addAt(legLeft, 0)
    view.container.addAt(legRight, 1)
    view.container.addAt(sprite, 2)
    view.body = sprite
    view.legs = [legLeft, legRight]
    view.bodyBaseY = AVATAR_BASE_Y
    view.hasAvatar = true

    // A hit area de clique cobre busto + perninhas (coordenadas locais).
    const hit = view.container.input?.hitArea as Phaser.Geom.Rectangle | undefined
    hit?.setTo(-AVATAR_HEIGHT / 2, AVATAR_BASE_Y - AVATAR_HEIGHT, AVATAR_HEIGHT, AVATAR_HEIGHT + LEG_TOP_Y + LEG_HEIGHT - AVATAR_BASE_Y)

    this.face(view, view.lastDir)
  }
```

- [ ] **Step 4: passo anima uma perninha por vez**

No `step()`, depois do bloco do `bobTween`, adicionar (e parar o tween no
início do método junto dos demais — `view.legTween?.stop()` ao lado de
`view.bobTween?.stop()`; idem em `destroyCharacter`):

```ts
    // Passo das perninhas: uma de cada vez dá um "chute" sutil para cima.
    if (view.legs) {
      const leg = view.legs[view.stepLeft ? 0 : 1]
      view.stepLeft = !view.stepLeft
      view.legTween = this.tweens.add({
        targets: leg,
        y: LEG_TOP_Y - 2,
        duration: STEP_MS / 2,
        yoyo: true,
        ease: 'Sine.easeInOut',
        onComplete: () => leg.setY(LEG_TOP_Y),
      })
    }
```

Atenção ao detalhe do padrão da cena: `legTween?.stop()` pode deixar a perninha
fora do lugar (tween parado no meio) — por isso o stop deve vir acompanhado de
re-assentar as duas: `view.legs?.forEach((l) => l.setY(LEG_TOP_Y))` logo após o
stop no `step()`.

- [ ] **Step 5: Verificação**

Run: `pnpm --filter @legends/web test`
Expected: PASS (com as 2 falhas pré-existentes do ProfilePage).

Run: `pnpm build`
Expected: PASS.

Verificação manual no browser (controller): personagem com corpo completo
(busto + perninhas), pernas alternando no andar, flip funciona, clique abre o
card, tamanho não invade demais o tile de cima.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(web): perninhas sob o busto — personagem de corpo inteiro"
```
