# Resenha — GIFs (Tenor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir anexar 1 GIF (buscado no Tenor) a uma resenha e a um comentário, exibido no feed.

**Architecture:** Backend faz proxy ao Tenor (chave fica no servidor) e expõe `/gifs/search` + `/gifs/config`. O GIF é referenciado pela URL do CDN do Tenor + dimensões, gravado em colunas nullable em `Review`/`ReviewComment`. O front tem um `GifPicker` acionado por um botão GIF nos composers; o GIF escolhido vai no corpo de criação e é renderizado no card/comentário.

**Tech Stack:** Fastify 4 + Prisma 5 + Zod (api), Vite/React 18 + React Query + Tailwind (web), Vitest, `@legends/shared` (contrato). Tenor REST API v2.

## Global Constraints

- TypeScript **strict**, ESM puro; mensagens ao usuário em **português**.
- Camadas: route fina (Zod `safeParse` → `400 { message, issues }`), lógica no service (erros `ReviewError` com `status`), DTO em `serialize.ts`, contrato em `@legends/shared` **primeiro**.
- Front sempre fala com a API por `/api` (proxy); `apiFetch` só manda `Content-Type: application/json` quando há corpo.
- Testes Vitest colocados ao lado do código; API testa contra Postgres real (`pnpm db:up` antes). Rodar `pnpm test` antes de concluir.
- **Nunca editar migration já aplicada**; gerar nova com `pnpm db:migrate`.
- `build`/Vitest **não** fazem typecheck — rodar `npx tsc --noEmit -p <workspace>` ao mudar DTOs/includes Prisma.
- Máximo **1 GIF** por post/comentário. Hosts aceitos no `gifUrl`: `media.tenor.com`, `c.tenor.com`. Atribuição "Powered by Tenor" no picker. Botão GIF some quando o backend reporta `enabled: false`.

---

### Task 1: Contrato compartilhado (`@legends/shared`)

**Files:**
- Create: `packages/shared/src/gif.ts`
- Modify: `packages/shared/src/index.ts` (barril), `packages/shared/src/review.ts`

**Interfaces:**
- Produces: `TENOR_MEDIA_HOSTS`, `GifResult`, `AttachedGif`, `GifSearchResponse`; `ReviewDTO.gif`, `ReviewCommentDTO.gif` (`AttachedGif | null`); `CreateReviewRequest.gif?`, `CreateReviewCommentRequest.gif?`.

- [ ] **Step 1: Criar `packages/shared/src/gif.ts`**

```ts
/** Hosts de CDN do Tenor aceitos ao gravar/exibir um GIF. */
export const TENOR_MEDIA_HOSTS = ['media.tenor.com', 'c.tenor.com'] as const

/** Resultado de busca devolvido pelo picker. */
export interface GifResult {
  id: string
  url: string // URL do .gif (exibir/gravar)
  previewUrl: string // still/preview leve para a grade do picker
  width: number
  height: number
  description: string // content_description do Tenor (alt)
}

/** GIF anexado, como persistido/serializado. */
export interface AttachedGif {
  url: string
  width: number
  height: number
}

export interface GifSearchResponse {
  results: GifResult[]
  next: string | null // cursor de paginação do Tenor
}
```

- [ ] **Step 2: Exportar no barril `packages/shared/src/index.ts`**

Adicionar, junto aos demais `export *`:

```ts
export * from './gif'
```

- [ ] **Step 3: Estender os DTOs e requests em `packages/shared/src/review.ts`**

No topo do arquivo, ajustar o import existente de `./feedback` mantendo-o e adicionar import do gif:

```ts
import type { AttachedGif } from './gif'
```

Em `ReviewDTO`, adicionar o campo (logo após `content`):

```ts
  /** GIF anexado, ou null. */
  gif: AttachedGif | null
```

Em `ReviewCommentDTO`, adicionar (após `content`):

```ts
  gif: AttachedGif | null
```

Em `CreateReviewRequest` e `CreateReviewCommentRequest`, adicionar (após `mentionedUserIds?`):

```ts
  gif?: AttachedGif
```

- [ ] **Step 4: Verificar typecheck do shared**

Run: `pnpm --filter @legends/shared run build`
Expected: build sem erros (gera tipos; `gif.ts` e os campos novos compilam).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/gif.ts packages/shared/src/index.ts packages/shared/src/review.ts
git commit -m "feat(shared): contrato de GIF na resenha (GifResult, AttachedGif, DTOs)"
```

---

### Task 2: Migration — colunas de GIF em `Review` e `ReviewComment`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Review` ~469-484, model `ReviewComment` ~486-500)
- Create: `apps/api/prisma/migrations/<timestamp>_review_gif/migration.sql` (gerado)

**Interfaces:**
- Produces: campos Prisma `gifUrl/gifWidth/gifHeight` (nullable) em `Review` e `ReviewComment`.

- [ ] **Step 1: Adicionar os campos no `model Review`**

Dentro de `model Review`, após `updatedAt DateTime @updatedAt`:

```prisma
  gifUrl    String?
  gifWidth  Int?
  gifHeight Int?
```

- [ ] **Step 2: Adicionar os campos no `model ReviewComment`**

Dentro de `model ReviewComment`, após `createdAt DateTime @default(now())`:

```prisma
  gifUrl    String?
  gifWidth  Int?
  gifHeight Int?
```

- [ ] **Step 3: Garantir Postgres de pé e gerar a migration**

Run: `pnpm db:up && pnpm db:migrate`
Quando pedir o nome da migration, usar: `review_gif`
Expected: cria `..._review_gif/migration.sql` com `ALTER TABLE "Review" ADD COLUMN ...` e idem para `ReviewComment`; Prisma Client regenerado.

- [ ] **Step 4: Verificar typecheck da API (client novo)**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: sem erros (os tipos `Review.gifUrl` etc. existem).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): migration de colunas de GIF em Review e ReviewComment"
```

---

### Task 3: Tenor client + config (`lib/tenor-client.ts`)

**Files:**
- Create: `apps/api/src/lib/tenor-client.ts`, `apps/api/src/lib/tenor-client.test.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: `GifResult`, `GifSearchResponse`, `TENOR_MEDIA_HOSTS` (Task 1).
- Produces: `gifsEnabled(env?): boolean`; `class TenorError extends Error { status }`; `searchGifs(input: { query: string; pos?: string; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }): Promise<GifSearchResponse>`.

- [ ] **Step 1: Escrever o teste falho `apps/api/src/lib/tenor-client.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { gifsEnabled, searchGifs, TenorError } from './tenor-client'

const tenorPayload = {
  results: [
    {
      id: 'abc',
      content_description: 'happy cat',
      media_formats: {
        gif: { url: 'https://media.tenor.com/abc.gif', dims: [320, 240] },
        tinygif: { url: 'https://media.tenor.com/abc-tiny.gif', dims: [120, 90] },
      },
    },
  ],
  next: '10',
}

function fakeFetch(payload: unknown, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload })) as unknown as typeof fetch
}

describe('tenor-client', () => {
  it('gifsEnabled reflete a presença da chave', () => {
    expect(gifsEnabled({})).toBe(false)
    expect(gifsEnabled({ TENOR_API_KEY: 'k' })).toBe(true)
  })

  it('mapeia a resposta do Tenor para GifSearchResponse', async () => {
    const fetchImpl = fakeFetch(tenorPayload)
    const res = await searchGifs({ query: 'cat', env: { TENOR_API_KEY: 'k' }, fetchImpl })
    expect(res.next).toBe('10')
    expect(res.results).toEqual([
      {
        id: 'abc',
        url: 'https://media.tenor.com/abc.gif',
        previewUrl: 'https://media.tenor.com/abc-tiny.gif',
        width: 320,
        height: 240,
        description: 'happy cat',
      },
    ])
  })

  it('lança TenorError 503 sem chave configurada', async () => {
    await expect(searchGifs({ query: 'cat', env: {}, fetchImpl: fakeFetch(tenorPayload) })).rejects.toMatchObject({
      status: 503,
    })
  })

  it('usa o endpoint featured quando a query é vazia', async () => {
    const fetchImpl = fakeFetch({ results: [], next: '' })
    await searchGifs({ query: '', env: { TENOR_API_KEY: 'k' }, fetchImpl })
    const calledUrl = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string
    expect(calledUrl).toContain('/featured')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- tenor-client`
Expected: FAIL (módulo `./tenor-client` não existe).

- [ ] **Step 3: Implementar `apps/api/src/lib/tenor-client.ts`**

```ts
import type { GifResult, GifSearchResponse } from '@legends/shared'

export class TenorError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'TenorError'
  }
}

/** Há chave do Tenor configurada? (controla a exibição do recurso) */
export function gifsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TENOR_API_KEY)
}

interface TenorFormat {
  url: string
  dims: [number, number]
}
interface TenorItem {
  id: string
  content_description?: string
  media_formats: { gif?: TenorFormat; tinygif?: TenorFormat }
}
interface TenorResponse {
  results: TenorItem[]
  next?: string
}

function mapItem(item: TenorItem): GifResult | null {
  const gif = item.media_formats.gif
  if (!gif) return null
  const preview = item.media_formats.tinygif ?? gif
  return {
    id: item.id,
    url: gif.url,
    previewUrl: preview.url,
    width: gif.dims?.[0] ?? 0,
    height: gif.dims?.[1] ?? 0,
    description: item.content_description ?? 'GIF',
  }
}

export async function searchGifs(input: {
  query: string
  pos?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}): Promise<GifSearchResponse> {
  const env = input.env ?? process.env
  const key = env.TENOR_API_KEY
  if (!key) throw new TenorError('Busca de GIFs não está configurada.', 503)
  const doFetch = input.fetchImpl ?? fetch

  const endpoint = input.query.trim() ? 'search' : 'featured'
  const params = new URLSearchParams({
    key,
    limit: '24',
    media_filter: 'gif,tinygif',
    contentfilter: 'high',
  })
  if (env.TENOR_CLIENT_KEY) params.set('client_key', env.TENOR_CLIENT_KEY)
  if (input.query.trim()) params.set('q', input.query.trim())
  if (input.pos) params.set('pos', input.pos)

  const res = await doFetch(`https://tenor.googleapis.com/v2/${endpoint}?${params.toString()}`)
  if (!res.ok) throw new TenorError('Falha ao buscar GIFs no Tenor.', 502)
  const data = (await res.json()) as TenorResponse
  return {
    results: data.results.map(mapItem).filter((r): r is GifResult => r !== null),
    next: data.next ? data.next : null,
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- tenor-client`
Expected: PASS (4 testes).

- [ ] **Step 5: Atualizar `apps/api/.env.example`**

Adicionar ao final:

```
# Busca de GIFs na Resenha (opcional). Sem TENOR_API_KEY, o recurso fica oculto.
TENOR_API_KEY=
TENOR_CLIENT_KEY=engineering-legends
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/tenor-client.ts apps/api/src/lib/tenor-client.test.ts apps/api/.env.example
git commit -m "feat(api): cliente Tenor + flag gifsEnabled"
```

---

### Task 4: Rotas de GIF (`routes/gifs.ts`) + registro

**Files:**
- Create: `apps/api/src/routes/gifs.ts`, `apps/api/src/routes/gifs.test.ts`
- Modify: `apps/api/src/app.ts` (import + `app.register`)

**Interfaces:**
- Consumes: `searchGifs`, `gifsEnabled`, `TenorError` (Task 3).
- Produces: `GET /gifs/config` → `{ enabled: boolean }` (público); `GET /gifs/search?q=&pos=` (auth) → `GifSearchResponse`; `export async function gifRoutes(app)`.

- [ ] **Step 1: Escrever o teste falho `apps/api/src/routes/gifs.test.ts`**

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../app'

// Mesmo padrão de auth de review.test.ts: registrar devolve accessToken.
async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Gi', email: 'gi@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  return { app, token }
}
function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('rotas de GIF', () => {
  const original = process.env.TENOR_API_KEY
  afterEach(() => {
    if (original === undefined) delete process.env.TENOR_API_KEY
    else process.env.TENOR_API_KEY = original
    vi.restoreAllMocks()
  })

  it('/gifs/config reflete a flag', async () => {
    process.env.TENOR_API_KEY = 'k'
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/gifs/config' })
    expect(res.json()).toEqual({ enabled: true })
    await app.close()
  })

  it('/gifs/search devolve resultados (auth)', async () => {
    process.env.TENOR_API_KEY = 'k'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { id: '1', content_description: 'oi', media_formats: { gif: { url: 'https://media.tenor.com/a.gif', dims: [10, 20] } } },
        ],
        next: '5',
      }),
    } as Response)
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/gifs/search?q=oi', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().results[0].url).toBe('https://media.tenor.com/a.gif')
    expect(res.json().next).toBe('5')
    await app.close()
  })

  it('/gifs/search sem chave responde 503', async () => {
    delete process.env.TENOR_API_KEY
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/gifs/search?q=oi', headers: auth(token) })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('/gifs/search sem auth responde 401', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/gifs/search?q=oi' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- gifs`
Expected: FAIL (`gifRoutes`/rota não existe → 404).

- [ ] **Step 3: Implementar `apps/api/src/routes/gifs.ts`**

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { gifsEnabled, searchGifs, TenorError } from '../lib/tenor-client'

const searchQuery = z.object({ q: z.string().optional(), pos: z.string().optional() })

export async function gifRoutes(app: FastifyInstance) {
  app.get('/gifs/config', async (_request, reply) => {
    return reply.send({ enabled: gifsEnabled() })
  })

  app.get('/gifs/search', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = searchQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ message: 'Busca inválida.', issues: parsed.error.flatten() })
    try {
      const result = await searchGifs({ query: parsed.data.q ?? '', pos: parsed.data.pos })
      return reply.send(result)
    } catch (err) {
      if (err instanceof TenorError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
```

- [ ] **Step 4: Registrar em `apps/api/src/app.ts`**

Após `import { reviewRoutes } from './routes/review'`:

```ts
import { gifRoutes } from './routes/gifs'
```

Junto aos demais `app.register(...)` (ex.: perto de `app.register(reviewRoutes)`):

```ts
  app.register(gifRoutes)
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- gifs`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/gifs.ts apps/api/src/routes/gifs.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas /gifs/config e /gifs/search (proxy Tenor)"
```

---

### Task 5: Review service — aceitar e validar GIF

**Files:**
- Modify: `apps/api/src/services/review-service.ts` (`createReview` ~66-87, `createComment` ~159-190, helper de validação ~32-38)
- Test: `apps/api/src/services/review-service.test.ts`

**Interfaces:**
- Consumes: `TENOR_MEDIA_HOSTS`, `AttachedGif` (Task 1); colunas Prisma (Task 2).
- Produces: `createReview`/`createComment` aceitam `gif?: AttachedGif`; persistem `gifUrl/gifWidth/gifHeight`; validam "conteúdo OU gif" e host do GIF.

- [ ] **Step 1: Escrever os testes falhos (anexar em `review-service.test.ts`, dentro de um novo `describe`)**

```ts
import { TENOR_MEDIA_HOSTS } from '@legends/shared'

describe('review-service: gif', () => {
  it('cria resenha com gif (texto + gif)', async () => {
    const u = await makeUser('gif1@empresa.com')
    const review = await createReview({
      authorId: u.id,
      content: 'olha esse',
      gif: { url: 'https://media.tenor.com/x.gif', width: 100, height: 80 },
    })
    expect(review.gifUrl).toBe('https://media.tenor.com/x.gif')
    expect(review.gifWidth).toBe(100)
    expect(review.gifHeight).toBe(80)
  })

  it('cria resenha só com gif (sem texto)', async () => {
    const u = await makeUser('gif2@empresa.com')
    const review = await createReview({
      authorId: u.id,
      content: '',
      gif: { url: 'https://media.tenor.com/y.gif', width: 1, height: 1 },
    })
    expect(review.content).toBe('')
    expect(review.gifUrl).toBe('https://media.tenor.com/y.gif')
  })

  it('rejeita vazio sem gif (400)', async () => {
    const u = await makeUser('gif3@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ' })).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita gif de host fora da allowlist (400)', async () => {
    const u = await makeUser('gif4@empresa.com')
    await expect(
      createReview({ authorId: u.id, content: 'x', gif: { url: 'https://evil.example/z.gif', width: 1, height: 1 } }),
    ).rejects.toMatchObject({ status: 400 })
    expect(TENOR_MEDIA_HOSTS).toContain('media.tenor.com')
  })
})
```

> Nota: `makeUser`/`createReview` já são usados no arquivo; reaproveite os mesmos imports/helpers existentes.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- review-service`
Expected: FAIL (campo `gif` não aceito / `gifUrl` undefined / não rejeita).

- [ ] **Step 3: Implementar a validação e a persistência em `review-service.ts`**

No topo, estender o import do shared:

```ts
import { REVIEW_MAX_LENGTH, REVIEW_REACTIONS, MAX_REVIEW_MENTIONS, TENOR_MEDIA_HOSTS, type AttachedGif } from '@legends/shared'
```

Adicionar dois helpers perto de `assertContent` (~38):

```ts
/** Conteúdo da resenha: texto (1..MAX) OU presença de gif. Devolve o texto já trimado (pode ser ''). */
function assertContentOrGif(content: string, gif?: AttachedGif): string {
  const trimmed = content.trim()
  if (trimmed.length > REVIEW_MAX_LENGTH) {
    throw new ReviewError(`O texto precisa ter no máximo ${REVIEW_MAX_LENGTH} caracteres.`, 400)
  }
  if (trimmed.length === 0 && !gif) {
    throw new ReviewError('Escreva algo ou anexe um GIF.', 400)
  }
  return trimmed
}

/** Valida que a URL do gif aponta para um host de CDN do Tenor permitido. */
function assertGifHost(gif?: AttachedGif): void {
  if (!gif) return
  let host = ''
  try {
    host = new URL(gif.url).host
  } catch {
    throw new ReviewError('GIF inválido.', 400)
  }
  if (!(TENOR_MEDIA_HOSTS as readonly string[]).includes(host)) {
    throw new ReviewError('GIF inválido.', 400)
  }
}
```

Em `createReview`, trocar a validação e o `data`:

```ts
export async function createReview(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
}): Promise<ReviewWithRelations> {
  const content = assertContentOrGif(input.content, input.gif)
  assertGifHost(input.gif)
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new ReviewError('Autor inválido.', 400)
  }
  const mentions = await resolveMentions(input.mentionedUserIds)
  return prisma.review.create({
    data: {
      authorId: input.authorId,
      content,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(mentions.length
        ? { mentions: { create: mentions.map((m) => ({ userId: m.userId, name: m.name })) } }
        : {}),
    },
    include: reviewInclude,
  })
}
```

Em `createComment`, espelhar: adicionar `gif?: AttachedGif` no input, trocar `assertContent` por `assertContentOrGif(input.content, input.gif)` + `assertGifHost(input.gif)`, e no `data` do `prisma.reviewComment.create` adicionar o mesmo spread `...(input.gif ? { gifUrl, gifWidth, gifHeight } : {})`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- review-service`
Expected: PASS (incluindo o novo describe).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/review-service.ts apps/api/src/services/review-service.test.ts
git commit -m "feat(api): service aceita e valida GIF (conteúdo-ou-gif, host Tenor)"
```

---

### Task 6: Rotas de criação + serialize do GIF

**Files:**
- Modify: `apps/api/src/routes/review.ts` (`contentSchema` ~35-40, POST `/reviews` ~60-84, POST `/reviews/:id/comments` ~174+)
- Modify: `apps/api/src/lib/serialize.ts` (`toReviewDTO` ~224-239, `toReviewCommentDTO` ~241-249)
- Test: `apps/api/src/routes/review.test.ts`, `apps/api/src/lib/serialize.test.ts`

**Interfaces:**
- Consumes: `createReview`/`createComment` com `gif` (Task 5); `AttachedGif` (Task 1).
- Produces: POST `/reviews` e `/reviews/:id/comments` aceitam `gif` no corpo; `toReviewDTO`/`toReviewCommentDTO` retornam `gif`.

- [ ] **Step 1: Escrever testes falhos**

Em `apps/api/src/routes/review.test.ts`, adicionar:

```ts
it('cria resenha só com gif (sem texto) e serializa o gif', async () => {
  const { app, token } = await setup()
  const r = await app.inject({
    method: 'POST',
    url: '/reviews',
    headers: auth(token),
    payload: { content: '', gif: { url: 'https://media.tenor.com/g.gif', width: 200, height: 150 } },
  })
  expect(r.statusCode).toBe(201)
  expect(r.json().review.gif).toEqual({ url: 'https://media.tenor.com/g.gif', width: 200, height: 150 })
  await app.close()
})
```

Em `apps/api/src/lib/serialize.test.ts`, adicionar um caso que monta um `ReviewWithRelations` (ou usa o factory já presente no arquivo) com `gifUrl/gifWidth/gifHeight` setados e espera `dto.gif` correspondente, e `null` quando ausente. (Siga o estilo do teste existente nesse arquivo.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- review.test serialize`
Expected: FAIL (`gif` não no DTO; corpo rejeitado por content min(1)).

- [ ] **Step 3: Relaxar o schema da rota e repassar o gif (`review.ts`)**

Estender o import do shared no topo com `type AttachedGif` e adicionar um schema de gif. Trocar `contentSchema`:

```ts
const gifSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
const contentSchema = z
  .object({
    content: z.string().trim().max(REVIEW_MAX_LENGTH).optional().default(''),
    mentionedUserIds: z.array(z.string()).max(MAX_REVIEW_MENTIONS).optional(),
    gif: gifSchema.optional(),
  })
  .refine((v) => v.content.trim().length >= 1 || v.gif, { message: 'Escreva algo ou anexe um GIF.' })
const invalidContent = { message: `Escreva algo (até ${REVIEW_MAX_LENGTH} caracteres) ou anexe um GIF.` }
```

No handler POST `/reviews`, passar o gif ao service:

```ts
      const review = await createReview({
        authorId: request.user.sub,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
      })
```

No handler POST `/reviews/:id/comments`, idem: adicionar `gif: parsed.data.gif` ao objeto passado para `createComment`.

- [ ] **Step 4: Incluir o gif no serialize (`serialize.ts`)**

Em `toReviewDTO`, no objeto retornado (após `content` ou junto aos demais campos):

```ts
    gif: review.gifUrl ? { url: review.gifUrl, width: review.gifWidth ?? 0, height: review.gifHeight ?? 0 } : null,
```

Em `toReviewCommentDTO`, adicionar a mesma linha usando `comment.gifUrl/gifWidth/gifHeight`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- review.test serialize`
Expected: PASS.

- [ ] **Step 6: Typecheck + suíte da API**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json && pnpm --filter @legends/api test`
Expected: tsc sem erros; todos os testes da API passam.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/review.ts apps/api/src/lib/serialize.ts apps/api/src/routes/review.test.ts apps/api/src/lib/serialize.test.ts
git commit -m "feat(api): aceitar gif na criação de resenha/comentário e serializar"
```

---

### Task 7: Web — hooks de GIF (`lib/use-gifs.ts`)

**Files:**
- Create: `apps/web/src/lib/use-gifs.ts`, `apps/web/src/lib/use-gifs.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`apps/web/src/lib/api.ts`); `GifSearchResponse`, `GifResult` (Task 1).
- Produces: `useGifsEnabled(): boolean`; `useGifSearch(query: string): { results: GifResult[]; fetchNextPage; hasNextPage; isLoading }`.

- [ ] **Step 1: Escrever o teste falho `apps/web/src/lib/use-gifs.test.tsx`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useGifsEnabled } from './use-gifs'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useGifsEnabled', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true }),
    } as Response)
  })

  it('retorna true quando /gifs/config diz enabled', async () => {
    const { result } = renderHook(() => useGifsEnabled(), { wrapper })
    await waitFor(() => expect(result.current).toBe(true))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- use-gifs`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `apps/web/src/lib/use-gifs.ts`**

```ts
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { GifSearchResponse } from '@legends/shared'
import { apiFetch } from './api'

/** Flag pública: o backend tem chave do Tenor? (controla o botão GIF) */
export function useGifsEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['gifs', 'config'],
    queryFn: () => apiFetch<{ enabled: boolean }>('/gifs/config'),
    staleTime: 5 * 60 * 1000,
  })
  return data?.enabled ?? false
}

/** Busca paginada de GIFs. `query` vazio → featured. */
export function useGifSearch(query: string) {
  const q = useInfiniteQuery({
    queryKey: ['gifs', 'search', query],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) =>
      apiFetch<GifSearchResponse>(
        `/gifs/search?q=${encodeURIComponent(query)}${pageParam ? `&pos=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  })
  return {
    results: q.data?.pages.flatMap((p) => p.results) ?? [],
    fetchNextPage: q.fetchNextPage,
    hasNextPage: q.hasNextPage,
    isLoading: q.isLoading,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- use-gifs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-gifs.ts apps/web/src/lib/use-gifs.test.tsx
git commit -m "feat(web): hooks useGifsEnabled e useGifSearch"
```

---

### Task 8: Web — `GifPicker`

**Files:**
- Create: `apps/web/src/components/GifPicker.tsx`, `apps/web/src/components/GifPicker.test.tsx`

**Interfaces:**
- Consumes: `useGifSearch` (Task 7); `GifResult` (Task 1).
- Produces: `<GifPicker onSelect={(gif: GifResult) => void} onClose={() => void} />`.

- [ ] **Step 1: Escrever o teste falho `apps/web/src/components/GifPicker.test.tsx`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { GifResult } from '@legends/shared'
import { GifPicker } from './GifPicker'

const sample: GifResult[] = [
  { id: '1', url: 'https://media.tenor.com/a.gif', previewUrl: 'https://media.tenor.com/a-t.gif', width: 100, height: 80, description: 'gato' },
]

vi.mock('../lib/use-gifs', () => ({
  useGifSearch: () => ({ results: sample, fetchNextPage: vi.fn(), hasNextPage: false, isLoading: false }),
}))

describe('GifPicker', () => {
  it('renderiza a grade e chama onSelect ao clicar', () => {
    const onSelect = vi.fn()
    render(<GifPicker onSelect={onSelect} onClose={() => {}} />)
    const img = screen.getByAltText('gato')
    fireEvent.click(img)
    expect(onSelect).toHaveBeenCalledWith(sample[0])
  })

  it('mostra a atribuição do Tenor', () => {
    render(<GifPicker onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/Tenor/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- GifPicker`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `apps/web/src/components/GifPicker.tsx`**

```tsx
import { useState } from 'react'
import type { GifResult } from '@legends/shared'
import { useGifSearch } from '../lib/use-gifs'
import { Icon } from './Icon'

export function GifPicker({
  onSelect,
  onClose,
}: {
  onSelect: (gif: GifResult) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const { results, fetchNextPage, hasNextPage, isLoading } = useGifSearch(query)

  return (
    <div className="absolute z-30 mt-1 w-80 rounded-lg border border-outline-variant/40 bg-surface-container p-sm shadow-lg">
      <div className="mb-sm flex items-center gap-xs">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar GIF…"
          aria-label="Buscar GIF"
          className="flex-1 rounded-full border border-outline-variant/60 bg-transparent px-sm py-1 text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
        />
        <button type="button" onClick={onClose} aria-label="Fechar" className="text-on-surface-variant hover:text-on-surface">
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
      <div className="grid max-h-72 grid-cols-2 gap-xs overflow-auto">
        {results.map((gif) => (
          <button
            key={gif.id}
            type="button"
            onClick={() => onSelect(gif)}
            className="overflow-hidden rounded-md border border-outline-variant/40 hover:border-primary"
          >
            <img src={gif.previewUrl} alt={gif.description} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
        {isLoading && <span className="col-span-2 py-2 text-center text-label-sm text-on-surface-variant">Carregando…</span>}
        {!isLoading && results.length === 0 && (
          <span className="col-span-2 py-2 text-center text-label-sm text-on-surface-variant">Nenhum GIF encontrado.</span>
        )}
      </div>
      <div className="mt-sm flex items-center justify-between">
        {hasNextPage ? (
          <button type="button" onClick={() => fetchNextPage()} className="text-label-sm text-primary hover:underline">
            Carregar mais
          </button>
        ) : (
          <span />
        )}
        <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">Powered by Tenor</span>
      </div>
    </div>
  )
}
```

> Nota: confirme o nome do ícone de fechar usado no projeto (ex.: `close`) em `components/Icon`; ajuste se necessário.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- GifPicker`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/GifPicker.tsx apps/web/src/components/GifPicker.test.tsx
git commit -m "feat(web): GifPicker com busca, grade e atribuição Tenor"
```

---

### Task 9: Composer do post — botão GIF + preview

**Files:**
- Modify: `apps/web/src/pages/resenha/ReviewComposer.tsx`, `apps/web/src/pages/resenha/ResenhaFeed.tsx` (~55-56)
- Test: `apps/web/src/pages/resenha/ReviewComposer.test.tsx` (criar)

**Interfaces:**
- Consumes: `GifPicker` (Task 8), `useGifsEnabled` (Task 7), `AttachedGif`/`GifResult` (Task 1).
- Produces: `ReviewComposer` com `onSubmit: (content: string, mentionedUserIds: string[], gif: AttachedGif | null) => void`.

- [ ] **Step 1: Escrever o teste falho `apps/web/src/pages/resenha/ReviewComposer.test.tsx`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewComposer } from './ReviewComposer'

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Eu' } }) }))
vi.mock('../../lib/use-colleagues', () => ({ useColleagues: () => ({ data: [] }) }))
vi.mock('../../lib/use-gifs', () => ({
  useGifsEnabled: () => true,
  useGifSearch: () => ({
    results: [{ id: '1', url: 'https://media.tenor.com/a.gif', previewUrl: 'https://media.tenor.com/a-t.gif', width: 10, height: 8, description: 'gato' }],
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isLoading: false,
  }),
}))

describe('ReviewComposer + GIF', () => {
  it('anexar GIF permite publicar sem texto e envia o gif', () => {
    const onSubmit = vi.fn()
    render(<ReviewComposer onSubmit={onSubmit} pending={false} />)
    fireEvent.click(screen.getByRole('button', { name: /gif/i }))
    fireEvent.click(screen.getByAltText('gato'))
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(onSubmit).toHaveBeenCalledWith('', [], { url: 'https://media.tenor.com/a.gif', width: 10, height: 8 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- ReviewComposer`
Expected: FAIL (sem botão GIF / onSubmit antigo).

- [ ] **Step 3: Atualizar `ReviewComposer.tsx`**

Imports adicionais:

```ts
import type { AttachedGif } from '@legends/shared'
import { GifPicker } from '../../components/GifPicker'
import { useGifsEnabled } from '../../lib/use-gifs'
import { Icon } from '../../components/Icon'
```

Trocar a assinatura do `onSubmit` e o corpo do componente para gerenciar gif + picker:

```tsx
export function ReviewComposer({
  onSubmit,
  pending,
}: {
  onSubmit: (content: string, mentionedUserIds: string[], gif: AttachedGif | null) => void
  pending: boolean
}) {
  const { user } = useAuth()
  const colleagues = useColleagues().data ?? []
  const gifsEnabled = useGifsEnabled()
  const [content, setContent] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [gif, setGif] = useState<AttachedGif | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const trimmed = content.trim()
  const tooLong = content.length > REVIEW_MAX_LENGTH
  const canSubmit = (trimmed.length >= 1 || gif !== null) && !tooLong && !pending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit(trimmed, mentionIds, gif)
    setContent('')
    setMentionIds([])
    setGif(null)
  }
```

Dentro do `<div className="flex flex-1 flex-col">`, abaixo do `<MentionTextarea .../>` e antes da barra de ações, inserir o preview do gif:

```tsx
        {gif && (
          <div className="relative mt-sm w-fit">
            <img src={gif.url} alt="GIF" className="max-h-48 rounded-lg border border-outline-variant/40" />
            <button
              type="button"
              onClick={() => setGif(null)}
              aria-label="Remover GIF"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-on-surface hover:bg-surface"
            >
              <Icon name="close" className="text-[16px]" />
            </button>
          </div>
        )}
```

Na barra de ações (a `div` com o contador e o botão "Publicar"), adicionar o botão GIF + picker do lado esquerdo. Substituir a `div` por:

```tsx
        <div className="flex items-center justify-between gap-sm border-t border-outline-variant/30 pt-sm">
          <div className="flex items-center gap-sm">
            {gifsEnabled && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Adicionar GIF"
                  className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                >
                  <Icon name="gif_box" className="text-[18px]" /> GIF
                </button>
                {pickerOpen && (
                  <GifPicker
                    onSelect={(g) => {
                      setGif({ url: g.url, width: g.width, height: g.height })
                      setPickerOpen(false)
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>
            )}
            <span className={`font-label text-label-sm ${tooLong ? 'text-error' : 'text-on-surface-variant'}`}>
              {content.length}/{REVIEW_MAX_LENGTH}
            </span>
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full bg-primary px-xl py-2 font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-40"
          >
            Publicar
          </button>
        </div>
```

> Nota: confirme nomes de ícone (`gif_box`, `close`) no `components/Icon`; ajuste se o set não os tiver (ex.: usar texto "GIF" sem ícone).

- [ ] **Step 4: Atualizar a fiação em `ResenhaFeed.tsx`**

Trocar (linha ~56):

```tsx
        <ReviewComposer
          onSubmit={(content, mentionedUserIds, gif) =>
            create.mutate({ content, mentionedUserIds, ...(gif ? { gif } : {}) })
          }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- ReviewComposer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/resenha/ReviewComposer.tsx apps/web/src/pages/resenha/ResenhaFeed.tsx apps/web/src/pages/resenha/ReviewComposer.test.tsx
git commit -m "feat(web): botão GIF + preview no composer da resenha"
```

---

### Task 10: Composer do comentário — botão GIF

**Files:**
- Modify: `apps/web/src/pages/resenha/ReviewComments.tsx` (estado ~32-51 e a área do `<form>`/composer ~110-118)

**Interfaces:**
- Consumes: `GifPicker`, `useGifsEnabled`, `AttachedGif`; `useCreateComment` (já recebe `CreateReviewCommentRequest` com `gif?`).

- [ ] **Step 1: Adicionar estado e imports**

Imports adicionais no topo:

```ts
import type { AttachedGif } from '@legends/shared'
import { GifPicker } from '../../components/GifPicker'
import { useGifsEnabled } from '../../lib/use-gifs'
```

No componente, junto aos outros `useState`:

```ts
  const gifsEnabled = useGifsEnabled()
  const [gif, setGif] = useState<AttachedGif | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
```

Trocar `canSubmit` e `submit`:

```ts
  const canSubmit = (trimmed.length >= 1 || gif !== null) && trimmed.length <= REVIEW_MAX_LENGTH && !create.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    create.mutate(
      { content: trimmed, mentionedUserIds: mentionIds, ...(gif ? { gif } : {}) },
      { onSuccess: () => { setText(''); setMentionIds([]); setGif(null) } },
    )
  }
```

- [ ] **Step 2: Renderizar preview do gif + botão GIF no composer do comentário**

No bloco do composer (onde está o `<MentionTextarea>` e o botão de enviar), adicionar — abaixo do textarea — o preview (igual ao do post, com `setGif(null)`), e ao lado do botão de enviar o botão GIF com o `GifPicker` condicionado a `gifsEnabled` (mesmo padrão da Task 9, Step 3). Use `aria-label="Adicionar GIF"` e `aria-label="Remover GIF"`.

- [ ] **Step 3: Verificar a suíte web e o typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json && pnpm --filter @legends/web test`
Expected: tsc sem erros; testes passam (os testes de `ReviewComments`/feed existentes continuam verdes; `useGifsEnabled` faz fetch a `/gifs/config` — se algum teste não mocka fetch e quebrar, mocke `../../lib/use-gifs` nesse teste retornando `useGifsEnabled: () => false`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/resenha/ReviewComments.tsx
git commit -m "feat(web): botão GIF + preview no composer de comentário"
```

---

### Task 11: Render do GIF no feed

**Files:**
- Modify: `apps/web/src/pages/resenha/ReviewCard.tsx` (após o `<p>` do conteúdo, ~114), `apps/web/src/pages/resenha/ReviewComments.tsx` (após o `<p>` do comentário, ~94)
- Test: `apps/web/src/pages/resenha/ReviewCard.test.tsx` (criar se não existir)

**Interfaces:**
- Consumes: `ReviewDTO.gif` / `ReviewCommentDTO.gif` (Task 1/6).

- [ ] **Step 1: Escrever o teste falho `ReviewCard.test.tsx`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReviewDTO } from '@legends/shared'
import { ReviewCard } from './ReviewCard'

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Eu', role: 'LEGEND' } }) }))
vi.mock('../../lib/use-reviews', () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleReviewReaction: () => ({ mutate: vi.fn() }),
  useToggleShare: () => ({ mutate: vi.fn(), isPending: false }),
}))

const base: ReviewDTO = {
  id: 'r1', author: { id: 'u2', name: 'Bia', email: '', role: 'LEGEND', area: null, position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
  content: 'olha', createdAt: '2026-06-29T00:00:00.000Z', reactions: [], reactors: [], reactorCount: 0,
  commentCount: 0, shareCount: 0, sharedByMe: false, mentions: [],
  gif: { url: 'https://media.tenor.com/a.gif', width: 100, height: 80 },
}

describe('ReviewCard + GIF', () => {
  it('renderiza o <img> do GIF quando presente', () => {
    render(<MemoryRouter><ul><ReviewCard review={base} /></ul></MemoryRouter>)
    const img = screen.getByRole('img', { name: 'GIF' }) as HTMLImageElement
    expect(img.src).toContain('media.tenor.com/a.gif')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- ReviewCard`
Expected: FAIL (nenhum img de GIF).

- [ ] **Step 3: Renderizar o GIF em `ReviewCard.tsx`**

Logo após o `<p>` do conteúdo (e antes do bloco de reactors):

```tsx
        {review.gif && (
          <img
            src={review.gif.url}
            alt="GIF"
            width={review.gif.width || undefined}
            height={review.gif.height || undefined}
            loading="lazy"
            className="mt-sm max-h-80 max-w-full rounded-lg border border-outline-variant/40"
          />
        )}
```

- [ ] **Step 4: Renderizar o GIF no comentário (`ReviewComments.tsx`)**

Após o `<p>` do comentário (`renderWithMentions(c.content, c.mentions)`):

```tsx
                {c.gif && (
                  <img
                    src={c.gif.url}
                    alt="GIF"
                    width={c.gif.width || undefined}
                    height={c.gif.height || undefined}
                    loading="lazy"
                    className="mt-xs max-h-64 max-w-full rounded-lg border border-outline-variant/40"
                  />
                )}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- ReviewCard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/resenha/ReviewCard.tsx apps/web/src/pages/resenha/ReviewComments.tsx apps/web/src/pages/resenha/ReviewCard.test.tsx
git commit -m "feat(web): renderizar o GIF no card e no comentário"
```

---

### Task 12: Verificação final

- [ ] **Step 1: Typecheck dos três workspaces**

Run: `pnpm --filter @legends/shared run build && npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: tudo sem erros.

- [ ] **Step 2: Suíte completa (Postgres de pé)**

Run: `pnpm db:up && pnpm test`
Expected: api e web verdes.

- [ ] **Step 3: Build web (garante que nada quebra no bundle)**

Run: `pnpm --filter @legends/web build`
Expected: build conclui.

- [ ] **Step 4: Smoke manual (opcional, requer TENOR_API_KEY no `.env`)**

Run: `pnpm dev` → abrir a Resenha → botão GIF → buscar → selecionar → publicar (com e sem texto) → ver no feed; idem em comentário. Sem chave: o botão GIF não aparece.

## Notas de cobertura do spec

- Fonte Tenor + proxy: Tasks 3, 4. Escopo post+comentário: Tasks 9, 10, 11. GIF-sozinho-ou-com-texto / máx 1: Tasks 5, 6, 9, 10. Armazenamento por URL + dimensões: Tasks 2, 5, 6. Allowlist de host: Task 5. Config/flag + botão oculto sem chave: Tasks 3, 4, 7, 9, 10. Atribuição Tenor: Task 8. Contrato shared primeiro: Task 1.
