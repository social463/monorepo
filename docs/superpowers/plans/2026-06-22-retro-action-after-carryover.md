# Cards de ação logo na sequência do carry-over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Posicionar os cards-espelho de ação novos logo na sequência dos cards de carry-over (offset dinâmico pela contagem real de carry-over), em vez de abaixo de uma faixa fixa de 2 linhas.

**Architecture:** Mudança backend-only em `upsertActionCard` (apps/api/src/services/retro-service.ts). Substitui `RESERVED_TOP` por um offset dinâmico `carryoverCount + actionCount`, numa grade única de 240px alinhada à que o frontend já usa para o carry-over no topo. Um helper interno `countCarryover(room)` reusa `priorConcludedSquadRooms` e os mesmos filtros de classificação de `listCarryover`.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL, Vitest contra Postgres real.

## Global Constraints

- Região "Ações" em `RETRO_REGIONS`: `{ id: 'actions', x: 2320, y: 280, w: 1080, h: 1900 }`. Logo `actions.x + 40 = 2360`, `actions.y + 80 = 360`.
- Grade contígua de **240px**, 4 colunas: slot `s` → `x = 2320 + 40 + (s % 4) * 240`, `y = 280 + 80 + Math.floor(s / 4) * 240`.
- `carryoverCount` = total de itens de carry-over da sala = `toValidate + overdue`, com as MESMAS regras de `listCarryover` (retro-service.ts:548-551): `toValidate` = `actionDone && auditStatus == null`; `overdue` = `!actionDone && (actionDueDate ?? '') <= roomDate`, onde `roomDate = room.createdAt.toISOString().slice(0,10)`.
- Backend-only: sem mudança de contrato (`@legends/shared`), schema ou frontend.
- Testes da API batem em Postgres real (`pnpm db:up` antes). GOTCHA: se `brew services` rodar `postgresql@17`, ele sombreia o Docker na 5432 — `brew services stop postgresql@17` e repetir.

---

### Task 1: Offset dinâmico pelo carry-over em `upsertActionCard`

**Files:**
- Modify: `apps/api/src/services/retro-service.ts:301-329` (adiciona helper `countCarryover` antes de `upsertActionCard`; altera o cálculo de `x`/`y`)
- Test: `apps/api/src/services/retro-card-service.test.ts` (altera o teste existente da linha 122-135 e adiciona um novo logo após)

**Interfaces:**
- Consumes: `priorConcludedSquadRooms(room)` (retro-service.ts:528) → `Promise<{ id: string; sprint: number }[]>`; `createCard(...)`, `updateCard({ roomId, cardId, userId, actionPlan, actionResponsible, actionDueDate })` → `{ card, actionCard, actionCardCreated }` (já existentes); `RetroRoomWithRelations` (tem `id`, `createdAt`, `squads: { squadId }[]`).
- Produces: helper interno `countCarryover(room: RetroRoomWithRelations): Promise<number>` (não exportado). O `x`/`y` do `actionCard` gerado passa a depender do carry-over: sem carry-over → slot 0 (`x=2360, y=360`); com 1 carry-over → slot 1 (`x=2600, y=360`).

- [ ] **Step 1: Atualizar o teste existente da faixa reservada (sem carry-over → slot 0)**

Em `apps/api/src/services/retro-card-service.test.ts`, substituir o teste atual (linhas 122-135):

```ts
  it('card-espelho nasce abaixo da faixa reservada para carry-over (topo)', async () => {
    const { dev, r } = await room()
    const ana = await mkUser('AnaTopo')
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360 })
    const { actionCard } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
    })
    // região "Ações": y base = 280 + 80 = 360; faixa reservada = 2*240 = 480 → primeiro espelho em y = 840.
    expect(actionCard?.y).toBe(840)
  })
```

por:

```ts
  it('sem carry-over: card-espelho nasce no slot 0 do quadrante Ações', async () => {
    const { dev, r } = await room()
    const ana = await mkUser('AnaTopo')
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360 })
    const { actionCard } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
    })
    // sem carry-over → slot 0: x = 2320+40 = 2360; y = 280+80 = 360.
    expect(actionCard?.x).toBe(2360)
    expect(actionCard?.y).toBe(360)
  })
```

- [ ] **Step 2: Adicionar o teste novo (1 carry-over → slot 1)**

Logo após o teste do Step 1, adicionar:

```ts
  it('com carry-over: card-espelho nasce logo após os cards carregados', async () => {
    const { lead, dev, r } = await room()
    const ana = await mkUser('AnaSeq')
    // squad da sala atual (criada pelo helper room()).
    const sqId = (await prisma.retroRoom.findUniqueOrThrow({ where: { id: r.id }, include: { squads: true } })).squads[0].squadId
    // sala anterior concluída, mesma squad, com 1 ação vencida (vira 1 item de carry-over na sala atual).
    const prev = await prisma.retroRoom.create({
      data: {
        sprint: 0, createdById: lead.id, anonymous: true, votesPerParticipant: 3,
        status: 'CONCLUDED', concludedAt: new Date('2020-01-01'), createdAt: new Date('2019-12-01'),
        squads: { create: { squadId: sqId } },
      },
    })
    await prisma.retroCard.create({
      data: {
        roomId: prev.id, authorId: lead.id, text: 'o', color: 'blue', kind: 'note', x: 1200, y: 340,
        actionPlan: 'P', actionResponsible: lead.id, actionDueDate: '2020-01-01', actionDone: false,
      },
    })

    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360 })
    const { actionCard } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
    })
    // 1 carry-over + 0 espelhos = slot 1: x = 2360 + 240 = 2600; y = 360 (mesma linha).
    expect(actionCard?.x).toBe(2600)
    expect(actionCard?.y).toBe(360)
  })
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

```bash
pnpm db:up
pnpm --filter @legends/api test -- retro-card-service
```

Expected: FAIL. O teste do Step 1 falha com `expected 840 to be 360` (lógica antiga usa `RESERVED_TOP`). O teste do Step 2 falha na asserção de `x`: `expected 2360 to be 2600` (a lógica antiga ignora o carry-over — `x = 2360 + (0%4)*220 = 2360`).

- [ ] **Step 4: Implementar o helper e o offset dinâmico**

Em `apps/api/src/services/retro-service.ts`, adicionar o helper imediatamente ANTES de `async function upsertActionCard` (antes da linha 301):

```ts
async function countCarryover(room: RetroRoomWithRelations): Promise<number> {
  const sources = await priorConcludedSquadRooms(room)
  if (sources.length === 0) return 0
  const cards = await prisma.retroCard.findMany({
    where: { roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
    select: { actionDone: true, auditStatus: true, actionDueDate: true },
  })
  const roomDate = room.createdAt.toISOString().slice(0, 10)
  const toValidate = cards.filter((c) => c.actionDone && c.auditStatus == null).length
  const overdue = cards.filter((c) => !c.actionDone && (c.actionDueDate ?? '') <= roomDate).length
  return toValidate + overdue
}
```

E substituir o bloco de posicionamento (linhas atuais 318-323):

```ts
  const actions = RETRO_REGIONS.find((r) => r.id === 'actions')
  const actionCount = await prisma.retroCard.count({ where: { roomId: room.id, x: { gte: actions?.x ?? 0 } } })
  // Faixa reservada no topo (~2 linhas) para os cards de carry-over fixos; espelhos nascem abaixo.
  const RESERVED_TOP = 2 * 240
  const x = (actions?.x ?? 2320) + 40 + (actionCount % 4) * 220
  const y = (actions?.y ?? 280) + 80 + RESERVED_TOP + Math.floor(actionCount / 4) * 220
```

por:

```ts
  const actions = RETRO_REGIONS.find((r) => r.id === 'actions')
  const actionCount = await prisma.retroCard.count({ where: { roomId: room.id, x: { gte: actions?.x ?? 0 } } })
  // Novo espelho entra logo na sequência dos cards de carry-over (fixos no topo), grade única de 240px.
  const slot = (await countCarryover(room)) + actionCount
  const x = (actions?.x ?? 2320) + 40 + (slot % 4) * 240
  const y = (actions?.y ?? 280) + 80 + Math.floor(slot / 4) * 240
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

```bash
pnpm --filter @legends/api test -- retro-card-service
```

Expected: PASS (os dois testes novos/alterados + os pré-existentes de `upsertActionCard`, que só checam `text`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-card-service.test.ts
git commit -m "feat(retro): cards de ação novos entram logo na sequência do carry-over"
```

---

## Verificação final

- [ ] `pnpm test` (api + web + shared) verde.
- [ ] `tsc --noEmit` limpo em `@legends/api` (o helper usa `RetroRoomWithRelations` e `priorConcludedSquadRooms`).
- [ ] Conferir visualmente em sala aberta com 1 card de carry-over: a 1ª ação nova aparece ao lado dele (mesma linha), sem buraco.

## Fora de escopo (YAGNI)

- Reposicionar espelhos já criados quando `carryoverCount` muda depois.
- Contar carry-over por viewer (lista é global).
- Qualquer mudança no frontend (já renderiza o carry-over no topo na grade de 240).
