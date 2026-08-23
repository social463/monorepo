# Design — LEAD edita action cards de sala concluída (com rastro)

Data: 2026-06-22
Branch: `feat/retro-board`
Depende de: cards de ação (`actionPlan`/`actionResponsible`/`actionDueDate`, `upsertActionCard`) e da
feature de ações no perfil + auditoria (`2026-06-22-retro-action-todo-audit-design.md`, já implementada).

## Problema

Após uma retro ser **concluída** (`status = CONCLUDED`), todo write é bloqueado (`assertOpen` → 409).
Mas as **ações** (plano/responsável/prazo) continuam vivas: aparecem no perfil do responsável e são
auditadas na retro seguinte. Quando uma ação precisa de correção depois de concluída (responsável
errado, prazo, texto do plano), hoje não há como ajustar.

Queremos permitir que **qualquer usuário LEAD** edite os **action cards** de uma sala concluída,
**in-place** (a sala continua `CONCLUDED`), com **rastro de quem editou e quando**.

## Decisões tomadas

- **Editar in-place** — a sala permanece `CONCLUDED`; nada de reabrir. `concludedAt` não muda, então a
  cadeia de auditoria (que depende de `CONCLUDED`/`concludedAt`) não é perturbada.
- **Quem:** **qualquer LEAD** (não só o facilitador/criador). Um DEV/participante comum continua
  bloqueado após concluir.
- **Escopo:** **somente action cards** — card `kind = 'note'` posicionado numa região de ação
  (`RETRO_ACTION_REGION_IDS`). Edição = os campos do `updateCard` (texto/cor + `actionPlan`/
  `actionResponsible`/`actionDueDate`). **Nada** de criar/mover/excluir cards, votar, reagir, gerenciar
  participantes ou modo anônimo após concluir — tudo isso segue 409, inclusive para LEAD.
- **Rastro em duas camadas:**
  - **Carimbo no card:** `editedById`/`editedAt` no `RetroCard`, exibido como "editado por X em DD/MM"
    (mostra o **último** editor).
  - **Log da sala:** tabela `RetroEdit` (histórico cronológico completo das edições pós-conclusão),
    exibida num painel "Histórico de edições".
- Editar uma ação **reflete** em perfil/auditoria (leem o estado atual do card) — agora com rastro.
- Editar os campos **não** mexe em `actionDone`/`auditStatus` (fora de escopo; ver "Fora de escopo").
- Sem retrocompatibilidade de dados (banco pode resetar; sem dados de produção).

## Backend (`apps/api`)

### Prisma (`prisma/schema.prisma`) — uma migração nova
`RetroCard` ganha:
```prisma
editedById String?
editedAt   DateTime?
editedBy   User?     @relation("RetroCardsEdited", fields: [editedById], references: [id])
```
`User` ganha a relação inversa `editedRetroCards RetroCard[] @relation("RetroCardsEdited")`.

Novo model:
```prisma
model RetroEdit {
  id        String   @id @default(cuid())
  roomId    String
  editorId  String
  action    String            // "action.updated"
  detail    String?           // trecho do card/plano para exibição
  createdAt DateTime @default(now())

  room   RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  editor User      @relation("RetroEditsAuthored", fields: [editorId], references: [id])

  @@index([roomId])
}
```
`RetroRoom` ganha `edits RetroEdit[]`; `User` ganha `retroEditsAuthored RetroEdit[] @relation("RetroEditsAuthored")`.
Gerar com `pnpm db:migrate` (não editar migração aplicada).

### Service (`src/services/retro-service.ts`)
- **Helper** `isActionCard(card)`: `card.kind === 'note' && RETRO_ACTION_REGION_IDS.some((rid) => isCardInRegion(card, rid))`.
- **`updateCard`** passa a receber `role: string` no input. Substituir o `assertOpen(room)` por:
  - se `room.status === 'OPEN'`: comportamento atual (autor-only mais abaixo permanece).
  - se `room.status === 'CONCLUDED'`: exigir `role === 'LEAD'` (senão `RetroError('A sala foi concluída.', 409)`) **e** `isActionCard(card)` (senão `RetroError('Após concluir, só action cards podem ser editados.', 409)`); **pular** a checagem "só o autor edita"; ao gravar, setar `editedById = userId`, `editedAt = new Date()`; chamar `logEdit(...)`.
  - O `upsertActionCard` existente continua rodando ao final (ressincroniza o espelho).
- **`logEdit(roomId, editorId, action, detail)`** → `prisma.retroEdit.create(...)`. Chamado só no caminho pós-conclusão.
- **`listEdits(roomId, viewer)`** → carrega a sala, valida acesso com `resolveRole` (null → 404), retorna `prisma.retroEdit.findMany({ where: { roomId }, include: { editor: true }, orderBy: { createdAt: 'desc' } })`.
- Demais mutações (`createCard`/`updateCardPosition`/`deleteCard`/`addVote`/`removeVote`/`toggleReaction`/`setParticipants`/`setAnonymous`/`advancePhase`) **inalteradas** — seguem 409 quando concluída.

### Serialize (`src/lib/serialize.ts`)
- `toRetroCardDTO`: incluir `editedBy: card.editedBy ? { id, name } : null` e `editedAt`. (O include do card precisa de `editedBy`; ver abaixo.)
- `toRetroEditDTO(edit)` → `{ id, editor: { id, name }, action, detail, createdAt: ISO }`.
- `retroRoomInclude.cards` e `loadCard` passam a incluir `editedBy: true` (além de `author`, `votes`, `reactions`).

### Rotas (`src/routes/retro.ts`)
- `PATCH /retro/rooms/:id/cards/:cardId` (updateCard): passar `role: request.user.role` ao service.
- `GET /retro/rooms/:id/edits` — `authenticate`; `listEdits`; responde `{ edits: edits.map(toRetroEditDTO) }`.
- Após uma edição pós-conclusão bem-sucedida, `retroHub.broadcast(id, () => ({ type: 'edits.changed' }))` (além do `card.updated` já existente).
- Erros via `instanceof RetroError`.

## Contrato (`packages/shared/src/retro.ts`)
```ts
export interface RetroEditDTO {
  id: string
  editor: { id: string; name: string }
  action: string
  detail: string | null
  createdAt: string
}
```
- `RetroCardDTO` ganha `editedBy: { id: string; name: string } | null` e `editedAt: string | null`.
- `RetroEvent` ganha `| { type: 'edits.changed' }`.

## Frontend (`apps/web`)
- **`retro-api.ts`**: `getRetroEdits(roomId)` → `GET /retro/rooms/:id/edits`.
- **`useRetroSocket.ts`**: em `edits.changed`, invalidar `['retro-edits', roomId]` (e a sala, para refletir o carimbo no card — `card.updated` já chega, mas invalidar a sala é seguro).
- **`RetroRoomPage.tsx`**:
  - `canEditConcludedActions = room.status === 'CONCLUDED' && user?.role === 'LEAD'`.
  - `editM` (updateCard) já existe e passa a funcionar para card alheio (o servidor autoriza). Habilitar a interação de edição/`actionForm` num **action card** quando `canEditConcludedActions` — mesmo sem `card.mine`.
  - Nada de toolbar/pads/voto/participantes/anônimo nesse modo (já gated por `canWrite`/`status==='OPEN'`).
  - Botão no header **"Histórico (N)"** quando há edits; abre o painel.
- **`PostIt.tsx`**: aceitar edição quando o card for action card e o modo concluído-LEAD estiver ativo; exibir **"editado por X em DD/MM"** quando `card.editedBy`.
- **Novo `Audit/EditHistoryPanel.tsx`** (drawer estilo `ParticipantsPanel`): lista `RetroEditDTO[]` ("X editou — {detail} — DD/MM HH:mm").

## Testes
- **API** (Postgres real):
  - LEAD (não-criador, não-participante) edita um action card de sala CONCLUÍDA → 200; grava `editedById`/`editedAt`; cria `RetroEdit`.
  - LEAD tentando editar card **não-ação** em sala concluída → 409; outras mutações (createCard/vote/etc.) em sala concluída por LEAD → 409.
  - DEV/participante comum editando em sala concluída → 409.
  - Em sala OPEN, `updateCard` mantém autor-only (não-autor → 403) e não grava `editedBy`.
  - `GET /retro/rooms/:id/edits` retorna em ordem desc; acesso negado a quem não enxerga a sala (404).
  - Serialize: `editedBy`/`editedAt` no card; `toRetroEditDTO`.
- **Web** (jsdom):
  - `canEditConcludedActions`: action card editável por LEAD não-autor em sala concluída; carimbo "editado por X".
  - Painel "Histórico de edições" lista entradas.

## Fora de escopo (YAGNI)
- Reabrir sala (CONCLUDED→OPEN).
- Editar cards comuns, criar/mover/excluir, votos, reações, participantes, modo anônimo após concluir.
- Resetar `actionDone`/`auditStatus` quando o responsável/plano é alterado (mantém o estado atual).
- Diff campo-a-campo no log (basta `detail` com um resumo).
