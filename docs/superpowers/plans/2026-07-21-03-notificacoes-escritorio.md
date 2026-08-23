# Notificações e Convites no Escritório Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar o sino de notificações dentro do Escritório e disparar um toast clicável, dedicado, quando o usuário tem um convite não-lido (retro ou votação) e a atividade ainda está aberta.

**Architecture:** Tudo client-side, reaproveitando o polling REST de 45s já existente (sem WebSocket novo). O sino (`NotificationBell`) é remontado sem alterações dentro de `OfficePage`. Um hook novo (`useOfficeInviteToasts`) faz polling de notificações não-lidas, filtra pelos 4 tipos-alvo, checa se a atividade ainda está aberta (retro via `GET /retro/rooms/:id`, votação via `useCurrentPeriod`) e alimenta uma fila exibida por um componente novo (`InviteToastStack`). Duas correções pontuais no backend ajustam o `link` gravado pelas notificações de votação pra apontar pra `/votar`.

**Tech Stack:** TypeScript, React 18, React Query (`@tanstack/react-query`), React Router, Fastify, Prisma, Vitest + Testing Library.

## Global Constraints

- Sino e toast de convite só aparecem pra usuários autenticados (`!isGuest`) — guests não veem nenhum dos dois.
- Toast de convite é exclusivo da tela `/escritorio` — não aparece em nenhum outro lugar do site.
- Sem WebSocket/tempo real novo: tudo via polling REST já existente (45s), reaproveitando `useMarkRead` e `apiFetch` já existentes.
- Se a checagem "ainda aberta" falhar (404/403/erro de rede), o candidato é descartado silenciosamente — sem toast, sem popup de erro.
- Um convite só vira toast uma vez por sessão do Escritório (clicado, dispensado no X, ou expirado em ~10s → não reaparece enquanto a pessoa continuar lá, mesmo que o próximo polling ainda o traga como não-lido).
- Tipos-alvo do toast: `RETRO_INVITED`, `PERIOD_OPENED`, `VOTE_REMINDER_MIDWAY`, `VOTE_REMINDER_CLOSING`. Nenhum outro tipo de notificação vira toast.

---

### Task 1: Corrigir o link das notificações de votação pra `/votar`

**Files:**
- Modify: `apps/api/src/services/notification-service.ts:271-273`
- Modify: `apps/api/src/scheduler/vote-reminders.ts:70`
- Test: `apps/api/src/services/notification-service.test.ts`
- Test: `apps/api/src/scheduler/vote-reminders.test.ts`

**Interfaces:**
- Não expõe nada novo — só muda o valor de `link` gravado nas notificações `PERIOD_OPENED`, `VOTE_REMINDER_MIDWAY` e `VOTE_REMINDER_CLOSING`. Task 3 depende de `PERIOD_OPENED`/`VOTE_REMINDER_*` terem `link: '/votar'` pra decidir se o candidato é "de votação" ao montar o link do toast — mas na prática a Task 3 usa o `link` que já vem no DTO da notificação, então essa dependência é só de dado (o valor gravado), não de assinatura.

- [ ] **Step 1: Escrever o teste de `PERIOD_OPENED`**

Em `apps/api/src/services/notification-service.test.ts`, dentro do teste existente `'notifyPeriodOpened faz broadcast só para usuários ativos'` (linha ~100-106), adicionar a asserção de `link`:

```ts
  it('notifyPeriodOpened faz broadcast só para usuários ativos', async () => {
    const a = await makeUser('act@x.com', { active: true })
    const b = await makeUser('inact@x.com', { active: false })
    await notifyPeriodOpened({ monthRef: '2026-06' })
    expect(await prisma.notification.count({ where: { userId: a.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: b.id } })).toBe(0)
    const notif = await prisma.notification.findFirst({ where: { userId: a.id } })
    expect(notif?.link).toBe('/votar')
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts -t 'notifyPeriodOpened'`
Expected: FAIL — hoje `notif?.link` é `null`.

- [ ] **Step 3: Corrigir `notifyPeriodOpened`**

Em `apps/api/src/services/notification-service.ts:271-273`, trocar:

```ts
export async function notifyPeriodOpened(period: { monthRef: string }): Promise<void> {
  await broadcastToActive('PERIOD_OPENED', `A votação de ${monthLabel(period.monthRef)} está aberta!`)
}
```

por:

```ts
export async function notifyPeriodOpened(period: { monthRef: string }): Promise<void> {
  await broadcastToActive('PERIOD_OPENED', `A votação de ${monthLabel(period.monthRef)} está aberta!`, '/votar')
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts -t 'notifyPeriodOpened'`
Expected: PASS

- [ ] **Step 5: Escrever o teste de `VOTE_REMINDER_MIDWAY`**

Em `apps/api/src/scheduler/vote-reminders.test.ts`, no teste existente `'no ponto médio, notifica quem não votou (MIDWAY)'` (linhas 42-50), trocar a asserção de `link`:

```ts
  it('no ponto médio, notifica quem não votou (MIDWAY)', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(MIDWAY)
    const notifs = await prisma.notification.findMany({ where: { userId: u.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0].type).toBe('VOTE_REMINDER_MIDWAY')
    expect(notifs[0].link).toBe('/votar')
  })
```

- [ ] **Step 6: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/scheduler/vote-reminders.test.ts -t 'MIDWAY'`
Expected: FAIL — hoje `notifs[0].link` é `'/'`.

- [ ] **Step 7: Corrigir `runVoteReminderTick`**

Em `apps/api/src/scheduler/vote-reminders.ts:70`, trocar:

```ts
      await createNotification({ userId: user.id, type, title, link: '/', metadata: { periodId: period.id } })
```

por:

```ts
      await createNotification({ userId: user.id, type, title, link: '/votar', metadata: { periodId: period.id } })
```

- [ ] **Step 8: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/scheduler/vote-reminders.test.ts src/services/notification-service.test.ts`
Expected: PASS (arquivos inteiros, incluindo os testes pré-existentes)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/notification-service.ts apps/api/src/scheduler/vote-reminders.ts apps/api/src/services/notification-service.test.ts apps/api/src/scheduler/vote-reminders.test.ts
git commit -m "fix: notificações de votação levam para /votar"
```

---

### Task 2: Sino de notificações dentro do Escritório

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Test: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consome: `NotificationBell` (`apps/web/src/components/NotificationBell.tsx`), sem props — já busca seus próprios dados via `useUnreadCount`/`useNotifications`.
- Não produz nada consumido por outras tasks.

- [ ] **Step 1: Escrever o teste**

Em `apps/web/src/pages/OfficePage.test.tsx`, adicionar (perto do teste de guest citado no plano, seguindo o mesmo padrão de `renderPage`):

```ts
  it('mostra o sino de notificações pra usuário autenticado, mas não pra convidado', () => {
    const { rerenderWithSession } = renderPage({ isGuest: false })
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument()

    rerenderWithSession({ isGuest: true })
    expect(screen.queryByRole('button', { name: 'Notificações' })).not.toBeInTheDocument()
  })
```

(O `aria-label="Notificações"` já existe em `NotificationBell.tsx:45` — não precisa de mudança lá.)

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx -t 'sino de notificações'`
Expected: FAIL — `NotificationBell` ainda não é renderizado em `OfficePage`.

- [ ] **Step 3: Importar e montar o `NotificationBell`**

Em `apps/web/src/pages/OfficePage.tsx`, adicionar o import (perto dos outros imports de componentes, linha ~4):

```ts
import { NotificationBell } from '../components/NotificationBell'
```

No wrapper existente do canto superior direito (linha ~405), adicionar o sino como primeiro item, condicionado a `!isGuest`:

```tsx
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2" onWheel={(event) => event.stopPropagation()}>
        {!isGuest && <NotificationBell />}

        {/* Erro ao ENTRAR em modo de edição (...) */}
        {editing.state.lockError && !editing.state.active && (
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx -t 'sino de notificações'`
Expected: PASS

- [ ] **Step 5: Rodar a suíte completa do arquivo pra garantir que nada quebrou**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: PASS (todos os testes do arquivo)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat: mostra o sino de notificações dentro do Escritório"
```

---

### Task 3: Hook de polling reaproveitável + hook de convites do Escritório

**Files:**
- Modify: `apps/web/src/lib/use-notifications.ts`
- Create: `apps/web/src/office/notifications/useOfficeInviteToasts.ts`
- Test: `apps/web/src/office/notifications/useOfficeInviteToasts.test.ts`

**Interfaces:**
- Produz `useUnreadNotificationsPoll()` em `use-notifications.ts`, retornando o mesmo shape de `useQuery` com `data: NotificationListResponse | undefined` (`{ items: NotificationDTO[]; unreadCount: number; nextCursor: string | null }`).
- Produz `useOfficeInviteToasts(): { queue: InviteToastItem[]; dismiss: (id: string) => void }`, onde:
  ```ts
  export interface InviteToastItem {
    id: string
    type: 'RETRO_INVITED' | 'PERIOD_OPENED' | 'VOTE_REMINDER_MIDWAY' | 'VOTE_REMINDER_CLOSING'
    title: string
    link: string
  }
  ```
  Consumido pela Task 4 (`InviteToastStack`), que usa exatamente esses 4 campos e as 2 funções.

- [ ] **Step 1: Escrever o hook de polling reaproveitável**

Em `apps/web/src/lib/use-notifications.ts`, adicionar (depois de `useUnreadCount`, antes de `NotificationFilter`):

```ts
/** Lista de não-lidas, com polling a cada 45s — alimenta os toasts de convite do Escritório. */
export function useUnreadNotificationsPoll() {
  return useQuery({
    queryKey: ['notifications', 'unread-list'],
    queryFn: () => apiFetch<NotificationListResponse>('/notifications?limit=20&read=false'),
    refetchInterval: 45_000,
  })
}
```

Esse hook não tem teste dedicado (é uma configuração de `useQuery` idêntica ao padrão já usado por `useUnreadCount` linhas acima) — sua cobertura vem indiretamente pelos testes da Task 3, Step 2 em diante, que mockam o módulo inteiro.

- [ ] **Step 2: Escrever os testes do hook de convites**

Criar `apps/web/src/office/notifications/useOfficeInviteToasts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useOfficeInviteToasts } from './useOfficeInviteToasts'
import { useUnreadNotificationsPoll } from '../../lib/use-notifications'
import { useCurrentPeriod } from '../../lib/use-current-period'
import { getRetroRoom } from '../../lib/retro-api'

vi.mock('../../lib/use-notifications', () => ({ useUnreadNotificationsPoll: vi.fn() }))
vi.mock('../../lib/use-current-period', () => ({ useCurrentPeriod: vi.fn() }))
vi.mock('../../lib/retro-api', () => ({ getRetroRoom: vi.fn() }))

const unreadPollMock = vi.mocked(useUnreadNotificationsPoll)
const currentPeriodMock = vi.mocked(useCurrentPeriod)
const getRetroRoomMock = vi.mocked(getRetroRoom)

function notif(over: Partial<{ id: string; type: string; title: string; link: string | null }> = {}) {
  return {
    id: 'n1',
    type: 'RETRO_INVITED',
    title: 'Você foi convidado para a retrospectiva "Sprint 12"',
    link: '/retrospectivas/room1',
    read: false,
    createdAt: '2026-07-21T00:00:00.000Z',
    actor: null,
    ...over,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  currentPeriodMock.mockReturnValue({ period: null, votingOpen: false, isLoading: false })
  getRetroRoomMock.mockResolvedValue({ room: { status: 'OPEN' } } as never)
})

it('ignora tipos que não são convite de retro/votação', async () => {
  unreadPollMock.mockReturnValue({
    data: { items: [notif({ type: 'FEEDBACK_RECEIVED', title: 'Você recebeu um feedback' })], unreadCount: 1, nextCursor: null },
  } as never)
  const { result } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(result.current.queue).toHaveLength(0))
})

it('retro aberta entra na fila; retro fechada não entra', async () => {
  getRetroRoomMock.mockResolvedValueOnce({ room: { status: 'CONCLUDED' } } as never)
  unreadPollMock.mockReturnValue({
    data: { items: [notif()], unreadCount: 1, nextCursor: null },
  } as never)
  const { result } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(getRetroRoomMock).toHaveBeenCalledWith('room1'))
  expect(result.current.queue).toHaveLength(0)
})

it('votação aberta entra na fila; votação fechada não entra', async () => {
  currentPeriodMock.mockReturnValue({ period: { id: 'p1' } as never, votingOpen: true, isLoading: false })
  unreadPollMock.mockReturnValue({
    data: {
      items: [notif({ id: 'n2', type: 'PERIOD_OPENED', title: 'A votação de Julho está aberta!', link: '/votar' })],
      unreadCount: 1,
      nextCursor: null,
    },
  } as never)
  const { result } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(result.current.queue).toHaveLength(1))
  expect(result.current.queue[0]).toMatchObject({ id: 'n2', type: 'PERIOD_OPENED', link: '/votar' })
})

it('checagem "ainda aberta" falhando descarta o candidato silenciosamente', async () => {
  getRetroRoomMock.mockRejectedValueOnce(new Error('404'))
  unreadPollMock.mockReturnValue({
    data: { items: [notif()], unreadCount: 1, nextCursor: null },
  } as never)
  const { result } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(getRetroRoomMock).toHaveBeenCalled())
  expect(result.current.queue).toHaveLength(0)
})

it('dismiss remove da fila e não reaparece mesmo que o próximo poll ainda traga como não-lido', async () => {
  currentPeriodMock.mockReturnValue({ period: { id: 'p1' } as never, votingOpen: true, isLoading: false })
  const item = notif({ id: 'n2', type: 'PERIOD_OPENED', title: 'A votação de Julho está aberta!', link: '/votar' })
  unreadPollMock.mockReturnValue({
    data: { items: [item], unreadCount: 1, nextCursor: null },
  } as never)
  const { result, rerender } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(result.current.queue).toHaveLength(1))

  act(() => result.current.dismiss('n2'))
  expect(result.current.queue).toHaveLength(0)

  rerender()
  expect(result.current.queue).toHaveLength(0)
})
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/notifications/useOfficeInviteToasts.test.ts`
Expected: FAIL — `useOfficeInviteToasts.ts` ainda não existe (erro de módulo não encontrado).

- [ ] **Step 4: Implementar o hook**

Criar `apps/web/src/office/notifications/useOfficeInviteToasts.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useUnreadNotificationsPoll } from '../../lib/use-notifications'
import { useCurrentPeriod } from '../../lib/use-current-period'
import { getRetroRoom } from '../../lib/retro-api'

const INVITE_TOAST_TYPES = ['RETRO_INVITED', 'PERIOD_OPENED', 'VOTE_REMINDER_MIDWAY', 'VOTE_REMINDER_CLOSING'] as const
type InviteToastType = (typeof INVITE_TOAST_TYPES)[number]

export interface InviteToastItem {
  id: string
  type: InviteToastType
  title: string
  link: string
}

function isInviteToastType(type: string): type is InviteToastType {
  return (INVITE_TOAST_TYPES as readonly string[]).includes(type)
}

/** Extrai o id da sala do link `/retrospectivas/:id` — formato gravado por notifyRetroInvited. */
function retroRoomIdFromLink(link: string): string | null {
  const match = link.match(/^\/retrospectivas\/(.+)$/)
  return match ? match[1]! : null
}

/**
 * Convites (retro/votação) não-lidos e ainda em aberto, prontos pra virar
 * toast no Escritório. `seen` é só desta sessão — nunca persiste, reseta ao
 * reentrar no Escritório.
 */
export function useOfficeInviteToasts() {
  const poll = useUnreadNotificationsPoll()
  const { votingOpen } = useCurrentPeriod()
  const [queue, setQueue] = useState<InviteToastItem[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const checkedRef = useRef<Set<string>>(new Set())

  const candidates = (poll.data?.items ?? []).filter(
    (n) => isInviteToastType(n.type) && n.link && !seenRef.current.has(n.id) && !checkedRef.current.has(n.id),
  )

  // Cada candidato só entra em um único fetch de checagem "ainda aberta"
  // (checkedRef evita refetch a cada re-render/poll enquanto aguarda).
  const retroCandidates = candidates.filter((n) => n.type === 'RETRO_INVITED')
  const votingCandidates = candidates.filter((n) => n.type !== 'RETRO_INVITED')

  useEffect(() => {
    for (const n of votingCandidates) {
      checkedRef.current.add(n.id)
      if (votingOpen) {
        setQueue((q) => [...q, { id: n.id, type: n.type as InviteToastType, title: n.title, link: n.link! }])
      } else {
        seenRef.current.add(n.id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votingCandidates.map((n) => n.id).join(','), votingOpen])

  useEffect(() => {
    for (const n of retroCandidates) {
      checkedRef.current.add(n.id)
      const roomId = retroRoomIdFromLink(n.link!)
      if (!roomId) {
        seenRef.current.add(n.id)
        continue
      }
      getRetroRoom(roomId)
        .then(({ room }) => {
          if (room.status === 'OPEN') {
            setQueue((q) => [...q, { id: n.id, type: 'RETRO_INVITED', title: n.title, link: n.link! }])
          } else {
            seenRef.current.add(n.id)
          }
        })
        .catch(() => {
          seenRef.current.add(n.id)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retroCandidates.map((n) => n.id).join(',')])

  function dismiss(id: string) {
    seenRef.current.add(id)
    setQueue((q) => q.filter((item) => item.id !== id))
  }

  return { queue, dismiss }
}
```

Observação: `checkedRef` evita re-disparar `getRetroRoom`/entrar na fila de novo pra um candidato que já está sendo checado ou já foi decidido nesta sessão, mesmo antes de `seenRef`/`queue` refletirem o resultado — sem isso, o próximo re-render (ex. `setQueue` do próprio efeito) recalcularia `candidates` e re-disparia o fetch em loop.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/notifications/useOfficeInviteToasts.test.ts`
Expected: PASS (todos os 5 testes)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/use-notifications.ts apps/web/src/office/notifications/useOfficeInviteToasts.ts apps/web/src/office/notifications/useOfficeInviteToasts.test.ts
git commit -m "feat: hook de convites de retro/votação pro Escritório"
```

---

### Task 4: Componente `InviteToastStack` + integração no `OfficePage`

**Files:**
- Create: `apps/web/src/office/notifications/InviteToastStack.tsx`
- Test: `apps/web/src/office/notifications/InviteToastStack.test.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Test: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consome: `InviteToastItem` e o retorno de `useOfficeInviteToasts()` (Task 3): `{ queue: InviteToastItem[]; dismiss: (id: string) => void }`.
- Consome: `useMarkRead()` (já existe, `apps/web/src/lib/use-notifications.ts:47-54`).

- [ ] **Step 1: Escrever os testes do componente**

Criar `apps/web/src/office/notifications/InviteToastStack.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InviteToastStack } from './InviteToastStack'
import { useMarkRead } from '../../lib/use-notifications'

vi.mock('../../lib/use-notifications', () => ({ useMarkRead: vi.fn() }))
const useMarkReadMock = vi.mocked(useMarkRead)

const items = [
  { id: 'n1', type: 'RETRO_INVITED' as const, title: 'Você foi convidado para a retrospectiva "Sprint 12"', link: '/retrospectivas/room1' },
]

function renderStack(dismiss = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    dismiss,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <InviteToastStack queue={items} dismiss={dismiss} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  useMarkReadMock.mockReturnValue({ mutate: vi.fn() } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

it('renderiza o título e o rótulo de call-to-action do tipo', () => {
  renderStack()
  expect(screen.getByText(/convidado para a retrospectiva/i)).toBeInTheDocument()
  expect(screen.getByText('Clique para participar')).toBeInTheDocument()
})

it('clicar navega (link do card) e marca como lida', () => {
  const markReadMutate = vi.fn()
  useMarkReadMock.mockReturnValue({ mutate: markReadMutate } as never)
  renderStack()
  fireEvent.click(screen.getByRole('link'))
  expect(markReadMutate).toHaveBeenCalledWith('n1')
})

it('X dispensa sem marcar como lida', () => {
  const markReadMutate = vi.fn()
  useMarkReadMock.mockReturnValue({ mutate: markReadMutate } as never)
  const dismiss = vi.fn()
  renderStack(dismiss)
  fireEvent.click(screen.getByRole('button', { name: 'Dispensar convite' }))
  expect(dismiss).toHaveBeenCalledWith('n1')
  expect(markReadMutate).not.toHaveBeenCalled()
})

it('some sozinho depois de ~10s', () => {
  const dismiss = vi.fn()
  renderStack(dismiss)
  vi.advanceTimersByTime(10_000)
  expect(dismiss).toHaveBeenCalledWith('n1')
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/notifications/InviteToastStack.test.tsx`
Expected: FAIL — `InviteToastStack.tsx` ainda não existe.

- [ ] **Step 3: Implementar o componente**

Criar `apps/web/src/office/notifications/InviteToastStack.tsx`:

```tsx
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useMarkRead } from '../../lib/use-notifications'
import type { InviteToastItem } from './useOfficeInviteToasts'

const AUTO_DISMISS_MS = 10_000

const CTA_LABEL: Record<InviteToastItem['type'], string> = {
  RETRO_INVITED: 'Clique para participar',
  PERIOD_OPENED: 'Clique para votar',
  VOTE_REMINDER_MIDWAY: 'Clique para votar',
  VOTE_REMINDER_CLOSING: 'Clique para votar',
}

export function InviteToastStack({
  queue,
  dismiss,
}: {
  queue: InviteToastItem[]
  dismiss: (id: string) => void
}) {
  if (queue.length === 0) return null
  return (
    <div className="absolute top-16 right-3 z-30 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-sm md:right-5 md:top-16">
      {queue.map((item) => (
        <InviteToast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </div>
  )
}

function InviteToast({ item, onDismiss }: { item: InviteToastItem; onDismiss: () => void }) {
  const markRead = useMarkRead()

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  return (
    <div className="flex items-start gap-sm rounded-xl border border-outline-variant/40 bg-surface-container/95 p-md shadow-lg backdrop-blur">
      <Link
        to={item.link}
        onClick={() => markRead.mutate(item.id)}
        className="min-w-0 flex-1"
      >
        <p className="text-body-sm text-on-surface">{item.title}</p>
        <p className="mt-1 font-label text-label-sm font-bold text-primary">{CTA_LABEL[item.type]}</p>
      </Link>
      <button
        type="button"
        aria-label="Dispensar convite"
        onClick={onDismiss}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
      >
        <Icon name="close" className="text-[16px]" />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/notifications/InviteToastStack.test.tsx`
Expected: PASS (todos os 4 testes)

- [ ] **Step 5: Integrar no `OfficePage`**

Em `apps/web/src/pages/OfficePage.tsx`, adicionar os imports (perto do import de `NotificationBell` adicionado na Task 2):

```ts
import { useOfficeInviteToasts } from '../office/notifications/useOfficeInviteToasts'
import { InviteToastStack } from '../office/notifications/InviteToastStack'
```

Dentro do componente `OfficePage`, perto de onde os outros hooks de estado do escritório são chamados (ex. logo após a desestruturação de `useOfficeSession()`), adicionar:

```ts
  const inviteToasts = useOfficeInviteToasts()
```

E no JSX, logo depois do wrapper `top-3 right-3 z-10` que já tem o `NotificationBell` (Task 2) — como um elemento irmão, condicionado a `!isGuest`:

```tsx
      {!isGuest && <InviteToastStack queue={inviteToasts.queue} dismiss={inviteToasts.dismiss} />}
```

- [ ] **Step 6: Escrever o teste de integração**

`OfficePage.test.tsx` mocka hooks locais com o padrão "variável módulo-nível reatribuível fechada pelo `vi.mock`" (ver `interactionsMock`, linhas 183-197: `let interactionsMock: {...}`, `vi.mock('../office/useOfficeInteractions', () => ({ useOfficeInteractions: () => interactionsMock }))`, reatribuído por teste com `interactionsMock = {...}`). Seguir o mesmo padrão — adicionar perto da declaração de `interactionsMock` (linhas 183-198):

```ts
let inviteToastsMock: { queue: InviteToastItem[]; dismiss: (id: string) => void } = { queue: [], dismiss: vi.fn() }
vi.mock('../office/notifications/useOfficeInviteToasts', () => ({
  useOfficeInviteToasts: () => inviteToastsMock,
}))
```

(Importar `InviteToastItem` de `../office/notifications/useOfficeInviteToasts` só pro tipo.)

E o teste:

```ts
  it('mostra o toast de convite quando há um na fila, mas não pra convidado', () => {
    const dismiss = vi.fn()
    inviteToastsMock = {
      queue: [{ id: 'n1', type: 'RETRO_INVITED', title: 'Você foi convidado para a retrospectiva "Sprint 12"', link: '/retrospectivas/room1' }],
      dismiss,
    }
    const { rerenderWithSession } = renderPage({ isGuest: false })
    expect(screen.getByText(/convidado para a retrospectiva/i)).toBeInTheDocument()

    rerenderWithSession({ isGuest: true })
    expect(screen.queryByText(/convidado para a retrospectiva/i)).not.toBeInTheDocument()
  })
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: PASS (todos os testes do arquivo, incluindo o novo)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/office/notifications/InviteToastStack.tsx apps/web/src/office/notifications/InviteToastStack.test.tsx apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat: toast de convite de retro/votação no Escritório"
```

---

### Task 5: Verificação final

**Files:** nenhum (só validação).

- [ ] **Step 1: Rodar a suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os testes passando (API precisa do Postgres de pé).

- [ ] **Step 2: Typecheck do web**

Run: `pnpm --filter @legends/web exec tsc -p tsconfig.json --noEmit`
Expected: sem erros.

- [ ] **Step 3: Validação manual no navegador**

Com `pnpm dev` rodando: entrar no Escritório autenticado e confirmar que o sino aparece no canto superior direito e funciona (abre dropdown, mostra notificações, marca como lida). Criar um convite de retro pra esse usuário (via outra conta) e, dentro de ~45s com a aba do Escritório aberta, confirmar que o toast aparece, some sozinho depois de ~10s se ignorado, e que clicar nele leva pro board da retro e marca a notificação como lida (some do sino). Repetir abrindo um período de votação como admin, conferindo que o toast leva pra `/votar`. Conferir que nada disso aparece numa sessão de convidado (`/convite/...`).
