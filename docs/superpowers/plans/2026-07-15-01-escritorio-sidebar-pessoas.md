# Escritório — Sidebar de pessoas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lista de pessoas do escritório ganha um menu de 3 pontinhos (chamar/seguir/ver perfil) por pessoa, uma lista de offline abaixo da online, e uma setinha de recolher/expandir em cada seção.

**Architecture:** Um componente novo `PeopleList` extrai o miolo das listas da `OfficePage`. Ele recebe presença (`occupants`, `youId`) + os três callbacks de ação (que a `OfficePage` já tem via `useOfficeInteractions`), busca o time por React Query (`GET /users`), deriva offline = time − presentes − você, e renderiza duas seções recolhíveis com um menu por linha. Zero backend novo, zero lógica nova de chamada/follow — só UI reusando o que já está na `main`.

**Tech Stack:** React 18 + React Query, Tailwind (tokens do projeto), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-15-escritorio-sidebar-pessoas-design.md`

## Global Constraints

- TypeScript **strict**, ESM. Strings ao usuário em **português**; comentários desta feature em português.
- **Reuso das ações:** o menu só chama `onCall/onFollow/onViewProfile` (que são `interactions.call/follow/viewProfile`). Nenhuma lógica nova de chamada/follow.
- **Offline = `GET /users` − `occupants` − `youId`.** `GET /users` já exclui admins e você. Presença (online) vem do WS (`occupants`), nunca do REST.
- **Regras do menu:** sua linha → só "Ver perfil"; linha online de outra pessoa → Chamar + Seguir + Ver perfil; linha offline → só "Ver perfil".
- **Um menu aberto por vez**, fecha em clique-fora, `Esc` e após a ação.
- **Default das setinhas:** Online **expandida**, Offline **recolhida**. Estado local, não persiste.
- **Visual das linhas online preservado** (iniciais + bolinha verde + "Ativo") — não introduzir avatar DiceBear aqui. Offline: bolinha **cinza** + "Offline".
- **Cirúrgico:** só o miolo das listas migra; o cabeçalho da sidebar (título, contador, botão recolher-sidebar, campo "Buscar pessoas" stub) fica **intocado** na `OfficePage`.
- Falha PRÉ-EXISTENTE conhecida, fora de escopo: `apps/web/src/pages/ProfilePage.test.tsx` (2 testes).
- Branch: `feat/escritorio-sidebar-pessoas` (criada de `origin/main`, spec commitado).

---

### Task 1: Componente `PeopleList` + helper `menuActionsFor`

**Files:**
- Create: `apps/web/src/office/PeopleList.tsx`
- Create: `apps/web/src/office/PeopleList.test.tsx`

**Interfaces:**
- Consumes: `OfficeOccupant`, `PublicUser` de `@legends/shared`; `apiFetch` de `../lib/api`; `Icon` de `../components/Icon`; `useQuery`.
- Produces: `PeopleList(props: PeopleListProps)` e `menuActionsFor(args)`, com:

```ts
export interface PeopleListProps {
  occupants: OfficeOccupant[]
  youId: string | null
  onCall: (userId: string) => void
  onFollow: (userId: string) => void
  onViewProfile: (userId: string) => void
}

export type PersonAction = 'call' | 'follow' | 'view-profile'
export function menuActionsFor(args: { isSelf: boolean; isOnline: boolean }): PersonAction[]
```

- [ ] **Step 1: Escrever os testes falhando**

`apps/web/src/office/PeopleList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OfficeOccupant, PublicUser } from '@legends/shared'

const apiFetchMock = vi.fn()
vi.mock('../lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }))

import { PeopleList, menuActionsFor } from './PeopleList'

function occ(userId: string, name: string): OfficeOccupant {
  return { userId, name, x: 5, y: 5, dir: 'down', skinColor: 'edb98a', clothingColor: '8fa7df' }
}
function pub(id: string, name: string): PublicUser {
  return {
    id, name, email: null, role: 'LEGEND', area: null, position: 'Dev', squad: null,
    photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
    active: true, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null,
  }
}

function renderList(props?: Partial<Parameters<typeof PeopleList>[0]>) {
  const onCall = vi.fn()
  const onFollow = vi.fn()
  const onViewProfile = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <PeopleList
        occupants={[occ('ana', 'Ana Silva'), occ('bruno', 'Bruno Costa')]}
        youId="ana"
        onCall={onCall}
        onFollow={onFollow}
        onViewProfile={onViewProfile}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onCall, onFollow, onViewProfile }
}

beforeEach(() => {
  apiFetchMock.mockReset()
  // /users exclui admins e você — devolve o resto do time (inclui um offline: carla)
  apiFetchMock.mockResolvedValue({ users: [pub('bruno', 'Bruno Costa'), pub('carla', 'Carla Dias')] })
})

describe('menuActionsFor', () => {
  it('sua linha → só ver perfil', () => {
    expect(menuActionsFor({ isSelf: true, isOnline: true })).toEqual(['view-profile'])
  })
  it('online de outra pessoa → chamar, seguir, ver perfil', () => {
    expect(menuActionsFor({ isSelf: false, isOnline: true })).toEqual(['call', 'follow', 'view-profile'])
  })
  it('offline → só ver perfil', () => {
    expect(menuActionsFor({ isSelf: false, isOnline: false })).toEqual(['view-profile'])
  })
})

describe('PeopleList', () => {
  it('lista os online (com "(você)") e o contador', async () => {
    renderList()
    expect(screen.getByText(/Ana Silva/)).toBeInTheDocument()
    expect(screen.getByText(/\(você\)/)).toBeInTheDocument()
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
    expect(screen.getByText('Online (2)')).toBeInTheDocument()
  })

  it('offline = time do /users menos os presentes e menos você', async () => {
    renderList()
    // Carla está no /users mas não em occupants → offline. Bruno está online. Ana é você.
    await screen.findByText('Offline (1)')
    // offline começa recolhida — expande para ver a Carla
    fireEvent.click(screen.getByRole('button', { name: /Offline/ }))
    await waitFor(() => expect(screen.getByText('Carla Dias')).toBeInTheDocument())
  })

  it('setinha de cada seção recolhe/expande a lista', async () => {
    renderList()
    // online começa aberta → Bruno visível; recolhe → some
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Online/ }))
    await waitFor(() => expect(screen.queryByText('Bruno Costa')).not.toBeInTheDocument())
    // reexpande
    fireEvent.click(screen.getByRole('button', { name: /Online/ }))
    await waitFor(() => expect(screen.getByText('Bruno Costa')).toBeInTheDocument())
  })

  it('menu de outra pessoa online tem as 3 ações e chamam os callbacks', async () => {
    const { onCall, onFollow, onViewProfile } = renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    const menu = screen.getByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Chamar' }))
    expect(onCall).toHaveBeenCalledWith('bruno')
    // menu fecha após a ação
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Seguir' }))
    expect(onFollow).toHaveBeenCalledWith('bruno')

    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Ver perfil' }))
    expect(onViewProfile).toHaveBeenCalledWith('bruno')
  })

  it('menu da SUA linha só tem "Ver perfil"', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Ana Silva' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Ver perfil' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Chamar' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Seguir' })).not.toBeInTheDocument()
  })

  it('menu de uma pessoa OFFLINE só tem "Ver perfil"', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Offline/ })) // expande
    await screen.findByText('Carla Dias')
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Carla Dias' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Ver perfil' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Chamar' })).not.toBeInTheDocument()
  })

  it('um menu aberto por vez; Esc e clique-fora fecham', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // abrir o da Ana fecha o do Bruno (um por vez)
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Ana Silva' }))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    // Esc fecha
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    // reabre e fecha por clique-fora
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('offline vazio mostra a frase discreta', async () => {
    apiFetchMock.mockResolvedValue({ users: [pub('bruno', 'Bruno Costa')] }) // só online
    renderList()
    expect(screen.getByText('Offline (0)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Offline/ }))
    await waitFor(() => expect(screen.getByText('Ninguém offline')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test src/office/PeopleList.test.tsx`
Expected: FAIL — `Cannot find module './PeopleList'`.

- [ ] **Step 3: Implementar o componente**

`apps/web/src/office/PeopleList.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { OfficeOccupant, PublicUser } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { Icon } from '../components/Icon'

export interface PeopleListProps {
  occupants: OfficeOccupant[]
  youId: string | null
  onCall: (userId: string) => void
  onFollow: (userId: string) => void
  onViewProfile: (userId: string) => void
}

export type PersonAction = 'call' | 'follow' | 'view-profile'

/**
 * Ações disponíveis no menu de uma pessoa. Chamar/seguir só fazem sentido para
 * OUTRA pessoa PRESENTE; a sua própria linha e qualquer offline só têm perfil.
 */
export function menuActionsFor(args: { isSelf: boolean; isOnline: boolean }): PersonAction[] {
  if (args.isSelf) return ['view-profile']
  if (args.isOnline) return ['call', 'follow', 'view-profile']
  return ['view-profile']
}

const ACTION_LABEL: Record<PersonAction, string> = {
  call: 'Chamar',
  follow: 'Seguir',
  'view-profile': 'Ver perfil',
}
const ACTION_ICON: Record<PersonAction, string> = {
  call: 'call',
  follow: 'directions_walk',
  'view-profile': 'account_circle',
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('')
      .slice(0, 2) || 'L'
  )
}

interface Person {
  userId: string
  name: string
  isSelf: boolean
  isOnline: boolean
}

export function PeopleList({ occupants, youId, onCall, onFollow, onViewProfile }: PeopleListProps) {
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState({ online: true, offline: false })

  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/users'),
    staleTime: 60_000,
  })

  const onlineIds = new Set(occupants.map((o) => o.userId))
  const online: Person[] = occupants.map((o) => ({
    userId: o.userId,
    name: o.name,
    isSelf: o.userId === youId,
    isOnline: true,
  }))
  const offline: Person[] = (data?.users ?? [])
    .filter((u) => !onlineIds.has(u.id) && u.id !== youId)
    .map((u) => ({ userId: u.id, name: u.name, isSelf: false, isOnline: false }))

  // Um menu por vez: fecha em Esc e em clique fora de qualquer raiz de menu.
  useEffect(() => {
    if (!openMenuUserId) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-people-menu-root]')) setOpenMenuUserId(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuUserId(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuUserId])

  // Se a pessoa com menu aberto sumir do mapa (e não estiver offline), fecha.
  useEffect(() => {
    if (!openMenuUserId) return
    const stillThere = online.some((p) => p.userId === openMenuUserId) || offline.some((p) => p.userId === openMenuUserId)
    if (!stillThere) setOpenMenuUserId(null)
  }, [online, offline, openMenuUserId])

  const runAction = (action: PersonAction, userId: string) => {
    if (action === 'call') onCall(userId)
    else if (action === 'follow') onFollow(userId)
    else onViewProfile(userId)
    setOpenMenuUserId(null)
  }

  const renderRow = (person: Person) => {
    const actions = menuActionsFor({ isSelf: person.isSelf, isOnline: person.isOnline })
    const menuOpen = openMenuUserId === person.userId
    return (
      <li key={person.userId} className="flex items-center gap-sm">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#9bd7ed] font-label text-label-lg text-[#24505f]">
          {initialsOf(person.name)}
          <span
            aria-hidden
            className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface-container ${
              person.isOnline ? 'bg-green-500' : 'bg-on-surface-variant/50'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-label text-label-md text-on-surface">
            {person.name}
            {person.isSelf ? ' (você)' : ''}
          </p>
          <p className="font-body text-body-sm text-on-surface-variant">
            {person.isOnline ? 'Ativo' : 'Offline'}
          </p>
        </div>

        <div className="relative shrink-0" data-people-menu-root>
          <button
            type="button"
            aria-label={`Ações para ${person.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setOpenMenuUserId(menuOpen ? null : person.userId)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="more_vert" className="text-[20px]" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container shadow-lg"
            >
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  onClick={() => runAction(action, person.userId)}
                  className="flex w-full items-center gap-sm px-md py-sm text-left font-label text-label-md text-on-surface transition-colors hover:bg-surface-container-highest"
                >
                  <Icon name={ACTION_ICON[action]} className="text-[18px]" />
                  {ACTION_LABEL[action]}
                </button>
              ))}
            </div>
          )}
        </div>
      </li>
    )
  }

  const section = (
    key: 'online' | 'offline',
    label: string,
    people: Person[],
    emptyText: string,
  ) => (
    <div className="mb-md">
      <button
        type="button"
        aria-expanded={expanded[key]}
        onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
        className="mb-sm flex w-full items-center gap-xs font-label text-label-sm text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <Icon name={expanded[key] ? 'expand_more' : 'chevron_right'} className="text-[18px]" />
        <span>
          {label} ({people.length})
        </span>
      </button>
      {expanded[key] &&
        (people.length === 0 ? (
          <p className="px-sm py-xs font-body text-body-sm text-on-surface-variant">{emptyText}</p>
        ) : (
          <ul className="flex flex-col gap-sm">{people.map(renderRow)}</ul>
        ))}
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto px-lg py-md">
      {section('online', 'Online', online, 'Ninguém online')}
      {section('offline', 'Offline', offline, 'Ninguém offline')}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test src/office/PeopleList.test.tsx`
Expected: PASS — os 3 do `menuActionsFor` + 8 do `PeopleList`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/PeopleList.tsx apps/web/src/office/PeopleList.test.tsx
git commit -m "feat(web): PeopleList com menu de ações, lista offline e seções recolhíveis"
```

---

### Task 2: Ligar `PeopleList` na `OfficePage`

Troca o miolo das listas (o bloco `<div class="flex-1 overflow-y-auto ...">` com a seção "Online" inline) por `<PeopleList/>`, preservando todo o resto da sidebar.

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `PeopleList` (task 1); `interactions.call/follow/viewProfile` (já existem na `OfficePage`).

- [ ] **Step 1: Substituir o bloco da lista na `OfficePage`**

Em `apps/web/src/pages/OfficePage.tsx`:

1. adicionar o import junto dos outros de `../office`:

```tsx
import { PeopleList } from '../office/PeopleList'
```

2. dentro do `<aside>`, substituir o bloco INTEIRO que hoje renderiza a lista online inline — o `div` que começa em
`<div className="flex-1 overflow-y-auto px-lg py-md">` e vai até o `</div>` que fecha logo antes de `</aside>` (a `<div>` com o cabeçalho "Online", o `<ul>` e o `.map` dos occupants) — por:

```tsx
            <PeopleList
              occupants={occupants}
              youId={youId}
              onCall={interactions.call}
              onFollow={interactions.follow}
              onViewProfile={interactions.viewProfile}
            />
```

O `<header>` (título/contador/botão recolher) e o bloco do campo "Buscar pessoas" **permanecem exatamente como estão**. A `OfficePage` não usa mais `initials`/o `.map` inline — remover só o que foi substituído; não tocar em mais nada.

- [ ] **Step 2: Ajustar o mock de `apiFetch` no teste da `OfficePage`**

Em `apps/web/src/pages/OfficePage.test.tsx`, o `PeopleList` agora chama `apiFetch('/users')`. O mock atual (`apiFetchMock.mockResolvedValue({ broadcastEnabled: false })`) responde isso a QUALQUER chamada, então `/users` viria sem `.users`. Tornar o mock ciente da URL: no `beforeEach` que hoje faz `apiFetchMock.mockResolvedValue({ broadcastEnabled: false })`, trocar por:

```tsx
    apiFetchMock.mockReset()
    apiFetchMock.mockImplementation((path: string) =>
      path === '/users'
        ? Promise.resolve({ users: [] })
        : Promise.resolve({ broadcastEnabled: false }),
    )
```

(Se o arquivo já tem `apiFetchMock.mockReset()` seguido do `mockResolvedValue`, substituir as duas linhas por essas.)

- [ ] **Step 3: Rodar o teste da `OfficePage` e ver passar**

Run: `pnpm --filter @legends/web test src/pages/OfficePage.test.tsx`
Expected: PASS — os testes existentes continuam verdes (a lista online mostra Ana/Bruno via `PeopleList`; "Online" agora é "Online (2)", mas as asserções existentes usam `getByText('Online')`/nomes, que seguem presentes; o teste de recolher a sidebar usa o botão do header, intocado).

Se alguma asserção existente casava com texto exato que mudou (ex. um `getByText('Online')` que agora é `Online (2)` num mesmo nó), ajuste-a para `getByText(/Online/)`. Não relaxe nenhuma asserção além do necessário para o texto do contador.

- [ ] **Step 4: Suíte web inteira + typecheck + build**

```bash
pnpm --filter @legends/web test
pnpm --filter @legends/web exec tsc -p tsconfig.json --noEmit
pnpm --filter @legends/web build
```
Expected: verde exceto as 2 falhas PRÉ-EXISTENTES do `ProfilePage.test.tsx`; tsc limpo; build ok.

- [ ] **Step 5: Verificação manual**

```bash
pnpm db:up
# exportar LIVEKIT_* no shell antes (a API não lê .env) — ver ledger de sessões anteriores
env -u PORT pnpm dev   # com Node 20 no PATH
```
Em `/escritorio`, abrir a sidebar de pessoas:
1. Cada pessoa online (menos você) tem `⋮` com Chamar/Seguir/Ver perfil; a sua linha e as offline têm só Ver perfil.
2. "Chamar"/"Seguir" pelo menu disparam o mesmo popup/caminhada do card.
3. A seção "Offline (N)" aparece abaixo, recolhida; a setinha expande e mostra o resto do time com bolinha cinza.
4. As setinhas de Online e Offline recolhem/expandem cada lista.
5. Abrir um menu e clicar fora / apertar Esc fecha; abrir outro fecha o primeiro.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(web): usa PeopleList na sidebar do escritório"
```

---

## Depois do v1 (fora deste plano)

Busca funcional no campo "Buscar pessoas"; status/humor por pessoa; ordenar por atividade; persistir seções recolhidas; avatar DiceBear nas linhas.
