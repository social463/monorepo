# Escritório Virtual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma rota `/escritorio` onde N pessoas do time aparecem como personagens num mapa de tiles e se movimentam em tempo real, sincronizadas por WebSocket.

**Architecture:** O mapa e o protocolo vivem em `@legends/shared` (fonte única — servidor valida colisão e cliente desenha a partir do mesmo módulo). O servidor é autoritativo: o cliente envia **intenção** (`move: 'up'`), o hub in-memory valida contra o mapa e faz broadcast da posição. Nada é persistido — presença some quando o socket fecha. O Phaser fica isolado atrás de um EventEmitter (`OfficeBridge`), que é a única fronteira React ⇄ jogo.

**Tech Stack:** Fastify 4 + `@fastify/websocket` (já instalados), Zod não é usado aqui (o protocolo é validado à mão, é minúsculo), React 18 + Phaser 3 (dependência nova, carregada por `import()` dinâmico), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-escritorio-virtual-design.md`

## Global Constraints

- TypeScript **strict**, ESM puro. Monorepo pnpm; imports cruzados por `@legends/shared`.
- Mensagens voltadas ao usuário em **português**.
- Rotas finas: regra de negócio no hub/service, nunca na route.
- Testes colocados ao lado do código (`*.test.ts(x)`). Testes da API exigem Postgres de pé (`pnpm db:up`).
- **Nenhuma migration** nesta feature — o estado do escritório é 100% in-memory.
- **Nenhum arquivo de imagem** entra no repo: as texturas são geradas em runtime.
- Branch de trabalho: `feat/escritorio-virtual` (já criada, com o spec commitado).

---

### Task 1: Contrato e mapa compartilhados

O módulo que servidor e cliente leem. Define o mapa, o protocolo e a função de colisão — se isso estiver errado, os dois lados erram junto (que é exatamente o objetivo: nunca divergirem).

**Files:**
- Create: `packages/shared/src/office.ts`
- Create: `packages/shared/src/office.test.ts`
- Modify: `packages/shared/src/index.ts` (adicionar `export * from './office'`)

**Interfaces:**
- Consumes: `AvatarOptions`, `OPEN_PEEPS_SKIN_COLORS`, `OPEN_PEEPS_CLOTHING_COLORS` de `./avatar`.
- Produces: `TILE_SIZE`, `OFFICE_MAP`, `OFFICE_WIDTH`, `OFFICE_HEIGHT`, `WALKABLE_TILES`, `OFFICE_SPAWN_TILES`, `isWalkable(x,y)`, `DIRECTIONS`, `isDirection(v)`, `DIRECTION_DELTAS`, `officeColors(userId, options)`, e os tipos `Direction`, `OfficeOccupant`, `OfficeClientMessage`, `OfficeServerMessage`.

- [ ] **Step 1: Escrever o teste falhando**

`packages/shared/src/office.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  OFFICE_MAP,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  OFFICE_SPAWN_TILES,
  isWalkable,
  isDirection,
  officeColors,
  DEFAULT_OPEN_PEEPS_OPTIONS,
} from './index'

describe('mapa do escritório', () => {
  it('é retangular', () => {
    expect(OFFICE_MAP).toHaveLength(OFFICE_HEIGHT)
    for (const row of OFFICE_MAP) {
      expect(row).toHaveLength(OFFICE_WIDTH)
    }
  })

  it('é cercado por parede', () => {
    for (let x = 0; x < OFFICE_WIDTH; x += 1) {
      expect(isWalkable(x, 0)).toBe(false)
      expect(isWalkable(x, OFFICE_HEIGHT - 1)).toBe(false)
    }
    for (let y = 0; y < OFFICE_HEIGHT; y += 1) {
      expect(isWalkable(0, y)).toBe(false)
      expect(isWalkable(OFFICE_WIDTH - 1, y)).toBe(false)
    }
  })

  it('tem spawns, e todo spawn é andável', () => {
    expect(OFFICE_SPAWN_TILES.length).toBeGreaterThan(0)
    for (const tile of OFFICE_SPAWN_TILES) {
      expect(isWalkable(tile.x, tile.y)).toBe(true)
    }
  })

  it('trata coordenada fora do mapa como não-andável', () => {
    expect(isWalkable(-1, 5)).toBe(false)
    expect(isWalkable(5, -1)).toBe(false)
    expect(isWalkable(OFFICE_WIDTH, 5)).toBe(false)
    expect(isWalkable(5, OFFICE_HEIGHT)).toBe(false)
  })
})

describe('isDirection', () => {
  it('aceita as quatro direções e rejeita o resto', () => {
    expect(isDirection('up')).toBe(true)
    expect(isDirection('down')).toBe(true)
    expect(isDirection('left')).toBe(true)
    expect(isDirection('right')).toBe(true)
    expect(isDirection('diagonal')).toBe(false)
    expect(isDirection(42)).toBe(false)
    expect(isDirection(undefined)).toBe(false)
  })
})

describe('officeColors', () => {
  it('usa as cores do avatar quando a pessoa tem um', () => {
    const colors = officeColors('user-1', {
      ...DEFAULT_OPEN_PEEPS_OPTIONS,
      skinColor: 'd08b5b',
      clothingColor: '78e185',
    })
    expect(colors).toEqual({ skinColor: 'd08b5b', clothingColor: '78e185' })
  })

  it('deriva cores estáveis do userId quando não há avatar', () => {
    const a = officeColors('user-1', null)
    const b = officeColors('user-1', null)
    expect(a).toEqual(b)
    expect(a.skinColor).toMatch(/^[0-9a-f]{6}$/)
    expect(a.clothingColor).toMatch(/^[0-9a-f]{6}$/)
  })

  it('dá cores diferentes para pessoas diferentes sem avatar', () => {
    const a = officeColors('ana', null)
    const b = officeColors('bruno', null)
    expect(a).not.toEqual(b)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/shared test`
Expected: FAIL — `Failed to resolve import './office'` / `OFFICE_MAP is not exported`.

- [ ] **Step 3: Implementar o contrato**

`packages/shared/src/office.ts`:

```ts
import {
  type AvatarOptions,
  OPEN_PEEPS_SKIN_COLORS,
  OPEN_PEEPS_CLOTHING_COLORS,
} from "./avatar";

/** Lado do tile em pixels. O mapa inteiro é medido nesta unidade. */
export const TILE_SIZE = 32;

/**
 * Planta do escritório. Uma linha por fileira de tiles.
 *
 * Legenda:
 *   `.` chão (andável) · `S` spawn (andável) ·
 *   `#` parede · `D` mesa · `P` planta · `C` bancada da copa
 *
 * Servidor e cliente leem ESTA constante — o servidor para validar colisão, o
 * cliente para desenhar. Não duplique a planta em lugar nenhum.
 */
export const OFFICE_MAP: readonly string[] = [
  "#########################",
  "#.......................#",
  "#..DDDD.......DDDD......#",
  "#..DDDD.......DDDD......#",
  "#.......................#",
  "#.......................#",
  "#..DDDD.......DDDD......#",
  "#..DDDD.......DDDD......#",
  "#.......................#",
  "#.......................#",
  "##########.....##########",
  "#CCCC..........P........#",
  "#CCCC...................#",
  "#.......................#",
  "#..........SSS..........#",
  "#..........SSS..........#",
  "#.......................#",
  "#########################",
];

export const OFFICE_HEIGHT = OFFICE_MAP.length;
export const OFFICE_WIDTH = OFFICE_MAP[0].length;

/** Tiles que uma pessoa pode ocupar. Todo o resto é cenário sólido. */
export const WALKABLE_TILES: ReadonlySet<string> = new Set([".", "S"]);

export interface TilePosition {
  x: number;
  y: number;
}

/** Tiles `S`, calculados uma vez no load do módulo. */
export const OFFICE_SPAWN_TILES: readonly TilePosition[] = OFFICE_MAP.flatMap(
  (row, y) =>
    [...row].flatMap((tile, x) => (tile === "S" ? [{ x, y }] : [])),
);

/** Fora do mapa também é "não andável" — quem chama não precisa checar limites. */
export function isWalkable(x: number, y: number): boolean {
  const row = OFFICE_MAP[y];
  if (row === undefined) return false;
  const tile = row[x];
  return tile !== undefined && WALKABLE_TILES.has(tile);
}

export const DIRECTIONS = ["up", "down", "left", "right"] as const;

export type Direction = (typeof DIRECTIONS)[number];

export function isDirection(value: unknown): value is Direction {
  return (DIRECTIONS as readonly unknown[]).includes(value);
}

export const DIRECTION_DELTAS: Record<Direction, TilePosition> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Uma pessoa presente no escritório. Existe só em memória, some ao desconectar. */
export interface OfficeOccupant {
  userId: string;
  name: string;
  x: number;
  y: number;
  dir: Direction;
  /** Hex sem `#`, derivado do avatar da pessoa (ver `officeColors`). */
  skinColor: string;
  clothingColor: string;
}

export type OfficeClientMessage = { type: "move"; dir: Direction };

export type OfficeServerMessage =
  | { type: "welcome"; youId: string; occupants: OfficeOccupant[] }
  | { type: "joined"; occupant: OfficeOccupant }
  | { type: "left"; userId: string }
  | { type: "moved"; userId: string; x: number; y: number; dir: Direction }
  /** Move recusado (parede/borda): posição autoritativa para o cliente re-ancorar. */
  | { type: "sync"; x: number; y: number; dir: Direction };

/** djb2 — hash estável para escolher spawn e cores sem depender de aleatório. */
export function officeHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Cores do personagem. Quem tem avatar open-peeps usa as próprias cores (o
 * boneco "combina" com o avatar do resto do app); quem não tem (foto do M365
 * ou nada) recebe cores estáveis derivadas do id, para não sair todo mundo
 * igual.
 */
export function officeColors(
  userId: string,
  options: AvatarOptions | null,
): { skinColor: string; clothingColor: string } {
  if (options) {
    return {
      skinColor: options.skinColor,
      clothingColor: options.clothingColor,
    };
  }
  const hash = officeHash(userId);
  return {
    skinColor: OPEN_PEEPS_SKIN_COLORS[hash % OPEN_PEEPS_SKIN_COLORS.length],
    // `>>>` (sem sinal): `officeHash` devolve um uint32, e `>>` tornaria
    // negativo todo hash >= 2^31 — índice negativo, cor `undefined`.
    clothingColor:
      OPEN_PEEPS_CLOTHING_COLORS[
        (hash >>> 8) % OPEN_PEEPS_CLOTHING_COLORS.length
      ],
  };
}
```

- [ ] **Step 4: Exportar no barril**

Em `packages/shared/src/index.ts`, adicionar na lista de exports (mantendo o estilo de uma linha por módulo):

```ts
export * from './office'
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/shared test`
Expected: PASS — 7 testes.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/office.ts packages/shared/src/office.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): mapa e protocolo do escritório virtual"
```

---

### Task 2: Hub in-memory (regra de movimento)

Toda a regra vive aqui: quem está no mapa, onde, quem pode andar pra onde, e o rate limit. É testável sem WebSocket nenhum — o hub só conhece um `OfficeSocket` (algo com `.send(string)`), então os testes usam sockets falsos.

**Files:**
- Create: `apps/api/src/lib/office-hub.ts`
- Create: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consumes: de `@legends/shared` — `OFFICE_SPAWN_TILES`, `isWalkable`, `DIRECTION_DELTAS`, `officeColors`, `officeHash`, tipos `Direction`, `OfficeOccupant`, `OfficeServerMessage`.
- Produces: `OfficeSocket` (interface), `OfficeUser` (interface), `class OfficeHub` com `join(socket, user)`, `move(socket, userId, dir)`, `leave(socket, userId)`, `occupants(): OfficeOccupant[]`, `reset()`; e o singleton `officeHub`.

- [ ] **Step 1: Escrever o teste falhando**

`apps/api/src/lib/office-hub.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OFFICE_SPAWN_TILES, isWalkable, type OfficeServerMessage } from '@legends/shared'
import { OfficeHub, type OfficeSocket } from './office-hub'

/** Socket falso: guarda tudo que o hub mandou, já parseado. */
function fakeSocket() {
  const sent: OfficeServerMessage[] = []
  const socket: OfficeSocket = { send: (data: string) => void sent.push(JSON.parse(data)) }
  return { socket, sent }
}

const ana = { id: 'ana', name: 'Ana', avatarOptions: null }
const bruno = { id: 'bruno', name: 'Bruno', avatarOptions: null }

let hub: OfficeHub

beforeEach(() => {
  hub = new OfficeHub()
})

describe('join', () => {
  it('coloca a pessoa num spawn e responde welcome', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)

    const welcome = a.sent.find((m) => m.type === 'welcome')
    expect(welcome).toMatchObject({ type: 'welcome', youId: 'ana' })

    const [occupant] = hub.occupants()
    expect(occupant.userId).toBe('ana')
    expect(OFFICE_SPAWN_TILES).toContainEqual({ x: occupant.x, y: occupant.y })
  })

  it('avisa quem já estava lá, e o welcome de quem chega já traz os outros', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    expect(a.sent).toContainEqual(
      expect.objectContaining({ type: 'joined', occupant: expect.objectContaining({ userId: 'bruno' }) }),
    )
    const welcome = b.sent.find((m) => m.type === 'welcome') as Extract<OfficeServerMessage, { type: 'welcome' }>
    expect(welcome.occupants.map((o) => o.userId).sort()).toEqual(['ana', 'bruno'])
  })

  it('duas abas da mesma pessoa = um personagem só', () => {
    const tab1 = fakeSocket()
    const tab2 = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(tab2.socket, ana)

    expect(hub.occupants()).toHaveLength(1)
    // a segunda aba não anuncia um "joined" duplicado para a primeira
    expect(tab1.sent.filter((m) => m.type === 'joined')).toHaveLength(0)
  })
})

describe('move', () => {
  it('anda para um tile livre e faz broadcast', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    const before = hub.occupants().find((o) => o.userId === 'ana')!
    // escolhe uma direção que sabemos ser livre a partir do spawn
    const dir = isWalkable(before.x, before.y - 1) ? 'up' : 'down'
    const expectedY = dir === 'up' ? before.y - 1 : before.y + 1

    hub.move(a.socket, 'ana', dir)

    const after = hub.occupants().find((o) => o.userId === 'ana')!
    expect(after).toMatchObject({ x: before.x, y: expectedY, dir })
    expect(b.sent).toContainEqual({ type: 'moved', userId: 'ana', x: before.x, y: expectedY, dir })
  })

  it('não atravessa parede: não move e devolve sync só para quem tentou', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      const b = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)
      const before = hub.occupants().find((o) => o.userId === 'ana')!

      // Anda para a esquerda até bater na parede. O relógio avança entre os
      // passos para o rate limit repor tokens: quem está sob teste aqui é a
      // COLISÃO, não o limite. (Sem isso, o burst de 10 acaba antes de o
      // personagem cruzar os ~11 tiles até a parede, e o teste passa sem
      // nunca ter encostado nela.)
      for (let i = 0; i < 40; i += 1) {
        hub.move(a.socket, 'ana', 'left')
        vi.advanceTimersByTime(200)
      }

      const after = hub.occupants().find((o) => o.userId === 'ana')!
      expect(after.y).toBe(before.y)
      expect(after.x).toBeGreaterThan(0)
      expect(isWalkable(after.x - 1, after.y)).toBe(false)
      expect(a.sent).toContainEqual({ type: 'sync', x: after.x, y: after.y, dir: 'left' })
      // o sync é privado: ninguém mais recebe
      expect(b.sent.some((m) => m.type === 'sync')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignora move de socket desconhecido', () => {
    const ghost = fakeSocket()
    hub.move(ghost.socket, 'ana', 'up')
    expect(hub.occupants()).toHaveLength(0)
    expect(ghost.sent).toHaveLength(0)
  })

  it('descarta o excesso quando alguém spamma move (rate limit)', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      hub.join(a.socket, ana)
      const spawn = hub.occupants()[0]
      // 100 tentativas no mesmo instante: no máximo o burst passa
      for (let i = 0; i < 100; i += 1) {
        hub.move(a.socket, 'ana', 'up')
        hub.move(a.socket, 'ana', 'down')
      }
      const moves = a.sent.filter((m) => m.type === 'moved')
      expect(moves.length).toBeLessThanOrEqual(10)
      expect(moves.length).toBeGreaterThan(0)
      // e o personagem continua num tile válido
      const after = hub.occupants()[0]
      expect(isWalkable(after.x, after.y)).toBe(true)
      expect(after.x).toBe(spawn.x)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('leave', () => {
  it('remove a pessoa e avisa os outros quando a última aba fecha', () => {
    const tab1 = fakeSocket()
    const tab2 = fakeSocket()
    const b = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(tab2.socket, ana)
    hub.join(b.socket, bruno)

    hub.leave(tab1.socket, 'ana')
    expect(hub.occupants().map((o) => o.userId)).toContain('ana')
    expect(b.sent.some((m) => m.type === 'left')).toBe(false)

    hub.leave(tab2.socket, 'ana')
    expect(hub.occupants().map((o) => o.userId)).not.toContain('ana')
    expect(b.sent).toContainEqual({ type: 'left', userId: 'ana' })
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api test src/lib/office-hub.test.ts`
Expected: FAIL — `Cannot find module './office-hub'`.

- [ ] **Step 3: Implementar o hub**

`apps/api/src/lib/office-hub.ts`:

```ts
import {
  DIRECTION_DELTAS,
  OFFICE_SPAWN_TILES,
  isWalkable,
  officeColors,
  officeHash,
  type AvatarOptions,
  type Direction,
  type OfficeOccupant,
  type OfficeServerMessage,
} from '@legends/shared'

/** O mínimo que o hub precisa de um socket — mantém o hub testável sem WS. */
export interface OfficeSocket {
  send(data: string): void
}

export interface OfficeUser {
  id: string
  name: string
  avatarOptions: AvatarOptions | null
}

/** Token bucket: até BURST passos instantâneos, repondo MOVES_PER_SECOND por segundo. */
const MOVES_PER_SECOND = 10
const BURST = 10

interface Bucket {
  tokens: number
  updatedAt: number
}

interface Entry {
  occupant: OfficeOccupant
  sockets: Set<OfficeSocket>
}

/**
 * Estado do escritório virtual — inteiramente em memória, por instância.
 * Presença é efêmera por decisão de design: fechou a última aba, saiu do mapa;
 * reiniciou o processo, todo mundo respawna. Nada aqui toca o Postgres.
 *
 * O servidor é autoritativo: o cliente só manda intenção (`move: dir`) e o hub
 * decide se o passo acontece. Um cliente adulterado não atravessa parede nem
 * teleporta.
 */
export class OfficeHub {
  private entries = new Map<string, Entry>()
  private buckets = new Map<OfficeSocket, Bucket>()
  /** Índice reverso: de qual usuário é este socket (evita confiar no userId do caller). */
  private socketOwner = new Map<OfficeSocket, string>()

  join(socket: OfficeSocket, user: OfficeUser): void {
    this.socketOwner.set(socket, user.id)
    this.buckets.set(socket, { tokens: BURST, updatedAt: Date.now() })

    const existing = this.entries.get(user.id)
    if (existing) {
      // Outra aba da mesma pessoa: um personagem só, sem novo "joined".
      existing.sockets.add(socket)
    } else {
      const spawn = this.pickSpawn(user.id)
      const { skinColor, clothingColor } = officeColors(user.id, user.avatarOptions)
      const occupant: OfficeOccupant = {
        userId: user.id,
        name: user.name,
        x: spawn.x,
        y: spawn.y,
        dir: 'down',
        skinColor,
        clothingColor,
      }
      this.entries.set(user.id, { occupant, sockets: new Set([socket]) })
      this.broadcast({ type: 'joined', occupant }, user.id)
    }

    this.sendTo(socket, { type: 'welcome', youId: user.id, occupants: this.occupants() })
  }

  move(socket: OfficeSocket, userId: string, dir: Direction): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    if (!this.takeToken(socket)) return

    const delta = DIRECTION_DELTAS[dir]
    const targetX = entry.occupant.x + delta.x
    const targetY = entry.occupant.y + delta.y

    if (!isWalkable(targetX, targetY)) {
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

    entry.occupant.x = targetX
    entry.occupant.y = targetY
    entry.occupant.dir = dir
    this.broadcast({ type: 'moved', userId, x: targetX, y: targetY, dir })
  }

  leave(socket: OfficeSocket, userId: string): void {
    this.socketOwner.delete(socket)
    this.buckets.delete(socket)
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.sockets.delete(socket)
    if (entry.sockets.size > 0) return // ainda há outra aba aberta
    this.entries.delete(userId)
    this.broadcast({ type: 'left', userId })
  }

  occupants(): OfficeOccupant[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.occupant }))
  }

  /** Só para testes: zera o estado do singleton entre casos. */
  reset(): void {
    this.entries.clear()
    this.buckets.clear()
    this.socketOwner.clear()
  }

  /**
   * Spawn estável por pessoa (mesmo id → mesmo tile), caindo para o próximo
   * spawn livre se estiver ocupado. Se todos estiverem ocupados, aceita a
   * sobreposição — pessoas se atravessam de qualquer forma.
   */
  private pickSpawn(userId: string): { x: number; y: number } {
    const taken = new Set(
      [...this.entries.values()].map((e) => `${e.occupant.x},${e.occupant.y}`),
    )
    const start = officeHash(userId) % OFFICE_SPAWN_TILES.length
    for (let i = 0; i < OFFICE_SPAWN_TILES.length; i += 1) {
      const tile = OFFICE_SPAWN_TILES[(start + i) % OFFICE_SPAWN_TILES.length]
      if (!taken.has(`${tile.x},${tile.y}`)) return tile
    }
    return OFFICE_SPAWN_TILES[start]
  }

  private takeToken(socket: OfficeSocket): boolean {
    const bucket = this.buckets.get(socket)
    if (!bucket) return false
    const now = Date.now()
    const refill = ((now - bucket.updatedAt) / 1000) * MOVES_PER_SECOND
    bucket.tokens = Math.min(BURST, bucket.tokens + refill)
    bucket.updatedAt = now
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }

  private sendTo(socket: OfficeSocket, message: OfficeServerMessage): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // socket morto: o close handler da rota limpa
    }
  }

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
}

export const officeHub = new OfficeHub()
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/api test src/lib/office-hub.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): hub in-memory do escritório virtual"
```

---

### Task 3: Rota WebSocket

Rota fina: autentica, busca o usuário, entrega o socket pro hub. Nenhuma regra aqui. Espelha `routes/retro-ws.ts` (inclusive o truque de resolver o usuário no `preValidation`, para o handler do socket ficar síncrono).

**Files:**
- Create: `apps/api/src/routes/office-ws.ts`
- Create: `apps/api/src/routes/office-ws.test.ts`
- Modify: `apps/api/src/app.ts` (import + `app.register(officeWsRoutes)`)

**Interfaces:**
- Consumes: `officeHub` de `../lib/office-hub`; `isDirection`, tipos `OfficeClientMessage` de `@legends/shared`; `prisma` de `../lib/prisma`.
- Produces: `officeWsRoutes(app)`; endpoint `GET /office/ws?token=<jwt>`.

- [ ] **Step 1: Escrever o teste falhando**

`apps/api/src/routes/office-ws.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { officeHub } from '../lib/office-hub'
import { isWalkable, type OfficeServerMessage } from '@legends/shared'

function waitOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// O hub é um singleton em memória: o truncate do Postgres não o limpa.
beforeEach(() => {
  officeHub.reset()
})

describe('office websocket', () => {
  it('entrega welcome ao conectar e propaga o movimento para os outros', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const bruno = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno@x.com', passwordHash: 'x', role: 'LEGEND' },
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

    const welcome = brunoMsgs.find((m) => m.type === 'welcome')
    expect(welcome).toMatchObject({ type: 'welcome', youId: bruno.id })
    expect(anaMsgs.some((m) => m.type === 'joined' && m.occupant.userId === bruno.id)).toBe(true)

    // Ana anda numa direção que sabemos ser livre a partir do spawn dela
    const spawn = officeHub.occupants().find((o) => o.userId === ana.id)!
    const dir = isWalkable(spawn.x, spawn.y - 1) ? 'up' : 'down'
    anaWs.send(JSON.stringify({ type: 'move', dir }))
    await delay(150)

    expect(brunoMsgs.some((m) => m.type === 'moved' && m.userId === ana.id && m.dir === dir)).toBe(true)

    anaWs.close()
    await delay(100)
    expect(brunoMsgs.some((m) => m.type === 'left' && m.userId === ana.id)).toBe(true)

    brunoWs.close()
    await app.close()
  })

  it('mensagem malformada não derruba a conexão', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', role: 'LEGEND' },
    })
    const token = app.jwt.sign({ sub: ana.id, role: 'LEGEND' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=${token}`)
    await waitOpen(ws)

    ws.send('isso não é json')
    ws.send(JSON.stringify({ type: 'move', dir: 'diagonal' }))
    ws.send(JSON.stringify({ type: 'teleport', x: 0, y: 0 }))
    await delay(150)

    expect(ws.readyState).toBe(WebSocket.OPEN)
    expect(officeHub.occupants()).toHaveLength(1)

    ws.close()
    await app.close()
  })

  it('recusa conexão sem token válido', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ws = new WebSocket(`ws://127.0.0.1:${port}/office/ws?token=invalido`)
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true))
      ws.on('open', () => resolve(false))
    })

    expect(failed).toBe(true)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test src/routes/office-ws.test.ts`
Expected: FAIL — a conexão erra em todos os casos (a rota `/office/ws` não existe).

- [ ] **Step 3: Implementar a rota**

`apps/api/src/routes/office-ws.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { isDirection, type AvatarOptions, type OfficeClientMessage } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { officeHub, type OfficeUser } from '../lib/office-hub'

/** Anexado ao request no preValidation para o handler do socket ficar síncrono. */
interface OfficeRequest {
  _officeUser?: OfficeUser
}

export async function officeWsRoutes(app: FastifyInstance) {
  app.get(
    '/office/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token ?? ''
        let userId: string
        try {
          const payload = app.jwt.verify(token) as { sub: string }
          userId = payload.sub
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, active: true, avatarOptions: true },
        })
        if (!user || !user.active) {
          return reply.code(401).send({ message: 'Não autorizado' })
        }

        ;(request as OfficeRequest)._officeUser = {
          id: user.id,
          name: user.name,
          avatarOptions: (user.avatarOptions as AvatarOptions | null) ?? null,
        }
      },
    },
    (connection, request) => {
      const ws = connection.socket
      const user = (request as OfficeRequest)._officeUser as OfficeUser

      officeHub.join(ws, user)

      ws.on('message', (raw: unknown) => {
        let msg: OfficeClientMessage
        try {
          msg = JSON.parse(String(raw)) as OfficeClientMessage
        } catch {
          return
        }
        if (msg.type === 'move' && isDirection(msg.dir)) {
          officeHub.move(ws, user.id, msg.dir)
        }
      })

      ws.on('close', () => {
        officeHub.leave(ws, user.id)
      })
    },
  )
}
```

- [ ] **Step 4: Registrar no app**

Em `apps/api/src/app.ts`, adicionar o import junto dos outros de rota:

```ts
import { officeWsRoutes } from './routes/office-ws'
```

e o registro logo após `app.register(reviewWsRoutes)`:

```ts
  app.register(officeWsRoutes)
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/api test src/routes/office-ws.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/office-ws.ts apps/api/src/routes/office-ws.test.ts apps/api/src/app.ts
git commit -m "feat(api): rota WebSocket do escritório virtual"
```

---

### Task 4: Bridge e socket no front

A ponte React ⇄ Phaser e a conexão. Sem Phaser ainda — só o encanamento, testável em jsdom.

`OfficeBridge` existe porque Phaser é imperativo e React é declarativo: se o estado do jogo passasse por props, cada re-render tentaria reconstruir a cena. O bridge deixa o React empurrar eventos pra dentro do jogo sem nunca re-renderizá-lo.

**Files:**
- Create: `apps/web/src/office/OfficeBridge.ts`
- Create: `apps/web/src/office/useOfficeSocket.ts`
- Create: `apps/web/src/office/useOfficeSocket.test.ts`

**Interfaces:**
- Consumes: `getAccessToken`, `refreshAccessToken` de `../lib/api`; tipos de `@legends/shared`.
- Produces: `class OfficeBridge` (`onServerMessage`, `emitServerMessage`, `onMoveIntent`, `emitMoveIntent` — os `on*` devolvem função de unsubscribe); `useOfficeSocket(bridge): { occupants: OfficeOccupant[]; youId: string | null; connected: boolean }`.

- [ ] **Step 1: Escrever o teste falhando**

`apps/web/src/office/useOfficeSocket.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { OfficeServerMessage } from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'
import { useOfficeSocket } from './useOfficeSocket'

vi.mock('../lib/api', () => ({
  getAccessToken: () => 'token-de-teste',
  refreshAccessToken: vi.fn(async () => {}),
}))

/** WebSocket falso controlável pelo teste. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 1
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  serverSends(message: OfficeServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const ana = {
  userId: 'ana',
  name: 'Ana',
  x: 11,
  y: 14,
  dir: 'down' as const,
  skinColor: 'edb98a',
  clothingColor: '8fa7df',
}

describe('useOfficeSocket', () => {
  it('conecta com o token e expõe os ocupantes do welcome', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeSocket(bridge))

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain('/api/office/ws?token=token-de-teste')

    act(() => {
      ws.onopen?.()
      ws.serverSends({ type: 'welcome', youId: 'ana', occupants: [ana] })
    })

    await waitFor(() => {
      expect(result.current.connected).toBe(true)
      expect(result.current.youId).toBe('ana')
      expect(result.current.occupants).toEqual([ana])
    })
  })

  it('mantém a lista de ocupantes em dia com joined/moved/left', async () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.onopen?.()
      ws.serverSends({ type: 'welcome', youId: 'ana', occupants: [ana] })
      ws.serverSends({
        type: 'joined',
        occupant: { ...ana, userId: 'bruno', name: 'Bruno', x: 12, y: 14 },
      })
    })
    await waitFor(() => expect(result.current.occupants).toHaveLength(2))

    act(() => {
      ws.serverSends({ type: 'moved', userId: 'bruno', x: 12, y: 13, dir: 'up' })
    })
    await waitFor(() =>
      expect(result.current.occupants.find((o) => o.userId === 'bruno')).toMatchObject({ x: 12, y: 13, dir: 'up' }),
    )

    act(() => {
      ws.serverSends({ type: 'left', userId: 'bruno' })
    })
    await waitFor(() => expect(result.current.occupants.map((o) => o.userId)).toEqual(['ana']))
  })

  it('repassa as mensagens do servidor para o bridge (a cena escuta ali)', async () => {
    const bridge = new OfficeBridge()
    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))

    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]

    act(() => {
      ws.onopen?.()
      ws.serverSends({ type: 'welcome', youId: 'ana', occupants: [ana] })
    })

    expect(seen).toEqual([{ type: 'welcome', youId: 'ana', occupants: [ana] }])
  })

  it('envia a intenção de movimento emitida pela cena', async () => {
    const bridge = new OfficeBridge()
    renderHook(() => useOfficeSocket(bridge))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const ws = FakeWebSocket.instances[0]
    act(() => ws.onopen?.())

    act(() => bridge.emitMoveIntent('right'))

    expect(ws.sent).toContain(JSON.stringify({ type: 'move', dir: 'right' }))
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/web test src/office/useOfficeSocket.test.ts`
Expected: FAIL — `Cannot find module './OfficeBridge'`.

- [ ] **Step 3: Implementar o bridge**

`apps/web/src/office/OfficeBridge.ts`:

```ts
import type { Direction, OfficeServerMessage } from '@legends/shared'

type Handler<T> = (payload: T) => void

/**
 * Única fronteira entre o React e o Phaser.
 *
 * O jogo é imperativo e vive fora do ciclo de render: passar estado por props
 * faria cada re-render tentar reconstruir a cena. Aqui o hook empurra eventos
 * do servidor para dentro (`emitServerMessage`) e a cena empurra a intenção do
 * teclado para fora (`emitMoveIntent`), sem que nenhum dos dois conheça o outro.
 */
export class OfficeBridge {
  private serverHandlers = new Set<Handler<OfficeServerMessage>>()
  private moveHandlers = new Set<Handler<Direction>>()

  onServerMessage(handler: Handler<OfficeServerMessage>): () => void {
    this.serverHandlers.add(handler)
    return () => this.serverHandlers.delete(handler)
  }

  emitServerMessage(message: OfficeServerMessage): void {
    for (const handler of this.serverHandlers) handler(message)
  }

  onMoveIntent(handler: Handler<Direction>): () => void {
    this.moveHandlers.add(handler)
    return () => this.moveHandlers.delete(handler)
  }

  emitMoveIntent(dir: Direction): void {
    for (const handler of this.moveHandlers) handler(dir)
  }
}
```

- [ ] **Step 4: Implementar o hook**

`apps/web/src/office/useOfficeSocket.ts` (a conexão/reconexão segue o padrão de `lib/useReviewSocket.ts`):

```ts
import { useEffect, useState } from 'react'
import type { OfficeOccupant, OfficeServerMessage } from '@legends/shared'
import { getAccessToken, refreshAccessToken } from '../lib/api'
import type { OfficeBridge } from './OfficeBridge'

export interface OfficeSocketState {
  occupants: OfficeOccupant[]
  youId: string | null
  connected: boolean
}

/**
 * Mantém a conexão com o escritório enquanto a rota está montada.
 *
 * Guarda os ocupantes em estado React (para o HUD "quem está online") e repassa
 * TODAS as mensagens ao bridge, de onde a cena do Phaser se vira. O estado do
 * jogo em si é do servidor: aqui não há predição nem correção.
 */
export function useOfficeSocket(bridge: OfficeBridge): OfficeSocketState {
  const [occupants, setOccupants] = useState<OfficeOccupant[]>([])
  const [youId, setYouId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let closedByUs = false
    let attempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    const unsubscribeMove = bridge.onMoveIntent((dir) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'move', dir }))
      }
    })

    function apply(message: OfficeServerMessage) {
      switch (message.type) {
        case 'welcome':
          setYouId(message.youId)
          setOccupants(message.occupants)
          break
        case 'joined':
          setOccupants((prev) =>
            prev.some((o) => o.userId === message.occupant.userId)
              ? prev
              : [...prev, message.occupant],
          )
          break
        case 'left':
          setOccupants((prev) => prev.filter((o) => o.userId !== message.userId))
          break
        case 'moved':
          setOccupants((prev) =>
            prev.map((o) =>
              o.userId === message.userId
                ? { ...o, x: message.x, y: message.y, dir: message.dir }
                : o,
            ),
          )
          break
        case 'sync':
          // Reancoragem de posição: só interessa à cena, não ao HUD.
          break
      }
    }

    async function connect() {
      let token = getAccessToken()
      if (attempts > 0 || !token) {
        await refreshAccessToken()
        token = getAccessToken()
      }
      if (!token || closedByUs) return

      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${scheme}://${window.location.host}/api/office/ws?token=${token}`)

      ws.onopen = () => {
        attempts = 0
        setConnected(true)
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let message: OfficeServerMessage
        try {
          message = JSON.parse(ev.data) as OfficeServerMessage
        } catch {
          return
        }
        apply(message)
        bridge.emitServerMessage(message)
      }
      ws.onclose = () => {
        setConnected(false)
        if (closedByUs) return
        attempts += 1
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15000))
      }
      ws.onerror = () => ws?.close()
    }
    void connect()

    return () => {
      closedByUs = true
      unsubscribeMove()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      ws = null
    }
  }, [bridge])

  return { occupants, youId, connected }
}
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/web test src/office/useOfficeSocket.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/OfficeBridge.ts apps/web/src/office/useOfficeSocket.ts apps/web/src/office/useOfficeSocket.test.ts
git commit -m "feat(web): bridge e socket do escritório virtual"
```

---

### Task 5: Cena Phaser e canvas

O jogo em si. Desenha o mapa a partir de `OFFICE_MAP`, cria/destrói personagens conforme o bridge, e traduz teclado em intenção.

**Não há teste da cena** — Phaser precisa de canvas/WebGL, que o jsdom não tem, e um teste com tudo mockado só verificaria os mocks. O que é testável (mapa, colisão, protocolo, socket) já está coberto nas tasks 1, 2, 4. A cena é validada rodando o app.

**Files:**
- Modify: `apps/web/package.json` (dependência `phaser`)
- Create: `apps/web/src/office/scenes/OfficeScene.ts`
- Create: `apps/web/src/office/OfficeCanvas.tsx`

**Interfaces:**
- Consumes: `OfficeBridge` (task 4); de `@legends/shared` — `OFFICE_MAP`, `OFFICE_WIDTH`, `OFFICE_HEIGHT`, `TILE_SIZE`, tipos `Direction`, `OfficeOccupant`, `OfficeServerMessage`.
- Produces: `class OfficeScene extends Phaser.Scene` (construtor recebe o `OfficeBridge`); componente `OfficeCanvas({ bridge })`.

- [ ] **Step 1: Instalar o Phaser**

```bash
pnpm --filter @legends/web add phaser@^3.80.1
```

- [ ] **Step 2: Escrever a cena**

`apps/web/src/office/scenes/OfficeScene.ts`:

```ts
import Phaser from 'phaser'
import {
  OFFICE_MAP,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  TILE_SIZE,
  type Direction,
  type OfficeOccupant,
  type OfficeServerMessage,
} from '@legends/shared'
import type { OfficeBridge } from '../OfficeBridge'

/** Duração do passo entre dois tiles. Casa com o rate limit do servidor (10/s). */
const STEP_MS = 150
/** Cadência do teclado com a tecla presa — não adianta mandar mais do que o servidor aceita. */
const INPUT_COOLDOWN_MS = 160

const TILE_COLORS: Record<string, number> = {
  '.': 0x2a2a31,
  S: 0x33333c,
  '#': 0x15151a,
  D: 0x5a4632,
  P: 0x2f5d3a,
  C: 0x4a4a57,
}

interface CharacterView {
  container: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Image
  head: Phaser.GameObjects.Image
  tween?: Phaser.Tweens.Tween
  /** Tween do "walk cycle". Precisa ser rastreado para ser parado — os passos
   *  chegam a cada ~100 ms e o bob dura 150 ms, então eles se sobrepõem. */
  bobTween?: Phaser.Tweens.Tween
}

/** Teclas por direção. Criadas UMA vez no `create` — nunca dentro do `update`. */
type DirectionKeys = Record<Direction, Phaser.Input.Keyboard.Key[]>

/** Centro em pixels do tile (x, y). */
function tileCenter(x: number, y: number): { px: number; py: number } {
  return { px: x * TILE_SIZE + TILE_SIZE / 2, py: y * TILE_SIZE + TILE_SIZE / 2 }
}

/**
 * O escritório. Recebe eventos do servidor pelo bridge e emite intenção de
 * movimento de volta — não decide nada sozinha (o servidor é autoritativo).
 */
export class OfficeScene extends Phaser.Scene {
  private characters = new Map<string, CharacterView>()
  private youId: string | null = null
  private lastInputAt = 0
  private unsubscribe: (() => void) | null = null
  private keys: DirectionKeys | null = null

  constructor(private readonly bridge: OfficeBridge) {
    super('office')
  }

  /**
   * Texturas placeholder geradas em runtime — nenhum PNG no repo.
   *
   * ESTE É O PONTO DE TROCA: quando entrar o spritesheet real (tileset +
   * personagem 4 direções), é aqui que ele é carregado, e o resto da cena
   * segue igual.
   */
  preload(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false)

    for (const [tile, color] of Object.entries(TILE_COLORS)) {
      g.clear()
      g.fillStyle(color, 1)
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE)
      g.lineStyle(1, 0x000000, 0.25)
      g.strokeRect(0, 0, TILE_SIZE, TILE_SIZE)
      g.generateTexture(`tile-${tile}`, TILE_SIZE, TILE_SIZE)
    }

    // Corpo e cabeça em branco: a cor de cada pessoa entra por tint.
    g.clear()
    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(0, 0, 18, 20, 5)
    g.generateTexture('char-body', 18, 20)

    g.clear()
    g.fillStyle(0xffffff, 1)
    g.fillCircle(9, 9, 9)
    g.generateTexture('char-head', 18, 18)

    g.destroy()
  }

  create(): void {
    OFFICE_MAP.forEach((row, y) => {
      ;[...row].forEach((tile, x) => {
        const { px, py } = tileCenter(x, y)
        this.add.image(px, py, `tile-${tile}`)
      })
    })

    this.cameras.main.setBounds(0, 0, OFFICE_WIDTH * TILE_SIZE, OFFICE_HEIGHT * TILE_SIZE)

    const keyboard = this.input.keyboard
    if (keyboard) {
      this.keys = {
        up: [keyboard.addKey('UP'), keyboard.addKey('W')],
        down: [keyboard.addKey('DOWN'), keyboard.addKey('S')],
        left: [keyboard.addKey('LEFT'), keyboard.addKey('A')],
        right: [keyboard.addKey('RIGHT'), keyboard.addKey('D')],
      }
    }

    this.unsubscribe = this.bridge.onServerMessage((message) => this.handle(message))

    // IMPORTANTE: tem que ser DESTROY, não SHUTDOWN. `game.destroy()` (o que o
    // OfficeCanvas chama no unmount) vai por SceneManager.destroy() → sys.destroy(),
    // que emite só DESTROY — SHUTDOWN só dispara ao pausar/trocar de cena. Com
    // SHUTDOWN, este cleanup vira código morto: a cena zumbi continua inscrita no
    // bridge e, na próxima mensagem, estoura contra uma cena já destruída.
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.unsubscribe?.()
      this.unsubscribe = null
      this.characters.clear()
      this.keys = null
    })
  }

  update(time: number): void {
    if (time - this.lastInputAt < INPUT_COOLDOWN_MS) return
    const dir = this.pressedDirection()
    if (!dir) return
    this.lastInputAt = time
    this.bridge.emitMoveIntent(dir)
  }

  /**
   * Segurar a tecla anda continuamente, na cadência do `INPUT_COOLDOWN_MS` — que
   * é o mesmo teto do rate limit do servidor, para não gerar tráfego descartado.
   */
  private pressedDirection(): Direction | null {
    if (!this.keys) return null
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      if (this.keys[dir].some((key) => key.isDown)) return dir
    }
    return null
  }

  private handle(message: OfficeServerMessage): void {
    switch (message.type) {
      case 'welcome': {
        this.youId = message.youId
        // Reconexão: o welcome é o estado completo, então recomeça do zero.
        for (const userId of [...this.characters.keys()]) this.destroyCharacter(userId)
        for (const occupant of message.occupants) this.spawn(occupant)
        const you = this.characters.get(message.youId)
        if (you) this.cameras.main.startFollow(you.container, true, 0.1, 0.1)
        break
      }
      case 'joined':
        this.spawn(message.occupant)
        break
      case 'left':
        this.destroyCharacter(message.userId)
        break
      case 'moved':
        this.step(message.userId, message.x, message.y, message.dir)
        break
      case 'sync': {
        if (!this.youId) break
        const view = this.characters.get(this.youId)
        if (!view) break
        view.tween?.stop()
        const { px, py } = tileCenter(message.x, message.y)
        view.container.setPosition(px, py)
        this.face(view, message.dir)
        break
      }
    }
  }

  /**
   * Para os tweens ANTES de destruir o container. O loop de tween do Phaser
   * escreve em `target[key]` sem checar se o alvo ainda existe — sem isso, um
   * tween continua escrevendo num container destruído por até STEP_MS.
   */
  private destroyCharacter(userId: string): void {
    const view = this.characters.get(userId)
    if (!view) return
    view.tween?.stop()
    view.bobTween?.stop()
    view.container.destroy()
    this.characters.delete(userId)
  }

  private spawn(occupant: OfficeOccupant): void {
    if (this.characters.has(occupant.userId)) this.destroyCharacter(occupant.userId)

    const { px, py } = tileCenter(occupant.x, occupant.y)
    const body = this.add.image(0, 4, 'char-body')
    body.setTint(Number.parseInt(occupant.clothingColor, 16))
    const head = this.add.image(0, -10, 'char-head')
    head.setTint(Number.parseInt(occupant.skinColor, 16))

    const label = this.add.text(0, 18, occupant.name.split(' ')[0], {
      fontFamily: 'sans-serif',
      fontSize: '10px',
      color: '#ffffff',
    })
    label.setOrigin(0.5, 0)

    const container = this.add.container(px, py, [body, head, label])
    container.setDepth(occupant.y)

    const view: CharacterView = { container, body, head }
    this.face(view, occupant.dir)
    this.characters.set(occupant.userId, view)
  }

  private step(userId: string, x: number, y: number, dir: Direction): void {
    const view = this.characters.get(userId)
    if (!view) return

    view.tween?.stop()
    view.bobTween?.stop()
    this.face(view, dir)
    const { px, py } = tileCenter(x, y)

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
    // aceita ~10 passos/s (100 ms) e o bob dura 150 ms, então dois bobs se
    // sobreporiam escrevendo em `body.y` ao mesmo tempo.
    view.bobTween = this.tweens.add({
      targets: view.body,
      y: 2,
      duration: STEP_MS / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => view.body.setY(4),
    })
  }

  /** Placeholder de "direção": desloca a cabeça para o lado que a pessoa encara. */
  private face(view: CharacterView, dir: Direction): void {
    const offsetX = dir === 'left' ? -3 : dir === 'right' ? 3 : 0
    const offsetY = dir === 'up' ? -12 : -10
    view.head.setPosition(offsetX, offsetY)
  }
}
```

- [ ] **Step 3: Escrever o canvas**

`apps/web/src/office/OfficeCanvas.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { OFFICE_WIDTH, OFFICE_HEIGHT, TILE_SIZE } from '@legends/shared'
import type { OfficeBridge } from './OfficeBridge'

/**
 * Monta o jogo UMA vez e o destrói no unmount. O `bridge` é a única via de
 * comunicação — nenhuma prop que muda entra aqui, então o React nunca
 * re-renderiza o Phaser.
 *
 * O `import()` dinâmico mantém o Phaser (~350 kB gzip) fora do bundle principal:
 * só quem abre o escritório paga por ele.
 */
export function OfficeCanvas({ bridge }: { bridge: OfficeBridge }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let game: import('phaser').Game | null = null
    let cancelled = false

    void (async () => {
      const [{ default: Phaser }, { OfficeScene }] = await Promise.all([
        import('phaser'),
        import('./scenes/OfficeScene'),
      ])
      if (cancelled || !hostRef.current) return

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: OFFICE_WIDTH * TILE_SIZE,
        height: OFFICE_HEIGHT * TILE_SIZE,
        backgroundColor: '#15151a',
        pixelArt: true,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: new OfficeScene(bridge),
      })
    })()

    return () => {
      cancelled = true
      game?.destroy(true)
      game = null
    }
  }, [bridge])

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden rounded-lg bg-surface-container-highest"
      aria-label="Mapa do escritório"
    />
  )
}
```

- [ ] **Step 4: Verificar que o build passa**

Run: `pnpm --filter @legends/web build`
Expected: build OK, e o output mostra um chunk separado para o Phaser (algo como `phaser-*.js`, ~1 MB / ~350 kB gzip) — sinal de que o `import()` dinâmico funcionou.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/OfficeCanvas.tsx pnpm-lock.yaml
git commit -m "feat(web): cena Phaser do escritório com texturas placeholder"
```

---

### Task 6: Página, rota e menu

Junta tudo: página com o canvas + HUD de quem está online, rota lazy e item no menu.

**Files:**
- Create: `apps/web/src/pages/OfficePage.tsx`
- Create: `apps/web/src/pages/OfficePage.test.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/escritorio` com `lazy` + `Suspense`)
- Modify: `apps/web/src/components/nav-items.ts` (item de menu)

**Interfaces:**
- Consumes: `OfficeBridge`, `useOfficeSocket`, `OfficeCanvas` (tasks 4 e 5).
- Produces: `OfficePage` (export nomeado).

- [ ] **Step 1: Escrever o teste falhando**

`apps/web/src/pages/OfficePage.test.tsx` — o `OfficeCanvas` é mockado (jsdom não tem canvas/WebGL); o teste cobre o HUD, que é o que a página realmente possui:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'

vi.mock('../office/OfficeCanvas', () => ({
  OfficeCanvas: () => <div data-testid="office-canvas" />,
}))

const occupants: OfficeOccupant[] = [
  { userId: 'ana', name: 'Ana Silva', x: 11, y: 14, dir: 'down', skinColor: 'edb98a', clothingColor: '8fa7df' },
  { userId: 'bruno', name: 'Bruno Costa', x: 12, y: 14, dir: 'up', skinColor: 'd08b5b', clothingColor: '78e185' },
]

vi.mock('../office/useOfficeSocket', () => ({
  useOfficeSocket: () => ({ occupants, youId: 'ana', connected: true }),
}))

import { OfficePage } from './OfficePage'

describe('OfficePage', () => {
  it('mostra o mapa e quem está no escritório', () => {
    render(<OfficePage />)

    expect(screen.getByTestId('office-canvas')).toBeInTheDocument()
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
    expect(screen.getByText(/2 pessoas no escritório/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/web test src/pages/OfficePage.test.tsx`
Expected: FAIL — `Cannot find module './OfficePage'`.

- [ ] **Step 3: Implementar a página**

`apps/web/src/pages/OfficePage.tsx`:

```tsx
import { useRef } from 'react'
import { OfficeBridge } from '../office/OfficeBridge'
import { OfficeCanvas } from '../office/OfficeCanvas'
import { useOfficeSocket } from '../office/useOfficeSocket'

export function OfficePage() {
  // O bridge precisa sobreviver aos re-renders: se trocasse de identidade,
  // o efeito do socket e o jogo seriam recriados a cada render.
  const bridgeRef = useRef<OfficeBridge | null>(null)
  if (bridgeRef.current === null) bridgeRef.current = new OfficeBridge()
  const bridge = bridgeRef.current

  const { occupants, youId, connected } = useOfficeSocket(bridge)

  const count = occupants.length
  const countLabel =
    count === 1 ? '1 pessoa no escritório' : `${count} pessoas no escritório`

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h1 className="font-display text-headline-md text-on-surface">Escritório</h1>
          <p className="font-body text-body-md text-on-surface-variant">
            Use as setas ou WASD para andar.
          </p>
        </div>
        <span className="font-label text-label-md text-on-surface-variant">
          {connected ? countLabel : 'Conectando…'}
        </span>
      </header>

      <div className="grid gap-lg lg:grid-cols-[1fr_240px]">
        <div className="aspect-[25/18] w-full">
          <OfficeCanvas bridge={bridge} />
        </div>

        <aside className="rounded-lg bg-surface-container p-md">
          <h2 className="mb-sm font-label text-label-lg text-on-surface">Por aqui agora</h2>
          <ul className="flex flex-col gap-xs">
            {occupants.map((occupant) => (
              <li
                key={occupant.userId}
                className="flex items-center gap-sm font-body text-body-md text-on-surface"
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: `#${occupant.clothingColor}` }}
                />
                <span className="truncate">{occupant.name}</span>
                {occupant.userId === youId && (
                  <span className="font-label text-label-sm text-on-surface-variant">(você)</span>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/web test src/pages/OfficePage.test.tsx`
Expected: PASS — 1 teste.

- [ ] **Step 5: Registrar a rota (lazy)**

Em `apps/web/src/App.tsx`:

1. adicionar `lazy` e `Suspense` ao import do React (o arquivo hoje só importa `type ReactNode`):

```tsx
import { lazy, Suspense, type ReactNode } from 'react'
```

2. declarar a página lazy junto dos outros imports de página (o `import()` só é buscado quando alguém abre a rota — é isso que mantém o Phaser fora do bundle principal):

```tsx
const OfficePage = lazy(() =>
  import('./pages/OfficePage').then((m) => ({ default: m.OfficePage })),
)
```

3. dentro do `<Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>`, logo após a rota `/quinta-desenvolvimento`:

```tsx
              <Route
                path="/escritorio"
                element={
                  <DevOnly>
                    <Suspense
                      fallback={
                        <p className="font-body text-body-md text-on-surface-variant">
                          Abrindo o escritório…
                        </p>
                      }
                    >
                      <OfficePage />
                    </Suspense>
                  </DevOnly>
                }
              />
```

- [ ] **Step 6: Adicionar o item de menu**

Em `apps/web/src/components/nav-items.ts`, na lista de não-admin (o `return` final), após a linha da Quinta de Dev:

```ts
    { to: '/escritorio', label: 'Escritório', icon: 'chair' },
```

- [ ] **Step 7: Rodar a suíte inteira**

```bash
pnpm db:up
pnpm test
pnpm build
```
Expected: todos os testes passam (shared, api, web) e o build sai limpo.

- [ ] **Step 8: Verificar no navegador**

```bash
pnpm dev
```
Abrir `http://localhost:5173/escritorio` em **duas abas** com usuários diferentes (o seed cria vários; use dois navegadores/janela anônima para ter sessões distintas). Confirmar:
- os dois personagens aparecem no mapa e no painel "Por aqui agora";
- andar com as setas numa aba move o personagem **na outra**;
- não dá para atravessar paredes nem as mesas;
- fechar uma aba remove o personagem da outra.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx apps/web/src/App.tsx apps/web/src/components/nav-items.ts
git commit -m "feat(web): página do escritório virtual com rota e menu"
```

---

## Depois do v1 (fora deste plano)

Registrado só para não virar escopo silencioso: spritesheet real (troca no `preload` da `OfficeScene`), client-side prediction se a latência incomodar, proximidade/chat, salas, persistência de posição.
