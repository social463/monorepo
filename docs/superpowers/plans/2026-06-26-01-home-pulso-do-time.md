# Home "Pulso do time" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a rota `/` numa Home feed-first ("pulso do time"): faixa de votação contextual + carrossel do mural + feed de resenha, em vez de redirecionar pro perfil.

**Architecture:** Frontend only. Extrai o corpo do feed da `ResenhaPage` num componente reutilizável `ResenhaFeed`; cria `VotingBanner` (faixa contextual) e `HomePage` (composição dos três blocos); altera o roteamento em `App.tsx` para renderizar `HomePage` em `/` para não-admin e remove o `MuralBanner` do perfil. Nenhuma mudança de contrato em `@legends/shared` nem no backend — todos os endpoints já existem.

**Tech Stack:** React 18, React Router 6 (`react-router-dom`), React Query (`@tanstack/react-query`), Tailwind 3, Vitest + Testing Library, TypeScript ESM strict.

## Global Constraints

- Mensagens voltadas ao usuário em **português** (produto pt-BR).
- Front sempre fala com a API por `/api` via `apiFetch` (nunca cravar `localhost:3333`).
- TypeScript **strict**, ESM. Siga o padrão da camada vizinha (componente fino, hooks em `lib/`).
- Testes Vitest `*.test.tsx` **colocados ao lado** do código; web usa `jsdom` + Testing Library.
- Tokens de estilo do tema (ex.: `bg-surface-container`, `text-on-surface`, `border-outline-variant`, `p-lg`, `gap-md`, `text-headline-lg`) — reuse os já presentes na codebase, não invente classes.
- Rode `pnpm --filter @legends/web test` para validar; ao mudar tipos/DTOs rode também `tsc --noEmit` no workspace web (build/Vitest não fazem typecheck do projeto).

---

## File Structure

- **Create** `apps/web/src/pages/resenha/ResenhaFeed.tsx` — corpo do feed (composer + lista + scroll infinito + deep-link), reusado por Home e `/resenha`.
- **Create** `apps/web/src/pages/resenha/ResenhaFeed.test.tsx` — testa que o feed renderiza composer + posts.
- **Create** `apps/web/src/components/VotingBanner.tsx` — faixa de votação contextual.
- **Create** `apps/web/src/components/VotingBanner.test.tsx` — estados aberto / fechado-com-próximo / sem nada.
- **Create** `apps/web/src/pages/HomePage.tsx` — composição `VotingBanner` + `MuralBanner` + `ResenhaFeed`.
- **Create** `apps/web/src/pages/HomePage.test.tsx` — renderiza os três blocos.
- **Modify** `apps/web/src/pages/resenha/ResenhaPage.tsx` — passa a renderizar `ResenhaFeed`.
- **Modify** `apps/web/src/App.tsx:38-48` — `HomeRoute` renderiza `HomePage` para não-admin.
- **Modify** `apps/web/src/pages/ProfilePage.tsx:27,171` — remove `MuralBanner` do perfil (import + uso).

Nota: o `MuralBanner` também aparece em `TeamPage.tsx:67`. Está **fora de escopo** — não mexa nele.

---

### Task 1: Extrair `ResenhaFeed` da `ResenhaPage`

Refactor puro, sem mudança de comportamento. Move toda a lógica de feed (hooks, effects de deep-link e scroll infinito, JSX do card) para um componente reutilizável. A `ResenhaPage` mantém só o `<section>` + título e delega ao `ResenhaFeed`.

**Files:**
- Create: `apps/web/src/pages/resenha/ResenhaFeed.tsx`
- Create: `apps/web/src/pages/resenha/ResenhaFeed.test.tsx`
- Modify: `apps/web/src/pages/resenha/ResenhaPage.tsx`

**Interfaces:**
- Consumes: `useReviewFeed`, `useCreateReview` (de `../../lib/use-reviews`); `ReviewComposer`, `ReviewCard` (locais); `Icon` (de `../../components/Icon`); `useLocation` (de `react-router-dom`).
- Produces: `export function ResenhaFeed(): JSX.Element` — sem props. Renderiza um `<div>` com o card do feed (composer no topo + lista + sentinela de scroll infinito). Usado por `ResenhaPage` (Task 1) e `HomePage` (Task 3).

- [ ] **Step 1: Escrever o teste do `ResenhaFeed`**

Cria `apps/web/src/pages/resenha/ResenhaFeed.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ResenhaFeed } from './ResenhaFeed'
import * as api from '../../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const author = {
  id: 'u2', name: 'Bia', email: 'b@x.com', role: 'LEGEND', position: null,
  squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null,
  avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z',
}

describe('ResenhaFeed', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renderiza o composer e a lista de resenhas', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      items: [
        {
          id: 'r1', author, content: 'Primeira resenha do time!',
          createdAt: '2026-06-20T00:00:00.000Z', reactions: [], reactors: [],
          reactorCount: 0, commentCount: 0, shareCount: 0, sharedByMe: false,
          mentions: [],
        },
      ],
      nextCursor: null,
    })

    wrap(<ResenhaFeed />)

    expect(await screen.findByText('Primeira resenha do time!')).toBeInTheDocument()
    // O composer expõe um textarea para escrever a resenha.
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- ResenhaFeed`
Expected: FAIL — `Failed to resolve import './ResenhaFeed'` (arquivo ainda não existe).

- [ ] **Step 3: Criar `ResenhaFeed.tsx` movendo a lógica da página**

Cria `apps/web/src/pages/resenha/ResenhaFeed.tsx` com o conteúdo (movido verbatim do corpo atual da `ResenhaPage`, sem o `<section>`/`<h1>`):

```tsx
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useCreateReview, useReviewFeed } from '../../lib/use-reviews'
import { ReviewComposer } from './ReviewComposer'
import { ReviewCard } from './ReviewCard'

/** Feed de resenha reutilizável: composer + lista + scroll infinito + deep-link. */
export function ResenhaFeed() {
  const feed = useReviewFeed()
  const create = useCreateReview()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()
  const targetId = hash.startsWith('#') ? hash.slice(1) : ''

  // Deep-link de notificação: carrega páginas até encontrar o post alvo, depois rola até ele.
  const scrolledRef = useRef(false)
  useEffect(() => {
    scrolledRef.current = false
  }, [targetId])
  useEffect(() => {
    if (!targetId) return
    const reviews = feed.data?.pages.flatMap((p) => p.items) ?? []
    if (!reviews.some((r) => r.id === targetId)) {
      if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage()
      return
    }
    if (scrolledRef.current) return
    scrolledRef.current = true
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [targetId, feed.data, feed.hasNextPage, feed.isFetchingNextPage])

  // Scroll infinito: observa a sentinela e busca a próxima página ao aparecer.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) {
        feed.fetchNextPage()
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [feed.hasNextPage, feed.isFetchingNextPage])

  const reviews = feed.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container">
      <div className="border-b border-outline-variant/40 px-lg py-md">
        <ReviewComposer
          onSubmit={(content, mentionedUserIds) => create.mutate({ content, mentionedUserIds })}
          pending={create.isPending}
        />
      </div>

      {feed.isLoading ? (
        <p className="px-lg py-md text-body-sm text-on-surface-variant">Carregando…</p>
      ) : feed.isError ? (
        <p role="alert" className="flex items-center gap-sm px-lg py-md text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar a resenha.
        </p>
      ) : reviews.length === 0 ? (
        <p className="px-lg py-md text-body-sm text-on-surface-variant">
          Ainda não há resenhas. Seja o primeiro!
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant/40">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
      )}

      {/* Sentinela do scroll infinito + fallback acessível por botão. */}
      <div ref={sentinelRef} className="h-px" />
      {feed.hasNextPage && (
        <button
          type="button"
          onClick={() => feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
          className="w-full border-t border-outline-variant/40 px-lg py-md font-label text-label-md text-primary transition-colors hover:bg-surface-container-high disabled:opacity-50"
        >
          {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Reescrever `ResenhaPage.tsx` para usar `ResenhaFeed`**

Substitui todo o conteúdo de `apps/web/src/pages/resenha/ResenhaPage.tsx` por:

```tsx
import { ResenhaFeed } from './ResenhaFeed'

export function ResenhaPage() {
  return (
    <section className="mx-auto max-w-7xl p-lg md:p-xl">
      <h1 className="mb-lg font-headline text-headline-lg text-on-surface">Resenha</h1>
      <ResenhaFeed />
    </section>
  )
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- ResenhaFeed`
Expected: PASS (1 teste).

Run: `pnpm --filter @legends/web test -- resenha`
Expected: PASS — testes existentes de resenha (`ReviewCard`, etc.) continuam verdes (refactor não muda comportamento).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/resenha/ResenhaFeed.tsx apps/web/src/pages/resenha/ResenhaFeed.test.tsx apps/web/src/pages/resenha/ResenhaPage.tsx
git commit -m "refactor(resenha): extrai ResenhaFeed reutilizável da ResenhaPage"
```

---

### Task 2: Componente `VotingBanner`

Faixa de votação contextual. Período aberto → faixa em destaque com link pra `/votar` e prazo. Período fechado com próximo período → faixa discreta com a data de abertura. Sem período aberto nem próximo → não renderiza nada.

**Files:**
- Create: `apps/web/src/components/VotingBanner.tsx`
- Create: `apps/web/src/components/VotingBanner.test.tsx`

**Interfaces:**
- Consumes: `useCurrentPeriod` (de `../lib/use-current-period`, retorna `{ period, votingOpen, isLoading }`); `apiFetch` (de `../lib/api`); `VotingPeriodDTO` (de `@legends/shared`, campos: `id, monthRef, startsAt, endsAt, status, state, editable`); `Icon` (de `./Icon`); `Link` (de `react-router-dom`); `useQuery` (de `@tanstack/react-query`).
- Produces: `export function VotingBanner(): JSX.Element | null` — sem props. Consumido por `HomePage` (Task 3).

- [ ] **Step 1: Escrever os testes do `VotingBanner`**

Cria `apps/web/src/components/VotingBanner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { VotingBanner } from './VotingBanner'
import { apiFetch } from '../lib/api'
import type { Mock } from 'vitest'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function routePeriods(current: unknown, next: unknown) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/periods/current') return Promise.resolve({ period: current })
    if (path === '/periods/next') return Promise.resolve({ period: next })
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VotingBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-26T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('mostra faixa de votação aberta com prazo e link para votar', async () => {
    routePeriods(
      { id: 'p1', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN', state: 'OPEN', editable: true },
      null,
    )
    wrap(<VotingBanner />)

    const banner = await screen.findByTestId('voting-banner-open')
    expect(banner).toHaveAttribute('href', '/votar')
    expect(banner).toHaveTextContent(/votação aberta/i)
    // De 26/06 até 30/06 ≈ 5 dias restantes.
    expect(banner).toHaveTextContent(/faltam 5 dias/i)
  })

  it('mostra faixa discreta com a data quando fechado mas há próximo período', async () => {
    routePeriods(
      null,
      { id: 'p2', monthRef: '2026-07', startsAt: '2026-07-01T00:00:00.000Z', endsAt: '2026-07-31T23:59:59.000Z', status: 'SCHEDULED', state: 'UPCOMING', editable: true },
    )
    wrap(<VotingBanner />)

    const banner = await screen.findByTestId('voting-banner-closed')
    expect(banner).toHaveTextContent(/próxima votação começa em/i)
    expect(banner).toHaveTextContent(/julho/i)
  })

  it('não renderiza nada quando não há período aberto nem próximo', async () => {
    routePeriods(null, null)
    const { container } = wrap(<VotingBanner />)
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/periods/next'))
    expect(container.querySelector('[data-testid^="voting-banner"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web test -- VotingBanner`
Expected: FAIL — `Failed to resolve import './VotingBanner'`.

- [ ] **Step 3: Implementar `VotingBanner.tsx`**

Cria `apps/web/src/components/VotingBanner.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { VotingPeriodDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { useCurrentPeriod } from '../lib/use-current-period'
import { Icon } from './Icon'

/** Dias inteiros (arredondando pra cima) entre agora e a data ISO; nunca negativo. */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}

/**
 * Faixa de votação no topo da Home. Quando a votação está aberta, puxa a ação
 * com o prazo; quando fechada, anuncia a próxima data (se houver). Some quando
 * não há período aberto nem próximo.
 */
export function VotingBanner() {
  const { period, votingOpen, isLoading } = useCurrentPeriod()
  const nextQuery = useQuery({
    queryKey: ['period', 'next'],
    queryFn: () => apiFetch<{ period: VotingPeriodDTO | null }>('/periods/next'),
    enabled: !isLoading && !votingOpen,
  })

  if (isLoading) return null

  if (votingOpen && period) {
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

  const next = nextQuery.data?.period ?? null
  if (!next) return null

  return (
    <div
      data-testid="voting-banner-closed"
      className="flex items-center gap-sm rounded-xl border border-outline-variant/40 bg-surface-container px-lg py-md text-body-sm text-on-surface-variant"
    >
      <Icon name="event_upcoming" className="text-[18px] text-tertiary" />
      <span>
        Próxima votação começa em{' '}
        <span className="font-semibold text-on-surface">{formatDate(next.startsAt)}</span>.
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- VotingBanner`
Expected: PASS (3 testes).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/VotingBanner.tsx apps/web/src/components/VotingBanner.test.tsx
git commit -m "feat(home): faixa de votação contextual (VotingBanner)"
```

---

### Task 3: Página `HomePage`

Compõe os três blocos: `VotingBanner` + `MuralBanner` + título "Resenha do time" + `ResenhaFeed`. Coluna única, mobile-first.

**Files:**
- Create: `apps/web/src/pages/HomePage.tsx`
- Create: `apps/web/src/pages/HomePage.test.tsx`

**Interfaces:**
- Consumes: `VotingBanner` (de `../components/VotingBanner`, Task 2); `MuralBanner` (de `../components/MuralBanner`, existente — renderiza `null` quando o mural vem vazio); `ResenhaFeed` (de `./resenha/ResenhaFeed`, Task 1).
- Produces: `export function HomePage(): JSX.Element` — sem props. Consumido pelo `App.tsx` (Task 4).

- [ ] **Step 1: Escrever o teste do `HomePage`**

Cria `apps/web/src/pages/HomePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'
import { apiFetch } from '../lib/api'
import type { Mock } from 'vitest'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mural vazio, sem período aberto nem próximo, feed vazio: a Home ainda
    // mostra o cabeçalho da resenha e o composer.
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/periods/next') return Promise.resolve({ period: null })
      if (path === '/mural') return Promise.resolve({ items: [] })
      return Promise.resolve({ items: [], nextCursor: null })
    })
  })

  it('renderiza o título da resenha e o composer', async () => {
    wrap(<HomePage />)
    expect(await screen.findByRole('heading', { name: /resenha do time/i })).toBeInTheDocument()
    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- HomePage`
Expected: FAIL — `Failed to resolve import './HomePage'`.

- [ ] **Step 3: Implementar `HomePage.tsx`**

Cria `apps/web/src/pages/HomePage.tsx`:

```tsx
import { MuralBanner } from '../components/MuralBanner'
import { VotingBanner } from '../components/VotingBanner'
import { ResenhaFeed } from './resenha/ResenhaFeed'

/** Home "pulso do time": faixa de votação + mural + feed de resenha. */
export function HomePage() {
  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-lg p-lg md:p-xl">
      <VotingBanner />
      <MuralBanner />
      <div>
        <h1 className="mb-lg font-headline text-headline-lg text-on-surface">Resenha do time</h1>
        <ResenhaFeed />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- HomePage`
Expected: PASS (1 teste).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/HomePage.tsx apps/web/src/pages/HomePage.test.tsx
git commit -m "feat(home): página HomePage compondo votação + mural + resenha"
```

---

### Task 4: Roteamento — `/` vira a Home e remover `MuralBanner` do perfil

`HomeRoute` passa a renderizar `HomePage` para não-admin (em vez de redirecionar pro perfil). Admin continua indo pra `/admin`. E o `MuralBanner` sai do perfil próprio (agora vive na Home).

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `HomePage` (de `./pages/HomePage`, Task 3); `useAuth` (existente, retorna `{ user }` com `user.role` e `user.id`).
- Produces: rota `/` renderizando `HomePage` para não-admin; `ProfilePage` sem `MuralBanner`.

- [ ] **Step 1: Importar `HomePage` no `App.tsx`**

Em `apps/web/src/App.tsx`, adiciona junto aos imports de páginas (após a linha do `ProfilePage`, ~linha 12):

```tsx
import { HomePage } from './pages/HomePage'
```

- [ ] **Step 2: Trocar o redirect do `HomeRoute` pela renderização da Home**

Em `apps/web/src/App.tsx`, substitui a função `HomeRoute` (atualmente `App.tsx:38-48`) por:

```tsx
/**
 * Página inicial: o "pulso do time" (Home feed-first) para não-admin. Admins
 * vão para o painel de administração. (Esta rota vive dentro do ProtectedRoute,
 * então sempre há usuário autenticado aqui.)
 */
function HomeRoute() {
  const { user } = useAuth()
  if (user?.role === 'ADMIN') return <Navigate to="/admin" replace />
  return <HomePage />
}
```

- [ ] **Step 3: Remover o `MuralBanner` do `ProfilePage`**

Em `apps/web/src/pages/ProfilePage.tsx`:
- Remove o import `import { MuralBanner } from "../components/MuralBanner";` (linha ~27).
- Remove a renderização `{isOwnProfile && <MuralBanner />}` (linha ~171). Se `isOwnProfile` ficar sem outros usos após a remoção, deixe-o — é usado em outras partes do perfil; **não** remova a variável sem confirmar com grep (Step 4).

- [ ] **Step 4: Verificar que `isOwnProfile` ainda é usado e que `MuralBanner` não ficou órfão no perfil**

Run: `grep -n "isOwnProfile\|MuralBanner" apps/web/src/pages/ProfilePage.tsx`
Expected: nenhuma linha com `MuralBanner`; `isOwnProfile` ainda aparece em outros pontos (sem variável/import não usado). Se `isOwnProfile` não aparecer mais em lugar nenhum, remova sua declaração para não quebrar o typecheck (no-unused).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (sem import/variável não usados).

- [ ] **Step 6: Rodar a suíte web inteira**

Run: `pnpm --filter @legends/web test`
Expected: PASS — incluindo os testes existentes de `ProfilePage` (sem o banner) e `AppLayout`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(home): / renderiza a Home para não-admin e remove o mural do perfil"
```

---

## Self-Review

**Spec coverage:**
- Roteamento `/` → Home para não-admin, admin em `/admin`, perfil só em `/perfil/:id` → Task 4. ✓
- Faixa de votação contextual (aberto/fechado/sem período) → Task 2. ✓
- `MuralBanner` movido pro topo da Home e removido do perfil → Tasks 3 e 4. ✓
- `ResenhaFeed` extraído e reusado por Home e `/resenha` → Tasks 1 e 3. ✓
- `/resenha` mantida → Task 1 (ResenhaPage segue renderizando o feed). ✓
- Testes de `VotingBanner`, `HomePage`, `ResenhaFeed` → Tasks 1–3. ✓
- Sem mudança de contrato `@legends/shared`/backend → confirmado (só endpoints existentes). ✓

**Placeholder scan:** nenhum TBD/TODO; todo passo de código tem código completo. ✓

**Type consistency:** `ResenhaFeed`, `VotingBanner`, `HomePage` exportados sem props e consumidos com os mesmos nomes nas tasks seguintes; `VotingPeriodDTO` usado conforme o tipo real em `packages/shared/src/vote.ts`; `useCurrentPeriod` retorna `{ period, votingOpen, isLoading }` conforme `lib/use-current-period.ts`. ✓
