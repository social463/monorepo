# Admin arquiva salas de retrospectiva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um `ADMIN` arquive (soft delete) qualquer sala de retrospectiva pela listagem; a sala some das listagens e fica inacessível, sem apagar dados.

**Architecture:** Soft delete por timestamp `archivedAt` em `RetroRoom`. O service filtra `archivedAt: null` em toda leitura de sala; uma rota `DELETE /retro/rooms/:id` protegida por `requireAdmin` seta o timestamp e emite o evento `room.deleted` pelo WebSocket para fechar sessões abertas. Frontend ganha botão de lixeira (só admin) com modal de confirmação.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod; React 18 + React Query + React Router; Vitest. Monorepo pnpm; contrato em `@legends/shared`.

## Global Constraints

- TypeScript **strict**, ESM puro. Mensagens ao usuário em **português**.
- Camadas finas: route valida/serializa, lógica no service, erros de domínio via `RetroError(msg, status)`.
- Testes da API rodam contra **Postgres real** (`pnpm db:up` antes). `pnpm test` deve passar antes de concluir.
- **⚠️ NÃO rodar `prisma migrate dev` contra o banco de HML.** O `apps/api/.env` atual aponta `DATABASE_URL` para `hml-dbs.eumedicoresidente.com.br`. Antes de gerar/aplicar migration, garanta que `DATABASE_URL` aponta para o Postgres **local** (`pnpm db:up` sobe na 5432; use uma `.env` local apontando para `postgresql://postgres:postgres@localhost:5432/legends` ou equivalente). A migration é aditiva (colunas nullable), mas `migrate dev` pode propor reset — nunca contra HML.
- Ao mudar contrato, alterar `@legends/shared` primeiro.

---

## File Structure

- `apps/api/prisma/schema.prisma` — colunas `archivedAt`/`archivedById` + relação em `RetroRoom` e inversa em `User`.
- `apps/api/prisma/migrations/<timestamp>_retro_room_archive/migration.sql` — migration aditiva.
- `packages/shared/src/retro.ts` — novo evento `room.deleted` no union `RetroEvent`.
- `apps/api/src/services/retro-service.ts` — `archiveRoom()` + filtro `archivedAt: null` nas leituras.
- `apps/api/src/routes/retro.ts` — rota `DELETE /retro/rooms/:id`.
- `apps/api/src/routes/retro.test.ts` — testes da rota.
- `apps/web/src/lib/retro-api.ts` — `deleteRetroRoom()`.
- `apps/web/src/lib/useRetroSocket.ts` — trata `room.deleted` (callback de redirect via ref).
- `apps/web/src/pages/RetroRoomPage.tsx` — passa callback de redirect ao socket.
- `apps/web/src/pages/RetrosPage.tsx` — `ListRow` ganha `action`; `RoomCard` ganha lixeira; `RetroSprintPage` orquestra mutation + modal de confirmação.
- `apps/web/src/pages/RetrosPage.test.tsx` (ou `RetroRoomPage.test.tsx`) — testes de UI.

---

## Task 1: Schema, migration e evento compartilhado

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `RetroRoom` ~287-305; model `User` ~64-80)
- Create: `apps/api/prisma/migrations/<timestamp>_retro_room_archive/migration.sql`
- Modify: `packages/shared/src/retro.ts:196-214` (union `RetroEvent`)

**Interfaces:**
- Produces: coluna `RetroRoom.archivedAt: DateTime?`, `RetroRoom.archivedById: String?`, relação `archivedBy`; evento `{ type: 'room.deleted' }` em `RetroEvent`.

- [ ] **Step 1: Adicionar colunas e relação no schema**

Em `apps/api/prisma/schema.prisma`, no `model RetroRoom`, depois de `concludedAt DateTime?` e antes do bloco de relações:

```prisma
  archivedAt          DateTime?
  archivedById        String?
```

E no bloco de relações do mesmo model (junto de `creator`, `squads`, etc.):

```prisma
  archivedBy   User?              @relation("RetroRoomsArchived", fields: [archivedById], references: [id], onDelete: SetNull)
```

No `model User`, junto às outras relações de retro (após `retroRoomsCreated ...`):

```prisma
  retroRoomsArchived  RetroRoom[]        @relation("RetroRoomsArchived")
```

- [ ] **Step 2: Garantir DATABASE_URL local e gerar a migration**

Confirme que NÃO está apontando para HML:

Run: `grep DATABASE_URL apps/api/.env`
Expected: um host **local** (`localhost`/`127.0.0.1`), não `hml-dbs...`. Se estiver em HML, ajuste para o Postgres local antes de continuar (`pnpm db:up`).

Run: `pnpm --filter @legends/api exec prisma migrate dev --name retro_room_archive`
Expected: cria `apps/api/prisma/migrations/<timestamp>_retro_room_archive/migration.sql` e aplica no banco local sem prompt de reset.

- [ ] **Step 3: Conferir o SQL gerado**

Run: `cat apps/api/prisma/migrations/*_retro_room_archive/migration.sql`
Expected (aditivo, sem DROP de dados existentes):

```sql
-- AlterTable
ALTER TABLE "RetroRoom" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedById" TEXT;

-- AddForeignKey
ALTER TABLE "RetroRoom" ADD CONSTRAINT "RetroRoom_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Adicionar o evento `room.deleted` ao contrato**

Em `packages/shared/src/retro.ts`, no union `RetroEvent` (após a linha `| { type: 'phase.changed'; status: RetroRoomStatus; concludedAt: string | null }`):

```ts
  | { type: 'room.deleted' }
```

- [ ] **Step 5: Typecheck e build do shared**

Run: `pnpm --filter @legends/shared build && pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/shared/src/retro.ts
git commit -m "feat(retro): schema + evento para arquivar salas (soft delete)"
```

---

## Task 2: Backend — service `archiveRoom`, filtro e rota DELETE

**Files:**
- Modify: `apps/api/src/services/retro-service.ts` (`loadRoom` ~70-74; `listRoomsForUser` ~127-130; `getRoomMeta` ~187-191; `priorConcludedSquadRooms` ~542-545; nova função no fim do arquivo)
- Modify: `apps/api/src/routes/retro.ts` (perto do bloco `DELETE .../cards/:cardId` ~258)
- Test: `apps/api/src/routes/retro.test.ts`

**Interfaces:**
- Consumes: `RetroError` (já exportado), `prisma`, `loadRoom`.
- Produces: `archiveRoom(input: { roomId: string; userId: string }): Promise<void>`; rota `DELETE /retro/rooms/:id` → `204` (admin) / `403` (não-admin) / `404` (inexistente ou já arquivada).

- [ ] **Step 1: Escrever os testes da rota (falhando)**

Em `apps/api/src/routes/retro.test.ts`, adicionar helper de admin (após `devToken`, ~linha 13) se ainda não existir:

```ts
async function adminToken(app: any, name = 'Ada') {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'ADMIN' }) }
}
```

E dentro do `describe('retro routes', ...)`, adicionar:

```ts
it('ADMIN arquiva sala (204), some da listagem e dá 404 ao acessar; dados ficam', async () => {
  const app = buildApp(); await app.ready()
  const lead = await leadToken(app)
  const admin = await adminToken(app)
  const squadId = await mkSquad(app)
  const created = await app.inject({
    method: 'POST', url: '/retro/rooms',
    headers: { authorization: `Bearer ${lead.token}` },
    payload: { sprint: 42, squadIds: [squadId], votesPerParticipant: 3, participantIds: [admin.id] },
  })
  expect(created.statusCode).toBe(201)
  const roomId = created.json().room.id
  await prisma.retroCard.create({ data: { roomId, authorId: lead.id, text: 'x', x: 0, y: 0, color: 'yellow', kind: 'NOTE' } })

  const del = await app.inject({ method: 'DELETE', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${admin.token}` } })
  expect(del.statusCode).toBe(204)

  const list = await app.inject({ method: 'GET', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` } })
  expect(list.json().rooms.find((r: any) => r.id === roomId)).toBeUndefined()

  const get = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
  expect(get.statusCode).toBe(404)

  expect(await prisma.retroCard.count({ where: { roomId } })).toBe(1)
  const row = await prisma.retroRoom.findUnique({ where: { id: roomId } })
  expect(row?.archivedAt).not.toBeNull()
  expect(row?.archivedById).toBe(admin.id)
})

it('DEV e LEAD não arquivam sala (403)', async () => {
  const app = buildApp(); await app.ready()
  const lead = await leadToken(app)
  const dev = await devToken(app)
  const squadId = await mkSquad(app)
  const created = await app.inject({
    method: 'POST', url: '/retro/rooms',
    headers: { authorization: `Bearer ${lead.token}` },
    payload: { sprint: 7, squadIds: [squadId], votesPerParticipant: 3, participantIds: [dev.id] },
  })
  const roomId = created.json().room.id
  for (const t of [lead.token, dev.token]) {
    const res = await app.inject({ method: 'DELETE', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(403)
  }
})

it('arquivar sala inexistente → 404', async () => {
  const app = buildApp(); await app.ready()
  const admin = await adminToken(app)
  const res = await app.inject({ method: 'DELETE', url: '/retro/rooms/nao-existe', headers: { authorization: `Bearer ${admin.token}` } })
  expect(res.statusCode).toBe(404)
})
```

> Confirme os campos obrigatórios de `retroCard.create` e do payload de `POST /retro/rooms` contra os testes vizinhos no mesmo arquivo; ajuste nomes/valores (`kind`, `color`, `participantIds`) se o padrão local divergir.

- [ ] **Step 2: Rodar os testes para vê-los falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- retro.test.ts`
Expected: FAIL — rota `DELETE /retro/rooms/:id` ainda não existe (404 onde se espera 204; ou erro de rota).

- [ ] **Step 3: Implementar `archiveRoom` + filtro no service**

Em `apps/api/src/services/retro-service.ts`:

Filtrar arquivadas em `loadRoom` (~70-74):

```ts
async function loadRoom(roomId: string): Promise<RetroRoomWithRelations> {
  const room = await prisma.retroRoom.findUnique({ where: { id: roomId }, include: retroRoomInclude })
  if (!room || room.archivedAt) throw new RetroError('Sala não encontrada.', 404)
  return room
}
```

Em `listRoomsForUser` (~127-130), adicionar `archivedAt: null` ao `where`:

```ts
export async function listRoomsForUser(viewer: { id: string; role: string }): Promise<RetroRoomWithRelations[]> {
  const where: Prisma.RetroRoomWhereInput =
    viewer.role === 'LEAD'
      ? { archivedAt: null }
      : { archivedAt: null, participants: { some: { userId: viewer.id } } }
  return prisma.retroRoom.findMany({ where, include: retroRoomInclude, orderBy: { createdAt: 'desc' } })
}
```

Em `getRoomMeta` (~187-191), excluir arquivadas para que o WebSocket rejeite conexão:

```ts
  const room = await prisma.retroRoom.findUnique({
    where: { id: roomId },
    include: { participants: { select: { userId: true } } },
  })
  if (!room || room.archivedAt) return null
```

Em `priorConcludedSquadRooms` (~542-545), excluir arquivadas do carry-over:

```ts
    where: { id: { not: room.id }, archivedAt: null, status: 'CONCLUDED', concludedAt: { lt: room.createdAt }, squads: { some: { squadId: { in: squadIds } } } },
```

Adicionar a função no fim do arquivo (junto das outras exportadas):

```ts
export async function archiveRoom(input: { roomId: string; userId: string }): Promise<void> {
  await loadRoom(input.roomId)
  await prisma.retroRoom.update({
    where: { id: input.roomId },
    data: { archivedAt: new Date(), archivedById: input.userId },
  })
}
```

- [ ] **Step 4: Adicionar a rota DELETE**

Em `apps/api/src/routes/retro.ts`, importar `archiveRoom` no import do service (junto de `deleteCard`, etc.) e registrar a rota (perto do bloco de delete de card, ~258):

```ts
app.delete('/retro/rooms/:id', { onRequest: [app.authenticate, app.requireAdmin] }, async (request, reply) => {
  const { id } = request.params as { id: string }
  try {
    await archiveRoom({ roomId: id, userId: request.user.sub })
    retroHub.broadcast(id, () => ({ type: 'room.deleted' }))
    return reply.code(204).send()
  } catch (err) {
    if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
    throw err
  }
})
```

> `requireAdmin` já está decorado em `app.ts`. Confirme que `retroHub` já está importado no arquivo (é usado nos outros handlers).

- [ ] **Step 5: Rodar os testes — devem passar**

Run: `pnpm --filter @legends/api test -- retro.test.ts`
Expected: PASS (os 3 novos casos + os existentes).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro.test.ts
git commit -m "feat(retro): rota admin DELETE /retro/rooms/:id arquiva sala (soft delete)"
```

---

## Task 3: Frontend — botão de lixeira, confirmação e redirect

**Files:**
- Modify: `apps/web/src/lib/retro-api.ts` (após `deleteRetroCard` ~48-50)
- Modify: `apps/web/src/lib/useRetroSocket.ts` (assinatura + `onmessage`)
- Modify: `apps/web/src/pages/RetroRoomPage.tsx` (chamada de `useRetroSocket`)
- Modify: `apps/web/src/pages/RetrosPage.tsx` (`ListRow`, `RoomCard`, `RetroSprintPage`)
- Test: `apps/web/src/pages/RetrosPage.test.tsx` (criar se não existir)

**Interfaces:**
- Consumes: `apiFetch`, `useAuth().user.role`, `useMutation`/`useQueryClient`, evento `room.deleted`.
- Produces: `deleteRetroRoom(roomId: string): Promise<void>`; `useRetroSocket(roomId, opts?: { onRoomDeleted?: () => void })`.

- [ ] **Step 1: Adicionar o client de API**

Em `apps/web/src/lib/retro-api.ts`, após `deleteRetroCard`:

```ts
export function deleteRetroRoom(roomId: string) {
  return apiFetch<void>(`/retro/rooms/${roomId}`, { method: 'DELETE' })
}
```

- [ ] **Step 2: Tratar `room.deleted` no socket (com redirect via ref)**

Em `apps/web/src/lib/useRetroSocket.ts`:

Mudar a assinatura para aceitar opções e guardar o callback num ref (evita reconectar quando a identidade da função muda):

```ts
export function useRetroSocket(roomId: string, opts?: { onRoomDeleted?: () => void }): {
```

Logo no início do corpo da função (junto dos outros `useRef`):

```ts
  const onRoomDeletedRef = useRef(opts?.onRoomDeleted)
  onRoomDeletedRef.current = opts?.onRoomDeleted
```

No `ws.onmessage`, antes do bloco `qc.setQueryData(...)` (junto dos outros early-returns como `phase.changed`):

```ts
        if (e.type === 'room.deleted') {
          qc.invalidateQueries({ queryKey: ['retro-rooms'] })
          onRoomDeletedRef.current?.()
          return
        }
```

> O `useEffect` continua com deps `[roomId, qc]` — o ref garante que mudar o callback não derruba a conexão.

- [ ] **Step 3: Passar o redirect na página da sala**

Em `apps/web/src/pages/RetroRoomPage.tsx`, onde hoje há `const socket = useRetroSocket(id)` (~linha 56), trocar por:

```ts
  const socket = useRetroSocket(id, { onRoomDeleted: () => navigate('/retrospectivas') })
```

> `navigate` já existe na página (`const navigate = useNavigate()` ~linha 54).

- [ ] **Step 4: Escrever o teste de UI (falhando)**

Em `apps/web/src/pages/RetrosPage.test.tsx` (criar se não existir; espelhar mocks de `RetroRoomPage.test.tsx`). Cobrir: admin vê a lixeira e confirma → chama `deleteRetroRoom`; não-admin não vê a lixeira.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const room = {
  id: 'r1', sprint: 42, squads: [{ id: 's1', name: 'Inovação' }], status: 'OPEN',
  anonymous: false, votesPerParticipant: 3, createdAt: '', concludedAt: null,
  creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR',
}

vi.mock('../lib/retro-api', () => ({
  listRetroRooms: vi.fn(async () => ({ rooms: [room] })),
  listRetroSquads: vi.fn(async () => ({ squads: [] })),
  listInvitableUsers: vi.fn(async () => ({ users: [] })),
  createRetroRoom: vi.fn(),
  deleteRetroRoom: vi.fn(async () => undefined),
}))

let role = 'ADMIN'
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'a1', role } }) }))

import * as api from '../lib/retro-api'
import { RetroSprintPage } from './RetrosPage'

function renderSprint() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/retrospectivas/sprint/42']}>
        <RetroSprintPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RetroSprintPage — arquivar sala (admin)', () => {
  beforeEach(() => { role = 'ADMIN'; vi.clearAllMocks() })

  it('admin confirma e arquiva a sala', async () => {
    renderSprint()
    const trash = await screen.findByRole('button', { name: /arquivar sala/i })
    fireEvent.click(trash)
    fireEvent.click(await screen.findByRole('button', { name: /^arquivar$/i }))
    await waitFor(() => expect(api.deleteRetroRoom).toHaveBeenCalledWith('r1'))
  })

  it('não-admin não vê o botão de arquivar', async () => {
    role = 'DEV'
    renderSprint()
    await screen.findByText('Inovação')
    expect(screen.queryByRole('button', { name: /arquivar sala/i })).toBeNull()
  })
})
```

> Se `RetroSprintPage` não estiver exportada, exporte-a (`export function RetroSprintPage`). Confirme o `initialEntries`/uso de `useParams` no componente e ajuste o wrapper se ele depender de uma rota `:sprint`.

- [ ] **Step 5: Rodar o teste para vê-lo falhar**

Run: `pnpm --filter @legends/web test -- RetrosPage.test.tsx`
Expected: FAIL — botão "Arquivar sala" não existe ainda.

- [ ] **Step 6: Implementar a UI**

Em `apps/web/src/pages/RetrosPage.tsx`:

Importar o que falta no topo:

```ts
import { Icon } from '../components/Icon'
import { createRetroRoom, deleteRetroRoom, listInvitableUsers, listRetroRooms, listRetroSquads } from '../lib/retro-api'
```

Adicionar `action` ao `ListRow` (deixa o botão fora do `<Link>`, evitando `<button>` aninhado em `<a>`):

```tsx
function ListRow({
  to,
  accent,
  title,
  meta,
  chips,
  action,
}: {
  to: string
  accent: 'primary' | 'muted'
  title: ReactNode
  meta?: ReactNode
  chips?: ReactNode
  action?: ReactNode
}) {
  return (
    <li className="relative">
      <Link
        to={to}
        className="group relative flex items-center gap-md overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container py-md pl-lg pr-md transition-all hover:border-primary/60 hover:bg-surface-container-high hover:shadow-lg"
      >
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-1.5 rounded-r-full ${accent === 'primary' ? 'bg-primary' : 'bg-outline-variant/60'}`}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-headline text-title-md text-on-surface">{title}</h3>
          {meta && <p className="mt-0.5 truncate text-body-sm text-on-surface-variant">{meta}</p>}
        </div>
        {chips && <div className="hidden shrink-0 items-center gap-sm sm:flex">{chips}</div>}
        <ArrowAffordance />
      </Link>
      {action && <div className="absolute right-2 top-2 z-10">{action}</div>}
    </li>
  )
}
```

> O `action` fica sobreposto no canto superior direito do card; basta para a lixeira. Se colidir visualmente com os chips, ajuste o posicionamento (ex.: `right-14`).

Trocar `RoomCard` para aceitar um handler opcional de arquivamento:

```tsx
function RoomCard({ room, onArchive }: { room: RetroRoomSummaryDTO; onArchive?: (room: RetroRoomSummaryDTO) => void }) {
  return (
    <ListRow
      to={`/retrospectivas/${room.id}`}
      accent={room.status === 'OPEN' ? 'primary' : 'muted'}
      title={room.squads.map((s) => s.name).join(', ')}
      meta={`${room.creator.name} · ${room.participantCount} participantes`}
      chips={
        <>
          <Chip tone={room.status === 'OPEN' ? 'primary' : 'neutral'}>{STATUS_LABEL[room.status]}</Chip>
          {room.anonymous && <Chip>anônima</Chip>}
        </>
      }
      action={
        onArchive ? (
          <button
            type="button"
            aria-label="Arquivar sala"
            onClick={() => onArchive(room)}
            className="grid h-9 w-9 place-items-center rounded-full bg-surface-container-highest text-on-surface-variant transition-colors hover:bg-error hover:text-on-error"
          >
            <Icon name="delete" className="text-[18px]" />
          </button>
        ) : undefined
      }
    />
  )
}
```

> Confirme que existe um glyph `delete` no `Icon` (material symbols). Se não, use `trash` ou o nome equivalente disponível no componente.

No `RetroSprintPage`, adicionar role admin, estado do modal e a mutation; passar `onArchive` para os `RoomCard`:

```tsx
export function RetroSprintPage() {
  const { user } = useAuth()
  const isLead = user?.role === 'LEAD'
  const isAdmin = user?.role === 'ADMIN'
  const qc = useQueryClient()
  const [toArchive, setToArchive] = useState<RetroRoomSummaryDTO | null>(null)
  const archive = useMutation({
    mutationFn: (room: RetroRoomSummaryDTO) => deleteRetroRoom(room.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['retro-rooms'] })
      setToArchive(null)
    },
  })
  // ... resto do componente como hoje (query de salas, filtro por sprint)
```

E onde os cards são renderizados (hoje `{filtered.map((room) => <RoomCard key={room.id} room={room} />)}`):

```tsx
{filtered.map((room) => (
  <RoomCard key={room.id} room={room} onArchive={isAdmin ? setToArchive : undefined} />
))}
```

Antes do fechamento do componente, renderizar o modal de confirmação:

```tsx
{toArchive && (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-lg" role="dialog" aria-modal="true">
    <div className="w-full max-w-md rounded-xl bg-surface-container-high p-lg shadow-xl">
      <h3 className="font-headline text-title-lg text-on-surface">Arquivar sala</h3>
      <p className="mt-2 text-body-md text-on-surface-variant">
        Arquivar a sala da sprint {toArchive.sprint} ({toArchive.squads.map((s) => s.name).join(', ')})?
        Os dados ficam ocultos, mas não são apagados.
      </p>
      <div className="mt-lg flex justify-end gap-sm">
        <button
          type="button"
          onClick={() => setToArchive(null)}
          className="rounded-md px-lg py-sm font-label text-label-lg text-on-surface-variant hover:bg-surface-container-highest"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={archive.isPending}
          onClick={() => archive.mutate(toArchive)}
          className="rounded-md bg-error px-lg py-sm font-label text-label-lg font-bold text-on-error transition-colors hover:bg-error/90 disabled:opacity-60"
        >
          Arquivar
        </button>
      </div>
    </div>
  </div>
)}
```

> Mantenha o `isLead` usado pelo botão "Nova sala" existente. Use os mesmos tokens de cor/estilo do `CreateRoomModal` vizinho se divergir.

- [ ] **Step 7: Rodar os testes — devem passar**

Run: `pnpm --filter @legends/web test -- RetrosPage.test.tsx`
Expected: PASS (os 2 casos).

- [ ] **Step 8: Typecheck do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os workspaces passam.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/retro-api.ts apps/web/src/lib/useRetroSocket.ts apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetrosPage.tsx apps/web/src/pages/RetrosPage.test.tsx
git commit -m "feat(retro): admin arquiva sala pela listagem com confirmação e redirect"
```

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura da spec:**
- Soft delete via `archivedAt` → Task 1 (schema) + Task 2 (`archiveRoom`). ✔
- Auditoria `archivedById` → Task 1 + teste em Task 2 Step 1. ✔
- Filtro em listagens/acesso (404) → Task 2 Step 3 (`loadRoom`, `listRoomsForUser`, `getRoomMeta`, `priorConcludedSquadRooms`). ✔
- Rota admin `DELETE` + 403 não-admin → Task 2 Step 4 + testes. ✔
- Broadcast `room.deleted` + redirect → Task 1 Step 4 (evento), Task 2 Step 4 (broadcast), Task 3 Steps 2-3 (redirect). ✔
- UI lixeira só admin + confirmação → Task 3 Step 6 + testes Step 4. ✔
- Sem mudança de DTO de sala (archivedAt não exposto) → respeitado (só o evento entra no contrato). ✔
- Testes (204/404/403/inexistente/dados preservados) → Task 2 Step 1. ✔

**Placeholders:** nenhum TODO/TBD; todo passo de código traz o código.

**Consistência de tipos:** `archiveRoom({ roomId, userId })`, `deleteRetroRoom(roomId)`, `useRetroSocket(roomId, { onRoomDeleted })`, evento `{ type: 'room.deleted' }` — coerentes entre tasks.
