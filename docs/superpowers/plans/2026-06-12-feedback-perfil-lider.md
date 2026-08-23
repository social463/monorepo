# Área de feedback (SCI) no perfil do líder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um subsistema de feedback no formato SCI (Situação · Comportamento · Impacto) exibido no perfil de usuários LEAD, junto com a galeria de selos conquistados.

**Architecture:** Novo model Prisma `Feedback` (author→target), um service com regras de autorização, rotas Fastify REST (`/users/:id/feedbacks`, `/feedbacks/:id`), DTOs em `@legends/shared`, e um componente React isolado `FeedbackSection` plugado na `ProfilePage` apenas para perfis LEAD. Backend espelha o padrão de `voting-service`/`votes.ts`; frontend espelha `MemberBadgesPanel`.

**Tech Stack:** Fastify, Prisma, PostgreSQL, Zod, React, TanStack Query, Tailwind, Vitest.

---

## File Structure

- **Create** `packages/shared/src/feedback.ts` — DTOs e constante de validação.
- **Modify** `packages/shared/src/index.ts` — exporta o novo módulo.
- **Modify** `apps/api/prisma/schema.prisma` — model `Feedback` + relações em `User`.
- **Create** `apps/api/prisma/migrations/<timestamp>_add_feedback/migration.sql` — gerada via `prisma migrate dev`.
- **Modify** `apps/api/test/setup.ts` — truncar `feedback` no `beforeEach`.
- **Create** `apps/api/src/services/feedback-service.ts` — lógica + autorização.
- **Modify** `apps/api/src/lib/serialize.ts` — `toFeedbackDTO`.
- **Create** `apps/api/src/routes/feedback.ts` — rotas REST.
- **Modify** `apps/api/src/app.ts` — registra `feedbackRoutes`.
- **Create** `apps/api/src/routes/feedback.test.ts` — testes de rota (inject).
- **Create** `apps/web/src/pages/profile/FeedbackSection.tsx` — UI da área de feedback.
- **Create** `apps/web/src/pages/profile/FeedbackSection.test.tsx` — testes do componente.
- **Modify** `apps/web/src/pages/ProfilePage.tsx` — layout LEAD (galeria + feedback).
- **Modify** `apps/web/src/pages/ProfilePage.test.tsx` — atualiza o teste do perfil LEAD.

---

## Task 1: Shared DTOs de feedback

**Files:**
- Create: `packages/shared/src/feedback.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Criar o módulo de tipos**

`packages/shared/src/feedback.ts`:

```ts
import type { PublicUser } from './auth'

export const MIN_FEEDBACK_FIELD_LENGTH = 10

export interface FeedbackDTO {
  id: string
  author: PublicUser
  situation: string
  behavior: string
  impact: string
  createdAt: string
  updatedAt: string
}

export interface CreateFeedbackRequest {
  situation: string
  behavior: string
  impact: string
}

export type UpdateFeedbackRequest = CreateFeedbackRequest
```

- [ ] **Step 2: Exportar no índice**

Em `packages/shared/src/index.ts`, adicionar ao final:

```ts
export * from './feedback'
```

- [ ] **Step 3: Verificar typecheck do pacote shared**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/feedback.ts packages/shared/src/index.ts
git commit -m "feat(shared): DTOs de feedback SCI"
```

---

## Task 2: Model Prisma `Feedback` + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_feedback/migration.sql` (gerada)
- Modify: `apps/api/test/setup.ts`

- [ ] **Step 1: Adicionar o model ao schema**

No fim de `apps/api/prisma/schema.prisma`, adicionar:

```prisma
model Feedback {
  id         String   @id @default(cuid())
  authorId   String
  targetId   String
  situation  String
  behavior   String
  impact     String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  author User @relation("FeedbacksGiven", fields: [authorId], references: [id])
  target User @relation("FeedbacksReceived", fields: [targetId], references: [id])

  @@index([targetId])
  @@index([authorId])
}
```

- [ ] **Step 2: Adicionar as relações inversas em `User`**

No model `User` (junto das outras relações como `votesGiven`/`votesReceived`), adicionar:

```prisma
  feedbacksGiven    Feedback[] @relation("FeedbacksGiven")
  feedbacksReceived Feedback[] @relation("FeedbacksReceived")
```

- [ ] **Step 3: Gerar a migration e o client**

Run: `pnpm --filter @legends/api exec prisma migrate dev --name add_feedback`
Expected: cria `apps/api/prisma/migrations/<timestamp>_add_feedback/migration.sql` com `CREATE TABLE "Feedback"`, aplica no banco de dev e regenera o Prisma Client sem erros.

- [ ] **Step 4: Truncar `feedback` entre testes**

Em `apps/api/test/setup.ts`, dentro do `prisma.$transaction([...])` do `beforeEach`, adicionar `prisma.feedback.deleteMany()` **antes** de `prisma.user.deleteMany()` (FK depende de user):

```ts
  await prisma.$transaction([
    prisma.refreshToken.deleteMany(),
    prisma.userBadge.deleteMany(),
    prisma.vote.deleteMany(),
    prisma.feedback.deleteMany(),
    prisma.badge.deleteMany(),
    prisma.votingPeriod.deleteMany(),
    prisma.category.deleteMany(),
    prisma.user.deleteMany(),
  ])
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/setup.ts
git commit -m "feat(api): model Feedback + migration"
```

---

## Task 3: Service de feedback

**Files:**
- Create: `apps/api/src/services/feedback-service.ts`

Este task entrega a lógica de domínio. Os comportamentos são exercitados pelos testes de rota da Task 5; aqui implementamos a base de que as rotas dependem.

- [ ] **Step 1: Criar o service**

`apps/api/src/services/feedback-service.ts`:

```ts
import { Prisma } from '@prisma/client'
import { MIN_FEEDBACK_FIELD_LENGTH } from '@legends/shared'
import { prisma } from '../lib/prisma'

export class FeedbackError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'FeedbackError'
  }
}

export const feedbackInclude = { author: true } as const
export type FeedbackWithAuthor = Prisma.FeedbackGetPayload<{ include: typeof feedbackInclude }>

interface FeedbackFields {
  situation: string
  behavior: string
  impact: string
}

function assertFields(fields: FeedbackFields) {
  const ok = [fields.situation, fields.behavior, fields.impact].every(
    (value) => value.trim().length >= MIN_FEEDBACK_FIELD_LENGTH,
  )
  if (!ok) {
    throw new FeedbackError('Situação, comportamento e impacto são obrigatórios.', 400)
  }
}

function trimmed(fields: FeedbackFields): FeedbackFields {
  return {
    situation: fields.situation.trim(),
    behavior: fields.behavior.trim(),
    impact: fields.impact.trim(),
  }
}

export function listFeedbacksForUser(targetId: string): Promise<FeedbackWithAuthor[]> {
  return prisma.feedback.findMany({
    where: { targetId },
    include: feedbackInclude,
    orderBy: { createdAt: 'desc' },
  })
}

export async function createFeedback(
  input: FeedbackFields & { authorId: string; targetId: string },
): Promise<FeedbackWithAuthor> {
  if (input.authorId === input.targetId) {
    throw new FeedbackError('Você não pode dar feedback a si mesmo.', 400)
  }
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new FeedbackError('Autor inválido.', 400)
  }
  if (author.role === 'ADMIN') {
    throw new FeedbackError('Administradores não deixam feedback.', 403)
  }
  const target = await prisma.user.findUnique({ where: { id: input.targetId } })
  if (!target || !target.active) {
    throw new FeedbackError('Destinatário inválido.', 404)
  }
  assertFields(input)
  return prisma.feedback.create({
    data: { authorId: input.authorId, targetId: input.targetId, ...trimmed(input) },
    include: feedbackInclude,
  })
}

export async function updateFeedback(
  input: FeedbackFields & { feedbackId: string; userId: string },
): Promise<FeedbackWithAuthor> {
  const existing = await prisma.feedback.findUnique({ where: { id: input.feedbackId } })
  if (!existing) {
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  if (existing.authorId !== input.userId) {
    throw new FeedbackError('Apenas o autor pode editar este feedback.', 403)
  }
  assertFields(input)
  return prisma.feedback.update({
    where: { id: input.feedbackId },
    data: trimmed(input),
    include: feedbackInclude,
  })
}

export async function deleteFeedback(input: { feedbackId: string; userId: string }): Promise<void> {
  const existing = await prisma.feedback.findUnique({ where: { id: input.feedbackId } })
  if (!existing) {
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  if (existing.authorId !== input.userId) {
    const actor = await prisma.user.findUnique({ where: { id: input.userId } })
    if (actor?.role !== 'ADMIN') {
      throw new FeedbackError('Sem permissão para excluir este feedback.', 403)
    }
  }
  await prisma.feedback.delete({ where: { id: input.feedbackId } })
}
```

> Nota: a checagem de role lê o usuário do banco (não do JWT), igual a `createVote` — assim um usuário promovido a ADMIN após o login é tratado corretamente.

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (depende do client regenerado na Task 2).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/feedback-service.ts
git commit -m "feat(api): service de feedback com regras de autorizacao"
```

---

## Task 4: Serialização `toFeedbackDTO`

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`

- [ ] **Step 1: Adicionar o import do tipo de service**

No topo de `apps/api/src/lib/serialize.ts`, junto dos outros imports de service, adicionar:

```ts
import type { FeedbackWithAuthor } from '../services/feedback-service'
```

E acrescentar `FeedbackDTO` à lista de imports de `@legends/shared`:

```ts
import type {
  AvatarOptions,
  AvatarStyleKey,
  AwardedBadgeDTO,
  BadgeDTO,
  CategoryDTO,
  FeedbackDTO,
  HighlightDTO,
  PublicUser,
  VoteDTO,
  VotingPeriodDTO,
} from '@legends/shared'
```

- [ ] **Step 2: Adicionar a função de serialização**

No fim de `apps/api/src/lib/serialize.ts`:

```ts
export function toFeedbackDTO(feedback: FeedbackWithAuthor): FeedbackDTO {
  return {
    id: feedback.id,
    author: toPublicUser(feedback.author),
    situation: feedback.situation,
    behavior: feedback.behavior,
    impact: feedback.impact,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/serialize.ts
git commit -m "feat(api): toFeedbackDTO"
```

---

## Task 5: Rotas de feedback (TDD)

**Files:**
- Create: `apps/api/src/routes/feedback.test.ts`
- Create: `apps/api/src/routes/feedback.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Escrever os testes de rota (falhando)**

`apps/api/src/routes/feedback.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

const SCI = {
  situation: 'Durante o incidente de produção da última sexta.',
  behavior: 'Assumiu a coordenação e comunicou o status a cada 15 minutos.',
  impact: 'O time recuperou o serviço mais rápido e com menos ruído.',
}

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  const authorId = reg.json().user.id as string
  const lead = await prisma.user.create({
    data: { name: 'Líder', email: 'lead@empresa.com', passwordHash: 'x', role: 'LEAD' },
  })
  return { app, token, authorId, lead }
}

describe('feedback routes', () => {
  it('cria um feedback SCI (201)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: SCI,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().feedback.author.name).toBe('Ana')
    expect(res.json().feedback.situation).toBe(SCI.situation)
    await app.close()
  })

  it('rejeita campos curtos (400)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { situation: 'curto', behavior: 'curto', impact: 'curto' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita ADMIN deixando feedback (403)', async () => {
    const { app, lead, token, authorId } = await setup()
    await prisma.user.update({ where: { id: authorId }, data: { role: 'ADMIN' } })
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: SCI,
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('rejeita feedback a si mesmo (400)', async () => {
    const { app, token, authorId } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${authorId}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: SCI,
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('404 para destinatário inexistente', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/inexistente/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: SCI,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('lista feedbacks do alvo em ordem decrescente', async () => {
    const { app, lead, token } = await setup()
    await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: SCI })
    const res = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedbacks).toHaveLength(1)
    expect(res.json().feedbacks[0].author.name).toBe('Ana')
    await app.close()
  })

  it('só o autor edita o feedback (403 para outro)', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: SCI })
    const feedbackId = created.json().feedback.id as string

    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const otherToken = other.json().accessToken as string

    const res = await app.inject({
      method: 'PATCH',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { ...SCI, impact: 'Texto novo suficientemente longo para validar.' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('autor edita o próprio feedback (200)', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: SCI })
    const feedbackId = created.json().feedback.id as string
    const res = await app.inject({
      method: 'PATCH',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...SCI, impact: 'Impacto revisado com texto suficientemente longo.' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedback.impact).toBe('Impacto revisado com texto suficientemente longo.')
    await app.close()
  })

  it('ADMIN exclui feedback de outro (204); terceiro não-admin recebe 403', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: SCI })
    const feedbackId = created.json().feedback.id as string

    const third = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Caio', email: 'caio@empresa.com', password: 'changeme123' },
    })
    const thirdToken = third.json().accessToken as string
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${thirdToken}` },
    })
    expect(forbidden.statusCode).toBe(403)

    const adminReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Adm', email: 'adm@empresa.com', password: 'changeme123' },
    })
    const adminId = adminReg.json().user.id as string
    const adminToken = adminReg.json().accessToken as string
    await prisma.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } })

    const res = await app.inject({
      method: 'DELETE',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(204)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/feedback.test.ts`
Expected: FAIL (rotas inexistentes → 404 onde se espera 201/200).

- [ ] **Step 3: Implementar as rotas**

`apps/api/src/routes/feedback.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MIN_FEEDBACK_FIELD_LENGTH } from '@legends/shared'
import {
  FeedbackError,
  createFeedback,
  deleteFeedback,
  listFeedbacksForUser,
  updateFeedback,
} from '../services/feedback-service'
import { toFeedbackDTO } from '../lib/serialize'

const feedbackBodySchema = z.object({
  situation: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH),
  behavior: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH),
  impact: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH),
})

const invalidBody = { message: 'Situação, comportamento e impacto são obrigatórios.' }

export async function feedbackRoutes(app: FastifyInstance) {
  app.get('/users/:id/feedbacks', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const feedbacks = await listFeedbacksForUser(id)
    return reply.send({ feedbacks: feedbacks.map(toFeedbackDTO) })
  })

  app.post('/users/:id/feedbacks', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = feedbackBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ ...invalidBody, issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const feedback = await createFeedback({
        authorId: request.user.sub,
        targetId: id,
        ...parsed.data,
      })
      return reply.code(201).send({ feedback: toFeedbackDTO(feedback) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/feedbacks/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = feedbackBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ ...invalidBody, issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const feedback = await updateFeedback({
        feedbackId: id,
        userId: request.user.sub,
        ...parsed.data,
      })
      return reply.send({ feedback: toFeedbackDTO(feedback) })
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/feedbacks/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteFeedback({ feedbackId: id, userId: request.user.sub })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
```

- [ ] **Step 4: Registrar as rotas**

Em `apps/api/src/app.ts`, adicionar o import junto dos demais (após a linha do `profileRoutes`):

```ts
import { feedbackRoutes } from './routes/feedback'
```

E registrar (após `app.register(profileRoutes)`):

```ts
  app.register(feedbackRoutes)
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/feedback.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 6: Rodar a suíte da API completa (regressão)**

Run: `pnpm --filter @legends/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/feedback.ts apps/api/src/routes/feedback.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de feedback (criar/listar/editar/excluir)"
```

---

## Task 6: Componente `FeedbackSection` (TDD)

**Files:**
- Create: `apps/web/src/pages/profile/FeedbackSection.test.tsx`
- Create: `apps/web/src/pages/profile/FeedbackSection.tsx`

- [ ] **Step 1: Escrever os testes do componente (falhando)**

`apps/web/src/pages/profile/FeedbackSection.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock, describe, it, expect, beforeEach } from 'vitest'
import { FeedbackSection } from './FeedbackSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

let authUser: { id: string; name: string; role: string } | null = { id: 'dev1', name: 'Ana', role: 'DEV' }
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: authUser }),
}))

const mockApiFetch = apiFetch as unknown as Mock

const FEEDBACK = {
  id: 'f1',
  author: { id: 'dev1', name: 'Ana', email: 'a@e.com', role: 'DEV', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
  situation: 'Situação detalhada o suficiente.',
  behavior: 'Comportamento observável e descrito.',
  impact: 'Impacto relevante para o time.',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

function renderSection(targetId = 'lead1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <FeedbackSection targetId={targetId} />
    </QueryClientProvider>,
  )
}

describe('FeedbackSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authUser = { id: 'dev1', name: 'Ana', role: 'DEV' }
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/users/lead1/feedbacks') return Promise.resolve({ feedbacks: [FEEDBACK] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
  })

  it('renderiza a lista de feedbacks com autor e campos SCI', async () => {
    renderSection()
    expect(await screen.findByText('Situação detalhada o suficiente.')).toBeInTheDocument()
    expect(screen.getByText('Comportamento observável e descrito.')).toBeInTheDocument()
    expect(screen.getByText('Impacto relevante para o time.')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('mostra o formulário para quem pode escrever (DEV em perfil de outro)', async () => {
    renderSection()
    expect(await screen.findByLabelText('Situação')).toBeInTheDocument()
    expect(screen.getByLabelText('Comportamento')).toBeInTheDocument()
    expect(screen.getByLabelText('Impacto')).toBeInTheDocument()
  })

  it('esconde o formulário para ADMIN', async () => {
    authUser = { id: 'adm', name: 'Adm', role: 'ADMIN' }
    renderSection()
    await screen.findByText('Situação detalhada o suficiente.')
    expect(screen.queryByLabelText('Situação')).not.toBeInTheDocument()
  })

  it('esconde o formulário no próprio perfil', async () => {
    authUser = { id: 'lead1', name: 'Líder', role: 'LEAD' }
    renderSection('lead1')
    await screen.findByText('Situação detalhada o suficiente.')
    expect(screen.queryByLabelText('Situação')).not.toBeInTheDocument()
  })

  it('mostra editar/excluir nos feedbacks do próprio autor', async () => {
    renderSection()
    expect(await screen.findByLabelText('Editar feedback')).toBeInTheDocument()
    expect(screen.getByLabelText('Excluir feedback')).toBeInTheDocument()
  })

  it('envia um novo feedback válido', async () => {
    mockApiFetch.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/users/lead1/feedbacks' && options?.method === 'POST') {
        return Promise.resolve({ feedback: FEEDBACK })
      }
      if (path === '/users/lead1/feedbacks') return Promise.resolve({ feedbacks: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderSection()
    fireEvent.change(await screen.findByLabelText('Situação'), { target: { value: 'Situação suficientemente longa.' } })
    fireEvent.change(screen.getByLabelText('Comportamento'), { target: { value: 'Comportamento suficientemente longo.' } })
    fireEvent.change(screen.getByLabelText('Impacto'), { target: { value: 'Impacto suficientemente longo.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/users/lead1/feedbacks', expect.objectContaining({ method: 'POST' })),
    )
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/profile/FeedbackSection.test.tsx`
Expected: FAIL (módulo `./FeedbackSection` não existe).

- [ ] **Step 3: Implementar o componente**

`apps/web/src/pages/profile/FeedbackSection.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateFeedbackRequest, FeedbackDTO } from '@legends/shared'
import { MIN_FEEDBACK_FIELD_LENGTH } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'
import { useAuth } from '../../auth/AuthContext'

const EMPTY_FORM: CreateFeedbackRequest = { situation: '', behavior: '', impact: '' }

const FIELDS: { key: keyof CreateFeedbackRequest; label: string; placeholder: string }[] = [
  { key: 'situation', label: 'Situação', placeholder: 'Em que contexto isso aconteceu?' },
  { key: 'behavior', label: 'Comportamento', placeholder: 'O que a pessoa fez (comportamento observável)?' },
  { key: 'impact', label: 'Impacto', placeholder: 'Que impacto isso gerou no time / resultado?' },
]

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function FeedbackSection({ targetId }: { targetId: string }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateFeedbackRequest>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const feedbacksQuery = useQuery({
    queryKey: ['feedbacks', targetId],
    queryFn: () => apiFetch<{ feedbacks: FeedbackDTO[] }>(`/users/${targetId}/feedbacks`),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['feedbacks', targetId] })
  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError(null)
  }

  const create = useMutation({
    mutationFn: (body: CreateFeedbackRequest) =>
      apiFetch<{ feedback: FeedbackDTO }>(`/users/${targetId}/feedbacks`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      resetForm()
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao enviar feedback.'),
  })
  const update = useMutation({
    mutationFn: (vars: { id: string; body: CreateFeedbackRequest }) =>
      apiFetch<{ feedback: FeedbackDTO }>(`/feedbacks/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.body),
      }),
    onSuccess: () => {
      resetForm()
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar feedback.'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/feedbacks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir feedback.'),
  })

  const feedbacks = feedbacksQuery.data?.feedbacks ?? []
  const canWrite = Boolean(user) && user?.role !== 'ADMIN' && user?.id !== targetId
  const isValid = FIELDS.every(({ key }) => form[key].trim().length >= MIN_FEEDBACK_FIELD_LENGTH)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isValid) {
      setError(`Cada campo precisa de pelo menos ${MIN_FEEDBACK_FIELD_LENGTH} caracteres.`)
      return
    }
    if (editingId) update.mutate({ id: editingId, body: form })
    else create.mutate(form)
  }

  function startEdit(feedback: FeedbackDTO) {
    setEditingId(feedback.id)
    setError(null)
    setForm({ situation: feedback.situation, behavior: feedback.behavior, impact: feedback.impact })
  }

  return (
    <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-7">
      <div className="mb-lg flex items-center justify-between">
        <h3 className="font-headline text-headline-md text-on-surface">Feedbacks</h3>
        <span className="rounded-full bg-primary/10 px-sm py-0.5 font-label text-label-sm font-bold text-primary">
          {feedbacks.length}
        </span>
      </div>

      {canWrite && (
        <form
          onSubmit={handleSubmit}
          className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md"
        >
          <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
            {editingId ? 'Editar feedback' : 'Deixar feedback (SCI)'}
          </p>
          {FIELDS.map(({ key, label, placeholder }) => (
            <label key={key} className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface">{label}</span>
              <textarea
                className="min-h-[64px] rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                aria-label={label}
              />
            </label>
          ))}
          {error && (
            <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              {error}
            </p>
          )}
          <div className="flex gap-sm">
            <button
              type="submit"
              disabled={!isValid || create.isPending || update.isPending}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
            >
              {editingId ? 'Salvar' : 'Enviar feedback'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {feedbacks.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhum feedback ainda.</p>
      ) : (
        <ul className="flex flex-col gap-md">
          {feedbacks.map((feedback) => {
            const isAuthor = user?.id === feedback.author.id
            const canDelete = isAuthor || user?.role === 'ADMIN'
            return (
              <li
                key={feedback.id}
                className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
              >
                <div className="mb-sm flex items-center gap-sm">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
                    <Avatar user={feedback.author} />
                  </div>
                  <div className="min-w-0 flex-grow">
                    <p className="truncate font-label text-label-md text-on-surface">{feedback.author.name}</p>
                    <p className="font-label text-label-sm text-on-surface-variant">{formatDate(feedback.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-sm">
                    {isAuthor && (
                      <button
                        onClick={() => startEdit(feedback)}
                        aria-label="Editar feedback"
                        className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                      >
                        <Icon name="edit" className="text-[18px]" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => remove.mutate(feedback.id)}
                        aria-label="Excluir feedback"
                        disabled={remove.isPending}
                        className="rounded-md border border-error/40 p-1 text-error transition-colors hover:border-error disabled:opacity-50"
                      >
                        <Icon name="delete" className="text-[18px]" />
                      </button>
                    )}
                  </div>
                </div>
                <dl className="flex flex-col gap-xs">
                  {FIELDS.map(({ key, label }) => (
                    <div key={key}>
                      <dt className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                        {label}
                      </dt>
                      <dd className="text-body-sm text-on-surface">{feedback[key]}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/profile/FeedbackSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/profile/FeedbackSection.tsx apps/web/src/pages/profile/FeedbackSection.test.tsx
git commit -m "feat(web): componente FeedbackSection (SCI)"
```

---

## Task 7: Layout do perfil LEAD (galeria + feedback)

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`
- Modify: `apps/web/src/pages/ProfilePage.test.tsx`

- [ ] **Step 1: Atualizar o teste do perfil LEAD (falhando)**

Em `apps/web/src/pages/ProfilePage.test.tsx`, substituir o corpo do teste
`'esconde as seções de reconhecimento no perfil de uma liderança (LEAD)'`
(linhas ~87-113) para dar um selo ao LEAD e afirmar a presença de galeria e
feedbacks. Substituir o bloco inteiro do `it(...)` por:

```tsx
  it('mostra galeria de selos e área de feedback no perfil de uma liderança (LEAD)', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/users/u1/profile') {
        return Promise.resolve({
          user: { id: 'u1', name: 'Lucca Secco', email: 'l@e.com', role: 'LEAD', position: 'Tech Lead', squad: 'Liderança', photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
          stats: { totalVotesReceived: 0, monthsRecognized: 0 },
          categoryBreakdown: [],
          months: [],
          badges: [{ id: 'ub1', awardedAt: '2026-06-01T00:00:00.000Z', badge: { id: 'b1', slug: 'mentor', name: 'Mentor', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 0, categorySlug: null } }],
        })
      }
      if (path === '/users/u1/feedbacks') return Promise.resolve({ feedbacks: [] })
      if (path.startsWith('/users/u1/votes')) return Promise.resolve({ votes: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderPage()

    // Identidade preservada
    expect(await screen.findByRole('heading', { name: 'Lucca Secco' })).toBeInTheDocument()
    // Galeria de selos e selo conquistado aparecem
    expect(screen.getByText('Galeria de selos')).toBeInTheDocument()
    expect(screen.getByText('Mentor')).toBeInTheDocument()
    // Área de feedbacks aparece
    expect(screen.getByText('Feedbacks')).toBeInTheDocument()
    // Seções baseadas em voto seguem ausentes
    expect(screen.queryByText('Impacto acumulado')).not.toBeInTheDocument()
    expect(screen.queryByText('Histórico de reconhecimento')).not.toBeInTheDocument()
    expect(screen.queryByText('Categorias reconhecidas')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Reconhecer/ })).not.toBeInTheDocument()
  })
```

> Nota: o mock global `useAuth` no topo do arquivo retorna `{ id: 'u1', name: 'Bruno Lima' }` sem `role`. Como `u1` é o próprio perfil aberto, `FeedbackSection` esconde o formulário (canWrite=false) — o teste valida apenas a presença da seção, então isso é suficiente.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ProfilePage.test.tsx`
Expected: FAIL (hoje "Galeria de selos"/"Feedbacks" estão ausentes para LEAD).

- [ ] **Step 3: Importar `FeedbackSection` na ProfilePage**

No topo de `apps/web/src/pages/ProfilePage.tsx`, adicionar:

```tsx
import { FeedbackSection } from './profile/FeedbackSection'
```

- [ ] **Step 4: Renderizar o bento LEAD**

Em `apps/web/src/pages/ProfilePage.tsx`, logo **após** o fechamento do bloco do
corpo bento de votos `{!isLead && ( ... )}` (que hoje termina em `)}` na linha
~280, antes de `{pickerOpen && ...}`), adicionar o bento exclusivo do LEAD:

```tsx
      {isLead && (
        <div className="grid grid-cols-12 gap-lg">
          {/* Galeria de selos */}
          <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-5">
            <div className="mb-lg flex items-center justify-between">
              <h3 className="font-headline text-headline-md text-on-surface">Galeria de selos</h3>
              <Link to="/selos" className="font-label text-label-md text-primary hover:underline">
                Ver todos
              </Link>
            </div>
            {badges.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">Nenhum selo atribuído ainda.</p>
            ) : (
              <div className="grid grid-cols-3 gap-md">
                {badges.map((awarded) => (
                  <div
                    key={awarded.id}
                    title={awarded.badge.description}
                    className="group flex cursor-default flex-col items-center rounded-lg border border-outline-variant/20 bg-surface-container-high p-md transition-all hover:border-outline-variant/50"
                  >
                    <div className="mb-sm transition-transform group-hover:scale-110">
                      <BadgeEmblem badge={awarded.badge} size={64} />
                    </div>
                    <p className="text-center font-label text-label-sm text-on-surface">
                      {awarded.badge.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Área de feedbacks (substitui o histórico de reconhecimento) */}
          <FeedbackSection targetId={user.id} />
        </div>
      )}
```

> A galeria reusa a mesma marcação do bento do dev (emblema 64px + nome + título=descrição). `FeedbackSection` já vem com `col-span-12 lg:col-span-7`, encaixando ao lado da galeria (`lg:col-span-5`).

- [ ] **Step 5: Rodar os testes da ProfilePage e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ProfilePage.test.tsx`
Expected: PASS (inclusive os testes existentes do perfil DEV, intocados).

- [ ] **Step 6: Typecheck + suíte web completa**

Run: `pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): galeria de selos e area de feedback no perfil do lider"
```

---

## Task 8: Verificação final

- [ ] **Step 1: Rodar toda a suíte do monorepo**

Run: `pnpm test`
Expected: PASS em `@legends/shared`, `@legends/api` e `@legends/web`.

- [ ] **Step 2: Smoke manual (opcional)**

Subir API + web (`pnpm --filter @legends/api dev` e `pnpm --filter @legends/web dev`),
logar como um DEV, abrir o perfil de um usuário LEAD e confirmar: galeria de selos
visível, formulário SCI presente, criar/editar/excluir o próprio feedback. Logar
como ADMIN e confirmar que o formulário some mas o botão de excluir aparece nos
feedbacks de terceiros.

---

## Notas de cobertura (self-review)

- **Galeria de selos para LEAD** → Task 7 (bloco `{isLead && ...}`).
- **Área de feedback SCI** → Tasks 1–6 (tipos, model, service, serialização, rotas, componente) + Task 7 (encaixe).
- **Regras:** quem escreve (não-ADMIN, não-self) → service Task 3 + `canWrite` Task 6; público → `GET` sem restrição Task 5; identificado → `author` no DTO Task 1/4; SCI obrigatório com mínimo → `assertFields`/zod Tasks 3 e 5 + `isValid` Task 6; vários sem limite → sem `@@unique` no model Task 2; editar/excluir autor + ADMIN modera → Task 3/5/6; alvo livre exceto self/admin → service Task 3.
- **Fora de escopo** (selo por feedback, área no perfil do dev) — não há tasks, conforme spec.
