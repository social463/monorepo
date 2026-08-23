# Catálogo de Selos (requisito + progresso + imagem) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enriquecer `GET /badges` para devolver, por selo, um requisito legível derivado e o progresso do usuário logado, e atualizar a página de Selos para exibir imagem + descrição + requisito + progresso.

**Architecture:** Uma função de serviço `getBadgeCatalog(userId)` reúne cada `Badge` com um `requirement` (string derivada de `kind`+`threshold`+nome da categoria) e um `progress` (`{current,target}|null`) calculado com os helpers de contagem já existentes. Um serializador transforma isso no novo `BadgeCatalogEntryDTO`; o handler `GET /badges` passa a devolvê-lo. A `BadgesPage` renderiza o emblema (componente `BadgeEmblem`) + requisito + barra de progresso.

**Tech Stack:** Fastify + Prisma (PostgreSQL), Zod, Vitest, React + TypeScript (Vite) + Tailwind, pacote compartilhado `@legends/shared`, React Query, Testing Library.

## Global Constraints

- Monorepo pnpm. API em `apps/api` (`@legends/api`), web em `apps/web` (`@legends/web`), tipos em `packages/shared` (`@legends/shared`, source-only — sem build step).
- Testes da API: Postgres real, banco resetado em `beforeEach` (`apps/api/test/setup.ts`). Rodar com `pnpm --filter @legends/api test <arquivo>`.
- Testes web: `pnpm --filter @legends/web test <arquivo>`. Typecheck: `pnpm --filter @legends/api exec tsc --noEmit` / `pnpm --filter @legends/web exec tsc --noEmit`.
- `GET /badges` permanece autenticado (`onRequest: [app.authenticate]`).
- NÃO alterar `toBadgeDTO`, o endpoint `/admin/badges`, nem o estado "conquistado" (vem de `GET /users/:id/badges`).
- Textos de UI/requisito em português, exatamente como especificados abaixo.
- `current` no progress é a contagem real (pode exceder `target`); a UI trava a barra/o texto em `target`.

## File Structure

- `packages/shared/src/badge.ts` — adicionar `BadgeProgress` e `BadgeCatalogEntryDTO`. **MODIFY**
- `apps/api/src/services/badge-service.ts` — adicionar `BadgeCatalogEntry`, `getBadgeCatalog`, e helpers de requisito/progresso. **MODIFY**
- `apps/api/src/services/badge-service.test.ts` — testes de `getBadgeCatalog`. **MODIFY**
- `apps/api/src/lib/serialize.ts` — adicionar `toBadgeCatalogEntryDTO`. **MODIFY**
- `apps/api/src/routes/badges.ts` — `GET /badges` devolve entradas enriquecidas. **MODIFY**
- `apps/api/src/routes/badges.test.ts` — atualizar o teste do catálogo. **MODIFY**
- `apps/web/src/pages/BadgesPage.tsx` — emblema + requisito + progresso. **MODIFY**
- `apps/web/src/pages/BadgesPage.test.tsx` — novo shape + asserções. **MODIFY**

---

## Task 1: Tipos compartilhados (`BadgeProgress`, `BadgeCatalogEntryDTO`)

**Files:**
- Modify: `packages/shared/src/badge.ts`

**Interfaces:**
- Consumes: `BadgeDTO` (já existe no mesmo arquivo).
- Produces:
  - `interface BadgeProgress { current: number; target: number }`
  - `interface BadgeCatalogEntryDTO extends BadgeDTO { requirement: string; progress: BadgeProgress | null }`
  - Ambos exportados (o `packages/shared/src/index.ts` já faz `export * from './badge'`).

- [ ] **Step 1: Adicionar os tipos**

No fim de `packages/shared/src/badge.ts`, após o bloco `AwardedBadgeDTO`, acrescentar:

```ts
export interface BadgeProgress {
  current: number
  target: number
}

export interface BadgeCatalogEntryDTO extends BadgeDTO {
  requirement: string
  progress: BadgeProgress | null
}
```

- [ ] **Step 2: Checar tipos da API (que consome o shared)**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (os novos tipos são aditivos).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/badge.ts
git commit -m "feat(shared): tipos BadgeProgress e BadgeCatalogEntryDTO"
```

---

## Task 2: `getBadgeCatalog` no badge-service (requisito + progresso)

**Files:**
- Modify: `apps/api/src/services/badge-service.ts`
- Test: `apps/api/src/services/badge-service.test.ts`

**Interfaces:**
- Consumes: tipo `BadgeProgress` de `@legends/shared` (Task 1); helpers `countVotesInCategory`, `countTotalVotes`, `countDistinctMonths`, `countFeedbacksAuthored` (já existem no arquivo, privados).
- Produces:
  - `export interface BadgeCatalogEntry { badge: Badge; requirement: string; progress: BadgeProgress | null }`
  - `export async function getBadgeCatalog(userId: string): Promise<BadgeCatalogEntry[]>` — um item por selo, ordenado por `name` asc.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/src/services/badge-service.test.ts`: adicionar `getBadgeCatalog` ao import de `./badge-service` (junto de `evaluateBadgesForUser`, `syncFeedbackBadgesForUser`, etc.). Os helpers `makeUser`, `makeFeedbackBadge` e `giveFeedback` JÁ existem neste arquivo (criados em trabalho anterior) — reutilize-os. Adicionar ao final do `describe('badge service', ...)`:

```ts
it('getBadgeCatalog derives a FEEDBACK requirement and the user progress', async () => {
  const author = await makeUser('Autor')
  const t1 = await makeUser('Alvo1')
  const t2 = await makeUser('Alvo2')
  const t3 = await makeUser('Alvo3')
  await makeFeedbackBadge(5)
  await giveFeedback(author.id, t1.id)
  await giveFeedback(author.id, t2.id)
  await giveFeedback(author.id, t3.id)

  const catalog = await getBadgeCatalog(author.id)
  const entry = catalog.find((e) => e.badge.kind === 'FEEDBACK')
  expect(entry?.requirement).toBe('Faça 5 feedbacks')
  expect(entry?.progress).toEqual({ current: 3, target: 5 })
})

it('getBadgeCatalog derives a CATEGORY requirement using the category name', async () => {
  const user = await makeUser('User')
  await prisma.category.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
  await prisma.badge.create({
    data: { slug: 'conector', name: 'Conector', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 4, categorySlug: 'colaboracao' },
  })

  const catalog = await getBadgeCatalog(user.id)
  const entry = catalog.find((e) => e.badge.slug === 'conector')
  expect(entry?.requirement).toBe('Receba 4 votos em Colaboração')
  expect(entry?.progress).toEqual({ current: 0, target: 4 })
})

it('getBadgeCatalog falls back to the slug for an orphan category and gives HIGHLIGHT no progress', async () => {
  const user = await makeUser('User')
  await prisma.badge.create({
    data: { slug: 'orfao', name: 'Órfão', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 2, categorySlug: 'inexistente' },
  })
  await prisma.badge.create({
    data: { slug: 'destaque', name: 'Destaque', description: 'd', kind: 'HIGHLIGHT', iconKey: 'trophy', threshold: 0, categorySlug: null },
  })

  const catalog = await getBadgeCatalog(user.id)
  const orphan = catalog.find((e) => e.badge.slug === 'orfao')
  expect(orphan?.requirement).toBe('Receba 2 votos em inexistente')
  const highlight = catalog.find((e) => e.badge.slug === 'destaque')
  expect(highlight?.requirement).toBe('Seja o destaque do mês')
  expect(highlight?.progress).toBeNull()
})
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `pnpm --filter @legends/api test src/services/badge-service.test.ts`
Expected: FAIL — `getBadgeCatalog` não existe (erro de import / TypeError).

- [ ] **Step 3: Implementar `getBadgeCatalog`**

Em `apps/api/src/services/badge-service.ts`:

(a) Adicionar o import do tipo no topo (após o import existente de `'../lib/prisma'`):

```ts
import type { BadgeProgress } from '@legends/shared'
```

(b) Adicionar o tipo, os helpers e a função ao final do arquivo (logo após `revokeManualBadge`):

```ts
export interface BadgeCatalogEntry {
  badge: Badge
  requirement: string
  progress: BadgeProgress | null
}

function buildRequirement(badge: Badge, categoryName: string | null): string {
  switch (badge.kind) {
    case 'FEEDBACK':
      return `Faça ${badge.threshold} feedbacks`
    case 'IMPACT':
      return `Receba ${badge.threshold} votos no total`
    case 'RECURRENCE':
      return `Receba votos em ${badge.threshold} meses diferentes`
    case 'CATEGORY':
      return `Receba ${badge.threshold} votos em ${categoryName ?? badge.categorySlug ?? 'uma categoria'}`
    case 'HIGHLIGHT':
      return 'Seja o destaque do mês'
    default:
      return ''
  }
}

async function computeProgress(userId: string, badge: Badge): Promise<BadgeProgress | null> {
  const target = badge.threshold
  switch (badge.kind) {
    case 'FEEDBACK':
      return { current: await countFeedbacksAuthored(userId), target }
    case 'IMPACT':
      return { current: await countTotalVotes(userId), target }
    case 'RECURRENCE':
      return { current: await countDistinctMonths(userId), target }
    case 'CATEGORY':
      return { current: badge.categorySlug ? await countVotesInCategory(userId, badge.categorySlug) : 0, target }
    case 'HIGHLIGHT':
    default:
      return null
  }
}

/** Catálogo completo de selos com requisito legível e progresso do usuário. */
export async function getBadgeCatalog(userId: string): Promise<BadgeCatalogEntry[]> {
  const [badges, categories] = await Promise.all([
    prisma.badge.findMany({ orderBy: { name: 'asc' } }),
    prisma.category.findMany({ select: { slug: true, name: true } }),
  ])
  const categoryNameBySlug = new Map(categories.map((c) => [c.slug, c.name]))

  const entries: BadgeCatalogEntry[] = []
  for (const badge of badges) {
    const categoryName = badge.categorySlug ? categoryNameBySlug.get(badge.categorySlug) ?? null : null
    const requirement = buildRequirement(badge, categoryName)
    const progress = await computeProgress(userId, badge)
    entries.push({ badge, requirement, progress })
  }
  return entries
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `pnpm --filter @legends/api test src/services/badge-service.test.ts`
Expected: PASS (os 3 novos + todos os pré-existentes de selo permanecem verdes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts
git commit -m "feat(api): getBadgeCatalog com requisito derivado e progresso do usuário"
```

---

## Task 3: Serializador + rota `GET /badges` enriquecida

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/routes/badges.ts`
- Test: `apps/api/src/routes/badges.test.ts`

**Interfaces:**
- Consumes: `getBadgeCatalog` e `BadgeCatalogEntry` (Task 2); `BadgeCatalogEntryDTO` (Task 1); `toBadgeDTO` (já existe em serialize).
- Produces:
  - `export function toBadgeCatalogEntryDTO(entry: BadgeCatalogEntry): BadgeCatalogEntryDTO`
  - `GET /badges` devolve `{ badges: BadgeCatalogEntryDTO[] }`.

- [ ] **Step 1: Escrever/atualizar o teste de rota que falha**

Em `apps/api/src/routes/badges.test.ts`, substituir o teste `lists the badge catalog (GET /badges)` por esta versão (acrescenta asserções de `requirement` e `progress`; o selo não tem categoria correspondente, então cai no fallback do slug):

```ts
it('lists the badge catalog with requirement and progress (GET /badges)', async () => {
  const { app, token } = await setup()
  await prisma.badge.create({
    data: { slug: 'conector', name: 'Conector', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao' },
  })
  const res = await app.inject({ method: 'GET', url: '/badges', headers: { authorization: `Bearer ${token}` } })
  expect(res.statusCode).toBe(200)
  expect(res.json().badges).toHaveLength(1)
  expect(res.json().badges[0].threshold).toBe(5)
  expect(res.json().badges[0].requirement).toBe('Receba 5 votos em colaboracao')
  expect(res.json().badges[0].progress).toEqual({ current: 0, target: 5 })
  await app.close()
})
```

(O teste `requires authentication (401)` permanece como está.)

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @legends/api test src/routes/badges.test.ts`
Expected: FAIL — `requirement`/`progress` ainda não existem na resposta (`undefined`).

- [ ] **Step 3: Adicionar o serializador**

Em `apps/api/src/lib/serialize.ts`:

(a) No import de `@legends/shared`, adicionar `BadgeCatalogEntryDTO` à lista de tipos importados (junto de `BadgeDTO`).

(b) Adicionar o import do tipo de entrada do serviço (type-only; não cria ciclo, pois badge-service não importa serialize). Colocar junto aos imports do topo:

```ts
import type { BadgeCatalogEntry } from '../services/badge-service'
```

(c) Logo após a função `toBadgeDTO`, adicionar:

```ts
export function toBadgeCatalogEntryDTO(entry: BadgeCatalogEntry): BadgeCatalogEntryDTO {
  return { ...toBadgeDTO(entry.badge), requirement: entry.requirement, progress: entry.progress }
}
```

- [ ] **Step 4: Atualizar o handler da rota**

Substituir o conteúdo de `apps/api/src/routes/badges.ts` por:

```ts
import type { FastifyInstance } from 'fastify'
import { getBadgeCatalog, listBadgesForUser } from '../services/badge-service'
import { toAwardedBadgeDTO, toBadgeCatalogEntryDTO } from '../lib/serialize'

export async function badgeRoutes(app: FastifyInstance) {
  app.get('/badges', { onRequest: [app.authenticate] }, async (request, reply) => {
    const catalog = await getBadgeCatalog(request.user.sub)
    return reply.send({ badges: catalog.map(toBadgeCatalogEntryDTO) })
  })

  app.get('/users/:id/badges', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const awarded = await listBadgesForUser(id)
    return reply.send({ badges: awarded.map(toAwardedBadgeDTO) })
  })
}
```

> Nota: isto remove os imports antes usados (`prisma`, `toBadgeDTO`) do arquivo de rota — eles não são mais necessários aqui. Garanta que o `tsc` fica limpo (sem imports não usados).

- [ ] **Step 5: Rodar os testes para confirmar que passam + typecheck**

Run: `pnpm --filter @legends/api test src/routes/badges.test.ts`
Expected: PASS.
Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (sem imports órfãos).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/badges.ts apps/api/src/routes/badges.test.ts
git commit -m "feat(api): GET /badges devolve requisito e progresso por selo"
```

---

## Task 4: `BadgesPage` — imagem + requisito + progresso

**Files:**
- Modify: `apps/web/src/pages/BadgesPage.tsx`
- Test: `apps/web/src/pages/BadgesPage.test.tsx`

**Interfaces:**
- Consumes: `BadgeCatalogEntryDTO` de `@legends/shared` (Task 1); componente `BadgeEmblem` de `../components/BadgeEmblem` (props `{ badge: Pick<BadgeDTO,'iconKey'|'kind'|'name'>; size?: number }`, renderiza um `role="img"` com `aria-label={badge.name}`).
- Produces: página renderiza emblema, requisito e barra/texto de progresso.

- [ ] **Step 1: Atualizar o mock e as asserções do teste (falha primeiro)**

Em `apps/web/src/pages/BadgesPage.test.tsx`, no `setupFetch`, substituir o array de `/badges` para incluir `requirement` e `progress` (b1 conquistado com progresso cheio; b2 não conquistado, 4/10):

```ts
    if (path === '/badges') {
      return Promise.resolve({
        badges: [
          { id: 'b1', slug: 'conector', name: 'Conector do Time', description: '5 em colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', requirement: 'Receba 5 votos em Colaboração', progress: { current: 5, target: 5 } },
          { id: 'b2', slug: 'reconhecido', name: 'Reconhecido', description: '10 no total', kind: 'IMPACT', iconKey: 'star', threshold: 10, categorySlug: null, requirement: 'Receba 10 votos no total', progress: { current: 4, target: 10 } },
        ],
      })
    }
```

Adicionar, após o teste `shows the catalog and marks earned badges`, um novo teste:

```ts
  it('shows the requirement, the progress for unearned badges, and the badge emblems', async () => {
    renderPage()
    expect(await screen.findByText('Receba 10 votos no total')).toBeInTheDocument()
    // selo não conquistado mostra progresso "4/10"
    expect(screen.getByText('4/10')).toBeInTheDocument()
    // emblema de cada selo é renderizado (BadgeEmblem usa role="img")
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2)
  })
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @legends/web test src/pages/BadgesPage.test.tsx`
Expected: FAIL — requisito/progresso/emblema ainda não são renderizados.

- [ ] **Step 3: Atualizar a `BadgesPage`**

Substituir o conteúdo de `apps/web/src/pages/BadgesPage.tsx` por:

```tsx
import { useQuery } from '@tanstack/react-query'
import type { AwardedBadgeDTO, BadgeCatalogEntryDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { BadgesSkeleton } from '../components/Skeleton'
import { BadgeEmblem } from '../components/BadgeEmblem'

export function BadgesPage() {
  const { user } = useAuth()

  const catalogQuery = useQuery({
    queryKey: ['badges'],
    queryFn: () => apiFetch<{ badges: BadgeCatalogEntryDTO[] }>('/badges'),
  })
  const earnedQuery = useQuery({
    queryKey: ['badges', 'me', user?.id],
    queryFn: () => apiFetch<{ badges: AwardedBadgeDTO[] }>(`/users/${user!.id}/badges`),
    enabled: Boolean(user),
  })

  const earnedSlugs = new Set(earnedQuery.data?.badges.map((entry) => entry.badge.slug))

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-lg p-lg md:p-xl">
      <header>
        <h2 className="font-headline text-headline-xl text-on-surface">Selos</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Conquistas que marcam a trajetória técnica do time.
        </p>
      </header>

      {catalogQuery.isError && <p className="text-red-400">Erro ao carregar os selos.</p>}

      {catalogQuery.isLoading && <BadgesSkeleton />}

      {!catalogQuery.isLoading && (
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {catalogQuery.data?.badges.map((badge) => {
          const earned = earnedSlugs.has(badge.slug)
          const pct =
            badge.progress && badge.progress.target > 0
              ? Math.min(100, Math.round((badge.progress.current / badge.progress.target) * 100))
              : 0
          return (
            <li
              key={badge.id}
              className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center ${earned ? 'bg-surface border-primary' : 'bg-surface border-slate-800 opacity-60'}`}
            >
              <BadgeEmblem badge={badge} size={72} />
              <p className="font-semibold flex items-center gap-2">
                {badge.name}
                {earned && (
                  <span className="font-mono text-[10px] uppercase tracking-widest text-secondary">
                    conquistado
                  </span>
                )}
              </p>
              <p className="text-sm text-slate-300">{badge.description}</p>
              <p className="text-xs text-on-surface-variant">{badge.requirement}</p>
              {!earned && badge.progress && (
                <div className="w-full">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-on-surface-variant">
                    {Math.min(badge.progress.current, badge.progress.target)}/{badge.progress.target}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam + typecheck**

Run: `pnpm --filter @legends/web test src/pages/BadgesPage.test.tsx`
Expected: PASS (o teste pré-existente `shows the catalog and marks earned badges` e o novo).
Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BadgesPage.tsx apps/web/src/pages/BadgesPage.test.tsx
git commit -m "feat(web): página de Selos com imagem, requisito e progresso"
```

---

## Task 5: Verificação ponta-a-ponta

**Files:** nenhum (apenas verificação).

- [ ] **Step 1: Suíte completa da API**

Run: `pnpm --filter @legends/api test`
Expected: PASS — todos os testes (inclui os pré-existentes de selo, feedback, admin).

- [ ] **Step 2: Suíte do web + typecheck do monorepo**

Run: `pnpm --filter @legends/web test`
Expected: PASS.
Run: `pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit (se necessário)**

Se algum ajuste foi preciso, commitar; caso contrário, nada a fazer.

---

## Self-Review

**1. Spec coverage:**
- Enriquecer `GET /badges` (em vez de rota nova) → Task 3. ✓
- `requirement` derivado por kind (+nome categoria, +fallbacks) → Task 2 (`buildRequirement`). ✓
- `progress {current,target}|null`, HIGHLIGHT null → Task 2 (`computeProgress`). ✓
- `current` real, UI trava em target → Task 2 retorna contagem real; Task 4 usa `Math.min` no texto e `Math.min(100,...)` na barra. ✓
- `BadgeCatalogEntryDTO` em shared, `toBadgeDTO` intacto → Task 1 + Task 3 (novo serializador, não toca `toBadgeDTO`). ✓
- Rota permanece autenticada → Task 3 mantém `onRequest: [app.authenticate]`; teste 401 preservado. ✓
- Web: imagem (BadgeEmblem) + requisito + barra/"3/5", esmaecido mantido, "conquistado" inalterado → Task 4. ✓
- Testes service/rota/web → Tasks 2, 3, 4. ✓

**2. Placeholder scan:** sem TBD/TODO; todo código completo. Os testes reutilizam helpers reais já verificados nos arquivos (`makeUser`/`makeFeedbackBadge`/`giveFeedback` em badge-service.test.ts; `setup` em badges.test.ts; `setupFetch`/`renderPage` em BadgesPage.test.tsx). ✓

**3. Type consistency:**
- `BadgeProgress { current; target }` e `BadgeCatalogEntryDTO extends BadgeDTO` — definidos na Task 1, consumidos nas Tasks 2/3/4. ✓
- `BadgeCatalogEntry { badge; requirement; progress }` — produzido na Task 2, consumido por `toBadgeCatalogEntryDTO` na Task 3. ✓
- `getBadgeCatalog(userId): Promise<BadgeCatalogEntry[]>` — assinatura idêntica entre Tasks 2 e 3. ✓
- `toBadgeCatalogEntryDTO(entry): BadgeCatalogEntryDTO` — produzido na Task 3, usado no handler da mesma task. ✓
