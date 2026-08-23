# Contas de liderança (papel `LEAD`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar contas de liderança (Head, GPM, Tech Leads) que fazem parte do time e votam, mas nunca recebem votos.

**Architecture:** Novo papel `LEAD` no enum `UserRole`. A regra "participa do reconhecimento" (recebe voto, aparece em Lendas) passa a ser `role === 'DEV'`; a regra "faz parte do time / vota" continua `role !== 'ADMIN'`. Backend rejeita votos cujo alvo não seja `DEV`; o front esconde liderança da lista de candidatos. Time, perfil (com avatar) e roteamento reaproveitam o comportamento de `DEV` sem mudança.

**Tech Stack:** pnpm monorepo · Fastify + Prisma + Postgres (apps/api) · Vite + React + TanStack Query (apps/web) · Vitest.

Spec: [docs/superpowers/specs/2026-06-11-contas-de-lideranca-design.md](../specs/2026-06-11-contas-de-lideranca-design.md)

---

## File Structure

- `packages/shared/src/enums.ts` — fonte da verdade do enum `UserRole` (modificar).
- `apps/api/prisma/schema.prisma` — enum `UserRole` no banco (modificar) + nova migration gerada.
- `apps/api/src/services/voting-service.ts` — guard de alvo no `createVote` (modificar).
- `apps/api/src/services/profile-service.ts` — `listShowcase` filtra `DEV` (modificar).
- `apps/api/src/services/voting-service.test.ts` — testes do guard (modificar).
- `apps/api/src/services/profile-service.test.ts` — teste do showcase (modificar).
- `apps/api/src/routes/users.test.ts` — teste de que `/users` inclui `LEAD` (modificar).
- `apps/web/src/pages/VotePage.tsx` — filtra candidatos para `DEV` (modificar).
- `apps/web/src/pages/VotePage.test.tsx` — teste do filtro (modificar).
- `apps/api/prisma/seed.ts` — 5 contas `LEAD` (modificar).

---

## Task 1: Adicionar papel `LEAD` ao enum (shared + Prisma)

**Files:**
- Modify: `packages/shared/src/enums.ts:1`
- Modify: `apps/api/prisma/schema.prisma:10-14`
- Create: `apps/api/prisma/migrations/<timestamp>_add_lead_role/migration.sql` (gerada pelo Prisma)

- [ ] **Step 1: Atualizar o enum no pacote compartilhado**

Em `packages/shared/src/enums.ts`, trocar a linha 1:

```ts
export const USER_ROLES = ['DEV', 'LEAD', 'ADMIN'] as const
```

(remove o `TECH_LEAD` morto e adiciona `LEAD`.)

- [ ] **Step 2: Atualizar o enum no schema do Prisma**

Em `apps/api/prisma/schema.prisma`, substituir o bloco do enum:

```prisma
enum UserRole {
  DEV
  LEAD
  ADMIN
}
```

- [ ] **Step 3: Gerar a migration e o client**

Run: `cd apps/api && pnpm exec prisma migrate dev --name add_lead_role`
Expected: cria `prisma/migrations/<timestamp>_add_lead_role/migration.sql` (recria o tipo `UserRole` com os valores `DEV, LEAD, ADMIN`), aplica no banco de dev e regenera o Prisma Client sem erro. Nenhuma linha usa `TECH_LEAD`, então o cast não falha.

- [ ] **Step 4: Type-check de shared e api**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (nada no código referencia `TECH_LEAD`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/enums.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat: adiciona papel LEAD ao enum UserRole

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — LEAD vota, mas votos para alvo não-DEV são rejeitados

**Files:**
- Modify: `apps/api/src/services/voting-service.test.ts`
- Modify: `apps/api/src/services/voting-service.ts:68-71`

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/src/services/voting-service.test.ts`, adicionar dentro do `describe('voting service', ...)` (após o teste "rejects an inactive voted user"):

```ts
it('lets a LEAD voter recognize a DEV', async () => {
  const { voted, category } = await seedFixtures()
  const lead = await prisma.user.create({
    data: { name: 'Lider', email: 'lider@empresa.com', passwordHash: 'x', role: 'LEAD' },
  })
  const vote = await createVote({
    voterId: lead.id,
    votedId: voted.id,
    categoryId: category.id,
    justification: 'Reconhecimento de uma liderança.',
  })
  expect(vote.id).toBeTruthy()
})

it('rejects voting for a LEAD target (400)', async () => {
  const { voter, category } = await seedFixtures()
  const lead = await prisma.user.create({
    data: { name: 'Lider', email: 'lider@empresa.com', passwordHash: 'x', role: 'LEAD' },
  })
  await expect(
    createVote({ voterId: voter.id, votedId: lead.id, categoryId: category.id, justification: 'justificativa válida' }),
  ).rejects.toMatchObject({ status: 400 })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/api exec vitest run src/services/voting-service.test.ts -t LEAD`
Expected: o teste "rejects voting for a LEAD target" FALHA (hoje o voto é criado, sem erro 400). O teste "lets a LEAD voter" pode já passar — o foco é o de rejeição.

- [ ] **Step 3: Adicionar o guard de alvo no `createVote`**

Em `apps/api/src/services/voting-service.ts`, no bloco que valida `voted` (linhas ~68-71), trocar:

```ts
  const voted = await prisma.user.findUnique({ where: { id: input.votedId } })
  if (!voted || !voted.active) {
    throw new VoteError('Colega inválido para votação.', 400)
  }
```

por:

```ts
  const voted = await prisma.user.findUnique({ where: { id: input.votedId } })
  if (!voted || !voted.active || voted.role !== 'DEV') {
    throw new VoteError('Colega inválido para votação.', 400)
  }
```

(Lideranças e admins não recebem voto; apenas `DEV` é candidato. O votante continua liberado para todos menos `ADMIN`, regra que já existe nas linhas acima.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/services/voting-service.test.ts`
Expected: todos PASS (inclusive os pré-existentes — as fixtures criam usuários com `role` default `DEV`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/voting-service.ts apps/api/src/services/voting-service.test.ts
git commit -m "feat(api): so DEV recebe voto; LEAD pode votar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend — `listShowcase` (Lendas) exclui liderança

**Files:**
- Modify: `apps/api/src/services/profile-service.test.ts`
- Modify: `apps/api/src/services/profile-service.ts:20`

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/services/profile-service.test.ts`, adicionar o import do `listShowcase` na linha 3:

```ts
import { getUserProfile, listShowcase, listVotesReceived } from './profile-service'
```

e adicionar, dentro do `describe('profile service', ...)`:

```ts
it('exclui lideranças (LEAD) da galeria de conquistas', async () => {
  await prisma.user.create({ data: { name: 'Dev', email: 'dev@empresa.com', passwordHash: 'x', role: 'DEV' } })
  await prisma.user.create({ data: { name: 'Lider', email: 'lider@empresa.com', passwordHash: 'x', role: 'LEAD' } })
  const rows = await listShowcase()
  const names = rows.map((r) => r.user.name)
  expect(names).toContain('Dev')
  expect(names).not.toContain('Lider')
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/profile-service.test.ts -t lideranças`
Expected: FALHA — hoje `listShowcase` traz todos `role != ADMIN`, então "Lider" aparece.

- [ ] **Step 3: Filtrar o showcase para `DEV`**

Em `apps/api/src/services/profile-service.ts`, na linha 20, trocar:

```ts
    prisma.user.findMany({ where: { active: true, role: { not: 'ADMIN' } } }),
```

por:

```ts
    prisma.user.findMany({ where: { active: true, role: 'DEV' } }),
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/profile-service.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/profile-service.ts apps/api/src/services/profile-service.test.ts
git commit -m "feat(api): Lendas lista apenas DEV (lideranca fora da galeria)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Backend — garantir que `/users` (Time) inclui liderança

Nenhuma mudança de código — `/users` já usa `role: { not: 'ADMIN' }`, que inclui `LEAD`. Este teste trava esse comportamento contra regressão (para ninguém "consertar" o `/users` igual ao showcase).

**Files:**
- Modify: `apps/api/src/routes/users.test.ts`

- [ ] **Step 1: Escrever o teste de garantia**

Em `apps/api/src/routes/users.test.ts`, dentro do `describe('GET /users', ...)`, adicionar:

```ts
it('inclui lideranças (LEAD) na listagem do time', async () => {
  const app = buildApp()
  await app.ready()
  const token = await registerAndToken(app, 'ana@empresa.com')
  await prisma.user.create({ data: { name: 'Lider', email: 'lider@empresa.com', passwordHash: 'x', role: 'LEAD' } })

  const res = await app.inject({
    method: 'GET',
    url: '/users',
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.statusCode).toBe(200)
  const emails = res.json().users.map((u: { email: string }) => u.email)
  expect(emails).toContain('lider@empresa.com')
  await app.close()
})
```

- [ ] **Step 2: Rodar o teste e confirmar que passa de primeira**

Run: `pnpm --filter @legends/api exec vitest run src/routes/users.test.ts`
Expected: PASS imediato (sem mudar código de produção) — confirma que `LEAD` já entra no Time.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/users.test.ts
git commit -m "test(api): trava inclusao de LEAD no /users (Time)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Web — `VotePage` esconde liderança da lista de candidatos

**Files:**
- Modify: `apps/web/src/pages/VotePage.test.tsx`
- Modify: `apps/web/src/pages/VotePage.tsx:76,83-91`

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/pages/VotePage.test.tsx`, adicionar dentro do `describe('VotePage', ...)`:

```ts
it('esconde lideranças (LEAD) da lista de candidatos', async () => {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/users') {
      return Promise.resolve({
        users: [
          { id: 'u2', name: 'Bruno Lima', email: 'bruno@empresa.com', role: 'DEV', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'u3', name: 'Lider Reis', email: 'lider@empresa.com', role: 'LEAD', position: 'Head de Engenharia', squad: 'Liderança', photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
        ],
      })
    }
    if (path === '/categories') return Promise.resolve({ categories: [{ id: 'c1', name: 'Colaboração', slug: 'colaboracao', description: null, isSpecial: false }] })
    if (path === '/periods/current') return Promise.resolve({ period: { id: 'p1', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN' } })
    if (path === '/votes/me') return Promise.resolve({ votes: [] })
    return Promise.reject(new Error(`unexpected ${path}`))
  })
  renderPage()

  expect(await screen.findByRole('radio', { name: /Bruno Lima/ })).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: /Lider Reis/ })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/VotePage.test.tsx -t lideranças`
Expected: FALHA — hoje todos de `/users` viram radios, então "Lider Reis" aparece.

- [ ] **Step 3: Filtrar candidatos para `DEV`**

Em `apps/web/src/pages/VotePage.tsx`, na linha 76, logo após `const users = usersQuery.data?.users ?? []`, adicionar:

```ts
  // Apenas DEV é candidato a reconhecimento. Liderança aparece no Time, mas
  // não pode receber voto (regra garantida também no backend).
  const votableUsers = useMemo(() => users.filter((u) => u.role === 'DEV'), [users])
```

Em seguida, no `useMemo` de `filteredUsers` (linhas ~83-91), trocar a base `users` por `votableUsers`:

```ts
  const filteredUsers = useMemo(() => {
    const term = colleagueQuery.trim().toLowerCase()
    if (!term) return votableUsers
    return votableUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(term) ||
        (u.position ?? '').toLowerCase().includes(term),
    )
  }, [votableUsers, colleagueQuery])
```

(`useMemo` já está importado na linha 1.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/VotePage.test.tsx`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/VotePage.tsx apps/web/src/pages/VotePage.test.tsx
git commit -m "feat(web): VotePage so lista DEV como candidato

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Seed — adicionar as 5 contas de liderança

**Files:**
- Modify: `apps/api/prisma/seed.ts:62,86` (após o loop dos `devs`)

- [ ] **Step 1: Adicionar a lista de lideranças e o loop de upsert**

Em `apps/api/prisma/seed.ts`, substituir o comentário da linha 62
`// Time atual (Tech Lead, Head e GPM ficam de fora a pedido).` por
`// Time atual (colaboradores que recebem voto).`

E, logo após o `for (const d of devs) { ... }` (que termina por volta da linha 86), adicionar:

```ts
  // Lideranças: fazem parte do Time e votam, mas não recebem voto (papel LEAD).
  const leads = [
    { email: 'waghner.reis@eumedicoresidente.com.br', name: 'Waghner Reis', position: 'Head de Engenharia', squad: 'Liderança' },
    { email: 'patricia.diletieri@eumedicoresidente.com.br', name: 'Patricia Diletieri', position: 'GPM', squad: 'Liderança' },
    { email: 'lucca.secco@eumedicoresidente.com.br', name: 'Lucca Secco', position: 'Tech Lead', squad: 'Liderança' },
    { email: 'arthur.pedro@eumedicoresidente.com.br', name: 'Arthur Pedro', position: 'Tech Lead', squad: 'Liderança' },
    { email: 'paulo.sarraff@eumedicoresidente.com.br', name: 'Paulo Sarraff', position: 'Tech Lead', squad: 'Liderança' },
  ]
  for (const l of leads) {
    await prisma.user.upsert({
      where: { email: l.email },
      update: { role: 'LEAD', position: l.position, squad: l.squad },
      create: { ...l, passwordHash, role: 'LEAD' },
    })
  }
```

(O `update` garante o papel `LEAD` mesmo se algum desses e-mails já existir como `DEV`.)

- [ ] **Step 2: Type-check do seed**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Rodar o seed e conferir as contas**

Run: `pnpm --filter @legends/api run db:seed`
Expected: termina sem erro. Conferir:

Run: `cd apps/api && pnpm exec prisma db execute --stdin <<< "SELECT name, role, position FROM \"User\" WHERE role = 'LEAD' ORDER BY name;"`
Expected: lista os 5 nomes (Arthur Pedro, Lucca Secco, Patricia Diletieri, Paulo Sarraff, Waghner Reis) com `role = LEAD`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(api): seed das 5 contas de lideranca (LEAD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Verificação final (suítes completas)

- [ ] **Step 1: Rodar a suíte da API**

Run: `pnpm --filter @legends/api test`
Expected: tudo PASS.

- [ ] **Step 2: Rodar a suíte do Web**

Run: `pnpm --filter @legends/web exec vitest run`
Expected: tudo PASS, exceto a falha pré-existente conhecida em `src/App.test.tsx` (heading "Legends" vs "Legends"), que não faz parte deste trabalho.

- [ ] **Step 3: Smoke manual (opcional)**

Subir api + web, logar como uma liderança (ex.: `lucca.secco@eumedicoresidente.com.br` / `emr2026@`) e confirmar: cai no Time, aparece na grade do Time, consegue abrir "Votar" e que liderança não aparece como candidato, consegue abrir o próprio perfil e editar o avatar.
