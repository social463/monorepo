# Selo de Tempo de Casa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conceder selos acumulativos de tempo de casa (1, 2, 3, 4 anos) no aniversário de entrada na equipe, derivados de `User.joinedAt`, avaliados de forma preguiçosa ao abrir o perfil.

**Architecture:** Novo `BadgeKind = 'TENURE'` reaproveita `Badge.threshold` como "anos exigidos". Um helper puro calcula anos completos; um avaliador dedicado (`evaluateTenureBadgesForUser`) concede os selos que o usuário já atingiu (somente aditivo). O gatilho é a rota `GET /users/:id/profile`, que reavalia o dono do perfil e notifica via `notifyBadgesEarned`. Catálogo e progresso reusam a infra existente de `getBadgeCatalog`.

**Tech Stack:** Fastify 4, Prisma 5 + PostgreSQL, TypeScript ESM, Vitest (Postgres real), `@legends/shared`.

## Global Constraints

- TypeScript **strict**, ESM puro; código novo segue o padrão da camada vizinha (route fina → service → Prisma).
- Mensagens voltadas ao usuário em **português**.
- **Nunca editar migration já aplicada** — gerar nova via `prisma migrate dev`.
- Contrato compartilhado muda **primeiro** em `@legends/shared` (`packages/shared`).
- Avaliação de selos é **best-effort**: falha logada, nunca derruba a request.
- Testes da API exigem Postgres de pé (`pnpm db:up`); `test/setup.ts` trunca todas as tabelas em `beforeEach`, então cada teste cria seus próprios fixtures.
- Concessão de `UserBadge` trata `P2002` (corrida) silenciosamente, como no código existente.

---

### Task 1: Helper puro `completedYears`

Calcula quantos anos completos se passaram entre a data de entrada e "agora", contando um ano só depois que o aniversário (mês/dia) já passou. Função pura, sem banco — base para qualificação e progresso.

**Files:**
- Modify: `apps/api/src/services/badge-service.ts` (adicionar export no topo, após os imports)
- Test: `apps/api/src/services/badge-service.test.ts` (novo `describe`)

**Interfaces:**
- Produces: `export function completedYears(joinedAt: Date, now: Date): number`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `apps/api/src/services/badge-service.test.ts`, e incluir `completedYears` no import existente de `./badge-service` (linha 4-11):

```ts
describe('completedYears', () => {
  it('conta 0 antes do primeiro aniversário', () => {
    expect(completedYears(new Date('2025-06-18'), new Date('2026-06-17'))).toBe(0)
  })
  it('conta 1 no dia exato do aniversário', () => {
    expect(completedYears(new Date('2025-06-18'), new Date('2026-06-18'))).toBe(1)
  })
  it('conta 3 anos completos', () => {
    expect(completedYears(new Date('2023-01-10'), new Date('2026-06-18'))).toBe(3)
  })
  it('não conta o ano quando ainda falta o mês', () => {
    expect(completedYears(new Date('2024-12-31'), new Date('2026-06-18'))).toBe(1)
  })
  it('29/fev só vira aniversário em 01/mar de ano não-bissexto', () => {
    expect(completedYears(new Date('2024-02-29'), new Date('2026-02-28'))).toBe(1)
    expect(completedYears(new Date('2024-02-29'), new Date('2026-03-01'))).toBe(2)
  })
  it('nunca retorna negativo', () => {
    expect(completedYears(new Date('2030-01-01'), new Date('2026-06-18'))).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- badge-service`
Expected: FAIL — `completedYears is not a function` / import inexistente.

- [ ] **Step 3: Implementar o helper**

Em `apps/api/src/services/badge-service.ts`, logo após os imports (após a linha 3):

```ts
/** Anos completos entre joinedAt e now — o aniversário (mês/dia) precisa já ter passado. */
export function completedYears(joinedAt: Date, now: Date): number {
  let years = now.getFullYear() - joinedAt.getFullYear()
  const monthDiff = now.getMonth() - joinedAt.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < joinedAt.getDate())) {
    years -= 1
  }
  return Math.max(0, years)
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- badge-service`
Expected: PASS (o novo `describe('completedYears')` verde).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts
git commit -m "feat(api): helper completedYears para tempo de casa"
```

---

### Task 2: Tipo `TENURE` no contrato e no schema

Adiciona o novo valor de enum em Prisma (com migration) e em `@legends/shared`. Sem isso, `'TENURE'` não é um literal válido do tipo `BadgeKind` e o TypeScript recusa as próximas tasks.

**Files:**
- Modify: `packages/shared/src/enums.ts:12`
- Modify: `apps/api/prisma/schema.prisma:27-33` (enum `BadgeKind`)
- Create: `apps/api/prisma/migrations/<timestamp>_add_tenure_badge_kind/migration.sql` (gerada pelo Prisma)

**Interfaces:**
- Produces: `BADGE_KINDS` passa a incluir `'TENURE'`; tipo Prisma `BadgeKind` aceita `'TENURE'`.

- [ ] **Step 1: Atualizar o contrato compartilhado**

Em `packages/shared/src/enums.ts`, linha 12:

```ts
export const BADGE_KINDS = ['CATEGORY', 'RECURRENCE', 'IMPACT', 'HIGHLIGHT', 'FEEDBACK', 'TENURE'] as const
```

- [ ] **Step 2: Atualizar o enum do Prisma**

Em `apps/api/prisma/schema.prisma`, no enum `BadgeKind`:

```prisma
enum BadgeKind {
  CATEGORY
  RECURRENCE
  IMPACT
  HIGHLIGHT
  FEEDBACK
  TENURE
}
```

- [ ] **Step 3: Gerar e aplicar a migration**

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev --name add_tenure_badge_kind`
Expected: cria `apps/api/prisma/migrations/<timestamp>_add_tenure_badge_kind/` com `ALTER TYPE "BadgeKind" ADD VALUE 'TENURE';`, aplica no banco e regenera o Prisma Client.

- [ ] **Step 4: Build do shared (consumidores usam o compilado)**

Run: `pnpm --filter @legends/shared build`
Expected: build sem erros.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/enums.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(shared,api): adiciona BadgeKind TENURE"
```

---

### Task 3: Avaliador `evaluateTenureBadgesForUser`

Concede, de forma somente aditiva e idempotente, os selos `TENURE` cujo threshold (anos) o usuário já atingiu. Aceita `now` injetável para testes.

**Files:**
- Modify: `apps/api/src/services/badge-service.ts` (nova função exportada)
- Test: `apps/api/src/services/badge-service.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `completedYears` (Task 1); enum `TENURE` (Task 2).
- Produces: `export async function evaluateTenureBadgesForUser(userId: string, now?: Date): Promise<UserBadge[]>`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `apps/api/src/services/badge-service.test.ts` (e incluir `evaluateTenureBadgesForUser` no import de `./badge-service`). Helper local de criação de selo de tempo de casa + os testes:

```ts
async function makeTenureBadge(years: number) {
  return prisma.badge.create({
    data: {
      slug: `tempo-de-casa-${years}`,
      name: `${years} ano(s) de casa`,
      description: `${years} anos de equipe`,
      kind: 'TENURE',
      iconKey: 'fe-medal-bronze',
      threshold: years,
    },
  })
}

describe('evaluateTenureBadgesForUser', () => {
  it('concede todos os níveis já atingidos, acumulando', async () => {
    const user = await prisma.user.create({
      data: { name: 'Tempo', email: `tempo-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2023-01-01') },
    })
    await makeTenureBadge(1)
    await makeTenureBadge(2)
    await makeTenureBadge(3)
    await makeTenureBadge(4)

    const awarded = await evaluateTenureBadgesForUser(user.id, new Date('2026-06-18'))
    expect(awarded).toHaveLength(3) // 1, 2 e 3 anos; ainda não 4
  })

  it('não concede quando ainda não completou 1 ano', async () => {
    const user = await prisma.user.create({
      data: { name: 'Novato', email: `novato-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2026-01-01') },
    })
    await makeTenureBadge(1)
    expect(await evaluateTenureBadgesForUser(user.id, new Date('2026-06-18'))).toHaveLength(0)
  })

  it('é idempotente: não concede o mesmo selo duas vezes', async () => {
    const user = await prisma.user.create({
      data: { name: 'Veterano', email: `vet-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2024-01-01') },
    })
    await makeTenureBadge(1)
    expect(await evaluateTenureBadgesForUser(user.id, new Date('2026-06-18'))).toHaveLength(1)
    expect(await evaluateTenureBadgesForUser(user.id, new Date('2026-06-18'))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- badge-service`
Expected: FAIL — `evaluateTenureBadgesForUser is not a function`.

- [ ] **Step 3: Implementar a função**

Em `apps/api/src/services/badge-service.ts`, após `evaluateBadgesForUser` (após a linha 72):

```ts
/**
 * Concede os selos de tempo de casa (kind TENURE) que o usuário já atingiu.
 * Somente aditivo — nunca revoga. `now` é injetável para testes.
 */
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
  const ownedIds = new Set(owned.map((entry) => entry.badgeId))
  const years = completedYears(user.joinedAt, now)

  const newlyAwarded: UserBadge[] = []
  for (const badge of tenureBadges) {
    if (ownedIds.has(badge.id)) continue
    if (years < badge.threshold) continue
    try {
      newlyAwarded.push(await prisma.userBadge.create({ data: { userId, badgeId: badge.id } }))
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // concorrência: já concedido, ignora
      } else {
        throw err
      }
    }
  }
  return newlyAwarded
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- badge-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts
git commit -m "feat(api): evaluateTenureBadgesForUser concede selos de tempo de casa"
```

---

### Task 4: Catálogo e progresso para `TENURE`

Faz os selos de tempo de casa aparecerem no catálogo (`getBadgeCatalog`) com requisito legível e barra de progresso baseada em anos completos.

**Files:**
- Modify: `apps/api/src/services/badge-service.ts` (`buildRequirement` linha ~160, `computeProgress` linha ~177)
- Test: `apps/api/src/services/badge-service.test.ts` (novo teste no `describe('badge service')`)

**Interfaces:**
- Consumes: `completedYears` (Task 1); enum `TENURE` (Task 2).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao `describe('badge service')` em `apps/api/src/services/badge-service.test.ts` (garantir que `getBadgeCatalog` já está importado — está):

```ts
it('catálogo mostra requisito e progresso do selo de tempo de casa', async () => {
  const user = await prisma.user.create({
    data: { name: 'Casa', email: `casa-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2024-01-01') },
  })
  await prisma.badge.create({
    data: { slug: 'tempo-de-casa-3-anos', name: '3 anos de casa', description: '3 anos', kind: 'TENURE', iconKey: 'fe-medal-gold', threshold: 3 },
  })

  const catalog = await getBadgeCatalog(user.id)
  const entry = catalog.find((e) => e.badge.slug === 'tempo-de-casa-3-anos')
  expect(entry?.requirement).toBe('Complete 3 anos na equipe')
  expect(entry?.progress?.target).toBe(3)
  expect(typeof entry?.progress?.current).toBe('number')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- badge-service`
Expected: FAIL — `requirement` vem `''` e `progress` vem `null` (TENURE cai no default).

- [ ] **Step 3: Implementar requisito e progresso**

Em `buildRequirement` (`apps/api/src/services/badge-service.ts`), adicionar um `case` antes do `default`:

```ts
    case 'TENURE':
      return `Complete ${badge.threshold} ${badge.threshold === 1 ? 'ano' : 'anos'} na equipe`
```

Em `computeProgress`, adicionar um `case` antes de `case 'HIGHLIGHT'`:

```ts
    case 'TENURE': {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { joinedAt: true } })
      return { current: user ? completedYears(user.joinedAt, new Date()) : 0, target }
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- badge-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts
git commit -m "feat(api): catálogo e progresso para selos de tempo de casa"
```

---

### Task 5: Gatilho na rota de perfil + notificação

Liga a avaliação preguiçosa: ao abrir `GET /users/:id/profile`, reavalia os selos de tempo de casa do dono do perfil e notifica os recém-concedidos. Best-effort.

**Files:**
- Modify: `apps/api/src/routes/profile.ts:1-41`
- Test: `apps/api/src/routes/profile.test.ts` (novo teste)

**Interfaces:**
- Consumes: `evaluateTenureBadgesForUser` (Task 3); `notifyBadgesEarned(userId, badgeIds)` de `../services/notification-service`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao `describe('profile routes')` em `apps/api/src/routes/profile.test.ts`:

```ts
it('concede selo de tempo de casa ao abrir o perfil', async () => {
  const { app, token } = await setup()
  const veterano = await prisma.user.create({
    data: { name: 'Veterano', email: 'veterano@empresa.com', passwordHash: 'x', joinedAt: new Date('2023-01-01') },
  })
  await prisma.badge.create({
    data: { slug: 'tempo-de-casa-1-ano', name: '1 ano de casa', description: '1 ano', kind: 'TENURE', iconKey: 'fe-medal-bronze', threshold: 1 },
  })

  const res = await app.inject({ method: 'GET', url: `/users/${veterano.id}/profile`, headers: { authorization: `Bearer ${token}` } })
  expect(res.statusCode).toBe(200)
  const slugs = res.json().badges.map((b: { badge: { slug: string } }) => b.badge.slug)
  expect(slugs).toContain('tempo-de-casa-1-ano')
  await app.close()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- profile`
Expected: FAIL — `badges` não contém `tempo-de-casa-1-ano` (selo não concedido).

- [ ] **Step 3: Implementar o gatilho**

Em `apps/api/src/routes/profile.ts`:

Atualizar o import da linha 4:
```ts
import { evaluateTenureBadgesForUser, listBadgesForUser } from '../services/badge-service'
```

Adicionar import do serviço de notificação (após a linha 5):
```ts
import { notifyBadgesEarned } from '../services/notification-service'
```

No handler de `GET /users/:id/profile`, entre a checagem de `!profile` e `const badges = ...` (entre as linhas 29 e 30), inserir:
```ts
    // Avaliação preguiçosa dos selos de tempo de casa: best-effort, nunca derruba o perfil.
    try {
      const awarded = await evaluateTenureBadgesForUser(id)
      if (awarded.length > 0) {
        await notifyBadgesEarned(id, awarded.map((b) => b.badgeId))
      }
    } catch (err) {
      request.log.error(err)
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- profile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/profile.ts apps/api/src/routes/profile.test.ts
git commit -m "feat(api): perfil concede e notifica selos de tempo de casa"
```

---

### Task 6: Seed dos 4 selos de tempo de casa

Cria os selos 1–4 anos de forma idempotente para dev/produção (`pnpm db:seed`).

**Files:**
- Modify: `apps/api/prisma/seed.ts`

**Interfaces:**
- Consumes: enum `TENURE` (Task 2).

- [ ] **Step 1: Adicionar os selos ao seed**

Em `apps/api/prisma/seed.ts`, dentro de `main()`, após o loop `for (const l of leads)` e antes do `console.log` final:

```ts
  // Selos de tempo de casa (acumulativos por aniversário de entrada na equipe).
  const tenureBadges = [
    { slug: "tempo-de-casa-1-ano", name: "1 ano de casa", threshold: 1, iconKey: "fe-medal-bronze" },
    { slug: "tempo-de-casa-2-anos", name: "2 anos de casa", threshold: 2, iconKey: "fe-medal-silver" },
    { slug: "tempo-de-casa-3-anos", name: "3 anos de casa", threshold: 3, iconKey: "fe-medal-gold" },
    { slug: "tempo-de-casa-4-anos", name: "4 anos de casa", threshold: 4, iconKey: "fe-crown" },
  ];
  for (const b of tenureBadges) {
    await prisma.badge.upsert({
      where: { slug: b.slug },
      update: {},
      create: {
        slug: b.slug,
        name: b.name,
        description: `Comemora ${b.threshold} ${b.threshold === 1 ? "ano" : "anos"} de equipe na EMR.`,
        kind: "TENURE",
        iconKey: b.iconKey,
        threshold: b.threshold,
      },
    });
  }
```

- [ ] **Step 2: Rodar o seed e conferir**

Run: `pnpm db:up && pnpm db:seed`
Expected: roda sem erro; rodar de novo não duplica (upsert por slug).

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(api): seed dos selos de tempo de casa (1-4 anos)"
```

---

### Task 7: Verificação final

- [ ] **Step 1: Suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os testes passam (API + web).

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: build de todos os workspaces sem erros de tipo (confirma que `TENURE` está coerente em shared + api).

---

## Notas de implementação

- **Front-end:** nenhuma mudança estrutural. A galeria/catálogo já renderiza selos genéricos por `iconKey`; os keys escolhidos (`fe-medal-bronze`, `fe-medal-silver`, `fe-medal-gold`, `fe-crown`) já existem em `apps/web/src/lib/badge-art.ts`. Admin pode trocar os ícones depois.
- **Produção:** os selos são criados pelo `db:seed` (idempotente) ou pela rota admin existente (`POST /admin/badges`). A migration de enum (`TENURE`) é obrigatória antes do seed.
- **Decisão (refino do spec §2.2):** o `qualifies()` da avaliação pós-voto **não** é alterado. Tenure tem avaliador dedicado (`evaluateTenureBadgesForUser`) acionado no perfil — entrega o mesmo resultado (concessão lazy + progresso no catálogo) sem onerar o hot-path de voto.
- **29/fev:** tratado pelo `completedYears` — em anos não-bissextos o aniversário conta a partir de 01/mar.
