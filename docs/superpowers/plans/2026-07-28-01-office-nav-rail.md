# Rail de navegação do escritório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o dock do canto superior direito e o botão avulso de "pessoas online" por um rail vertical fino e persistente na borda esquerda do escritório (Pessoas online, Notificações, Editar mapa), reaproveitando a linguagem visual "glass neon" da `MediaBar`.

**Architecture:** `NotificationBell` ganha um segundo prop de posicionamento (`anchor`) sem alterar seu uso em `AppLayout.tsx`. Um componente novo `OfficeNavRail` (apresentação pura) concentra os 3 itens. `OfficePage.tsx` reposiciona o painel de pessoas para nascer ao lado do rail e remove o dock antigo, mantendo a grade de câmeras onde estava antes da unificação recente (fora do rail).

**Tech Stack:** React 18, Tailwind 3, Vitest + Testing Library (jsdom).

## Global Constraints

- Nenhuma mudança de comportamento fora do escopo — só reorganização de layout/navegação do escritório.
- `NotificationBell` é compartilhado com `apps/web/src/components/AppLayout.tsx`: os dois props (`variant`, já existente; `anchor`, novo) têm defaults que preservam 100% o comportamento/visual atual lá.
- A "Grade de câmeras / N na sala" **não entra no rail** — continua fora dele, como estado de chamada ao vivo.
- O botão "Sair" continua na `MediaBar`, sem mudanças.
- Mensagens/aria-labels voltados ao usuário em português; os aria-labels dos itens migrados (`Expandir/Recolher pessoas online`, `Editar mapa`, `Notificações`) permanecem **idênticos** aos de hoje — isso preserva a maioria dos testes existentes sem precisar de alterações.
- Rodar só o(s) arquivo(s) de teste alterado durante a implementação; suíte completa só como checagem final.

---

### Task 1: `NotificationBell` — prop `anchor` para o dropdown

**Files:**
- Modify: `apps/web/src/components/NotificationBell.tsx`
- Test: `apps/web/src/components/NotificationBell.test.tsx`

**Interfaces:**
- Produces: prop `anchor?: 'bottom' | 'right'` (default `'bottom'`) em `NotificationBell`, usado pela Task 3 com `anchor="right"` dentro do rail do escritório.

- [ ] **Step 1: Escrever o teste do novo anchor**

Leia `apps/web/src/components/NotificationBell.test.tsx` primeiro para seguir o padrão de setup/mocks já usado (ex.: como `useUnreadCount`/`useNotifications` são mockados). Adicione um teste novo ao `describe('NotificationBell', ...)`:

```tsx
  it('com anchor="right", o dropdown abre à direita do ícone', () => {
    wrap(<NotificationBell anchor="right" />)
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }))

    const panel = screen.getByRole('menu')
    expect(panel).toHaveClass('left-full')
    expect(panel).not.toHaveClass('md:right-0')
  })

  it('sem anchor (ou "bottom"), o dropdown mantém o posicionamento atual', () => {
    wrap(<NotificationBell />)
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }))

    const panel = screen.getByRole('menu')
    expect(panel).toHaveClass('md:right-0')
    expect(panel).not.toHaveClass('left-full')
  })
```

(Ajuste os nomes de `wrap`/helpers de render para o que já existe no arquivo — não invente um novo helper de render.)

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/components/NotificationBell.test.tsx -t "anchor"`
Expected: FAIL — a prop `anchor` ainda não existe, e a classe `left-full` não é gerada.

- [ ] **Step 3: Implementar o prop `anchor`**

Em `apps/web/src/components/NotificationBell.tsx`, troque a assinatura da função:

```tsx
export function NotificationBell({ variant = 'default', anchor = 'bottom' }: { variant?: 'default' | 'bare'; anchor?: 'bottom' | 'right' } = {}) {
```

E troque o painel do dropdown (o `<div role="menu" className="fixed inset-x-sm top-[4.75rem] ...">`) para escolher a classe de posicionamento conforme `anchor`:

```tsx
      {open && (
        <div
          role="menu"
          className={
            anchor === 'right'
              ? 'absolute left-full top-0 z-50 ml-sm flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-lg'
              : 'fixed inset-x-sm top-[4.75rem] z-50 flex max-h-[calc(100vh-5.5rem)] flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-lg md:absolute md:left-auto md:right-0 md:top-full md:mt-sm md:block md:max-h-none md:w-80'
          }
        >
```

Não mude mais nada dentro desse `<div>` (cabeçalho "Notificações", lista, "Ver todas" continuam idênticos).

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/components/NotificationBell.test.tsx`
Expected: PASS (todos os testes, incluindo os 2 novos)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/NotificationBell.tsx apps/web/src/components/NotificationBell.test.tsx
git commit -m "feat(web): NotificationBell ganha prop anchor para dropdown à direita"
```

---

### Task 2: Criar `OfficeNavRail`

**Files:**
- Create: `apps/web/src/office/nav/office-nav-items.ts`
- Create: `apps/web/src/office/nav/OfficeNavRail.tsx`
- Test: `apps/web/src/office/nav/OfficeNavRail.test.tsx`

**Interfaces:**
- Consumes: `NotificationBell` (Task 1, com `variant="bare" anchor="right"`); `Icon` de `../../components/Icon`.
- Produces: `OfficeNavRail(props)` — ver assinatura abaixo — usado pela Task 3.

```ts
export function OfficeNavRail(props: {
  isGuest: boolean
  peopleOpen: boolean
  onTogglePeople: () => void
  canEditMap: boolean
  onEditMap: () => void
}): JSX.Element
```

Nota: `office-nav-items.ts` é um registro leve de ícone/rótulo (não um sistema de render dinâmico) — os 3 itens têm comportamentos heterogêneos demais (um é o componente `NotificationBell` inteiro, outro é toggle com estado, outro é ação única) para valer a pena um loop genérico agora; a extensão futura (novo item) significa: uma entrada nova aqui + um botão novo em `OfficeNavRail.tsx`, seguindo o padrão dos 3 existentes.

- [ ] **Step 1: Escrever o registro de itens**

Crie `apps/web/src/office/nav/office-nav-items.ts`:

```ts
export interface OfficeNavItemConfig {
  id: string
  icon: string
  label: string
}

export const OFFICE_NAV_ITEMS = {
  people: { id: 'people', icon: 'groups', label: 'Pessoas online' },
  notifications: { id: 'notifications', icon: 'notifications', label: 'Notificações' },
  editMap: { id: 'editMap', icon: 'edit', label: 'Editar mapa' },
} as const satisfies Record<string, OfficeNavItemConfig>
```

- [ ] **Step 2: Escrever o teste do componente**

Crie `apps/web/src/office/nav/OfficeNavRail.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { OfficeNavRail } from './OfficeNavRail'

vi.mock('../../lib/use-notifications', () => ({
  useUnreadCount: () => ({ data: { unreadCount: 0 } }),
  useNotifications: () => ({ data: { pages: [] } }),
  useMarkAllRead: () => ({ mutate: vi.fn() }),
}))

function wrap(ui: React.ReactElement) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function baseProps(overrides: Partial<Parameters<typeof OfficeNavRail>[0]> = {}) {
  return {
    isGuest: false,
    peopleOpen: false,
    onTogglePeople: vi.fn(),
    canEditMap: true,
    onEditMap: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('OfficeNavRail', () => {
  it('mostra os 3 itens quando não é convidado e pode editar o mapa', () => {
    wrap(<OfficeNavRail {...baseProps()} />)
    expect(screen.getByRole('button', { name: 'Expandir pessoas online' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar mapa' })).toBeInTheDocument()
  })

  it('convidado não vê Notificações nem Editar mapa', () => {
    wrap(<OfficeNavRail {...baseProps({ isGuest: true, canEditMap: false })} />)
    expect(screen.getByRole('button', { name: 'Expandir pessoas online' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Notificações' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar mapa' })).not.toBeInTheDocument()
  })

  it('canEditMap=false esconde Editar mapa mesmo sem ser convidado', () => {
    wrap(<OfficeNavRail {...baseProps({ canEditMap: false })} />)
    expect(screen.queryByRole('button', { name: 'Editar mapa' })).not.toBeInTheDocument()
  })

  it('clicar em Pessoas online chama onTogglePeople', () => {
    const onTogglePeople = vi.fn()
    wrap(<OfficeNavRail {...baseProps({ onTogglePeople })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expandir pessoas online' }))
    expect(onTogglePeople).toHaveBeenCalledOnce()
  })

  it('com peopleOpen, o botão de pessoas mostra o rótulo de recolher e fica marcado como pressionado', () => {
    wrap(<OfficeNavRail {...baseProps({ peopleOpen: true })} />)
    const button = screen.getByRole('button', { name: 'Recolher pessoas online' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicar em Editar mapa chama onEditMap', () => {
    const onEditMap = vi.fn()
    wrap(<OfficeNavRail {...baseProps({ onEditMap })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar mapa' }))
    expect(onEditMap).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/nav/OfficeNavRail.test.tsx`
Expected: FAIL — módulo `./OfficeNavRail` não existe.

- [ ] **Step 4: Implementar o componente**

Crie `apps/web/src/office/nav/OfficeNavRail.tsx`:

```tsx
import { NotificationBell } from '../../components/NotificationBell'
import { Icon } from '../../components/Icon'
import { OFFICE_NAV_ITEMS } from './office-nav-items'

const railButtonCls = (active: boolean) =>
  `office-toolbar-btn group relative flex h-11 w-11 items-center justify-center rounded-full border transition-all ${
    active
      ? 'border-primary-container/40 bg-primary-container/20 text-primary-container shadow-[0_0_15px_rgba(37,222,136,0.3)]'
      : 'border-transparent text-on-surface-variant hover:border-primary-container/30 hover:bg-primary-container/10 hover:text-primary-container hover:shadow-[0_0_15px_rgba(37,222,136,0.3)]'
  }`

/**
 * Rail vertical fino e persistente na borda esquerda do escritório
 * (Pessoas online, Notificações, Editar mapa) — mesma linguagem visual
 * "glass neon" da MediaBar. Não inclui a grade de câmeras (estado de
 * chamada ao vivo, fica fora do rail) nem "Sair" (ação de sessão, continua
 * na MediaBar).
 */
export function OfficeNavRail({
  isGuest,
  peopleOpen,
  onTogglePeople,
  canEditMap,
  onEditMap,
}: {
  isGuest: boolean
  peopleOpen: boolean
  onTogglePeople: () => void
  canEditMap: boolean
  onEditMap: () => void
}) {
  const peopleLabel = peopleOpen ? 'Recolher pessoas online' : 'Expandir pessoas online'

  return (
    <nav
      aria-label="Navegação do escritório"
      className="fixed inset-y-0 left-0 z-30 flex w-[68px] flex-col items-center gap-sm border-r border-primary-container/20 bg-surface/70 py-md backdrop-blur-xl"
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={peopleLabel}
        title={OFFICE_NAV_ITEMS.people.label}
        aria-pressed={peopleOpen}
        onClick={onTogglePeople}
        className={railButtonCls(peopleOpen)}
      >
        <Icon name={OFFICE_NAV_ITEMS.people.icon} className="text-[22px]" />
      </button>

      {!isGuest && <NotificationBell variant="bare" anchor="right" />}

      {!isGuest && canEditMap && (
        <button
          type="button"
          title={OFFICE_NAV_ITEMS.editMap.label}
          aria-label={OFFICE_NAV_ITEMS.editMap.label}
          onClick={onEditMap}
          className={railButtonCls(false)}
        >
          <Icon name={OFFICE_NAV_ITEMS.editMap.icon} className="text-[20px]" />
        </button>
      )}
    </nav>
  )
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/nav/OfficeNavRail.test.tsx`
Expected: PASS (6/6 testes)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/nav/office-nav-items.ts apps/web/src/office/nav/OfficeNavRail.tsx apps/web/src/office/nav/OfficeNavRail.test.tsx
git commit -m "feat(web): componente OfficeNavRail (rail de navegação do escritório)"
```

---

### Task 3: Integrar o rail em `OfficePage.tsx`

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Test: `apps/web/src/pages/OfficePage.test.tsx` (provavelmente sem mudanças — ver nota abaixo)

**Interfaces:**
- Consumes: `OfficeNavRail` (Task 2).

Esta task NÃO deve exigir mudanças em `OfficePage.test.tsx`: os aria-labels migrados (`Expandir/Recolher pessoas online`, `Editar mapa`, `Notificações`) são exatamente os mesmos de hoje, então os testes existentes que buscam por esses labels continuam funcionando, só que agora encontram o elemento dentro do rail em vez do dock antigo. Rode a suíte no fim e só ajuste algo se um teste falhar por um motivo real (nesse caso, pare e reporte — não é esperado que precise mudar nada aqui).

- [ ] **Step 1: Importar `OfficeNavRail` e remover o import de `NotificationBell` direto**

Em `apps/web/src/pages/OfficePage.tsx`, troque:

```tsx
import { NotificationBell } from '../components/NotificationBell'
```

por:

```tsx
import { OfficeNavRail } from '../office/nav/OfficeNavRail'
```

(`NotificationBell` deixa de ser usado diretamente em `OfficePage.tsx` — quem o usa agora é `OfficeNavRail`.)

- [ ] **Step 2: Reposicionar o painel de pessoas online**

Localize o bloco (por volta da linha 333, mas confirme pelo conteúdo, não pelo número — pode ter deslocado):

```tsx
      <div className="absolute inset-y-0 left-0 z-20 flex" onWheel={(event) => event.stopPropagation()}>
        {peopleSidebarOpen ? (
          <aside className="flex h-full w-[18.25rem] flex-col overflow-hidden border-r border-outline-variant/40 bg-surface-container/95 shadow-2xl backdrop-blur">
            <header className="border-b border-outline-variant/30 px-lg py-lg">
              <div className="mb-md flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <span className="font-label text-[11px] uppercase tracking-wide text-primary">Escritório virtual</span>
                  <h1 className="truncate font-headline text-headline-sm text-on-surface">Escritório</h1>
                  <p className="font-label text-label-sm text-on-surface-variant">
                    {connected ? countLabel : 'Conectando...'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Recolher pessoas online"
                  onClick={() => setPeopleSidebarOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                >
                  <Icon name="dock_to_left" className="text-[20px]" />
                </button>
              </div>
            </header>

            <div className="border-b border-outline-variant/20 px-lg py-md">
              <div className="flex items-center gap-sm rounded-lg bg-surface-container-high px-md py-sm text-on-surface-variant">
                <Icon name="search" className="text-[18px]" />
                <input
                  value={peopleSearch}
                  onChange={(event) => setPeopleSearch(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  onKeyUp={(event) => event.stopPropagation()}
                  placeholder="Buscar pessoas"
                  className="min-w-0 flex-1 bg-transparent font-body text-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
                />
              </div>
            </div>

            <PeopleList
              occupants={occupants}
              youId={youId}
              searchTerm={peopleSearch}
              onCall={interactions.call}
              onFollow={interactions.follow}
              onViewProfile={interactions.viewProfile}
            />
          </aside>
        ) : (
          <div className="p-3">
            <button
              type="button"
              aria-label="Expandir pessoas online"
              aria-expanded={false}
              onClick={() => setPeopleSidebarOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-outline-variant/40 bg-surface-container/95 text-on-surface-variant shadow-lg backdrop-blur transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            >
              <Icon name="dock_to_right" className="text-[21px]" />
            </button>
          </div>
        )}
      </div>
```

Troque por (o wrapper muda de `left-0` para `left-[68px]` — largura do rail —, e o branch "fechado" com o botão flutuante desaparece por completo; o `<aside>` interno **não muda em nada**):

```tsx
      <div className="absolute inset-y-0 left-[68px] z-20 flex" onWheel={(event) => event.stopPropagation()}>
        {peopleSidebarOpen && (
          <aside className="flex h-full w-[18.25rem] flex-col overflow-hidden border-r border-outline-variant/40 bg-surface-container/95 shadow-2xl backdrop-blur">
            <header className="border-b border-outline-variant/30 px-lg py-lg">
              <div className="mb-md flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <span className="font-label text-[11px] uppercase tracking-wide text-primary">Escritório virtual</span>
                  <h1 className="truncate font-headline text-headline-sm text-on-surface">Escritório</h1>
                  <p className="font-label text-label-sm text-on-surface-variant">
                    {connected ? countLabel : 'Conectando...'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Recolher pessoas online"
                  onClick={() => setPeopleSidebarOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                >
                  <Icon name="dock_to_left" className="text-[20px]" />
                </button>
              </div>
            </header>

            <div className="border-b border-outline-variant/20 px-lg py-md">
              <div className="flex items-center gap-sm rounded-lg bg-surface-container-high px-md py-sm text-on-surface-variant">
                <Icon name="search" className="text-[18px]" />
                <input
                  value={peopleSearch}
                  onChange={(event) => setPeopleSearch(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  onKeyUp={(event) => event.stopPropagation()}
                  placeholder="Buscar pessoas"
                  className="min-w-0 flex-1 bg-transparent font-body text-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
                />
              </div>
            </div>

            <PeopleList
              occupants={occupants}
              youId={youId}
              searchTerm={peopleSearch}
              onCall={interactions.call}
              onFollow={interactions.follow}
              onViewProfile={interactions.viewProfile}
            />
          </aside>
        )}
      </div>
```

- [ ] **Step 3: Remover o dock top-right, manter só a grade de câmeras**

Localize o bloco (comentário `{/* Área top-right: ... */}`):

```tsx
      <div className="absolute top-3 right-3 z-10 flex items-center gap-xs rounded-full border border-primary-container/20 bg-surface/70 p-1 shadow-2xl backdrop-blur-xl" onWheel={(event) => event.stopPropagation()}>
        {!isGuest && <NotificationBell variant="bare" />}

        {!editing.state.active && !isGuest && (
          <button
            type="button"
            title="Editar mapa"
            aria-label="Editar mapa"
            onClick={() => void editing.enter()}
            className="office-toolbar-btn flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-all hover:bg-white/10 hover:text-on-surface"
          >
            <Icon name="edit" className="text-[20px]" />
          </button>
        )}

        {inMeetingRoom && (
          <button
            type="button"
            aria-label={camerasExpanded ? 'Recolher grade de câmeras' : 'Abrir grade de câmeras'}
            onClick={() => setCamerasExpanded((value) => !value)}
            className={`office-toolbar-btn flex items-center gap-sm rounded-full border px-md py-sm transition-all ${
              camerasExpanded
                ? 'border-primary-container/40 bg-primary-container/20 text-primary-container shadow-[0_0_15px_rgba(37,222,136,0.3)]'
                : 'border-transparent text-on-surface-variant hover:border-primary-container/30 hover:bg-primary-container/10 hover:text-primary-container hover:shadow-[0_0_15px_rgba(37,222,136,0.3)]'
            }`}
          >
            <Icon name="grid_view" className="text-[20px]" />
            <span className="font-label text-label-sm">
              {roomOccupantCount} na sala
            </span>
          </button>
        )}
      </div>
```

Troque por (a grade de câmeras volta a ter seu próprio container, agora com fundo/borda vidro próprios já que não está mais dentro do dock compartilhado):

```tsx
      {inMeetingRoom && (
        <div className="absolute top-3 right-3 z-10" onWheel={(event) => event.stopPropagation()}>
          <button
            type="button"
            aria-label={camerasExpanded ? 'Recolher grade de câmeras' : 'Abrir grade de câmeras'}
            onClick={() => setCamerasExpanded((value) => !value)}
            className={`office-toolbar-btn flex items-center gap-sm rounded-full border px-md py-sm shadow-2xl backdrop-blur-xl transition-all ${
              camerasExpanded
                ? 'border-primary-container/40 bg-primary-container/20 text-primary-container shadow-[0_0_15px_rgba(37,222,136,0.3)]'
                : 'border-primary-container/20 bg-surface/70 text-on-surface-variant hover:border-primary-container/30 hover:bg-primary-container/10 hover:text-primary-container hover:shadow-[0_0_15px_rgba(37,222,136,0.3)]'
            }`}
          >
            <Icon name="grid_view" className="text-[20px]" />
            <span className="font-label text-label-sm">
              {roomOccupantCount} na sala
            </span>
          </button>
        </div>
      )}
```

- [ ] **Step 4: Renderizar o `OfficeNavRail`**

Logo depois do bloco do painel de pessoas online (Step 2), adicione:

```tsx
      <OfficeNavRail
        isGuest={isGuest}
        peopleOpen={peopleSidebarOpen}
        onTogglePeople={() => setPeopleSidebarOpen((value) => !value)}
        canEditMap={!editing.state.active}
        onEditMap={() => void editing.enter()}
      />
```

(`isGuest`, `editing`, `setPeopleSidebarOpen`, `peopleSidebarOpen` já existem no componente — não são criados nesta task.)

- [ ] **Step 5: Rodar a suíte de `OfficePage.test.tsx` e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: PASS (sem alterações no arquivo de teste — ver nota no início da task). Se algo falhar, leia a falha com atenção antes de tocar no teste: pode ser um sinal real de regressão na integração, não só um ajuste de string.

- [ ] **Step 6: Rodar `tsc --noEmit`**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx
git commit -m "feat(web): substitui dock top-right e botão de pessoas pelo OfficeNavRail"
```

---

### Task 4: Verificação final

**Files:** nenhum (só validação)

- [ ] **Step 1: Rodar a suíte completa do workspace web**

Run: `pnpm --filter @legends/web test`
Expected: PASS

- [ ] **Step 2: Rodar a suíte completa do monorepo** (subir Postgres com `pnpm db:up` se necessário)

Run: `pnpm db:up && pnpm test`
Expected: PASS

- [ ] **Step 3: Verificação visual manual no navegador**

Suba `pnpm dev`, entre no escritório, e confira:
- O rail aparece fixo na borda esquerda, com Pessoas online, Notificações (se não-convidado) e Editar mapa (se não-convidado e fora do modo de edição).
- Clicar em "Pessoas online" abre o painel ao lado do rail (não mais colado na borda esquerda da tela); clicar de novo fecha.
- Clicar em "Notificações" abre o dropdown à direita do ícone, sem cortar a lista; marca como lidas ao abrir, como já acontecia.
- Clicar em "Editar mapa" entra no modo de edição como antes.
- Dentro de uma sala de reunião, a "Grade de câmeras / N na sala" aparece no canto superior direito, independente do rail, com o destaque neon quando aberta.
- O cabeçalho principal do app (fora do escritório) continua com o sino de notificações exatamente como estava antes desta mudança.

Reporte o resultado (passou / o que não bateu) antes de considerar a task concluída.

- [ ] **Step 4: Commit final (se houver ajustes da verificação manual)**

Se a verificação manual não pedir ajustes, não há o que commitar nesta task.
