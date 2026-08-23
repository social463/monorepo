# Carry-over de ações no quadrante "Ações" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o painel/botão "Auditoria" por cards de referência (read-only, calculados) no quadrante "Ações": ações concluídas a validar e ações vencidas das retros anteriores da squad, com cores distintas e ações inline para qualquer LEAD.

**Architecture:** O backend calcula, para a sala atual, as ações das retros CONCLUÍDAS anteriores da mesma squad e as classifica por estado (a validar / vencida). Um endpoint serve isso; outro aplica validate/reject/reschedule/done na ação de origem (re-sincronizando o espelho). O front remove a auditoria antiga e renderiza cards virtuais na região "Ações".

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (api), Vite + React 18 + React Query + Tailwind (web), tipos em `@legends/shared`, Vitest.

## Global Constraints

- TypeScript **strict**, ESM puro. Mensagens ao usuário em **português**.
- Camadas: rota fina (Zod `safeParse` → 400 `{ message, issues }`) → service (`RetroError` + `instanceof`) → Prisma. DTO só em `serialize.ts`. Contrato em `@legends/shared` primeiro.
- **Quem age** nos cards: **qualquer `role === 'LEAD'`** (403 para DEV; 404 para quem não enxerga a sala). Demais papéis só visualizam.
- **Classificação por estado** (sem persistir status novo): toValidate = `actionDone=true && auditStatus==null`; overdue = `actionDone=false && actionDueDate <= data(createdAt) da sala atual`. Itens resolvidos somem do cálculo.
- Escopo das fontes: retros `CONCLUDED`, `concludedAt < sala.createdAt`, compartilham ≥1 squad, `id != sala.id`.
- **Sem migração** (os campos `auditStatus/auditedById/auditedAt/actionDone/actionDoneAt/actionDueDate` já existem).
- Testes da API em Postgres real (`pnpm db:up`); `try/finally` no `app.close()`.
- **Ordem de remoção (evita módulo quebrado):** Tasks 1–2 são **aditivas** (mantêm os símbolos de auditoria). A remoção da auditoria (DTO, serializer, service fns, rotas, evento) acontece toda na **Task 3** (backend), depois que nada mais os referencia no backend. O **web** (Task 4) só é tipado/buildado ao final dele — entre as remoções, o TS do web fica vermelho de propósito.

---

### Task 1: Contrato (`@legends/shared`) — aditivo

**Files:**
- Modify: `packages/shared/src/retro.ts`

**Interfaces:**
- Produces: `RetroCarryoverItemDTO`; `RetroEvent` com `carryover.changed`. (Mantém `RetroAuditItemDTO` e `audit.changed` — removidos na Task 3.)

- [ ] **Step 1: Adicionar `RetroCarryoverItemDTO`** — após `RetroActionItemDTO`:

```ts
export interface RetroCarryoverItemDTO {
  id: string                 // id do card de origem
  plan: string
  dueDate: string            // AAAA-MM-DD
  responsible: RetroCardAuthor | null
  sprint: number             // sprint da retro de origem
  type: 'validate' | 'overdue'
  auditStatus: 'VALIDATED' | 'REJECTED' | null
}
```

- [ ] **Step 2: Adicionar o evento** — em `RetroEvent`, junto ao bloco não-efêmero (perto de `audit.changed`):

```ts
  | { type: 'carryover.changed' }
```

- [ ] **Step 3: Build** — `pnpm --filter @legends/shared build` (limpo).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/retro.ts
git commit -m "feat(shared): adiciona RetroCarryoverItemDTO e evento carryover.changed"
```

---

### Task 2: Serialize `toRetroCarryoverItemDTO` — aditivo

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Test: `apps/api/src/lib/serialize-retro.test.ts`

**Interfaces:**
- Consumes: `RetroCarryoverItemDTO` (Task 1).
- Produces: `toRetroCarryoverItemDTO(card, responsible, type, sprint): RetroCarryoverItemDTO`. (Mantém `toRetroAuditItemDTO` — removido na Task 3.)

- [ ] **Step 1: Escrever o teste (RED)** — em `serialize-retro.test.ts`, acrescentar `toRetroCarryoverItemDTO` ao import de `'./serialize'` e adicionar:

```ts
describe('serialize carryover', () => {
  const c = { id: 'c1', actionPlan: 'Doc deploy', actionDueDate: '2026-07-01', auditStatus: null } as any
  const resp = { id: 'u9', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null } as any
  it('monta item de validação com responsável e sprint', () => {
    expect(toRetroCarryoverItemDTO(c, resp, 'validate', 5)).toEqual({
      id: 'c1', plan: 'Doc deploy', dueDate: '2026-07-01',
      responsible: { id: 'u9', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
      sprint: 5, type: 'validate', auditStatus: null,
    })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @legends/api test -- --run serialize-retro` (FAIL: `toRetroCarryoverItemDTO is not a function`).

- [ ] **Step 3: Implementar** — em `serialize.ts`, adicionar `RetroCarryoverItemDTO` ao import de `@legends/shared` (mantendo `RetroAuditItemDTO`) e a função (após `toRetroAuditItemDTO`):

```ts
export function toRetroCarryoverItemDTO(
  card: Pick<RetroCard, 'id' | 'actionPlan' | 'actionDueDate' | 'auditStatus'>,
  responsible: User | null,
  type: 'validate' | 'overdue',
  sprint: number,
): RetroCarryoverItemDTO {
  return {
    id: card.id,
    plan: card.actionPlan ?? '',
    dueDate: card.actionDueDate ?? '',
    responsible: responsible
      ? {
          id: responsible.id,
          name: responsible.name,
          photoUrl: responsible.photoUrl,
          avatarStyle: responsible.avatarStyle as AvatarStyleKey | null,
          avatarSeed: responsible.avatarSeed,
          avatarOptions: (responsible.avatarOptions as AvatarOptions | null) ?? null,
        }
      : null,
    sprint,
    type,
    auditStatus: (card.auditStatus as 'VALIDATED' | 'REJECTED' | null) ?? null,
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @legends/api test -- --run serialize-retro` (PASS).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize-retro.test.ts
git commit -m "feat(retro): adiciona toRetroCarryoverItemDTO"
```

---

### Task 3: Backend — `listCarryover`/`setCarryover` + rotas (substitui auditoria)

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Modify: `apps/api/src/lib/serialize.ts` (remover `toRetroAuditItemDTO`)
- Modify: `packages/shared/src/retro.ts` (remover `RetroAuditItemDTO` + `audit.changed`)
- Modify: `apps/api/src/lib/serialize-retro.test.ts` (remover teste de `toRetroAuditItemDTO`, se houver)
- Create: `apps/api/src/routes/retro-carryover.test.ts`
- Delete: `apps/api/src/routes/retro-audit.test.ts`

**Interfaces:**
- Produces: `priorConcludedSquadRooms(room)`, `listCarryover(roomId, viewer)`, `setCarryover(input)`; rotas `GET /retro/rooms/:id/carryover` e `POST /retro/rooms/:id/carryover/:cardId`; broadcast `carryover.changed`. Remove `findAuditSourceRoom`/`listAudit`/`setAudit`, rotas `/audit`, `toRetroAuditItemDTO`, `RetroAuditItemDTO`, `audit.changed`.
- Consumes: `loadRoom`, `loadCard`, `resolveRole`, `upsertActionCard`, `optionalText`, `toRetroCarryoverItemDTO`.

- [ ] **Step 1: Escrever os testes (RED)** — `git rm apps/api/src/routes/retro-audit.test.ts` e criar `apps/api/src/routes/retro-carryover.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'DEV' | 'LEAD' = 'LEAD') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function squad(name: string) {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase() } })
}
async function action(roomId: string, authorId: string, over: Record<string, unknown>) {
  return prisma.retroCard.create({ data: { roomId, authorId, text: 'o', color: 'blue', kind: 'note', x: 1200, y: 340, actionPlan: 'P', actionResponsible: authorId, actionDueDate: '2026-07-01', ...over } })
}

describe('GET /retro/rooms/:id/carryover', () => {
  it('classifica a validar (done) e vencida (prazo<=data da sala), só da mesma squad', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('Lia', 'LEAD')
      const sq = await squad('S'); const other = await squad('Other')
      const prev = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: sq.id } } } })
      const otherPrev = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: other.id } } } })
      const current = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, createdAt: new Date('2026-06-10'), squads: { create: { squadId: sq.id } } } })

      await action(prev.id, lead.id, { actionDone: true, actionDoneAt: new Date('2026-06-04'), actionPlan: 'Concluída' })
      await action(prev.id, lead.id, { actionDone: false, actionDueDate: '2026-06-05', actionPlan: 'Vencida' })
      await action(prev.id, lead.id, { actionDone: false, actionDueDate: '2026-12-31', actionPlan: 'Futura' })
      await action(otherPrev.id, lead.id, { actionDone: true, actionDoneAt: new Date(), actionPlan: 'OutraSquad' })

      const tk = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
      const res = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/carryover`, headers: { authorization: `Bearer ${tk}` } })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.toValidate.map((i: { plan: string }) => i.plan)).toEqual(['Concluída'])
      expect(body.overdue.map((i: { plan: string }) => i.plan)).toEqual(['Vencida'])
      expect(body.toValidate[0]).toMatchObject({ type: 'validate', sprint: 5 })
      expect(body.overdue[0]).toMatchObject({ type: 'overdue', sprint: 5 })
    } finally { await app.close() }
  })
})

describe('POST /retro/rooms/:id/carryover/:cardId', () => {
  async function setup() {
    const app = buildApp(); await app.ready()
    const lead = await user('Lia', 'LEAD'); const dev = await user('Dan', 'DEV')
    const sq = await squad('S2')
    const prev = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: sq.id } } } })
    const current = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, createdAt: new Date('2026-06-10'), squads: { create: { squadId: sq.id } }, participants: { create: { userId: dev.id } } } })
    const act = await action(prev.id, lead.id, { actionDone: false, actionDueDate: '2026-06-05' })
    return { app, lead, dev, current, act }
  }

  it('DEV não resolve (403); LEAD reschedule muda prazo e tira de vencida', async () => {
    const { app, dev, lead, current, act } = await setup()
    try {
      const devTk = app.jwt.sign({ sub: dev.id, role: 'DEV' })
      const forbidden = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${devTk}` }, payload: { action: 'reschedule', dueDate: '2026-12-31' } })
      expect(forbidden.statusCode).toBe(403)

      const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
      const ok = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'reschedule', dueDate: '2026-12-31' } })
      expect(ok.statusCode).toBe(200)
      expect((await prisma.retroCard.findUnique({ where: { id: act.id } }))!.actionDueDate).toBe('2026-12-31')
      const list = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/carryover`, headers: { authorization: `Bearer ${leadTk}` } })
      expect(list.json().overdue).toHaveLength(0)
    } finally { await app.close() }
  })

  it('LEAD done marca concluída (vira a validar)', async () => {
    const { app, lead, current, act } = await setup()
    try {
      const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
      const res = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'done' } })
      expect(res.statusCode).toBe(200)
      expect((await prisma.retroCard.findUnique({ where: { id: act.id } }))!.actionDone).toBe(true)
      const list = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/carryover`, headers: { authorization: `Bearer ${leadTk}` } })
      expect(list.json().toValidate.map((i: { id: string }) => i.id)).toContain(act.id)
    } finally { await app.close() }
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm db:up && pnpm --filter @legends/api test -- --run retro-carryover` (FAIL: rotas 404).

- [ ] **Step 3: Service** — em `retro-service.ts`: **remover** `findAuditSourceRoom`, `listAudit`, `setAudit`. Adicionar:

```ts
function priorConcludedSquadRooms(room: { id: string; createdAt: Date; squads: { squadId: string }[] }) {
  const squadIds = room.squads.map((s) => s.squadId)
  if (squadIds.length === 0) return Promise.resolve([] as { id: string; sprint: number }[])
  return prisma.retroRoom.findMany({
    where: { id: { not: room.id }, status: 'CONCLUDED', concludedAt: { lt: room.createdAt }, squads: { some: { squadId: { in: squadIds } } } },
    select: { id: true, sprint: true },
  })
}

export async function listCarryover(roomId: string, viewer: { id: string; role: string }) {
  const room = await loadRoom(roomId)
  if (!resolveRole(room, viewer)) throw new RetroError('Sala não encontrada.', 404)
  const sources = await priorConcludedSquadRooms(room)
  if (sources.length === 0) return { toValidate: [], overdue: [] }
  const sprintByRoom = new Map(sources.map((s) => [s.id, s.sprint]))
  const cards = await prisma.retroCard.findMany({
    where: { roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
    include: { author: true },
  })
  const roomDate = room.createdAt.toISOString().slice(0, 10)
  const toValidate = cards.filter((c) => c.actionDone && c.auditStatus == null)
    .sort((a, b) => (b.actionDoneAt?.getTime() ?? 0) - (a.actionDoneAt?.getTime() ?? 0))
  const overdue = cards.filter((c) => !c.actionDone && (c.actionDueDate ?? '') <= roomDate)
    .sort((a, b) => (a.actionDueDate ?? '').localeCompare(b.actionDueDate ?? ''))
  const respIds = [...new Set([...toValidate, ...overdue].map((c) => c.actionResponsible).filter((x): x is string => Boolean(x)))]
  const users = await prisma.user.findMany({ where: { id: { in: respIds } } })
  const byId = new Map(users.map((u) => [u.id, u]))
  const item = (c: (typeof cards)[number]) => ({
    card: c,
    responsible: c.actionResponsible ? byId.get(c.actionResponsible) ?? null : null,
    sprint: sprintByRoom.get(c.roomId) ?? 0,
  })
  return { toValidate: toValidate.map(item), overdue: overdue.map(item) }
}

export async function setCarryover(input: {
  roomId: string
  cardId: string
  userId: string
  role: string
  action: 'validate' | 'reject' | 'reschedule' | 'done'
  dueDate?: string
}): Promise<{ card: RetroCard; responsible: User | null; sprint: number }> {
  const room = await loadRoom(input.roomId)
  if (!resolveRole(room, { id: input.userId, role: input.role })) throw new RetroError('Sala não encontrada.', 404)
  if (input.role !== 'LEAD') throw new RetroError('Apenas líderes resolvem ações de outras sprints.', 403)
  const sources = await priorConcludedSquadRooms(room)
  const card = await prisma.retroCard.findFirst({
    where: { id: input.cardId, roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
  })
  if (!card) throw new RetroError('Ação não encontrada para esta sala.', 404)
  const now = new Date()
  let data: Record<string, unknown>
  if (input.action === 'validate') data = { auditStatus: 'VALIDATED', auditedById: input.userId, auditedAt: now }
  else if (input.action === 'reject') data = { auditStatus: 'REJECTED', auditedById: input.userId, auditedAt: now, actionDone: false, actionDoneAt: null }
  else if (input.action === 'done') data = { actionDone: true, actionDoneAt: now }
  else {
    const due = optionalText(input.dueDate, 20)
    if (!due) throw new RetroError('Novo prazo inválido.', 400)
    data = { actionDueDate: due }
  }
  await prisma.retroCard.update({ where: { id: card.id }, data })
  const updated = await loadCard(card.roomId, card.id)
  if (input.action === 'reschedule') {
    const sourceRoom = await loadRoom(card.roomId)
    await upsertActionCard(sourceRoom, updated)
  }
  const sourceRoom = await prisma.retroRoom.findUnique({ where: { id: card.roomId }, select: { sprint: true } })
  const responsible = updated.actionResponsible ? await prisma.user.findUnique({ where: { id: updated.actionResponsible } }) : null
  return { card: updated, responsible, sprint: sourceRoom?.sprint ?? 0 }
}
```

- [ ] **Step 4: Rotas** — em `retro.ts`: no import de `../services/retro-service`, remover `listAudit`/`setAudit` (e `findAuditSourceRoom` se importado), adicionar `listCarryover`/`setCarryover`. No import de `../lib/serialize`, remover `toRetroAuditItemDTO`, adicionar `toRetroCarryoverItemDTO`. **Remover** os handlers `/audit` e `/audit/:cardId` e a const `auditSchema`. Adicionar:

```ts
const carryoverSchema = z
  .object({ action: z.enum(['validate', 'reject', 'reschedule', 'done']), dueDate: z.string().optional() })
  .refine((d) => d.action !== 'reschedule' || (d.dueDate != null && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate)), { message: 'Novo prazo inválido.' })
```
e os handlers:
```ts
  app.get('/retro/rooms/:id/carryover', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { toValidate, overdue } = await listCarryover(id, { id: request.user.sub, role: request.user.role })
      return reply.send({
        toValidate: toValidate.map(({ card, responsible, sprint }) => toRetroCarryoverItemDTO(card, responsible, 'validate', sprint)),
        overdue: overdue.map(({ card, responsible, sprint }) => toRetroCarryoverItemDTO(card, responsible, 'overdue', sprint)),
      })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/carryover/:cardId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = carryoverSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { card, responsible, sprint } = await setCarryover({ roomId: id, cardId, userId: request.user.sub, role: request.user.role, ...parsed.data })
      retroHub.broadcast(id, () => ({ type: 'carryover.changed' }))
      const type = card.actionDone && card.auditStatus == null ? 'validate' : 'overdue'
      return reply.send({ item: toRetroCarryoverItemDTO(card, responsible, type, sprint) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 5: Remover símbolos órfãos** — agora que o backend não os referencia mais:
  - `serialize.ts`: remover a função `toRetroAuditItemDTO` e tirar `RetroAuditItemDTO` do import de `@legends/shared`.
  - `serialize-retro.test.ts`: remover o(s) teste(s) que chamavam `toRetroAuditItemDTO` e tirar do import.
  - `packages/shared/src/retro.ts`: remover a interface `RetroAuditItemDTO` e a variante `| { type: 'audit.changed' }` de `RetroEvent`.

- [ ] **Step 6: Rodar e ver passar** — `pnpm --filter @legends/shared build` então `pnpm --filter @legends/api test -- --run retro` (toda a suíte de retro verde, incl. retro-carryover e serialize-retro).

- [ ] **Step 7: Typecheck da API** — `pnpm --filter @legends/api exec tsc --noEmit` (limpo; sem usos órfãos).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/lib/serialize.ts apps/api/src/lib/serialize-retro.test.ts packages/shared/src/retro.ts apps/api/src/routes/retro-carryover.test.ts apps/api/src/routes/retro-audit.test.ts
git commit -m "feat(retro): carry-over (listCarryover/setCarryover + rotas) substitui auditoria no backend"
```

> Após esta task, o **TS do web fica vermelho** (RetroRoomPage/AuditPanel/useRetroSocket ainda usam símbolos de auditoria). Isso é resolvido inteiramente na Task 4.

---

### Task 4: Web — cards de carry-over no quadrante "Ações" (remove auditoria)

**Files:**
- Modify: `apps/web/src/lib/retro-api.ts`, `apps/web/src/lib/useRetroSocket.ts`, `apps/web/src/pages/retro/ColorPalette.tsx`, `apps/web/src/pages/RetroRoomPage.tsx`, `apps/web/src/pages/RetroRoomPage.test.tsx`
- Create: `apps/web/src/pages/retro/CarryoverCard.tsx`, `apps/web/src/pages/retro/CarryoverCard.test.tsx`
- Delete: `apps/web/src/pages/retro/AuditPanel.tsx`, `apps/web/src/pages/retro/AuditPanel.test.tsx`

**Interfaces:**
- Consumes: `RetroCarryoverItemDTO`, `getRetroCarryover`/`setRetroCarryover`, `RETRO_REGIONS`, `Avatar`.
- Produces: `getRetroCarryover(roomId)`, `setRetroCarryover(roomId, cardId, action, dueDate?)`; `CarryoverCard`; `CARRYOVER_CARD_CLASS`.

- [ ] **Step 1: API client + socket** — em `retro-api.ts`: trocar `RetroAuditItemDTO`→`RetroCarryoverItemDTO` no import; remover `getRetroAudit`/`setRetroAudit`; adicionar:

```ts
export function getRetroCarryover(roomId: string) {
  return apiFetch<{ toValidate: RetroCarryoverItemDTO[]; overdue: RetroCarryoverItemDTO[] }>(`/retro/rooms/${roomId}/carryover`)
}
export function setRetroCarryover(roomId: string, cardId: string, action: 'validate' | 'reject' | 'reschedule' | 'done', dueDate?: string) {
  return apiFetch<{ item: RetroCarryoverItemDTO }>(`/retro/rooms/${roomId}/carryover/${cardId}`, {
    method: 'POST',
    body: JSON.stringify(dueDate ? { action, dueDate } : { action }),
  })
}
```
Em `useRetroSocket.ts`, trocar a linha `audit.changed` por:
```ts
        if (e.type === 'carryover.changed') qc.invalidateQueries({ queryKey: ['retro-carryover', roomId] })
```

- [ ] **Step 2: Cores** — em `ColorPalette.tsx`, adicionar:
```ts
export const CARRYOVER_CARD_CLASS: Record<'validate' | 'overdue', string> = {
  validate: 'bg-violet-200 border-violet-400 ring-2 ring-violet-400/50',
  overdue: 'bg-red-200 border-red-500 ring-2 ring-red-500/50',
}
```

- [ ] **Step 3: Teste do componente (RED)** — criar `CarryoverCard.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CarryoverCard } from './CarryoverCard'

const base = { id: 'a1', plan: 'Documentar deploy', dueDate: '2026-07-01', responsible: { id: 'u1', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }, sprint: 5, auditStatus: null } as const

describe('CarryoverCard', () => {
  it('a validar: Validar/Reprovar só para LEAD', () => {
    const onAction = vi.fn()
    const { rerender } = render(<CarryoverCard item={{ ...base, type: 'validate' }} canAct={false} onAction={onAction} />)
    expect(screen.getByText('Documentar deploy')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validar' })).toBeNull()
    rerender(<CarryoverCard item={{ ...base, type: 'validate' }} canAct onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }))
    expect(onAction).toHaveBeenCalledWith('a1', 'validate')
  })
  it('vencida: Concluir chama onAction(done)', () => {
    const onAction = vi.fn()
    render(<CarryoverCard item={{ ...base, type: 'overdue' }} canAct onAction={onAction} />)
    expect(screen.getByText(/Vencida/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    expect(onAction).toHaveBeenCalledWith('a1', 'done')
  })
})
```
Rodar: `pnpm --filter @legends/web test -- --run CarryoverCard` (FAIL: módulo inexistente).

- [ ] **Step 4: Implementar `CarryoverCard.tsx`**:
```tsx
import { useState, type JSX } from 'react'
import type { RetroCarryoverItemDTO } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { CARRYOVER_CARD_CLASS } from './ColorPalette'

function formatDue(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}
export type CarryoverAction = 'validate' | 'reject' | 'reschedule' | 'done'

export function CarryoverCard({
  item, canAct, onAction,
}: {
  item: RetroCarryoverItemDTO
  canAct: boolean
  onAction: (cardId: string, action: CarryoverAction, dueDate?: string) => void
}): JSX.Element {
  const [newDate, setNewDate] = useState('')
  const isOverdue = item.type === 'overdue'
  return (
    <div className={`flex w-[220px] flex-col gap-1 rounded-lg border-2 p-2 shadow-md ${CARRYOVER_CARD_CLASS[item.type]}`}>
      <span className="font-label text-[10px] font-bold uppercase tracking-wide text-zinc-700">
        {isOverdue ? 'Vencida' : 'A validar'} · Sprint {item.sprint}
      </span>
      <div className="flex items-center gap-1">
        <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-zinc-700 ring-1 ring-white/60">
          <Avatar user={item.responsible ?? { name: '?' }} initialsClassName="text-[9px] font-bold text-white" />
        </span>
        <span className="text-[11px] text-zinc-800">{item.responsible?.name ?? 'Sem responsável'}</span>
      </div>
      <p className="text-body-sm text-zinc-900">{item.plan}</p>
      <p className={`font-label text-[11px] ${isOverdue ? 'font-bold text-red-700' : 'text-zinc-700'}`}>
        {isOverdue ? `Venceu em ${formatDue(item.dueDate)}` : `Prazo: ${formatDue(item.dueDate)}`}
      </p>
      {canAct && !isOverdue && (
        <div className="mt-1 flex gap-1">
          <button type="button" onClick={() => onAction(item.id, 'validate')} className="rounded bg-primary px-2 py-0.5 font-label text-[11px] font-bold text-on-primary">Validar</button>
          <button type="button" onClick={() => onAction(item.id, 'reject')} className="rounded border border-zinc-400/60 px-2 py-0.5 font-label text-[11px] text-zinc-800">Reprovar</button>
        </div>
      )}
      {canAct && isOverdue && (
        <div className="mt-1 flex flex-col gap-1">
          <button type="button" onClick={() => onAction(item.id, 'done')} className="rounded bg-primary px-2 py-0.5 font-label text-[11px] font-bold text-on-primary">Concluir</button>
          <div className="flex items-center gap-1">
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-6 flex-1 rounded border border-zinc-400/60 bg-white/80 px-1 text-[11px] text-zinc-900" />
            <button type="button" disabled={!newDate} onClick={() => onAction(item.id, 'reschedule', newDate)} className="rounded border border-zinc-400/60 px-2 py-0.5 font-label text-[11px] text-zinc-800 disabled:opacity-40">Novo prazo</button>
          </div>
        </div>
      )}
    </div>
  )
}
```
Rodar: `pnpm --filter @legends/web test -- --run CarryoverCard` (PASS).

- [ ] **Step 5: Remover auditoria do `RetroRoomPage.tsx`** — apagar import/uso de `AuditPanel`, `getRetroAudit`/`setRetroAudit`, estado `auditOpen`, `auditQuery`, `auditM`, o botão "Auditoria (N)" do header e o render `{auditOpen && <AuditPanel .../>}`. `git rm apps/web/src/pages/retro/AuditPanel.tsx apps/web/src/pages/retro/AuditPanel.test.tsx`.

- [ ] **Step 6: Adicionar carry-over no `RetroRoomPage.tsx`** — imports `import { getRetroCarryover, setRetroCarryover } from '../lib/retro-api'` e `import { CarryoverCard, type CarryoverAction } from './retro/CarryoverCard'`. Queries/mutação (perto das outras):
```ts
  const carryoverQuery = useQuery({ queryKey: ['retro-carryover', id], queryFn: () => getRetroCarryover(id), enabled: !!id })
  const carryoverM = useMutation({
    mutationFn: (v: { cardId: string; action: CarryoverAction; dueDate?: string }) => setRetroCarryover(id, v.cardId, v.action, v.dueDate),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['retro-carryover', id] }),
  })
  const canActCarryover = user?.role === 'LEAD'
```
Render dos cards virtuais — dentro do `<div data-world>` (após `room.cards.map(...)`):
```tsx
          {(() => {
            const actionsRegion = RETRO_REGIONS.find((r) => r.id === 'actions')!
            const ownInActions = room.cards.filter((c) => isInRegion(c, 'actions')).length
            const startRow = Math.ceil(ownInActions / 4) + 1
            const carry = [...(carryoverQuery.data?.overdue ?? []), ...(carryoverQuery.data?.toValidate ?? [])]
            return carry.map((it, i) => {
              const x = actionsRegion.x + 40 + (i % 4) * 240
              const y = actionsRegion.y + 80 + (startRow + Math.floor(i / 4)) * 240
              return (
                <div key={it.id} className="absolute" style={{ left: x, top: y }}>
                  <CarryoverCard item={it} canAct={canActCarryover} onAction={(cardId, action, dueDate) => carryoverM.mutate({ cardId, action, dueDate })} />
                </div>
              )
            })
          })()}
```

- [ ] **Step 7: Ajustar `RetroRoomPage.test.tsx`** — no `vi.mock('../lib/retro-api', ...)`: remover `getRetroAudit`/`setRetroAudit`; adicionar `getRetroCarryover: vi.fn().mockResolvedValue({ toValidate: [], overdue: [] })` e `setRetroCarryover: vi.fn().mockResolvedValue({ item: {} })`. Remover asserts de auditoria, se houver. Adicionar:
```ts
it('renderiza card de carry-over (vencida) no quadrante Ações', async () => {
  vi.mocked(api.getRetroCarryover).mockResolvedValue({
    toValidate: [],
    overdue: [{ id: 'a1', plan: 'Ação vencida', dueDate: '2026-06-01', responsible: pub('d1', 'Dan'), sprint: 5, type: 'overdue', auditStatus: null }],
  })
  renderPage()
  expect(await screen.findByText('Ação vencida')).toBeInTheDocument()
  expect(screen.getByText(/Vencida/i)).toBeInTheDocument()
})
```

- [ ] **Step 8: Verificar** — `pnpm --filter @legends/web exec tsc --noEmit` (limpo) e `pnpm --filter @legends/web test -- --run RetroRoomPage CarryoverCard useRetroSocket` (PASS).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/retro-api.ts apps/web/src/lib/useRetroSocket.ts apps/web/src/pages/retro/ColorPalette.tsx apps/web/src/pages/retro/CarryoverCard.tsx apps/web/src/pages/retro/CarryoverCard.test.tsx apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx apps/web/src/pages/retro/AuditPanel.tsx apps/web/src/pages/retro/AuditPanel.test.tsx
git commit -m "feat(web): cards de carry-over no quadrante Ações (remove painel Auditoria)"
```

---

### Task 5: Verificação final

- [ ] **Step 1: Suíte completa** — `pnpm db:up && pnpm test` (api + web + shared verdes; nada referenciando audit).
- [ ] **Step 2: Typecheck por workspace** — `pnpm --filter @legends/api exec tsc --noEmit` e `pnpm --filter @legends/web exec tsc --noEmit` (ambos limpos).
- [ ] **Step 3: Build** — `pnpm build` (verde; warnings pré-existentes ok).
- [ ] **Step 4: Smoke manual (opcional)** — concluir uma ação no perfil; criar a próxima retro da squad: card "A validar" (roxo) com Validar/Reprovar no quadrante Ações; uma ação vencida não-concluída aparece "Vencida" (vermelho) com Concluir/Novo prazo.

---

## Self-Review

- **Cobertura do spec:** contrato → Task 1; serialize → Task 2; cálculo + ações + rotas + remoção da auditoria (backend) → Task 3; web (cliente, socket, componente, cores, render, remoção do painel) → Task 4; verificação → Task 5.
- **Ordem segura:** Tasks 1–2 aditivas; toda remoção de auditoria no backend acontece junta na Task 3 (Step 5), depois que nada a referencia → cada task da API termina com módulos carregáveis. O web (Task 4) faz a troca + remoção num único commit (TS do web fica vermelho só durante a Task 3, entre commits).
- **Placeholders:** nenhum; todo passo tem código/comando.
- **Consistência de tipos:** `RetroCarryoverItemDTO` (Task 1) usado em 2/3/4; `toRetroCarryoverItemDTO(card, responsible, type, sprint)` igual em 2/3; `priorConcludedSquadRooms`/`listCarryover`/`setCarryover` consistentes service↔rota; `['retro-carryover', id]` igual em socket/query/mutation; `CarryoverAction` e `getRetroCarryover`/`setRetroCarryover` (Task 4) coerentes.
