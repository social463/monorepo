# Design — Sala de retro com uma ou mais squads

Data: 2026-06-20
Branch: `feat/retro-board`
Depende de: `2026-06-20-retro-sprint-squad-design.md` (já implementado).

## Problema

Hoje uma sala de retrospectiva tem **exatamente uma** squad (`RetroRoom.squadId` FK).
Queremos permitir criar uma sala com **uma ou mais** squads (≥1). Ao criar, os
integrantes de **todas** as squads escolhidas são puxados como participantes (união),
e o título derivado lista as squads.

## Decisões tomadas

- **Vínculo sala↔squad vira M:N** (tabela de junção `RetroRoomSquad`). `RetroRoom`
  perde a coluna `squadId` e a relação `squad`.
- **≥1 squad obrigatória** ao criar a sala.
- **Título derivado** com plural condicional, nomes **ordenados alfabeticamente** (estável):
  - 1 squad: `Retrospectiva Sprint 23 - Squad Inovação`
  - 2+ squads: `Retrospectiva Sprint 23 - Squads B2B, Inovação`
- **Participantes**: ao escolher/alterar o conjunto de squads, a seleção é **re-setada**
  para a **união** dos membros de todas as squads marcadas (LEAD ainda adiciona/remove
  manualmente depois).
- **Card da Tela 2** mostra os nomes das squads (plural quando >1), **sem chips** — o
  card já exibe esse texto como cabeçalho; não duplicar.
- Sem retrocompatibilidade de dados (banco pode resetar; sem dados de produção).

## Backend (`apps/api`)

### Prisma (`prisma/schema.prisma`)
- `RetroRoom`: **remover** `squadId String` e `squad Squad @relation(...)` e o
  `@@index([squadId])`. **Adicionar** relação `squads RetroRoomSquad[]`.
- `Squad`: trocar `rooms RetroRoom[]` por `rooms RetroRoomSquad[]`.
- Novo model:
  ```prisma
  model RetroRoomSquad {
    id      String @id @default(cuid())
    roomId  String
    squadId String

    room  RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
    squad Squad     @relation(fields: [squadId], references: [id])

    @@unique([roomId, squadId])
    @@index([squadId])
  }
  ```
- Migration nova via `pnpm db:migrate` (aceitar reset se pedir). Re-seed.
- `test/setup.ts`: truncar `retroRoomSquad` **antes** de `retroRoom` e de `squad`.

### Contrato (`packages/shared/src/retro.ts`)
- `retroRoomTitle(sprint: number, squadNames: string[]): string`:
  - `squadNames.length <= 1` → `Retrospectiva Sprint ${sprint} - Squad ${names[0] ?? ''}`
  - senão → `Retrospectiva Sprint ${sprint} - Squads ${names.join(', ')}`
  - (o chamador passa os nomes já ordenados alfabeticamente)
- `RetroRoomSummaryDTO`: trocar `squad: { id; name }` por `squads: { id: string; name: string }[]`.
- `CreateRetroRoomRequest`: trocar `squadId: string` por `squadIds: string[]`.

### Service (`src/services/retro-service.ts`)
- `retroRoomInclude`: trocar `squad: true` por `squads: { include: { squad: true } }`.
- `createRoom(input: { creatorId, sprint, squadIds: string[], anonymous, votesPerParticipant, participantIds })`:
  - `const squadIds = [...new Set(input.squadIds)]`; se vazio → `RetroError('Selecione ao menos uma squad.', 400)`.
  - Buscar as squads (`findMany where id in squadIds`); se faltar alguma ou alguma
    `!active` → `RetroError('Squad inválida.', 400)`.
  - Criar a sala + `squads: { create: squadIds.map((squadId) => ({ squadId })) }` na
    mesma chamada `prisma.retroRoom.create`.
  - Demais validações (criador LEAD ativo, `assertSprint`, `assertVotes`,
    `assertInvitable`) inalteradas.

### Serialize (`src/lib/serialize.ts`)
- `toRetroRoomSummaryDTO`: derivar `const squads = room.squads.map((rs) => ({ id: rs.squad.id, name: rs.squad.name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))`;
  emitir `squads` e `title: retroRoomTitle(room.sprint, squads.map((s) => s.name))`.

### Rotas (`src/routes/retro.ts`)
- `createRoomSchema`: `squadIds: z.array(z.string()).min(1).max(50)` (no lugar de `squadId`).
- Notificações: continuar usando `retroRoomTitle`, agora com a lista de nomes derivada
  da sala criada (ordenada). Como `createRoom` retorna a sala com `squads` incluídas,
  montar os nomes ali (ou reusar a derivação do serialize — manter simples: derivar
  inline os nomes ordenados para o `title` da notificação).
- `GET /retro/squads` inalterado.

## Frontend (`apps/web`)

### API client (`lib/retro-api.ts`)
- `createRetroRoom` segue tipado por `CreateRetroRoomRequest` (agora com `squadIds`).

### Form de criação (`CreateRoomModal` em `pages/RetrosPage.tsx`)
- Squad deixa de ser `<select>` único e vira **multi-seleção** (checkboxes das squads
  ativas de `listRetroSquads`), estado `squadIds: string[]`.
- Ao alternar uma squad, recomputar `squadIds` e **re-setar** `selected` (participantes)
  para a **união** dos membros de todas as squads marcadas (dedup por id).
- Preview do título: `retroRoomTitle(sprint, nomesOrdenados)` a partir das squads marcadas.
- Submit habilita com `sprint >= MIN_SPRINT` **e** `squadIds.length >= 1`.
- Envia `{ sprint, squadIds, anonymous, votesPerParticipant, participantIds }`.

### Listagem (`pages/RetrosPage.tsx`)
- Tela 1 (por sprint) inalterada.
- `RoomCard` (Tela 2): trocar `room.squad.name` por os nomes de `room.squads`
  ordenados e unidos por `, ` (ex.: `B2B, Inovação`). Sem chips.

## Testes

- **API** (`routes/retro.test.ts`, `services/retro-service.test.ts` e os demais arquivos
  de teste de retro que criam sala): trocar todos os `squadId`→`squadIds: [..]`.
  Helper `mkSquad` mantém-se; criar 2 squads onde fizer sentido.
  - `createRoom` com 2 squads → título plural "Squads A, B" (nomes ordenados) e
    `squads.length === 2`.
  - `createRoom` com 1 squad → título singular "Squad A".
  - `squadIds` vazio → 400; squad inativa entre as escolhidas → 400.
  - `GET /retro/squads` inalterado.
- **shared**: `retroRoomTitle` com 0/1/2+ nomes (singular vs plural).
- **web**: `CreateRoomModal` — marcar 2 squads monta título plural e une participantes;
  `RetrosPage`/`RoomCard` — card lista as squads da sala.
- Rodar `pnpm test` (com `pnpm db:up`) antes de concluir.

## Fora de escopo

- Editar as squads de uma sala já criada.
- Agrupar a listagem por squad (continua por sprint).
- Mudanças no board, votos, regiões.
