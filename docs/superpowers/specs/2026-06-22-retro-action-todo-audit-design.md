# Design — Ações de retro no perfil (To-Do) + auditoria na retro seguinte

Data: 2026-06-22
Branch: `feat/retro-board`
Depende de: cards de ação já existentes (`actionPlan`/`actionResponsible`/`actionDueDate`
no `RetroCard`, gerados por `upsertActionCard`) e do modelo M:N sala↔squad
(`2026-06-20-retro-multi-squad-design.md`).

## Problema

Ao concluir uma retrospectiva, as **ações** definidas (plano + responsável + prazo)
não têm continuidade fora do board. Queremos duas coisas:

1. **To-Do no perfil**: cada ação cujo `actionResponsible` é um usuário aparece no
   **perfil dele**, numa seção "Ações" em formato de to-do list (plano + prazo),
   marcável como concluída.
2. **Auditoria entre retros**: as ações **marcadas como concluídas** devem ser
   validadas na **retrospectiva imediatamente posterior da mesma squad** — um painel
   "Auditoria" na sala lista essas ações para o facilitador **validar ou reprovar**.

## Decisões tomadas

- **Fonte da ação** = o **card de origem** (regiões `went_bad`/`start`/`stop`) com os 3
  campos preenchidos — não o card-espelho da região "Ações". `actionResponsible` guarda
  o **id do usuário**.
- **"Aparecer ao concluir"** = filtro em tempo de leitura (`room.status = CONCLUDED`).
  Não há etapa de extração no `advancePhase` — surge naturalmente. (Abordagem A.)
- **Conclusão persistida**: novos campos `actionDone` + `actionDoneAt` no `RetroCard`.
  Só o **próprio responsável** marca/desmarca. **Alterar o `done` limpa o veredito de
  auditoria** (a ação volta a ser re-auditável).
- **Concluídas continuam visíveis** no to-do, riscadas, ordenadas ao fim (pendentes
  primeiro, depois por prazo asc; concluídas por `actionDoneAt` desc).
- **Visibilidade do To-Do**: a seção aparece para **qualquer** visitante do perfil; o
  **checkbox só é interativo no próprio perfil** (backend valida o dono de qualquer forma).
- **Sala de auditoria** = primeira sala **CONCLUÍDA que compartilha ≥1 squad** com a sala
  atual e foi concluída **antes** dela (maior `concludedAt` com `concludedAt < createdAt`
  da sala atual). Relação calculada — sem coluna nova de "próxima sala".
- **Painel "Auditoria" calculado** (não cria cards no board, não acopla à criação da sala):
  endpoint próprio, fora do serialize quente do room.
- **Validação registrada**: `auditStatus` (`VALIDATED`/`REJECTED`) + `auditedById` +
  `auditedAt`, **só pelo facilitador da sala que audita**. **Reprovar reabre** a ação
  (`actionDone=false`, `actionDoneAt=null`) → reaparece pendente no perfil do responsável.
- O painel de auditoria lista **apenas ações concluídas** (`actionDone=true`) da sala
  anterior. (Ações pendentes não entram no painel — ficam só no perfil.)
- Sem retrocompatibilidade de dados (banco pode resetar; sem dados de produção).

## Backend (`apps/api`)

### Prisma (`prisma/schema.prisma`) — uma migração nova
`RetroCard` ganha:
```prisma
actionDone    Boolean   @default(false)
actionDoneAt  DateTime?
auditStatus   String?            // null | "VALIDATED" | "REJECTED"
auditedById   String?
auditedAt     DateTime?
auditedBy     User?     @relation("RetroActionsAudited", fields: [auditedById], references: [id])

@@index([actionResponsible])
```
`User` ganha a relação inversa `auditedActions RetroCard[] @relation("RetroActionsAudited")`.
Gerar com `pnpm db:migrate` (não editar migrações aplicadas).

### Service (`src/services/`)
- **`profile-service.listUserActions(userId)`** — cards com `actionResponsible = userId`,
  `room.status = CONCLUDED`, `actionPlan`/`actionDueDate` não nulos; inclui `room {id,sprint}`.
  Ordena: pendentes primeiro, depois `actionDueDate` asc; concluídas ao fim por
  `actionDoneAt` desc.
- **`retro-service.setActionDone({ cardId, userId, done })`** — `loadCard`; 403 se
  `card.actionResponsible !== userId`; 400/404 se não for ação válida (faltam campos).
  Grava `actionDone`/`actionDoneAt` (set/limpa) e **zera** `auditStatus/auditedById/auditedAt`.
- **`retro-service.findAuditSourceRoom(room)`** — entre salas `CONCLUDED` que
  compartilham ≥1 squad com `room` e têm `concludedAt < room.createdAt`, retorna a de
  maior `concludedAt` (ou `null`).
- **`retro-service.listAudit(roomId, viewer)`** — resolve a sala anterior via
  `findAuditSourceRoom`; retorna `{ sourceRoom: {id,sprint} | null, items }` onde `items`
  são as ações da sala anterior com `actionDone=true` (inclui `author` para o responsável).
  Acesso: participante/observador da sala atual (mesma regra de `getRoomForViewer`).
- **`retro-service.setAudit({ roomId, cardId, userId, verdict })`** — 403 se `userId` não
  é `createdById` da sala atual (facilitador); valida que `cardId` está no conjunto
  auditável dessa sala (pertence à `findAuditSourceRoom` e `actionDone=true`) senão
  404/409; grava `auditStatus/auditedById/auditedAt`; se `REJECTED` → `actionDone=false`,
  `actionDoneAt=null`.

### Serialize (`src/lib/serialize.ts`)
- `toRetroActionItemDTO(card)` → `{ id, plan, dueDate, done, doneAt, sprint, roomId, auditStatus }`
  (`dueDate` cru `YYYY-MM-DD`; `doneAt`/datas em ISO).
- `toRetroAuditItemDTO(card)` → `{ id, plan, dueDate, doneAt, responsible: RetroCardAuthor,
  auditStatus, auditedAt }` (reusa o shape de avatar já adicionado ao autor do card).

### Rotas (`src/routes/`)
- `profile.ts` — `GET /users/:id/profile` anexa `actions: listUserActions(id)`.
- `retro.ts`:
  - `PATCH /retro/actions/:cardId` — Zod `{ done: boolean }`, `authenticate`; `setActionDone`;
    responde `{ action: toRetroActionItemDTO(card) }`.
  - `GET /retro/rooms/:id/audit` — `authenticate`; `listAudit`; responde
    `{ sourceRoom, items: items.map(toRetroAuditItemDTO) }`.
  - `POST /retro/rooms/:id/audit/:cardId` — Zod `{ verdict: 'VALIDATED' | 'REJECTED' }`,
    `authenticate`; `setAudit`; `retroHub.broadcast(roomId, () => ({ type: 'audit.changed' }))`;
    responde `{ item: toRetroAuditItemDTO(card) }`.
  - Erros via `instanceof RetroError` (padrão atual).

## Contrato (`packages/shared/src/`)
`retro.ts`:
```ts
export interface RetroActionItemDTO {
  id: string
  plan: string
  dueDate: string            // YYYY-MM-DD
  done: boolean
  doneAt: string | null      // ISO
  sprint: number
  roomId: string
  auditStatus: 'VALIDATED' | 'REJECTED' | null
}
export interface RetroAuditItemDTO {
  id: string
  plan: string
  dueDate: string
  doneAt: string | null
  responsible: RetroCardAuthor | null
  auditStatus: 'VALIDATED' | 'REJECTED' | null
  auditedAt: string | null
}
```
- `RetroEvent` ganha `| { type: 'audit.changed' }`.
- `profile.ts`: `ProfileDTO` ganha `actions: RetroActionItemDTO[]`.

## Frontend (`apps/web`)
- **`retro-api.ts`**: `toggleRetroAction(cardId, done)` (PATCH), `getRetroAudit(roomId)`
  (GET), `setRetroAudit(roomId, cardId, verdict)` (POST).
- **`ProfilePage.tsx`** — nova seção **"Ações"** (padrão `rounded-xl border
  border-outline-variant/40 bg-surface-container p-lg`), renderiza só se `actions.length > 0`.
  Cada item: checkbox (interativo só quando `auth.user.id === profile.user.id`), plano,
  prazo formatado pt-BR, sprint linkando `/retrospectivas/:roomId`, marcador **"Atrasada"**
  (pendente e `dueDate < hoje`), texto riscado quando `done`, badge **Validada/Reprovada**
  quando `auditStatus` setado. Mutação chama `toggleRetroAction` e invalida `['profile', id]`.
- **`RetroRoomPage.tsx`** — painel **"Auditoria"** (render só se `items.length > 0`), via
  `useQuery(['retro-audit', roomId])`. Lista responsável (avatar+nome), plano, prazo, data
  de conclusão e status. Facilitador (`room.myRole === 'FACILITATOR'`) vê **Validar /
  Reprovar**; demais veem só o status. Invalida a query em `audit.changed` (em
  `useRetroSocket`). Estilo coerente com o board/tema atual.

## Testes
- **API** (`*.test.ts`, Postgres real):
  - `profile`: retorna `actions` só de sala `CONCLUDED` (não `OPEN`); ordena pendentes
    antes de concluídas.
  - `retro-service`/rota `actions`: `setActionDone` só pelo responsável (403 p/ outro);
    set/clear de `actionDone`/`actionDoneAt`; alterar `done` zera veredito.
  - `audit`: `listAudit` resolve a **sala anterior da mesma squad** e lista só
    `actionDone=true`; ignora salas de outra squad e a própria sala; `setAudit` só pelo
    facilitador (403); `REJECTED` reabre a ação (volta pendente no perfil); `VALIDATED`
    grava status/quem/quando.
  - `serialize`: `toRetroActionItemDTO`/`toRetroAuditItemDTO`.
- **Web** (`jsdom`):
  - `ProfilePage`: seção "Ações" renderiza; checkbox bloqueado fora do próprio perfil;
    risca ao concluir; badge de veredito.
  - `RetroRoomPage`: painel "Auditoria" lista itens; botões Validar/Reprovar só p/ facilitador.

## Fora de escopo (YAGNI)
- Tabela própria de tarefas / materialização no conclude.
- Notificações ao responsável.
- Refletir `actionDone`/veredito no card-espelho do board.
- Auditar ações **não** concluídas (carry-over de pendências).
