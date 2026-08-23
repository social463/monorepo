# Board de Retrospectiva (tempo real) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir um board de retrospectiva de sprint colaborativo em tempo real, onde um LEAD abre salas, convida participantes e o time preenche 5 colunas, com fases (coleta → revelada → concluída), dot voting, reações e atualização ao vivo via WebSocket.

**Architecture:** Mutações via REST (route → service → Prisma, padrão do repo); o handler persiste e publica eventos num hub em memória; o WebSocket é push-only (servidor → clientes) + presença. Postgres é a fonte da verdade.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL, `@fastify/websocket` v8, Zod; React 18 + React Query + React Router 6; tipos compartilhados em `@legends/shared`. Vitest (API contra Postgres real; web jsdom).

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`), Node ≥ 20.
- Mensagens voltadas ao usuário em **português**.
- Camadas finas: route valida (Zod `safeParse` → `400 { message, issues }`) e serializa; service tem a regra de negócio com classe de erro tipada (`RetroError` com `status`); `instanceof` na route. Erros inesperados sobem.
- Contrato em `@legends/shared` **primeiro**, depois os dois lados.
- DTO de saída em `lib/serialize.ts`.
- Auth: rotas com `onRequest: [app.authenticate]`; `request.user.sub` = id, `request.user.role`.
- Notificação/efeitos colaterais são **best-effort** (falha logada via `request.log.error`, não derruba a operação).
- Testes da API exigem Postgres de pé (`pnpm db:up`); `test/setup.ts` trunca tabelas em `beforeEach` (`fileParallelism: false`).
- Deploy é **instância única** — hub em memória é aceitável (Redis é evolução futura, fora do escopo).
- **Nunca** editar migration já aplicada; gerar nova com `pnpm db:migrate`.
- Spec de referência: `docs/superpowers/specs/2026-06-18-retrospectiva-board-design.md`.

---

## Mapa de arquivos

**`packages/shared`**
- Create: `packages/shared/src/retro.ts` — enums, constantes, DTOs, `RetroEvent`, requests.
- Modify: `packages/shared/src/index.ts` — exportar `./retro`.

**`apps/api`**
- Modify: `apps/api/prisma/schema.prisma` — enums `RetroRoomStatus`/`RetroColumn`, models `RetroRoom`/`RetroParticipant`/`RetroCard`/`RetroVote`/`RetroReaction`, relações em `User`, valor `RETRO_INVITED` em `NotificationType`.
- Modify: `apps/api/test/setup.ts` — truncar as novas tabelas.
- Modify: `apps/api/package.json` — `@fastify/websocket`, `ws`, `@types/ws`.
- Create: `apps/api/src/lib/retro-hub.ts` — registro de conexões em memória + broadcast/presença.
- Create: `apps/api/src/services/retro-service.ts` — regra de negócio.
- Modify: `apps/api/src/lib/serialize.ts` — `toRetroCardDTO`, `toRetroRoomDTO`, `toRetroRoomSummaryDTO`.
- Modify: `apps/api/src/services/notification-service.ts` — `notifyRetroInvited`.
- Create: `apps/api/src/routes/retro.ts` — rotas REST.
- Create: `apps/api/src/routes/retro-ws.ts` — rota WebSocket.
- Modify: `apps/api/src/app.ts` — registrar `@fastify/websocket` + as duas rotas.

**`apps/web`**
- Create: `apps/web/src/lib/retro-api.ts` — chamadas REST tipadas.
- Create: `apps/web/src/lib/useRetroSocket.ts` — hook do WebSocket.
- Create: `apps/web/src/pages/RetrosPage.tsx` — lista + modal de criação.
- Create: `apps/web/src/pages/RetroRoomPage.tsx` — o board.
- Modify: `apps/web/src/App.tsx` — rotas `/retrospectivas` e `/retrospectivas/:id`.
- Modify: `apps/web/src/components/AppLayout.tsx` — item de navegação (oculto para ADMIN).

---
### Task 1: Contrato compartilhado (`@legends/shared`)

**Files:**
- Create: `packages/shared/src/retro.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/retro.test.ts`

**Interfaces:**
- Produces: enums `RETRO_ROOM_STATUS`, `RETRO_COLUMNS`, `RETRO_REACTION_EMOJIS`, `RETRO_ROOM_ROLES`; constantes `RETRO_COLUMN_LABELS`, `MAX_CARD_LENGTH`, `MIN_CARD_LENGTH`, `MAX_ROOM_TITLE_LENGTH`, `MIN_VOTES_PER_PARTICIPANT`, `MAX_VOTES_PER_PARTICIPANT`; tipos `RetroRoomStatus`, `RetroColumn`, `RetroReactionEmoji`, `RetroRoomRole`, `RetroReactionSummary`, `RetroCardDTO`, `RetroParticipantDTO`, `RetroColumnCounts`, `RetroRoomSummaryDTO`, `RetroRoomDTO`, `RetroEvent`; requests `CreateRetroRoomRequest`, `UpdateParticipantsRequest`, `CreateRetroCardRequest`, `UpdateRetroCardRequest`, `RetroPhaseRequest`, `RetroPhaseAction`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/retro.test.ts
import { describe, it, expect } from 'vitest'
import { RETRO_COLUMNS, RETRO_COLUMN_LABELS, RETRO_ROOM_STATUS } from './retro'

describe('retro shared contract', () => {
  it('tem as 5 colunas na ordem do board', () => {
    expect(RETRO_COLUMNS).toEqual(['WENT_WELL', 'WENT_BAD', 'START', 'STOP', 'ACTIONS'])
  })

  it('rotula toda coluna em português', () => {
    for (const col of RETRO_COLUMNS) {
      expect(RETRO_COLUMN_LABELS[col]).toBeTruthy()
    }
  })

  it('expõe os três estados da sala', () => {
    expect(RETRO_ROOM_STATUS).toEqual(['COLLECTING', 'REVEALED', 'CONCLUDED'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/shared exec vitest run src/retro.test.ts`
Expected: FAIL — `Cannot find module './retro'`.

> Se `@legends/shared` ainda não tiver `vitest` configurado, o teste serve apenas como verificação local; a verificação canônica desta task é o type-check (`pnpm --filter @legends/shared build`). Mantenha o arquivo de teste mesmo assim.

- [ ] **Step 3: Write the contract**

```ts
// packages/shared/src/retro.ts
import type { PublicUser } from './auth'

export const RETRO_ROOM_STATUS = ['COLLECTING', 'REVEALED', 'CONCLUDED'] as const
export type RetroRoomStatus = (typeof RETRO_ROOM_STATUS)[number]

export const RETRO_COLUMNS = ['WENT_WELL', 'WENT_BAD', 'START', 'STOP', 'ACTIONS'] as const
export type RetroColumn = (typeof RETRO_COLUMNS)[number]

export const RETRO_COLUMN_LABELS: Record<RetroColumn, string> = {
  WENT_WELL: 'O que foi bom',
  WENT_BAD: 'O que foi ruim',
  START: 'O que precisamos começar',
  STOP: 'O que precisamos parar',
  ACTIONS: 'Ações',
}

export const RETRO_ROOM_ROLES = ['FACILITATOR', 'PARTICIPANT', 'OBSERVER'] as const
export type RetroRoomRole = (typeof RETRO_ROOM_ROLES)[number]

export const RETRO_REACTION_EMOJIS = ['👍', '❤️', '🎯', '💡', '🚀', '🔥'] as const
export type RetroReactionEmoji = (typeof RETRO_REACTION_EMOJIS)[number]

export const MIN_CARD_LENGTH = 1
export const MAX_CARD_LENGTH = 500
export const MAX_ROOM_TITLE_LENGTH = 120
export const MIN_VOTES_PER_PARTICIPANT = 1
export const MAX_VOTES_PER_PARTICIPANT = 20

export interface RetroReactionSummary {
  emoji: RetroReactionEmoji
  count: number
  reactedByMe: boolean
}

export interface RetroCardDTO {
  id: string
  column: RetroColumn
  text: string
  createdAt: string
  updatedAt: string
  /** Autor — null em sala anônima (use `mine` para afordâncias do próprio card). */
  author: { id: string; name: string } | null
  /** true se quem vê é o autor (libera editar/excluir mesmo em sala anônima). */
  mine: boolean
  voteCount: number
  /** Quantos dots o viewer colocou neste card. */
  myVotes: number
  reactions: RetroReactionSummary[]
}

export interface RetroParticipantDTO {
  user: PublicUser
  isCreator: boolean
}

export interface RetroColumnCounts {
  WENT_WELL: number
  WENT_BAD: number
  START: number
  STOP: number
  ACTIONS: number
}

export interface RetroRoomSummaryDTO {
  id: string
  title: string
  status: RetroRoomStatus
  anonymous: boolean
  votesPerParticipant: number
  createdAt: string
  revealedAt: string | null
  concludedAt: string | null
  creator: { id: string; name: string }
  participantCount: number
  /** Papel de quem está vendo, nesta sala. */
  myRole: RetroRoomRole
}

export interface RetroRoomDTO extends RetroRoomSummaryDTO {
  participants: RetroParticipantDTO[]
  /** Cards visíveis ao viewer (em COLLECTING, só os próprios). */
  cards: RetroCardDTO[]
  /** Total de cards por coluna, incluindo os ocultos de outros. */
  columnCounts: RetroColumnCounts
  /** Votos que ainda restam ao viewer. */
  myRemainingVotes: number
}

export type RetroEvent =
  | { type: 'card.created'; card: RetroCardDTO }
  | { type: 'card.updated'; card: RetroCardDTO }
  | { type: 'card.deleted'; cardId: string; column: RetroColumn }
  | { type: 'vote.changed'; cardId: string; voteCount: number }
  | { type: 'reaction.changed'; cardId: string; reactions: RetroReactionSummary[] }
  | {
      type: 'phase.changed'
      status: RetroRoomStatus
      revealedAt: string | null
      concludedAt: string | null
    }
  | { type: 'presence.changed'; userIds: string[] }
  | { type: 'columnCounts.changed'; columnCounts: RetroColumnCounts }

export type RetroPhaseAction = 'reveal' | 'conclude'

export interface CreateRetroRoomRequest {
  title: string
  anonymous: boolean
  votesPerParticipant: number
  participantIds: string[]
}

export interface UpdateParticipantsRequest {
  participantIds: string[]
}

export interface CreateRetroCardRequest {
  column: RetroColumn
  text: string
}

export interface UpdateRetroCardRequest {
  text: string
}

export interface RetroPhaseRequest {
  action: RetroPhaseAction
}
```

- [ ] **Step 4: Export from the barrel**

Edit `packages/shared/src/index.ts` — adicione na lista de re-exports:

```ts
export * from './retro'
```

- [ ] **Step 5: Verify type-check and test**

Run: `pnpm --filter @legends/shared build`
Expected: sem erros de tipo.
Run (se houver vitest no pacote): `pnpm --filter @legends/shared exec vitest run src/retro.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/retro.ts packages/shared/src/retro.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato do board de retrospectiva"
```

---

### Task 2: Schema Prisma + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/test/setup.ts`
- Test: `apps/api/src/services/retro-schema.test.ts`

**Interfaces:**
- Produces: models Prisma `RetroRoom`, `RetroParticipant`, `RetroCard`, `RetroVote`, `RetroReaction`; enums `RetroRoomStatus` (`COLLECTING|REVEALED|CONCLUDED`), `RetroColumn` (`WENT_WELL|WENT_BAD|START|STOP|ACTIONS`); valor `RETRO_INVITED` em `NotificationType`. Cliente Prisma regenerado.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/retro-schema.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'

describe('retro schema', () => {
  it('cria sala com participante, card, voto e reação', async () => {
    const lead = await prisma.user.create({
      data: { name: 'Lia', email: 'lia@x.com', passwordHash: 'x', role: 'LEAD' },
    })
    const room = await prisma.retroRoom.create({
      data: {
        title: 'Retro Sprint 1',
        createdById: lead.id,
        anonymous: true,
        votesPerParticipant: 3,
        participants: { create: { userId: lead.id } },
      },
    })
    const card = await prisma.retroCard.create({
      data: { roomId: room.id, authorId: lead.id, column: 'WENT_WELL', text: 'Deploy tranquilo' },
    })
    await prisma.retroVote.create({ data: { cardId: card.id, userId: lead.id } })
    await prisma.retroReaction.create({ data: { cardId: card.id, userId: lead.id, emoji: '🔥' } })

    expect(await prisma.retroVote.count({ where: { cardId: card.id } })).toBe(1)
    expect(room.status).toBe('COLLECTING')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/retro-schema.test.ts`
Expected: FAIL — `prisma.retroRoom` é `undefined` (model não existe).

- [ ] **Step 3: Add enums and models to the schema**

Em `apps/api/prisma/schema.prisma`, adicione o valor ao enum existente `NotificationType`:

```prisma
enum NotificationType {
  FEEDBACK_RECEIVED
  FEEDBACK_REACTION
  BADGE_EARNED
  HIGHLIGHT_PUBLISHED
  PERIOD_OPENED
  PERIOD_CLOSED
  RETRO_INVITED
}
```

Adicione os novos enums (perto dos outros enums no topo):

```prisma
enum RetroRoomStatus {
  COLLECTING
  REVEALED
  CONCLUDED
}

enum RetroColumn {
  WENT_WELL
  WENT_BAD
  START
  STOP
  ACTIONS
}
```

Adicione os models ao final do arquivo:

```prisma
model RetroRoom {
  id                  String          @id @default(cuid())
  title               String
  createdById         String
  anonymous           Boolean         @default(false)
  votesPerParticipant Int
  status              RetroRoomStatus @default(COLLECTING)
  createdAt           DateTime        @default(now())
  revealedAt          DateTime?
  concludedAt         DateTime?

  creator      User               @relation("RetroRoomsCreated", fields: [createdById], references: [id])
  participants RetroParticipant[]
  cards        RetroCard[]

  @@index([createdById])
}

model RetroParticipant {
  id        String   @id @default(cuid())
  roomId    String
  userId    String
  invitedAt DateTime @default(now())

  room RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user User      @relation("RetroParticipations", fields: [userId], references: [id])

  @@unique([roomId, userId])
  @@index([userId])
}

model RetroCard {
  id        String      @id @default(cuid())
  roomId    String
  authorId  String
  column    RetroColumn
  text      String
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  room      RetroRoom       @relation(fields: [roomId], references: [id], onDelete: Cascade)
  author    User            @relation("RetroCards", fields: [authorId], references: [id])
  votes     RetroVote[]
  reactions RetroReaction[]

  @@index([roomId])
  @@index([authorId])
}

model RetroVote {
  id        String   @id @default(cuid())
  cardId    String
  userId    String
  createdAt DateTime @default(now())

  card RetroCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  user User      @relation("RetroVotes", fields: [userId], references: [id])

  @@index([cardId])
  @@index([userId])
}

model RetroReaction {
  id     String @id @default(cuid())
  cardId String
  userId String
  emoji  String

  card RetroCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  user User      @relation("RetroReactions", fields: [userId], references: [id])

  @@unique([cardId, userId, emoji])
  @@index([cardId])
}
```

Adicione as relações inversas dentro do model `User` (junto das outras relações):

```prisma
  retroRoomsCreated   RetroRoom[]        @relation("RetroRoomsCreated")
  retroParticipations RetroParticipant[] @relation("RetroParticipations")
  retroCards          RetroCard[]        @relation("RetroCards")
  retroVotes          RetroVote[]        @relation("RetroVotes")
  retroReactions      RetroReaction[]    @relation("RetroReactions")
```

- [ ] **Step 4: Generate the migration and client**

Run: `pnpm db:migrate` (quando pedir o nome, use `retro_board`).
Run: `pnpm db:generate`
Expected: nova pasta em `apps/api/prisma/migrations/*_retro_board/` e cliente regenerado.

- [ ] **Step 5: Add the new tables to the test truncation**

Em `apps/api/test/setup.ts`, dentro do `prisma.$transaction([...])` do `beforeEach`, adicione **antes** de `prisma.user.deleteMany()` (a ordem importa por FKs — filhos primeiro):

```ts
    prisma.retroReaction.deleteMany(),
    prisma.retroVote.deleteMany(),
    prisma.retroCard.deleteMany(),
    prisma.retroParticipant.deleteMany(),
    prisma.retroRoom.deleteMany(),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full API suite (no regressions)**

Run: `pnpm --filter @legends/api test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/setup.ts apps/api/src/services/retro-schema.test.ts
git commit -m "feat(api): schema do board de retrospectiva + migration"
```

---
### Task 3: Hub de tempo real em memória

Registro de conexões WebSocket por sala, com broadcast por-viewer (uma função decide o payload de cada conexão, permitindo respeitar anonimato/visibilidade) e presença. Unidade pura, sem DB — testável isoladamente.

**Files:**
- Create: `apps/api/src/lib/retro-hub.ts`
- Test: `apps/api/src/lib/retro-hub.test.ts`

**Interfaces:**
- Produces:
  - `interface RetroSocket { send(data: string): void }`
  - `interface RetroConnection { socket: RetroSocket; userId: string }`
  - `class RetroHub { subscribe(roomId, conn); unsubscribe(roomId, conn); presentUserIds(roomId): string[]; broadcast(roomId, build: (viewerId: string) => unknown | null): void }`
  - `const retroHub: RetroHub` (singleton).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/retro-hub.test.ts
import { describe, it, expect, vi } from 'vitest'
import { RetroHub } from './retro-hub'

function fakeConn(userId: string) {
  return { socket: { send: vi.fn() }, userId }
}

describe('RetroHub', () => {
  it('faz broadcast só para quem o build retorna payload', () => {
    const hub = new RetroHub()
    const a = fakeConn('u1')
    const b = fakeConn('u2')
    hub.subscribe('r1', a)
    hub.subscribe('r1', b)

    hub.broadcast('r1', (viewerId) => (viewerId === 'u1' ? { hi: viewerId } : null))

    expect(a.socket.send).toHaveBeenCalledWith(JSON.stringify({ hi: 'u1' }))
    expect(b.socket.send).not.toHaveBeenCalled()
  })

  it('presença lista userIds únicos e cai ao desinscrever', () => {
    const hub = new RetroHub()
    const a1 = fakeConn('u1')
    const a2 = fakeConn('u1') // segunda aba do mesmo usuário
    const b = fakeConn('u2')
    hub.subscribe('r1', a1)
    hub.subscribe('r1', a2)
    hub.subscribe('r1', b)
    expect(hub.presentUserIds('r1').sort()).toEqual(['u1', 'u2'])

    hub.unsubscribe('r1', b)
    expect(hub.presentUserIds('r1')).toEqual(['u1'])

    hub.unsubscribe('r1', a1)
    expect(hub.presentUserIds('r1')).toEqual(['u1']) // u1 ainda tem a2 aberta
  })

  it('não vaza entre salas', () => {
    const hub = new RetroHub()
    const a = fakeConn('u1')
    hub.subscribe('r1', a)
    hub.broadcast('r2', () => ({ x: 1 }))
    expect(a.socket.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/lib/retro-hub.test.ts`
Expected: FAIL — `Cannot find module './retro-hub'`.

- [ ] **Step 3: Implement the hub**

```ts
// apps/api/src/lib/retro-hub.ts

export interface RetroSocket {
  send(data: string): void
}

export interface RetroConnection {
  socket: RetroSocket
  userId: string
}

/**
 * Registro em memória de conexões WebSocket por sala. Postgres é a fonte da
 * verdade; o hub só faz fan-out. Preso a uma instância (ver spec: Redis é futuro).
 */
export class RetroHub {
  private rooms = new Map<string, Set<RetroConnection>>()

  subscribe(roomId: string, conn: RetroConnection): void {
    let set = this.rooms.get(roomId)
    if (!set) {
      set = new Set()
      this.rooms.set(roomId, set)
    }
    set.add(conn)
  }

  unsubscribe(roomId: string, conn: RetroConnection): void {
    const set = this.rooms.get(roomId)
    if (!set) return
    set.delete(conn)
    if (set.size === 0) this.rooms.delete(roomId)
  }

  presentUserIds(roomId: string): string[] {
    const set = this.rooms.get(roomId)
    if (!set) return []
    return [...new Set([...set].map((c) => c.userId))]
  }

  /**
   * Envia a cada conexão da sala o payload produzido por `build(viewerId)`.
   * Quando `build` retorna `null`, aquela conexão é pulada (respeita
   * anonimato/visibilidade por usuário).
   */
  broadcast(roomId: string, build: (viewerId: string) => unknown | null): void {
    const set = this.rooms.get(roomId)
    if (!set) return
    for (const conn of set) {
      const payload = build(conn.userId)
      if (payload == null) continue
      try {
        conn.socket.send(JSON.stringify(payload))
      } catch {
        // conexão morta: será limpa no close handler
      }
    }
  }
}

export const retroHub = new RetroHub()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/lib/retro-hub.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/retro-hub.ts apps/api/src/lib/retro-hub.test.ts
git commit -m "feat(api): hub em memória para tempo real do board"
```

---
### Task 4: Service — salas, papéis e fases

Cria o `retro-service.ts` com a classe de erro, os includes Prisma, o resolvedor de papel e as operações de sala (criar, listar, obter, gerenciar participantes, avançar fase) + helpers compartilhados.

**Files:**
- Create: `apps/api/src/services/retro-service.ts`
- Test: `apps/api/src/services/retro-service.test.ts`

**Interfaces:**
- Consumes: `prisma` (`../lib/prisma`); enums/consts de `@legends/shared`.
- Produces:
  - `class RetroError extends Error { status: number }`
  - `const retroRoomInclude` e tipos `RetroRoomWithRelations`, `RetroCardWithRelations`
  - `interface RetroRoomMeta { id; status: RetroRoomStatus; anonymous: boolean; createdById: string; votesPerParticipant: number; participantUserIds: string[] }`
  - `resolveRole(room: { createdById: string; participants: { userId: string }[] }, viewer: { id: string; role: string }): RetroRoomRole | null`
  - `createRoom(input: { creatorId; title; anonymous; votesPerParticipant; participantIds: string[] }): Promise<RetroRoomWithRelations>`
  - `listRoomsForUser(viewer: { id; role }): Promise<RetroRoomWithRelations[]>`
  - `getRoomForViewer(roomId: string, viewer: { id; role }): Promise<{ room: RetroRoomWithRelations; role: RetroRoomRole }>`
  - `setParticipants(input: { roomId; userId; participantIds: string[] }): Promise<{ room: RetroRoomWithRelations; addedUserIds: string[] }>`
  - `advancePhase(input: { roomId; userId; action: RetroPhaseAction }): Promise<RetroRoomWithRelations>`
  - `getRoomMeta(roomId: string): Promise<RetroRoomMeta | null>`
  - `getColumnCounts(roomId: string): Promise<RetroColumnCounts>`
  - `countUserVotesInRoom(roomId: string, userId: string): Promise<number>`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/services/retro-service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  RetroError,
  advancePhase,
  createRoom,
  getRoomForViewer,
  listRoomsForUser,
  resolveRole,
  setParticipants,
} from './retro-service'

async function mkUser(name: string, role: 'DEV' | 'LEAD' | 'ADMIN' = 'DEV') {
  return prisma.user.create({
    data: { name, email: `${name}@x.com`, passwordHash: 'x', role },
  })
}

describe('retro-service: salas', () => {
  it('LEAD cria sala e entra como participante automaticamente', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const dev = await mkUser('Dan', 'DEV')
    const room = await createRoom({
      creatorId: lead.id,
      title: 'Retro 1',
      anonymous: true,
      votesPerParticipant: 3,
      participantIds: [dev.id],
    })
    const ids = room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, dev.id].sort())
    expect(room.status).toBe('COLLECTING')
  })

  it('não-LEAD não cria sala (403)', async () => {
    const dev = await mkUser('Dan', 'DEV')
    await expect(
      createRoom({ creatorId: dev.id, title: 'x', anonymous: false, votesPerParticipant: 3, participantIds: [] }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejeita votesPerParticipant fora do intervalo (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    await expect(
      createRoom({ creatorId: lead.id, title: 'x', anonymous: false, votesPerParticipant: 0, participantIds: [] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita convidar ADMIN (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const admin = await mkUser('Ada', 'ADMIN')
    await expect(
      createRoom({ creatorId: lead.id, title: 'x', anonymous: false, votesPerParticipant: 3, participantIds: [admin.id] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('resolveRole: criador=FACILITATOR, convidado=PARTICIPANT, LEAD externo=OBSERVER, DEV externo=null', async () => {
    const room = { createdById: 'lead1', participants: [{ userId: 'lead1' }, { userId: 'dev1' }] }
    expect(resolveRole(room, { id: 'lead1', role: 'LEAD' })).toBe('FACILITATOR')
    expect(resolveRole(room, { id: 'dev1', role: 'DEV' })).toBe('PARTICIPANT')
    expect(resolveRole(room, { id: 'lead2', role: 'LEAD' })).toBe('OBSERVER')
    expect(resolveRole(room, { id: 'dev2', role: 'DEV' })).toBeNull()
    expect(resolveRole(room, { id: 'adm', role: 'ADMIN' })).toBeNull()
  })

  it('listRoomsForUser: LEAD vê todas; DEV só as suas', async () => {
    const lead1 = await mkUser('L1', 'LEAD')
    const lead2 = await mkUser('L2', 'LEAD')
    const dev = await mkUser('D', 'DEV')
    await createRoom({ creatorId: lead1.id, title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] })
    await createRoom({ creatorId: lead2.id, title: 'B', anonymous: false, votesPerParticipant: 3, participantIds: [] })

    expect((await listRoomsForUser({ id: lead1.id, role: 'LEAD' })).length).toBe(2)
    const devRooms = await listRoomsForUser({ id: dev.id, role: 'DEV' })
    expect(devRooms.map((r) => r.title)).toEqual(['A'])
  })

  it('getRoomForViewer: DEV não convidado recebe 404', async () => {
    const lead = await mkUser('L', 'LEAD')
    const stranger = await mkUser('S', 'DEV')
    const room = await createRoom({ creatorId: lead.id, title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [] })
    await expect(getRoomForViewer(room.id, { id: stranger.id, role: 'DEV' })).rejects.toMatchObject({ status: 404 })
  })

  it('fases avançam COLLECTING→REVEALED→CONCLUDED só pelo facilitador', async () => {
    const lead = await mkUser('L', 'LEAD')
    const dev = await mkUser('D', 'DEV')
    const room = await createRoom({ creatorId: lead.id, title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] })

    await expect(advancePhase({ roomId: room.id, userId: dev.id, action: 'reveal' })).rejects.toMatchObject({ status: 403 })

    const revealed = await advancePhase({ roomId: room.id, userId: lead.id, action: 'reveal' })
    expect(revealed.status).toBe('REVEALED')
    expect(revealed.revealedAt).not.toBeNull()

    const concluded = await advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude' })
    expect(concluded.status).toBe('CONCLUDED')

    await expect(advancePhase({ roomId: room.id, userId: lead.id, action: 'reveal' })).rejects.toMatchObject({ status: 409 })
  })

  it('setParticipants adiciona e reporta novos; não remove o criador', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'DEV')
    const d2 = await mkUser('D2', 'DEV')
    const room = await createRoom({ creatorId: lead.id, title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [d1.id] })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [d2.id] })
    expect(res.addedUserIds).toEqual([d2.id])
    const ids = res.room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, d1.id, d2.id].sort()) // criador sempre presente
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts`
Expected: FAIL — `Cannot find module './retro-service'`.

- [ ] **Step 3: Implement the service (salas/fases/helpers)**

```ts
// apps/api/src/services/retro-service.ts
import { Prisma } from '@prisma/client'
import {
  MAX_ROOM_TITLE_LENGTH,
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  RETRO_COLUMNS,
  type RetroColumn,
  type RetroColumnCounts,
  type RetroPhaseAction,
  type RetroRoomRole,
  type RetroRoomStatus,
} from '@legends/shared'
import { prisma } from '../lib/prisma'

export class RetroError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'RetroError'
  }
}

export const retroRoomInclude = {
  creator: true,
  participants: { include: { user: true }, orderBy: { invitedAt: 'asc' } },
  cards: {
    include: { author: true, votes: true, reactions: true },
    orderBy: { createdAt: 'asc' },
  },
} as const
export type RetroRoomWithRelations = Prisma.RetroRoomGetPayload<{ include: typeof retroRoomInclude }>
export type RetroCardWithRelations = RetroRoomWithRelations['cards'][number]

export interface RetroRoomMeta {
  id: string
  status: RetroRoomStatus
  anonymous: boolean
  createdById: string
  votesPerParticipant: number
  participantUserIds: string[]
}

/** Papel do viewer na sala, ou null se não tem acesso (DEV não convidado / ADMIN). */
export function resolveRole(
  room: { createdById: string; participants: { userId: string }[] },
  viewer: { id: string; role: string },
): RetroRoomRole | null {
  if (room.createdById === viewer.id) return 'FACILITATOR'
  if (room.participants.some((p) => p.userId === viewer.id)) return 'PARTICIPANT'
  if (viewer.role === 'LEAD') return 'OBSERVER'
  return null
}

async function loadRoom(roomId: string): Promise<RetroRoomWithRelations> {
  const room = await prisma.retroRoom.findUnique({ where: { id: roomId }, include: retroRoomInclude })
  if (!room) throw new RetroError('Sala não encontrada.', 404)
  return room
}

function assertTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) throw new RetroError('O título da sala é obrigatório.', 400)
  if (trimmed.length > MAX_ROOM_TITLE_LENGTH) throw new RetroError('Título muito longo.', 400)
  return trimmed
}

function assertVotes(votes: number): void {
  if (!Number.isInteger(votes) || votes < MIN_VOTES_PER_PARTICIPANT || votes > MAX_VOTES_PER_PARTICIPANT) {
    throw new RetroError('Número de votos por participante inválido.', 400)
  }
}

/** Valida que todos os ids existem, estão ativos e não são ADMIN. */
async function assertInvitable(participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return
  const users = await prisma.user.findMany({ where: { id: { in: participantIds } } })
  if (users.length !== new Set(participantIds).size) {
    throw new RetroError('Algum participante é inválido.', 400)
  }
  if (users.some((u) => !u.active)) throw new RetroError('Participante inativo.', 400)
  if (users.some((u) => u.role === 'ADMIN')) throw new RetroError('Administradores não participam de retrospectivas.', 400)
}

export async function createRoom(input: {
  creatorId: string
  title: string
  anonymous: boolean
  votesPerParticipant: number
  participantIds: string[]
}): Promise<RetroRoomWithRelations> {
  const creator = await prisma.user.findUnique({ where: { id: input.creatorId } })
  if (!creator || !creator.active) throw new RetroError('Criador inválido.', 400)
  if (creator.role !== 'LEAD') throw new RetroError('Apenas líderes abrem salas de retrospectiva.', 403)

  const title = assertTitle(input.title)
  assertVotes(input.votesPerParticipant)

  // O criador é sempre participante; remove duplicatas e o próprio criador da lista de convidados.
  const invited = [...new Set(input.participantIds)].filter((id) => id !== input.creatorId)
  await assertInvitable(invited)
  const allParticipantIds = [input.creatorId, ...invited]

  return prisma.retroRoom.create({
    data: {
      title,
      createdById: input.creatorId,
      anonymous: input.anonymous,
      votesPerParticipant: input.votesPerParticipant,
      participants: { create: allParticipantIds.map((userId) => ({ userId })) },
    },
    include: retroRoomInclude,
  })
}

export async function listRoomsForUser(viewer: { id: string; role: string }): Promise<RetroRoomWithRelations[]> {
  // LEAD consulta todas as salas; DEV vê apenas as que participa.
  const where: Prisma.RetroRoomWhereInput =
    viewer.role === 'LEAD' ? {} : { participants: { some: { userId: viewer.id } } }
  return prisma.retroRoom.findMany({ where, include: retroRoomInclude, orderBy: { createdAt: 'desc' } })
}

export async function getRoomForViewer(
  roomId: string,
  viewer: { id: string; role: string },
): Promise<{ room: RetroRoomWithRelations; role: RetroRoomRole }> {
  const room = await loadRoom(roomId)
  const role = resolveRole(room, viewer)
  if (!role) throw new RetroError('Sala não encontrada.', 404)
  return { room, role }
}

export async function setParticipants(input: {
  roomId: string
  userId: string
  participantIds: string[]
}): Promise<{ room: RetroRoomWithRelations; addedUserIds: string[] }> {
  const room = await loadRoom(input.roomId)
  if (room.createdById !== input.userId) {
    throw new RetroError('Apenas o facilitador gerencia participantes.', 403)
  }
  if (room.status === 'CONCLUDED') throw new RetroError('A sala foi concluída.', 409)

  const desired = new Set([room.createdById, ...input.participantIds]) // criador nunca sai
  await assertInvitable([...desired].filter((id) => id !== room.createdById))

  const current = new Set(room.participants.map((p) => p.userId))
  const toAdd = [...desired].filter((id) => !current.has(id))
  const toRemove = [...current].filter((id) => !desired.has(id))

  await prisma.$transaction([
    ...(toAdd.length
      ? [prisma.retroParticipant.createMany({ data: toAdd.map((userId) => ({ roomId: room.id, userId })) })]
      : []),
    ...(toRemove.length
      ? [prisma.retroParticipant.deleteMany({ where: { roomId: room.id, userId: { in: toRemove } } })]
      : []),
  ])

  return { room: await loadRoom(room.id), addedUserIds: toAdd }
}

export async function advancePhase(input: {
  roomId: string
  userId: string
  action: RetroPhaseAction
}): Promise<RetroRoomWithRelations> {
  const room = await loadRoom(input.roomId)
  if (room.createdById !== input.userId) {
    throw new RetroError('Apenas o facilitador muda a fase.', 403)
  }
  const valid =
    (input.action === 'reveal' && room.status === 'COLLECTING') ||
    (input.action === 'conclude' && room.status === 'REVEALED')
  if (!valid) throw new RetroError('Transição de fase inválida.', 409)

  const data =
    input.action === 'reveal'
      ? { status: 'REVEALED' as const, revealedAt: new Date() }
      : { status: 'CONCLUDED' as const, concludedAt: new Date() }

  await prisma.retroRoom.update({ where: { id: room.id }, data })
  return loadRoom(room.id)
}

export async function getRoomMeta(roomId: string): Promise<RetroRoomMeta | null> {
  const room = await prisma.retroRoom.findUnique({
    where: { id: roomId },
    include: { participants: { select: { userId: true } } },
  })
  if (!room) return null
  return {
    id: room.id,
    status: room.status,
    anonymous: room.anonymous,
    createdById: room.createdById,
    votesPerParticipant: room.votesPerParticipant,
    participantUserIds: room.participants.map((p) => p.userId),
  }
}

export async function getColumnCounts(roomId: string): Promise<RetroColumnCounts> {
  const grouped = await prisma.retroCard.groupBy({
    by: ['column'],
    where: { roomId },
    _count: { _all: true },
  })
  const counts: RetroColumnCounts = { WENT_WELL: 0, WENT_BAD: 0, START: 0, STOP: 0, ACTIONS: 0 }
  for (const g of grouped) counts[g.column as RetroColumn] = g._count._all
  // Garante que toda coluna conhecida está presente mesmo sem cards.
  for (const col of RETRO_COLUMNS) counts[col] ??= 0
  return counts
}

export function countUserVotesInRoom(roomId: string, userId: string): Promise<number> {
  return prisma.retroVote.count({ where: { userId, card: { roomId } } })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-service.test.ts
git commit -m "feat(api): service de salas/fases da retrospectiva"
```

---
### Task 5: Service — cards (criar/editar/excluir)

Adiciona ao `retro-service.ts` as operações de card com regras de participação e fase.

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Test: `apps/api/src/services/retro-card-service.test.ts`

**Interfaces:**
- Consumes: `RetroError`, `loadRoom`, `resolveRole`, `RetroCardWithRelations` (Task 4).
- Produces:
  - `createCard(input: { roomId; userId; column: RetroColumn; text: string }): Promise<RetroCardWithRelations>`
  - `updateCard(input: { roomId; cardId; userId; text: string }): Promise<RetroCardWithRelations>`
  - `deleteCard(input: { roomId; cardId; userId }): Promise<{ column: RetroColumn; authorId: string }>`
  - `loadCard(roomId, cardId): Promise<RetroCardWithRelations>` (helper exportado, reusado nos votos/reações)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/services/retro-card-service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { advancePhase, createCard, createRoom, deleteCard, updateCard } from './retro-service'

async function mkUser(name: string, role: 'DEV' | 'LEAD' = 'DEV') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function room(extraDevIds: string[] = []) {
  const lead = await mkUser('L', 'LEAD')
  const dev = await mkUser('D', 'DEV')
  const r = await createRoom({
    creatorId: lead.id,
    title: 'A',
    anonymous: false,
    votesPerParticipant: 3,
    participantIds: [dev.id, ...extraDevIds],
  })
  return { lead, dev, r }
}

describe('retro-service: cards', () => {
  it('participante cria card em COLLECTING', async () => {
    const { dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, column: 'START', text: 'Pair programming' })
    expect(card.text).toBe('Pair programming')
    expect(card.column).toBe('START')
  })

  it('observador (LEAD externo) não cria card (403)', async () => {
    const { r } = await room()
    const otherLead = await mkUser('L2', 'LEAD')
    await expect(
      createCard({ roomId: r.id, userId: otherLead.id, column: 'START', text: 'x' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('texto vazio é rejeitado (400)', async () => {
    const { dev, r } = await room()
    await expect(createCard({ roomId: r.id, userId: dev.id, column: 'START', text: '   ' })).rejects.toMatchObject({ status: 400 })
  })

  it('criar card ainda é permitido em REVEALED', async () => {
    const { lead, dev, r } = await room()
    await advancePhase({ roomId: r.id, userId: lead.id, action: 'reveal' })
    const card = await createCard({ roomId: r.id, userId: dev.id, column: 'ACTIONS', text: 'Definir dono' })
    expect(card.column).toBe('ACTIONS')
  })

  it('criar card em CONCLUDED é bloqueado (409)', async () => {
    const { lead, dev, r } = await room()
    await advancePhase({ roomId: r.id, userId: lead.id, action: 'reveal' })
    await advancePhase({ roomId: r.id, userId: lead.id, action: 'conclude' })
    await expect(createCard({ roomId: r.id, userId: dev.id, column: 'START', text: 'x' })).rejects.toMatchObject({ status: 409 })
  })

  it('só o autor edita/exclui o próprio card (403 para outro)', async () => {
    const { lead, dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, column: 'START', text: 'orig' })
    await expect(updateCard({ roomId: r.id, cardId: card.id, userId: lead.id, text: 'hack' })).rejects.toMatchObject({ status: 403 })

    const updated = await updateCard({ roomId: r.id, cardId: card.id, userId: dev.id, text: 'editado' })
    expect(updated.text).toBe('editado')

    const del = await deleteCard({ roomId: r.id, cardId: card.id, userId: dev.id })
    expect(del.column).toBe('START')
    expect(await prisma.retroCard.count({ where: { id: card.id } })).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-card-service.test.ts`
Expected: FAIL — `createCard is not exported` / não existe.

- [ ] **Step 3: Implement card operations**

Adicione ao **final** de `apps/api/src/services/retro-service.ts`:

```ts
import { MAX_CARD_LENGTH } from '@legends/shared'

export async function loadCard(roomId: string, cardId: string): Promise<RetroCardWithRelations> {
  const card = await prisma.retroCard.findFirst({
    where: { id: cardId, roomId },
    include: { author: true, votes: true, reactions: true },
  })
  if (!card) throw new RetroError('Card não encontrado.', 404)
  return card
}

/** Garante que o viewer participa (facilitador/participante) — observador não escreve/vota. */
function assertParticipant(room: RetroRoomWithRelations, userId: string): void {
  const role = resolveRole(room, { id: userId, role: 'DEV' })
  // role pode ser FACILITATOR ou PARTICIPANT aqui; OBSERVER só sai com role LEAD,
  // por isso reavaliamos diretamente pela participação/criação:
  const isParticipant = room.createdById === userId || room.participants.some((p) => p.userId === userId)
  if (!isParticipant || role === null) {
    throw new RetroError('Apenas participantes da sala podem fazer isso.', 403)
  }
}

function assertText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new RetroError('O card não pode ser vazio.', 400)
  if (trimmed.length > MAX_CARD_LENGTH) throw new RetroError('Card muito longo.', 400)
  return trimmed
}

export async function createCard(input: {
  roomId: string
  userId: string
  column: RetroColumn
  text: string
}): Promise<RetroCardWithRelations> {
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  if (room.status === 'CONCLUDED') throw new RetroError('A sala foi concluída.', 409)
  const text = assertText(input.text)
  const created = await prisma.retroCard.create({
    data: { roomId: room.id, authorId: input.userId, column: input.column, text },
  })
  return loadCard(room.id, created.id)
}

export async function updateCard(input: {
  roomId: string
  cardId: string
  userId: string
  text: string
}): Promise<RetroCardWithRelations> {
  const room = await loadRoom(input.roomId)
  if (room.status === 'CONCLUDED') throw new RetroError('A sala foi concluída.', 409)
  const card = await loadCard(input.roomId, input.cardId)
  if (card.authorId !== input.userId) throw new RetroError('Apenas o autor edita o card.', 403)
  const text = assertText(input.text)
  await prisma.retroCard.update({ where: { id: card.id }, data: { text } })
  return loadCard(input.roomId, card.id)
}

export async function deleteCard(input: {
  roomId: string
  cardId: string
  userId: string
}): Promise<{ column: RetroColumn; authorId: string }> {
  const room = await loadRoom(input.roomId)
  if (room.status === 'CONCLUDED') throw new RetroError('A sala foi concluída.', 409)
  const card = await loadCard(input.roomId, input.cardId)
  if (card.authorId !== input.userId) throw new RetroError('Apenas o autor exclui o card.', 403)
  await prisma.retroCard.delete({ where: { id: card.id } })
  return { column: card.column, authorId: card.authorId }
}
```

> Mova o `import { MAX_CARD_LENGTH }` para o bloco de import de `@legends/shared` no topo do arquivo (não deixe um segundo `import` no meio). Aqui é mostrado inline só para indicar a dependência.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-card-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-card-service.test.ts
git commit -m "feat(api): cards da retrospectiva (criar/editar/excluir)"
```

---

### Task 6: Service — votos (dot) e reações

Adiciona dot voting com orçamento e toggle de reação, ambos só em REVEALED.

**Files:**
- Modify: `apps/api/src/services/retro-service.ts`
- Test: `apps/api/src/services/retro-vote-service.test.ts`

**Interfaces:**
- Consumes: `loadRoom`, `loadCard`, `assertParticipant` (interno), `countUserVotesInRoom`, `RetroError`.
- Produces:
  - `addVote(input: { roomId; cardId; userId }): Promise<{ voteCount: number }>`
  - `removeVote(input: { roomId; cardId; userId }): Promise<{ voteCount: number }>`
  - `toggleReaction(input: { roomId; cardId; userId; emoji: string }): Promise<RetroCardWithRelations>`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/services/retro-vote-service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { addVote, advancePhase, createCard, createRoom, removeVote, toggleReaction } from './retro-service'

async function mkUser(name: string, role: 'DEV' | 'LEAD' = 'DEV') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function revealedRoom(votes = 2) {
  const lead = await mkUser('L', 'LEAD')
  const dev = await mkUser('D', 'DEV')
  const r = await createRoom({ creatorId: lead.id, title: 'A', anonymous: false, votesPerParticipant: votes, participantIds: [dev.id] })
  const card = await createCard({ roomId: r.id, userId: dev.id, column: 'WENT_WELL', text: 'bom' })
  await advancePhase({ roomId: r.id, userId: lead.id, action: 'reveal' })
  return { lead, dev, r, card }
}

describe('retro-service: votos e reações', () => {
  it('votar só é permitido em REVEALED', async () => {
    const lead = await mkUser('L', 'LEAD')
    const dev = await mkUser('D', 'DEV')
    const r = await createRoom({ creatorId: lead.id, title: 'A', anonymous: false, votesPerParticipant: 2, participantIds: [dev.id] })
    const card = await createCard({ roomId: r.id, userId: dev.id, column: 'WENT_WELL', text: 'bom' })
    await expect(addVote({ roomId: r.id, cardId: card.id, userId: dev.id })).rejects.toMatchObject({ status: 409 })
  })

  it('empilha dots e respeita o orçamento', async () => {
    const { dev, r, card } = await revealedRoom(2)
    expect((await addVote({ roomId: r.id, cardId: card.id, userId: dev.id })).voteCount).toBe(1)
    expect((await addVote({ roomId: r.id, cardId: card.id, userId: dev.id })).voteCount).toBe(2)
    await expect(addVote({ roomId: r.id, cardId: card.id, userId: dev.id })).rejects.toMatchObject({ status: 409 })
  })

  it('removeVote tira um dot por vez', async () => {
    const { dev, r, card } = await revealedRoom(2)
    await addVote({ roomId: r.id, cardId: card.id, userId: dev.id })
    await addVote({ roomId: r.id, cardId: card.id, userId: dev.id })
    expect((await removeVote({ roomId: r.id, cardId: card.id, userId: dev.id })).voteCount).toBe(1)
  })

  it('toggle de reação adiciona e remove', async () => {
    const { dev, r, card } = await revealedRoom()
    const added = await toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🔥' })
    expect(added.reactions).toHaveLength(1)
    const removed = await toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🔥' })
    expect(removed.reactions).toHaveLength(0)
  })

  it('rejeita emoji fora da paleta (400)', async () => {
    const { dev, r, card } = await revealedRoom()
    await expect(toggleReaction({ roomId: r.id, cardId: card.id, userId: dev.id, emoji: '🤡' })).rejects.toMatchObject({ status: 400 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-vote-service.test.ts`
Expected: FAIL — funções não exportadas.

- [ ] **Step 3: Implement votes and reactions**

Adicione ao **final** de `apps/api/src/services/retro-service.ts` (e mova `RETRO_REACTION_EMOJIS` para o import de `@legends/shared` do topo):

```ts
import { RETRO_REACTION_EMOJIS } from '@legends/shared'

function assertRevealed(room: RetroRoomWithRelations): void {
  if (room.status !== 'REVEALED') {
    throw new RetroError('Só é possível votar/reagir com a sala revelada.', 409)
  }
}

export async function addVote(input: {
  roomId: string
  cardId: string
  userId: string
}): Promise<{ voteCount: number }> {
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  assertRevealed(room)
  await loadCard(input.roomId, input.cardId) // garante que o card é da sala
  const used = await countUserVotesInRoom(input.roomId, input.userId)
  if (used >= room.votesPerParticipant) {
    throw new RetroError('Você já usou todos os seus votos.', 409)
  }
  await prisma.retroVote.create({ data: { cardId: input.cardId, userId: input.userId } })
  const voteCount = await prisma.retroVote.count({ where: { cardId: input.cardId } })
  return { voteCount }
}

export async function removeVote(input: {
  roomId: string
  cardId: string
  userId: string
}): Promise<{ voteCount: number }> {
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  assertRevealed(room)
  const one = await prisma.retroVote.findFirst({
    where: { cardId: input.cardId, userId: input.userId, card: { roomId: input.roomId } },
    orderBy: { createdAt: 'desc' },
  })
  if (one) await prisma.retroVote.delete({ where: { id: one.id } })
  const voteCount = await prisma.retroVote.count({ where: { cardId: input.cardId } })
  return { voteCount }
}

export async function toggleReaction(input: {
  roomId: string
  cardId: string
  userId: string
  emoji: string
}): Promise<RetroCardWithRelations> {
  if (!(RETRO_REACTION_EMOJIS as readonly string[]).includes(input.emoji)) {
    throw new RetroError('Reação inválida.', 400)
  }
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  assertRevealed(room)
  await loadCard(input.roomId, input.cardId)
  const existing = await prisma.retroReaction.findUnique({
    where: { cardId_userId_emoji: { cardId: input.cardId, userId: input.userId, emoji: input.emoji } },
  })
  if (existing) {
    await prisma.retroReaction.delete({ where: { id: existing.id } })
  } else {
    await prisma.retroReaction.create({ data: { cardId: input.cardId, userId: input.userId, emoji: input.emoji } })
  }
  return loadCard(input.roomId, input.cardId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-vote-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-vote-service.test.ts
git commit -m "feat(api): dot voting e reações da retrospectiva"
```

---
### Task 7: Serialização (DTOs)

Funções puras que convertem entidades Prisma em DTOs, aplicando anonimato e visibilidade por fase.

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Test: `apps/api/src/lib/serialize-retro.test.ts`

**Interfaces:**
- Consumes: `RetroRoomWithRelations`, `RetroCardWithRelations` (de `retro-service`); `RetroRoomRole`.
- Produces:
  - `toRetroCardDTO(card: RetroCardWithRelations, ctx: { viewerId: string; anonymous: boolean }): RetroCardDTO`
  - `toRetroRoomSummaryDTO(room: RetroRoomWithRelations, role: RetroRoomRole): RetroRoomSummaryDTO`
  - `toRetroRoomDTO(room: RetroRoomWithRelations, viewer: { id: string }, role: RetroRoomRole): RetroRoomDTO`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/lib/serialize-retro.test.ts
import { describe, it, expect } from 'vitest'
import { toRetroCardDTO, toRetroRoomDTO } from './serialize'
import type { RetroRoomWithRelations } from '../services/retro-service'

const baseUser = {
  id: 'u1', name: 'Ana', email: 'a@x.com', role: 'DEV', position: null, squad: null,
  photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true,
  passwordHash: 'x', joinedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
} as any

function card(over: Partial<any> = {}) {
  return {
    id: 'c1', roomId: 'r1', authorId: 'u1', column: 'WENT_WELL', text: 'oi',
    createdAt: new Date(), updatedAt: new Date(),
    author: { ...baseUser }, votes: [], reactions: [], ...over,
  }
}

describe('serialize retro', () => {
  it('omite autor em sala anônima mas marca mine', () => {
    const dto = toRetroCardDTO(card(), { viewerId: 'u1', anonymous: true })
    expect(dto.author).toBeNull()
    expect(dto.mine).toBe(true)
  })

  it('mostra autor em sala identificada', () => {
    const dto = toRetroCardDTO(card(), { viewerId: 'u2', anonymous: false })
    expect(dto.author).toEqual({ id: 'u1', name: 'Ana' })
    expect(dto.mine).toBe(false)
  })

  it('conta votos totais e os do viewer', () => {
    const dto = toRetroCardDTO(
      card({ votes: [{ userId: 'u1' }, { userId: 'u1' }, { userId: 'u2' }] }),
      { viewerId: 'u1', anonymous: false },
    )
    expect(dto.voteCount).toBe(3)
    expect(dto.myVotes).toBe(2)
  })

  it('em COLLECTING, room DTO esconde cards de outros mas mantém columnCounts', () => {
    const room = {
      id: 'r1', title: 'A', status: 'COLLECTING', anonymous: true, votesPerParticipant: 3,
      createdAt: new Date(), revealedAt: null, concludedAt: null, createdById: 'lead',
      creator: { ...baseUser, id: 'lead', name: 'Lia' },
      participants: [
        { userId: 'lead', user: { ...baseUser, id: 'lead', name: 'Lia' } },
        { userId: 'u1', user: { ...baseUser } },
      ],
      cards: [
        card({ id: 'c1', authorId: 'u1' }),
        card({ id: 'c2', authorId: 'lead', column: 'STOP' }),
      ],
    } as unknown as RetroRoomWithRelations

    const dto = toRetroRoomDTO(room, { id: 'u1' }, 'PARTICIPANT')
    expect(dto.cards.map((c) => c.id)).toEqual(['c1']) // só o próprio
    expect(dto.columnCounts.WENT_WELL).toBe(1)
    expect(dto.columnCounts.STOP).toBe(1)
    expect(dto.myRemainingVotes).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @legends/api exec vitest run src/lib/serialize-retro.test.ts`
Expected: FAIL — `toRetroCardDTO`/`toRetroRoomDTO` não exportados.

- [ ] **Step 3: Implement the serializers**

Adicione ao **final** de `apps/api/src/lib/serialize.ts`. Acrescente os imports necessários nos blocos existentes do topo do arquivo:

```ts
// adicionar ao import de '@legends/shared':
//   RETRO_COLUMNS, RETRO_REACTION_EMOJIS,
//   type RetroCardDTO, type RetroColumnCounts, type RetroReactionSummary,
//   type RetroRoomDTO, type RetroRoomRole, type RetroRoomSummaryDTO
// adicionar no topo:
import type { RetroCardWithRelations, RetroRoomWithRelations } from '../services/retro-service'
```

```ts
function summarizeRetroReactions(
  reactions: { emoji: string; userId: string }[],
  viewerId: string,
): RetroReactionSummary[] {
  return RETRO_REACTION_EMOJIS.flatMap((emoji) => {
    const matching = reactions.filter((r) => r.emoji === emoji)
    if (matching.length === 0) return []
    return [
      {
        emoji,
        count: matching.length,
        reactedByMe: matching.some((r) => r.userId === viewerId),
      },
    ]
  })
}

export function toRetroCardDTO(
  card: RetroCardWithRelations,
  ctx: { viewerId: string; anonymous: boolean },
): RetroCardDTO {
  const mine = card.authorId === ctx.viewerId
  return {
    id: card.id,
    column: card.column,
    text: card.text,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    author: ctx.anonymous ? null : { id: card.author.id, name: card.author.name },
    mine,
    voteCount: card.votes.length,
    myVotes: card.votes.filter((v) => v.userId === ctx.viewerId).length,
    reactions: summarizeRetroReactions(card.reactions, ctx.viewerId),
  }
}

export function toRetroRoomSummaryDTO(
  room: RetroRoomWithRelations,
  role: RetroRoomRole,
): RetroRoomSummaryDTO {
  return {
    id: room.id,
    title: room.title,
    status: room.status,
    anonymous: room.anonymous,
    votesPerParticipant: room.votesPerParticipant,
    createdAt: room.createdAt.toISOString(),
    revealedAt: room.revealedAt ? room.revealedAt.toISOString() : null,
    concludedAt: room.concludedAt ? room.concludedAt.toISOString() : null,
    creator: { id: room.creator.id, name: room.creator.name },
    participantCount: room.participants.length,
    myRole: role,
  }
}

function emptyColumnCounts(): RetroColumnCounts {
  return { WENT_WELL: 0, WENT_BAD: 0, START: 0, STOP: 0, ACTIONS: 0 }
}

export function toRetroRoomDTO(
  room: RetroRoomWithRelations,
  viewer: { id: string },
  role: RetroRoomRole,
): RetroRoomDTO {
  // Contagem por coluna sobre TODOS os cards (mesmo os ocultos).
  const columnCounts = emptyColumnCounts()
  for (const c of room.cards) columnCounts[c.column] += 1

  // Em COLLECTING, cada um só vê os próprios cards.
  const visibleCards =
    room.status === 'COLLECTING' ? room.cards.filter((c) => c.authorId === viewer.id) : room.cards

  const usedVotes = room.cards.reduce(
    (acc, c) => acc + c.votes.filter((v) => v.userId === viewer.id).length,
    0,
  )

  return {
    ...toRetroRoomSummaryDTO(room, role),
    participants: room.participants.map((p) => ({
      user: toPublicUser(p.user),
      isCreator: p.userId === room.createdById,
    })),
    cards: visibleCards.map((c) => toRetroCardDTO(c, { viewerId: viewer.id, anonymous: room.anonymous })),
    columnCounts,
    myRemainingVotes: Math.max(0, room.votesPerParticipant - usedVotes),
  }
}
```

> O parâmetro `RETRO_COLUMNS` é importado para manter consistência futura, mas a contagem usa as chaves fixas de `RetroColumnCounts`. Se o lint reclamar de import não usado, remova `RETRO_COLUMNS` do import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @legends/api exec vitest run src/lib/serialize-retro.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize-retro.test.ts
git commit -m "feat(api): DTOs da retrospectiva (anonimato + visibilidade por fase)"
```

---
### Task 8: Notificação de convite

**Files:**
- Modify: `apps/api/src/services/notification-service.ts`
- Test: `apps/api/src/services/notification-service.test.ts` (adicionar caso; criar o arquivo se não existir)

**Interfaces:**
- Produces: `notifyRetroInvited(input: { roomId: string; title: string; actorId: string; invitedUserIds: string[] }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Adicione (ou crie o arquivo com) este teste:

```ts
// apps/api/src/services/notification-service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { notifyRetroInvited } from './notification-service'

describe('notifyRetroInvited', () => {
  it('cria uma notificação RETRO_INVITED para cada convidado, menos o ator', async () => {
    const lead = await prisma.user.create({ data: { name: 'L', email: 'l@x.com', passwordHash: 'x', role: 'LEAD' } })
    const d1 = await prisma.user.create({ data: { name: 'D1', email: 'd1@x.com', passwordHash: 'x' } })
    const d2 = await prisma.user.create({ data: { name: 'D2', email: 'd2@x.com', passwordHash: 'x' } })

    await notifyRetroInvited({ roomId: 'room1', title: 'Retro 1', actorId: lead.id, invitedUserIds: [d1.id, d2.id, lead.id] })

    expect(await prisma.notification.count({ where: { type: 'RETRO_INVITED' } })).toBe(2)
    const toD1 = await prisma.notification.findFirst({ where: { userId: d1.id } })
    expect(toD1?.link).toBe('/retrospectivas/room1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts`
Expected: FAIL — `notifyRetroInvited` não exportado.

- [ ] **Step 3: Implement the notifier**

Adicione em `apps/api/src/services/notification-service.ts`:

```ts
export async function notifyRetroInvited(input: {
  roomId: string
  title: string
  actorId: string
  invitedUserIds: string[]
}): Promise<void> {
  const targets = input.invitedUserIds.filter((id) => id !== input.actorId)
  for (const userId of targets) {
    await createNotification({
      userId,
      type: 'RETRO_INVITED',
      actorId: input.actorId,
      title: `Você foi convidado para a retrospectiva "${input.title}"`,
      link: `/retrospectivas/${input.roomId}`,
      metadata: { roomId: input.roomId },
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/notification-service.ts apps/api/src/services/notification-service.test.ts
git commit -m "feat(api): notificação RETRO_INVITED"
```

---

### Task 9: Rotas REST + broadcast

Endpoints REST que validam, chamam o service, serializam a resposta para o ator e publicam eventos no hub (por-viewer, respeitando anonimato/visibilidade). Registradas em `buildApp`.

**Files:**
- Create: `apps/api/src/routes/retro.ts`
- Modify: `apps/api/src/app.ts` (registrar `retroRoutes`)
- Test: `apps/api/src/routes/retro.test.ts`

**Interfaces:**
- Consumes: tudo de `retro-service`, `toRetroRoomDTO`/`toRetroRoomSummaryDTO`/`toRetroCardDTO` (serialize), `retroHub` (hub), `notifyRetroInvited`.
- Produces: `retroRoutes(app: FastifyInstance)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/routes/retro.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function leadToken(app: any, name = 'Lia') {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'LEAD' } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'LEAD' }) }
}
async function devToken(app: any, name = 'Dan') {
  const u = await prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'DEV' } })
  return { id: u.id, token: app.jwt.sign({ sub: u.id, role: 'DEV' }) }
}

describe('retro routes', () => {
  it('LEAD cria sala (201) e DEV não (403)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)

    const ok = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { title: 'Retro 1', anonymous: true, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().room.myRole).toBe('FACILITATOR')

    const forbidden = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${dev.token}` },
      payload: { title: 'x', anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })

  it('valida corpo inválido (400)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const res = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { title: '', anonymous: 'sim', votesPerParticipant: 3, participantIds: [] },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('DEV não convidado recebe 404 ao abrir sala', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const stranger = await devToken(app, 'Estranho')
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    const roomId = created.json().room.id
    const res = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${stranger.token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('fluxo: cria card, revela, vota e reage', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { title: 'A', anonymous: false, votesPerParticipant: 2, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id

    const card = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { column: 'WENT_WELL', text: 'Deploy tranquilo' },
    })
    expect(card.statusCode).toBe(201)
    const cardId = card.json().card.id

    // votar antes de revelar → 409
    const early = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/votes`, headers: { authorization: `Bearer ${dev.token}` } })
    expect(early.statusCode).toBe(409)

    await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/phase`, headers: { authorization: `Bearer ${lead.token}` }, payload: { action: 'reveal' } })

    const vote = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/votes`, headers: { authorization: `Bearer ${dev.token}` } })
    expect(vote.statusCode).toBe(200)
    expect(vote.json().voteCount).toBe(1)
    expect(vote.json().myRemainingVotes).toBe(1)

    const react = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/reactions`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { emoji: '🔥' },
    })
    expect(react.statusCode).toBe(200)
    expect(react.json().reactions[0]).toMatchObject({ emoji: '🔥', count: 1, reactedByMe: true })
    await app.close()
  })

  it('em COLLECTING, GET esconde card de outro participante', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { title: 'A', anonymous: true, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id
    await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` }, payload: { column: 'WENT_BAD', text: 'segredo' } })

    const asLead = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
    expect(asLead.json().room.cards).toHaveLength(0) // facilitador não vê card alheio em COLLECTING
    expect(asLead.json().room.columnCounts.WENT_BAD).toBe(1) // mas vê o contador
    await app.close()
  })

  it('PATCH participants notifica os novos convidados', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    const roomId = created.json().room.id
    const res = await app.inject({
      method: 'PATCH', url: `/retro/rooms/${roomId}/participants`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { participantIds: [dev.id] },
    })
    expect(res.statusCode).toBe(200)
    expect(await prisma.notification.count({ where: { userId: dev.id, type: 'RETRO_INVITED' } })).toBe(1)
    await app.close()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @legends/api exec vitest run src/routes/retro.test.ts`
Expected: FAIL — rota não registrada (404) / módulo inexistente.

- [ ] **Step 3: Implement the routes**

```ts
// apps/api/src/routes/retro.ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  MAX_CARD_LENGTH,
  MAX_ROOM_TITLE_LENGTH,
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  RETRO_COLUMNS,
  RETRO_REACTION_EMOJIS,
  type RetroColumnCounts,
} from '@legends/shared'
import {
  RetroError,
  addVote,
  advancePhase,
  countUserVotesInRoom,
  createCard,
  createRoom,
  deleteCard,
  getColumnCounts,
  getRoomForViewer,
  getRoomMeta,
  listRoomsForUser,
  removeVote,
  setParticipants,
  toggleReaction,
  updateCard,
  type RetroCardWithRelations,
  type RetroRoomMeta,
} from '../services/retro-service'
import { notifyRetroInvited } from '../services/notification-service'
import { toRetroCardDTO, toRetroRoomDTO, toRetroRoomSummaryDTO } from '../lib/serialize'
import { retroHub } from '../lib/retro-hub'

const createRoomSchema = z.object({
  title: z.string().trim().min(1).max(MAX_ROOM_TITLE_LENGTH),
  anonymous: z.boolean(),
  votesPerParticipant: z.number().int().min(MIN_VOTES_PER_PARTICIPANT).max(MAX_VOTES_PER_PARTICIPANT),
  participantIds: z.array(z.string()).max(200),
})
const participantsSchema = z.object({ participantIds: z.array(z.string()).max(200) })
const phaseSchema = z.object({ action: z.enum(['reveal', 'conclude']) })
const createCardSchema = z.object({
  column: z.enum(RETRO_COLUMNS),
  text: z.string().trim().min(1).max(MAX_CARD_LENGTH),
})
const updateCardSchema = z.object({ text: z.string().trim().min(1).max(MAX_CARD_LENGTH) })
const reactionSchema = z.object({ emoji: z.enum(RETRO_REACTION_EMOJIS) })

const badBody = { message: 'Dados inválidos.' }

/** card.created/updated por-viewer: em COLLECTING, só o autor recebe. */
function broadcastCard(
  type: 'card.created' | 'card.updated',
  meta: RetroRoomMeta,
  card: RetroCardWithRelations,
): void {
  retroHub.broadcast(meta.id, (viewerId) => {
    if (meta.status === 'COLLECTING' && viewerId !== card.authorId) return null
    return { type, card: toRetroCardDTO(card, { viewerId, anonymous: meta.anonymous }) }
  })
}

function broadcastColumnCounts(roomId: string, columnCounts: RetroColumnCounts): void {
  retroHub.broadcast(roomId, () => ({ type: 'columnCounts.changed', columnCounts }))
}

export async function retroRoutes(app: FastifyInstance) {
  // Criar sala
  app.post('/retro/rooms', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = createRoomSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    try {
      const room = await createRoom({ creatorId: request.user.sub, ...parsed.data })
      // best-effort: notifica convidados
      try {
        await notifyRetroInvited({
          roomId: room.id,
          title: room.title,
          actorId: request.user.sub,
          invitedUserIds: room.participants.map((p) => p.userId),
        })
      } catch (err) {
        request.log.error(err)
      }
      return reply.code(201).send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Listar salas
  app.get('/retro/rooms', { onRequest: [app.authenticate] }, async (request, reply) => {
    const rooms = await listRoomsForUser({ id: request.user.sub, role: request.user.role })
    const dtos = rooms.map((room) => {
      const role =
        room.createdById === request.user.sub
          ? 'FACILITATOR'
          : room.participants.some((p) => p.userId === request.user.sub)
            ? 'PARTICIPANT'
            : 'OBSERVER'
      return toRetroRoomSummaryDTO(room, role)
    })
    return reply.send({ rooms: dtos })
  })

  // Detalhe da sala
  app.get('/retro/rooms/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { room, role } = await getRoomForViewer(id, { id: request.user.sub, role: request.user.role })
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, role) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Gerenciar participantes
  app.patch('/retro/rooms/:id/participants', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = participantsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { room, addedUserIds } = await setParticipants({
        roomId: id,
        userId: request.user.sub,
        participantIds: parsed.data.participantIds,
      })
      if (addedUserIds.length) {
        try {
          await notifyRetroInvited({ roomId: room.id, title: room.title, actorId: request.user.sub, invitedUserIds: addedUserIds })
        } catch (err) {
          request.log.error(err)
        }
      }
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Avançar fase
  app.post('/retro/rooms/:id/phase', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = phaseSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const room = await advancePhase({ roomId: id, userId: request.user.sub, action: parsed.data.action })
      retroHub.broadcast(room.id, () => ({
        type: 'phase.changed',
        status: room.status,
        revealedAt: room.revealedAt ? room.revealedAt.toISOString() : null,
        concludedAt: room.concludedAt ? room.concludedAt.toISOString() : null,
      }))
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Criar card
  app.post('/retro/rooms/:id/cards', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = createCardSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const card = await createCard({ roomId: id, userId: request.user.sub, ...parsed.data })
      const meta = await getRoomMeta(id)
      if (meta) {
        broadcastCard('card.created', meta, card)
        broadcastColumnCounts(id, await getColumnCounts(id))
      }
      return reply.code(201).send({ card: toRetroCardDTO(card, { viewerId: request.user.sub, anonymous: meta?.anonymous ?? false }) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Editar card
  app.patch('/retro/rooms/:id/cards/:cardId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = updateCardSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const card = await updateCard({ roomId: id, cardId, userId: request.user.sub, text: parsed.data.text })
      const meta = await getRoomMeta(id)
      if (meta) broadcastCard('card.updated', meta, card)
      return reply.send({ card: toRetroCardDTO(card, { viewerId: request.user.sub, anonymous: meta?.anonymous ?? false }) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Excluir card
  app.delete('/retro/rooms/:id/cards/:cardId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { column, authorId } = await deleteCard({ roomId: id, cardId, userId: request.user.sub })
      const meta = await getRoomMeta(id)
      retroHub.broadcast(id, (viewerId) => {
        if (meta && meta.status === 'COLLECTING' && viewerId !== authorId) return null
        return { type: 'card.deleted', cardId, column }
      })
      broadcastColumnCounts(id, await getColumnCounts(id))
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Votar (+1 dot)
  app.post('/retro/rooms/:id/cards/:cardId/votes', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { voteCount } = await addVote({ roomId: id, cardId, userId: request.user.sub })
      retroHub.broadcast(id, () => ({ type: 'vote.changed', cardId, voteCount }))
      const meta = await getRoomMeta(id)
      const used = await countUserVotesInRoom(id, request.user.sub)
      const myRemainingVotes = Math.max(0, (meta?.votesPerParticipant ?? 0) - used)
      return reply.send({ voteCount, myRemainingVotes })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Remover voto (-1 dot)
  app.delete('/retro/rooms/:id/cards/:cardId/votes', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { voteCount } = await removeVote({ roomId: id, cardId, userId: request.user.sub })
      retroHub.broadcast(id, () => ({ type: 'vote.changed', cardId, voteCount }))
      const meta = await getRoomMeta(id)
      const used = await countUserVotesInRoom(id, request.user.sub)
      const myRemainingVotes = Math.max(0, (meta?.votesPerParticipant ?? 0) - used)
      return reply.send({ voteCount, myRemainingVotes })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // Toggle de reação
  app.post('/retro/rooms/:id/cards/:cardId/reactions', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const card = await toggleReaction({ roomId: id, cardId, userId: request.user.sub, emoji: parsed.data.emoji })
      // reactedByMe varia por viewer → build por-viewer
      retroHub.broadcast(id, (viewerId) => ({
        type: 'reaction.changed',
        cardId,
        reactions: toRetroCardDTO(card, { viewerId, anonymous: false }).reactions,
      }))
      return reply.send({ reactions: toRetroCardDTO(card, { viewerId: request.user.sub, anonymous: false }).reactions })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
```

- [ ] **Step 4: Register the routes in `buildApp`**

Em `apps/api/src/app.ts`, importe e registre (junto dos outros `app.register`):

```ts
import { retroRoutes } from './routes/retro'
// ...
  app.register(retroRoutes)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @legends/api exec vitest run src/routes/retro.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/retro.ts apps/api/src/app.ts apps/api/src/routes/retro.test.ts
git commit -m "feat(api): rotas REST do board + broadcast no hub"
```

---
### Task 10: Rota WebSocket + presença

Upgrade autenticado por `?token=`, autorização por papel, subscribe no hub e broadcast de presença em connect/disconnect.

**Files:**
- Modify: `apps/api/package.json` (deps `@fastify/websocket`, devDeps `ws`, `@types/ws`)
- Create: `apps/api/src/routes/retro-ws.ts`
- Modify: `apps/api/src/app.ts` (registrar plugin + rota)
- Test: `apps/api/src/routes/retro-ws.test.ts`

**Interfaces:**
- Consumes: `retroHub`, `getRoomMeta`.
- Produces: `retroWsRoutes(app: FastifyInstance)` — registra `GET /retro/rooms/:id/ws`.

> **Pin de versão:** estamos em Fastify 4, então use **`@fastify/websocket@^8`** (v10+ é para Fastify 5). Em v8, o handler recebe `(connection, request)` onde `connection.socket` é o WebSocket (`ws`). Adapte se atualizar o Fastify.

- [ ] **Step 1: Add the dependencies**

Em `apps/api/package.json`, adicione em `dependencies`:

```json
    "@fastify/websocket": "^8.3.1",
```

e em `devDependencies`:

```json
    "@types/ws": "^8.5.10",
    "ws": "^8.18.0",
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing integration test**

```ts
// apps/api/src/routes/retro-ws.test.ts
import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

function waitOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('retro websocket', () => {
  it('recebe card.created após revelar a sala', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const lead = await prisma.user.create({ data: { name: 'L', email: 'l@x.com', passwordHash: 'x', role: 'LEAD' } })
    const dev = await prisma.user.create({ data: { name: 'D', email: 'd@x.com', passwordHash: 'x', role: 'DEV' } })
    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
    const devTk = app.jwt.sign({ sub: dev.id, role: 'DEV' })

    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` },
      payload: { title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id
    await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/phase`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'reveal' } })

    const client = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${devTk}`)
    const messages: any[] = []
    client.on('message', (d) => messages.push(JSON.parse(d.toString())))
    await waitOpen(client)

    await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${leadTk}` },
      payload: { column: 'WENT_WELL', text: 'Boa comunicação' },
    })
    await delay(150)

    expect(messages.some((m) => m.type === 'card.created' && m.card.text === 'Boa comunicação')).toBe(true)
    client.close()
    await app.close()
  })

  it('recusa conexão sem token válido', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const lead = await prisma.user.create({ data: { name: 'L', email: 'l@x.com', passwordHash: 'x', role: 'LEAD' } })
    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` },
      payload: { title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    const roomId = created.json().room.id

    const client = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=invalido`)
    const closed = await new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true))
      client.on('error', () => resolve(true))
      client.on('open', () => resolve(false))
    })
    expect(closed).toBe(true)
    await app.close()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/routes/retro-ws.test.ts`
Expected: FAIL — conexão recusada (rota não existe).

- [ ] **Step 4: Implement the WebSocket route**

```ts
// apps/api/src/routes/retro-ws.ts
import type { FastifyInstance } from 'fastify'
import { getRoomMeta } from '../services/retro-service'
import { retroHub, type RetroConnection } from '../lib/retro-hub'

export async function retroWsRoutes(app: FastifyInstance) {
  app.get('/retro/rooms/:id/ws', { websocket: true }, async (connection, request) => {
    const ws = connection.socket
    const { id } = request.params as { id: string }
    const token = (request.query as { token?: string }).token ?? ''

    let userId: string
    let role: string
    try {
      const payload = app.jwt.verify(token) as { sub: string; role: string }
      userId = payload.sub
      role = payload.role
    } catch {
      ws.close(1008, 'unauthorized')
      return
    }

    const meta = await getRoomMeta(id)
    if (!meta) {
      ws.close(1008, 'not found')
      return
    }
    const isParticipant = meta.createdById === userId || meta.participantUserIds.includes(userId)
    if (!isParticipant && role !== 'LEAD') {
      ws.close(1008, 'forbidden')
      return
    }

    const conn: RetroConnection = { socket: ws, userId }
    retroHub.subscribe(id, conn)
    const pushPresence = () =>
      retroHub.broadcast(id, () => ({ type: 'presence.changed', userIds: retroHub.presentUserIds(id) }))
    pushPresence()

    ws.on('close', () => {
      retroHub.unsubscribe(id, conn)
      pushPresence()
    })
  })
}
```

- [ ] **Step 5: Register the plugin and route in `buildApp`**

Em `apps/api/src/app.ts`:

```ts
import websocket from '@fastify/websocket'
import { retroWsRoutes } from './routes/retro-ws'
// ... dentro de buildApp, ANTES de registrar as rotas:
  app.register(websocket)
// ... junto dos demais app.register:
  app.register(retroWsRoutes)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/routes/retro-ws.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full API suite**

Run: `pnpm --filter @legends/api test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/src/routes/retro-ws.ts apps/api/src/app.ts apps/api/src/routes/retro-ws.test.ts ../../pnpm-lock.yaml
git commit -m "feat(api): WebSocket do board com presença e auth por token"
```

---
### Task 11: Web — cliente REST, navegação e lista de salas

**Files:**
- Create: `apps/web/src/lib/retro-api.ts`
- Modify: `apps/web/src/components/nav-items.ts`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/RetrosPage.tsx`
- Test: `apps/web/src/pages/RetrosPage.test.tsx`

**Interfaces:**
- Produces (`retro-api.ts`): `listRetroRooms`, `getRetroRoom`, `createRetroRoom`, `setRetroParticipants`, `advanceRetroPhase`, `createRetroCard`, `updateRetroCard`, `deleteRetroCard`, `addRetroVote`, `removeRetroVote`, `toggleRetroReaction`, `listInvitableUsers`.

- [ ] **Step 1: Write the API client**

```ts
// apps/web/src/lib/retro-api.ts
import type {
  CreateRetroCardRequest,
  CreateRetroRoomRequest,
  PublicUser,
  RetroCardDTO,
  RetroReactionEmoji,
  RetroReactionSummary,
  RetroPhaseAction,
  RetroRoomDTO,
  RetroRoomSummaryDTO,
} from '@legends/shared'
import { apiFetch } from './api'

export function listRetroRooms() {
  return apiFetch<{ rooms: RetroRoomSummaryDTO[] }>('/retro/rooms')
}
export function getRetroRoom(id: string) {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}`)
}
export function createRetroRoom(body: CreateRetroRoomRequest) {
  return apiFetch<{ room: RetroRoomDTO }>('/retro/rooms', { method: 'POST', body: JSON.stringify(body) })
}
export function setRetroParticipants(id: string, participantIds: string[]) {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/participants`, {
    method: 'PATCH',
    body: JSON.stringify({ participantIds }),
  })
}
export function advanceRetroPhase(id: string, action: RetroPhaseAction) {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/phase`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}
export function createRetroCard(roomId: string, body: CreateRetroCardRequest) {
  return apiFetch<{ card: RetroCardDTO }>(`/retro/rooms/${roomId}/cards`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
export function updateRetroCard(roomId: string, cardId: string, text: string) {
  return apiFetch<{ card: RetroCardDTO }>(`/retro/rooms/${roomId}/cards/${cardId}`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  })
}
export function deleteRetroCard(roomId: string, cardId: string) {
  return apiFetch<void>(`/retro/rooms/${roomId}/cards/${cardId}`, { method: 'DELETE' })
}
export function addRetroVote(roomId: string, cardId: string) {
  return apiFetch<{ voteCount: number; myRemainingVotes: number }>(
    `/retro/rooms/${roomId}/cards/${cardId}/votes`,
    { method: 'POST' },
  )
}
export function removeRetroVote(roomId: string, cardId: string) {
  return apiFetch<{ voteCount: number; myRemainingVotes: number }>(
    `/retro/rooms/${roomId}/cards/${cardId}/votes`,
    { method: 'DELETE' },
  )
}
export function toggleRetroReaction(roomId: string, cardId: string, emoji: RetroReactionEmoji) {
  return apiFetch<{ reactions: RetroReactionSummary[] }>(
    `/retro/rooms/${roomId}/cards/${cardId}/reactions`,
    { method: 'POST', body: JSON.stringify({ emoji }) },
  )
}
export function listInvitableUsers() {
  return apiFetch<{ users: PublicUser[] }>('/users')
}
```

- [ ] **Step 2: Add the nav item (DEV/LEAD, oculto p/ ADMIN)**

Em `apps/web/src/components/nav-items.ts`, adicione no array **não-admin** (o `return [...]` final), logo após o item de Lendas:

```ts
    { to: '/retrospectivas', label: 'Retrospectivas', icon: 'dashboard' },
```

(Não adicione ao array do `if (isAdmin)` — ADMIN fica fora.)

- [ ] **Step 3: Write the failing test**

```tsx
// apps/web/src/pages/RetrosPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { RetrosPage } from './RetrosPage'

vi.mock('../lib/retro-api', () => ({
  listRetroRooms: vi.fn().mockResolvedValue({
    rooms: [
      { id: 'r1', title: 'Retro Sprint 1', status: 'COLLECTING', anonymous: true, votesPerParticipant: 3, createdAt: new Date().toISOString(), revealedAt: null, concludedAt: null, creator: { id: 'l1', name: 'Lia' }, participantCount: 4, myRole: 'FACILITATOR' },
    ],
  }),
  listInvitableUsers: vi.fn().mockResolvedValue({ users: [] }),
  createRetroRoom: vi.fn(),
}))

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'l1', role: 'LEAD' } }) }))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><RetrosPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RetrosPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista salas e mostra botão de nova sala para LEAD', async () => {
    renderPage()
    expect(await screen.findByText('Retro Sprint 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nova sala/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetrosPage.test.tsx`
Expected: FAIL — `RetrosPage` não existe.

- [ ] **Step 5: Implement `RetrosPage` (lista + modal de criação)**

```tsx
// apps/web/src/pages/RetrosPage.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  RETRO_ROOM_STATUS,
  type RetroRoomStatus,
} from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { createRetroRoom, listInvitableUsers, listRetroRooms } from '../lib/retro-api'

const STATUS_LABEL: Record<RetroRoomStatus, string> = {
  COLLECTING: 'Em coleta',
  REVEALED: 'Revelada',
  CONCLUDED: 'Concluída',
}

export function RetrosPage() {
  const { user } = useAuth()
  const isLead = user?.role === 'LEAD'
  const rooms = useQuery({ queryKey: ['retro-rooms'], queryFn: listRetroRooms })
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <section className="mx-auto max-w-7xl p-lg md:p-xl">
      <header className="mb-xl flex items-start justify-between gap-md">
        <div>
          <h2 className="font-headline text-headline-xl text-on-surface">Retrospectivas</h2>
          <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
            Quadros de retrospectiva de sprint do time, em tempo real.
          </p>
        </div>
        {isLead && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="shrink-0 rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container"
          >
            Nova sala
          </button>
        )}
      </header>

      {rooms.isLoading ? (
        <p className="py-2xl text-center text-on-surface-variant">Carregando…</p>
      ) : (rooms.data?.rooms.length ?? 0) === 0 ? (
        <p className="py-2xl text-center text-on-surface-variant">Nenhuma sala por aqui ainda.</p>
      ) : (
        <ul className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
          {rooms.data!.rooms.map((room) => (
            <li key={room.id}>
              <Link
                to={`/retrospectivas/${room.id}`}
                className="block rounded-xl border border-outline-variant/30 bg-surface-container px-lg py-md transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg"
              >
                <div className="flex items-center justify-between gap-sm">
                  <span className="font-label text-[11px] uppercase tracking-wide text-primary">
                    {STATUS_LABEL[room.status]}
                  </span>
                  {room.anonymous && (
                    <span className="font-label text-[11px] text-on-surface-variant">anônima</span>
                  )}
                </div>
                <h3 className="mt-1 font-headline text-title-md text-on-surface">{room.title}</h3>
                <p className="mt-2 text-body-sm text-on-surface-variant">
                  {room.creator.name} · {room.participantCount} participantes
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {modalOpen && <CreateRoomModal onClose={() => setModalOpen(false)} />}
    </section>
  )
}

function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const candidates = useQuery({ queryKey: ['retro-invitable'], queryFn: listInvitableUsers })
  const [title, setTitle] = useState('')
  const [anonymous, setAnonymous] = useState(true)
  const [votes, setVotes] = useState(3)
  const [selected, setSelected] = useState<string[]>([])

  const create = useMutation({
    mutationFn: () =>
      createRetroRoom({ title: title.trim(), anonymous, votesPerParticipant: votes, participantIds: selected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['retro-rooms'] })
      onClose()
    },
  })

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-outline-variant/40 bg-surface-container p-xl">
        <h3 className="font-headline text-title-lg text-on-surface">Nova retrospectiva</h3>

        <label className="mt-lg block text-label-md text-on-surface-variant">
          Título
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-outline-variant/40 bg-surface px-md py-sm text-on-surface"
            placeholder="Retro Sprint 23 — Squad Pagamentos"
          />
        </label>

        <div className="mt-md flex items-center gap-lg">
          <label className="flex items-center gap-sm text-body-md text-on-surface">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Sala anônima
          </label>
          <label className="flex items-center gap-sm text-body-md text-on-surface">
            Votos por pessoa
            <input
              type="number"
              min={MIN_VOTES_PER_PARTICIPANT}
              max={MAX_VOTES_PER_PARTICIPANT}
              value={votes}
              onChange={(e) => setVotes(Number(e.target.value))}
              className="w-16 rounded-md border border-outline-variant/40 bg-surface px-sm py-1 text-on-surface"
            />
          </label>
        </div>

        <fieldset className="mt-md">
          <legend className="text-label-md text-on-surface-variant">Participantes</legend>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-outline-variant/30 p-sm">
            {candidates.data?.users.map((u) => (
              <label key={u.id} className="flex items-center gap-sm py-1 text-body-md text-on-surface">
                <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                {u.name}
              </label>
            ))}
          </div>
        </fieldset>

        {create.isError && <p className="mt-md text-body-sm text-error">Não foi possível criar a sala.</p>}

        <div className="mt-xl flex justify-end gap-sm">
          <button type="button" onClick={onClose} className="rounded-md px-lg py-sm text-on-surface-variant hover:bg-surface-container-highest">
            Cancelar
          </button>
          <button
            type="button"
            disabled={title.trim().length === 0 || create.isPending}
            onClick={() => create.mutate()}
            className="rounded-md bg-primary px-lg py-sm font-label font-bold text-on-primary disabled:opacity-50"
          >
            {create.isPending ? 'Criando…' : 'Criar sala'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

> `RETRO_ROOM_STATUS` é importado para garantir cobertura do mapa `STATUS_LABEL`; se o lint acusar import não usado, remova-o.

- [ ] **Step 6: Wire the routes in `App.tsx`**

Em `apps/web/src/App.tsx`, importe as páginas e adicione as rotas dentro do bloco protegido (`<DevOnly>` exclui ADMIN, igual a `/votar`):

```tsx
import { RetrosPage } from './pages/RetrosPage'
import { RetroRoomPage } from './pages/RetroRoomPage'
// ...
              <Route path="/retrospectivas" element={<DevOnly><RetrosPage /></DevOnly>} />
              <Route path="/retrospectivas/:id" element={<DevOnly><RetroRoomPage /></DevOnly>} />
```

> `RetroRoomPage` é criado na Task 12. Para esta task compilar isoladamente, crie um stub temporário `export function RetroRoomPage() { return null }` em `apps/web/src/pages/RetroRoomPage.tsx` (será substituído na Task 12), **ou** adicione apenas a rota de `/retrospectivas` agora e a de `:id` na Task 12. Escolha uma; o teste desta task não depende da RetroRoomPage.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetrosPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/retro-api.ts apps/web/src/components/nav-items.ts apps/web/src/App.tsx apps/web/src/pages/RetrosPage.tsx apps/web/src/pages/RetrosPage.test.tsx
git commit -m "feat(web): cliente REST, navegação e lista de retrospectivas"
```

---
### Task 12: Web — o board (`RetroRoomPage`) via REST

Quadro com as 5 colunas, criação/edição/exclusão de card, controles de fase (facilitador), votos e reações. Ao vivo entra na Task 13; aqui as mutações invalidam a query da sala.

**Files:**
- Create: `apps/web/src/pages/RetroRoomPage.tsx` (substitui o stub, se criado)
- Test: `apps/web/src/pages/RetroRoomPage.test.tsx`

**Interfaces:**
- Consumes: `retro-api` (Task 11), `@legends/shared`.
- Produces: `RetroRoomPage` (default-less named export).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/RetroRoomPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RetroRoomPage } from './RetroRoomPage'
import type { RetroRoomDTO } from '@legends/shared'

const room: RetroRoomDTO = {
  id: 'r1', title: 'Retro 1', status: 'REVEALED', anonymous: false, votesPerParticipant: 3,
  createdAt: new Date().toISOString(), revealedAt: new Date().toISOString(), concludedAt: null,
  creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'PARTICIPANT',
  participants: [], columnCounts: { WENT_WELL: 1, WENT_BAD: 0, START: 0, STOP: 0, ACTIONS: 0 },
  myRemainingVotes: 3,
  cards: [
    { id: 'c1', column: 'WENT_WELL', text: 'Deploy tranquilo', createdAt: '', updatedAt: '', author: { id: 'd1', name: 'Dan' }, mine: false, voteCount: 0, myVotes: 0, reactions: [] },
  ],
}

vi.mock('../lib/retro-api', () => ({
  getRetroRoom: vi.fn().mockResolvedValue({ room }),
  createRetroCard: vi.fn(), updateRetroCard: vi.fn(), deleteRetroCard: vi.fn(),
  addRetroVote: vi.fn(), removeRetroVote: vi.fn(), toggleRetroReaction: vi.fn(), advanceRetroPhase: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'd1', role: 'DEV' } }) }))
vi.mock('../lib/useRetroSocket', () => ({ useRetroSocket: () => ({ presentUserIds: [] }) }))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/retrospectivas/r1']}>
        <Routes><Route path="/retrospectivas/:id" element={<RetroRoomPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RetroRoomPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mostra título, as 5 colunas e um card', async () => {
    renderPage()
    expect(await screen.findByText('Retro 1')).toBeInTheDocument()
    expect(screen.getByText('O que foi bom')).toBeInTheDocument()
    expect(screen.getByText('Ações')).toBeInTheDocument()
    expect(screen.getByText('Deploy tranquilo')).toBeInTheDocument()
  })
})
```

> Esta task já referencia `../lib/useRetroSocket` (mockado no teste). O arquivo real é criado na Task 13. Para a página compilar agora, crie um stub mínimo em `apps/web/src/lib/useRetroSocket.ts`:
> ```ts
> export function useRetroSocket(_roomId: string): { presentUserIds: string[] } { return { presentUserIds: [] } }
> ```
> A Task 13 substitui o stub pela implementação real.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: FAIL — `RetroRoomPage` não existe.

- [ ] **Step 3: Implement the board**

```tsx
// apps/web/src/pages/RetroRoomPage.tsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RETRO_COLUMNS,
  RETRO_COLUMN_LABELS,
  RETRO_REACTION_EMOJIS,
  type RetroCardDTO,
  type RetroColumn,
  type RetroRoomDTO,
} from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { useRetroSocket } from '../lib/useRetroSocket'
import {
  addRetroVote,
  advanceRetroPhase,
  createRetroCard,
  deleteRetroCard,
  getRetroRoom,
  removeRetroVote,
  toggleRetroReaction,
  updateRetroCard,
} from '../lib/retro-api'

export function RetroRoomPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { user } = useAuth()
  const roomQuery = useQuery({ queryKey: ['retro-room', id], queryFn: () => getRetroRoom(id), enabled: !!id })
  useRetroSocket(id) // ao vivo (Task 13)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['retro-room', id] })

  if (roomQuery.isLoading) return <p className="p-xl text-center text-on-surface-variant">Carregando…</p>
  if (roomQuery.isError || !roomQuery.data) return <p className="p-xl text-center text-error">Sala indisponível.</p>

  const room = roomQuery.data.room
  const isFacilitator = room.myRole === 'FACILITATOR'
  const canWrite = room.myRole !== 'OBSERVER' && room.status !== 'CONCLUDED'
  const canVote = room.myRole !== 'OBSERVER' && room.status === 'REVEALED'

  return (
    <section className="mx-auto max-w-[1400px] p-lg md:p-xl">
      <RoomHeader room={room} isFacilitator={isFacilitator} onPhase={invalidate} />
      <div className="mt-xl grid gap-md md:grid-cols-2 xl:grid-cols-5">
        {RETRO_COLUMNS.map((col) => (
          <RetroColumnView
            key={col}
            roomId={id}
            column={col}
            room={room}
            canWrite={canWrite}
            canVote={canVote}
            viewerId={user?.id ?? ''}
            onChanged={invalidate}
          />
        ))}
      </div>
    </section>
  )
}

function RoomHeader({
  room,
  isFacilitator,
  onPhase,
}: {
  room: RetroRoomDTO
  isFacilitator: boolean
  onPhase: () => void
}) {
  const phase = useMutation({
    mutationFn: (action: 'reveal' | 'conclude') => advanceRetroPhase(room.id, action),
    onSuccess: onPhase,
  })
  const statusLabel = { COLLECTING: 'Em coleta', REVEALED: 'Revelada', CONCLUDED: 'Concluída' }[room.status]

  return (
    <header className="flex flex-wrap items-center justify-between gap-md">
      <div>
        <span className="font-label text-[11px] uppercase tracking-wide text-primary">{statusLabel}</span>
        <h2 className="font-headline text-headline-lg text-on-surface">{room.title}</h2>
        {room.status === 'REVEALED' && (
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Votos restantes: <strong>{room.myRemainingVotes}</strong>
          </p>
        )}
      </div>
      {isFacilitator && room.status !== 'CONCLUDED' && (
        <button
          type="button"
          disabled={phase.isPending}
          onClick={() => phase.mutate(room.status === 'COLLECTING' ? 'reveal' : 'conclude')}
          className="rounded-md bg-primary px-lg py-sm font-label font-bold text-on-primary disabled:opacity-50"
        >
          {room.status === 'COLLECTING' ? 'Revelar cards' : 'Concluir retrospectiva'}
        </button>
      )}
    </header>
  )
}

function RetroColumnView({
  roomId,
  column,
  room,
  canWrite,
  canVote,
  viewerId,
  onChanged,
}: {
  roomId: string
  column: RetroColumn
  room: RetroRoomDTO
  canWrite: boolean
  canVote: boolean
  viewerId: string
  onChanged: () => void
}) {
  const [text, setText] = useState('')
  const cards = room.cards.filter((c) => c.column === column)
  const total = room.columnCounts[column]
  const hiddenCount = room.status === 'COLLECTING' ? total - cards.length : 0

  const add = useMutation({
    mutationFn: () => createRetroCard(roomId, { column, text: text.trim() }),
    onSuccess: () => {
      setText('')
      onChanged()
    },
  })

  return (
    <div className="flex flex-col rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-md">
      <div className="mb-sm flex items-center justify-between">
        <h3 className="font-label text-label-lg font-bold text-on-surface">{RETRO_COLUMN_LABELS[column]}</h3>
        <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] text-on-surface-variant">{total}</span>
      </div>

      {canWrite && (
        <div className="mb-sm">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Escrever um card…"
            className="w-full resize-none rounded-md border border-outline-variant/40 bg-surface px-sm py-1 text-body-sm text-on-surface"
          />
          <button
            type="button"
            disabled={text.trim().length === 0 || add.isPending}
            onClick={() => add.mutate()}
            className="mt-1 w-full rounded-md bg-primary/90 py-1 font-label text-label-sm font-bold text-on-primary disabled:opacity-40"
          >
            Adicionar
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-sm">
        {cards.map((card) => (
          <RetroCardView
            key={card.id}
            roomId={roomId}
            card={card}
            status={room.status}
            canVote={canVote}
            viewerId={viewerId}
            onChanged={onChanged}
          />
        ))}
      </ul>

      {hiddenCount > 0 && (
        <p className="mt-sm text-center text-[11px] text-on-surface-variant">
          {hiddenCount} card(s) oculto(s) até a revelação
        </p>
      )}
    </div>
  )
}

function RetroCardView({
  roomId,
  card,
  status,
  canVote,
  viewerId,
  onChanged,
}: {
  roomId: string
  card: RetroCardDTO
  status: RetroRoomDTO['status']
  canVote: boolean
  viewerId: string
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(card.text)

  const save = useMutation({
    mutationFn: () => updateRetroCard(roomId, card.id, draft.trim()),
    onSuccess: () => {
      setEditing(false)
      onChanged()
    },
  })
  const remove = useMutation({ mutationFn: () => deleteRetroCard(roomId, card.id), onSuccess: onChanged })
  const vote = useMutation({
    mutationFn: (dir: 'add' | 'remove') => (dir === 'add' ? addRetroVote(roomId, card.id) : removeRetroVote(roomId, card.id)),
    onSuccess: onChanged,
  })
  const react = useMutation({
    mutationFn: (emoji: (typeof RETRO_REACTION_EMOJIS)[number]) => toggleRetroReaction(roomId, card.id, emoji),
    onSuccess: onChanged,
  })

  return (
    <li className="rounded-lg border border-outline-variant/20 bg-surface-container px-md py-sm">
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-outline-variant/40 bg-surface px-sm py-1 text-body-sm text-on-surface"
          />
          <div className="mt-1 flex justify-end gap-sm">
            <button type="button" onClick={() => setEditing(false)} className="text-label-sm text-on-surface-variant">Cancelar</button>
            <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="text-label-sm font-bold text-primary">Salvar</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-body-sm text-on-surface">{card.text}</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px] text-on-surface-variant">{card.author ? card.author.name : card.mine ? 'Você' : 'Anônimo'}</span>
            {card.mine && status !== 'CONCLUDED' && (
              <span className="flex gap-sm">
                <button type="button" onClick={() => { setDraft(card.text); setEditing(true) }} className="text-[11px] text-on-surface-variant hover:text-on-surface">Editar</button>
                <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="text-[11px] text-error hover:opacity-80">Excluir</button>
              </span>
            )}
          </div>

          {status === 'REVEALED' && (
            <div className="mt-sm flex flex-wrap items-center gap-2">
              {canVote && (
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => vote.mutate('remove')} disabled={card.myVotes === 0} className="rounded bg-surface-container-highest px-2 text-on-surface disabled:opacity-40">−</button>
                  <span className="min-w-[2ch] text-center text-label-sm text-on-surface">{card.voteCount}</span>
                  <button type="button" onClick={() => vote.mutate('add')} className="rounded bg-surface-container-highest px-2 text-on-surface">+</button>
                  {card.myVotes > 0 && <span className="text-[11px] text-primary">({card.myVotes} seu(s))</span>}
                </span>
              )}
              <span className="flex flex-wrap gap-1">
                {RETRO_REACTION_EMOJIS.map((emoji) => {
                  const summary = card.reactions.find((r) => r.emoji === emoji)
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => react.mutate(emoji)}
                      className={`rounded-full px-2 py-0.5 text-[13px] ${summary?.reactedByMe ? 'bg-primary/20' : 'bg-surface-container-highest'}`}
                    >
                      {emoji}{summary ? ` ${summary.count}` : ''}
                    </button>
                  )
                })}
              </span>
            </div>
          )}
        </>
      )}
    </li>
  )
}
```

> O parâmetro `viewerId` é passado para uso futuro (ex.: destacar próprios votos); se o lint reclamar de não-uso, marque com `void viewerId` ou remova da assinatura.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx apps/web/src/lib/useRetroSocket.ts apps/web/src/App.tsx
git commit -m "feat(web): board de retrospectiva (colunas, cards, votos, reações)"
```

---
### Task 13: Web — hook de WebSocket ao vivo

Substitui o stub de `useRetroSocket` pela implementação real: conecta, aplica eventos no cache do React Query, expõe presença e reconecta com backoff.

**Files:**
- Modify: `apps/web/src/lib/useRetroSocket.ts` (substitui o stub da Task 12)
- Test: `apps/web/src/lib/useRetroSocket.test.tsx`

**Interfaces:**
- Consumes: `getAccessToken`, `refreshAccessToken` (de `./api`); query key `['retro-room', id]` com shape `{ room: RetroRoomDTO }` (definido na Task 12).
- Produces: `useRetroSocket(roomId: string): { presentUserIds: string[] }`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/lib/useRetroSocket.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { RetroRoomDTO } from '@legends/shared'
import { useRetroSocket } from './useRetroSocket'

vi.mock('./api', () => ({
  getAccessToken: () => 'tok',
  refreshAccessToken: vi.fn().mockResolvedValue(true),
}))

class FakeWS {
  static instances: FakeWS[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readyState = 0
  constructor(public url: string) {
    FakeWS.instances.push(this)
  }
  send() {}
  close() {
    this.readyState = 3
    this.onclose?.({})
  }
  emitOpen() {
    this.readyState = 1
    this.onopen?.({})
  }
  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

const baseRoom: RetroRoomDTO = {
  id: 'r1', title: 'A', status: 'REVEALED', anonymous: false, votesPerParticipant: 3,
  createdAt: '', revealedAt: '', concludedAt: null, creator: { id: 'l1', name: 'L' },
  participantCount: 1, myRole: 'PARTICIPANT', participants: [],
  columnCounts: { WENT_WELL: 1, WENT_BAD: 0, START: 0, STOP: 0, ACTIONS: 0 }, myRemainingVotes: 3,
  cards: [{ id: 'c1', column: 'WENT_WELL', text: 'x', createdAt: '', updatedAt: '', author: null, mine: false, voteCount: 0, myVotes: 0, reactions: [] }],
}

describe('useRetroSocket', () => {
  beforeEach(() => {
    FakeWS.instances = []
    ;(globalThis as any).WebSocket = FakeWS
  })

  it('aplica vote.changed no cache da sala', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['retro-room', 'r1'], { room: baseRoom })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )

    renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]

    act(() => ws.emitOpen())
    act(() => ws.emitMessage({ type: 'vote.changed', cardId: 'c1', voteCount: 5 }))

    const cached = qc.getQueryData<{ room: RetroRoomDTO }>(['retro-room', 'r1'])
    expect(cached?.room.cards[0].voteCount).toBe(5)
  })

  it('expõe presentUserIds ao receber presence.changed', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['retro-room', 'r1'], { room: baseRoom })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    act(() => ws.emitMessage({ type: 'presence.changed', userIds: ['u1', 'u2'] }))
    expect(result.current.presentUserIds).toEqual(['u1', 'u2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/lib/useRetroSocket.test.tsx`
Expected: FAIL — o stub não aplica eventos nem expõe presença real.

- [ ] **Step 3: Implement the hook**

```ts
// apps/web/src/lib/useRetroSocket.ts
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RetroEvent, RetroRoomDTO } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from './api'

type Cached = { room: RetroRoomDTO } | undefined

function applyEvent(prev: Cached, event: RetroEvent): Cached {
  if (!prev) return prev
  const room = prev.room
  switch (event.type) {
    case 'card.created':
    case 'card.updated': {
      const exists = room.cards.some((c) => c.id === event.card.id)
      const cards = exists
        ? room.cards.map((c) => (c.id === event.card.id ? event.card : c))
        : [...room.cards, event.card]
      return { room: { ...room, cards } }
    }
    case 'card.deleted':
      return { room: { ...room, cards: room.cards.filter((c) => c.id !== event.cardId) } }
    case 'vote.changed':
      return {
        room: { ...room, cards: room.cards.map((c) => (c.id === event.cardId ? { ...c, voteCount: event.voteCount } : c)) },
      }
    case 'reaction.changed':
      return {
        room: { ...room, cards: room.cards.map((c) => (c.id === event.cardId ? { ...c, reactions: event.reactions } : c)) },
      }
    case 'columnCounts.changed':
      return { room: { ...room, columnCounts: event.columnCounts } }
    default:
      return prev
  }
}

export function useRetroSocket(roomId: string): { presentUserIds: string[] } {
  const qc = useQueryClient()
  const [presentUserIds, setPresentUserIds] = useState<string[]>([])
  const closedByUs = useRef(false)
  const attempts = useRef(0)

  useEffect(() => {
    if (!roomId) return
    closedByUs.current = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      let token = getAccessToken()
      if (!token) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (!token || closedByUs.current) return

      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${scheme}://${window.location.host}/api/retro/rooms/${roomId}/ws?token=${token}`)

      ws.onopen = () => {
        attempts.current = 0
        // resync ao (re)conectar: garante consistência após perdas/fase
        qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
      }
      ws.onmessage = (ev) => {
        let event: RetroEvent
        try {
          event = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
        } catch {
          return
        }
        if (event.type === 'presence.changed') {
          setPresentUserIds(event.userIds)
          return
        }
        if (event.type === 'phase.changed') {
          qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
          return
        }
        qc.setQueryData<Cached>(['retro-room', roomId], (prev) => applyEvent(prev, event))
      }
      ws.onclose = () => {
        if (closedByUs.current) return
        attempts.current += 1
        const backoff = Math.min(1000 * 2 ** attempts.current, 15000)
        reconnectTimer = setTimeout(connect, backoff)
      }
      ws.onerror = () => ws?.close()
    }

    void connect()

    return () => {
      closedByUs.current = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [roomId, qc])

  return { presentUserIds }
}
```

> O proxy do nginx já encaminha `/api/` para a API; o WebSocket usa o mesmo prefixo (`/api/retro/.../ws`). Em dev (Vite), confirme que o proxy de `/api` repassa upgrades de WebSocket — habilite `ws: true` no proxy do `apps/web/vite.config.ts` se necessário (ver Task 14 / nota de infra).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/lib/useRetroSocket.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/useRetroSocket.ts apps/web/src/lib/useRetroSocket.test.tsx
git commit -m "feat(web): WebSocket ao vivo do board (cache + presença + reconexão)"
```

---

### Task 14: Proxy de WebSocket (dev + nginx) e verificação ponta-a-ponta

Garante que o upgrade de WebSocket chega à API em desenvolvimento (Vite) e em produção (nginx).

**Files:**
- Modify: `apps/web/vite.config.ts` (proxy `/api` com `ws: true`)
- Modify: `nginx/*.conf` (headers de upgrade na location `/api/`)

**Interfaces:** nenhuma de código; é configuração de infra.

- [ ] **Step 1: Habilitar upgrade no proxy do Vite**

Abra `apps/web/vite.config.ts`. No `server.proxy['/api']` (ou equivalente), garanta `ws: true`. Exemplo do shape esperado:

```ts
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3333', changeOrigin: true, ws: true },
      '/highlights': { target: 'http://localhost:3333', changeOrigin: true },
    },
  },
```

> Se o arquivo já tiver o proxy de `/api` sem `ws: true`, apenas adicione a flag. Não altere targets/portas existentes.

- [ ] **Step 2: Habilitar upgrade no nginx**

No arquivo de configuração do nginx (procure a `location /api/` em `nginx/`), adicione os headers de upgrade:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3333/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

> Mantenha quaisquer diretivas já presentes (timeouts, headers). O essencial é `proxy_http_version 1.1` + `Upgrade`/`Connection`.

- [ ] **Step 3: Verificação manual ponta-a-ponta**

Run: `pnpm db:up && pnpm dev`
Abra dois navegadores autenticados (um LEAD, um DEV convidado) na mesma sala:
1. LEAD cria sala e convida o DEV.
2. Em COLLECTING, cada um vê só os próprios cards; o contador da coluna sobe para ambos.
3. LEAD revela → os cards aparecem nos dois sem reload.
4. Votos e reações de um aparecem no outro em tempo real.
5. Concluir → board fica somente-leitura; outro LEAD não-membro abre a sala como observador.

Expected: todas as transições refletem ao vivo entre as duas sessões.

- [ ] **Step 4: Full build + suites**

Run: `pnpm build && pnpm test`
Expected: build de todos os workspaces e todos os testes verdes (Postgres de pé).

- [ ] **Step 5: Commit**

```bash
git add apps/web/vite.config.ts nginx
git commit -m "chore(infra): upgrade de WebSocket no proxy (dev + nginx)"
```

---

## Self-Review (autor)

**Cobertura do spec:**
- Tempo real (WebSocket push-only + hub) → Tasks 3, 9, 10, 13.
- Anonimato configurável por sala → schema (T2), serialize (T7), modal (T11).
- Dot voting com orçamento definido pelo LEAD → service (T6), rotas (T9), UI (T12).
- Reações → T6/T9/T12.
- Fases COLLECTING/REVEALED/CONCLUDED + visibilidade → T4 (fase), T7 (visibilidade), T9 (broadcast), T12 (UI).
- Papéis (facilitador/participante/observador, ADMIN fora) → `resolveRole` (T4), rotas (T9), gating de nav/rota (T11).
- Convite + notificação `RETRO_INVITED` → T8/T9.
- Sala solta com título livre, independente do período → schema (T2), service (T4).
- LEAD consulta qualquer sala → `listRoomsForUser`/`getRoomForViewer` (T4).
- Instância única / hub em memória; Redis fora de escopo → T3 + Global Constraints.
- Auth do WS por token na URL → T10.

**Placeholders:** nenhum bloco de código tem TODO/“implementar depois”; os stubs temporários (`RetroRoomPage`, `useRetroSocket`) são explicitamente substituídos nas Tasks 12 e 13.

**Consistência de tipos:** nomes batem entre tasks — `resolveRole`, `getRoomMeta`, `RetroRoomMeta`, `RetroCardWithRelations`, `toRetroCardDTO({ viewerId, anonymous })`, `toRetroRoomDTO(room, { id }, role)`, query key `['retro-room', id]`, eventos de `RetroEvent`. As rotas consomem exatamente as funções exportadas pelo service (Tasks 4–6).

**Riscos conhecidos a validar na execução:**
- `@fastify/websocket` v8 vs Fastify 4 — confirmar a assinatura `(connection, request)` com `connection.socket` ao implementar a T10.
- `vite.config.ts` e arquivos do nginx têm shapes assumidos na T14 — ajustar ao conteúdo real sem quebrar o que existe.

