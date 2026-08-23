# Telas Responsivas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a web (`apps/web`) responsiva em mobile/tablet/desktop, colapsando a sidebar fixa para um rail compacto (tablet) e uma bottom tab bar (mobile).

**Architecture:** A montagem dos itens de navegação vira uma função pura compartilhada. A sidebar `<aside>` ganha classes responsivas (oculta no mobile, rail só-ícones no tablet, completa no desktop). Um novo componente `BottomNav` renderiza a tab bar mobile. As páginas recebem padding responsivo. Validação por screenshots Playwright.

**Tech Stack:** React 18, React Router, Tailwind (tokens custom de spacing/cor), Vitest + Testing Library, Playwright (MCP) para screenshots.

## Global Constraints

- Breakpoints padrão do Tailwind: `sm`=640, `md`=768, `lg`=1024, `xl`=1280.
- Desktop (`lg+`) NÃO pode regredir: sidebar `w-64` + `ml-64` permanecem idênticos.
- Tokens de spacing: `xs`=4px, `sm`=8px, `md`=16px, `lg`=24px, `xl`=40px, `gutter`=16px.
- Copy em pt-BR; manter rótulos existentes ("Time", "Lendas", "Votar", "Destaques", "Meu perfil", "Admin").
- Ícones via componente `Icon` (Material Symbols). Cores via tokens (`primary`, `surface-container`, etc.) — sem hex cru novo.
- Testes rodam com `pnpm --filter @legends/web test` (vitest run). Dev server: `pnpm --filter @legends/web dev` na porta 5173.

---

### Task 1: Extrair montagem de itens de navegação (`buildNavItems`)

Isola a lógica de montagem dos itens (hoje inline no `AppLayout`) numa função pura, para sidebar e bottom nav compartilharem a mesma fonte.

**Files:**
- Create: `apps/web/src/components/nav-items.ts`
- Create: `apps/web/src/components/nav-items.test.ts`

**Interfaces:**
- Produces:
  - `interface NavItem { to: string; label: string; icon: string; end?: boolean; showOpenBadge?: boolean }`
  - `function buildNavItems(args: { isAdmin: boolean; userId?: string }): NavItem[]`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/components/nav-items.test.ts
import { buildNavItems } from './nav-items'

describe('buildNavItems', () => {
  it('lista itens de admin sem "Votar" nem "Meu perfil"', () => {
    const items = buildNavItems({ isAdmin: true, userId: 'a1' })
    const labels = items.map((i) => i.label)
    expect(labels).toEqual(['Admin', 'Time', 'Lendas', 'Destaques'])
  })

  it('lista itens de dev com "Votar" e "Meu perfil" no fim', () => {
    const items = buildNavItems({ isAdmin: false, userId: 'u1' })
    const labels = items.map((i) => i.label)
    expect(labels).toEqual(['Time', 'Lendas', 'Votar', 'Destaques', 'Meu perfil'])
    expect(items.find((i) => i.label === 'Meu perfil')?.to).toBe('/perfil/u1')
    expect(items.find((i) => i.label === 'Votar')?.showOpenBadge).toBe(true)
  })

  it('omite "Meu perfil" quando não há userId', () => {
    const items = buildNavItems({ isAdmin: false })
    expect(items.map((i) => i.label)).not.toContain('Meu perfil')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: FAIL — `Failed to resolve import './nav-items'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/components/nav-items.ts
export interface NavItem {
  to: string
  label: string
  icon: string
  /** Only match the exact path (used for the home route). */
  end?: boolean
  /** Mostra o selo pulsante "Aberta" quando a votação está aberta. */
  showOpenBadge?: boolean
}

// Admins gerenciam a plataforma: não votam nem têm perfil próprio.
// Para eles, Admin é a ação principal e vem antes de Time.
export function buildNavItems(args: { isAdmin: boolean; userId?: string }): NavItem[] {
  const { isAdmin, userId } = args
  const items: NavItem[] = isAdmin
    ? [
        { to: '/admin', label: 'Admin', icon: 'shield_person' },
        { to: '/time', label: 'Time', icon: 'groups', end: true },
        { to: '/lendas', label: 'Lendas', icon: 'workspace_premium' },
        { to: '/destaques', label: 'Destaques', icon: 'trophy' },
      ]
    : [
        { to: '/time', label: 'Time', icon: 'groups', end: true },
        { to: '/lendas', label: 'Lendas', icon: 'workspace_premium' },
        { to: '/votar', label: 'Votar', icon: 'how_to_vote', showOpenBadge: true },
        { to: '/destaques', label: 'Destaques', icon: 'trophy' },
      ]
  if (!isAdmin && userId) {
    items.push({ to: `/perfil/${userId}`, label: 'Meu perfil', icon: 'person' })
  }
  return items
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/nav-items.ts apps/web/src/components/nav-items.test.ts
git commit -m "refactor(web): extrair buildNavItems para nav compartilhada"
```

---

### Task 2: Componente `BottomNav` (tab bar mobile)

Barra de abas fixa no rodapé, visível só `< md`, renderizando os mesmos itens.

**Files:**
- Create: `apps/web/src/components/BottomNav.tsx`
- Create: `apps/web/src/components/BottomNav.test.tsx`

**Interfaces:**
- Consumes: `NavItem` de `./nav-items`.
- Produces: `function BottomNav(props: { items: NavItem[]; activeTo: string; votingOpen: boolean }): JSX.Element` — renderiza um `<nav aria-label="Navegação inferior">`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/BottomNav.test.tsx
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import type { NavItem } from './nav-items'

const items: NavItem[] = [
  { to: '/time', label: 'Time', icon: 'groups', end: true },
  { to: '/votar', label: 'Votar', icon: 'how_to_vote', showOpenBadge: true },
]

function renderNav(props: Partial<{ activeTo: string; votingOpen: boolean }> = {}) {
  return render(
    <MemoryRouter>
      <BottomNav items={items} activeTo={props.activeTo ?? '/time'} votingOpen={props.votingOpen ?? false} />
    </MemoryRouter>,
  )
}

describe('BottomNav', () => {
  it('renderiza um link por item dentro do landmark inferior', () => {
    renderNav()
    const nav = screen.getByRole('navigation', { name: /navegação inferior/i })
    expect(within(nav).getByRole('link', { name: /time/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /votar/i })).toBeInTheDocument()
  })

  it('marca o item ativo com aria-current', () => {
    renderNav({ activeTo: '/votar' })
    const nav = screen.getByRole('navigation', { name: /navegação inferior/i })
    expect(within(nav).getByRole('link', { name: /votar/i })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /time/i })).not.toHaveAttribute('aria-current')
  })

  it('mostra o selo "Aberta" no Votar só quando a votação está aberta', () => {
    const { rerender } = renderNav({ votingOpen: false })
    expect(screen.queryByText(/aberta/i)).not.toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <BottomNav items={items} activeTo="/time" votingOpen />
      </MemoryRouter>,
    )
    expect(screen.getByText(/aberta/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/components/BottomNav.test.tsx`
Expected: FAIL — `Failed to resolve import './BottomNav'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/src/components/BottomNav.tsx
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import type { NavItem } from './nav-items'

interface BottomNavProps {
  items: NavItem[]
  activeTo: string
  votingOpen: boolean
}

/**
 * Tab bar fixa no rodapé para navegação mobile (< md). No desktop/tablet fica
 * oculta (a sidebar assume). Espelha os itens de `buildNavItems`.
 */
export function BottomNav({ items, activeTo, votingOpen }: BottomNavProps) {
  return (
    <nav
      aria-label="Navegação inferior"
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-outline-variant/40 bg-surface-container-lowest/95 backdrop-blur-md md:hidden"
    >
      {items.map((item) => {
        const isActive = item.to === activeTo
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'relative flex flex-1 flex-col items-center gap-0.5 py-2 font-label text-[10px] transition-colors',
              isActive ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            <span className="relative">
              <Icon name={item.icon} filled={isActive} className="text-[24px]" />
              {item.showOpenBadge && votingOpen && (
                <span className="absolute -right-1 -top-0.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
              )}
            </span>
            <span>{item.label}</span>
            {item.showOpenBadge && votingOpen && <span className="sr-only">Aberta</span>}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/components/BottomNav.test.tsx`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/BottomNav.tsx apps/web/src/components/BottomNav.test.tsx
git commit -m "feat(web): componente BottomNav para navegação mobile"
```

---

### Task 3: AppLayout responsivo (rail tablet + bottom nav + header)

Refatora o `AppLayout` para usar `buildNavItems`/`BottomNav`, tornar a sidebar responsiva, adicionar logo mobile no header, esconder a busca no mobile e mover "Sair" para o menu do avatar. Atualiza o teste para conviver com itens de navegação duplicados (sidebar + bottom nav).

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/components/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `buildNavItems`, `NavItem` de `./nav-items`; `BottomNav` de `./BottomNav`.
- Produces: layout com `<nav aria-label="Navegação principal">` na sidebar e `<nav aria-label="Navegação inferior">` (via BottomNav).

- [ ] **Step 1: Update the AppLayout test to scope by landmark and expect duplicated nav**

Substitua o corpo do `describe` em `apps/web/src/components/AppLayout.test.tsx` por:

```tsx
describe('AppLayout — indicador de votação', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mostra o selo "Aberta" e o CTA de reconhecimento quando há período aberto', async () => {
    setupPeriod({
      id: 'p1',
      monthRef: '2026-06',
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-06-30T23:59:59.000Z',
      status: 'OPEN',
    })
    renderLayout()

    // "Aberta" aparece na sidebar e na bottom nav — basta haver ao menos um.
    expect((await screen.findAllByText(/aberta/i)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /fazer reconhecimento/i })).toBeInTheDocument()
  })

  it('esconde o selo "Aberta" e o CTA quando não há período aberto', async () => {
    setupPeriod(null)
    renderLayout()

    // O item Votar continua visível (sidebar + bottom nav) para alcançar a página de estado fechado.
    expect((await screen.findAllByRole('link', { name: /votar/i })).length).toBeGreaterThan(0)
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/periods/current'))
    expect(screen.queryByText(/aberta/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /fazer reconhecimento/i })).not.toBeInTheDocument()
  })

  it('inclui "Sair" no menu do avatar', async () => {
    setupPeriod(null)
    renderLayout()
    await screen.findAllByRole('link', { name: /votar/i })

    screen.getByRole('button', { name: /abrir menu da conta/i }).click()
    expect(screen.getByRole('menuitem', { name: /sair/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/components/AppLayout.test.tsx`
Expected: FAIL — o teste "inclui Sair no menu do avatar" falha (menuitem "Sair" ainda não existe); os outros já podem passar.

- [ ] **Step 3: Refactor AppLayout — nav compartilhada, sidebar responsiva, header, bottom nav**

Em `apps/web/src/components/AppLayout.tsx`:

a) Ajuste os imports do topo:

```tsx
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useCurrentPeriod } from "../lib/use-current-period";
import { Icon } from "./Icon";
import { Avatar } from "./Avatar";
import { buildNavItems } from "./nav-items";
import { BottomNav } from "./BottomNav";
```

b) Remova a `interface NavItem { ... }` local (agora vem de `./nav-items`) e substitua o bloco que monta `navItems` (o `const navItems: NavItem[] = isAdmin ? [...] : [...]` e o `if (user && !isAdmin) { navItems.push(...) }`) por:

```tsx
  const navItems = buildNavItems({ isAdmin, userId: user?.id });
```

c) Substitua a `<aside>` inteira (de `<aside ...>` até `</aside>`) por esta versão responsiva:

```tsx
      {/* SideNavBar — oculta no mobile; rail de ícones no tablet; completa no desktop */}
      <aside className="fixed left-0 top-0 z-50 hidden h-screen w-20 flex-col border-r border-outline-variant/40 bg-surface-container-lowest py-xl md:flex lg:w-64">
        <div className="mb-xl hidden px-lg lg:block">
          <h1 className="font-headline text-headline-md font-bold tracking-tight text-primary">
            Legends
          </h1>
          <p className="mt-1 font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
            Onde lendas nascem
          </p>
        </div>

        <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 px-sm">
          {navItems.map((item) => {
            const isActive = item.to === activeTo;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                title={item.label}
                className={[
                  "flex items-center gap-md rounded-md px-md py-sm font-label text-label-md transition-colors lg:justify-start justify-center",
                  isActive
                    ? "lg:border-r-2 lg:border-primary bg-primary/10 font-bold text-primary"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                ].join(" ")}
              >
                <Icon name={item.icon} filled={isActive} className="text-[22px]" />
                <span className="hidden lg:inline">{item.label}</span>
                {item.showOpenBadge && votingOpen && (
                  <span className="ml-auto hidden items-center gap-1 rounded-full bg-primary/15 py-0.5 pl-1.5 pr-2 font-label text-[10px] font-bold uppercase tracking-wide text-primary lg:flex">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    Aberta
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-sm lg:px-md">
          {!isAdmin && votingOpen && (
            <button
              type="button"
              onClick={() => navigate("/votar")}
              title="Fazer reconhecimento"
              className="mb-lg flex w-full items-center justify-center gap-sm rounded-md bg-primary py-md font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container active:scale-[0.98]"
            >
              <Icon name="add" className="text-[20px]" />
              <span className="hidden lg:inline">Fazer reconhecimento</span>
            </button>
          )}
          <div className="border-t border-outline-variant/40 pt-md">
            <button
              type="button"
              onClick={logout}
              title="Sair"
              className="flex w-full items-center gap-md rounded-md px-md py-sm text-body-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface lg:justify-start justify-center"
            >
              <Icon name="logout" className="text-[20px]" />
              <span className="hidden lg:inline">Sair</span>
            </button>
          </div>
        </div>
      </aside>
```

d) Ajuste a coluna principal (a `<div className="ml-64 flex min-h-screen flex-col">`) para margem responsiva:

```tsx
      {/* Main column */}
      <div className="ml-0 flex min-h-screen flex-col md:ml-20 lg:ml-64">
```

e) No header (`<header ...>`), substitua o `<label className="group relative block">...</label>` da busca por um bloco que mostra o logo no mobile e a busca só a partir de `sm`:

```tsx
          <h1 className="font-headline text-headline-md font-bold tracking-tight text-primary md:hidden">
            Legends
          </h1>

          <label className="group relative hidden sm:block">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant transition-colors group-focus-within:text-primary">
              <Icon name="search" className="text-[20px]" />
            </span>
            <input
              type="search"
              placeholder="Procurar colegas…"
              className="w-48 rounded-full border border-outline-variant/60 bg-surface-container-highest py-2 pl-10 pr-4 text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/30 lg:w-64"
            />
          </label>
```

f) Dentro do dropdown do avatar (o `<div role="menu" ...>`), adicione o item "Sair" depois do botão "Alterar senha" existente:

```tsx
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-sm px-lg py-md text-left font-label text-label-md text-on-surface transition-colors hover:bg-surface-container-highest"
                  >
                    <Icon name="logout" className="text-[20px] text-on-surface-variant" />
                    Sair
                  </button>
```

g) Logo após o fechamento do `<main>...</main>`, dentro da `<div>` da coluna principal, adicione a bottom nav:

```tsx
        <main className="flex-1 pb-24 md:pb-0">
          <Outlet />
        </main>

        <BottomNav items={navItems} activeTo={activeTo} votingOpen={votingOpen} />
```

(Observe que o `pb-24 md:pb-0` substitui o `flex-1` puro do `<main>`.)

- [ ] **Step 4: Run AppLayout tests to verify they pass**

Run: `pnpm --filter @legends/web exec vitest run src/components/AppLayout.test.tsx`
Expected: PASS (3 testes)

- [ ] **Step 5: Run the full web suite to catch regressions**

Run: `pnpm --filter @legends/web test`
Expected: PASS (toda a suíte verde)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AppLayout.tsx apps/web/src/components/AppLayout.test.tsx
git commit -m "feat(web): AppLayout responsivo com rail tablet e bottom nav mobile"
```

---

### Task 4: Padding responsivo nas páginas

Reduz o padding pesado (`p-xl` = 40px) no mobile para `p-lg` (24px), mantendo `xl` a partir de `md`. Mudança puramente de classe utilitária, sem alterar estrutura.

**Files:**
- Modify: `apps/web/src/pages/TeamPage.tsx`
- Modify: `apps/web/src/pages/VotePage.tsx`
- Modify: `apps/web/src/pages/ProfilePage.tsx`
- Modify: `apps/web/src/pages/LegendsPage.tsx`
- Modify: `apps/web/src/pages/HighlightsPage.tsx`
- Modify: `apps/web/src/pages/BadgesPage.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`

**Interfaces:** nenhuma nova. Apenas troca de className na `<section>` raiz de cada página.

- [ ] **Step 1: Aplicar padding responsivo em cada página**

Em cada arquivo, na `<section>` (ou container raiz) que hoje usa `p-xl`, troque `p-xl` por `p-lg md:p-xl`. Padrões exatos a substituir:

- `TeamPage.tsx`, `VotePage.tsx`, `ProfilePage.tsx`, `LegendsPage.tsx`, `HighlightsPage.tsx`:
  - De: `className="mx-auto max-w-7xl p-xl"`
  - Para: `className="mx-auto max-w-7xl p-lg md:p-xl"`
- `BadgesPage.tsx`:
  - De: `className="mx-auto flex max-w-7xl flex-col gap-lg p-xl"`
  - Para: `className="mx-auto flex max-w-7xl flex-col gap-lg p-lg md:p-xl"`
- `AdminPage.tsx`: localize o container raiz com `p-xl` (Grep `p-xl` no arquivo) e aplique a mesma troca `p-xl` → `p-lg md:p-xl`. Se a página não usar `p-xl`, deixe-a como está e registre isso no commit.

Comando para localizar todas as ocorrências antes de editar:

Run: `grep -rn "p-xl" apps/web/src/pages`

- [ ] **Step 2: Verificar build de tipos e lint via test run**

Run: `pnpm --filter @legends/web test`
Expected: PASS (mudanças de className não afetam testes; suíte continua verde)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages
git commit -m "style(web): padding responsivo nas páginas (p-lg no mobile)"
```

---

### Task 5: Validação visual com Playwright (screenshots)

Sobe o app e captura screenshots nas três faixas para confirmar o comportamento e que o desktop não regrediu. Não é teste automatizado — é um gate de revisão manual usando as ferramentas Playwright (MCP).

**Files:** nenhum arquivo de código alterado (a menos que a inspeção revele ajustes — nesse caso, voltar à task pertinente).

- [ ] **Step 1: Subir o app**

Run (background): `pnpm --filter @legends/web dev`
Garanta que o backend/API necessário esteja disponível (ver README/seed; usar credenciais de seed para login). App em `http://localhost:5173`.

- [ ] **Step 2: Capturar screenshots por faixa**

Para cada largura — 390px (mobile), 820px (tablet), 1440px (desktop) — usando as ferramentas Playwright: redimensionar a janela, navegar e fazer login, e capturar screenshot de cada tela:
- Login (`/`)
- Time (`/time`)
- Lendas (`/lendas`)
- Votar (`/votar`)
- Destaques (`/destaques`)
- Perfil (`/perfil/:id`)
- Admin (`/admin`, logado como ADMIN)

- [ ] **Step 3: Conferir critérios**

Verificar em cada screenshot:
- **Mobile (390px):** sidebar oculta; bottom nav visível com itens corretos e item ativo destacado; conteúdo não fica atrás da tab bar (graças ao `pb-24`); busca oculta; logo "Legends" no header; grids em coluna única.
- **Tablet (820px):** rail de ícones (`w-20`) sem labels; sem bottom nav; conteúdo com `ml-20`; grids em 2 colunas onde previsto.
- **Desktop (1440px):** idêntico ao layout atual (sidebar `w-64` com labels, `ml-64`).

- [ ] **Step 4: Registrar resultado**

Se tudo conforme: descrever os achados ao usuário e seguir. Se algum problema: abrir correção na task correspondente (1–4), re-testar, e só então concluir.

---

## Notas de execução

- Ordem das tasks é sequencial (3 depende de 1 e 2). Tasks 1 e 2 são independentes entre si e podem ser feitas em paralelo.
- Após Task 3, a suíte inteira deve estar verde — é o principal gate de regressão antes da validação visual.
