# Admin gerencia salas de retrospectiva (editar / arquivar / deletar) — Design

**Data:** 2026-06-26
**Status:** aprovado

## Contexto e problema

A ação de arquivar sala já existe (ver `2026-06-22-admin-arquiva-salas-retro-design.md`):
`DELETE /retro/rooms/:id` protegido por `requireAdmin`, soft delete via `archivedAt`.

Porém o **admin não consegue chegar até essa ação**, por três bloqueios:

1. **Menu** — `apps/web/src/components/nav-items.ts:13-24`: admin recebe um menu fixo
   que **não inclui** `/retrospectivas`.
2. **Rota** — `apps/web/src/App.tsx` (`DevOnly`): admin que acessa `/retrospectivas`
   é redirecionado para `/admin`.
3. **Backend** — `apps/api/src/services/retro-service.ts` (`listRoomsForUser`):
   só devolve todas as salas para `isLeaderRole` (LEAD/MANAGER/HEAD); `ADMIN` não
   está incluído, então a lista vem vazia.

Resultado: o botão "Arquivar" existe e é exclusivo do admin, mas o admin não tem
como vê-lo. Como arquivar/gerenciar salas é uma ação de **gestão de plataforma**,
o lugar coerente é o painel `/admin` (a filosofia do código é "admin gerencia pelo
`/admin`, não participa do dia a dia").

## Objetivo

Adicionar uma aba **"Retrospectivas"** ao painel `/admin` onde o admin lista todas
as salas e executa três ações por sala: **Editar**, **Arquivar** e **Deletar**.
O admin **não** abre o board nem vota — apenas gerencia.

## Decisões

- **Superfície:** nova aba no `/admin` (state local, padrão das demais seções),
  **não** liberar a página pública `/retrospectivas` para admin. Os três bloqueios
  acima permanecem como estão.
- **Editar** altera `sprint`, `squadIds` e `votesPerParticipant`. Modo anônimo e
  participantes ficam fora (anônimo já tem toggle dentro da sala; participantes têm
  fluxo próprio do facilitador).
- **Arquivar** = soft delete já existente (reusa `DELETE /retro/rooms/:id`).
- **Deletar** = **hard delete** novo: remove a sala e, por cascata, todos os dados
  vinculados. Irreversível. Existe separadamente do arquivar.
- **Sem migration** — o schema não muda.
- **Fora de escopo (YAGNI):** restaurar salas arquivadas, admin abrir/visualizar o
  board, editar participantes/anônimo, push ao vivo via WS na edição.

## Backend (`apps/api`)

Todas as rotas novas em `routes/admin.ts` sob `adminOnly`
(`{ onRequest: [app.authenticate, app.requireAdmin] }`), com a lógica em
`services/retro-service.ts` seguindo o padrão route→service→prisma e erros
`RetroError` tipados.

### Listar — `GET /admin/retro/rooms`

Service: `listRoomsForAdmin(): Promise<RetroRoomWithRelations[]>` — todas as salas
com `archivedAt: null` (status `OPEN` **e** `CONCLUDED`), `orderBy: { sprint: 'desc' }`
(empate por `createdAt` desc), `include: retroRoomInclude`.

Rota serializa com `toRetroRoomSummaryDTO(room, 'OBSERVER')` (admin não participa, daí
o fallback). Resposta: `{ rooms: RetroRoomSummaryDTO[] }`.

### Editar — `PATCH /admin/retro/rooms/:id`

Schema Zod (`safeParse`, 400 em falha), todos os campos opcionais, espelhando a
validação de `createRoom`:

```ts
const updateRoomAdminSchema = z.object({
  sprint: z.number().int().positive().optional(),
  squadIds: z.array(z.string()).min(1).optional(),
  votesPerParticipant: z.number().int().min(1).max(MAX_VOTES).optional(),
})
```

> Os limites exatos (range de `votesPerParticipant`, validação de sprint) devem
> copiar os do `createRoom`/`CreateRetroRoomRequest` no momento da implementação —
> não inventar bounds novos.

Service: `updateRoomAsAdmin(input: { roomId: string; sprint?; squadIds?; votesPerParticipant? })`
- `loadRoom(roomId)` → `RetroError` 404 se não existir / arquivada.
- Valida que `squadIds`, se vier, referencia squads existentes (`RetroError` 400/404
  no padrão do create).
- Atualiza os campos presentes. Quando `squadIds` vier, **recria** os
  `RetroRoomSquad` da sala (deleteMany por `roomId` + createMany) dentro de uma
  `prisma.$transaction`.
- Independe do status (corrigir metadados de sala `CONCLUDED` é válido).
- Retorna a sala atualizada com relações.

Rota: `instanceof RetroError → reply.code(err.status)`. Resposta:
`{ room: RetroRoomSummaryDTO }`.

**Limitação conhecida (aceita):** a edição não envia atualização ao vivo via
`retroHub`; clientes com a sala aberta veem a mudança no próximo carregamento. É
ação de manutenção em salas geralmente ociosas — aceitável para este escopo.

### Arquivar — reusa `DELETE /retro/rooms/:id`

Sem rota nova. O frontend chama o `deleteRetroRoom` já existente (soft delete +
broadcast `room.deleted`).

### Deletar (hard delete) — `DELETE /admin/retro/rooms/:id`

Service: `hardDeleteRoom(input: { roomId: string }): Promise<void>`
- `loadRoom(roomId)` → 404 se não existir.
- `prisma.retroRoom.delete({ where: { id } })`. A cascata do schema
  (`onDelete: Cascade` em `RetroRoomSquad`, `RetroParticipant`, `RetroCard` →
  `RetroVote`/`RetroReaction`, `RetroEdit`) remove todos os dados vinculados.

Rota: após deletar, `retroHub.broadcast(id, () => ({ type: 'room.deleted' }))`
(mesmo evento do arquivar — quem estiver na sala é redirecionado). Resposta `204`.

> Notificações que apontam para a sala via `link` ficam órfãs (link morto); não há
> FK, então não há erro. Aceitável.

## Shared (`packages/shared`)

Adicionar em `src/retro.ts` (e exportar no barril):

```ts
export interface UpdateRetroRoomAdminRequest {
  sprint?: number
  squadIds?: string[]
  votesPerParticipant?: number
}
```

`RetroRoomSummaryDTO` já existe e é reusado na listagem — sem DTO novo.

## Frontend (`apps/web`)

### API (`lib/retro-api.ts`)

```ts
export function listAdminRetroRooms() // GET /admin/retro/rooms
export function updateAdminRetroRoom(roomId, body: UpdateRetroRoomAdminRequest) // PATCH /admin/retro/rooms/:id
export function hardDeleteAdminRetroRoom(roomId) // DELETE /admin/retro/rooms/:id
```

`deleteRetroRoom` (arquivar) já existe.

### Seção (`pages/admin/RetrospectivesSection.tsx`)

- Padrão das demais seções: wrapper `Panel`, `useQuery` key `['admin','retro-rooms']`,
  `useMutation` com `invalidateQueries(['admin','retro-rooms'])` e erro via
  `ApiError`/`role="alert"`.
- Lista de salas exibindo: título derivado (`retroRoomTitle`), sprint, squads,
  status, criador, nº de participantes, data de criação.
- Três ações por sala:
  - **Editar** — abre form (inline ou modal) com sprint, multiselect de squads
    (opções de `GET /admin/squads`, que já existe) e votos por pessoa.
  - **Arquivar** — botão destrutivo + confirm simples → `deleteRetroRoom`.
  - **Deletar** — botão destrutivo + confirm **reforçado** deixando explícito que é
    permanente e apaga cards/votos/edits junto → `hardDeleteAdminRetroRoom`.
- Estado vazio: "Nenhuma sala por aqui ainda."

### Wiring

- `TabBar.tsx`: adicionar `"retrospectivas"` em `AdminTabId` e
  `{ id: "retrospectivas", label: "Retrospectivas" }` em `ADMIN_TABS`.
- `AdminPage.tsx`: `{activeTab === "retrospectivas" && <RetrospectivesSection />}`.

## Testes

### API (`routes/retro-admin.test.ts`, Vitest contra Postgres real)

- `GET /admin/retro/rooms`: admin recebe salas `OPEN` e `CONCLUDED`, **não** recebe
  arquivadas; `DEV`/`LEAD` → `403`.
- `PATCH /admin/retro/rooms/:id`: admin atualiza `sprint`/`squadIds`/`votesPerParticipant`
  e a resposta/refetch reflete; `squadIds` recria os `RetroRoomSquad`; payload
  inválido → `400`; sala inexistente → `404`; `LEAD`/`DEV` → `403`.
- `DELETE /admin/retro/rooms/:id` (hard): admin deleta → `204`; a sala e os dados
  vinculados (cards/votos) **somem do banco** (count == 0); sala inexistente → `404`;
  `LEAD`/`DEV` → `403`.

### Web

- Render da `RetrospectivesSection`: lista as salas e dispara as mutations de
  editar/arquivar/deletar, seguindo o padrão de teste das demais seções admin (se
  houver cobertura equivalente).
