# Redesenho da tela Admin com abas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a tela Admin (hoje um scroll único de 6 painéis) em navegação por abas, com formulários de criação recolhíveis atrás de "+ Adicionar", quebrando o `AdminPage.tsx` monolítico em seções focadas.

**Architecture:** Front-end apenas. Extrai cada seção do `AdminPage.tsx` (~1023 linhas) para componentes em `apps/web/src/pages/admin/`, cada um auto-suficiente (próprias queries/mutations/estado). A casca `AdminPage` mantém o gate `isAdmin`, o cabeçalho, uma `TabBar` e um switch que renderiza só a seção da aba ativa. Sem mudança de back-end/DTO/schema.

**Tech Stack:** React + React Query + Tailwind, vitest + @testing-library/react. Monorepo pnpm.

**Estratégia de ordem:** primeiro extrair as seções (mantendo-as empilhadas, comportamento idêntico → testes seguem verdes), depois trocar o empilhamento por abas (migrando os testes), e por fim adicionar o reveal "+ Adicionar" dos formulários (atualizando os testes). Cada task termina com build + testes verdes e um commit.

---

## Mapa de arquivos

Estado inicial: tudo em `apps/web/src/pages/AdminPage.tsx`. Componentes auxiliares e seus intervalos atuais:
- `Panel` (22–32), `inputCls` (const, ~13–14)
- `MemberBadgesPanel` (35–159)
- `HighlightAdmin` (161–266)
- `PeriodRow` (268–356)
- `PeriodGroup` (358–384)
- `CollaboratorRow` (387–494)
- `AdminPage` (496–1023): estado/queries/mutations/handlers + JSX dos painéis: Período (754–811), Colaboradores (813–851), Selos (853–959) + `<MemberBadgesPanel>` (960), Categorias (962–996), Moderação (997–1021).

Estado final:
```
pages/AdminPage.tsx                  → casca (gate, header, TabBar, switch de aba)
pages/admin/shared.tsx               → Panel, inputCls
pages/admin/TabBar.tsx               → TabBar + ADMIN_TABS + AdminTabId
pages/admin/PeriodsSection.tsx       → PeriodsSection (+ HighlightAdmin, PeriodRow, PeriodGroup)
pages/admin/CollaboratorsSection.tsx → CollaboratorsSection (+ CollaboratorRow)
pages/admin/BadgesSection.tsx        → BadgesSection (Catálogo + MemberBadgesPanel)
pages/admin/CategoriesSection.tsx    → CategoriesSection
pages/admin/ModerationSection.tsx    → ModerationSection
pages/admin/TabBar.test.tsx          → teste unitário da TabBar
```

---

## Task 1: Extrair `Panel` e `inputCls` para `pages/admin/shared.tsx`

**Files:**
- Create: `apps/web/src/pages/admin/shared.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`

- [ ] **Step 1: Criar `shared.tsx`**

```tsx
import type { ReactNode } from 'react'

export const inputCls =
  'w-full rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/30'

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <div className="mb-lg flex flex-wrap items-center justify-between gap-md">
        <h3 className="font-headline text-headline-md text-on-surface">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}
```

- [ ] **Step 2: Em `AdminPage.tsx`, remover a definição local de `Panel` (linhas 22–32) e a const `inputCls` (~13–14), e importá-las**

Adicione perto do topo dos imports:
```tsx
import { Panel, inputCls } from './admin/shared'
```
Remova o `function Panel(...) {...}` e a `const inputCls = ...`. Se `ReactNode` ficar sem uso no import do React, remova-o do import.

- [ ] **Step 3: Build + testes**

Run:
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/AdminPage.test.tsx
```
Expected: typecheck sem erros; testes do AdminPage passam (comportamento inalterado).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/admin/shared.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "refactor(web): extrai Panel e inputCls para pages/admin/shared"
```

---

## Task 2: Criar `TabBar` (`pages/admin/TabBar.tsx`) + teste

**Files:**
- Create: `apps/web/src/pages/admin/TabBar.tsx`
- Test: `apps/web/src/pages/admin/TabBar.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

`apps/web/src/pages/admin/TabBar.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { TabBar, ADMIN_TABS } from './TabBar'

test('renderiza todas as abas e marca a ativa', () => {
  render(<TabBar activeTab="periodos" onChange={vi.fn()} />)
  for (const tab of ADMIN_TABS) {
    expect(screen.getByRole('tab', { name: tab.label })).toBeInTheDocument()
  }
  expect(screen.getByRole('tab', { name: 'Períodos' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'Selos' })).toHaveAttribute('aria-selected', 'false')
})

test('clicar numa aba chama onChange com o id', () => {
  const onChange = vi.fn()
  render(<TabBar activeTab="periodos" onChange={onChange} />)
  fireEvent.click(screen.getByRole('tab', { name: 'Selos' }))
  expect(onChange).toHaveBeenCalledWith('selos')
})
```

- [ ] **Step 2: Rodar e confirmar que falha**
```bash
cd apps/web && pnpm test src/pages/admin/TabBar.test.tsx
```
Expected: FAIL — `./TabBar` não existe.

- [ ] **Step 3: Implementar `TabBar.tsx`**
```tsx
export type AdminTabId = 'periodos' | 'colaboradores' | 'selos' | 'categorias' | 'moderacao'

export const ADMIN_TABS: { id: AdminTabId; label: string }[] = [
  { id: 'periodos', label: 'Períodos' },
  { id: 'colaboradores', label: 'Colaboradores' },
  { id: 'selos', label: 'Selos' },
  { id: 'categorias', label: 'Categorias' },
  { id: 'moderacao', label: 'Moderação' },
]

export function TabBar({ activeTab, onChange }: { activeTab: AdminTabId; onChange: (id: AdminTabId) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-outline-variant/40">
      {ADMIN_TABS.map((tab) => {
        const active = tab.id === activeTab
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`shrink-0 border-b-2 px-lg py-sm font-label text-label-md transition-colors ${
              active ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar que passa**
```bash
cd apps/web && pnpm test src/pages/admin/TabBar.test.tsx
```
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/admin/TabBar.tsx apps/web/src/pages/admin/TabBar.test.tsx
git commit -m "feat(web): componente TabBar para a navegacao do Admin"
```

---

## Tasks 3–7: Extrair seções (comportamento idêntico, ainda empilhadas)

**Princípio comum a todas:** cada seção vira `function XSection()` num arquivo próprio, que detém seu **próprio** estado, queries e mutations (movidos do `AdminPage`). Importa `Panel`/`inputCls` de `./shared`, `Icon` de `../../components/Icon`, `apiFetch`/`ApiError` de `../../lib/api`, `useQuery`/`useMutation`/`useQueryClient` de `@tanstack/react-query`, e os tipos de `@legends/shared`. As queries não precisam mais de `enabled: isAdmin` (a seção só é montada quando o usuário é admin, pois o `AdminPage` faz o gate antes). No `AdminPage`, remova o estado/queries/mutations/handlers/JSX daquela seção e renderize `<XSection />` no lugar do bloco antigo. Após cada task: `tsc --noEmit` + testes do AdminPage verdes (comportamento inalterado, seções ainda empilhadas).

### Task 3: `ModerationSection` (a mais simples — sem formulário)

**Files:**
- Create: `apps/web/src/pages/admin/ModerationSection.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`

- [ ] **Step 1: Criar `ModerationSection.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VoteDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Panel } from './shared'

export function ModerationSection() {
  const queryClient = useQueryClient()
  const votesQuery = useQuery({
    queryKey: ['admin', 'votes'],
    queryFn: () => apiFetch<{ votes: VoteDTO[] }>('/admin/votes'),
  })
  const removeVote = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/admin/votes/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'votes'] }),
  })

  return (
    <Panel title="Moderação de votos">
      {votesQuery.data && votesQuery.data.votes.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum voto registrado.</p>
      )}
      <ul className="flex flex-col gap-2">
        {votesQuery.data?.votes.map((vote) => (
          <li key={vote.id} className="flex items-start justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <div className="min-w-0">
              <p className="font-label text-label-md text-on-surface">
                {vote.voter.name} → {vote.voted.name}
                <span className="ml-2 font-body text-body-sm text-on-surface-variant">· {vote.category.name}</span>
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{vote.justification}</p>
            </div>
            <button
              onClick={() => removeVote.mutate(vote.id)}
              className="shrink-0 rounded-md border border-error/40 px-3 py-1 font-label text-label-sm text-error transition-colors hover:border-error"
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
```

- [ ] **Step 2: Em `AdminPage.tsx`, remover o que migrou e renderizar `<ModerationSection />`**

Remova: `votesQuery` (535–539) e `removeVote` (607–610). Substitua o bloco JSX `{/* Moderação */}` + `<Panel title="Moderação de votos">…</Panel>` (997–1021) por:
```tsx
      <ModerationSection />
```
Adicione o import: `import { ModerationSection } from './admin/ModerationSection'`. Se `VoteDTO` ficar sem uso no import de `@legends/shared` do AdminPage, remova-o.

- [ ] **Step 3: Build + testes**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/AdminPage.test.tsx
```
Expected: verde (o teste de moderação "removes a vote" continua passando).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/admin/ModerationSection.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "refactor(web): extrai ModerationSection"
```

### Task 4: `CategoriesSection`

**Files:**
- Create: `apps/web/src/pages/admin/CategoriesSection.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`

- [ ] **Step 1: Criar `CategoriesSection.tsx`** — mova para cá: o estado `categoryName`/`catError` (501–502), `categoriesQuery` (520–524, sem `enabled`), `createCategory` (546–555), `toggleCategory` (556–560), `handleCreateCategory` (688–692), e o JSX `<Panel title="Categorias">…</Panel>` (963–996). Estrutura:

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CategoryDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

export function CategoriesSection() {
  const queryClient = useQueryClient()
  const [categoryName, setCategoryName] = useState('')
  const [catError, setCatError] = useState<string | null>(null)

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => apiFetch<{ categories: CategoryDTO[] }>('/admin/categories'),
  })
  const createCategory = useMutation({
    mutationFn: (body: { name: string }) =>
      apiFetch<{ category: CategoryDTO }>('/admin/categories', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setCategoryName('')
      setCatError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] })
    },
    onError: (err) => setCatError(err instanceof ApiError ? err.message : 'Erro ao criar categoria.'),
  })
  const toggleCategory = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      apiFetch<{ category: CategoryDTO }>(`/admin/categories/${vars.id}`, { method: 'PATCH', body: JSON.stringify({ active: vars.active }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] }),
  })
  const categories = categoriesQuery.data?.categories ?? []

  function handleCreateCategory(event: FormEvent) {
    event.preventDefault()
    if (!categoryName.trim()) return
    createCategory.mutate({ name: categoryName.trim() })
  }

  return (
    <Panel title="Categorias">
      {/* COLE AQUI o conteúdo interno do bloco <Panel title="Categorias"> atual do AdminPage
          (localize pelo título "Categorias"): o <form onSubmit={handleCreateCategory}>…</form>,
          o bloco de erro catError, e o <ul> das categorias. É o mesmo markup, sem alterações. */}
    </Panel>
  )
}
```

> O conteúdo interno do painel de Categorias (form + erro + lista) deve ser copiado **verbatim** do `AdminPage.tsx` atual (linhas 836–866), pois usa exatamente `categoryName`, `setCategoryName`, `handleCreateCategory`, `catError`, `categories`, `toggleCategory`, `inputCls`, `Icon` — todos disponíveis neste componente.

- [ ] **Step 2: Em `AdminPage.tsx`** remover `categoryName`/`catError`, `categoriesQuery`, `createCategory`, `toggleCategory`, `handleCreateCategory`, a derivação `const categories = …` (651) e o bloco JSX Categorias (962–996), substituindo por `<CategoriesSection />`. Import: `import { CategoriesSection } from './admin/CategoriesSection'`. Remova `CategoryDTO` do import se ficar sem uso.

- [ ] **Step 3: Build + testes**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/AdminPage.test.tsx
```
Expected: verde (testes "creates a new category" e listagem continuam passando).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/admin/CategoriesSection.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "refactor(web): extrai CategoriesSection"
```

### Task 5: `CollaboratorsSection` (move `CollaboratorRow` junto)

**Files:**
- Create: `apps/web/src/pages/admin/CollaboratorsSection.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`

- [ ] **Step 1: Criar `CollaboratorsSection.tsx`** — mova para cá: `CollaboratorRow` (387–494) inteiro; o estado `devForm`/`devError` + `emptyDev` (510–512); `usersQuery` (530–534, sem `enabled`); `createUser` (593–601); `updateUser` (602–606); `handleCreateDev` (694–709); e o JSX `<Panel title="Colaboradores">…</Panel>` (813–851). Estrutura:

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicUser } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

// ----- Linha de colaborador (com edição inline) -----
function CollaboratorRow({ /* …mesma assinatura e corpo das linhas 387–494… */ }) { /* … */ }

export function CollaboratorsSection() {
  const queryClient = useQueryClient()
  const emptyDev = { name: '', email: '', password: '', position: '', squad: '', joinedAt: '' }
  const [devForm, setDevForm] = useState(emptyDev)
  const [devError, setDevError] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/admin/users'),
  })
  const createUser = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<{ user: PublicUser }>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setDevForm(emptyDev)
      setDevError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (err) => setDevError(err instanceof ApiError ? err.message : 'Erro ao criar colaborador.'),
  })
  const updateUser = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) =>
      apiFetch<{ user: PublicUser }>(`/admin/users/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  function handleCreateDev(event: FormEvent) {
    event.preventDefault()
    if (!devForm.name.trim() || !devForm.email.trim() || devForm.password.length < 8) {
      setDevError('Nome, e-mail e senha (mín. 8 caracteres) são obrigatórios.')
      return
    }
    const payload: Record<string, unknown> = {
      name: devForm.name.trim(),
      email: devForm.email.trim(),
      password: devForm.password,
      position: devForm.position.trim(),
      squad: devForm.squad.trim(),
    }
    if (devForm.joinedAt) payload.joinedAt = devForm.joinedAt
    createUser.mutate(payload)
  }

  return (
    <Panel title="Colaboradores">
      {/* COLE verbatim o conteúdo interno do <Panel title="Colaboradores"> atual (linhas 815–850):
          o <form onSubmit={handleCreateDev}>…</form> e o <ul> que mapeia usersQuery.data?.users em <CollaboratorRow>. */}
    </Panel>
  )
}
```

> `CollaboratorRow` (387–494) é copiado verbatim; ele já usa `inputCls`, `Icon`, `useState`, `PublicUser` — todos importados aqui. O `<ul>` interno usa `usersQuery.data?.users`, `updateUser.mutate` — disponíveis no componente.

- [ ] **Step 2: Em `AdminPage.tsx`** remover `CollaboratorRow`, `emptyDev`/`devForm`/`devError`, `usersQuery`, `createUser`, `updateUser`, `handleCreateDev`, e o bloco JSX Colaboradores (813–851), substituindo por `<CollaboratorsSection />`. Import correspondente. Remova `PublicUser` do import do AdminPage se ficar sem uso (atenção: `usersQuery` também era usado por `<MemberBadgesPanel>` na linha 960 — isso será tratado na Task 7; por enquanto a 960 ainda referencia `usersQuery`). 

> **Importante (ordem):** como a linha 960 (`<MemberBadgesPanel members={usersQuery.data?.users ?? []} …/>`) ainda depende de `usersQuery`, **não** remova `usersQuery` do AdminPage nesta task. Em vez disso, mantenha `usersQuery` no AdminPage por enquanto (ele fica duplicado: um no AdminPage para o MemberBadgesPanel, outro dentro do CollaboratorsSection). A Task 7 (BadgesSection) absorve o MemberBadgesPanel e aí o `usersQuery` do AdminPage é removido. O React Query deduplica a query (mesma key), então não há fetch duplicado problemático.

- [ ] **Step 3: Build + testes**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/AdminPage.test.tsx
```
Expected: verde (testes de editar colaborador / senha continuam passando).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/admin/CollaboratorsSection.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "refactor(web): extrai CollaboratorsSection"
```

### Task 6: `PeriodsSection` (move `HighlightAdmin`, `PeriodRow`, `PeriodGroup`)

**Files:**
- Create: `apps/web/src/pages/admin/PeriodsSection.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`

- [ ] **Step 1: Criar `PeriodsSection.tsx`** — mova para cá: `HighlightAdmin` (161–266), `PeriodRow` (268–356), `PeriodGroup` (358–384) verbatim; o estado `emptyPeriod`/`periodForm`/`periodError` (505–507); `periodsQuery` (525–529, sem `enabled`); `invalidatePeriods` (561–564), `schedulePeriod` (565–574), `closePeriod` (575–578), `updatePeriod` (579–591); os derivados `periods`/`activePeriods`/`scheduledPeriods`/`endedPeriods` (647–650); `handleMonthChange` (655–668); `handleSchedulePeriod` (670–683); `fmtRange` (685–686); e o JSX `<Panel title="Período de votação">…</Panel>` (754–811). Estrutura:

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VotingPeriodDTO, HighlightDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'
// + quaisquer imports que HighlightAdmin já use (ex.: nenhum extra além dos acima; conferir o corpo atual)

function HighlightAdmin({ period }: { period: VotingPeriodDTO }) { /* …verbatim 161–266… */ }
function PeriodRow({ /* … */ }) { /* …verbatim 268–356… */ }
function PeriodGroup({ /* … */ }) { /* …verbatim 358–384… */ }

export function PeriodsSection() {
  const queryClient = useQueryClient()
  const emptyPeriod = { monthRef: '', startsAt: '', endsAt: '' }
  const [periodForm, setPeriodForm] = useState(emptyPeriod)
  const [periodError, setPeriodError] = useState<string | null>(null)

  const periodsQuery = useQuery({
    queryKey: ['admin', 'periods'],
    queryFn: () => apiFetch<{ periods: VotingPeriodDTO[] }>('/admin/periods'),
  })
  const invalidatePeriods = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'periods'] })
    queryClient.invalidateQueries({ queryKey: ['period'] })
  }
  const schedulePeriod = useMutation({ /* …verbatim 565–574… */ })
  const closePeriod = useMutation({ /* …verbatim 575–578… */ })
  const updatePeriod = useMutation({ /* …verbatim 579–591… */ })

  const periods = periodsQuery.data?.periods ?? []
  const activePeriods = periods.filter((p) => p.state === 'ACTIVE')
  const scheduledPeriods = periods.filter((p) => p.state === 'SCHEDULED')
  const endedPeriods = periods.filter((p) => p.state === 'ENDED')

  function handleMonthChange(monthRef: string) { /* …verbatim 655–668… */ }
  function handleSchedulePeriod(event: FormEvent) { /* …verbatim 670–683… */ }
  const fmtRange = (startsAt: string, endsAt: string) =>
    `${new Date(startsAt).toLocaleDateString('pt-BR')} – ${new Date(endsAt).toLocaleDateString('pt-BR')}`

  return (
    <Panel title="Período de votação">
      {/* COLE verbatim o conteúdo interno do <Panel title="Período de votação"> atual (linhas 756–810):
          form de agendamento, os 3 <PeriodGroup>, e o aviso "Nenhum período cadastrado ainda." */}
    </Panel>
  )
}
```

> Conferir o corpo de `HighlightAdmin` (161–266) para reproduzir seus imports exatos (provavelmente usa `useState`, `useMutation`, `useQueryClient`, `apiFetch`, `ApiError`, `Icon`, `HighlightDTO`, `VotingPeriodDTO`, e talvez componentes de imagem/preview). Copiar todos os imports necessários para o topo do novo arquivo.

- [ ] **Step 2: Em `AdminPage.tsx`** remover tudo que migrou (componentes `HighlightAdmin`/`PeriodRow`/`PeriodGroup`, estado de período, `periodsQuery`, mutations de período, derivados, handlers, `fmtRange`) e o bloco JSX Período (754–811), substituindo por `<PeriodsSection />`. Import correspondente. Remova `VotingPeriodDTO`/`HighlightDTO` do import do AdminPage se ficarem sem uso.

- [ ] **Step 3: Build + testes**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/AdminPage.test.tsx
```
Expected: verde (testes de agendar/editar período continuam passando).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/admin/PeriodsSection.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "refactor(web): extrai PeriodsSection"
```

### Task 7: `BadgesSection` (Catálogo + `MemberBadgesPanel`)

**Files:**
- Create: `apps/web/src/pages/admin/BadgesSection.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`

- [ ] **Step 1: Criar `BadgesSection.tsx`** — mova para cá: `MemberBadgesPanel` (35–159) verbatim; o estado `emptyBadge`/`badgeForm`/`editingBadgeId`/`badgeError` (515–518); `badgesQuery` (540–544, sem `enabled`); o `usersQuery` (que o AdminPage ainda tinha por causa do MemberBadgesPanel) — recrie-o aqui; `createBadge` (612–621), `updateBadge` (622–632), `deleteBadge` (633–636); `startBadgeEdit` (711–722), `handleSubmitBadge` (724–743); e o JSX `<Panel title="Selos">…</Panel>` (853–959) + `<MemberBadgesPanel …/>` (960). Estrutura com as DUAS áreas:

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AwardedBadgeDTO, BadgeDTO, PublicUser } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { BadgeEmblem } from '../../components/BadgeEmblem'
import { BadgeArtPicker } from '../../components/BadgeArtPicker'
import { DEFAULT_ART_KEY } from '../../lib/badge-art'
import { Panel, inputCls } from './shared'

type BadgeKind = BadgeDTO['kind']

const BADGE_KINDS: { value: BadgeKind; label: string }[] = [
  { value: 'CATEGORY', label: 'Por categoria' },
  { value: 'IMPACT', label: 'Por impacto (total de votos)' },
  { value: 'RECURRENCE', label: 'Recorrência (meses distintos)' },
]

function MemberBadgesPanel({ members, badges }: { members: PublicUser[]; badges: BadgeDTO[] }) { /* …verbatim 35–159… */ }

export function BadgesSection() {
  const queryClient = useQueryClient()
  const emptyBadge = { name: '', description: '', kind: 'IMPACT' as BadgeKind, iconKey: DEFAULT_ART_KEY, threshold: 5, categorySlug: '' }
  const [badgeForm, setBadgeForm] = useState(emptyBadge)
  const [editingBadgeId, setEditingBadgeId] = useState<string | null>(null)
  const [badgeError, setBadgeError] = useState<string | null>(null)

  const badgesQuery = useQuery({
    queryKey: ['admin', 'badges'],
    queryFn: () => apiFetch<{ badges: BadgeDTO[] }>('/badges'),
  })
  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/admin/users'),
  })
  const createBadge = useMutation({ /* …verbatim 612–621… */ })
  const updateBadge = useMutation({ /* …verbatim 622–632… */ })
  const deleteBadge = useMutation({ /* …verbatim 633–636… */ })

  const badges = badgesQuery.data?.badges ?? []

  function startBadgeEdit(badge: BadgeDTO) { /* …verbatim 711–722… */ }
  function handleSubmitBadge(event: FormEvent) { /* …verbatim 724–743… */ }

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Catálogo de selos">
        {/* COLE verbatim o conteúdo interno do bloco <Panel title="Selos"> atual (localize pelo título "Selos"):
            o <form onSubmit={handleSubmitBadge}>…</form> (com BADGE_KINDS, BadgeArtPicker, etc.) e o <ul> que mapeia badges com BadgeEmblem + editar/excluir. */}
      </Panel>
      <MemberBadgesPanel members={usersQuery.data?.users ?? []} badges={badges} />
    </div>
  )
}
```

> O conteúdo interno do painel "Selos" atual (form de selo + grid de selos) é copiado verbatim (localize pelo título "Selos"); usa `badgeForm`, `setBadgeForm`, `editingBadgeId`, `badgeError`, `handleSubmitBadge`, `startBadgeEdit`, `deleteBadge.mutate`, `BADGE_KINDS`, `BadgeArtPicker`, `BadgeEmblem`, `Icon`, `inputCls`, `DEFAULT_ART_KEY` — todos disponíveis aqui. Conferir no `AdminPage.tsx` atual os imports de `BadgeEmblem`, `BadgeArtPicker`, `DEFAULT_ART_KEY`, `BADGE_KINDS`, `BadgeKind` para reproduzi-los. O título do painel muda de "Selos" para **"Catálogo de selos"**.

- [ ] **Step 2: Em `AdminPage.tsx`** remover `MemberBadgesPanel`, estado de selo, `badgesQuery`, `usersQuery` (agora sim — o último consumidor saiu), `createBadge`/`updateBadge`/`deleteBadge`, `startBadgeEdit`/`handleSubmitBadge`, a derivação `const badges = …` (652), os imports `BadgeEmblem`/`BadgeArtPicker`/`DEFAULT_ART_KEY`/`BADGE_KINDS`/`BadgeKind`/`AwardedBadgeDTO` se ficarem sem uso, e os blocos JSX Selos (853–959) + `<MemberBadgesPanel>` (960), substituindo por `<BadgesSection />`. Import correspondente.

> Após esta task, `AdminPage` não deve ter mais nenhuma query/mutation/estado de seção — só o gate `isAdmin` e o JSX renderizando as 5 seções empilhadas. O teste do painel "Selos por membro" (selecionar membro → conceder/revogar) deve continuar passando, pois o markup é idêntico.

- [ ] **Step 3: Build + testes**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/AdminPage.test.tsx
```
Expected: verde (todos os 11 testes, incluindo selos e selos por membro).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/pages/admin/BadgesSection.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "refactor(web): extrai BadgesSection com catalogo e concessao"
```

---

## Task 8: Trocar o empilhamento por abas + migrar os testes

**Files:**
- Modify: `apps/web/src/pages/AdminPage.tsx`
- Modify: `apps/web/src/pages/AdminPage.test.tsx`

- [ ] **Step 1: Reescrever o corpo do `AdminPage` para usar abas**

`AdminPage.tsx` deve ficar assim (a casca completa):
```tsx
import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Icon } from '../components/Icon'
import { TabBar, type AdminTabId } from './admin/TabBar'
import { PeriodsSection } from './admin/PeriodsSection'
import { CollaboratorsSection } from './admin/CollaboratorsSection'
import { BadgesSection } from './admin/BadgesSection'
import { CategoriesSection } from './admin/CategoriesSection'
import { ModerationSection } from './admin/ModerationSection'

export function AdminPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [activeTab, setActiveTab] = useState<AdminTabId>('periodos')

  if (!isAdmin) {
    return (
      <div className="m-xl flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
        <Icon name="lock" className="text-[20px]" />
        Acesso restrito a administradores.
      </div>
    )
  }

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-lg p-xl">
      <header>
        <h2 className="font-headline text-headline-xl text-on-surface">Administração</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Gerencie desenvolvedores, selos, categorias, períodos e moderação.
        </p>
      </header>
      <TabBar activeTab={activeTab} onChange={setActiveTab} />
      {activeTab === 'periodos' && <PeriodsSection />}
      {activeTab === 'colaboradores' && <CollaboratorsSection />}
      {activeTab === 'selos' && <BadgesSection />}
      {activeTab === 'categorias' && <CategoriesSection />}
      {activeTab === 'moderacao' && <ModerationSection />}
    </section>
  )
}
```
Remova quaisquer imports agora não usados (`useQuery`, `useMutation`, `useQueryClient`, `apiFetch`, `ApiError`, tipos DTO, `Panel`, `inputCls`, etc.).

- [ ] **Step 2: Migrar `AdminPage.test.tsx` — adicionar helper de navegação e prefixar cada teste**

No topo do arquivo de teste (após os imports), adicione:
```tsx
async function goToTab(name: string) {
  fireEvent.click(await screen.findByRole('tab', { name }))
}
```
Em cada teste existente, **antes** de interagir com o conteúdo de uma seção, navegue até a aba correspondente:
- Testes de categoria → `await goToTab('Categorias')`
- Testes de período → `await goToTab('Períodos')` (é a aba default, mas deixe explícito)
- Testes de colaborador → `await goToTab('Colaboradores')`
- Testes de selo / selos por membro → `await goToTab('Selos')`
- Teste de moderação (remover voto) → `await goToTab('Moderação')`

Exemplo (teste de categoria), padrão a replicar:
```tsx
it('creates a new category', async () => {
  setupFetch()
  renderPage()
  await goToTab('Categorias')
  // …resto do teste como estava…
})
```

- [ ] **Step 3: Adicionar testes de navegação**

```tsx
it('mostra a aba Períodos por padrão e troca de aba ao clicar', async () => {
  setupFetch()
  renderPage()
  // Períodos é a default: o painel de período aparece
  expect(await screen.findByText('Período de votação')).toBeInTheDocument()
  // Trocar para Categorias mostra o painel de categorias e esconde o de período
  await goToTab('Categorias')
  expect(await screen.findByText('Categorias')).toBeInTheDocument()
  expect(screen.queryByText('Período de votação')).not.toBeInTheDocument()
})
```
> Ajuste os textos-âncora (`'Período de votação'`, `'Categorias'`) ao que de fato renderiza como título de `Panel` em cada seção. Se "Categorias" colidir com outro texto, ancore no `heading`/`role` apropriado.

- [ ] **Step 4: Build + suíte web completa**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test
```
Expected: verde — todos os testes (AdminPage migrado + TabBar + navegação + demais).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/pages/AdminPage.tsx apps/web/src/pages/AdminPage.test.tsx
git commit -m "feat(web): navegacao por abas na tela Admin"
```

---

## Task 9: Formulários recolhíveis "+ Adicionar"

Aplica o reveal aos 4 formulários de criação (Períodos, Colaboradores, Selos/Catálogo, Categorias). Padrão idêntico em cada seção: estado `showForm`, botão de ação no slot `action` do `Panel`, form renderizado só quando `showForm`, e colapso automático ao salvar.

**Files:**
- Modify: `apps/web/src/pages/admin/PeriodsSection.tsx`, `CollaboratorsSection.tsx`, `BadgesSection.tsx`, `CategoriesSection.tsx`
- Modify: `apps/web/src/pages/AdminPage.test.tsx`

- [ ] **Step 1: CategoriesSection** — adicionar reveal

No componente, adicione `const [showForm, setShowForm] = useState(false)`. No `createCategory.onSuccess`, adicione `setShowForm(false)` (além do reset atual). No JSX, passe um `action` ao `Panel` e condicione o form:
```tsx
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
    /* o <form onSubmit={handleCreateCategory}>…</form> existente */
  )}
  {/* o bloco de erro e o <ul> de categorias continuam sempre visíveis */}
</Panel>
```

- [ ] **Step 2: CollaboratorsSection** — mesmo padrão: `showForm` state; `createUser.onSuccess` → `setShowForm(false)`; `action` com "+ Adicionar colaborador"/"Cancelar"; o `<form onSubmit={handleCreateDev}>` só quando `showForm`; a lista `<ul>` sempre visível.

- [ ] **Step 3: PeriodsSection** — mesmo padrão: `showForm` state; `schedulePeriod.onSuccess` → `setShowForm(false)`; `action` com "+ Agendar período"/"Cancelar"; o `<form onSubmit={handleSchedulePeriod}>` só quando `showForm`; os `<PeriodGroup>` sempre visíveis.

- [ ] **Step 4: BadgesSection** — mesmo padrão no painel "Catálogo de selos": `showForm` state; `createBadge.onSuccess` **e** `updateBadge.onSuccess` → `setShowForm(false)`; em `startBadgeEdit`, adicionar `setShowForm(true)` (abrir o form ao editar); `action` no `Panel title="Catálogo de selos"` com rótulo `{showForm ? 'Cancelar' : '+ Adicionar selo'}` (ao cancelar, também limpar edição: `setEditingBadgeId(null); setBadgeForm(emptyBadge); setBadgeError(null)`); o `<form onSubmit={handleSubmitBadge}>` só quando `showForm`; o grid de selos sempre visível. O `MemberBadgesPanel` não muda.

- [ ] **Step 5: Atualizar os testes que interagem com formulários**

Os testes que criam/editam via formulário agora precisam **revelar** o form primeiro. Após `goToTab(...)`, clique no botão de adicionar antes de preencher:
- Teste "creates a new category": após `goToTab('Categorias')`, `fireEvent.click(screen.getByRole('button', { name: '+ Adicionar categoria' }))` antes de digitar o nome.
- Teste de criar colaborador (se houver): clicar "+ Adicionar colaborador" primeiro.
- Teste "concede um selo": o catálogo não é usado nesse fluxo (usa o `MemberBadgesPanel`), então **não** precisa revelar o form do catálogo; mas se algum teste cria/edita selo via catálogo, clicar "+ Adicionar selo" primeiro.
- Teste de editar colaborador: o botão "Editar" da `CollaboratorRow` não é afetado (edição inline na linha), então segue igual.
- Adicionar um teste de reveal:
```tsx
it('revela e recolhe o formulário de nova categoria', async () => {
  setupFetch()
  renderPage()
  await goToTab('Categorias')
  expect(screen.queryByLabelText('Nova categoria')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '+ Adicionar categoria' }))
  expect(screen.getByLabelText('Nova categoria')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByLabelText('Nova categoria')).not.toBeInTheDocument()
})
```
> Ajuste o `aria-label`/seletor (`'Nova categoria'`) ao que o input realmente expõe no markup atual.

- [ ] **Step 6: Build + suíte web completa**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test
```
Expected: verde.

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/pages/admin apps/web/src/pages/AdminPage.test.tsx
git commit -m "feat(web): formularios de criacao recolhiveis no Admin"
```

---

## Verificação final

- [ ] **Suíte web completa + typecheck**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test
```
Expected: tudo verde. (API intocada — não precisa rodar, mas `pnpm --filter @legends/api test` deve seguir 187 verdes.)

- [ ] **Verificação manual (com os servidores de dev já rodando em :3333/:5173)** — logar como admin, confirmar: a barra de abas aparece; cada aba mostra só sua seção; "+ Adicionar" revela/recolhe os formulários; criar categoria/colaborador/selo e agendar período funcionam; conceder/revogar selo na aba Selos funciona; moderação remove voto.
