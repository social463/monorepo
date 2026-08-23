# Selo de Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um tipo de selo (`FEEDBACK`) concedido automaticamente com base no total de feedbacks que o usuário fez, com limiar definido pelo admin e revogação quando a contagem cai.

**Architecture:** Reutiliza o modelo `Badge` existente com um novo valor de enum `BadgeKind = FEEDBACK`. A qualificação conta `Feedback` onde `authorId = usuário`. Uma nova função `syncFeedbackBadgesForUser` concede e revoga selos `FEEDBACK` AUTO, disparada após criar e apagar feedback. Selos de voto seguem permanentes e intocados.

**Tech Stack:** Fastify + Prisma (PostgreSQL), Zod, Vitest, React + TypeScript (Vite), pnpm monorepo, pacote compartilhado `@legends/shared`.

## Global Constraints

- Monorepo pnpm. API em `apps/api` (pacote `@legends/api`), web em `apps/web`, tipos em `packages/shared`.
- Testes da API rodam contra Postgres real; resetam o banco em `beforeEach` (`apps/api/test/setup.ts`). Rodar: `pnpm --filter @legends/api test`.
- Migrations Prisma: `pnpm db:migrate` (= `pnpm --filter @legends/api exec prisma migrate dev`).
- Selos automáticos usam `source = AUTO` e `periodId = null`; concessões `MANUAL` nunca são revogadas automaticamente.
- O ramo de qualificação atual trata o race `P2002` ignorando silenciosamente (manter esse padrão).
- Mensagens de usuário em português.

---

## File Structure

- `packages/shared/src/enums.ts` — adiciona `FEEDBACK` à constante `BADGE_KINDS` (fonte do tipo `BadgeKind`). **MODIFY**
- `apps/api/prisma/schema.prisma` — adiciona `FEEDBACK` ao enum `BadgeKind`. **MODIFY**
- `apps/api/prisma/migrations/<timestamp>_add_feedback_badge_kind/migration.sql` — `ALTER TYPE ... ADD VALUE`. **CREATE (via prisma migrate)**
- `apps/api/src/services/badge-service.ts` — ramo `FEEDBACK` em `qualifies`; nova `syncFeedbackBadgesForUser`; `evaluateBadgesForUser` ignora `FEEDBACK`. **MODIFY**
- `apps/api/src/services/badge-service.test.ts` — testes da lógica nova. **MODIFY**
- `apps/api/src/services/feedback-service.ts` — `deleteFeedback` passa a retornar o `authorId` do feedback removido. **MODIFY**
- `apps/api/src/routes/feedback.ts` — dispara `syncFeedbackBadgesForUser` após criar e após apagar. **MODIFY**
- `apps/api/src/routes/feedback.test.ts` — testes de integração dos gatilhos. **MODIFY**
- `apps/api/src/routes/admin.ts` — adiciona `'FEEDBACK'` ao `badgeKindSchema`. **MODIFY**
- `apps/api/src/routes/admin.test.ts` — teste de criar selo `FEEDBACK`. **MODIFY**
- `apps/web/src/pages/admin/BadgesSection.tsx` — adiciona a opção "Feedback" ao seletor de tipo. **MODIFY**

---

## Task 1: Adicionar o valor `FEEDBACK` ao enum BadgeKind (shared + Prisma + migration)

**Files:**
- Modify: `packages/shared/src/enums.ts:12`
- Modify: `apps/api/prisma/schema.prisma:27-32`
- Create: `apps/api/prisma/migrations/<timestamp>_add_feedback_badge_kind/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: o tipo `BadgeKind` (`@legends/shared`) e o enum Prisma `BadgeKind` passam a aceitar `'FEEDBACK'`. Tarefas seguintes dependem disso.

- [ ] **Step 1: Adicionar `FEEDBACK` à constante compartilhada**

Em `packages/shared/src/enums.ts`, alterar a linha 12:

```ts
export const BADGE_KINDS = ['CATEGORY', 'RECURRENCE', 'IMPACT', 'HIGHLIGHT', 'FEEDBACK'] as const
```

- [ ] **Step 2: Adicionar `FEEDBACK` ao enum no schema Prisma**

Em `apps/api/prisma/schema.prisma`, no enum `BadgeKind` (linhas 27-32), adicionar a entrada `FEEDBACK`:

```prisma
enum BadgeKind {
  CATEGORY
  RECURRENCE
  IMPACT
  HIGHLIGHT
  FEEDBACK
}
```

- [ ] **Step 3: Gerar a migration e o client**

Run: `pnpm db:migrate --name add_feedback_badge_kind`
Expected: cria `apps/api/prisma/migrations/<timestamp>_add_feedback_badge_kind/migration.sql` contendo `ALTER TYPE "BadgeKind" ADD VALUE 'FEEDBACK';`, aplica no banco de dev e regenera o Prisma Client sem erros.

- [ ] **Step 4: Compilar o pacote shared e checar tipos**

Run: `pnpm --filter @legends/shared build && pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros de tipo. (O Prisma Client regenerado e o tipo `BadgeKind` já reconhecem `FEEDBACK`.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/enums.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat: adiciona BadgeKind FEEDBACK (enum shared + prisma + migration)"
```

---

## Task 2: Qualificação `FEEDBACK` e `syncFeedbackBadgesForUser` no badge-service

**Files:**
- Modify: `apps/api/src/services/badge-service.ts`
- Test: `apps/api/src/services/badge-service.test.ts`

**Interfaces:**
- Consumes: enum `BadgeKind` com `FEEDBACK` (Task 1).
- Produces:
  - `qualifies(userId, badge)` retorna `true` para `badge.kind === 'FEEDBACK'` quando `count(Feedback where authorId = userId) >= badge.threshold`.
  - `export async function syncFeedbackBadgesForUser(userId: string): Promise<{ awarded: UserBadge[]; revoked: number }>` — concede selos `FEEDBACK` qualificados e ainda não possuídos (AUTO, `periodId: null`) e revoga selos `FEEDBACK` AUTO (`periodId: null`) que não qualificam mais. Nunca toca em concessões `MANUAL`.
  - `evaluateBadgesForUser` ignora badges com `kind === 'FEEDBACK'`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final do `describe('badge service', ...)` em `apps/api/src/services/badge-service.test.ts`. Importar `syncFeedbackBadgesForUser` no topo do arquivo (junto dos outros imports de `./badge-service`).

Helper local (colocar logo após `makePeriod`, antes de `const just`):

```ts
async function makeFeedbackBadge(threshold: number, slug = `feedbacker-${threshold}`) {
  return prisma.badge.create({
    data: { slug, name: `Feedbacker ${threshold}`, description: `${threshold} feedbacks feitos`, kind: 'FEEDBACK', iconKey: 'chat', threshold },
  })
}
async function giveFeedback(authorId: string, targetId: string) {
  return prisma.feedback.create({
    data: { authorId, targetId, message: 'feedback suficientemente longo para a contagem', category: 'POSITIVO' },
  })
}
```

Testes:

```ts
it('awards a FEEDBACK badge once the author reaches the threshold of feedbacks given', async () => {
  const author = await makeUser('Autor')
  const t1 = await makeUser('Alvo1')
  const t2 = await makeUser('Alvo2')
  const badge = await makeFeedbackBadge(2)

  await giveFeedback(author.id, t1.id)
  expect((await syncFeedbackBadgesForUser(author.id)).awarded).toHaveLength(0)

  await giveFeedback(author.id, t2.id)
  const res = await syncFeedbackBadgesForUser(author.id)
  expect(res.awarded).toHaveLength(1)
  expect(res.awarded[0].badgeId).toBe(badge.id)

  // idempotente
  expect((await syncFeedbackBadgesForUser(author.id)).awarded).toHaveLength(0)
})

it('revokes an AUTO FEEDBACK badge when the count drops below the threshold', async () => {
  const author = await makeUser('Autor')
  const t1 = await makeUser('Alvo1')
  const t2 = await makeUser('Alvo2')
  const badge = await makeFeedbackBadge(2)

  const f1 = await giveFeedback(author.id, t1.id)
  await giveFeedback(author.id, t2.id)
  expect((await syncFeedbackBadgesForUser(author.id)).awarded).toHaveLength(1)

  await prisma.feedback.delete({ where: { id: f1.id } })
  const res = await syncFeedbackBadgesForUser(author.id)
  expect(res.revoked).toBe(1)
  expect(await prisma.userBadge.count({ where: { userId: author.id, badgeId: badge.id } })).toBe(0)
})

it('does not revoke a MANUAL FEEDBACK badge even below the threshold', async () => {
  const author = await makeUser('Autor')
  const admin = await makeUser('Admin')
  const badge = await makeFeedbackBadge(5)
  await prisma.userBadge.create({
    data: { userId: author.id, badgeId: badge.id, source: 'MANUAL', awardedById: admin.id, periodId: null },
  })

  const res = await syncFeedbackBadgesForUser(author.id)
  expect(res.revoked).toBe(0)
  expect(await prisma.userBadge.count({ where: { userId: author.id, badgeId: badge.id } })).toBe(1)
})

it('evaluateBadgesForUser ignores FEEDBACK badges', async () => {
  const author = await makeUser('Autor')
  const t1 = await makeUser('Alvo1')
  await makeFeedbackBadge(1)
  await giveFeedback(author.id, t1.id)

  expect(await evaluateBadgesForUser(author.id)).toHaveLength(0)
})
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `pnpm --filter @legends/api test src/services/badge-service.test.ts`
Expected: FAIL — `syncFeedbackBadgesForUser` não existe (erro de import / TypeError) e o teste de `evaluateBadgesForUser` pode conceder indevidamente.

- [ ] **Step 3: Implementar a lógica no badge-service**

Em `apps/api/src/services/badge-service.ts`:

(a) Adicionar a contagem de feedbacks feitos (perto das outras funções `count*`, após `countDistinctMonths`):

```ts
function countFeedbacksAuthored(userId: string): Promise<number> {
  return prisma.feedback.count({ where: { authorId: userId } })
}
```

(b) Adicionar o ramo `FEEDBACK` em `qualifies` (antes do `return false` final):

```ts
  if (badge.kind === 'FEEDBACK') {
    return (await countFeedbacksAuthored(userId)) >= badge.threshold
  }
```

(c) Fazer `evaluateBadgesForUser` ignorar selos `FEEDBACK`. Alterar a linha que itera os badges para pular esse kind logo no início do loop (junto do `if (ownedIds.has(badge.id)) continue`):

```ts
  for (const badge of badges) {
    if (badge.kind === 'FEEDBACK') continue
    if (ownedIds.has(badge.id)) continue
    // ... resto inalterado
```

(d) Adicionar a nova função (após `evaluateBadgesForUser`):

```ts
/**
 * Sincroniza os selos FEEDBACK (AUTO, periodId null) do usuário com a contagem atual de
 * feedbacks feitos: concede os que passaram a qualificar e revoga os que não qualificam mais.
 * Nunca mexe em concessões MANUAL.
 */
export async function syncFeedbackBadgesForUser(
  userId: string,
): Promise<{ awarded: UserBadge[]; revoked: number }> {
  const [feedbackBadges, autoOwned, count] = await Promise.all([
    prisma.badge.findMany({ where: { kind: 'FEEDBACK' } }),
    prisma.userBadge.findMany({
      where: { userId, periodId: null, source: 'AUTO', badge: { kind: 'FEEDBACK' } },
      select: { id: true, badgeId: true },
    }),
    countFeedbacksAuthored(userId),
  ])
  const ownedByBadgeId = new Map(autoOwned.map((entry) => [entry.badgeId, entry.id]))

  const awarded: UserBadge[] = []
  const toRevoke: string[] = []
  for (const badge of feedbackBadges) {
    const qualifies = count >= badge.threshold
    const ownedUserBadgeId = ownedByBadgeId.get(badge.id)
    if (qualifies && !ownedUserBadgeId) {
      try {
        awarded.push(await prisma.userBadge.create({ data: { userId, badgeId: badge.id } }))
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // concorrência: já concedido, ignora
        } else {
          throw err
        }
      }
    } else if (!qualifies && ownedUserBadgeId) {
      toRevoke.push(ownedUserBadgeId)
    }
  }

  let revoked = 0
  if (toRevoke.length > 0) {
    revoked = (await prisma.userBadge.deleteMany({ where: { id: { in: toRevoke } } })).count
  }
  return { awarded, revoked }
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `pnpm --filter @legends/api test src/services/badge-service.test.ts`
Expected: PASS (todos, incluindo os testes pré-existentes de selos de voto).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts
git commit -m "feat(api): qualificação e sync de selos FEEDBACK (concede e revoga)"
```

---

## Task 3: `deleteFeedback` retorna o autor + gatilhos nas rotas de feedback

**Files:**
- Modify: `apps/api/src/services/feedback-service.ts:108-127`
- Modify: `apps/api/src/routes/feedback.ts`
- Test: `apps/api/src/routes/feedback.test.ts`

**Interfaces:**
- Consumes: `syncFeedbackBadgesForUser(userId)` (Task 2).
- Produces: `deleteFeedback(input)` passa a retornar `Promise<{ authorId: string }>` (o autor do feedback removido). As rotas `POST /users/:id/feedbacks` e `DELETE /feedbacks/:id` chamam `syncFeedbackBadgesForUser` após a operação.

- [ ] **Step 1: Escrever os testes de integração que falham**

Em `apps/api/src/routes/feedback.test.ts`, adicionar testes dentro do `describe('feedback routes', ...)`. Usar o helper `setup()` existente (devolve `{ app, token, authorId, lead }`).

```ts
it('concede selo FEEDBACK ao autor quando atinge o limiar ao criar feedback', async () => {
  const { app, token, authorId, lead } = await setup()
  const badge = await prisma.badge.create({
    data: { slug: 'feedbacker-1', name: 'Feedbacker', description: '1 feedback', kind: 'FEEDBACK', iconKey: 'chat', threshold: 1 },
  })

  const res = await app.inject({
    method: 'POST',
    url: `/users/${lead.id}/feedbacks`,
    headers: { authorization: `Bearer ${token}` },
    payload: MSG,
  })
  expect(res.statusCode).toBe(201)
  expect(await prisma.userBadge.count({ where: { userId: authorId, badgeId: badge.id } })).toBe(1)
  await app.close()
})

it('revoga selo FEEDBACK AUTO quando apagar feedback derruba a contagem abaixo do limiar', async () => {
  const { app, token, authorId, lead } = await setup()
  const badge = await prisma.badge.create({
    data: { slug: 'feedbacker-1', name: 'Feedbacker', description: '1 feedback', kind: 'FEEDBACK', iconKey: 'chat', threshold: 1 },
  })
  const created = await app.inject({
    method: 'POST',
    url: `/users/${lead.id}/feedbacks`,
    headers: { authorization: `Bearer ${token}` },
    payload: MSG,
  })
  const feedbackId = created.json().feedback.id as string
  expect(await prisma.userBadge.count({ where: { userId: authorId, badgeId: badge.id } })).toBe(1)

  const del = await app.inject({
    method: 'DELETE',
    url: `/feedbacks/${feedbackId}`,
    headers: { authorization: `Bearer ${token}` },
  })
  expect(del.statusCode).toBe(204)
  expect(await prisma.userBadge.count({ where: { userId: authorId, badgeId: badge.id } })).toBe(0)
  await app.close()
})
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `pnpm --filter @legends/api test src/routes/feedback.test.ts`
Expected: FAIL — nenhum selo é concedido/revogado (os gatilhos ainda não existem).

- [ ] **Step 3: Fazer `deleteFeedback` retornar o autor**

Em `apps/api/src/services/feedback-service.ts`, na função `deleteFeedback` (linha 108). O `existing` já é buscado para a checagem de permissão; retornar o `authorId` no fim:

```ts
export async function deleteFeedback(input: { feedbackId: string; userId: string }): Promise<{ authorId: string }> {
  const existing = await prisma.feedback.findUnique({ where: { id: input.feedbackId } })
  if (!existing) {
    throw new FeedbackError('Feedback não encontrado.', 404)
  }
  if (existing.authorId !== input.userId) {
    const actor = await prisma.user.findUnique({ where: { id: input.userId } })
    if (!actor || actor.role !== 'ADMIN') {
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
  return { authorId: existing.authorId }
}
```

> Nota: preservar o `try/catch` e o `throw` existentes exatamente como estão hoje — só muda a assinatura de retorno e o `return` final. Verifique se `Prisma` já está importado no arquivo; se não, manter o tratamento de erro como já existe.

- [ ] **Step 4: Disparar a sync nas rotas**

Em `apps/api/src/routes/feedback.ts`:

(a) Adicionar o import no topo (junto dos outros imports de services):

```ts
import { syncFeedbackBadgesForUser } from '../services/badge-service'
```

(b) No handler `POST /users/:id/feedbacks`, após criar o feedback e antes do `return reply.code(201)...`:

```ts
      const feedback = await createFeedback({
        authorId: request.user.sub,
        targetId: id,
        ...parsed.data,
      })
      await syncFeedbackBadgesForUser(request.user.sub)
      return reply.code(201).send({ feedback: toFeedbackDTO(feedback, request.user.sub) })
```

(c) No handler `DELETE /feedbacks/:id`, usar o autor retornado para sincronizar:

```ts
  app.delete('/feedbacks/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { authorId } = await deleteFeedback({ feedbackId: id, userId: request.user.sub })
      await syncFeedbackBadgesForUser(authorId)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof FeedbackError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `pnpm --filter @legends/api test src/routes/feedback.test.ts`
Expected: PASS (incluindo os testes pré-existentes de feedback).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/feedback-service.ts apps/api/src/routes/feedback.ts apps/api/src/routes/feedback.test.ts
git commit -m "feat(api): sincroniza selos FEEDBACK ao criar/apagar feedback"
```

---

## Task 4: Aceitar `FEEDBACK` no admin (validação) + teste

**Files:**
- Modify: `apps/api/src/routes/admin.ts:56`
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: enum `BadgeKind` com `FEEDBACK` (Task 1).
- Produces: `POST /admin/badges` e `PATCH /admin/badges/:id` aceitam `kind: 'FEEDBACK'`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/routes/admin.test.ts`, adicionar logo após o teste `creates a badge (POST /admin/badges, slug auto)` (~linha 485). Usa o helper `adminToken(app)` já existente no arquivo, mesmo padrão do teste vizinho:

```ts
it('creates a FEEDBACK badge (POST /admin/badges)', async () => {
  const app = buildApp()
  await app.ready()
  const token = await adminToken(app)
  const res = await app.inject({
    method: 'POST',
    url: '/admin/badges',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Mentor de Feedback', description: '10 feedbacks feitos', kind: 'FEEDBACK', iconKey: 'chat', threshold: 10 },
  })
  expect(res.statusCode).toBe(201)
  expect(res.json().badge.kind).toBe('FEEDBACK')
  await app.close()
})
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `pnpm --filter @legends/api test src/routes/admin.test.ts`
Expected: FAIL com 400 — `badgeKindSchema` ainda rejeita `'FEEDBACK'`.

- [ ] **Step 3: Adicionar `FEEDBACK` ao schema de validação**

Em `apps/api/src/routes/admin.ts`, linha 56:

```ts
const badgeKindSchema = z.enum(['CATEGORY', 'RECURRENCE', 'IMPACT', 'FEEDBACK'])
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `pnpm --filter @legends/api test src/routes/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): admin aceita criar selo do tipo FEEDBACK"
```

---

## Task 5: Opção "Feedback" no formulário de selos do admin (web)

**Files:**
- Modify: `apps/web/src/pages/admin/BadgesSection.tsx:19-23`

**Interfaces:**
- Consumes: tipo `BadgeKind` de `@legends/shared` (via `BadgeDTO["kind"]`), agora com `FEEDBACK` (Task 1).
- Produces: o seletor de tipo de selo no admin oferece "Feedback".

- [ ] **Step 1: Adicionar a opção ao array de tipos**

Em `apps/web/src/pages/admin/BadgesSection.tsx`, no array `BADGE_KINDS` (linhas 19-23), acrescentar a entrada FEEDBACK:

```tsx
const BADGE_KINDS: { value: BadgeKind; label: string }[] = [
  { value: "CATEGORY", label: "Por categoria" },
  { value: "IMPACT", label: "Por impacto (total de votos)" },
  { value: "RECURRENCE", label: "Recorrência (meses distintos)" },
  { value: "FEEDBACK", label: "Feedback (total de feedbacks feitos)" },
];
```

> O campo `categorySlug` no formulário só aparece quando `kind === 'CATEGORY'` (já implementado, ~linha 360), então para FEEDBACK ele fica corretamente oculto e é enviado como `null`. Nada mais a mudar.

- [ ] **Step 2: Checar tipos e build do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (o tipo `BadgeKind` já inclui `FEEDBACK` desde a Task 1).

- [ ] **Step 3: Rodar os testes do web da seção (se existirem)**

Run: `pnpm --filter @legends/web test src/pages/AdminPage.test.tsx`
Expected: PASS. (Se o teste não exercitar o novo valor, basta continuar verde.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/admin/BadgesSection.tsx
git commit -m "feat(web): opção de selo Feedback no formulário do admin"
```

---

## Task 6: Verificação ponta-a-ponta da suíte

**Files:** nenhum (apenas verificação).

- [ ] **Step 1: Rodar a suíte completa da API**

Run: `pnpm --filter @legends/api test`
Expected: PASS — todos os testes, incluindo os pré-existentes de selos, feedback e admin.

- [ ] **Step 2: Checar tipos em todo o monorepo**

Run: `pnpm --filter @legends/shared build && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros de tipo.

- [ ] **Step 3: Commit (se houver ajustes)**

Se algum ajuste foi necessário para a suíte passar, commitar. Caso contrário, nada a fazer.

---

## Self-Review

**Spec coverage:**
- Métrica = total de feedbacks feitos → Task 2 (`countFeedbacksAuthored`, ramo `FEEDBACK` em `qualifies`). ✓
- Escopo "todo feedback conta" / auto-feedback já impossível → `count where authorId`, sem filtros extras (Task 2). ✓
- Permanência: revogável só para FEEDBACK; selos de voto permanentes → `syncFeedbackBadgesForUser` revoga AUTO; `evaluateBadgesForUser` ignora FEEDBACK (Task 2). ✓
- Modelo de dados: novo enum, sem tabela nova → Task 1. ✓
- Não revoga MANUAL → filtro `source: 'AUTO'` na query de owned + teste (Task 2). ✓
- Gatilhos em criar e apagar; editar não dispara → Task 3 (POST e DELETE só). ✓
- Admin cria/define limiar pelo CRUD existente → Task 4 (validação) + Task 5 (web), sem endpoint novo. ✓

**Placeholder scan:** sem TBD/TODO. Os testes referenciam apenas helpers reais já verificados nos arquivos (`adminToken` em admin.test.ts; `setup` em feedback.test.ts; `makeUser`/`makePeriod` em badge-service.test.ts). Toda lógica de produção está com código completo. ✓

**Type consistency:**
- `syncFeedbackBadgesForUser(userId: string): Promise<{ awarded: UserBadge[]; revoked: number }>` — mesma assinatura usada/consumida nas Tasks 2 e 3. ✓
- `deleteFeedback(...): Promise<{ authorId: string }>` — produzido na Task 3, consumido no DELETE da mesma task. ✓
- `BADGE_KINDS` (shared) e enum Prisma `BadgeKind` ambos com `'FEEDBACK'` — Task 1. ✓
