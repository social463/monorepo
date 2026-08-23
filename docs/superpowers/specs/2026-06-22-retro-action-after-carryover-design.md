# Design — Cards de ação novos logo na sequência dos cards carregados (carry-over)

Data: 2026-06-22
Branch: `feat/retro-board`
Depende de: `2026-06-22-retro-carryover-top-layout-design.md` (implementado — carry-over fixo no topo + faixa reservada).

## Problema

Hoje o `upsertActionCard` reserva uma **faixa fixa de 2 linhas** (`RESERVED_TOP = 2 * 240 = 480px`)
no topo da região "Ações" para os cards de carry-over, e posiciona os cards-espelho (ações novas
da própria sala) **abaixo** dessa faixa. Quando há poucos cards carregados (ex.: 1), sobra um buraco:
a primeira ação nova aparece longe, na 3ª linha, em vez de logo após o card carregado.

Queremos: os cards de ação novos começam **logo na sequência** dos cards carregados (carry-over),
sem buraco — preenchendo a mesma grade, contíguos.

## Decisões tomadas

- **Offset dinâmico em vez de faixa fixa**: o novo card-espelho é posicionado no slot
  `carryoverCount + actionCount`, onde `carryoverCount` é a quantidade real de itens de carry-over
  da sala (overdue + toValidate) e `actionCount` é a quantidade de cards-espelho já existentes na
  região "Ações" desta sala.
- **Grade única de 240px** (a mesma que o frontend já usa para o carry-over no topo), para que
  carregados e ações novas formem uma sequência contígua. Substitui o passo de 220px usado antes
  só pelos espelhos.
- **Contíguo, não bloco-em-nova-linha**: preenche a mesma linha logo após o último carregado
  (ex.: 1 carregado → 1ª ação nova ao lado, no slot 1).
- **Snapshot no momento da criação**: `carryoverCount` é lido quando o espelho é criado. Se surgir
  carry-over novo depois (prazo vence), pode encostar num espelho já posicionado — aceitável, os
  cards são arrastáveis (mesma ressalva do comportamento atual).
- **Só backend**: o frontend já desenha o carry-over no topo nessa grade (240px) e os espelhos onde
  estão persistidos. Nenhuma mudança no frontend, no contrato ou no schema.

## Backend (`apps/api/src/services/retro-service.ts` — `upsertActionCard`)

- **Remover** `RESERVED_TOP`.
- **Contar** os itens de carry-over da sala sem rodar o `listCarryover` completo (que resolve
  acesso e nomes de responsáveis). Extrair um helper interno que reusa `priorConcludedSquadRooms`
  e os mesmos filtros de classificação (overdue + toValidate) e retorna só o total:

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

  As regras de `toValidate`/`overdue` são as mesmas de `listCarryover` (linhas atuais 548-551),
  então a contagem casa com o que o frontend renderiza no topo.

- **Posicionar** o novo espelho no slot contíguo, grade de 240:

  ```ts
  const actions = RETRO_REGIONS.find((r) => r.id === 'actions')
  const actionCount = await prisma.retroCard.count({ where: { roomId: room.id, x: { gte: actions?.x ?? 0 } } })
  const slot = (await countCarryover(room)) + actionCount
  const x = (actions?.x ?? 2320) + 40 + (slot % 4) * 240
  const y = (actions?.y ?? 280) + 80 + Math.floor(slot / 4) * 240
  ```

- Espelhos já existentes mantêm a posição persistida (usuário arrasta se quiser reorganizar).

## Testes

- **API** (`apps/api/src/services/retro-card-service.test.ts`): com **1** ação de carry-over válida
  (sala da mesma squad concluída antes, com `actionDueDate <= createdAt` da sala atual e responsável),
  ao criar um card de ação na sala atual, o espelho gerado fica no slot 1:
  `x === 2360 + 240` (= 2600) e `y === 360`. Modelar o setup nos testes de carry-over existentes
  (`apps/api/src/services/retro-carryover.test.ts`).
- Conferir que o caso **sem** carry-over volta a `slot 0` → `x === 2360`, `y === 360` (atualizar o
  teste da faixa reservada criado no run anterior, que hoje espera `y === 840`).

## Fora de escopo (YAGNI)

- Reposicionar espelhos já criados quando o `carryoverCount` muda.
- Contar carry-over por viewer (a lista é global; só o acesso depende do viewer).
- Mudança de passo/coluna no frontend (já está em 240).
