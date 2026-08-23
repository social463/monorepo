# Multi-tenancy em Retro — sub-fatia 1: dados + services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer os 7 models de Retro (`RetroRoom`, `RetroRoomSquad`, `RetroParticipant`,
`RetroCard`, `RetroVote`, `RetroReaction`, `RetroEdit`) pro escopo de multi-tenancy, fechando o
vazamento mais severo remanescente da linha de trabalho (PR #10609): `listRoomsForUser`/
`listRoomsForAdmin` hoje devolvem salas de **qualquer** empresa pra qualquer líder/admin,
incluindo conteúdo de card e identidade de participante.

**Architecture:** Migration adiciona `companyId String @default("company-emr")` aos 7 models
(mesmo padrão aditivo de todas as fatias anteriores — `ADD COLUMN ... NOT NULL DEFAULT` já é um
backfill real: popula toda linha existente com o valor correto, já que hoje só existe uma
empresa). `RetroRoom.companyId` é a fonte da verdade, gravado a partir do `companyId` explícito
que o chamador passa (mesmo padrão self-service de `request.user.companyId` usado em toda a
linha — não é relido do `creator` no banco). As ~25 funções exportadas de `retro-service.ts`
ganham `companyId` e passam a usar `scopedPrisma(companyId)` para carregar
`RetroRoom`/`RetroCard`; os privados que já recebem uma `room`/`card` carregada (com `companyId`
no próprio objeto, já que agora é uma coluna do model) reusam `room.companyId` em vez de ganhar
um parâmetro novo — reduz plumbing sem perder isolamento, ver Global Constraints.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest.

## Global Constraints

- Base: branch `feat/multi-empresa-auth-jwt-clean` (PR #10609) — mesma onde as fatias anteriores
  de multi-tenancy foram commitadas. Trabalhar em worktree isolado.
- **Antes de rodar `prisma migrate dev` ou qualquer comando que grave no Postgres, confirme que
  `apps/api/.env`'s `DATABASE_URL` é `postgresql://legends:legends@localhost:5432/legends?schema=public`
  (Postgres local). Se for qualquer outra coisa, pare e reporte BLOCKED sem executar nada.**
- **Decisão de design (privados que recebem `room`/`card` já carregados não ganham parâmetro
  `companyId` novo):** `upsertActionCard`, `countCarryover` e `priorConcludedSquadRooms` recebem
  hoje um `room: RetroRoomWithRelations` (ou subconjunto seu) já carregado por um `loadRoom`
  escopado. Como `RetroRoom` ganha a coluna `companyId` nesta fatia, `room.companyId` já está
  disponível ali dentro — usar `scopedPrisma(room.companyId)` internamente é equivalente a
  receber `companyId` como parâmetro extra, sem repetir plumbing. Já `resolveResponsibleName` e
  `assertResponsible` **ganham** `companyId` como parâmetro explícito (não recebem `room`/`card`,
  só um id solto) — o chamador passa `room.companyId` ou `input.companyId` conforme disponível.
- **Decisão de design (gap adjacente de squad cross-empresa fecha "de graça" via `scopedPrisma`):**
  a spec pede uma validação explícita "toda squad anexada precisa ter `squad.companyId ===
  room.companyId`, rejeitada com erro de domínio". Como `createRoom`/`updateRoomAsAdmin` já
  carregam as squads com `prisma.squad.findMany({ where: { id: { in: squadIds } } })` e comparam
  `squads.length !== squadIds.length` pra rejeitar squad inativa/inexistente, trocar esse client
  por `scopedPrisma(companyId).squad.findMany(...)` já filtra squads de outra empresa pra fora do
  resultado — o `squads.length !== squadIds.length` existente já dispara `RetroError('Squad
  inválida.', 400)` sem nenhum código novo. Mesmo raciocínio aplicado a `assertInvitable`
  (participantes) — não estava listado explicitamente na spec, mas é o mesmo gap (convidar
  usuário de outra empresa) e a mesma correção mecânica; documentado aqui como decisão de
  julgamento seguindo o espírito da spec.
- **Nenhum `upsert` encontrado em `retro-service.ts`** — todas as escritas já são `create`/
  `update`/`delete`/`createMany`/`deleteMany` explícitos, então a restrição de `scopedPrisma` (não
  suporta `upsert`) não exige nenhuma refatoração nesta fatia.
- **Nested writes (`squads: { create: ... } }`, `participants: { create: ... } }` dentro de
  `retroRoom.create`) continuam confiando no `@default("company-emr")` do schema** para a
  `companyId` da linha filha — a extensão de `scopedPrisma` só intercepta operações de
  **top-level** (`$allOperations` por model/operação invocada diretamente), não escritas
  aninhadas dentro do `data` de outro model. Isso é a mesma limitação já aceita em
  `createReview`/`createComment` (menções aninhadas) nas fatias anteriores — não é regressão
  nova, é o padrão estabelecido, correto enquanto existir uma empresa só.
- Para as 2 operações que **hoje** usam `prisma.$transaction` (`updateRoomAsAdmin`, com callback
  interativo; `setParticipants`, com array de promises), trocar para
  `scopedPrisma(companyId).$transaction(...)` — o cliente estendido do Prisma propaga a extensão
  pro `tx` de transações interativas, e uma transação em array só precisa que cada promise já
  tenha sido construída a partir do cliente estendido (o que ela será, pois construímos as
  chamadas com `db = scopedPrisma(companyId)` antes de montar o array).
- **Handoff problem:** `createRoom` é usada como fixture em **3 arquivos de teste** que chamam
  `retro-service.ts` diretamente fora de rota — `retro-service.test.ts`, `retro-card-service.test.ts`
  (via helper `room()`), `retro-vote-service.test.ts` (via helper `openRoomWithCard()`). `createCard`
  também aparece em `retro-service.test.ts` (describe de auditoria) além dos outros dois. Cada task
  que muda a assinatura de uma função precisa atualizar **todo** call-site nos **3 arquivos**, não só
  no describe mais óbvio — documentado explicitamente em cada task abaixo.
- Nenhuma rota muda de assinatura de request/response nesta sub-fatia — `apps/api/src/routes/retro.ts`,
  o trecho de retro em `apps/api/src/routes/admin.ts`, `apps/api/src/lib/retro-hub.ts` e
  `apps/api/src/routes/retro-ws.ts` ficam **intocados nesta sub-fatia** e vão parar de compilar
  (chamadas a funções de `retro-service.ts` sem o novo `companyId` obrigatório) — handoff
  intencional para a sub-fatia 2 (rotas) e 3 (hub/ws), mesmo padrão já usado nas fatias anteriores
  desta linha. `pnpm --filter @legends/api exec tsc --noEmit` vai mostrar erros nesses 4 arquivos
  até lá — é o resultado esperado da Task 5 (verificação final).
- Zero mudança de comportamento observável em produção — só existe uma empresa hoje.

---

### Task 1: Migration + schema + registro em `TENANT_SCOPED_MODELS`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/lib/tenant-scope.ts`

**Interfaces:**
- Produces: `companyId: string` em `RetroRoom`, `RetroRoomSquad`, `RetroParticipant`,
  `RetroCard`, `RetroVote`, `RetroReaction`, `RetroEdit` — todos passam a estar na allowlist de
  `scopedPrisma`.

- [ ] **Step 1: Editar `schema.prisma` — os 7 models de Retro**

Modify `apps/api/prisma/schema.prisma` — trocar o bloco `model RetroRoom { ... }` até
`model RetroEdit { ... }` (linhas ~612-737 na branch investigada) por:

```prisma
model RetroRoom {
  id                  String          @id @default(cuid())
  sprint              Int
  createdById         String
  anonymous           Boolean         @default(false)
  votesPerParticipant Int
  status              RetroRoomStatus @default(OPEN)
  createdAt           DateTime        @default(now())
  concludedAt         DateTime?
  archivedAt          DateTime?
  archivedById        String?
  companyId           String          @default("company-emr")

  creator      User               @relation("RetroRoomsCreated", fields: [createdById], references: [id])
  archivedBy   User?              @relation("RetroRoomsArchived", fields: [archivedById], references: [id], onDelete: SetNull)
  squads       RetroRoomSquad[]
  participants RetroParticipant[]
  cards        RetroCard[]
  edits        RetroEdit[]
  company      Company            @relation(fields: [companyId], references: [id])

  @@index([createdById])
  @@index([companyId])
}

model RetroRoomSquad {
  id        String @id @default(cuid())
  roomId    String
  squadId   String
  companyId String @default("company-emr")

  room    RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  squad   Squad     @relation(fields: [squadId], references: [id])
  company Company   @relation(fields: [companyId], references: [id])

  @@unique([roomId, squadId])
  @@index([squadId])
  @@index([companyId])
}

model RetroParticipant {
  id        String   @id @default(cuid())
  roomId    String
  userId    String
  invitedAt DateTime @default(now())
  companyId String   @default("company-emr")

  room    RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user    User      @relation("RetroParticipations", fields: [userId], references: [id])
  company Company   @relation(fields: [companyId], references: [id])

  @@unique([roomId, userId])
  @@index([userId])
  @@index([companyId])
}

model RetroCard {
  id                String    @id @default(cuid())
  roomId            String
  authorId          String
  text              String
  x                 Float
  y                 Float
  color             String
  kind              String    @default("note")
  shape             String?
  shapeStyle        String?
  width             Float?
  height            Float?
  actionPlan        String?
  actionResponsible String?
  actionDueDate     String?
  actionCardId      String?
  actionDone        Boolean   @default(false)
  actionDoneAt      DateTime?
  actionNote        String?
  auditStatus       String?
  auditedById       String?
  auditedAt         DateTime?
  editedById        String?
  editedAt          DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  companyId         String    @default("company-emr")

  room      RetroRoom       @relation(fields: [roomId], references: [id], onDelete: Cascade)
  author    User            @relation("RetroCards", fields: [authorId], references: [id])
  auditedBy User?           @relation("RetroActionsAudited", fields: [auditedById], references: [id])
  editedBy  User?           @relation("RetroCardsEdited", fields: [editedById], references: [id])
  votes     RetroVote[]
  reactions RetroReaction[]
  company   Company         @relation(fields: [companyId], references: [id])

  @@index([roomId])
  @@index([authorId])
  @@index([actionResponsible])
  @@index([companyId])
}

model RetroVote {
  id        String   @id @default(cuid())
  cardId    String
  userId    String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  card    RetroCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  user    User      @relation("RetroVotes", fields: [userId], references: [id])
  company Company   @relation(fields: [companyId], references: [id])

  @@index([cardId])
  @@index([userId])
  @@index([companyId])
}

model RetroReaction {
  id        String @id @default(cuid())
  cardId    String
  userId    String
  emoji     String
  companyId String @default("company-emr")

  card    RetroCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  user    User      @relation("RetroReactions", fields: [userId], references: [id])
  company Company   @relation(fields: [companyId], references: [id])

  @@unique([cardId, userId, emoji])
  @@index([cardId])
  @@index([companyId])
}

model RetroEdit {
  id        String   @id @default(cuid())
  roomId    String
  editorId  String
  action    String
  detail    String?
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  room    RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  editor  User      @relation("RetroEditsAuthored", fields: [editorId], references: [id])
  company Company   @relation(fields: [companyId], references: [id])

  @@index([roomId])
  @@index([companyId])
}
```

No `model Company`, adicionar as 7 relações inversas (depois de `userBadges UserBadge[]`, antes
do bloco `officeSetting ...`):

```prisma
  retroRooms        RetroRoom[]
  retroRoomSquads   RetroRoomSquad[]
  retroParticipants RetroParticipant[]
  retroCards        RetroCard[]
  retroVotes        RetroVote[]
  retroReactions    RetroReaction[]
  retroEdits        RetroEdit[]
```

- [ ] **Step 2: Gerar a migration**

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev --name add_company_to_retro`
Expected: cria uma nova pasta em `apps/api/prisma/migrations/`, SQL puramente aditivo — 7×
`ALTER TABLE ... ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr'`, 7× `CREATE INDEX`,
7× `ADD CONSTRAINT ... FOREIGN KEY`, sem `DROP`/recreate. Se o Prisma gerar algo diferente, pare
e ajuste o schema antes de aceitar. (`ADD COLUMN ... NOT NULL DEFAULT` já é um backfill real —
popula toda linha existente com o valor, não só declara um default para o futuro; mesmo padrão
de todas as migrations anteriores desta linha, ex. `20260724111042_add_company_and_tenant_columns`.)

- [ ] **Step 3: Registrar os 7 models em `tenant-scope.ts`**

Modify `apps/api/src/lib/tenant-scope.ts` — acrescentar ao `TENANT_SCOPED_MODELS` (depois de
`'OfficeGuestInvite',`):

```ts
  'RetroRoom',
  'RetroRoomSquad',
  'RetroParticipant',
  'RetroCard',
  'RetroVote',
  'RetroReaction',
  'RetroEdit',
```

- [ ] **Step 4: Rodar a suíte da API pra confirmar que nada quebrou na migration**

Run: `pnpm --filter @legends/api test`
Expected: PASS nos arquivos que não dependem de `retro-service.ts` (a migration só adiciona
colunas com default). Os arquivos de teste de Retro (`retro-service.test.ts`,
`retro-card-service.test.ts`, `retro-vote-service.test.ts`, `retro.test.ts`,
`retro-admin.test.ts`, `retro-carryover.test.ts`, `retro-edit.test.ts`, `retro-ws.test.ts`) ainda
não foram tocados nesta task — continuam passando como antes (as funções de serviço ainda não
exigem `companyId`, então nenhuma chamada existente quebra ainda). Falha aceitável: só a flake
conhecida `office-map-service.test.ts`.

- [ ] **Step 5: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros novos (a migration não muda nenhuma assinatura ainda).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/lib/tenant-scope.ts
git commit -m "feat: adiciona companyId aos 7 models de Retro (migration + allowlist)"
```

---

### Task 2: Sala — CRUD, listagem, fases e participantes

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/services/retro-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma(companyId)` (Task 1).
- Produces:
  ```ts
  createRoom(input: { creatorId, sprint, squadIds, votesPerParticipant, participantIds, companyId: string }): Promise<RetroRoomWithRelations>
  listRoomsForUser(viewer: { id, role }, companyId: string): Promise<RetroRoomWithRelations[]>
  listRoomsForAdmin(companyId: string): Promise<RetroRoomWithRelations[]>
  updateRoomAsAdmin(input: { roomId, actorId, companyId: string, sprint?, squadIds?, votesPerParticipant? }): Promise<RetroRoomWithRelations>
  hardDeleteRoom(input: { roomId, actorId, companyId: string }): Promise<void>
  getRoomForViewer(roomId: string, viewer: { id, role }, companyId: string): Promise<{ room, role }>
  setParticipants(input: { roomId, userId, participantIds, companyId: string }): Promise<{ room, addedUserIds }>
  advancePhase(input: { roomId, userId, action: 'conclude', companyId: string }): Promise<RetroRoomWithRelations>
  setAnonymous(input: { roomId, userId, anonymous, companyId: string }): Promise<RetroRoomWithRelations>
  archiveRoom(input: { roomId, userId, companyId: string }): Promise<void>
  getRoomMeta(roomId: string, companyId: string): Promise<RetroRoomMeta | null>
  ```
  (`loadRoom`, `sanitizeRoomForAudit`, `assertInvitable`, `assertSprint`, `assertVotes` são
  privadas — `loadRoom` e `assertInvitable` ganham `companyId`, as outras duas ficam iguais,
  puras.)

Este task fecha o vazamento real mais severo (`listRoomsForUser`/`listRoomsForAdmin` globais) e
os dois gaps adjacentes (squad de outra empresa anexada à sala; participante de outra empresa
convidado) — ambos resolvidos "de graça" trocando o client de `prisma` por `scopedPrisma`, ver
Global Constraints.

- [ ] **Step 1: Atualizar os call-sites de teste existentes + escrever os testes falhando**

Modify `apps/api/src/services/retro-service.test.ts` — arquivo inteiro:

```ts
// apps/api/src/services/retro-service.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  advancePhase,
  archiveRoom,
  createCard,
  createRoom,
  getRoomForViewer,
  getRoomMeta,
  hardDeleteRoom,
  listRoomsForAdmin,
  listRoomsForUser,
  resolveRole,
  setAnonymous,
  setParticipants,
  updateRoomAsAdmin,
} from './retro-service'

async function mkUser(name: string, role: 'LEGEND' | 'LEAD' | 'MANAGER' | 'HEAD' | 'ADMIN' | 'SUBADMIN' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
/** Usuário com segredos "marcados" — para provar que não vazam pro log de auditoria. */
async function mkUserWithSecrets(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({
    data: {
      name,
      email: `${name}-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: `secret-hash-${name}-nao-pode-vazar`,
      teamsWebhookUrl: `https://outlook.office.com/webhook/${name}-nao-pode-vazar`,
      role,
    },
  })
}
function assertNoSecretsInAuditPayload(payload: unknown, secretUsers: { name: string }[]) {
  const serialized = JSON.stringify(payload)
  expect(serialized).not.toContain('passwordHash')
  expect(serialized).not.toContain('teamsWebhookUrl')
  for (const u of secretUsers) {
    expect(serialized).not.toContain(`secret-hash-${u.name}-nao-pode-vazar`)
    expect(serialized).not.toContain(`${u.name}-nao-pode-vazar`)
  }
}
async function mkSquad(name = 'Inovação') {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
}

describe('retro-service: salas', () => {
  it('LEAD cria sala e entra como participante automaticamente', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const dev = await mkUser('Dan', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({
      creatorId: lead.id, sprint: 23, squadIds: [squad.id],
      votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID,
    })
    const ids = room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, dev.id].sort())
    expect(room.status).toBe('OPEN')
    expect(room.sprint).toBe(23)
    expect(room.squads.map((rs) => rs.squad.name)).toContain('Inovação')
  })

  it('não-LEAD não cria sala (403)', async () => {
    const dev = await mkUser('Dan', 'LEGEND')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: dev.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('MANAGER e HEAD também criam sala (papéis de liderança)', async () => {
    const squad = await mkSquad()
    for (const role of ['MANAGER', 'HEAD'] as const) {
      const leader = await mkUser(`Lead${role}`, role)
      const room = await createRoom({
        creatorId: leader.id, sprint: 5, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID,
      })
      expect(room.status).toBe('OPEN')
      expect(room.participants.map((p) => p.userId)).toContain(leader.id)
    }
  })

  it('rejeita votesPerParticipant fora do intervalo (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 0, participantIds: [], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita squad inativa (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const squad = await prisma.squad.create({ data: { name: 'Off', slug: 'off', active: false } })
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita convidar ADMIN (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const admin = await mkUser('Ada', 'ADMIN')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [admin.id], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita convidar SUBADMIN (400)', async () => {
    const lead = await mkUser('Lia2', 'LEAD')
    const sub = await mkUser('Suba', 'SUBADMIN')
    const squad = await mkSquad('Inovação Sub')
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [sub.id], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('resolveRole: criador=FACILITATOR, convidado=PARTICIPANT, LEAD externo=OBSERVER, DEV externo=null', async () => {
    const room = { createdById: 'lead1', participants: [{ userId: 'lead1' }, { userId: 'dev1' }] }
    expect(resolveRole(room, { id: 'lead1', role: 'LEAD' })).toBe('FACILITATOR')
    expect(resolveRole(room, { id: 'dev1', role: 'LEGEND' })).toBe('PARTICIPANT')
    expect(resolveRole(room, { id: 'lead2', role: 'LEAD' })).toBe('OBSERVER')
    expect(resolveRole(room, { id: 'mgr', role: 'MANAGER' })).toBe('OBSERVER')
    expect(resolveRole(room, { id: 'head', role: 'HEAD' })).toBe('OBSERVER')
    expect(resolveRole(room, { id: 'dev2', role: 'LEGEND' })).toBeNull()
    expect(resolveRole(room, { id: 'adm', role: 'ADMIN' })).toBeNull()
  })

  it('listRoomsForUser: LEAD vê todas; DEV só as suas', async () => {
    const lead1 = await mkUser('L1', 'LEAD')
    const lead2 = await mkUser('L2', 'LEAD')
    const dev = await mkUser('D', 'LEGEND')
    const squad = await mkSquad()
    await createRoom({ creatorId: lead1.id, sprint: 10, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await createRoom({ creatorId: lead2.id, sprint: 20, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID })

    expect((await listRoomsForUser({ id: lead1.id, role: 'LEAD' }, DEFAULT_COMPANY_ID)).length).toBe(2)
    const devRooms = await listRoomsForUser({ id: dev.id, role: 'LEGEND' }, DEFAULT_COMPANY_ID)
    expect(devRooms.map((r) => r.sprint)).toEqual([10])
  })

  it('getRoomForViewer: DEV não convidado recebe 404', async () => {
    const lead = await mkUser('L', 'LEAD')
    const stranger = await mkUser('S', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID })
    await expect(getRoomForViewer(room.id, { id: stranger.id, role: 'LEGEND' }, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('conclui a sala (OPEN→CONCLUDED) só pelo facilitador; transição inválida = 409', async () => {
    const lead = await mkUser('L', 'LEAD')
    const dev = await mkUser('D', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await expect(advancePhase({ roomId: room.id, userId: dev.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 403 })
    const done = await advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })
    expect(done.status).toBe('CONCLUDED')
    await expect(advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 409 })
  })

  it('setParticipants substitui a lista (add/remove) e mantém o criador', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'LEGEND')
    const d2 = await mkUser('D2', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [d1.id], companyId: DEFAULT_COMPANY_ID })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [d2.id], companyId: DEFAULT_COMPANY_ID })
    expect(res.addedUserIds).toEqual([d2.id])
    const ids = res.room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, d2.id].sort())
  })

  it('remover participante mantém os cards dele', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'LEGEND')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [d1.id], companyId: DEFAULT_COMPANY_ID })
    const card = await createCard({ roomId: room.id, userId: d1.id, text: 'oi', color: 'yellow', x: 0, y: 0 })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [], companyId: DEFAULT_COMPANY_ID })
    expect(res.room.participants.map((p) => p.userId)).toEqual([lead.id])
    expect(res.room.cards.some((c) => c.id === card.id)).toBe(true)
  })
})

describe('retro-service: auditoria não vaza User completo (passwordHash/teamsWebhookUrl)', () => {
  it('updateRoomAsAdmin não persiste passwordHash/teamsWebhookUrl aninhados (before/after)', async () => {
    const lead = await mkUserWithSecrets('LeadSecreto', 'LEAD')
    const dev = await mkUserWithSecrets('DevSecreto')
    const admin = await mkUser('AdminAud', 'ADMIN')
    const squad = await mkSquad()
    const squad2 = await mkSquad('Outra')
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await createCard({ roomId: room.id, userId: dev.id, text: 'card com autor sensível', color: 'yellow', x: 0, y: 0 })

    await updateRoomAsAdmin({ roomId: room.id, actorId: admin.id, sprint: 2, squadIds: [squad2.id], companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'RetroRoom', entityId: room.id, action: 'UPDATE' } })
    expect(log).not.toBeNull()
    assertNoSecretsInAuditPayload(log?.before, [lead, dev])
    assertNoSecretsInAuditPayload(log?.after, [lead, dev])
    // continua rastreável: nome sobrevive no resumo seguro
    expect(JSON.stringify(log?.before)).toContain('LeadSecreto')
  })

  it('hardDeleteRoom não persiste passwordHash/teamsWebhookUrl aninhados (before)', async () => {
    const lead = await mkUserWithSecrets('LeadDel', 'LEAD')
    const dev = await mkUserWithSecrets('DevDel')
    const admin = await mkUser('AdminDel', 'ADMIN')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await createCard({ roomId: room.id, userId: dev.id, text: 'card', color: 'yellow', x: 0, y: 0 })

    await hardDeleteRoom({ roomId: room.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'RetroRoom', entityId: room.id, action: 'DELETE' } })
    expect(log).not.toBeNull()
    assertNoSecretsInAuditPayload(log?.before, [lead, dev])
  })

  it('archiveRoom não persiste passwordHash/teamsWebhookUrl aninhados (before)', async () => {
    const lead = await mkUserWithSecrets('LeadArc', 'LEAD')
    const dev = await mkUserWithSecrets('DevArc')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    await createCard({ roomId: room.id, userId: dev.id, text: 'card', color: 'yellow', x: 0, y: 0 })

    await archiveRoom({ roomId: room.id, userId: lead.id, companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'RetroRoom', entityId: room.id, action: 'DELETE' } })
    expect(log).not.toBeNull()
    assertNoSecretsInAuditPayload(log?.before, [lead, dev])
  })
})

describe('retro-service: isolamento por empresa', () => {
  it('listRoomsForUser (LEAD) não retorna sala de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro', slug: 'outra-empresa-retro-list-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetro', email: 'lead-outra-empresa-retro@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetro', slug: 'squad-outra-empresa-retro-test', companyId: otherCompany.id } })
    await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const leadDaqui = await mkUser('LeadDaquiRetroList', 'LEAD')

    const rooms = await listRoomsForUser({ id: leadDaqui.id, role: 'LEAD' }, DEFAULT_COMPANY_ID)
    expect(rooms).toHaveLength(0)
  })

  it('listRoomsForAdmin não retorna sala de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Admin', slug: 'outra-empresa-retro-admin-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroAdmin', email: 'lead-outra-empresa-retro-admin@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroAdmin', slug: 'squad-outra-empresa-retro-admin-test', companyId: otherCompany.id } })
    await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })

    const rooms = await listRoomsForAdmin(DEFAULT_COMPANY_ID)
    expect(rooms).toHaveLength(0)
  })

  it('getRoomForViewer/updateRoomAsAdmin/hardDeleteRoom/archiveRoom tratam sala de outra empresa como 404', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Mutacao', slug: 'outra-empresa-retro-mutacao-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroMut', email: 'lead-outra-empresa-retro-mut@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroMut', slug: 'squad-outra-empresa-retro-mut-test', companyId: otherCompany.id } })
    const room = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const actor = await mkUser('AtorRetroMut', 'ADMIN')

    await expect(getRoomForViewer(room.id, { id: actor.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    await expect(updateRoomAsAdmin({ roomId: room.id, actorId: actor.id, sprint: 2, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    await expect(archiveRoom({ roomId: room.id, userId: actor.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    await expect(hardDeleteRoom({ roomId: room.id, actorId: actor.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
  })

  it('setAnonymous e getRoomMeta tratam sala de outra empresa como inexistente', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Meta', slug: 'outra-empresa-retro-meta-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroMeta', email: 'lead-outra-empresa-retro-meta@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroMeta', slug: 'squad-outra-empresa-retro-meta-test', companyId: otherCompany.id } })
    const room = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })

    await expect(setAnonymous({ roomId: room.id, userId: leadOutraEmpresa.id, anonymous: false, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    expect(await getRoomMeta(room.id, DEFAULT_COMPANY_ID)).toBeNull()
  })

  it('createRoom rejeita squad de outra empresa anexada à sala (400)', async () => {
    const lead = await mkUser('LeadRejeitaSquad', 'LEAD')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Squad', slug: 'outra-empresa-retro-squad-test' } })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRejeita', slug: 'squad-outra-empresa-rejeita-test', companyId: otherCompany.id } })

    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squadOutraEmpresa.id], votesPerParticipant: 3, participantIds: [], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('createRoom rejeita participante de outra empresa convidado (400)', async () => {
    const lead = await mkUser('LeadRejeitaParticipante', 'LEAD')
    const squad = await mkSquad('SquadRejeitaParticipante')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Participante', slug: 'outra-empresa-retro-participante-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaRetroParticipante', email: 'fora-retro-participante@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })

    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [outsider.id], companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts`
Expected: FAIL — erro de compilação (as assinaturas de `createRoom`/`listRoomsForUser`/
`listRoomsForAdmin`/`getRoomForViewer`/`updateRoomAsAdmin`/`hardDeleteRoom`/`archiveRoom`/
`setAnonymous`/`getRoomMeta`/`setParticipants`/`advancePhase` ainda não aceitam `companyId`; as
chamadas de `createCard` neste mesmo arquivo continuam sem `companyId` de propósito — `createCard`
só é tocada na Task 3). Depois de implementar (Step 3), os testes do describe `'retro-service:
isolamento por empresa'` são os que provam o vazamento fechado.

- [ ] **Step 3: Implementar o escopo em `retro-service.ts`**

Modify `apps/api/src/services/retro-service.ts` — adicionar o import:

```ts
import { scopedPrisma } from '../lib/tenant-scope'
```

Trocar `loadRoom`:

```ts
async function loadRoom(roomId: string, companyId: string): Promise<RetroRoomWithRelations> {
  const room = await scopedPrisma(companyId).retroRoom.findUnique({ where: { id: roomId }, include: retroRoomInclude })
  if (!room || room.archivedAt) throw new RetroError('Sala não encontrada.', 404)
  return room
}
```

Trocar `assertInvitable` (agora recebe `companyId` — fecha o gap de participante de outra empresa
convidado):

```ts
async function assertInvitable(ids: string[], companyId: string): Promise<void> {
  if (ids.length === 0) return
  const users = await scopedPrisma(companyId).user.findMany({ where: { id: { in: ids } } })
  if (users.length !== new Set(ids).size) throw new RetroError('Algum participante é inválido.', 400)
  if (users.some((u) => !u.active || u.leftAt)) throw new RetroError('Participante inativo.', 400)
  if (users.some((u) => u.role === 'ADMIN' || u.role === 'SUBADMIN')) throw new RetroError('Administradores não participam de retrospectivas.', 400)
}
```

Trocar `createRoom`:

```ts
export async function createRoom(input: {
  creatorId: string
  sprint: number
  squadIds: string[]
  votesPerParticipant: number
  participantIds: string[]
  companyId: string
}): Promise<RetroRoomWithRelations> {
  const creator = await prisma.user.findUnique({ where: { id: input.creatorId } })
  if (!creator || !creator.active || creator.leftAt) throw new RetroError('Criador inválido.', 400)
  if (!isLeaderRole(creator.role)) throw new RetroError('Apenas líderes abrem salas de retrospectiva.', 403)
  assertSprint(input.sprint)
  assertVotes(input.votesPerParticipant)
  const squadIds = [...new Set(input.squadIds)]
  if (squadIds.length === 0) throw new RetroError('Selecione ao menos uma squad.', 400)
  const db = scopedPrisma(input.companyId)
  // scopedPrisma já filtra squad de outra empresa pra fora do resultado — a checagem de
  // comprimento abaixo cobre tanto squad inativa/inexistente quanto squad de outra empresa.
  const squads = await db.squad.findMany({ where: { id: { in: squadIds } } })
  if (squads.length !== squadIds.length || squads.some((s) => !s.active)) {
    throw new RetroError('Squad inválida.', 400)
  }
  const invited = [...new Set(input.participantIds)].filter((id) => id !== input.creatorId)
  await assertInvitable(invited, input.companyId)
  const allParticipantIds = [input.creatorId, ...invited]
  return db.retroRoom.create({
    data: {
      sprint: input.sprint,
      createdById: input.creatorId,
      // Sala começa anônima (conteúdo oculto); o facilitador revela quando quiser.
      anonymous: true,
      votesPerParticipant: input.votesPerParticipant,
      squads: { create: squadIds.map((squadId) => ({ squadId })) },
      participants: { create: allParticipantIds.map((userId) => ({ userId })) },
    },
    include: retroRoomInclude,
  })
}
```

Trocar `listRoomsForUser`:

```ts
export async function listRoomsForUser(viewer: { id: string; role: string }, companyId: string): Promise<RetroRoomWithRelations[]> {
  const where: Prisma.RetroRoomWhereInput =
    isLeaderRole(viewer.role)
      ? { archivedAt: null }
      : { archivedAt: null, participants: { some: { userId: viewer.id } } }
  return scopedPrisma(companyId).retroRoom.findMany({ where, include: retroRoomInclude, orderBy: { createdAt: 'desc' } })
}
```

Trocar `listRoomsForAdmin`:

```ts
/** Lista todas as salas não arquivadas para gestão pelo admin (OPEN + CONCLUDED). */
export async function listRoomsForAdmin(companyId: string): Promise<RetroRoomWithRelations[]> {
  return scopedPrisma(companyId).retroRoom.findMany({
    where: { archivedAt: null },
    include: retroRoomInclude,
    orderBy: [{ sprint: 'desc' }, { createdAt: 'desc' }],
  })
}
```

Trocar `updateRoomAsAdmin`:

```ts
/** Edita metadados da sala (sprint, squads, votos) — uso administrativo. */
export async function updateRoomAsAdmin(input: {
  roomId: string
  actorId: string
  companyId: string
  sprint?: number
  squadIds?: string[]
  votesPerParticipant?: number
}): Promise<RetroRoomWithRelations> {
  const db = scopedPrisma(input.companyId)
  const before = await loadRoom(input.roomId, input.companyId) // 404 se não existir / arquivada / outra empresa

  const data: Prisma.RetroRoomUpdateInput = {}
  if (input.sprint !== undefined) {
    assertSprint(input.sprint)
    data.sprint = input.sprint
  }
  if (input.votesPerParticipant !== undefined) {
    assertVotes(input.votesPerParticipant)
    data.votesPerParticipant = input.votesPerParticipant
  }

  let squadIds: string[] | null = null
  if (input.squadIds !== undefined) {
    squadIds = [...new Set(input.squadIds)]
    if (squadIds.length === 0) throw new RetroError('Selecione ao menos uma squad.', 400)
    const squads = await db.squad.findMany({ where: { id: { in: squadIds } } })
    if (squads.length !== squadIds.length || squads.some((s) => !s.active)) {
      throw new RetroError('Squad inválida.', 400)
    }
  }

  await db.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.retroRoom.update({ where: { id: input.roomId }, data })
    }
    if (squadIds) {
      await tx.retroRoomSquad.deleteMany({ where: { roomId: input.roomId } })
      await tx.retroRoomSquad.createMany({ data: squadIds.map((squadId) => ({ roomId: input.roomId, squadId })) })
    }
  })

  const after = await loadRoom(input.roomId, input.companyId)
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'RetroRoom',
    entityId: input.roomId,
    action: 'UPDATE',
    before: sanitizeRoomForAudit(before),
    after: sanitizeRoomForAudit(after),
  })
  return after
}
```

Trocar `hardDeleteRoom`:

```ts
/** Exclusão definitiva da sala (cascata remove cards/votos/reações/participantes/squads/edits). */
export async function hardDeleteRoom(input: { roomId: string; actorId: string; companyId: string }): Promise<void> {
  const before = await loadRoom(input.roomId, input.companyId) // 404 se não existir / arquivada / outra empresa
  await scopedPrisma(input.companyId).retroRoom.delete({ where: { id: input.roomId } })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'RetroRoom',
    entityId: input.roomId,
    action: 'DELETE',
    before: sanitizeRoomForAudit(before),
  })
}
```

Trocar `getRoomForViewer`:

```ts
export async function getRoomForViewer(
  roomId: string,
  viewer: { id: string; role: string },
  companyId: string,
): Promise<{ room: RetroRoomWithRelations; role: RetroRoomRole }> {
  const room = await loadRoom(roomId, companyId)
  const role = resolveRole(room, viewer)
  if (!role) throw new RetroError('Sala não encontrada.', 404)
  return { room, role }
}
```

Trocar `setParticipants`:

```ts
export async function setParticipants(input: {
  roomId: string
  userId: string
  participantIds: string[]
  companyId: string
}): Promise<{ room: RetroRoomWithRelations; addedUserIds: string[] }> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador gerencia participantes.', 403)
  if (room.status === 'CONCLUDED') throw new RetroError('A sala foi concluída.', 409)
  const desired = new Set([room.createdById, ...input.participantIds])
  await assertInvitable([...desired].filter((id) => id !== room.createdById), input.companyId)
  const current = new Set(room.participants.map((p) => p.userId))
  const toAdd = [...desired].filter((id) => !current.has(id))
  const toRemove = [...current].filter((id) => !desired.has(id) && id !== room.createdById)
  const db = scopedPrisma(input.companyId)
  await db.$transaction([
    ...(toAdd.length ? [db.retroParticipant.createMany({ data: toAdd.map((userId) => ({ roomId: room.id, userId })) })] : []),
    ...(toRemove.length ? [db.retroParticipant.deleteMany({ where: { roomId: room.id, userId: { in: toRemove } } })] : []),
  ])
  return { room: await loadRoom(room.id, input.companyId), addedUserIds: toAdd }
}
```

Trocar `advancePhase`:

```ts
export async function advancePhase(input: {
  roomId: string
  userId: string
  action: 'conclude'
  companyId: string
}): Promise<RetroRoomWithRelations> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador muda a fase.', 403)
  if (room.status !== 'OPEN') throw new RetroError('Transição de fase inválida.', 409)
  await scopedPrisma(input.companyId).retroRoom.update({ where: { id: room.id }, data: { status: 'CONCLUDED', concludedAt: new Date() } })
  return loadRoom(room.id, input.companyId)
}
```

Trocar `setAnonymous`:

```ts
export async function setAnonymous(input: {
  roomId: string
  userId: string
  anonymous: boolean
  companyId: string
}): Promise<RetroRoomWithRelations> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador muda o modo anônimo.', 403)
  if (room.status !== 'OPEN') throw new RetroError('Sala não está aberta.', 409)
  await scopedPrisma(input.companyId).retroRoom.update({ where: { id: room.id }, data: { anonymous: input.anonymous } })
  return loadRoom(room.id, input.companyId)
}
```

Trocar `getRoomMeta`:

```ts
export async function getRoomMeta(roomId: string, companyId: string): Promise<RetroRoomMeta | null> {
  const room = await scopedPrisma(companyId).retroRoom.findUnique({
    where: { id: roomId },
    include: { participants: { select: { userId: true } } },
  })
  if (!room || room.archivedAt) return null
  return {
    id: room.id,
    status: room.status,
    anonymous: room.anonymous,
    createdById: room.createdById,
    votesPerParticipant: room.votesPerParticipant,
    participantUserIds: room.participants.map((p) => p.userId),
  }
}
```

Trocar `archiveRoom`:

```ts
export async function archiveRoom(input: { roomId: string; userId: string; companyId: string }): Promise<void> {
  const before = await loadRoom(input.roomId, input.companyId)
  await scopedPrisma(input.companyId).retroRoom.update({
    where: { id: input.roomId },
    data: { archivedAt: new Date(), archivedById: input.userId },
  })
  await recordAuditLog({
    actorId: input.userId,
    entityType: 'RetroRoom',
    entityId: input.roomId,
    action: 'DELETE',
    before: sanitizeRoomForAudit(before),
  })
}
```

(o resto do arquivo — `getRoomMeta` já trocado acima, `countUserVotesInRoom`, `loadCard`,
`createCard`, `updateCard`, `updateCardPosition`, `deleteCard`, `addVote`, `removeVote`,
`toggleReaction`, `updateAction`, `listEdits`, `priorConcludedSquadRooms`, `listCarryover`,
`setCarryover` e os privados de card/ação — fica inalterado nesta task; Tasks 3 e 4 cuidam
deles.)

- [ ] **Step 4: Rodar e confirmar que passa (com as exceções esperadas)**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts`
Expected: PASS em todos os describes deste arquivo, incluindo `'retro-service: isolamento por
empresa'` (os 7 novos testes).

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-card-service.test.ts src/services/retro-vote-service.test.ts`
Expected: FAIL — erro de compilação, pois esses dois arquivos chamam `createRoom` (via
`room()`/`openRoomWithCard()`) sem `companyId` ainda — esperado, corrigido na Task 3 junto com
`createCard`/`updateCard`/etc.

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros em `apps/api/src/services/retro-card-service.test.ts`,
`apps/api/src/services/retro-vote-service.test.ts` (chamadas de `createRoom` sem `companyId`),
em `apps/api/src/routes/retro.ts` e no trecho de retro em `apps/api/src/routes/admin.ts`
(call-sites de produção ainda sem `companyId` — Task futura fora desta sub-fatia), e em
`apps/api/src/lib/retro-hub.ts`/`apps/api/src/routes/retro-ws.ts` (usam `getRoomMeta` sem
`companyId`). Nenhum erro dentro de `retro-service.ts` ou de `retro-service.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-service.test.ts
git commit -m "fix: escopa CRUD/listagem/fases/participantes de sala de retro por empresa"
```

---

### Task 3: Cards, votos, reações e ações

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/services/retro-service.test.ts`
- Modify: `apps/api/src/services/retro-card-service.test.ts`
- Modify: `apps/api/src/services/retro-vote-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma(companyId)` (Task 1), `loadRoom(roomId, companyId)` (Task 2).
- Produces:
  ```ts
  loadCard(roomId: string, cardId: string, companyId: string): Promise<RetroCardWithRelations>
  createCard(input: { roomId, userId, companyId: string, text?, color, x, y, kind?, shape?, shapeStyle?, width?, height?, actionPlan?, actionResponsible?, actionDueDate? }): Promise<RetroCardWithRelations>
  updateCard(input: { roomId, cardId, userId, companyId: string, role?, text?, color?, shape?, shapeStyle?, width?, height?, actionPlan?, actionResponsible?, actionDueDate? }): Promise<UpdateCardResult>
  updateCardPosition(input: { roomId, cardId, userId, companyId: string, x, y }): Promise<{ x, y }>
  deleteCard(input: { roomId, cardId, userId, companyId: string }): Promise<void>
  addVote(input: { roomId, cardId, userId, companyId: string }): Promise<{ voteCount }>
  removeVote(input: { roomId, cardId, userId, companyId: string }): Promise<{ voteCount }>
  toggleReaction(input: { roomId, cardId, userId, emoji, companyId: string }): Promise<RetroCardWithRelations>
  countUserVotesInRoom(roomId: string, userId: string, companyId: string): Promise<number>
  updateAction(input: { cardId, userId, done?, note?, companyId: string })
  logEdit(roomId: string, editorId: string, action: string, detail: string | null, companyId: string): Promise<unknown>
  ```
  (`assertParticipant`, `assertOpen`, `assertText`, `assertColor`, `assertKind`, `assertShape`,
  `assertShapeStyle`, `assertDimension`, `optionalText`, `isCardInRegion`, `isActionCard`,
  `formatDueDate`, `actionCardText` são puras/sem DB, ficam iguais. `assertResponsible` e
  `resolveResponsibleName` ganham `companyId` explícito — não recebem `room`/`card`. `upsertActionCard`,
  `countCarryover` e `priorConcludedSquadRooms` **não** ganham parâmetro novo — usam
  `room.companyId` internamente, ver Global Constraints.)

- [ ] **Step 1: Atualizar os call-sites de teste existentes nos 3 arquivos + escrever os testes falhando**

Modify `apps/api/src/services/retro-service.test.ts` — as **4** chamadas de `createCard` que
ainda faltam ganhar `companyId` (dentro de `'remover participante mantém os cards dele'` e das 3
do describe de auditoria). Exemplo da transformação (aplicar a mesma regra nas 4 ocorrências):

```ts
// antes:
const card = await createCard({ roomId: room.id, userId: d1.id, text: 'oi', color: 'yellow', x: 0, y: 0 })
// depois:
const card = await createCard({ roomId: room.id, userId: d1.id, text: 'oi', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })
```

(idem nas 3 chamadas `createCard({ roomId: room.id, userId: dev.id, text: 'card...', color:
'yellow', x: 0, y: 0 })` dentro do describe de auditoria — todas ganham `, companyId:
DEFAULT_COMPANY_ID` antes do `}`.)

Modify `apps/api/src/services/retro-card-service.test.ts` — arquivo inteiro:

```ts
// apps/api/src/services/retro-card-service.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { advancePhase, createCard, createRoom, deleteCard, updateCard, updateCardPosition } from './retro-service'

async function mkUser(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function mkSquad(name = 'Squad') {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
}
async function room(extraDevIds: string[] = []) {
  const lead = await mkUser('L', 'LEAD')
  const dev = await mkUser('D', 'LEGEND')
  const squad = await mkSquad()
  const r = await createRoom({
    creatorId: lead.id,
    sprint: 1,
    squadIds: [squad.id],
    votesPerParticipant: 3,
    participantIds: [dev.id, ...extraDevIds],
    companyId: DEFAULT_COMPANY_ID,
  })
  return { lead, dev, r }
}

describe('retro-service: cards', () => {
  it('participante cria card em OPEN', async () => {
    const { dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Pair programming', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })
    expect(card.text).toBe('Pair programming')
    expect(card.color).toBe('yellow')
  })

  it('participante cria forma sem texto obrigatório', async () => {
    const { dev, r } = await room()
    const card = await createCard({
      roomId: r.id,
      userId: dev.id,
      text: '',
      color: 'blue',
      kind: 'shape',
      shape: 'arrow-right',
      shapeStyle: 'outline',
      width: 160,
      height: 104,
      x: 10,
      y: 20,
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(card).toMatchObject({ kind: 'shape', shape: 'arrow-right', shapeStyle: 'outline', width: 160, height: 104 })
  })

  it('observador (LEAD externo) não cria card (403)', async () => {
    const { r } = await room()
    const otherLead = await mkUser('L2', 'LEAD')
    await expect(
      createCard({ roomId: r.id, userId: otherLead.id, text: 'x', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('texto vazio é rejeitado (400)', async () => {
    const { dev, r } = await room()
    await expect(createCard({ roomId: r.id, userId: dev.id, text: '   ', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('criar card em CONCLUDED é bloqueado (409)', async () => {
    const { lead, dev, r } = await room()
    await advancePhase({ roomId: r.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })
    await expect(createCard({ roomId: r.id, userId: dev.id, text: 'x', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 409 })
  })

  it('só o autor edita/exclui o próprio card (403 para outro)', async () => {
    const { lead, dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'orig', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })
    await expect(updateCard({ roomId: r.id, cardId: card.id, userId: lead.id, text: 'hack', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 403 })

    const { card: updated } = await updateCard({ roomId: r.id, cardId: card.id, userId: dev.id, text: 'editado', companyId: DEFAULT_COMPANY_ID })
    expect(updated.text).toBe('editado')

    await deleteCard({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.retroCard.count({ where: { id: card.id } })).toBe(0)
  })

  it('qualquer participante move qualquer card (updateCardPosition)', async () => {
    const { lead, dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'x', color: 'pink', x: 1, y: 2, companyId: DEFAULT_COMPANY_ID })
    const moved = await updateCardPosition({ roomId: r.id, cardId: card.id, userId: lead.id, x: 50, y: 60, companyId: DEFAULT_COMPANY_ID })
    expect(moved).toEqual({ x: 50, y: 60 })
  })

  it('rejeita cor inválida (400)', async () => {
    const { dev, r } = await room()
    await expect(createCard({ roomId: r.id, userId: dev.id, text: 'x', color: 'turquoise', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita forma inválida (400)', async () => {
    const { dev, r } = await room()
    await expect(createCard({ roomId: r.id, userId: dev.id, text: '', color: 'blue', kind: 'shape', shape: 'blob', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('cria card de ação quando card em ruim tem plano, responsável e prazo', async () => {
    const { dev, r } = await room()
    const ana = await mkUser('Ana')
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    const { card: updated, actionCard, actionCardCreated } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })

    expect(actionCardCreated).toBe(true)
    expect(updated.actionResponsible).toBe(ana.id)
    expect(updated.actionCardId).toBe(actionCard?.id)
    expect(actionCard?.text).toContain('Plano: Revisar pipeline')
    // `actionResponsible` guarda o ID; o card-espelho mostra o nome resolvido.
    expect(actionCard?.text).toContain('Responsável: Ana')
    expect(actionCard?.text).toContain('Prazo: 30-06-2026')
  })

  it('sem carry-over: card-espelho nasce no slot 0 do quadrante Ações', async () => {
    const { dev, r } = await room()
    const ana = await mkUser('AnaTopo')
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    const { actionCard } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })
    // sem carry-over → slot 0: x = 2320+40 = 2360; y = 280+80 = 360.
    expect(actionCard?.x).toBe(2360)
    expect(actionCard?.y).toBe(360)
  })

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

    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    const { actionCard } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Revisar pipeline',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })
    // 1 carry-over + 0 espelhos = slot 1: x = 2360 + 240 = 2600; y = 360 (mesma linha).
    expect(actionCard?.x).toBe(2600)
    expect(actionCard?.y).toBe(360)
  })

  it.each([
    ['começar', 100, 1300],
    ['parar', 1200, 1300],
  ])('cria card de ação também no quadrante "%s"', async (_label, x, y) => {
    const { dev, r } = await room()
    const ana = await mkUser(`Ana-${x}-${y}`)
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Ponto', color: 'green', x, y, companyId: DEFAULT_COMPANY_ID })
    const { actionCard, actionCardCreated } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Plano X',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(actionCardCreated).toBe(true)
    expect(actionCard?.text).toContain('Plano: Plano X')
    expect(actionCard?.text).toContain(`Responsável: ${ana.name}`)
  })

  it('não cria card de ação para card no quadrante "O que foi bom"', async () => {
    const { dev, r } = await room()
    const ana = await mkUser('AnaBom')
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Ponto bom', color: 'green', x: 100, y: 360, companyId: DEFAULT_COMPANY_ID })
    const { actionCard, actionCardCreated } = await updateCard({
      roomId: r.id,
      cardId: card.id,
      userId: dev.id,
      actionPlan: 'Plano X',
      actionResponsible: ana.id,
      actionDueDate: '2026-06-30',
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(actionCardCreated).toBe(false)
    expect(actionCard).toBeNull()
  })

  it('rejeita responsável inexistente (400)', async () => {
    const { dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    await expect(
      updateCard({ roomId: r.id, cardId: card.id, userId: dev.id, actionResponsible: 'id-invalido', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita responsável de outra empresa (400)', async () => {
    const { dev, r } = await room()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Responsavel', slug: 'outra-empresa-retro-resp-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaRetroResponsavel', email: 'fora-retro-resp@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'Falhou deploy', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    await expect(
      updateCard({ roomId: r.id, cardId: card.id, userId: dev.id, actionResponsible: outsider.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('createCard/updateCard/updateCardPosition/deleteCard tratam card de outra empresa como inexistente (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Card', slug: 'outra-empresa-retro-card-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroCard', email: 'lead-outra-empresa-retro-card@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroCard', slug: 'squad-outra-empresa-retro-card-test', companyId: otherCompany.id } })
    const roomOutraEmpresa = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const cardOutraEmpresa = await prisma.retroCard.create({
      data: { roomId: roomOutraEmpresa.id, authorId: leadOutraEmpresa.id, text: 'de outra empresa', color: 'yellow', kind: 'note', x: 0, y: 0, companyId: otherCompany.id },
    })
    const { dev, r } = await room()

    await expect(
      createCard({ roomId: roomOutraEmpresa.id, userId: dev.id, text: 'x', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      updateCard({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, text: 'x', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      updateCardPosition({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, x: 1, y: 1, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      deleteCard({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
```

Modify `apps/api/src/services/retro-vote-service.test.ts` — arquivo inteiro:

```ts
// apps/api/src/services/retro-vote-service.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { addVote, advancePhase, createCard, createRoom, removeVote, toggleReaction } from './retro-service'

async function mkUser(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function mkSquad(name = 'Squad') {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
}
async function openRoomWithCard(votes = 2) {
  const lead = await mkUser('L', 'LEAD')
  const dev = await mkUser('D', 'LEGEND')
  const squad = await mkSquad()
  const r = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: votes, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
  const card = await createCard({ roomId: r.id, userId: dev.id, text: 'bom', color: 'yellow', x: 0, y: 0, companyId: DEFAULT_COMPANY_ID })
  return { lead, dev, r, card }
}

describe('retro-service: votos e reações', () => {
  it('empilha dots e respeita o orçamento', async () => {
    const { dev, r, card } = await openRoomWithCard(2)
    expect((await addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).voteCount).toBe(1)
    expect((await addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).voteCount).toBe(2)
    await expect(addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 409 })
  })

  it('removeVote tira um dot por vez', async () => {
    const { dev, r, card } = await openRoomWithCard(2)
    await addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })
    await addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })
    expect((await removeVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).voteCount).toBe(1)
  })

  it('toggle de reação adiciona e remove', async () => {
    const { dev, r, card } = await openRoomWithCard()
    const added = await toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🔥', companyId: DEFAULT_COMPANY_ID })
    expect(added.reactions).toHaveLength(1)
    const removed = await toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🔥', companyId: DEFAULT_COMPANY_ID })
    expect(removed.reactions).toHaveLength(0)
  })

  it('rejeita emoji fora da paleta (400)', async () => {
    const { dev, r, card } = await openRoomWithCard()
    await expect(toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🤡', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('não vota em sala concluída (409)', async () => {
    const { lead, dev, r, card } = await openRoomWithCard(2)
    await advancePhase({ roomId: r.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })
    await expect(addVote({ roomId: r.id, cardId: card.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 409 })
  })

  it('addVote/removeVote/toggleReaction tratam card de outra empresa como inexistente (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Voto', slug: 'outra-empresa-retro-voto-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroVoto', email: 'lead-outra-empresa-retro-voto@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroVoto', slug: 'squad-outra-empresa-retro-voto-test', companyId: otherCompany.id } })
    const roomOutraEmpresa = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const cardOutraEmpresa = await prisma.retroCard.create({
      data: { roomId: roomOutraEmpresa.id, authorId: leadOutraEmpresa.id, text: 'de outra empresa', color: 'yellow', kind: 'note', x: 0, y: 0, companyId: otherCompany.id },
    })
    const { dev, r } = await openRoomWithCard()

    await expect(addVote({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    await expect(removeVote({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
    await expect(toggleReaction({ roomId: r.id, cardId: cardOutraEmpresa.id, userId: dev.id, emoji: '🔥', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts src/services/retro-card-service.test.ts src/services/retro-vote-service.test.ts`
Expected: FAIL — erro de compilação (`createCard`/`updateCard`/`updateCardPosition`/`deleteCard`/
`addVote`/`removeVote`/`toggleReaction` ainda não aceitam `companyId`); depois de corrigir a
compilação localmente pra rodar, os 3 novos testes de isolamento falhariam (card de outra empresa
hoje é encontrado normalmente via `loadCard`/`prisma` cru).

- [ ] **Step 3: Implementar o escopo nas funções de card/voto/reação/ação**

Modify `apps/api/src/services/retro-service.ts` — trocar `loadCard`:

```ts
export async function loadCard(roomId: string, cardId: string, companyId: string): Promise<RetroCardWithRelations> {
  const card = await scopedPrisma(companyId).retroCard.findFirst({
    where: { id: cardId, roomId },
    include: { author: true, votes: true, reactions: true, editedBy: true },
  })
  if (!card) throw new RetroError('Card não encontrado.', 404)
  return card
}
```

Trocar `assertResponsible`:

```ts
/** Garante que o responsável (quando informado) é um usuário válido da mesma empresa — base para o futuro vínculo com o perfil. */
async function assertResponsible(responsibleId: string | null | undefined, companyId: string): Promise<void> {
  if (!responsibleId) return
  const user = await scopedPrisma(companyId).user.findUnique({ where: { id: responsibleId }, select: { id: true } })
  if (!user) throw new RetroError('Responsável inválido.', 400)
}
```

Trocar `resolveResponsibleName`:

```ts
/** `actionResponsible` guarda o ID do usuário; resolvemos para o nome ao montar o texto. */
async function resolveResponsibleName(responsibleId: string | null, companyId: string): Promise<string | null> {
  if (!responsibleId) return responsibleId
  const user = await scopedPrisma(companyId).user.findUnique({ where: { id: responsibleId }, select: { name: true } })
  return user?.name ?? responsibleId
}
```

Trocar `countCarryover` (usa `room.companyId`, sem parâmetro novo):

```ts
async function countCarryover(room: RetroRoomWithRelations): Promise<number> {
  const sources = await priorConcludedSquadRooms(room)
  if (sources.length === 0) return 0
  const cards = await scopedPrisma(room.companyId).retroCard.findMany({
    where: { roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
    select: { actionDone: true, auditStatus: true, actionDueDate: true },
  })
  const roomDate = room.createdAt.toISOString().slice(0, 10)
  const toValidate = cards.filter((c) => c.actionDone && c.auditStatus == null).length
  const overdue = cards.filter((c) => !c.actionDone && (c.actionDueDate ?? '') <= roomDate).length
  return toValidate + overdue
}
```

Trocar `upsertActionCard` (usa `room.companyId`, sem parâmetro novo):

```ts
async function upsertActionCard(room: RetroRoomWithRelations, source: RetroCardWithRelations): Promise<{ card: RetroCardWithRelations | null; created: boolean }> {
  if (source.kind !== 'note') return { card: null, created: false }
  if (!RETRO_ACTION_REGION_IDS.some((rid) => isCardInRegion(source, rid))) return { card: null, created: false }
  const db = scopedPrisma(room.companyId)

  const text = actionCardText(source, await resolveResponsibleName(source.actionResponsible, room.companyId))
  // Espelho já existe: mantém sempre em sincronia com a origem (reflete qualquer edição, mesmo parcial).
  if (source.actionCardId) {
    const existing = await db.retroCard.findFirst({ where: { id: source.actionCardId, roomId: room.id } })
    if (existing) {
      await db.retroCard.update({ where: { id: existing.id }, data: { text } })
      return { card: await loadCard(room.id, existing.id, room.companyId), created: false }
    }
  }

  // Ainda sem espelho: só cria quando a ação está completa (plano + responsável + prazo).
  if (!source.actionPlan || !source.actionResponsible || !source.actionDueDate) return { card: null, created: false }

  const actions = RETRO_REGIONS.find((r) => r.id === 'actions')
  const actionCount = await db.retroCard.count({ where: { roomId: room.id, x: { gte: actions?.x ?? 0 } } })
  // Novo espelho entra logo na sequência dos cards de carry-over (fixos no topo), grade única de 240px.
  const slot = (await countCarryover(room)) + actionCount
  const x = (actions?.x ?? 2320) + 40 + (slot % 4) * 240
  const y = (actions?.y ?? 280) + 80 + Math.floor(slot / 4) * 240
  const created = await db.retroCard.create({
    data: { roomId: room.id, authorId: source.authorId, text, color: 'blue', kind: 'note', x, y },
  })
  await db.retroCard.update({ where: { id: source.id }, data: { actionCardId: created.id } })
  return { card: await loadCard(room.id, created.id, room.companyId), created: true }
}
```

Trocar `createCard`:

```ts
export async function createCard(input: {
  roomId: string
  userId: string
  companyId: string
  text?: string
  color: string
  x: number
  y: number
  kind?: string
  shape?: string
  shapeStyle?: string
  width?: number
  height?: number
  actionPlan?: string
  actionResponsible?: string
  actionDueDate?: string
}): Promise<RetroCardWithRelations> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  const kind = assertKind(input.kind ?? 'note')
  const text = kind === 'note' ? assertText(input.text ?? '') : (input.text ?? '').trim().slice(0, MAX_CARD_LENGTH)
  const color = assertColor(input.color)
  const shape = assertShape(input.shape, kind)
  const shapeStyle = assertShapeStyle(input.shapeStyle, kind)
  const width = kind === 'shape' ? assertDimension(input.width, SHAPE_WIDTH) : null
  const height = kind === 'shape' ? assertDimension(input.height, SHAPE_HEIGHT) : null
  const actionPlan = optionalText(input.actionPlan, MAX_CARD_LENGTH)
  const actionResponsible = optionalText(input.actionResponsible, 120)
  await assertResponsible(actionResponsible, input.companyId)
  const actionDueDate = optionalText(input.actionDueDate, 20)
  const created = await scopedPrisma(input.companyId).retroCard.create({
    data: { roomId: room.id, authorId: input.userId, text, color, kind, shape, shapeStyle, width, height, actionPlan, actionResponsible, actionDueDate, x: input.x, y: input.y },
  })
  return loadCard(room.id, created.id, input.companyId)
}
```

Trocar `updateCard`:

```ts
export async function updateCard(input: {
  roomId: string
  cardId: string
  userId: string
  companyId: string
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
  const room = await loadRoom(input.roomId, input.companyId)
  const card = await loadCard(input.roomId, input.cardId, input.companyId)
  const postConclusion = room.status === 'CONCLUDED'
  if (postConclusion) {
    if (!isLeaderRole(input.role)) throw new RetroError('A sala foi concluída.', 409)
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
    await assertResponsible(data.actionResponsible, input.companyId)
  }
  if (input.actionDueDate !== undefined) data.actionDueDate = optionalText(input.actionDueDate, 20)
  if (postConclusion) {
    data.editedById = input.userId
    data.editedAt = new Date()
  }
  if (Object.keys(data).length > 0) await scopedPrisma(input.companyId).retroCard.update({ where: { id: card.id }, data })
  const updated = await loadCard(input.roomId, card.id, input.companyId)
  if (postConclusion) await logEdit(room.id, input.userId, 'action.updated', updated.actionPlan ?? updated.text, input.companyId)
  const action = await upsertActionCard(room, updated)
  const refreshed = action.created ? await loadCard(input.roomId, card.id, input.companyId) : updated
  return { card: refreshed, actionCard: action.card, actionCardCreated: action.created }
}
```

Trocar `updateCardPosition`:

```ts
/** Qualquer participante pode mover qualquer card (canvas livre). */
export async function updateCardPosition(input: {
  roomId: string
  cardId: string
  userId: string
  companyId: string
  x: number
  y: number
}): Promise<{ x: number; y: number }> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  const card = await loadCard(input.roomId, input.cardId, input.companyId)
  await scopedPrisma(input.companyId).retroCard.update({ where: { id: card.id }, data: { x: input.x, y: input.y } })
  return { x: input.x, y: input.y }
}
```

Trocar `deleteCard`:

```ts
export async function deleteCard(input: { roomId: string; cardId: string; userId: string; companyId: string }): Promise<void> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertOpen(room)
  const card = await loadCard(input.roomId, input.cardId, input.companyId)
  if (card.authorId !== input.userId) throw new RetroError('Apenas o autor exclui o card.', 403)
  await scopedPrisma(input.companyId).retroCard.delete({ where: { id: card.id } })
}
```

Trocar `countUserVotesInRoom`:

```ts
export function countUserVotesInRoom(roomId: string, userId: string, companyId: string): Promise<number> {
  return scopedPrisma(companyId).retroVote.count({ where: { userId, card: { roomId } } })
}
```

Trocar `addVote`:

```ts
export async function addVote(input: { roomId: string; cardId: string; userId: string; companyId: string }): Promise<{ voteCount: number }> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  await loadCard(input.roomId, input.cardId, input.companyId)
  const used = await countUserVotesInRoom(input.roomId, input.userId, input.companyId)
  if (used >= room.votesPerParticipant) throw new RetroError('Você já usou todos os seus votos.', 409)
  const db = scopedPrisma(input.companyId)
  await db.retroVote.create({ data: { cardId: input.cardId, userId: input.userId } })
  return { voteCount: await db.retroVote.count({ where: { cardId: input.cardId } }) }
}
```

Trocar `removeVote`:

```ts
export async function removeVote(input: { roomId: string; cardId: string; userId: string; companyId: string }): Promise<{ voteCount: number }> {
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  const db = scopedPrisma(input.companyId)
  const one = await db.retroVote.findFirst({
    where: { cardId: input.cardId, userId: input.userId, card: { roomId: input.roomId } },
    orderBy: { createdAt: 'desc' },
  })
  if (one) await db.retroVote.delete({ where: { id: one.id } })
  return { voteCount: await db.retroVote.count({ where: { cardId: input.cardId } }) }
}
```

Trocar `toggleReaction`:

```ts
export async function toggleReaction(input: {
  roomId: string
  cardId: string
  userId: string
  emoji: string
  companyId: string
}): Promise<RetroCardWithRelations> {
  if (!(RETRO_REACTION_EMOJIS as readonly string[]).includes(input.emoji)) throw new RetroError('Reação inválida.', 400)
  const room = await loadRoom(input.roomId, input.companyId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  await loadCard(input.roomId, input.cardId, input.companyId)
  const db = scopedPrisma(input.companyId)
  const existing = await db.retroReaction.findUnique({
    where: { cardId_userId_emoji: { cardId: input.cardId, userId: input.userId, emoji: input.emoji } },
  })
  if (existing) await db.retroReaction.delete({ where: { id: existing.id } })
  else await db.retroReaction.create({ data: { cardId: input.cardId, userId: input.userId, emoji: input.emoji } })
  return loadCard(input.roomId, input.cardId, input.companyId)
}
```

Trocar `updateAction`:

```ts
export async function updateAction(input: { cardId: string; userId: string; done?: boolean; note?: string; companyId: string }) {
  const db = scopedPrisma(input.companyId)
  const card = await db.retroCard.findUnique({
    where: { id: input.cardId },
    include: { room: { select: { sprint: true, archivedAt: true } } },
  })
  if (!card || card.room.archivedAt || !card.actionPlan || !card.actionResponsible || !card.actionDueDate) {
    throw new RetroError('Ação não encontrada.', 404)
  }
  if (card.actionResponsible !== input.userId) throw new RetroError('Apenas o responsável trata a ação.', 403)
  const data: Prisma.RetroCardUncheckedUpdateInput = {}
  if (input.done !== undefined) {
    // Espelha o comportamento anterior de setActionDone: concluir/reabrir reseta a auditoria.
    data.actionDone = input.done
    data.actionDoneAt = input.done ? new Date() : null
    data.auditStatus = null
    data.auditedById = null
    data.auditedAt = null
  }
  if (input.note !== undefined) {
    const trimmed = input.note.trim()
    data.actionNote = trimmed.length === 0 ? null : trimmed
  }
  return db.retroCard.update({
    where: { id: card.id },
    data,
    include: { room: { select: { sprint: true, squads: { select: { squad: { select: { name: true } } } } } } },
  })
}
```

Trocar `logEdit`:

```ts
export function logEdit(roomId: string, editorId: string, action: string, detail: string | null, companyId: string): Promise<unknown> {
  return scopedPrisma(companyId).retroEdit.create({ data: { roomId, editorId, action, detail } })
}
```

(`priorConcludedSquadRooms`, `listEdits`, `listCarryover` e `setCarryover` ficam inalterados
nesta task — Task 4 cuida deles; `priorConcludedSquadRooms` já é chamado por `countCarryover`
acima, mas sua própria assinatura/implementação só muda na Task 4 já que ela mesma ainda usa
`prisma` cru — isso é seguro porque `room.squads`/`room.id`/`room.createdAt` já vêm de um `room`
carregado via `loadRoom` escopado, então o resultado de `countCarryover`/`upsertActionCard`
continua correto mesmo com `priorConcludedSquadRooms` não-escopado nesta task intermediária —
squads de outra empresa nunca aparecem em `room.squads` pois a própria sala já é da empresa
correta.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts src/services/retro-card-service.test.ts src/services/retro-vote-service.test.ts`
Expected: PASS em todos os 3 arquivos, incluindo os novos testes de isolamento.

- [ ] **Step 5: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros só em `apps/api/src/routes/retro.ts`, `apps/api/src/routes/admin.ts`,
`apps/api/src/lib/retro-hub.ts`, `apps/api/src/routes/retro-ws.ts` (rotas/hub, fora de escopo —
sub-fatias 2/3). Nenhum erro dentro de `retro-service.ts` ou dos 3 arquivos de teste de service.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-service.test.ts apps/api/src/services/retro-card-service.test.ts apps/api/src/services/retro-vote-service.test.ts
git commit -m "feat: escopa cards/votos/reações/ações de retro por empresa"
```

---

### Task 4: Carry-over cross-sala e histórico de edições

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/services/retro-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma(companyId)` (Task 1), `loadRoom(roomId, companyId)` (Task 2),
  `loadCard(roomId, cardId, companyId)`, `upsertActionCard(room, source)` (Task 3).
- Produces:
  ```ts
  listEdits(roomId: string, viewer: { id, role }, companyId: string)
  listCarryover(roomId: string, viewer: { id, role }, companyId: string)
  setCarryover(input: { roomId, cardId, userId, role, action, dueDate?, companyId: string }): Promise<{ card, responsible, sprint }>
  ```
  (`priorConcludedSquadRooms` é privada, ganha `room.companyId` internamente — o parâmetro `room`
  que ela recebe já inclui `companyId` desde a Task 1, e passa a exigir esse campo no seu tipo.)

`listEdits`/`listCarryover`/`setCarryover` não têm hoje nenhum teste de service direto (só
indireto via rota, fora de escopo) — este task adiciona a cobertura mínima exigida pela spec.

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/services/retro-service.test.ts` — o import existente (montado na Task 2)
tem `advancePhase, archiveRoom, createCard, createRoom, getRoomForViewer, getRoomMeta,
hardDeleteRoom, listRoomsForAdmin, listRoomsForUser, resolveRole, setAnonymous, setParticipants,
updateRoomAsAdmin` — faltam `listCarryover`, `listEdits`, `setCarryover` e `updateCard` (nenhum
dos 4 foi importado nas tasks anteriores). Trocar o bloco de import por:

```ts
import {
  advancePhase,
  archiveRoom,
  createCard,
  createRoom,
  getRoomForViewer,
  getRoomMeta,
  hardDeleteRoom,
  listCarryover,
  listEdits,
  listRoomsForAdmin,
  listRoomsForUser,
  resolveRole,
  setAnonymous,
  setCarryover,
  setParticipants,
  updateCard,
  updateRoomAsAdmin,
} from './retro-service'
```

Adicionar ao final do arquivo:

```ts

describe('retro-service: carry-over e histórico de edições — isolamento por empresa', () => {
  it('listEdits/listCarryover/setCarryover tratam sala de outra empresa como inexistente', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Retro Carryover', slug: 'outra-empresa-retro-carryover-test' } })
    const leadOutraEmpresa = await prisma.user.create({
      data: { name: 'LeadOutraEmpresaRetroCarryover', email: 'lead-outra-empresa-retro-carryover@x.com', passwordHash: 'x', role: 'LEAD', companyId: otherCompany.id },
    })
    const squadOutraEmpresa = await prisma.squad.create({ data: { name: 'SquadOutraEmpresaRetroCarryover', slug: 'squad-outra-empresa-retro-carryover-test', companyId: otherCompany.id } })
    const roomOutraEmpresa = await prisma.retroRoom.create({
      data: { sprint: 1, createdById: leadOutraEmpresa.id, votesPerParticipant: 3, companyId: otherCompany.id, squads: { create: { squadId: squadOutraEmpresa.id, companyId: otherCompany.id } } },
    })
    const cardOutraEmpresa = await prisma.retroCard.create({
      data: { roomId: roomOutraEmpresa.id, authorId: leadOutraEmpresa.id, text: 'de outra empresa', color: 'yellow', kind: 'note', x: 0, y: 0, companyId: otherCompany.id },
    })
    const actor = await mkUser('AtorRetroCarryover', 'ADMIN')

    await expect(listEdits(roomOutraEmpresa.id, { id: actor.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    await expect(listCarryover(roomOutraEmpresa.id, { id: actor.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    await expect(
      setCarryover({ roomId: roomOutraEmpresa.id, cardId: cardOutraEmpresa.id, userId: actor.id, role: 'ADMIN', action: 'validate', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('listCarryover só considera salas concluídas da mesma squad e empresa', async () => {
    const lead = await mkUser('LeadCarryoverEmpresa', 'LEAD')
    const dev = await mkUser('DevCarryoverEmpresa', 'LEGEND')
    const squad = await mkSquad('SquadCarryoverEmpresa')
    const prevRoom = await createRoom({ creatorId: lead.id, sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    const prevCard = await createCard({ roomId: prevRoom.id, userId: dev.id, text: 'ação vencida', color: 'pink', x: 1200, y: 360, companyId: DEFAULT_COMPANY_ID })
    await updateCard({
      roomId: prevRoom.id, cardId: prevCard.id, userId: dev.id,
      actionPlan: 'Plano', actionResponsible: dev.id, actionDueDate: '2020-01-01', companyId: DEFAULT_COMPANY_ID,
    })
    await advancePhase({ roomId: prevRoom.id, userId: lead.id, action: 'conclude', companyId: DEFAULT_COMPANY_ID })

    const currentRoom = await createRoom({ creatorId: lead.id, sprint: 2, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id], companyId: DEFAULT_COMPANY_ID })
    const { overdue } = await listCarryover(currentRoom.id, { id: lead.id, role: 'LEAD' }, DEFAULT_COMPANY_ID)
    expect(overdue.some((item) => item.card.id === prevCard.id)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts`
Expected: FAIL — erro de compilação (`listEdits`/`listCarryover`/`setCarryover` ainda não aceitam
`companyId`); depois de corrigir a compilação localmente, o primeiro novo teste falharia (sala de
outra empresa hoje é encontrada normalmente).

- [ ] **Step 3: Implementar o escopo**

Modify `apps/api/src/services/retro-service.ts` — trocar `priorConcludedSquadRooms`:

```ts
function priorConcludedSquadRooms(room: { id: string; companyId: string; createdAt: Date; squads: { squadId: string }[] }) {
  const squadIds = room.squads.map((s) => s.squadId)
  if (squadIds.length === 0) return Promise.resolve([] as { id: string; sprint: number }[])
  return scopedPrisma(room.companyId).retroRoom.findMany({
    where: { id: { not: room.id }, archivedAt: null, status: 'CONCLUDED', concludedAt: { lt: room.createdAt }, squads: { some: { squadId: { in: squadIds } } } },
    select: { id: true, sprint: true },
  })
}
```

Trocar `listEdits`:

```ts
export async function listEdits(roomId: string, viewer: { id: string; role: string }, companyId: string) {
  const room = await loadRoom(roomId, companyId)
  if (!resolveRole(room, viewer)) throw new RetroError('Sala não encontrada.', 404)
  return scopedPrisma(companyId).retroEdit.findMany({
    where: { roomId },
    include: { editor: true },
    orderBy: { createdAt: 'desc' },
  })
}
```

Trocar `listCarryover`:

```ts
export async function listCarryover(roomId: string, viewer: { id: string; role: string }, companyId: string) {
  const room = await loadRoom(roomId, companyId)
  if (!resolveRole(room, viewer)) throw new RetroError('Sala não encontrada.', 404)
  const sources = await priorConcludedSquadRooms(room)
  if (sources.length === 0) return { toValidate: [], overdue: [] }
  const sprintByRoom = new Map(sources.map((s) => [s.id, s.sprint]))
  const db = scopedPrisma(companyId)
  const cards = await db.retroCard.findMany({
    where: { roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
    include: { author: true },
  })
  const roomDate = room.createdAt.toISOString().slice(0, 10)
  const toValidate = cards.filter((c) => c.actionDone && c.auditStatus == null)
    .sort((a, b) => (b.actionDoneAt?.getTime() ?? 0) - (a.actionDoneAt?.getTime() ?? 0))
  const overdue = cards.filter((c) => !c.actionDone && (c.actionDueDate ?? '') <= roomDate)
    .sort((a, b) => (a.actionDueDate ?? '').localeCompare(b.actionDueDate ?? ''))
  const respIds = [...new Set([...toValidate, ...overdue].map((c) => c.actionResponsible).filter((x): x is string => Boolean(x)))]
  const users = await db.user.findMany({ where: { id: { in: respIds } } })
  const byId = new Map(users.map((u) => [u.id, u]))
  const item = (c: (typeof cards)[number]) => ({
    card: c,
    responsible: c.actionResponsible ? byId.get(c.actionResponsible) ?? null : null,
    sprint: sprintByRoom.get(c.roomId) ?? 0,
  })
  return { toValidate: toValidate.map(item), overdue: overdue.map(item) }
}
```

Trocar `setCarryover`:

```ts
export async function setCarryover(input: {
  roomId: string
  cardId: string
  userId: string
  role: string
  action: 'validate' | 'reject' | 'reschedule' | 'done'
  dueDate?: string
  companyId: string
}): Promise<{ card: RetroCard; responsible: User | null; sprint: number }> {
  const room = await loadRoom(input.roomId, input.companyId)
  if (!resolveRole(room, { id: input.userId, role: input.role })) throw new RetroError('Sala não encontrada.', 404)
  if (!isLeaderRole(input.role)) throw new RetroError('Apenas líderes resolvem ações de outras sprints.', 403)
  const sources = await priorConcludedSquadRooms(room)
  const db = scopedPrisma(input.companyId)
  const card = await db.retroCard.findFirst({
    where: { id: input.cardId, roomId: { in: sources.map((s) => s.id) }, actionPlan: { not: null }, actionResponsible: { not: null }, actionDueDate: { not: null } },
  })
  if (!card) throw new RetroError('Ação não encontrada para esta sala.', 404)
  const now = new Date()
  let data: Record<string, unknown>
  if (input.action === 'validate') data = { auditStatus: 'VALIDATED', auditedById: input.userId, auditedAt: now }
  else if (input.action === 'reject') data = { auditStatus: 'REJECTED', auditedById: input.userId, auditedAt: now, actionDone: false, actionDoneAt: null }
  else if (input.action === 'done') data = { actionDone: true, actionDoneAt: now, auditStatus: null, auditedById: null, auditedAt: null }
  else {
    const due = optionalText(input.dueDate, 20)
    if (!due) throw new RetroError('Novo prazo inválido.', 400)
    data = { actionDueDate: due }
  }
  await db.retroCard.update({ where: { id: card.id }, data })
  const updated = await loadCard(card.roomId, card.id, input.companyId)
  const sourceRoom = await loadRoom(card.roomId, input.companyId)
  if (input.action === 'reschedule') {
    await upsertActionCard(sourceRoom, updated)
  }
  const responsible = updated.actionResponsible ? await db.user.findUnique({ where: { id: updated.actionResponsible } }) : null
  return { card: updated, responsible, sprint: sourceRoom.sprint }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts`
Expected: PASS em todos os describes, incluindo `'retro-service: carry-over e histórico de
edições — isolamento por empresa'`.

- [ ] **Step 5: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros só em `apps/api/src/routes/retro.ts`, `apps/api/src/routes/admin.ts`,
`apps/api/src/lib/retro-hub.ts`, `apps/api/src/routes/retro-ws.ts` (sub-fatias 2/3, fora de
escopo). Nenhum erro dentro de `retro-service.ts` ou de qualquer um dos 3 arquivos de teste de
service.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-service.test.ts
git commit -m "feat: escopa carry-over e histórico de edições de retro por empresa"
```

---

### Task 5: Verificação final

**Files:** nenhum (só execução de comandos)

- [ ] **Step 1: Testes de service desta sub-fatia**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts src/services/retro-card-service.test.ts src/services/retro-vote-service.test.ts`
Expected: PASS em todos os 3 arquivos.

- [ ] **Step 2: Testes que só tocam schema/allowlist (não deveriam ter quebrado)**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-schema.test.ts src/services/retro-canvas-schema.test.ts src/lib/serialize-retro.test.ts`
Expected: PASS (esses arquivos testam validação/serialização pura, não chamam `retro-service.ts`
com as novas assinaturas — confirmar que não foram afetados).

- [ ] **Step 3: Typecheck — confirmar o handoff esperado**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros **apenas** em `apps/api/src/routes/retro.ts`, o trecho de retro em
`apps/api/src/routes/admin.ts`, `apps/api/src/lib/retro-hub.ts` e
`apps/api/src/routes/retro-ws.ts` (chamadas às funções de `retro-service.ts` sem o novo
`companyId` obrigatório — handoff intencional pras sub-fatias 2 e 3). Qualquer erro em
`apps/api/src/services/retro-service.ts` ou em qualquer `*.test.ts` de service precisa ser
investigado e corrigido antes de prosseguir — não é esperado.

- [ ] **Step 4: Não rodar a suíte completa nem os testes de rota de Retro**

`apps/api/src/routes/retro.test.ts`, `retro-admin.test.ts`, `retro-carryover.test.ts`,
`retro-edit.test.ts`, `retro-ws.test.ts` e a suíte completa (`pnpm test`) **vão falhar** nesta
sub-fatia — as rotas ainda chamam `retro-service.ts` com as assinaturas antigas. Isso é esperado
e será corrigido na sub-fatia 2 (rotas) e 3 (hub/ws); não é sinal de regressão nesta sub-fatia.
Não gaste tempo investigando essas falhas agora.
