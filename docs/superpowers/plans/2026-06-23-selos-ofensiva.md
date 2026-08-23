# Selos de ofensiva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma família de selos `STREAK` concedida automaticamente quando o recorde de ofensiva (`bestStreak`, em dias úteis) atinge marcos de 7/14/30/60 dias.

**Architecture:** Reutiliza o sistema de badges existente. Novo `BadgeKind = STREAK` (enum aditivo + migration). Um avaliador dedicado `evaluateStreakBadgesForUser` (espelhando `evaluateTenureBadgesForUser`) concede os níveis atingidos, disparado best-effort ao registrar o Humor do Dia. Catálogo e admin ganham suporte ao novo tipo. Sem mudança no painel/indicador da ofensiva.

**Tech Stack:** Fastify 4 + Prisma 5 + Zod (api), Vite 5 + React 18 (web), Vitest, `@legends/shared`.

## Global Constraints

- TypeScript **strict**, ESM puro.
- Fluxo backend route → service → Prisma; camadas finas; selos aditivos, **nunca revogam**.
- Critério do selo: `bestStreak >= threshold`, onde `bestStreak` vem de `getStreakSummary(userId, todayYmd?)` (já em dias úteis).
- 4 níveis (slug / nome / threshold / iconKey), descrição `"Seu recorde de ofensiva atingiu N dias úteis consecutivos."`:
  - `ofensiva-7-dias-uteis` / "Em chamas" / 7 / `fe-fire`
  - `ofensiva-14-dias-uteis` / "Imparável" / 14 / `fe-voltage`
  - `ofensiva-30-dias-uteis` / "Incandescente" / 30 / `fe-rocket`
  - `ofensiva-60-dias-uteis` / "Lendária" / 60 / `fe-crown`
- Concessão por avaliador dedicado (`evaluateStreakBadgesForUser`), **não** via `qualifies()` (caminho único, igual ao TENURE).
- Gatilho best-effort no `PUT /me/mood/today` (try/catch que loga e não derruba o registro).
- Migration **aditiva** (`ALTER TYPE "BadgeKind" ADD VALUE 'STREAK'`); nunca editar migration aplicada. Migrar contra o **DB local de dev** (`.env`), nunca HML.
- Testes Vitest `*.test.ts(x)` ao lado do código; API em **Postgres real** (`pnpm db:up`); `test/setup.ts` trunca tabelas por teste (selos semeados são apagados — testes criam os selos que precisam).
- Mensagens ao usuário em **português**.
- Rodar comandos da raiz: `/Users/luccasecco/Documents/projetos/engineering_legends`.

---

### Task 1: Enum `STREAK` + migration + admin schema + seed

Habilita `STREAK` como tipo de selo de ponta a ponta: contrato, banco, validação do admin e dados de produção (seed).

**Files:**
- Modify: `packages/shared/src/enums.ts:12` (adicionar `'STREAK'` a `BADGE_KINDS`)
- Modify: `apps/api/prisma/schema.prisma:27-34` (adicionar `STREAK` ao enum `BadgeKind`)
- Create: `apps/api/prisma/migrations/<timestamp>_add_streak_badge_kind/migration.sql` (gerada)
- Modify: `apps/api/src/routes/admin.ts:60` (adicionar `'STREAK'` ao `badgeKindSchema`)
- Modify: `apps/api/prisma/seed.ts` (bloco de selos de ofensiva, após o bloco de Tempo de Casa, linha ~200)
- Modify: `apps/api/src/routes/admin.test.ts` (teste de criação de selo STREAK)

**Interfaces:**
- Produces: `BadgeKind` agora inclui `'STREAK'`; rota `POST /admin/badges` aceita `kind: 'STREAK'`; seed cria os 4 selos.

- [ ] **Step 1: Escrever o teste que falha (admin cria selo STREAK)**

Adicionar este teste dentro do `describe('admin routes', ...)` em `apps/api/src/routes/admin.test.ts`:

```ts
  it('creates a STREAK badge as admin', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/badges',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Em chamas',
        description: 'Recorde de ofensiva de 7 dias úteis',
        kind: 'STREAK',
        iconKey: 'fe-fire',
        threshold: 7,
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().badge.kind).toBe('STREAK')
    await app.close()
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "STREAK"`
Expected: FAIL — `badgeKindSchema` rejeita `STREAK` → resposta 400 (não 201).

- [ ] **Step 3: Adicionar `STREAK` ao contrato e ao schema Prisma**

Em `packages/shared/src/enums.ts:12`, trocar a linha por:

```ts
export const BADGE_KINDS = ['CATEGORY', 'RECURRENCE', 'IMPACT', 'HIGHLIGHT', 'FEEDBACK', 'TENURE', 'STREAK'] as const
```

Em `apps/api/prisma/schema.prisma`, no enum `BadgeKind` (linhas 27-34), adicionar `STREAK` como último valor:

```prisma
enum BadgeKind {
  CATEGORY
  RECURRENCE
  IMPACT
  HIGHLIGHT
  FEEDBACK
  TENURE
  STREAK
}
```

- [ ] **Step 4: Gerar e aplicar a migration (DB local)**

Garanta que o `DATABASE_URL` do `apps/api/.env` aponta para o Postgres **local** de dev (não HML). Rode:

Run: `pnpm --filter @legends/api exec prisma migrate dev --name add_streak_badge_kind`
Expected: cria `migration.sql` com `ALTER TYPE "BadgeKind" ADD VALUE 'STREAK';`, aplica no DB local e regenera o Prisma Client.

- [ ] **Step 5: Aceitar `STREAK` no admin**

Em `apps/api/src/routes/admin.ts:60`, trocar a linha por (mantendo `HIGHLIGHT` de fora — é gerido pelo sistema):

```ts
const badgeKindSchema = z.enum(['CATEGORY', 'RECURRENCE', 'IMPACT', 'FEEDBACK', 'TENURE', 'STREAK'])
```

- [ ] **Step 6: Semear os 4 selos de ofensiva**

Em `apps/api/prisma/seed.ts`, logo após o `for` dos `tenureBadges` (linha ~200, antes do bloco `retroSquads`), inserir:

```ts
  const streakBadges = [
    { slug: "ofensiva-7-dias-uteis", name: "Em chamas", threshold: 7, iconKey: "fe-fire" },
    { slug: "ofensiva-14-dias-uteis", name: "Imparável", threshold: 14, iconKey: "fe-voltage" },
    { slug: "ofensiva-30-dias-uteis", name: "Incandescente", threshold: 30, iconKey: "fe-rocket" },
    { slug: "ofensiva-60-dias-uteis", name: "Lendária", threshold: 60, iconKey: "fe-crown" },
  ];
  for (const b of streakBadges) {
    await prisma.badge.upsert({
      where: { slug: b.slug },
      update: {},
      create: {
        slug: b.slug,
        name: b.name,
        description: `Seu recorde de ofensiva atingiu ${b.threshold} dias úteis consecutivos.`,
        kind: "STREAK",
        iconKey: b.iconKey,
        threshold: b.threshold,
      },
    });
  }
```

- [ ] **Step 7: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "STREAK"`
Expected: PASS (o `global-setup` aplica a nova migration no banco de teste via `migrate deploy`).

- [ ] **Step 8: Verificar o seed (idempotente) e o typecheck do contrato**

Run:
```bash
pnpm --filter @legends/api run db:seed
pnpm --filter @legends/shared exec tsc --noEmit
```
Expected: seed roda sem erro (cria/ignora os 4 selos); tsc do shared limpo.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/enums.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/routes/admin.ts apps/api/prisma/seed.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(badge): novo tipo STREAK (enum/migration/admin/seed) para selos de ofensiva"
```

---

### Task 2: `evaluateStreakBadgesForUser` + catálogo (requisito/progresso)

Avaliador dedicado que concede os selos `STREAK` pelo recorde, e os ramos `STREAK` do catálogo (requisito legível + progresso).

**Files:**
- Modify: `apps/api/src/services/badge-service.ts` (import + nova função + 2 ramos de switch)
- Create: `apps/api/src/services/badge-streak.test.ts`

**Interfaces:**
- Consumes: `getStreakSummary(userId, todayYmd?)` de `./streak-service`; `prisma`, `Prisma`, `UserBadge` (já importados).
- Produces:
  - `evaluateStreakBadgesForUser(userId: string, todayYmd?: string): Promise<UserBadge[]>`
  - `buildRequirement`/`computeProgress` passam a cobrir `kind: 'STREAK'` (usados por `getBadgeCatalog`).

- [ ] **Step 1: Escrever os testes que falham**

Create `apps/api/src/services/badge-streak.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { dayFromYmd } from '../lib/sao-paulo-date'
import { evaluateStreakBadgesForUser, getBadgeCatalog } from './badge-service'

async function makeUser(email: string): Promise<string> {
  const app = buildApp()
  await app.ready()
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email, password: 'changeme123' },
  })
  await app.close()
  const user = await prisma.user.findUniqueOrThrow({ where: { email } })
  return user.id
}

async function seedDays(userId: string, ymds: string[]) {
  await prisma.moodEntry.createMany({
    data: ymds.map((ymd) => ({ userId, mood: 'GOOD' as const, day: dayFromYmd(ymd) })),
  })
}

async function makeStreakBadge(slug: string, name: string, threshold: number) {
  return prisma.badge.create({
    data: { slug, name, description: 'x', kind: 'STREAK', iconKey: 'fe-fire', threshold },
  })
}

// 7 dias úteis consecutivos (ponte de fim de semana): 06-01..06-05 + 06-08, 06-09.
const SEVEN_BIZ = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-08', '2026-06-09']

describe('selos de ofensiva', () => {
  it('concede só os níveis cujo threshold <= bestStreak', async () => {
    const userId = await makeUser('a@empresa.com')
    await seedDays(userId, SEVEN_BIZ) // bestStreak = 7
    const b7 = await makeStreakBadge('ofensiva-7-dias-uteis', 'Em chamas', 7)
    await makeStreakBadge('ofensiva-14-dias-uteis', 'Imparável', 14)
    const awarded = await evaluateStreakBadgesForUser(userId)
    expect(awarded).toHaveLength(1)
    expect(awarded[0].badgeId).toBe(b7.id)
    const owned = await prisma.userBadge.findMany({ where: { userId } })
    expect(owned).toHaveLength(1)
    expect(owned[0].badgeId).toBe(b7.id)
  })

  it('é idempotente e não revoga ao rodar de novo', async () => {
    const userId = await makeUser('b@empresa.com')
    await seedDays(userId, SEVEN_BIZ)
    await makeStreakBadge('ofensiva-7-dias-uteis', 'Em chamas', 7)
    await evaluateStreakBadgesForUser(userId)
    const second = await evaluateStreakBadgesForUser(userId)
    expect(second).toHaveLength(0)
    expect(await prisma.userBadge.count({ where: { userId } })).toBe(1)
  })

  it('catálogo traz requisito e progresso do selo de ofensiva', async () => {
    const userId = await makeUser('c@empresa.com')
    await seedDays(userId, SEVEN_BIZ) // bestStreak = 7
    await makeStreakBadge('ofensiva-14-dias-uteis', 'Imparável', 14)
    const catalog = await getBadgeCatalog(userId)
    const entry = catalog.find((e) => e.badge.slug === 'ofensiva-14-dias-uteis')
    expect(entry?.requirement).toBe('Mantenha uma ofensiva de 14 dias úteis')
    expect(entry?.progress).toEqual({ current: 7, target: 14 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/badge-streak.test.ts`
Expected: FAIL — `evaluateStreakBadgesForUser` não existe; catálogo sem ramo STREAK (requirement vazio, progress null).

- [ ] **Step 3: Implementar o avaliador e os ramos do catálogo**

Em `apps/api/src/services/badge-service.ts`:

Adicionar o import (após `import type { BadgeProgress } from '@legends/shared'`):

```ts
import { getStreakSummary } from './streak-service'
```

Adicionar a função (após `evaluateTenureBadgesForUser`, antes de `evaluateTenureBadgesForAllUsers`):

```ts
/**
 * Concede os selos de ofensiva (kind STREAK) que o usuário já atingiu pelo recorde
 * (`bestStreak`, em dias úteis). Somente aditivo — nunca revoga. `todayYmd` é
 * repassado a getStreakSummary para testes determinísticos.
 */
export async function evaluateStreakBadgesForUser(
  userId: string,
  todayYmd?: string,
): Promise<UserBadge[]> {
  const [streakBadges, owned] = await Promise.all([
    prisma.badge.findMany({ where: { kind: 'STREAK' } }),
    prisma.userBadge.findMany({ where: { userId, periodId: null }, select: { badgeId: true } }),
  ])
  if (streakBadges.length === 0) return []
  const ownedIds = new Set(owned.map((entry) => entry.badgeId))
  const { bestStreak } = await getStreakSummary(userId, todayYmd)

  const newlyAwarded: UserBadge[] = []
  for (const badge of streakBadges) {
    if (ownedIds.has(badge.id)) continue
    if (bestStreak < badge.threshold) continue
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

No `switch` de `buildRequirement`, adicionar o caso (antes de `case 'HIGHLIGHT':`):

```ts
    case 'STREAK':
      return `Mantenha uma ofensiva de ${badge.threshold} ${badge.threshold === 1 ? 'dia útil' : 'dias úteis'}`
```

No `switch` de `computeProgress`, adicionar o caso (antes de `case 'HIGHLIGHT':`):

```ts
    case 'STREAK': {
      const { bestStreak } = await getStreakSummary(userId)
      return { current: bestStreak, target }
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/badge-streak.test.ts`
Expected: PASS nos 3 casos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-streak.test.ts
git commit -m "feat(badge): avaliador e catálogo dos selos de ofensiva (bestStreak)"
```

---

### Task 3: Gatilho ao registrar o Humor do Dia

Concede selos de ofensiva best-effort após `PUT /me/mood/today`, com notificação.

**Files:**
- Modify: `apps/api/src/routes/mood.ts` (imports + bloco best-effort no PUT)
- Modify: `apps/api/src/routes/mood.test.ts` (teste de concessão + notificação)

**Interfaces:**
- Consumes: `evaluateStreakBadgesForUser` de `../services/badge-service`; `notifyBadgesEarned` de `../services/notification-service`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `apps/api/src/routes/mood.test.ts` (dentro do `describe('mood routes', ...)`):

```ts
  it('PUT /me/mood/today concede selo de ofensiva e notifica quando o recorde atinge o limiar', async () => {
    const { app, token } = await setup()
    const { prisma } = await import('../lib/prisma')
    const { dayFromYmd } = await import('../lib/sao-paulo-date')
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@empresa.com' } })
    // Pré-semeia 7 dias úteis consecutivos → bestStreak 7, independente de "hoje".
    await prisma.moodEntry.createMany({
      data: ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-08', '2026-06-09'].map(
        (ymd) => ({ userId: user.id, mood: 'GOOD' as const, day: dayFromYmd(ymd) }),
      ),
    })
    const badge = await prisma.badge.create({
      data: { slug: 'ofensiva-7-dias-uteis', name: 'Em chamas', description: 'x', kind: 'STREAK', iconKey: 'fe-fire', threshold: 7 },
    })

    const res = await app.inject({
      method: 'PUT',
      url: '/me/mood/today',
      headers: { authorization: `Bearer ${token}` },
      payload: { mood: 'GOOD' },
    })
    expect(res.statusCode).toBe(200)

    const owned = await prisma.userBadge.findMany({ where: { userId: user.id, badgeId: badge.id } })
    expect(owned).toHaveLength(1)
    const notifs = await prisma.notification.findMany({ where: { userId: user.id, type: 'BADGE_EARNED' } })
    expect(notifs.length).toBeGreaterThanOrEqual(1)
    await app.close()
  })
```

(Confira o nome do modelo/enum de notificação no `notification-service`: o teste usa `prisma.notification` e `type: 'BADGE_EARNED'` — ajuste se o projeto usar nomes diferentes.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/mood.test.ts -t "concede selo de ofensiva"`
Expected: FAIL — sem gatilho, nenhum `UserBadge`/notificação é criado.

- [ ] **Step 3: Adicionar o gatilho best-effort**

Em `apps/api/src/routes/mood.ts`, adicionar aos imports:

```ts
import { evaluateStreakBadgesForUser } from '../services/badge-service'
import { notifyBadgesEarned } from '../services/notification-service'
```

No handler `PUT /me/mood/today`, entre `const today = await setTodayMood(...)` e o `return reply.send(...)`, inserir:

```ts
    // Avaliação dos selos de ofensiva: best-effort, nunca derruba o registro.
    try {
      const awarded = await evaluateStreakBadgesForUser(request.user.sub)
      if (awarded.length > 0) {
        await notifyBadgesEarned(request.user.sub, awarded.map((b) => b.badgeId))
      }
    } catch (err) {
      request.log.error(err)
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/mood.test.ts`
Expected: PASS (incluindo os testes de mood já existentes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/mood.ts apps/api/src/routes/mood.test.ts
git commit -m "feat(api): concede selos de ofensiva ao registrar o humor do dia"
```

---

### Task 4: Opção `STREAK` no admin (web)

Permite escolher o tipo "Ofensiva" ao criar selos pelo admin.

**Files:**
- Modify: `apps/web/src/pages/admin/BadgesSection.tsx:19-25` (exportar a lista + adicionar a opção)
- Create: `apps/web/src/pages/admin/BadgesSection.test.tsx`

**Interfaces:**
- Consumes: tipo `BadgeKind` (já inclui `STREAK` após Task 1).
- Produces: `export const BADGE_KINDS` em `BadgesSection.tsx` (lista de opções do seletor).

- [ ] **Step 1: Escrever o teste que falha**

Create `apps/web/src/pages/admin/BadgesSection.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { BADGE_KINDS } from './BadgesSection'

describe('BadgesSection — tipos de selo', () => {
  it('oferece a opção de selo de ofensiva', () => {
    const option = BADGE_KINDS.find((k) => k.value === 'STREAK')
    expect(option?.label).toBe('Ofensiva (dias úteis consecutivos)')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/BadgesSection.test.tsx`
Expected: FAIL — `BADGE_KINDS` não é exportado / não tem a opção STREAK.

- [ ] **Step 3: Exportar a lista e adicionar a opção**

Em `apps/web/src/pages/admin/BadgesSection.tsx`, trocar a declaração (linhas 19-25) por:

```tsx
export const BADGE_KINDS: { value: BadgeKind; label: string }[] = [
  { value: "CATEGORY", label: "Por categoria" },
  { value: "IMPACT", label: "Por impacto (total de votos)" },
  { value: "RECURRENCE", label: "Recorrência (meses distintos)" },
  { value: "FEEDBACK", label: "Feedback (total de feedbacks feitos)" },
  { value: "TENURE", label: "Tempo de casa (anos)" },
  { value: "STREAK", label: "Ofensiva (dias úteis consecutivos)" },
];
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/BadgesSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/BadgesSection.tsx apps/web/src/pages/admin/BadgesSection.test.tsx
git commit -m "feat(web): opção de selo de ofensiva no admin"
```

---

### Task 5: Verificação final (typecheck + suíte)

**Files:** nenhum (verificação; corrigir o que aparecer).

- [ ] **Step 1: Typecheck dos workspaces**

Run:
```bash
pnpm --filter @legends/shared exec tsc --noEmit
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 2: Suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: api + web + shared PASS.

- [ ] **Step 3: Commit (se houve ajustes)**

```bash
git add -A
git commit -m "chore(ofensiva): ajustes de typecheck e verificação final dos selos"
```

---

## Self-Review

**Spec coverage:**
- `BadgeKind = STREAK` (shared + schema + migration aditiva) → Task 1. ✅
- Admin aceita STREAK (`badgeKindSchema`) → Task 1. ✅
- Seed dos 4 níveis (7/14/30/60, slugs/nomes/artes/descrição) → Task 1. ✅
- `evaluateStreakBadgesForUser` (recorde, aditivo, P2002-safe, `todayYmd?`) → Task 2. ✅
- Catálogo: requisito + progresso STREAK (`bestStreak/threshold`) → Task 2. ✅
- Gatilho best-effort no `PUT /me/mood/today` + notificação → Task 3. ✅
- Opção STREAK no admin web → Task 4. ✅
- Sem mudança no painel/indicador; só selos → respeitado. ✅
- Sem selos por `currentStreak`; só recorde → Task 2 usa `bestStreak`. ✅
- Testes API (avaliador aditivo/idempotente/no-revoke; catálogo; gatilho) e web (opção admin) → Tasks 2,3 / 4. ✅

**Placeholder scan:** Sem TBD/TODO; todo passo tem código/comando concreto. A nota sobre confirmar o nome do modelo de notificação é uma instrução de verificação, não um placeholder de implementação. ✅

**Type consistency:** `evaluateStreakBadgesForUser(userId, todayYmd?)` definido na Task 2 e consumido na Task 3 com 1 arg (default). `BADGE_KINDS` exportado na Task 4 e consumido pelo seu teste. `getStreakSummary(userId, todayYmd?)` (entregue na ofensiva dias úteis) consumido na Task 2. Slugs/thresholds idênticos entre seed (Task 1), testes (Tasks 2,3) e spec. ✅
