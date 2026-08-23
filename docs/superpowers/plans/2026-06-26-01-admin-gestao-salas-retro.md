# Admin gerencia salas de retrospectiva (editar / arquivar / deletar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao admin uma aba "Retrospectivas" no painel `/admin` para listar todas as salas e Editar / Arquivar / Deletar (hard delete) cada uma.

**Architecture:** Novas rotas `/admin/retro/rooms*` em `apps/api/src/routes/admin.ts` (sob `adminOnly`), com lógica em `apps/api/src/services/retro-service.ts` (padrão route→service→prisma, erros `RetroError` tipados). Arquivar reusa o `DELETE /retro/rooms/:id` existente. Frontend: nova seção `RetrospectivesSection` no padrão das demais abas de `/admin`. Sem migration (schema não muda).

**Tech Stack:** Fastify 4 + Prisma 5 + Zod (api), React 18 + React Query + Tailwind (web), Vitest contra Postgres real (api) e jsdom + Testing Library (web). Contrato em `@legends/shared`.

## Global Constraints

- Mensagens voltadas ao usuário em **português**.
- TypeScript strict, ESM puro. Imports cruzados via nome do workspace (`@legends/shared`).
- Camadas finas: route valida (Zod `safeParse` → `400 { message }`), chama service, serializa; service tem a regra e lança `RetroError(message, status)`; route faz `instanceof RetroError → reply.code(err.status).send({ message })`.
- Validação de edição espelha a de criação. Constantes exatas (de `@legends/shared`): `MIN_SPRINT = 1`, `MAX_SPRINT = 999`, `MIN_VOTES_PER_PARTICIPANT = 1`, `MAX_VOTES_PER_PARTICIPANT = 20`.
- Testes da API exigem Postgres de pé (`pnpm db:up`). Rode `pnpm test` antes de concluir; ao mexer em DTO/include Prisma, rode `tsc --noEmit` por workspace.
- Rotas admin protegidas com `adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }`.
- Commits frequentes, mensagens em português.

---

## File Structure

- **Modify** `packages/shared/src/retro.ts` — adicionar `UpdateRetroRoomAdminRequest` (já reexportado por `index.ts` via `export * from './retro'`).
- **Modify** `apps/api/src/services/retro-service.ts` — adicionar `listRoomsForAdmin`, `updateRoomAsAdmin`, `hardDeleteRoom`.
- **Modify** `apps/api/src/routes/admin.ts` — adicionar `GET/PATCH/DELETE /admin/retro/rooms`.
- **Create** `apps/api/src/routes/retro-admin.test.ts` — testes de integração das novas rotas.
- **Modify** `apps/web/src/lib/retro-api.ts` — adicionar `listAdminRetroRooms`, `updateAdminRetroRoom`, `hardDeleteAdminRetroRoom`.
- **Create** `apps/web/src/pages/admin/RetrospectivesSection.tsx` — a seção da aba.
- **Modify** `apps/web/src/pages/admin/TabBar.tsx` — registrar a aba.
- **Modify** `apps/web/src/pages/AdminPage.tsx` — renderizar a seção.
- **Create** `apps/web/src/pages/admin/RetrospectivesSection.test.tsx` — teste de render/interação.

---

## Task 1: Backend — listar salas para o admin (`GET /admin/retro/rooms`)

**Files:**
- Modify: `packages/shared/src/retro.ts` (perto das outras interfaces de request)
- Modify: `apps/api/src/services/retro-service.ts` (após `listRoomsForUser`, ~linha 134)
- Modify: `apps/api/src/routes/admin.ts` (imports no topo; rota dentro de `adminRoutes`)
- Test: `apps/api/src/routes/retro-admin.test.ts`

**Interfaces:**
- Produces:
  - `UpdateRetroRoomAdminRequest` (shared): `{ sprint?: number; squadIds?: string[]; votesPerParticipant?: number }` — usada nas Tasks 2 e 4.
  - `listRoomsForAdmin(): Promise<RetroRoomWithRelations[]>` (retro-service) — usada pela rota.
  - `GET /admin/retro/rooms` → `{ rooms: RetroRoomSummaryDTO[] }`.
- Consumes: `retroRoomInclude`, `RetroRoomWithRelations`, `prisma` (já em retro-service); `toRetroRoomSummaryDTO` (serialize); `adminOnly` (admin.ts).

- [ ] **Step 1: Adicionar o tipo compartilhado**

Em `packages/shared/src/retro.ts`, junto das outras interfaces `Create*Request` (após `CreateRetroRoomRequest`), adicionar:

```ts
export interface UpdateRetroRoomAdminRequest {
  sprint?: number
  squadIds?: string[]
  votesPerParticipant?: number
}
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `apps/api/src/routes/retro-admin.test.ts`:

```ts
// apps/api/src/routes/retro-admin.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function leadToken(app: any, name = 'Lia') {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'LEAD' } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'LEAD' }) }
}
async function devToken(app: any, name = 'Dan') {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'LEGEND' } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'LEGEND' }) }
}
async function adminToken(app: any, name = 'Ada') {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'ADMIN' }) }
}
async function mkSquad(app: any, name = 'Inovação') {
  const s = await prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
  return s.id
}
async function mkRoom(app: any, leadTk: string, squadId: string, sprint = 10) {
  const res = await app.inject({
    method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` },
    payload: { sprint, squadIds: [squadId], votesPerParticipant: 3, participantIds: [] },
  })
  return res.json().room.id as string
}

describe('admin retro rooms — listagem', () => {
  it('ADMIN lista salas OPEN e CONCLUDED, mas não as arquivadas', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const openId = await mkRoom(app, lead.token, squadId, 11)
    const concludedId = await mkRoom(app, lead.token, squadId, 12)
    const archivedId = await mkRoom(app, lead.token, squadId, 13)

    // conclui uma e arquiva outra
    await prisma.retroRoom.update({ where: { id: concludedId }, data: { status: 'CONCLUDED', concludedAt: new Date() } })
    await app.inject({ method: 'DELETE', url: `/retro/rooms/${archivedId}`, headers: { authorization: `Bearer ${admin.token}` } })

    const res = await app.inject({ method: 'GET', url: '/admin/retro/rooms', headers: { authorization: `Bearer ${admin.token}` } })
    expect(res.statusCode).toBe(200)
    const ids = res.json().rooms.map((r: { id: string }) => r.id)
    expect(ids).toContain(openId)
    expect(ids).toContain(concludedId)
    expect(ids).not.toContain(archivedId)
    await app.close()
  })

  it('LEAD e DEV recebem 403', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const a = await app.inject({ method: 'GET', url: '/admin/retro/rooms', headers: { authorization: `Bearer ${lead.token}` } })
    const b = await app.inject({ method: 'GET', url: '/admin/retro/rooms', headers: { authorization: `Bearer ${dev.token}` } })
    expect(a.statusCode).toBe(403)
    expect(b.statusCode).toBe(403)
    await app.close()
  })
})
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- retro-admin`
Expected: FAIL — `GET /admin/retro/rooms` retorna 404 (rota não existe).

- [ ] **Step 4: Implementar o service**

Em `apps/api/src/services/retro-service.ts`, após `listRoomsForUser` (~linha 134), adicionar:

```ts
/** Lista todas as salas não arquivadas para gestão pelo admin (OPEN + CONCLUDED). */
export async function listRoomsForAdmin(): Promise<RetroRoomWithRelations[]> {
  return prisma.retroRoom.findMany({
    where: { archivedAt: null },
    include: retroRoomInclude,
    orderBy: [{ sprint: 'desc' }, { createdAt: 'desc' }],
  })
}
```

- [ ] **Step 5: Implementar a rota**

Em `apps/api/src/routes/admin.ts`, adicionar aos imports do topo:

```ts
import { listRoomsForAdmin } from '../services/retro-service'
import { toRetroRoomSummaryDTO } from '../lib/serialize'
```

Dentro de `adminRoutes(app)`, adicionar (junto às outras rotas, ex. após as de squads):

```ts
app.get('/admin/retro/rooms', adminOnly, async (_request, reply) => {
  const rooms = await listRoomsForAdmin()
  // admin não participa: papel OBSERVER apenas para satisfazer o DTO.
  return reply.send({ rooms: rooms.map((room) => toRetroRoomSummaryDTO(room, 'OBSERVER')) })
})
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- retro-admin`
Expected: PASS (2 testes).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/retro.ts apps/api/src/services/retro-service.ts apps/api/src/routes/admin.ts apps/api/src/routes/retro-admin.test.ts
git commit -m "feat(retro): admin lista salas para gestão (GET /admin/retro/rooms)"
```

---

## Task 2: Backend — editar sala (`PATCH /admin/retro/rooms/:id`)

**Files:**
- Modify: `apps/api/src/services/retro-service.ts` (após `listRoomsForAdmin`)
- Modify: `apps/api/src/routes/admin.ts` (schema Zod no topo do arquivo + rota)
- Test: `apps/api/src/routes/retro-admin.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `loadRoom`, `assertSprint`, `assertVotes`, `RetroError`, `prisma`, `retroRoomInclude` (retro-service); `MIN_SPRINT`, `MAX_SPRINT`, `MIN_VOTES_PER_PARTICIPANT`, `MAX_VOTES_PER_PARTICIPANT` (@legends/shared).
- Produces:
  - `updateRoomAsAdmin(input: { roomId: string; sprint?: number; squadIds?: string[]; votesPerParticipant?: number }): Promise<RetroRoomWithRelations>`.
  - `PATCH /admin/retro/rooms/:id` → `{ room: RetroRoomSummaryDTO }`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/routes/retro-admin.test.ts`, adicionar ao final (antes do fechamento do arquivo) um novo bloco. Reusa os helpers já definidos no arquivo (`leadToken`, `adminToken`, `mkSquad`, `mkRoom`):

```ts
describe('admin retro rooms — edição', () => {
  it('ADMIN edita sprint, squads e votos; recria os RetroRoomSquad', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadA = await mkSquad(app, 'Squad A')
    const squadB = await mkSquad(app, 'Squad B')
    const roomId = await mkRoom(app, lead.token, squadA, 20)

    const res = await app.inject({
      method: 'PATCH', url: `/admin/retro/rooms/${roomId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { sprint: 21, squadIds: [squadB], votesPerParticipant: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().room.sprint).toBe(21)
    expect(res.json().room.votesPerParticipant).toBe(5)
    expect(res.json().room.squads.map((s: { id: string }) => s.id)).toEqual([squadB])

    const squads = await prisma.retroRoomSquad.findMany({ where: { roomId } })
    expect(squads.map((s) => s.squadId)).toEqual([squadB])
    await app.close()
  })

  it('valida payload inválido (400) e sala inexistente (404)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const roomId = await mkRoom(app, lead.token, squadId, 30)

    const bad = await app.inject({
      method: 'PATCH', url: `/admin/retro/rooms/${roomId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { votesPerParticipant: 999 },
    })
    expect(bad.statusCode).toBe(400)

    const missing = await app.inject({
      method: 'PATCH', url: '/admin/retro/rooms/nao-existe',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { sprint: 5 },
    })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })

  it('LEAD recebe 403 ao editar', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const squadId = await mkSquad(app)
    const roomId = await mkRoom(app, lead.token, squadId, 40)
    const res = await app.inject({
      method: 'PATCH', url: `/admin/retro/rooms/${roomId}`,
      headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 41 },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- retro-admin`
Expected: FAIL — `PATCH /admin/retro/rooms/:id` retorna 404 (rota não existe).

- [ ] **Step 3: Implementar o service**

Em `apps/api/src/services/retro-service.ts`, após `listRoomsForAdmin`, adicionar:

```ts
/** Edita metadados da sala (sprint, squads, votos) — uso administrativo. */
export async function updateRoomAsAdmin(input: {
  roomId: string
  sprint?: number
  squadIds?: string[]
  votesPerParticipant?: number
}): Promise<RetroRoomWithRelations> {
  await loadRoom(input.roomId) // 404 se não existir / arquivada

  const data: Prisma.RetroRoomUpdateInput = {}
  if (input.sprint !== undefined) {
    assertSprint(input.sprint)
    data.sprint = input.sprint
  }
  if (input.votesPerParticipant !== undefined) {
    assertVotes(input.votesPerParticipant)
    data.votesPerParticipant = input.votesPerParticipant
  }

  let squadIds: string[] | null = null
  if (input.squadIds !== undefined) {
    squadIds = [...new Set(input.squadIds)]
    if (squadIds.length === 0) throw new RetroError('Selecione ao menos uma squad.', 400)
    const squads = await prisma.squad.findMany({ where: { id: { in: squadIds } } })
    if (squads.length !== squadIds.length || squads.some((s) => !s.active)) {
      throw new RetroError('Squad inválida.', 400)
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.retroRoom.update({ where: { id: input.roomId }, data })
    }
    if (squadIds) {
      await tx.retroRoomSquad.deleteMany({ where: { roomId: input.roomId } })
      await tx.retroRoomSquad.createMany({ data: squadIds.map((squadId) => ({ roomId: input.roomId, squadId })) })
    }
  })

  return loadRoom(input.roomId)
}
```

- [ ] **Step 4: Implementar a rota**

Em `apps/api/src/routes/admin.ts`, adicionar ao import do service da Task 1:

```ts
import { listRoomsForAdmin, updateRoomAsAdmin, RetroError } from '../services/retro-service'
```

Adicionar aos imports de `@legends/shared` (já existe a linha `import { USER_ROLES, AREAS } from '@legends/shared'` — estender):

```ts
import { USER_ROLES, AREAS, MIN_SPRINT, MAX_SPRINT, MIN_VOTES_PER_PARTICIPANT, MAX_VOTES_PER_PARTICIPANT } from '@legends/shared'
```

Adicionar o schema Zod junto aos outros schemas no topo do arquivo:

```ts
const updateRetroRoomSchema = z.object({
  sprint: z.number().int().min(MIN_SPRINT).max(MAX_SPRINT).optional(),
  squadIds: z.array(z.string()).min(1).max(50).optional(),
  votesPerParticipant: z.number().int().min(MIN_VOTES_PER_PARTICIPANT).max(MAX_VOTES_PER_PARTICIPANT).optional(),
})
```

Adicionar a rota dentro de `adminRoutes`, logo após o `GET /admin/retro/rooms`:

```ts
app.patch('/admin/retro/rooms/:id', adminOnly, async (request, reply) => {
  const { id } = request.params as { id: string }
  const parsed = updateRetroRoomSchema.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
  try {
    const room = await updateRoomAsAdmin({ roomId: id, ...parsed.data })
    return reply.send({ room: toRetroRoomSummaryDTO(room, 'OBSERVER') })
  } catch (err) {
    if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
    throw err
  }
})
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- retro-admin`
Expected: PASS (todos, incluindo os 3 novos de edição).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/admin.ts apps/api/src/routes/retro-admin.test.ts
git commit -m "feat(retro): admin edita sala (PATCH /admin/retro/rooms/:id)"
```

---

## Task 3: Backend — hard delete (`DELETE /admin/retro/rooms/:id`)

**Files:**
- Modify: `apps/api/src/services/retro-service.ts` (após `updateRoomAsAdmin`)
- Modify: `apps/api/src/routes/admin.ts` (import `retroHub` + rota)
- Test: `apps/api/src/routes/retro-admin.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `loadRoom`, `RetroError`, `prisma` (retro-service); `retroHub` (lib/retro-hub).
- Produces:
  - `hardDeleteRoom(input: { roomId: string }): Promise<void>`.
  - `DELETE /admin/retro/rooms/:id` → `204`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/routes/retro-admin.test.ts`, adicionar novo bloco ao final (reusa helpers do arquivo):

```ts
describe('admin retro rooms — hard delete', () => {
  it('ADMIN deleta de vez: sala e dados vinculados somem do banco (204)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const roomId = await mkRoom(app, lead.token, squadId, 50)
    // cria um card com voto para provar a cascata
    const card = await prisma.retroCard.create({ data: { roomId, authorId: lead.id, text: 'x', x: 0, y: 0, color: 'yellow', kind: 'note' } })
    await prisma.retroVote.create({ data: { cardId: card.id, userId: lead.id } })

    const del = await app.inject({ method: 'DELETE', url: `/admin/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${admin.token}` } })
    expect(del.statusCode).toBe(204)

    expect(await prisma.retroRoom.findUnique({ where: { id: roomId } })).toBeNull()
    expect(await prisma.retroCard.count({ where: { roomId } })).toBe(0)
    expect(await prisma.retroVote.count({ where: { cardId: card.id } })).toBe(0)
    expect(await prisma.retroRoomSquad.count({ where: { roomId } })).toBe(0)
    await app.close()
  })

  it('sala inexistente → 404; LEAD → 403', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const admin = await adminToken(app)
    const squadId = await mkSquad(app)
    const roomId = await mkRoom(app, lead.token, squadId, 60)

    const missing = await app.inject({ method: 'DELETE', url: '/admin/retro/rooms/nao-existe', headers: { authorization: `Bearer ${admin.token}` } })
    expect(missing.statusCode).toBe(404)

    const forbidden = await app.inject({ method: 'DELETE', url: `/admin/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test -- retro-admin`
Expected: FAIL — `DELETE /admin/retro/rooms/:id` retorna 404 (rota não existe).

- [ ] **Step 3: Implementar o service**

Em `apps/api/src/services/retro-service.ts`, após `updateRoomAsAdmin`, adicionar:

```ts
/** Exclusão definitiva da sala (cascata remove cards/votos/reações/participantes/squads/edits). */
export async function hardDeleteRoom(input: { roomId: string }): Promise<void> {
  await loadRoom(input.roomId) // 404 se não existir / arquivada
  await prisma.retroRoom.delete({ where: { id: input.roomId } })
}
```

- [ ] **Step 4: Implementar a rota**

Em `apps/api/src/routes/admin.ts`, estender o import do retro-service e adicionar o `retroHub`:

```ts
import { listRoomsForAdmin, updateRoomAsAdmin, hardDeleteRoom, RetroError } from '../services/retro-service'
import { retroHub } from '../lib/retro-hub'
```

Adicionar a rota dentro de `adminRoutes`, após o `PATCH /admin/retro/rooms/:id`:

```ts
app.delete('/admin/retro/rooms/:id', adminOnly, async (request, reply) => {
  const { id } = request.params as { id: string }
  try {
    await hardDeleteRoom({ roomId: id })
    retroHub.broadcast(id, () => ({ type: 'room.deleted' }))
    return reply.code(204).send()
  } catch (err) {
    if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
    throw err
  }
})
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api test -- retro-admin`
Expected: PASS (todos os blocos).

- [ ] **Step 6: Typecheck da API**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/admin.ts apps/api/src/routes/retro-admin.test.ts
git commit -m "feat(retro): admin deleta sala de vez (DELETE /admin/retro/rooms/:id)"
```

---

## Task 4: Frontend — aba "Retrospectivas" no painel admin

**Files:**
- Modify: `apps/web/src/lib/retro-api.ts`
- Create: `apps/web/src/pages/admin/RetrospectivesSection.tsx`
- Modify: `apps/web/src/pages/admin/TabBar.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`
- Test: `apps/web/src/pages/admin/RetrospectivesSection.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (lib/api), `RetroRoomSummaryDTO` + `UpdateRetroRoomAdminRequest` (@legends/shared), `Panel`/`inputCls` (pages/admin/shared), `deleteRetroRoom` (já existe em retro-api).
- Produces:
  - `listAdminRetroRooms()`, `updateAdminRetroRoom(roomId, body)`, `hardDeleteAdminRetroRoom(roomId)` (retro-api).
  - `AdminTabId` ganha `"retrospectivas"`; `<RetrospectivesSection />` renderizado em `AdminPage`.

- [ ] **Step 1: Adicionar as funções de API**

Em `apps/web/src/lib/retro-api.ts`, estender o import de tipos e adicionar as funções:

```ts
// adicionar UpdateRetroRoomAdminRequest à lista de imports de '@legends/shared'
export function listAdminRetroRooms() {
  return apiFetch<{ rooms: RetroRoomSummaryDTO[] }>('/admin/retro/rooms')
}
export function updateAdminRetroRoom(roomId: string, body: UpdateRetroRoomAdminRequest) {
  return apiFetch<{ room: RetroRoomSummaryDTO }>(`/admin/retro/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify(body) })
}
export function hardDeleteAdminRetroRoom(roomId: string) {
  return apiFetch<void>(`/admin/retro/rooms/${roomId}`, { method: 'DELETE' })
}
```

(`deleteRetroRoom` — arquivar — já existe no arquivo; reusar.)

- [ ] **Step 2: Registrar a aba no TabBar**

Em `apps/web/src/pages/admin/TabBar.tsx`, adicionar `"retrospectivas"` ao union e à lista:

```ts
export type AdminTabId =
  | "periodos"
  | "lendas"
  | "selos"
  | "categorias"
  | "squads"
  | "moderacao"
  | "retrospectivas";

export const ADMIN_TABS: { id: AdminTabId; label: string }[] = [
  { id: "periodos", label: "Períodos" },
  { id: "lendas", label: "Lendas" },
  { id: "selos", label: "Selos" },
  { id: "categorias", label: "Categorias" },
  { id: "squads", label: "Squads" },
  { id: "moderacao", label: "Moderação" },
  { id: "retrospectivas", label: "Retrospectivas" },
];
```

- [ ] **Step 3: Criar a seção**

Criar `apps/web/src/pages/admin/RetrospectivesSection.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RetroRoomSummaryDTO, SquadWithMembersDTO } from '@legends/shared'
import { MIN_VOTES_PER_PARTICIPANT, MAX_VOTES_PER_PARTICIPANT } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import {
  listAdminRetroRooms,
  updateAdminRetroRoom,
  hardDeleteAdminRetroRoom,
  deleteRetroRoom,
} from '../../lib/retro-api'
import { Panel, inputCls } from './shared'
import { Icon } from '../../components/Icon'

type Confirm = { roomId: string; mode: 'archive' | 'delete' } | null

export function RetrospectivesSection() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'retro-rooms'] })
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [error, setError] = useState<string | null>(null)

  const rooms = useQuery({ queryKey: ['admin', 'retro-rooms'], queryFn: listAdminRetroRooms })
  const squads = useQuery({
    queryKey: ['admin', 'squads'],
    queryFn: () => apiFetch<{ squads: SquadWithMembersDTO[] }>('/admin/squads'),
  })

  const editMut = useMutation({
    mutationFn: (vars: { id: string; sprint: number; squadIds: string[]; votesPerParticipant: number }) =>
      updateAdminRetroRoom(vars.id, { sprint: vars.sprint, squadIds: vars.squadIds, votesPerParticipant: vars.votesPerParticipant }),
    onSuccess: () => { setEditing(null); setError(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao editar sala.'),
  })
  const archiveMut = useMutation({
    mutationFn: (id: string) => deleteRetroRoom(id),
    onSuccess: () => { setConfirm(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao arquivar sala.'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => hardDeleteAdminRetroRoom(id),
    onSuccess: () => { setConfirm(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao deletar sala.'),
  })

  const list = rooms.data?.rooms ?? []

  return (
    <Panel title="Retrospectivas">
      {error && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" /> {error}
        </p>
      )}
      {list.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhuma sala por aqui ainda.</p>
      ) : (
        <ul className="flex flex-col gap-md">
          {list.map((room) => (
            <li key={room.id} className="rounded-lg border border-outline-variant/40 bg-surface-container-highest p-md">
              {editing === room.id ? (
                <EditForm
                  room={room}
                  squads={squads.data?.squads ?? []}
                  pending={editMut.isPending}
                  onCancel={() => setEditing(null)}
                  onSave={(vars) => editMut.mutate({ id: room.id, ...vars })}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-md">
                  <div>
                    <p className="font-label text-label-md text-on-surface">{room.title}</p>
                    <p className="text-body-sm text-on-surface-variant">
                      Sprint {room.sprint} · {room.status === 'OPEN' ? 'Aberta' : 'Concluída'} ·{' '}
                      {room.participantCount} participante(s) · por {room.creator.name}
                    </p>
                  </div>
                  <div className="flex gap-sm">
                    <button
                      type="button"
                      onClick={() => { setError(null); setEditing(room.id) }}
                      className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => { setError(null); setConfirm({ roomId: room.id, mode: 'archive' }) }}
                      className="rounded-md border border-error/40 px-md py-1 font-label text-label-sm text-error transition-colors hover:border-error"
                    >
                      Arquivar
                    </button>
                    <button
                      type="button"
                      onClick={() => { setError(null); setConfirm({ roomId: room.id, mode: 'delete' }) }}
                      className="rounded-md border border-error/40 px-md py-1 font-label text-label-sm text-error transition-colors hover:border-error"
                    >
                      Deletar
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg">
          <div className="w-full max-w-md rounded-xl bg-surface-container p-lg">
            <h4 className="font-headline text-headline-sm text-on-surface">
              {confirm.mode === 'archive' ? 'Arquivar sala?' : 'Deletar sala permanentemente?'}
            </h4>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              {confirm.mode === 'archive'
                ? 'A sala some das listagens e fica inacessível, mas os dados continuam no banco.'
                : 'Esta ação é irreversível: apaga a sala e todos os cards, votos, reações e histórico de edições.'}
            </p>
            <div className="mt-lg flex justify-end gap-sm">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-sm text-on-surface-variant"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={archiveMut.isPending || deleteMut.isPending}
                onClick={() => (confirm.mode === 'archive' ? archiveMut.mutate(confirm.roomId) : deleteMut.mutate(confirm.roomId))}
                className="rounded-md bg-error px-lg py-sm font-label text-label-md font-bold text-on-error disabled:opacity-50"
              >
                {confirm.mode === 'archive' ? 'Arquivar' : 'Deletar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

function EditForm({
  room,
  squads,
  pending,
  onCancel,
  onSave,
}: {
  room: RetroRoomSummaryDTO
  squads: SquadWithMembersDTO[]
  pending: boolean
  onCancel: () => void
  onSave: (vars: { sprint: number; squadIds: string[]; votesPerParticipant: number }) => void
}) {
  const [sprint, setSprint] = useState(room.sprint)
  const [votes, setVotes] = useState(room.votesPerParticipant)
  const [squadIds, setSquadIds] = useState<string[]>(room.squads.map((s) => s.id))

  const toggleSquad = (id: string) =>
    setSquadIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  return (
    <form
      className="flex flex-col gap-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (squadIds.length === 0) return
        onSave({ sprint, squadIds, votesPerParticipant: votes })
      }}
    >
      <div className="flex flex-wrap gap-md">
        <label className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
          Sprint
          <input type="number" min={1} value={sprint} onChange={(e) => setSprint(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
          Votos por pessoa
          <input
            type="number"
            min={MIN_VOTES_PER_PARTICIPANT}
            max={MAX_VOTES_PER_PARTICIPANT}
            value={votes}
            onChange={(e) => setVotes(Number(e.target.value))}
            className={inputCls}
          />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-sm">
        <legend className="mb-1 text-body-sm text-on-surface-variant">Squads</legend>
        {squads.map((s) => (
          <label key={s.id} className="flex items-center gap-1 text-body-sm text-on-surface">
            <input type="checkbox" checked={squadIds.includes(s.id)} onChange={() => toggleSquad(s.id)} />
            {s.name}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={pending || squadIds.length === 0}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:opacity-50"
        >
          Salvar
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-sm text-on-surface-variant">
          Cancelar
        </button>
      </div>
    </form>
  )
}
```

> Antes de implementar, confirme rapidamente os nomes reais em `pages/admin/shared.tsx` (`Panel`, `inputCls`) e em `components/Icon.tsx` (`Icon`, prop `name`) e o shape de `SquadWithMembersDTO` (`id`, `name`). Ajuste os imports se diferirem; o restante segue o padrão das outras seções.

- [ ] **Step 4: Renderizar a seção no AdminPage**

Em `apps/web/src/pages/AdminPage.tsx`, importar e renderizar:

```tsx
import { RetrospectivesSection } from './admin/RetrospectivesSection'
// ...
{activeTab === "retrospectivas" && <RetrospectivesSection />}
```

(adicionar a linha junto às outras `{activeTab === ... && <...Section />}`.)

- [ ] **Step 5: Escrever o teste de render/interação**

Criar `apps/web/src/pages/admin/RetrospectivesSection.test.tsx`. Espelhe o padrão das outras `*.test.tsx` de `pages/admin` (provider do React Query + mock de `lib/retro-api`). Estrutura:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RetrospectivesSection } from './RetrospectivesSection'

vi.mock('../../lib/retro-api', () => ({
  listAdminRetroRooms: vi.fn(),
  updateAdminRetroRoom: vi.fn(),
  hardDeleteAdminRetroRoom: vi.fn(),
  deleteRetroRoom: vi.fn(),
}))
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn().mockResolvedValue({ squads: [] }) }
})

import { listAdminRetroRooms, hardDeleteAdminRetroRoom } from '../../lib/retro-api'

const room = {
  id: 'r1', title: 'Retrospectiva Sprint 10 - Squad Inovação', sprint: 10,
  squads: [{ id: 's1', name: 'Inovação' }], status: 'OPEN', anonymous: false,
  votesPerParticipant: 3, createdAt: new Date().toISOString(), concludedAt: null,
  creator: { id: 'u1', name: 'Lia' }, participantCount: 2, myRole: 'OBSERVER',
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><RetrospectivesSection /></QueryClientProvider>)
}

describe('RetrospectivesSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista as salas e deleta após confirmar', async () => {
    ;(listAdminRetroRooms as any).mockResolvedValue({ rooms: [room] })
    ;(hardDeleteAdminRetroRoom as any).mockResolvedValue(undefined)
    renderSection()

    expect(await screen.findByText(/Retrospectiva Sprint 10/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Deletar' }))
    // botão de confirmação no modal
    fireEvent.click(screen.getByRole('button', { name: 'Deletar' }))
    await waitFor(() => expect(hardDeleteAdminRetroRoom).toHaveBeenCalledWith('r1'))
  })

  it('estado vazio', async () => {
    ;(listAdminRetroRooms as any).mockResolvedValue({ rooms: [] })
    renderSection()
    expect(await screen.findByText('Nenhuma sala por aqui ainda.')).toBeInTheDocument()
  })
})
```

> Se houver dois botões "Deletar" (linha + modal) atrapalhando o `getByRole`, ajuste o segundo clique para buscar dentro do modal (ex.: `within(screen.getByRole('dialog'))` se você adicionar `role="dialog"` ao container do modal, ou use `getAllByRole(...).at(-1)`). Mantenha o teste verde.

- [ ] **Step 6: Rodar os testes do web**

Run: `pnpm --filter @legends/web test -- RetrospectivesSection`
Expected: PASS (2 testes).

- [ ] **Step 7: Typecheck do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/retro-api.ts apps/web/src/pages/admin/RetrospectivesSection.tsx apps/web/src/pages/admin/RetrospectivesSection.test.tsx apps/web/src/pages/admin/TabBar.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "feat(retro): aba de gestão de retrospectivas no painel admin"
```

---

## Task 5: Verificação final

- [ ] **Step 1: Suite completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os workspaces verdes.

- [ ] **Step 2: Teste manual (opcional)**

Run: `pnpm dev`, logar como admin, abrir `/admin` → aba **Retrospectivas**, e validar Editar / Arquivar / Deletar numa sala de teste.

---

## Self-Review (preenchido pelo autor do plano)

- **Cobertura da spec:** listar (Task 1), editar (Task 2), hard delete (Task 3), arquivar via reuso (Task 1 usa o endpoint existente; frontend chama em Task 4), shared type (Task 1), aba + wiring (Task 4), testes API e web (Tasks 1-4). Limitação "sem push WS na edição" é intencional e documentada na spec.
- **Sem placeholders:** todos os steps têm código/comando concretos. As duas notas de verificação (`shared.tsx`/`Icon` e duplicidade de botão no teste) são checagens de nomes reais, não trabalho em aberto.
- **Consistência de tipos:** `listRoomsForAdmin`/`updateRoomAsAdmin`/`hardDeleteRoom` (service) e `listAdminRetroRooms`/`updateAdminRetroRoom`/`hardDeleteAdminRetroRoom` (web) usados com os mesmos nomes em todas as tasks; `UpdateRetroRoomAdminRequest` definido na Task 1 e consumido na Task 4; DTO de saída sempre `RetroRoomSummaryDTO`.
