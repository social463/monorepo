# Home — layout do print — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reformular a `HomePage` (não-admin) para o layout do mockup: saudação + streak, Mural como hero, e corpo em duas colunas (feed da Resenha à esquerda, card "Minhas Stats" com progresso de selos à direita).

**Architecture:** Mudança 100% frontend (`apps/web`). Reusa endpoints e DTOs existentes — nenhum endpoint, migration ou tipo em `@legends/shared` é criado. Três peças: simplificar `VotingBanner` (só renderiza com votação aberta), criar `MyStatsCard` (reusa a lógica de progresso da `BadgesPage`), e recompor `HomePage` (saudação + grid de duas colunas).

**Tech Stack:** React 18, React Router 6, React Query, Tailwind 3, Vitest + Testing Library (jsdom).

**Spec:** [`docs/superpowers/specs/2026-06-29-home-layout-print-design.md`](../specs/2026-06-29-home-layout-print-design.md)

## Global Constraints

- **Frontend-only:** não tocar em `apps/api`, `prisma`, migrations nem `packages/shared`.
- **Copy em pt-BR** (produto pt-BR).
- **Design system:** reusar tokens Tailwind do projeto (`gap-lg`, `text-headline-*`, `text-on-surface`, `border-outline-variant`, `bg-surface-container*`, `text-primary`, etc.) e componentes existentes (`Icon`, `BadgeEmblem`).
- **Sem backend novo:** todo dado vem de `GET /me/streak`, `GET /mural`, `GET /badges`, `GET /users/:id/badges`, `GET /periods/current`, `GET /reviews`.
- **Rodar testes do web** ao concluir: `pnpm --filter @legends/web exec vitest run` e typecheck `pnpm --filter @legends/web exec tsc --noEmit`.

---

### Task 1: `VotingBanner` — só renderiza com votação aberta

Remove o placeholder neutro e a faixa de "próxima votação". A faixa só aparece quando `votingOpen === true`; caso contrário retorna `null`.

**Files:**
- Modify: `apps/web/src/components/VotingBanner.tsx` (substituição completa)
- Test: `apps/web/src/components/VotingBanner.test.tsx`

**Interfaces:**
- Consumes: `useCurrentPeriod()` de `../lib/use-current-period` → `{ period: VotingPeriodDTO | null, votingOpen: boolean, isLoading: boolean }`.
- Produces: `<VotingBanner />` — renderiza um `<Link data-testid="voting-banner-open" to="/votar">` quando há votação aberta, ou `null` caso contrário.

- [ ] **Step 1: Atualizar os testes (vermelho)**

Substituir o conteúdo de `apps/web/src/components/VotingBanner.test.tsx` por:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { VotingBanner } from './VotingBanner'
import * as api from '../lib/api'

function routePeriods(current: unknown) {
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/periods/current') return { period: current }
    throw new Error(`unexpected ${path}`)
  })
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VotingBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-26T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra faixa de votação aberta com prazo e link para votar', async () => {
    routePeriods({
      id: 'p1', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN', state: 'OPEN', editable: true,
    })
    wrap(<VotingBanner />)

    const banner = await screen.findByTestId('voting-banner-open')
    expect(banner).toHaveAttribute('href', '/votar')
    expect(banner).toHaveTextContent(/votação aberta/i)
    // De 26/06 até 30/06 ≈ 5 dias restantes.
    expect(banner).toHaveTextContent(/faltam 5 dias/i)
  })

  it('não renderiza nada quando não há votação aberta', () => {
    routePeriods(null)
    const { container } = wrap(<VotingBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `pnpm --filter @legends/web exec vitest run src/components/VotingBanner.test.tsx`
Expected: FAIL — o segundo teste ainda encontra `voting-banner-none`/`voting-banner-closed` (DOM não vazio) com a implementação atual.

- [ ] **Step 3: Reescrever o componente**

Substituir todo o conteúdo de `apps/web/src/components/VotingBanner.tsx` por:

```tsx
import { Link } from 'react-router-dom'
import { useCurrentPeriod } from '../lib/use-current-period'
import { Icon } from './Icon'

/** Dias inteiros (arredondando pra cima) entre agora e a data ISO; nunca negativo. */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

/**
 * Faixa de votação no topo da Home. Só aparece quando há votação aberta —
 * caso contrário não renderiza nada (sem placeholder).
 */
export function VotingBanner() {
  const { period, votingOpen } = useCurrentPeriod()

  if (!votingOpen || !period) return null

  const days = daysUntil(period.endsAt)
  const prazo = days <= 0 ? 'último dia' : days === 1 ? 'falta 1 dia' : `faltam ${days} dias`
  return (
    <Link
      to="/votar"
      data-testid="voting-banner-open"
      className="flex items-center justify-between gap-md rounded-xl border border-primary/30 bg-primary/10 px-lg py-md transition-colors hover:bg-primary/15"
    >
      <span className="flex items-center gap-sm font-label text-label-lg text-on-surface">
        <Icon name="how_to_vote" filled className="text-[20px] text-primary" />
        Votação aberta · {prazo}
      </span>
      <span className="flex shrink-0 items-center gap-1 font-label text-label-md text-primary">
        Votar agora
        <Icon name="arrow_forward" className="text-[18px]" />
      </span>
    </Link>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/components/VotingBanner.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/VotingBanner.tsx apps/web/src/components/VotingBanner.test.tsx
git commit -m "feat(home): VotingBanner só aparece com votação aberta"
```

---

### Task 2: `MyStatsCard` — card de progresso de selos

Novo card da sidebar: contagem de selos conquistados, anos de casa e top-3 selos não conquistados por progresso. Reusa a fórmula/UI de progresso da `BadgesPage`.

**Files:**
- Create: `apps/web/src/components/MyStatsCard.tsx`
- Test: `apps/web/src/components/MyStatsCard.test.tsx`

**Interfaces:**
- Consumes:
  - `useAuth()` de `../auth/AuthContext` → `{ user: { id: string; name: string; joinedAt: string } | null }`.
  - `apiFetch<{ badges: BadgeCatalogEntryDTO[] }>('/badges')` — catálogo com `progress: { current, target } | null`.
  - `apiFetch<{ badges: AwardedBadgeDTO[] }>('/users/:id/badges')` — selos conquistados (`badge.slug`).
  - `BadgeEmblem` de `./BadgeEmblem` → `badge: Pick<BadgeDTO,'iconKey'|'kind'|'name'>`, `size?: number`.
  - `Icon` de `./Icon`.
- Produces: `<MyStatsCard />` — `<aside data-testid="my-stats-card">` com heading "Minhas Stats", contagem de selos, label de anos de casa, lista "Próximos selos" (até 3), e `<Link to="/selos">Ver Galeria Completa</Link>`.

- [ ] **Step 1: Escrever o teste (vermelho)**

Criar `apps/web/src/components/MyStatsCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { MyStatsCard } from './MyStatsCard'
import { apiFetch } from '../lib/api'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Silva', role: 'LEGEND', joinedAt: '2023-06-01T00:00:00.000Z' },
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function badge(slug: string, name: string, current: number, target: number): unknown {
  return {
    id: slug, slug, name, description: 'd', kind: 'IMPACT', iconKey: 'k',
    threshold: target, categorySlug: null, requirement: 'r',
    progress: { current, target },
  }
}

describe('MyStatsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra contagem de selos, anos de casa e top-3 por progresso', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges')
        return Promise.resolve({
          badges: [
            badge('a', 'Quase lá', 4, 5),    // 80%
            badge('b', 'No meio', 5, 10),     // 50%
            badge('c', 'Começando', 1, 10),   // 10%
            badge('d', 'Bem baixo', 1, 100),  // 1% — fica de fora do top-3
            badge('earned', 'Conquistado', 5, 5),
          ],
        })
      if (path === '/users/u1/badges')
        return Promise.resolve({ badges: [{ badge: { slug: 'earned' } }, { badge: { slug: 'x2' } }] })
      throw new Error(`unexpected ${path}`)
    })

    wrap(<MyStatsCard />)

    // 2 selos conquistados.
    expect(await screen.findByText('2')).toBeInTheDocument()
    // joinedAt 2023-06 → em 2026-06 = 3 anos.
    expect(screen.getByText(/3 anos de casa/i)).toBeInTheDocument()
    // Top-3 por progresso; o de 1% e o conquistado ficam de fora.
    expect(await screen.findByText('Quase lá')).toBeInTheDocument()
    expect(screen.getByText('No meio')).toBeInTheDocument()
    expect(screen.getByText('Começando')).toBeInTheDocument()
    expect(screen.queryByText('Bem baixo')).toBeNull()
    expect(screen.queryByText('Conquistado')).toBeNull()
    // Link para a galeria.
    expect(screen.getByRole('link', { name: /ver galeria completa/i })).toHaveAttribute('href', '/selos')
  })

  it('esconde "Próximos selos" quando não há selos em progresso', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges') return Promise.resolve({ badges: [badge('earned', 'Conquistado', 5, 5)] })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [{ badge: { slug: 'earned' } }] })
      throw new Error(`unexpected ${path}`)
    })
    wrap(<MyStatsCard />)
    expect(await screen.findByText('1')).toBeInTheDocument()
    expect(screen.queryByText(/próximos selos/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `pnpm --filter @legends/web exec vitest run src/components/MyStatsCard.test.tsx`
Expected: FAIL — `Cannot find module './MyStatsCard'` (arquivo ainda não existe).

- [ ] **Step 3: Criar o componente**

Criar `apps/web/src/components/MyStatsCard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { AwardedBadgeDTO, BadgeCatalogEntryDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { BadgeEmblem } from './BadgeEmblem'
import { Icon } from './Icon'

/** Anos completos entre a data ISO de entrada e agora. */
function completedYears(iso: string): number {
  const start = new Date(iso)
  const now = new Date()
  let years = now.getFullYear() - start.getFullYear()
  const m = now.getMonth() - start.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < start.getDate())) years--
  return Math.max(0, years)
}

function tenureLabel(iso: string): string {
  const years = completedYears(iso)
  if (years < 1) return 'Menos de 1 ano de casa'
  return years === 1 ? '1 ano de casa' : `${years} anos de casa`
}

const MAX_PROGRESS = 3

/** Card da sidebar da Home: selos conquistados, tempo de casa e próximos selos. */
export function MyStatsCard() {
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

  const earnedSlugs = new Set(earnedQuery.data?.badges.map((e) => e.badge.slug))
  const earnedCount = earnedQuery.data?.badges.length ?? 0

  const inProgress = (catalogQuery.data?.badges ?? [])
    .filter((b) => !earnedSlugs.has(b.slug) && b.progress && b.progress.target > 0)
    .sort((a, b) => b.progress!.current / b.progress!.target - a.progress!.current / a.progress!.target)
    .slice(0, MAX_PROGRESS)

  return (
    <aside
      data-testid="my-stats-card"
      className="flex flex-col gap-lg rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      <h2 className="font-headline text-headline-sm text-on-surface">Minhas Stats</h2>

      <div className="flex items-center gap-md">
        <div className="flex flex-col items-center rounded-xl border border-outline-variant/40 bg-surface px-lg py-md">
          <span className="font-label text-label-sm uppercase tracking-widest text-on-surface-variant">
            Selos
          </span>
          <span className="font-headline text-headline-md text-primary tabular-nums">{earnedCount}</span>
        </div>
        {user && (
          <span className="flex items-center gap-1 text-body-sm text-on-surface-variant">
            <Icon name="workspace_premium" className="text-[18px] text-tertiary" />
            {tenureLabel(user.joinedAt)}
          </span>
        )}
      </div>

      {inProgress.length > 0 && (
        <div className="flex flex-col gap-sm">
          <p className="font-label text-label-sm uppercase tracking-widest text-on-surface-variant">
            Próximos selos
          </p>
          <ul className="flex flex-col gap-md">
            {inProgress.map((badge) => {
              const pct = Math.min(
                100,
                Math.round((badge.progress!.current / badge.progress!.target) * 100),
              )
              return (
                <li key={badge.id} className="flex items-center gap-sm">
                  <BadgeEmblem badge={badge} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-label text-label-md text-on-surface">{badge.name}</p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-on-surface-variant">
                    {Math.min(badge.progress!.current, badge.progress!.target)}/{badge.progress!.target}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <Link
        to="/selos"
        className="flex items-center justify-center gap-1 font-label text-label-md text-primary hover:underline"
      >
        Ver Galeria Completa
        <Icon name="arrow_forward" className="text-[16px]" />
      </Link>
    </aside>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/components/MyStatsCard.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/MyStatsCard.tsx apps/web/src/components/MyStatsCard.test.tsx
git commit -m "feat(home): MyStatsCard com progresso de selos e tempo de casa"
```

---

### Task 3: `HomePage` — saudação + grid de duas colunas + Mural-hero

Recompõe a Home: saudação com streak, `VotingBanner`, `MuralBanner` (hero), e grid de duas colunas (Resenha + "Ver tudo" à esquerda, `MyStatsCard` à direita). Remove a margem `mb-xl` do `MuralBanner` (espaçamento passa a ser do `gap-lg` da Home).

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx` (substituição completa)
- Modify: `apps/web/src/components/MuralBanner.tsx:179` e `:205` (remover `mb-xl`)
- Test: `apps/web/src/pages/HomePage.test.tsx`

**Interfaces:**
- Consumes:
  - `useAuth()` → `{ user: { name: string } | null }` (primeiro nome).
  - `useStreakSummary()` de `../lib/use-streak` → `useQuery` com `data: StreakSummaryDTO | undefined` (`currentStreak: number`).
  - `<VotingBanner />` (Task 1), `<MyStatsCard />` (Task 2), `<MuralBanner />`, `<ResenhaFeed />`.
- Produces: `<HomePage />` — header com `Olá, {primeiroNome}!` + pílula `data-testid="home-streak"` (só quando `currentStreak > 0`), heading "Resenha do time", link "Ver tudo" → `/resenha`, e `MyStatsCard`.

- [ ] **Step 1: Atualizar o teste (vermelho)**

Substituir o `beforeEach` e o corpo do `describe` em `apps/web/src/pages/HomePage.test.tsx` (manter os imports e mocks do topo do arquivo, linhas 1–46) por:

```tsx
describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/mural') return Promise.resolve({ items: [] })
      if (path === '/me/streak')
        return Promise.resolve({ currentStreak: 12, bestStreak: 12, today: '2026-06-29', registeredToday: true })
      if (path === '/badges') return Promise.resolve({ badges: [] })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      return Promise.resolve({ items: [], nextCursor: null })
    })
  })

  it('mostra saudação, streak, mural, resenha e stats', async () => {
    wrap(<HomePage />)

    expect(await screen.findByText(/olá, test!/i)).toBeInTheDocument()
    expect(await screen.findByTestId('home-streak')).toHaveTextContent(/streak: 12/i)
    expect(screen.getByRole('heading', { name: /resenha do time/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /minhas stats/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver tudo/i })).toHaveAttribute('href', '/resenha')
    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/HomePage.test.tsx`
Expected: FAIL — não encontra `home-streak` / `Olá, Test!` (a Home atual não tem saudação).

- [ ] **Step 3: Reescrever a HomePage**

Substituir todo o conteúdo de `apps/web/src/pages/HomePage.tsx` por:

```tsx
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useStreakSummary } from '../lib/use-streak'
import { MuralBanner } from '../components/MuralBanner'
import { MyStatsCard } from '../components/MyStatsCard'
import { VotingBanner } from '../components/VotingBanner'
import { Icon } from '../components/Icon'
import { ResenhaFeed } from './resenha/ResenhaFeed'

/** Home "pulso do time": saudação + votação + mural-hero + resenha & stats. */
export function HomePage() {
  const { user } = useAuth()
  const streakQuery = useStreakSummary()
  const firstName = user?.name.split(' ')[0] ?? ''
  const streak = streakQuery.data?.currentStreak ?? 0

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-lg p-lg md:p-xl">
      <header className="flex flex-wrap items-center justify-between gap-md">
        <h1 className="font-headline text-headline-lg text-on-surface">Olá, {firstName}!</h1>
        {streak > 0 && (
          <span
            data-testid="home-streak"
            className="flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container px-md py-1 font-label text-label-md text-on-surface"
          >
            <Icon name="local_fire_department" filled className="text-[18px] text-tertiary" />
            Streak: {streak}
          </span>
        )}
      </header>

      <VotingBanner />
      <MuralBanner />

      <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-lg flex items-center justify-between gap-md">
            <h2 className="font-headline text-headline-md text-on-surface">Resenha do time</h2>
            <Link
              to="/resenha"
              className="flex items-center gap-1 font-label text-label-md text-primary hover:underline"
            >
              Ver tudo
              <Icon name="arrow_forward" className="text-[16px]" />
            </Link>
          </div>
          <ResenhaFeed />
        </div>
        <MyStatsCard />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Remover `mb-xl` do MuralBanner**

Em `apps/web/src/components/MuralBanner.tsx`, na `<section data-testid="mural-banner-empty">` (linha ~179), trocar:

```
className="mb-xl flex items-center gap-md rounded-2xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-lg"
```
por:
```
className="flex items-center gap-md rounded-2xl border border-dashed border-outline-variant/50 bg-surface-container-low px-lg py-lg"
```

E na `<section data-testid="mural-banner">` (linha ~205), trocar:

```
className="relative mb-xl overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low"
```
por:
```
className="relative overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-low"
```

- [ ] **Step 5: Rodar os testes do web e o typecheck**

Run: `pnpm --filter @legends/web exec vitest run`
Expected: PASS — todos os testes do web, incluindo `HomePage.test.tsx`, `MuralBanner.test.tsx` (sem asserções de classe, não quebram), `VotingBanner.test.tsx`, `MyStatsCard.test.tsx`.

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/HomePage.tsx apps/web/src/pages/HomePage.test.tsx apps/web/src/components/MuralBanner.tsx
git commit -m "feat(home): layout do print — saudação, mural-hero e duas colunas"
```

---

## Self-Review

**Spec coverage:**
- Mural como hero → Task 3 (posição no topo) + remoção do `mb-xl`. ✔
- Minhas Stats com progresso de selos (contagem, anos de casa, top-3) → Task 2. ✔
- VotingBanner só com votação aberta → Task 1. ✔
- Saudação + streak (conteúdo da página, sem duplicar header global) → Task 3. ✔
- "Resenha do time" + "Ver tudo" → `/resenha` → Task 3. ✔
- "Ver Galeria Completa" → `/selos` → Task 2. ✔
- Grid duas colunas (lg+) / coluna única no mobile, stats ao fim → Task 3 (`lg:grid-cols-[minmax(0,1fr)_320px]`). ✔
- Fora de escopo (Hall da Fama, pontos, comunicados, backend) → nenhuma task os toca. ✔

**Type consistency:** `useStreakSummary` (não `useStreak`), `BadgeEmblem` com `badge: Pick<...>` + `size`, `BadgeCatalogEntryDTO.progress: { current, target } | null`, `AwardedBadgeDTO.badge.slug` — todos batem com o código lido (`use-streak.ts`, `BadgeEmblem.tsx`, `badge.ts`, `BadgesPage.tsx`). `data-testid` usados nos testes (`voting-banner-open`, `my-stats-card`, `home-streak`) batem com os componentes.

**Placeholder scan:** sem TBD/TODO; todo código está completo.
