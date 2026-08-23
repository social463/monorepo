# High-five (bater mão) no Escritório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dois personagens acenando (👋), adjacentes e virados um pro outro, disparam uma batida de mão — os dois emojis convergem, dão um pop no impacto e somem, com som de palma.

**Arquitetura:** O servidor é a autoridade. O `OfficeHub` passa a guardar a última reação por usuário com timestamp, reavalia pares em três gatilhos (reação, `move`, `face`) e faz broadcast de `high-five`. O cliente só reage: para os tweens em curso dos dois balões, anima a convergência e limpa.

**Tech Stack:** TypeScript ESM strict, Fastify + WebSocket (api), Phaser 3 (web), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-high-five-escritorio-design.md`
**Card:** ADO 21916. **Branch:** `feat/high-five-escritorio`, baseada em `origin/feat/emoji` (`80e11291`).

## Global Constraints

- **Estilo por arquivo** (o repo é misto de propósito; `AGENTS.md`: "padrão da camada vizinha"):
  - `packages/shared/src/office.ts` → aspas **duplas** + ponto-e-vírgula.
  - `apps/api/src/lib/office-hub.ts` → aspas **simples**, **sem** ponto-e-vírgula.
  - `apps/web/src/office/**` → aspas **simples**, **sem** ponto-e-vírgula. O `OfficeScene.ts` chegou reformatado pela `feat/emoji` (aspas duplas + `;`); **escrever no estilo da `main`** mesmo assim — decisão tomada com o Matheus.
- Mensagens ao usuário em **português**.
- Nenhum asset de terceiro sem licença livre; crédito obrigatório (ver Task 4).
- Durante a implementação rodar **só o arquivo de teste tocado**; a suíte completa (`pnpm test`) só na verificação final (`AGENTS.md`).
- **A branch base tem 1 teste vermelho pré-existente** (`OfficeScene.test.ts`, reação — o Gabriel mudou `REACTION_REST_Y` de -42 pra -70 e não atualizou o teste). Não é regressão desta feature; ver "Pendência herdada" no fim.

---

### Task 1: Protocolo compartilhado

**Files:**
- Modify: `packages/shared/src/office.ts`
- Test: `packages/shared/src/office.test.ts`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: `HIGH_FIVE_EMOJI: string`, `REACTION_ACTIVE_WINDOW_MS: number`, e o membro `{ type: "high-five"; userIds: [string, string] }` em `OfficeServerMessage`. Tasks 2, 3 e 5 dependem destes nomes.

- [ ] **Step 1: Escrever o teste que falha**

Em `packages/shared/src/office.test.ts`, adicionar:

```ts
describe("high-five", () => {
  it("aceita a mensagem de high-five na união do servidor", () => {
    const message: OfficeServerMessage = { type: "high-five", userIds: ["ana", "bruno"] };
    expect(message.userIds).toHaveLength(2);
  });

  it("expõe o emoji do gesto e a janela de validade da reação", () => {
    expect(HIGH_FIVE_EMOJI).toBe("👋");
    expect(REACTION_ACTIVE_WINDOW_MS).toBe(3000);
  });
});
```

Ajustar o import do topo do arquivo para incluir `HIGH_FIVE_EMOJI` e `REACTION_ACTIVE_WINDOW_MS`.

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/shared exec vitest run src/office.test.ts
```

Esperado: FAIL — `HIGH_FIVE_EMOJI` não existe (erro de compilação do TS).

- [ ] **Step 3: Implementar**

Em `packages/shared/src/office.ts`, junto das outras constantes do topo:

```ts
/** O gesto que dispara o high-five. Comparado com o TEXTO da reação, não com a
 *  tecla: a lista de reações é customizável por usuário (localStorage), então a
 *  posição 1 não é garantidamente o 👋. */
export const HIGH_FIVE_EMOJI = "👋";

/**
 * Por quanto tempo uma reação conta como "ativa" para efeito de high-five.
 * Casado com a fase visível do balão no cliente (entrada 350ms + 3 pulos
 * ~2700ms ≈ 3.05s até começar a sumir) — se fosse maior, o servidor dispararia
 * com as mãos já saindo da tela.
 */
export const REACTION_ACTIVE_WINDOW_MS = 3000;
```

E na união `OfficeServerMessage`, junto de `confetti`/`celebration`:

```ts
  | { type: "high-five"; userIds: [string, string] }
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/shared exec vitest run src/office.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office.ts packages/shared/src/office.test.ts
git commit -m "feat(shared): contrato do high-five no escritório"
```

---

### Task 2: Estado da última reação no hub

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts` (método `nearbyMessage`, `leave`, `reset`)
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consumes: `REACTION_ACTIVE_WINDOW_MS` (Task 1).
- Produces: `private lastReaction = new Map<string, { emoji: string; at: number }>()` no `OfficeHub`. Task 3 lê este mapa.

> Postgres precisa estar de pé para os testes da API: `pnpm db:up`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/lib/office-hub.test.ts`, dentro de um novo `describe('high-five', ...)`:

```ts
it('esquece a reação de quem sai do escritório', () => {
  const a = fakeSocket()
  hub.join(a.socket, ana)
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  hub.leave(a.socket, 'ana')

  const b = fakeSocket()
  hub.join(b.socket, ana)
  // Sem reação nova depois de reentrar: o estado não pode ter sobrevivido.
  expect(hub.reactionAt('ana')).toBeNull()
})
```

E um acessor de leitura só para teste (o hub já expõe `occupantOf` no mesmo espírito):

```ts
it('registra a última reação com o emoji enviado', () => {
  const a = fakeSocket()
  hub.join(a.socket, ana)
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  expect(hub.reactionAt('ana')?.emoji).toBe('👋')
})

it('não registra fala nem pensamento como reação', () => {
  const a = fakeSocket()
  hub.join(a.socket, ana)
  hub.nearbyMessage(a.socket, 'ana', 'oi', 'speech')
  expect(hub.reactionAt('ana')).toBeNull()
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t high-five
```

Esperado: FAIL — `hub.reactionAt is not a function`.

- [ ] **Step 3: Implementar**

Em `apps/api/src/lib/office-hub.ts`, junto dos outros campos privados (perto de `confettiActive`):

```ts
  /**
   * Última reação de cada usuário, para o high-five. Diferente de
   * `confettiActive`, NÃO precisa de um Map de socket paralelo: confete é
   * estado liga/desliga (e só a aba dona pode desligar), reação é evento
   * pontual que expira sozinho pela janela de validade.
   */
  private lastReaction = new Map<string, { emoji: string; at: number }>()
```

No fim de `nearbyMessage()`, antes do broadcast existente:

```ts
    if (kind === 'reaction') this.lastReaction.set(userId, { emoji: trimmed, at: Date.now() })
```

Acessor de leitura, junto de `occupantOf()`:

```ts
  /** Última reação de um usuário, ou null. Usado pela avaliação de high-five e pelos testes. */
  reactionAt(userId: string): { emoji: string; at: number } | null {
    return this.lastReaction.get(userId) ?? null
  }
```

Em `leave()`, junto de `this.confettiActive.delete(userId)`:

```ts
    this.lastReaction.delete(userId)
```

Em `reset()`, junto de `this.confettiActive.clear()`:

```ts
    this.lastReaction.clear()
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t high-five
```

Esperado: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): hub guarda a última reação por usuário"
```

---

### Task 3: Detecção do par e broadcast

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts` (`nearbyMessage`, `move`, `face`, `leave`, `reset`)
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consumes: `lastReaction`/`reactionAt` (Task 2); `HIGH_FIVE_EMOJI`, `REACTION_ACTIVE_WINDOW_MS` (Task 1); `DIRECTION_DELTAS` (já existe no shared).
- Produces: broadcast `{ type: 'high-five', userIds: [a, b] }`; export `HIGH_FIVE_COOLDOWN_MS = 3000`. Task 5 consome a mensagem.

**Helper de teste** (adicionar no `describe('high-five')`, usado por vários testes).

> ⚠️ Dois atritos conhecidos com o hub, resolver aqui e não em cada teste:
> `move()` e `face()` passam por `takeToken(userId)` (rate limit por tempo), e vários
> testes desta task usam `vi.useFakeTimers()`. Se o posicionamento do `facePair()`
> esgotar o orçamento ou travar com o relógio congelado, chamar `vi.useFakeTimers()`
> **depois** do `facePair()`, ou avançar o relógio entre os `move()`. Conferir como
> `takeToken` recarrega (`office-hub.ts:634`) antes de escrever os testes.

```ts
/** Põe dois usuários adjacentes e virados um pro outro. Devolve os sockets. */
function facePair() {
  const a = fakeSocket()
  const b = fakeSocket()
  hub.join(a.socket, ana)
  hub.join(b.socket, bruno)

  const target = hub.occupantOf('ana') as { x: number; y: number }
  // Leva bruno até o tile à direita de ana.
  const from = hub.occupantOf('bruno') as { x: number; y: number }
  for (const dir of shortestPath(from, { x: target.x + 1, y: target.y })) {
    hub.move(b.socket, 'bruno', dir)
  }
  hub.face(a.socket, 'ana', 'right')
  hub.face(b.socket, 'bruno', 'left')
  a.sent.length = 0
  b.sent.length = 0
  return { a, b }
}

const highFives = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'high-five')
```

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('dispara quando os dois acenam de frente um pro outro', () => {
  const { a, b } = facePair()
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')

  expect(highFives(a.sent)).toHaveLength(1)
  expect(highFives(b.sent)).toHaveLength(1)
  expect((highFives(a.sent)[0] as { userIds: string[] }).userIds.sort()).toEqual(['ana', 'bruno'])
})

it('não dispara com só um acenando', () => {
  const { a, b } = facePair()
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  expect(highFives(a.sent)).toHaveLength(0)
  expect(highFives(b.sent)).toHaveLength(0)
})

it('não dispara com outro emoji', () => {
  const { a, b } = facePair()
  hub.nearbyMessage(a.socket, 'ana', '🔥', 'reaction')
  hub.nearbyMessage(b.socket, 'bruno', '🔥', 'reaction')
  expect(highFives(a.sent)).toHaveLength(0)
})

it('não dispara se estão de costas', () => {
  const { a, b } = facePair()
  hub.face(a.socket, 'ana', 'left')
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
  expect(highFives(a.sent)).toHaveLength(0)
})

it('dispara ao VIRAR de frente para quem já está acenando', () => {
  const { a, b } = facePair()
  hub.face(a.socket, 'ana', 'up')
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
  expect(highFives(a.sent)).toHaveLength(0)

  hub.face(a.socket, 'ana', 'right')
  expect(highFives(a.sent)).toHaveLength(1)
})

it('não redispara com o mesmo aceno (reação consumida)', () => {
  const { a, b } = facePair()
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
  expect(highFives(a.sent)).toHaveLength(1)

  hub.face(a.socket, 'ana', 'right')
  expect(highFives(a.sent)).toHaveLength(1)
})

it('respeita o cooldown do par', () => {
  const { a, b } = facePair()
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
  expect(highFives(a.sent)).toHaveLength(1)

  // Novo aceno dos dois dentro do cooldown: nada.
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
  expect(highFives(a.sent)).toHaveLength(1)

  vi.setSystemTime(Date.now() + HIGH_FIVE_COOLDOWN_MS + 1)
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
  expect(highFives(a.sent)).toHaveLength(2)
})

it('não dispara se a reação do outro já expirou', () => {
  const { a, b } = facePair()
  hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
  vi.setSystemTime(Date.now() + REACTION_ACTIVE_WINDOW_MS + 1)
  hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
  expect(highFives(a.sent)).toHaveLength(0)
})
```

Os testes com `vi.setSystemTime` precisam de `vi.useFakeTimers()` no `beforeEach` do `describe` e `vi.useRealTimers()` no `afterEach`. Importar `HIGH_FIVE_COOLDOWN_MS` de `./office-hub` e `REACTION_ACTIVE_WINDOW_MS` de `@legends/shared`.

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts -t high-five
```

Esperado: FAIL — `HIGH_FIVE_COOLDOWN_MS` não existe.

- [ ] **Step 3: Implementar**

Constante exportada, junto de `CELEBRATION_COOLDOWN_MS`:

```ts
/** Janela mínima entre dois high-fives do MESMO par — segura quem martela a tecla. */
export const HIGH_FIVE_COOLDOWN_MS = 3000
```

Campo privado, junto de `lastReaction`:

```ts
  /** Último high-five por par, chaveado pelos dois ids ordenados. */
  private lastHighFiveAt = new Map<string, number>()
```

O método de avaliação (perto de `confetti()`):

```ts
  /** Uma reação de high-five válida (emoji certo, dentro da janela) daquele usuário. */
  private waving(userId: string, now: number): boolean {
    const reaction = this.lastReaction.get(userId)
    return (
      reaction !== undefined
      && reaction.emoji === HIGH_FIVE_EMOJI
      && now - reaction.at <= REACTION_ACTIVE_WINDOW_MS
    )
  }

  /**
   * Avalia se `userId` fecha um high-five com quem está à sua frente. Chamado
   * nos TRÊS pontos que mudam a condição: reação nova, `move()` e `face()` —
   * virar sem andar é o caso mais comum (dois lado a lado, um vira pro outro).
   *
   * Dispara no máximo UM par por avaliação: numa fileira de três, o do meio
   * não vira dois high-fives simultâneos.
   */
  private evaluateHighFive(userId: string): void {
    const now = Date.now()
    if (!this.waving(userId, now)) return
    const me = this.entries.get(userId)?.occupant
    if (!me) return

    const frontX = me.x + DIRECTION_DELTAS[me.dir].x
    const frontY = me.y + DIRECTION_DELTAS[me.dir].y

    for (const [otherId, entry] of this.entries) {
      if (otherId === userId) continue
      const other = entry.occupant
      // Ele está no tile que eu encaro...
      if (other.x !== frontX || other.y !== frontY) continue
      // ...e me encara de volta. Isso já implica adjacência (delta tem norma 1),
      // então não precisa de teste de distância separado.
      if (other.x + DIRECTION_DELTAS[other.dir].x !== me.x) continue
      if (other.y + DIRECTION_DELTAS[other.dir].y !== me.y) continue
      if (!this.waving(otherId, now)) continue

      const pairKey = [userId, otherId].sort().join('|')
      if (now - (this.lastHighFiveAt.get(pairKey) ?? 0) < HIGH_FIVE_COOLDOWN_MS) continue

      this.lastHighFiveAt.set(pairKey, now)
      // Consome as duas reações: o mesmo aceno não dispara de novo na próxima
      // avaliação (o cooldown é a segunda linha, pra quem martela a tecla).
      this.lastReaction.delete(userId)
      this.lastReaction.delete(otherId)
      this.broadcast({ type: 'high-five', userIds: [userId, otherId] })
      return
    }
  }
```

Chamadas nos três pontos:

- em `nearbyMessage()`, logo depois do `this.lastReaction.set(...)` da Task 2 e do broadcast:
  ```ts
    if (kind === 'reaction') this.evaluateHighFive(userId)
  ```
- no fim de `move()`, depois do broadcast de `moved` e dos sinais de sala:
  ```ts
    this.evaluateHighFive(userId)
  ```
- no fim de `face()`, depois do broadcast de `faced`:
  ```ts
    this.evaluateHighFive(userId)
  ```

Limpeza — em `leave()`, junto do `this.lastReaction.delete(userId)`:

```ts
    for (const key of this.lastHighFiveAt.keys()) {
      if (key.split('|').includes(userId)) this.lastHighFiveAt.delete(key)
    }
```

Em `reset()`, junto do `this.lastReaction.clear()`:

```ts
    this.lastHighFiveAt.clear()
```

Importar `HIGH_FIVE_EMOJI` e `REACTION_ACTIVE_WINDOW_MS` de `@legends/shared` no topo do arquivo.

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts
```

Esperado: PASS, incluindo os testes pré-existentes do hub.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): detecta e faz broadcast do high-five entre dois personagens"
```

---

### Task 4: Som da palma

**Files:**
- Create: `apps/web/public/sounds/high-five.mp3` (asset externo — ver Step 1)
- Modify: `apps/web/public/sounds/CREDITS.txt`
- Create: `apps/web/src/office/media/high-five-sound.ts`
- Test: `apps/web/src/office/media/high-five-sound.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `playHighFiveSound(): void`. Task 5 chama.

- [ ] **Step 1: Obter o sample (ação humana — requer rede e escolha editorial)**

Baixar **uma palma única, curta (<1s), CC0**, salvar como `apps/web/public/sounds/high-five.mp3`. Fontes usadas pelo repo antes: BigSoundBank (origem do `applause.mp3`), Freesound (filtrar por CC0), OpenGameArt.

**Não** reusar `applause.mp3`: é multidão, ~1.5s — aqui é um tapa seco.

Registrar em `apps/web/public/sounds/CREDITS.txt`, no formato já existente:

```
high-five.mp3
Fonte: <nome> — "<título>" (<url>)
Licença: CC0 1.0 Universal (domínio público). Atribuição não exigida; registrada aqui por cortesia e rastreabilidade.
Uso: som do high-five entre dois personagens no Escritório virtual.
```

- [ ] **Step 2: Escrever o teste que falha**

`apps/web/src/office/media/high-five-sound.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { playHighFiveSound } from './high-five-sound'

class FakeAudio {
  static instances: FakeAudio[] = []
  volume = 1
  currentTime = 99
  src: string
  play = vi.fn(() => Promise.resolve())
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
}

beforeEach(() => {
  FakeAudio.instances = []
  vi.stubGlobal('Audio', FakeAudio)
})

describe('playHighFiveSound', () => {
  it('toca o sample com volume baixo, rebobinando a cada disparo', () => {
    playHighFiveSound()
    const audio = FakeAudio.instances[0]
    expect(audio.src).toBe('/sounds/high-five.mp3')
    expect(audio.volume).toBe(0.25)
    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalled()
  })

  it('reaproveita o mesmo elemento entre disparos', () => {
    playHighFiveSound()
    playHighFiveSound()
    expect(FakeAudio.instances).toHaveLength(1)
    expect(FakeAudio.instances[0].play).toHaveBeenCalledTimes(2)
  })

  it('engole falha de play — som é opcional', () => {
    playHighFiveSound()
    FakeAudio.instances[0].play.mockReturnValueOnce(Promise.reject(new Error('bloqueado')))
    expect(() => playHighFiveSound()).not.toThrow()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/office/media/high-five-sound.test.ts
```

Esperado: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar**

`apps/web/src/office/media/high-five-sound.ts` (espelha `applause-sound.ts`):

```ts
/**
 * Palma do high-five. Um mp3 curto (CC0) em `/sounds/high-five.mp3` — sample
 * real, não síntese (ver `applause-sound.ts`: Web Audio soava como chiado).
 * Sempre disparado sob gesto do usuário (acenar), o que satisfaz a política de
 * autoplay dos browsers.
 *
 * Reaproveita um único `HTMLAudioElement` e o rebobina a cada disparo; o
 * cooldown de 3s por par no servidor evita empilhamento. Falha de play é
 * engolida: som é opcional, nunca deve quebrar a animação.
 */
const HIGH_FIVE_SRC = '/sounds/high-five.mp3'
/** Seco e discreto — é pontuação da animação, não protagonista. */
const HIGH_FIVE_VOLUME = 0.25

let audio: HTMLAudioElement | null = null

export function playHighFiveSound(): void {
  if (typeof Audio === 'undefined') return
  try {
    if (!audio) audio = new Audio(HIGH_FIVE_SRC)
    // Setado a CADA disparo: o elemento é reaproveitado, então ajustar só na
    // criação deixaria o volume preso no primeiro valor.
    audio.volume = HIGH_FIVE_VOLUME
    audio.currentTime = 0
    void audio.play().catch(() => {})
  } catch {
    // som é opcional: nunca deixar o áudio quebrar o high-five
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/office/media/high-five-sound.test.ts
```

Esperado: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/web/public/sounds/ apps/web/src/office/media/high-five-sound.ts apps/web/src/office/media/high-five-sound.test.ts
git commit -m "feat(web): som de palma do high-five"
```

---

### Task 5: Animação da convergência

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (constantes do topo, `handle()`, novo método `playHighFive`)
- Test: `apps/web/src/office/scenes/OfficeScene.test.ts`

**Interfaces:**
- Consumes: `{ type: 'high-five', userIds }` (Task 1/3), `playHighFiveSound()` (Task 4), `REACTION_REST_Y` e `clearBubble()` (já existem no arquivo).
- Produces: `private playHighFive(userIds: [string, string]): void`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/office/scenes/OfficeScene.test.ts`, adicionar `playHighFive` ao bloco `scenePrivate`, mockar o som no topo (junto do mock de `applause-sound`):

```ts
vi.mock('../media/high-five-sound', () => ({ playHighFiveSound: vi.fn() }))
```

E o teste:

```ts
describe('OfficeScene.playHighFive', () => {
  function fakeView(x: number) {
    return {
      container: { x, y: 0 },
      bubble: { x: 0, y: 0, alpha: 1, scale: 1 },
      bubbleTween: { stop: vi.fn() },
      bubbleKind: 'reaction' as const,
    }
  }

  function fakeScene(views: Record<string, ReturnType<typeof fakeView>>) {
    return {
      characters: new Map(Object.entries(views)),
      clearBubble: vi.fn(),
      tweens: { chain: vi.fn(() => ({ stop: vi.fn() })) },
      time: { delayedCall: vi.fn() },
    }
  }

  it('leva os dois balões ao ponto médio e agenda o som no impacto', () => {
    const ana = fakeView(100)
    const bruno = fakeView(140)
    const scene = fakeScene({ ana, bruno })

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    expect(ana.bubbleTween.stop).toHaveBeenCalled()
    expect(bruno.bubbleTween.stop).toHaveBeenCalled()
    expect(scene.tweens.chain).toHaveBeenCalledTimes(2)

    // Ponto médio do mundo = 120. Em coords locais: 20 para ana, -20 para bruno.
    const [primeira, segunda] = scene.tweens.chain.mock.calls
    expect(primeira[0].tweens[0]).toEqual(expect.objectContaining({ x: 20 }))
    expect(segunda[0].tweens[0]).toEqual(expect.objectContaining({ x: -20 }))
    expect(scene.time.delayedCall).toHaveBeenCalledWith(250, playHighFiveSound)
  })

  it('ignora quando um dos balões já sumiu', () => {
    const ana = fakeView(100)
    const bruno = { ...fakeView(140), bubble: undefined }
    const scene = fakeScene({ ana, bruno } as never)

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    expect(scene.tweens.chain).not.toHaveBeenCalled()
  })

  it('ignora userId desconhecido sem lançar', () => {
    const scene = fakeScene({ ana: fakeView(100) })
    expect(() => scenePrivate.playHighFive.call(scene, ['ana', 'fantasma'])).not.toThrow()
    expect(scene.tweens.chain).not.toHaveBeenCalled()
  })
})
```

Importar `playHighFiveSound` de `'../media/high-five-sound'` no topo do teste.

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts -t playHighFive
```

Esperado: FAIL — `playHighFive` não existe.

- [ ] **Step 3: Implementar**

Constantes, junto das de reação no topo do arquivo (estilo da `main`: sem `;`):

```ts
const HIGH_FIVE_APPROACH_MS = 250
const HIGH_FIVE_POP_MS = 120
const HIGH_FIVE_POP_SCALE = 1.4
const HIGH_FIVE_FADE_MS = 200
```

Import junto dos outros de `media/`:

```ts
import { playHighFiveSound } from '../media/high-five-sound'
```

No `switch` do `handle()`, junto de `case "celebration"`:

```ts
      case 'high-five':
        this.playHighFive(message.userIds)
        break
```

O método (perto de `showNearbyBubble`):

```ts
  /**
   * Os dois balões de 👋 convergem pro ponto médio, dão um pop no impacto e
   * somem. Os balões pertencem ao fluxo de reação (`showNearbyBubble`) — aqui
   * a gente PARA o tween em curso deles e assume o controle, porque podem estar
   * em fases diferentes (um acenou há 2s, outro agora).
   */
  private playHighFive(userIds: [string, string]): void {
    const views = userIds.map((id) => this.characters.get(id))
    const [a, b] = views
    // Balão já sumiu (borda da janela de 3s do servidor) ou não é reação:
    // melhor perder um high-five do que animar mãos que não estão na tela.
    if (!a?.bubble || a.bubbleKind !== 'reaction') return
    if (!b?.bubble || b.bubbleKind !== 'reaction') return

    const midX = (a.container.x + b.container.x) / 2

    for (const view of [a, b]) {
      view.bubbleTween?.stop()
      const bubble = view.bubble
      if (!bubble) continue
      view.bubbleTween = this.tweens.chain({
        targets: bubble,
        tweens: [
          {
            // Balão é filho do container, então o alvo vai em coords locais.
            x: midX - view.container.x,
            y: REACTION_REST_Y,
            duration: HIGH_FIVE_APPROACH_MS,
            ease: 'Back.easeIn',
          },
          {
            scale: HIGH_FIVE_POP_SCALE,
            duration: HIGH_FIVE_POP_MS,
            yoyo: true,
            ease: 'Quad.easeOut',
          },
          {
            alpha: 0,
            duration: HIGH_FIVE_FADE_MS,
            ease: 'Sine.easeIn',
          },
        ],
        // Reusa a limpeza da reação em vez de restaurar posição/escala na mão —
        // não deixa o balão sujo pra próxima.
        onComplete: () => this.clearBubble(view),
      })
    }

    // No impacto, não na largada.
    this.time.delayedCall(HIGH_FIVE_APPROACH_MS, playHighFiveSound)
  }
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts -t playHighFive
```

Esperado: PASS (3 testes). O teste pré-existente de reação continua vermelho — ver "Pendência herdada".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/scenes/OfficeScene.test.ts
git commit -m "feat(web): animação do high-five entre dois personagens"
```

---

### Task 6: Verificação final

- [ ] **Step 1: Suíte completa**

```bash
pnpm db:up
pnpm test
```

Esperado: tudo verde **exceto** o teste herdado de reação no `OfficeScene.test.ts` (ver abaixo). Qualquer outra falha é regressão desta feature e precisa ser corrigida antes do PR.

- [ ] **Step 2: Verificar no app rodando**

Usar a skill `verify` do repo. Dois navegadores autenticados com usuários diferentes, andar até ficar frente a frente, apertar a tecla do 👋 nos dois dentro de 3s. Conferir: convergência, pop, som, e que o balão some limpo (uma reação nova depois funciona normal).

- [ ] **Step 3: Revisão cruzada antes do PR**

Skill `revisao-cruzada` (Codex revisa o diff) — convenção do repo para implementação não-trivial.

---

## Pendência herdada (não é desta feature)

`apps/web/src/office/scenes/OfficeScene.test.ts` já vem **vermelho** da branch base `feat/emoji` (`80e11291`): o teste de reação espera `container (0, -12)` e tweens `-42 / -50 / -72`, mas o código tem `REACTION_REST_Y = -70`, que produz `(0, -40)` e `-70 / -78 / -100`. O Gabriel subiu a altura do emoji e não atualizou o próprio teste.

**Não corrigir silenciosamente** — é código de outra pessoa, numa task em andamento (ADO 21907), e a "altura certa" é decisão visual dele. Avisar e deixar que ele ajuste, ou combinar explicitamente de corrigir aqui.

## Fora de escopo

- O gesto de acenar (tecla, balão, broadcast) — é a 21907.
- Forçar o 👋 na lista de reações de quem customizou; quem tirou o 👋 não dá high-five.
- High-five de 3+ pessoas como evento único; contador/badge/histórico.
- Mobile/touch.
