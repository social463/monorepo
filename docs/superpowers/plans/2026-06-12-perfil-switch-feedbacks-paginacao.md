# Switch Reconhecimentos/Feedbacks no perfil + paginação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No perfil DEV, alternar entre Reconhecimentos e Feedbacks com um controle segmentado (reusando `FeedbackSection`), e paginar as duas listas com "Carregar mais" (lotes de 10) sem o bloco de selos crescer junto.

**Architecture:** API ganha `offset`/`limit` + `hasMore` nos endpoints de votos e feedbacks (Prisma skip/take com take+1, slice na rota). Web: extrai `BadgeGallery`, adiciona estado de visualização + controle segmentado no `ProfilePage` (só DEV), e migra as listas de votos e feedbacks para `useInfiniteQuery` com botão "Carregar mais". Sem mudança de schema/DTO.

**Tech Stack:** Fastify + Prisma + vitest (API); React + React Query (`useInfiniteQuery`) + Tailwind + @testing-library/react (web). Monorepo pnpm. Estilo do repo: aspas simples, sem ponto-e-vírgula.

---

## Mapa de arquivos

- **Modify** `apps/api/src/services/profile-service.ts` — `listVotesReceived` aceita `offset`/`limit`.
- **Modify** `apps/api/src/routes/profile.ts` — rota `/users/:id/votes` parseia paginação + retorna `hasMore`.
- **Modify** `apps/api/src/routes/profile.test.ts` — testes de paginação dos votos.
- **Modify** `apps/api/src/services/feedback-service.ts` — `listFeedbacksForUser` aceita `offset`/`limit`.
- **Modify** `apps/api/src/routes/feedback.ts` — rota `/users/:id/feedbacks` parseia paginação + retorna `hasMore`.
- **Modify** `apps/api/src/routes/feedback.test.ts` — testes de paginação dos feedbacks.
- **Create** `apps/web/src/pages/profile/BadgeGallery.tsx` — galeria de selos extraída.
- **Modify** `apps/web/src/pages/ProfilePage.tsx` — usa BadgeGallery, switch DEV, `useInfiniteQuery` nos votos, "Carregar mais", `items-start`.
- **Modify** `apps/web/src/pages/ProfilePage.test.tsx` — mocks com `hasMore`, testes do switch e "Carregar mais".
- **Modify** `apps/web/src/pages/profile/FeedbackSection.tsx` — `useInfiniteQuery` + "Carregar mais".
- **Modify** `apps/web/src/pages/profile/FeedbackSection.test.tsx` — mocks com `hasMore` + teste "Carregar mais".

---

## Task 1: Paginação dos votos (API)

**Files:**
- Modify: `apps/api/src/services/profile-service.ts`
- Modify: `apps/api/src/routes/profile.ts`
- Test: `apps/api/src/routes/profile.test.ts`

- [ ] **Step 1: Escrever os testes que falham** em `apps/api/src/routes/profile.test.ts`, dentro do `describe` de votos (após o teste de filtro por categoria). Use os helpers/fixtures já presentes no arquivo para criar um `target` que recebeu vários votos. Padrão a seguir (adapte os nomes dos helpers ao que o arquivo já usa para criar usuário/categoria/período/voto):

```ts
  it('paginates received votes with limit and hasMore', async () => {
    const token = await authToken(app)
    const target = await makeUser('Alvo')
    const cat = await prisma.category.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    const period = await prisma.votingPeriod.create({ data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-28'), status: 'OPEN' } })
    // 3 votantes distintos: Vote tem @@unique([voterId, periodId]), então o mesmo
    // votante não pode votar 2x no mesmo período — use votantes diferentes.
    for (let i = 0; i < 3; i += 1) {
      const voter = await makeUser(`Votante ${i}`)
      await prisma.vote.create({ data: { voterId: voter.id, votedId: target.id, categoryId: cat.id, periodId: period.id, justification: `voto ${i}` } })
    }
    const page1 = await app.inject({ method: 'GET', url: `/users/${target.id}/votes?limit=2&offset=0`, headers: { authorization: `Bearer ${token}` } })
    expect(page1.statusCode).toBe(200)
    expect(page1.json().votes).toHaveLength(2)
    expect(page1.json().hasMore).toBe(true)
    const page2 = await app.inject({ method: 'GET', url: `/users/${target.id}/votes?limit=2&offset=2`, headers: { authorization: `Bearer ${token}` } })
    expect(page2.json().votes).toHaveLength(1)
    expect(page2.json().hasMore).toBe(false)
  })
```
> Antes de escrever, leia o topo de `profile.test.ts` para reaproveitar os helpers existentes (`authToken`, criação de usuários etc.). Se o `voterId` precisar ser único por período em outro teste, aqui é leitura — múltiplos votos do mesmo votante são aceitos para exercitar a paginação. Ajuste se o schema impuser unicidade.

- [ ] **Step 2: Rodar e confirmar que falha**
```bash
cd apps/api && pnpm test src/routes/profile.test.ts
```
Expected: FAIL — `hasMore` é `undefined` e `limit` é ignorado (retorna 3).

- [ ] **Step 3: Implementar no service** — em `apps/api/src/services/profile-service.ts`, troque a interface e a função:

```ts
interface VoteFilters {
  month?: string
  categorySlug?: string
  offset?: number
  limit?: number
}

export function listVotesReceived(userId: string, filters: VoteFilters): Promise<VoteWithRelations[]> {
  const limit = filters.limit ?? 10
  const offset = filters.offset ?? 0
  return prisma.vote.findMany({
    where: {
      votedId: userId,
      ...(filters.month ? { period: { monthRef: filters.month } } : {}),
      ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
    },
    include: voteInclude,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit + 1, // +1 para detectar hasMore sem query de count
  })
}
```
> Mantém o retorno como array (até `limit + 1` itens). Os testes existentes em `profile-service.test.ts` que chamam `listVotesReceived(target.id, {})` continuam válidos (default limit 10 ⇒ retorna ≤11; com 1 voto, length 1).

- [ ] **Step 4: Implementar na rota** — em `apps/api/src/routes/profile.ts`, substitua o handler de `/users/:id/votes`:

```ts
  app.get('/users/:id/votes', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = request.query as { month?: string; categorySlug?: string; offset?: string; limit?: string }
    const limit = clampLimit(query.limit)
    const offset = Math.max(0, Number(query.offset) || 0)
    const rows = await listVotesReceived(id, { month: query.month, categorySlug: query.categorySlug, offset, limit })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return reply.send({ votes: page.map(toVoteDTO), hasMore })
  })
```
E adicione, perto do topo do arquivo (após os imports), o helper compartilhado:
```ts
/** Normaliza o limit de paginação: default 10, mínimo 1, máximo 50. */
function clampLimit(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 10
  return Math.min(Math.floor(n), 50)
}
```

- [ ] **Step 5: Rodar e confirmar que passa**
```bash
cd apps/api && pnpm test src/routes/profile.test.ts src/services/profile-service.test.ts
```
Expected: PASS (novos + existentes). O teste antigo "lists received votes" (1 voto) segue verde (`hasMore: false`, length 1).

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/services/profile-service.ts apps/api/src/routes/profile.ts apps/api/src/routes/profile.test.ts
git commit -m "feat(api): paginacao (offset/limit/hasMore) em /users/:id/votes"
```

---

## Task 2: Paginação dos feedbacks (API)

**Files:**
- Modify: `apps/api/src/services/feedback-service.ts`
- Modify: `apps/api/src/routes/feedback.ts`
- Test: `apps/api/src/routes/feedback.test.ts`

- [ ] **Step 1: Escrever o teste que falha** em `apps/api/src/routes/feedback.test.ts` (após o teste "lista feedbacks do alvo em ordem decrescente"). Reuse os helpers do arquivo (criação de usuário/lead, `authToken`, `MSG`):

```ts
  it('pagina feedbacks com limit e hasMore', async () => {
    const token = await authToken(app)
    const target = await makeUser('Alvo')
    const a1 = await makeUser('Autor 1')
    const a2 = await makeUser('Autor 2')
    const a3 = await makeUser('Autor 3')
    for (const author of [a1, a2, a3]) {
      await prisma.feedback.create({ data: { authorId: author.id, targetId: target.id, message: 'feedback suficientemente longo' } })
    }
    const page1 = await app.inject({ method: 'GET', url: `/users/${target.id}/feedbacks?limit=2&offset=0`, headers: { authorization: `Bearer ${token}` } })
    expect(page1.statusCode).toBe(200)
    expect(page1.json().feedbacks).toHaveLength(2)
    expect(page1.json().hasMore).toBe(true)
    const page2 = await app.inject({ method: 'GET', url: `/users/${target.id}/feedbacks?limit=2&offset=2`, headers: { authorization: `Bearer ${token}` } })
    expect(page2.json().feedbacks).toHaveLength(1)
    expect(page2.json().hasMore).toBe(false)
  })
```
> Leia o topo de `feedback.test.ts` para usar os mesmos helpers (nomes de `makeUser`/`authToken`/`MSG` podem diferir — adapte). Os autores precisam ser distintos do alvo (regra anti-self-feedback).

- [ ] **Step 2: Rodar e confirmar que falha**
```bash
cd apps/api && pnpm test src/routes/feedback.test.ts
```
Expected: FAIL — `hasMore` undefined; `limit` ignorado.

- [ ] **Step 3: Implementar no service** — em `apps/api/src/services/feedback-service.ts`, troque `listFeedbacksForUser`:

```ts
export function listFeedbacksForUser(
  targetId: string,
  pagination: { offset?: number; limit?: number } = {},
): Promise<FeedbackWithAuthor[]> {
  const limit = pagination.limit ?? 10
  const offset = pagination.offset ?? 0
  return prisma.feedback.findMany({
    where: { targetId },
    include: feedbackInclude,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit + 1,
  })
}
```

- [ ] **Step 4: Implementar na rota** — em `apps/api/src/routes/feedback.ts`, substitua o handler GET:

```ts
  app.get('/users/:id/feedbacks', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = request.query as { offset?: string; limit?: string }
    const limit = clampLimit(query.limit)
    const offset = Math.max(0, Number(query.offset) || 0)
    const rows = await listFeedbacksForUser(id, { offset, limit })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return reply.send({ feedbacks: page.map(toFeedbackDTO), hasMore })
  })
```
E adicione o mesmo helper `clampLimit` perto do topo de `feedback.ts` (após os imports):
```ts
/** Normaliza o limit de paginação: default 10, mínimo 1, máximo 50. */
function clampLimit(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 10
  return Math.min(Math.floor(n), 50)
}
```

- [ ] **Step 5: Rodar e confirmar que passa**
```bash
cd apps/api && pnpm test src/routes/feedback.test.ts
```
Expected: PASS (novos + existentes; o teste de 1 feedback segue verde com `hasMore: false`).

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/services/feedback-service.ts apps/api/src/routes/feedback.ts apps/api/src/routes/feedback.test.ts
git commit -m "feat(api): paginacao (offset/limit/hasMore) em /users/:id/feedbacks"
```

---

## Task 3: Extrair `BadgeGallery` (web, refactor)

**Files:**
- Create: `apps/web/src/pages/profile/BadgeGallery.tsx`
- Modify: `apps/web/src/pages/ProfilePage.tsx`

- [ ] **Step 1: Criar `apps/web/src/pages/profile/BadgeGallery.tsx`**
```tsx
import { Link } from 'react-router-dom'
import type { AwardedBadgeDTO } from '@legends/shared'
import { BadgeEmblem } from '../../components/BadgeEmblem'

export function BadgeGallery({
  badges,
  emptyLabel,
  className = '',
}: {
  badges: AwardedBadgeDTO[]
  emptyLabel: string
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-outline-variant/40 bg-surface-container p-lg ${className}`}>
      <div className="mb-lg flex items-center justify-between">
        <h3 className="font-headline text-headline-md text-on-surface">Galeria de selos</h3>
        <Link to="/selos" className="font-label text-label-md text-primary hover:underline">
          Ver todos
        </Link>
      </div>
      {badges.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-3 gap-md">
          {badges.map((awarded) => (
            <div
              key={awarded.id}
              title={awarded.badge.description}
              className="group flex cursor-default flex-col items-center rounded-lg border border-outline-variant/20 bg-surface-container-high p-md transition-all hover:border-outline-variant/50"
            >
              <div className="mb-sm transition-transform group-hover:scale-110">
                <BadgeEmblem badge={awarded.badge} size={64} />
              </div>
              <p className="text-center font-label text-label-sm text-on-surface">{awarded.badge.name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Usar no `ProfilePage.tsx`** — importe `import { BadgeGallery } from './profile/BadgeGallery'`. No branch `!isLead`, substitua todo o `<div ...Galeria de selos...>...</div>` (col-span-5) por:
```tsx
        <BadgeGallery badges={badges} emptyLabel="Nenhum selo conquistado ainda." className="col-span-12 lg:col-span-5" />
```
No branch `isLead`, substitua o `<div ...Galeria de selos...>` por:
```tsx
          <BadgeGallery badges={badges} emptyLabel="Nenhum selo atribuído ainda." className="col-span-12 lg:col-span-5" />
```
Remova o import agora não usado de `BadgeEmblem` no `ProfilePage.tsx` se não houver mais uso.

- [ ] **Step 3: Build + testes (sem mudança de comportamento)**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/ProfilePage.test.tsx
```
Expected: verde — markup idêntico, os testes que verificam "Galeria de selos"/badges continuam passando.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/profile/BadgeGallery.tsx apps/web/src/pages/ProfilePage.tsx
git commit -m "refactor(web): extrai BadgeGallery do ProfilePage"
```

---

## Task 4: Switch Reconhecimentos/Feedbacks no perfil DEV (web)

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`
- Test: `apps/web/src/pages/ProfilePage.test.tsx`

- [ ] **Step 1: Escrever os testes que falham** em `apps/web/src/pages/ProfilePage.test.tsx`. O mock de `/users/u1/profile` já retorna `role: 'DEV'`. Adicione (dentro do `describe('ProfilePage')`):

```ts
  it('mostra o switch e alterna para feedbacks no perfil DEV', async () => {
    renderPage()
    // default: reconhecimentos
    expect(await screen.findByText('Histórico de reconhecimento')).toBeInTheDocument()
    // alterna para feedbacks
    fireEvent.click(screen.getByRole('button', { name: 'Feedbacks' }))
    expect(await screen.findByRole('heading', { name: 'Feedbacks' })).toBeInTheDocument()
    expect(screen.queryByText('Histórico de reconhecimento')).not.toBeInTheDocument()
    // volta
    fireEvent.click(screen.getByRole('button', { name: 'Reconhecimentos' }))
    expect(await screen.findByText('Histórico de reconhecimento')).toBeInTheDocument()
  })
```
Adicione ao `setupFetch` um handler para o endpoint de feedbacks (a aba feedbacks busca isso):
```ts
    if (path.startsWith('/users/u1/feedbacks')) {
      return Promise.resolve({ feedbacks: [], hasMore: false })
    }
```

- [ ] **Step 2: Rodar e confirmar que falha**
```bash
cd apps/web && pnpm test src/pages/ProfilePage.test.tsx
```
Expected: FAIL — não há botão "Feedbacks" (switch não existe).

- [ ] **Step 3: Implementar o switch** — em `apps/web/src/pages/ProfilePage.tsx`:

(a) Adicione o estado (junto aos outros `useState`):
```tsx
  const [profileView, setProfileView] = useState<'reconhecimentos' | 'feedbacks'>('reconhecimentos')
```

(b) Adicione um componente local `ViewToggle` no topo do arquivo (após `joinedLabel`):
```tsx
function ViewToggle({
  value,
  onChange,
}: {
  value: 'reconhecimentos' | 'feedbacks'
  onChange: (value: 'reconhecimentos' | 'feedbacks') => void
}) {
  const pill = (key: 'reconhecimentos' | 'feedbacks', label: string) => (
    <button
      type="button"
      onClick={() => onChange(key)}
      aria-pressed={value === key}
      className={`rounded-md px-lg py-sm font-label text-label-md transition-colors ${
        value === key ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="mb-lg inline-flex gap-1 rounded-lg border border-outline-variant/40 bg-surface-container p-1">
      {pill('reconhecimentos', 'Reconhecimentos')}
      {pill('feedbacks', 'Feedbacks')}
    </div>
  )
}
```

(c) Reestruture o branch `!isLead`. Substitua o atual `{!isLead && ( <div className="grid grid-cols-12 gap-lg"> …badges + histórico + categorias… </div> )}` por:
```tsx
      {!isLead && (
        <>
          <ViewToggle value={profileView} onChange={setProfileView} />
          <div className="grid grid-cols-12 items-start gap-lg">
            <BadgeGallery badges={badges} emptyLabel="Nenhum selo conquistado ainda." className="col-span-12 lg:col-span-5" />

            {profileView === 'reconhecimentos' ? (
              <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-7">
                {/* === Histórico de reconhecimento: MOVA para cá o conteúdo do painel atual
                       (header com os dois selects de mês/categoria + a lista de votos/empty).
                       Mantenha o mesmo markup. === */}
              </div>
            ) : (
              <FeedbackSection targetId={user.id} />
            )}

            {profileView === 'reconhecimentos' && (
              <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
                {/* === Categorias reconhecidas (barras): MOVA para cá o conteúdo atual. === */}
              </div>
            )}
          </div>
        </>
      )}
```
> O conteúdo interno do "Histórico de reconhecimento" e de "Categorias reconhecidas" é o mesmo que já existe — apenas movido para dentro dos novos wrappers condicionais. A `BadgeGallery` já foi adotada na Task 3; aqui ela passa a ficar dentro do grid `items-start`.

(d) No branch `isLead`, troque a `<div className="grid grid-cols-12 gap-lg">` por `<div className="grid grid-cols-12 items-start gap-lg">` (para o selo não esticar junto do FeedbackSection).

- [ ] **Step 4: Rodar e confirmar que passa**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/ProfilePage.test.tsx
```
Expected: PASS (switch alterna; reconhecimentos↔feedbacks). Os testes existentes seguem verdes.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): switch reconhecimentos/feedbacks no perfil DEV"
```

---

## Task 5: "Carregar mais" nos reconhecimentos (web)

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`
- Test: `apps/web/src/pages/ProfilePage.test.tsx`

- [ ] **Step 1: Escrever o teste que falha** em `apps/web/src/pages/ProfilePage.test.tsx`. Ajuste o handler de votos do `setupFetch` para paginar conforme o `offset`, e adicione o teste:

Substitua o handler `if (path.startsWith('/users/u1/votes'))` por uma versão paginada:
```ts
    if (path.startsWith('/users/u1/votes')) {
      const offset = Number(new URL(`http://x/${path}`).searchParams.get('offset') ?? '0')
      if (offset === 0) {
        return Promise.resolve({
          votes: [{ id: 'v1', voter: { id: 'u2', name: 'Carla' }, voted: { id: 'u1', name: 'Bruno Lima' }, category: { id: 'c1', name: 'Colaboração', slug: 'colaboracao' }, justification: 'Ajudou no incidente.', createdAt: '2026-06-02T00:00:00.000Z', periodId: 'p1', monthRef: '2026-06' }],
          hasMore: true,
        })
      }
      return Promise.resolve({
        votes: [{ id: 'v2', voter: { id: 'u3', name: 'Diego' }, voted: { id: 'u1', name: 'Bruno Lima' }, category: { id: 'c1', name: 'Colaboração', slug: 'colaboracao' }, justification: 'Revisou meu PR.', createdAt: '2026-05-02T00:00:00.000Z', periodId: 'p2', monthRef: '2026-05' }],
        hasMore: false,
      })
    }
```
Teste:
```ts
  it('carrega mais reconhecimentos ao clicar em "Carregar mais"', async () => {
    renderPage()
    expect(await screen.findByText('Ajudou no incidente.')).toBeInTheDocument()
    const more = await screen.findByRole('button', { name: 'Carregar mais' })
    fireEvent.click(more)
    expect(await screen.findByText('Revisou meu PR.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument())
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**
```bash
cd apps/web && pnpm test src/pages/ProfilePage.test.tsx
```
Expected: FAIL — não há botão "Carregar mais"; só o primeiro voto aparece.

- [ ] **Step 3: Migrar o votesQuery para `useInfiniteQuery`** — em `apps/web/src/pages/ProfilePage.tsx`:

(a) No import do react-query, troque `useQuery` por `useQuery, useInfiniteQuery` (mantém `useQuery` para o `profileQuery`).

(b) Substitua o `votesQuery` por:
```tsx
  const votesQuery = useInfiniteQuery({
    queryKey: ['profile-votes', id, categorySlug, month],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (categorySlug) params.set('categorySlug', categorySlug)
      if (month) params.set('month', month)
      params.set('offset', String(pageParam))
      params.set('limit', '10')
      return apiFetch<{ votes: VoteDTO[]; hasMore: boolean }>(`/users/${id}/votes?${params.toString()}`)
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.reduce((n, p) => n + p.votes.length, 0) : undefined,
    enabled: Boolean(id),
  })
```

(c) Troque a derivação `const votes = votesQuery.data?.votes ?? []` por:
```tsx
  const votes = votesQuery.data?.pages.flatMap((page) => page.votes) ?? []
```

(d) No fim da lista de votos (dentro do painel "Histórico de reconhecimento", após o bloco que renderiza os votos), adicione o botão:
```tsx
          {votesQuery.hasNextPage && (
            <button
              type="button"
              onClick={() => votesQuery.fetchNextPage()}
              disabled={votesQuery.isFetchingNextPage}
              className="mt-md w-full rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {votesQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
```
> Coloque o botão dentro do container do painel, depois do `{votes.length === 0 ? … : (…)}`.

- [ ] **Step 4: Rodar e confirmar que passa**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/ProfilePage.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): carregar mais nos reconhecimentos do perfil"
```

---

## Task 6: "Carregar mais" nos feedbacks (web)

**Files:**
- Modify: `apps/web/src/pages/profile/FeedbackSection.tsx`
- Test: `apps/web/src/pages/profile/FeedbackSection.test.tsx`

- [ ] **Step 1: Escrever/ajustar os testes** em `apps/web/src/pages/profile/FeedbackSection.test.tsx`. Leia o arquivo: ajuste o(s) mock(s) de `/users/:id/feedbacks` para a forma paginada `{ feedbacks, hasMore }` e pagine por `offset`. Adicione um teste de "Carregar mais" análogo (offset 0 → 1 feedback + `hasMore: true`; offset 1 → outro feedback + `hasMore: false`; clicar "Carregar mais" anexa o segundo e o botão some). Mantenha os testes existentes de criar/editar/excluir, ajustando os mocks de GET para a forma paginada.

> Siga o padrão de mock já usado no arquivo (vi.fn em `apiFetch`). Para os mocks de lista, retorne `{ feedbacks: [...], hasMore: false }` por padrão; para o teste de paginação, ramifique por `offset`.

- [ ] **Step 2: Rodar e confirmar que falha**
```bash
cd apps/web && pnpm test src/pages/profile/FeedbackSection.test.tsx
```
Expected: FAIL — sem "Carregar mais"; e os GET mocks com `{feedbacks, hasMore}` ainda lidos como `useQuery` (sem paginação).

- [ ] **Step 3: Migrar `FeedbackSection` para `useInfiniteQuery`** — em `apps/web/src/pages/profile/FeedbackSection.tsx`:

(a) Import: troque `useMutation, useQuery, useQueryClient` por `useInfiniteQuery, useMutation, useQueryClient`.

(b) Substitua o `feedbacksQuery`:
```tsx
  const feedbacksQuery = useInfiniteQuery({
    queryKey: ['feedbacks', targetId],
    queryFn: ({ pageParam }) =>
      apiFetch<{ feedbacks: FeedbackDTO[]; hasMore: boolean }>(
        `/users/${targetId}/feedbacks?offset=${pageParam}&limit=10`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.reduce((n, p) => n + p.feedbacks.length, 0) : undefined,
  })
```

(c) Troque `const feedbacks = feedbacksQuery.data?.feedbacks ?? []` por:
```tsx
  const feedbacks = feedbacksQuery.data?.pages.flatMap((page) => page.feedbacks) ?? []
```
(Os blocos `isLoading`/`isError` continuam usando `feedbacksQuery.isLoading`/`feedbacksQuery.isError`, que existem igualmente em `useInfiniteQuery`.)

(d) Após o `</ul>` da lista de feedbacks (dentro do mesmo container), adicione:
```tsx
      {feedbacksQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => feedbacksQuery.fetchNextPage()}
          disabled={feedbacksQuery.isFetchingNextPage}
          className="mt-md w-full rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {feedbacksQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
```
> Coloque o botão depois do bloco `{feedbacks.length === 0 ? … : (<ul>…</ul>)}`, ainda dentro do `<div className="…lg:col-span-7">`.

- [ ] **Step 4: Rodar e confirmar que passa (suíte web completa)**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test
```
Expected: tudo verde.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/profile/FeedbackSection.tsx apps/web/src/pages/profile/FeedbackSection.test.tsx
git commit -m "feat(web): carregar mais nos feedbacks"
```

---

## Verificação final

- [ ] **Suítes completas**
```bash
cd /Users/luccasecco/Documents/projetos/engineering_legends && pnpm --filter @legends/api test && pnpm --filter @legends/web test
```
Expected: API e web verdes.

- [ ] **Verificação manual** — subir API+web, logar, abrir `/perfil/:id` de um DEV: o controle segmentado aparece; "Reconhecimentos" mostra selos + histórico (com "Carregar mais" quando houver >10) + barras; "Feedbacks" mostra selos + a seção de feedbacks (com "Carregar mais"); o bloco de selos não estica ao carregar mais; perfil de LEAD não mostra o switch.
