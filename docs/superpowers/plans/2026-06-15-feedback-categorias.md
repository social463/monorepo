# Categorias de Feedback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar categorias ao feedback (Positivo, Orientação, Elogio, Melhoria) e controlar a visibilidade — Positivo/Elogio para todos; Orientação/Melhoria só para autor, alvo e ADMIN.

**Architecture:** A categoria vira um enum do Prisma + coluna obrigatória em `Feedback`. A regra de visibilidade é aplicada na query do banco (`listFeedbacksForUser`), recebendo o viewer (id + role) da rota, de modo que feedbacks privados nunca trafegam para quem não pode vê-los e a paginação continua correta. O frontend ganha um seletor de categoria no formulário e um badge por feedback.

**Tech Stack:** pnpm monorepo · Fastify + Prisma + Postgres (`apps/api`) · Vite + React + Tailwind + React Query (`apps/web`) · tipos compartilhados em `packages/shared` · testes com Vitest.

**Pré-requisito:** o Postgres de dev precisa estar de pé (`pnpm db:up`) para rodar migração e os testes da API.

---

### Task 1: Tipos compartilhados (`@legends/shared`)

**Files:**
- Modify: `packages/shared/src/feedback.ts`

- [ ] **Step 1: Adicionar enum, labels, conjunto público e atualizar os tipos**

Substituir todo o conteúdo de `packages/shared/src/feedback.ts` por:

```ts
import type { PublicUser } from './auth'

export const MIN_FEEDBACK_FIELD_LENGTH = 10

export const FEEDBACK_CATEGORIES = ['POSITIVO', 'ORIENTACAO', 'ELOGIO', 'MELHORIA'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  POSITIVO: 'Positivo',
  ORIENTACAO: 'Orientação',
  ELOGIO: 'Elogio',
  MELHORIA: 'Melhoria',
}

/** Categorias visíveis para todos os usuários autenticados. As demais são restritas a autor, alvo e ADMIN. */
export const PUBLIC_FEEDBACK_CATEGORIES = ['POSITIVO', 'ELOGIO'] as const satisfies readonly FeedbackCategory[]

export interface FeedbackDTO {
  id: string
  author: PublicUser
  message: string
  category: FeedbackCategory
  createdAt: string
  updatedAt: string
}

export interface CreateFeedbackRequest {
  message: string
  category: FeedbackCategory
}

// Edição altera apenas a mensagem; a categoria não é editável no PATCH.
export interface UpdateFeedbackRequest {
  message: string
}
```

- [ ] **Step 2: Verificar typecheck do pacote shared**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: PASS (sem erros). Os erros de tipo em `apps/api` e `apps/web` serão resolvidos nas próximas tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/feedback.ts
git commit -m "feat(shared): categorias de feedback + visibilidade pública"
```

---

### Task 2: Schema Prisma + migração

**Files:**
- Modify: `apps/api/prisma/schema.prisma:163-176`
- Create: `apps/api/prisma/migrations/<timestamp>_add_feedback_category/migration.sql`

- [ ] **Step 1: Adicionar o enum e a coluna no schema**

Em `apps/api/prisma/schema.prisma`, logo antes de `model Feedback {`, adicionar o enum:

```prisma
enum FeedbackCategory {
  POSITIVO
  ORIENTACAO
  ELOGIO
  MELHORIA
}
```

E alterar o model `Feedback` (linhas 163-176) para:

```prisma
model Feedback {
  id         String           @id @default(cuid())
  authorId   String
  targetId   String
  message    String
  category   FeedbackCategory
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  author User @relation("FeedbacksGiven", fields: [authorId], references: [id])
  target User @relation("FeedbacksReceived", fields: [targetId], references: [id])

  @@index([targetId])
  @@index([authorId])
  @@index([targetId, category])
}
```

Note: a coluna `category` **não** tem `@default` no schema — assim o Prisma Client exige o valor na criação. O backfill das linhas existentes é feito no SQL da migração.

- [ ] **Step 2: Gerar a migração sem aplicar (`--create-only`)**

Run: `pnpm --filter @legends/api exec prisma migrate dev --create-only --name add_feedback_category`
Expected: cria a pasta `apps/api/prisma/migrations/<timestamp>_add_feedback_category/` com `migration.sql`. **Não** aplica ainda.

- [ ] **Step 3: Substituir o SQL gerado pela versão segura (backfill + drop default)**

O SQL gerado automaticamente adiciona a coluna `NOT NULL` sem default e quebraria em tabelas com dados. Substituir todo o conteúdo de `migration.sql` por:

```sql
-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('POSITIVO', 'ORIENTACAO', 'ELOGIO', 'MELHORIA');

-- AlterTable: adiciona com default para preencher linhas existentes, depois remove o default
ALTER TABLE "Feedback" ADD COLUMN "category" "FeedbackCategory" NOT NULL DEFAULT 'POSITIVO';
ALTER TABLE "Feedback" ALTER COLUMN "category" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Feedback_targetId_category_idx" ON "Feedback"("targetId", "category");
```

- [ ] **Step 4: Aplicar a migração e regenerar o client**

Run: `pnpm --filter @legends/api exec prisma migrate dev`
Expected: aplica `add_feedback_category` no banco de dev e regenera o Prisma Client (agora com `category` em `Feedback` e o enum `FeedbackCategory`). Sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): coluna category em Feedback com backfill POSITIVO"
```

---

### Task 3: Serialização — incluir `category` no DTO

**Files:**
- Modify: `apps/api/src/lib/serialize.ts:110-118`

- [ ] **Step 1: Incluir `category` em `toFeedbackDTO`**

Substituir a função `toFeedbackDTO` (linhas 110-118) por:

```ts
export function toFeedbackDTO(feedback: FeedbackWithAuthor): FeedbackDTO {
  return {
    id: feedback.id,
    author: toPublicUser(feedback.author),
    message: feedback.message,
    category: feedback.category,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/serialize.ts
git commit -m "feat(api): serializa category no FeedbackDTO"
```

---

### Task 4: Serviço — persistir categoria e filtrar visibilidade

**Files:**
- Modify: `apps/api/src/services/feedback-service.ts`

- [ ] **Step 1: Importar `PUBLIC_FEEDBACK_CATEGORIES` e o tipo da categoria**

Em `apps/api/src/services/feedback-service.ts`, alterar o import da linha 2:

```ts
import { MIN_FEEDBACK_FIELD_LENGTH, PUBLIC_FEEDBACK_CATEGORIES, type FeedbackCategory } from '@legends/shared'
```

- [ ] **Step 2: Atualizar `listFeedbacksForUser` para receber o viewer e filtrar por visibilidade**

Substituir a função `listFeedbacksForUser` (linhas 24-37) por:

```ts
export function listFeedbacksForUser(
  targetId: string,
  viewer: { id: string; role: string },
  pagination: { offset?: number; limit?: number } = {},
): Promise<FeedbackWithAuthor[]> {
  const limit = pagination.limit ?? 10
  const offset = pagination.offset ?? 0
  // Autor e ADMIN veem tudo do alvo; demais só veem públicos + os privados que eles próprios escreveram.
  const canSeeAll = viewer.id === targetId || viewer.role === 'ADMIN'
  return prisma.feedback.findMany({
    where: {
      targetId,
      ...(canSeeAll
        ? {}
        : {
            OR: [
              { category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] } },
              { authorId: viewer.id },
            ],
          }),
    },
    include: feedbackInclude,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit + 1,
  })
}
```

- [ ] **Step 3: Atualizar `createFeedback` para aceitar e persistir `category`**

Substituir a assinatura e o `prisma.feedback.create` de `createFeedback` (linhas 39-61). A assinatura passa a ser:

```ts
export async function createFeedback(
  input: { authorId: string; targetId: string; message: string; category: FeedbackCategory },
): Promise<FeedbackWithAuthor> {
```

E o `create` no final da função passa a ser:

```ts
  return prisma.feedback.create({
    data: {
      authorId: input.authorId,
      targetId: input.targetId,
      message: input.message.trim(),
      category: input.category,
    },
    include: feedbackInclude,
  })
```

(O restante das validações da função — não dar feedback a si mesmo, autor ativo/não-ADMIN, alvo válido, `assertMessage` — permanece igual.)

- [ ] **Step 4: Atualizar a rota para passar o viewer e validar a categoria**

Em `apps/api/src/routes/feedback.ts`:

Alterar o import da linha 3 para incluir `FEEDBACK_CATEGORIES`:

```ts
import { FEEDBACK_CATEGORIES, MIN_FEEDBACK_FIELD_LENGTH } from '@legends/shared'
```

Substituir o `feedbackBodySchema` (linhas 20-22) por dois schemas (create exige categoria; update só mensagem):

```ts
const createFeedbackSchema = z.object({
  message: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH),
  category: z.enum(FEEDBACK_CATEGORIES),
})

const updateFeedbackSchema = z.object({
  message: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH),
})
```

No handler `GET /users/:id/feedbacks` (linha 32), passar o viewer:

```ts
    const rows = await listFeedbacksForUser(
      id,
      { id: request.user.sub, role: request.user.role },
      { offset, limit },
    )
```

No handler `POST` (linha 39), trocar `feedbackBodySchema` por `createFeedbackSchema`:

```ts
    const parsed = createFeedbackSchema.safeParse(request.body)
```

No handler `PATCH` (linha 58), trocar `feedbackBodySchema` por `updateFeedbackSchema`:

```ts
    const parsed = updateFeedbackSchema.safeParse(request.body)
```

- [ ] **Step 5: Verificar typecheck/build da API**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: PASS. Se aparecer erro de `category` em `prisma.feedback.create`, o Prisma Client não foi regenerado — rode `pnpm --filter @legends/api exec prisma generate`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/feedback-service.ts apps/api/src/routes/feedback.ts
git commit -m "feat(api): visibilidade por categoria + categoria obrigatoria na criacao"
```

---

### Task 5: Testes de backend (visibilidade + validação de categoria)

**Files:**
- Modify: `apps/api/src/routes/feedback.test.ts`

- [ ] **Step 1: Atualizar fixtures existentes para incluir categoria**

Em `apps/api/src/routes/feedback.test.ts`, alterar a constante `MSG` (linhas 5-7) para incluir uma categoria pública:

```ts
const MSG = {
  message: 'Conduziu o incidente de produção com calma, comunicou o time a cada 15 minutos e acelerou a recuperação.',
  category: 'POSITIVO',
}
```

E no teste de paginação, a criação direta via Prisma (linha 118) precisa de `category`. Substituir aquela linha por:

```ts
      await prisma.feedback.create({ data: { authorId: author.id, targetId: target.id, message: 'feedback suficientemente longo para passar na validação', category: 'POSITIVO' } })
```

- [ ] **Step 2: Escrever os testes de categoria e visibilidade (devem falhar antes da lógica? não — a lógica já existe das tasks anteriores; estes testes a validam)**

Adicionar os seguintes testes dentro do `describe('feedback routes', ...)`, antes do fechamento `})` da linha 209:

```ts
  it('rejeita criação sem categoria (400)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita categoria inválida (400)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'INEXISTENTE' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('persiste a categoria enviada (201)', async () => {
    const { app, lead, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'ELOGIO' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().feedback.category).toBe('ELOGIO')
    await app.close()
  })

  it('feedback privado (ORIENTACAO) NÃO aparece para um terceiro', async () => {
    const { app, lead, token } = await setup()
    // Ana (token) escreve um feedback privado para o líder.
    await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'ORIENTACAO' },
    })
    // Terceiro (Bia) autenticado lista os feedbacks do líder.
    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const otherToken = other.json().accessToken as string
    const res = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().feedbacks).toHaveLength(0)
    await app.close()
  })

  it('feedback público (POSITIVO) aparece para um terceiro', async () => {
    const { app, lead, token } = await setup()
    await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'POSITIVO' },
    })
    const other = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const otherToken = other.json().accessToken as string
    const res = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(res.json().feedbacks).toHaveLength(1)
    await app.close()
  })

  it('feedback privado aparece para o autor, para o alvo e para ADMIN', async () => {
    const { app, lead, token, authorId } = await setup()
    await app.inject({
      method: 'POST',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: MSG.message, category: 'MELHORIA' },
    })

    // Autor (Ana) vê o próprio privado.
    const asAuthor = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(asAuthor.json().feedbacks).toHaveLength(1)

    // Alvo (líder) logado vê o privado destinado a ele.
    const leadLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'lead@empresa.com', password: 'changeme123' },
    })
    // O líder do setup não tem senha utilizável; gera um token via JWT do app.
    const leadToken = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
    const asTarget = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${leadToken}` },
    })
    expect(asTarget.json().feedbacks).toHaveLength(1)

    // ADMIN vê o privado de qualquer par.
    const adminReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Adm', email: 'adm@empresa.com', password: 'changeme123' },
    })
    const adminId = adminReg.json().user.id as string
    await prisma.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } })
    const adminToken = app.jwt.sign({ sub: adminId, role: 'ADMIN' })
    const asAdmin = await app.inject({
      method: 'GET',
      url: `/users/${lead.id}/feedbacks`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(asAdmin.json().feedbacks).toHaveLength(1)

    void leadLogin
    void authorId
    await app.close()
  })
```

Note sobre o token do alvo/admin: o app expõe `app.jwt.sign(...)` (via `@fastify/jwt`), usado aqui para emitir um token de teste para usuários criados direto no banco (que não têm senha). Confirme no Step 3 se compila; se `app.jwt` não estiver tipado, use `(app as any).jwt.sign(...)`.

- [ ] **Step 3: Rodar os testes da API**

Run: `pnpm --filter @legends/api test`
Expected: PASS — todos os testes de feedback, incluindo os novos de visibilidade e validação de categoria. (Postgres precisa estar de pé.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/feedback.test.ts
git commit -m "test(api): visibilidade por categoria e validacao de categoria"
```

---

### Task 6: Frontend — seletor de categoria + badge

**Files:**
- Modify: `apps/web/src/pages/profile/FeedbackSection.tsx`

- [ ] **Step 1: Atualizar imports e adicionar mapa de estilos das categorias**

Em `apps/web/src/pages/profile/FeedbackSection.tsx`, alterar os imports das linhas 3-4 para:

```ts
import type { CreateFeedbackRequest, FeedbackDTO, FeedbackCategory } from '@legends/shared'
import { MIN_FEEDBACK_FIELD_LENGTH, FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABELS } from '@legends/shared'
```

Logo após o array `GUIDE_ITEMS` (depois da linha 16), adicionar o mapa de estilos do badge:

```ts
// Estilo do badge por categoria. `locked` marca as categorias restritas (só autor, alvo e ADMIN veem).
const CATEGORY_BADGE: Record<FeedbackCategory, { cls: string; locked: boolean }> = {
  POSITIVO: { cls: 'bg-emerald-500/15 text-emerald-600', locked: false },
  ELOGIO: { cls: 'bg-amber-500/15 text-amber-600', locked: false },
  ORIENTACAO: { cls: 'bg-sky-500/15 text-sky-600', locked: true },
  MELHORIA: { cls: 'bg-violet-500/15 text-violet-600', locked: true },
}
```

(As cores usam a paleta padrão do Tailwind; ajuste para os tokens do design system se preferir.)

- [ ] **Step 2: Adicionar estado da categoria e ajustar a validação de envio**

Após a linha `const [message, setMessage] = useState('')` (linha 41), adicionar:

```ts
  const [category, setCategory] = useState<FeedbackCategory | ''>('')
```

No `resetForm` (linhas 64-68), limpar também a categoria:

```ts
  const resetForm = () => {
    setMessage('')
    setCategory('')
    setEditingId(null)
    setError(null)
  }
```

Substituir a linha `const isValid = message.trim().length >= MIN_FEEDBACK_FIELD_LENGTH` (linha 123) por:

```ts
  const messageValid = message.trim().length >= MIN_FEEDBACK_FIELD_LENGTH
  // Categoria é obrigatória só na criação; na edição altera-se apenas a mensagem.
  const canSubmit = messageValid && (editingId !== null || category !== '')
```

Substituir `handleSubmit` (linhas 133-141) por:

```ts
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!messageValid) {
      setError(`O feedback precisa de pelo menos ${MIN_FEEDBACK_FIELD_LENGTH} caracteres.`)
      return
    }
    if (editingId) {
      update.mutate({ id: editingId, body: { message: message.trim() } })
      return
    }
    if (category === '') {
      setError('Selecione uma categoria.')
      return
    }
    create.mutate({ message: message.trim(), category })
  }
```

- [ ] **Step 3: Tipar o body do `create` com categoria**

A mutation `create` (linhas 70-81) já usa `CreateFeedbackRequest`, que agora inclui `category` — nenhuma mudança de assinatura é necessária. Confirme apenas que o `body` passado em `handleSubmit` (`{ message, category }`) satisfaz `CreateFeedbackRequest`.

- [ ] **Step 4: Renderizar o seletor de categoria no formulário**

No formulário, logo **antes** do `<textarea ...>` (linha 200), adicionar o seletor. Ele só faz sentido na criação (não na edição), então é condicionado a `!editingId`:

```tsx
          {!editingId && (
            <div className="flex flex-col gap-xs">
              <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                Categoria
              </p>
              <div className="flex flex-wrap gap-xs" role="group" aria-label="Categoria do feedback">
                {FEEDBACK_CATEGORIES.map((cat) => {
                  const selected = category === cat
                  return (
                    <button
                      key={cat}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setCategory(cat)}
                      className={`flex items-center gap-xs rounded-full border px-sm py-0.5 font-label text-label-sm transition-colors ${
                        selected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {CATEGORY_BADGE[cat].locked && <Icon name="lock" className="text-[14px]" />}
                      {FEEDBACK_CATEGORY_LABELS[cat]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
```

- [ ] **Step 5: Trocar `isValid` por `canSubmit` no botão de envio**

No botão `type="submit"` (linha 217), trocar `disabled={!isValid || ...}` por:

```tsx
              disabled={!canSubmit || create.isPending || update.isPending}
```

- [ ] **Step 6: Renderizar o badge da categoria em cada feedback**

No item da lista, dentro do bloco do cabeçalho do feedback, adicionar o badge ao lado da data. Substituir o `<div className="min-w-0 flex-grow">...</div>` (linhas 251-254) por:

```tsx
                  <div className="min-w-0 flex-grow">
                    <p className="truncate font-label text-label-md text-on-surface">{feedback.author.name}</p>
                    <div className="flex items-center gap-sm">
                      <p className="font-label text-label-sm text-on-surface-variant">{formatDate(feedback.createdAt)}</p>
                      <span
                        className={`flex items-center gap-xs rounded-full px-sm py-0.5 font-label text-label-sm ${CATEGORY_BADGE[feedback.category].cls}`}
                      >
                        {CATEGORY_BADGE[feedback.category].locked && <Icon name="lock" className="text-[14px]" />}
                        {FEEDBACK_CATEGORY_LABELS[feedback.category]}
                      </span>
                    </div>
                  </div>
```

- [ ] **Step 7: Verificar typecheck do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/profile/FeedbackSection.tsx
git commit -m "feat(web): seletor de categoria e badge por feedback"
```

---

### Task 7: Testes de frontend

**Files:**
- Modify: `apps/web/src/pages/profile/FeedbackSection.test.tsx`

- [ ] **Step 1: Adicionar `category` aos fixtures**

Em `apps/web/src/pages/profile/FeedbackSection.test.tsx`, adicionar `category` aos objetos `FEEDBACK` e `FEEDBACK2`. No `FEEDBACK` (linha 19-25), adicionar após `message`:

```ts
  category: 'POSITIVO',
```

No `FEEDBACK2` (linhas 27-33), adicionar após `message`:

```ts
  category: 'ORIENTACAO',
```

- [ ] **Step 2: Atualizar o teste de envio para selecionar categoria e esperar `{ message, category }`**

Substituir o teste `'envia um novo feedback válido com { message }'` (linhas 106-128) por:

```ts
  it('envia um novo feedback com { message, category }', async () => {
    mockApiFetch.mockImplementation((path: string, options?: { method?: string; body?: string }) => {
      if (path.startsWith('/users/lead1/feedbacks') && options?.method === 'POST') {
        return Promise.resolve({ feedback: FEEDBACK })
      }
      if (path.startsWith('/users/lead1/feedbacks')) return Promise.resolve({ feedbacks: [], hasMore: false })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderSection()
    fireEvent.change(await screen.findByLabelText('Seu feedback'), {
      target: { value: 'Feedback específico e suficientemente longo.' },
    })
    // Categoria é obrigatória: o envio fica bloqueado até escolher uma.
    expect(screen.getByRole('button', { name: 'Enviar feedback' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Elogio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }))
    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(
        ([p, o]) => p.startsWith('/users/lead1/feedbacks') && o?.method === 'POST',
      )
      expect(call).toBeTruthy()
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
        message: 'Feedback específico e suficientemente longo.',
        category: 'ELOGIO',
      })
    })
  })
```

- [ ] **Step 3: Adicionar teste do badge de categoria**

Adicionar este teste dentro do `describe('FeedbackSection', ...)`, antes do fechamento `})` final:

```ts
  it('exibe o badge da categoria em cada feedback', async () => {
    renderSection()
    await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
    // FEEDBACK tem category POSITIVO → badge "Positivo".
    // O texto "Positivo" também existe como botão do seletor de categoria no formulário,
    // então usamos getAllByText (esperamos pelo menos um match: o badge).
    expect(screen.getAllByText('Positivo').length).toBeGreaterThanOrEqual(1)
  })
```

- [ ] **Step 4: Rodar os testes do web**

Run: `pnpm --filter @legends/web test`
Expected: PASS — todos os testes de `FeedbackSection`, incluindo o seletor obrigatório e o badge.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/profile/FeedbackSection.test.tsx
git commit -m "test(web): seletor de categoria obrigatorio e badge"
```

---

### Task 8: Verificação final

- [ ] **Step 1: Rodar a suíte completa**

Run: `pnpm test`
Expected: PASS em `@legends/shared`, `@legends/api` e `@legends/web`.

- [ ] **Step 2: Build geral (typecheck de produção)**

Run: `pnpm build`
Expected: PASS sem erros de tipo.

- [ ] **Step 3 (opcional): smoke manual**

Subir o app (`pnpm dev`), criar um feedback de cada categoria e confirmar:
- Positivo/Elogio aparecem para outro usuário.
- Orientação/Melhoria só aparecem para autor, alvo e ADMIN.
- Badge com cor e cadeado nas categorias restritas.

---

## Notas de verificação do plano (self-review)

- **Cobertura do spec:** modelo+migração (Task 2), visibilidade backend (Task 4), DTO/shared (Tasks 1, 3), frontend seletor+badge (Task 6), testes back/front (Tasks 5, 7). ✔
- **Default removido:** migração adiciona `DEFAULT 'POSITIVO'` para backfill e dá `DROP DEFAULT` em seguida; schema.prisma não tem `@default`, então o Client exige `category` na criação. ✔
- **Schemas separados:** `createFeedbackSchema` (com categoria) vs `updateFeedbackSchema` (só mensagem) — o PATCH não exige categoria, consistente com `UpdateFeedbackRequest`. ✔
- **Tokens de teste para usuários sem senha:** usa `app.jwt.sign(...)`; fallback `(app as any).jwt.sign(...)` se a tipagem reclamar.
