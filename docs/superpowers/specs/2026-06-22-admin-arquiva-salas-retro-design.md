# Admin arquiva salas de retrospectiva — Design

**Data:** 2026-06-22
**Status:** aprovado

## Objetivo

Permitir que um usuário com role `ADMIN` exclua (arquive) salas de retrospectiva
diretamente da listagem de salas. A exclusão é **soft delete**: a sala e todos os
dados vinculados (cards, votos, reações, participantes, edits) permanecem no banco,
mas a sala some de todas as listagens e fica inacessível.

## Decisões

- **Soft delete** via timestamp `archivedAt`, não hard delete. Reversível por SQL,
  preserva histórico.
- **Escopo:** admin pode arquivar **qualquer** sala — `OPEN` ou `CONCLUDED`,
  independente de quem criou.
- **UI:** ícone de lixeira em cada card da listagem (`RoomCard`), visível **apenas**
  para `ADMIN`, com modal de confirmação.
- **Sem UI de restaurar** (YAGNI — reverter é operação rara, feita por SQL).
- Acessar uma sala arquivada por id retorna **404**.

## Backend (`apps/api`)

### Schema + migration

Adicionar em `model RetroRoom` (`prisma/schema.prisma`):

```prisma
archivedAt   DateTime?
archivedById String?
archivedBy   User?     @relation("RetroRoomsArchived", fields: [archivedById], references: [id], onDelete: SetNull)
```

`onDelete: SetNull` segue o padrão de `auditedById`/`editedById` em `RetroCard`.
Acrescentar a relação inversa em `model User` (`retroRoomsArchived RetroRoom[] @relation("RetroRoomsArchived")`).

Gerar migration com `pnpm db:migrate` — operação **não destrutiva** (apenas adiciona
colunas nullable).

### Service (`services/retro-service.ts`)

Nova função:

```ts
export async function archiveRoom(input: { roomId: string; userId: string }): Promise<void>
```

- Carrega a sala com `loadRoom` (404 se não existir / já arquivada).
- Atualiza `archivedAt: new Date()`, `archivedById: input.userId`.

**Filtro de arquivadas:** `loadRoom` e todas as funções de listagem
(`listRooms` e qualquer consulta por sprint/squad que liste salas) passam a incluir
`archivedAt: null` no `where`. Consequência: sala arquivada some das listagens e
`GET /retro/rooms/:id` retorna 404.

### Rota (`routes/retro.ts`)

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

## Frontend (`apps/web`)

### API (`lib/retro-api.ts`)

```ts
export function deleteRetroRoom(roomId: string) {
  return apiFetch<void>(`/retro/rooms/${roomId}`, { method: 'DELETE' })
}
```

### UI (`pages/RetrosPage.tsx` / `RoomCard`)

- Ícone de lixeira no `RoomCard`, renderizado só quando `user?.role === 'ADMIN'`.
- Clique abre modal de confirmação: "Arquivar a sala da sprint X? Os dados ficam
  ocultos." com ações Cancelar / Arquivar.
- `useMutation` com `mutationFn: () => deleteRetroRoom(id)` e
  `onSuccess: invalidateQueries({ queryKey: ['retro-rooms'] })`.

### Sessão aberta

No detalhe da sala, ao receber o evento `room.deleted` pelo `retroHub`, redirecionar
o usuário para a listagem de retrospectivas.

## Shared (`packages/shared`)

Sem mudança de DTO. `archivedAt` não é exposto ao cliente — salas arquivadas
simplesmente não aparecem nos payloads.

## Testes (`apps/api`, Vitest contra Postgres real)

- Admin arquiva sala → `204`; a sala some de `GET /retro/rooms`; `GET /retro/rooms/:id`
  retorna `404`.
- Dados vinculados (cards/votos) permanecem no banco (count > 0 após arquivar).
- `DEV` e `LEAD` recebem `403` ao tentar `DELETE /retro/rooms/:id`.
- Arquivar sala inexistente → `404`.
