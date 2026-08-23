# Carry-over fixo no topo do quadrante "Ações" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renderizar os cards de carry-over (vencida / a validar) fixos no topo do quadrante "Ações", com os card-espelho da própria sala nascendo abaixo de uma faixa reservada, para não sobrepor nem bloquear o arraste.

**Architecture:** Duas mudanças independentes e pequenas. (1) Backend: `upsertActionCard` reserva uma faixa fixa no topo da região "Ações" ao calcular o `y` de um novo card-espelho. (2) Frontend: o overlay de carry-over no `RetroRoomPage` passa a posicionar a partir do topo da região, sem o offset `startRow`. Sem migração, sem mudança de contrato.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (api), Vite + React 18 + React Query (web), Vitest.

## Global Constraints

- Região "Ações": `{ id: 'actions', x: 2320, y: 280, w: 1080, h: 1900 }` (de `RETRO_REGIONS` em `@legends/shared`). Logo `actions.y + 80 = 360`, `actions.x + 40 = 2360`.
- Testes da API batem em Postgres real (`pnpm db:up` antes); `pnpm --filter @legends/api test`.
- `pnpm build` e Vitest **não** fazem typecheck do projeto — rodar `tsc --noEmit` por workspace ao mudar tipos (não é o caso aqui, mas vale conferir).
- Mensagens ao usuário em português; código novo segue a camada vizinha.
- Escopo: só sala **aberta** (onde o carry-over aparece). Arraste em sala concluída segue travado, fora de escopo.

---

### Task 1: Backend — reservar faixa no topo ao criar card-espelho

**Files:**
- Modify: `apps/api/src/services/retro-service.ts:318-321` (função `upsertActionCard`)
- Test: `apps/api/src/services/retro-card-service.test.ts` (novo caso após o de linha 100)

**Interfaces:**
- Consumes: `updateCard({ roomId, cardId, userId, actionPlan, actionResponsible, actionDueDate })` → `{ card, actionCard, actionCardCreated }` (já existente).
- Produces: nenhum símbolo novo exportado. Só muda o `y` do `actionCard` gerado: passa a ser `>= 840` (era `>= 360`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `apps/api/src/services/retro-card-service.test.ts`, logo após o teste `'cria card de ação quando card em ruim tem plano, responsável e prazo'` (termina na linha 120):

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

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
pnpm db:up
pnpm --filter @legends/api test -- retro-card-service
```

Expected: FAIL — `expected 360 to be 840` (o `y` atual é `actions.y + 80 + 0 = 360`).

- [ ] **Step 3: Implementar a faixa reservada**

Em `apps/api/src/services/retro-service.ts`, substituir as linhas 318-321:

```ts
  const actions = RETRO_REGIONS.find((r) => r.id === 'actions')
  const actionCount = await prisma.retroCard.count({ where: { roomId: room.id, x: { gte: actions?.x ?? 0 } } })
  const x = (actions?.x ?? 2320) + 40 + (actionCount % 4) * 220
  const y = (actions?.y ?? 280) + 80 + Math.floor(actionCount / 4) * 220
```

por:

```ts
  const actions = RETRO_REGIONS.find((r) => r.id === 'actions')
  const actionCount = await prisma.retroCard.count({ where: { roomId: room.id, x: { gte: actions?.x ?? 0 } } })
  // Faixa reservada no topo (~2 linhas) para os cards de carry-over fixos; espelhos nascem abaixo.
  const RESERVED_TOP = 2 * 240
  const x = (actions?.x ?? 2320) + 40 + (actionCount % 4) * 220
  const y = (actions?.y ?? 280) + 80 + RESERVED_TOP + Math.floor(actionCount / 4) * 220
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
pnpm --filter @legends/api test -- retro-card-service
```

Expected: PASS (incluindo os testes pré-existentes de `upsertActionCard`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-card-service.test.ts
git commit -m "feat(retro): reserva faixa no topo do quadrante Ações para carry-over"
```

---

### Task 2: Frontend — fixar carry-over no topo da região "Ações"

**Files:**
- Modify: `apps/web/src/pages/RetroRoomPage.tsx:563-577` (o IIFE que renderiza os cards de carry-over)
- Test: `apps/web/src/pages/RetroRoomPage.test.tsx` (estende o caso de linha 276)

**Interfaces:**
- Consumes: `carryoverQuery.data` = `{ overdue: RetroCarryoverItemDTO[]; toValidate: RetroCarryoverItemDTO[] }`; `RETRO_REGIONS` (região `actions` com `x:2320, y:280`); componente `CarryoverCard` (já existente).
- Produces: nenhum símbolo novo. O wrapper `<div>` de cada carry-over passa a ter `top` ≤ `360 + 240` (topo da região), independente de quantas ações próprias existam.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/pages/RetroRoomPage.test.tsx`, substituir o teste `'renderiza card de carry-over (vencida) no quadrante Ações'` (linhas 276-284) por uma versão que também afirma a posição de topo:

```tsx
  it('renderiza card de carry-over (vencida) fixo no topo do quadrante Ações', async () => {
    vi.mocked(api.getRetroCarryover).mockResolvedValue({
      toValidate: [],
      overdue: [{ id: 'a1', plan: 'Ação vencida', dueDate: '2026-06-01', responsible: pub('d1', 'Dan'), sprint: 5, type: 'overdue', auditStatus: null }],
    })
    renderPage()
    const label = await screen.findByText('Ação vencida')
    expect(screen.getAllByText(/Vencida/i).length).toBeGreaterThan(0)
    // fixo no topo: região "Ações" y base = 280 + 80 = 360, primeira linha → top = 360px.
    const wrapper = label.closest('div.absolute') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.style.top).toBe('360px')
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
pnpm --filter @legends/web test -- RetroRoomPage
```

Expected: FAIL — `expected '600px' to be '360px'`. Com 0 ações próprias, `startRow = ceil(0/4) + 1 = 1`, então `top = 360 + (1 + 0) * 240 = 600px`; com ações próprias seria maior. O ponto é que o `startRow` atual nunca deixa o card no topo (`360px`).

- [ ] **Step 3: Remover o offset `startRow`**

Em `apps/web/src/pages/RetroRoomPage.tsx`, substituir o bloco das linhas 563-577:

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

por:

```tsx
          {(() => {
            const actionsRegion = RETRO_REGIONS.find((r) => r.id === 'actions')!
            // Carry-over é fixo no topo da região "Ações" (não arrastável); as ações próprias nascem abaixo da faixa reservada.
            const carry = [...(carryoverQuery.data?.overdue ?? []), ...(carryoverQuery.data?.toValidate ?? [])]
            return carry.map((it, i) => {
              const x = actionsRegion.x + 40 + (i % 4) * 240
              const y = actionsRegion.y + 80 + Math.floor(i / 4) * 240
              return (
                <div key={it.id} className="absolute" style={{ left: x, top: y }}>
                  <CarryoverCard item={it} canAct={canActCarryover} onAction={(cardId, action, dueDate) => carryoverM.mutate({ cardId, action, dueDate })} />
                </div>
              )
            })
          })()}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
pnpm --filter @legends/web test -- RetroRoomPage
```

Expected: PASS. Se `isInRegion` ficar sem uso após a remoção, conferir que ainda é usado em outro ponto do arquivo (é — no hit-test de arraste); não remover o import.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(retro): carry-over fixo no topo do quadrante Ações"
```

---

## Verificação final

- [ ] `pnpm test` (api + web + shared) verde.
- [ ] Conferir visualmente em sala aberta com carry-over: cards de carry-over no topo, ações próprias abaixo e arrastáveis, sem sobreposição (até ~8 itens de carry-over; acima disso, sobreposição leve aceitável — usuário arrasta).

## Fora de escopo (YAGNI)

- Persistir posição dos cards de carry-over.
- Arrastar em sala concluída.
- Reserva dinâmica pela contagem real de carry-over (faixa fixa de 2 linhas basta).
