# Corrida com Shift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Segurar Shift faz o personagem correr a 2× a velocidade normal, sincronizado de verdade — todo mundo no escritório vê a corrida, não só quem está correndo.

**Architecture:** Campo opcional `sprint` entra no protocolo WS (`move`/`moved`); o servidor dobra seu rate limit (10→20 passos/s) e ecoa o flag no broadcast; o cliente detecta Shift, dobra sua própria cadência de input na mesma proporção de hoje, e a MESMA função `step()` que anima tanto você quanto os outros ocupantes passa a receber a duração como parâmetro (derivada do flag) em vez de uma constante fixa.

**Tech Stack:** TypeScript strict ESM, Fastify WS (`@fastify/websocket`), Phaser 3, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-corrida-shift-design.md` — leia antes.

## Global Constraints

- Branch: `feat/corrida-shift` (worktree `.claude/worktrees/corrida-shift`).
- Node ≥ 20 (`source ~/.nvm/nvm.sh && nvm use 20` — shell default é 18).
- Servidor autoritativo: colisão continua validada 100% no servidor; a mudança é só de RITMO (rate limit), nunca de regra de colisão.
- `sprint` é opcional no protocolo (`packages/shared/src/office.ts`) — cliente antigo/sem o campo se comporta como hoje.
- `MOVES_PER_SECOND` e `BURST` sobem de `10` para `20` em `apps/api/src/lib/office-hub.ts`.
- Cadência do cliente correndo: metade dos valores atuais — `SPRINT_STEP_MS = STEP_MS / 2` (75ms), `SPRINT_INPUT_COOLDOWN_MS = INPUT_COOLDOWN_MS / 2` (80ms).
- Fora de escopo: o "Seguir" (FollowController) não herda sprint; `MovementPredictor` não muda; sem indicador visual de "correndo" na UI.
- Mensagens de UI em português (esta feature não adiciona nenhuma).
- Testes da API precisam de Postgres: `pnpm db:up` antes (container `legends-db` costuma já estar de pé).
- `OfficeScene.ts` é Phaser-coupled: o próprio `OfficeScene.test.ts` já hoje só testa helpers puros exportados (`officeMapTileFrame`, `computeScreenPosition`, `getScreenPosition`), nunca `update()`/`step()`/teclado — não há harness de cena completa no repo. A Task 3 (mudanças na cena) segue esse mesmo padrão: sem teste automatizado novo para o wiring do Shift; a verificação é manual, na Task 4.

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `packages/shared/src/office.ts` | `sprint?: boolean` em `move` e `moved` |
| `apps/api/src/lib/office-hub.ts` | rate limit 10→20; `move()` ganha `sprint`; broadcast inclui `sprint` |
| `apps/api/src/routes/office-ws.ts` | dispatch passa `msg.sprint === true` |
| `apps/api/src/lib/office-hub.test.ts` | 2 testes existentes (hardcoded `10`) → `20`; 2 testes novos |
| `apps/web/src/office/OfficeBridge.ts` | `MoveIntent` (dir+sprint) substitui `Direction` cru no canal de teclado |
| `apps/web/src/office/OfficeBridge.test.ts` | 1 teste existente atualizado para o novo shape |
| `apps/web/src/office/useOfficeSocket.ts` | envia `sprint` no WS, omitindo quando `false` |
| `apps/web/src/office/useOfficeSocket.test.ts` | 1 teste existente atualizado; 1 teste novo (sprint:true) |
| `apps/web/src/office/scenes/OfficeScene.ts` | tecla Shift, cadência dupla, `step()` parametrizado, `timeScale` da animação |

---

### Task 1: Servidor — protocolo, rate limit e propagação do sprint

**Files:**
- Modify: `packages/shared/src/office.ts:138-151`
- Modify: `apps/api/src/lib/office-hub.ts:31-33,158-198`
- Modify: `apps/api/src/routes/office-ws.ts:91-92`
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (primeira task).
- Produces: `OfficeClientMessage` inclui `{type:'move'; dir: Direction; sprint?: boolean}`; `OfficeServerMessage` inclui `{type:'moved'; userId; x; y; dir; sprint?: boolean}`; `OfficeHub.move(socket, userId, dir, sprint = false): void`. Tasks 2-3 (cliente) consomem esses tipos.

- [ ] **Step 1: Atualizar o protocolo compartilhado**

Em `packages/shared/src/office.ts`, trocar:

```ts
export type OfficeClientMessage =
  | { type: "move"; dir: Direction }
```
por
```ts
export type OfficeClientMessage =
  | { type: "move"; dir: Direction; sprint?: boolean }
```

E trocar:
```ts
  | { type: "moved"; userId: string; x: number; y: number; dir: Direction }
```
por
```ts
  | { type: "moved"; userId: string; x: number; y: number; dir: Direction; sprint?: boolean }
```

- [ ] **Step 2: Escrever os testes novos do servidor (falham antes do Step 3)**

Em `apps/api/src/lib/office-hub.test.ts`, dentro do `describe('move', ...)` existente (depois do último `it` do bloco, antes do `})` de fechamento na linha ~251), adicionar:

```ts
  it('propaga sprint:true no broadcast quando o passo veio com sprint', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    const before = hub.occupants().find((o) => o.userId === 'ana')!
    const dir = isWalkable(before.x, before.y - 1) ? 'up' : 'down'

    hub.move(a.socket, 'ana', dir, true)

    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'moved', userId: 'ana', sprint: true }),
    )
  })

  it('passo sem sprint propaga sprint:false explícito no broadcast', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    const before = hub.occupants().find((o) => o.userId === 'ana')!
    const dir = isWalkable(before.x, before.y - 1) ? 'up' : 'down'

    hub.move(a.socket, 'ana', dir)

    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'moved', userId: 'ana', sprint: false }),
    )
  })

  it('corrida sustentada (passos a cada ~80ms) não esbarra no rate limit', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      hub.join(a.socket, ana)
      const spawn = hub.occupants()[0]
      // Alterna entre um passo e o oposto (volta pro spawn, sempre andável
      // por definição) — mesma técnica defensiva do teste de colisão acima:
      // escolhe uma direção livre a partir do spawn em vez de assumir 'up'.
      const [forward, backward]: [Direction, Direction] = isWalkable(spawn.x, spawn.y - 1)
        ? ['up', 'down']
        : ['down', 'up']
      // 30 passos a 80ms de intervalo = ~2.4s de corrida sustentada — bem
      // acima do necessário pra provar que não é só o burst inicial segurando.
      for (let i = 0; i < 30; i += 1) {
        hub.move(a.socket, 'ana', i % 2 === 0 ? forward : backward, true)
        vi.advanceTimersByTime(80)
      }
      const accepted = a.sent.filter((m) => m.type === 'moved').length
      // Sustentado (12.5 passos/s efetivos) contra um teto de 20/s: nenhum
      // passo deveria ser descartado pelo rate limit.
      expect(accepted).toBe(30)
    } finally {
      vi.useRealTimers()
    }
  })
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- office-hub`
Expected: FAIL — `hub.move(a.socket, 'ana', dir, true)` não tem 4º parâmetro ainda; `sprint` não existe no broadcast; `Property 'sprint' does not exist` no typecheck do teste (o próprio teste falha ao compilar/rodar).

- [ ] **Step 4: Corrigir os 2 testes existentes que hardcodam o limite antigo (10)**

Em `apps/api/src/lib/office-hub.test.ts`, no teste `'descarta o excesso quando alguém spamma move (rate limit)'` (linha ~200), trocar:

```ts
      const moves = a.sent.filter((m) => m.type === 'moved')
      expect(moves.length).toBeLessThanOrEqual(10)
      expect(moves.length).toBeGreaterThan(0)
```
por
```ts
      const moves = a.sent.filter((m) => m.type === 'moved')
      expect(moves.length).toBeLessThanOrEqual(20)
      expect(moves.length).toBeGreaterThan(0)
```

E no teste `'duas abas da mesma pessoa dividem um único orçamento de movimento...'` (linha ~223), trocar o mesmo par de asserts (`toBeLessThanOrEqual(10)` → `toBeLessThanOrEqual(20)`) e o comentário acima delas:

```ts
      // Alterna entre as duas abas do MESMO usuário. Se o bucket fosse por
      // socket (bug), cada aba teria seu próprio orçamento de 20 e o total
      // aceito passaria de 20 (até 40). Com o bucket por userId, o total
      // aceito não pode passar do burst (20), não importa por qual aba.
```

- [ ] **Step 5: Implementar no servidor**

Em `apps/api/src/lib/office-hub.ts`, trocar:

```ts
/** Token bucket: até BURST passos instantâneos, repondo MOVES_PER_SECOND por segundo. */
const MOVES_PER_SECOND = 10
const BURST = 10
```
por
```ts
/**
 * Token bucket: até BURST passos instantâneos, repondo MOVES_PER_SECOND por
 * segundo. O teto cobre tanto o passo normal quanto a corrida (Shift) — não
 * há bucket separado; correr só consome tokens mais rápido, dentro do mesmo
 * teto. Dobrado (era 10/10) para acomodar a cadência de corrida do cliente
 * (~12.5 passos/s efetivos) com a mesma folga proporcional de antes.
 */
const MOVES_PER_SECOND = 20
const BURST = 20
```

Trocar a assinatura e o corpo de `move`:

```ts
  move(socket: OfficeSocket, userId: string, dir: Direction): void {
```
por
```ts
  move(socket: OfficeSocket, userId: string, dir: Direction, sprint = false): void {
```

E trocar a linha do broadcast do passo aceito:
```ts
    this.broadcast({ type: 'moved', userId, x: targetX, y: targetY, dir })
```
por
```ts
    this.broadcast({ type: 'moved', userId, x: targetX, y: targetY, dir, sprint })
```

- [ ] **Step 6: Dispatch da rota WS**

Em `apps/api/src/routes/office-ws.ts`, trocar:

```ts
        if (msg.type === 'move' && isDirection(msg.dir)) {
          officeHub.move(ws, user.id, msg.dir)
```
por
```ts
        if (msg.type === 'move' && isDirection(msg.dir)) {
          officeHub.move(ws, user.id, msg.dir, msg.sprint === true)
```

(`msg.sprint === true` — não `Boolean(msg.sprint)` — para tratar qualquer coisa que não seja exatamente `true` vindo de um payload não confiável como `false`, mesmo padrão defensivo já usado nesta rota para `call-response`.)

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @legends/api test -- office-hub`
Expected: PASS — todos os testes do arquivo, incluindo os 3 novos e os 2 corrigidos.

- [ ] **Step 8: Suite completa da API**

Run: `pnpm --filter @legends/api test`
Expected: PASS completo (nenhuma outra suíte usa os números de rate limit).

- [ ] **Step 9: Commit**

```bash
cd .claude/worktrees/corrida-shift
git add packages/shared/src/office.ts apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts apps/api/src/routes/office-ws.ts
git commit -m "feat(office): servidor aceita e retransmite corrida (sprint) a 2x o ritmo"
```

---

### Task 2: Cliente — Bridge e socket propagam sprint

**Files:**
- Modify: `apps/web/src/office/OfficeBridge.ts:9,23,36,123-131,159-164`
- Modify: `apps/web/src/office/OfficeBridge.test.ts` (teste em torno da linha 134)
- Modify: `apps/web/src/office/useOfficeSocket.ts:41-45`
- Test: `apps/web/src/office/useOfficeSocket.test.ts` (teste em torno da linha 140)

**Interfaces:**
- Consumes: `OfficeClientMessage` com `sprint?: boolean` (Task 1).
- Produces: `export interface MoveIntent { dir: Direction; sprint: boolean }`; `OfficeBridge.onMoveIntent(handler: (intent: MoveIntent) => void): () => void`; `OfficeBridge.emitMoveIntent(intent: MoveIntent): void`. Task 3 (OfficeScene) consome essa assinatura nova.

- [ ] **Step 1: Atualizar o teste existente do Bridge (falha antes do Step 3)**

Em `apps/web/src/office/OfficeBridge.test.ts`, trocar o teste `'bloqueia intenção de movimento enquanto a UI está capturando teclado'` (linha ~134):

```ts
  it('bloqueia intenção de movimento enquanto a UI está capturando teclado', () => {
    const bridge = new OfficeBridge()
    const moves: string[] = []
    bridge.onMoveIntent((dir) => moves.push(dir))

    bridge.setMovementLocked(true)
    bridge.emitMoveIntent('right')
    expect(moves).toEqual([])

    bridge.setMovementLocked(false)
    bridge.emitMoveIntent('right')
    expect(moves).toEqual(['right'])
  })
```
por
```ts
  it('bloqueia intenção de movimento enquanto a UI está capturando teclado', () => {
    const bridge = new OfficeBridge()
    const moves: string[] = []
    bridge.onMoveIntent((intent) => moves.push(intent.dir))

    bridge.setMovementLocked(true)
    bridge.emitMoveIntent({ dir: 'right', sprint: false })
    expect(moves).toEqual([])

    bridge.setMovementLocked(false)
    bridge.emitMoveIntent({ dir: 'right', sprint: false })
    expect(moves).toEqual(['right'])
  })

  it('repassa o flag de sprint da intenção de movimento', () => {
    const bridge = new OfficeBridge()
    const intents: boolean[] = []
    bridge.onMoveIntent((intent) => intents.push(intent.sprint))

    bridge.emitMoveIntent({ dir: 'up', sprint: true })
    bridge.emitMoveIntent({ dir: 'up', sprint: false })

    expect(intents).toEqual([true, false])
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- OfficeBridge`
Expected: FAIL — `emitMoveIntent('right')` não bate com a assinatura nova esperada pelo teste (`onMoveIntent` ainda entrega `dir` cru, não `intent.dir`).

- [ ] **Step 3: Implementar no Bridge**

Em `apps/web/src/office/OfficeBridge.ts`, adicionar a interface nova logo após `NearbyMessage` (linha ~15):

```ts
/** Intenção de movimento vinda do teclado — direção + se Shift (corrida) está pressionado. */
export interface MoveIntent {
  dir: Direction
  sprint: boolean
}
```

Trocar:
```ts
  private moveHandlers = new Set<Handler<Direction>>()
```
por
```ts
  private moveHandlers = new Set<Handler<MoveIntent>>()
```

Trocar:
```ts
  onMoveIntent(handler: Handler<Direction>): () => void {
    this.moveHandlers.add(handler)
    return () => this.moveHandlers.delete(handler)
  }

  emitMoveIntent(dir: Direction): void {
    if (this.movementLocked) return
    for (const handler of this.moveHandlers) handler(dir)
  }
```
por
```ts
  onMoveIntent(handler: Handler<MoveIntent>): () => void {
    this.moveHandlers.add(handler)
    return () => this.moveHandlers.delete(handler)
  }

  emitMoveIntent(intent: MoveIntent): void {
    if (this.movementLocked) return
    for (const handler of this.moveHandlers) handler(intent)
  }
```

- [ ] **Step 4: Rodar e ver passar (só o Bridge)**

Run: `pnpm --filter @legends/web test -- OfficeBridge`
Expected: PASS.

- [ ] **Step 5: Atualizar o teste existente do socket (falha antes do Step 6)**

Em `apps/web/src/office/useOfficeSocket.test.ts`, trocar o teste `'envia a intenção de movimento emitida pela cena'` (linha ~140):

```ts
    act(() => bridge.emitMoveIntent('right'))

    expect(ws.sent).toContain(JSON.stringify({ type: 'move', dir: 'right' }))
  })
```
por
```ts
    act(() => bridge.emitMoveIntent({ dir: 'right', sprint: false }))

    expect(ws.sent).toContain(JSON.stringify({ type: 'move', dir: 'right' }))
  })

  it('envia sprint:true quando a intenção de movimento vem correndo', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.onopen?.())

    act(() => bridge.emitMoveIntent({ dir: 'right', sprint: true }))

    expect(ws.sent).toContain(JSON.stringify({ type: 'move', dir: 'right', sprint: true }))
  })
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- useOfficeSocket`
Expected: FAIL — `bridge.onMoveIntent((dir) => ...)` dentro de `useOfficeSocket.ts` ainda trata o payload como `Direction` cru; o teste novo de `sprint:true` não recebe o campo no JSON enviado.

- [ ] **Step 7: Implementar no socket**

Em `apps/web/src/office/useOfficeSocket.ts`, trocar:

```ts
    const unsubscribeMove = bridge.onMoveIntent((dir) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'move', dir }))
      }
    })
```
por
```ts
    const unsubscribeMove = bridge.onMoveIntent(({ dir, sprint }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Omite o campo quando não está correndo — mantém o payload comum
        // idêntico ao de antes desta feature.
        ws.send(JSON.stringify(sprint ? { type: 'move', dir, sprint } : { type: 'move', dir }))
      }
    })
```

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- useOfficeSocket OfficeBridge`
Expected: PASS nos dois arquivos.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/office/OfficeBridge.ts apps/web/src/office/OfficeBridge.test.ts apps/web/src/office/useOfficeSocket.ts apps/web/src/office/useOfficeSocket.test.ts
git commit -m "feat(web): Bridge e socket do escritório propagam a intenção de corrida"
```

---

### Task 3: Cliente — Shift, cadência dupla e animação na cena

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (constantes ~20-22; campo ~100; setup ~264-272 e cleanup ~301; `update` ~318-326; `applyLocalIntent` ~336-345; `onClientMessage` ~280-282; `handle` caso `'moved'` ~384-387; `step` ~646-703)

**Interfaces:**
- Consumes: `MoveIntent` e a assinatura nova de `emitMoveIntent`/`onMoveIntent` (Task 2); `OfficeServerMessage` com `sprint?: boolean` em `moved` (Task 1).
- Produces: nenhuma interface nova exposta fora da cena — mudança é só de comportamento interno.

Sem teste automatizado nesta task (ver Global Constraints — `OfficeScene` não tem harness de cena completa no repo; a verificação é manual, Task 4).

- [ ] **Step 1: Constantes de cadência da corrida**

Em `apps/web/src/office/scenes/OfficeScene.ts`, logo após as constantes existentes:

```ts
/** Duração do passo entre dois tiles. Casa com o rate limit do servidor (10/s). */
const STEP_MS = 150
/** Cadência do teclado com a tecla presa — não adianta mandar mais do que o servidor aceita. */
const INPUT_COOLDOWN_MS = 160
```
adicionar logo abaixo:
```ts
/** Correndo (Shift): metade da duração/cadência — casa com o rate limit dobrado do servidor. */
const SPRINT_STEP_MS = STEP_MS / 2
const SPRINT_INPUT_COOLDOWN_MS = INPUT_COOLDOWN_MS / 2
/** Pernas mais rápidas durante a corrida, senão o personagem parece deslizar. */
const SPRINT_ANIM_TIME_SCALE = 2
```

- [ ] **Step 2: Campo da tecla Shift**

Trocar:
```ts
  private keys: DirectionKeys | null = null
```
por
```ts
  private keys: DirectionKeys | null = null
  private shiftKey: Phaser.Input.Keyboard.Key | null = null
```

- [ ] **Step 3: Registrar e limpar a tecla**

Trocar:
```ts
    const keyboard = this.input.keyboard
    if (keyboard) {
      this.keys = {
        up: [keyboard.addKey('UP'), keyboard.addKey('W')],
        down: [keyboard.addKey('DOWN'), keyboard.addKey('S')],
        left: [keyboard.addKey('LEFT'), keyboard.addKey('A')],
        right: [keyboard.addKey('RIGHT'), keyboard.addKey('D')],
      }
    }
```
por
```ts
    const keyboard = this.input.keyboard
    if (keyboard) {
      this.keys = {
        up: [keyboard.addKey('UP'), keyboard.addKey('W')],
        down: [keyboard.addKey('DOWN'), keyboard.addKey('S')],
        left: [keyboard.addKey('LEFT'), keyboard.addKey('A')],
        right: [keyboard.addKey('RIGHT'), keyboard.addKey('D')],
      }
      this.shiftKey = keyboard.addKey('SHIFT')
    }
```

E no cleanup do `DESTROY` (perto de `this.keys = null`), trocar:
```ts
      this.characters.clear()
      this.keys = null
    })
```
por
```ts
      this.characters.clear()
      this.keys = null
      this.shiftKey = null
    })
```

- [ ] **Step 4: `update()` usa cadência dupla quando corre**

Trocar:
```ts
  update(time: number): void {
    if (this.inputLocked || this.bridge.isMovementLocked()) return
    if (time - this.lastInputAt < INPUT_COOLDOWN_MS) return
    const dir = this.pressedDirection()
    if (!dir) return
    this.lastInputAt = time
    this.applyLocalIntent(dir)
    this.bridge.emitMoveIntent(dir)
  }
```
por
```ts
  update(time: number): void {
    if (this.inputLocked || this.bridge.isMovementLocked()) return
    const sprint = this.shiftKey?.isDown ?? false
    const cooldown = sprint ? SPRINT_INPUT_COOLDOWN_MS : INPUT_COOLDOWN_MS
    if (time - this.lastInputAt < cooldown) return
    const dir = this.pressedDirection()
    if (!dir) return
    this.lastInputAt = time
    this.applyLocalIntent(dir, sprint)
    this.bridge.emitMoveIntent({ dir, sprint })
  }
```

- [ ] **Step 5: `applyLocalIntent` recebe e repassa o sprint**

Trocar:
```ts
  private applyLocalIntent(dir: Direction): void {
    if (!this.youId || !this.bridge.isConnected()) return
    const action = this.predictor.predict(dir)
    if (action.kind === 'step') {
      this.step(this.youId, action.x, action.y, dir)
    } else if (action.kind === 'face') {
      const view = this.characters.get(this.youId)
      if (view) this.face(view, dir)
    }
  }
```
por
```ts
  private applyLocalIntent(dir: Direction, sprint: boolean): void {
    if (!this.youId || !this.bridge.isConnected()) return
    const action = this.predictor.predict(dir)
    if (action.kind === 'step') {
      this.step(this.youId, action.x, action.y, dir, sprint)
    } else if (action.kind === 'face') {
      const view = this.characters.get(this.youId)
      if (view) this.face(view, dir)
    }
  }
```

- [ ] **Step 6: chamada do Seguir passa `sprint` explícito (sempre `false` hoje — fora de escopo herdar corrida)**

Trocar:
```ts
    const unsubscribeClient = this.bridge.onClientMessage((message) => {
      if (message.type === 'move') this.applyLocalIntent(message.dir)
    })
```
por
```ts
    const unsubscribeClient = this.bridge.onClientMessage((message) => {
      if (message.type === 'move') this.applyLocalIntent(message.dir, message.sprint === true)
    })
```

- [ ] **Step 7: `handle()` repassa o sprint do `moved` remoto**

Trocar:
```ts
      case 'moved':
        // Passo do próprio já animado pela predição: o eco só confirma.
        if (message.userId === this.youId && this.predictor.confirmMove(message.x, message.y)) break
        this.step(message.userId, message.x, message.y, message.dir)
        break
```
por
```ts
      case 'moved':
        // Passo do próprio já animado pela predição: o eco só confirma.
        if (message.userId === this.youId && this.predictor.confirmMove(message.x, message.y)) break
        this.step(message.userId, message.x, message.y, message.dir, message.sprint === true)
        break
```

- [ ] **Step 8: `step()` recebe `sprint` e parametriza duração + `timeScale`**

Trocar a assinatura e o corpo inteiro de `step`:

```ts
  private step(userId: string, x: number, y: number, dir: Direction): void {
    const view = this.characters.get(userId)
    if (!view) return

    view.tween?.stop()
    view.bobTween?.stop()
    if (view.bubbleKind === 'thought') this.clearBubble(view)
    this.face(view, dir)
    const { px, py } = tileCenter(this.document, x, y)

    // Personagem LPC composto: toca o walk cycle da direção e para no frame
    // parado (idle) da última direção ao chegar no tile.
    if (view.textureKey && 'play' in view.body) {
      const sprite = view.body as Phaser.GameObjects.Sprite
      sprite.play(`${view.textureKey}-walk-${dir}`, true)
      view.tween = this.tweens.add({
        targets: view.container,
        x: px,
        y: py,
        duration: STEP_MS,
        ease: 'Linear',
        onComplete: () => {
          view.container.setDepth(y)
          // Um avatar-updated no meio do passo troca o body: o sprite capturado
          // aqui já foi destruído (anims nulo) — parar/posar só o body atual.
          if (view.body !== sprite) return
          sprite.stop()
          sprite.setFrame(characterIdleFrame(view.lastDir))
        },
      })
      return
    }

    // Spinner ainda de pé (composição em voo): tween de posição + bob antigos.
    view.tween = this.tweens.add({
      targets: view.container,
      x: px,
      y: py,
      duration: STEP_MS,
      ease: 'Linear',
      onComplete: () => {
        view.container.setDepth(y)
      },
    })

    // "Walk cycle" do placeholder: um bob vertical enquanto o passo acontece.
    // Rastreado em `view.bobTween` e parado a cada passo novo — o servidor
    // permite ~10 passos/s (100ms) mas o bob dura 150ms, então passos em
    // sequência sobrepunham dois tweens escrevendo em `body.y` ao mesmo tempo.
    view.bobTween = this.tweens.add({
      targets: view.body,
      y: view.bodyBaseY - 2,
      duration: STEP_MS / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => view.body.setY(view.bodyBaseY),
    })
  }
```

por

```ts
  private step(userId: string, x: number, y: number, dir: Direction, sprint: boolean): void {
    const view = this.characters.get(userId)
    if (!view) return
    const duration = sprint ? SPRINT_STEP_MS : STEP_MS

    view.tween?.stop()
    view.bobTween?.stop()
    if (view.bubbleKind === 'thought') this.clearBubble(view)
    this.face(view, dir)
    const { px, py } = tileCenter(this.document, x, y)

    // Personagem LPC composto: toca o walk cycle da direção e para no frame
    // parado (idle) da última direção ao chegar no tile. Correndo, as pernas
    // animam mais rápido (timeScale) — senão o personagem parece deslizar.
    if (view.textureKey && 'play' in view.body) {
      const sprite = view.body as Phaser.GameObjects.Sprite
      sprite.play(`${view.textureKey}-walk-${dir}`, true)
      sprite.anims.timeScale = sprint ? SPRINT_ANIM_TIME_SCALE : 1
      view.tween = this.tweens.add({
        targets: view.container,
        x: px,
        y: py,
        duration,
        ease: 'Linear',
        onComplete: () => {
          view.container.setDepth(y)
          // Um avatar-updated no meio do passo troca o body: o sprite capturado
          // aqui já foi destruído (anims nulo) — parar/posar só o body atual.
          if (view.body !== sprite) return
          sprite.stop()
          sprite.setFrame(characterIdleFrame(view.lastDir))
        },
      })
      return
    }

    // Spinner ainda de pé (composição em voo): tween de posição + bob antigos.
    view.tween = this.tweens.add({
      targets: view.container,
      x: px,
      y: py,
      duration,
      ease: 'Linear',
      onComplete: () => {
        view.container.setDepth(y)
      },
    })

    // "Walk cycle" do placeholder: um bob vertical enquanto o passo acontece.
    // Rastreado em `view.bobTween` e parado a cada passo novo — o servidor
    // permite mais passos/s do que a duração do bob, então passos em
    // sequência sobrepunham dois tweens escrevendo em `body.y` ao mesmo tempo.
    view.bobTween = this.tweens.add({
      targets: view.body,
      y: view.bodyBaseY - 2,
      duration: duration / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => view.body.setY(view.bodyBaseY),
    })
  }
```

- [ ] **Step 9: Typecheck e suite web completa**

Run: `pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web test`
Expected: typecheck limpo; suite PASS completa (nenhum teste automatizado exercitava `OfficeScene.update/step` antes, então nada quebra por essa mudança — os únicos afetados foram corrigidos nas Tasks 1-2).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts
git commit -m "feat(web): Shift faz o personagem correr a 2x no escritório"
```

---

### Task 4: Verificação integrada e manual no browser

**Files:** nenhum novo (ajustes pontuais se algo falhar).

- [ ] **Step 1: Suite completa do monorepo**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && pnpm db:up && pnpm test`
Expected: shared + web + api verdes.

- [ ] **Step 2: Build/typecheck**

Run: `pnpm build`
Expected: limpo nos três workspaces.

- [ ] **Step 3: Subir e verificar (skill `verify` do projeto)**

Usar a skill `verify` para subir web+api. Checklist manual com DOIS usuários logados (duas abas/sessões, como nas verificações anteriores desta sessão):

1. Andar sem Shift: ritmo igual ao de antes da feature (sem mudança perceptível).
2. Segurar Shift + uma direção: o próprio personagem visivelmente dobra de velocidade, pernas animando mais rápido (não "deslizando").
3. Com a SEGUNDA sessão olhando a primeira: enquanto a primeira corre, a segunda também vê o personagem dela correndo no mesmo ritmo — não só andando rápido "por dentro".
4. Soltar Shift no meio de um passo: o passo em andamento termina normal, sem soluço/pulo visual; o próximo passo já volta ao ritmo normal.
5. Segurar Shift por vários segundos seguidos (>3s) numa área aberta do mapa: sem travadas, sem "correção"/rubber-band — a predição local nunca diverge do servidor por causa do rate limit.
6. Bater numa parede correndo: personagem vira a direção sem atravessar, igual a andando (comportamento de colisão intocado).
7. Testar o "Seguir" (clicar para seguir um colega): o Seguir continua no ritmo normal mesmo se Shift estiver pressionado (fora de escopo confirmado).
8. Console do navegador sem erros novos durante o fluxo.

- [ ] **Step 4: Ajustes + commit final (se houver)**

```bash
git add -A apps/web/src apps/api/src packages/shared/src
git commit -m "fix: ajustes da verificação manual da corrida com Shift"
```
(só se necessário; senão, pular)
