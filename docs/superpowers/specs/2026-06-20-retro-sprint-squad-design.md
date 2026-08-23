# Design — Retro por Sprint + Squad (com Squad como entidade)

Data: 2026-06-20
Branch: `feat/retro-board`

## Problema

Hoje a sala de retrospectiva tem **título livre** (`title: String`, max 120) e a
listagem é um grid plano de cards. Queremos:

1. Na **criação**, trocar o título livre por **sprint** (numérico) + **squad**
   (selecionável). Título passa a ser **derivado**: `Retrospectiva Sprint X - Squad Y`.
2. **Squad vira entidade** (mutável: surgem, são extintas, mudam de nome), gerenciada
   por ADMIN. Integrantes são vinculados a squads; ao criar a sala, os integrantes da
   squad são puxados automaticamente como participantes (com poder de adicionar/remover).
3. Na **listagem**, agrupar por **sprint** (drill-down em duas telas): Tela 1 lista as
   sprints; clicar numa sprint leva às salas daquela sprint (uma por squad).

## Decisões tomadas

- **Sem retrocompatibilidade.** Salas atuais são dados de teste; o banco pode ser limpo.
  `sprint` e `squad` obrigatórios; sem backfill.
- **Squad é entidade** no banco (tabela `Squad`), **gerenciada por ADMIN** no painel admin.
  Retro (LEAD) apenas **consome** a lista de squads ativas.
- **Operações de squad (v1):** criar, renomear, desativar. **Sem fundir.**
- **Vínculo integrante↔squad é N:N** (tabela `SquadMember`), **sem limite de squads por
  integrante** — qualquer DEV/LEAD pode pertencer a várias; o admin distribui livremente.
  As únicas restrições (no service): **ADMIN não entra em squad** e **não duplicar o mesmo
  integrante na mesma squad**.
  > Histórico: a v1 limitava DEV a 1 squad; a regra foi removida porque PMs/designers (que
  > são role `DEV`) também participam de várias squads, e o role não distingue desenvolvedor
  > de PM. Decisão: deixar a cargo do admin.
- O campo atual `User.squad String?` (texto livre, rótulo org-level mostrado em
  perfil/time/busca) é **mantido como está** — não é tocado. O vínculo `SquadMember` é um
  conceito **novo e paralelo**, usado apenas pelo retro (puxar integrantes). Os dois
  coexistem; nenhuma tela existente de exibição de squad é alterada.
- **Listagem agrupada por SPRINT** (sprint é estável; squad é mutável), drill-down 2 telas.
- **Botão "Criar sala" nas duas telas;** na Tela 2 (de uma sprint) o modal abre com a
  **sprint** pré-preenchida.
- **`title` deixa de ser coluna** — derivado no serialize a partir de `sprint` + nome da squad.

## Squads iniciais (seed)

Estudar Mais, Estudar Melhor, Inovação, B2B, Sucesso do Cliente.

---

# Parte A — Squad como entidade (admin)

Implementada primeiro; a Parte B depende dela.

## Backend (`apps/api`)

### Prisma (`prisma/schema.prisma`)
```prisma
model Squad {
  id        String   @id @default(cuid())
  name      String   @unique
  slug      String   @unique
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  members   SquadMember[]
  rooms     RetroRoom[]      // ligado na Parte B
}

model SquadMember {
  id       String   @id @default(cuid())
  squadId  String
  userId   String
  joinedAt DateTime @default(now())

  squad Squad @relation(fields: [squadId], references: [id], onDelete: Cascade)
  user  User  @relation("SquadMemberships", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([squadId, userId])
  @@index([userId])
}
```
- `User`: **manter** `squad String?` intacto; apenas **adicionar** a relação inversa
  `squadMemberships SquadMember[] @relation("SquadMemberships")`.
- Migration nova via `pnpm db:migrate`. Atualizar `prisma/seed.ts` para criar as 5 squads
  (idempotente via `upsert` por `slug`). O `squad` texto dos usuários no seed permanece.

### Service (`src/services/squad-service.ts`, novo)
- Classe `SquadError extends Error` com `status` (padrão do `BadgeError`).
- `listSquads(opts?: { activeOnly?: boolean })` — ordenado por `name`.
- `createSquad({ name })` — gera `slug` (slugify), `name`/`slug` únicos
  (Prisma P2002 → 409 "Já existe uma squad com esse nome.").
- `updateSquad(id, { name?, active? })` — renomear (re-slugify) e/ou ativar/desativar.
  P2025 → 404.
- `addMember(squadId, userId)` — valida squad e usuário existentes/ativos.
  **Regra:** `ADMIN` → `SquadError(400)`; integrante já presente na **mesma** squad
  (P2002) → `SquadError(409)`. Sem limite de squads por integrante.
- `removeMember(squadId, userId)` — remove o vínculo (204).

### Rotas admin (`src/routes/admin.ts`, `adminOnly`)
- `GET  /admin/squads` → `{ squads: SquadWithMembersDTO[] }` (inclui membros).
- `POST /admin/squads` (`createSquadSchema { name: z.string().min(1) }`) → 201 `{ squad }`.
- `PATCH /admin/squads/:id` (`updateSquadSchema { name?: min(1), active?: boolean }`) → `{ squad }`.
- `POST /admin/squads/:id/members` (`{ userId: z.string() }`) → 201 `{ squad }` (com membros) ou erro.
- `DELETE /admin/squads/:id/members/:userId` → 204.
- Erros: `catch` de `SquadError` → `reply.code(err.status).send({ message })`; demais sobem.

### Serialize (`src/lib/serialize.ts`)
- `toSquadDTO(squad)` → `{ id, name, slug, active }`.
- `toSquadWithMembersDTO(squad + members)` → `SquadDTO & { members: { id, name }[] }`.

## Contrato (`packages/shared/src/squad.ts`, novo; export no `index.ts`)
```ts
export interface SquadDTO { id: string; name: string; slug: string; active: boolean }
export interface SquadMemberDTO { id: string; name: string }
export interface SquadWithMembersDTO extends SquadDTO { members: SquadMemberDTO[] }
export interface CreateSquadRequest { name: string }
export interface UpdateSquadRequest { name?: string; active?: boolean }
export interface AddSquadMemberRequest { userId: string }
```

## Frontend admin (`apps/web`)
- `pages/admin/TabBar.tsx`: adicionar `"squads"` ao `AdminTabId` e `{ id:'squads', label:'Squads' }`
  em `ADMIN_TABS`.
- `pages/admin/SquadsSection.tsx` (novo, espelha `CategoriesSection.tsx`):
  - Lista squads (`GET /admin/squads`) com badge ativo/inativo.
  - Form criar squad; renomear inline; toggle ativar/desativar (`PATCH`).
  - Por squad: lista de integrantes + adicionar (select de usuários) / remover.
    Exibe a mensagem de erro vinda do backend (ex.: integrante duplicado na mesma squad).
  - Mutations invalidam `['admin','squads']`.
- `pages/AdminPage.tsx`: render `<SquadsSection/>` no `activeTab === 'squads'`.
- Client: usar `apiFetch` direto (padrão das sections admin).

## Testes (Parte A)
- `routes/admin.test.ts` (ou arquivo dedicado): criar squad (201) / nome duplicado (409) /
  renomear / desativar; **membership**: integrante em 2ª squad → ok (201), ADMIN → 400,
  duplicado na mesma squad → 409; remover membro (204); não-admin → 403.

---

# Parte B — Retro consome squad

## Backend (`apps/api`)

### Prisma (`prisma/schema.prisma`)
- `RetroRoom`: **remover** `title String`; **adicionar** `sprint Int` e `squadId String` +
  relação `squad Squad @relation(fields:[squadId], references:[id])`. Índice `@@index([squadId])`.

### Contrato (`packages/shared/src/retro.ts`)
- `MIN_SPRINT = 1`, `MAX_SPRINT = 999`. **Remover** `MAX_ROOM_TITLE_LENGTH`.
- `CreateRetroRoomRequest`: `{ sprint, squadId, anonymous, votesPerParticipant, participantIds }`
  (remove `title`).
- `RetroRoomSummaryDTO` / `RetroRoomDTO`: adicionam `sprint: number` e
  `squad: { id: string; name: string }`; **mantêm** `title: string` (derivado).

### Route (`src/routes/retro.ts`)
- `createRoomSchema`: trocar `title` por
  `sprint: z.number().int().min(MIN_SPRINT).max(MAX_SPRINT)` e `squadId: z.string()`.
- `GET /retro/squads` (autenticada; LEAD acessa pela área retro) →
  `{ squads: SquadWithMembersDTO[] }` **apenas ativas**, para popular o form de criação
  (squads ativas + seus integrantes p/ pré-preencher participantes). Lê via `squad-service`.
- `GET /retro/rooms` inalterado (agrupamento por sprint é no front).

### Service (`src/services/retro-service.ts`)
- `createRoom`: recebe `sprint`/`squadId` em vez de `title`. Validar que a squad existe e
  está ativa (senão `VoteError`/`RetroError` 400/404). Persistir `sprint` + `squadId`.
  Remover asserção de tamanho de título. Demais validações inalteradas.
  Observação: a lista de participantes continua vindo do payload (`participantIds`); o
  **pré-preenchimento com os membros da squad é responsabilidade do front** — o back só
  persiste quem veio no payload (+ criador, como hoje).

### Serialize (`src/lib/serialize.ts`)
- `toRetroRoomSummaryDTO`: incluir `sprint`, `squad: { id, name }` e `title` derivado
  `Retrospectiva Sprint ${sprint} - Squad ${squad.name}`.
- `toRetroRoomDTO` herda o título derivado. As queries do service precisam `include: { squad: true }`.

## Frontend (`apps/web`)

### API client (`lib/retro-api.ts`)
- `listRetroSquads()` → `GET /retro/squads` (`{ squads: SquadWithMembersDTO[] }`).
- `createRetroRoom` tipa o novo `CreateRetroRoomRequest`.

### Form de criação (`CreateRoomModal` em `pages/RetrosPage.tsx`)
- Props: `defaultSprint?: number` (vindo da Tela 2).
- Remover input de título livre. Campos:
  - **Sprint:** `<input type="number" min={MIN_SPRINT}>` (label "Número da Sprint"),
    inicial = `defaultSprint` quando houver.
  - **Squad:** `<select>` de squads ativas (`listRetroSquads`), placeholder "Selecione a squad".
  - Ao escolher/trocar a squad, **pré-preenche os participantes** com os membros dela
    (`squad.members`); LEAD pode então adicionar/remover. Trocar de squad **re-seta** a
    seleção para os membros da nova squad (decisão: simplicidade > preservar adições manuais).
  - Anônimo, votos por participante e participantes seguem.
  - Preview do título montado abaixo dos campos.
  - Submit habilita com `sprint >= MIN_SPRINT` + `squadId` escolhido.
  - Envia `{ sprint, squadId, anonymous, votesPerParticipant, participantIds }`.

### Tela 1 — `/retrospectivas` (sprints)
- Substitui o grid de salas por **cards por sprint**: agrupa `listRetroRooms()` no cliente
  por `room.sprint` (desc), cada card mostra "Sprint N" + contagem de salas.
- Clicar navega para `/retrospectivas/sprint/:sprint`.
- Botão "Criar sala" abre o modal (sem sprint pré-preenchida).
- Estado vazio quando não há salas.

### Tela 2 — `/retrospectivas/sprint/:sprint` (salas da sprint)
- Nova rota em `App.tsx`, mesmo guard (`ProtectedRoute` + `DevOnly`).
- Lê `:sprint` da URL (number); lista as salas com `room.sprint === sprint`, reaproveitando
  o card de sala atual (status, anônimo, título derivado, criador, contagem de participantes,
  link p/ `/retrospectivas/:id`), cada uma exibindo sua **squad**.
- "Voltar" para a Tela 1.
- Botão "Criar sala" abre o modal com `defaultSprint` = a sprint da tela.

## Testes (Parte B)
- `routes/retro.test.ts`: ajustar payloads de criação para `sprint`/`squadId`; manter
  autorização (LEAD 201 / DEV 403) e validação (400 p/ sprint/squad inválidos, 404/400 p/
  squad inexistente/inativa). Atualizar o teste de workflow. Cobrir `GET /retro/squads`
  (só ativas).
- `packages/shared`: ajustar/!remover testes que referenciavam `MAX_ROOM_TITLE_LENGTH`.
- web: teste do `CreateRoomModal` (sprint+squad montam título; escolher squad pré-preenche
  participantes; submit habilita) e da agregação por sprint na Tela 1, se houver padrão de
  teste de página vizinha.
- Rodar `pnpm test` (com `pnpm db:up`) antes de concluir.

## Fora de escopo

- Fundir squads.
- Edição de sprint/squad de salas já criadas.
- Filtros/busca adicionais na listagem.
- Mudanças no board em si (cards, votos, regiões).
- Uso de squad fora do retro (ex.: exibir squad no perfil) — só a modelagem fica pronta.
