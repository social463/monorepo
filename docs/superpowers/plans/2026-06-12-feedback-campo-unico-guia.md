# Campo único de feedback com guia opcional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os três campos SCI (situation/behavior/impact) do feedback por um único campo `message`, e adicionar um guia ligável/desligável (apenas texto orientador) no formulário do `FeedbackSection`.

**Architecture:** Refatoração da feature de feedback já implementada na branch `feat/feedback-perfil-lider` (não mergeada). Troca-se o shape de dados (Prisma, shared DTOs, service, serialize, rotas) de três campos para um `message`; o frontend passa a ter um `<textarea>` único + um toggle de guia persistido em `localStorage`. As regras de autorização e o layout do perfil não mudam.

**Tech Stack:** Fastify, Prisma, PostgreSQL, Zod, React, TanStack Query, Tailwind, Vitest.

---

## File Structure

- **Modify** `packages/shared/src/feedback.ts` — `FeedbackDTO`/`CreateFeedbackRequest` usam `message`.
- **Modify** `apps/api/prisma/schema.prisma` — model `Feedback`: 3 campos → `message`.
- **Create** `apps/api/prisma/migrations/<timestamp>_feedback_single_message/migration.sql` — gerada.
- **Modify** `apps/api/src/services/feedback-service.ts` — valida/persiste `message`.
- **Modify** `apps/api/src/lib/serialize.ts` — `toFeedbackDTO` → `message`.
- **Modify** `apps/api/src/routes/feedback.ts` — zod `{ message }`.
- **Modify** `apps/api/src/routes/feedback.test.ts` — payloads `{ message }`.
- **Modify** `apps/web/src/pages/profile/FeedbackSection.tsx` — campo único + guia.
- **Modify** `apps/web/src/pages/profile/FeedbackSection.test.tsx` — testes do campo único + guia.

`apps/web/src/pages/ProfilePage.tsx` e seu teste **não mudam** (a fixture de feedbacks é vazia e só verifica o bloco "Feedbacks").

> Nota de ordem: durante a refatoração, o pacote `apps/api` fica sem compilar até a Task 5 (porque shared muda em Task 1, modelo em Task 2, e service/serialize/rotas em Tasks 3–5). Isso é esperado; a verificação de typecheck + testes do backend acontece ao fim da Task 5.

---

## Task 1: Shared DTOs → `message`

**Files:**
- Modify: `packages/shared/src/feedback.ts`

- [ ] **Step 1: Substituir o conteúdo do arquivo**

`packages/shared/src/feedback.ts` passa a ser exatamente:

```ts
import type { PublicUser } from './auth'

export const MIN_FEEDBACK_FIELD_LENGTH = 10

export interface FeedbackDTO {
  id: string
  author: PublicUser
  message: string
  createdAt: string
  updatedAt: string
}

export interface CreateFeedbackRequest {
  message: string
}

export type UpdateFeedbackRequest = CreateFeedbackRequest
```

- [ ] **Step 2: Verificar typecheck do shared**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/feedback.ts
git commit -m "refactor(shared): feedback vira campo unico message"
```

---

## Task 2: Prisma model + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_feedback_single_message/migration.sql`

- [ ] **Step 1: Alterar o model `Feedback`**

Em `apps/api/prisma/schema.prisma`, no model `Feedback`, **remover** as três linhas:

```prisma
  situation  String
  behavior   String
  impact     String
```

e **adicionar** no lugar:

```prisma
  message    String
```

(Manter `id`, `authorId`, `targetId`, `createdAt`, `updatedAt`, as relações `author`/`target` e os `@@index`.)

- [ ] **Step 2: Garantir tabela vazia em dev (a nova coluna é NOT NULL)**

A migration adiciona `message` como `NOT NULL`; se houver linhas residuais na tabela `Feedback` do banco de dev, a migration falha. Limpe a tabela antes (é seguro — não há feedback real):

Run: `pnpm --filter @legends/api exec prisma db execute --stdin <<< 'TRUNCATE TABLE "Feedback";'`
Expected: executa sem erro (ou erro benigno se a tabela já está vazia).

- [ ] **Step 3: Gerar a migration e regenerar o client**

Run: `pnpm --filter @legends/api exec prisma migrate dev --name feedback_single_message`
Expected: cria `apps/api/prisma/migrations/<timestamp>_feedback_single_message/migration.sql` com `ALTER TABLE "Feedback" DROP COLUMN ... ADD COLUMN "message"`, aplica no banco de dev, regenera o Prisma Client. Se o migrate apontar drift/dados, confirme que a tabela foi truncada no Step 2 e rode de novo.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "refactor(api): model Feedback usa campo unico message"
```

---

## Task 3: Service → `message`

**Files:**
- Modify: `apps/api/src/services/feedback-service.ts`

- [ ] **Step 1: Substituir o conteúdo do arquivo**

`apps/api/src/services/feedback-service.ts` passa a ser exatamente:

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

function assertMessage(message: string) {
  if (message.trim().length < MIN_FEEDBACK_FIELD_LENGTH) {
    throw new FeedbackError('O feedback é obrigatório e precisa ser específico.', 400)
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
  input: { authorId: string; targetId: string; message: string },
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
  assertMessage(input.message)
  return prisma.feedback.create({
    data: { authorId: input.authorId, targetId: input.targetId, message: input.message.trim() },
    include: feedbackInclude,
  })
}

export async function updateFeedback(
  input: { feedbackId: string; userId: string; message: string },
): Promise<FeedbackWithAuthor> {
  const existing = await prisma.feedback.findUnique({ where: { id: input.feedbackId } })
  if (!existing) {
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  if (existing.authorId !== input.userId) {
    throw new FeedbackError('Apenas o autor pode editar este feedback.', 403)
  }
  assertMessage(input.message)
  return prisma.feedback.update({
    where: { id: input.feedbackId },
    data: { message: input.message.trim() },
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
  try {
    await prisma.feedback.delete({ where: { id: input.feedbackId } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new FeedbackError('Feedback não encontrado.', 404)
    }
    throw err
  }
}
```

- [ ] **Step 2: Commit** (typecheck só fecha na Task 5)

```bash
git add apps/api/src/services/feedback-service.ts
git commit -m "refactor(api): service de feedback usa message"
```

---

## Task 4: Serialização → `message`

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`

- [ ] **Step 1: Atualizar `toFeedbackDTO`**

Em `apps/api/src/lib/serialize.ts`, substituir a função `toFeedbackDTO` por:

```ts
export function toFeedbackDTO(feedback: FeedbackWithAuthor): FeedbackDTO {
  return {
    id: feedback.id,
    author: toPublicUser(feedback.author),
    message: feedback.message,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
  }
}
```

(Os imports de `FeedbackDTO` e `FeedbackWithAuthor` já existem no arquivo.)

- [ ] **Step 2: Commit** (typecheck só fecha na Task 5)

```bash
git add apps/api/src/lib/serialize.ts
git commit -m "refactor(api): toFeedbackDTO usa message"
```

---

## Task 5: Rotas + testes da API → `message` (TDD)

**Files:**
- Modify: `apps/api/src/routes/feedback.ts`
- Modify: `apps/api/src/routes/feedback.test.ts`

- [ ] **Step 1: Atualizar os testes para `{ message }` (devem falhar)**

Substituir o conteúdo de `apps/api/src/routes/feedback.test.ts` por exatamente:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

const MSG = {
  message: 'Conduziu o incidente de produção com calma, comunicou o time a cada 15 minutos e acelerou a recuperação.',
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
  it('cria um feedback (201)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: MSG,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().feedback.author.name).toBe('Ana')
    expect(res.json().feedback.message).toBe(MSG.message)
    await app.close()
  })

  it('rejeita mensagem curta (400)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'curto' },
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
      payload: MSG,
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
      payload: MSG,
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
      payload: MSG,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('lista feedbacks do alvo em ordem decrescente', async () => {
    const { app, lead, token } = await setup()
    await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
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

  it('GET feedbacks exige autenticação (401)', async () => {
    const { app, lead } = await setup()
    const res = await app.inject({ method: 'GET', url: `/users/${lead.id}/feedbacks` })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('só o autor edita o feedback (403 para outro)', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
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
      payload: { message: 'Tentando editar feedback de outra pessoa, texto longo.' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('autor edita o próprio feedback (200)', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
    const feedbackId = created.json().feedback.id as string
    const res = await app.inject({
      method: 'PATCH',
      url: `/feedbacks/${feedbackId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'Mensagem revisada, suficientemente longa para validar.' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedback.message).toBe('Mensagem revisada, suficientemente longa para validar.')
    await app.close()
  })

  it('ADMIN exclui feedback de outro (204); terceiro não-admin recebe 403', async () => {
    const { app, lead, token } = await setup()
    const created = await app.inject({ method: 'POST', url: `/users/${lead.id}/feedbacks`, headers: { authorization: `Bearer ${token}` }, payload: MSG })
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

Run: `pnpm --filter @legends/api exec vitest run src/routes/feedback.test.ts`
Expected: FAIL (a rota ainda valida o shape antigo / o build quebra com `message`).

- [ ] **Step 2: Atualizar o zod schema da rota**

Em `apps/api/src/routes/feedback.ts`, substituir o `feedbackBodySchema` e o `invalidBody` por:

```ts
const feedbackBodySchema = z.object({
  message: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH),
})

const invalidBody = { message: 'O feedback é obrigatório e precisa ser específico.' }
```

O resto do arquivo permanece igual: `parsed.data` agora é `{ message }` e já é repassado via spread para `createFeedback`/`updateFeedback`, que aceitam `message`.

- [ ] **Step 3: Rodar os testes da rota e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/feedback.test.ts`
Expected: PASS (10 testes).

- [ ] **Step 4: Typecheck + suíte completa da API**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.
Run: `pnpm --filter @legends/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/feedback.ts apps/api/src/routes/feedback.test.ts
git commit -m "refactor(api): rota de feedback valida message"
```

---

## Task 6: `FeedbackSection` — campo único + guia (TDD)

**Files:**
- Modify: `apps/web/src/pages/profile/FeedbackSection.test.tsx`
- Modify: `apps/web/src/pages/profile/FeedbackSection.tsx`

- [ ] **Step 1: Substituir os testes (devem falhar)**

Substituir o conteúdo de `apps/web/src/pages/profile/FeedbackSection.test.tsx` por exatamente:

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
  message: 'Conduziu o incidente com calma e comunicou bem o time.',
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
    localStorage.clear()
    authUser = { id: 'dev1', name: 'Ana', role: 'DEV' }
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/users/lead1/feedbacks') return Promise.resolve({ feedbacks: [FEEDBACK] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
  })

  it('renderiza a lista com autor e a mensagem', async () => {
    renderSection()
    expect(await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('mostra o campo único para quem pode escrever', async () => {
    renderSection()
    expect(await screen.findByLabelText('Seu feedback')).toBeInTheDocument()
  })

  it('exibe o guia ligado por padrão', async () => {
    renderSection()
    expect(await screen.findByText(/Um bom feedback costuma cobrir/)).toBeInTheDocument()
  })

  it('alterna o guia ao clicar no toggle', async () => {
    renderSection()
    const toggle = await screen.findByRole('button', { name: /Guia ligado/ })
    fireEvent.click(toggle)
    expect(screen.queryByText(/Um bom feedback costuma cobrir/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guia desligado/ })).toBeInTheDocument()
  })

  it('esconde o formulário para ADMIN', async () => {
    authUser = { id: 'adm', name: 'Adm', role: 'ADMIN' }
    renderSection()
    await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
    expect(screen.queryByLabelText('Seu feedback')).not.toBeInTheDocument()
  })

  it('esconde o formulário no próprio perfil', async () => {
    authUser = { id: 'lead1', name: 'Líder', role: 'LEAD' }
    renderSection('lead1')
    await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
    expect(screen.queryByLabelText('Seu feedback')).not.toBeInTheDocument()
  })

  it('mostra editar/excluir nos feedbacks do próprio autor', async () => {
    renderSection()
    expect(await screen.findByLabelText('Editar feedback')).toBeInTheDocument()
    expect(screen.getByLabelText('Excluir feedback')).toBeInTheDocument()
  })

  it('ADMIN vê excluir mas não editar em feedback de terceiro', async () => {
    authUser = { id: 'adm', name: 'Adm', role: 'ADMIN' }
    renderSection()
    expect(await screen.findByLabelText('Excluir feedback')).toBeInTheDocument()
    expect(screen.queryByLabelText('Editar feedback')).not.toBeInTheDocument()
  })

  it('envia um novo feedback válido com { message }', async () => {
    mockApiFetch.mockImplementation((path: string, options?: { method?: string; body?: string }) => {
      if (path === '/users/lead1/feedbacks' && options?.method === 'POST') {
        return Promise.resolve({ feedback: FEEDBACK })
      }
      if (path === '/users/lead1/feedbacks') return Promise.resolve({ feedbacks: [] })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderSection()
    fireEvent.change(await screen.findByLabelText('Seu feedback'), {
      target: { value: 'Feedback específico e suficientemente longo.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }))
    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(
        ([p, o]) => p === '/users/lead1/feedbacks' && o?.method === 'POST',
      )
      expect(call).toBeTruthy()
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
        message: 'Feedback específico e suficientemente longo.',
      })
    })
  })
})
```

Run: `pnpm --filter @legends/web exec vitest run src/pages/profile/FeedbackSection.test.tsx`
Expected: FAIL (componente ainda usa 3 campos; sem campo "Seu feedback", sem toggle "Guia").

- [ ] **Step 2: Substituir o componente**

Substituir o conteúdo de `apps/web/src/pages/profile/FeedbackSection.tsx` por exatamente:

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateFeedbackRequest, FeedbackDTO } from '@legends/shared'
import { MIN_FEEDBACK_FIELD_LENGTH } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'
import { useAuth } from '../../auth/AuthContext'

const GUIDE_STORAGE_KEY = 'feedback-guide-enabled'

const GUIDE_ITEMS: { label: string; hint: string }[] = [
  { label: 'Situação', hint: 'em que contexto e quando isso aconteceu?' },
  { label: 'Comportamento', hint: 'o que a pessoa fez — ações observáveis, não interpretações?' },
  { label: 'Impacto', hint: 'que efeito isso gerou no time, no projeto ou em você?' },
]

function readGuidePreference(): boolean {
  if (typeof localStorage === 'undefined') return true
  const stored = localStorage.getItem(GUIDE_STORAGE_KEY)
  return stored === null ? true : stored === 'true'
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function FeedbackSection({ targetId }: { targetId: string }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guideOn, setGuideOn] = useState(readGuidePreference)

  const feedbacksQuery = useQuery({
    queryKey: ['feedbacks', targetId],
    queryFn: () => apiFetch<{ feedbacks: FeedbackDTO[] }>(`/users/${targetId}/feedbacks`),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['feedbacks', targetId] })
  const resetForm = () => {
    setMessage('')
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

  if (feedbacksQuery.isLoading) {
    return (
      <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-7">
        <p className="text-body-sm text-on-surface-variant">Carregando feedbacks…</p>
      </div>
    )
  }
  if (feedbacksQuery.isError) {
    return (
      <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-7">
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar feedbacks.
        </p>
      </div>
    )
  }

  const feedbacks = feedbacksQuery.data?.feedbacks ?? []
  const canWrite = Boolean(user) && user?.role !== 'ADMIN' && user?.id !== targetId
  const isValid = message.trim().length >= MIN_FEEDBACK_FIELD_LENGTH

  function toggleGuide() {
    setGuideOn((prev) => {
      const next = !prev
      if (typeof localStorage !== 'undefined') localStorage.setItem(GUIDE_STORAGE_KEY, String(next))
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!isValid) {
      setError(`O feedback precisa de pelo menos ${MIN_FEEDBACK_FIELD_LENGTH} caracteres.`)
      return
    }
    if (editingId) update.mutate({ id: editingId, body: { message: message.trim() } })
    else create.mutate({ message: message.trim() })
  }

  function startEdit(feedback: FeedbackDTO) {
    setEditingId(feedback.id)
    setError(null)
    setMessage(feedback.message)
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
          <div className="flex items-center justify-between gap-sm">
            <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              {editingId ? 'Editar feedback' : 'Deixar feedback'}
            </p>
            <button
              type="button"
              onClick={toggleGuide}
              aria-pressed={guideOn}
              className={`flex items-center gap-xs rounded-full border px-sm py-0.5 font-label text-label-sm transition-colors ${
                guideOn
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Icon name="lightbulb" className="text-[16px]" />
              Guia {guideOn ? 'ligado' : 'desligado'}
            </button>
          </div>

          {guideOn && (
            <div className="rounded-md border border-outline-variant/30 bg-surface-container-highest p-sm">
              <p className="mb-xs font-label text-label-sm text-on-surface">
                Um bom feedback costuma cobrir três pontos:
              </p>
              <ul className="flex flex-col gap-xs">
                {GUIDE_ITEMS.map((item) => (
                  <li key={item.label} className="text-body-sm text-on-surface-variant">
                    <span className="font-label text-on-surface">{item.label}</span> — {item.hint}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <textarea
            className="min-h-[120px] rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-body-sm text-on-surface outline-none focus:border-primary"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escreva um feedback específico e construtivo…"
            aria-label="Seu feedback"
          />

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
                        type="button"
                        onClick={() => startEdit(feedback)}
                        aria-label="Editar feedback"
                        className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                      >
                        <Icon name="edit" className="text-[18px]" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
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
                <p className="whitespace-pre-wrap text-body-sm text-on-surface">{feedback.message}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

Run: `pnpm --filter @legends/web exec vitest run src/pages/profile/FeedbackSection.test.tsx`
Expected: PASS (9 testes).

- [ ] **Step 3: Typecheck + suíte web completa**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.
Run: `pnpm --filter @legends/web test`
Expected: PASS (inclusive `ProfilePage.test.tsx`, intocado).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/profile/FeedbackSection.tsx apps/web/src/pages/profile/FeedbackSection.test.tsx
git commit -m "feat(web): feedback em campo unico com guia ligavel"
```

---

## Task 7: Verificação final

- [ ] **Step 1: Rodar toda a suíte do monorepo**

Run: `pnpm test`
Expected: PASS em `@legends/shared`, `@legends/api` e `@legends/web`.

- [ ] **Step 2: Smoke manual (opcional)**

Logar como DEV, abrir o perfil de um LEAD: confirmar o campo único, o guia ligado por padrão com as três perguntas, alternar o toggle (recarregar a página mantém a preferência), enviar um feedback e vê-lo na lista; editar e excluir o próprio.

---

## Notas de cobertura (self-review)

- **Campo único `message`** → Tasks 1 (shared), 2 (prisma), 3 (service), 4 (serialize), 5 (rota/zod), 6 (textarea).
- **Guia ligável + painel só-texto + default ligado + localStorage** → Task 6 (`GUIDE_ITEMS`, `readGuidePreference`, `toggleGuide`, `aria-pressed`).
- **Regras de autorização inalteradas** → preservadas na Task 3 e cobertas pelos testes da Task 5.
- **Validação min length** → `assertMessage` (Task 3) + zod (Task 5) + `isValid` (Task 6).
- **ProfilePage intocado** → confirmado (fixture vazia); rodado na Task 6 Step 3.
- **Fora de escopo** (detecção automática, IA, campos SCI separados) — sem tasks.
```
