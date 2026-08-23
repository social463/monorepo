# Redesign do Board (canvas livre Miro-like) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a UX engessada de 5 colunas do board de retrospectiva por um canvas livre estilo Miro — post-its coloridos arrastáveis em `x/y`, movimento e cursores ao vivo, sala sempre visível (`OPEN`/`CONCLUDED`).

**Architecture:** Evolui a feature já existente na branch `feat/retro-board`. O WebSocket passa a ser **bidirecional**: um canal **efêmero** (não persiste) repassa `card.moving`/`cursor`/soft-lock em alta frequência com throttle; a **persistência** continua via REST (route→service→Prisma) que emite o broadcast autoritativo (`card.moved` etc.). O front vira um canvas pan/zoom com post-its como elementos DOM.

**Tech Stack:** Fastify 4 + Prisma 5 + Postgres, `@fastify/websocket` v8; React 18 + React Query + React Router 6 + Tailwind; tipos em `@legends/shared`. Vitest (API contra Postgres real; web jsdom).

## Global Constraints

- TypeScript **strict**, ESM puro, Node ≥ 20. Mensagens ao usuário em **português**.
- Camadas finas: route valida (Zod `safeParse` → `400 { message, issues }`) e serializa; lógica no service com `RetroError(status)`; `instanceof` na route. DTO em `lib/serialize.ts`.
- Contrato em `@legends/shared` **primeiro**, depois os dois lados.
- Auth: rotas com `onRequest: [app.authenticate]`; `request.user.sub`/`.role`. WS autentica por `?token=` em `preValidation` (recusa pré-upgrade com 401/403).
- Efeitos colaterais (notificações) best-effort: `try/catch` + `request.log.error`.
- Deploy **instância única** — hub e soft-lock em memória são aceitáveis (Redis fora de escopo).
- **Nunca** editar migration já aplicada; gerar nova com Prisma. O banco local já tem `retro_board` aplicada.
- Coordenadas de post-it/cursor sempre no **espaço do mundo** (independem de pan/zoom de cada cliente).
- Throttle do canal efêmero no cliente: `MOVE_THROTTLE_MS` e `CURSOR_THROTTLE_MS` ≈ 33ms (~30/s). O servidor só **repassa** mensagens efêmeras (sem I/O de banco).
- Paleta de cores fixa: `['yellow','pink','green','blue','purple','orange']`.
- Spec de referência: `docs/superpowers/specs/2026-06-19-retro-board-canvas-redesign-design.md`.

## Estado atual (o que já existe nesta branch e será alterado)

- `packages/shared/src/retro.ts`: `RETRO_ROOM_STATUS=['COLLECTING','REVEALED','CONCLUDED']`, `RETRO_COLUMNS`, `RETRO_COLUMN_LABELS`, `RetroCardDTO` (com `column`), `RetroRoomDTO` (com `columnCounts`/`revealedAt`), `RetroEvent` (com `phase.changed`/`columnCounts.changed`).
- `apps/api/prisma/schema.prisma`: enums `RetroRoomStatus` (3 valores) e `RetroColumn`; `RetroCard.column`.
- `apps/api/src/services/retro-service.ts`: `assertRevealed` (votos/reações só em REVEALED), `getColumnCounts`, `createCard({roomId,userId,column,text})`, `advancePhase` (`reveal`|`conclude`), visibilidade COLLECTING.
- `apps/api/src/lib/serialize.ts`: `toRetroCardDTO` (com `column`), `toRetroRoomDTO` (com `columnCounts` + filtro COLLECTING).
- `apps/api/src/lib/retro-hub.ts`: `RetroHub` (subscribe/unsubscribe/presentUserIds/broadcast), `retroHub`.
- `apps/api/src/routes/retro.ts`: cria card com `column`, broadcasts `card.*` + `columnCounts.changed`, fase `reveal`/`conclude`.
- `apps/api/src/routes/retro-ws.ts`: só subscribe + presença (push-only).
- `apps/web/src/lib/retro-api.ts`, `apps/web/src/lib/useRetroSocket.ts`, `apps/web/src/pages/RetroRoomPage.tsx` (colunas), `apps/web/src/pages/RetrosPage.tsx` (labels de status).

## Mapa de arquivos

- Modify: `packages/shared/src/retro.ts` — status `OPEN|CONCLUDED`, cores, regiões, DTO `x/y/color`, eventos efêmeros, `RetroClientMessage`.
- Modify: `apps/api/prisma/schema.prisma` + nova migration.
- Modify: `apps/api/src/services/retro-service.ts` — posição, gating OPEN, sem coluna.
- Modify: `apps/api/src/lib/serialize.ts` — DTO `x/y/color`, sem `columnCounts`/visibilidade.
- Modify: `apps/api/src/lib/retro-hub.ts` — soft-lock + relay helpers.
- Modify: `apps/api/src/routes/retro.ts` — `position` endpoint, broadcasts novos.
- Modify: `apps/api/src/routes/retro-ws.ts` — mensagens cliente→servidor (cursor/move/grab/drop).
- Modify: `apps/web/src/lib/retro-api.ts` — assinaturas novas + `position`.
- Modify: `apps/web/src/lib/useRetroSocket.ts` — bidirecional (envio + estado efêmero).
- Create: `apps/web/src/pages/retro/RetroCanvas.tsx`, `PostIt.tsx`, `ColorPalette.tsx`, `RegionsBackground.tsx`, `LiveCursors.tsx`, `use-canvas-viewport.ts`.
- Rewrite: `apps/web/src/pages/RetroRoomPage.tsx` — orquestra o canvas.
- Modify: `apps/web/src/pages/RetrosPage.tsx` — labels `OPEN|CONCLUDED`.

---
### Task 1: Contrato compartilhado (canvas)

**Files:**
- Modify: `packages/shared/src/retro.ts` (substituição quase completa)
- Test: `packages/shared/src/retro.test.ts` (atualizar)

**Interfaces:**
- Produces: `RETRO_ROOM_STATUS=['OPEN','CONCLUDED']`, `RETRO_CARD_COLORS`, `RetroCardColor`, `RETRO_REGIONS`, `RETRO_ROOM_ROLES`, `RETRO_REACTION_EMOJIS`, constantes (`MAX_CARD_LENGTH`, `MAX_ROOM_TITLE_LENGTH`, `MIN/MAX_VOTES_PER_PARTICIPANT`, `CURSOR_THROTTLE_MS`, `MOVE_THROTTLE_MS`); tipos `RetroRoomStatus`, `RetroRoomRole`, `RetroReactionEmoji`, `RetroReactionSummary`, `RetroCardDTO` (com `x,y,color`, sem `column`), `RetroParticipantDTO`, `RetroRoomSummaryDTO`, `RetroRoomDTO`, `RetroEvent`, `RetroClientMessage`; requests `CreateRetroRoomRequest`, `UpdateParticipantsRequest`, `CreateRetroCardRequest`, `UpdateRetroCardRequest`, `UpdateCardPositionRequest`, `RetroPhaseRequest`.

- [ ] **Step 1: Update the test**

```ts
// packages/shared/src/retro.test.ts
import { describe, it, expect } from 'vitest'
import { RETRO_ROOM_STATUS, RETRO_CARD_COLORS, RETRO_REGIONS } from './retro'

describe('retro shared contract (canvas)', () => {
  it('sala tem só OPEN e CONCLUDED', () => {
    expect(RETRO_ROOM_STATUS).toEqual(['OPEN', 'CONCLUDED'])
  })
  it('paleta tem 6 cores', () => {
    expect(RETRO_CARD_COLORS).toEqual(['yellow', 'pink', 'green', 'blue', 'purple', 'orange'])
  })
  it('tem as 5 regiões de fundo rotuladas', () => {
    expect(RETRO_REGIONS).toHaveLength(5)
    for (const r of RETRO_REGIONS) {
      expect(r.label).toBeTruthy()
      expect(typeof r.x).toBe('number')
      expect(typeof r.w).toBe('number')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/shared exec vitest run src/retro.test.ts`
Expected: FAIL — `RETRO_ROOM_STATUS` ainda é `['COLLECTING','REVEALED','CONCLUDED']` / `RETRO_REGIONS` indefinido.

- [ ] **Step 3: Rewrite the contract**

Substitua o conteúdo de `packages/shared/src/retro.ts` por:

```ts
import type { PublicUser } from './auth'

export const RETRO_ROOM_STATUS = ['OPEN', 'CONCLUDED'] as const
export type RetroRoomStatus = (typeof RETRO_ROOM_STATUS)[number]

export const RETRO_ROOM_ROLES = ['FACILITATOR', 'PARTICIPANT', 'OBSERVER'] as const
export type RetroRoomRole = (typeof RETRO_ROOM_ROLES)[number]

export const RETRO_CARD_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange'] as const
export type RetroCardColor = (typeof RETRO_CARD_COLORS)[number]

export const RETRO_REACTION_EMOJIS = ['👍', '❤️', '🎯', '💡', '🚀', '🔥'] as const
export type RetroReactionEmoji = (typeof RETRO_REACTION_EMOJIS)[number]

export const MIN_CARD_LENGTH = 1
export const MAX_CARD_LENGTH = 500
export const MAX_ROOM_TITLE_LENGTH = 120
export const MIN_VOTES_PER_PARTICIPANT = 1
export const MAX_VOTES_PER_PARTICIPANT = 20

// Throttle do canal efêmero (cliente). ~30 msgs/s.
export const CURSOR_THROTTLE_MS = 33
export const MOVE_THROTTLE_MS = 33

// Dimensões padrão de um post-it (espaço do mundo) — usado pelo front no hit-test/centralização.
export const POSTIT_WIDTH = 180
export const POSTIT_HEIGHT = 180

/** Regiões de fundo do canvas — guia visual rotulado, SEM vínculo de dado. Coordenadas no mundo. */
export interface RetroRegion {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}
const REGION_W = 360
const REGION_H = 680
const REGION_GAP = 32
export const RETRO_REGIONS: RetroRegion[] = [
  { id: 'went_well', label: 'O que foi bom' },
  { id: 'went_bad', label: 'O que foi ruim' },
  { id: 'start', label: 'O que precisamos começar' },
  { id: 'stop', label: 'O que precisamos parar' },
  { id: 'actions', label: 'Ações' },
].map((r, i) => ({ ...r, x: i * (REGION_W + REGION_GAP), y: 0, w: REGION_W, h: REGION_H }))

export interface RetroReactionSummary {
  emoji: RetroReactionEmoji
  count: number
  reactedByMe: boolean
}

export interface RetroCardDTO {
  id: string
  text: string
  x: number
  y: number
  color: RetroCardColor
  /** null em sala anônima. */
  author: { id: string; name: string } | null
  mine: boolean
  voteCount: number
  myVotes: number
  reactions: RetroReactionSummary[]
  createdAt: string
  updatedAt: string
}

export interface RetroParticipantDTO {
  user: PublicUser
  isCreator: boolean
}

export interface RetroRoomSummaryDTO {
  id: string
  title: string
  status: RetroRoomStatus
  anonymous: boolean
  votesPerParticipant: number
  createdAt: string
  concludedAt: string | null
  creator: { id: string; name: string }
  participantCount: number
  myRole: RetroRoomRole
}

export interface RetroRoomDTO extends RetroRoomSummaryDTO {
  participants: RetroParticipantDTO[]
  cards: RetroCardDTO[]
  myRemainingVotes: number
}

// Eventos servidor → cliente.
export type RetroEvent =
  // autoritativos (pós-persistência)
  | { type: 'card.created'; card: RetroCardDTO }
  | { type: 'card.updated'; card: RetroCardDTO }
  | { type: 'card.moved'; cardId: string; x: number; y: number }
  | { type: 'card.deleted'; cardId: string }
  | { type: 'vote.changed'; cardId: string; voteCount: number }
  | { type: 'reaction.changed'; cardId: string; reactions: RetroReactionSummary[] }
  | { type: 'phase.changed'; status: RetroRoomStatus; concludedAt: string | null }
  | { type: 'presence.changed'; userIds: string[] }
  // efêmeros (relay, não persistem)
  | { type: 'card.moving'; cardId: string; x: number; y: number; byUserId: string }
  | { type: 'cursor.moved'; userId: string; name: string; x: number; y: number }
  | { type: 'card.locked'; cardId: string; byUserId: string; byName: string }
  | { type: 'card.unlocked'; cardId: string }

// Mensagens cliente → servidor (canal efêmero/WS bidirecional).
export type RetroClientMessage =
  | { type: 'cursor'; x: number; y: number }
  | { type: 'card.grab'; cardId: string }
  | { type: 'card.move'; cardId: string; x: number; y: number }
  | { type: 'card.drop'; cardId: string }

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
  text: string
  color: RetroCardColor
  x: number
  y: number
}
export interface UpdateRetroCardRequest {
  text?: string
  color?: RetroCardColor
}
export interface UpdateCardPositionRequest {
  x: number
  y: number
}
export interface RetroPhaseRequest {
  action: 'conclude'
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @legends/shared build` → sem erros.
Run: `pnpm --filter @legends/shared exec vitest run src/retro.test.ts` → PASS.

> Esperado: a partir daqui, `apps/api` e `apps/web` deixam de type-checkar até as Tasks 3–12 ajustarem os consumidores. Isso é normal — cada task seguinte conserta sua camada e roda seus próprios testes (Vitest transpila sem type-check; o `pnpm build` do web só volta a passar após a Task 12).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/retro.ts packages/shared/src/retro.test.ts
git commit -m "feat(shared): contrato do board canvas (x/y/color, OPEN/CONCLUDED, eventos efêmeros)"
```

---

### Task 2: Migration — posição/cor no card + status OPEN/CONCLUDED

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/api/src/services/retro-canvas-schema.test.ts`

**Interfaces:**
- Produces: `RetroCard` com `x Float`, `y Float`, `color String`, **sem** `column`; enum `RetroRoomStatus = OPEN|CONCLUDED`; enum `RetroColumn` removido; `RetroRoom` sem `revealedAt`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/retro-canvas-schema.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'

describe('retro canvas schema', () => {
  it('cria card com x/y/color e sala OPEN', async () => {
    const lead = await prisma.user.create({ data: { name: 'Lia', email: 'lia@x.com', passwordHash: 'x', role: 'LEAD' } })
    const room = await prisma.retroRoom.create({
      data: { title: 'R', createdById: lead.id, anonymous: false, votesPerParticipant: 3, participants: { create: { userId: lead.id } } },
    })
    expect(room.status).toBe('OPEN')
    const card = await prisma.retroCard.create({
      data: { roomId: room.id, authorId: lead.id, text: 'oi', x: 12.5, y: -8, color: 'yellow' },
    })
    expect(card.x).toBe(12.5)
    expect(card.color).toBe('yellow')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/retro-canvas-schema.test.ts`
Expected: FAIL — `Unknown arg 'x'` / default status ainda é `COLLECTING`.

- [ ] **Step 3: Edit the schema**

Em `apps/api/prisma/schema.prisma`:

Troque o enum de status:
```prisma
enum RetroRoomStatus {
  OPEN
  CONCLUDED
}
```
Remova **inteiramente** o enum `RetroColumn`.

No model `RetroRoom`: o `status` agora usa o enum novo (`@default(OPEN)`); **remova** a linha `revealedAt DateTime?`.
```prisma
  status              RetroRoomStatus @default(OPEN)
```

No model `RetroCard`: remova `column RetroColumn` e adicione posição/cor:
```prisma
model RetroCard {
  id        String   @id @default(cuid())
  roomId    String
  authorId  String
  text      String
  x         Float
  y         Float
  color     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  room      RetroRoom       @relation(fields: [roomId], references: [id], onDelete: Cascade)
  author    User            @relation("RetroCards", fields: [authorId], references: [id])
  votes     RetroVote[]
  reactions RetroReaction[]

  @@index([roomId])
  @@index([authorId])
}
```

- [ ] **Step 4: Create the migration by hand (enum recreation + columns)**

`prisma migrate dev` tem dificuldade com remoção de valor de enum; crie a migration manualmente para controlar o SQL. Crie a pasta e arquivo:

`apps/api/prisma/migrations/20260619130000_retro_canvas/migration.sql`
```sql
-- RetroCard: posição + cor; remove categoria
ALTER TABLE "RetroCard" ADD COLUMN "x" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "RetroCard" ADD COLUMN "y" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "RetroCard" ADD COLUMN "color" TEXT NOT NULL DEFAULT 'yellow';
ALTER TABLE "RetroCard" ALTER COLUMN "x" DROP DEFAULT;
ALTER TABLE "RetroCard" ALTER COLUMN "y" DROP DEFAULT;
ALTER TABLE "RetroCard" ALTER COLUMN "color" DROP DEFAULT;
ALTER TABLE "RetroCard" DROP COLUMN "column";
DROP TYPE "RetroColumn";

-- RetroRoom: status OPEN|CONCLUDED (converte COLLECTING/REVEALED -> OPEN), remove revealedAt
ALTER TABLE "RetroRoom" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "RetroRoomStatus_new" AS ENUM ('OPEN', 'CONCLUDED');
ALTER TABLE "RetroRoom" ALTER COLUMN "status" TYPE "RetroRoomStatus_new"
  USING (CASE WHEN "status"::text = 'CONCLUDED' THEN 'CONCLUDED' ELSE 'OPEN' END::"RetroRoomStatus_new");
DROP TYPE "RetroRoomStatus";
ALTER TYPE "RetroRoomStatus_new" RENAME TO "RetroRoomStatus";
ALTER TABLE "RetroRoom" ALTER COLUMN "status" SET DEFAULT 'OPEN';
ALTER TABLE "RetroRoom" DROP COLUMN "revealedAt";
```

- [ ] **Step 5: Apply migration + regenerate client**

Run: `pnpm --filter @legends/api exec prisma migrate deploy`
Expected: aplica `20260619130000_retro_canvas`.
Run: `pnpm db:generate`

> Se `migrate deploy` reclamar de drift, rode `pnpm --filter @legends/api exec prisma migrate status` e confirme que só a nova migration estava pendente. Não edite migrations anteriores.

- [ ] **Step 6: Run the test + full suite**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-canvas-schema.test.ts` → PASS.
Run: `pnpm --filter @legends/api test`
Expected: vários testes do retro **ainda quebram** aqui (services/serialize/routes/ws referenciam `column`/`REVEALED`). Isso é esperado e será corrigido nas Tasks 3–7. Confirme que a falha é só nos arquivos de retro a refatorar, não em outras features.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260619130000_retro_canvas
git commit -m "feat(api): migration do board canvas (x/y/color, status OPEN/CONCLUDED)"
```

---
### Task 3: Service — posição, cor, gating OPEN, sem coluna

Reescreve `retro-service.ts`: remove `column`/`getColumnCounts`/visibilidade COLLECTING; `createCard` recebe `text,color,x,y`; novo `updateCardPosition` (qualquer participante move qualquer card); `updateCard` muda `text?`/`color?`; votos/reações e escrita gated por `assertOpen`; `advancePhase` só `conclude`.

**Files:**
- Modify: `apps/api/src/services/retro-service.ts` (substituição completa)
- Modify: `apps/api/src/services/retro-service.test.ts`, `retro-card-service.test.ts`, `retro-vote-service.test.ts` (ajustar aos novos contratos)
- Test: os três acima

**Interfaces:**
- Produces: `RetroError`, `retroRoomInclude`, `RetroRoomWithRelations`, `RetroCardWithRelations`, `RetroRoomMeta`, `resolveRole`, `createRoom`, `listRoomsForUser`, `getRoomForViewer`, `setParticipants`, `advancePhase(input:{roomId,userId,action:'conclude'})`, `getRoomMeta`, `countUserVotesInRoom`, `loadCard`, `createCard(input:{roomId,userId,text,color,x,y})`, `updateCard(input:{roomId,cardId,userId,text?,color?})`, `updateCardPosition(input:{roomId,cardId,userId,x,y}):Promise<{x:number;y:number}>`, `deleteCard(input:{roomId,cardId,userId}):Promise<void>`, `addVote`, `removeVote`, `toggleReaction`.
- **Removido:** `getColumnCounts`, `assertRevealed`, qualquer uso de `column`/`RetroColumn`/`RetroColumnCounts`.

- [ ] **Step 1: Rewrite the service**

Substitua `apps/api/src/services/retro-service.ts` por:

```ts
import { Prisma } from '@prisma/client'
import {
  MAX_CARD_LENGTH,
  MAX_ROOM_TITLE_LENGTH,
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  RETRO_CARD_COLORS,
  RETRO_REACTION_EMOJIS,
  type RetroCardColor,
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
  cards: { include: { author: true, votes: true, reactions: true }, orderBy: { createdAt: 'asc' } },
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
  const t = title.trim()
  if (t.length === 0) throw new RetroError('O título da sala é obrigatório.', 400)
  if (t.length > MAX_ROOM_TITLE_LENGTH) throw new RetroError('Título muito longo.', 400)
  return t
}
function assertVotes(v: number): void {
  if (!Number.isInteger(v) || v < MIN_VOTES_PER_PARTICIPANT || v > MAX_VOTES_PER_PARTICIPANT) {
    throw new RetroError('Número de votos por participante inválido.', 400)
  }
}
async function assertInvitable(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const users = await prisma.user.findMany({ where: { id: { in: ids } } })
  if (users.length !== new Set(ids).size) throw new RetroError('Algum participante é inválido.', 400)
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
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador gerencia participantes.', 403)
  if (room.status === 'CONCLUDED') throw new RetroError('A sala foi concluída.', 409)
  const desired = new Set([room.createdById, ...input.participantIds])
  await assertInvitable([...desired].filter((id) => id !== room.createdById))
  const current = new Set(room.participants.map((p) => p.userId))
  const toAdd = [...desired].filter((id) => !current.has(id))
  if (toAdd.length) {
    await prisma.retroParticipant.createMany({ data: toAdd.map((userId) => ({ roomId: room.id, userId })) })
  }
  return { room: await loadRoom(room.id), addedUserIds: toAdd }
}

export async function advancePhase(input: {
  roomId: string
  userId: string
  action: 'conclude'
}): Promise<RetroRoomWithRelations> {
  const room = await loadRoom(input.roomId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador muda a fase.', 403)
  if (room.status !== 'OPEN') throw new RetroError('Transição de fase inválida.', 409)
  await prisma.retroRoom.update({ where: { id: room.id }, data: { status: 'CONCLUDED', concludedAt: new Date() } })
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

export function countUserVotesInRoom(roomId: string, userId: string): Promise<number> {
  return prisma.retroVote.count({ where: { userId, card: { roomId } } })
}

export async function loadCard(roomId: string, cardId: string): Promise<RetroCardWithRelations> {
  const card = await prisma.retroCard.findFirst({
    where: { id: cardId, roomId },
    include: { author: true, votes: true, reactions: true },
  })
  if (!card) throw new RetroError('Card não encontrado.', 404)
  return card
}

/** Facilitador ou participante (não observador). */
function assertParticipant(room: RetroRoomWithRelations, userId: string): void {
  const isParticipant = room.createdById === userId || room.participants.some((p) => p.userId === userId)
  if (!isParticipant) throw new RetroError('Apenas participantes da sala podem fazer isso.', 403)
}
function assertOpen(room: RetroRoomWithRelations): void {
  if (room.status !== 'OPEN') throw new RetroError('A sala foi concluída.', 409)
}
function assertText(text: string): string {
  const t = text.trim()
  if (t.length === 0) throw new RetroError('O card não pode ser vazio.', 400)
  if (t.length > MAX_CARD_LENGTH) throw new RetroError('Card muito longo.', 400)
  return t
}
function assertColor(color: string): RetroCardColor {
  if (!(RETRO_CARD_COLORS as readonly string[]).includes(color)) throw new RetroError('Cor inválida.', 400)
  return color as RetroCardColor
}

export async function createCard(input: {
  roomId: string
  userId: string
  text: string
  color: string
  x: number
  y: number
}): Promise<RetroCardWithRelations> {
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  const text = assertText(input.text)
  const color = assertColor(input.color)
  const created = await prisma.retroCard.create({
    data: { roomId: room.id, authorId: input.userId, text, color, x: input.x, y: input.y },
  })
  return loadCard(room.id, created.id)
}

export async function updateCard(input: {
  roomId: string
  cardId: string
  userId: string
  text?: string
  color?: string
}): Promise<RetroCardWithRelations> {
  const room = await loadRoom(input.roomId)
  assertOpen(room)
  const card = await loadCard(input.roomId, input.cardId)
  if (card.authorId !== input.userId) throw new RetroError('Apenas o autor edita o card.', 403)
  const data: { text?: string; color?: RetroCardColor } = {}
  if (input.text !== undefined) data.text = assertText(input.text)
  if (input.color !== undefined) data.color = assertColor(input.color)
  if (Object.keys(data).length > 0) await prisma.retroCard.update({ where: { id: card.id }, data })
  return loadCard(input.roomId, card.id)
}

/** Qualquer participante pode mover qualquer card (canvas livre). */
export async function updateCardPosition(input: {
  roomId: string
  cardId: string
  userId: string
  x: number
  y: number
}): Promise<{ x: number; y: number }> {
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  const card = await loadCard(input.roomId, input.cardId)
  await prisma.retroCard.update({ where: { id: card.id }, data: { x: input.x, y: input.y } })
  return { x: input.x, y: input.y }
}

export async function deleteCard(input: { roomId: string; cardId: string; userId: string }): Promise<void> {
  const room = await loadRoom(input.roomId)
  assertOpen(room)
  const card = await loadCard(input.roomId, input.cardId)
  if (card.authorId !== input.userId) throw new RetroError('Apenas o autor exclui o card.', 403)
  await prisma.retroCard.delete({ where: { id: card.id } })
}

export async function addVote(input: { roomId: string; cardId: string; userId: string }): Promise<{ voteCount: number }> {
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  await loadCard(input.roomId, input.cardId)
  const used = await countUserVotesInRoom(input.roomId, input.userId)
  if (used >= room.votesPerParticipant) throw new RetroError('Você já usou todos os seus votos.', 409)
  await prisma.retroVote.create({ data: { cardId: input.cardId, userId: input.userId } })
  return { voteCount: await prisma.retroVote.count({ where: { cardId: input.cardId } }) }
}

export async function removeVote(input: { roomId: string; cardId: string; userId: string }): Promise<{ voteCount: number }> {
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  const one = await prisma.retroVote.findFirst({
    where: { cardId: input.cardId, userId: input.userId, card: { roomId: input.roomId } },
    orderBy: { createdAt: 'desc' },
  })
  if (one) await prisma.retroVote.delete({ where: { id: one.id } })
  return { voteCount: await prisma.retroVote.count({ where: { cardId: input.cardId } }) }
}

export async function toggleReaction(input: {
  roomId: string
  cardId: string
  userId: string
  emoji: string
}): Promise<RetroCardWithRelations> {
  if (!(RETRO_REACTION_EMOJIS as readonly string[]).includes(input.emoji)) throw new RetroError('Reação inválida.', 400)
  const room = await loadRoom(input.roomId)
  assertParticipant(room, input.userId)
  assertOpen(room)
  await loadCard(input.roomId, input.cardId)
  const existing = await prisma.retroReaction.findUnique({
    where: { cardId_userId_emoji: { cardId: input.cardId, userId: input.userId, emoji: input.emoji } },
  })
  if (existing) await prisma.retroReaction.delete({ where: { id: existing.id } })
  else await prisma.retroReaction.create({ data: { cardId: input.cardId, userId: input.userId, emoji: input.emoji } })
  return loadCard(input.roomId, input.cardId)
}
```

- [ ] **Step 2: Update the service tests to the new contracts**

Atualize os três arquivos de teste existentes. As mudanças mecânicas:
- Em `retro-service.test.ts`: o teste de fases agora é só `OPEN→CONCLUDED`. Substitua o caso de fases por:
```ts
  it('conclui a sala (OPEN→CONCLUDED) só pelo facilitador; transição inválida = 409', async () => {
    const lead = await mkUser('L', 'LEAD')
    const dev = await mkUser('D', 'DEV')
    const room = await createRoom({ creatorId: lead.id, title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] })
    await expect(advancePhase({ roomId: room.id, userId: dev.id, action: 'conclude' })).rejects.toMatchObject({ status: 403 })
    const done = await advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude' })
    expect(done.status).toBe('CONCLUDED')
    await expect(advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude' })).rejects.toMatchObject({ status: 409 })
  })
```
  Remova qualquer assert de `revealedAt`/`reveal`.
- Em `retro-card-service.test.ts`: trocar `createCard({ ..., column: 'START', text })` por `createCard({ ..., text, color: 'yellow', x: 0, y: 0 })`; remover o teste "criar card em REVEALED" (não há REVEALED); manter "criar em OPEN" e "bloqueado em CONCLUDED (409)" (concluir via `advancePhase('conclude')`). Adicionar:
```ts
  it('qualquer participante move qualquer card (updateCardPosition)', async () => {
    const { lead, dev, r } = await room()
    const card = await createCard({ roomId: r.id, userId: dev.id, text: 'x', color: 'pink', x: 1, y: 2 })
    const moved = await updateCardPosition({ roomId: r.id, cardId: card.id, userId: lead.id, x: 50, y: 60 })
    expect(moved).toEqual({ x: 50, y: 60 })
  })
  it('rejeita cor inválida (400)', async () => {
    const { dev, r } = await room()
    await expect(createCard({ roomId: r.id, userId: dev.id, text: 'x', color: 'turquoise', x: 0, y: 0 })).rejects.toMatchObject({ status: 400 })
  })
```
  (Importe `updateCardPosition` no topo do arquivo de teste.)
- Em `retro-vote-service.test.ts`: votar/reagir agora vale em **OPEN** (não precisa revelar). Remova a etapa `advancePhase('reveal')` e o teste "votar só é permitido em REVEALED"; em vez disso garanta que vota direto numa sala OPEN, e adicione que **CONCLUDED bloqueia** votar:
```ts
  it('não vota em sala concluída (409)', async () => {
    const { lead, dev, r, card } = await openRoomWithCard(2)
    await advancePhase({ roomId: r.id, userId: lead.id, action: 'conclude' })
    await expect(addVote({ roomId: r.id, cardId: card.id, userId: dev.id })).rejects.toMatchObject({ status: 409 })
  })
```
  Ajuste o helper para criar card com `text/color/x/y` e NÃO revelar (sala nasce OPEN). Importe `advancePhase`.

- [ ] **Step 3: Run the service tests**

Run: `pnpm --filter @legends/api exec vitest run src/services/retro-service.test.ts src/services/retro-card-service.test.ts src/services/retro-vote-service.test.ts`
Expected: PASS (após ajustes). Se algum teste antigo ainda referenciar `column`/`reveal`, corrija-o conforme acima.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/services/retro-service.test.ts apps/api/src/services/retro-card-service.test.ts apps/api/src/services/retro-vote-service.test.ts
git commit -m "feat(api): service do board canvas (posição, OPEN/CONCLUDED, sem coluna)"
```

---
### Task 4: Serialização (x/y/color, sem columnCounts/visibilidade)

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/lib/serialize-retro.test.ts`

**Interfaces:**
- Produces: `toRetroCardDTO(card, ctx:{viewerId,anonymous})` → DTO com `x,y,color` (sem `column`); `toRetroRoomSummaryDTO(room, role)` (sem `revealedAt`, status OPEN/CONCLUDED); `toRetroRoomDTO(room, viewer:{id}, role)` → todos os cards (sem filtro de fase), sem `columnCounts`.

- [ ] **Step 1: Update the test**

Substitua o teste de visibilidade COLLECTING e o de `author` por:

```ts
// apps/api/src/lib/serialize-retro.test.ts — casos relevantes
it('inclui x/y/color e omite autor em sala anônima mas marca mine', () => {
  const dto = toRetroCardDTO(card({ x: 10, y: 20, color: 'pink' }), { viewerId: 'u1', anonymous: true })
  expect(dto).toMatchObject({ x: 10, y: 20, color: 'pink', author: null, mine: true })
})

it('room DTO traz TODOS os cards (sem filtro de fase) e sem columnCounts', () => {
  const room = {
    id: 'r1', title: 'A', status: 'OPEN', anonymous: false, votesPerParticipant: 3,
    createdAt: new Date(), concludedAt: null, createdById: 'lead',
    creator: { ...baseUser, id: 'lead', name: 'Lia' },
    participants: [{ userId: 'lead', user: { ...baseUser, id: 'lead', name: 'Lia' } }, { userId: 'u1', user: { ...baseUser } }],
    cards: [card({ id: 'c1', authorId: 'u1' }), card({ id: 'c2', authorId: 'lead' })],
  } as unknown as RetroRoomWithRelations
  const dto = toRetroRoomDTO(room, { id: 'u1' }, 'PARTICIPANT')
  expect(dto.cards.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
  expect((dto as any).columnCounts).toBeUndefined()
  expect(dto.myRemainingVotes).toBe(3)
})
```

Atualize o helper `card()` do teste para usar `x/y/color` em vez de `column`:
```ts
function card(over: Partial<any> = {}) {
  return {
    id: 'c1', roomId: 'r1', authorId: 'u1', text: 'oi', x: 0, y: 0, color: 'yellow',
    createdAt: new Date(), updatedAt: new Date(),
    author: { ...baseUser }, votes: [], reactions: [], ...over,
  } as any
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/lib/serialize-retro.test.ts`
Expected: FAIL — `toRetroCardDTO` ainda devolve `column`/`toRetroRoomDTO` filtra por fase.

- [ ] **Step 3: Replace the retro serializers**

No topo de `serialize.ts`, no import de `@legends/shared`, **remova** `RETRO_COLUMNS` e os tipos `RetroColumnCounts`; mantenha `RETRO_REACTION_EMOJIS`, `RetroCardDTO`, `RetroReactionSummary`, `RetroRoomDTO`, `RetroRoomRole`, `RetroRoomSummaryDTO`. Substitua o bloco de funções retro (de `summarizeRetroReactions` até `toRetroRoomDTO`) por:

```ts
function summarizeRetroReactions(
  reactions: { emoji: string; userId: string }[],
  viewerId: string,
): RetroReactionSummary[] {
  return RETRO_REACTION_EMOJIS.flatMap((emoji) => {
    const matching = reactions.filter((r) => r.emoji === emoji)
    if (matching.length === 0) return []
    return [{ emoji, count: matching.length, reactedByMe: matching.some((r) => r.userId === viewerId) }]
  })
}

export function toRetroCardDTO(
  card: RetroCardWithRelations,
  ctx: { viewerId: string; anonymous: boolean },
): RetroCardDTO {
  return {
    id: card.id,
    text: card.text,
    x: card.x,
    y: card.y,
    color: card.color as RetroCardDTO['color'],
    author: ctx.anonymous ? null : { id: card.author.id, name: card.author.name },
    mine: card.authorId === ctx.viewerId,
    voteCount: card.votes.length,
    myVotes: card.votes.filter((v) => v.userId === ctx.viewerId).length,
    reactions: summarizeRetroReactions(card.reactions, ctx.viewerId),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  }
}

export function toRetroRoomSummaryDTO(room: RetroRoomWithRelations, role: RetroRoomRole): RetroRoomSummaryDTO {
  return {
    id: room.id,
    title: room.title,
    status: room.status,
    anonymous: room.anonymous,
    votesPerParticipant: room.votesPerParticipant,
    createdAt: room.createdAt.toISOString(),
    concludedAt: room.concludedAt ? room.concludedAt.toISOString() : null,
    creator: { id: room.creator.id, name: room.creator.name },
    participantCount: room.participants.length,
    myRole: role,
  }
}

export function toRetroRoomDTO(
  room: RetroRoomWithRelations,
  viewer: { id: string },
  role: RetroRoomRole,
): RetroRoomDTO {
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
    cards: room.cards.map((c) => toRetroCardDTO(c, { viewerId: viewer.id, anonymous: room.anonymous })),
    myRemainingVotes: Math.max(0, room.votesPerParticipant - usedVotes),
  }
}
```

Remova a função `emptyColumnCounts` (não é mais usada).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/lib/serialize-retro.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize-retro.test.ts
git commit -m "feat(api): DTOs canvas (x/y/color, todos os cards visíveis, sem columnCounts)"
```

---

### Task 5: Hub — soft-lock + nome na conexão

Adiciona estado de soft-lock por sala e o nome do usuário à conexão (para `cursor.moved`/`card.locked`). O relay efêmero reaproveita `broadcast`.

**Files:**
- Modify: `apps/api/src/lib/retro-hub.ts`
- Modify: `apps/api/src/lib/retro-hub.test.ts`

**Interfaces:**
- Produces: `RetroConnection` agora `{ socket: RetroSocket; userId: string; name: string }`; `RetroHub` ganha `grabCard(roomId, cardId, userId, name): boolean`, `dropCard(roomId, cardId, userId): boolean`, `lockOwner(roomId, cardId): { userId: string; name: string } | undefined`, `releaseLocksHeldBy(roomId, userId): string[]` (retorna cardIds liberados). `subscribe/unsubscribe/presentUserIds/broadcast` inalterados em assinatura.

- [ ] **Step 1: Add failing hub tests**

Acrescente a `retro-hub.test.ts` (e ajuste `fakeConn` para incluir `name`):

```ts
function fakeConn(userId: string, name = userId) {
  return { socket: { send: vi.fn() }, userId, name }
}

describe('RetroHub soft-lock', () => {
  it('grab trava; segundo grab de outro usuário é negado; drop libera', () => {
    const hub = new RetroHub()
    expect(hub.grabCard('r1', 'c1', 'u1', 'Ana')).toBe(true)
    expect(hub.grabCard('r1', 'c1', 'u2', 'Bia')).toBe(false)
    expect(hub.lockOwner('r1', 'c1')).toEqual({ userId: 'u1', name: 'Ana' })
    expect(hub.dropCard('r1', 'c1', 'u2')).toBe(false) // não é o dono
    expect(hub.dropCard('r1', 'c1', 'u1')).toBe(true)
    expect(hub.lockOwner('r1', 'c1')).toBeUndefined()
    expect(hub.grabCard('r1', 'c1', 'u2', 'Bia')).toBe(true) // agora livre
  })

  it('releaseLocksHeldBy libera todos os locks do usuário e retorna os cardIds', () => {
    const hub = new RetroHub()
    hub.grabCard('r1', 'c1', 'u1', 'Ana')
    hub.grabCard('r1', 'c2', 'u1', 'Ana')
    hub.grabCard('r1', 'c3', 'u2', 'Bia')
    const freed = hub.releaseLocksHeldBy('r1', 'u1').sort()
    expect(freed).toEqual(['c1', 'c2'])
    expect(hub.lockOwner('r1', 'c3')).toEqual({ userId: 'u2', name: 'Bia' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/lib/retro-hub.test.ts`
Expected: FAIL — `grabCard` não existe.

- [ ] **Step 3: Extend the hub**

Em `retro-hub.ts`, atualize a interface da conexão e some o estado de locks:

```ts
export interface RetroConnection {
  socket: RetroSocket
  userId: string
  name: string
}
```

Dentro da classe `RetroHub`, adicione o campo e os métodos (mantendo subscribe/unsubscribe/presentUserIds/broadcast como estão):

```ts
  private locks = new Map<string, Map<string, { userId: string; name: string }>>()

  private roomLocks(roomId: string): Map<string, { userId: string; name: string }> {
    let m = this.locks.get(roomId)
    if (!m) {
      m = new Map()
      this.locks.set(roomId, m)
    }
    return m
  }

  /** Adquire o lock se livre ou já é do próprio usuário. Retorna false se está com outro. */
  grabCard(roomId: string, cardId: string, userId: string, name: string): boolean {
    const m = this.roomLocks(roomId)
    const cur = m.get(cardId)
    if (cur && cur.userId !== userId) return false
    m.set(cardId, { userId, name })
    return true
  }

  /** Libera o lock se for do usuário. Retorna true se liberou. */
  dropCard(roomId: string, cardId: string, userId: string): boolean {
    const m = this.locks.get(roomId)
    const cur = m?.get(cardId)
    if (m && cur && cur.userId === userId) {
      m.delete(cardId)
      return true
    }
    return false
  }

  lockOwner(roomId: string, cardId: string): { userId: string; name: string } | undefined {
    return this.locks.get(roomId)?.get(cardId)
  }

  /** Libera todos os locks do usuário na sala (ex.: no disconnect). Retorna os cardIds liberados. */
  releaseLocksHeldBy(roomId: string, userId: string): string[] {
    const m = this.locks.get(roomId)
    if (!m) return []
    const freed: string[] = []
    for (const [cardId, owner] of m) {
      if (owner.userId === userId) {
        m.delete(cardId)
        freed.push(cardId)
      }
    }
    return freed
  }
```

> Nota (v1, instância única): `releaseLocksHeldBy` libera por `userId`, então se o mesmo usuário tiver duas abas e uma fechar, locks da outra também caem. Raro numa retro; aceitável e documentado.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/lib/retro-hub.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/retro-hub.ts apps/api/src/lib/retro-hub.test.ts
git commit -m "feat(api): soft-lock no hub + nome na conexão"
```

---
### Task 6: Rotas REST (position, cor, sem columnCounts/reveal)

**Files:**
- Modify: `apps/api/src/routes/retro.ts` (substituição completa)
- Modify: `apps/api/src/routes/retro.test.ts`

**Interfaces:**
- Consumes: service (Task 3), serialize (Task 4), `retroHub` (Task 5), `notifyRetroInvited`.
- Produces: `retroRoutes(app)` com endpoints: POST `/retro/rooms`, GET `/retro/rooms`, GET `/retro/rooms/:id`, PATCH `/retro/rooms/:id/participants`, POST `/retro/rooms/:id/phase` (`conclude`), POST `/retro/rooms/:id/cards` (`{text,color,x,y}`), PATCH `.../cards/:cardId` (`{text?,color?}`), **PATCH `.../cards/:cardId/position` (`{x,y}`)**, DELETE `.../cards/:cardId`, POST/DELETE `.../cards/:cardId/votes`, POST `.../cards/:cardId/reactions`.

- [ ] **Step 1: Replace the routes file**

Substitua `apps/api/src/routes/retro.ts` por:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  MAX_CARD_LENGTH,
  MAX_ROOM_TITLE_LENGTH,
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  RETRO_CARD_COLORS,
  RETRO_REACTION_EMOJIS,
} from '@legends/shared'
import {
  RetroError,
  addVote,
  advancePhase,
  countUserVotesInRoom,
  createCard,
  createRoom,
  deleteCard,
  getRoomForViewer,
  getRoomMeta,
  listRoomsForUser,
  removeVote,
  resolveRole,
  setParticipants,
  toggleReaction,
  updateCard,
  updateCardPosition,
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
const phaseSchema = z.object({ action: z.literal('conclude') })
const createCardSchema = z.object({
  text: z.string().trim().min(1).max(MAX_CARD_LENGTH),
  color: z.enum(RETRO_CARD_COLORS),
  x: z.number(),
  y: z.number(),
})
const updateCardSchema = z
  .object({ text: z.string().trim().min(1).max(MAX_CARD_LENGTH).optional(), color: z.enum(RETRO_CARD_COLORS).optional() })
  .refine((d) => d.text !== undefined || d.color !== undefined, { message: 'Nada para atualizar.' })
const positionSchema = z.object({ x: z.number(), y: z.number() })
const reactionSchema = z.object({ emoji: z.enum(RETRO_REACTION_EMOJIS) })

const badBody = { message: 'Dados inválidos.' }

/** card.created/updated por-viewer (anonimato + `mine`/`myVotes` variam por usuário). */
function broadcastCard(type: 'card.created' | 'card.updated', meta: RetroRoomMeta, card: RetroCardWithRelations): void {
  retroHub.broadcast(meta.id, (viewerId) => ({
    type,
    card: toRetroCardDTO(card, { viewerId, anonymous: meta.anonymous }),
  }))
}

export async function retroRoutes(app: FastifyInstance) {
  app.post('/retro/rooms', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = createRoomSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    try {
      const room = await createRoom({ creatorId: request.user.sub, ...parsed.data })
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

  app.get('/retro/rooms', { onRequest: [app.authenticate] }, async (request, reply) => {
    const rooms = await listRoomsForUser({ id: request.user.sub, role: request.user.role })
    const dtos = rooms.map((room) =>
      toRetroRoomSummaryDTO(room, resolveRole(room, { id: request.user.sub, role: request.user.role }) ?? 'OBSERVER'),
    )
    return reply.send({ rooms: dtos })
  })

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

  app.patch('/retro/rooms/:id/participants', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = participantsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { room, addedUserIds } = await setParticipants({ roomId: id, userId: request.user.sub, participantIds: parsed.data.participantIds })
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

  app.post('/retro/rooms/:id/phase', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = phaseSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const room = await advancePhase({ roomId: id, userId: request.user.sub, action: parsed.data.action })
      retroHub.broadcast(room.id, () => ({
        type: 'phase.changed',
        status: room.status,
        concludedAt: room.concludedAt ? room.concludedAt.toISOString() : null,
      }))
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/cards', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = createCardSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const card = await createCard({ roomId: id, userId: request.user.sub, ...parsed.data })
      const meta = await getRoomMeta(id)
      if (meta) broadcastCard('card.created', meta, card)
      return reply.code(201).send({ card: toRetroCardDTO(card, { viewerId: request.user.sub, anonymous: meta?.anonymous ?? true }) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/retro/rooms/:id/cards/:cardId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = updateCardSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const card = await updateCard({ roomId: id, cardId, userId: request.user.sub, ...parsed.data })
      const meta = await getRoomMeta(id)
      if (meta) broadcastCard('card.updated', meta, card)
      return reply.send({ card: toRetroCardDTO(card, { viewerId: request.user.sub, anonymous: meta?.anonymous ?? true }) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/retro/rooms/:id/cards/:cardId/position', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = positionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { x, y } = await updateCardPosition({ roomId: id, cardId, userId: request.user.sub, ...parsed.data })
      retroHub.broadcast(id, () => ({ type: 'card.moved', cardId, x, y }))
      return reply.send({ x, y })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/retro/rooms/:id/cards/:cardId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      await deleteCard({ roomId: id, cardId, userId: request.user.sub })
      retroHub.broadcast(id, () => ({ type: 'card.deleted', cardId }))
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/cards/:cardId/votes', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { voteCount } = await addVote({ roomId: id, cardId, userId: request.user.sub })
      retroHub.broadcast(id, () => ({ type: 'vote.changed', cardId, voteCount }))
      const meta = await getRoomMeta(id)
      const used = await countUserVotesInRoom(id, request.user.sub)
      return reply.send({ voteCount, myRemainingVotes: Math.max(0, (meta?.votesPerParticipant ?? 0) - used) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/retro/rooms/:id/cards/:cardId/votes', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const { voteCount } = await removeVote({ roomId: id, cardId, userId: request.user.sub })
      retroHub.broadcast(id, () => ({ type: 'vote.changed', cardId, voteCount }))
      const meta = await getRoomMeta(id)
      const used = await countUserVotesInRoom(id, request.user.sub)
      return reply.send({ voteCount, myRemainingVotes: Math.max(0, (meta?.votesPerParticipant ?? 0) - used) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/retro/rooms/:id/cards/:cardId/reactions', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id, cardId } = request.params as { id: string; cardId: string }
    try {
      const card = await toggleReaction({ roomId: id, cardId, userId: request.user.sub, emoji: parsed.data.emoji })
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

> `app.register(retroRoutes)` já existe em `app.ts` desde a feature original — não precisa mexer.

- [ ] **Step 2: Update the route tests**

Em `apps/api/src/routes/retro.test.ts`:
- Trocar criação de card: `payload: { column: 'WENT_WELL', text: 'Deploy tranquilo' }` → `payload: { text: 'Deploy tranquilo', color: 'yellow', x: 10, y: 20 }`; e o assert do `myRole` continua.
- Remover o teste "em COLLECTING esconde card de outro participante" (não há mais COLLECTING/visibilidade) e o `columnCounts`.
- O fluxo "cria card, revela, vota e reage" vira **sem revelar** (vota direto, sala OPEN). Remover a chamada de `phase {action:'reveal'}`. A chamada de conclude usa `{ action: 'conclude' }`.
- Adicionar:
```ts
  it('move card via PATCH position e responde {x,y}', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app); const dev = await devToken(app)
    const created = await app.inject({ method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` }, payload: { title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] } })
    const roomId = created.json().room.id
    const card = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` }, payload: { text: 'x', color: 'green', x: 0, y: 0 } })
    const cardId = card.json().card.id
    const moved = await app.inject({ method: 'PATCH', url: `/retro/rooms/${roomId}/cards/${cardId}/position`, headers: { authorization: `Bearer ${lead.token}` }, payload: { x: 99, y: -5 } })
    expect(moved.statusCode).toBe(200)
    expect(moved.json()).toEqual({ x: 99, y: -5 })
  })

  it('vota em sala OPEN (sem revelar) e bloqueia após concluir (409)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app); const dev = await devToken(app)
    const created = await app.inject({ method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` }, payload: { title: 'A', anonymous: false, votesPerParticipant: 2, participantIds: [dev.id] } })
    const roomId = created.json().room.id
    const card = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` }, payload: { text: 'x', color: 'blue', x: 0, y: 0 } })
    const cardId = card.json().card.id
    const v = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/votes`, headers: { authorization: `Bearer ${dev.token}` } })
    expect(v.statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/phase`, headers: { authorization: `Bearer ${lead.token}` }, payload: { action: 'conclude' } })
    const blocked = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards/${cardId}/votes`, headers: { authorization: `Bearer ${dev.token}` } })
    expect(blocked.statusCode).toBe(409)
    await app.close()
  })
```
  Ajuste o `payload` inválido do teste de validação (ex.: faltar `color`/`x` deve dar 400).

- [ ] **Step 3: Run the route tests**

Run: `pnpm --filter @legends/api exec vitest run src/routes/retro.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/retro.ts apps/api/src/routes/retro.test.ts
git commit -m "feat(api): rotas canvas (position, cor, sem columnCounts/reveal)"
```

---

### Task 7: WebSocket bidirecional (cursor, grab/move/drop)

Adiciona o tratamento de mensagens cliente→servidor no WS: relay efêmero de cursores e movimento, soft-lock via hub, liberação de locks no disconnect. Mantém a auth `preValidation` e a presença.

**Files:**
- Modify: `apps/api/src/routes/retro-ws.ts`
- Modify: `apps/api/src/routes/retro-ws.test.ts`

**Interfaces:**
- Consumes: `retroHub` (grab/drop/release + broadcast), `getRoomMeta`, `prisma` (nome do usuário), tipos `RetroClientMessage` de `@legends/shared`.
- Produces: rota WS que aceita `RetroClientMessage` e emite eventos efêmeros (`cursor.moved`, `card.moving`, `card.locked`, `card.unlocked`).

- [ ] **Step 1: Add failing integration tests**

Acrescente a `retro-ws.test.ts` (mantendo os 2 testes existentes de "recebe card.created" e "recusa token inválido", ajustando o de card.created para criar card com `{text,color,x,y}` e sem revelar):

```ts
function waitForMessage(ws: WebSocket, predicate: (m: any) => boolean, timeoutMs = 1500) {
  return new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout esperando mensagem WS')), timeoutMs)
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (predicate(m)) { clearTimeout(t); resolve(m) }
    })
  })
}

it('relay de grab/move/drop e cursor entre dois clientes', async () => {
  const app = buildApp(); await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as { port: number }).port
  const lead = await prisma.user.create({ data: { name: 'Lia', email: 'lia@x.com', passwordHash: 'x', role: 'LEAD' } })
  const dev = await prisma.user.create({ data: { name: 'Dan', email: 'dan@x.com', passwordHash: 'x', role: 'DEV' } })
  const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
  const devTk = app.jwt.sign({ sub: dev.id, role: 'DEV' })
  const created = await app.inject({ method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` }, payload: { title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] } })
  const roomId = created.json().room.id
  const card = await app.inject({ method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${leadTk}` }, payload: { text: 'x', color: 'yellow', x: 0, y: 0 } })
  const cardId = card.json().card.id

  const wsA = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${leadTk}`)
  const wsB = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${devTk}`)
  await Promise.all([
    new Promise((r) => wsA.on('open', r)),
    new Promise((r) => wsB.on('open', r)),
  ])

  // A pega o card; B recebe card.locked
  const lockedOnB = waitForMessage(wsB, (m) => m.type === 'card.locked' && m.cardId === cardId)
  wsA.send(JSON.stringify({ type: 'card.grab', cardId }))
  const locked = await lockedOnB
  expect(locked.byUserId).toBe(lead.id)

  // A move; B recebe card.moving
  const movingOnB = waitForMessage(wsB, (m) => m.type === 'card.moving' && m.cardId === cardId)
  wsA.send(JSON.stringify({ type: 'card.move', cardId, x: 42, y: 7 }))
  const moving = await movingOnB
  expect(moving).toMatchObject({ x: 42, y: 7, byUserId: lead.id })

  // A solta; B recebe card.unlocked
  const unlockedOnB = waitForMessage(wsB, (m) => m.type === 'card.unlocked' && m.cardId === cardId)
  wsA.send(JSON.stringify({ type: 'card.drop', cardId }))
  await unlockedOnB

  // cursor de A chega em B
  const cursorOnB = waitForMessage(wsB, (m) => m.type === 'cursor.moved' && m.userId === lead.id)
  wsA.send(JSON.stringify({ type: 'cursor', x: 5, y: 9 }))
  const cur = await cursorOnB
  expect(cur).toMatchObject({ name: 'Lia', x: 5, y: 9 })

  wsA.close(); wsB.close(); await app.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/routes/retro-ws.test.ts`
Expected: FAIL — nenhuma mensagem efêmera é repassada (o WS ainda é push-only).

- [ ] **Step 3: Implement the bidirectional handler**

Substitua `apps/api/src/routes/retro-ws.ts` por:

```ts
import type { FastifyInstance } from 'fastify'
import type { RetroClientMessage } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getRoomMeta } from '../services/retro-service'
import { retroHub, type RetroConnection } from '../lib/retro-hub'

export async function retroWsRoutes(app: FastifyInstance) {
  app.get(
    '/retro/rooms/:id/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        let userId: string
        let role: string
        try {
          const payload = app.jwt.verify(token) as { sub: string; role: string }
          userId = payload.sub
          role = payload.role
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }
        const { id } = request.params as { id: string }
        const meta = await getRoomMeta(id)
        if (!meta) return reply.code(404).send({ message: 'Sala não encontrada' })
        const isMember = meta.createdById === userId || meta.participantUserIds.includes(userId)
        if (!isMember && role !== 'LEAD') return reply.code(403).send({ message: 'Sem acesso' })
        ;(request as { _wsUserId?: string })._wsUserId = userId
      },
    },
    async (connection, request) => {
      const ws = connection.socket
      const { id: roomId } = request.params as { id: string }
      const userId = (request as { _wsUserId?: string })._wsUserId as string
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
      const name = user?.name ?? 'Alguém'

      const conn: RetroConnection = { socket: ws, userId, name }
      retroHub.subscribe(roomId, conn)
      const pushPresence = () =>
        retroHub.broadcast(roomId, () => ({ type: 'presence.changed', userIds: retroHub.presentUserIds(roomId) }))
      pushPresence()

      ws.on('message', (raw: unknown) => {
        let msg: RetroClientMessage
        try {
          msg = JSON.parse(String(raw)) as RetroClientMessage
        } catch {
          return
        }
        switch (msg.type) {
          case 'cursor':
            retroHub.broadcast(roomId, (viewerId) =>
              viewerId === userId ? null : { type: 'cursor.moved', userId, name, x: msg.x, y: msg.y },
            )
            break
          case 'card.grab':
            if (retroHub.grabCard(roomId, msg.cardId, userId, name)) {
              retroHub.broadcast(roomId, (viewerId) =>
                viewerId === userId ? null : { type: 'card.locked', cardId: msg.cardId, byUserId: userId, byName: name },
              )
            }
            break
          case 'card.move':
            if (retroHub.lockOwner(roomId, msg.cardId)?.userId === userId) {
              retroHub.broadcast(roomId, (viewerId) =>
                viewerId === userId ? null : { type: 'card.moving', cardId: msg.cardId, x: msg.x, y: msg.y, byUserId: userId },
              )
            }
            break
          case 'card.drop':
            if (retroHub.dropCard(roomId, msg.cardId, userId)) {
              retroHub.broadcast(roomId, () => ({ type: 'card.unlocked', cardId: msg.cardId }))
            }
            break
        }
      })

      ws.on('close', () => {
        const freed = retroHub.releaseLocksHeldBy(roomId, userId)
        retroHub.unsubscribe(roomId, conn)
        for (const cardId of freed) {
          retroHub.broadcast(roomId, () => ({ type: 'card.unlocked', cardId }))
        }
        pushPresence()
      })
    },
  )
}
```

- [ ] **Step 4: Run test + full suite**

Run: `pnpm --filter @legends/api exec vitest run src/routes/retro-ws.test.ts` → PASS.
Run: `pnpm --filter @legends/api test` → tudo verde (toda a API já está migrada).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/retro-ws.ts apps/api/src/routes/retro-ws.test.ts
git commit -m "feat(api): WebSocket bidirecional (cursor, grab/move/drop, soft-lock)"
```

---
### Task 8: Web — cliente REST atualizado

**Files:**
- Modify: `apps/web/src/lib/retro-api.ts`

**Interfaces:**
- Produces: `createRetroCard(roomId, body: CreateRetroCardRequest)`, `updateRetroCard(roomId, cardId, body: UpdateRetroCardRequest)`, `updateRetroCardPosition(roomId, cardId, x, y): Promise<{x:number;y:number}>`, `advanceRetroPhase(id, action:'conclude')`; mantém `listRetroRooms`, `getRetroRoom`, `createRetroRoom`, `setRetroParticipants`, `deleteRetroCard`, `addRetroVote`, `removeRetroVote`, `toggleRetroReaction`, `listInvitableUsers`.

- [ ] **Step 1: Replace the client**

Substitua `apps/web/src/lib/retro-api.ts` por:

```ts
import type {
  CreateRetroCardRequest,
  CreateRetroRoomRequest,
  PublicUser,
  RetroCardDTO,
  RetroReactionEmoji,
  RetroReactionSummary,
  RetroRoomDTO,
  RetroRoomSummaryDTO,
  UpdateRetroCardRequest,
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
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/participants`, { method: 'PATCH', body: JSON.stringify({ participantIds }) })
}
export function advanceRetroPhase(id: string, action: 'conclude' = 'conclude') {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/phase`, { method: 'POST', body: JSON.stringify({ action }) })
}
export function createRetroCard(roomId: string, body: CreateRetroCardRequest) {
  return apiFetch<{ card: RetroCardDTO }>(`/retro/rooms/${roomId}/cards`, { method: 'POST', body: JSON.stringify(body) })
}
export function updateRetroCard(roomId: string, cardId: string, body: UpdateRetroCardRequest) {
  return apiFetch<{ card: RetroCardDTO }>(`/retro/rooms/${roomId}/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(body) })
}
export function updateRetroCardPosition(roomId: string, cardId: string, x: number, y: number) {
  return apiFetch<{ x: number; y: number }>(`/retro/rooms/${roomId}/cards/${cardId}/position`, { method: 'PATCH', body: JSON.stringify({ x, y }) })
}
export function deleteRetroCard(roomId: string, cardId: string) {
  return apiFetch<void>(`/retro/rooms/${roomId}/cards/${cardId}`, { method: 'DELETE' })
}
export function addRetroVote(roomId: string, cardId: string) {
  return apiFetch<{ voteCount: number; myRemainingVotes: number }>(`/retro/rooms/${roomId}/cards/${cardId}/votes`, { method: 'POST' })
}
export function removeRetroVote(roomId: string, cardId: string) {
  return apiFetch<{ voteCount: number; myRemainingVotes: number }>(`/retro/rooms/${roomId}/cards/${cardId}/votes`, { method: 'DELETE' })
}
export function toggleRetroReaction(roomId: string, cardId: string, emoji: RetroReactionEmoji) {
  return apiFetch<{ reactions: RetroReactionSummary[] }>(`/retro/rooms/${roomId}/cards/${cardId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) })
}
export function listInvitableUsers() {
  return apiFetch<{ users: PublicUser[] }>('/users')
}
```

- [ ] **Step 2: Verify it type-checks against shared**

Run: `pnpm --filter @legends/web exec tsc --noEmit -p tsconfig.json 2>&1 | grep retro-api || echo "retro-api OK"`
Expected: sem erros apontando para `retro-api.ts` (outros arquivos retro do web ainda quebram até Tasks 9–12).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/retro-api.ts
git commit -m "feat(web): cliente REST canvas (position, cor, conclude)"
```

---

### Task 9: Web — hook WebSocket bidirecional

Reescreve `useRetroSocket`: aplica eventos autoritativos no cache `['retro-room', id]`, aplica `card.moving` ao vivo, mantém estado de **cursores** e **locks**, e expõe funções de **envio** (`sendCursor`, `grab`, `move`, `drop`) com throttle.

**Files:**
- Modify: `apps/web/src/lib/useRetroSocket.ts` (substituição completa)
- Modify: `apps/web/src/lib/useRetroSocket.test.tsx`

**Interfaces:**
- Produces: `useRetroSocket(roomId: string): { presentUserIds: string[]; cursors: { userId: string; name: string; x: number; y: number }[]; lockOf: (cardId: string) => { byUserId: string; byName: string } | null; sendCursor: (x: number, y: number) => void; grab: (cardId: string) => void; move: (cardId: string, x: number, y: number) => void; drop: (cardId: string) => void }`.

- [ ] **Step 1: Update the test**

```tsx
// apps/web/src/lib/useRetroSocket.test.tsx — substitua os casos por:
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { RetroRoomDTO } from '@legends/shared'
import { useRetroSocket } from './useRetroSocket'

vi.mock('./api', () => ({ getAccessToken: () => 'tok', refreshAccessToken: vi.fn().mockResolvedValue(true) }))

class FakeWS {
  static instances: FakeWS[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readyState = 1
  sent: string[] = []
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(d: string) { this.sent.push(d) }
  close() { this.readyState = 3; this.onclose?.({}) }
  emitOpen() { this.readyState = 1; this.onopen?.({}) }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

const baseRoom: RetroRoomDTO = {
  id: 'r1', title: 'A', status: 'OPEN', anonymous: false, votesPerParticipant: 3,
  createdAt: '', concludedAt: null, creator: { id: 'l1', name: 'L' }, participantCount: 1, myRole: 'PARTICIPANT',
  participants: [], myRemainingVotes: 3,
  cards: [{ id: 'c1', text: 'x', x: 0, y: 0, color: 'yellow', author: null, mine: false, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '' }],
}

function setup() {
  const qc = new QueryClient()
  qc.setQueryData(['retro-room', 'r1'], { room: baseRoom })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, wrapper }
}

describe('useRetroSocket (canvas)', () => {
  beforeEach(() => { FakeWS.instances = []; ;(globalThis as any).WebSocket = FakeWS })

  it('card.moving e card.moved atualizam x/y no cache', async () => {
    const { qc, wrapper } = setup()
    renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    act(() => ws.emit({ type: 'card.moving', cardId: 'c1', x: 10, y: 20, byUserId: 'u2' }))
    expect(qc.getQueryData<{ room: RetroRoomDTO }>(['retro-room', 'r1'])!.room.cards[0]).toMatchObject({ x: 10, y: 20 })
    act(() => ws.emit({ type: 'card.moved', cardId: 'c1', x: 30, y: 40 }))
    expect(qc.getQueryData<{ room: RetroRoomDTO }>(['retro-room', 'r1'])!.room.cards[0]).toMatchObject({ x: 30, y: 40 })
  })

  it('expõe cursores e locks; envia mensagens', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useRetroSocket('r1'), { wrapper })
    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    const ws = FakeWS.instances[0]
    act(() => ws.emitOpen())
    act(() => ws.emit({ type: 'cursor.moved', userId: 'u2', name: 'Bia', x: 5, y: 6 }))
    expect(result.current.cursors).toEqual([{ userId: 'u2', name: 'Bia', x: 5, y: 6 }])
    act(() => ws.emit({ type: 'card.locked', cardId: 'c1', byUserId: 'u2', byName: 'Bia' }))
    expect(result.current.lockOf('c1')).toEqual({ byUserId: 'u2', byName: 'Bia' })
    act(() => ws.emit({ type: 'card.unlocked', cardId: 'c1' }))
    expect(result.current.lockOf('c1')).toBeNull()
    act(() => result.current.grab('c1'))
    expect(ws.sent.some((s) => JSON.parse(s).type === 'card.grab')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/lib/useRetroSocket.test.tsx`
Expected: FAIL — hook não expõe `cursors`/`lockOf`/`grab` nem aplica `card.moving`.

- [ ] **Step 3: Rewrite the hook**

Substitua `apps/web/src/lib/useRetroSocket.ts` por:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  CURSOR_THROTTLE_MS,
  MOVE_THROTTLE_MS,
  type RetroClientMessage,
  type RetroEvent,
  type RetroRoomDTO,
} from '@legends/shared'
import { getAccessToken, refreshAccessToken } from './api'

type Cached = { room: RetroRoomDTO } | undefined
export interface RetroCursor { userId: string; name: string; x: number; y: number }

function setCardXY(prev: Cached, cardId: string, x: number, y: number): Cached {
  if (!prev) return prev
  return { room: { ...prev.room, cards: prev.room.cards.map((c) => (c.id === cardId ? { ...c, x, y } : c)) } }
}

function applyEvent(prev: Cached, e: RetroEvent): Cached {
  if (!prev) return prev
  const room = prev.room
  switch (e.type) {
    case 'card.created':
    case 'card.updated': {
      const exists = room.cards.some((c) => c.id === e.card.id)
      const cards = exists ? room.cards.map((c) => (c.id === e.card.id ? e.card : c)) : [...room.cards, e.card]
      return { room: { ...room, cards } }
    }
    case 'card.deleted':
      return { room: { ...room, cards: room.cards.filter((c) => c.id !== e.cardId) } }
    case 'card.moved':
    case 'card.moving':
      return setCardXY(prev, e.cardId, e.x, e.y)
    case 'vote.changed':
      return { room: { ...room, cards: room.cards.map((c) => (c.id === e.cardId ? { ...c, voteCount: e.voteCount } : c)) } }
    case 'reaction.changed':
      return { room: { ...room, cards: room.cards.map((c) => (c.id === e.cardId ? { ...c, reactions: e.reactions } : c)) } }
    default:
      return prev
  }
}

export function useRetroSocket(roomId: string): {
  presentUserIds: string[]
  cursors: RetroCursor[]
  lockOf: (cardId: string) => { byUserId: string; byName: string } | null
  sendCursor: (x: number, y: number) => void
  grab: (cardId: string) => void
  move: (cardId: string, x: number, y: number) => void
  drop: (cardId: string) => void
} {
  const qc = useQueryClient()
  const [presentUserIds, setPresentUserIds] = useState<string[]>([])
  const [cursors, setCursors] = useState<Record<string, RetroCursor>>({})
  const locksRef = useRef<Record<string, { byUserId: string; byName: string }>>({})
  const [, forceLockRender] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const closedByUs = useRef(false)
  const attempts = useRef(0)
  const lastCursorAt = useRef(0)
  const lastMoveAt = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!roomId) return
    closedByUs.current = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      let token = getAccessToken()
      if (attempts.current > 0 || !token) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (!token || closedByUs.current) return
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${scheme}://${window.location.host}/api/retro/rooms/${roomId}/ws?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        attempts.current = 0
        qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let e: RetroEvent
        try {
          e = JSON.parse(ev.data) as RetroEvent
        } catch {
          return
        }
        if (e.type === 'presence.changed') {
          setPresentUserIds(e.userIds)
          setCursors((cur) => Object.fromEntries(Object.entries(cur).filter(([uid]) => e.userIds.includes(uid))))
          return
        }
        if (e.type === 'phase.changed') {
          qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
          return
        }
        if (e.type === 'cursor.moved') {
          setCursors((cur) => ({ ...cur, [e.userId]: { userId: e.userId, name: e.name, x: e.x, y: e.y } }))
          return
        }
        if (e.type === 'card.locked') {
          locksRef.current[e.cardId] = { byUserId: e.byUserId, byName: e.byName }
          forceLockRender((n) => n + 1)
          return
        }
        if (e.type === 'card.unlocked') {
          delete locksRef.current[e.cardId]
          forceLockRender((n) => n + 1)
          return
        }
        qc.setQueryData<Cached>(['retro-room', roomId], (prev) => applyEvent(prev, e))
      }
      ws.onclose = () => {
        if (closedByUs.current) return
        attempts.current += 1
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts.current, 15000))
      }
      ws.onerror = () => ws.close()
    }
    void connect()

    return () => {
      closedByUs.current = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [roomId, qc])

  const send = useCallback((msg: RetroClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const sendCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now()
      if (now - lastCursorAt.current < CURSOR_THROTTLE_MS) return
      lastCursorAt.current = now
      send({ type: 'cursor', x, y })
    },
    [send],
  )
  const grab = useCallback((cardId: string) => send({ type: 'card.grab', cardId }), [send])
  const move = useCallback(
    (cardId: string, x: number, y: number) => {
      const now = Date.now()
      if (now - (lastMoveAt.current[cardId] ?? 0) < MOVE_THROTTLE_MS) return
      lastMoveAt.current[cardId] = now
      send({ type: 'card.move', cardId, x, y })
    },
    [send],
  )
  const drop = useCallback((cardId: string) => send({ type: 'card.drop', cardId }), [send])
  const lockOf = useCallback((cardId: string) => locksRef.current[cardId] ?? null, [])

  return { presentUserIds, cursors: Object.values(cursors), lockOf, sendCursor, grab, move, drop }
}
```

> Nota: `Date.now()` é usado para throttle no cliente (navegador) — não há a restrição do ambiente de workflows aqui. Aplicar `card.moving` ao cache é barato na escala de uma retro; se virar gargalo, troca-se por um overlay transitório (fora do v1).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/lib/useRetroSocket.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/useRetroSocket.ts apps/web/src/lib/useRetroSocket.test.tsx
git commit -m "feat(web): hook WebSocket bidirecional (cursores, locks, envio com throttle)"
```

---
### Task 10: Web — primitivas do canvas (viewport + componentes)

Cria a matemática de pan/zoom (com funções puras testáveis) e os componentes de apresentação: fundo de regiões, paleta de cores, post-it e cursores ao vivo.

**Files:**
- Create: `apps/web/src/pages/retro/use-canvas-viewport.ts` (+ funções puras `worldToScreen`/`screenToWorld`)
- Create: `apps/web/src/pages/retro/RegionsBackground.tsx`
- Create: `apps/web/src/pages/retro/ColorPalette.tsx`
- Create: `apps/web/src/pages/retro/PostIt.tsx`
- Create: `apps/web/src/pages/retro/LiveCursors.tsx`
- Test: `apps/web/src/pages/retro/use-canvas-viewport.test.ts`, `apps/web/src/pages/retro/PostIt.test.tsx`

**Interfaces:**
- Produces:
  - `worldToScreen(wx, wy, pan, zoom): { x: number; y: number }`, `screenToWorld(sx, sy, pan, zoom): { x: number; y: number }` (puras).
  - `useCanvasViewport(): { pan: {x:number;y:number}; zoom: number; panBy(dx,dy): void; zoomAt(clientX, clientY, rect: DOMRect, deltaY): void; toWorld(clientX, clientY, rect: DOMRect): {x:number;y:number} }`.
  - `RegionsBackground()` — desenha `RETRO_REGIONS`.
  - `ColorPalette({ onPick, disabled })`.
  - `PostIt({ card, readOnly, lockedBy, onPointerDown, onEdit, onDelete, onVote, onReact })`.
  - `LiveCursors({ cursors, worldToScreen })`.

- [ ] **Step 1: Write the viewport math test**

```ts
// apps/web/src/pages/retro/use-canvas-viewport.test.ts
import { describe, it, expect } from 'vitest'
import { worldToScreen, screenToWorld } from './use-canvas-viewport'

describe('canvas viewport math', () => {
  it('worldToScreen aplica zoom e pan', () => {
    expect(worldToScreen(10, 20, { x: 5, y: 5 }, 2)).toEqual({ x: 25, y: 45 })
  })
  it('screenToWorld é o inverso', () => {
    const pan = { x: 30, y: -10 }, zoom = 1.5
    const s = worldToScreen(12, 34, pan, zoom)
    const w = screenToWorld(s.x, s.y, pan, zoom)
    expect(w.x).toBeCloseTo(12)
    expect(w.y).toBeCloseTo(34)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/use-canvas-viewport.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implement the viewport hook**

```ts
// apps/web/src/pages/retro/use-canvas-viewport.ts
import { useCallback, useState } from 'react'

export interface Pan { x: number; y: number }

export function worldToScreen(wx: number, wy: number, pan: Pan, zoom: number): { x: number; y: number } {
  return { x: wx * zoom + pan.x, y: wy * zoom + pan.y }
}
export function screenToWorld(sx: number, sy: number, pan: Pan, zoom: number): { x: number; y: number } {
  return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom }
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.5

export function useCanvasViewport() {
  const [pan, setPan] = useState<Pan>({ x: 120, y: 80 })
  const [zoom, setZoom] = useState(0.8)

  const panBy = useCallback((dx: number, dy: number) => {
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
  }, [])

  const zoomAt = useCallback((clientX: number, clientY: number, rect: DOMRect, deltaY: number) => {
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (deltaY < 0 ? 1.1 : 1 / 1.1)))
      // mantém o ponto sob o cursor estável
      setPan((p) => {
        const sx = clientX - rect.left
        const sy = clientY - rect.top
        const wx = (sx - p.x) / z
        const wy = (sy - p.y) / z
        return { x: sx - wx * next, y: sy - wy * next }
      })
      return next
    })
  }, [])

  const toWorld = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => screenToWorld(clientX - rect.left, clientY - rect.top, pan, zoom),
    [pan, zoom],
  )

  return { pan, zoom, panBy, zoomAt, toWorld }
}
```

- [ ] **Step 4: Run the math test → PASS**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/use-canvas-viewport.test.ts` → PASS.

- [ ] **Step 5: Implement RegionsBackground, ColorPalette, LiveCursors**

```tsx
// apps/web/src/pages/retro/RegionsBackground.tsx
import { RETRO_REGIONS } from '@legends/shared'

export function RegionsBackground() {
  return (
    <>
      {RETRO_REGIONS.map((r) => (
        <div
          key={r.id}
          className="absolute rounded-2xl border-2 border-dashed border-outline-variant/40 bg-surface-container/30"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        >
          <span className="absolute left-4 top-3 font-label text-label-md font-bold uppercase tracking-wide text-on-surface-variant">
            {r.label}
          </span>
        </div>
      ))}
    </>
  )
}
```

```tsx
// apps/web/src/pages/retro/ColorPalette.tsx
import { RETRO_CARD_COLORS, type RetroCardColor } from '@legends/shared'

export const CARD_COLOR_CLASS: Record<RetroCardColor, string> = {
  yellow: 'bg-amber-200 border-amber-300',
  pink: 'bg-pink-200 border-pink-300',
  green: 'bg-emerald-200 border-emerald-300',
  blue: 'bg-sky-200 border-sky-300',
  purple: 'bg-violet-200 border-violet-300',
  orange: 'bg-orange-200 border-orange-300',
}

export function ColorPalette({ onPick, disabled }: { onPick: (c: RetroCardColor) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container px-3 py-2 shadow-lg">
      <span className="mr-1 font-label text-label-sm text-on-surface-variant">Novo post-it:</span>
      {RETRO_CARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          aria-label={`Criar post-it ${c}`}
          onClick={() => onPick(c)}
          className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-40 ${CARD_COLOR_CLASS[c]}`}
        />
      ))}
    </div>
  )
}
```

```tsx
// apps/web/src/pages/retro/LiveCursors.tsx
import type { RetroCursor } from '../../lib/useRetroSocket'
import type { Pan } from './use-canvas-viewport'
import { worldToScreen } from './use-canvas-viewport'

export function LiveCursors({ cursors, pan, zoom }: { cursors: RetroCursor[]; pan: Pan; zoom: number }) {
  return (
    <>
      {cursors.map((c) => {
        const s = worldToScreen(c.x, c.y, pan, zoom)
        return (
          <div key={c.userId} className="pointer-events-none absolute z-50" style={{ left: s.x, top: s.y }}>
            <div className="h-3 w-3 rotate-45 rounded-sm bg-primary" />
            <span className="ml-3 rounded bg-primary px-1.5 py-0.5 font-label text-[10px] text-on-primary">{c.name}</span>
          </div>
        )
      })}
    </>
  )
}
```

- [ ] **Step 6: Write the PostIt test**

```tsx
// apps/web/src/pages/retro/PostIt.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PostIt } from './PostIt'
import type { RetroCardDTO } from '@legends/shared'

const card: RetroCardDTO = {
  id: 'c1', text: 'Deploy tranquilo', x: 0, y: 0, color: 'yellow',
  author: { id: 'u1', name: 'Dan' }, mine: true, voteCount: 2, myVotes: 1, reactions: [], createdAt: '', updatedAt: '',
}

describe('PostIt', () => {
  it('mostra texto, autor e votos; aciona voto', () => {
    const onVote = vi.fn()
    render(<PostIt card={card} readOnly={false} lockedBy={null} onPointerDown={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onVote={onVote} onReact={vi.fn()} />)
    expect(screen.getByText('Deploy tranquilo')).toBeInTheDocument()
    expect(screen.getByText('Dan')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(onVote).toHaveBeenCalledWith('add')
  })

  it('quando lockedBy, mostra quem está movendo e não permite editar', () => {
    render(<PostIt card={card} readOnly={false} lockedBy={{ byUserId: 'u2', byName: 'Bia' }} onPointerDown={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onVote={vi.fn()} onReact={vi.fn()} />)
    expect(screen.getByText(/Bia movendo/i)).toBeInTheDocument()
  })

  it('readOnly esconde votar/editar', () => {
    render(<PostIt card={card} readOnly lockedBy={null} onPointerDown={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onVote={vi.fn()} onReact={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '+' })).toBeNull()
  })
})
```

- [ ] **Step 7: Run test to verify it fails, then implement PostIt**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/PostIt.test.tsx` → FAIL (módulo inexistente).

```tsx
// apps/web/src/pages/retro/PostIt.tsx
import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { RETRO_REACTION_EMOJIS, POSTIT_WIDTH, POSTIT_HEIGHT, type RetroCardColor, type RetroCardDTO, type RetroReactionEmoji } from '@legends/shared'
import { CARD_COLOR_CLASS } from './ColorPalette'

export function PostIt({
  card,
  readOnly,
  lockedBy,
  onPointerDown,
  onEdit,
  onDelete,
  onVote,
  onReact,
}: {
  card: RetroCardDTO
  readOnly: boolean
  lockedBy: { byUserId: string; byName: string } | null
  onPointerDown: (e: ReactPointerEvent) => void
  onEdit: (text: string) => void
  onDelete: () => void
  onVote: (dir: 'add' | 'remove') => void
  onReact: (emoji: RetroReactionEmoji) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(card.text)
  const locked = lockedBy != null
  const colorClass = CARD_COLOR_CLASS[card.color as RetroCardColor] ?? CARD_COLOR_CLASS.yellow

  return (
    <div
      className={`absolute flex flex-col rounded-lg border-2 p-2 shadow-md ${colorClass} ${locked ? 'opacity-70 ring-2 ring-primary' : ''}`}
      style={{ left: card.x, top: card.y, width: POSTIT_WIDTH, minHeight: POSTIT_HEIGHT, touchAction: 'none' }}
      onPointerDown={(e) => {
        if (editing || locked || readOnly) return
        onPointerDown(e)
      }}
    >
      {locked && (
        <span className="absolute -top-5 left-0 rounded bg-primary px-1.5 py-0.5 font-label text-[10px] text-on-primary">
          {lockedBy!.byName} movendo
        </span>
      )}

      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft.trim() && draft !== card.text) onEdit(draft.trim())
            else setDraft(card.text)
          }}
          className="flex-1 resize-none rounded bg-white/60 p-1 text-body-sm text-zinc-900 outline-none"
          rows={5}
        />
      ) : (
        <p className="flex-1 whitespace-pre-wrap break-words text-body-sm text-zinc-900">{card.text}</p>
      )}

      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-zinc-600">{card.author ? card.author.name : card.mine ? 'Você' : 'Anônimo'}</span>
        {card.mine && !readOnly && !editing && (
          <span className="flex gap-2">
            <button type="button" className="text-[10px] text-zinc-700 hover:underline" onClick={() => { setDraft(card.text); setEditing(true) }}>editar</button>
            <button type="button" className="text-[10px] text-red-700 hover:underline" onClick={onDelete}>excluir</button>
          </span>
        )}
      </div>

      {!readOnly && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <button type="button" aria-label="remover voto" onClick={() => onVote('remove')} disabled={card.myVotes === 0} className="rounded bg-white/70 px-1.5 text-zinc-800 disabled:opacity-40">−</button>
          <span className="min-w-[2ch] text-center text-[11px] font-bold text-zinc-800">{card.voteCount}</span>
          <button type="button" aria-label="+" onClick={() => onVote('add')} className="rounded bg-white/70 px-1.5 text-zinc-800">+</button>
          <span className="mx-1 h-3 w-px bg-zinc-400/50" />
          {RETRO_REACTION_EMOJIS.map((emoji) => {
            const r = card.reactions.find((x) => x.emoji === emoji)
            return (
              <button key={emoji} type="button" onClick={() => onReact(emoji)} className={`rounded-full px-1 text-[12px] ${r?.reactedByMe ? 'bg-white' : 'bg-white/50'}`}>
                {emoji}{r ? ` ${r.count}` : ''}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8: Run PostIt test → PASS**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/PostIt.test.tsx` → PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/retro/use-canvas-viewport.ts apps/web/src/pages/retro/use-canvas-viewport.test.ts apps/web/src/pages/retro/RegionsBackground.tsx apps/web/src/pages/retro/ColorPalette.tsx apps/web/src/pages/retro/LiveCursors.tsx apps/web/src/pages/retro/PostIt.tsx apps/web/src/pages/retro/PostIt.test.tsx
git commit -m "feat(web): primitivas do canvas (viewport, regiões, paleta, post-it, cursores)"
```

---
### Task 11: Web — board orquestrado (`RetroRoomPage`)

Reescreve a página: canvas pan/zoom, render de regiões + post-its + cursores, criação pela paleta, arrasto ao vivo (grab/move/drop + persistência no soltar), votos/reações, concluir, read-only.

**Files:**
- Rewrite: `apps/web/src/pages/RetroRoomPage.tsx`
- Test: `apps/web/src/pages/RetroRoomPage.test.tsx`

**Interfaces:**
- Consumes: `getRetroRoom`, `createRetroCard`, `updateRetroCard`, `updateRetroCardPosition`, `deleteRetroCard`, `addRetroVote`, `removeRetroVote`, `toggleRetroReaction`, `advanceRetroPhase` (Task 8); `useRetroSocket` (Task 9); `useCanvasViewport`, `worldToScreen`, `RegionsBackground`, `ColorPalette`, `PostIt`, `LiveCursors` (Task 10).
- Produces: `RetroRoomPage` (named export). Query key `['retro-room', id]`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/RetroRoomPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RetroRoomPage } from './RetroRoomPage'
import type { RetroRoomDTO } from '@legends/shared'
import * as api from '../lib/retro-api'

const room: RetroRoomDTO = {
  id: 'r1', title: 'Retro 1', status: 'OPEN', anonymous: false, votesPerParticipant: 3,
  createdAt: '', concludedAt: null, creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR',
  participants: [], myRemainingVotes: 3,
  cards: [{ id: 'c1', text: 'Deploy tranquilo', x: 40, y: 50, color: 'yellow', author: { id: 'd1', name: 'Dan' }, mine: false, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '' }],
}

vi.mock('../lib/retro-api', () => ({
  getRetroRoom: vi.fn(),
  createRetroCard: vi.fn().mockResolvedValue({ card: { id: 'c2', text: 'Novo ponto', x: 0, y: 0, color: 'green', author: null, mine: true, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '' } }),
  updateRetroCard: vi.fn(), updateRetroCardPosition: vi.fn(), deleteRetroCard: vi.fn(),
  addRetroVote: vi.fn(), removeRetroVote: vi.fn(), toggleRetroReaction: vi.fn(),
  advanceRetroPhase: vi.fn().mockResolvedValue({ room: { ...room, status: 'CONCLUDED' } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'l1', role: 'LEAD', name: 'Lia' } }) }))
vi.mock('../lib/useRetroSocket', () => ({
  useRetroSocket: () => ({ presentUserIds: ['l1'], cursors: [], lockOf: () => null, sendCursor: vi.fn(), grab: vi.fn(), move: vi.fn(), drop: vi.fn() }),
}))

function renderPage() {
  vi.mocked(api.getRetroRoom).mockResolvedValue({ room })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/retrospectivas/r1']}>
        <Routes><Route path="/retrospectivas/:id" element={<RetroRoomPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RetroRoomPage (canvas)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renderiza título, regiões e o post-it existente', async () => {
    renderPage()
    expect(await screen.findByText('Retro 1')).toBeInTheDocument()
    expect(screen.getByText('Deploy tranquilo')).toBeInTheDocument()
    expect(screen.getByText('O que foi bom')).toBeInTheDocument() // região de fundo
  })

  it('clicar numa cor da paleta cria post-it via API', async () => {
    renderPage()
    await screen.findByText('Retro 1')
    fireEvent.click(screen.getByRole('button', { name: /Criar post-it green/i }))
    expect(api.createRetroCard).toHaveBeenCalledWith('r1', expect.objectContaining({ color: 'green' }))
  })

  it('facilitador vê botão Concluir', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /concluir/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: FAIL — a página ainda é a de colunas (sem regiões/paleta).

- [ ] **Step 3: Rewrite RetroRoomPage**

```tsx
// apps/web/src/pages/RetroRoomPage.tsx
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { POSTIT_WIDTH, POSTIT_HEIGHT, type RetroCardColor, type RetroCardDTO, type RetroReactionEmoji, type RetroRoomDTO } from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { useRetroSocket } from '../lib/useRetroSocket'
import {
  addRetroVote, advanceRetroPhase, createRetroCard, deleteRetroCard, getRetroRoom,
  removeRetroVote, toggleRetroReaction, updateRetroCard, updateRetroCardPosition,
} from '../lib/retro-api'
import { useCanvasViewport, worldToScreen } from './retro/use-canvas-viewport'
import { RegionsBackground } from './retro/RegionsBackground'
import { ColorPalette } from './retro/ColorPalette'
import { PostIt } from './retro/PostIt'
import { LiveCursors } from './retro/LiveCursors'

type Cached = { room: RetroRoomDTO }

export function RetroRoomPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { user } = useAuth()
  const roomQuery = useQuery({ queryKey: ['retro-room', id], queryFn: () => getRetroRoom(id), enabled: !!id })
  const socket = useRetroSocket(id)
  const vp = useCanvasViewport()
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ cardId: string; offX: number; offY: number } | null>(null)
  const panning = useRef<{ x: number; y: number } | null>(null)

  const patch = (fn: (c: Cached) => Cached) => qc.setQueryData<Cached>(['retro-room', id], (p) => (p ? fn(p) : p))

  const createM = useMutation({
    mutationFn: (v: { color: RetroCardColor; x: number; y: number }) =>
      createRetroCard(id, { text: 'Novo ponto', color: v.color, x: v.x, y: v.y }),
    onSuccess: ({ card }) => patch((c) => ({ room: { ...c.room, cards: [...c.room.cards.filter((x) => x.id !== card.id), card] } })),
  })
  const editM = useMutation({
    mutationFn: (v: { cardId: string; text: string }) => updateRetroCard(id, v.cardId, { text: v.text }),
    onSuccess: ({ card }) => patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((x) => (x.id === card.id ? card : x)) } })),
  })
  const deleteM = useMutation({
    mutationFn: (cardId: string) => deleteRetroCard(id, cardId),
    onSuccess: (_r, cardId) => patch((c) => ({ room: { ...c.room, cards: c.room.cards.filter((x) => x.id !== cardId) } })),
  })
  const voteM = useMutation({
    mutationFn: (v: { cardId: string; dir: 'add' | 'remove' }) => (v.dir === 'add' ? addRetroVote(id, v.cardId) : removeRetroVote(id, v.cardId)),
    onSuccess: (res, v) => patch((c) => ({
      room: {
        ...c.room,
        myRemainingVotes: res.myRemainingVotes,
        cards: c.room.cards.map((x) => (x.id === v.cardId ? { ...x, voteCount: res.voteCount, myVotes: Math.max(0, x.myVotes + (v.dir === 'add' ? 1 : -1)) } : x)),
      },
    })),
  })
  const reactM = useMutation({
    mutationFn: (v: { cardId: string; emoji: RetroReactionEmoji }) => toggleRetroReaction(id, v.cardId, v.emoji),
    onSuccess: (res, v) => patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((x) => (x.id === v.cardId ? { ...x, reactions: res.reactions } : x)) } })),
  })
  const concludeM = useMutation({
    mutationFn: () => advanceRetroPhase(id, 'conclude'),
    onSuccess: ({ room }) => patch((c) => ({ room: { ...c.room, status: room.status, concludedAt: room.concludedAt } })),
  })

  // Listeners globais de arrasto/pan.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      if (drag.current) {
        const w = vp.toWorld(e.clientX, e.clientY, rect)
        const x = w.x - drag.current.offX
        const y = w.y - drag.current.offY
        const cardId = drag.current.cardId
        patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((k) => (k.id === cardId ? { ...k, x, y } : k)) } }))
        socket.move(cardId, x, y)
      } else if (panning.current) {
        vp.panBy(e.clientX - panning.current.x, e.clientY - panning.current.y)
        panning.current = { x: e.clientX, y: e.clientY }
      } else {
        const w = vp.toWorld(e.clientX, e.clientY, rect)
        socket.sendCursor(w.x, w.y)
      }
    }
    function onUp() {
      if (drag.current) {
        const cardId = drag.current.cardId
        const card = roomQuery.data?.room.cards.find((k) => k.id === cardId)
        if (card) updateRetroCardPosition(id, cardId, card.x, card.y).catch(() => {})
        socket.drop(cardId)
        drag.current = null
      }
      panning.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [id, vp, socket, qc, roomQuery.data])

  if (roomQuery.isLoading) return <p className="p-xl text-center text-on-surface-variant">Carregando…</p>
  if (roomQuery.isError || !roomQuery.data) return <p className="p-xl text-center text-error">Sala indisponível.</p>
  const room = roomQuery.data.room
  const isFacilitator = room.myRole === 'FACILITATOR'
  const canWrite = room.myRole !== 'OBSERVER' && room.status === 'OPEN'

  function onCardPointerDown(e: ReactPointerEvent, card: RetroCardDTO) {
    if (!canWrite) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const w = vp.toWorld(e.clientX, e.clientY, rect)
    drag.current = { cardId: card.id, offX: w.x - card.x, offY: w.y - card.y }
    socket.grab(card.id)
  }

  function onCanvasPointerDown(e: ReactPointerEvent) {
    if (e.target === containerRef.current || (e.target as HTMLElement).dataset.world === 'true') {
      panning.current = { x: e.clientX, y: e.clientY }
    }
  }

  function createAtCenter(color: RetroCardColor) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const center = vp.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, rect)
    createM.mutate({ color, x: center.x - POSTIT_WIDTH / 2, y: center.y - POSTIT_HEIGHT / 2 })
  }

  return (
    <section className="relative flex h-[calc(100vh-64px)] flex-col">
      <header className="flex items-center justify-between gap-md border-b border-outline-variant/40 px-lg py-sm">
        <div>
          <span className="font-label text-[11px] uppercase tracking-wide text-primary">{room.status === 'OPEN' ? 'Aberta' : 'Concluída'}</span>
          <h2 className="font-headline text-headline-md text-on-surface">{room.title}</h2>
        </div>
        <div className="flex items-center gap-md">
          <span className="font-label text-label-sm text-on-surface-variant">{socket.presentUserIds.length} online</span>
          {room.status === 'OPEN' && <span className="font-label text-label-sm text-on-surface-variant">Votos: {room.myRemainingVotes}</span>}
          {isFacilitator && room.status === 'OPEN' && (
            <button type="button" onClick={() => concludeM.mutate()} className="rounded-md bg-primary px-lg py-sm font-label font-bold text-on-primary">Concluir</button>
          )}
        </div>
      </header>

      <div
        ref={containerRef}
        data-world="true"
        onPointerDown={onCanvasPointerDown}
        onWheel={(e) => {
          const rect = containerRef.current?.getBoundingClientRect()
          if (rect) vp.zoomAt(e.clientX, e.clientY, rect, e.deltaY)
        }}
        className="relative flex-1 overflow-hidden bg-surface"
        style={{ cursor: 'grab', touchAction: 'none' }}
      >
        <div
          data-world="true"
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${vp.pan.x}px, ${vp.pan.y}px) scale(${vp.zoom})` }}
        >
          <RegionsBackground />
          {room.cards.map((card) => (
            <PostIt
              key={card.id}
              card={card}
              readOnly={!canWrite}
              lockedBy={socket.lockOf(card.id)}
              onPointerDown={(e) => onCardPointerDown(e, card)}
              onEdit={(text) => editM.mutate({ cardId: card.id, text })}
              onDelete={() => deleteM.mutate(card.id)}
              onVote={(dir) => voteM.mutate({ cardId: card.id, dir })}
              onReact={(emoji) => reactM.mutate({ cardId: card.id, emoji })}
            />
          ))}
        </div>
        <LiveCursors cursors={socket.cursors} pan={vp.pan} zoom={vp.zoom} />
      </div>

      {canWrite && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="pointer-events-auto">
            <ColorPalette onPick={createAtCenter} disabled={createM.isPending} />
          </div>
        </div>
      )}
    </section>
  )
}
```

> Simplificação consciente do v1: a paleta cria o post-it já com texto "Novo ponto" (em vez de nascer com textarea vazia); o usuário clica em "editar" para trocar. Trocar por draft-vazio-com-descarte fica para depois (o usuário OK com ajustar depois).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(web): board canvas orquestrado (arrasto ao vivo, paleta, cursores, concluir)"
```

---

### Task 12: Web — labels de status na lista

**Files:**
- Modify: `apps/web/src/pages/RetrosPage.tsx`
- Test: `apps/web/src/pages/RetrosPage.test.tsx` (ajustar mock se referenciar status antigo)

**Interfaces:**
- Consumes: `RetroRoomStatus` agora `OPEN|CONCLUDED`.

- [ ] **Step 1: Update status labels**

Em `RetrosPage.tsx`, troque o mapa de labels de status:

```tsx
const STATUS_LABEL: Record<RetroRoomStatus, string> = {
  OPEN: 'Aberta',
  CONCLUDED: 'Concluída',
}
```

Remova qualquer referência a `COLLECTING`/`REVEALED`. (O resto da página — lista + modal de criação — não muda; o modal já envia `title/anonymous/votesPerParticipant/participantIds`.)

- [ ] **Step 2: Update the test mock**

Em `RetrosPage.test.tsx`, no mock de `listRetroRooms`, troque `status: 'COLLECTING'` por `status: 'OPEN'`.

- [ ] **Step 3: Run the test + full web build**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetrosPage.test.tsx` → PASS.
Run: `pnpm --filter @legends/web build`
Expected: **type-check limpo** (todo o web já migrado) + build ok.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/RetrosPage.tsx apps/web/src/pages/RetrosPage.test.tsx
git commit -m "feat(web): labels de status OPEN/CONCLUDED na lista de retrospectivas"
```

---

## Self-Review (autor)

**Cobertura do spec:**
- Canvas livre pan/zoom + post-its DOM arrastáveis → Tasks 10, 11.
- 5 regiões como fundo visual, categoria fora do dado → `RETRO_REGIONS` (T1), `RegionsBackground` (T10); `column` removido (T2, T3, T4).
- `x/y/color` no card → T1 (DTO), T2 (schema), T3 (service), T4 (serialize).
- Status `OPEN/CONCLUDED`, sem revelação → T1, T2, T3, T4, T6.
- Arrasto ao vivo + cursores + soft-lock (WS bidirecional) → T5 (hub), T7 (WS), T9 (hook), T11 (wiring).
- Persistência da posição no soltar → `updateCardPosition` (T3), rota position (T6), drop handler (T11).
- Paleta de cores, criar no centro → ColorPalette (T10), `createAtCenter` (T11).
- Votos/reações liberados em OPEN, read-only em CONCLUDED → T3, T6, T11/PostIt.
- Anonimato preservado (autor null) → T4, PostIt (T10).
- Pan/zoom local → `useCanvasViewport` (T10).

**Placeholder scan:** sem TODO/“implementar depois” em código; a única simplificação (criar com texto "Novo ponto" em vez de draft vazio) está explicitada e é funcional.

**Consistência de tipos:** `RetroCardDTO` (`x,y,color`, sem `column`), `RetroEvent`/`RetroClientMessage`, query key `['retro-room', id]`, `RetroConnection {socket,userId,name}`, assinaturas de `createCard`/`updateCardPosition`/`advancePhase('conclude')`, helpers do hub (`grabCard/dropCard/lockOwner/releaseLocksHeldBy`) batem entre tasks. `CARD_COLOR_CLASS` exportado de `ColorPalette` e reusado em `PostIt`.

**Riscos a validar na execução:**
- Migration de enum no Postgres (recriar tipo) — SQL manual na T2; rodar `migrate deploy` e conferir `migrate status`.
- Aplicar `card.moving` ao cache a ~30/s — aceitável na escala; vira overlay se pesar.
- `releaseLocksHeldBy` por `userId` derruba locks de múltiplas abas do mesmo usuário (raro; documentado).
- Pan vs. clique em post-it: `PostIt` para a propagação no `pointerdown`; o canvas só inicia pan quando o alvo tem `data-world`.

