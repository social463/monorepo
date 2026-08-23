# Resenha em Tempo Real (WebSocket) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer resenhas novas, comentários e reações aparecerem instantaneamente para quem está na rota `/resenha`, sem refresh.

**Architecture:** Reaproveita o padrão WebSocket do retro. Um hub em memória (`reviewHub`) faz fan-out de eventos "magros" para todas as conexões abertas; as rotas REST de resenha emitem um evento após cada mutation; o cliente, ao receber o evento, **invalida** a query relevante do React Query (não aplica DTO empurrado). Canal único e global (sem salas), auth só por JWT (feed é público a autenticados).

**Tech Stack:** Fastify 4 + `@fastify/websocket` (já registrado), TypeScript ESM, Vitest, React 18 + React Query, `@legends/shared` como contrato.

## Global Constraints

- **TypeScript strict, ESM puro.** Imports relativos no backend usam o caminho sem extensão como o resto do repo (`moduleResolution: bundler`); siga o padrão dos arquivos vizinhos.
- **Mensagens ao usuário em português.**
- **Contrato em `@legends/shared` primeiro:** o tipo do evento é a fonte única api⇄web.
- **Camadas finas:** broadcast é emitido **na rota** (`routes/review.ts`), não no service — segue a convenção de `routes/retro.ts`. Service permanece puro.
- **Testes da API batem em Postgres real:** rode `pnpm db:up` antes de `pnpm test`. `fileParallelism: false`, tabelas truncadas em `beforeEach`.
- **Hub preso a uma instância** (Postgres é a fonte da verdade). Redis/multi-instância é fora de escopo.
- **Não enviar mensagens do cliente→servidor:** o fluxo é unidirecional (servidor empurra).

---

## File Structure

- **Modify** `packages/shared/src/review.ts` — adiciona o tipo `ReviewEvent` (colocado no arquivo de domínio, como `RetroEvent` vive em `retro.ts`). Já é exportado pelo barril `index.ts`.
- **Create** `apps/api/src/lib/review-hub.ts` — hub em memória (singleton `reviewHub`).
- **Create** `apps/api/src/lib/review-hub.test.ts` — testes do hub.
- **Create** `apps/api/src/routes/review-ws.ts` — rota `GET /reviews/ws`.
- **Modify** `apps/api/src/services/review-service.ts` — `deleteComment` passa a retornar `{ reviewId }`.
- **Modify** `apps/api/src/routes/review.ts` — emite `reviewHub.broadcast(...)` após cada mutation.
- **Modify** `apps/api/src/routes/review.test.ts` — teste de que mutations disparam broadcast.
- **Modify** `apps/api/src/app.ts` — registra `reviewWsRoutes`.
- **Create** `apps/web/src/lib/useReviewSocket.ts` — hook cliente (conexão + invalidação).
- **Create** `apps/web/src/lib/useReviewSocket.test.tsx` — testes do hook.
- **Modify** `apps/web/src/pages/resenha/ResenhaPage.tsx` — chama `useReviewSocket()`.

---

## Task 1: Tipo `ReviewEvent` no contrato compartilhado

**Files:**
- Modify: `packages/shared/src/review.ts` (append no fim do arquivo)

**Interfaces:**
- Produces: `export type ReviewEvent` — union discriminada por `type`:
  - `{ type: 'feed:changed' }`
  - `{ type: 'review:changed'; reviewId: string }`
  - `{ type: 'comments:changed'; reviewId: string }`

- [ ] **Step 1: Adicionar o tipo ao fim de `packages/shared/src/review.ts`**

```ts
/**
 * Eventos de tempo real da resenha empurrados pelo servidor (WebSocket).
 * São "magros": carregam só o necessário para o cliente invalidar a query certa.
 */
export type ReviewEvent =
  | { type: 'feed:changed' }
  | { type: 'review:changed'; reviewId: string }
  | { type: 'comments:changed'; reviewId: string }
```

- [ ] **Step 2: Compilar o pacote shared para confirmar que o tipo exporta**

Run: `pnpm --filter @legends/shared build`
Expected: build sem erros (o tipo já é reexportado pelo barril `index.ts`, que tem `export * from './review'`).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/review.ts
git commit -m "feat(shared): tipo ReviewEvent para tempo real da resenha"
```

---

## Task 2: Hub em memória (`reviewHub`)

**Files:**
- Create: `apps/api/src/lib/review-hub.ts`
- Test: `apps/api/src/lib/review-hub.test.ts`

**Interfaces:**
- Consumes: `ReviewEvent` de `@legends/shared` (Task 1).
- Produces:
  - `interface ReviewSocket { send(data: string): void }`
  - `interface ReviewConnection { socket: ReviewSocket }`
  - `class ReviewHub` com `subscribe(conn: ReviewConnection): void`, `unsubscribe(conn: ReviewConnection): void`, `broadcast(event: ReviewEvent): void`, `size(): number`
  - `export const reviewHub: ReviewHub` (singleton)

- [ ] **Step 1: Escrever o teste que falha** em `apps/api/src/lib/review-hub.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { ReviewHub } from './review-hub'

function fakeConn() {
  return { socket: { send: vi.fn() } }
}

describe('ReviewHub', () => {
  it('faz broadcast do evento para todas as conexões inscritas', () => {
    const hub = new ReviewHub()
    const a = fakeConn()
    const b = fakeConn()
    hub.subscribe(a)
    hub.subscribe(b)

    hub.broadcast({ type: 'feed:changed' })

    const payload = JSON.stringify({ type: 'feed:changed' })
    expect(a.socket.send).toHaveBeenCalledWith(payload)
    expect(b.socket.send).toHaveBeenCalledWith(payload)
  })

  it('para de enviar após unsubscribe', () => {
    const hub = new ReviewHub()
    const a = fakeConn()
    hub.subscribe(a)
    hub.unsubscribe(a)

    hub.broadcast({ type: 'review:changed', reviewId: 'r1' })

    expect(a.socket.send).not.toHaveBeenCalled()
    expect(hub.size()).toBe(0)
  })

  it('um socket que lança no send não impede os demais', () => {
    const hub = new ReviewHub()
    const bad = { socket: { send: vi.fn(() => { throw new Error('dead') }) } }
    const good = fakeConn()
    hub.subscribe(bad)
    hub.subscribe(good)

    expect(() => hub.broadcast({ type: 'feed:changed' })).not.toThrow()
    expect(good.socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'feed:changed' }))
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/review-hub.test.ts`
Expected: FAIL — `Cannot find module './review-hub'`.

- [ ] **Step 3: Implementar** `apps/api/src/lib/review-hub.ts`

```ts
import type { ReviewEvent } from '@legends/shared'

export interface ReviewSocket {
  send(data: string): void
}

export interface ReviewConnection {
  socket: ReviewSocket
}

/**
 * Registro em memória das conexões WebSocket do feed de resenha. Canal único
 * e global (sem salas): qualquer evento vai para todas as conexões abertas.
 * Postgres é a fonte da verdade; o hub só faz fan-out. Preso a uma instância
 * (Redis/multi-instância fica como futuro, igual ao retro).
 */
export class ReviewHub {
  private conns = new Set<ReviewConnection>()

  subscribe(conn: ReviewConnection): void {
    this.conns.add(conn)
  }

  unsubscribe(conn: ReviewConnection): void {
    this.conns.delete(conn)
  }

  size(): number {
    return this.conns.size
  }

  broadcast(event: ReviewEvent): void {
    const payload = JSON.stringify(event)
    for (const conn of this.conns) {
      try {
        conn.socket.send(payload)
      } catch {
        // conexão morta: será limpa no close handler da rota
      }
    }
  }
}

export const reviewHub = new ReviewHub()
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/review-hub.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/review-hub.ts apps/api/src/lib/review-hub.test.ts
git commit -m "feat(api): ReviewHub em memória para broadcast da resenha"
```

---

## Task 3: Rota WebSocket `GET /reviews/ws` + registro no app

**Files:**
- Create: `apps/api/src/routes/review-ws.ts`
- Modify: `apps/api/src/app.ts` (import + register)

**Interfaces:**
- Consumes: `reviewHub` de `../lib/review-hub` (Task 2); `app.jwt` (já decorado em `buildApp`).
- Produces: `export async function reviewWsRoutes(app: FastifyInstance)`.

Nota: segue `routes/retro-ws.ts`, porém sem buscar nome, sem checar membership e sem `ws.on('message')` (fluxo só servidor→cliente).

- [ ] **Step 1: Implementar** `apps/api/src/routes/review-ws.ts`

```ts
import type { FastifyInstance } from 'fastify'
import { reviewHub, type ReviewConnection } from '../lib/review-hub'

export async function reviewWsRoutes(app: FastifyInstance) {
  app.get(
    '/reviews/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        try {
          app.jwt.verify(token)
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }
      },
    },
    (connection) => {
      const conn: ReviewConnection = { socket: connection.socket }
      reviewHub.subscribe(conn)
      connection.socket.on('close', () => {
        reviewHub.unsubscribe(conn)
      })
    },
  )
}
```

- [ ] **Step 2: Registrar no app** — em `apps/api/src/app.ts`, adicionar o import junto dos outros (logo após a linha que importa `retroWsRoutes`):

```ts
import { reviewWsRoutes } from './routes/review-ws'
```

E registrar logo após `app.register(retroWsRoutes)` (dentro de `buildApp`):

```ts
  app.register(reviewWsRoutes)
```

- [ ] **Step 3: Verificar que o app sobe sem erro**

Run: `pnpm --filter @legends/api exec vitest run src/routes/review.test.ts`
Expected: PASS — a suíte existente de review continua verde (a rota WS é registrada mas não afeta os testes REST atuais).

- [ ] **Step 4: Typecheck do workspace api** (mudança de wiring vale checar tipos)

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/review-ws.ts apps/api/src/app.ts
git commit -m "feat(api): rota WebSocket /reviews/ws (auth por JWT, canal global)"
```

---

## Task 4: `deleteComment` retorna `reviewId`

As rotas de comentário por `:commentId` (delete e toggle reaction) precisam do `reviewId` para emitir `comments:changed`. `toggleCommentReaction` já devolve o comentário completo (tem `comment.reviewId`), mas `deleteComment` retorna `void` e apaga a linha antes — precisa capturar o `reviewId` antes do delete.

**Files:**
- Modify: `apps/api/src/services/review-service.ts` (função `deleteComment`, linhas ~192-202)
- Test: `apps/api/src/services/review-service.test.ts` (adiciona um caso)

**Interfaces:**
- Produces: `deleteComment(input: { commentId: string; userId: string; role: string }): Promise<{ reviewId: string }>`

- [ ] **Step 1: Escrever o teste que falha** — adicionar em `apps/api/src/services/review-service.test.ts` (dentro do `describe` existente do service; importe `createReview`, `createComment`, `deleteComment` se ainda não importados no arquivo):

```ts
it('deleteComment retorna o reviewId do comentário removido', async () => {
  const author = await prisma.user.create({
    data: { name: 'Ana', email: 'ana-del@empresa.com', passwordHash: 'x', active: true },
  })
  const review = await createReview({ authorId: author.id, content: 'oi' })
  const { comment } = await createComment({ reviewId: review.id, authorId: author.id, content: 'comentário' })

  const result = await deleteComment({ commentId: comment.id, userId: author.id, role: 'COLLABORATOR' })

  expect(result.reviewId).toBe(review.id)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts -t "deleteComment retorna o reviewId"`
Expected: FAIL — `result.reviewId` é `undefined` (a função retorna `void`).

- [ ] **Step 3: Alterar `deleteComment`** em `apps/api/src/services/review-service.ts`:

```ts
export async function deleteComment(input: {
  commentId: string
  userId: string
  role: string
}): Promise<{ reviewId: string }> {
  const existing = await prisma.reviewComment.findUnique({
    where: { id: input.commentId },
    select: { authorId: true, reviewId: true },
  })
  if (!existing) throw new ReviewError('Comentário não encontrado.', 404)
  if (existing.authorId !== input.userId && input.role !== 'ADMIN') {
    throw new ReviewError('Sem permissão para excluir este comentário.', 403)
  }
  await prisma.reviewComment.delete({ where: { id: input.commentId } })
  return { reviewId: existing.reviewId }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts`
Expected: PASS (incluindo o novo caso; os antigos continuam verdes — o retorno extra não quebra chamadas que ignoram o valor).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/review-service.ts apps/api/src/services/review-service.test.ts
git commit -m "feat(api): deleteComment retorna reviewId (para evento de tempo real)"
```

---

## Task 5: Emitir broadcasts nas rotas de resenha

**Files:**
- Modify: `apps/api/src/routes/review.ts` (import + 1 linha de broadcast por mutation)
- Test: `apps/api/src/routes/review.test.ts` (novo caso de broadcast)

**Interfaces:**
- Consumes: `reviewHub` de `../lib/review-hub` (Task 2); `deleteComment` agora retorna `{ reviewId }` (Task 4).

Mapa de emissões (cada uma logo após o service retornar com sucesso, **antes** do `reply.send`/`reply.code(...).send()`):

| Endpoint | Evento |
|---|---|
| `POST /reviews` | `{ type: 'feed:changed' }` |
| `DELETE /reviews/:id` | `{ type: 'feed:changed' }` |
| `POST /reviews/:id/reactions/toggle` | `{ type: 'review:changed', reviewId: id }` |
| `POST /reviews/:id/share` | `{ type: 'review:changed', reviewId: id }` |
| `DELETE /reviews/:id/share` | `{ type: 'review:changed', reviewId: id }` |
| `POST /reviews/:id/comments` | `{ type: 'comments:changed', reviewId: id }` |
| `DELETE /reviews/comments/:commentId` | `{ type: 'comments:changed', reviewId }` (do retorno do service) |
| `POST /reviews/comments/:commentId/reactions/toggle` | `{ type: 'comments:changed', reviewId: comment.reviewId }` |

- [ ] **Step 1: Escrever o teste que falha** — adicionar em `apps/api/src/routes/review.test.ts` (usa o `reviewHub` singleton: inscreve um socket fake, faz a request, confere o evento):

```ts
import { reviewHub } from '../lib/review-hub'

it('emite broadcast feed:changed ao criar resenha', async () => {
  const { app, token } = await setup()
  const sent: string[] = []
  const conn = { socket: { send: (d: string) => sent.push(d) } }
  reviewHub.subscribe(conn)
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: auth(token),
      payload: { content: 'tempo real' },
    })
    expect(res.statusCode).toBe(201)
    expect(sent).toContain(JSON.stringify({ type: 'feed:changed' }))
  } finally {
    reviewHub.unsubscribe(conn)
    await app.close()
  }
})

it('emite comments:changed (com reviewId) ao comentar', async () => {
  const { app, token } = await setup()
  const created = await app.inject({
    method: 'POST',
    url: '/reviews',
    headers: auth(token),
    payload: { content: 'base' },
  })
  const reviewId = created.json().review.id as string

  const sent: string[] = []
  const conn = { socket: { send: (d: string) => sent.push(d) } }
  reviewHub.subscribe(conn)
  try {
    const res = await app.inject({
      method: 'POST',
      url: `/reviews/${reviewId}/comments`,
      headers: auth(token),
      payload: { content: 'comentário' },
    })
    expect(res.statusCode).toBe(201)
    expect(sent).toContain(JSON.stringify({ type: 'comments:changed', reviewId }))
  } finally {
    reviewHub.unsubscribe(conn)
    await app.close()
  }
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/review.test.ts -t "emite"`
Expected: FAIL — `sent` está vazio (nenhum broadcast ainda).

- [ ] **Step 3: Importar o hub** em `apps/api/src/routes/review.ts` (junto dos outros imports, ex. após o import de `serialize`):

```ts
import { reviewHub } from '../lib/review-hub'
```

- [ ] **Step 4: Adicionar os broadcasts.** Em cada handler, insira a linha logo antes do `return reply...` de sucesso:

`POST /reviews` (após o bloco `try/catch` de `notifyReviewMention`, antes do `return reply.code(201)`):
```ts
      reviewHub.broadcast({ type: 'feed:changed' })
```

`DELETE /reviews/:id` (após `deleteReview(...)`, antes do `return reply.code(204)`):
```ts
      reviewHub.broadcast({ type: 'feed:changed' })
```

`POST /reviews/:id/reactions/toggle` (após o bloco de `notifyReviewReaction`, antes do `return reply.send`):
```ts
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
```

`POST /reviews/:id/share` (após obter `review`/`sharedByMe`, antes do `return reply.send`):
```ts
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
```

`DELETE /reviews/:id/share` (após `getReviewForViewer`, antes do `return reply.send`):
```ts
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
```

`POST /reviews/:id/comments` (após os blocos de notificação, antes do `return reply.code(201)`):
```ts
      reviewHub.broadcast({ type: 'comments:changed', reviewId: id })
```

`DELETE /reviews/comments/:commentId` — capturar o retorno do service e emitir:
```ts
      const { reviewId } = await deleteComment({ commentId, userId: request.user.sub, role: request.user.role })
      reviewHub.broadcast({ type: 'comments:changed', reviewId })
      return reply.code(204).send()
```

`POST /reviews/comments/:commentId/reactions/toggle` (após `toggleCommentReaction`, antes do `return reply.send`):
```ts
      reviewHub.broadcast({ type: 'comments:changed', reviewId: comment.reviewId })
```

- [ ] **Step 5: Rodar a suíte de review e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/review.test.ts`
Expected: PASS (incluindo os 2 novos casos).

- [ ] **Step 6: Typecheck do workspace api**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (confirma que `comment.reviewId` existe no objeto retornado e que `deleteComment` agora devolve `{ reviewId }`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/review.ts apps/api/src/routes/review.test.ts
git commit -m "feat(api): emitir eventos de tempo real nas mutations de resenha"
```

---

## Task 6: Hook cliente `useReviewSocket`

**Files:**
- Create: `apps/web/src/lib/useReviewSocket.ts`
- Test: `apps/web/src/lib/useReviewSocket.test.tsx`

**Interfaces:**
- Consumes: `ReviewEvent` de `@legends/shared` (Task 1); `getAccessToken`, `refreshAccessToken` de `./api`; `useQueryClient` do React Query.
- Produces: `export function useReviewSocket(): void` — conecta no mount, invalida queries por evento, desconecta no unmount.

Mecânica de conexão copiada de `useRetroSocket` (token em memória, refresh single-flight na 1ª falha, backoff exponencial cap 15s, `wss`/`ws` por protocolo, cleanup via `closedByUs`). Mapa de invalidação:
- `feed:changed` → `invalidateQueries(['reviews','feed'])`
- `review:changed` → `invalidateQueries(['reviews','feed'])`
- `comments:changed` → `invalidateQueries(['reviews','comments', reviewId])` **e** `invalidateQueries(['reviews','feed'])`

- [ ] **Step 1: Escrever o teste que falha** em `apps/web/src/lib/useReviewSocket.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useReviewSocket } from './useReviewSocket'

vi.mock('./api', () => ({ getAccessToken: () => 'tok', refreshAccessToken: vi.fn().mockResolvedValue(true) }))

class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readyState = 1
  constructor(public url: string) { FakeWS.instances.push(this) }
  send() {}
  close() { this.readyState = 3; this.onclose?.({}) }
  emitOpen() { this.readyState = 1; this.onopen?.({}) }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

function setup() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, spy, wrapper }
}

describe('useReviewSocket', () => {
  beforeEach(() => { FakeWS.instances = []; ;(globalThis as any).WebSocket = FakeWS })

  it('abre a conexão na rota /api/reviews/ws com token', async () => {
    const { wrapper } = setup()
    renderHook(() => useReviewSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    expect(FakeWS.instances[0].url).toContain('/api/reviews/ws?token=tok')
  })

  it('feed:changed invalida o feed', async () => {
    const { spy, wrapper } = setup()
    renderHook(() => useReviewSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    spy.mockClear()
    act(() => ws.emit({ type: 'feed:changed' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews', 'feed'] })
  })

  it('comments:changed invalida os comentários do review e o feed', async () => {
    const { spy, wrapper } = setup()
    renderHook(() => useReviewSocket(), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    spy.mockClear()
    act(() => ws.emit({ type: 'comments:changed', reviewId: 'r1' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews', 'comments', 'r1'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['reviews', 'feed'] })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/lib/useReviewSocket.test.tsx`
Expected: FAIL — `Cannot find module './useReviewSocket'`.

- [ ] **Step 3: Implementar** `apps/web/src/lib/useReviewSocket.ts`

```ts
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ReviewEvent } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from './api'

const FEED_KEY = ['reviews', 'feed'] as const

/**
 * Mantém uma conexão WebSocket com o feed de resenha enquanto a rota está
 * montada. Ao receber um evento, invalida a query relevante do React Query
 * (eventos magros — o refetch traz o estado já com as flags do viewer).
 */
export function useReviewSocket(): void {
  const qc = useQueryClient()

  useEffect(() => {
    let closedByUs = false
    let attempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    async function connect() {
      let token = getAccessToken()
      if (attempts > 0 || !token) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (!token || closedByUs) return
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${scheme}://${window.location.host}/api/reviews/ws?token=${token}`)

      ws.onopen = () => {
        attempts = 0
        qc.invalidateQueries({ queryKey: FEED_KEY })
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let e: ReviewEvent
        try {
          e = JSON.parse(ev.data) as ReviewEvent
        } catch {
          return
        }
        if (e.type === 'feed:changed' || e.type === 'review:changed') {
          qc.invalidateQueries({ queryKey: FEED_KEY })
          return
        }
        if (e.type === 'comments:changed') {
          qc.invalidateQueries({ queryKey: ['reviews', 'comments', e.reviewId] })
          qc.invalidateQueries({ queryKey: FEED_KEY })
        }
      }
      ws.onclose = () => {
        if (closedByUs) return
        attempts += 1
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15000))
      }
      ws.onerror = () => ws?.close()
    }
    void connect()

    return () => {
      closedByUs = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      ws = null
    }
  }, [qc])
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/lib/useReviewSocket.test.tsx`
Expected: PASS (3 testes).

Nota: o `onopen` invalida o feed de propósito — ao (re)conectar, sincroniza o que possa ter sido perdido durante a desconexão. Por isso o teste dá `spy.mockClear()` após `emitOpen()`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/useReviewSocket.ts apps/web/src/lib/useReviewSocket.test.tsx
git commit -m "feat(web): useReviewSocket — invalida queries da resenha por evento WS"
```

---

## Task 7: Conectar o hook na `ResenhaPage`

**Files:**
- Modify: `apps/web/src/pages/resenha/ResenhaPage.tsx`

**Interfaces:**
- Consumes: `useReviewSocket` de `../../lib/useReviewSocket` (Task 6).

- [ ] **Step 1: Adicionar o import** em `apps/web/src/pages/resenha/ResenhaPage.tsx` (após o import de `use-reviews`):

```ts
import { useReviewSocket } from '../../lib/useReviewSocket'
```

- [ ] **Step 2: Chamar o hook** no topo do componente — logo após `const feed = useReviewFeed()`:

```ts
  useReviewSocket()
```

- [ ] **Step 3: Typecheck + testes do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web test`
Expected: sem erros de tipo; suíte web verde.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/resenha/ResenhaPage.tsx
git commit -m "feat(web): ResenhaPage conecta no WebSocket de tempo real"
```

---

## Task 8: Verificação ponta a ponta

**Files:** nenhum (validação).

- [ ] **Step 1: Subir o Postgres** (necessário para os testes da API)

Run: `pnpm db:up`
Expected: container do Postgres de pé.

- [ ] **Step 2: Rodar toda a suíte**

Run: `pnpm test`
Expected: todos os workspaces verdes (shared, api, web).

- [ ] **Step 3: Smoke manual de tempo real** (dois navegadores)

```
pnpm dev
```
Abra `/resenha` em duas janelas (logins diferentes ou abas anônimas). Na janela A: poste uma resenha → deve aparecer na janela B **sem refresh**. Comente e reaja na A → contadores/comentários atualizam na B. Confirme no devtools (Network → WS) que há uma conexão `reviews/ws` aberta e que ela reconecta após cair (ex.: derrube a API e suba de novo).

- [ ] **Step 4: Concluir o branch** — invoque a skill `superpowers:finishing-a-development-branch` para decidir merge/PR.

---

## Self-Review (autor do plano)

- **Cobertura do spec:** hub (Task 2) ✓; rota WS + registro (Task 3) ✓; eventos magros nas 8 mutations (Task 5) ✓; `reviewId` para rotas por commentId (Task 4) ✓; tipo no `@legends/shared` (Task 1) ✓; hook cliente com a mecânica do retro (Task 6) ✓; conexão atrelada à rota (Task 7) ✓; auth só por JWT sem membership (Task 3) ✓; testes hub/rota/cliente (Tasks 2,5,6) ✓. Desvio consciente do spec: o tipo `ReviewEvent` foi colocado em `review.ts` (não em `review-events.ts`) para seguir a convenção do repo, onde `RetroEvent` vive em `retro.ts`.
- **Placeholders:** nenhum — todo step de código mostra o código; comandos têm resultado esperado.
- **Consistência de tipos:** `ReviewEvent` (Task 1) é consumido igual em hub (2), rota (5) e cliente (6); `deleteComment` retorna `{ reviewId }` (Task 4) e é usado assim na rota (Task 5); `reviewHub`/`ReviewConnection` definidos na Task 2 e usados nas Tasks 3 e 5.
