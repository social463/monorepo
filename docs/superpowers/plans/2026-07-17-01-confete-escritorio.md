# Confete no F (Escritório) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Easter egg estilo Gather Town no Escritório virtual — segurar `F` faz o personagem lançar confete; 5 pessoas segurando ao mesmo tempo disparam uma comemoração (banner + burst em tela cheia + aplausos sintetizados), tudo efêmero.

**Architecture:** Contrato novo em `@legends/shared` (2 client/server messages). Servidor autoritativo no `OfficeHub` (Set em memória por `userId`, threshold + cooldown) e relay via rota WS. Cliente: `OfficeScene` (Phaser) captura keydown/keyup de `F` e manda `bridge.emitClientMessage({ type:'confetti', active })`; ao receber `confetti`/`celebration` do servidor, desenha emissor de partículas por personagem e a comemoração; som via módulo Web Audio puro. Nada toca o Postgres.

**Tech Stack:** TypeScript ESM, pnpm workspaces. Backend Fastify 4 + `@fastify/websocket` (testes Vitest contra Postgres real). Frontend Vite 5 + React 18 + Phaser 3.80 + Web Audio API (testes Vitest + jsdom).

## Global Constraints

- **Efêmero:** nenhum estado de confete/comemoração persiste — vive só em memória do `OfficeHub`, cai com o processo. Nada de Prisma/migration.
- **Threshold fixo:** `CELEBRATION_THRESHOLD = 5` (constante exportada do hub, sem UI de config — YAGNI).
- **Cooldown fixo:** `CELEBRATION_COOLDOWN_MS = 4000` (evita re-disparo com o grupo oscilando em 4↔5).
- **Mudança de payload começa em `@legends/shared`** e é a única fonte de verdade do contrato; ajuste os dois lados.
- **Camadas finas:** route → service/hub → estado. Route só valida shape (`typeof msg.active === 'boolean'`) e chama `officeHub.confetti`; regra de negócio no hub.
- **Broadcast inclui o remetente** (mesmo padrão de `nearby-message`, sem predição local no cliente).
- **Anti-spoof:** todo handler do hub valida `this.socketOwner.get(socket) === userId` antes de agir.
- **Caminho de envio da client-message (cena → servidor):** `this.bridge.emitClientMessage({ type:'confetti', active })` (canal genérico público em `OfficeBridge`) → `useOfficeSocket` já reencaminha via `bridge.onClientMessage(msg => ws.send(JSON.stringify(msg)))`. **Não precisa mexer no `useOfficeSocket` nem no `OfficeBridge`** — o canal genérico já existe.
- **Mensagens visíveis ao usuário em pt-BR** (ex.: banner "🎉 Comemoração!").
- **Testes colocados AO LADO do código** (`*.test.ts(x)`).
- **Restrição do teste de `OfficeScene`:** o test file MOCKA `phaser` (`vi.mock('phaser', () => ({ default: { Scene: class {} } }))`) e NÃO instancia a cena (jsdom não tem canvas). Toda lógica testada da cena é exercida por (a) funções puras exportadas ou (b) `OfficeScene.prototype.<metodo>.call(fakeScene, ...)`. **Nenhum caminho de código testado pode referenciar `Phaser.*` em runtime** (só como anotação de tipo, que é apagada) — `this.add.*`, `this.tweens.*`, etc. são stubados no `fakeScene`.
- **Gate de verificação:** `pnpm test` (vitest). Antes dos testes da API subir o Postgres uma vez: `pnpm db:up`. Comandos por workspace:
  - `pnpm --filter @legends/shared test [caminho]`
  - `pnpm --filter @legends/api test [caminho]` (precisa Postgres de pé)
  - `pnpm --filter @legends/web test [caminho]`

---

## File Structure

- `packages/shared/src/office.ts` — **Modify:** adicionar 2 membros nas uniões `OfficeClientMessage`/`OfficeServerMessage`.
- `packages/shared/src/office.test.ts` — **Modify:** teste de contrato (type-level + runtime).
- `apps/api/src/lib/office-hub.ts` — **Modify:** constantes, estado (`confettiActive`, `lastCelebrationAt`), método `confetti()`, limpeza em `leave()`/`reset()`/`configure()`.
- `apps/api/src/lib/office-hub.test.ts` — **Modify:** testes do `confetti()` (broadcast, anti-spoof, threshold, cooldown, limpeza).
- `apps/api/src/routes/office-ws.ts` — **Modify:** branch `confetti` no switch de mensagens.
- `apps/api/src/routes/office-ws.test.ts` — **Modify:** roteamento + malformado.
- `apps/web/src/office/media/applause-sound.ts` — **Create:** som de aplausos/torcida via Web Audio puro (`playApplauseSound()`).
- `apps/web/src/office/media/applause-sound.test.ts` — **Create:** teste com `AudioContext` fake.
- `apps/web/src/office/scenes/OfficeScene.ts` — **Modify:** captura de `F` + envio (Task 5), emissor por personagem + config funcs + textura (Task 6), comemoração (Task 7).
- `apps/web/src/office/scenes/OfficeScene.test.ts` — **Modify:** testes de `emitConfetti`, `setConfetti`, `celebrate` e das config funcs.

---

## Task 1: Contrato em `@legends/shared`

**Files:**
- Modify: `packages/shared/src/office.ts:138-187` (uniões `OfficeClientMessage`/`OfficeServerMessage`)
- Test: `packages/shared/src/office.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `OfficeClientMessage` ganha `| { type: "confetti"; active: boolean }`
  - `OfficeServerMessage` ganha `| { type: "confetti"; userId: string; active: boolean }` e `| { type: "celebration" }`

- [ ] **Step 1: Escrever o teste de contrato que falha (só-tipos)**

Editar `packages/shared/src/office.test.ts`. Adicionar o import de tipos logo após o import existente (linha 9):

```ts
import type { OfficeClientMessage, OfficeServerMessage } from './index'
```

E adicionar, no fim do arquivo, um novo bloco `describe`:

```ts
describe('contrato de confete', () => {
  it('aceita as mensagens de confete/comemoração nas uniões', () => {
    const client: OfficeClientMessage = { type: 'confetti', active: true }
    const serverConfetti: OfficeServerMessage = { type: 'confetti', userId: 'ana', active: false }
    const serverCelebration: OfficeServerMessage = { type: 'celebration' }

    expect(client).toEqual({ type: 'confetti', active: true })
    expect(serverConfetti).toMatchObject({ type: 'confetti', userId: 'ana', active: false })
    expect(serverCelebration.type).toBe('celebration')
  })
})
```

- [ ] **Step 2: Rodar o typecheck e ver falhar (RED)**

O runtime (vitest/esbuild) apaga os tipos e passaria trivialmente; o sinal real é o `tsc`. Rodar:

Run: `pnpm --filter @legends/shared exec tsc -p tsconfig.json --noEmit 2>&1 | grep office.test`
Expected: uma linha de erro em `office.test.ts`, algo como
`src/office.test.ts(…): error TS2322: Type '{ type: "confetti"; active: boolean; }' is not assignable to type 'OfficeClientMessage'.`
(Os erros pré-existentes de `runtime-geometry.ts`/`office-map.ts` são ruído conhecido e NÃO aparecem no grep por `office.test`.)

- [ ] **Step 3: Implementar os membros das uniões**

Editar `packages/shared/src/office.ts`. Trocar a união `OfficeClientMessage` (linhas ~138-143) por:

```ts
export type OfficeClientMessage =
  | { type: "move"; dir: Direction }
  | { type: "call"; targetUserId: string }
  | { type: "call-response"; callerId: string; accepted: boolean }
  | { type: "nearby-message"; text: string; kind?: OfficeNearbyMessageKind }
  | { type: "room-chat-message"; text: string }
  /** Início/fim de "segurar F" — enviado no keydown/keyup físico (evento, não polling). */
  | { type: "confetti"; active: boolean };
```

E, na união `OfficeServerMessage`, inserir os dois membros logo antes de `| { type: "map-changed"; publicationId: string };` (linha ~187):

```ts
  /** Alguém começou/parou de lançar confete — rebroadcast pra todos, inclusive o remetente. */
  | { type: "confetti"; userId: string; active: boolean }
  /** Sinal (sem payload) pra todo mundo comemorar junto: banner + burst + som. */
  | { type: "celebration" }
  | { type: "map-changed"; publicationId: string };
```

- [ ] **Step 4: Rodar o typecheck e ver passar (GREEN)**

Run: `pnpm --filter @legends/shared exec tsc -p tsconfig.json --noEmit 2>&1 | grep office.test`
Expected: nenhuma saída (sem erros em `office.test.ts`).

Run: `pnpm --filter @legends/shared test src/office.test.ts`
Expected: PASS — `Test Files 1 passed`, incluindo `contrato de confete › aceita as mensagens de confete/comemoração nas uniões`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office.ts packages/shared/src/office.test.ts
git commit -m "feat(shared): mensagens de confete e comemoração no contrato do escritório"
```

---

## Task 2: Hub backend — `confetti()`, threshold e cooldown

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts`
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consumes: `OfficeServerMessage` (com `confetti`/`celebration` da Task 1); `OfficeSocket`; `socketOwner`, `entries`, `broadcast` (existentes).
- Produces:
  - `export const CELEBRATION_THRESHOLD = 5`
  - `export const CELEBRATION_COOLDOWN_MS = 4000`
  - `confetti(socket: OfficeSocket, userId: string, active: boolean): void` — anti-spoof, atualiza `confettiActive`, broadcast de `{ type:'confetti', userId, active }`, e broadcast de `{ type:'celebration' }` ao cruzar o threshold (respeitando o cooldown).
  - `leave()`/`reset()`/`configure()` limpam `confettiActive`.

- [ ] **Step 1: Escrever os testes que falham**

Editar `apps/api/src/lib/office-hub.test.ts`. Ampliar o import do hub (linha 9) para incluir as novas constantes:

```ts
import { OfficeHub, type OfficeSocket, CALL_COOLDOWN_MS, ROOM_CHAT_MESSAGE_MAX_LENGTH, CELEBRATION_THRESHOLD, CELEBRATION_COOLDOWN_MS } from './office-hub'
```

Adicionar, no fim do arquivo, o bloco de testes de confete:

```ts
describe('confetti', () => {
  /** Cria N usuários já dentro do escritório, com socket próprio. */
  function joinConfettiUsers(count: number): Array<{ socket: OfficeSocket; sent: OfficeServerMessage[]; id: string }> {
    const users: Array<{ socket: OfficeSocket; sent: OfficeServerMessage[]; id: string }> = []
    for (let i = 0; i < count; i += 1) {
      const id = `conf-${i}`
      const { socket, sent } = fakeSocket()
      hub.join(socket, { id, name: id, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
      users.push({ socket, sent, id })
    }
    return users
  }
  const celebrations = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'celebration').length

  it('faz broadcast de confetti (active true e false) para todos, inclusive o remetente', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.confetti(a.socket, 'ana', true)
    expect(a.sent).toContainEqual({ type: 'confetti', userId: 'ana', active: true })
    expect(b.sent).toContainEqual({ type: 'confetti', userId: 'ana', active: true })

    hub.confetti(a.socket, 'ana', false)
    expect(a.sent).toContainEqual({ type: 'confetti', userId: 'ana', active: false })
    expect(b.sent).toContainEqual({ type: 'confetti', userId: 'ana', active: false })
  })

  it('ignora confetti de socket cujo dono não bate com o userId (anti-spoof)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    // socket da ana tentando lançar confete EM NOME do bruno
    hub.confetti(a.socket, 'bruno', true)
    expect(a.sent.some((m) => m.type === 'confetti')).toBe(false)
    expect(b.sent.some((m) => m.type === 'confetti')).toBe(false)
  })

  it('dispara celebration só quando a contagem cruza de <5 para >=5', () => {
    const users = joinConfettiUsers(CELEBRATION_THRESHOLD)
    // os 4 primeiros: ainda abaixo do threshold, nada de celebration
    for (let i = 0; i < CELEBRATION_THRESHOLD - 1; i += 1) {
      hub.confetti(users[i].socket, users[i].id, true)
    }
    expect(celebrations(users[0].sent)).toBe(0)
    // o 5º cruza o threshold
    hub.confetti(users[CELEBRATION_THRESHOLD - 1].socket, users[CELEBRATION_THRESHOLD - 1].id, true)
    expect(celebrations(users[0].sent)).toBe(1)
  })

  it('respeita o cooldown de 4s antes de comemorar de novo (oscilar 4↔5)', () => {
    vi.useFakeTimers()
    try {
      const users = joinConfettiUsers(CELEBRATION_THRESHOLD)
      for (const u of users) hub.confetti(u.socket, u.id, true) // sobe a 5 → celebration #1
      expect(celebrations(users[0].sent)).toBe(1)

      const last = users[CELEBRATION_THRESHOLD - 1]
      last && hub.confetti(last.socket, last.id, false) // cai pra 4
      last && hub.confetti(last.socket, last.id, true) // volta pra 5 dentro do cooldown
      expect(celebrations(users[0].sent)).toBe(1) // sem 2ª comemoração

      vi.advanceTimersByTime(CELEBRATION_COOLDOWN_MS + 10)
      last && hub.confetti(last.socket, last.id, false)
      last && hub.confetti(last.socket, last.id, true) // cruza de novo, agora fora do cooldown
      expect(celebrations(users[0].sent)).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leave() limpa o confettiActive — quem sai não conta mais para o threshold', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.confetti(a.socket, 'ana', true) // ana entra na contagem
    hub.leave(a.socket, 'ana') // e deve sair dela ao desconectar

    const users = joinConfettiUsers(CELEBRATION_THRESHOLD)
    // Se a ana tivesse virado fantasma na contagem, o 4º já cruzaria o threshold.
    for (let i = 0; i < CELEBRATION_THRESHOLD - 1; i += 1) {
      hub.confetti(users[i].socket, users[i].id, true)
    }
    expect(celebrations(users[0].sent)).toBe(0)
    hub.confetti(users[CELEBRATION_THRESHOLD - 1].socket, users[CELEBRATION_THRESHOLD - 1].id, true)
    expect(celebrations(users[0].sent)).toBe(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar (RED)**

Run: `pnpm db:up` (só uma vez por sessão, se o Postgres ainda não estiver de pé)
Run: `pnpm --filter @legends/api test src/lib/office-hub.test.ts`
Expected: FAIL — os testes de `confetti` quebram porque `hub.confetti` não existe (`TypeError: hub.confetti is not a function`) e/ou `CELEBRATION_THRESHOLD`/`CELEBRATION_COOLDOWN_MS` são `undefined`.

- [ ] **Step 3: Implementar as constantes, o estado e o método**

Editar `apps/api/src/lib/office-hub.ts`.

(a) Após `export const ROOM_CHAT_MESSAGE_MAX_LENGTH = 500` (linha ~38), adicionar:

```ts
/** Quantas pessoas segurando F ao mesmo tempo disparam a comemoração coletiva. */
export const CELEBRATION_THRESHOLD = 5
/** Janela mínima entre comemorações — evita re-disparo com o grupo oscilando em 4↔5. */
export const CELEBRATION_COOLDOWN_MS = 4000
```

(b) Após o campo `private roomChat = new Map<string, StoredRoomChatMessage[]>()` (linha ~81), adicionar:

```ts
  /** Quem está segurando F agora, por userId (não por socket). Some no leave(). */
  private confettiActive = new Set<string>()
  /** Último instante (ms) de comemoração — base do cooldown. */
  private lastCelebrationAt = 0
```

(c) No `configure()`, no bloco `if (changed) { ... }`, trocar:

```ts
      this.lastCallAt.clear()
      this.roomChat.clear()
    }
```

por:

```ts
      this.lastCallAt.clear()
      this.roomChat.clear()
      this.confettiActive.clear()
    }
```

(d) No `leave()`, trocar:

```ts
    this.buckets.delete(userId) // última aba fechou: some o orçamento junto
    this.lastCallAt.delete(userId)
```

por:

```ts
    this.buckets.delete(userId) // última aba fechou: some o orçamento junto
    this.lastCallAt.delete(userId)
    this.confettiActive.delete(userId) // não deixa fantasma inflando a contagem de confete
```

(e) Inserir o método `confetti` logo antes do `reset()` (entre o fim de `roomChatMessage` e o comentário `/** Só para testes: ... */`):

```ts
  /**
   * Alguém começou/parou de lançar confete (segurar F). Relay para todos,
   * inclusive o remetente (sem predição local no cliente). Se essa atualização
   * fez a contagem cruzar de `< CELEBRATION_THRESHOLD` para `>=`, dispara
   * `celebration` — respeitando o `CELEBRATION_COOLDOWN_MS`.
   */
  confetti(socket: OfficeSocket, userId: string, active: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    if (!this.entries.has(userId)) return

    const wasBelow = this.confettiActive.size < CELEBRATION_THRESHOLD
    if (active) this.confettiActive.add(userId)
    else this.confettiActive.delete(userId)

    this.broadcast({ type: 'confetti', userId, active })

    if (active && wasBelow && this.confettiActive.size >= CELEBRATION_THRESHOLD) {
      const now = Date.now()
      if (now - this.lastCelebrationAt >= CELEBRATION_COOLDOWN_MS) {
        this.lastCelebrationAt = now
        this.broadcast({ type: 'celebration' })
      }
    }
  }

```

(f) No `reset()`, trocar:

```ts
    this.roomChat.clear()
    this.runtime = null
  }
```

por:

```ts
    this.roomChat.clear()
    this.confettiActive.clear()
    this.lastCelebrationAt = 0
    this.runtime = null
  }
```

- [ ] **Step 4: Rodar e ver passar (GREEN)**

Run: `pnpm --filter @legends/api test src/lib/office-hub.test.ts`
Expected: PASS — todos os `describe('confetti', ...)` verdes e os testes pré-existentes intactos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): OfficeHub.confetti com threshold e cooldown de comemoração"
```

---

## Task 3: Rota WS — rotear `confetti` para o hub

**Files:**
- Modify: `apps/api/src/routes/office-ws.ts:91-106` (switch de `ws.on('message')`)
- Test: `apps/api/src/routes/office-ws.test.ts`

**Interfaces:**
- Consumes: `officeHub.confetti(socket, userId, active)` (Task 2); `OfficeClientMessage` (Task 1).
- Produces: nenhum símbolo novo — só o roteamento `msg.type === 'confetti'` → `officeHub.confetti(ws, user.id, msg.active)`.

- [ ] **Step 1: Escrever os testes que falham**

Editar `apps/api/src/routes/office-ws.test.ts`. Adicionar dois testes dentro do `describe('office websocket', ...)` (ex.: no fim, antes do `})` que fecha o describe):

```ts
  it('despacha confetti pro hub com os parâmetros certos', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-confetti@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    const spy = vi.spyOn(officeHub, 'confetti')
    ws.send(JSON.stringify({ type: 'confetti', active: true }))
    await delay(100)

    expect(spy).toHaveBeenCalledWith(expect.anything(), ana.id, true)

    spy.mockRestore()
    ws.close()
    await app.close()
  })

  it('mensagem de confetti malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana-confetti-bad@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send(JSON.stringify({ type: 'confetti' })) // sem active
    ws.send(JSON.stringify({ type: 'confetti', active: 'sim' })) // shape errado
    await delay(120)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
    await app.close()
  })
```

- [ ] **Step 2: Rodar e ver falhar (RED)**

Run: `pnpm --filter @legends/api test src/routes/office-ws.test.ts`
Expected: FAIL — `despacha confetti pro hub...` falha porque a rota ainda não chama `officeHub.confetti` (spy não é chamado): `expected "confetti" to be called with arguments: [ Anything, …, true ]`.

- [ ] **Step 3: Implementar o branch no switch**

Editar `apps/api/src/routes/office-ws.ts`. Trocar:

```ts
        } else if (msg.type === 'room-chat-message' && typeof msg.text === 'string') {
          officeHub.roomChatMessage(ws, user.id, msg.text)
        }
      })
```

por:

```ts
        } else if (msg.type === 'room-chat-message' && typeof msg.text === 'string') {
          officeHub.roomChatMessage(ws, user.id, msg.text)
        } else if (msg.type === 'confetti' && typeof msg.active === 'boolean') {
          officeHub.confetti(ws, user.id, msg.active)
        }
      })
```

- [ ] **Step 4: Rodar e ver passar (GREEN)**

Run: `pnpm --filter @legends/api test src/routes/office-ws.test.ts`
Expected: PASS — os dois testes novos verdes e os pré-existentes intactos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/office-ws.ts apps/api/src/routes/office-ws.test.ts
git commit -m "feat(api): rota WS roteia mensagem confetti para o hub"
```

---

## Task 4: Módulo `applause-sound.ts` (Web Audio puro)

**Files:**
- Create: `apps/web/src/office/media/applause-sound.ts`
- Test: `apps/web/src/office/media/applause-sound.test.ts`

**Interfaces:**
- Consumes: `globalThis.AudioContext` (com fallback `webkitAudioContext`).
- Produces: `export function playApplauseSound(): void` — sem estado, sem cleanup manual; cria um `AudioContext` sob demanda, agenda palmas (ruído branco passa-alta) + torcida (ruído passa-baixa) e fecha o contexto no fim. No-op silencioso se não houver `AudioContext`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/office/media/applause-sound.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'

function installFakeAudio() {
  const makeNode = () => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    type: '',
    buffer: null as unknown,
    frequency: { value: 0 },
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  })
  const buffer = { getChannelData: vi.fn(() => new Float32Array(16)) }
  const ctx = {
    state: 'running' as const,
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createGain: vi.fn(() => makeNode()),
    createBufferSource: vi.fn(() => makeNode()),
    createBiquadFilter: vi.fn(() => makeNode()),
    createBuffer: vi.fn(() => buffer),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  }
  vi.stubGlobal('AudioContext', vi.fn(() => ctx))
  return { ctx, buffer }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('playApplauseSound', () => {
  it('sintetiza palmas + torcida (fontes de ruído filtrado agendadas)', async () => {
    const fake = installFakeAudio()
    const { playApplauseSound } = await import('./applause-sound')

    playApplauseSound()

    // várias palmas (ruído branco) + o leito de torcida = múltiplas buffer sources
    expect(fake.ctx.createBufferSource.mock.calls.length).toBeGreaterThan(1)
    // filtros (passa-alta das palmas, passa-baixa da torcida)
    expect(fake.ctx.createBiquadFilter).toHaveBeenCalled()
    // preencheu o buffer de ruído com amostras
    expect(fake.buffer.getChannelData).toHaveBeenCalled()
    // ao menos uma fonte foi disparada
    const anyStarted = fake.ctx.createBufferSource.mock.results.some((r) => r.value.start.mock.calls.length > 0)
    expect(anyStarted).toBe(true)
  })

  it('não lança quando o navegador não tem AudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { playApplauseSound } = await import('./applause-sound')
    expect(() => playApplauseSound()).not.toThrow()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar (RED)**

Run: `pnpm --filter @legends/web test src/office/media/applause-sound.test.ts`
Expected: FAIL — `Failed to load … applause-sound` / módulo não existe.

- [ ] **Step 3: Implementar o módulo**

Criar `apps/web/src/office/media/applause-sound.ts`:

```ts
/**
 * Aplausos + torcida sintetizados via Web Audio API pura — sem asset de áudio
 * (coerente com o escritório, que gera tudo em runtime). Chamado sob um gesto
 * do usuário (segurar F conta), então a política de autoplay dos browsers é
 * respeitada. Cria um AudioContext descartável por comemoração e o fecha quando
 * o envelope zera; comemorações têm cooldown de 4s no servidor, então não há
 * risco de estourar o limite de contextos do browser.
 */
export function playApplauseSound(): void {
  const globalAny = globalThis as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctor = globalAny.AudioContext ?? globalAny.webkitAudioContext
  if (!Ctor) return

  let ctx: AudioContext
  try {
    ctx = new Ctor()
  } catch {
    return
  }

  try {
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime

    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)

    const DURATION = 1.5
    const CLAP_COUNT = 26

    // "Palmas": estouros curtos de ruído branco passa-alta, espalhados no tempo.
    for (let i = 0; i < CLAP_COUNT; i += 1) {
      const at = now + Math.random() * DURATION
      const noise = ctx.createBufferSource()
      noise.buffer = makeNoiseBuffer(ctx, 0.08)
      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 1500 + Math.random() * 1500
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
      noise.connect(highpass)
      highpass.connect(gain)
      gain.connect(master)
      noise.start(at)
      noise.stop(at + 0.1)
    }

    // "Torcida": leito de ruído passa-baixa por baixo das palmas, com fade out.
    const bed = ctx.createBufferSource()
    bed.buffer = makeNoiseBuffer(ctx, DURATION + 0.5)
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 900
    const bedGain = ctx.createGain()
    bedGain.gain.setValueAtTime(0.0001, now)
    bedGain.gain.exponentialRampToValueAtTime(0.08, now + 0.3)
    bedGain.gain.exponentialRampToValueAtTime(0.0001, now + DURATION + 0.4)
    bed.connect(lowpass)
    lowpass.connect(bedGain)
    bedGain.connect(master)
    bed.start(now)
    bed.stop(now + DURATION + 0.5)

    // Fecha o contexto depois que tudo terminou, pra não vazar. `.unref()`
    // quando existir (Node/jsdom nos testes) pra não segurar o event loop.
    const closeTimer = globalThis.setTimeout(() => {
      if (typeof ctx.close === 'function') void ctx.close().catch(() => {})
    }, (DURATION + 0.9) * 1000)
    ;(closeTimer as unknown as { unref?: () => void }).unref?.()
  } catch {
    // som é opcional: nunca deixar o áudio quebrar a comemoração
  }
}

/** Buffer mono de ruído branco de `seconds` de duração. */
function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}
```

- [ ] **Step 4: Rodar e ver passar (GREEN)**

Run: `pnpm --filter @legends/web test src/office/media/applause-sound.test.ts`
Expected: PASS — `playApplauseSound › sintetiza palmas + torcida …` e `… não lança quando o navegador não tem AudioContext`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/applause-sound.ts apps/web/src/office/media/applause-sound.test.ts
git commit -m "feat(web): som de aplausos/torcida sintetizado via Web Audio"
```

---

## Task 5: `OfficeScene` — capturar `F` e enviar `confetti`

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (campos ~95-106, `setInputLocked` ~151-154, `create` ~264-272 e bloco DESTROY ~292-302)
- Test: `apps/web/src/office/scenes/OfficeScene.test.ts`

**Interfaces:**
- Consumes: `this.bridge.emitClientMessage({ type:'confetti', active })` (canal genérico existente); `this.inputLocked`; `this.releaseDirectionKeys()`.
- Produces:
  - campo `private confettiKeyHeld = false`
  - campos arrow `private readonly handleConfettiDown/handleConfettiUp/handleBlur`
  - método `private emitConfetti(active: boolean): void` (guard de `inputLocked`, dedupe por `confettiKeyHeld`, envia a client-message)
  - `setInputLocked(true)` passa a forçar `emitConfetti(false)`
  - `create()` registra `keyboard.addKey('F')` + listeners `down`/`up` e o listener `Phaser.Core.Events.BLUR`; DESTROY remove o BLUR.

- [ ] **Step 1: Escrever os testes que falham**

Editar `apps/web/src/office/scenes/OfficeScene.test.ts`. Logo após o import `import { computeScreenPosition, OfficeScene } from './OfficeScene'` (linha 14), adicionar um acessor tipado aos métodos privados testados via `prototype.call` (cast por `unknown` — não valida existência em tempo de tipo, e o RED de runtime vem do método ainda inexistente):

```ts
const scenePrivate = OfficeScene.prototype as unknown as {
  emitConfetti(this: unknown, active: boolean): void
  setConfetti(this: unknown, userId: string, active: boolean): void
  celebrate(this: unknown): void
}
```

Adicionar, no fim do arquivo, o bloco de testes da tecla F:

```ts
describe('OfficeScene.emitConfetti (segurar F)', () => {
  function fakeScene() {
    return { inputLocked: false, confettiKeyHeld: false, bridge: { emitClientMessage: vi.fn() } }
  }

  it('keydown envia confetti active:true e keyup envia active:false', () => {
    const s = fakeScene()
    scenePrivate.emitConfetti.call(s, true)
    scenePrivate.emitConfetti.call(s, false)
    expect(s.bridge.emitClientMessage.mock.calls).toEqual([
      [{ type: 'confetti', active: true }],
      [{ type: 'confetti', active: false }],
    ])
  })

  it('não reenvia enquanto já está segurando (dedupe por transição)', () => {
    const s = fakeScene()
    scenePrivate.emitConfetti.call(s, true)
    scenePrivate.emitConfetti.call(s, true)
    expect(s.bridge.emitClientMessage).toHaveBeenCalledTimes(1)
  })

  it('ignora keydown enquanto o input está travado (chat aberto etc.)', () => {
    const s = { ...fakeScene(), inputLocked: true }
    scenePrivate.emitConfetti.call(s, true)
    expect(s.bridge.emitClientMessage).not.toHaveBeenCalled()
  })

  it('setInputLocked(true) força o fim do confete se estava segurando', () => {
    // `setInputLocked` chama `this.releaseDirectionKeys()` e `this.emitConfetti(false)`,
    // então o fakeScene precisa expor ambos: releaseDirectionKeys como no-op e
    // emitConfetti como a implementação REAL (pra exercer o dedupe + o envio).
    const s = {
      inputLocked: false,
      confettiKeyHeld: false,
      bridge: { emitClientMessage: vi.fn() },
      releaseDirectionKeys: () => {},
      emitConfetti: scenePrivate.emitConfetti,
    }
    // simula estar segurando F (roda a impl real com this = s)
    s.emitConfetti(true)
    s.bridge.emitClientMessage.mockClear()

    OfficeScene.prototype.setInputLocked.call(s as unknown as OfficeScene, true)
    expect(s.bridge.emitClientMessage).toHaveBeenCalledWith({ type: 'confetti', active: false })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar (RED)**

Run: `pnpm --filter @legends/web test src/office/scenes/OfficeScene.test.ts`
Expected: FAIL — `scenePrivate.emitConfetti` é `undefined` (`Cannot read properties of undefined (reading 'call')`), e o teste de `setInputLocked` não vê o `emitClientMessage({ type:'confetti', active:false })`.

- [ ] **Step 3: Implementar campos, handlers, `emitConfetti` e `setInputLocked`**

Editar `apps/web/src/office/scenes/OfficeScene.ts`.

(a) Adicionar o campo `confettiKeyHeld` logo após `private inputLocked = false` (linha ~102):

```ts
  private inputLocked = false
  /** True enquanto F está fisicamente segurado — dedupe do keydown/keyup. */
  private confettiKeyHeld = false
```

(b) Adicionar os handlers arrow logo após `private readonly handleScaleResize = () => this.applyCameraZoom()` (linha ~106):

```ts
  private readonly handleScaleResize = () => this.applyCameraZoom()
  private readonly handleConfettiDown = () => this.emitConfetti(true)
  private readonly handleConfettiUp = () => this.emitConfetti(false)
  private readonly handleBlur = () => this.emitConfetti(false)
```

(c) Trocar o `setInputLocked` (linhas ~151-154) por:

```ts
  setInputLocked(locked: boolean): void {
    this.inputLocked = locked
    if (locked) {
      this.releaseDirectionKeys()
      this.emitConfetti(false)
    }
  }

  /**
   * Início/fim de "segurar F" — uma mensagem por transição física (dedupe via
   * `confettiKeyHeld`). Travado por `inputLocked` (chat aberto etc.) pra não
   * disparar sem querer. O servidor rebroadcasta pra todos, inclusive de volta
   * pra você (sem predição local).
   */
  private emitConfetti(active: boolean): void {
    if (active && this.inputLocked) return
    if (active === this.confettiKeyHeld) return
    this.confettiKeyHeld = active
    this.bridge.emitClientMessage({ type: 'confetti', active })
  }
```

(d) No `create()`, trocar o bloco de teclas (linhas ~264-272):

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

por:

```ts
    const keyboard = this.input.keyboard
    if (keyboard) {
      this.keys = {
        up: [keyboard.addKey('UP'), keyboard.addKey('W')],
        down: [keyboard.addKey('DOWN'), keyboard.addKey('S')],
        left: [keyboard.addKey('LEFT'), keyboard.addKey('A')],
        right: [keyboard.addKey('RIGHT'), keyboard.addKey('D')],
      }
      // F = lançar confete. Eventos físicos da Key (não polling em update()):
      // um keydown e um keyup por "segurada", independente da duração.
      const confettiKey = keyboard.addKey('F')
      confettiKey.on('down', this.handleConfettiDown)
      confettiKey.on('up', this.handleConfettiUp)
    }
    // Alt-tab / perda de foco da aba com F segurado: encerra o confete pra o
    // servidor não achar que a pessoa segura pra sempre.
    this.sys.game.events.on(Phaser.Core.Events.BLUR, this.handleBlur)
```

(e) No bloco `this.events.once(Phaser.Scenes.Events.DESTROY, () => { ... })`, adicionar a remoção do listener de BLUR. Trocar:

```ts
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleScaleResize)
      this.focusTimer?.remove(false)
```

por:

```ts
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleScaleResize)
      this.sys.game.events.off(Phaser.Core.Events.BLUR, this.handleBlur)
      this.focusTimer?.remove(false)
```

- [ ] **Step 4: Rodar e ver passar (GREEN)**

Run: `pnpm --filter @legends/web test src/office/scenes/OfficeScene.test.ts`
Expected: PASS — o novo `describe('OfficeScene.emitConfetti (segurar F)', …)` verde; `computeScreenPosition`/`getScreenPosition` intactos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/scenes/OfficeScene.test.ts
git commit -m "feat(web): OfficeScene captura F e envia confetti (com guard de lock e blur)"
```

---

## Task 6: `OfficeScene` — emissor de confete por personagem

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (após `computeScreenPosition` ~85; campo ~95; `preload` ~168-182; `handle` ~366-416; `destroyCharacter` ~424-433)
- Test: `apps/web/src/office/scenes/OfficeScene.test.ts`

**Interfaces:**
- Consumes: `OfficeServerMessage` `{ type:'confetti', userId, active }` (Task 1); `this.add.particles`, `this.characters`.
- Produces:
  - `export const CONFETTI_TEXTURE = 'office-confetti'`
  - `export const CONFETTI_COLORS: number[]`
  - `export function confettiLaunchConfig(): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig`
  - campo `private confettiEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>()`
  - método `private setConfetti(userId: string, active: boolean): void`
  - `handle()` trata `case 'confetti'`; `preload()` gera a textura; `destroyCharacter()` destrói o emissor.

- [ ] **Step 1: Escrever os testes que falham**

Editar `apps/web/src/office/scenes/OfficeScene.test.ts`. Ampliar o import da cena (linha 14) para trazer as novas exports:

```ts
import {
  computeScreenPosition,
  OfficeScene,
  confettiLaunchConfig,
  CONFETTI_TEXTURE,
  CONFETTI_COLORS,
} from './OfficeScene'
```

Adicionar, no fim do arquivo, dois blocos:

```ts
describe('confettiLaunchConfig', () => {
  it('descreve um LANÇAMENTO (leque pra cima) e não uma chuva', () => {
    const config = confettiLaunchConfig()
    expect(config).toMatchObject({
      angle: { min: -120, max: -60 },
      speed: { min: 120, max: 260 },
      gravityY: 260,
      lifespan: 900,
      quantity: 2,
      frequency: 35,
      tint: CONFETTI_COLORS,
    })
    expect(CONFETTI_COLORS.length).toBeGreaterThanOrEqual(6)
  })
})

describe('OfficeScene.setConfetti (emissor por personagem)', () => {
  function fakeEmitter() {
    return {
      setDepth: vi.fn().mockReturnThis(),
      startFollow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    }
  }

  it('cria o emissor no primeiro active:true, seguindo o container', () => {
    const emitter = fakeEmitter()
    const view = { container: { id: 'container-ana' } }
    const s = {
      characters: new Map([['ana', view]]),
      confettiEmitters: new Map(),
      add: { particles: vi.fn(() => emitter) },
    }

    scenePrivate.setConfetti.call(s, 'ana', true)

    expect(s.add.particles).toHaveBeenCalledWith(0, 0, CONFETTI_TEXTURE, confettiLaunchConfig())
    expect(emitter.startFollow).toHaveBeenCalledWith(view.container)
    expect(s.confettiEmitters.get('ana')).toBe(emitter)
  })

  it('reaproveita o emissor e só para (stop) no active:false — sem sumir abrupto', () => {
    const emitter = fakeEmitter()
    const view = { container: { id: 'container-ana' } }
    const s = {
      characters: new Map([['ana', view]]),
      confettiEmitters: new Map(),
      add: { particles: vi.fn(() => emitter) },
    }

    scenePrivate.setConfetti.call(s, 'ana', true)
    scenePrivate.setConfetti.call(s, 'ana', true) // reaproveita
    expect(s.add.particles).toHaveBeenCalledTimes(1)
    expect(emitter.start).toHaveBeenCalledTimes(1)

    scenePrivate.setConfetti.call(s, 'ana', false)
    expect(emitter.stop).toHaveBeenCalledTimes(1)
  })

  it('é no-op para userId sem personagem spawnado', () => {
    const s = {
      characters: new Map(),
      confettiEmitters: new Map(),
      add: { particles: vi.fn() },
    }
    scenePrivate.setConfetti.call(s, 'ninguem', true)
    expect(s.add.particles).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar (RED)**

Run: `pnpm --filter @legends/web test src/office/scenes/OfficeScene.test.ts`
Expected: FAIL — o import de `confettiLaunchConfig`/`CONFETTI_TEXTURE`/`CONFETTI_COLORS` resolve `undefined` e `scenePrivate.setConfetti` é `undefined`.

- [ ] **Step 3: Implementar constantes, config func, textura, `setConfetti`, `handle` e cleanup**

Editar `apps/web/src/office/scenes/OfficeScene.ts`.

(a) Logo após a função `computeScreenPosition` (fecha na linha ~85), adicionar o bloco de constantes e a config func:

```ts
/** Textura (4×4 branco) da partícula de confete; a cor real vem do `tint`. */
export const CONFETTI_TEXTURE = 'office-confetti'
/** Paleta de confete — o emissor sorteia uma cor por partícula via `tint`. */
export const CONFETTI_COLORS = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x8338ec, 0xff9f1c]
/** Confete acima dos personagens (que usam depth ~ y do tile). */
const CONFETTI_DEPTH = 10_000

/** Config de LANÇAMENTO (canhão de festa saindo do personagem), não chuva de cima. */
export function confettiLaunchConfig(): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  return {
    angle: { min: -120, max: -60 },
    speed: { min: 120, max: 260 },
    gravityY: 260,
    lifespan: 900,
    quantity: 2,
    frequency: 35,
    scale: { start: 1, end: 0.3 },
    rotate: { start: 0, end: 360 },
    tint: CONFETTI_COLORS,
  }
}
```

(b) Adicionar o campo `confettiEmitters` logo após `private characters = new Map<string, CharacterView>()` (linha ~95):

```ts
  private characters = new Map<string, CharacterView>()
  /** Emissor de confete por userId, paralelo a `characters`. */
  private confettiEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>()
```

(c) No `preload()`, gerar a textura de confete reaproveitando o mesmo `Graphics`. Trocar:

```ts
    g.generateTexture('char-loading', 24, 24)

    g.destroy()
  }
```

por:

```ts
    g.generateTexture('char-loading', 24, 24)

    // Partícula de confete: quadradinho branco 4×4 (a cor vem do tint por partícula).
    g.clear()
    g.fillStyle(0xffffff, 1)
    g.fillRect(0, 0, 4, 4)
    g.generateTexture(CONFETTI_TEXTURE, 4, 4)

    g.destroy()
  }
```

(d) No `handle()`, adicionar o `case 'confetti'` no fim do switch. Trocar o trecho final do `case 'avatar-updated'` + fecho do switch:

```ts
          )
        }
        break
      }
    }
  }
```

por:

```ts
          )
        }
        break
      }
      case 'confetti':
        this.setConfetti(message.userId, message.active)
        break
    }
  }
```

(e) Inserir o método `setConfetti` logo após `handle()` e antes do comentário de `destroyCharacter` (linha ~417):

```ts
  /**
   * Cria (ou reaproveita) o emissor de confete de um personagem, fazendo-o
   * seguir o container pra acompanhar a pessoa andando. `active:false` só
   * `stop()`: as partículas em voo terminam naturalmente, sem sumir abrupto.
   */
  private setConfetti(userId: string, active: boolean): void {
    const view = this.characters.get(userId)
    if (!view) return
    if (!active) {
      this.confettiEmitters.get(userId)?.stop()
      return
    }
    const existing = this.confettiEmitters.get(userId)
    if (existing) {
      existing.start()
      return
    }
    const emitter = this.add.particles(0, 0, CONFETTI_TEXTURE, confettiLaunchConfig())
    emitter.setDepth(CONFETTI_DEPTH)
    emitter.startFollow(view.container)
    this.confettiEmitters.set(userId, emitter)
  }

```

(f) No `destroyCharacter()`, destruir o emissor do userId junto do container. Trocar:

```ts
    this.clearBubble(view)
    view.container.destroy()
    this.characters.delete(userId)
  }
```

por:

```ts
    this.clearBubble(view)
    const emitter = this.confettiEmitters.get(userId)
    if (emitter) {
      emitter.stop()
      emitter.destroy()
      this.confettiEmitters.delete(userId)
    }
    view.container.destroy()
    this.characters.delete(userId)
  }
```

(g) No bloco DESTROY (`this.events.once(Phaser.Scenes.Events.DESTROY, …)`), destruir os emissores restantes. Trocar:

```ts
      this.characters.clear()
      this.keys = null
    })
```

por:

```ts
      for (const emitter of this.confettiEmitters.values()) emitter.destroy()
      this.confettiEmitters.clear()
      this.characters.clear()
      this.keys = null
    })
```

- [ ] **Step 4: Rodar e ver passar (GREEN)**

Run: `pnpm --filter @legends/web test src/office/scenes/OfficeScene.test.ts`
Expected: PASS — `confettiLaunchConfig` e `OfficeScene.setConfetti (emissor por personagem)` verdes; testes das Tasks anteriores intactos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/scenes/OfficeScene.test.ts
git commit -m "feat(web): OfficeScene renderiza confete lançado por personagem"
```

---

## Task 7: `OfficeScene` — comemoração (banner + burst + som)

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (imports ~1-17; consts após `confettiLaunchConfig`; `handle` `case 'celebration'`; novo método `celebrate`)
- Test: `apps/web/src/office/scenes/OfficeScene.test.ts`

**Interfaces:**
- Consumes: `OfficeServerMessage` `{ type:'celebration' }` (Task 1); `playApplauseSound` (Task 4); `CONFETTI_TEXTURE`/`CONFETTI_COLORS` (Task 6); `this.add.text`, `this.add.particles`, `this.tweens.add`, `this.time.delayedCall`, `this.scale.width`.
- Produces:
  - `export function confettiBurstConfig(width: number): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig`
  - método `private celebrate(): void` (banner fixo na câmera com fade, burst de tela cheia, `playApplauseSound()`)
  - `handle()` trata `case 'celebration'`.

- [ ] **Step 1: Escrever os testes que falham**

Editar `apps/web/src/office/scenes/OfficeScene.test.ts`.

Adicionar o mock do módulo de som logo abaixo do `vi.mock('phaser', …)` (linha ~12):

```ts
vi.mock('../media/applause-sound', () => ({ playApplauseSound: vi.fn() }))
```

Ampliar o import da cena (que na Task 6 já traz `confettiLaunchConfig` etc.) para incluir `confettiBurstConfig`, e importar o `playApplauseSound` mockado:

```ts
import {
  computeScreenPosition,
  OfficeScene,
  confettiLaunchConfig,
  confettiBurstConfig,
  CONFETTI_TEXTURE,
  CONFETTI_COLORS,
} from './OfficeScene'
import { playApplauseSound } from '../media/applause-sound'
```

Adicionar, no fim do arquivo, dois blocos:

```ts
describe('confettiBurstConfig', () => {
  it('espalha o burst pela largura da tela e cai (comemoração)', () => {
    const config = confettiBurstConfig(1000)
    expect(config).toMatchObject({
      x: { min: 0, max: 1000 },
      y: 0,
      angle: { min: 60, max: 120 },
      emitting: false,
      tint: CONFETTI_COLORS,
    })
  })
})

describe('OfficeScene.celebrate (comemoração)', () => {
  it('mostra banner fixo na câmera, dispara burst e toca aplausos', () => {
    const banner = {
      setOrigin: vi.fn().mockReturnThis(),
      setScrollFactor: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setAlpha: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    }
    const burst = {
      setDepth: vi.fn().mockReturnThis(),
      setScrollFactor: vi.fn().mockReturnThis(),
      explode: vi.fn(),
      destroy: vi.fn(),
    }
    const s = {
      scale: { width: 800 },
      add: { text: vi.fn(() => banner), particles: vi.fn(() => burst) },
      tweens: { add: vi.fn() },
      time: { delayedCall: vi.fn() },
    }

    scenePrivate.celebrate.call(s)

    // banner com o texto pt-BR, centrado horizontalmente e fixo na viewport
    expect(s.add.text).toHaveBeenCalledWith(400, expect.any(Number), '🎉 Comemoração!', expect.any(Object))
    expect(banner.setScrollFactor).toHaveBeenCalledWith(0)
    expect(s.tweens.add).toHaveBeenCalled()
    // burst de tela cheia, fixo na câmera, disparado de uma vez
    expect(s.add.particles).toHaveBeenCalledWith(0, 0, CONFETTI_TEXTURE, confettiBurstConfig(800))
    expect(burst.setScrollFactor).toHaveBeenCalledWith(0)
    expect(burst.explode).toHaveBeenCalled()
    // som sintetizado
    expect(playApplauseSound).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar (RED)**

Run: `pnpm --filter @legends/web test src/office/scenes/OfficeScene.test.ts`
Expected: FAIL — `confettiBurstConfig` é `undefined` no import e `scenePrivate.celebrate` é `undefined`.

- [ ] **Step 3: Implementar import, `confettiBurstConfig`, `celebrate` e o `case 'celebration'`**

Editar `apps/web/src/office/scenes/OfficeScene.ts`.

(a) Adicionar o import do som logo após o import de `./officeMapTiles` (linha ~17):

```ts
import { officeMapTileFrame } from './officeMapTiles'
import { playApplauseSound } from '../media/applause-sound'
```

(b) Logo após a função `confettiLaunchConfig` (adicionada na Task 6), acrescentar as consts da comemoração e a config do burst:

```ts
/** Comemoração acima de tudo (banner e burst fixos na câmera). */
const CELEBRATION_DEPTH = 20_000
const CONFETTI_BURST_COUNT = 140
const CONFETTI_BURST_LIFESPAN = 2200

/** Burst único de tela cheia: linha no topo da viewport, caindo pela largura. */
export function confettiBurstConfig(width: number): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  return {
    x: { min: 0, max: width },
    y: 0,
    angle: { min: 60, max: 120 },
    speed: { min: 160, max: 340 },
    gravityY: 320,
    lifespan: CONFETTI_BURST_LIFESPAN,
    scale: { start: 1, end: 0.4 },
    rotate: { start: 0, end: 360 },
    tint: CONFETTI_COLORS,
    emitting: false,
  }
}
```

(c) No `handle()`, adicionar o `case 'celebration'` logo após o `case 'confetti'` (adicionado na Task 6). Trocar:

```ts
      case 'confetti':
        this.setConfetti(message.userId, message.active)
        break
    }
  }
```

por:

```ts
      case 'confetti':
        this.setConfetti(message.userId, message.active)
        break
      case 'celebration':
        this.celebrate()
        break
    }
  }
```

(d) Inserir o método `celebrate` logo após `setConfetti` (adicionado na Task 6):

```ts
  /**
   * Comemoração coletiva (5+ segurando F): banner fixo na câmera com fade,
   * burst de confete cobrindo a tela e aplausos sintetizados. Tudo efêmero e
   * fixo na viewport (scrollFactor 0), some sozinho.
   */
  private celebrate(): void {
    const width = this.scale.width
    const banner = this.add
      .text(width / 2, 72, '🎉 Comemoração!', {
        fontFamily: 'sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        backgroundColor: '#7c3aed',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(CELEBRATION_DEPTH)
      .setAlpha(0)
    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 400,
      hold: 2200,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => banner.destroy(),
    })

    const burst = this.add.particles(0, 0, CONFETTI_TEXTURE, confettiBurstConfig(width))
    burst.setDepth(CELEBRATION_DEPTH - 1)
    burst.setScrollFactor(0)
    burst.explode(CONFETTI_BURST_COUNT)
    this.time.delayedCall(CONFETTI_BURST_LIFESPAN + 300, () => burst.destroy())

    playApplauseSound()
  }

```

- [ ] **Step 4: Rodar e ver passar (GREEN)**

Run: `pnpm --filter @legends/web test src/office/scenes/OfficeScene.test.ts`
Expected: PASS — `confettiBurstConfig` e `OfficeScene.celebrate (comemoração)` verdes; tudo anterior intacto.

- [ ] **Step 5: Rodar a suíte web inteira (regressão) e commitar**

Run: `pnpm --filter @legends/web test`
Expected: PASS — nenhuma regressão nos demais testes do escritório.

```bash
git add apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/scenes/OfficeScene.test.ts
git commit -m "feat(web): comemoração no escritório (banner + burst + aplausos)"
```

---

## Verificação final (após a Task 7)

- [ ] Suíte completa dos três workspaces:

```bash
pnpm db:up
pnpm --filter @legends/shared test
pnpm --filter @legends/api test
pnpm --filter @legends/web test
```

Expected: tudo verde. Fluxo manual (opcional, fora do gate automatizado): abrir o Escritório em duas abas, segurar `F` numa → confete lançando; com 5 pessoas segurando → banner + burst + aplausos.

---

## Self-Review

**1. Cobertura da spec**

| Requisito da spec | Task |
| --- | --- |
| Protocolo: client `{confetti, active}`; server `{confetti, userId, active}` + `{celebration}` | Task 1 |
| Estado `confettiActive: Set<string>` por userId | Task 2 |
| `confetti(socket, userId, active)` com anti-spoof + broadcast (inclui remetente) | Task 2 |
| Threshold fixo `CELEBRATION_THRESHOLD = 5` exportado | Task 2 |
| Comemoração ao cruzar `<5 → >=5` com `CELEBRATION_COOLDOWN_MS = 4000` | Task 2 |
| `leave()` e `reset()` limpam o Set (+ `configure()` por consistência) | Task 2 |
| Rota WS: `msg.type==='confetti' && typeof active==='boolean'` → hub | Task 3 |
| `keyboard.addKey('F')`, eventos `down`/`up` (não polling) | Task 5 |
| Guard de `inputLocked`; forçar `active:false` em `setInputLocked(true)` | Task 5 |
| Forçar `active:false` no `Phaser.Core.Events.BLUR` | Task 5 |
| Textura de partícula 4×4 gerada em runtime; paleta ~6 cores via `tint` | Task 6 |
| `Map<userId, ParticleEmitter>` paralelo a `characters` | Task 6 |
| Config de LANÇAMENTO (angle/speed/gravityY/lifespan/quantity/frequency/scale/rotate) | Task 6 |
| `active:false` → `stop()`; `startFollow(container)` | Task 6 |
| `destroyCharacter` destrói o emissor | Task 6 |
| Banner "🎉 Comemoração!" fixo na câmera com fade | Task 7 |
| Burst único cobrindo a largura da tela, fixo na câmera, sem follow | Task 7 |
| `playApplauseSound()` via Web Audio puro (palmas + torcida) | Tasks 4, 7 |
| Testes: hub (broadcast/threshold/cooldown/leave), rota, cena (lock/emissor/celebration) | Tasks 2, 3, 5, 6, 7 |
| Nada persiste no Postgres | Global Constraints (nenhuma migration/Prisma tocada) |

Sem lacunas.

**2. Scan de placeholders**

Nenhum "TBD/TODO/implementar depois". Todo step de código traz o código completo; comandos e outputs esperados são exatos.

**3. Consistência de tipos/nomes entre tasks**

- `confetti(socket, userId, active)` — assinatura idêntica em Task 2 (def), Task 3 (chamada `officeHub.confetti(ws, user.id, msg.active)`).
- `CELEBRATION_THRESHOLD`/`CELEBRATION_COOLDOWN_MS` — definidas na Task 2, importadas no teste da Task 2. `CELEBRATION_DEPTH` (cliente, Task 7) é um nome distinto e intencional (depth de render), sem colisão.
- `emitConfetti(active)` (Task 5), `setConfetti(userId, active)` (Task 6), `celebrate()` (Task 7) — todos no `scenePrivate` (definido uma vez na Task 5) com as mesmas assinaturas usadas nos testes e nas chamadas de `handle()`.
- `CONFETTI_TEXTURE`/`CONFETTI_COLORS`/`confettiLaunchConfig` (Task 6) e `confettiBurstConfig` (Task 7) — nomes usados de forma idêntica em `OfficeScene.ts` e nos testes.
- `playApplauseSound` — exportada na Task 4; importada e chamada em `celebrate` (Task 7); mockada no teste da Task 7 pelo mesmo caminho relativo (`../media/applause-sound`) que o import de produção.
- Client-message: `{ type:'confetti', active }` (Task 5) casa com `OfficeClientMessage` (Task 1) e com o guard da rota (Task 3).
- Server-message: `{ type:'confetti', userId, active }` e `{ type:'celebration' }` (Task 2 broadcast) casam com `OfficeServerMessage` (Task 1) e com os `case` de `handle()` (Tasks 6, 7).

Consistente.

**Riscos anotados**

- **Mock de Phaser nos testes da cena:** nenhum caminho testado toca `Phaser.*` em runtime — `emitConfetti`/`setConfetti`/`celebrate` e as config funcs só leem campos do `this` e chamam `this.add.*`/`this.tweens.*`/`this.time.*` (stubados) ou retornam objetos puros. `Phaser.Types...` aparece só como anotação de tipo (apagada). Confere com o padrão de `getScreenPosition`.
- **`this.sys.game.events` para o BLUR:** usei `this.sys.game.events` (garantido em qualquer Scene do Phaser 3) em vez de `this.game.events`, e removo o listener no DESTROY — sem isso o handler sobreviveria à cena. Não é exercido nos testes (nem `create()` nem o listener rodam sob o mock).
- **API de partículas (Phaser 3.60+/3.80):** `this.add.particles(x, y, textura, config)` retorna o `ParticleEmitter`; `startFollow/stop/start/explode/setDepth/setScrollFactor/destroy` são métodos do emissor. Como os testes stubam `this.add.particles` inteiro, a corretude visual do `explode`/`x:{min,max}` é validada só no fluxo manual — aceitável para um easter egg efêmero.
- **Gate real = vitest:** o repo não faz gate por `tsc` (o `packages/shared` tem erros de tsc pré-existentes e commitados; os hooks de tsc/eslint são de SOA/EGA, não do Legends). Por isso todo RED/GREEN é vitest, exceto a Task 1 (mudança só-de-tipos), cujo sinal é `tsc` filtrado por `office.test`.
