# Gerir participantes (add/remove) numa sala aberta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O facilitador adiciona e remove participantes de uma sala aberta por um painel lateral no board; mudanças refletem ao vivo e os cards de quem sai permanecem.

**Architecture:** `setParticipants` deixa de ser só-adiciona e vira um "set" (a lista enviada é a final, preservando o criador, sem apagar cards). A rota PATCH passa a emitir `participants.changed`; os clientes refazem o GET (igual ao modo anônimo). UI: drawer lateral no board (facilitador, sala aberta) com remover (×) / adicionar (+) imediatos.

**Tech Stack:** Fastify + Prisma + Postgres (api); React 18 + React Query + Tailwind (web); tipos em `@legends/shared`. Vitest (api contra Postgres real; web jsdom).

## Global Constraints

- TypeScript **strict**, ESM. Mensagens ao usuário em **português**.
- **Sem migration** — modelo `RetroParticipant` já existe (`@@unique([roomId, userId])`).
- Camadas finas: route → service → Prisma; DTO em `serialize.ts`; contrato em `@legends/shared`.
- Facilitador-only (`room.createdById`); sala não-`CONCLUDED` (guards já existem em `setParticipants`).
- Remover participante **mantém** cards/votos/reações (sem cascade). O criador nunca é removido.
- Único consumidor de `setParticipants` é o PATCH (a criação usa `createRoom`) — mudar a semântica é seguro.
- Testes da API exigem **Postgres de pé** (`pnpm db:up`).
- Spec: `docs/superpowers/specs/2026-06-19-retro-manage-participants-design.md`.

## Mapa de arquivos

- Modify: `packages/shared/src/retro.ts` — `RetroEvent` += `participants.changed`.
- Modify: `apps/api/src/services/retro-service.ts` — `setParticipants` set-semantics.
- Modify: `apps/api/src/routes/retro.ts` — broadcast `participants.changed` no PATCH.
- Test: `apps/api/src/services/retro-service.test.ts`.
- Modify: `apps/web/src/lib/useRetroSocket.ts` — invalidate em `participants.changed`.
- Create: `apps/web/src/pages/retro/ParticipantsPanel.tsx` + test.
- Modify: `apps/web/src/pages/RetroRoomPage.tsx` — botão + drawer + mutation + query. Test: `RetroRoomPage.test.tsx`.

**Ordem:** Task 1 (contrato) → Task 2 (api) / Task 3 (painel) / Task 4 (web wiring). Tasks 2–4 dependem do contrato; Task 4 consome o painel (Task 3).

---

### Task 1: Contrato — evento `participants.changed`

**Files:**
- Modify: `packages/shared/src/retro.ts`

**Interfaces:**
- Produces: `RetroEvent` ganha `{ type: 'participants.changed' }`.

- [ ] **Step 1: Add the event variant**

Em `packages/shared/src/retro.ts`, no `export type RetroEvent`, adicione (junto dos autoritativos, após `anonymous.changed`):

```ts
  | { type: 'participants.changed' }
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @legends/web build`
Expected: type-clean (adição aditiva; nada quebra).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/retro.ts
git commit -m "feat(shared): evento participants.changed"
```

---

### Task 2: API — `setParticipants` set-semantics + broadcast

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Test: `apps/api/src/services/retro-service.test.ts`

**Interfaces:**
- Consumes: evento `participants.changed` (Task 1).
- Produces: `setParticipants({ roomId, userId, participantIds })` agora substitui a lista (add+remove, criador preservado, cards mantidos), retorno `{ room, addedUserIds }` inalterado. PATCH emite `participants.changed`.

- [ ] **Step 1: Update the service test (set-semantics) + removal-keeps-cards**

Em `apps/api/src/services/retro-service.test.ts`:

(a) Garanta que `createCard` está importado do service (junto de `createRoom`, `setParticipants`, etc.):

```ts
import { createRoom, setParticipants, createCard /* , ...os já existentes */ } from './retro-service'
```

> Se já houver um import agrupado do `./retro-service`, apenas inclua `createCard` nele; não duplique a linha.

(b) **Substitua** o teste `it('setParticipants adiciona e reporta novos; não remove o criador', ...)` por:

```ts
  it('setParticipants substitui a lista (add/remove) e mantém o criador', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'DEV')
    const d2 = await mkUser('D2', 'DEV')
    const room = await createRoom({ creatorId: lead.id, title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [d1.id] })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [d2.id] })
    expect(res.addedUserIds).toEqual([d2.id])
    const ids = res.room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, d2.id].sort()) // d1 removido, criador mantido
  })

  it('remover participante mantém os cards dele', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'DEV')
    const room = await createRoom({ creatorId: lead.id, title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [d1.id] })
    const card = await createCard({ roomId: room.id, userId: d1.id, text: 'oi', color: 'yellow', x: 0, y: 0 })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [] })
    expect(res.room.participants.map((p) => p.userId)).toEqual([lead.id])
    expect(res.room.cards.some((c) => c.id === card.id)).toBe(true)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm db:up` (se necessário) e `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts`
Expected: FAIL — hoje `setParticipants` não remove (d1 permaneceria; primeiro teste falha no array esperado).

- [ ] **Step 3: Make `setParticipants` a true set**

Em `apps/api/src/services/retro-service.ts`, substitua o corpo de `setParticipants` (mantendo a assinatura e os guards) por:

```ts
export async function setParticipants(input: {
  roomId: string
  userId: string
  participantIds: string[]
}): Promise<{ room: RetroRoomWithRelations; addedUserIds: string[] }> {
  const room = await loadRoom(input.roomId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador gerencia participantes.', 403)
  if (room.status === 'CONCLUDED') throw new RetroError('A sala foi concluída.', 409)
  const desired = new Set([room.createdById, ...input.participantIds])
  await assertInvitable([...desired].filter((id) => id !== room.createdById))
  const current = new Set(room.participants.map((p) => p.userId))
  const toAdd = [...desired].filter((id) => !current.has(id))
  const toRemove = [...current].filter((id) => !desired.has(id) && id !== room.createdById)
  await prisma.$transaction([
    ...(toAdd.length ? [prisma.retroParticipant.createMany({ data: toAdd.map((userId) => ({ roomId: room.id, userId })) })] : []),
    ...(toRemove.length ? [prisma.retroParticipant.deleteMany({ where: { roomId: room.id, userId: { in: toRemove } } })] : []),
  ])
  return { room: await loadRoom(room.id), addedUserIds: toAdd }
}
```

- [ ] **Step 4: Run the service tests to verify they pass**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts`
Expected: PASS (os dois casos novos + os demais).

- [ ] **Step 5: Broadcast `participants.changed` no PATCH**

Em `apps/api/src/routes/retro.ts`, no handler `app.patch('/retro/rooms/:id/participants', ...)`, logo após o bloco `if (addedUserIds.length) { ...notifyRetroInvited... }` e **antes** do `return reply.send(...)`, adicione:

```ts
      retroHub.broadcast(room.id, () => ({ type: 'participants.changed' }))
```

- [ ] **Step 6: Run the full API suite**

Run: `pnpm --filter @legends/api test`
Expected: tudo verde (inclui o teste de notificação do PATCH, inalterado).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/services/retro-service.test.ts
git commit -m "feat(api): setParticipants substitui a lista (add/remove) + broadcast participants.changed"
```

---

### Task 3: ParticipantsPanel (drawer)

**Files:**
- Create: `apps/web/src/pages/retro/ParticipantsPanel.tsx`
- Test: `apps/web/src/pages/retro/ParticipantsPanel.test.tsx`

**Interfaces:**
- Consumes: `RetroParticipantDTO`, `PublicUser` de `@legends/shared`.
- Produces: `ParticipantsPanel({ participants, invitable, busy, onAdd, onRemove, onClose })`. Botões: criador sem ×; demais com `aria-label="Remover {nome}"`; convidáveis com `aria-label="Adicionar {nome}"`; fechar com `aria-label="Fechar"`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/retro/ParticipantsPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PublicUser, RetroParticipantDTO } from '@legends/shared'
import { ParticipantsPanel } from './ParticipantsPanel'

const pub = (id: string, name: string): PublicUser => ({
  id, name, email: `${id}@x`, role: 'DEV', position: null, squad: null,
  photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '',
})
const participants: RetroParticipantDTO[] = [
  { user: pub('l1', 'Lia'), isCreator: true },
  { user: pub('d1', 'Dan'), isCreator: false },
]
const invitable: PublicUser[] = [pub('b1', 'Bia')]

describe('ParticipantsPanel', () => {
  it('lista participantes (criador sem remover) e dispara onRemove', () => {
    const onRemove = vi.fn()
    render(<ParticipantsPanel participants={participants} invitable={invitable} onAdd={() => {}} onRemove={onRemove} onClose={() => {}} />)
    expect(screen.getByText('Lia')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remover Lia/i })).toBeNull() // criador
    fireEvent.click(screen.getByRole('button', { name: /Remover Dan/i }))
    expect(onRemove).toHaveBeenCalledWith('d1')
  })

  it('lista convidáveis e dispara onAdd; fechar dispara onClose', () => {
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(<ParticipantsPanel participants={participants} invitable={invitable} onAdd={onAdd} onRemove={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Adicionar Bia/i }))
    expect(onAdd).toHaveBeenCalledWith('b1')
    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/ParticipantsPanel.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implement ParticipantsPanel**

```tsx
// apps/web/src/pages/retro/ParticipantsPanel.tsx
import type { JSX } from 'react'
import type { PublicUser, RetroParticipantDTO } from '@legends/shared'

export function ParticipantsPanel({
  participants,
  invitable,
  busy,
  onAdd,
  onRemove,
  onClose,
}: {
  participants: RetroParticipantDTO[]
  invitable: PublicUser[]
  busy?: boolean
  onAdd: (userId: string) => void
  onRemove: (userId: string) => void
  onClose: () => void
}): JSX.Element {
  const row = 'flex items-center justify-between rounded px-2 py-1 text-body-sm text-on-surface'
  const iconBtn = 'flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-40'
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-72 flex-col border-l border-outline-variant/40 bg-surface-container shadow-xl">
      <div className="flex items-center justify-between border-b border-outline-variant/40 px-4 py-3">
        <h3 className="font-label text-title-sm font-bold text-on-surface">Participantes</h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className={iconBtn}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <p className="mb-1 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Na sala</p>
        <ul className="space-y-1">
          {participants.map((p) => (
            <li key={p.user.id} className={row}>
              <span>
                {p.user.name}
                {p.isCreator && <span className="ml-1 text-label-sm text-on-surface-variant">(criador)</span>}
              </span>
              {!p.isCreator && (
                <button type="button" aria-label={`Remover ${p.user.name}`} disabled={busy} onClick={() => onRemove(p.user.id)} className={iconBtn}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="mb-1 mt-4 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Adicionar</p>
        <ul className="space-y-1">
          {invitable.map((u) => (
            <li key={u.id} className={row}>
              <span>{u.name}</span>
              <button type="button" aria-label={`Adicionar ${u.name}`} disabled={busy} onClick={() => onAdd(u.id)} className={iconBtn}>
                +
              </button>
            </li>
          ))}
          {invitable.length === 0 && <li className="px-2 py-1 text-body-sm text-on-surface-variant">Ninguém para adicionar.</li>}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/ParticipantsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/ParticipantsPanel.tsx apps/web/src/pages/retro/ParticipantsPanel.test.tsx
git commit -m "feat(web): ParticipantsPanel (drawer de participantes)"
```

---

### Task 4: Web wiring — socket + botão/drawer na RetroRoomPage

**Files:**
- Modify: `apps/web/src/lib/useRetroSocket.ts`
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Test: `apps/web/src/pages/RetroRoomPage.test.tsx`

**Interfaces:**
- Consumes: `participants.changed` (Task 1); `ParticipantsPanel` (Task 3); `setRetroParticipants`/`listInvitableUsers` (já em `retro-api.ts`).
- Produces: botão "Participantes (N)" (facilitador, OPEN) abre o drawer; add/remove chamam `setRetroParticipants(id, novaLista)`; clientes refazem o GET ao receber `participants.changed`.

- [ ] **Step 1: Invalidate on `participants.changed`**

Em `apps/web/src/lib/useRetroSocket.ts`, no `ws.onmessage`, logo após a linha
`if (e.type === 'anonymous.changed') qc.invalidateQueries({ queryKey: ['retro-room', roomId] })`, adicione:

```ts
        if (e.type === 'participants.changed') qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
```

- [ ] **Step 2: Update the page test**

Em `apps/web/src/pages/RetroRoomPage.test.tsx`:

(a) No import de `@legends/shared`, adicione `type PublicUser`:

```tsx
import type { PublicUser, RetroRoomDTO } from '@legends/shared'
```

(b) No `vi.mock('../lib/retro-api', ...)`, adicione à fábrica (literais completos — a fábrica é içada, não referencie consts externas):

```ts
  setRetroParticipants: vi.fn().mockResolvedValue({ room: { id: 'r1', title: 'Retro 1', status: 'OPEN', anonymous: false, votesPerParticipant: 3, createdAt: '', concludedAt: null, creator: { id: 'l1', name: 'Lia' }, participantCount: 1, myRole: 'FACILITATOR', participants: [], myRemainingVotes: 3, cards: [] } }),
  listInvitableUsers: vi.fn().mockResolvedValue({ users: [
    { id: 'b1', name: 'Bia', email: 'b@x', role: 'DEV', position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '' },
    { id: 'd1', name: 'Dan', email: 'd@x', role: 'DEV', position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '' },
  ] }),
```

(c) Logo após a definição do `const room` (topo do arquivo), adicione um helper e uma sala com participantes:

```tsx
const pub = (id: string, name: string): PublicUser => ({
  id, name, email: `${id}@x`, role: 'DEV', position: null, squad: null,
  photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '',
})
const roomWithParticipants: RetroRoomDTO = {
  ...room,
  participants: [
    { user: pub('l1', 'Lia'), isCreator: true },
    { user: pub('d1', 'Dan'), isCreator: false },
  ],
}
```

(d) Adicione os casos (no `describe` existente):

```tsx
  it('facilitador vê "Participantes (N)" e abre o painel', async () => {
    renderPage(roomWithParticipants)
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /participantes/i }))
    // o painel busca convidáveis (Dan já é participante => só Bia aparece para adicionar)
    expect(await screen.findByRole('button', { name: /Adicionar Bia/i })).toBeInTheDocument()
  })

  it('adicionar um participante chama a API com a lista incluindo o novo', async () => {
    renderPage(roomWithParticipants)
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /participantes/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Adicionar Bia/i }))
    await waitFor(() => expect(api.setRetroParticipants).toHaveBeenCalledWith('r1', ['l1', 'd1', 'b1']))
  })

  it('remover um participante chama a API sem o id', async () => {
    renderPage(roomWithParticipants)
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /participantes/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Remover Dan/i }))
    await waitFor(() => expect(api.setRetroParticipants).toHaveBeenCalledWith('r1', ['l1']))
  })
```

- [ ] **Step 3: Run the page test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: FAIL — não há botão "Participantes" nem painel.

- [ ] **Step 4: Wire the page**

Em `apps/web/src/pages/RetroRoomPage.tsx`:

(a) No import de `../lib/retro-api`, adicione `listInvitableUsers` e `setRetroParticipants`.

(b) Adicione o import do painel (junto dos outros `./retro/*`):

```tsx
import { ParticipantsPanel } from './retro/ParticipantsPanel'
```

(c) No bloco de estado, adicione:

```tsx
  const [participantsOpen, setParticipantsOpen] = useState(false)
```

(d) Junto dos hooks de query/topo (perto de `roomQuery`), adicione a query de convidáveis:

```tsx
  const invitableQuery = useQuery({ queryKey: ['retro-invitable'], queryFn: listInvitableUsers, enabled: participantsOpen })
```

(e) Junto das mutations (ex. após `toggleAnonM`), adicione:

```tsx
  const participantsM = useMutation({
    mutationFn: (ids: string[]) => setRetroParticipants(id, ids),
    onSuccess: ({ room: r }) => patch((c) => ({ room: { ...c.room, participants: r.participants, participantCount: r.participantCount } })),
  })
```

(f) Na top bar, antes do botão "Concluir", adicione o botão (facilitador, sala aberta):

```tsx
          {isFacilitator && room.status === 'OPEN' && (
            <button
              type="button"
              onClick={() => setParticipantsOpen(true)}
              className="rounded-md border border-outline-variant/40 px-lg py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
            >
              Participantes ({room.participants.length})
            </button>
          )}
```

(g) Renderize o drawer — logo antes do fechamento `</section>` (depois do bloco da toolbar `{canWrite && (...)}`):

```tsx
      {participantsOpen && isFacilitator && (
        <ParticipantsPanel
          participants={room.participants}
          invitable={(invitableQuery.data?.users ?? []).filter((u) => !room.participants.some((p) => p.user.id === u.id))}
          busy={participantsM.isPending}
          onAdd={(uid) => participantsM.mutate([...room.participants.map((p) => p.user.id), uid])}
          onRemove={(uid) => participantsM.mutate(room.participants.map((p) => p.user.id).filter((x) => x !== uid))}
          onClose={() => setParticipantsOpen(false)}
        />
      )}
```

- [ ] **Step 5: Run test + full web build**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx` → PASS.
Run: `pnpm --filter @legends/web build` → type-clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/useRetroSocket.ts apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(web): painel de participantes no board (add/remove ao vivo)"
```

---

## Self-Review (autor)

**Cobertura do spec:**
- Evento `participants.changed` → Task 1.
- `setParticipants` set-semantics (add+remove, criador preservado, cards mantidos) → Task 2 (service + testes).
- Broadcast no PATCH → Task 2 (Step 5).
- Invalidate ao vivo nos clientes → Task 4 (Step 1).
- Drawer com add/remove imediatos → Task 3 (componente) + Task 4 (fiação).
- Sem migration → confirmado (nenhuma mudança em schema.prisma).

**Placeholder scan:** sem TODO/itens vagos; todo passo tem código real.

**Type consistency:** `participants.changed` (Task 1) tratado em useRetroSocket (Task 4); `setParticipants` retorno `{ room, addedUserIds }` inalterado; `ParticipantsPanel` props (Task 3) batem com a fiação (Task 4): `participants: RetroParticipantDTO[]`, `invitable: PublicUser[]`, `onAdd/onRemove: (userId)=>void`; `participantsM.mutate(ids: string[])` ↔ `setRetroParticipants(id, ids)`; ids derivados de `room.participants.map((p) => p.user.id)`.

**Riscos a validar na execução:**
- Set-semantics muda o teste de serviço existente (atualizado na Task 2 Step 1); rodar a suite completa da API (Step 6).
- `createCard` precisa estar importado no teste de serviço (Step 1a).
- A fábrica do `vi.mock` é içada — os literais de `listInvitableUsers`/`setRetroParticipants` não referenciam consts externas (Task 4 Step 2b).
- A query `retro-invitable` só roda com o painel aberto (`enabled: participantsOpen`); os testes abrem o painel antes de procurar "Adicionar Bia".
- A ordem dos ids no `mutate` é determinística (`[...current, novo]` / `current.filter`) — asserts usam a ordem exata `['l1','d1','b1']` e `['l1']`.
