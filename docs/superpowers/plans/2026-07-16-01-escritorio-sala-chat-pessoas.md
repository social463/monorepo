# Grade estilo Meet: painel lateral (chat/pessoas) + MediaBar acessível — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na grade expandida de câmeras (Meet-style) do escritório, mostrar a
`MediaBar` por cima da grade (hoje escondida atrás), acrescentar dois botões
novos nela para abrir/fechar um painel lateral direito mutuamente exclusivo
(chat da sala OU lista de pessoas da sala), com chat persistido em memória no
servidor por sala (histórico enviado a quem entra, apagado quando a sala
esvazia).

**Architecture:** O overlay `fixed inset-0 z-50` de `MediaTiles` vira um
container flex vertical (`flex flex-col overflow-hidden`) com uma linha
`flex flex-1 min-h-0` de dois filhos: a área central (`flex-1`, lógica de
destaque/grid inalterada) e um painel lateral condicional (`w-[360px]`) com
`RoomChatPanel` ou `RoomPeoplePanel`. O estado do painel (`roomPanel`) e a
sala atual moram em `OfficePage`, que também hospeda o novo hook
`useRoomChat` (histórico + envio via `OfficeBridge`). No backend, `OfficeHub`
ganha um `Map<roomId, mensagens[]>` em memória, populado por um novo método
`roomChatMessage`, com histórico entregue no `move()`/`join()` de entrada na
sala e apagado quando a sala esvazia (`move()` de saída ou `leave()`).

**Tech Stack:** React 18 + Tailwind (frontend), Fastify 4 + `@fastify/websocket`
(backend), tipos compartilhados em `@legends/shared`, Vitest + Testing Library
nos dois lados.

## Global Constraints

- Mensagens voltadas ao usuário em **português** (aria-label, título, texto de
  UI).
- `ROOM_CHAT_MESSAGE_MAX_LENGTH` fica em `apps/api/src/lib/office-hub.ts`
  (junto de `NEARBY_MESSAGE_MAX_LENGTH`/`CALL_COOLDOWN_MS`), **não** em
  `packages/shared/src/office.ts` como o texto do spec sugere — é o padrão já
  usado no arquivo para constantes de rate-limit/tamanho, e o pacote
  `shared` só guarda os tipos de mensagem e os DTOs em si.
- A página do escritório vive em `apps/web/src/pages/OfficePage.tsx` (não
  `apps/web/src/office/OfficePage.tsx`).
- Chat de sala **não persiste em banco** — vive inteiramente em memória no
  `OfficeHub` (mesmo padrão de `entries`/`buckets`), chaveado por `room.id`
  (o mesmo id de `OfficeRoomDTO` usado por `roomForPosition`/`canEnterRoom`).
- Testes da API (`office-hub.test.ts`, `office-ws.test.ts`) exigem Postgres
  de pé (`pnpm db:up`) — ver `AGENTS.md`.
- TypeScript strict, ESM puro; testes Vitest colocados ao lado do código
  (`*.test.ts(x)`).
- Fora de escopo (não implementar aqui): anexos/menções/emojis no chat de
  sala, ações na lista de pessoas da sala, qualquer mudança no nearby chat ou
  na lógica de destaque/grid da área central, mais botões na `MediaBar` além
  dos dois descritos.

---

### Task 1: Tipos compartilhados — mensagens de chat de sala

**Files:**
- Modify: `packages/shared/src/office.ts:138-171`

**Interfaces:**
- Produces: `OfficeClientMessage` ganha o variante `{ type: "room-chat-message"; text: string }`; `OfficeServerMessage` ganha `{ type: "room-chat-message"; roomId; userId; name; text; sentAt }` e `{ type: "room-chat-history"; roomId; messages: Array<{userId; name; text; sentAt}> }`. Todas as tasks seguintes (backend e frontend) dependem exatamente destes shapes.

- [ ] **Step 1: Adicionar o novo tipo de mensagem cliente→servidor**

Em `packages/shared/src/office.ts`, localizar:

```ts
export type OfficeClientMessage =
  | { type: "move"; dir: Direction }
  | { type: "call"; targetUserId: string }
  | { type: "call-response"; callerId: string; accepted: boolean }
  | { type: "nearby-message"; text: string; kind?: OfficeNearbyMessageKind };
```

Substituir por:

```ts
export type OfficeClientMessage =
  | { type: "move"; dir: Direction }
  | { type: "call"; targetUserId: string }
  | { type: "call-response"; callerId: string; accepted: boolean }
  | { type: "nearby-message"; text: string; kind?: OfficeNearbyMessageKind }
  | { type: "room-chat-message"; text: string };
```

- [ ] **Step 2: Adicionar os novos tipos de mensagem servidor→cliente**

Localizar o fim de `OfficeServerMessage`:

```ts
export type OfficeServerMessage =
  | { type: "welcome"; youId: string; occupants: OfficeOccupant[]; publicationId?: string }
  | { type: "joined"; occupant: OfficeOccupant }
  | { type: "left"; userId: string }
  | { type: "moved"; userId: string; x: number; y: number; dir: Direction }
  /** Move recusado (parede/borda): posição autoritativa para o cliente re-ancorar. */
  | { type: "sync"; x: number; y: number; dir: Direction }
  /** Alguém está te chamando — mostrado em todas as abas do alvo. */
  | { type: "incoming-call"; from: { userId: string; name: string } }
  /** Resposta a uma chamada que VOCÊ fez. */
  | { type: "call-result"; targetUserId: string; accepted: boolean }
  /** Sua chamada não foi entregue. */
  | { type: "call-failed"; targetUserId: string; reason: "offline" | "rate-limited" }
  /** Mensagem curta/reação/pensamento exibida como balão sobre o personagem. */
  | {
      type: "nearby-message";
      userId: string;
      text: string;
      kind: OfficeNearbyMessageKind;
    }
  /** O avatar de alguém mudou — os clientes recompõem o personagem ao vivo. */
  | {
      type: "avatar-updated";
      userId: string;
      avatarSeed: string | null;
      avatarOptions: CharacterOptions | null;
    }
  | { type: "map-changed"; publicationId: string };
```

Substituir por (acrescenta os dois novos variantes antes de `map-changed`):

```ts
export type OfficeServerMessage =
  | { type: "welcome"; youId: string; occupants: OfficeOccupant[]; publicationId?: string }
  | { type: "joined"; occupant: OfficeOccupant }
  | { type: "left"; userId: string }
  | { type: "moved"; userId: string; x: number; y: number; dir: Direction }
  /** Move recusado (parede/borda): posição autoritativa para o cliente re-ancorar. */
  | { type: "sync"; x: number; y: number; dir: Direction }
  /** Alguém está te chamando — mostrado em todas as abas do alvo. */
  | { type: "incoming-call"; from: { userId: string; name: string } }
  /** Resposta a uma chamada que VOCÊ fez. */
  | { type: "call-result"; targetUserId: string; accepted: boolean }
  /** Sua chamada não foi entregue. */
  | { type: "call-failed"; targetUserId: string; reason: "offline" | "rate-limited" }
  /** Mensagem curta/reação/pensamento exibida como balão sobre o personagem. */
  | {
      type: "nearby-message";
      userId: string;
      text: string;
      kind: OfficeNearbyMessageKind;
    }
  /** O avatar de alguém mudou — os clientes recompõem o personagem ao vivo. */
  | {
      type: "avatar-updated";
      userId: string;
      avatarSeed: string | null;
      avatarOptions: CharacterOptions | null;
    }
  /** Mensagem de texto do chat da sala — só chega a quem está na MESMA sala. */
  | {
      type: "room-chat-message";
      roomId: string;
      userId: string;
      name: string;
      text: string;
      sentAt: string;
    }
  /** Histórico da sala, enviado a quem acabou de entrar nela. */
  | {
      type: "room-chat-history";
      roomId: string;
      messages: Array<{ userId: string; name: string; text: string; sentAt: string }>;
    }
  | { type: "map-changed"; publicationId: string };
```

- [ ] **Step 3: Checar tipos do pacote `shared`**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros (mudança é só de tipos, sem uso ainda).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/office.ts
git commit -m "feat(shared): tipos de mensagem do chat de sala"
```

---

### Task 2: Backend — `OfficeHub` guarda e distribui o chat por sala

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts`
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consumes: `OfficeServerMessage`/`OfficeClientMessage` de `@legends/shared` (Task 1); `roomForPosition(x, y): OfficeRoomDTO | null` e `canEnterRoom` já existentes no próprio arquivo; `legacyOfficeRuntimeFixture()` de `apps/api/src/test/office-map-fixture.ts` (já existe, sem mudanças).
- Produces: `OfficeHub.roomChatMessage(socket: OfficeSocket, userId: string, text: string): void`; `ROOM_CHAT_MESSAGE_MAX_LENGTH` (constante exportada); efeitos colaterais em `move()`/`leave()`/`join()` descritos abaixo — usados pela Task 3 (dispatch do WS).

- [ ] **Step 1: Escrever os testes falhos para `roomChatMessage`**

Em `apps/api/src/lib/office-hub.test.ts`, no import do topo, adicionar
`type Direction` e trocar o import de `office-hub`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  defaultCharacterFromSeed,
  OFFICE_SPAWN_TILES,
  isWalkable,
  type OfficeServerMessage,
  type Direction,
} from '@legends/shared'
import { OfficeHub, type OfficeSocket, CALL_COOLDOWN_MS, ROOM_CHAT_MESSAGE_MAX_LENGTH } from './office-hub'
import { legacyOfficeRuntimeFixture } from '../test/office-map-fixture'
```

Logo após a função `fakeSocket()` (antes de `const ana = ...`), adicionar os
helpers de movimento e as constantes da sala de teste:

```ts
const DIRECTION_DELTAS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** BFS tile-a-tile simples: chega EM CIMA do alvo (diferente do findPath de produção, que para adjacente). */
function shortestPath(from: { x: number; y: number }, to: { x: number; y: number }): Direction[] {
  if (from.x === to.x && from.y === to.y) return []
  const key = (x: number, y: number) => `${x},${y}`
  const visited = new Set<string>([key(from.x, from.y)])
  const queue: Array<{ x: number; y: number; path: Direction[] }> = [{ ...from, path: [] }]
  while (queue.length > 0) {
    const node = queue.shift() as { x: number; y: number; path: Direction[] }
    for (const dir of ['up', 'down', 'left', 'right'] as Direction[]) {
      const delta = DIRECTION_DELTAS[dir]
      const nx = node.x + delta.x
      const ny = node.y + delta.y
      if (!isWalkable(nx, ny) || visited.has(key(nx, ny))) continue
      const path = [...node.path, dir]
      if (nx === to.x && ny === to.y) return path
      visited.add(key(nx, ny))
      queue.push({ x: nx, y: ny, path })
    }
  }
  throw new Error(`sem caminho andável de ${JSON.stringify(from)} até ${JSON.stringify(to)}`)
}

/** Anda uma pessoa até o tile alvo, um passo por vez — mesma API que o cliente usaria. */
function walkTo(hub: OfficeHub, socket: OfficeSocket, userId: string, target: { x: number; y: number }): void {
  const occupant = hub.occupants().find((o) => o.userId === userId)!
  for (const dir of shortestPath({ x: occupant.x, y: occupant.y }, target)) {
    hub.move(socket, userId, dir)
  }
}

// Sala "Sala de Reunião 1" da fixture legada (OFFICE_ZONES): x0=17,y0=11,x1=23,y1=12.
const ROOM1_ID = 'room-reuniao-1'
const ROOM1_INSIDE = { x: 20, y: 12 }
const ROOM1_OUTSIDE = { x: 11, y: 12 }
```

Ao final do arquivo (depois do `describe('updateAvatar', ...)`), adicionar:

```ts
describe('roomChatMessage', () => {
  it('mensagem de chat de sala chega só pra quem está na mesma sala', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.roomChatMessage(a.socket, 'ana', 'oi pessoal')

    expect(a.sent).toContainEqual(
      expect.objectContaining({ type: 'room-chat-message', roomId: ROOM1_ID, userId: 'ana', text: 'oi pessoal' }),
    )
    expect(b.sent.some((m) => m.type === 'room-chat-message')).toBe(false)
  })

  it('quem entra numa sala recebe o histórico atual', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.roomChatMessage(a.socket, 'ana', 'oi pessoal')

    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    expect(b.sent).toContainEqual(
      expect.objectContaining({
        type: 'room-chat-history',
        roomId: ROOM1_ID,
        messages: [expect.objectContaining({ userId: 'ana', name: 'Ana', text: 'oi pessoal' })],
      }),
    )
  })

  it('sala esvaziar (última pessoa sai andando) apaga o histórico; reentrar começa do zero', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.roomChatMessage(a.socket, 'ana', 'mensagem antiga')

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    const historyMessages = a.sent.filter(
      (m): m is Extract<OfficeServerMessage, { type: 'room-chat-history' }> =>
        m.type === 'room-chat-history' && m.roomId === ROOM1_ID,
    )
    expect(historyMessages.at(-1)?.messages).toEqual([])
  })

  it('sala esvaziar por desconexão (leave) também apaga o histórico', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.roomChatMessage(a.socket, 'ana', 'mensagem antiga')

    hub.leave(a.socket, 'ana')

    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    const historyMessages = b.sent.filter(
      (m): m is Extract<OfficeServerMessage, { type: 'room-chat-history' }> =>
        m.type === 'room-chat-history' && m.roomId === ROOM1_ID,
    )
    expect(historyMessages.at(-1)?.messages).toEqual([])
  })

  it('mandar de fora de sala (espaço aberto) não faz nada', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.roomChatMessage(a.socket, 'ana', 'oi da área aberta')

    expect(b.sent.some((m) => m.type === 'room-chat-message')).toBe(false)
  })

  it('texto é cortado no tamanho máximo', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    const longText = 'x'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH + 50)
    hub.roomChatMessage(a.socket, 'ana', longText)

    const message = a.sent.find((m) => m.type === 'room-chat-message') as Extract<
      OfficeServerMessage,
      { type: 'room-chat-message' }
    >
    expect(message.text).toHaveLength(ROOM_CHAT_MESSAGE_MAX_LENGTH)
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm db:up && pnpm --filter @legends/api test -- office-hub.test.ts`
Expected: FAIL — `hub.roomChatMessage is not a function` / `ROOM_CHAT_MESSAGE_MAX_LENGTH` não exportado.

- [ ] **Step 3: Implementar `roomChatMessage` e o estado de chat por sala**

Em `apps/api/src/lib/office-hub.ts`, adicionar a constante logo abaixo de
`NEARBY_MESSAGE_MAX_LENGTH`:

```ts
export const NEARBY_MESSAGE_MAX_LENGTH = 80
export const ROOM_CHAT_MESSAGE_MAX_LENGTH = 500
```

Adicionar a interface de mensagem armazenada, logo acima de `interface Bucket`:

```ts
interface StoredRoomChatMessage {
  userId: string
  name: string
  text: string
  sentAt: string
}

interface Bucket {
```

Adicionar o novo campo privado, junto dos demais (após `lastCallAt`):

```ts
  /** Último instante (ms) em que cada usuário iniciou uma chamada. */
  private lastCallAt = new Map<string, number>()
  /** Histórico do chat de cada sala, chaveado por `room.id`. Nunca persiste em banco. */
  private roomChat = new Map<string, StoredRoomChatMessage[]>()
```

Em `configure()`, limpar o chat de sala junto do resto quando o mapa ativo
muda:

```ts
  configure(runtime: ActiveOfficeMapDTO, notify = false): void {
    const changed = this.runtime !== null && this.runtime.publication.id !== runtime.publication.id
    if (changed && notify) this.broadcast({ type: 'map-changed', publicationId: runtime.publication.id })
    if (changed) {
      this.entries.clear()
      this.buckets.clear()
      this.socketOwner.clear()
      this.lastCallAt.clear()
      this.roomChat.clear()
    }
    this.runtime = runtime
  }
```

Em `join()`, logo após o bloco `this.sendTo(socket, { type: 'welcome', ... })`
(caso defensivo: spawn já dentro de uma sala), adicionar:

```ts
    this.sendTo(socket, {
      type: 'welcome',
      youId: user.id,
      occupants: this.occupants(),
      publicationId: this.runtime?.publication.id,
    })

    const occupant = this.entries.get(user.id)!.occupant
    const room = this.roomForPosition(occupant.x, occupant.y)
    if (room) {
      this.sendTo(socket, {
        type: 'room-chat-history',
        roomId: room.id,
        messages: this.roomChat.get(room.id) ?? [],
      })
    }
  }
```

Em `move()`, capturar a sala de origem ANTES de atualizar `x`/`y`, e depois
de fazer o broadcast do `moved`, enviar histórico a quem entrou numa sala
nova e apagar o chat da sala de origem se ela ficou vazia:

```ts
  move(socket: OfficeSocket, userId: string, dir: Direction): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    if (!this.takeToken(userId)) return

    const delta = DIRECTION_DELTAS[dir]
    const targetX = entry.occupant.x + delta.x
    const targetY = entry.occupant.y + delta.y

    if (!this.walkable(targetX, targetY) || !this.canEnterRoom(userId, targetX, targetY)) {
      // Encara a parede mesmo sem andar: vira o personagem e re-ancora o cliente.
      entry.occupant.dir = dir
      this.sendTo(socket, {
        type: 'sync',
        x: entry.occupant.x,
        y: entry.occupant.y,
        dir,
      })
      return
    }

    const previousRoom = this.roomForPosition(entry.occupant.x, entry.occupant.y)
    entry.occupant.x = targetX
    entry.occupant.y = targetY
    entry.occupant.dir = dir
    delete entry.occupant.thoughtText
    this.broadcast({ type: 'moved', userId, x: targetX, y: targetY, dir })

    const nextRoom = this.roomForPosition(targetX, targetY)
    if (nextRoom && nextRoom.id !== previousRoom?.id) {
      this.sendTo(socket, {
        type: 'room-chat-history',
        roomId: nextRoom.id,
        messages: this.roomChat.get(nextRoom.id) ?? [],
      })
    }
    if (previousRoom && previousRoom.id !== nextRoom?.id) {
      this.deleteRoomChatIfEmpty(previousRoom.id)
    }
  }
```

Em `leave()`, capturar a sala de origem antes de remover a entry e apagar o
chat se ela ficou vazia:

```ts
  leave(socket: OfficeSocket, userId: string): void {
    this.socketOwner.delete(socket)
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.sockets.delete(socket)
    if (entry.sockets.size > 0) return // ainda há outra aba aberta
    const previousRoom = this.roomForPosition(entry.occupant.x, entry.occupant.y)
    this.entries.delete(userId)
    this.buckets.delete(userId) // última aba fechou: some o orçamento junto
    this.lastCallAt.delete(userId)
    this.broadcast({ type: 'left', userId })
    if (previousRoom) this.deleteRoomChatIfEmpty(previousRoom.id)
  }
```

Adicionar o novo método público, logo após `nearbyMessage()`:

```ts
  /** Reação/chat efêmero: não persiste, só vira balão em todos os clientes conectados. */
  nearbyMessage(
    socket: OfficeSocket,
    userId: string,
    text: string,
    kind: OfficeNearbyMessageKind = 'speech',
  ): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    const trimmed = text.trim().slice(0, NEARBY_MESSAGE_MAX_LENGTH)
    if (!trimmed) return
    if (kind === 'thought') entry.occupant.thoughtText = trimmed
    this.broadcast({ type: 'nearby-message', userId, text: trimmed, kind })
  }

  /**
   * Mensagem de texto do chat da sala. Não persiste em banco — vive em
   * memória, associada ao `room.id` da posição ATUAL de quem manda. Fora de
   * sala (espaço aberto), é no-op: chat de sala só existe dentro de sala.
   */
  roomChatMessage(socket: OfficeSocket, userId: string, text: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    const room = this.roomForPosition(entry.occupant.x, entry.occupant.y)
    if (!room) return
    const trimmed = text.trim().slice(0, ROOM_CHAT_MESSAGE_MAX_LENGTH)
    if (!trimmed) return

    const message: StoredRoomChatMessage = {
      userId,
      name: entry.occupant.name,
      text: trimmed,
      sentAt: new Date().toISOString(),
    }
    const history = this.roomChat.get(room.id) ?? []
    history.push(message)
    this.roomChat.set(room.id, history)
    this.broadcastToRoom(room.id, { type: 'room-chat-message', roomId: room.id, ...message })
  }
```

Adicionar os dois helpers privados, logo após `private broadcast(...)`:

```ts
  private broadcast(message: OfficeServerMessage, exceptUserId?: string): void {
    const payload = JSON.stringify(message)
    for (const [userId, entry] of this.entries) {
      if (userId === exceptUserId) continue
      for (const socket of entry.sockets) {
        try {
          socket.send(payload)
        } catch {
          // idem
        }
      }
    }
  }

  /** Broadcast filtrado: só para quem está NA MESMA sala agora (mesmo predicado de `canEnterRoom`). */
  private broadcastToRoom(roomId: string, message: OfficeServerMessage): void {
    const payload = JSON.stringify(message)
    for (const entry of this.entries.values()) {
      if (this.roomForPosition(entry.occupant.x, entry.occupant.y)?.id !== roomId) continue
      for (const socket of entry.sockets) {
        try {
          socket.send(payload)
        } catch {
          // idem
        }
      }
    }
  }

  /** Sala ficou sem ninguém (última pessoa saiu andando ou desconectou): apaga o histórico dela. */
  private deleteRoomChatIfEmpty(roomId: string): void {
    const stillOccupied = this.occupants().some(
      (occupant) => this.roomForPosition(occupant.x, occupant.y)?.id === roomId,
    )
    if (!stillOccupied) this.roomChat.delete(roomId)
  }
```

Por fim, em `reset()`, limpar também o novo mapa:

```ts
  /** Só para testes: zera o estado do singleton entre casos. */
  reset(): void {
    this.entries.clear()
    this.buckets.clear()
    this.socketOwner.clear()
    this.lastCallAt.clear()
    this.roomChat.clear()
    this.runtime = null
  }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api test -- office-hub.test.ts`
Expected: PASS (todos os testes existentes + os 6 novos de `roomChatMessage`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): chat de sala em memória no OfficeHub"
```

---

### Task 3: Backend — despacho do WebSocket

**Files:**
- Modify: `apps/api/src/routes/office-ws.ts:91-103`
- Test: `apps/api/src/routes/office-ws.test.ts`

**Interfaces:**
- Consumes: `OfficeHub.roomChatMessage(socket, userId, text)` (Task 2); `OfficeClientMessage` com `type: 'room-chat-message'` (Task 1).
- Produces: nenhuma nova API pública — só liga o dispatch já existente.

- [ ] **Step 1: Escrever o teste falho de dispatch**

Em `apps/api/src/routes/office-ws.test.ts`, ao final do `describe('office
websocket', ...)` (depois do teste `'propaga reação/chat nearby...'`),
adicionar:

```ts
  it('despacha room-chat-message pro hub com os parâmetros certos', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-roomchat@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'roomChatMessage')
    ws.send(JSON.stringify({ type: 'room-chat-message', text: 'oi' }))
    await delay(100)

    expect(spy).toHaveBeenCalledWith(expect.anything(), ana.id, 'oi')

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('mensagem de chat de sala malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-roomchat-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send(JSON.stringify({ type: 'room-chat-message' })) // sem text
    await delay(100)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await app.close()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm db:up && pnpm --filter @legends/api test -- office-ws.test.ts`
Expected: FAIL — `expect(spy).toHaveBeenCalledWith(...)` nunca é chamado
(não existe dispatch para `room-chat-message` ainda).

- [ ] **Step 3: Implementar o dispatch**

Em `apps/api/src/routes/office-ws.ts`, dentro de `ws.on('message', ...)`,
localizar o fim da cadeia de `if/else if`:

```ts
        } else if (msg.type === 'nearby-message' && typeof msg.text === 'string') {
          officeHub.nearbyMessage(ws, user.id, msg.text, msg.kind === 'thought' ? 'thought' : 'speech')
        }
      })
```

Substituir por:

```ts
        } else if (msg.type === 'nearby-message' && typeof msg.text === 'string') {
          officeHub.nearbyMessage(ws, user.id, msg.text, msg.kind === 'thought' ? 'thought' : 'speech')
        } else if (msg.type === 'room-chat-message' && typeof msg.text === 'string') {
          officeHub.roomChatMessage(ws, user.id, msg.text)
        }
      })
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api test -- office-ws.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/office-ws.ts apps/api/src/routes/office-ws.test.ts
git commit -m "feat(api): despacha room-chat-message pro OfficeHub"
```

---

### Task 4: Frontend — hook `useRoomChat`

**Files:**
- Create: `apps/web/src/office/media/useRoomChat.ts`
- Test: `apps/web/src/office/media/useRoomChat.test.ts`

**Interfaces:**
- Consumes: `OfficeBridge` (`onServerMessage`, `emitClientMessage`) de `apps/web/src/office/OfficeBridge.ts` (já existe, sem mudanças).
- Produces: `export interface RoomChatMessage { userId: string; name: string; text: string; sentAt: string }`; `export function useRoomChat(bridge: OfficeBridge, roomId: string | null): { messages: RoomChatMessage[]; sendMessage: (text: string) => void }` — consumido pelas Tasks 5 e 9.

- [ ] **Step 1: Escrever o teste falho**

Criar `apps/web/src/office/media/useRoomChat.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { OfficeBridge } from '../OfficeBridge'
import { useRoomChat } from './useRoomChat'

describe('useRoomChat', () => {
  it('nasce sem mensagens e acumula room-chat-message da própria sala', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useRoomChat(bridge, 'room-1'))

    expect(result.current.messages).toEqual([])

    act(() => {
      bridge.emitServerMessage({
        type: 'room-chat-message',
        roomId: 'room-1',
        userId: 'ana',
        name: 'Ana',
        text: 'oi',
        sentAt: '2026-01-01T00:00:00.000Z',
      })
    })

    expect(result.current.messages).toEqual([
      { userId: 'ana', name: 'Ana', text: 'oi', sentAt: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('ignora mensagens de outra sala', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useRoomChat(bridge, 'room-1'))

    act(() => {
      bridge.emitServerMessage({
        type: 'room-chat-message',
        roomId: 'room-2',
        userId: 'ana',
        name: 'Ana',
        text: 'oi',
        sentAt: '2026-01-01T00:00:00.000Z',
      })
    })

    expect(result.current.messages).toEqual([])
  })

  it('substitui as mensagens pelo histórico ao receber room-chat-history da mesma sala', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useRoomChat(bridge, 'room-1'))

    act(() => {
      bridge.emitServerMessage({
        type: 'room-chat-history',
        roomId: 'room-1',
        messages: [{ userId: 'bruno', name: 'Bruno', text: 'oi de antes', sentAt: '2026-01-01T00:00:00.000Z' }],
      })
    })

    expect(result.current.messages).toEqual([
      { userId: 'bruno', name: 'Bruno', text: 'oi de antes', sentAt: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('zera as mensagens quando o roomId muda (trocou de sala ou saiu)', () => {
    const bridge = new OfficeBridge()
    const { result, rerender } = renderHook(({ roomId }) => useRoomChat(bridge, roomId), {
      initialProps: { roomId: 'room-1' as string | null },
    })

    act(() => {
      bridge.emitServerMessage({
        type: 'room-chat-message',
        roomId: 'room-1',
        userId: 'ana',
        name: 'Ana',
        text: 'oi',
        sentAt: '2026-01-01T00:00:00.000Z',
      })
    })
    expect(result.current.messages).toHaveLength(1)

    rerender({ roomId: null })
    expect(result.current.messages).toEqual([])

    rerender({ roomId: 'room-2' })
    expect(result.current.messages).toEqual([])
  })

  it('sendMessage emite room-chat-message via bridge, cortando espaços e ignorando texto vazio', () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(() => useRoomChat(bridge, 'room-1'))

    act(() => result.current.sendMessage('  oi pessoal  '))
    expect(sent).toContainEqual({ type: 'room-chat-message', text: 'oi pessoal' })

    act(() => result.current.sendMessage('   '))
    expect(sent).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- useRoomChat.test.ts`
Expected: FAIL — `Cannot find module './useRoomChat'`.

- [ ] **Step 3: Implementar o hook**

Criar `apps/web/src/office/media/useRoomChat.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import type { OfficeBridge } from '../OfficeBridge'

export interface RoomChatMessage {
  userId: string
  name: string
  text: string
  sentAt: string
}

export interface RoomChatState {
  messages: RoomChatMessage[]
  sendMessage: (text: string) => void
}

/**
 * Histórico do chat da sala atual. Zera sempre que `roomId` muda — trocar de
 * sala ou sair dela nunca deixa o histórico anterior vazar para a próxima.
 */
export function useRoomChat(bridge: OfficeBridge, roomId: string | null): RoomChatState {
  const [messages, setMessages] = useState<RoomChatMessage[]>([])
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  useEffect(() => {
    setMessages([])
  }, [roomId])

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type === 'room-chat-history' && message.roomId === roomIdRef.current) {
          setMessages(message.messages)
        } else if (message.type === 'room-chat-message' && message.roomId === roomIdRef.current) {
          setMessages((current) => [
            ...current,
            { userId: message.userId, name: message.name, text: message.text, sentAt: message.sentAt },
          ])
        }
      }),
    [bridge],
  )

  function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    bridge.emitClientMessage({ type: 'room-chat-message', text: trimmed })
  }

  return { messages, sendMessage }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- useRoomChat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/useRoomChat.ts apps/web/src/office/media/useRoomChat.test.ts
git commit -m "feat(web): hook useRoomChat (histórico + envio do chat de sala)"
```

---

### Task 5: Frontend — `RoomChatPanel`

**Files:**
- Create: `apps/web/src/office/media/RoomChatPanel.tsx`
- Test: `apps/web/src/office/media/RoomChatPanel.test.tsx`

**Interfaces:**
- Consumes: `RoomChatMessage` de `./useRoomChat` (Task 4); `Icon` de `../../components/Icon` (já existe).
- Produces: `export function RoomChatPanel({ messages, onSendMessage, onClose }: { messages: RoomChatMessage[]; onSendMessage: (text: string) => void; onClose: () => void })` — consumido pela Task 8 (`MediaTiles`).

- [ ] **Step 1: Escrever o teste falho**

Criar `apps/web/src/office/media/RoomChatPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoomChatPanel } from './RoomChatPanel'

describe('RoomChatPanel', () => {
  it('mostra aviso de "sem mensagens" quando a lista está vazia', () => {
    render(<RoomChatPanel messages={[]} onSendMessage={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Sem mensagens na sala ainda.')).toBeInTheDocument()
  })

  it('lista as mensagens com remetente e texto, na ordem recebida', () => {
    render(
      <RoomChatPanel
        messages={[
          { userId: 'ana', name: 'Ana', text: 'oi', sentAt: '2026-01-01T00:00:00.000Z' },
          { userId: 'bruno', name: 'Bruno', text: 'e aí', sentAt: '2026-01-01T00:00:01.000Z' },
        ]}
        onSendMessage={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Ana')
    expect(items[0]).toHaveTextContent('oi')
    expect(items[1]).toHaveTextContent('Bruno')
    expect(items[1]).toHaveTextContent('e aí')
  })

  it('envia a mensagem digitada e limpa o campo', () => {
    const onSendMessage = vi.fn()
    render(<RoomChatPanel messages={[]} onSendMessage={onSendMessage} onClose={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Mensagem...'), { target: { value: '  opa  ' } })
    fireEvent.submit(screen.getByPlaceholderText('Mensagem...').closest('form')!)

    expect(onSendMessage).toHaveBeenCalledWith('opa')
    expect(screen.getByPlaceholderText('Mensagem...')).toHaveValue('')
  })

  it('não envia texto vazio', () => {
    const onSendMessage = vi.fn()
    render(<RoomChatPanel messages={[]} onSendMessage={onSendMessage} onClose={vi.fn()} />)

    fireEvent.submit(screen.getByPlaceholderText('Mensagem...').closest('form')!)
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it('botão fechar chama onClose', () => {
    const onClose = vi.fn()
    render(<RoomChatPanel messages={[]} onSendMessage={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Fechar chat da sala' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- RoomChatPanel.test.tsx`
Expected: FAIL — `Cannot find module './RoomChatPanel'`.

- [ ] **Step 3: Implementar o componente**

Criar `apps/web/src/office/media/RoomChatPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { RoomChatMessage } from './useRoomChat'

export function RoomChatPanel({
  messages,
  onSendMessage,
  onClose,
}: {
  messages: RoomChatMessage[]
  onSendMessage: (text: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Nova mensagem chegou: rola pro final, igual a qualquer chat.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSendMessage(trimmed)
    setText('')
  }

  return (
    <div className="flex h-full flex-col text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-md py-sm">
        <h2 className="font-label text-label-md text-white/90">Chat da sala</h2>
        <button
          type="button"
          aria-label="Fechar chat da sala"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-md py-sm">
        {messages.length === 0 ? (
          <p className="font-body text-body-sm text-white/55">Sem mensagens na sala ainda.</p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {messages.map((message, index) => (
              <li key={`${message.userId}-${message.sentAt}-${index}`} className="font-body text-body-sm">
                <span className="font-label text-label-sm text-white/70">{message.name}</span>
                <p className="text-white">{message.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="flex items-center gap-sm border-t border-white/10 px-md py-sm"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => event.stopPropagation()}
          placeholder="Mensagem..."
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface-container-high/70 px-sm py-xs font-body text-body-md text-white outline-none placeholder:text-white/45"
        />
        <button
          type="submit"
          aria-label="Enviar mensagem"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Icon name="send" className="text-[20px]" />
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- RoomChatPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/RoomChatPanel.tsx apps/web/src/office/media/RoomChatPanel.test.tsx
git commit -m "feat(web): componente RoomChatPanel"
```

---

### Task 6: Frontend — `RoomPeoplePanel`

**Files:**
- Create: `apps/web/src/office/media/RoomPeoplePanel.tsx`
- Test: `apps/web/src/office/media/RoomPeoplePanel.test.tsx`

**Interfaces:**
- Consumes: `OfficeOccupant` de `@legends/shared`; `Avatar`/`AvatarSource` de `../../components/Avatar` (já existe — `OfficeOccupant` satisfaz `AvatarSource` estruturalmente: tem `name`, `photoUrl?`, `avatarStyle?`, `avatarSeed?`, `avatarOptions?`); `Icon` de `../../components/Icon`.
- Produces: `export function RoomPeoplePanel({ occupants, onClose }: { occupants: OfficeOccupant[]; onClose: () => void })` — consumido pela Task 8 (`MediaTiles`).

- [ ] **Step 1: Escrever o teste falho**

Criar `apps/web/src/office/media/RoomPeoplePanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { RoomPeoplePanel } from './RoomPeoplePanel'

function occupant(overrides: Partial<OfficeOccupant> = {}): OfficeOccupant {
  return {
    userId: 'ana',
    name: 'Ana Silva',
    x: 1,
    y: 1,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
    ...overrides,
  }
}

describe('RoomPeoplePanel', () => {
  it('mostra o total de pessoas no título e um item por ocupante', () => {
    render(
      <RoomPeoplePanel
        occupants={[occupant(), occupant({ userId: 'bruno', name: 'Bruno Costa' })]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Pessoas na sala (2)')).toBeInTheDocument()
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
  })

  it('lista vazia mostra "(0)" e nenhum item', () => {
    render(<RoomPeoplePanel occupants={[]} onClose={vi.fn()} />)
    expect(screen.getByText('Pessoas na sala (0)')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('botão fechar chama onClose', () => {
    const onClose = vi.fn()
    render(<RoomPeoplePanel occupants={[occupant()]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar pessoas da sala' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- RoomPeoplePanel.test.tsx`
Expected: FAIL — `Cannot find module './RoomPeoplePanel'`.

- [ ] **Step 3: Implementar o componente**

Criar `apps/web/src/office/media/RoomPeoplePanel.tsx`:

```tsx
import type { OfficeOccupant } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'

export function RoomPeoplePanel({
  occupants,
  onClose,
}: {
  occupants: OfficeOccupant[]
  onClose: () => void
}) {
  return (
    <div className="flex h-full flex-col text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-md py-sm">
        <h2 className="font-label text-label-md text-white/90">Pessoas na sala ({occupants.length})</h2>
        <button
          type="button"
          aria-label="Fechar pessoas da sala"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </header>

      <ul className="flex-1 overflow-y-auto px-md py-sm">
        {occupants.map((occupant) => (
          <li key={occupant.userId} className="flex items-center gap-sm py-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
              <Avatar user={occupant} initialsClassName="font-label text-label-sm font-bold text-primary" />
            </div>
            <span className="truncate font-body text-body-sm text-white">{occupant.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- RoomPeoplePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/RoomPeoplePanel.tsx apps/web/src/office/media/RoomPeoplePanel.test.tsx
git commit -m "feat(web): componente RoomPeoplePanel"
```

---

### Task 7: Frontend — `MediaBar` ganha os dois botões de sala

**Files:**
- Modify: `apps/web/src/office/media/MediaBar.tsx`
- Test: `apps/web/src/office/media/MediaBar.test.tsx`

**Interfaces:**
- Consumes: nada novo (só props do próprio componente).
- Produces: `MediaBar` ganha props opcionais `showRoomControls?: boolean`, `roomPanel?: 'chat' | 'people' | null`, `onToggleRoomChat?: () => void`, `onToggleRoomPeople?: () => void` — consumidos pela Task 9 (`OfficePage`).

- [ ] **Step 1: Escrever os testes falhos**

Em `apps/web/src/office/media/MediaBar.test.tsx`, atualizar
`renderMediaBar` para aceitar e repassar os novos props:

```tsx
function renderMediaBar({
  media = mediaState(),
  zoneName = null,
  broadcast = broadcastState({ available: false }),
  canBroadcast = false,
  youName = 'Lucca Secco',
  onLeave = vi.fn(),
  onChatOpenChange,
  onNearbyMessage,
  onReaction,
  showRoomControls = false,
  roomPanel = null,
  onToggleRoomChat,
  onToggleRoomPeople,
}: Partial<ComponentProps<typeof MediaBar>> = {}) {
  return render(
    <MediaBar
      media={media}
      zoneName={zoneName}
      broadcast={broadcast}
      canBroadcast={canBroadcast}
      youName={youName}
      onLeave={onLeave}
      onChatOpenChange={onChatOpenChange}
      onNearbyMessage={onNearbyMessage}
      onReaction={onReaction}
      showRoomControls={showRoomControls}
      roomPanel={roomPanel}
      onToggleRoomChat={onToggleRoomChat}
      onToggleRoomPeople={onToggleRoomPeople}
    />,
  )
}
```

Adicionar, ao final do `describe('MediaBar', ...)`:

```tsx
  it('os botões de sala só aparecem quando showRoomControls é true', () => {
    renderMediaBar()
    expect(screen.queryByRole('button', { name: 'Abrir chat da sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir pessoas da sala' })).not.toBeInTheDocument()
  })

  it('com showRoomControls, os botões de sala aparecem e chamam os callbacks', () => {
    const onToggleRoomChat = vi.fn()
    const onToggleRoomPeople = vi.fn()
    renderMediaBar({ showRoomControls: true, onToggleRoomChat, onToggleRoomPeople })

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(onToggleRoomChat).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))
    expect(onToggleRoomPeople).toHaveBeenCalledOnce()
  })

  it('o botão do painel ativo mostra o rótulo de fechar', () => {
    renderMediaBar({ showRoomControls: true, roomPanel: 'chat' })
    expect(screen.getByRole('button', { name: 'Fechar chat da sala' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir pessoas da sala' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web test -- MediaBar.test.tsx`
Expected: FAIL — botões "Abrir chat da sala"/"Abrir pessoas da sala" não existem.

- [ ] **Step 3: Implementar os props e os botões**

Em `apps/web/src/office/media/MediaBar.tsx`, no cabeçalho da função,
localizar:

```tsx
export function MediaBar({
  media,
  zoneName,
  broadcast,
  canBroadcast,
  youName,
  onLeave,
  onChatOpenChange,
  onNearbyMessage,
  onReaction,
}: {
  media: OfficeMediaState
  zoneName: string | null
  broadcast: OfficeBroadcastState
  canBroadcast: boolean
  youName?: string | null
  onLeave: () => void
  onChatOpenChange?: (open: boolean) => void
  onNearbyMessage?: (text: string, kind: OfficeNearbyMessageKind) => void
  onReaction?: (reaction: string) => void
}) {
```

Substituir por:

```tsx
export function MediaBar({
  media,
  zoneName,
  broadcast,
  canBroadcast,
  youName,
  onLeave,
  onChatOpenChange,
  onNearbyMessage,
  onReaction,
  showRoomControls = false,
  roomPanel = null,
  onToggleRoomChat,
  onToggleRoomPeople,
}: {
  media: OfficeMediaState
  zoneName: string | null
  broadcast: OfficeBroadcastState
  canBroadcast: boolean
  youName?: string | null
  onLeave: () => void
  onChatOpenChange?: (open: boolean) => void
  onNearbyMessage?: (text: string, kind: OfficeNearbyMessageKind) => void
  onReaction?: (reaction: string) => void
  showRoomControls?: boolean
  roomPanel?: 'chat' | 'people' | null
  onToggleRoomChat?: () => void
  onToggleRoomPeople?: () => void
}) {
```

Logo depois do botão de nearby chat, localizar:

```tsx
        <button
          type="button"
          aria-label={showChat ? 'Fechar nearby chat' : 'Abrir nearby chat'}
          title="Nearby chat"
          aria-expanded={showChat}
          className={toolButtonCls(showChat)}
          onClick={() => setShowChat((current) => !current)}
        >
          <Icon name="chat_bubble" className="text-[20px]" />
        </button>
        <button
          type="button"
          aria-label={media.screenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'}
```

Substituir por (insere os dois botões novos entre eles):

```tsx
        <button
          type="button"
          aria-label={showChat ? 'Fechar nearby chat' : 'Abrir nearby chat'}
          title="Nearby chat"
          aria-expanded={showChat}
          className={toolButtonCls(showChat)}
          onClick={() => setShowChat((current) => !current)}
        >
          <Icon name="chat_bubble" className="text-[20px]" />
        </button>
        {showRoomControls && (
          <>
            <button
              type="button"
              aria-label={roomPanel === 'chat' ? 'Fechar chat da sala' : 'Abrir chat da sala'}
              title="Chat da sala"
              aria-expanded={roomPanel === 'chat'}
              className={toolButtonCls(roomPanel === 'chat')}
              onClick={onToggleRoomChat}
            >
              <Icon name="forum" className="text-[20px]" />
            </button>
            <button
              type="button"
              aria-label={roomPanel === 'people' ? 'Fechar pessoas da sala' : 'Abrir pessoas da sala'}
              title="Pessoas da sala"
              aria-expanded={roomPanel === 'people'}
              className={toolButtonCls(roomPanel === 'people')}
              onClick={onToggleRoomPeople}
            >
              <Icon name="group" className="text-[20px]" />
            </button>
          </>
        )}
        <button
          type="button"
          aria-label={media.screenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- MediaBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx
git commit -m "feat(web): botões de chat/pessoas da sala na MediaBar"
```

---

### Task 8: Frontend — `MediaTiles` ganha o painel lateral

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx`
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: `RoomChatMessage` de `./useRoomChat` (Task 4); `RoomChatPanel` (Task 5); `RoomPeoplePanel` (Task 6); `OfficeOccupant` de `@legends/shared`.
- Produces: `MediaTiles` ganha props opcionais `roomPanel?: 'chat' | 'people' | null`, `roomChatMessages?: RoomChatMessage[]`, `onSendRoomChatMessage?: (text: string) => void`, `roomOccupants?: OfficeOccupant[]`, `onCloseRoomPanel?: () => void` — consumidos pela Task 9 (`OfficePage`).

- [ ] **Step 1: Escrever os testes falhos**

Em `apps/web/src/office/media/MediaTiles.test.tsx`, adicionar ao final do
`describe('MediaTiles', ...)`:

```tsx
  it('sem roomPanel, nenhum painel lateral aparece', () => {
    render(<MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={vi.fn()} />)
    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()
  })

  it('roomPanel="chat" renderiza o RoomChatPanel ao lado da área central', () => {
    render(
      <MediaTiles
        remotes={[remote({ cameraTrack: fakeVideoTrack() })]}
        expanded
        onToggleExpanded={vi.fn()}
        roomPanel="chat"
        roomChatMessages={[{ userId: 'ana', name: 'Ana', text: 'oi', sentAt: '2026-01-01T00:00:00.000Z' }]}
        onSendRoomChatMessage={vi.fn()}
      />,
    )
    expect(screen.getByText('Chat da sala')).toBeInTheDocument()
    expect(screen.getByText('oi')).toBeInTheDocument()
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()
  })

  it('roomPanel="people" renderiza o RoomPeoplePanel ao lado da área central', () => {
    render(
      <MediaTiles
        remotes={[remote({ cameraTrack: fakeVideoTrack() })]}
        expanded
        onToggleExpanded={vi.fn()}
        roomPanel="people"
        roomOccupants={[
          { userId: 'ana', name: 'Ana Silva', x: 1, y: 1, dir: 'down', avatarSeed: null, avatarOptions: null },
        ]}
      />,
    )
    expect(screen.getByText('Pessoas na sala (1)')).toBeInTheDocument()
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
  })

  it('clicar em fechar no painel lateral chama onCloseRoomPanel', () => {
    const onCloseRoomPanel = vi.fn()
    render(
      <MediaTiles
        remotes={[remote({ cameraTrack: fakeVideoTrack() })]}
        expanded
        onToggleExpanded={vi.fn()}
        roomPanel="chat"
        onCloseRoomPanel={onCloseRoomPanel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fechar chat da sala' }))
    expect(onCloseRoomPanel).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web test -- MediaTiles.test.tsx`
Expected: FAIL — `roomPanel`/`roomChatMessages`/etc. não têm efeito nenhum
ainda (props inexistentes na assinatura).

- [ ] **Step 3: Implementar o painel lateral**

Em `apps/web/src/office/media/MediaTiles.tsx`, atualizar os imports do topo:

```tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import type { AvatarStyleKey, CharacterOptions, OfficeOccupant } from '@legends/shared'
import type { RemoteMedia } from './useOfficeMedia'
import type { RoomChatMessage } from './useRoomChat'
import { RemoteAudio } from './RemoteAudio'
import { RoomChatPanel } from './RoomChatPanel'
import { RoomPeoplePanel } from './RoomPeoplePanel'
import { Icon } from '../../components/Icon'
import { Avatar, type AvatarSource } from '../../components/Avatar'
```

Na assinatura de `MediaTiles`, localizar:

```tsx
export function MediaTiles({
  remotes,
  local,
  expanded = false,
  onToggleExpanded = () => {},
  showAllPresent = false,
}: {
  remotes: RemoteMedia[]
  local?: {
    track: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: CharacterOptions | null
  } | null
  expanded?: boolean
  onToggleExpanded?: () => void
  showAllPresent?: boolean
}) {
```

Substituir por:

```tsx
export function MediaTiles({
  remotes,
  local,
  expanded = false,
  onToggleExpanded = () => {},
  showAllPresent = false,
  roomPanel = null,
  roomChatMessages = [],
  onSendRoomChatMessage = () => {},
  roomOccupants = [],
  onCloseRoomPanel = () => {},
}: {
  remotes: RemoteMedia[]
  local?: {
    track: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: CharacterOptions | null
  } | null
  expanded?: boolean
  onToggleExpanded?: () => void
  showAllPresent?: boolean
  roomPanel?: 'chat' | 'people' | null
  roomChatMessages?: RoomChatMessage[]
  onSendRoomChatMessage?: (text: string) => void
  roomOccupants?: OfficeOccupant[]
  onCloseRoomPanel?: () => void
}) {
```

Por fim, localizar o bloco do portal (do `{expanded && hasVisible &&
createPortal(` até o fechamento `)}` antes de `document.body,`):

```tsx
      {expanded && hasVisible && createPortal(
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/90 p-lg"
          role="region"
          aria-label="Câmeras em tela cheia"
        >
          <button
            type="button"
            aria-label="Recolher câmeras"
            onClick={onToggleExpanded}
            className="fixed right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <Icon name="fullscreen_exit" className="text-[22px]" />
          </button>
          {featured ? (
            <div className="flex h-full gap-md">
              <div className="flex min-w-0 flex-1 flex-col" data-testid="featured-tile">
                {featured.kind === 'avatar' ? (
                  <AvatarTile user={featured.avatar} label={featured.label} className="flex h-full flex-1 flex-col" fill />
                ) : (
                  <VideoTile
                    track={featured.track!}
                    label={featured.label}
                    mirrored={featured.mirrored}
                    className="flex h-full flex-1 flex-col"
                    videoClassName="min-h-0 flex-1 object-contain"
                  />
                )}
              </div>
              <div className="flex w-56 shrink-0 flex-col gap-sm overflow-y-auto">
                {tiles
                  .filter((t) => t.key !== featured.key)
                  .map((t) =>
                    t.kind === 'avatar' ? (
                      <AvatarTile key={t.key} user={t.avatar} label={t.label} className="w-full" onClick={() => setFeaturedPin(t.key)} />
                    ) : (
                      <VideoTile
                        key={t.key}
                        track={t.track!}
                        label={t.label}
                        mirrored={t.mirrored}
                        className="w-full"
                        onClick={() => setFeaturedPin(t.key)}
                      />
                    ),
                  )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-md">
              {tiles.map((tile) =>
                tile.kind === 'avatar' ? (
                  <AvatarTile key={tile.key} user={tile.avatar} label={tile.label} className="w-full" onClick={() => setFeaturedPin(tile.key)} />
                ) : (
                  <VideoTile
                    key={tile.key}
                    track={tile.track!}
                    label={tile.label}
                    mirrored={tile.mirrored}
                    className="w-full"
                    onClick={() => setFeaturedPin(tile.key)}
                  />
                ),
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
```

Substituir por (raiz vira flex-col sem overflow próprio; linha
`flex flex-1 min-h-0` com área central + painel lateral condicional):

```tsx
      {expanded && hasVisible && createPortal(
        <div
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black/90"
          role="region"
          aria-label="Câmeras em tela cheia"
        >
          <button
            type="button"
            aria-label="Recolher câmeras"
            onClick={onToggleExpanded}
            className="fixed right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <Icon name="fullscreen_exit" className="text-[22px]" />
          </button>
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-y-auto p-lg">
              {featured ? (
                <div className="flex h-full gap-md">
                  <div className="flex min-w-0 flex-1 flex-col" data-testid="featured-tile">
                    {featured.kind === 'avatar' ? (
                      <AvatarTile user={featured.avatar} label={featured.label} className="flex h-full flex-1 flex-col" fill />
                    ) : (
                      <VideoTile
                        track={featured.track!}
                        label={featured.label}
                        mirrored={featured.mirrored}
                        className="flex h-full flex-1 flex-col"
                        videoClassName="min-h-0 flex-1 object-contain"
                      />
                    )}
                  </div>
                  <div className="flex w-56 shrink-0 flex-col gap-sm overflow-y-auto">
                    {tiles
                      .filter((t) => t.key !== featured.key)
                      .map((t) =>
                        t.kind === 'avatar' ? (
                          <AvatarTile key={t.key} user={t.avatar} label={t.label} className="w-full" onClick={() => setFeaturedPin(t.key)} />
                        ) : (
                          <VideoTile
                            key={t.key}
                            track={t.track!}
                            label={t.label}
                            mirrored={t.mirrored}
                            className="w-full"
                            onClick={() => setFeaturedPin(t.key)}
                          />
                        ),
                      )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-md">
                  {tiles.map((tile) =>
                    tile.kind === 'avatar' ? (
                      <AvatarTile key={tile.key} user={tile.avatar} label={tile.label} className="w-full" onClick={() => setFeaturedPin(tile.key)} />
                    ) : (
                      <VideoTile
                        key={tile.key}
                        track={tile.track!}
                        label={tile.label}
                        mirrored={tile.mirrored}
                        className="w-full"
                        onClick={() => setFeaturedPin(tile.key)}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
            {roomPanel && (
              <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-[#2f2f2f]">
                {roomPanel === 'chat' ? (
                  <RoomChatPanel
                    messages={roomChatMessages}
                    onSendMessage={onSendRoomChatMessage}
                    onClose={onCloseRoomPanel}
                  />
                ) : (
                  <RoomPeoplePanel occupants={roomOccupants} onClose={onCloseRoomPanel} />
                )}
              </aside>
            )}
          </div>
        </div>,
        document.body,
      )}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- MediaTiles.test.tsx`
Expected: PASS (todos os testes existentes + os 4 novos do painel lateral).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(web): painel lateral (chat/pessoas) na grade expandida"
```

---

### Task 9: Frontend — `OfficePage` liga tudo

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Test: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `useRoomChat` (Task 4), `MediaBar` com os novos props (Task 7), `MediaTiles` com os novos props (Task 8), `mapZoneAt` de `@legends/shared` (já importado).
- Produces: nada consumido por outra task — é o topo da árvore.

- [ ] **Step 1: Escrever os testes falhos**

Em `apps/web/src/pages/OfficePage.test.tsx`, atualizar o bloco de mocks
hoisted para incluir `useRoomChatMock`:

```tsx
const { apiFetchMock, useOfficeBroadcastMock, useRoomChatMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  useOfficeBroadcastMock: vi.fn(),
  useRoomChatMock: vi.fn(),
}))
```

Adicionar o mock do módulo (perto dos outros `vi.mock`):

```tsx
vi.mock('../office/media/useRoomChat', () => ({
  useRoomChat: (...args: unknown[]) => useRoomChatMock(...args),
}))
```

Atualizar `meetingRoomMap` para incluir a `OfficeRoomDTO` correspondente
(hoje `rooms` fica vazio mesmo com a zona presente — sem isso, `OfficePage`
não acha o `room.id` e o painel lateral nunca teria uma sala válida):

```tsx
const meetingRoomMap: ActiveOfficeMapDTO = {
  ...activeMap,
  document: {
    ...activeMap.document,
    objects: [
      ...activeMap.document.objects,
      {
        id: 'room-1',
        layerKey: 'meeting-rooms',
        type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 320, y: 416, width: 96, height: 96 },
        properties: {
          externalKey: 'sala-1',
          name: 'Sala de Reunião',
          status: 'OPEN',
          voiceEnabled: true,
          accessPolicy: 'OPEN',
        },
      },
    ],
  },
  rooms: [
    {
      id: 'room-sala-1',
      name: 'Sala de Reunião',
      externalKey: 'sala-1',
      status: 'OPEN',
      capacity: null,
      voiceEnabled: true,
      accessPolicy: 'OPEN',
      allowedUsers: [],
    },
  ],
}
```

No `beforeEach`, resetar o mock de `useRoomChat`:

```tsx
  beforeEach(() => {
    vi.useRealTimers()
    socketMockValue = { occupants, youId: 'ana', connected: true }
    apiFetchMock.mockReset()
    apiFetchMock.mockImplementation((path: string) =>
      path === '/users'
        ? Promise.resolve({ users: [] })
        : path === '/office/map'
          ? Promise.resolve(activeMap)
          : Promise.resolve({ broadcastEnabled: false, activeMapPublicationId: 'publication-1' }),
    )
    useOfficeBroadcastMock.mockReset()
    useOfficeBroadcastMock.mockImplementation(() => broadcastMockValue)
    useRoomChatMock.mockReset()
    useRoomChatMock.mockReturnValue({ messages: [], sendMessage: vi.fn() })
    broadcastMockValue = {
      available: false,
      speakerEnabled: false,
      speakerError: false,
      speakers: [],
      broadcastTracks: [],
      toggleSpeaker: async () => {},
    }
    interactionsMock = {
      selected: null,
      selectedEntry: null,
      incomingCall: null,
      toast: null,
      openCard: () => {},
      closeCard: () => {},
      call: () => {},
      follow: () => {},
      viewProfile: () => {},
      acceptCall: () => {},
      refuseCall: () => {},
    }
  })
```

Adicionar, ao final do `describe('OfficePage', ...)`:

```tsx
  it('abrir o chat da sala fecha a lista de pessoas, e vice-versa', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(screen.getByText('Chat da sala')).toBeInTheDocument()
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))
    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
    expect(screen.getByText(/Pessoas na sala/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar pessoas da sala' }))
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()
  })

  it('fechar a grade de câmeras fecha também o painel lateral', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(screen.getByText('Chat da sala')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
  })

  it('a lista de pessoas da sala mostra só quem está na mesma sala', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))

    expect(screen.getByText('Pessoas na sala (2)')).toBeInTheDocument()
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
  })

  it('a MediaBar continua acima (z-index maior) da grade expandida, não escondida atrás dela', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    const micButton = screen.getByRole('button', { name: 'Ativar microfone' })
    expect(micButton.closest('[class*="z-[60]"]')).not.toBeNull()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web test -- OfficePage.test.tsx`
Expected: FAIL — botões "Abrir chat da sala"/"Abrir pessoas da sala" não
existem ainda na página (não são repassados pra `MediaBar`).

- [ ] **Step 3: Ligar tudo em `OfficePage`**

Em `apps/web/src/pages/OfficePage.tsx`, adicionar o import do hook:

```tsx
import { useOfficeMedia } from '../office/media/useOfficeMedia'
import { useOfficeBroadcast } from '../office/media/useOfficeBroadcast'
import { useRoomChat } from '../office/media/useRoomChat'
```

Adicionar o novo state, junto dos demais:

```tsx
  const [camerasExpanded, setCamerasExpanded] = useState(false)
  const [roomPanel, setRoomPanel] = useState<'chat' | 'people' | null>(null)
```

Logo após o cálculo de `inMeetingRoom`, adicionar o cálculo da sala atual e
de quem está nela:

```tsx
  const zone = you && activeMap ? mapZoneAt(activeMap.document, you.x, you.y) : null
  const zoneName = zone?.properties.name ?? null
  const inMeetingRoom = zoneName !== null
  const room =
    inMeetingRoom && zone && activeMap
      ? activeMap.rooms.find((r) => r.externalKey === zone.properties.externalKey) ?? null
      : null
  const roomOccupants =
    inMeetingRoom && zone && activeMap
      ? occupants.filter(
          (o) => mapZoneAt(activeMap.document, o.x, o.y)?.properties.externalKey === zone.properties.externalKey,
        )
      : []
```

Logo após a definição de `interactions` (`const interactions =
useOfficeInteractions(...)`), adicionar o hook de chat e os toggles do
painel:

```tsx
  const interactions = useOfficeInteractions(bridge, occupants, youId, activeMap?.document)
  const roomChat = useRoomChat(bridge, room?.id ?? null)

  function toggleRoomChat() {
    setRoomPanel((current) => (current === 'chat' ? null : 'chat'))
  }
  function toggleRoomPeople() {
    setRoomPanel((current) => (current === 'people' ? null : 'people'))
  }
```

Adicionar o `useEffect` que fecha o painel junto com a grade, perto dos
outros efeitos (ex.: logo após o `useEffect` do `map-changed`):

```tsx
  useEffect(() => bridge.onServerMessage((message) => {
    if (message.type === 'map-changed') window.location.reload()
  }), [bridge])

  // Fechar a grade fecha também qualquer painel lateral aberto.
  useEffect(() => {
    if (!camerasExpanded) setRoomPanel(null)
  }, [camerasExpanded])
```

Atualizar o `<MediaTiles>`:

```tsx
      <MediaTiles
        remotes={media.remotes}
        local={local}
        expanded={camerasExpanded}
        onToggleExpanded={() => setCamerasExpanded((value) => !value)}
        showAllPresent={inMeetingRoom}
        roomPanel={roomPanel}
        roomChatMessages={roomChat.messages}
        onSendRoomChatMessage={roomChat.sendMessage}
        roomOccupants={roomOccupants}
        onCloseRoomPanel={() => setRoomPanel(null)}
      />
```

Por fim — este é o ponto central do problema descrito no spec ("a MediaBar
fica coberta pelo overlay z-50 da grade") — subir o `z-10` do container fixo
da `MediaBar` para acima do `z-50` do overlay de `MediaTiles` (que é um
portal direto pra `document.body`, então só o valor de `z-index` decide quem
fica por cima, não a ordem no JSX). Localizar:

```tsx
      {/* Controles: barra fixa embaixo, sempre acessível independente do
          estado das câmeras. */}
      <div
        className="absolute bottom-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
        onWheel={(event) => event.stopPropagation()}
      >
```

Substituir por (`z-10` → `z-[60]`, acima do `z-50` da grade expandida):

```tsx
      {/* Controles: barra fixa embaixo, sempre acessível independente do
          estado das câmeras — inclusive por cima da grade expandida
          (z-50 do overlay de MediaTiles), daí o z-[60] aqui. */}
      <div
        className="absolute bottom-3 left-1/2 z-[60] flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
        onWheel={(event) => event.stopPropagation()}
      >
```

Atualizar o `<MediaBar>`:

```tsx
        <MediaBar
          media={media}
          zoneName={zoneName}
          broadcast={broadcast}
          canBroadcast={canBroadcast}
          youName={you?.name}
          onLeave={() => navigate('/')}
          onChatOpenChange={setNearbyChatOpen}
          onNearbyMessage={(text, kind) => {
            bridge.emitClientMessage({ type: 'nearby-message', text, kind })
          }}
          onReaction={(reaction) => {
            bridge.emitClientMessage({ type: 'nearby-message', text: reaction, kind: 'speech' })
          }}
          showRoomControls={camerasExpanded}
          roomPanel={roomPanel}
          onToggleRoomChat={toggleRoomChat}
          onToggleRoomPeople={toggleRoomPeople}
        />
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- OfficePage.test.tsx`
Expected: PASS (todos os testes existentes + os 3 novos de painel lateral).

- [ ] **Step 5: Rodar a suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: PASS em todos os workspaces (`@legends/shared`, `@legends/api`,
`@legends/web`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(web): liga o painel lateral (chat/pessoas da sala) na OfficePage"
```

---

## Verificação manual (opcional, recomendada antes de considerar pronto)

Suba `pnpm dev`, entre no escritório com duas contas/abas diferentes, ande
até uma sala de reunião com as duas, abra a grade de câmeras (`grid_view`),
confirme que a `MediaBar` aparece por cima da grade, abra o chat da sala numa
aba e mande uma mensagem, confirme que ela aparece em tempo real na outra
aba, saia da sala com as duas (a última que sair deve zerar o histórico) e
reentre para confirmar que o chat começa vazio de novo.
