# Levantar a mão (sala de reunião) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dentro de uma sala de reunião do escritório virtual, permitir levantar a mão (fila FIFO por sala), ver um contador/lista no topo, ouvir um som e ter a mão abaixada automaticamente ao começar a falar.

**Architecture:** Fila FIFO mantida no `OfficeHub` (servidor), por `roomId`, entregue via `broadcastToRoom` — mesmo padrão do chat/sinais sonoros de sala já existentes. No cliente, um hook dedicado `useRaisedHands` (mesmo molde de `useRoomChat`) mantém o estado local da sala atual, toca o som e cuida do abaixar automático via a detecção de fala local (LiveKit) já usada pelo indicador visual de "falando". A UI é toda DOM (fora do Phaser): botão na `MediaBar` e um novo componente de contador/lista no topo da `OfficePage`.

**Tech Stack:** Fastify + WebSocket (API), React + Vite (web), Web Audio API (som sintetizado, sem asset binário), Vitest + Testing Library.

## Global Constraints

- Mensagens de servidor room-scoped só chegam a quem está fisicamente na mesma sala (`broadcastToRoom`) — nunca vazam para o escritório inteiro.
- Sem asset de áudio binário — todo som do escritório é sintetizado via Web Audio (`apps/web/src/lib/beep.ts`).
- Mensagens ao usuário em português; nomes de arquivo/símbolo em português quando o restante do arquivo já usa português (ex. `office-hub.ts`), em inglês quando o arquivo já é em inglês (ex. tipos TS).
- `pnpm db:up` precisa estar rodando antes de qualquer teste da API (`apps/api`).
- Sem indicador visual no personagem dentro do Phaser, sem papel de moderador, sem persistência entre reinícios do processo — fora de escopo (ver spec).

Spec de referência: `docs/superpowers/specs/2026-07-17-levantar-mao-sala-reuniao-design.md`.

---

### Task 1: Contrato compartilhado — mensagens `raise-hand` / `raised-hands`

**Files:**
- Modify: `packages/shared/src/office.ts:153-226`

**Interfaces:**
- Produces: `OfficeClientMessage` ganha a variante `{ type: "raise-hand"; active: boolean }`. `OfficeServerMessage` ganha a variante `{ type: "raised-hands"; roomId: string; queue: string[]; event?: { kind: "raised" | "lowered"; userId: string } }`. Todas as tasks seguintes (servidor e cliente) dependem exatamente desses dois shapes.

- [ ] **Step 1: Adicionar a mensagem cliente→servidor**

Em `packages/shared/src/office.ts`, dentro do `export type OfficeClientMessage = ...`, logo após a entrada de `confetti` (linha 160) e antes de `set-status`:

```ts
export type OfficeClientMessage =
  | { type: "move"; dir: Direction; sprint?: boolean }
  | { type: "call"; targetUserId: string }
  | { type: "call-response"; callerId: string; accepted: boolean }
  | { type: "nearby-message"; text: string; kind?: OfficeNearbyMessageKind }
  | { type: "room-chat-message"; text: string }
  /** Início/fim de "segurar F" — enviado no keydown/keyup físico (evento, não polling). */
  | { type: "confetti"; active: boolean }
  /** Levantar (true) ou abaixar (false) a própria mão — fila FIFO por sala de reunião. */
  | { type: "raise-hand"; active: boolean }
  /** Troca manual de status de presença, pelo menu do chip de identidade. */
  | { type: "set-status"; status: OfficeUserStatus };
```

- [ ] **Step 2: Adicionar a mensagem servidor→cliente**

Na mesma seção, dentro do `export type OfficeServerMessage = ...`, logo após a entrada de `confetti` (linha 211) e antes de `celebration`:

```ts
  /** Alguém começou/parou de lançar confete — rebroadcast pra todos, inclusive o remetente. */
  | { type: "confetti"; userId: string; active: boolean }
  /**
   * Fila de mãos levantadas da sala — só chega a quem está na MESMA sala (mais o
   * próprio ao sair andando, para zerar a fila do lado dele). `queue` é sempre o
   * snapshot completo, na ordem de quem levantou primeiro. `event` ausente = sync
   * (ex.: snapshot para quem acabou de entrar na sala) — não deve tocar som;
   * presente = mudança real (alguém levantou ou abaixou agora).
   */
  | { type: "raised-hands"; roomId: string; queue: string[]; event?: { kind: "raised" | "lowered"; userId: string } }
  /** Sinal (sem payload) pra todo mundo comemorar junto: banner + burst + som. */
  | { type: "celebration" }
```

- [ ] **Step 3: Verificar que o pacote compila**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros (o arquivo é consumido diretamente como fonte pelos outros workspaces — não há build próprio; este comando só confirma que o TS do arquivo em si é válido).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/office.ts
git commit -m "feat(shared): contrato de mensagens para levantar a mão em sala de reunião"
```

---

### Task 2: `OfficeHub` — fila de mãos levantadas por sala

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts`
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consumes: `OfficeClientMessage`/`OfficeServerMessage` de `@legends/shared` (Task 1). `roomForPosition(x,y)`, `broadcastToRoom(roomId, msg, exceptSocket?)`, `sendTo(socket, msg)`, `entries: Map<string, Entry>`, `socketOwner: Map<OfficeSocket, string>` já existentes na classe.
- Produces: `OfficeHub.raiseHand(socket: OfficeSocket, userId: string, active: boolean): void` — chamado pela rota WS (Task 3).

Rode `pnpm db:up` antes de rodar os testes desta task (banco real).

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/src/lib/office-hub.test.ts`, adicionar um novo `describe`, logo após o `describe('roomPresence', ...)` que termina na linha 810 (antes do fim do arquivo):

```ts
describe('raiseHand', () => {
  const raisedHands = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'raised-hands')
  const lastRaisedHands = (sent: OfficeServerMessage[]) =>
    raisedHands(sent).at(-1) as Extract<OfficeServerMessage, { type: 'raised-hands' }> | undefined

  it('levantar dentro da sala inclui na fila e avisa quem está na sala (inclusive o próprio)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', true)

    const expected = expect.objectContaining({
      type: 'raised-hands',
      roomId: ROOM1_ID,
      queue: ['ana'],
      event: { kind: 'raised', userId: 'ana' },
    })
    expect(raisedHands(a.sent)).toContainEqual(expected)
    expect(raisedHands(b.sent)).toContainEqual(expected)
  })

  it('levantar fora de sala de reunião é no-op', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana) // spawn fora de sala

    hub.raiseHand(a.socket, 'ana', true)

    expect(raisedHands(a.sent)).toHaveLength(0)
  })

  it('levantar duas vezes seguidas é no-op (já está na fila)', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', true)
    hub.raiseHand(a.socket, 'ana', true)

    expect(raisedHands(a.sent)).toHaveLength(1)
  })

  it('fila é FIFO — segunda pessoa entra no fim', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', true)
    hub.raiseHand(b.socket, 'bruno', true)

    expect(lastRaisedHands(b.sent)?.queue).toEqual(['ana', 'bruno'])
  })

  it('abaixar manualmente remove da fila e mantém a ordem dos demais', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)
    hub.raiseHand(b.socket, 'bruno', true)

    hub.raiseHand(a.socket, 'ana', false)

    expect(lastRaisedHands(b.sent)).toEqual(
      expect.objectContaining({
        type: 'raised-hands',
        roomId: ROOM1_ID,
        queue: ['bruno'],
        event: { kind: 'lowered', userId: 'ana' },
      }),
    )
  })

  it('abaixar sem estar na fila é no-op', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', false)

    expect(raisedHands(a.sent)).toHaveLength(0)
  })

  it('sair andando da sala abaixa a mão automaticamente e avisa o próprio e quem ficou', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    const expected = expect.objectContaining({
      type: 'raised-hands',
      roomId: ROOM1_ID,
      queue: [],
      event: { kind: 'lowered', userId: 'ana' },
    })
    expect(raisedHands(a.sent)).toContainEqual(expected)
    expect(raisedHands(b.sent)).toContainEqual(expected)
  })

  it('desconectar com a mão levantada limpa a fila para quem ficou', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)

    hub.leave(a.socket, 'ana')

    expect(raisedHands(b.sent)).toContainEqual(
      expect.objectContaining({
        type: 'raised-hands',
        roomId: ROOM1_ID,
        queue: [],
        event: { kind: 'lowered', userId: 'ana' },
      }),
    )
  })

  it('entrar numa sala com fila em andamento entrega snapshot sem event (não deve tocar som)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)

    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    expect(raisedHands(b.sent)).toContainEqual({ type: 'raised-hands', roomId: ROOM1_ID, queue: ['ana'] })
  })

  it('ignora raiseHand de socket cujo dono não bate com o userId (anti-spoof)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'bruno', true)

    expect(raisedHands(b.sent)).toHaveLength(0)
  })

  it('configure() com troca de publicação zera a fila de mãos levantadas', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)

    const runtime = legacyOfficeRuntimeFixture()
    hub.configure({ ...runtime, publication: { ...runtime.publication, id: 'outra-publicacao' } })

    const b = fakeSocket()
    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    hub.raiseHand(b.socket, 'bruno', true)

    // Se a fila antiga não tivesse zerado, a nova incluiria 'ana' também.
    expect(lastRaisedHands(b.sent)?.queue).toEqual(['bruno'])
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run office-hub -t raiseHand`
Expected: FAIL — `hub.raiseHand is not a function` (o método ainda não existe).

- [ ] **Step 3: Adicionar o estado e o helper privado**

Em `apps/api/src/lib/office-hub.ts`, dentro da classe `OfficeHub`, logo após a declaração de `confettiSocket` (linha 88, antes de `lastCelebrationAt`):

```ts
  /** De qual socket veio o `active:true` de cada userId — permite limpar o confete certo quando ESSA aba cai, sem mexer em outra aba do mesmo usuário. */
  private confettiSocket = new Map<string, OfficeSocket>()
  /** Fila de mãos levantadas por sala (FIFO). Só existe entrada enquanto a fila não está vazia. */
  private raisedHandsByRoom = new Map<string, string[]>()
  /** Índice reverso: em qual sala (se houver) o usuário está com a mão levantada. */
  private raisedHandRoomOf = new Map<string, string>()
  /** Último instante (ms) de comemoração — base do cooldown. */
  private lastCelebrationAt = 0
```

- [ ] **Step 4: Adicionar `removeFromRaisedHandQueue` e `raiseHand`**

Logo após o método `confetti()` (que termina na linha 408, antes de `/** Só para testes: zera o estado do singleton entre casos. */`):

```ts
  /**
   * Remove userId da fila em que estiver (se houver); devolve sala+fila
   * atualizada, ou null se não estava em fila nenhuma. Único ponto que mexe
   * em `raisedHandsByRoom`/`raisedHandRoomOf` — todo caller (ação do próprio,
   * sair da sala, desconexão) passa por aqui.
   */
  private removeFromRaisedHandQueue(userId: string): { roomId: string; queue: string[] } | null {
    const roomId = this.raisedHandRoomOf.get(userId)
    if (!roomId) return null
    this.raisedHandRoomOf.delete(userId)
    const queue = (this.raisedHandsByRoom.get(roomId) ?? []).filter((id) => id !== userId)
    if (queue.length > 0) this.raisedHandsByRoom.set(roomId, queue)
    else this.raisedHandsByRoom.delete(roomId)
    return { roomId, queue }
  }

  /**
   * Levantar (active:true) ou abaixar (active:false) a própria mão. Levantar
   * só funciona dentro de uma sala de reunião e é no-op se já está em alguma
   * fila; abaixar reaproveita `removeFromRaisedHandQueue` e é no-op se não
   * estava em fila nenhuma. `broadcastToRoom` alcança o próprio remetente
   * automaticamente — ele ainda está fisicamente na sala nos dois casos.
   */
  raiseHand(socket: OfficeSocket, userId: string, active: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return

    if (!active) {
      const removed = this.removeFromRaisedHandQueue(userId)
      if (!removed) return
      this.broadcastToRoom(removed.roomId, {
        type: 'raised-hands',
        roomId: removed.roomId,
        queue: removed.queue,
        event: { kind: 'lowered', userId },
      })
      return
    }

    if (this.raisedHandRoomOf.has(userId)) return
    const room = this.roomForPosition(entry.occupant.x, entry.occupant.y)
    if (!room) return
    const queue = [...(this.raisedHandsByRoom.get(room.id) ?? []), userId]
    this.raisedHandsByRoom.set(room.id, queue)
    this.raisedHandRoomOf.set(userId, room.id)
    this.broadcastToRoom(room.id, {
      type: 'raised-hands',
      roomId: room.id,
      queue,
      event: { kind: 'raised', userId },
    })
  }

```

- [ ] **Step 5: Integrar em `move()` — snapshot ao entrar, abaixar ao sair**

Em `apps/api/src/lib/office-hub.ts`, dentro de `move()`, substituir o bloco atual:

```ts
    // Sinal sonoro de entrar/sair de sala de reunião.
    const nextRoom = this.roomForPosition(targetX, targetY)
    if (nextRoom?.id !== previousRoom?.id) {
      if (nextRoom) {
        // O próprio já está reposicionado dentro da sala, então o broadcast
        // alcança ele + quem já estava lá (e ninguém de fora).
        this.broadcastToRoom(nextRoom.id, { type: 'room-presence', kind: 'enter', userId, roomId: nextRoom.id })
      }
      if (previousRoom) {
        // O próprio já saiu da sala, logo o broadcast só pega quem ficou —
        // mandamos direto ao socket dele para que também ouça.
        const leftMessage = { type: 'room-presence', kind: 'leave', userId, roomId: previousRoom.id } as const
        this.sendTo(socket, leftMessage)
        this.broadcastToRoom(previousRoom.id, leftMessage)
      }
    }
```

por:

```ts
    // Sinal sonoro de entrar/sair de sala de reunião.
    const nextRoom = this.roomForPosition(targetX, targetY)
    if (nextRoom?.id !== previousRoom?.id) {
      if (nextRoom) {
        // O próprio já está reposicionado dentro da sala, então o broadcast
        // alcança ele + quem já estava lá (e ninguém de fora).
        this.broadcastToRoom(nextRoom.id, { type: 'room-presence', kind: 'enter', userId, roomId: nextRoom.id })
        // Fila de mãos levantadas já em andamento na sala: manda o snapshot só
        // para quem chegou (sem `event` — não deve tocar som de "levantou").
        const queue = this.raisedHandsByRoom.get(nextRoom.id)
        if (queue && queue.length > 0) {
          this.sendTo(socket, { type: 'raised-hands', roomId: nextRoom.id, queue: [...queue] })
        }
      }
      if (previousRoom) {
        // O próprio já saiu da sala, logo o broadcast só pega quem ficou —
        // mandamos direto ao socket dele para que também ouça.
        const leftMessage = { type: 'room-presence', kind: 'leave', userId, roomId: previousRoom.id } as const
        this.sendTo(socket, leftMessage)
        this.broadcastToRoom(previousRoom.id, leftMessage)
        // Saiu fisicamente da sala: a mão abaixa junto, se estava levantada.
        const removedHand = this.removeFromRaisedHandQueue(userId)
        if (removedHand) {
          const handMessage = {
            type: 'raised-hands',
            roomId: removedHand.roomId,
            queue: removedHand.queue,
            event: { kind: 'lowered', userId },
          } as const
          this.sendTo(socket, handMessage)
          this.broadcastToRoom(removedHand.roomId, handMessage)
        }
      }
    }
```

- [ ] **Step 6: Integrar em `leave()` — limpar ao desconectar**

Substituir o trecho final de `leave()`:

```ts
    this.confettiActive.delete(userId) // não deixa fantasma inflando a contagem de confete
    this.confettiSocket.delete(userId)
    this.broadcast({ type: 'left', userId })
    if (previousRoom) {
      // Já removido das entries: o broadcast avisa só quem continua na sala.
      this.broadcastToRoom(previousRoom.id, { type: 'room-presence', kind: 'leave', userId, roomId: previousRoom.id })
    }
  }
```

por:

```ts
    this.confettiActive.delete(userId) // não deixa fantasma inflando a contagem de confete
    this.confettiSocket.delete(userId)
    const removedHand = this.removeFromRaisedHandQueue(userId)
    this.broadcast({ type: 'left', userId })
    if (previousRoom) {
      // Já removido das entries: o broadcast avisa só quem continua na sala.
      this.broadcastToRoom(previousRoom.id, { type: 'room-presence', kind: 'leave', userId, roomId: previousRoom.id })
    }
    if (removedHand) {
      this.broadcastToRoom(removedHand.roomId, {
        type: 'raised-hands',
        roomId: removedHand.roomId,
        queue: removedHand.queue,
        event: { kind: 'lowered', userId },
      })
    }
  }
```

- [ ] **Step 7: Limpar o estado em `configure()` e `reset()`**

Em `configure()`, dentro do bloco `if (changed) { ... }`, adicionar as duas linhas novas:

```ts
    if (changed) {
      this.entries.clear()
      this.buckets.clear()
      this.socketOwner.clear()
      this.lastCallAt.clear()
      this.confettiActive.clear()
      this.confettiSocket.clear()
      this.raisedHandsByRoom.clear()
      this.raisedHandRoomOf.clear()
      this.lastCelebrationAt = 0
    }
```

Em `reset()`:

```ts
  reset(): void {
    this.entries.clear()
    this.buckets.clear()
    this.socketOwner.clear()
    this.lastCallAt.clear()
    this.confettiActive.clear()
    this.confettiSocket.clear()
    this.raisedHandsByRoom.clear()
    this.raisedHandRoomOf.clear()
    this.lastCelebrationAt = 0
    this.runtime = null
  }
```

- [ ] **Step 8: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run office-hub`
Expected: PASS (todos os testes do arquivo, incluindo os 11 novos de `raiseHand`).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): fila de mãos levantadas por sala de reunião no OfficeHub"
```

---

### Task 3: Rota WS — despachar `raise-hand` para o hub

**Files:**
- Modify: `apps/api/src/routes/office-ws.ts`
- Test: `apps/api/src/routes/office-ws.test.ts`

**Interfaces:**
- Consumes: `OfficeHub.raiseHand(socket, userId, active)` (Task 2).
- Produces: nada consumido por tasks seguintes — ponta final do caminho cliente→servidor.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/src/routes/office-ws.test.ts`, logo após o teste `'mensagem de confetti malformada não derruba a conexão'` (que termina na linha 395), adicionar:

```ts
  it('despacha raise-hand pro hub com os parâmetros certos', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-raise-hand@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'raiseHand')
    ws.send(JSON.stringify({ type: 'raise-hand', active: true }))
    await delay(100)

    expect(spy).toHaveBeenCalledWith(expect.anything(), ana.id, true)

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('mensagem de raise-hand malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-raise-hand-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send(JSON.stringify({ type: 'raise-hand' })) // sem active
    ws.send(JSON.stringify({ type: 'raise-hand', active: 'sim' })) // shape errado
    await delay(120)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await app.close()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run office-ws -t raise-hand`
Expected: FAIL — o primeiro teste falha porque `officeHub.raiseHand` nunca é chamado (a rota ainda não despacha a mensagem).

- [ ] **Step 3: Adicionar o dispatch na rota**

Em `apps/api/src/routes/office-ws.ts`, no `ws.on('message', ...)`, substituir:

```ts
        } else if (msg.type === 'confetti' && typeof msg.active === 'boolean') {
          officeHub.confetti(ws, user.id, msg.active)
        } else if (msg.type === 'set-status' && isOfficeUserStatus(msg.status)) {
```

por:

```ts
        } else if (msg.type === 'confetti' && typeof msg.active === 'boolean') {
          officeHub.confetti(ws, user.id, msg.active)
        } else if (msg.type === 'raise-hand' && typeof msg.active === 'boolean') {
          officeHub.raiseHand(ws, user.id, msg.active)
        } else if (msg.type === 'set-status' && isOfficeUserStatus(msg.status)) {
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run office-ws`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Rodar a suíte inteira da API**

Run: `pnpm --filter @legends/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/office-ws.ts apps/api/src/routes/office-ws.test.ts
git commit -m "feat(api): despacha raise-hand da rota WS pro OfficeHub"
```

---

### Task 4: Som — `playRaiseHandBeep`

**Files:**
- Modify: `apps/web/src/lib/beep.ts`
- Test: `apps/web/src/lib/beep.test.ts`

**Interfaces:**
- Produces: `playRaiseHandBeep(): void`, exportado de `apps/web/src/lib/beep.ts` — consumido pela Task 5.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/lib/beep.test.ts`, ao final do arquivo (após o `describe('playEnterBeep / playLeaveBeep', ...)`):

```ts
describe('playRaiseHandBeep', () => {
  it('agenda um único tom curto', async () => {
    const fake = installFakeAudio()
    const { playRaiseHandBeep } = await import('./beep')
    playRaiseHandBeep()
    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(1)
    expect(fake.osc.start).toHaveBeenCalled()
    expect(fake.osc.stop).toHaveBeenCalled()
  })

  it('não lança quando o navegador não tem AudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { playRaiseHandBeep } = await import('./beep')
    expect(() => playRaiseHandBeep()).not.toThrow()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run beep -t playRaiseHandBeep`
Expected: FAIL — `playRaiseHandBeep` não existe em `./beep`.

- [ ] **Step 3: Implementar**

Em `apps/web/src/lib/beep.ts`, ao final do arquivo, após `playLeaveBeep`:

```ts
/** Alguém levantou a mão numa sala de reunião — um tom curto e discreto. */
export function playRaiseHandBeep(): void {
  playTones([{ freq: 740, at: 0, gain: 0.15, dur: 0.16 }])
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run beep`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/beep.ts apps/web/src/lib/beep.test.ts
git commit -m "feat(web): som de levantar a mão (playRaiseHandBeep)"
```

---

### Task 5: Hook `useRaisedHands`

**Files:**
- Create: `apps/web/src/office/media/useRaisedHands.ts`
- Test: `apps/web/src/office/media/useRaisedHands.test.ts`

**Interfaces:**
- Consumes: `OfficeBridge` (`onServerMessage`, `emitClientMessage`, `onClientMessage`) de `../OfficeBridge`; `playRaiseHandBeep` de `../../lib/beep` (Task 4); os tipos `OfficeClientMessage`/`OfficeServerMessage` (Task 1, via `OfficeBridge`).
- Produces: `useRaisedHands(bridge, roomId, youId, connected, localSpeaking): RaisedHandsState`, com `RaisedHandsState = { queue: string[]; raised: boolean; canRaise: boolean; toggle: () => void }` — consumido pela Task 6 (`OfficeSessionContext.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/web/src/office/media/useRaisedHands.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { OfficeBridge } from '../OfficeBridge'

const beepMock = vi.fn()
vi.mock('../../lib/beep', () => ({ playRaiseHandBeep: () => beepMock() }))

import { useRaisedHands } from './useRaisedHands'

interface Props {
  roomId: string | null
  youId: string | null
  connected: boolean
  localSpeaking: boolean
}

function renderRaisedHands(overrides: Partial<Props> = {}) {
  const props: Props = { roomId: 'room-1', youId: 'ana', connected: true, localSpeaking: false, ...overrides }
  const bridge = new OfficeBridge()
  const hook = renderHook((p: Props) => useRaisedHands(bridge, p.roomId, p.youId, p.connected, p.localSpeaking), {
    initialProps: props,
  })
  return { bridge, ...hook }
}

beforeEach(() => {
  beepMock.mockClear()
})

describe('useRaisedHands', () => {
  it('toggle() levanta a mão quando abaixada', () => {
    const { bridge, result } = renderRaisedHands()
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.toggle())

    expect(sent).toEqual([{ type: 'raise-hand', active: true }])
  })

  it('toggle() abaixa a mão quando o próprio já está na fila', () => {
    const { bridge, result, rerender } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: ['ana'],
        event: { kind: 'raised', userId: 'ana' },
      })
    })
    rerender({ roomId: 'room-1', youId: 'ana', connected: true, localSpeaking: false })
    expect(result.current.raised).toBe(true)

    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))
    act(() => result.current.toggle())

    expect(sent).toEqual([{ type: 'raise-hand', active: false }])
  })

  it('acumula a fila da sala atual e ignora mensagens de outra sala', () => {
    const { bridge, result } = renderRaisedHands()

    act(() => {
      bridge.emitServerMessage({ type: 'raised-hands', roomId: 'room-2', queue: ['outra'] })
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: ['ana', 'bruno'],
        event: { kind: 'raised', userId: 'bruno' },
      })
    })

    expect(result.current.queue).toEqual(['ana', 'bruno'])
  })

  it('zera a fila ao trocar de sala', () => {
    const { bridge, result, rerender } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({ type: 'raised-hands', roomId: 'room-1', queue: ['ana'] })
    })
    expect(result.current.queue).toEqual(['ana'])

    rerender({ roomId: 'room-2', youId: 'ana', connected: true, localSpeaking: false })
    expect(result.current.queue).toEqual([])
  })

  it('event.kind "raised" toca o som', () => {
    const { bridge } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: ['ana'],
        event: { kind: 'raised', userId: 'ana' },
      })
    })
    expect(beepMock).toHaveBeenCalledTimes(1)
  })

  it('snapshot sem event não toca som', () => {
    const { bridge } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({ type: 'raised-hands', roomId: 'room-1', queue: ['ana'] })
    })
    expect(beepMock).not.toHaveBeenCalled()
  })

  it('event.kind "lowered" não toca som', () => {
    const { bridge } = renderRaisedHands()
    act(() => {
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: [],
        event: { kind: 'lowered', userId: 'ana' },
      })
    })
    expect(beepMock).not.toHaveBeenCalled()
  })

  it('abaixa sozinha quando começa a falar com a mão levantada', () => {
    const { bridge, rerender } = renderRaisedHands({ localSpeaking: false })
    act(() => {
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: ['ana'],
        event: { kind: 'raised', userId: 'ana' },
      })
    })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    rerender({ roomId: 'room-1', youId: 'ana', connected: true, localSpeaking: true })

    expect(sent).toEqual([{ type: 'raise-hand', active: false }])
  })

  it('não abaixa se já estava falando antes de levantar a mão (sem borda de subida)', () => {
    const { bridge, rerender } = renderRaisedHands({ localSpeaking: true })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => {
      bridge.emitServerMessage({
        type: 'raised-hands',
        roomId: 'room-1',
        queue: ['ana'],
        event: { kind: 'raised', userId: 'ana' },
      })
    })
    rerender({ roomId: 'room-1', youId: 'ana', connected: true, localSpeaking: true })

    expect(sent).toEqual([])
  })

  it('canRaise exige sala, identificação e conexão', () => {
    expect(renderRaisedHands({ roomId: null }).result.current.canRaise).toBe(false)
    expect(renderRaisedHands({ youId: null }).result.current.canRaise).toBe(false)
    expect(renderRaisedHands({ connected: false }).result.current.canRaise).toBe(false)
    expect(renderRaisedHands({}).result.current.canRaise).toBe(true)
  })

  it('toggle() é no-op sem sala', () => {
    const { bridge, result } = renderRaisedHands({ roomId: null })
    const sent: unknown[] = []
    bridge.onClientMessage((message) => sent.push(message))

    act(() => result.current.toggle())

    expect(sent).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run useRaisedHands`
Expected: FAIL — `Failed to resolve import "./useRaisedHands"`.

- [ ] **Step 3: Implementar o hook**

Criar `apps/web/src/office/media/useRaisedHands.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import type { OfficeBridge } from '../OfficeBridge'
import { playRaiseHandBeep } from '../../lib/beep'

export interface RaisedHandsState {
  /** Fila ordenada de userIds — quem levantou primeiro vem primeiro. */
  queue: string[]
  /** Se o próprio usuário está na fila agora. */
  raised: boolean
  /** Se dá pra levantar/abaixar agora (dentro de sala, identificado, conectado). */
  canRaise: boolean
  /** Levanta se abaixada, abaixa se levantada. */
  toggle: () => void
}

/**
 * Fila de mãos levantadas da sala atual — mesmo padrão de `useRoomChat`: o
 * servidor é autoritativo, entrega só a quem está na MESMA sala, e trocar de
 * sala sempre zera o estado local (a fila é por permanência, não persiste
 * entre salas).
 */
export function useRaisedHands(
  bridge: OfficeBridge,
  roomId: string | null,
  youId: string | null,
  connected: boolean,
  localSpeaking: boolean,
): RaisedHandsState {
  const [queue, setQueue] = useState<string[]>([])
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  useEffect(() => {
    setQueue([])
  }, [roomId])

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type !== 'raised-hands' || message.roomId !== roomIdRef.current) return
        setQueue(message.queue)
        // `event` ausente = snapshot (ex.: acabou de entrar na sala) — nunca toca som.
        if (message.event?.kind === 'raised') playRaiseHandBeep()
      }),
    [bridge],
  )

  const raised = youId !== null && queue.includes(youId)

  // Abaixa sozinha só na TRANSIÇÃO para "falando" (borda de subida) — levantar
  // a mão no meio de uma fala já em andamento não deve derrubá-la na hora.
  const wasSpeakingRef = useRef(false)
  useEffect(() => {
    const startedSpeaking = localSpeaking && !wasSpeakingRef.current
    wasSpeakingRef.current = localSpeaking
    if (startedSpeaking && raised) {
      bridge.emitClientMessage({ type: 'raise-hand', active: false })
    }
  }, [localSpeaking, raised, bridge])

  function toggle() {
    if (!roomId || !youId || !connected) return
    bridge.emitClientMessage({ type: 'raise-hand', active: !raised })
  }

  return { queue, raised, canRaise: roomId !== null && youId !== null && connected, toggle }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run useRaisedHands`
Expected: PASS (12 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/useRaisedHands.ts apps/web/src/office/media/useRaisedHands.test.ts
git commit -m "feat(web): hook useRaisedHands (fila de mãos levantadas da sala atual)"
```

---

### Task 6: Instanciar `useRaisedHands` na sessão do escritório

**Files:**
- Modify: `apps/web/src/office/session/OfficeSessionContext.tsx`
- Modify: `apps/web/src/office/session/OfficeSessionContext.test.tsx`

**Interfaces:**
- Consumes: `useRaisedHands` e `RaisedHandsState` de `../media/useRaisedHands` (Task 5).
- Produces: `OfficeSessionValue.raisedHands: RaisedHandsState` — consumido pelas Tasks 7 e 8 via `useOfficeSession()`.

Esta task é wiring (liga um hook já testado no provider da sessão) — sem novo
comportamento observável isolado, então não há um ciclo red/green próprio; a garantia é
"a suíte inteira do arquivo continua verde depois da mudança".

- [ ] **Step 1: Atualizar o mock no teste (para não quebrar com o hook real sendo chamado)**

Em `apps/web/src/office/session/OfficeSessionContext.test.tsx`, adicionar o import e o mock ao lado dos de `useRoomChat`:

```ts
import { useRoomChat } from '../media/useRoomChat'
import { useRaisedHands } from '../media/useRaisedHands'
```

```ts
vi.mock('../media/useRoomChat', () => ({ useRoomChat: vi.fn() }))
vi.mock('../media/useRaisedHands', () => ({ useRaisedHands: vi.fn() }))
```

E, junto do `vi.mocked(useRoomChat).mockReturnValue(...)` já existente (no bloco `beforeEach`/setup):

```ts
  vi.mocked(useRoomChat).mockReturnValue({ messages: [], canSend: false, sendMessage: vi.fn(() => false) })
  vi.mocked(useRaisedHands).mockReturnValue({ queue: [], raised: false, canRaise: false, toggle: vi.fn() })
```

- [ ] **Step 2: Rodar os testes e confirmar que ainda passam (mock isolado, ainda sem uso)**

Run: `pnpm --filter @legends/web exec vitest run OfficeSessionContext`
Expected: PASS — o mock foi registrado mas o provider ainda não chama `useRaisedHands`, então nada muda de comportamento ainda.

- [ ] **Step 3: Instanciar o hook no provider**

Em `apps/web/src/office/session/OfficeSessionContext.tsx`, adicionar o import ao lado de `useRoomChat`:

```ts
import { useRoomChat, type RoomChatState } from '../media/useRoomChat'
import { useRaisedHands, type RaisedHandsState } from '../media/useRaisedHands'
```

Adicionar ao `OfficeSessionValue`, logo após `roomChat: RoomChatState`:

```ts
  roomChat: RoomChatState
  raisedHands: RaisedHandsState
```

Logo após a declaração de `roomChat` (o bloco que chama `useRoomChat(...)`), adicionar:

```ts
  const roomChat = useRoomChat(
    bridge,
    currentRoom?.id ?? null,
    you ? { userId: you.userId, name: you.name } : null,
    connected,
  )
  const raisedHands = useRaisedHands(bridge, currentRoom?.id ?? null, youId, connected, media.localSpeaking)
```

- [ ] **Step 4: Expor no `value` memoizado**

No `useMemo<OfficeSessionValue>`, adicionar `raisedHands` ao objeto e à lista de dependências:

```ts
  const value = useMemo<OfficeSessionValue>(
    () => ({
      status,
      enterOffice,
      leaveOffice,
      bridge,
      activeMap,
      activeMapLoading: active && activeMapQuery.isLoading,
      occupants,
      youId,
      connected,
      media,
      broadcast,
      canBroadcast,
      cameraBackground,
      roomChat,
      raisedHands,
      setUserStatus,
    }),
    [
      status,
      enterOffice,
      leaveOffice,
      bridge,
      activeMap,
      active,
      activeMapQuery.isLoading,
      occupants,
      youId,
      connected,
      media,
      broadcast,
      canBroadcast,
      cameraBackground,
      roomChat,
      raisedHands,
      setUserStatus,
    ],
  )
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run OfficeSessionContext`
Expected: PASS (todos os testes do arquivo, sem quebrar nenhum existente).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/session/OfficeSessionContext.tsx apps/web/src/office/session/OfficeSessionContext.test.tsx
git commit -m "feat(web): expõe raisedHands na sessão do escritório"
```

---

### Task 7: Botão "levantar a mão" na `MediaBar`

**Files:**
- Modify: `apps/web/src/office/media/MediaBar.tsx`
- Test: `apps/web/src/office/media/MediaBar.test.tsx`

**Interfaces:**
- Consumes: nenhuma dependência nova de outras tasks (props simples: `boolean`/callback).
- Produces: `MediaBar` ganha as props `canRaiseHand?: boolean`, `raised?: boolean`, `onToggleRaiseHand?: () => void` — consumidas pela Task 8 (`OfficePage.tsx`).

- [ ] **Step 1: Atualizar o helper de render do teste**

Em `apps/web/src/office/media/MediaBar.test.tsx`, adicionar `canRaiseHand`, `raised` e `onToggleRaiseHand` aos parâmetros e ao JSX de `renderMediaBar`:

```ts
function renderMediaBar({
  media = mediaState(),
  zoneName = null,
  broadcast = broadcastState({ available: false }),
  canBroadcast = false,
  you = { name: 'Lucca Secco' },
  status,
  onSetStatus,
  onLeave = vi.fn(),
  onEditCharacter,
  onChatOpenChange,
  onNearbyMessage,
  onReaction,
  showRoomControls = false,
  roomPanel = null,
  onToggleRoomChat,
  onToggleRoomPeople,
  canRaiseHand = false,
  raised = false,
  onToggleRaiseHand,
  cameraBackground = cameraBackgroundState(),
}: Partial<ComponentProps<typeof MediaBar>> = {}) {
  return render(
    <MediaBar
      media={media}
      zoneName={zoneName}
      broadcast={broadcast}
      canBroadcast={canBroadcast}
      you={you}
      status={status}
      onSetStatus={onSetStatus}
      onLeave={onLeave}
      onEditCharacter={onEditCharacter}
      onChatOpenChange={onChatOpenChange}
      onNearbyMessage={onNearbyMessage}
      onReaction={onReaction}
      showRoomControls={showRoomControls}
      roomPanel={roomPanel}
      onToggleRoomChat={onToggleRoomChat}
      onToggleRoomPeople={onToggleRoomPeople}
      canRaiseHand={canRaiseHand}
      raised={raised}
      onToggleRaiseHand={onToggleRaiseHand}
      cameraBackground={cameraBackground}
    />,
  )
}
```

- [ ] **Step 2: Escrever os testes que falham**

Ao final do `describe('MediaBar', ...)`, adicionar:

```ts
  it('sem canRaiseHand, o botão de levantar a mão não aparece', () => {
    renderMediaBar()
    expect(screen.queryByRole('button', { name: 'Levantar a mão' })).not.toBeInTheDocument()
  })

  it('com canRaiseHand, mostra o botão de levantar a mão e dispara onToggleRaiseHand', () => {
    const onToggleRaiseHand = vi.fn()
    renderMediaBar({ canRaiseHand: true, raised: false, onToggleRaiseHand })
    const button = screen.getByRole('button', { name: 'Levantar a mão' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(onToggleRaiseHand).toHaveBeenCalledOnce()
  })

  it('com a mão levantada, o botão mostra "Abaixar a mão"', () => {
    renderMediaBar({ canRaiseHand: true, raised: true })
    expect(screen.getByRole('button', { name: 'Abaixar a mão' })).toHaveAttribute('aria-pressed', 'true')
  })
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run MediaBar -t "levantar a mão"`
Expected: FAIL — TypeScript reclama de props desconhecidas (`canRaiseHand`, `raised`, `onToggleRaiseHand`) e o botão não é encontrado.

- [ ] **Step 4: Adicionar as props e o botão**

Em `apps/web/src/office/media/MediaBar.tsx`, atualizar a assinatura da função (bloco de props, linhas 41-78):

```ts
export function MediaBar({
  media,
  zoneName,
  broadcast,
  canBroadcast,
  you,
  status = 'online',
  onSetStatus,
  onLeave,
  onEditCharacter,
  onChatOpenChange,
  onNearbyMessage,
  onReaction,
  showRoomControls = false,
  roomPanel = null,
  onToggleRoomChat,
  onToggleRoomPeople,
  canRaiseHand = false,
  raised = false,
  onToggleRaiseHand,
  cameraBackground,
}: {
  media: OfficeMediaState
  zoneName: string | null
  broadcast: OfficeBroadcastState
  canBroadcast: boolean
  you?: AvatarSource | null
  /** Status de presença atual (bolinha do menu de identidade) — default 'online'. */
  status?: OfficeUserStatus
  onSetStatus?: (status: OfficeUserStatus) => void
  onLeave: () => void
  onEditCharacter?: () => void
  onChatOpenChange?: (open: boolean) => void
  onNearbyMessage?: (text: string, kind: OfficeNearbyMessageKind) => void
  onReaction?: (reaction: string) => void
  showRoomControls?: boolean
  roomPanel?: 'chat' | 'people' | null
  onToggleRoomChat?: () => void
  onToggleRoomPeople?: () => void
  /** Independe de `showRoomControls` (que só liga com a grade de câmeras aberta) — o botão de mão vale sempre que está numa sala de reunião. */
  canRaiseHand?: boolean
  raised?: boolean
  onToggleRaiseHand?: () => void
  cameraBackground: CameraBackgroundState
}) {
```

Adicionar o botão logo após o botão de nearby chat e antes do bloco `{showRoomControls && (...)}`:

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
        {canRaiseHand && (
          <button
            type="button"
            aria-label={raised ? 'Abaixar a mão' : 'Levantar a mão'}
            title={raised ? 'Abaixar a mão' : 'Levantar a mão'}
            aria-pressed={raised}
            className={toolButtonCls(raised)}
            onClick={onToggleRaiseHand}
          >
            <Icon name="back_hand" className="text-[20px]" />
          </button>
        )}
        {showRoomControls && (
```

(o `{showRoomControls && (` acima é o início do bloco já existente — só a linha de contexto para localizar o ponto de inserção; o resto do bloco `showRoomControls` continua inalterado.)

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run MediaBar`
Expected: PASS (arquivo inteiro).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx
git commit -m "feat(web): botão de levantar a mão na barra de ferramentas do escritório"
```

---

### Task 8: Contador/lista de mãos levantadas + wiring na `OfficePage`

**Files:**
- Create: `apps/web/src/office/media/RaiseHandQueue.tsx`
- Test: `apps/web/src/office/media/RaiseHandQueue.test.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `OfficeSessionValue.raisedHands` (Task 6); props `canRaiseHand`/`raised`/`onToggleRaiseHand` de `MediaBar` (Task 7).
- Produces: `RaiseHandQueue({ queue: string[], occupants: OfficeOccupant[] })` — componente final, sem consumidores além de `OfficePage.tsx`.

- [ ] **Step 1: Escrever o teste do componente `RaiseHandQueue` (falha)**

Criar `apps/web/src/office/media/RaiseHandQueue.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { RaiseHandQueue } from './RaiseHandQueue'

const ana: OfficeOccupant = {
  userId: 'ana',
  name: 'Ana Silva',
  x: 1,
  y: 1,
  dir: 'down',
  avatarSeed: null,
  avatarOptions: null,
}
const bruno: OfficeOccupant = {
  userId: 'bruno',
  name: 'Bruno Costa',
  x: 2,
  y: 1,
  dir: 'down',
  avatarSeed: null,
  avatarOptions: null,
}

describe('RaiseHandQueue', () => {
  it('fila vazia não renderiza nada', () => {
    const { container } = render(<RaiseHandQueue queue={[]} occupants={[ana, bruno]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra o contador com o tamanho da fila', () => {
    render(<RaiseHandQueue queue={['ana', 'bruno']} occupants={[ana, bruno]} />)
    expect(screen.getByRole('button', { name: 'Expandir fila de mãos levantadas' })).toHaveTextContent('2')
  })

  it('clicar expande a lista na ordem da fila; nomes não aparecem antes de expandir', () => {
    render(<RaiseHandQueue queue={['bruno', 'ana']} occupants={[ana, bruno]} />)
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir fila de mãos levantadas' }))

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Bruno Costa')
    expect(items[1]).toHaveTextContent('Ana Silva')
  })

  it('clicar de novo recolhe a lista', () => {
    render(<RaiseHandQueue queue={['ana']} occupants={[ana, bruno]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expandir fila de mãos levantadas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recolher fila de mãos levantadas' }))
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run RaiseHandQueue`
Expected: FAIL — `Failed to resolve import "./RaiseHandQueue"`.

- [ ] **Step 3: Implementar o componente**

Criar `apps/web/src/office/media/RaiseHandQueue.tsx`:

```tsx
import { useState } from 'react'
import type { OfficeOccupant } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'

/**
 * Contador de mãos levantadas da sala atual, no topo da tela — clicar expande
 * a lista na ordem da fila. Não renderiza nada com a fila vazia (o pai ainda
 * pode condicionar por `inMeetingRoom` também, mas isto sozinho já é seguro).
 */
export function RaiseHandQueue({
  queue,
  occupants,
}: {
  queue: string[]
  occupants: OfficeOccupant[]
}) {
  const [expanded, setExpanded] = useState(false)
  if (queue.length === 0) return null

  const people = queue
    .map((userId) => occupants.find((o) => o.userId === userId))
    .filter((o): o is OfficeOccupant => o !== undefined)

  return (
    <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2">
      <button
        type="button"
        aria-label={expanded ? 'Recolher fila de mãos levantadas' : 'Expandir fila de mãos levantadas'}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-md py-sm shadow-lg backdrop-blur"
      >
        <Icon name="back_hand" className="text-[20px]" />
        <span className="font-label text-label-sm text-on-surface">{queue.length}</span>
      </button>
      {expanded && (
        <ul className="mt-xs w-56 overflow-hidden rounded-xl border border-white/10 bg-[#2f2f2f]/95 py-xs shadow-2xl backdrop-blur">
          {people.map((person, index) => (
            <li key={person.userId} className="flex items-center gap-sm px-md py-xs text-white">
              <span className="w-4 shrink-0 text-right font-label text-label-sm text-white/55">{index + 1}</span>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                <Avatar user={person} initialsClassName="font-label text-label-sm font-bold text-primary" />
              </div>
              <span className="truncate font-body text-body-sm">{person.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run RaiseHandQueue`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit do componente**

```bash
git add apps/web/src/office/media/RaiseHandQueue.tsx apps/web/src/office/media/RaiseHandQueue.test.tsx
git commit -m "feat(web): componente RaiseHandQueue (contador + lista expansível)"
```

- [ ] **Step 6: Adicionar `raisedHands` ao fixture de sessão do teste da página**

Em `apps/web/src/pages/OfficePage.test.tsx`, na função `sessionValue()`, adicionar o campo `raisedHands` ao objeto default retornado (logo após `roomChat`):

```ts
    roomChat: {
      messages: [],
      canSend: true,
      sendMessage: vi.fn(() => true),
    },
    raisedHands: {
      queue: [],
      raised: false,
      canRaise: false,
      toggle: vi.fn(),
    },
    setUserStatus: vi.fn(),
    ...overrides,
```

- [ ] **Step 7: Escrever os testes de wiring que falham**

Ao final do `describe('OfficePage', ...)`, adicionar:

```ts
  it('fora de sala de reunião, o botão de levantar a mão não aparece', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: 'Levantar a mão' })).not.toBeInTheDocument()
  })

  it('dentro da sala, clicar no botão de levantar a mão chama raisedHands.toggle', () => {
    const toggle = vi.fn()
    renderPage({
      activeMap: meetingRoomMap,
      raisedHands: { queue: [], raised: false, canRaise: true, toggle },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Levantar a mão' }))

    expect(toggle).toHaveBeenCalledOnce()
  })

  it('sem mãos levantadas, o contador não aparece mesmo dentro da sala', () => {
    renderPage({
      activeMap: meetingRoomMap,
      raisedHands: { queue: [], raised: false, canRaise: true, toggle: vi.fn() },
    })
    expect(screen.queryByRole('button', { name: /fila de mãos levantadas/ })).not.toBeInTheDocument()
  })

  it('mostra o contador de mãos levantadas e expande a lista ao clicar', () => {
    renderPage({
      activeMap: meetingRoomMap,
      raisedHands: { queue: ['ana', 'bruno'], raised: true, canRaise: true, toggle: vi.fn() },
    })
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir fila de mãos levantadas' }))

    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
  })
```

- [ ] **Step 8: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run OfficePage -t "mão"`
Expected: FAIL — botão/contador inexistentes na página ainda.

- [ ] **Step 9: Wire no `OfficePage.tsx`**

Adicionar o import, logo abaixo do de `PeopleList`:

```ts
import { PeopleList } from '../office/PeopleList'
import { RaiseHandQueue } from '../office/media/RaiseHandQueue'
```

Destructure `raisedHands` de `useOfficeSession()`, junto de `roomChat`:

```ts
  const {
    status,
    enterOffice,
    bridge,
    activeMap,
    activeMapLoading,
    occupants,
    youId,
    connected,
    media,
    broadcast,
    canBroadcast,
    cameraBackground,
    roomChat,
    raisedHands,
    setUserStatus,
  } = useOfficeSession()
```

Renderizar o contador, logo antes do botão de grade de câmeras (bloco `{inMeetingRoom && (<button ... grid_view ...>)}`):

```tsx
      {inMeetingRoom && <RaiseHandQueue queue={raisedHands.queue} occupants={occupants} />}

      {/* Botão de grade (Meet-style): só dentro de sala de reunião. Abre a
          grade expandida de MediaTiles mesmo sem ninguém ter câmera/tela
          ativa (showAllPresent), mostrando avatar de quem está na sala. */}
      {inMeetingRoom && (
```

Passar as novas props pra `MediaBar`:

```tsx
        <MediaBar
          media={media}
          zoneName={zoneName}
          broadcast={broadcast}
          canBroadcast={canBroadcast}
          you={you}
          status={you?.status}
          onSetStatus={setUserStatus}
          cameraBackground={cameraBackground}
          onLeave={() => navigate('/')}
          onEditCharacter={() => navigate('/personagem')}
          onChatOpenChange={setNearbyChatOpen}
          onNearbyMessage={(text, kind) => {
            bridge.emitClientMessage({ type: 'nearby-message', text, kind })
          }}
          onReaction={(reaction) => {
            bridge.emitClientMessage({ type: 'nearby-message', text: reaction, kind: 'speech' })
          }}
          showRoomControls={camerasExpanded && inMeetingRoom}
          roomPanel={roomPanel}
          onToggleRoomChat={toggleRoomChat}
          onToggleRoomPeople={toggleRoomPeople}
          canRaiseHand={inMeetingRoom}
          raised={raisedHands.raised}
          onToggleRaiseHand={raisedHands.toggle}
        />
```

- [ ] **Step 10: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run OfficePage`
Expected: PASS (arquivo inteiro, incluindo os testes pré-existentes).

- [ ] **Step 11: Rodar a suíte inteira do web**

Run: `pnpm --filter @legends/web test`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(web): liga levantar a mão na OfficePage (botão + contador/lista)"
```

---

### Task 9: Verificação final

**Files:** nenhum (só validação).

- [ ] **Step 1: Rodar a suíte inteira do monorepo**

Run: `pnpm db:up && pnpm test`
Expected: PASS em todos os workspaces.

- [ ] **Step 2: Typecheck de API e web**

Run: `pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (checagem adicional — `pnpm build`/Vitest não fazem typecheck completo do projeto).

- [ ] **Step 3: Smoke test manual (opcional, recomendado)**

Suba `pnpm dev`, entre em `/escritorio`, ande até uma sala de reunião, clique no botão de mão na barra inferior (ícone `back_hand`), confirme que:
- o contador aparece no topo com "1";
- clicar no contador expande a lista com seu nome;
- abrir outra aba/usuário na mesma sala e levantar a mão também — a fila cresce na ordem certa para ambos;
- falar (ativar o microfone e emitir som) com a mão levantada abaixa ela sozinha;
- sair da sala andando abaixa a mão automaticamente;
- um som toca ao levantar.
