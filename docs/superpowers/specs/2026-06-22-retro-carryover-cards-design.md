# Design — Carry-over de ações no quadrante "Ações" (validar + vencidas)

Data: 2026-06-22
Branch: `feat/retro-board`
Depende de: ações no perfil + auditoria (`2026-06-22-retro-action-todo-audit-design.md`) e
edição de action card em sala concluída (`2026-06-22-retro-lead-edit-concluded-design.md`).

## Problema

Hoje a validação de ações concluídas aparece como um **botão "Auditoria" no header** + painel
lateral, olhando só a **retro imediatamente anterior** da squad. Queremos:

1. Mostrar essas ações **dentro do quadrante "Ações"** da sala, como **cards de referência** com
   **cor distinta**, indicando que vêm de outras sprints e precisam de **validação** — destacando o **prazo**.
2. **Ações vencidas e não concluídas** (prazo passou) devem ser **carregadas** na sala da squad
   cuja data é **≥ prazo**, para visibilidade e definição de **novo prazo** (ou conclusão).

Removendo o botão/painel "Auditoria" do header.

## Decisões tomadas

- **Cards de referência calculados (read-only)**: não são `RetroCard` persistidos na sala atual; são
  derivados das ações de origem (em retros anteriores). Não movem/editam/excluem como card normal;
  só oferecem as ações abaixo. Sempre refletem a origem, sem duplicar dado.
- **Duas categorias** (cores distintas):
  - **A validar** (`type: 'validate'`): ação `actionDone=true` e `auditStatus` nulo. Cor própria
    (ex.: roxo). Mostra o prazo.
  - **Vencida** (`type: 'overdue'`): ação `actionDone=false` e `actionDueDate ≤ data da sala atual`.
    Cor própria (ex.: vermelho/laranja forte). Mostra "venceu em DD/MM".
- **Escopo**: ações das retros **CONCLUÍDAS anteriores que compartilham ≥1 squad** com a sala atual
  (`concludedAt < sala.createdAt`, `id != sala.id`). **Toda a história da squad**, não só a anterior.
- **"Até ser resolvida"** sai de graça do cálculo por estado: validar/reprovar tira de *a validar*;
  concluir tira de *vencida* e passa a *a validar* na próxima; novo prazo no futuro tira de *vencida*.
- **Quem age** nos cards de carry-over: **qualquer usuário LEAD** (`role === 'LEAD'`), consistente com
  a edição de action card em sala concluída. Demais papéis (DEV/observador) só visualizam.
- **Ações disponíveis**: `validate` / `reject` (a validar) e `reschedule` (novo prazo) / `done`
  (concluir) (vencida).
- **Reaproveita** a edição já existente da origem: gravar na origem re-sincroniza o card-espelho dela
  e reflete no perfil/auditoria.
- **Substitui** o endpoint/painel de auditoria atual (`/audit`, `AuditPanel`, botão no header).
- Sem retrocompatibilidade de dados (banco pode resetar; sem dados de produção).

## Backend (`apps/api`)

### Service (`src/services/retro-service.ts`)
Substituir a dupla `findAuditSourceRoom`/`listAudit` por um cálculo baseado em estado:

- **`listCarryover(roomId, viewer)`**:
  - `loadRoom` + `resolveRole` (null → 404).
  - `squadIds = room.squads.map(s => s.squadId)`; se vazio → `{ toValidate: [], overdue: [] }`.
  - Salas-fonte: `prisma.retroRoom.findMany({ where: { id: { not: room.id }, status: 'CONCLUDED', concludedAt: { lt: room.createdAt }, squads: { some: { squadId: { in: squadIds } } } } })` → ids.
  - Ações: `prisma.retroCard.findMany({ where: { roomId: { in: sourceIds }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } }, include: { author: true } })`.
  - `roomDate = room.createdAt.toISOString().slice(0,10)`.
  - Classifica:
    - **toValidate**: `actionDone === true && auditStatus == null`.
    - **overdue**: `actionDone === false && actionDueDate <= roomDate`.
    - (demais ignoradas: pendentes não-vencidas ficam só no perfil; validadas somem.)
  - Resolve `responsible` por `actionResponsible` (um `findMany` + map; sem N+1).
  - Ordena toValidate por `actionDoneAt desc`; overdue por `actionDueDate asc` (mais antiga primeiro).
  - Retorna `{ toValidate: { card, responsible }[], overdue: { card, responsible }[], sourceSprints }`.

- **`setCarryover(input: { roomId, cardId, userId, role, action: 'validate'|'reject'|'reschedule'|'done', dueDate?: string })`**:
  - `loadRoom`; `resolveRole` null → 404 (precisa enxergar a sala); 403 se `role !== 'LEAD'`.
  - Resolve o conjunto auditável: a ação (`cardId`) deve pertencer a uma sala-fonte da sala atual
    (mesma regra de `listCarryover`) e ter os 3 campos; senão 404/409.
  - Aplica:
    - `validate`: `auditStatus='VALIDATED'`, `auditedById=userId`, `auditedAt=now`.
    - `reject`: `auditStatus='REJECTED'`, `auditedById=userId`, `auditedAt=now`, `actionDone=false`, `actionDoneAt=null`.
    - `reschedule`: exige `dueDate` (AAAA-MM-DD válido); grava `actionDueDate=dueDate`. Re-sincroniza
      o card-espelho da origem (`upsertActionCard`).
    - `done`: `actionDone=true`, `actionDoneAt=now`.
  - Quando muda campos da ação (`reschedule`), chama `upsertActionCard(sourceRoom, updatedCard)` para
    refletir no espelho da origem.
  - Retorna a ação atualizada + responsável.

> `setActionDone` (perfil) e a edição de action card seguem como estão; o carry-over apenas adiciona
> um caminho de resolução pelo facilitador na sala seguinte.

### Serialize (`src/lib/serialize.ts`)
- `toRetroCarryoverItemDTO(card, responsible, type)` → `RetroCarryoverItemDTO`.
- Remover `toRetroAuditItemDTO` (ou mantê-lo só se ainda referenciado; o plano removerá os usos).

### Rotas (`src/routes/retro.ts`)
- Substituir `GET /retro/rooms/:id/audit` por **`GET /retro/rooms/:id/carryover`** →
  `{ toValidate: RetroCarryoverItemDTO[], overdue: RetroCarryoverItemDTO[] }`.
- Substituir `POST /retro/rooms/:id/audit/:cardId` por **`POST /retro/rooms/:id/carryover/:cardId`**
  (Zod: `{ action: z.enum(['validate','reject','reschedule','done']), dueDate: z.string().optional() }`,
  com refine: `dueDate` obrigatório quando `action==='reschedule'`). Após sucesso,
  `retroHub.broadcast(id, () => ({ type: 'carryover.changed' }))`.
- Erros via `instanceof RetroError`.

## Contrato (`packages/shared/src/retro.ts`)
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
- `RetroEvent`: remover `audit.changed`; adicionar `{ type: 'carryover.changed' }`.
- Remover `RetroAuditItemDTO` (e seus usos).

## Frontend (`apps/web`)
- **`retro-api.ts`**: remover `getRetroAudit`/`setRetroAudit`; adicionar `getRetroCarryover(roomId)` e
  `setRetroCarryover(roomId, cardId, action, dueDate?)`.
- **`useRetroSocket.ts`**: trocar invalidação de `audit.changed`→`['retro-audit']` por
  `carryover.changed`→`['retro-carryover', roomId]`.
- **`RetroRoomPage.tsx`**: remover estado/painel/botão de auditoria. Adicionar
  `carryoverQuery (['retro-carryover', id])` e `carryoverM`. Renderizar **cards virtuais** na região
  "Ações":
  - posicionados numa sub-faixa própria do quadrante "Ações" (abaixo das ações da sala), em grade,
    sem sobrepor as ações reais;
  - **read-only** (não entram em `room.cards`, não arrastam/editam);
  - cor por `type` (validate vs overdue) + rótulo ("A validar" / "Vencida — venceu em DD/MM") e o
    responsável + sprint de origem;
  - se `user?.role === 'LEAD'`: botões inline — **Validar/Reprovar** (validate) e **Novo prazo (data)/Concluir**
    (overdue). Caso contrário, só leitura.
  - invalida `['retro-carryover', id]` em `carryover.changed` e após `carryoverM`.
- **Novo componente** `CarryoverCard.tsx` (ou similar) para o card virtual; `ColorPalette.tsx` ganha as
  cores `validate`/`overdue`.
- **Remover** `AuditPanel.tsx`.

## Testes
- **API**:
  - `listCarryover` classifica certo: concluída-não-validada → toValidate; não-concluída com
    `actionDueDate ≤ data da sala` → overdue; pendente futura → não aparece; validada → não aparece;
    só salas da mesma squad e anteriores.
  - `setCarryover`: cada ação só por LEAD (403 p/ DEV; 404 p/ quem não enxerga a sala); `validate`/`reject` (reabre);
    `reschedule` muda prazo e re-sincroniza espelho e tira de overdue; `done` marca concluída
    (vira toValidate); valida pertencimento (404/409).
  - serialize de `RetroCarryoverItemDTO`.
- **Web**:
  - cards virtuais nas duas cores no quadrante Ações; botões só p/ LEAD; ações chamam a API certa.
  - sem render do `AuditPanel`/botão antigo.

## Fora de escopo (YAGNI)
- Notificar o responsável sobre ação vencida.
- Histórico/auditoria de reschedules.
- Carry-over para ações sem responsável/prazo (precisam dos 3 campos).
- Configurar cores por usuário.
