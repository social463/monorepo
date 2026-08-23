# Categorias e Selos por Setor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Category` e `Badge` deixam de ser sempre globais: cada um ganha um marcador `global` e, quando `global = false`, uma lista de setores específicos aos quais fica restrito — tanto na votação/avaliação de selos quanto na tela do admin.

**Architecture:** Dois novos modelos de junção (`CategorySector`, `BadgeSector`, muitos-para-muitos) + um campo `global Boolean @default(true)` em cada entidade. Toda rota/serviço que hoje lê "todas as categorias/selos" passa a filtrar por `global = true OU associado ao setor do usuário` quando o consumidor é um usuário comum (votação, catálogo de selos, avaliação automática); o admin continua vendo tudo, sem filtro. O admin gerencia global/setores num checkbox + lista de checkboxes de setor, e a listagem no painel agrupa por "Global" + um grupo por setor (um item pode aparecer em mais de um grupo).

**Tech Stack:** Fastify + Prisma + PostgreSQL (apps/api), Vite + React + TanStack Query (apps/web), Zod, Vitest.

## Global Constraints

- TypeScript strict, ESM puro; migrations geradas com `pnpm db:migrate` (via `prisma migrate dev`), nunca editando uma já aplicada.
- Mensagens ao usuário em português.
- Rotas finas → lógica no service quando já existir um (Squad/Sector); Categoria e Selo já têm sua lógica de CRUD inline em `apps/api/src/routes/admin.ts` hoje — este plano mantém esse padrão existente ali, só adicionando o necessário para o novo campo/relação (não é o momento de extrair um service novo só por isto).
- Testes Vitest colocados ao lado do código; a API testa contra Postgres real (`pnpm db:up` precisa estar de pé).
- Durante a implementação, rode só o(s) arquivo(s) de teste do que foi alterado; a suíte completa (`pnpm test`, ambos workspaces) é a verificação final, no último task deste plano.
- `global` nasce com `@default(true)` em ambos os modelos — toda categoria/selo já existente vira global automaticamente; nenhuma migration de dados manual é necessária.
- Quando `global = false`, a lista de setores associados pode ficar vazia (rascunho válido, "invisível para todo mundo até alguém ser associado") — não é um estado de erro.
- `UserBadge` (selo já concedido) nunca é revogado por uma mudança de escopo global/setor feita depois — histórico é imutável.
- Admin (`GET/POST/PATCH /admin/categories`, `GET/POST/PATCH/DELETE /admin/badges`) sempre vê/gerencia tudo, sem filtro de setor.

---

## Task 1: Schema — `Category.global`, `Badge.global`, `CategorySector`, `BadgeSector`

**Files:**
- Modify: `apps/api/prisma/schema.prisma:224-234` (model `Category`), `apps/api/prisma/schema.prisma:267-280` (model `Sector`), `apps/api/prisma/schema.prisma:366-377` (model `Badge`)
- Create: uma migration gerada por `prisma migrate dev` em `apps/api/prisma/migrations/`
- Modify: `apps/api/test/setup.ts`

**Interfaces:**
- Produces: colunas `Category.global: boolean`, `Badge.global: boolean`; modelos `CategorySector { categoryId, sectorId }` e `BadgeSector { badgeId, sectorId }`; relações `Category.sectors: CategorySector[]`, `Badge.sectors: BadgeSector[]`, `Sector.categorySectors: CategorySector[]`, `Sector.badgeSectors: BadgeSector[]`. Todas as tasks seguintes dependem destes nomes exatos.

- [ ] **Step 1: Editar o model `Category`**

Em `apps/api/prisma/schema.prisma`, troque:

```prisma
model Category {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  active      Boolean  @default(true)
  isSpecial   Boolean  @default(false)
  createdAt   DateTime @default(now())

  voteCategories VoteCategory[]
}
```

por:

```prisma
model Category {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  active      Boolean  @default(true)
  isSpecial   Boolean  @default(false)
  global      Boolean  @default(true)
  createdAt   DateTime @default(now())

  voteCategories VoteCategory[]
  sectors        CategorySector[]
}

model CategorySector {
  categoryId String
  sectorId   String

  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  sector   Sector   @relation(fields: [sectorId], references: [id], onDelete: Cascade)

  @@id([categoryId, sectorId])
}
```

- [ ] **Step 2: Editar o model `Badge`**

Em `apps/api/prisma/schema.prisma`, troque:

```prisma
model Badge {
  id           String    @id @default(cuid())
  slug         String    @unique
  name         String
  description  String
  kind         BadgeKind
  iconKey      String
  threshold    Int       @default(0)
  categorySlug String?

  awarded UserBadge[]
}
```

por:

```prisma
model Badge {
  id           String    @id @default(cuid())
  slug         String    @unique
  name         String
  description  String
  kind         BadgeKind
  iconKey      String
  threshold    Int       @default(0)
  categorySlug String?
  global       Boolean   @default(true)

  awarded UserBadge[]
  sectors BadgeSector[]
}

model BadgeSector {
  badgeId  String
  sectorId String

  badge  Badge  @relation(fields: [badgeId], references: [id], onDelete: Cascade)
  sector Sector @relation(fields: [sectorId], references: [id], onDelete: Cascade)

  @@id([badgeId, sectorId])
}
```

- [ ] **Step 3: Adicionar as relações inversas no model `Sector`**

Em `apps/api/prisma/schema.prisma`, troque:

```prisma
  users         User[]
  roles         SectorRole[]
  votingPeriods VotingPeriod[]
  squads        Squad[]
}
```

por:

```prisma
  users           User[]
  roles           SectorRole[]
  votingPeriods   VotingPeriod[]
  squads          Squad[]
  categorySectors CategorySector[]
  badgeSectors    BadgeSector[]
}
```

- [ ] **Step 4: Gerar e aplicar a migration**

Com o Postgres local no ar (`pnpm db:up` se ainda não estiver), rode a partir da raiz do repo:

```bash
pnpm --filter @legends/api exec prisma migrate dev --name add_category_badge_sectors
```

Expected: prompt/execução conclui com "Your database is now in sync with your schema" (ou equivalente) e um novo diretório em `apps/api/prisma/migrations/<timestamp>_add_category_badge_sectors/` aparece com `migration.sql`.

- [ ] **Step 5: Regenerar o Prisma Client**

```bash
pnpm db:generate
```

Expected: "Generated Prisma Client" sem erros.

- [ ] **Step 6: Conferir que a migration não tem drift**

```bash
pnpm --filter @legends/api exec prisma migrate status
```

Expected: "Database schema is up to date!"

- [ ] **Step 7: Atualizar `apps/api/test/setup.ts` — truncar as novas tabelas de junção**

A ordem de `deleteMany` dentro do array de `$transaction` respeita dependência de FK (filho antes do pai) — `userBadge.deleteMany()` já precede `badge.deleteMany()` pelo mesmo motivo. Troque:

```ts
    prisma.feedbackReaction.deleteMany(),
    prisma.feedback.deleteMany(),
    prisma.badge.deleteMany(),
    prisma.votingPeriod.deleteMany(),
    prisma.category.deleteMany(),
```

por:

```ts
    prisma.feedbackReaction.deleteMany(),
    prisma.feedback.deleteMany(),
    prisma.badgeSector.deleteMany(),
    prisma.badge.deleteMany(),
    prisma.votingPeriod.deleteMany(),
    prisma.categorySector.deleteMany(),
    prisma.category.deleteMany(),
```

- [ ] **Step 8: Rodar a suíte da API para confirmar que nada quebrou**

```bash
pnpm --filter @legends/api test
```

Expected: todos os testes passam (nenhuma mudança de comportamento ainda — só schema + truncation). Este é o baseline antes de qualquer lógica nova.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/setup.ts
git commit -m "feat(api): Category e Badge ganham global + associação com setores"
```

---

## Task 2: Tipos compartilhados — `CategoryDTO`/`BadgeDTO` ganham `global`/`sectorIds`

**Files:**
- Modify: `packages/shared/src/vote.ts` (interface `CategoryDTO`)
- Modify: `packages/shared/src/badge.ts` (interface `BadgeDTO`)

**Interfaces:**
- Consumes: nada de tasks anteriores (é um pacote independente).
- Produces: `CategoryDTO { ...campos atuais, global: boolean, sectorIds: string[] }`, `BadgeDTO { ...campos atuais, global: boolean, sectorIds: string[] }`. Task 3 (`serialize.ts`) e todas as tasks de frontend consomem estes dois tipos exatos.

- [ ] **Step 1: Editar `CategoryDTO` em `packages/shared/src/vote.ts`**

Troque:

```ts
export interface CategoryDTO {
  id: string
  name: string
  slug: string
  description: string | null
  isSpecial: boolean
  active: boolean
}
```

por:

```ts
export interface CategoryDTO {
  id: string
  name: string
  slug: string
  description: string | null
  isSpecial: boolean
  active: boolean
  global: boolean
  sectorIds: string[]
}
```

- [ ] **Step 2: Editar `BadgeDTO` em `packages/shared/src/badge.ts`**

Troque:

```ts
export interface BadgeDTO {
  id: string
  slug: string
  name: string
  description: string
  kind: BadgeKind
  iconKey: string
  threshold: number
  categorySlug: string | null
}
```

por:

```ts
export interface BadgeDTO {
  id: string
  slug: string
  name: string
  description: string
  kind: BadgeKind
  iconKey: string
  threshold: number
  categorySlug: string | null
  global: boolean
  sectorIds: string[]
}
```

- [ ] **Step 3: Rodar o typecheck do pacote (ainda vai falhar em outros lugares — é esperado)**

```bash
pnpm --filter @legends/shared exec tsc --noEmit
```

Expected: PASS (este pacote não referencia `apps/api`/`apps/web`, então não quebra aqui — a quebra por causa dos novos campos obrigatórios vai aparecer em `apps/api` e `apps/web` nas próximas tasks; isso é esperado e será corrigido task a task).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/vote.ts packages/shared/src/badge.ts
git commit -m "feat(shared): CategoryDTO/BadgeDTO ganham global e sectorIds"
```

---

## Task 3: `serialize.ts` — `toCategoryDTO`/`toBadgeDTO` computam `sectorIds`

**Files:**
- Modify: `apps/api/src/lib/serialize.ts` (funções `toCategoryDTO`, `toBadgeDTO`)
- Modify: `apps/api/src/lib/serialize.test.ts` (arquivo já existe, com outros testes de serialize — adicione os casos abaixo sem remover nada; adicione `toCategoryDTO, toBadgeDTO` aos imports já existentes de `./serialize` no topo do arquivo)

**Interfaces:**
- Consumes: `CategoryDTO`/`BadgeDTO` (Task 2).
- Produces: `toCategoryDTO(category: Category & { sectors?: { sectorId: string }[] }): CategoryDTO`, `toBadgeDTO(badge: Badge & { sectors?: { sectorId: string }[] }): BadgeDTO` — a propriedade `sectors` é opcional no tipo de entrada (default `[]` quando ausente), mas todo chamador que expõe a DTO pro admin (Tasks 5-6) DEVE incluir a relação via `include: { sectors: true }` na query, senão `sectorIds` sai vazio mesmo pra um item não-global.

- [ ] **Step 1: Editar `toCategoryDTO`**

Troque:

```ts
export function toCategoryDTO(category: Category): CategoryDTO {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    isSpecial: category.isSpecial,
    active: category.active,
  }
}
```

por:

```ts
export function toCategoryDTO(category: Category & { sectors?: { sectorId: string }[] }): CategoryDTO {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    isSpecial: category.isSpecial,
    active: category.active,
    global: category.global,
    sectorIds: category.sectors?.map((s) => s.sectorId) ?? [],
  }
}
```

- [ ] **Step 2: Editar `toBadgeDTO`**

Troque:

```ts
export function toBadgeDTO(badge: Badge): BadgeDTO {
  return {
    id: badge.id,
    slug: badge.slug,
    name: badge.name,
    description: badge.description,
    kind: badge.kind,
    iconKey: badge.iconKey,
    threshold: badge.threshold,
    categorySlug: badge.categorySlug,
  }
}
```

por:

```ts
export function toBadgeDTO(badge: Badge & { sectors?: { sectorId: string }[] }): BadgeDTO {
  return {
    id: badge.id,
    slug: badge.slug,
    name: badge.name,
    description: badge.description,
    kind: badge.kind,
    iconKey: badge.iconKey,
    threshold: badge.threshold,
    categorySlug: badge.categorySlug,
    global: badge.global,
    sectorIds: badge.sectors?.map((s) => s.sectorId) ?? [],
  }
}
```

- [ ] **Step 3: Verificar que `Category`/`Badge` importados no topo do arquivo já vêm de `@prisma/client` (já são — só confirme, não precisa mudar o import)**

- [ ] **Step 4: Adicionar os testes ao final de `apps/api/src/lib/serialize.test.ts`** (e adicionar `toCategoryDTO, toBadgeDTO` à lista de imports nomeados já existente no topo do arquivo, vinda de `./serialize`)

```ts
import { describe, it, expect } from 'vitest'
import { toCategoryDTO, toBadgeDTO } from './serialize'

describe('toCategoryDTO', () => {
  it('expõe sectorIds vazio quando a relação não foi incluída', () => {
    const category = { id: 'c1', name: 'X', slug: 'x', description: null, isSpecial: false, active: true, global: true, createdAt: new Date() }
    expect(toCategoryDTO(category).sectorIds).toEqual([])
  })

  it('expõe sectorIds a partir da relação sectors incluída', () => {
    const category = {
      id: 'c1', name: 'X', slug: 'x', description: null, isSpecial: false, active: true, global: false, createdAt: new Date(),
      sectors: [{ sectorId: 's1' }, { sectorId: 's2' }],
    }
    expect(toCategoryDTO(category).sectorIds).toEqual(['s1', 's2'])
    expect(toCategoryDTO(category).global).toBe(false)
  })
})

describe('toBadgeDTO', () => {
  it('expõe sectorIds a partir da relação sectors incluída', () => {
    const badge = {
      id: 'b1', slug: 'b', name: 'B', description: 'd', kind: 'IMPACT' as const, iconKey: 'star', threshold: 1, categorySlug: null, global: false,
      sectors: [{ sectorId: 's1' }],
    }
    expect(toBadgeDTO(badge).sectorIds).toEqual(['s1'])
  })
})
```

- [ ] **Step 5: Rodar o teste**

```bash
pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts
```

Expected: PASS (3 testes).

- [ ] **Step 6: Rodar o typecheck da API (ainda deve ter erros em admin.ts/badge-service.ts/categories.ts — normal, corrigidos nas próximas tasks)**

```bash
pnpm --filter @legends/api exec tsc --noEmit
```

Expected: erros nos arquivos que ainda chamam `prisma.category.create`/`prisma.badge.create` sem os campos novos, ou que usam `toCategoryDTO`/`toBadgeDTO` — isso é esperado neste ponto do plano.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize.test.ts
git commit -m "feat(api): toCategoryDTO/toBadgeDTO computam sectorIds"
```

---

## Task 4: `GET /categories` e `createVote` filtram por setor

**Files:**
- Modify: `apps/api/src/routes/categories.ts`
- Modify: `apps/api/src/services/voting-service.ts:79-82` (validação de `categoryIds` em `createVote`)
- Test: `apps/api/src/routes/categories.test.ts`, `apps/api/src/services/voting-service.test.ts`

**Interfaces:**
- Consumes: `request.user.sectorId` (já disponível no payload do JWT, `apps/api/src/types/fastify.d.ts`), `toCategoryDTO` (Task 3).
- Produces: nenhuma interface nova — só muda o comportamento das duas rotas/função já existentes.

- [ ] **Step 1: Escrever o teste que falha — `GET /categories` só devolve globais + do setor do usuário**

Em `apps/api/src/routes/categories.test.ts`, adicione (mantendo os testes existentes):

```ts
  it('inclui categorias globais e específicas do setor do usuário, mas não as de outro setor', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app)
    const otherSector = await prisma.sector.create({ data: { name: 'Comercial', slug: 'comercial-cat-test', enabledFeatures: [] } })
    await prisma.category.create({ data: { name: 'Global', slug: 'global-cat', global: true } })
    await prisma.category.create({
      data: { name: 'Só Comercial', slug: 'so-comercial', global: false, sectors: { create: [{ sectorId: otherSector.id }] } },
    })
    const res = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const names = res.json().categories.map((c: { name: string }) => c.name)
    expect(names).toContain('Global')
    expect(names).not.toContain('Só Comercial')
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/categories.test.ts
```

Expected: FAIL — a categoria "Só Comercial" aparece na lista, porque a rota ainda não filtra.

- [ ] **Step 3: Editar `apps/api/src/routes/categories.ts`**

Troque:

```ts
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { toCategoryDTO } from '../lib/serialize'

export async function categoryRoutes(app: FastifyInstance) {
  app.get('/categories', { onRequest: [app.authenticate] }, async (_request, reply) => {
    const categories = await prisma.category.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ categories: categories.map(toCategoryDTO) })
  })
}
```

por:

```ts
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { toCategoryDTO } from '../lib/serialize'

export async function categoryRoutes(app: FastifyInstance) {
  app.get('/categories', { onRequest: [app.authenticate] }, async (request, reply) => {
    const categories = await prisma.category.findMany({
      where: {
        active: true,
        OR: [{ global: true }, { sectors: { some: { sectorId: request.user.sectorId } } }],
      },
      include: { sectors: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ categories: categories.map(toCategoryDTO) })
  })
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/routes/categories.test.ts
```

Expected: PASS (todos os testes do arquivo, incluindo os pré-existentes).

- [ ] **Step 5: Escrever o teste que falha — `createVote` rejeita categoria fora do setor do votante**

Leia primeiro `apps/api/src/services/voting-service.test.ts` para confirmar o padrão de setup já usado nele (criação de usuário/setor/período). Adicione um teste seguindo o mesmo padrão:

```ts
  it('rejeita categoryId específico de outro setor', async () => {
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A', slug: 'setor-a-vote-test', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B', slug: 'setor-b-vote-test', enabledFeatures: [] } })
    const voter = await prisma.user.create({ data: { name: 'Voter', email: 'voter-cat@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    const voted = await prisma.user.create({ data: { name: 'Voted', email: 'voted-cat@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    await prisma.votingPeriod.create({
      data: { sectorId: sectorA.id, monthRef: '2026-07', startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), status: 'OPEN' },
    })
    const categoryB = await prisma.category.create({
      data: { name: 'Só Setor B', slug: 'so-setor-b', global: false, sectors: { create: [{ sectorId: sectorB.id }] } },
    })
    await expect(
      createVote({ voterId: voter.id, votedId: voted.id, categoryIds: [categoryB.id], justification: 'Justificativa válida aqui.' }),
    ).rejects.toMatchObject({ status: 400 })
  })
```

- [ ] **Step 6: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/services/voting-service.test.ts
```

Expected: FAIL — o voto é criado com sucesso em vez de rejeitado, porque a validação ainda não olha pro setor da categoria.

- [ ] **Step 7: Editar `apps/api/src/services/voting-service.ts:79-82`**

Troque:

```ts
  const categoryIds = [...new Set(input.categoryIds)]
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } })
  if (categories.length !== categoryIds.length || categories.some((c) => !c.active)) {
    throw new VoteError('Categoria inválida.', 400)
  }
```

por:

```ts
  const categoryIds = [...new Set(input.categoryIds)]
  const categories = await prisma.category.findMany({
    where: {
      id: { in: categoryIds },
      OR: [{ global: true }, { sectors: { some: { sectorId: voter.sectorId } } }],
    },
  })
  if (categories.length !== categoryIds.length || categories.some((c) => !c.active)) {
    throw new VoteError('Categoria inválida.', 400)
  }
```

- [ ] **Step 8: Rodar de novo e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/services/voting-service.test.ts
```

Expected: PASS (todos os testes do arquivo).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/categories.ts apps/api/src/routes/categories.test.ts apps/api/src/services/voting-service.ts apps/api/src/services/voting-service.test.ts
git commit -m "feat(api): GET /categories e createVote respeitam categorias globais/por-setor"
```

---

## Task 5: Avaliação e catálogo de selos respeitam globais/por-setor

**Files:**
- Modify: `apps/api/src/services/badge-service.ts` (`evaluateBadgesForUser`, `evaluateTenureBadgesForUser`, `evaluateStreakBadgesForUser`, `evaluateTenureBadgesForAllUsers`, `syncFeedbackBadgesForUser`, `getBadgeCatalog`)
- Test: `apps/api/src/services/badge-service.test.ts`, `apps/api/src/services/badge-streak.test.ts`

**Interfaces:**
- Consumes: nenhuma de tasks anteriores além do schema (Task 1).
- Produces: nenhuma assinatura de função muda — todas continuam recebendo só `userId` (e `now`/`todayYmd` opcionais como já era). O filtro de setor é resolvido internamente, buscando o `sectorId` do usuário avaliado.

- [ ] **Step 1: Escrever o teste que falha — `evaluateBadgesForUser` não concede selo de outro setor**

Leia `apps/api/src/services/badge-service.test.ts` primeiro para confirmar o helper de criação de usuário/setor já usado nele. Adicione:

```ts
  it('evaluateBadgesForUser não avalia/concede selo específico de outro setor', async () => {
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A', slug: 'setor-a-badge-test', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B', slug: 'setor-b-badge-test', enabledFeatures: [] } })
    const user = await prisma.user.create({ data: { name: 'U', email: 'u-badge-sector@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    const badgeB = await prisma.badge.create({
      data: { name: 'Só Setor B', slug: 'so-setor-b-badge', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 0, global: false, sectors: { create: [{ sectorId: sectorB.id }] } },
    })
    await evaluateBadgesForUser(user.id)
    const owned = await prisma.userBadge.findMany({ where: { userId: user.id, badgeId: badgeB.id } })
    expect(owned).toHaveLength(0)
  })

  it('evaluateBadgesForUser concede selo global normalmente', async () => {
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A2', slug: 'setor-a2-badge-test', enabledFeatures: [] } })
    const user = await prisma.user.create({ data: { name: 'U2', email: 'u2-badge-sector@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    const badgeGlobal = await prisma.badge.create({
      data: { name: 'Global Impact', slug: 'global-impact-badge', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    await evaluateBadgesForUser(user.id)
    const owned = await prisma.userBadge.findMany({ where: { userId: user.id, badgeId: badgeGlobal.id } })
    expect(owned).toHaveLength(1)
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/services/badge-service.test.ts -t "evaluateBadgesForUser"
```

Expected: FAIL no primeiro teste novo (o selo de outro setor é concedido mesmo assim, já que `IMPACT` com `threshold: 0` sempre qualifica).

- [ ] **Step 3: Editar `evaluateBadgesForUser`**

Troque:

```ts
export async function evaluateBadgesForUser(userId: string): Promise<UserBadge[]> {
  const [badges, owned] = await Promise.all([
    prisma.badge.findMany(),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
```

por:

```ts
export async function evaluateBadgesForUser(userId: string): Promise<UserBadge[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sectorId: true } })
  if (!user) return []
  const [badges, owned] = await Promise.all([
    prisma.badge.findMany({ where: { OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
```

- [ ] **Step 4: Editar `evaluateTenureBadgesForUser` — já busca o usuário, só adiciona o filtro**

Troque:

```ts
export async function evaluateTenureBadgesForUser(
  userId: string,
  now: Date = new Date(),
): Promise<UserBadge[]> {
  const [user, tenureBadges, owned] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { joinedAt: true } }),
    prisma.badge.findMany({ where: { kind: 'TENURE' } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
  if (!user) return []
```

por:

```ts
export async function evaluateTenureBadgesForUser(
  userId: string,
  now: Date = new Date(),
): Promise<UserBadge[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { joinedAt: true, sectorId: true } })
  if (!user) return []
  const [tenureBadges, owned] = await Promise.all([
    prisma.badge.findMany({ where: { kind: 'TENURE', OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
```

- [ ] **Step 5: Editar `evaluateStreakBadgesForUser`**

Troque:

```ts
export async function evaluateStreakBadgesForUser(
  userId: string,
  todayYmd?: string,
): Promise<UserBadge[]> {
  const [streakBadges, owned] = await Promise.all([
    prisma.badge.findMany({ where: { kind: 'STREAK' } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
  if (streakBadges.length === 0) return []
```

por:

```ts
export async function evaluateStreakBadgesForUser(
  userId: string,
  todayYmd?: string,
): Promise<UserBadge[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sectorId: true } })
  if (!user) return []
  const [streakBadges, owned] = await Promise.all([
    prisma.badge.findMany({ where: { kind: 'STREAK', OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
  if (streakBadges.length === 0) return []
```

- [ ] **Step 6: Editar `syncFeedbackBadgesForUser`**

Troque:

```ts
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
```

por:

```ts
export async function syncFeedbackBadgesForUser(
  userId: string,
): Promise<{ awarded: UserBadge[]; revoked: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sectorId: true } })
  if (!user) return { awarded: [], revoked: 0 }
  const [feedbackBadges, autoOwned, count] = await Promise.all([
    prisma.badge.findMany({ where: { kind: 'FEEDBACK', OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] } }),
    prisma.userBadge.findMany({
      where: { userId, periodId: null, source: 'AUTO', badge: { kind: 'FEEDBACK' } },
      select: { id: true, badgeId: true },
    }),
    countFeedbacksAuthored(userId),
  ])
```

- [ ] **Step 7: Editar `evaluateTenureBadgesForAllUsers` — processa vários usuários de setores diferentes contra o mesmo lote de selos, filtra em memória**

Troque:

```ts
export async function evaluateTenureBadgesForAllUsers(now: Date = new Date()): Promise<number> {
  const [users, tenureBadges, owned] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, joinedAt: true } }),
    prisma.badge.findMany({ where: { kind: 'TENURE' } }),
    prisma.userBadge.findMany({
      where: { periodId: null, badge: { kind: 'TENURE' } },
      select: { userId: true, badgeId: true },
    }),
  ])
  if (tenureBadges.length === 0) return 0
```

por:

```ts
export async function evaluateTenureBadgesForAllUsers(now: Date = new Date()): Promise<number> {
  const [users, tenureBadges, owned] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, joinedAt: true, sectorId: true } }),
    prisma.badge.findMany({ where: { kind: 'TENURE' }, include: { sectors: true } }),
    prisma.userBadge.findMany({
      where: { periodId: null, badge: { kind: 'TENURE' } },
      select: { userId: true, badgeId: true },
    }),
  ])
  if (tenureBadges.length === 0) return 0
```

E, no laço logo abaixo (mesma função), troque:

```ts
  const toCreate: { userId: string; badgeId: string }[] = []
  for (const user of users) {
    const years = completedYears(user.joinedAt, now)
    const ownedIds = ownedByUser.get(user.id)
    for (const badge of tenureBadges) {
      if (years < badge.threshold) continue
      if (ownedIds?.has(badge.id)) continue
      toCreate.push({ userId: user.id, badgeId: badge.id })
    }
  }
```

por:

```ts
  const toCreate: { userId: string; badgeId: string }[] = []
  for (const user of users) {
    const years = completedYears(user.joinedAt, now)
    const ownedIds = ownedByUser.get(user.id)
    for (const badge of tenureBadges) {
      if (years < badge.threshold) continue
      if (ownedIds?.has(badge.id)) continue
      const inScope = badge.global || badge.sectors.some((s) => s.sectorId === user.sectorId)
      if (!inScope) continue
      toCreate.push({ userId: user.id, badgeId: badge.id })
    }
  }
```

- [ ] **Step 8: Editar `getBadgeCatalog` — filtra pelo setor do usuário visualizando o catálogo**

Troque:

```ts
export async function getBadgeCatalog(userId: string): Promise<BadgeCatalogEntry[]> {
  const [badges, categories] = await Promise.all([
    prisma.badge.findMany({ orderBy: { name: 'asc' } }),
    prisma.category.findMany({ select: { slug: true, name: true } }),
  ])
```

por:

```ts
export async function getBadgeCatalog(userId: string): Promise<BadgeCatalogEntry[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sectorId: true } })
  if (!user) return []
  const [badges, categories] = await Promise.all([
    prisma.badge.findMany({
      where: { OR: [{ global: true }, { sectors: { some: { sectorId: user.sectorId } } }] },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({ select: { slug: true, name: true } }),
  ])
```

- [ ] **Step 9: Rodar os testes de badge-service e badge-streak**

```bash
pnpm --filter @legends/api exec vitest run src/services/badge-service.test.ts src/services/badge-streak.test.ts
```

Expected: PASS — todos os testes, incluindo os dois novos do Step 1.

- [ ] **Step 10: Rodar o typecheck da API**

```bash
pnpm --filter @legends/api exec tsc --noEmit
```

Expected: só devem restar erros em `apps/api/src/routes/admin.ts` (categorias/selos ainda não atualizados — Tasks 6 e 7).

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts apps/api/src/services/badge-streak.test.ts
git commit -m "feat(api): avaliação e catálogo de selos respeitam escopo global/setor"
```

---

## Task 6: Admin — CRUD de Categorias com `global`/`sectorIds`

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (schemas `createCategorySchema`/`updateCategorySchema`, rotas `GET/POST/PATCH /admin/categories`)
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `toCategoryDTO` (Task 3), `recordAuditLog` (já existente).
- Produces: `POST/PATCH /admin/categories` aceitam `global?: boolean` e `sectorIds?: string[]` no corpo; a resposta (`category`) inclui `global`/`sectorIds`. Nenhuma outra rota depende desta.

- [ ] **Step 1: Escrever o teste que falha — criar categoria específica de setores e trocar depois**

Em `apps/api/src/routes/admin.test.ts`, adicione perto dos outros testes de `/admin/categories` (a função `adminToken(app)` já existe no topo do arquivo, reuse):

```ts
  it('cria categoria global por padrão, e permite torná-la específica de setores', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sectorA = await prisma.sector.create({ data: { name: 'Setor Cat A', slug: 'setor-cat-a', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor Cat B', slug: 'setor-cat-b', enabledFeatures: [] } })

    const created = await app.inject({
      method: 'POST', url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Categoria Setores Test' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().category.global).toBe(true)
    expect(created.json().category.sectorIds).toEqual([])

    const categoryId = created.json().category.id
    const restricted = await app.inject({
      method: 'PATCH', url: `/admin/categories/${categoryId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { global: false, sectorIds: [sectorA.id, sectorB.id] },
    })
    expect(restricted.statusCode).toBe(200)
    expect(restricted.json().category.global).toBe(false)
    expect(restricted.json().category.sectorIds.sort()).toEqual([sectorA.id, sectorB.id].sort())

    const backToGlobal = await app.inject({
      method: 'PATCH', url: `/admin/categories/${categoryId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { global: true },
    })
    expect(backToGlobal.statusCode).toBe(200)
    expect(backToGlobal.json().category.global).toBe(true)
    expect(backToGlobal.json().category.sectorIds).toEqual([])
    await app.close()
  })

  it('log de auditoria da categoria inclui sectorIds', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sector = await prisma.sector.create({ data: { name: 'Setor Cat Audit', slug: 'setor-cat-audit', enabledFeatures: [] } })
    const created = await app.inject({
      method: 'POST', url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Categoria Audit Test', global: false, sectorIds: [sector.id] },
    })
    const categoryId = created.json().category.id
    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'Category', entityId: categoryId, action: 'CREATE' } })
    expect(log).not.toBeNull()
    expect((log!.after as { sectorIds: string[] }).sectorIds).toEqual([sector.id])
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "categoria"
```

Expected: FAIL — os campos `global`/`sectorIds` não existem ainda na rota (a request nem é aceita pelo schema Zod atual, que não tem esses campos).

- [ ] **Step 3: Editar `createCategorySchema`/`updateCategorySchema` em `apps/api/src/routes/admin.ts`**

Troque:

```ts
const createCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
})
const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
})
```

por:

```ts
const createCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  global: z.boolean().optional(),
  sectorIds: z.array(z.string().min(1)).optional(),
})
const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
  global: z.boolean().optional(),
  sectorIds: z.array(z.string().min(1)).optional(),
})
```

- [ ] **Step 4: Editar `GET /admin/categories` — incluir a relação `sectors`**

Troque:

```ts
  app.get('/admin/categories', adminOnly, async (_request, reply) => {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } })
    return reply.send({ categories: categories.map(toCategoryDTO) })
  })
```

por:

```ts
  app.get('/admin/categories', adminOnly, async (_request, reply) => {
    const categories = await prisma.category.findMany({ include: { sectors: true }, orderBy: { name: 'asc' } })
    return reply.send({ categories: categories.map(toCategoryDTO) })
  })
```

- [ ] **Step 5: Editar `POST /admin/categories` — grava `global`/`sectorIds` numa transação**

Troque:

```ts
  app.post('/admin/categories', adminOnly, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    try {
      const category = await prisma.category.create({
        data: { name: parsed.data.name, slug: slugify(parsed.data.name), description: parsed.data.description },
      })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Category', entityId: category.id, action: 'CREATE', after: category })
      return reply.code(201).send({ category: toCategoryDTO(category) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe uma categoria com esse nome.' })
      }
      throw err
    }
  })
```

por:

```ts
  app.post('/admin/categories', adminOnly, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const global = parsed.data.global ?? true
    const sectorIds = global ? [] : (parsed.data.sectorIds ?? [])
    try {
      const category = await prisma.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: {
            name: parsed.data.name,
            slug: slugify(parsed.data.name),
            description: parsed.data.description,
            global,
            sectors: sectorIds.length > 0 ? { create: sectorIds.map((sectorId) => ({ sectorId })) } : undefined,
          },
          include: { sectors: true },
        })
        await recordAuditLog({
          actorId: request.user.sub,
          entityType: 'Category',
          entityId: created.id,
          action: 'CREATE',
          after: { ...created, sectorIds: created.sectors.map((s) => s.sectorId) },
          tx,
        })
        return created
      })
      return reply.code(201).send({ category: toCategoryDTO(category) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe uma categoria com esse nome.' })
      }
      throw err
    }
  })
```

- [ ] **Step 6: Editar `PATCH /admin/categories/:id` — mesma transação, substituindo as linhas de `CategorySector` quando necessário**

Troque:

```ts
  app.patch('/admin/categories/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const before = await prisma.category.findUnique({ where: { id } })
    if (!before) return reply.code(404).send({ message: 'Categoria não encontrada' })
    try {
      const category = await prisma.category.update({ where: { id }, data: parsed.data })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Category', entityId: id, action: 'UPDATE', before, after: category })
      return reply.send({ category: toCategoryDTO(category) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Categoria não encontrada' })
      }
      throw err
    }
  })
```

por:

```ts
  app.patch('/admin/categories/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const before = await prisma.category.findUnique({ where: { id }, include: { sectors: true } })
    if (!before) return reply.code(404).send({ message: 'Categoria não encontrada' })
    const { sectorIds, ...rest } = parsed.data
    const effectiveGlobal = rest.global ?? before.global
    try {
      const category = await prisma.$transaction(async (tx) => {
        const updated = await tx.category.update({ where: { id }, data: rest })
        if (effectiveGlobal) {
          await tx.categorySector.deleteMany({ where: { categoryId: id } })
        } else if (sectorIds !== undefined) {
          await tx.categorySector.deleteMany({ where: { categoryId: id } })
          if (sectorIds.length > 0) {
            await tx.categorySector.createMany({ data: sectorIds.map((sectorId) => ({ categoryId: id, sectorId })) })
          }
        }
        const withSectors = await tx.category.findUniqueOrThrow({ where: { id }, include: { sectors: true } })
        await recordAuditLog({
          actorId: request.user.sub,
          entityType: 'Category',
          entityId: id,
          action: 'UPDATE',
          before: { ...before, sectorIds: before.sectors.map((s) => s.sectorId) },
          after: { ...withSectors, sectorIds: withSectors.sectors.map((s) => s.sectorId) },
          tx,
        })
        return withSectors
      })
      return reply.send({ category: toCategoryDTO(category) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Categoria não encontrada' })
      }
      throw err
    }
  })
```

- [ ] **Step 7: Rodar os testes de novo**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "categoria"
```

Expected: PASS — todos os testes de categoria, incluindo os dois novos.

- [ ] **Step 8: Rodar a suíte inteira de `admin.test.ts` (garante que nada relacionado a categorias quebrou em outro teste que a reutiliza, ex.: os testes de auditoria já existentes que criam categorias)**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```

Expected: PASS (todos os testes do arquivo).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): admin gerencia global/sectorIds de categorias"
```

---

## Task 7: Admin — CRUD de Selos com `global`/`sectorIds` + `GET /admin/badges`

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (schemas `createBadgeSchema`/`updateBadgeSchema`, rotas `POST/PATCH /admin/badges`; nova rota `GET /admin/badges`)
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `toBadgeDTO` (Task 3).
- Produces: `GET /admin/badges` (novo — lista TODOS os selos, sem filtro de setor, `admin`-only); `POST/PATCH /admin/badges` aceitam `global?: boolean`/`sectorIds?: string[]`. Task 10 (frontend) troca `BadgesSection.tsx` de `/badges` para `/admin/badges`.

**Nota:** hoje não existe `GET /admin/badges` — a tela de admin reaproveita a rota pública `GET /badges` (que devolve o catálogo com progresso do usuário logado, calculado por `getBadgeCatalog`). Depois da Task 5, `GET /badges` passa a filtrar por setor — usar essa rota pro painel admin esconderia selos de outros setores da visão de gestão, contrariando a Global Constraint "admin sempre vê tudo". Por isso esta task cria uma rota nova, simples (sem progresso, sem filtro), só para o admin listar/gerenciar.

- [ ] **Step 1: Escrever o teste que falha — `GET /admin/badges` lista tudo, sem filtro de setor**

Em `apps/api/src/routes/admin.test.ts`, adicione perto dos outros testes de `/admin/badges`:

```ts
  it('lista todos os selos sem filtro de setor (GET /admin/badges)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Selo Test', slug: 'setor-selo-test', enabledFeatures: [] } })
    await prisma.badge.create({ data: { name: 'Global Selo', slug: 'global-selo-admin-test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1 } })
    await prisma.badge.create({
      data: { name: 'Selo Setor', slug: 'selo-setor-admin-test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: false, sectors: { create: [{ sectorId: otherSector.id }] } },
    })
    const res = await app.inject({ method: 'GET', url: '/admin/badges', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const names = res.json().badges.map((b: { name: string }) => b.name)
    expect(names).toContain('Global Selo')
    expect(names).toContain('Selo Setor')
    await app.close()
  })

  it('proíbe não-admin de listar selos do admin (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/badges', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('cria selo específico de setores e permite trocar depois', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sector = await prisma.sector.create({ data: { name: 'Setor Selo Criar', slug: 'setor-selo-criar', enabledFeatures: [] } })
    const created = await app.inject({
      method: 'POST', url: '/admin/badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Selo Restrito Test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: false, sectorIds: [sector.id] },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().badge.global).toBe(false)
    expect(created.json().badge.sectorIds).toEqual([sector.id])

    const badgeId = created.json().badge.id
    const madeGlobal = await app.inject({
      method: 'PATCH', url: `/admin/badges/${badgeId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { global: true },
    })
    expect(madeGlobal.statusCode).toBe(200)
    expect(madeGlobal.json().badge.global).toBe(true)
    expect(madeGlobal.json().badge.sectorIds).toEqual([])
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "selo"
```

Expected: FAIL — `GET /admin/badges` não existe (404), e o `payload` de criação com `global`/`sectorIds` ainda não é aceito.

- [ ] **Step 3: Editar `createBadgeSchema`/`updateBadgeSchema` em `apps/api/src/routes/admin.ts`**

Troque:

```ts
const createBadgeSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  kind: badgeKindSchema,
  iconKey: z.string().min(1),
  threshold: z.number().int().min(0).optional(),
  categorySlug: z.string().nullable().optional(),
})
const updateBadgeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  kind: badgeKindSchema.optional(),
  iconKey: z.string().min(1).optional(),
  threshold: z.number().int().min(0).optional(),
  categorySlug: z.string().nullable().optional(),
})
```

por:

```ts
const createBadgeSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  kind: badgeKindSchema,
  iconKey: z.string().min(1),
  threshold: z.number().int().min(0).optional(),
  categorySlug: z.string().nullable().optional(),
  global: z.boolean().optional(),
  sectorIds: z.array(z.string().min(1)).optional(),
})
const updateBadgeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  kind: badgeKindSchema.optional(),
  iconKey: z.string().min(1).optional(),
  threshold: z.number().int().min(0).optional(),
  categorySlug: z.string().nullable().optional(),
  global: z.boolean().optional(),
  sectorIds: z.array(z.string().min(1)).optional(),
})
```

- [ ] **Step 4: Adicionar `GET /admin/badges` — logo antes de `app.post('/admin/badges', ...)`**

```ts
  app.get('/admin/badges', adminOnly, async (_request, reply) => {
    const badges = await prisma.badge.findMany({ include: { sectors: true }, orderBy: { name: 'asc' } })
    return reply.send({ badges: badges.map(toBadgeDTO) })
  })

```

- [ ] **Step 5: Editar `POST /admin/badges`**

Troque:

```ts
  app.post('/admin/badges', adminOnly, async (request, reply) => {
    const parsed = createBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    try {
      const badge = await prisma.badge.create({
        data: {
          name: parsed.data.name,
          slug: slugify(parsed.data.name),
          description: parsed.data.description,
          kind: parsed.data.kind,
          iconKey: parsed.data.iconKey,
          threshold: parsed.data.threshold ?? 0,
          categorySlug: parsed.data.categorySlug ?? null,
        },
      })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Badge', entityId: badge.id, action: 'CREATE', after: badge })
      return reply.code(201).send({ badge: toBadgeDTO(badge) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe um selo com esse nome.' })
      }
      throw err
    }
  })
```

por:

```ts
  app.post('/admin/badges', adminOnly, async (request, reply) => {
    const parsed = createBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const global = parsed.data.global ?? true
    const sectorIds = global ? [] : (parsed.data.sectorIds ?? [])
    try {
      const badge = await prisma.$transaction(async (tx) => {
        const created = await tx.badge.create({
          data: {
            name: parsed.data.name,
            slug: slugify(parsed.data.name),
            description: parsed.data.description,
            kind: parsed.data.kind,
            iconKey: parsed.data.iconKey,
            threshold: parsed.data.threshold ?? 0,
            categorySlug: parsed.data.categorySlug ?? null,
            global,
            sectors: sectorIds.length > 0 ? { create: sectorIds.map((sectorId) => ({ sectorId })) } : undefined,
          },
          include: { sectors: true },
        })
        await recordAuditLog({
          actorId: request.user.sub,
          entityType: 'Badge',
          entityId: created.id,
          action: 'CREATE',
          after: { ...created, sectorIds: created.sectors.map((s) => s.sectorId) },
          tx,
        })
        return created
      })
      return reply.code(201).send({ badge: toBadgeDTO(badge) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe um selo com esse nome.' })
      }
      throw err
    }
  })
```

- [ ] **Step 6: Editar `PATCH /admin/badges/:id`**

Troque:

```ts
  app.patch('/admin/badges/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    // Regenera o slug quando o nome muda, mantendo-o consistente e único.
    const data = parsed.data.name ? { ...parsed.data, slug: slugify(parsed.data.name) } : parsed.data
    const before = await prisma.badge.findUnique({ where: { id } })
    if (!before) return reply.code(404).send({ message: 'Selo não encontrado' })
    try {
      const badge = await prisma.badge.update({ where: { id }, data })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Badge', entityId: id, action: 'UPDATE', before, after: badge })
      return reply.send({ badge: toBadgeDTO(badge) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.code(404).send({ message: 'Selo não encontrado' })
        if (err.code === 'P2002') return reply.code(409).send({ message: 'Já existe um selo com esse nome.' })
      }
      throw err
    }
  })
```

por:

```ts
  app.patch('/admin/badges/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const { sectorIds, ...rest } = parsed.data
    // Regenera o slug quando o nome muda, mantendo-o consistente e único.
    const data = rest.name ? { ...rest, slug: slugify(rest.name) } : rest
    const before = await prisma.badge.findUnique({ where: { id }, include: { sectors: true } })
    if (!before) return reply.code(404).send({ message: 'Selo não encontrado' })
    const effectiveGlobal = data.global ?? before.global
    try {
      const badge = await prisma.$transaction(async (tx) => {
        const updated = await tx.badge.update({ where: { id }, data })
        if (effectiveGlobal) {
          await tx.badgeSector.deleteMany({ where: { badgeId: id } })
        } else if (sectorIds !== undefined) {
          await tx.badgeSector.deleteMany({ where: { badgeId: id } })
          if (sectorIds.length > 0) {
            await tx.badgeSector.createMany({ data: sectorIds.map((sectorId) => ({ badgeId: id, sectorId })) })
          }
        }
        const withSectors = await tx.badge.findUniqueOrThrow({ where: { id }, include: { sectors: true } })
        await recordAuditLog({
          actorId: request.user.sub,
          entityType: 'Badge',
          entityId: id,
          action: 'UPDATE',
          before: { ...before, sectorIds: before.sectors.map((s) => s.sectorId) },
          after: { ...withSectors, sectorIds: withSectors.sectors.map((s) => s.sectorId) },
          tx,
        })
        return withSectors
      })
      return reply.send({ badge: toBadgeDTO(badge) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.code(404).send({ message: 'Selo não encontrado' })
        if (err.code === 'P2002') return reply.code(409).send({ message: 'Já existe um selo com esse nome.' })
      }
      throw err
    }
  })
```

- [ ] **Step 7: `DELETE /admin/badges/:id` não precisa mudar** — `BadgeSector` tem `onDelete: Cascade` (Task 1), então excluir o selo já limpa as linhas de junção automaticamente, igual já acontece hoje com nenhuma tabela extra a mais para tratar manualmente ali.

- [ ] **Step 8: Rodar os testes de novo**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "selo"
```

Expected: PASS — todos os testes de selo, incluindo os três novos.

- [ ] **Step 9: Rodar a suíte inteira de `admin.test.ts`**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```

Expected: PASS (todos os testes do arquivo).

- [ ] **Step 10: Rodar o typecheck e a suíte completa da API**

```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/api test
```

Expected: ambos limpos — este é o fim da parte de backend do plano.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): admin gerencia global/sectorIds de selos + GET /admin/badges"
```

---

## Task 8: Frontend — `SectorChecklist` e `groupBySectorMulti` em `shared.tsx`

**Files:**
- Modify: `apps/web/src/pages/admin/shared.tsx`
- Test: `apps/web/src/pages/admin/shared.test.tsx` (criar — hoje não existe teste para este arquivo)

**Interfaces:**
- Consumes: nenhuma (usa só tipos/dados já genéricos).
- Produces: `SectorChecklist({ sectors, selected, onToggle }: { sectors: {id:string;name:string}[]; selected: Set<string>; onToggle: (sectorId: string) => void })`, `groupBySectorMulti<T extends {global: boolean; sectorIds: string[]}>(items: T[], sectors: {id:string;name:string}[]): SectorGroup<T>[]` (retorna sempre um grupo `key: '__global__', name: 'Global'` primeiro, contendo todo item com `global: true`; depois um grupo por setor, cada um com os itens `global: false` que têm aquele setor em `sectorIds` — um item pode aparecer em mais de um grupo). Tasks 9 e 10 consomem os dois.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/web/src/pages/admin/shared.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { groupBySectorMulti, SectorChecklist } from './shared'

describe('groupBySectorMulti', () => {
  const sectors = [
    { id: 's1', name: 'Comercial' },
    { id: 's2', name: 'Produto' },
  ]

  it('coloca item global só no grupo Global', () => {
    const items = [{ id: 'a', global: true, sectorIds: [] }]
    const groups = groupBySectorMulti(items, sectors)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: '__global__', name: 'Global' })
    expect(groups[0].items).toEqual(items)
  })

  it('item específico de dois setores aparece nos dois grupos', () => {
    const items = [{ id: 'b', global: false, sectorIds: ['s1', 's2'] }]
    const groups = groupBySectorMulti(items, sectors)
    const bySector = groups.filter((g) => g.key !== '__global__')
    expect(bySector).toHaveLength(2)
    expect(bySector.every((g) => g.items.some((i) => i.id === 'b'))).toBe(true)
  })

  it('não gera grupo Global quando não há item global', () => {
    const items = [{ id: 'c', global: false, sectorIds: ['s1'] }]
    const groups = groupBySectorMulti(items, sectors)
    expect(groups.find((g) => g.key === '__global__')).toBeUndefined()
  })

  it('não gera grupo de um setor sem nenhum item específico associado', () => {
    const items = [{ id: 'd', global: false, sectorIds: ['s1'] }]
    const groups = groupBySectorMulti(items, sectors)
    expect(groups.find((g) => g.name === 'Produto')).toBeUndefined()
  })
})

describe('SectorChecklist', () => {
  const sectors = [
    { id: 's1', name: 'Comercial' },
    { id: 's2', name: 'Produto' },
  ]

  it('mostra um checkbox por setor, marcado conforme selected', () => {
    render(<SectorChecklist sectors={sectors} selected={new Set(['s1'])} onToggle={() => {}} />)
    expect(screen.getByLabelText('Comercial')).toBeChecked()
    expect(screen.getByLabelText('Produto')).not.toBeChecked()
  })

  it('chama onToggle com o sectorId ao clicar', () => {
    const onToggle = vi.fn()
    render(<SectorChecklist sectors={sectors} selected={new Set()} onToggle={onToggle} />)
    fireEvent.click(screen.getByLabelText('Produto'))
    expect(onToggle).toHaveBeenCalledWith('s2')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/shared.test.tsx
```

Expected: FAIL — `groupBySectorMulti`/`SectorChecklist` ainda não existem (erro de import).

- [ ] **Step 3: Adicionar `groupBySectorMulti` e `SectorChecklist` em `apps/web/src/pages/admin/shared.tsx`**

Ao final do arquivo (depois de `SectorAccordion`), adicione:

```tsx
// ----- Agrupamento multi-setor (Categorias/Selos: global OU um-ou-mais setores) -----

/**
 * Como groupBySector, mas pra itens que podem ser globais OU específicos de
 * MAIS DE UM setor ao mesmo tempo (não pertencem a exatamente um). Sempre
 * devolve o grupo "Global" primeiro (se houver algum item global); depois um
 * grupo por setor com pelo menos um item específico associado — um item de
 * dois setores aparece nos dois grupos correspondentes.
 */
export function groupBySectorMulti<T extends { global: boolean; sectorIds: string[] }>(
  items: T[],
  sectors: { id: string; name: string }[],
): SectorGroup<T>[] {
  const groups: SectorGroup<T>[] = []

  const globalItems = items.filter((item) => item.global)
  if (globalItems.length > 0) {
    groups.push({ key: '__global__', name: 'Global', items: globalItems })
  }

  for (const sector of sectors) {
    const matched = items.filter((item) => !item.global && item.sectorIds.includes(sector.id))
    if (matched.length > 0) {
      groups.push({ key: sector.id, name: sector.name, items: matched })
    }
  }

  return groups
}

export function SectorChecklist({
  sectors,
  selected,
  onToggle,
}: {
  sectors: { id: string; name: string }[]
  selected: Set<string>
  onToggle: (sectorId: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
      {sectors.map((sector) => (
        <label key={sector.id} className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input
            type="checkbox"
            aria-label={sector.name}
            checked={selected.has(sector.id)}
            onChange={() => onToggle(sector.id)}
          />
          {sector.name}
        </label>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/shared.test.tsx
```

Expected: PASS (6 testes).

- [ ] **Step 5: Rodar o typecheck do workspace web**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Expected: erros ainda esperados em `CategoriesSection.tsx`/`BadgesSection.tsx` (não usam os campos novos do DTO ainda — corrigido nas próximas duas tasks). Confirme que `shared.tsx` em si não introduz nenhum erro novo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/shared.tsx apps/web/src/pages/admin/shared.test.tsx
git commit -m "feat(web): groupBySectorMulti e SectorChecklist (Categorias/Selos)"
```

---

## Task 9: Frontend — `CategoriesSection.tsx` com Global/setores e agrupamento

**Files:**
- Modify: `apps/web/src/pages/admin/CategoriesSection.tsx`
- Modify: `apps/web/src/pages/admin/CategoriesSection.test.tsx`

**Interfaces:**
- Consumes: `groupBySectorMulti`, `SectorChecklist`, `SectorAccordion` (Task 8); `CategoryDTO` com `global`/`sectorIds` (Task 2); `/admin/sectors` (rota já existente, usada em `SectorsSection.tsx`/`CollaboratorsSection.tsx`/`SquadsSection.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Reescreva `apps/web/src/pages/admin/CategoriesSection.test.tsx` por completo:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { CategoriesSection } from './CategoriesSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/categories' && !method) {
      return Promise.resolve({
        categories: [
          { id: 'c1', name: 'Colaboração', slug: 'colaboracao', description: null, isSpecial: false, active: true, global: true, sectorIds: [] },
          { id: 'c2', name: 'Só Comercial', slug: 'so-comercial', description: null, isSpecial: false, active: true, global: false, sectorIds: ['s1'] },
        ],
      })
    }
    if (path === '/admin/sectors' && !method) {
      return Promise.resolve({ sectors: [{ id: 's1', name: 'Comercial', slug: 'comercial', active: true, enabledFeatures: [], roles: [] }] })
    }
    if (path === '/admin/categories' && method === 'POST') {
      return Promise.resolve({ category: { id: 'c3', name: 'Inovação', slug: 'inovacao', description: null, isSpecial: false, active: true, global: true, sectorIds: [] } })
    }
    if (path === '/admin/categories/c1' && method === 'PATCH') {
      return Promise.resolve({ category: { id: 'c1', name: 'Colaboração', slug: 'colaboracao', description: null, isSpecial: false, active: true, global: false, sectorIds: ['s1'] } })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CategoriesSection />
    </QueryClientProvider>,
  )
}

describe('CategoriesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('agrupa em Global e por setor, recolhido por padrão', async () => {
    renderSection()
    const globalToggle = await screen.findByRole('button', { name: /global \(1\)/i })
    const sectorToggle = screen.getByRole('button', { name: /comercial \(1\)/i })
    expect(globalToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Colaboração')).not.toBeInTheDocument()
    fireEvent.click(globalToggle)
    expect(screen.getByText('Colaboração')).toBeInTheDocument()
    fireEvent.click(sectorToggle)
    expect(screen.getByText('Só Comercial')).toBeInTheDocument()
  })

  it('creates a new category (global por padrão)', async () => {
    renderSection()
    await screen.findByRole('button', { name: /global \(1\)/i })
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar categoria' }))
    fireEvent.change(screen.getByLabelText(/nova categoria/i), { target: { value: 'Inovação' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/categories', expect.objectContaining({ method: 'POST' })),
    )
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/categories' && c[1]?.method === 'POST')![1] as RequestInit).body as string)
    expect(body.global).toBe(true)
  })

  it('desmarca Global e mostra a lista de setores no formulário de criação', async () => {
    renderSection()
    await screen.findByRole('button', { name: /global \(1\)/i })
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar categoria' }))
    expect(screen.queryByLabelText('Comercial')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/^global$/i))
    expect(screen.getByLabelText('Comercial')).toBeInTheDocument()
  })

  it('torna uma categoria específica de setor (checkbox Global inline)', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /global \(1\)/i }))
    await screen.findByText('Colaboração')
    const rowGlobalCheckbox = screen.getByLabelText(/global — colaboração/i)
    fireEvent.click(rowGlobalCheckbox)
    fireEvent.click(screen.getByLabelText('Comercial'))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/categories/c1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ global: false, sectorIds: ['s1'] }) }),
      ),
    )
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/CategoriesSection.test.tsx
```

Expected: FAIL — nenhum dos elementos novos (acordeões, checkbox Global) existe ainda.

- [ ] **Step 3: Reescrever `apps/web/src/pages/admin/CategoriesSection.tsx` por completo**

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CategoryDTO, SectorDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls, groupBySectorMulti, SectorAccordion, SectorChecklist } from './shared'

// ----- Linha de categoria (Global + setores editáveis inline) -----
function CategoryRow({
  category,
  sectors,
  onToggleActive,
  onChangeScope,
}: {
  category: CategoryDTO
  sectors: SectorDTO[]
  onToggleActive: (id: string, active: boolean) => void
  onChangeScope: (id: string, global: boolean, sectorIds: string[]) => void
}) {
  const [sectorIds, setSectorIds] = useState<Set<string>>(new Set(category.sectorIds))

  function toggleGlobal() {
    const nextGlobal = !category.global
    if (nextGlobal) {
      onChangeScope(category.id, true, [])
    } else {
      onChangeScope(category.id, false, [...sectorIds])
    }
  }

  function toggleSector(sectorId: string) {
    const next = new Set(sectorIds)
    if (next.has(sectorId)) next.delete(sectorId)
    else next.add(sectorId)
    setSectorIds(next)
    onChangeScope(category.id, false, [...next])
  }

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="flex items-center justify-between">
        <span className={category.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>{category.name}</span>
        <button
          onClick={() => onToggleActive(category.id, !category.active)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {category.active ? 'Desativar' : 'Ativar'}
        </button>
      </div>
      <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
        <input type="checkbox" aria-label={`Global — ${category.name}`} checked={category.global} onChange={toggleGlobal} />
        Global
      </label>
      {!category.global && (
        <SectorChecklist sectors={sectors} selected={sectorIds} onToggle={toggleSector} />
      )}
    </li>
  )
}

export function CategoriesSection() {
  const queryClient = useQueryClient()
  const [categoryName, setCategoryName] = useState('')
  const [newGlobal, setNewGlobal] = useState(true)
  const [newSectorIds, setNewSectorIds] = useState<Set<string>>(new Set())
  const [catError, setCatError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => apiFetch<{ categories: CategoryDTO[] }>('/admin/categories'),
  })
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const createCategory = useMutation({
    mutationFn: (body: { name: string; global: boolean; sectorIds?: string[] }) =>
      apiFetch<{ category: CategoryDTO }>('/admin/categories', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setCategoryName('')
      setNewGlobal(true)
      setNewSectorIds(new Set())
      setCatError(null)
      setShowForm(false)
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] })
    },
    onError: (err) => setCatError(err instanceof ApiError ? err.message : 'Erro ao criar categoria.'),
  })
  const toggleCategory = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      apiFetch<{ category: CategoryDTO }>(`/admin/categories/${vars.id}`, { method: 'PATCH', body: JSON.stringify({ active: vars.active }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  })
  const changeScope = useMutation({
    mutationFn: (vars: { id: string; global: boolean; sectorIds: string[] }) =>
      apiFetch<{ category: CategoryDTO }>(`/admin/categories/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.global ? { global: true } : { global: false, sectorIds: vars.sectorIds }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  })
  const categories = categoriesQuery.data?.categories ?? []
  const sectors = sectorsQuery.data?.sectors ?? []

  function handleCreateCategory(event: FormEvent) {
    event.preventDefault()
    if (!categoryName.trim()) return
    createCategory.mutate({ name: categoryName.trim(), global: newGlobal, sectorIds: newGlobal ? undefined : [...newSectorIds] })
  }

  function toggleNewSector(sectorId: string) {
    const next = new Set(newSectorIds)
    if (next.has(sectorId)) next.delete(sectorId)
    else next.add(sectorId)
    setNewSectorIds(next)
  }

  return (
    <Panel
      title="Categorias"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Adicionar categoria'}
        </button>
      }
    >
      {showForm && (
        <form onSubmit={handleCreateCategory} className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
          <div className="flex gap-sm">
            <input
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              aria-label="Nova categoria"
              placeholder="Nova categoria"
              className={`${inputCls} flex-1`}
            />
            <button type="submit" className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container">
              Adicionar
            </button>
          </div>
          <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
            <input type="checkbox" aria-label="Global" checked={newGlobal} onChange={() => setNewGlobal((v) => !v)} />
            Global
          </label>
          {!newGlobal && <SectorChecklist sectors={sectors} selected={newSectorIds} onToggle={toggleNewSector} />}
        </form>
      )}
      {catError && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {catError}
        </p>
      )}
      <div className="flex flex-col gap-sm">
        {groupBySectorMulti(categories, sectors).map((group) => (
          <SectorAccordion key={group.key} name={group.name} count={group.items.length}>
            <ul className="flex flex-col gap-2">
              {group.items.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  sectors={sectors}
                  onToggleActive={(id, active) => toggleCategory.mutate({ id, active })}
                  onChangeScope={(id, global, sectorIds) => changeScope.mutate({ id, global, sectorIds })}
                />
              ))}
            </ul>
          </SectorAccordion>
        ))}
      </div>
    </Panel>
  )
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/CategoriesSection.test.tsx
```

Expected: PASS (todos os testes, incluindo os 4 novos/reescritos).

- [ ] **Step 5: Rodar o typecheck**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Expected: erros restantes só em `BadgesSection.tsx` (Task 10).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/CategoriesSection.tsx apps/web/src/pages/admin/CategoriesSection.test.tsx
git commit -m "feat(web): CategoriesSection com Global/setores e agrupamento"
```

---

## Task 10: Frontend — `BadgesSection.tsx` com Global/setores, agrupamento, e troca pra `/admin/badges`

**Files:**
- Modify: `apps/web/src/pages/admin/BadgesSection.tsx`
- Modify: `apps/web/src/pages/admin/BadgesSection.test.tsx`

**Interfaces:**
- Consumes: `groupBySectorMulti`, `SectorAccordion`, `SectorChecklist` (Task 8); `GET /admin/badges` (Task 7); `CategoryDTO`/`BadgeDTO` com `global`/`sectorIds` (Task 2).

- [ ] **Step 1: Atualizar os mocks em `apps/web/src/pages/admin/BadgesSection.test.tsx`**

Troque o bloco `if (path === '/badges' && !method) {...}` dentro de `setupFetch()` por:

```ts
    if (path === '/admin/badges' && !method) {
      return Promise.resolve({
        badges: [{ id: 'b1', slug: 'conector', name: 'Conector do Time', description: '5 votos em Colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', global: true, sectorIds: [] }],
      })
    }
    if (path === '/admin/sectors' && !method) {
      return Promise.resolve({ sectors: [] })
    }
```

Em cada objeto de selo já existente no restante do arquivo (dentro de `/admin/users/u9/badges` GET/POST e no `describe('BadgesSection — atribuição manual', ...)`), adicione `global: true, sectorIds: []` aos badges embutidos, para bater com o novo shape de `BadgeDTO`. Ex.: o badge dentro de `/admin/users/u9/badges` GET vira:

```ts
    if (path === '/admin/users/u9/badges' && !method) {
      return Promise.resolve({
        badges: [
          { id: 'ub1', badge: { id: 'b1', slug: 'conector', name: 'Conector do Time', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', global: true, sectorIds: [] }, awardedAt: '2026-06-01T00:00:00.000Z', source: 'MANUAL', awardedBy: { id: 'a1', name: 'Admin' } },
        ],
      })
    }
```

(mesmo ajuste no bloco POST logo abaixo dele).

- [ ] **Step 2: Adicionar os testes novos ao final do arquivo, dentro de um novo describe**

```tsx
describe('BadgesSection — global/setores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/admin/badges' && !method) {
        return Promise.resolve({
          badges: [
            { id: 'b1', slug: 'global-badge', name: 'Selo Global', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, categorySlug: null, global: true, sectorIds: [] },
            { id: 'b2', slug: 'setor-badge', name: 'Selo Comercial', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, categorySlug: null, global: false, sectorIds: ['s1'] },
          ],
        })
      }
      if (path === '/admin/sectors' && !method) {
        return Promise.resolve({ sectors: [{ id: 's1', name: 'Comercial', slug: 'comercial', active: true, enabledFeatures: [], roles: [] }] })
      }
      if (path === '/admin/users' && !method) return Promise.resolve({ users: [] })
      if (path === '/admin/categories' && !method) return Promise.resolve({ categories: [] })
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })
  })

  it('busca o catálogo em /admin/badges (não em /badges)', async () => {
    renderSection()
    await screen.findByRole('button', { name: /global \(1\)/i })
    expect(mockApiFetch).toHaveBeenCalledWith('/admin/badges')
    expect(mockApiFetch).not.toHaveBeenCalledWith('/badges')
  })

  it('agrupa selos em Global e por setor, recolhido por padrão', async () => {
    renderSection()
    const globalToggle = await screen.findByRole('button', { name: /global \(1\)/i })
    const sectorToggle = screen.getByRole('button', { name: /comercial \(1\)/i })
    expect(screen.queryByText('Selo Global')).not.toBeInTheDocument()
    fireEvent.click(globalToggle)
    expect(screen.getByText('Selo Global')).toBeInTheDocument()
    fireEvent.click(sectorToggle)
    expect(screen.getByText('Selo Comercial')).toBeInTheDocument()
  })

  it('envia global/sectorIds ao criar um selo específico de setor', async () => {
    renderSection()
    await screen.findByRole('button', { name: /global \(1\)/i })
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar selo' }))
    fireEvent.change(screen.getByLabelText('Nome do selo'), { target: { value: 'Novo Selo' } })
    fireEvent.change(screen.getByLabelText('Descrição do selo'), { target: { value: 'Descrição' } })
    fireEvent.click(screen.getByLabelText(/^global$/i))
    fireEvent.click(screen.getByLabelText('Comercial'))
    fireEvent.click(screen.getByRole('button', { name: 'Criar selo' }))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/admin/badges', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/badges' && c[1]?.method === 'POST')![1] as RequestInit).body as string)
    expect(body.global).toBe(false)
    expect(body.sectorIds).toEqual(['s1'])
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/BadgesSection.test.tsx
```

Expected: FAIL — `BadgesSection` ainda busca `/badges`, não tem checkbox Global nem agrupamento.

- [ ] **Step 4: Editar `apps/web/src/pages/admin/BadgesSection.tsx` — trocar a query do catálogo**

Troque:

```ts
  const badgesQuery = useQuery({
    queryKey: ["admin", "badges"],
    queryFn: () => apiFetch<{ badges: BadgeDTO[] }>("/badges"),
  });
```

por:

```ts
  const badgesQuery = useQuery({
    queryKey: ["admin", "badges"],
    queryFn: () => apiFetch<{ badges: BadgeDTO[] }>("/admin/badges"),
  });
  const sectorsQuery = useQuery({
    queryKey: ["admin", "sectors"],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>("/admin/sectors"),
  });
```

- [ ] **Step 5: Importar `SectorDTO`, `groupBySectorMulti`/`SectorAccordion`/`SectorChecklist`**

Troque:

```ts
import type {
  AwardedBadgeDTO,
  BadgeDTO,
  CategoryDTO,
  PublicUser,
} from "@legends/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { BadgeEmblem } from "../../components/BadgeEmblem";
import { BadgeArtPicker } from "../../components/BadgeArtPicker";
import { DEFAULT_ART_KEY } from "../../lib/badge-art";
import { Panel, inputCls } from "./shared";
import { Select } from "../../components/Select";
```

por:

```ts
import type {
  AwardedBadgeDTO,
  BadgeDTO,
  CategoryDTO,
  PublicUser,
  SectorDTO,
} from "@legends/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { BadgeEmblem } from "../../components/BadgeEmblem";
import { BadgeArtPicker } from "../../components/BadgeArtPicker";
import { DEFAULT_ART_KEY } from "../../lib/badge-art";
import { Panel, inputCls, groupBySectorMulti, SectorAccordion, SectorChecklist } from "./shared";
import { Select } from "../../components/Select";
```

- [ ] **Step 6: Estender `emptyBadge`/`badgeForm` com `global`/`sectorIds`**

Troque:

```ts
  const emptyBadge = {
    name: "",
    description: "",
    kind: "IMPACT" as BadgeKind,
    iconKey: DEFAULT_ART_KEY,
    threshold: 5,
    categorySlug: "",
  };
  const [badgeForm, setBadgeForm] = useState(emptyBadge);
```

por:

```ts
  const emptyBadge = {
    name: "",
    description: "",
    kind: "IMPACT" as BadgeKind,
    iconKey: DEFAULT_ART_KEY,
    threshold: 5,
    categorySlug: "",
    global: true,
    sectorIds: [] as string[],
  };
  const [badgeForm, setBadgeForm] = useState(emptyBadge);
```

- [ ] **Step 7: Popular `global`/`sectorIds` ao editar um selo existente**

Troque:

```ts
  function startBadgeEdit(badge: BadgeDTO) {
    setEditingBadgeId(badge.id);
    setBadgeError(null);
    setShowForm(true);
    setBadgeForm({
      name: badge.name,
      description: badge.description,
      kind: badge.kind,
      iconKey: badge.iconKey,
      threshold: badge.threshold,
      categorySlug: badge.categorySlug ?? "",
    });
  }
```

por:

```ts
  function startBadgeEdit(badge: BadgeDTO) {
    setEditingBadgeId(badge.id);
    setBadgeError(null);
    setShowForm(true);
    setBadgeForm({
      name: badge.name,
      description: badge.description,
      kind: badge.kind,
      iconKey: badge.iconKey,
      threshold: badge.threshold,
      categorySlug: badge.categorySlug ?? "",
      global: badge.global,
      sectorIds: badge.sectorIds,
    });
  }
```

- [ ] **Step 8: Incluir `global`/`sectorIds` no payload de submit**

Troque:

```ts
    const payload = {
      name: badgeForm.name.trim(),
      description: badgeForm.description.trim(),
      kind: badgeForm.kind,
      iconKey: badgeForm.iconKey.trim(),
      threshold: Number(badgeForm.threshold) || 0,
      categorySlug:
        badgeForm.kind === "CATEGORY" ? badgeForm.categorySlug || null : null,
    };
```

por:

```ts
    const payload = {
      name: badgeForm.name.trim(),
      description: badgeForm.description.trim(),
      kind: badgeForm.kind,
      iconKey: badgeForm.iconKey.trim(),
      threshold: Number(badgeForm.threshold) || 0,
      categorySlug:
        badgeForm.kind === "CATEGORY" ? badgeForm.categorySlug || null : null,
      global: badgeForm.global,
      sectorIds: badgeForm.global ? undefined : badgeForm.sectorIds,
    };
```

- [ ] **Step 9: Adicionar o checkbox Global + `SectorChecklist` no formulário (logo depois do bloco `{badgeForm.kind === "CATEGORY" && (...)}`, ainda dentro do `<div className="grid gap-sm sm:grid-cols-2">`)**

Troque:

```tsx
              {badgeForm.kind === "CATEGORY" && (
                <Select
                  ariaLabel="Categoria do selo"
                  placeholder="Selecione a categoria…"
                  className="sm:col-span-2"
                  value={badgeForm.categorySlug}
                  options={categories.map((c) => ({ value: c.slug, label: c.name }))}
                  onChange={(next) =>
                    setBadgeForm({ ...badgeForm, categorySlug: next })
                  }
                />
              )}
            </div>
```

por:

```tsx
              {badgeForm.kind === "CATEGORY" && (
                <Select
                  ariaLabel="Categoria do selo"
                  placeholder="Selecione a categoria…"
                  className="sm:col-span-2"
                  value={badgeForm.categorySlug}
                  options={categories.map((c) => ({ value: c.slug, label: c.name }))}
                  onChange={(next) =>
                    setBadgeForm({ ...badgeForm, categorySlug: next })
                  }
                />
              )}
            </div>
            <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
              <input
                type="checkbox"
                aria-label="Global"
                checked={badgeForm.global}
                onChange={() => setBadgeForm({ ...badgeForm, global: !badgeForm.global })}
              />
              Global
            </label>
            {!badgeForm.global && (
              <SectorChecklist
                sectors={sectors}
                selected={new Set(badgeForm.sectorIds)}
                onToggle={(sectorId) => {
                  const next = new Set(badgeForm.sectorIds);
                  if (next.has(sectorId)) next.delete(sectorId);
                  else next.add(sectorId);
                  setBadgeForm({ ...badgeForm, sectorIds: [...next] });
                }}
              />
            )}
```

Adicione `const sectors = sectorsQuery.data?.sectors ?? [];` junto de `const categories = categoriesQuery.data?.categories ?? [];` (mesma linha de bloco, logo abaixo).

- [ ] **Step 10: Agrupar a listagem do catálogo por Global/setor**

Troque:

```tsx
        <ul className="grid gap-2 sm:grid-cols-2">
          {badges.map((badge) => (
            <li
              key={badge.id}
              className="flex items-start gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
            >
              <BadgeEmblem badge={badge} size={40} />
              <div className="min-w-0 flex-grow">
                <p className="font-label text-label-md text-on-surface">
                  {badge.name}
                </p>
                <p className="truncate text-body-sm text-on-surface-variant">
                  {badge.description}
                </p>
                <p className="mt-1 font-label text-label-sm text-on-surface-variant">
                  {badge.kind} · limiar {badge.threshold}
                  {badge.categorySlug ? ` · ${badge.categorySlug}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-sm">
                <button
                  onClick={() => startBadgeEdit(badge)}
                  aria-label={`Editar selo ${badge.name}`}
                  className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                >
                  <Icon name="edit" className="text-[18px]" />
                </button>
                <button
                  onClick={() => deleteBadge.mutate(badge.id)}
                  aria-label={`Excluir selo ${badge.name}`}
                  className="rounded-md border border-error/40 p-1 text-error transition-colors hover:border-error"
                >
                  <Icon name="delete" className="text-[18px]" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
```

por:

```tsx
        <div className="flex flex-col gap-sm">
          {groupBySectorMulti(badges, sectors).map((group) => (
            <SectorAccordion key={group.key} name={group.name} count={group.items.length}>
              <ul className="grid gap-2 sm:grid-cols-2">
                {group.items.map((badge) => (
                  <li
                    key={badge.id}
                    className="flex items-start gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
                  >
                    <BadgeEmblem badge={badge} size={40} />
                    <div className="min-w-0 flex-grow">
                      <p className="font-label text-label-md text-on-surface">
                        {badge.name}
                      </p>
                      <p className="truncate text-body-sm text-on-surface-variant">
                        {badge.description}
                      </p>
                      <p className="mt-1 font-label text-label-sm text-on-surface-variant">
                        {badge.kind} · limiar {badge.threshold}
                        {badge.categorySlug ? ` · ${badge.categorySlug}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-sm">
                      <button
                        onClick={() => startBadgeEdit(badge)}
                        aria-label={`Editar selo ${badge.name}`}
                        className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                      >
                        <Icon name="edit" className="text-[18px]" />
                      </button>
                      <button
                        onClick={() => deleteBadge.mutate(badge.id)}
                        aria-label={`Excluir selo ${badge.name}`}
                        className="rounded-md border border-error/40 p-1 text-error transition-colors hover:border-error"
                      >
                        <Icon name="delete" className="text-[18px]" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </SectorAccordion>
          ))}
        </div>
      </Panel>
```

- [ ] **Step 11: Rodar de novo e confirmar que passa**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/BadgesSection.test.tsx
```

Expected: PASS (todos os testes, incluindo os 3 novos).

- [ ] **Step 12: Rodar o typecheck do workspace web**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Expected: limpo.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/pages/admin/BadgesSection.tsx apps/web/src/pages/admin/BadgesSection.test.tsx
git commit -m "feat(web): BadgesSection com Global/setores, agrupamento e GET /admin/badges"
```

---

## Task 11: Verificação final

**Files:** nenhum (só verificação)

**Interfaces:** nenhuma — task de fechamento do plano.

- [ ] **Step 1: Typecheck dos três workspaces**

```bash
pnpm --filter @legends/shared exec tsc --noEmit
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
```

Expected: os três limpos.

- [ ] **Step 2: Suíte completa da API**

```bash
pnpm --filter @legends/api test
```

Expected: todos os testes passam.

- [ ] **Step 3: Suíte completa do shared**

```bash
pnpm --filter @legends/shared test
```

Expected: todos os testes passam.

- [ ] **Step 4: Suíte completa do web**

```bash
pnpm --filter @legends/web test
```

Expected: todos os testes passam. Se aparecerem exatamente 2 erros "Worker exited unexpectedly" (tinypool) sem nenhuma linha `FAIL`, é um flake de infraestrutura pré-existente já documentado neste repo (não relacionado a este plano) — confirme rodando `grep FAIL` na saída antes de investigar mais.

- [ ] **Step 5: Revisão manual do payload de auditoria**

Abra a tela de Auditoria do admin (`/admin/auditoria`) depois de criar/editar uma categoria e um selo específicos de setor durante os testes manuais, e confirme visualmente que o `before`/`after` mostra `sectorIds` corretamente no diff.

- [ ] **Step 6: Commit final (se sobrar algo solto)**

```bash
git status
```

Se não houver nada para commitar, este plano está completo.
