# Voto em múltiplas categorias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o votante reconheça um colega em 1 a 3 categorias numa única submissão, com uma justificativa compartilhada, sem inflar a eleição do Destaque do Mês nem os rankings.

**Architecture:** O `Vote` continua sendo a unidade de reconhecimento (um por votante/período, guarda a justificativa). A categoria deixa de ser um campo único e vira uma relação N‑N via nova tabela `VoteCategory`. Toda contagem que opera por linha de `Vote` (eleição, vitrine, selo Impacto, meses distintos, justificativas do highlight) fica intacta; só o que é "por categoria" passa a contar pela join.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (apps/api); Vite 5 + React 18 + Tailwind 3 (apps/web); tipos em `@legends/shared`; testes em Vitest contra Postgres real.

## Global Constraints

- TypeScript **strict**, ESM puro. Mensagens ao usuário em **português** (pt-BR).
- Contrato é fonte única: alterar o tipo em `@legends/shared` **primeiro**, ajustar os dois lados.
- Teto: **`MIN_VOTE_CATEGORIES = 1`**, **`MAX_VOTE_CATEGORIES = 3`** (constantes em `@legends/shared`).
- `MIN_JUSTIFICATION_LENGTH = 10` (já existe, inalterado).
- Regra inalterada: **um voto por votante por período** (`@@unique([voterId, periodId])`); trava após enviar; sem auto-voto; alvo deve ser DEV ativo.
- Peso: um reconhecimento por votante/colega, independente do nº de categorias.
- Postgres precisa estar de pé para os testes da API: `pnpm db:up`.
- **Nunca editar uma migration já aplicada** — gerar nova.
- **Nota sobre o "red window":** entre a Task 2 e o fim da Task 8 o repositório não compila inteiro (mudança de contrato cruzada). Vitest usa esbuild (não faz typecheck), então cada arquivo de teste roda isolado conforme é corrigido. O typecheck completo só é exigido nas Tasks 8 (API) e 10 (web).

---

### Task 1: Contrato compartilhado (`@legends/shared`)

**Files:**
- Modify: `packages/shared/src/vote.ts`

**Interfaces:**
- Produces: `MIN_VOTE_CATEGORIES = 1`, `MAX_VOTE_CATEGORIES = 3`; `CreateVoteRequest { votedId: string; categoryIds: string[]; justification: string }`; `VoteDTO.categories: VoteCategoryRef[]` (substitui `category`).

- [ ] **Step 1: Editar `packages/shared/src/vote.ts`**

Adicionar as constantes logo após `MIN_JUSTIFICATION_LENGTH`:

```ts
export const MIN_JUSTIFICATION_LENGTH = 10

export const MIN_VOTE_CATEGORIES = 1
export const MAX_VOTE_CATEGORIES = 3
```

Trocar o campo `category` por `categories` em `VoteDTO`:

```ts
export interface VoteDTO {
  id: string
  voter: VoteUserRef
  voted: VoteUserRef
  categories: VoteCategoryRef[]
  justification: string
  createdAt: string
  periodId: string
  monthRef: string
}
```

Trocar `categoryId` por `categoryIds` em `CreateVoteRequest`:

```ts
export interface CreateVoteRequest {
  votedId: string
  categoryIds: string[]
  justification: string
}
```

- [ ] **Step 2: Garantir o barril**

`packages/shared/src/index.ts` reexporta `./vote` com `export *`? Confirmar com:

Run: `grep -n "vote" packages/shared/src/index.ts`
Expected: uma linha tipo `export * from './vote'` (as novas constantes saem automaticamente). Se for export nomeado, adicionar `MIN_VOTE_CATEGORIES`, `MAX_VOTE_CATEGORIES`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/vote.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato de voto com múltiplas categorias"
```

---

### Task 2: Schema Prisma + migration + client

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (models `Vote`, `Category`)
- Create: `apps/api/prisma/migrations/<timestamp>_vote_multiplas_categorias/migration.sql`

**Interfaces:**
- Produces: model `VoteCategory { voteId, categoryId }` com PK composta e cascade; `Vote` sem `categoryId`/relação `category`; `Vote.categories VoteCategory[]`; `Category.voteCategories VoteCategory[]`.

- [ ] **Step 1: Editar o `Vote` em `apps/api/prisma/schema.prisma`**

Substituir o model `Vote` (linhas ~116-134) por:

```prisma
model Vote {
  id            String   @id @default(cuid())
  voterId       String
  votedId       String
  periodId      String
  justification String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  voter      User           @relation("VotesGiven", fields: [voterId], references: [id])
  voted      User           @relation("VotesReceived", fields: [votedId], references: [id])
  period     VotingPeriod   @relation(fields: [periodId], references: [id])
  categories VoteCategory[]

  @@unique([voterId, periodId], name: "one_vote_per_voter_period")
  @@index([periodId])
  @@index([votedId])
}

model VoteCategory {
  voteId     String
  categoryId String

  vote     Vote     @relation(fields: [voteId], references: [id], onDelete: Cascade)
  category Category @relation(fields: [categoryId], references: [id])

  @@id([voteId, categoryId])
  @@index([categoryId])
}
```

- [ ] **Step 2: Editar o `Category` no mesmo arquivo**

Trocar a relação `votes Vote[]` (linha ~95) por:

```prisma
  voteCategories VoteCategory[]
```

- [ ] **Step 3: Gerar a migration sem aplicar**

Run: `pnpm db:up` (garante Postgres) e depois
`pnpm --filter @legends/api exec prisma migrate dev --create-only --name vote_multiplas_categorias`
Expected: cria a pasta de migration com `migration.sql` (ainda não aplicada).

- [ ] **Step 4: Editar o `migration.sql` para preservar os votos existentes**

O SQL gerado cria a tabela `VoteCategory` e dropa a coluna/FK `categoryId` de `Vote`. Inserir **um comando de cópia ENTRE o `CREATE TABLE "VoteCategory"` e o `DROP`/`ALTER TABLE "Vote" DROP COLUMN "categoryId"`**:

```sql
-- Copia os votos existentes (1 categoria por voto) para a nova join
INSERT INTO "VoteCategory" ("voteId", "categoryId")
SELECT "id", "categoryId" FROM "Vote";
```

Verificar a ordem final: (1) CreateTable VoteCategory + índices/constraints; (2) o INSERT acima; (3) DropForeignKey + DropColumn de `Vote.categoryId`. Se o gerador emitir o DROP antes do CreateTable, reordenar manualmente para que o INSERT só rode com a coluna ainda presente e a tabela já criada.

- [ ] **Step 5: Aplicar a migration e regenerar o client**

Run: `pnpm --filter @legends/api exec prisma migrate dev`
Expected: aplica a migration editada sem erro; em seguida regenera o Prisma Client (o `migrate dev` já roda `generate`). Confirmar com `pnpm db:generate` se necessário.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): schema VoteCategory (voto N categorias) + migração de dados"
```

---

### Task 3: `voting-service` — criar voto com múltiplas categorias

**Files:**
- Modify: `apps/api/src/services/voting-service.ts`
- Test: `apps/api/src/services/voting-service.test.ts`

**Interfaces:**
- Consumes: model `VoteCategory` (Task 2); `MIN_VOTE_CATEGORIES`/`MAX_VOTE_CATEGORIES` não usados aqui (validação de tamanho é na route).
- Produces: `voteInclude = { voter, voted, period, categories: { include: { category } } }`; `createVote({ voterId, votedId, categoryIds: string[], justification })`; `VoteWithRelations` agora com `categories[]` e sem `category`.

- [ ] **Step 1: Atualizar os testes de `voting-service.test.ts`**

Atualizar o helper e os casos para usar `categoryIds`. Trocar a assinatura de `createVote` em todas as chamadas (`categoryId: category.id` → `categoryIds: [category.id]`) e a asserção de categoria. Substituir o primeiro teste por:

```ts
it('creates a vote with valid data', async () => {
  const { voter, voted, category } = await seedFixtures()
  const vote = await createVote({
    voterId: voter.id,
    votedId: voted.id,
    categoryIds: [category.id],
    justification: 'Ajudou muito no incidente de produção.',
  })
  expect(vote.id).toBeTruthy()
  expect(vote.voted.name).toBe('Bruno')
  expect(vote.categories.map((c) => c.category.slug)).toEqual(['colaboracao'])
})
```

Adicionar dois casos novos (várias categorias e categoria inválida). Para o caso de várias categorias, criar uma segunda categoria no fixture:

```ts
it('creates a vote with multiple categories', async () => {
  const { voter, voted, category } = await seedFixtures()
  const outra = await prisma.category.create({ data: { name: 'Inovação', slug: 'inovacao' } })
  const vote = await createVote({
    voterId: voter.id,
    votedId: voted.id,
    categoryIds: [category.id, outra.id],
    justification: 'Reconhecimento em dois eixos.',
  })
  expect(vote.categories).toHaveLength(2)
  expect(await prisma.voteCategory.count({ where: { voteId: vote.id } })).toBe(2)
})

it('rejects an invalid category (400)', async () => {
  const { voter, voted } = await seedFixtures()
  await expect(
    createVote({ voterId: voter.id, votedId: voted.id, categoryIds: ['nao-existe'], justification: 'texto válido aqui' }),
  ).rejects.toMatchObject({ status: 400 })
})
```

Nos casos existentes (`rejects voting for yourself`, `no open period`, `inactive voted`, `lets a LEAD voter`, e o de duplicidade se houver), trocar `categoryId: category.id` por `categoryIds: [category.id]`.

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @legends/api test -- voting-service`
Expected: FAIL (o tipo `CreateVoteInput` ainda tem `categoryId`; `vote.categories` não existe no resultado atual).

- [ ] **Step 3: Implementar em `voting-service.ts`**

Trocar `voteInclude` (linha 14):

```ts
export const voteInclude = {
  voter: true,
  voted: true,
  period: true,
  categories: { include: { category: true } },
} as const
```

Trocar `CreateVoteInput` (linhas 43-48):

```ts
interface CreateVoteInput {
  voterId: string
  votedId: string
  categoryIds: string[]
  justification: string
}
```

Substituir a validação de categoria única e o `prisma.vote.create` (linhas 73-94) por:

```ts
  const categoryIds = [...new Set(input.categoryIds)]
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } })
  if (categories.length !== categoryIds.length || categories.some((c) => !c.active)) {
    throw new VoteError('Categoria inválida.', 400)
  }

  try {
    return await prisma.vote.create({
      data: {
        voterId: input.voterId,
        votedId: input.votedId,
        periodId: period.id,
        justification: input.justification,
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      },
      include: voteInclude,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new VoteError('Você já registrou seu voto neste período.', 409)
    }
    throw err
  }
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/api test -- voting-service`
Expected: PASS (todos os casos do arquivo).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/voting-service.ts apps/api/src/services/voting-service.test.ts
git commit -m "feat(api): createVote aceita múltiplas categorias"
```

---

### Task 4: `serialize.toVoteDTO` — emitir array de categorias

**Files:**
- Modify: `apps/api/src/lib/serialize.ts:67-78`
- Test: `apps/api/src/lib/serialize.test.ts`

**Interfaces:**
- Consumes: `VoteWithRelations.categories` (Task 3); `VoteDTO.categories` (Task 1).
- Produces: `toVoteDTO` retornando `categories: VoteCategoryRef[]`.

- [ ] **Step 1: Atualizar/adicionar teste em `serialize.test.ts`**

Procurar o teste existente de `toVoteDTO` (`grep -n "toVoteDTO" apps/api/src/lib/serialize.test.ts`). Ajustar a fixture do vote para ter `categories` em vez de `category` e asserir o array. Forma do mock (espelha `VoteWithRelations`):

```ts
const vote = {
  id: 'v1',
  voter: { id: 'u1', name: 'Ana' },
  voted: { id: 'u2', name: 'Bruno' },
  categories: [{ category: { id: 'c1', name: 'Colaboração', slug: 'colaboracao' } }],
  justification: 'texto',
  createdAt: new Date('2026-06-10T00:00:00Z'),
  periodId: 'p1',
  period: { monthRef: '2026-06' },
} as unknown as Parameters<typeof toVoteDTO>[0]

it('serializa categorias do voto', () => {
  expect(toVoteDTO(vote).categories).toEqual([{ id: 'c1', name: 'Colaboração', slug: 'colaboracao' }])
})
```

Se já existir um teste de `toVoteDTO` referenciando `category`, substituí-lo por este.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- serialize`
Expected: FAIL (`toVoteDTO` ainda lê `vote.category`).

- [ ] **Step 3: Implementar em `serialize.ts`**

Trocar a linha do `category` (72) dentro de `toVoteDTO` por:

```ts
    categories: vote.categories.map((vc) => ({
      id: vc.category.id,
      name: vc.category.name,
      slug: vc.category.slug,
    })),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- serialize`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize.test.ts
git commit -m "feat(api): toVoteDTO serializa array de categorias"
```

---

### Task 5: Route `POST /votes` — validar 1..MAX categorias

**Files:**
- Modify: `apps/api/src/routes/votes.ts:9-27`
- Test: `apps/api/src/routes/votes.test.ts`

**Interfaces:**
- Consumes: `createVote` com `categoryIds` (Task 3); `MIN_VOTE_CATEGORIES`/`MAX_VOTE_CATEGORIES` (Task 1).
- Produces: contrato HTTP `POST /votes` body `{ votedId, categoryIds, justification }`.

- [ ] **Step 1: Atualizar `votes.test.ts`**

Encontrar os POSTs de voto (`grep -n "categoryId\|/votes" apps/api/src/routes/votes.test.ts`) e trocar `categoryId: X` por `categoryIds: [X]` no payload. Adicionar casos de teto e mínimo (usar o helper de auth/seed já existente no arquivo; espelhar o estilo dos testes vizinhos):

```ts
it('rejeita mais de MAX_VOTE_CATEGORIES categorias (400)', async () => {
  // ...seed de voter autenticado, voted DEV, período aberto e 4 categorias c1..c4
  const res = await app.inject({
    method: 'POST', url: '/votes',
    headers: authHeader,
    payload: { votedId: voted.id, categoryIds: [c1.id, c2.id, c3.id, c4.id], justification: 'texto válido aqui' },
  })
  expect(res.statusCode).toBe(400)
})

it('rejeita zero categorias (400)', async () => {
  const res = await app.inject({
    method: 'POST', url: '/votes',
    headers: authHeader,
    payload: { votedId: voted.id, categoryIds: [], justification: 'texto válido aqui' },
  })
  expect(res.statusCode).toBe(400)
})
```

(Reaproveitar o setup de autenticação/seed do próprio arquivo; não duplicar helpers.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- routes/votes`
Expected: FAIL (schema ainda exige `categoryId`).

- [ ] **Step 3: Implementar em `votes.ts`**

Trocar o import (linha 3) e o schema/handler:

```ts
import { MIN_JUSTIFICATION_LENGTH, MIN_VOTE_CATEGORIES, MAX_VOTE_CATEGORIES } from '@legends/shared'
```

```ts
const createVoteSchema = z.object({
  votedId: z.string().min(1),
  categoryIds: z.array(z.string().min(1)).min(MIN_VOTE_CATEGORIES).max(MAX_VOTE_CATEGORIES),
  justification: z.string().trim().min(MIN_JUSTIFICATION_LENGTH),
})
```

No handler, trocar a passagem de argumentos (linhas 22-27):

```ts
      const vote = await createVote({
        voterId: request.user.sub,
        votedId: parsed.data.votedId,
        categoryIds: parsed.data.categoryIds,
        justification: parsed.data.justification,
      })
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- routes/votes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/votes.ts apps/api/src/routes/votes.test.ts
git commit -m "feat(api): POST /votes valida 1..3 categorias"
```

---

### Task 6: `badge-service` — selo de categoria conta pela join

**Files:**
- Modify: `apps/api/src/services/badge-service.ts:5-7`
- Test: `apps/api/src/services/badge-service.test.ts`

**Interfaces:**
- Consumes: model `VoteCategory` (Task 2).
- Produces: `countVotesInCategory` baseado em `voteCategory`; `countTotalVotes`/`countDistinctMonths` inalterados (continuam por `Vote`).

- [ ] **Step 1: Ajustar as fixtures e asserções de `badge-service.test.ts`**

Todas as criações diretas `prisma.vote.create({ data: { ..., categoryId: cat.id, ... } })` precisam usar a join. Substituir cada uma pelo padrão de nested create:

```ts
await prisma.vote.create({
  data: { voterId: v1.id, votedId: target.id, periodId: period.id, justification: just, categories: { create: [{ categoryId: cat.id }] } },
})
```

(Aplicar a mesma transformação em todas as ~5 chamadas do arquivo — linhas ~47, 50, 68, 83, 84.) As asserções de contagem (selo CATEGORY com threshold) permanecem iguais: 2 votos na categoria = 2.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- badge-service`
Expected: FAIL — primeiro por `categoryId` inexistente no create (corrigido no Step 1) e depois porque `countVotesInCategory` ainda consulta `prisma.vote`.

- [ ] **Step 3: Implementar em `badge-service.ts`**

Trocar `countVotesInCategory` (linhas 5-7):

```ts
function countVotesInCategory(userId: string, categorySlug: string): Promise<number> {
  return prisma.voteCategory.count({
    where: { category: { slug: categorySlug }, vote: { votedId: userId } },
  })
}
```

`countTotalVotes` e `countDistinctMonths` ficam **inalterados** (devem continuar contando linhas de `Vote`).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- badge-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts
git commit -m "feat(api): selo de categoria conta por VoteCategory"
```

---

### Task 7: `profile-service` — breakdown e filtro por categoria

**Files:**
- Modify: `apps/api/src/services/profile-service.ts:70-77` e `106-120`
- Test: `apps/api/src/services/profile-service.test.ts`

**Interfaces:**
- Consumes: model `VoteCategory` (Task 2); `voteInclude` (Task 3).
- Produces: `categoryBreakdown` via `voteCategory.groupBy`; `listVotesReceived` filtra por categoria via relação `categories.some`. `totalVotesReceived`/`monthsRecognized`/`listShowcase` inalterados.

- [ ] **Step 1: Ajustar fixtures de `profile-service.test.ts`**

As três criações de voto (linhas 27-29) usam `categoryId`. Trocar para nested create, preservando os mesmos pares votante/categoria/período:

```ts
await prisma.vote.create({ data: { voterId: a.id, votedId: target.id, periodId: p1.id, justification: just, categories: { create: [{ categoryId: colaboracao.id }] } } })
await prisma.vote.create({ data: { voterId: b.id, votedId: target.id, periodId: p1.id, justification: just, categories: { create: [{ categoryId: colaboracao.id }] } } })
await prisma.vote.create({ data: { voterId: c.id, votedId: target.id, periodId: p2.id, justification: just, categories: { create: [{ categoryId: inovacao.id }] } } })
```

As asserções de `categoryBreakdown` (colaboracao=2, inovacao=1), `totalVotesReceived=3` e `monthsRecognized=2` permanecem iguais. Se houver um teste de `listVotesReceived` com filtro `categorySlug`, mantê-lo; ele deve continuar verde após o Step 2.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- profile-service`
Expected: FAIL (`groupBy(['categoryId'])` e filtro `category: { slug }` não existem mais em `Vote`).

- [ ] **Step 3: Implementar em `profile-service.ts`**

Substituir o bloco de breakdown (linhas 70-77) por agregação na join:

```ts
  const grouped = await prisma.voteCategory.groupBy({
    by: ['categoryId'],
    where: { vote: { votedId: userId } },
    _count: { _all: true },
  })
  const categories = await prisma.category.findMany({
    where: { id: { in: grouped.map((g) => g.categoryId) } },
  })
```

(O restante do mapeamento de `categoryBreakdown` — `categoryById`, `.map`, `.sort` — permanece igual, pois ainda usa `g.categoryId` e `g._count._all`.)

Substituir o filtro em `listVotesReceived` (linha 113) por relação:

```ts
      ...(filters.categorySlug ? { categories: { some: { category: { slug: filters.categorySlug } } } } : {}),
```

`totalVotesReceived` (count em `Vote`) e `monthRows` ficam inalterados.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- profile-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/profile-service.ts apps/api/src/services/profile-service.test.ts
git commit -m "feat(api): breakdown e filtro de perfil por VoteCategory"
```

---

### Task 8: Demais testes de API que semeiam votos + typecheck + suíte completa

**Files:**
- Modify (testes que criam votos via `prisma.vote.create` com `categoryId` ou assertam `vote.category`):
  - `apps/api/src/services/highlight-service.test.ts` (helper `castVote`, linhas ~18-25)
  - `apps/api/src/services/highlight-service.orchestration.test.ts`
  - `apps/api/src/routes/admin.test.ts` e `apps/api/src/routes/admin.highlight.test.ts`
  - `apps/api/src/routes/profile.test.ts`, `apps/api/src/routes/badges.test.ts`, `apps/api/src/routes/users.test.ts`
- Modify (se necessário): `apps/api/prisma/seed.ts` — **confirmado que não cria votos**; nada a fazer salvo se mudou.

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: suíte da API 100% verde e typecheck limpo.

- [ ] **Step 1: Localizar todos os pontos restantes**

Run: `grep -rn "categoryId\|\.category\b\|vote\.category" apps/api/src --include="*.test.ts"`
Expected: lista de call sites em arquivos de teste ainda usando o formato antigo.

- [ ] **Step 2: Atualizar o helper `castVote` em `highlight-service.test.ts`**

Trocar a criação para nested create, mantendo `createdAt` (tiebreaker da eleição):

```ts
async function castVote(opts: { votedId: string; categoryId: string; periodId: string; at: Date; voterName: string }) {
  const voter = await prisma.user.create({ data: { name: opts.voterName, email: `${opts.voterName}@e.com`, passwordHash: 'x' } })
  return prisma.vote.create({
    data: {
      voterId: voter.id,
      votedId: opts.votedId,
      periodId: opts.periodId,
      justification: 'justificativa de teste',
      createdAt: opts.at,
      categories: { create: [{ categoryId: opts.categoryId }] },
    },
  })
}
```

(Manter a assinatura `castVote` com `categoryId` singular — os chamadores não mudam.) As asserções de `electWinner` (contagem por `votedId`, tiebreaker) permanecem iguais — **valida que 1 voto = 1 reconhecimento mesmo com a join**.

- [ ] **Step 3: Atualizar os demais arquivos de teste**

Para cada call site da listagem do Step 1, aplicar o padrão de nested create (remover `categoryId` do nível raiz, adicionar `categories: { create: [{ categoryId }] }`). Onde algum teste assere `vote.category.name`/`.slug` na resposta de uma rota, trocar para `vote.categories[0].name`/`.slug` (ou asserir o array). Rodar cada arquivo isoladamente conforme corrige, ex.: `pnpm --filter @legends/api test -- admin.highlight`.

- [ ] **Step 4: Typecheck da API**

Run: `pnpm --filter @legends/api exec tsc --noEmit -p tsconfig.json`
Expected: sem erros. Se acusar resíduo de `category`/`categoryId` em código de produção, corrigir o ponto indicado.

- [ ] **Step 5: Suíte completa da API**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Expected: PASS em todos os arquivos.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "test(api): fixtures de voto migradas para VoteCategory"
```

---

### Task 9: Frontend — `VotePage` com checkboxes e teto

**Files:**
- Modify: `apps/web/src/pages/VotePage.tsx`
- Test: `apps/web/src/pages/VotePage.test.tsx`

**Interfaces:**
- Consumes: `CreateVoteRequest.categoryIds` e `MIN_VOTE_CATEGORIES`/`MAX_VOTE_CATEGORIES` (Task 1); `VoteDTO.categories` (Task 1).
- Produces: formulário que envia `categoryIds: string[]`; lista "Seus votos" renderizando chips de categorias.

- [ ] **Step 1: Atualizar `VotePage.test.tsx`**

Inspecionar o teste atual (`grep -n "categor\|radio\|checkbox\|categoryId" apps/web/src/pages/VotePage.test.tsx`). Ajustar/garantir um teste que: seleciona um colega, marca **duas** categorias (checkboxes) e submete, esperando que o `apiFetch`/mutation seja chamado com `categoryIds` de 2 itens. Espelhar o mock de `apiFetch` já usado no arquivo. Exemplo do assert central:

```ts
// após marcar colega + 2 categorias + justificativa e clicar em "Finalizar voto"
expect(fetchMock).toHaveBeenCalledWith(
  '/votes',
  expect.objectContaining({
    method: 'POST',
    body: expect.stringContaining('"categoryIds"'),
  }),
)
```

Se o teste atual seleciona categoria por `radio`, trocar para marcar checkboxes por nome/label.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- VotePage`
Expected: FAIL (estado ainda é `categoryId` único / inputs são radios).

- [ ] **Step 3: Implementar em `VotePage.tsx`**

Importar as constantes (linhas 3-8):

```ts
import {
  MAX_VOTE_CATEGORIES,
  type CategoryDTO,
  type PublicUser,
  type VoteDTO,
  type VotingPeriodDTO,
} from "@legends/shared";
```

Trocar o estado (linha 48):

```ts
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
```

Adicionar um toggle (perto dos `useMemo`), respeitando o teto:

```ts
  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id)
        ? prev.filter((c) => c !== id)
        : prev.length < MAX_VOTE_CATEGORIES
          ? [...prev, id]
          : prev,
    );
  }
```

Atualizar a mutation (linhas 74-91): tipo do body e reset:

```ts
  const mutation = useMutation({
    mutationFn: (body: {
      votedId: string;
      categoryIds: string[];
      justification: string;
    }) =>
      apiFetch<{ vote: VoteDTO }>("/votes", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setSuccess("Voto registrado! Obrigado por reconhecer um colega.");
      setError(null);
      setVotedId("");
      setCategoryIds([]);
      setJustification("");
      setColleagueQuery("");
      queryClient.invalidateQueries({ queryKey: ["votes", "me"] });
    },
    onError: (err) => {
      setSuccess(null);
      setError(
        err instanceof ApiError ? err.message : "Erro ao registrar o voto.",
      );
    },
  });
```

Atualizar `handleSubmit` (linhas 126-145):

```ts
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    if (!votedId || categoryIds.length === 0) {
      setError("Escolha um colega e ao menos uma categoria.");
      return;
    }
    if (justification.trim().length < MIN_JUSTIFICATION_LENGTH) {
      setError(
        `A justificativa precisa ter pelo menos ${MIN_JUSTIFICATION_LENGTH} caracteres.`,
      );
      return;
    }
    setError(null);
    mutation.mutate({ votedId, categoryIds, justification: justification.trim() });
  }
```

Trocar o grid de categorias (linhas 300-345): cabeçalho com dica de teto e inputs `checkbox`:

```tsx
<StepHeader step={2} title="Escolher categorias" />
<p className="mb-md text-body-sm text-on-surface-variant">
  Você pode escolher até {MAX_VOTE_CATEGORIES} categorias para este colega.
</p>

{categoriesQuery.isLoading && <CategoryGridSkeleton />}
<div className="grid grid-cols-2 gap-md sm:grid-cols-3">
  {categories.map((category) => {
    const selected = categoryIds.includes(category.id);
    const atLimit = !selected && categoryIds.length >= MAX_VOTE_CATEGORIES;
    return (
      <label
        key={category.id}
        className={[
          "relative block",
          atLimit ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        ].join(" ")}
      >
        <input
          type="checkbox"
          name="category"
          value={category.id}
          checked={selected}
          disabled={atLimit}
          onChange={() => toggleCategory(category.id)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <div
          className={[
            "flex h-full flex-col items-center gap-2 rounded-lg border-2 p-md text-center transition-all",
            selected
              ? "border-primary bg-primary/10"
              : "border-outline-variant/30 bg-surface-container-highest hover:border-primary/50",
          ].join(" ")}
        >
          <Icon
            name={categoryIcon(category.slug)}
            filled={selected}
            className={[
              "text-[32px] transition-colors",
              selected ? "text-primary" : "text-on-surface-variant",
            ].join(" ")}
          />
          <span className="font-label text-label-md font-semibold text-on-surface">
            {category.name}
          </span>
        </div>
      </label>
    );
  })}
</div>
```

Trocar a renderização de "Seus votos neste mês" (linhas 444-449) para chips:

```tsx
<p className="font-headline text-body-md font-semibold text-on-surface">
  {vote.voted.name}
</p>
<div className="mt-1 flex flex-wrap gap-1">
  {vote.categories.map((c) => (
    <span
      key={c.id}
      className="rounded-full bg-primary/10 px-2 py-0.5 font-label text-label-sm text-primary"
    >
      {c.name}
    </span>
  ))}
</div>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- VotePage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/VotePage.tsx apps/web/src/pages/VotePage.test.tsx
git commit -m "feat(web): votar em até 3 categorias por colega"
```

---

### Task 10: Frontend — `ProfilePage`, `ModerationSection` e build do web

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx:280-311`
- Modify: `apps/web/src/pages/admin/ModerationSection.tsx:28`
- Test: `apps/web/src/pages/ProfilePage.test.tsx`

**Interfaces:**
- Consumes: `VoteDTO.categories` (Task 1).
- Produces: web compila (`tsc --noEmit`) e renderiza votos com múltiplas categorias.

- [ ] **Step 1: Atualizar `ProfilePage.test.tsx`**

Inspecionar (`grep -n "category\|categories\|vote" apps/web/src/pages/ProfilePage.test.tsx`). Onde o mock de votos recebidos usa `category: {...}`, trocar para `categories: [{...}]`. Garantir um assert de que o nome da categoria aparece na lista de reconhecimentos.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- ProfilePage`
Expected: FAIL (acessa `vote.category`).

- [ ] **Step 3: Implementar em `ProfilePage.tsx`**

No card de cada voto recebido (linhas 285-295), usar a primeira categoria para o ícone e renderizar todas como chips:

```tsx
<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-container/20 text-primary">
  <Icon
    name={categoryIcon(vote.categories[0]?.slug ?? "")}
    className="text-[22px]"
  />
</div>
<div className="flex-grow">
  <div className="flex items-start justify-between gap-md">
    <div className="flex flex-wrap gap-1">
      {vote.categories.map((c) => (
        <span
          key={c.id}
          className="rounded-full bg-primary/10 px-2 py-0.5 font-label text-label-sm text-primary"
        >
          {c.name}
        </span>
      ))}
    </div>
    <span className="shrink-0 font-label text-label-sm text-on-surface-variant">
      {vote.monthRef}
    </span>
  </div>
  {/* ...justificativa e "Enviado por" permanecem iguais... */}
</div>
```

- [ ] **Step 4: Implementar em `ModerationSection.tsx`**

Trocar a linha 28 (`· {vote.category.name}`) por:

```tsx
<span className="ml-2 font-body text-body-sm text-on-surface-variant">· {vote.categories.map((c) => c.name).join(", ")}</span>
```

- [ ] **Step 5: Rodar testes e build do web (typecheck)**

Run: `pnpm --filter @legends/web test -- ProfilePage`
Expected: PASS.

Run: `pnpm --filter @legends/web build`
Expected: `tsc --noEmit` sem erros + build Vite OK. Se acusar resíduo de `vote.category`, corrigir o ponto indicado.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/admin/ModerationSection.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): perfil e moderação exibem múltiplas categorias por voto"
```

---

### Task 11: Verificação final (suíte completa + build)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Subir Postgres e rodar tudo**

Run: `pnpm db:up && pnpm test`
Expected: PASS em api e web.

- [ ] **Step 2: Build completo**

Run: `pnpm build`
Expected: build de todos os workspaces sem erro.

- [ ] **Step 3: Smoke manual (opcional, recomendado)**

Run: `pnpm dev`, abrir a tela de votação, marcar 2-3 categorias, enviar; conferir que aparece como um único reconhecimento com os chips e que ultrapassar o teto desabilita as demais.
