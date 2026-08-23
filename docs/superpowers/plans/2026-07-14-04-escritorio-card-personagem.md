# Escritório — Card de personagem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicar num personagem do escritório abre o card de /lendas com três ações — chamar (popup + som + aceitar/recusar), seguir (caminhada automática por BFS) e ver perfil (nova aba).

**Architecture:** O clique no Phaser emite só o `userId` pelo bridge; toda UI é React. O card reusa o `LegendCard` extraído de /lendas, alimentado pelo `/users/showcase` cacheado. Chamada é relay puro no hub (sem estado de chamada). Seguir usa `findPath` (BFS no shared) executado por um `FollowController` (classe pura) que confirma cada passo pelo `moved` — porque o rate limit do servidor descarta moves em silêncio.

**Tech Stack:** Phaser 3 (`setInteractive`), WebSocket do escritório, BFS no `@legends/shared`, React 18 + React Query, Web Audio (beep), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-escritorio-card-personagem-design.md`

## Global Constraints

- TypeScript **strict**, ESM. Mensagens ao usuário em **português**; comentários desta feature em português.
- A cena Phaser não decide nada: clique emite só `userId`; card/popup/som/follow são React/lib.
- Servidor autoritativo: cliente manda intenção; chamada é **relay puro** (hub sem estado de chamada).
- Rate limit de movimento descarta em **silêncio** (sem `moved` nem `sync`) — o follow confirma cada passo e usa timeout, nunca assume resposta.
- Rate limit de chamada: **1 chamada a cada 3 s por usuário** (bucket próprio); excesso → `call-failed rate-limited`.
- `findPath` vive no `@legends/shared` (mapa é fonte única); retorno `[]` = já adjacente, `null` = sem caminho; destino é tile **adjacente** ao alvo, nunca em cima.
- Beep sem asset binário: Web Audio (`OscillatorNode`), `AudioContext` singleton lazy, `resume()` no primeiro gesto, falha silenciosa se bloqueado.
- Timeout de chamada não respondida: **30 s** → auto-recusa.
- Tecla de movimento cancela o follow (o humano sempre vence).
- Testes colocados ao lado; testes da API exigem Postgres (`pnpm db:up`). Sem migration (nada persiste).
- Falha PRÉ-EXISTENTE, fora de escopo: `apps/web/src/pages/ProfilePage.test.tsx` (2 testes).
- Branch: `feat/escritorio-card-personagem` (criada, spec commitado).

---

### Task 1: Shared — BFS `findPath` + protocolo de chamada

**Files:**
- Modify: `packages/shared/src/office.ts` (adicionar `findPath` e estender os dois tipos de mensagem)
- Create: `packages/shared/src/office-pathfinding.test.ts`

**Interfaces:**
- Consumes: `TilePosition`, `Direction`, `DIRECTION_DELTAS`, `isWalkable`, `OFFICE_WIDTH`, `OFFICE_HEIGHT` (já em office.ts).
- Produces: `findPath(from: TilePosition, to: TilePosition): Direction[] | null`; `OfficeClientMessage` ganha `{type:'call'; targetUserId}` e `{type:'call-response'; callerId; accepted}`; `OfficeServerMessage` ganha `{type:'incoming-call'; from:{userId;name}}`, `{type:'call-result'; targetUserId; accepted}`, `{type:'call-failed'; targetUserId; reason:'offline'|'rate-limited'}`.

- [ ] **Step 1: Escrever o teste falhando**

`packages/shared/src/office-pathfinding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findPath, isWalkable, DIRECTION_DELTAS, type TilePosition } from './index'

/** Aplica um caminho e devolve a posição final. */
function walk(from: TilePosition, path: readonly ('up' | 'down' | 'left' | 'right')[]): TilePosition {
  let { x, y } = from
  for (const dir of path) {
    x += DIRECTION_DELTAS[dir].x
    y += DIRECTION_DELTAS[dir].y
  }
  return { x, y }
}

function isAdjacent(a: TilePosition, b: TilePosition): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1
}

describe('findPath', () => {
  it('caminho reto no chão aberto, terminando ADJACENTE ao alvo', () => {
    const from = { x: 3, y: 4 }
    const to = { x: 8, y: 4 }
    const path = findPath(from, to)
    expect(path).not.toBeNull()
    // cada passo cai num tile andável
    let cur = { ...from }
    for (const dir of path!) {
      cur = walk(cur, [dir])
      expect(isWalkable(cur.x, cur.y)).toBe(true)
    }
    // parou adjacente ao alvo, não em cima
    expect(cur).not.toEqual(to)
    expect(isAdjacent(cur, to)).toBe(true)
  })

  it('devolve [] quando já está adjacente ao alvo', () => {
    expect(findPath({ x: 3, y: 4 }, { x: 4, y: 4 })).toEqual([])
  })

  it('contorna as mesas (bloco D em 2..5 nas linhas 2-3) em vez de atravessar', () => {
    // de cima da mesa para baixo dela: precisa desviar, nunca pisa num D
    const from = { x: 3, y: 1 }
    const to = { x: 3, y: 5 }
    const path = findPath(from, to)
    expect(path).not.toBeNull()
    let cur = { ...from }
    for (const dir of path!) {
      cur = walk(cur, [dir])
      expect(isWalkable(cur.x, cur.y)).toBe(true) // nunca pisa numa mesa
    }
    expect(isAdjacent(cur, to)).toBe(true)
  })

  it('atravessa a porta (16,15) para chegar na sala de reunião 2', () => {
    const from = { x: 12, y: 15 } // spawn, espaço aberto
    const to = { x: 20, y: 15 }   // dentro da sala de reunião 2
    const path = findPath(from, to)
    expect(path).not.toBeNull()
    let cur = { ...from }
    const visited = [{ ...cur }]
    for (const dir of path!) {
      cur = walk(cur, [dir])
      expect(isWalkable(cur.x, cur.y)).toBe(true)
      visited.push({ ...cur })
    }
    // o único vão na parede da coluna 16 nessa faixa é a porta (16,15)
    expect(visited).toContainEqual({ x: 16, y: 15 })
    expect(isAdjacent(cur, to)).toBe(true)
  })

  it('devolve null quando o alvo é cercado por parede (sem vizinho andável)', () => {
    // (0,0) é canto de parede: todos os vizinhos são parede/borda
    expect(findPath({ x: 5, y: 5 }, { x: 0, y: 0 })).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared test office-pathfinding`
Expected: FAIL — `findPath` não existe.

- [ ] **Step 3: Implementar `findPath`**

Em `packages/shared/src/office.ts`, adicionar após `DIRECTION_DELTAS`:

```ts
/**
 * BFS no grid do escritório: menor caminho de `from` até um tile ANDÁVEL
 * ADJACENTE a `to` (nunca em cima do alvo — pessoas se atravessam, mas parar
 * sobre alguém é estranho). Custo uniforme, mapa 25×18 — BFS basta, A* não paga.
 *
 * Retorno: lista de direções (`[]` se `from` já é adjacente a `to`), ou `null`
 * se nenhum tile adjacente andável é alcançável.
 *
 * O alvo em si NÃO precisa ser andável (pode-se "chamar" alguém parado numa
 * borda), e os OUTROS ocupantes não são obstáculo (o hub não bloqueia
 * sobreposição) — o BFS considera só o cenário (`isWalkable`).
 */
export function findPath(from: TilePosition, to: TilePosition): Direction[] | null {
  const isGoal = (x: number, y: number) =>
    Math.abs(x - to.x) + Math.abs(y - to.y) === 1 && isWalkable(x, y)

  if (isGoal(from.x, from.y)) return []
  if (!isWalkable(from.x, from.y)) return null

  const key = (x: number, y: number) => y * OFFICE_WIDTH + x
  const visited = new Set<number>([key(from.x, from.y)])
  const queue: { x: number; y: number; path: Direction[] }[] = [
    { x: from.x, y: from.y, path: [] },
  ]

  while (queue.length > 0) {
    const node = queue.shift() as { x: number; y: number; path: Direction[] }
    for (const dir of DIRECTIONS) {
      const nx = node.x + DIRECTION_DELTAS[dir].x
      const ny = node.y + DIRECTION_DELTAS[dir].y
      if (!isWalkable(nx, ny) || visited.has(key(nx, ny))) continue
      const path = [...node.path, dir]
      if (isGoal(nx, ny)) return path
      visited.add(key(nx, ny))
      queue.push({ x: nx, y: ny, path })
    }
  }
  return null
}
```

- [ ] **Step 4: Estender o protocolo de mensagens**

No mesmo arquivo, substituir as definições de `OfficeClientMessage` e `OfficeServerMessage`:

```ts
export type OfficeClientMessage =
  | { type: "move"; dir: Direction }
  | { type: "call"; targetUserId: string }
  | { type: "call-response"; callerId: string; accepted: boolean };

export type OfficeServerMessage =
  | { type: "welcome"; youId: string; occupants: OfficeOccupant[] }
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
  | { type: "call-failed"; targetUserId: string; reason: "offline" | "rate-limited" };
```

- [ ] **Step 5: Rodar e ver passar (shared inteiro, o protocolo mudou)**

```bash
pnpm --filter @legends/shared test
pnpm --filter @legends/shared exec tsc --noEmit
```
Expected: PASS; tsc limpo.

- [ ] **Step 6: Confirmar que a API ainda compila (o tipo mudou sob o hub/rota)**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: limpo (os cases novos só serão tratados nas tasks 2–3; `switch` sem eles ainda compila).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/office.ts packages/shared/src/office-pathfinding.test.ts
git commit -m "feat(shared): BFS findPath e protocolo de chamada do escritório"
```

---

### Task 2: API hub — `sendToUser`, `call`, `callResponse` + bucket de chamada

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts`
- Modify: `apps/api/src/lib/office-hub.test.ts` (casos novos; os existentes não mudam)

**Interfaces:**
- Consumes: tipos de `@legends/shared` (nada novo além dos da task 1).
- Produces em `OfficeHub`: `sendToUser(userId: string, message: OfficeServerMessage): boolean` (false se offline); `call(callerSocket: OfficeSocket, callerId: string, targetUserId: string): void`; `callResponse(socket: OfficeSocket, responderId: string, callerId: string, accepted: boolean): void`.

- [ ] **Step 1: Escrever os testes falhando**

Adicionar a `apps/api/src/lib/office-hub.test.ts` (o helper `fakeSocket` e os fixtures `ana`/`bruno` já existem):

```ts
import { CALL_COOLDOWN_MS } from './office-hub'

const carol = { id: 'carol', name: 'Carol', avatarOptions: null }

describe('sendToUser', () => {
  it('entrega a mensagem a TODAS as abas do usuário e retorna true', () => {
    const tab1 = fakeSocket()
    const tab2 = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(tab2.socket, ana)

    const ok = hub.sendToUser('ana', { type: 'left', userId: 'x' })
    expect(ok).toBe(true)
    expect(tab1.sent).toContainEqual({ type: 'left', userId: 'x' })
    expect(tab2.sent).toContainEqual({ type: 'left', userId: 'x' })
  })

  it('retorna false quando o usuário não está no escritório', () => {
    expect(hub.sendToUser('ninguem', { type: 'left', userId: 'x' })).toBe(false)
  })
})

describe('call', () => {
  it('entrega incoming-call (com nome do chamador) a todas as abas do alvo', () => {
    const a = fakeSocket()
    const bTab1 = fakeSocket()
    const bTab2 = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(bTab1.socket, bruno)
    hub.join(bTab2.socket, bruno)

    hub.call(a.socket, 'ana', 'bruno')

    const expected = { type: 'incoming-call', from: { userId: 'ana', name: 'Ana' } }
    expect(bTab1.sent).toContainEqual(expected)
    expect(bTab2.sent).toContainEqual(expected)
    // o chamador não recebe incoming-call
    expect(a.sent.some((m) => m.type === 'incoming-call')).toBe(false)
  })

  it('alvo offline → call-failed offline para o chamador', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.call(a.socket, 'ana', 'fantasma')
    expect(a.sent).toContainEqual({ type: 'call-failed', targetUserId: 'fantasma', reason: 'offline' })
  })

  it('spam de chamadas → call-failed rate-limited (1 a cada 3s)', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      const b = fakeSocket()
      const c = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)
      hub.join(c.socket, carol)

      hub.call(a.socket, 'ana', 'bruno') // 1ª passa
      hub.call(a.socket, 'ana', 'carol') // 2ª imediata: barrada

      expect(b.sent.some((m) => m.type === 'incoming-call')).toBe(true)
      expect(c.sent.some((m) => m.type === 'incoming-call')).toBe(false)
      expect(a.sent).toContainEqual({ type: 'call-failed', targetUserId: 'carol', reason: 'rate-limited' })

      // depois do cooldown, passa de novo
      vi.advanceTimersByTime(CALL_COOLDOWN_MS + 10)
      hub.call(a.socket, 'ana', 'carol')
      expect(c.sent.some((m) => m.type === 'incoming-call')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignora call de socket cujo dono não bate com o callerId (anti-spoof)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    // socket da ana tentando chamar EM NOME do bruno
    hub.call(a.socket, 'bruno', 'ana')
    expect(a.sent.some((m) => m.type === 'incoming-call')).toBe(false)
  })
})

describe('callResponse', () => {
  it('entrega call-result só ao chamador', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.callResponse(b.socket, 'bruno', 'ana', true)
    expect(a.sent).toContainEqual({ type: 'call-result', targetUserId: 'bruno', accepted: true })
    // o próprio respondente não recebe call-result
    expect(b.sent.some((m) => m.type === 'call-result')).toBe(false)
  })

  it('chamador saiu no meio → descarta sem erro', () => {
    const b = fakeSocket()
    hub.join(b.socket, bruno)
    expect(() => hub.callResponse(b.socket, 'bruno', 'ana', false)).not.toThrow()
  })

  it('ignora resposta de socket cujo dono não bate com o responderId', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    // socket da ana respondendo em nome do bruno
    hub.callResponse(a.socket, 'bruno', 'ana', true)
    expect(a.sent.some((m) => m.type === 'call-result')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api test src/lib/office-hub.test.ts`
Expected: FAIL — métodos e `CALL_COOLDOWN_MS` não existem.

- [ ] **Step 3: Implementar no hub**

Em `apps/api/src/lib/office-hub.ts`:

1. adicionar ao import de `@legends/shared` o tipo `OfficeClientMessage` **não** é necessário; garantir que `OfficeServerMessage` já está importado (está);
2. após a constante `BURST`, adicionar:

```ts
/** Intervalo mínimo entre chamadas iniciadas pelo mesmo usuário (anti-spam). */
export const CALL_COOLDOWN_MS = 3000
```

3. adicionar o campo de estado junto dos outros (`private buckets`, `private socketOwner`):

```ts
  /** Último instante (ms) em que cada usuário iniciou uma chamada. */
  private lastCallAt = new Map<string, number>()
```

4. limpar esse mapa no `reset()` (adicionar `this.lastCallAt.clear()`), e no `leave()` quando a última aba fecha (adicionar `this.lastCallAt.delete(userId)` junto de `this.buckets.delete(userId)`);

5. adicionar os três métodos públicos (depois de `occupantOf`):

```ts
  /** Envia uma mensagem a todas as abas de um usuário. false se ele não está no escritório. */
  sendToUser(userId: string, message: OfficeServerMessage): boolean {
    const entry = this.entries.get(userId)
    if (!entry) return false
    const payload = JSON.stringify(message)
    for (const socket of entry.sockets) {
      try {
        socket.send(payload)
      } catch {
        // socket morto: o close handler da rota limpa
      }
    }
    return true
  }

  /**
   * Um usuário chama outro. Relay puro: o hub não guarda estado de chamada,
   * só retransmite. Anti-spoof (o socket tem que ser dono do callerId),
   * anti-spam (CALL_COOLDOWN_MS) e feedback de offline.
   */
  call(callerSocket: OfficeSocket, callerId: string, targetUserId: string): void {
    if (this.socketOwner.get(callerSocket) !== callerId) return
    const caller = this.entries.get(callerId)
    if (!caller) return

    const now = Date.now()
    const last = this.lastCallAt.get(callerId) ?? 0
    if (now - last < CALL_COOLDOWN_MS) {
      this.sendToUser(callerId, { type: 'call-failed', targetUserId, reason: 'rate-limited' })
      return
    }

    if (!this.entries.has(targetUserId)) {
      this.sendToUser(callerId, { type: 'call-failed', targetUserId, reason: 'offline' })
      return
    }

    this.lastCallAt.set(callerId, now)
    this.sendToUser(targetUserId, {
      type: 'incoming-call',
      from: { userId: callerId, name: caller.occupant.name },
    })
  }

  /** O alvo respondeu; encaminha o resultado só ao chamador (se ainda presente). */
  callResponse(socket: OfficeSocket, responderId: string, callerId: string, accepted: boolean): void {
    if (this.socketOwner.get(socket) !== responderId) return
    this.sendToUser(callerId, { type: 'call-result', targetUserId: responderId, accepted })
  }
```

- [ ] **Step 4: Rodar e ver passar (arquivo inteiro — os testes antigos não mudam)**

Run: `pnpm --filter @legends/api test src/lib/office-hub.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): relay de chamada no hub (sendToUser, call, callResponse)"
```

---

### Task 3: API ws route — cases de chamada

**Files:**
- Modify: `apps/api/src/routes/office-ws.ts`
- Modify: `apps/api/src/routes/office-ws.test.ts` (integração; os existentes não mudam)

**Interfaces:**
- Consumes: `officeHub.call`, `officeHub.callResponse` (task 2).
- Produces: o `switch` de mensagens trata `call` e `call-response`; malformadas continuam ignoradas sem derrubar o socket.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `apps/api/src/routes/office-ws.test.ts`:

```ts
it('chamada: alvo recebe incoming-call e o chamador recebe call-result', async () => {
  const app = buildApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as { port: number }).port

  const ana = await prisma.user.create({
    data: { name: 'Ana', email: 'ana-call@x.com', passwordHash: 'x', role: 'LEGEND' },
  })
  const bruno = await prisma.user.create({
    data: { name: 'Bruno', email: 'bruno-call@x.com', passwordHash: 'x', role: 'LEGEND' },
  })
  const anaTk = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
  const brunoTk = app.jwt.sign({ sub: bruno.id, role: 'LEGEND' })

  const anaWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${anaTk}`)
  const anaMsgs: OfficeServerMessage[] = []
  anaWs.on('message', (d) => anaMsgs.push(JSON.parse(d.toString())))
  await waitOpen(anaWs)

  const brunoWs = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${brunoTk}`)
  const brunoMsgs: OfficeServerMessage[] = []
  brunoWs.on('message', (d) => brunoMsgs.push(JSON.parse(d.toString())))
  await waitOpen(brunoWs)
  await delay(100)

  anaWs.send(JSON.stringify({ type: 'call', targetUserId: bruno.id }))
  await delay(100)
  expect(brunoMsgs.some((m) => m.type === 'incoming-call' && m.from.userId === ana.id)).toBe(true)

  brunoWs.send(JSON.stringify({ type: 'call-response', callerId: ana.id, accepted: true }))
  await delay(100)
  expect(anaMsgs.some((m) => m.type === 'call-result' && m.targetUserId === bruno.id && m.accepted === true)).toBe(true)

  anaWs.close()
  brunoWs.close()
  await app.close()
})

it('mensagem de chamada malformada não derruba a conexão', async () => {
  const app = buildApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as { port: number }).port

  const ana = await prisma.user.create({
    data: { name: 'Ana', email: 'ana-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
  })
  const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
  const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
  await waitOpen(ws)

  ws.send(JSON.stringify({ type: 'call' })) // sem targetUserId
  ws.send(JSON.stringify({ type: 'call-response', callerId: 42 })) // shape errado
  await delay(120)

  expect(ws.readyState).toBe(WebSocket.OPEN)
  ws.close()
  await app.close()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test src/routes/office-ws.test.ts`
Expected: FAIL — `incoming-call` nunca chega (os cases não existem).

- [ ] **Step 3: Implementar os cases**

Em `apps/api/src/routes/office-ws.ts`, dentro do `ws.on('message', ...)`, substituir o bloco do `if (msg.type === 'move' ...)` por um switch que trata os três tipos (validação de shape à mão, padrão do arquivo):

```ts
        if (msg.type === 'move' && isDirection(msg.dir)) {
          officeHub.move(ws, user.id, msg.dir)
        } else if (msg.type === 'call' && typeof msg.targetUserId === 'string') {
          officeHub.call(ws, user.id, msg.targetUserId)
        } else if (
          msg.type === 'call-response' &&
          typeof msg.callerId === 'string' &&
          typeof msg.accepted === 'boolean'
        ) {
          officeHub.callResponse(ws, user.id, msg.callerId, msg.accepted)
        }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api test src/routes/office-ws.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/office-ws.ts apps/api/src/routes/office-ws.test.ts
git commit -m "feat(api): cases de chamada no websocket do escritório"
```

---

### Task 4: Web bridge — clique, canal genérico, cena interativa

**Files:**
- Modify: `apps/web/src/office/OfficeBridge.ts`
- Modify: `apps/web/src/office/OfficeBridge.test.ts` (casos novos)
- Modify: `apps/web/src/office/useOfficeSocket.ts` (enviar `onClientMessage`)
- Modify: `apps/web/src/office/useOfficeSocket.test.ts` (1 caso novo)
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (container clicável)

**Interfaces:**
- Consumes: `OfficeClientMessage` de `@legends/shared`; `bridge.snapshot()` (já existe).
- Produces no bridge: `onCharacterClick(handler: (userId: string) => void): () => void`, `emitCharacterClick(userId: string)`, `onClientMessage(handler: (msg: OfficeClientMessage) => void): () => void`, `emitClientMessage(msg: OfficeClientMessage)`. **`emitMoveIntent`/`onMoveIntent` permanecem** como o canal do TECLADO (usado para cancelar o follow); o `useOfficeSocket` envia tanto o move do teclado quanto o `onClientMessage`.

- [ ] **Step 1: Escrever os testes do bridge (falhando)**

Adicionar a `apps/web/src/office/OfficeBridge.test.ts`:

```ts
import type { OfficeClientMessage } from '@legends/shared'

describe('canal de clique', () => {
  it('emitCharacterClick chega aos handlers e o unsubscribe funciona', () => {
    const bridge = new OfficeBridge()
    const seen: string[] = []
    const off = bridge.onCharacterClick((id) => seen.push(id))
    bridge.emitCharacterClick('ana')
    off()
    bridge.emitCharacterClick('bruno')
    expect(seen).toEqual(['ana'])
  })
})

describe('canal genérico cliente→servidor', () => {
  it('emitClientMessage chega aos handlers; onMoveIntent NÃO dispara por ele', () => {
    const bridge = new OfficeBridge()
    const client: OfficeClientMessage[] = []
    const moves: string[] = []
    bridge.onClientMessage((m) => client.push(m))
    bridge.onMoveIntent((d) => moves.push(d))

    bridge.emitClientMessage({ type: 'call', targetUserId: 'x' })
    expect(client).toEqual([{ type: 'call', targetUserId: 'x' }])
    expect(moves).toEqual([]) // canal genérico não é o do teclado
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test src/office/OfficeBridge.test.ts`
Expected: FAIL — métodos não existem.

- [ ] **Step 3: Implementar no bridge**

Em `apps/web/src/office/OfficeBridge.ts`:

1. no import, trocar por: `import type { Direction, OfficeClientMessage, OfficeOccupant, OfficeServerMessage } from '@legends/shared'`;
2. adicionar os dois novos `Set` junto de `serverHandlers`/`moveHandlers`:

```ts
  private clickHandlers = new Set<Handler<string>>()
  private clientHandlers = new Set<Handler<OfficeClientMessage>>()
```

3. adicionar os quatro métodos (junto de `onMoveIntent`/`emitMoveIntent`):

```ts
  /** Cena → React: um personagem foi clicado (só o userId; o React resolve o resto). */
  onCharacterClick(handler: Handler<string>): () => void {
    this.clickHandlers.add(handler)
    return () => this.clickHandlers.delete(handler)
  }

  emitCharacterClick(userId: string): void {
    for (const handler of this.clickHandlers) handler(userId)
  }

  /**
   * Canal genérico React → servidor (call, call-response, e os moves do
   * FollowController). Separado de `emitMoveIntent`, que é só o TECLADO —
   * assim o follow pode ser cancelado ao ouvir `onMoveIntent` sem se
   * autocancelar com os próprios passos.
   */
  onClientMessage(handler: Handler<OfficeClientMessage>): () => void {
    this.clientHandlers.add(handler)
    return () => this.clientHandlers.delete(handler)
  }

  emitClientMessage(message: OfficeClientMessage): void {
    for (const handler of this.clientHandlers) handler(message)
  }
```

- [ ] **Step 4: Rodar e ver passar (bridge)**

Run: `pnpm --filter @legends/web test src/office/OfficeBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: `useOfficeSocket` envia o canal genérico (teste primeiro)**

Adicionar a `apps/web/src/office/useOfficeSocket.test.ts` um caso que prova que `emitClientMessage` é enviado pelo WS (o teste do arquivo já usa um `WebSocket` fake — reusar o mesmo padrão do move):

```ts
  it('envia pelo WS o que for emitido em emitClientMessage', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    ws.onopen?.()

    bridge.emitClientMessage({ type: 'call', targetUserId: 'bruno' })
    expect(ws.sent).toContainEqual(JSON.stringify({ type: 'call', targetUserId: 'bruno' }))
  })
```

(Se os nomes do fake diferirem no arquivo, ajuste para o padrão já usado no teste do `move`.)

Rodar e ver FALHAR. Implementar em `apps/web/src/office/useOfficeSocket.ts`: dentro do `useEffect`, junto do `unsubscribeMove`, adicionar uma inscrição no canal genérico e desinscrever no cleanup:

```ts
    const unsubscribeClient = bridge.onClientMessage((message) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    })
```

e no `return () => { ... }` do efeito, adicionar `unsubscribeClient()` junto de `unsubscribeMove()`.

Rodar e ver PASSAR (arquivo inteiro).

- [ ] **Step 6: Cena — container clicável**

Em `apps/web/src/office/scenes/OfficeScene.ts`, no método `spawn()`, logo após `const container = this.add.container(...)` e antes de `container.setDepth(...)`, inserir:

```ts
    // Torna o personagem clicável. Container não tem tamanho implícito: a hit
    // area é um retângulo em coordenadas LOCAIS cobrindo cabeça (y -19..-1) e
    // corpo (y -6..14). O clique só emite o userId — a UI vive no React.
    const userId = occupant.userId
    container.setInteractive(
      new Phaser.Geom.Rectangle(-9, -19, 18, 34),
      Phaser.Geom.Rectangle.Contains,
    )
    container.input!.cursor = 'pointer'
    container.on('pointerdown', () => this.bridge.emitCharacterClick(userId))
```

Sem teste unitário (Phaser precisa de WebGL — jsdom não tem; coberto pela verificação manual, como as demais mudanças de cena). O respawn do `welcome` já recria o `spawn()`, então o interactive volta; o `destroyCharacter` remove o container (e o input junto).

- [ ] **Step 7: Verificar build e typecheck**

```bash
pnpm --filter @legends/web exec tsc -p tsconfig.json --noEmit
pnpm --filter @legends/web build
```
Expected: limpo.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/office/OfficeBridge.ts apps/web/src/office/OfficeBridge.test.ts apps/web/src/office/useOfficeSocket.ts apps/web/src/office/useOfficeSocket.test.ts apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(web): clique no personagem e canal genérico de mensagens no bridge"
```

---

### Task 5: Web — `FollowController` (classe pura)

O orquestrador do "seguir/aceitar": calcula o BFS e emite um passo por vez, confirmando cada um pelo `moved`. Classe pura, sem Phaser nem React, com relógio injetável — é a peça com mais estados.

**Files:**
- Create: `apps/web/src/office/FollowController.ts`
- Create: `apps/web/src/office/FollowController.test.ts`

**Interfaces:**
- Consumes: `findPath`, `OFFICE`/`TilePosition`, `Direction`, `DIRECTION_DELTAS` de `@legends/shared`.
- Produces: `class FollowController` com construtor `({ emitMove, onArrived, onFailed, now, setTimer, clearTimer, stepTimeoutMs? })`; métodos `start(self: TilePosition, target: TilePosition): void`, `onMoved(userId, x, y, dir): void`, `onSync(x, y): void`, `onTargetLeft(userId): void`, `cancel(): void`, `isActive(): boolean`. O consumidor informa **quem é você** e **quem é o alvo** guardando os userIds fora ou passando-os — ver assinatura abaixo.

- [ ] **Step 1: Escrever os testes falhando**

`apps/web/src/office/FollowController.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { Direction, TilePosition } from '@legends/shared'
import { FollowController } from './FollowController'

/** Relógio + timer controláveis para dirigir a máquina passo a passo. */
function harness() {
  const emitted: Direction[] = []
  let arrived: Direction | null | undefined
  let failed = false
  let pendingTimer: (() => void) | null = null
  const ctl = new FollowController({
    emitMove: (dir) => emitted.push(dir),
    onArrived: (facing) => { arrived = facing },
    onFailed: () => { failed = true },
    setTimer: (cb) => { pendingTimer = cb; return 1 },
    clearTimer: () => { pendingTimer = null },
    stepTimeoutMs: 500,
  })
  return {
    ctl,
    emitted,
    get arrived() { return arrived },
    get failed() { return failed },
    fireTimeout() { const cb = pendingTimer; pendingTimer = null; cb?.() },
    hasTimer() { return pendingTimer !== null },
  }
}

const YOU = 'you'
const TARGET = 'alvo'

describe('FollowController', () => {
  it('emite o primeiro passo ao iniciar e NÃO o segundo até o moved confirmar', () => {
    const h = harness()
    // você em (3,4), alvo em (8,4): caminho para a direita, parada adjacente (7,4)
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    expect(h.emitted).toEqual(['right'])

    // moved de OUTRO usuário não avança
    h.ctl.onMoved('outro', 4, 4, 'right')
    expect(h.emitted).toEqual(['right'])

    // moved do próprio, confirmando (4,4), libera o próximo passo
    h.ctl.onMoved(YOU, 4, 4, 'right')
    expect(h.emitted).toEqual(['right', 'right'])
  })

  it('chega adjacente ao alvo, encara-o e chama onArrived', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 6, y: 4 }, { x: 8, y: 4 })
    // um passo: de (6,4) para (7,4), que já é adjacente a (8,4)
    expect(h.emitted).toEqual(['right'])
    h.ctl.onMoved(YOU, 7, 4, 'right')
    expect(h.ctl.isActive()).toBe(false)
    expect(h.arrived).toBe('right') // encara o alvo à direita
  })

  it('já começa adjacente → não anda, encara e conclui', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 7, y: 4 }, { x: 8, y: 4 })
    expect(h.emitted).toEqual([])
    expect(h.ctl.isActive()).toBe(false)
    expect(h.arrived).toBe('right')
  })

  it('sync (parede) re-ancora e recalcula o caminho do ponto real', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    expect(h.emitted).toEqual(['right'])
    // servidor recusou: continua em (3,4). Recalcula e reemite a partir dali.
    h.ctl.onSync(3, 4)
    expect(h.emitted).toEqual(['right', 'right'])
  })

  it('timeout sem moved reenvia o passo (drop silencioso do rate limit)', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    expect(h.emitted).toEqual(['right'])
    expect(h.hasTimer()).toBe(true)
    h.fireTimeout() // nada chegou em 500ms
    expect(h.emitted).toEqual(['right', 'right'])
  })

  it('alvo se moveu → recalcula o caminho a partir da posição atual do seguidor', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    h.ctl.onMoved(YOU, 4, 4, 'right') // você avançou
    expect(h.emitted).toEqual(['right', 'right'])
    // o ALVO andou para cima; o destino muda
    h.ctl.onMoved(TARGET, 8, 3, 'up')
    // próximo moved seu segue o caminho recalculado (ainda para a direita/cima)
    h.ctl.onMoved(YOU, 5, 4, 'right')
    expect(h.emitted.length).toBeGreaterThan(2)
    expect(h.ctl.isActive()).toBe(true)
  })

  it('alvo saiu do escritório → falha e encerra', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    h.ctl.onTargetLeft(TARGET)
    expect(h.failed).toBe(true)
    expect(h.ctl.isActive()).toBe(false)
  })

  it('cancel encerra e limpa o timer', () => {
    const h = harness()
    h.ctl.start({ selfId: YOU, targetId: TARGET }, { x: 3, y: 4 }, { x: 8, y: 4 })
    expect(h.hasTimer()).toBe(true)
    h.ctl.cancel()
    expect(h.ctl.isActive()).toBe(false)
    expect(h.hasTimer()).toBe(false)
    // eventos após cancel são ignorados
    h.ctl.onMoved(YOU, 4, 4, 'right')
    expect(h.emitted).toEqual(['right'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test src/office/FollowController.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`apps/web/src/office/FollowController.ts`:

```ts
import { findPath, DIRECTION_DELTAS, type Direction, type TilePosition } from '@legends/shared'

export interface FollowOptions {
  /** Envia um passo ao servidor (via bridge.emitClientMessage move). */
  emitMove: (dir: Direction) => void
  /** Chegou adjacente ao alvo; `facing` é a direção para encará-lo. */
  onArrived: (facing: Direction) => void
  /** Não foi possível concluir (alvo saiu, sem caminho). */
  onFailed: (reason: 'target-left' | 'no-path') => void
  setTimer: (cb: () => void, ms: number) => number
  clearTimer: (id: number) => void
  /** Tempo sem `moved` até reenviar o passo. O rate limit descarta em silêncio. */
  stepTimeoutMs?: number
}

interface Ids {
  selfId: string
  targetId: string
}

/**
 * Orquestra a caminhada automática até outro personagem. Servidor-autoritativo:
 * emite UM passo, espera o `moved` do próprio confirmar a posição esperada, e
 * só então avança. `sync` (parede) ou timeout (drop silencioso do rate limit)
 * → recalcula/reenvia. Alvo que anda → recalcula. Classe pura: relógio e timer
 * são injetados, sem Phaser nem React.
 */
export class FollowController {
  private ids: Ids | null = null
  private self: TilePosition = { x: 0, y: 0 }
  private target: TilePosition = { x: 0, y: 0 }
  private path: Direction[] = []
  private index = 0
  private timer: number | null = null
  private readonly stepTimeoutMs: number

  constructor(private readonly opts: FollowOptions) {
    this.stepTimeoutMs = opts.stepTimeoutMs ?? 500
  }

  isActive(): boolean {
    return this.ids !== null
  }

  start(ids: Ids, self: TilePosition, target: TilePosition): void {
    this.ids = ids
    this.self = { ...self }
    this.target = { ...target }
    this.recalculateAndStep()
  }

  /** Recebe TODOS os `moved`; filtra pelo self e pelo target internamente. */
  onMoved(userId: string, x: number, y: number, _dir: Direction): void {
    if (!this.ids) return
    if (userId === this.ids.selfId) {
      // Só avança o índice se este `moved` confirma EXATAMENTE o passo esperado.
      // O alvo pode andar (disparando recalculateAndStep) enquanto o nosso
      // próprio passo ainda não foi confirmado; quando a confirmação atrasada
      // chega, o `path`/`index` já são de outro caminho — indexar cegamente
      // introduz um erro de um tile. Se não bate (ou o caminho acabou),
      // recalcula da posição confirmada.
      const dir = this.path[this.index]
      const expected = dir
        ? { x: this.self.x + DIRECTION_DELTAS[dir].x, y: this.self.y + DIRECTION_DELTAS[dir].y }
        : null
      this.self = { x, y }
      if (expected && expected.x === x && expected.y === y) {
        this.advance()
      } else {
        this.recalculateAndStep()
      }
    } else if (userId === this.ids.targetId) {
      this.target = { x, y }
      this.recalculateAndStep()
    }
  }

  onSync(x: number, y: number): void {
    if (!this.ids) return
    this.self = { x, y }
    this.recalculateAndStep()
  }

  onTargetLeft(userId: string): void {
    if (this.ids && userId === this.ids.targetId) {
      this.fail('target-left')
    }
  }

  cancel(): void {
    this.stopTimer()
    this.ids = null
    this.path = []
    this.index = 0
  }

  /** Avança um passo do caminho já calculado após um `moved` confirmar. */
  private advance(): void {
    this.stopTimer()
    this.index += 1
    if (this.index >= this.path.length) {
      // Caminho terminou: se estamos adjacentes, chegou; senão recalcula.
      if (this.adjacentToTarget()) return this.arrive()
      return this.recalculateAndStep()
    }
    this.emitStep()
  }

  private recalculateAndStep(): void {
    this.stopTimer()
    if (!this.ids) return
    if (this.adjacentToTarget()) return this.arrive()
    const path = findPath(this.self, this.target)
    if (path === null) return this.fail('no-path')
    if (path.length === 0) return this.arrive()
    this.path = path
    this.index = 0
    this.emitStep()
  }

  private emitStep(): void {
    const dir = this.path[this.index]
    this.opts.emitMove(dir)
    this.timer = this.opts.setTimer(() => {
      // Nenhum `moved` chegou: rate limit descartou. Recalcula do ponto atual.
      this.recalculateAndStep()
    }, this.stepTimeoutMs)
  }

  private adjacentToTarget(): boolean {
    return Math.abs(this.self.x - this.target.x) + Math.abs(this.self.y - this.target.y) === 1
  }

  private arrive(): void {
    const facing = this.facingTarget()
    this.cancel()
    if (facing) this.opts.onArrived(facing)
  }

  private facingTarget(): Direction | null {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      if (this.self.x + DIRECTION_DELTAS[dir].x === this.target.x &&
          this.self.y + DIRECTION_DELTAS[dir].y === this.target.y) {
        return dir
      }
    }
    return null
  }

  private fail(reason: 'target-left' | 'no-path'): void {
    this.cancel()
    this.opts.onFailed(reason)
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.opts.clearTimer(this.timer)
      this.timer = null
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test src/office/FollowController.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/FollowController.ts apps/web/src/office/FollowController.test.ts
git commit -m "feat(web): FollowController — caminhada automática confirmada passo a passo"
```

---

### Task 6: Web — extrair `LegendCard` + helper de beep

**Files:**
- Create: `apps/web/src/components/LegendCard.tsx`
- Modify: `apps/web/src/pages/LegendsPage.tsx` (remove a definição local, importa o componente)
- Create: `apps/web/src/lib/beep.ts`
- Create: `apps/web/src/lib/beep.test.ts`

**Interfaces:**
- Consumes: `ShowcaseEntry` de `@legends/shared`; `Avatar`, `BadgeEmblem`, `Icon` (já existem).
- Produces: `LegendCard({ entry, linkTo }: { entry: ShowcaseEntry; linkTo?: string | null })` — `linkTo` string ⇒ o card inteiro é um `<Link>` para lá; `null` ⇒ um `<div>` (usado no overlay do escritório); ausente ⇒ default `/perfil/<id>?from=lendas`. `playCallBeep(): void` em `beep.ts`.

- [ ] **Step 1: Extrair o `LegendCard` para `components/`**

Criar `apps/web/src/components/LegendCard.tsx` com o componente movido de `LegendsPage.tsx` (linhas ~9–96), tornando o wrapper de link configurável:

```tsx
import { Link } from 'react-router-dom'
import type { ShowcaseEntry } from '@legends/shared'
import { Icon } from './Icon'
import { BadgeEmblem } from './BadgeEmblem'
import { Avatar } from './Avatar'

function formerSinceLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

const CARD_CLASS =
  'group flex flex-col items-center rounded-xl border border-outline-variant/30 bg-surface-container p-lg text-center transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10'

/**
 * Card de uma lenda (avatar, cargo, selos, reconhecimentos). Reusado na galeria
 * (/lendas) e no overlay do escritório.
 *
 * `linkTo`: string ⇒ o card inteiro navega para lá; `null` ⇒ não é link (o
 * overlay do escritório tem os próprios botões); ausente ⇒ perfil da pessoa.
 */
export function LegendCard({
  entry,
  linkTo,
}: {
  entry: ShowcaseEntry
  linkTo?: string | null
}) {
  const { user, recognitions, badges } = entry
  const topBadges = badges.slice(0, 3)
  const href = linkTo === undefined ? `/perfil/${user.id}?from=lendas` : linkTo

  const inner = (
    <>
      <div className="relative mb-md">
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-md transition-opacity group-hover:opacity-100" />
        <div className="relative z-10 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-primary bg-surface-container-highest">
          <Avatar
            user={user}
            initialsClassName="font-headline text-headline-md font-bold text-primary"
          />
        </div>
      </div>

      <h3 className="font-headline text-headline-md text-on-surface">{user.name}</h3>
      <span className="mt-xs rounded-full bg-primary/10 px-md py-xs font-label text-label-sm text-primary">
        {user.position ?? 'Desenvolvimento de Produto'}
      </span>

      {user.leftAt && (
        <span className="mt-xs inline-flex items-center gap-xs rounded-full bg-surface-container-highest px-md py-xs font-label text-label-sm text-on-surface-variant">
          <Icon name="workspace_premium" className="text-[14px]" />
          saiu em {formerSinceLabel(user.leftAt)}
        </span>
      )}

      <div className="my-md w-full border-t border-outline-variant/20" />

      <div className="mb-md w-full">
        <p className="mb-sm font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
          Principais conquistas
        </p>
        {topBadges.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Sem selos ainda.</p>
        ) : (
          <div className="flex justify-center gap-sm">
            {topBadges.map((awarded) => (
              <div key={awarded.id} className="transition-transform group-hover:scale-105">
                <BadgeEmblem badge={awarded.badge} size={40} />
              </div>
            ))}
            {badges.length > 3 && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-highest font-label text-label-sm text-on-surface-variant">
                +{badges.length - 3}
              </div>
            )}
          </div>
        )}
      </div>

      {recognitions > 0 && (
        <div className="flex items-center gap-xs text-on-surface-variant">
          <Icon name="verified" className="text-[18px]" />
          <span className="text-body-sm">
            {recognitions} {recognitions === 1 ? 'reconhecimento' : 'reconhecimentos'}
          </span>
        </div>
      )}
    </>
  )

  if (href === null) {
    return <div className={CARD_CLASS}>{inner}</div>
  }
  return (
    <Link to={href} className={CARD_CLASS}>
      {inner}
    </Link>
  )
}
```

- [ ] **Step 2: LegendsPage usa o componente extraído**

Em `apps/web/src/pages/LegendsPage.tsx`: remover a função local `LegendCard` **e** a função `formerSinceLabel` (agora vivem no componente), remover os imports que só ela usava (`Link`, `BadgeEmblem`, `Avatar` — manter os que a página ainda usa: `Icon`, `LegendsSkeleton`, `useQuery`, etc.), e adicionar `import { LegendCard } from '../components/LegendCard'`. O uso `<LegendCard key={...} entry={entry} />` continua igual (o default de `linkTo` mantém o link para /perfil).

- [ ] **Step 3: Rodar o teste da LegendsPage (não pode quebrar)**

Run: `pnpm --filter @legends/web test src/pages/LegendsPage.test.tsx`
Expected: PASS — o comportamento visível é idêntico.

- [ ] **Step 4: Teste do beep (falhando)**

`apps/web/src/lib/beep.test.ts` — jsdom não tem `AudioContext`, então mockamos o construtor e verificamos que um oscilador é criado e agendado, e que erro não vaza:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'

function installFakeAudio() {
  const osc = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { value: 0 } }
  const gain = { connect: vi.fn(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
  const ctx = {
    state: 'running' as const,
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    resume: vi.fn(() => Promise.resolve()),
  }
  vi.stubGlobal('AudioContext', vi.fn(() => ctx))
  return { ctx, osc, gain }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('playCallBeep', () => {
  it('cria e agenda um oscilador (som curto)', async () => {
    const fake = installFakeAudio()
    const { playCallBeep } = await import('./beep')
    playCallBeep()
    expect(fake.ctx.createOscillator).toHaveBeenCalled()
    expect(fake.osc.start).toHaveBeenCalled()
    expect(fake.osc.stop).toHaveBeenCalled()
  })

  it('não lança quando o navegador não tem AudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { playCallBeep } = await import('./beep')
    expect(() => playCallBeep()).not.toThrow()
  })
})
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test src/lib/beep.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 6: Implementar o beep**

`apps/web/src/lib/beep.ts`:

```ts
/**
 * Aviso sonoro de chamada — dois bipes curtos via Web Audio, sem asset binário
 * (coerente com o escritório, que gera tudo em runtime). AudioContext é um
 * singleton lazy: navegadores exigem um gesto do usuário antes de tocar, então
 * o contexto pode nascer "suspended" (F5 direto na página sem interação) —
 * nesse caso tentamos `resume()` e falhamos em silêncio se ainda bloqueado.
 */
let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
  if (!Ctor) return null
  if (!ctx) {
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  return ctx
}

export function playCallBeep(): void {
  const context = getContext()
  if (!context) return
  try {
    if (context.state === 'suspended') void context.resume()
    const now = context.currentTime
    // dois bipes curtos: 880 Hz e 1046 Hz
    for (const [i, freq] of [880, 1046].entries()) {
      const osc = context.createOscillator()
      const gain = context.createGain()
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(context.destination)
      const start = now + i * 0.18
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15)
      osc.start(start)
      osc.stop(start + 0.16)
    }
  } catch {
    // som é opcional: nunca deixar o áudio quebrar a chamada
  }
}
```

- [ ] **Step 7: Rodar e ver passar; suíte web inteira sem regressão**

```bash
pnpm --filter @legends/web test src/lib/beep.test.ts
pnpm --filter @legends/web test
```
Expected: beep PASS; suíte web só com as 2 falhas PRÉ-EXISTENTES do `ProfilePage.test.tsx`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/LegendCard.tsx apps/web/src/pages/LegendsPage.tsx apps/web/src/lib/beep.ts apps/web/src/lib/beep.test.ts
git commit -m "feat(web): extrai LegendCard reusável e helper de beep de chamada"
```

---

### Task 7: Web — card, popup, hook de interações e composição na página

Junta tudo: clique → card com 3 ações; chamar → popup + som no alvo, toast no chamador; seguir/aceitar → FollowController; ver perfil → nova aba.

**Files:**
- Create: `apps/web/src/office/CharacterCard.tsx`
- Create: `apps/web/src/office/IncomingCallPopup.tsx`
- Create: `apps/web/src/office/useOfficeInteractions.ts`
- Create: `apps/web/src/office/useOfficeInteractions.test.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `OfficeBridge` (métodos das tasks 4), `FollowController` (task 5), `LegendCard`, `playCallBeep` (task 6), `useOfficeSocket` (`occupants`, `youId`), `ShowcaseEntry`, `OfficeOccupant`, `apiFetch`, React Query.
- Produces: `useOfficeInteractions(bridge, occupants, youId): OfficeInteractionsState`, com `OfficeInteractionsState = { selected: OfficeOccupant | null; selectedEntry: ShowcaseEntry | null; incomingCall: { userId: string; name: string } | null; toast: string | null; openCard(userId): void; closeCard(): void; call(userId): void; follow(userId): void; viewProfile(userId): void; acceptCall(): void; refuseCall(): void }`. Componentes `CharacterCard({ occupant, entry, isSelf, onCall, onFollow, onViewProfile, onClose })` e `IncomingCallPopup({ name, onAccept, onRefuse })`.

- [ ] **Step 1: Teste do hook (falhando)**

`apps/web/src/office/useOfficeInteractions.test.tsx` — mocka `apiFetch` (showcase), `playCallBeep` e `window.open`; dirige o bridge e o relógio:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'

const beepMock = vi.fn()
vi.mock('../lib/beep', () => ({ playCallBeep: () => beepMock() }))

const apiFetchMock = vi.fn()
vi.mock('../lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }))

import { useOfficeInteractions } from './useOfficeInteractions'

function occ(userId: string, x = 5, y = 5): OfficeOccupant {
  return { userId, name: userId, x, y, dir: 'down', skinColor: 'edb98a', clothingColor: '8fa7df' }
}

const showcase = {
  entries: [
    { user: { id: 'bruno', name: 'Bruno', position: 'Dev', leftAt: null }, recognitions: 3, badges: [] },
  ],
}

beforeEach(() => {
  vi.useFakeTimers()
  beepMock.mockClear()
  apiFetchMock.mockReset().mockResolvedValue(showcase)
})
afterEach(() => vi.useRealTimers())

describe('useOfficeInteractions', () => {
  it('clique no personagem abre o card com a entry do showcase', async () => {
    const bridge = new OfficeBridge()
    const occupants = [occ('you', 3, 4), occ('bruno', 8, 4)]
    const { result } = renderHook(() => useOfficeInteractions(bridge, occupants, 'you'))

    act(() => bridge.emitCharacterClick('bruno'))
    await waitFor(() => expect(result.current.selected?.userId).toBe('bruno'))
    await waitFor(() => expect(result.current.selectedEntry?.user.name).toBe('Bruno'))
  })

  it('card do próprio usuário: sem entry problem, isSelf detectável por youId', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'))
    act(() => bridge.emitCharacterClick('you'))
    await waitFor(() => expect(result.current.selected?.userId).toBe('you'))
  })

  it('chamar envia a mensagem de call pelo canal do bridge', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you'), occ('bruno')], 'you'))
    act(() => result.current.call('bruno'))
    expect(sent).toContainEqual({ type: 'call', targetUserId: 'bruno' })
  })

  it('incoming-call abre o popup e toca o beep; aceitar responde accepted=true', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'))

    act(() => bridge.emitServerMessage({ type: 'incoming-call', from: { userId: 'ana', name: 'Ana' } }))
    await waitFor(() => expect(result.current.incomingCall?.name).toBe('Ana'))
    expect(beepMock).toHaveBeenCalled()

    act(() => result.current.acceptCall())
    expect(sent).toContainEqual({ type: 'call-response', callerId: 'ana', accepted: true })
    expect(result.current.incomingCall).toBeNull()
  })

  it('recusar responde accepted=false', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'))
    act(() => bridge.emitServerMessage({ type: 'incoming-call', from: { userId: 'ana', name: 'Ana' } }))
    await waitFor(() => expect(result.current.incomingCall).not.toBeNull())
    act(() => result.current.refuseCall())
    expect(sent).toContainEqual({ type: 'call-response', callerId: 'ana', accepted: false })
  })

  it('sem resposta em 30s → auto-recusa', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'))
    act(() => bridge.emitServerMessage({ type: 'incoming-call', from: { userId: 'ana', name: 'Ana' } }))
    act(() => vi.advanceTimersByTime(30_100))
    expect(sent).toContainEqual({ type: 'call-response', callerId: 'ana', accepted: false })
  })

  it('call-result vira toast no chamador', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you'), occ('bruno')], 'you'))
    act(() => bridge.emitServerMessage({ type: 'call-result', targetUserId: 'bruno', accepted: true }))
    await waitFor(() => expect(result.current.toast).toMatch(/aceitou/i))
  })

  it('call-failed offline vira toast', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you')], 'you'))
    act(() => bridge.emitServerMessage({ type: 'call-failed', targetUserId: 'x', reason: 'offline' }))
    await waitFor(() => expect(result.current.toast).toBeTruthy())
  })

  it('ver perfil abre nova aba com a URL do perfil', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeInteractions(bridge, [occ('you'), occ('bruno')], 'you'))
    act(() => result.current.viewProfile('bruno'))
    expect(openSpy).toHaveBeenCalledWith('/perfil/bruno', '_blank', 'noopener')
    openSpy.mockRestore()
  })

  it('tecla de movimento (onMoveIntent) cancela um follow em andamento', async () => {
    const bridge = new OfficeBridge()
    const sent: unknown[] = []
    bridge.onClientMessage((m) => sent.push(m))
    const { result } = renderHook(() =>
      useOfficeInteractions(bridge, [occ('you', 3, 4), occ('bruno', 8, 4)], 'you'),
    )
    act(() => result.current.follow('bruno'))
    const before = sent.length
    act(() => bridge.emitMoveIntent('up')) // humano assumiu
    // moved do follow depois do cancel não deve gerar novos passos
    act(() => bridge.emitServerMessage({ type: 'moved', userId: 'you', x: 4, y: 4, dir: 'right' }))
    expect(sent.length).toBe(before) // nenhum passo novo após o cancelamento
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test src/office/useOfficeInteractions.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o hook**

`apps/web/src/office/useOfficeInteractions.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { OfficeOccupant, ShowcaseEntry } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { playCallBeep } from '../lib/beep'
import type { OfficeBridge } from './OfficeBridge'
import { FollowController } from './FollowController'

const CALL_TIMEOUT_MS = 30_000

export interface OfficeInteractionsState {
  selected: OfficeOccupant | null
  selectedEntry: ShowcaseEntry | null
  incomingCall: { userId: string; name: string } | null
  toast: string | null
  openCard: (userId: string) => void
  closeCard: () => void
  call: (userId: string) => void
  follow: (userId: string) => void
  viewProfile: (userId: string) => void
  acceptCall: () => void
  refuseCall: () => void
}

export function useOfficeInteractions(
  bridge: OfficeBridge,
  occupants: OfficeOccupant[],
  youId: string | null,
): OfficeInteractionsState {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [incomingCall, setIncomingCall] = useState<{ userId: string; name: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Refs-espelho para os callbacks lerem o estado atual sem virar dependência.
  const occupantsRef = useRef(occupants)
  occupantsRef.current = occupants
  const youIdRef = useRef(youId)
  youIdRef.current = youId

  const { data: showcase } = useQuery({
    queryKey: ['showcase', 'ativas'],
    queryFn: () => apiFetch<{ entries: ShowcaseEntry[] }>('/users/showcase'),
    staleTime: 60_000,
  })

  const selected = useMemo(
    () => occupants.find((o) => o.userId === selectedId) ?? null,
    [occupants, selectedId],
  )
  const selectedEntry = useMemo(
    () => showcase?.entries.find((e) => e.user.id === selectedId) ?? null,
    [showcase, selectedId],
  )

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }, [])

  // --- Follow ---------------------------------------------------------------
  const followRef = useRef<FollowController | null>(null)
  if (followRef.current === null) {
    followRef.current = new FollowController({
      emitMove: (dir) => bridge.emitClientMessage({ type: 'move', dir }),
      onArrived: () => {},
      onFailed: (reason) => {
        if (reason === 'target-left') showToast('A pessoa saiu do escritório.')
        else showToast('Não foi possível chegar até a pessoa.')
      },
      setTimer: (cb, ms) => window.setTimeout(cb, ms),
      clearTimer: (id) => window.clearTimeout(id),
    })
  }
  const follow = useCallback(
    (userId: string) => {
      const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
      const target = occupantsRef.current.find((o) => o.userId === userId)
      if (!me || !target) return
      followRef.current!.start({ selfId: me.userId, targetId: userId }, me, target)
      setSelectedId(null)
    },
    [],
  )

  // --- Ações do card --------------------------------------------------------
  const openCard = useCallback((userId: string) => setSelectedId(userId), [])
  const closeCard = useCallback(() => setSelectedId(null), [])
  const call = useCallback(
    (userId: string) => {
      bridge.emitClientMessage({ type: 'call', targetUserId: userId })
      setSelectedId(null)
    },
    [bridge],
  )
  const viewProfile = useCallback((userId: string) => {
    window.open(`/perfil/${userId}`, '_blank', 'noopener')
    setSelectedId(null)
  }, [])

  // --- Chamada recebida -----------------------------------------------------
  const callerIdRef = useRef<string | null>(null)
  const respond = useCallback(
    (accepted: boolean) => {
      const callerId = callerIdRef.current
      if (!callerId) return
      bridge.emitClientMessage({ type: 'call-response', callerId, accepted })
      // Aceitar = ir até o chamador (reusa o follow).
      if (accepted) {
        const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
        const caller = occupantsRef.current.find((o) => o.userId === callerId)
        if (me && caller) followRef.current!.start({ selfId: me.userId, targetId: callerId }, me, caller)
      }
      callerIdRef.current = null
      setIncomingCall(null)
    },
    [bridge],
  )
  const acceptCall = useCallback(() => respond(true), [respond])
  const refuseCall = useCallback(() => respond(false), [respond])

  // Eventos do servidor + cancelamento do follow por teclado.
  useEffect(() => {
    const offMove = bridge.onMoveIntent(() => followRef.current?.cancel())
    const offClick = bridge.onCharacterClick((userId) => setSelectedId(userId))
    const offServer = bridge.onServerMessage((msg) => {
      const follow = followRef.current
      switch (msg.type) {
        case 'moved':
          follow?.onMoved(msg.userId, msg.x, msg.y, msg.dir)
          break
        case 'sync':
          follow?.onSync(msg.x, msg.y)
          break
        case 'left':
          follow?.onTargetLeft(msg.userId)
          break
        case 'incoming-call':
          callerIdRef.current = msg.from.userId
          setIncomingCall({ userId: msg.from.userId, name: msg.from.name })
          playCallBeep()
          break
        case 'call-result':
          showToast(
            msg.accepted
              ? 'A pessoa aceitou — está indo até você.'
              : 'A pessoa não pôde atender agora.',
          )
          break
        case 'call-failed':
          showToast(
            msg.reason === 'offline'
              ? 'A pessoa não está mais no escritório.'
              : 'Aguarde um momento antes de chamar de novo.',
          )
          break
      }
    })
    return () => {
      offMove()
      offClick()
      offServer()
    }
  }, [bridge, showToast])

  // Timeout de 30s do popup recebido → auto-recusa.
  useEffect(() => {
    if (!incomingCall) return
    const id = window.setTimeout(() => respond(false), CALL_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [incomingCall, respond])

  // Alvo do card saiu → fecha o card.
  useEffect(() => {
    if (selectedId && !occupants.some((o) => o.userId === selectedId)) setSelectedId(null)
  }, [occupants, selectedId])

  return {
    selected,
    selectedEntry,
    incomingCall,
    toast,
    openCard,
    closeCard,
    call,
    follow,
    viewProfile,
    acceptCall,
    refuseCall,
  }
}
```

- [ ] **Step 4: Rodar e ver passar (hook)**

Run: `pnpm --filter @legends/web test src/office/useOfficeInteractions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Componentes de UI (sem teste próprio — cobertos pela página)**

`apps/web/src/office/CharacterCard.tsx`:

```tsx
import type { OfficeOccupant, ShowcaseEntry } from '@legends/shared'
import { LegendCard } from '../components/LegendCard'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'

/**
 * Overlay ao clicar num personagem. Reusa o `LegendCard` (sem link — os botões
 * têm as ações) quando há dados de showcase; senão, cai num cabeçalho mínimo
 * (avatar de iniciais + nome), nunca quebra. `isSelf` esconde chamar/seguir.
 */
export function CharacterCard({
  occupant,
  entry,
  isSelf,
  onCall,
  onFollow,
  onViewProfile,
  onClose,
}: {
  occupant: OfficeOccupant
  entry: ShowcaseEntry | null
  isSelf: boolean
  onCall: () => void
  onFollow: () => void
  onViewProfile: () => void
  onClose: () => void
}) {
  const actionCls =
    'flex items-center justify-center gap-sm rounded-md px-md py-sm font-label text-label-md transition-colors'

  return (
    <div
      className="pointer-events-auto w-72 rounded-lg border border-outline-variant/40 bg-surface-container/95 p-md shadow-lg backdrop-blur"
      role="dialog"
      aria-label={`Ações para ${occupant.name}`}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="mb-md flex justify-end">
        <button type="button" aria-label="Fechar" onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
          <Icon name="close" className="text-[20px]" />
        </button>
      </div>

      {entry ? (
        <LegendCard entry={entry} linkTo={null} />
      ) : (
        <div className="flex flex-col items-center gap-sm p-md text-center">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-primary bg-surface-container-highest">
            <Avatar user={{ name: occupant.name }} initialsClassName="font-headline text-headline-md font-bold text-primary" />
          </div>
          <h3 className="font-headline text-headline-md text-on-surface">{occupant.name}</h3>
        </div>
      )}

      <div className="mt-md flex flex-col gap-sm">
        {!isSelf && (
          <>
            <button type="button" onClick={onCall} className={`${actionCls} bg-primary text-on-primary hover:bg-primary-container`}>
              <Icon name="call" className="text-[18px]" /> Chamar
            </button>
            <button type="button" onClick={onFollow} className={`${actionCls} bg-surface-container-highest text-on-surface hover:bg-surface-container-high`}>
              <Icon name="directions_walk" className="text-[18px]" /> Seguir
            </button>
          </>
        )}
        <button type="button" onClick={onViewProfile} className={`${actionCls} bg-surface-container-highest text-on-surface hover:bg-surface-container-high`}>
          <Icon name="account_circle" className="text-[18px]" /> Ver perfil
        </button>
      </div>
    </div>
  )
}
```

`apps/web/src/office/IncomingCallPopup.tsx`:

```tsx
import { Icon } from '../components/Icon'

/** Popup de chamada recebida. O beep é tocado pelo hook ao abrir. */
export function IncomingCallPopup({
  name,
  onAccept,
  onRefuse,
}: {
  name: string
  onAccept: () => void
  onRefuse: () => void
}) {
  return (
    <div
      role="alertdialog"
      aria-label={`Chamada de ${name}`}
      className="pointer-events-auto flex w-80 flex-col gap-md rounded-lg border border-primary/50 bg-surface-container/95 p-lg shadow-xl backdrop-blur"
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-sm">
        <Icon name="call" className="text-[24px] text-primary" />
        <p className="font-body text-body-md text-on-surface">
          <span className="font-bold">{name}</span> está te chamando
        </p>
      </div>
      <div className="flex gap-sm">
        <button type="button" onClick={onAccept} className="flex-1 rounded-md bg-primary py-sm font-label text-label-md text-on-primary hover:bg-primary-container">
          Aceitar
        </button>
        <button type="button" onClick={onRefuse} className="flex-1 rounded-md bg-surface-container-highest py-sm font-label text-label-md text-on-surface hover:bg-surface-container-high">
          Recusar
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Compor na OfficePage (com Esc/clique-fora do card)**

Em `apps/web/src/pages/OfficePage.tsx`:

1. imports novos:

```tsx
import { useOfficeInteractions } from '../office/useOfficeInteractions'
import { CharacterCard } from '../office/CharacterCard'
import { IncomingCallPopup } from '../office/IncomingCallPopup'
```

2. dentro do componente, após `const broadcast = ...`:

```tsx
  const interactions = useOfficeInteractions(bridge, occupants, youId)
```

3. no JSX, antes do fechamento da `</section>`, adicionar as três camadas de overlay (acima do banner do alto-falante, que é z-20):

```tsx
      {interactions.selected && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-lg"
          onClick={interactions.closeCard}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <CharacterCard
              occupant={interactions.selected}
              entry={interactions.selectedEntry}
              isSelf={interactions.selected.userId === youId}
              onCall={() => interactions.call(interactions.selected!.userId)}
              onFollow={() => interactions.follow(interactions.selected!.userId)}
              onViewProfile={() => interactions.viewProfile(interactions.selected!.userId)}
              onClose={interactions.closeCard}
            />
          </div>
        </div>
      )}

      {interactions.incomingCall && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2">
          <IncomingCallPopup
            name={interactions.incomingCall.name}
            onAccept={interactions.acceptCall}
            onRefuse={interactions.refuseCall}
          />
        </div>
      )}

      {interactions.toast && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur">
          {interactions.toast}
        </div>
      )}
```

4. fechar o card com Esc — adicionar um efeito no componente:

```tsx
  useEffect(() => {
    if (!interactions.selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') interactions.closeCard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interactions])
```

(importar `useEffect` de `react` se ainda não estiver importado).

- [ ] **Step 7: Atualizar o teste da página**

Em `apps/web/src/pages/OfficePage.test.tsx`, adicionar o mock do hook novo (mesmo estilo dos mocks existentes) para o teste atual não quebrar, e um caso mostrando o card:

```tsx
let interactionsMock: {
  selected: unknown
  selectedEntry: unknown
  incomingCall: { userId: string; name: string } | null
  toast: string | null
  openCard: () => void
  closeCard: () => void
  call: () => void
  follow: () => void
  viewProfile: () => void
  acceptCall: () => void
  refuseCall: () => void
}
vi.mock('../office/useOfficeInteractions', () => ({
  useOfficeInteractions: () => interactionsMock,
}))
```

No `beforeEach`, resetar `interactionsMock` para tudo vazio (`selected: null`, `incomingCall: null`, `toast: null`, funções `() => {}`). Caso novo:

```tsx
  it('mostra o popup de chamada recebida', () => {
    interactionsMock = { ...interactionsMock, incomingCall: { userId: 'ana', name: 'Ana' } }
    renderPage()
    expect(screen.getByRole('alertdialog', { name: /Ana/ })).toBeInTheDocument()
  })
```

(Se a `OfficePage.test.tsx` não tiver um helper `renderPage`, use o mesmo `render(...)` com providers dos testes existentes; garanta que o mock existente de `useOfficeSocket`/`useOfficeMedia`/`useOfficeBroadcast` continua.)

- [ ] **Step 8: Rodar tudo + build**

```bash
pnpm --filter @legends/web test
pnpm --filter @legends/api test
pnpm --filter @legends/shared test
pnpm build
```
Expected: verde exceto as 2 falhas PRÉ-EXISTENTES do `ProfilePage.test.tsx`; build limpo (`phaser-*.js` e `livekit-client` fora do chunk principal).

- [ ] **Step 9: Verificação manual (dois navegadores)**

```bash
pnpm db:up
# exportar LIVEKIT_* no shell (a API não lê .env) — ver ledger
env -u PORT pnpm dev
```
Com dois usuários do seed no `/escritorio`:
1. Clicar num personagem → card aparece com avatar/selos e os botões (no próprio, só "ver perfil").
2. **Chamar** → o outro navegador toca o beep e mostra o popup; Aceitar → o personagem do chamado caminha até o chamador (contornando paredes) e o chamador vê o toast "aceitou"; Recusar → toast "não pôde atender".
3. **Seguir** → seu personagem anda até parar adjacente à pessoa; apertar uma seta no meio cancela o follow.
4. **Ver perfil** → abre `/perfil/<id>` em nova aba, já autenticada.
5. Chamar duas vezes seguidas → segundo toast "aguarde um momento".

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/office/CharacterCard.tsx apps/web/src/office/IncomingCallPopup.tsx apps/web/src/office/useOfficeInteractions.ts apps/web/src/office/useOfficeInteractions.test.tsx apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(web): card de personagem com chamar, seguir e ver perfil"
```

---

## Depois do v1 (fora deste plano)

Chamada em grupo; estado "ocupado/não perturbe"; fechar o popup nas duas abas do chamado em sincronia (exige estado de chamada no servidor); seguir contínuo; som customizável.
