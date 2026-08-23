# LEAD edita action cards de sala concluída (com rastro) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que qualquer usuário LEAD edite os action cards de uma retro concluída (in-place, sem reabrir), registrando quem editou e quando (carimbo no card + log da sala).

**Architecture:** Apenas `updateCard` ganha um caminho pós-conclusão: quando a sala está `CONCLUDED`, exige `role === 'LEAD'` e que o card seja um action card (note em região de ação), dispensa a regra autor-only, grava `editedBy`/`editedAt` e registra um `RetroEdit`. Demais mutações seguem 409 quando concluída. Frontend libera só a edição de action cards nesse modo e exibe carimbo + painel de histórico.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (api), Vite + React 18 + React Query + Tailwind (web), tipos em `@legends/shared`, Vitest.

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`).
- Mensagens ao usuário em **português**.
- Camadas: **rota fina (Zod `safeParse` → 400 `{ message, issues }`) → service (`RetroError` com `status`; rota faz `instanceof`) → Prisma**. DTO só em `serialize.ts`. Contrato em `@legends/shared` primeiro.
- **Nunca editar migration já aplicada**; gerar nova com Prisma.
- Testes da API batem em **Postgres real** — `pnpm db:up` antes.
- **Escopo pós-conclusão:** só LEAD, só `updateCard`, só action card (`kind === 'note'` e centro dentro de `RETRO_ACTION_REGION_IDS`). Nada de create/move/delete/voto/reação/participantes/anônimo após concluir.
- **In-place:** `status` continua `CONCLUDED` e `concludedAt` não muda.

---

### Task 1: Migração — `RetroCard.editedBy*` + model `RetroEdit`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_retro_edit_provenance/migration.sql` (gerado)

**Interfaces:**
- Produces: `RetroCard.editedById String?`, `RetroCard.editedAt DateTime?`, relação `RetroCard.editedBy`; model `RetroEdit`; relações inversas em `User` e `RetroRoom`.

- [ ] **Step 1: Editar `RetroCard`** — adicionar os campos e a relação. No bloco do model `RetroCard`, após `auditedBy ... @relation("RetroActionsAudited", ...)`, acrescentar a relação e, junto dos campos escalares (após `auditedAt DateTime?`), os dois campos:

```prisma
  editedById String?
  editedAt    DateTime?
```
e na seção de relações do mesmo model:
```prisma
  editedBy  User?           @relation("RetroCardsEdited", fields: [editedById], references: [id])
```

- [ ] **Step 2: Editar `RetroRoom`** — adicionar a relação de edits. No model `RetroRoom`, junto das outras relações (após `cards RetroCard[]`):

```prisma
  edits        RetroEdit[]
```

- [ ] **Step 3: Criar o model `RetroEdit`** — adicionar ao final da área de models de retro:

```prisma
model RetroEdit {
  id        String   @id @default(cuid())
  roomId    String
  editorId  String
  action    String
  detail    String?
  createdAt DateTime @default(now())

  room   RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  editor User      @relation("RetroEditsAuthored", fields: [editorId], references: [id])

  @@index([roomId])
}
```

- [ ] **Step 4: Editar `User`** — adicionar as relações inversas. No model `User`, junto das outras relações de retro (após `auditedActions RetroCard[] @relation("RetroActionsAudited")`):

```prisma
  editedRetroCards   RetroCard[]        @relation("RetroCardsEdited")
  retroEditsAuthored RetroEdit[]        @relation("RetroEditsAuthored")
```

- [ ] **Step 5: Gerar a migração**

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev --name retro_edit_provenance`
Expected: cria a migração, aplica, regenera o client; termina com "Your database is now in sync with your schema."

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(retro): editedBy/editedAt no RetroCard e model RetroEdit (rastro de edição)"
```

---

### Task 2: Contrato (`@legends/shared`)

**Files:**
- Modify: `packages/shared/src/retro.ts`

**Interfaces:**
- Produces: `RetroEditDTO`; `RetroCardDTO.editedBy`/`editedAt`; `RetroEvent` com `edits.changed`.

- [ ] **Step 1: Adicionar `RetroEditDTO`** — após a definição de `RetroAuditItemDTO` em `retro.ts`:

```ts
export interface RetroEditDTO {
  id: string
  editor: { id: string; name: string }
  action: string
  detail: string | null
  createdAt: string
}
```

- [ ] **Step 2: Estender `RetroCardDTO`** — adicionar dois campos (perto de `author`/`mine`):

```ts
  editedBy: { id: string; name: string } | null
  editedAt: string | null
```

- [ ] **Step 3: Adicionar evento** — na união `RetroEvent`, junto das variantes não-efêmeras (perto de `audit.changed`):

```ts
  | { type: 'edits.changed' }
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @legends/shared build`
Expected: build limpo.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/retro.ts
git commit -m "feat(shared): RetroEditDTO, RetroCardDTO.editedBy/editedAt e evento edits.changed"
```

---

### Task 3: Serialize + includes

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/services/retro-service.ts` (includes em `retroRoomInclude` e `loadCard`)
- Test: `apps/api/src/lib/serialize-retro.test.ts`

**Interfaces:**
- Consumes: `RetroEditDTO`, `RetroCardDTO.editedBy/editedAt` (Task 2).
- Produces: `toRetroEditDTO(edit)`; `toRetroCardDTO` com `editedBy`/`editedAt`; card includes com `editedBy: true`.

- [ ] **Step 1: Incluir `editedBy` nos includes do card** — em `retro-service.ts`. Em `retroRoomInclude` (linha ~40) trocar a linha dos cards:

```ts
  cards: { include: { author: true, votes: true, reactions: true, editedBy: true }, orderBy: { createdAt: 'asc' } },
```
e em `loadCard` (linha ~210) trocar o include:
```ts
    include: { author: true, votes: true, reactions: true, editedBy: true },
```

- [ ] **Step 2: Escrever o teste que falha** — acrescentar a `serialize-retro.test.ts` (importar `toRetroEditDTO` no topo junto dos outros: `import { toRetroCardDTO, toRetroRoomDTO, toRetroActionItemDTO, toRetroAuditItemDTO, toRetroEditDTO } from './serialize'`):

```ts
describe('serialize edição/rastro', () => {
  it('toRetroCardDTO inclui editedBy/editedAt quando presentes', () => {
    const dto = toRetroCardDTO(card({ editedBy: { id: 'u2', name: 'Bia' }, editedById: 'u2', editedAt: new Date('2026-06-26T10:00:00Z') }) as any, { viewerId: 'u1', anonymous: false })
    expect(dto.editedBy).toEqual({ id: 'u2', name: 'Bia' })
    expect(dto.editedAt).toBe('2026-06-26T10:00:00.000Z')
  })

  it('toRetroCardDTO sem edição → editedBy/editedAt nulos', () => {
    const dto = toRetroCardDTO(card() as any, { viewerId: 'u1', anonymous: false })
    expect(dto.editedBy).toBeNull()
    expect(dto.editedAt).toBeNull()
  })

  it('toRetroEditDTO mapeia editor/action/detail/createdAt', () => {
    const edit = { id: 'e1', action: 'action.updated', detail: 'Deploy', createdAt: new Date('2026-06-26T10:00:00Z'), editor: { id: 'u2', name: 'Bia' } } as any
    expect(toRetroEditDTO(edit)).toEqual({ id: 'e1', editor: { id: 'u2', name: 'Bia' }, action: 'action.updated', detail: 'Deploy', createdAt: '2026-06-26T10:00:00.000Z' })
  })
})
```

> Nota: o helper `card()` em `serialize-retro.test.ts` cria o card base com `author: { ...baseUser }`. Os novos campos `editedBy`/`editedById`/`editedAt` chegam via `over`, então o spread `...over` já os injeta — não precisa mudar o helper.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- --run serialize-retro`
Expected: FAIL — `toRetroEditDTO is not a function` / `dto.editedBy` undefined.

- [ ] **Step 4: Implementar em `serialize.ts`** — em `toRetroCardDTO`, após o bloco `author: { ... }` (e antes de `mine`), adicionar:

```ts
    editedBy: card.editedBy ? { id: card.editedBy.id, name: card.editedBy.name } : null,
    editedAt: card.editedAt ? card.editedAt.toISOString() : null,
```
E adicionar a função (após `toRetroAuditItemDTO`). Primeiro, no import de `../services/retro-service`, nada muda (usa `RetroCardWithRelations`). Adicionar:
```ts
export function toRetroEditDTO(
  edit: { id: string; action: string; detail: string | null; createdAt: Date; editor: { id: string; name: string } },
): RetroEditDTO {
  return {
    id: edit.id,
    editor: { id: edit.editor.id, name: edit.editor.name },
    action: edit.action,
    detail: edit.detail,
    createdAt: edit.createdAt.toISOString(),
  }
}
```
Adicionar `RetroEditDTO` ao import de `@legends/shared`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- --run serialize-retro`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/services/retro-service.ts apps/api/src/lib/serialize-retro.test.ts
git commit -m "feat(retro): serialize de editedBy/editedAt e toRetroEditDTO; include editedBy no card"
```

---

### Task 4: `updateCard` pós-conclusão (LEAD edita action card) + log

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Test: `apps/api/src/routes/retro-edit.test.ts` (criar)

**Interfaces:**
- Consumes: `isCardInRegion`, `RETRO_ACTION_REGION_IDS`, `upsertActionCard` (existentes).
- Produces: `updateCard` aceitando `role`; helper `isActionCard`; `logEdit`; gravação de `editedBy`/`editedAt` e de `RetroEdit`; rota passa `role` e faz broadcast `edits.changed`.

- [ ] **Step 1: Escrever o teste que falha** — criar `apps/api/src/routes/retro-edit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { RETRO_REGIONS, RETRO_ACTION_REGION_IDS } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'DEV' | 'LEAD' = 'DEV') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
const region = RETRO_REGIONS.find((r) => (RETRO_ACTION_REGION_IDS as readonly string[]).includes(r.id))!
const AX = region.x + 10
const AY = region.y + 10

/** Cria sala + 1 action card (em região de ação) + 1 card comum, e conclui a sala. */
async function concludedRoomWithCards() {
  const creator = await user('Lia', 'LEAD')
  const squad = await prisma.squad.create({ data: { name: 'S', slug: 's' } })
  const room = await prisma.retroRoom.create({ data: { sprint: 1, createdById: creator.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } }, participants: { create: { userId: creator.id } } } })
  const action = await prisma.retroCard.create({ data: { roomId: room.id, authorId: creator.id, text: 'Origem', color: 'blue', kind: 'note', x: AX, y: AY, actionPlan: 'Plano', actionResponsible: creator.id, actionDueDate: '2026-07-01' } })
  const plain = await prisma.retroCard.create({ data: { roomId: room.id, authorId: creator.id, text: 'comum', color: 'yellow', kind: 'note', x: 50, y: 50 } })
  return { creator, room, action, plain }
}

describe('PATCH /retro/rooms/:id/cards/:cardId — pós-conclusão (LEAD)', () => {
  it('LEAD (não-criador) edita action card de sala concluída; grava editedBy/editedAt e RetroEdit', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, action } = await concludedRoomWithCards()
      const lead2 = await user('Léo', 'LEAD')
      const tk = app.jwt.sign({ sub: lead2.id, role: 'LEAD' })
      const res = await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${action.id}`, headers: { authorization: `Bearer ${tk}` }, payload: { actionPlan: 'Plano revisado' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().card.editedBy).toMatchObject({ id: lead2.id })
      const saved = await prisma.retroCard.findUnique({ where: { id: action.id } })
      expect(saved!.actionPlan).toBe('Plano revisado')
      expect(saved!.editedById).toBe(lead2.id)
      expect(saved!.editedAt).not.toBeNull()
      const edits = await prisma.retroEdit.findMany({ where: { roomId: room.id } })
      expect(edits).toHaveLength(1)
      expect(edits[0]).toMatchObject({ editorId: lead2.id, action: 'action.updated' })
    } finally { await app.close() }
  })

  it('LEAD não pode editar card NÃO-ação em sala concluída (409)', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, plain } = await concludedRoomWithCards()
      const lead2 = await user('Léo', 'LEAD')
      const tk = app.jwt.sign({ sub: lead2.id, role: 'LEAD' })
      const res = await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${plain.id}`, headers: { authorization: `Bearer ${tk}` }, payload: { text: 'x' } })
      expect(res.statusCode).toBe(409)
    } finally { await app.close() }
  })

  it('DEV não edita action card em sala concluída (409)', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, action } = await concludedRoomWithCards()
      const dev = await user('Dan', 'DEV')
      const tk = app.jwt.sign({ sub: dev.id, role: 'DEV' })
      const res = await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${action.id}`, headers: { authorization: `Bearer ${tk}` }, payload: { actionPlan: 'nope' } })
      expect(res.statusCode).toBe(409)
    } finally { await app.close() }
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- --run retro-edit`
Expected: FAIL — hoje `updateCard` chama `assertOpen` → 409 para todos (o 1º caso espera 200).

- [ ] **Step 3: Implementar no service** — em `retro-service.ts`.

(a) Helper `isActionCard` (perto de `isCardInRegion`):
```ts
function isActionCard(card: { kind: string; x: number; y: number }): boolean {
  return card.kind === 'note' && RETRO_ACTION_REGION_IDS.some((rid) => isCardInRegion(card, rid))
}
```
(b) `logEdit` (perto dos outros helpers):
```ts
export function logEdit(roomId: string, editorId: string, action: string, detail: string | null): Promise<unknown> {
  return prisma.retroEdit.create({ data: { roomId, editorId, action, detail } })
}
```
(c) Alterar a assinatura e a guarda de `updateCard`:
```ts
export async function updateCard(input: {
  roomId: string
  cardId: string
  userId: string
  role?: string  // opcional: chamadas legadas (OPEN) não precisam; ausente = trata como não-LEAD
  text?: string
  color?: string
  shape?: string
  shapeStyle?: string
  width?: number
  height?: number
  actionPlan?: string
  actionResponsible?: string
  actionDueDate?: string
}): Promise<UpdateCardResult> {
  const room = await loadRoom(input.roomId)
  const card = await loadCard(input.roomId, input.cardId)
  const postConclusion = room.status === 'CONCLUDED'
  if (postConclusion) {
    if (input.role !== 'LEAD') throw new RetroError('A sala foi concluída.', 409)
    if (!isActionCard(card)) throw new RetroError('Após concluir, só action cards podem ser editados.', 409)
  } else {
    if (card.authorId !== input.userId) throw new RetroError('Apenas o autor edita o card.', 403)
  }
  const kind = assertKind(card.kind)
  const data: {
    text?: string
    color?: RetroCardColor
    shape?: RetroShape | null
    shapeStyle?: RetroShapeStyle | null
    width?: number
    height?: number
    actionPlan?: string | null
    actionResponsible?: string | null
    actionDueDate?: string | null
    editedById?: string
    editedAt?: Date
  } = {}
  if (input.text !== undefined) data.text = assertText(input.text)
  if (input.color !== undefined) data.color = assertColor(input.color)
  if (input.shape !== undefined) data.shape = assertShape(input.shape, kind)
  if (input.shapeStyle !== undefined) data.shapeStyle = assertShapeStyle(input.shapeStyle, kind)
  if (input.width !== undefined) data.width = assertDimension(input.width, card.width ?? SHAPE_WIDTH)
  if (input.height !== undefined) data.height = assertDimension(input.height, card.height ?? SHAPE_HEIGHT)
  if (input.actionPlan !== undefined) data.actionPlan = optionalText(input.actionPlan, MAX_CARD_LENGTH)
  if (input.actionResponsible !== undefined) {
    data.actionResponsible = optionalText(input.actionResponsible, 120)
    await assertResponsible(data.actionResponsible)
  }
  if (input.actionDueDate !== undefined) data.actionDueDate = optionalText(input.actionDueDate, 20)
  if (postConclusion) {
    data.editedById = input.userId
    data.editedAt = new Date()
  }
  if (Object.keys(data).length > 0) await prisma.retroCard.update({ where: { id: card.id }, data })
  if (postConclusion) await logEdit(room.id, input.userId, 'action.updated', card.text)
  const updated = await loadCard(input.roomId, card.id)
  const action = await upsertActionCard(room, updated)
  const refreshed = action.created ? await loadCard(input.roomId, card.id) : updated
  return { card: refreshed, actionCard: action.card, actionCardCreated: action.created }
}
```

> Nota: removemos o `assertOpen(room)` do topo; a guarda agora é o bloco `postConclusion`. Em sala OPEN o comportamento é idêntico ao atual (autor-only, sem carimbo). `editedAt`/`editedById` só entram em `data` no caminho pós-conclusão, então OPEN nunca grava carimbo mesmo com `Object.keys(data).length`.

- [ ] **Step 4: Ligar a rota** — em `retro.ts`, no handler `PATCH /retro/rooms/:id/cards/:cardId`, passar `role` e broadcast condicional. Trocar a chamada e o bloco de broadcast:
```ts
      const room0 = await getRoomMeta(id)
      const { card, actionCard, actionCardCreated } = await updateCard({ roomId: id, cardId, userId: request.user.sub, role: request.user.role, ...parsed.data })
      const meta = await getRoomMeta(id)
      if (meta) {
        broadcastCard('card.updated', meta, card)
        if (actionCard) broadcastCard(actionCardCreated ? 'card.created' : 'card.updated', meta, actionCard)
      }
      if (room0?.status === 'CONCLUDED') retroHub.broadcast(id, () => ({ type: 'edits.changed' }))
```

> `getRoomMeta` já existe e retorna `{ status, ... }`. Usamos o status de antes da edição (`room0`) para decidir o broadcast `edits.changed` (a edição não muda o status).

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- --run retro-edit`
Expected: PASS (3 casos).

- [ ] **Step 6: Rodar a suíte de retro inteira** (garantir que o caminho OPEN não regrediu — `retro-card-service.test.ts` cobre autor-only e o bloqueio de criar em CONCLUDED):

Run: `pnpm --filter @legends/api test -- --run retro`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro-edit.test.ts
git commit -m "feat(retro): LEAD edita action card de sala concluída (carimbo + log)"
```

---

### Task 5: Listar edições — `listEdits` + `GET /retro/rooms/:id/edits`

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Test: `apps/api/src/routes/retro-edit.test.ts` (acrescentar)

**Interfaces:**
- Produces: `listEdits(roomId, viewer)`; rota `GET /retro/rooms/:id/edits` → `{ edits: RetroEditDTO[] }`.
- Consumes: `loadRoom`, `resolveRole` (existentes); `toRetroEditDTO` (Task 3).

- [ ] **Step 1: Escrever o teste que falha** — acrescentar em `retro-edit.test.ts`:

```ts
describe('GET /retro/rooms/:id/edits', () => {
  it('lista as edições em ordem desc; nega acesso a quem não vê a sala (404)', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, action, creator } = await concludedRoomWithCards()
      const lead2 = await user('Léo', 'LEAD')
      const tk2 = app.jwt.sign({ sub: lead2.id, role: 'LEAD' })
      await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${action.id}`, headers: { authorization: `Bearer ${tk2}` }, payload: { actionPlan: 'v2' } })

      const list = await app.inject({ method: 'GET', url: `/retro/rooms/${room.id}/edits`, headers: { authorization: `Bearer ${app.jwt.sign({ sub: creator.id, role: 'LEAD' })}` } })
      expect(list.statusCode).toBe(200)
      expect(list.json().edits).toHaveLength(1)
      expect(list.json().edits[0]).toMatchObject({ editor: { id: lead2.id }, action: 'action.updated' })

      const stranger = await user('Estranho', 'DEV')
      const denied = await app.inject({ method: 'GET', url: `/retro/rooms/${room.id}/edits`, headers: { authorization: `Bearer ${app.jwt.sign({ sub: stranger.id, role: 'DEV' })}` } })
      expect(denied.statusCode).toBe(404)
    } finally { await app.close() }
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test -- --run retro-edit`
Expected: FAIL — rota `GET .../edits` inexistente (404 no caso de sucesso por rota ausente, mas o `toHaveLength(1)` quebra).

- [ ] **Step 3: Implementar `listEdits`** — em `retro-service.ts`, ao final:

```ts
export async function listEdits(roomId: string, viewer: { id: string; role: string }) {
  const room = await loadRoom(roomId)
  if (!resolveRole(room, viewer)) throw new RetroError('Sala não encontrada.', 404)
  return prisma.retroEdit.findMany({
    where: { roomId },
    include: { editor: true },
    orderBy: { createdAt: 'desc' },
  })
}
```

- [ ] **Step 4: Implementar a rota** — em `retro.ts`. Adicionar `listEdits` ao import de `../services/retro-service` e `toRetroEditDTO` ao import de `../lib/serialize`. Dentro de `retroRoutes`:

```ts
  app.get('/retro/rooms/:id/edits', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const edits = await listEdits(id, { id: request.user.sub, role: request.user.role })
      return reply.send({ edits: edits.map(toRetroEditDTO) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- --run retro-edit`
Expected: PASS (todos os casos do arquivo).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro-edit.test.ts
git commit -m "feat(retro): listar histórico de edições (GET /retro/rooms/:id/edits)"
```

---

### Task 6: Cliente web — `getRetroEdits` + invalidação `edits.changed`

**Files:**
- Modify: `apps/web/src/lib/retro-api.ts`
- Modify: `apps/web/src/lib/useRetroSocket.ts`

**Interfaces:**
- Produces: `getRetroEdits(roomId)`; invalidação de `['retro-edits', roomId]` em `edits.changed`.

- [ ] **Step 1: Adicionar a função de API** — em `retro-api.ts`. Adicionar `RetroEditDTO` ao import de `@legends/shared` e a função ao final:

```ts
export function getRetroEdits(roomId: string) {
  return apiFetch<{ edits: RetroEditDTO[] }>(`/retro/rooms/${roomId}/edits`)
}
```

- [ ] **Step 2: Invalidar no socket** — em `useRetroSocket.ts`, no `ws.onmessage`, junto das outras invalidações por evento (após a de `audit.changed`):

```ts
        if (e.type === 'edits.changed') {
          qc.invalidateQueries({ queryKey: ['retro-edits', roomId] })
          qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
        }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/retro-api.ts apps/web/src/lib/useRetroSocket.ts
git commit -m "feat(web): getRetroEdits + invalidação por edits.changed"
```

---

### Task 7: Web — liberar edição de action card concluído (LEAD) + carimbo

**Files:**
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Modify: `apps/web/src/pages/retro/PostIt.tsx`
- Test: `apps/web/src/pages/retro/PostIt.test.tsx`

**Interfaces:**
- Consumes: `editM`/`handleCursorClick`/`onCardPointerDown`/`isInRegion` (existentes em RetroRoomPage); `RETRO_ACTION_REGION_IDS`.

- [ ] **Step 1: Teste do carimbo no PostIt (RED)** — acrescentar em `PostIt.test.tsx` (o arquivo já monta `base`/`props`):

```ts
it('mostra "editado por" quando o card tem editedBy', () => {
  render(<PostIt {...props} card={{ ...base, editedBy: { id: 'u2', name: 'Bia' }, editedAt: '2026-06-26T10:00:00.000Z' }} />)
  expect(screen.getByText(/editado por Bia/i)).toBeInTheDocument()
})
```

> Os fixtures de `RetroCardDTO` neste arquivo precisam dos novos campos. Onde o `base` é definido, adicionar `editedBy: null, editedAt: null` (e em qualquer outro fixture de card que o tsc acusar).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- --run PostIt`
Expected: FAIL — texto "editado por Bia" não encontrado.

- [ ] **Step 3: Implementar o carimbo no `PostIt.tsx`** — dentro do `<div>` do card note (perto do badge do autor / rodapé), adicionar, antes do fechamento do card:

```tsx
{card.editedBy && (
  <p className="mt-1 font-label text-[10px] text-zinc-500">
    editado por {card.editedBy.name}{card.editedAt ? ` em ${new Date(card.editedAt).toLocaleDateString('pt-BR')}` : ''}
  </p>
)}
```

- [ ] **Step 4: Rodar e ver passar (PostIt)**

Run: `pnpm --filter @legends/web test -- --run PostIt`
Expected: PASS.

- [ ] **Step 5: Liberar a edição no `RetroRoomPage.tsx`** — fazer os ajustes de gating.

(a) Após `const canWrite = ...` (linha ~268) adicionar:
```ts
  const canEditConcludedActions = room.status === 'CONCLUDED' && user?.role === 'LEAD'
  const isActionCardClient = (card: RetroCardDTO) =>
    card.kind !== 'shape' && RETRO_ACTION_REGION_IDS.some((rid) => isInRegion(card, rid))
  const canEditCard = (card: RetroCardDTO) =>
    (canWrite && card.mine && card.kind !== 'shape') || (canEditConcludedActions && isActionCardClient(card))
```

(b) Estender o tipo do ref `drag` (linha ~57) com `editOnly?: boolean`:
```ts
  const drag = useRef<{ cardId: string; startX: number; startY: number; offX: number; offY: number; moved: boolean; editOnly?: boolean; onClick: () => void } | null>(null)
```

(c) Em `onCardPointerDown` (linha 310), trocar o early-return e permitir seleção/edição de action card no modo concluído:
```ts
  function onCardPointerDown(e: ReactPointerEvent, card: RetroCardDTO) {
    if (!canWrite) {
      if (canEditConcludedActions && tool === 'cursor' && isActionCardClient(card)) {
        drag.current = { cardId: card.id, startX: e.clientX, startY: e.clientY, offX: 0, offY: 0, moved: false, editOnly: true, onClick: () => handleCursorClick(card) }
      }
      return
    }
    // ... resto inalterado
```

(d) No handler de `pointermove` (bloco `else if (drag.current)`, linha ~181), impedir movimento quando `editOnly`:
```ts
      } else if (drag.current) {
        const d = drag.current
        if (d.editOnly) return
        if (!d.moved) {
```

(e) Em `handleCursorClick` (linha 297), trocar a condição de entrar em edição para usar `canEditCard`:
```ts
    } else if (canEditCard(card)) {
      setEditingCardId(card.id)
      setEditingText(card.text === DEFAULT_CARD_TEXT ? '' : card.text)
    }
```

(f) Gating do `actionForm` (linha ~509): trocar `canWrite && ... && card.mine && ...` por:
```tsx
              actionForm={
                canEditCard(card) && selectedCardId === card.id && card.kind !== 'shape' && RETRO_ACTION_REGION_IDS.some((rid) => isInRegion(card, rid))
                  ? { value: actionDraft, users: actionUsers, onChange: setActionDraft, onCommit: (value) => actionM.mutate({ cardId: card.id, value }) }
                  : undefined
              }
```

(g) `PostIt` `readOnly` (linha ~497): trocar `readOnly={!canWrite}` por `readOnly={!canEditCard(card)}`.

> O `editM`/`actionM` já enviam `updateRetroCard`; o servidor (Task 4) autoriza o LEAD. `actionM` precisa passar pelo mesmo PATCH — confirmar que `actionM` chama `updateRetroCard` (chama: é o commit de ação). Nenhuma mudança em `editM`/`actionM` é necessária.

- [ ] **Step 6: Typecheck + suíte web de retro**

Run: `pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web test -- --run PostIt RetroRoomPage`
Expected: sem erros de tipo; testes PASS. (Se o tsc apontar fixtures de card sem `editedBy`/`editedAt` em `RetroRoomPage.test.tsx`/`useRetroSocket.test.tsx`, adicionar `editedBy: null, editedAt: null` neles.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/retro/PostIt.tsx apps/web/src/pages/retro/PostIt.test.tsx
git commit -m "feat(web): LEAD edita action card em sala concluída + carimbo 'editado por'"
```

---

### Task 8: Web — painel "Histórico de edições"

**Files:**
- Create: `apps/web/src/pages/retro/EditHistoryPanel.tsx`
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Test: `apps/web/src/pages/retro/EditHistoryPanel.test.tsx` (criar)

**Interfaces:**
- Consumes: `getRetroEdits` (Task 6); `RetroEditDTO`.

- [ ] **Step 1: Teste do componente (RED)** — criar `apps/web/src/pages/retro/EditHistoryPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditHistoryPanel } from './EditHistoryPanel'

const edits = [
  { id: 'e1', editor: { id: 'u2', name: 'Bia' }, action: 'action.updated', detail: 'Deploy tranquilo', createdAt: '2026-06-26T10:00:00.000Z' },
]

describe('EditHistoryPanel', () => {
  it('lista as edições com autor e detalhe', () => {
    render(<EditHistoryPanel edits={edits as any} onClose={vi.fn()} />)
    expect(screen.getByText(/Bia/)).toBeInTheDocument()
    expect(screen.getByText(/Deploy tranquilo/)).toBeInTheDocument()
  })
  it('estado vazio', () => {
    render(<EditHistoryPanel edits={[]} onClose={vi.fn()} />)
    expect(screen.getByText(/Nenhuma edição/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- --run EditHistoryPanel`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Criar o componente** — `apps/web/src/pages/retro/EditHistoryPanel.tsx`:

```tsx
import type { JSX } from 'react'
import type { RetroEditDTO } from '@legends/shared'

const ACTION_LABEL: Record<string, string> = {
  'action.updated': 'editou uma ação',
}

export function EditHistoryPanel({ edits, onClose }: { edits: RetroEditDTO[]; onClose: () => void }): JSX.Element {
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-outline-variant/40 bg-surface-container shadow-xl">
      <div className="flex items-center justify-between border-b border-outline-variant/40 px-4 py-3">
        <h3 className="font-label text-title-sm font-bold text-on-surface">Histórico de edições</h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {edits.length === 0 ? (
          <p className="px-2 py-1 text-body-sm text-on-surface-variant">Nenhuma edição registrada.</p>
        ) : (
          <ul className="space-y-2">
            {edits.map((e) => (
              <li key={e.id} className="rounded-lg border border-outline-variant/30 bg-surface-container-high p-3">
                <p className="text-body-sm text-on-surface">
                  <span className="font-bold">{e.editor.name}</span> {ACTION_LABEL[e.action] ?? e.action}
                </p>
                {e.detail && <p className="mt-1 text-body-sm text-on-surface-variant">{e.detail}</p>}
                <p className="mt-1 font-label text-label-sm text-on-surface-variant">{new Date(e.createdAt).toLocaleString('pt-BR')}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar (componente)**

Run: `pnpm --filter @legends/web test -- --run EditHistoryPanel`
Expected: PASS.

- [ ] **Step 5: Ligar no `RetroRoomPage.tsx`** — adicionar import, estado, query, botão e render.

(a) Imports: adicionar `getRetroEdits` ao import de `../lib/retro-api` e o componente:
```ts
import { EditHistoryPanel } from './retro/EditHistoryPanel'
```
(b) Estado (perto de `auditOpen`/`participantsOpen`):
```ts
  const [editsOpen, setEditsOpen] = useState(false)
```
(c) Query (perto de `auditQuery`):
```ts
  const editsQuery = useQuery({ queryKey: ['retro-edits', id], queryFn: () => getRetroEdits(id), enabled: !!id && room.status === 'CONCLUDED' })
```
(d) Botão no header (perto do botão "Auditoria", antes de "Sair"):
```tsx
          {(editsQuery.data?.edits.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setEditsOpen(true)}
              className="rounded-md border border-outline-variant/40 px-lg py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
            >
              Histórico ({editsQuery.data?.edits.length})
            </button>
          )}
```
(e) Painel (junto do render do `AuditPanel`, antes de `</section>`):
```tsx
      {editsOpen && (
        <EditHistoryPanel edits={editsQuery.data?.edits ?? []} onClose={() => setEditsOpen(false)} />
      )}
```

> `editsQuery` referencia `room.status`, então deve ser declarada após `const room = roomQuery.data.room`. Colocar junto de `auditQuery` (que já está depois de `room`).

- [ ] **Step 6: Typecheck + suíte web de retro**

Run: `pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web test -- --run EditHistoryPanel RetroRoomPage`
Expected: sem erros; testes PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/retro/EditHistoryPanel.tsx apps/web/src/pages/retro/EditHistoryPanel.test.tsx apps/web/src/pages/RetroRoomPage.tsx
git commit -m "feat(web): painel Histórico de edições na sala concluída"
```

---

### Task 9: Verificação final ponta a ponta

- [ ] **Step 1: Subir Postgres e rodar toda a suíte**

Run: `pnpm db:up && pnpm test`
Expected: api + web + shared verdes.

- [ ] **Step 2: Build geral**

Run: `pnpm build`
Expected: build sem erros (warnings pré-existentes de chunk-size são aceitáveis).

- [ ] **Step 3: Smoke manual (opcional)** — `pnpm dev`, concluir uma sala que tenha um action card; como LEAD (mesmo não-criador), abrir a sala, editar o plano/responsável/prazo do action card, ver o carimbo "editado por X em DD/MM" e o painel "Histórico de edições".

---

## Self-Review

- **Cobertura do spec:** modelo de dados → Task 1; contrato → Task 2; serialize/include → Task 3; permissão `updateCard` + carimbo + log → Task 4; `listEdits`/rota → Task 5; cliente web + invalidação → Task 6; gating de edição + carimbo no PostIt → Task 7; painel de histórico → Task 8; verificação → Task 9. Sem lacunas.
- **Placeholders:** nenhum — todo passo de código mostra o código.
- **Consistência de tipos:** `updateCard` recebe `role?: string` (opcional — chamadas legadas em sala OPEN não precisam; Task 4) e a rota envia `request.user.role` (Task 4); `RetroEditDTO` definido na Task 2 e usado em Task 3/5/6/8; `toRetroEditDTO(edit)` com a mesma assinatura em Task 3 e Task 5; chaves de query `['retro-edits', id]` idênticas em Task 6 e Task 8; `isActionCard` (server, Task 4) e `isActionCardClient` (web, Task 7) com a mesma regra (note + região de ação); `editedBy`/`editedAt` no DTO (Task 2) consumidos no PostIt (Task 7) e serializados (Task 3).
