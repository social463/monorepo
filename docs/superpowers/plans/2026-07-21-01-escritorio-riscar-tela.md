# Riscar a tela compartilhada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que qualquer pessoa que veja a tela compartilhada em destaque desenhe por cima dela, com o traço aparecendo para os demais e sumindo sozinho depois de ~3 s.

**Architecture:** Os traços trafegam pelo WebSocket do escritório (`office-ws` → `office-hub`), com contrato tipado em `@legends/shared`, no mesmo molde de `room-chat-message`/`confetti`. No web, um diretório novo `apps/web/src/office/annotation/` isola geometria (puro), cor (puro), estado/rede (hook) e desenho (canvas); `MediaTiles` só ganha o botão de alternar e monta o overlay sobre o tile em destaque.

**Tech Stack:** TypeScript ESM strict, React 18, Canvas 2D, Fastify + `ws`, Vitest (+ Testing Library no web).

**Spec:** `docs/superpowers/specs/2026-07-21-escritorio-riscar-tela-design.md`

## Global Constraints

- Branch de trabalho: `feat/escritorio-riscar-tela` (já criada a partir de `origin/main`).
- **Escreva os testes de cada tarefa, mas NÃO os execute** — decisão do autor do plano. Cada tarefa traz o comando exato numa linha "Verificação (não rodar agora)" para quem quiser rodar depois.
- Typecheck é a verificação ativa: `pnpm --filter @legends/web exec tsc --noEmit` e `pnpm --filter @legends/api exec tsc --noEmit`. **Nunca** use `npx tsc` neste ambiente.
- Mensagens e rótulos voltados ao usuário em **português**.
- Contrato api⇄web muda **primeiro** em `@legends/shared`, depois nos dois lados.
- Rota fina: `office-ws.ts` só despacha; regra vive no hub. No web, DOM só no componente de canvas.
- Comentários no estilo da camada vizinha: explicam **por quê**, não o quê.
- Constantes vindas de `@legends/shared` — nada de número mágico duplicado nos dois lados.

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
| --- | --- | --- |
| `packages/shared/src/office-annotation.ts` | Tipo do ponto, constantes, validação pura dos pontos | 1 |
| `packages/shared/src/office-annotation.test.ts` | Testes da validação | 1 |
| `packages/shared/src/office.ts` | Variantes `screen-annotation` nas uniões cliente/servidor | 1 |
| `packages/shared/src/index.ts` | Reexporta o módulo novo | 1 |
| `apps/api/src/lib/office-hub.ts` | `screenAnnotation()`: valida e difunde | 2 |
| `apps/api/src/routes/office-ws.ts` | Despacho da mensagem para o hub | 3 |
| `apps/web/src/office/annotation/annotation-geometry.ts` | Área útil do vídeo, normalizar/desnormalizar, clamp | 4 |
| `apps/web/src/office/annotation/annotation-color.ts` | Cor determinística por `userId` | 5 |
| `apps/web/src/office/annotation/useScreenAnnotations.ts` | Traços vivos, TTL, lotes, bridge | 6 |
| `apps/web/src/office/annotation/AnnotationCanvas.tsx` | `<canvas>`, pointer events, rAF | 7 |
| `apps/web/src/office/media/MediaTiles.tsx` | Botão "Riscar", `Esc`, monta o overlay no tile em destaque | 8 |
| `apps/web/src/pages/OfficePage.tsx` | Liga o hook ao `MediaTiles` | 9 |

---

### Task 1: Contrato e validação em `@legends/shared`

**Files:**
- Create: `packages/shared/src/office-annotation.ts`
- Create: `packages/shared/src/office-annotation.test.ts`
- Modify: `packages/shared/src/office.ts` (uniões `OfficeClientMessage` ~linha 171-203 e `OfficeServerMessage` ~linha 298+)
- Modify: `packages/shared/src/index.ts` (barril)

**Interfaces:**
- Consumes: nada.
- Produces: `OfficeAnnotationPoint`, `OFFICE_ANNOTATION_STROKE_TTL_MS`, `OFFICE_ANNOTATION_ABANDON_MS`, `OFFICE_ANNOTATION_BATCH_MS`, `OFFICE_ANNOTATION_MAX_POINTS`, `OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH`, `sanitizeAnnotationPoints(input: unknown): OfficeAnnotationPoint[] | null`, e as variantes `screen-annotation` nas duas uniões.

- [ ] **Step 1: Escreva o teste da validação**

Crie `packages/shared/src/office-annotation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  OFFICE_ANNOTATION_MAX_POINTS,
  sanitizeAnnotationPoints,
} from "./office-annotation";

describe("sanitizeAnnotationPoints", () => {
  it("aceita pontos dentro de 0–1 e arredonda para 3 casas", () => {
    expect(sanitizeAnnotationPoints([{ x: 0.123456, y: 0.9 }])).toEqual([
      { x: 0.123, y: 0.9 },
    ]);
  });

  it("recusa o que não é lista de pontos", () => {
    expect(sanitizeAnnotationPoints(undefined)).toBeNull();
    expect(sanitizeAnnotationPoints("0,0")).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: 0.5 }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: "0.5", y: 0.5 }])).toBeNull();
  });

  it("recusa lista vazia — um lote sem ponto não é traço", () => {
    expect(sanitizeAnnotationPoints([])).toBeNull();
  });

  it("recusa coordenada fora de 0–1 ou não finita", () => {
    expect(sanitizeAnnotationPoints([{ x: -0.01, y: 0.5 }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: 0.5, y: 1.01 }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: Number.NaN, y: 0.5 }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: 0.5, y: Number.POSITIVE_INFINITY }])).toBeNull();
  });

  it("recusa lote acima do teto em vez de cortar — cliente honesto nunca passa disso", () => {
    const points = Array.from({ length: OFFICE_ANNOTATION_MAX_POINTS + 1 }, () => ({
      x: 0.5,
      y: 0.5,
    }));
    expect(sanitizeAnnotationPoints(points)).toBeNull();
    expect(sanitizeAnnotationPoints(points.slice(1))).toHaveLength(
      OFFICE_ANNOTATION_MAX_POINTS,
    );
  });
});
```

- [ ] **Step 2: Implemente o módulo**

Crie `packages/shared/src/office-annotation.ts`:

```ts
/**
 * Ponto de um traço desenhado sobre a tela compartilhada, normalizado 0–1
 * SOBRE O CONTEÚDO do vídeo (não sobre o elemento): o vídeo é renderizado com
 * `object-contain`, então sobra letterbox, e normalizar pelo elemento faria o
 * traço cair em pixels diferentes para cada tamanho de janela.
 */
export interface OfficeAnnotationPoint {
  x: number;
  y: number;
}

/** Quanto tempo um traço terminado leva para sumir (fade) — comportamento de apontador. */
export const OFFICE_ANNOTATION_STROKE_TTL_MS = 3000;

/**
 * Rede de segurança para traço que nunca recebeu o lote final (quem desenhava
 * caiu no meio). Alto de propósito: enquanto o ponteiro está parado, nenhum
 * lote é enviado, e um valor curto apagaria traço legítimo.
 */
export const OFFICE_ANNOTATION_ABANDON_MS = 15_000;

/** Intervalo de envio dos lotes de pontos enquanto se desenha. */
export const OFFICE_ANNOTATION_BATCH_MS = 60;

/** Teto de pontos por mensagem. */
export const OFFICE_ANNOTATION_MAX_POINTS = 64;

/** Teto do identificador de traço aceito pelo servidor. */
export const OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH = 64;

function isPoint(value: unknown): value is OfficeAnnotationPoint {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as { x: unknown; y: unknown };
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1
  );
}

/**
 * Valida um lote vindo da rede e devolve os pontos arredondados, ou `null` se
 * qualquer coisa estiver fora do contrato. Recusa o lote inteiro em vez de
 * consertá-lo: cliente honesto nunca manda fora da faixa, e cortar em silêncio
 * esconderia bug de geometria.
 */
export function sanitizeAnnotationPoints(
  input: unknown,
): OfficeAnnotationPoint[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length === 0 || input.length > OFFICE_ANNOTATION_MAX_POINTS) return null;
  const points: OfficeAnnotationPoint[] = [];
  for (const item of input) {
    if (!isPoint(item)) return null;
    points.push({
      x: Math.round(item.x * 1000) / 1000,
      y: Math.round(item.y * 1000) / 1000,
    });
  }
  return points;
}
```

- [ ] **Step 3: Reexporte no barril**

Em `packages/shared/src/index.ts`, logo abaixo de `export * from './office-media'`, acrescente:

```ts
export * from './office-annotation'
```

- [ ] **Step 4: Acrescente as variantes nas uniões**

Em `packages/shared/src/office.ts`, no topo, ao lado dos imports existentes:

```ts
import { type OfficeAnnotationPoint } from "./office-annotation";
```

No fim de `OfficeClientMessage` (hoje termina em `knock-response`, ~linha 203), troque o `;` final da última variante por uma nova entrada:

```ts
  | { type: "knock-response"; userId: string; accepted: boolean }
  /**
   * Um lote de pontos de um traço sobre a tela de `sharerId` (o userId de quem
   * compartilha, mesmo quando é a própria). `strokeId` agrupa os lotes de um
   * mesmo traço; `done` marca o último e dispara a contagem do TTL.
   */
  | {
      type: "screen-annotation";
      sharerId: string;
      strokeId: string;
      points: OfficeAnnotationPoint[];
      done?: boolean;
    };
```

No fim de `OfficeServerMessage`, acrescente a variante espelhada com o autor:

```ts
  /** Rebroadcast de um lote de traço — `userId` é quem desenhou. */
  | {
      type: "screen-annotation";
      userId: string;
      sharerId: string;
      strokeId: string;
      points: OfficeAnnotationPoint[];
      done?: boolean;
    };
```

Atenção: `OfficeServerMessage` termina com `;` na última variante — mantenha o `;` só no fim da união.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @legends/shared exec tsc --noEmit
```

Esperado: sem saída (sucesso).

Verificação (não rodar agora): `pnpm --filter @legends/shared exec vitest run src/office-annotation.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/office-annotation.ts packages/shared/src/office-annotation.test.ts packages/shared/src/office.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato de anotação sobre a tela compartilhada"
```

---

### Task 2: Hub difunde as anotações

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts` (método novo perto de `roomChatMessage`, ~linha 718)
- Test: `apps/api/src/lib/office-hub.test.ts` (novo `describe` no fim do arquivo)

**Interfaces:**
- Consumes: `sanitizeAnnotationPoints`, `OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH`, `OfficeAnnotationPoint` (Task 1); métodos privados existentes `raiseHandZoneId(x, y)`, `broadcastToRoom(roomId, message, exceptSocket?)`, `broadcast(message, exceptUserId?)`.
- Produces: `OfficeHub.screenAnnotation(socket: OfficeSocket, userId: string, message: { sharerId: unknown; strokeId: unknown; points: unknown; done?: unknown }): void`.

- [ ] **Step 1: Escreva os testes do hub**

No fim de `apps/api/src/lib/office-hub.test.ts`, acrescente:

```ts
describe('screenAnnotation', () => {
  it('dentro de sala, chega aos outros da sala e não ecoa no socket remetente', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'bruno',
      strokeId: 's1',
      points: [{ x: 0.1, y: 0.2 }],
      done: true,
    })

    expect(a.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
    expect(b.sent).toContainEqual(
      expect.objectContaining({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.2 }],
        done: true,
      }),
    )
  })

  it('dentro de sala, não vaza para quem está fora dela', () => {
    const a = fakeSocket()
    const c = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(c.socket, carla)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    expect(c.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
  })

  it('fora de sala, difunde para o escritório — quem não vê a tela descarta no cliente', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'screen-annotation', userId: 'ana', sharerId: 'ana' }),
    )
  })

  it('omite `done` quando o lote não é o último', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    const message = b.sent.find((m) => m.type === 'screen-annotation')
    expect(message).toBeDefined()
    expect('done' in (message as object)).toBe(false)
  })

  it('ignora payload inválido (pontos fora da faixa, ids vazios, sharer ausente)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.screenAnnotation(a.socket, 'ana', { sharerId: 'ana', strokeId: 's1', points: [{ x: 2, y: 0 }] })
    hub.screenAnnotation(a.socket, 'ana', { sharerId: '', strokeId: 's1', points: [{ x: 0.5, y: 0.5 }] })
    hub.screenAnnotation(a.socket, 'ana', { sharerId: 'ana', strokeId: '', points: [{ x: 0.5, y: 0.5 }] })
    hub.screenAnnotation(a.socket, 'ana', { sharerId: 'ana', strokeId: 's1', points: 'nada' })

    expect(b.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
  })

  it('ignora quem manda em nome de outro (socket não é dono do userId)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.screenAnnotation(a.socket, 'bruno', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    expect(b.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
  })
})
```

O arquivo já tem `fakeSocket`, `walkTo`, `ROOM1_INSIDE`, `ana`, `bruno`, `carla` e o `hub` do `beforeEach` — não recrie nada disso.

- [ ] **Step 2: Importe o que falta no hub**

Em `apps/api/src/lib/office-hub.ts`, acrescente ao import de `@legends/shared` (o bloco já existente no topo):

```ts
  OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH,
  sanitizeAnnotationPoints,
```

- [ ] **Step 3: Implemente `screenAnnotation`**

Logo depois do método `roomChatMessage` (que termina com o `broadcastToRoom(...)`, ~linha 740), acrescente:

```ts
  /**
   * Um lote de pontos de um traço sobre a tela compartilhada. Efêmero como o
   * confete: nada é guardado, então quem chega no meio de um traço não o vê —
   * coerente com um apontador.
   *
   * Escopo: dentro de sala/zona, só a zona (mesmo público do chat da sala);
   * fora dela, o escritório todo, e o cliente descarta o que for de uma tela
   * que ele não está vendo — mesmo desenho de `nearby-message`. Em ambos os
   * casos quem desenhou não recebe de volta: o traço já apareceu localmente.
   */
  screenAnnotation(
    socket: OfficeSocket,
    userId: string,
    message: { sharerId: unknown; strokeId: unknown; points: unknown; done?: unknown },
  ): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    if (typeof message.sharerId !== 'string' || !message.sharerId) return
    if (typeof message.strokeId !== 'string' || !message.strokeId) return
    if (message.strokeId.length > OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH) return
    const points = sanitizeAnnotationPoints(message.points)
    if (!points) return

    const outgoing: OfficeServerMessage = {
      type: 'screen-annotation',
      userId,
      sharerId: message.sharerId,
      strokeId: message.strokeId,
      points,
      // Só carrega o campo quando é o último lote — evita `done: false` no fio.
      ...(message.done === true ? { done: true } : {}),
    }

    const zoneId = this.raiseHandZoneId(entry.occupant.x, entry.occupant.y)
    if (zoneId) this.broadcastToRoom(zoneId, outgoing, socket)
    else this.broadcast(outgoing, userId)
  }
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @legends/api exec tsc --noEmit
```

Esperado: sem saída.

Verificação (não rodar agora): `pnpm db:up && pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): difusão de anotações sobre a tela compartilhada"
```

---

### Task 3: Rota WS despacha a mensagem

**Files:**
- Modify: `apps/api/src/routes/office-ws.ts:165-171` (fim da cadeia `else if`)
- Test: `apps/api/src/routes/office-ws.test.ts` (novo caso)

**Interfaces:**
- Consumes: `officeHub.screenAnnotation(...)` (Task 2).
- Produces: nada além do despacho.

- [ ] **Step 1: Escreva o teste de roteamento**

Em `apps/api/src/routes/office-ws.test.ts`, dentro do `describe('office websocket', ...)`, acrescente um caso no mesmo molde dos existentes (dois usuários conectados, um manda, o outro recebe):

```ts
  it('roteia screen-annotation para os outros conectados', async () => {
    const app = buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@ex.com', passwordHash: 'x' },
    })
    const bruno = await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno@ex.com', passwordHash: 'x' },
    })
    const anaToken = app.jwt.sign({ sub: ana.id, role: ana.role })
    const brunoToken = app.jwt.sign({ sub: bruno.id, role: bruno.role })

    const anaWs = new WebSocket(`ws://127.0.0.1:${port}/api/office/ws?token=${anaToken}&mapId=${activeMapId}`)
    await waitOpen(anaWs)
    const brunoWs = new WebSocket(`ws://127.0.0.1:${port}/api/office/ws?token=${brunoToken}&mapId=${activeMapId}`)
    await waitOpen(brunoWs)

    const received: OfficeServerMessage[] = []
    brunoWs.on('message', (raw) => received.push(JSON.parse(String(raw)) as OfficeServerMessage))

    anaWs.send(
      JSON.stringify({
        type: 'screen-annotation',
        sharerId: bruno.id,
        strokeId: 's1',
        points: [{ x: 0.25, y: 0.75 }],
        done: true,
      }),
    )
    await delay(50)

    expect(received).toContainEqual(
      expect.objectContaining({
        type: 'screen-annotation',
        userId: ana.id,
        sharerId: bruno.id,
        strokeId: 's1',
        points: [{ x: 0.25, y: 0.75 }],
        done: true,
      }),
    )

    anaWs.close()
    brunoWs.close()
    await app.close()
  })
```

Confira, ao escrever, a forma exata de criar usuário/token e a URL do socket usadas nos casos vizinhos do próprio arquivo e siga-as — este bloco espelha o padrão, mas o arquivo é a fonte da verdade.

- [ ] **Step 2: Despache no fim da cadeia**

Em `apps/api/src/routes/office-ws.ts`, depois do `else if` de `knock-response` (~linha 165-171), acrescente o último ramo:

```ts
        } else if (
          msg.type === 'screen-annotation' &&
          typeof msg.sharerId === 'string' &&
          typeof msg.strokeId === 'string'
        ) {
          // Os pontos são validados no hub (`sanitizeAnnotationPoints`) — aqui
          // só o formato mínimo que decide o roteamento, como nas demais.
          officeHub.screenAnnotation(ws, user.id, msg)
        }
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @legends/api exec tsc --noEmit
```

Esperado: sem saída.

Verificação (não rodar agora): `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/office-ws.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/office-ws.ts apps/api/src/routes/office-ws.test.ts
git commit -m "feat(api): rota ws despacha screen-annotation"
```

---

### Task 4: Geometria do overlay (web, puro)

**Files:**
- Create: `apps/web/src/office/annotation/annotation-geometry.ts`
- Create: `apps/web/src/office/annotation/annotation-geometry.test.ts`

**Interfaces:**
- Consumes: `OfficeAnnotationPoint` (Task 1).
- Produces:
  - `interface AnnotationRect { left: number; top: number; width: number; height: number }`
  - `videoContentRect(video: { videoWidth: number; videoHeight: number; clientWidth: number; clientHeight: number }): AnnotationRect`
  - `toNormalized(px: { x: number; y: number }, rect: AnnotationRect): OfficeAnnotationPoint`
  - `toLocal(point: OfficeAnnotationPoint, rect: AnnotationRect): { x: number; y: number }`

- [ ] **Step 1: Escreva o teste**

Crie `apps/web/src/office/annotation/annotation-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toLocal, toNormalized, videoContentRect } from './annotation-geometry'

describe('videoContentRect', () => {
  it('vídeo mais largo que o elemento: barras em cima e embaixo', () => {
    const rect = videoContentRect({ videoWidth: 1920, videoHeight: 1080, clientWidth: 800, clientHeight: 600 })
    expect(rect).toEqual({ left: 0, top: 75, width: 800, height: 450 })
  })

  it('vídeo mais alto que o elemento: barras nas laterais', () => {
    const rect = videoContentRect({ videoWidth: 600, videoHeight: 800, clientWidth: 800, clientHeight: 400 })
    expect(rect).toEqual({ left: 250, top: 0, width: 300, height: 400 })
  })

  it('mesma proporção: preenche tudo, sem barra', () => {
    const rect = videoContentRect({ videoWidth: 1000, videoHeight: 500, clientWidth: 400, clientHeight: 200 })
    expect(rect).toEqual({ left: 0, top: 0, width: 400, height: 200 })
  })

  it('sem metadados ainda (0x0): usa o elemento inteiro em vez de dividir por zero', () => {
    const rect = videoContentRect({ videoWidth: 0, videoHeight: 0, clientWidth: 800, clientHeight: 600 })
    expect(rect).toEqual({ left: 0, top: 0, width: 800, height: 600 })
  })
})

describe('toNormalized', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }

  it('converte pixel do elemento em fração do conteúdo', () => {
    expect(toNormalized({ x: 200, y: 100 }, rect)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('prende nas bordas quem sai da área do conteúdo (letterbox)', () => {
    expect(toNormalized({ x: 0, y: 0 }, rect)).toEqual({ x: 0, y: 0 })
    expect(toNormalized({ x: 9999, y: 9999 }, rect)).toEqual({ x: 1, y: 1 })
  })

  it('elemento sem área ainda: devolve o canto, sem NaN', () => {
    expect(toNormalized({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('toLocal', () => {
  it('é o inverso de toNormalized dentro da área do conteúdo', () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 }
    expect(toLocal({ x: 0.5, y: 0.5 }, rect)).toEqual({ x: 200, y: 100 })
    expect(toLocal(toNormalized({ x: 150, y: 75 }, rect), rect)).toEqual({ x: 150, y: 75 })
  })
})
```

- [ ] **Step 2: Implemente**

Crie `apps/web/src/office/annotation/annotation-geometry.ts`:

```ts
import type { OfficeAnnotationPoint } from '@legends/shared'

/** Retângulo em pixels, relativo ao canto do elemento de vídeo. */
export interface AnnotationRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Área realmente ocupada pelo conteúdo dentro do `<video>`. O tile usa
 * `object-contain`, então o vídeo é centralizado com barras (letterbox) quando
 * as proporções não batem — desenhar em cima da barra não faria sentido, e
 * normalizar pelo elemento faria o traço escorregar entre janelas de tamanhos
 * diferentes.
 */
export function videoContentRect(video: {
  videoWidth: number
  videoHeight: number
  clientWidth: number
  clientHeight: number
}): AnnotationRect {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video
  // Metadados ainda não chegaram: o elemento inteiro é a melhor aproximação.
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { left: 0, top: 0, width: clientWidth, height: clientHeight }
  }
  const scale = Math.min(clientWidth / videoWidth, clientHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return { left: (clientWidth - width) / 2, top: (clientHeight - height) / 2, width, height }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Pixel do elemento → fração 0–1 do conteúdo, presa às bordas. */
export function toNormalized(px: { x: number; y: number }, rect: AnnotationRect): OfficeAnnotationPoint {
  return {
    x: rect.width > 0 ? clamp01((px.x - rect.left) / rect.width) : 0,
    y: rect.height > 0 ? clamp01((px.y - rect.top) / rect.height) : 0,
  }
}

/** Fração 0–1 do conteúdo → pixel do elemento. */
export function toLocal(point: OfficeAnnotationPoint, rect: AnnotationRect): { x: number; y: number } {
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height }
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Esperado: sem saída.

Verificação (não rodar agora): `pnpm --filter @legends/web exec vitest run src/office/annotation/annotation-geometry.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/office/annotation/annotation-geometry.ts apps/web/src/office/annotation/annotation-geometry.test.ts
git commit -m "feat(web): geometria do overlay de anotação"
```

---

### Task 5: Cor por pessoa (web, puro)

**Files:**
- Create: `apps/web/src/office/annotation/annotation-color.ts`
- Create: `apps/web/src/office/annotation/annotation-color.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `ANNOTATION_COLORS: readonly string[]`, `annotationColor(userId: string): string`.

- [ ] **Step 1: Escreva o teste**

Crie `apps/web/src/office/annotation/annotation-color.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ANNOTATION_COLORS, annotationColor } from './annotation-color'

describe('annotationColor', () => {
  it('é determinística — a mesma pessoa desenha sempre na mesma cor, em qualquer aba', () => {
    expect(annotationColor('ana')).toBe(annotationColor('ana'))
  })

  it('sempre devolve uma cor da paleta', () => {
    for (const userId of ['ana', 'bruno', 'carla', 'daniel', 'elisa', 'fabio', 'gabi']) {
      expect(ANNOTATION_COLORS).toContain(annotationColor(userId))
    }
  })

  it('distribui pessoas diferentes por cores diferentes (não colapsa tudo numa só)', () => {
    const ids = ['ana', 'bruno', 'carla', 'daniel', 'elisa', 'fabio']
    expect(new Set(ids.map(annotationColor)).size).toBeGreaterThan(1)
  })

  it('id vazio não quebra', () => {
    expect(ANNOTATION_COLORS).toContain(annotationColor(''))
  })
})
```

- [ ] **Step 2: Implemente**

Crie `apps/web/src/office/annotation/annotation-color.ts`:

```ts
/**
 * Paleta saturada e clara: o traço cai sobre conteúdo arbitrário (código,
 * planilha, slide), então precisa contrastar com fundo claro e escuro.
 */
export const ANNOTATION_COLORS = [
  '#ff5252',
  '#ffb300',
  '#00e676',
  '#40c4ff',
  '#e040fb',
  '#ff6e40',
] as const

/**
 * Cor estável por pessoa, derivada do id (djb2). Determinística de propósito:
 * todo mundo vê o traço de fulano na mesma cor, sem o servidor mandar nada.
 */
export function annotationColor(userId: string): string {
  let hash = 5381
  for (let i = 0; i < userId.length; i += 1) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) >>> 0
  }
  return ANNOTATION_COLORS[hash % ANNOTATION_COLORS.length]
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Esperado: sem saída.

Verificação (não rodar agora): `pnpm --filter @legends/web exec vitest run src/office/annotation/annotation-color.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/office/annotation/annotation-color.ts apps/web/src/office/annotation/annotation-color.test.ts
git commit -m "feat(web): cor determinística por autor da anotação"
```

---

### Task 6: Hook de estado e rede

**Files:**
- Create: `apps/web/src/office/annotation/useScreenAnnotations.ts`
- Create: `apps/web/src/office/annotation/useScreenAnnotations.test.ts`

**Interfaces:**
- Consumes: `OfficeBridge` (`emitClientMessage`, `onServerMessage`), `annotationColor` (Task 5), constantes de Task 1.
- Produces:
  ```ts
  interface AnnotationStroke {
    strokeId: string
    userId: string
    sharerId: string
    points: OfficeAnnotationPoint[]
    color: string
    /** ms (Date.now) em que o traço terminou; null = ainda em andamento. */
    doneAt: number | null
    /** ms do último ponto recebido — rede de segurança para traço abandonado. */
    lastAt: number
  }
  interface ScreenAnnotationsState {
    strokesFor(sharerId: string): AnnotationStroke[]
    beginStroke(sharerId: string, point: OfficeAnnotationPoint): void
    extendStroke(point: OfficeAnnotationPoint): void
    endStroke(): void
  }
  function useScreenAnnotations(bridge: OfficeBridge, youId: string | null): ScreenAnnotationsState
  ```

Notas de projeto que o implementador precisa respeitar:

- O estado vive em `useRef` (um `Map<strokeId, AnnotationStroke>`), **não** em `useState`: o canvas redesenha em `requestAnimationFrame` lendo o ref, e re-renderizar o React a 60 fps por causa de um traço seria desperdício.
- O traço local aparece na hora (predição local); o servidor não devolve eco para quem desenhou.
- Envio em lote: pontos acumulam num buffer e saem a cada `OFFICE_ANNOTATION_BATCH_MS`; `endStroke` esvazia na hora com `done: true`.
- Um lote nunca passa de `OFFICE_ANNOTATION_MAX_POINTS` pontos — o buffer sai em pedaços se preciso.
- Cada lote enviado repete o **último ponto do lote anterior** como primeiro ponto, senão a linha fica com furos entre lotes.

- [ ] **Step 1: Escreva o teste**

Crie `apps/web/src/office/annotation/useScreenAnnotations.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  OFFICE_ANNOTATION_BATCH_MS,
  OFFICE_ANNOTATION_STROKE_TTL_MS,
  type OfficeClientMessage,
} from '@legends/shared'
import { OfficeBridge } from '../OfficeBridge'
import { useScreenAnnotations } from './useScreenAnnotations'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useScreenAnnotations', () => {
  it('traço remoto entra na lista do sharer certo e some do sharer errado', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.1 }],
      })
    })

    expect(result.current.strokesFor('bruno')).toHaveLength(1)
    expect(result.current.strokesFor('bruno')[0].userId).toBe('ana')
    expect(result.current.strokesFor('carla')).toHaveLength(0)
  })

  it('lotes do mesmo strokeId acumulam pontos no mesmo traço', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.1 }],
      })
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.2, y: 0.2 }],
        done: true,
      })
    })

    expect(result.current.strokesFor('bruno')[0].points).toHaveLength(2)
    expect(result.current.strokesFor('bruno')[0].doneAt).not.toBeNull()
  })

  it('traço terminado some depois do TTL', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.1 }],
        done: true,
      })
    })
    expect(result.current.strokesFor('bruno')).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(OFFICE_ANNOTATION_STROKE_TTL_MS + 1)
    })
    expect(result.current.strokesFor('bruno')).toHaveLength(0)
  })

  it('desenhar aparece localmente antes de qualquer resposta do servidor', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.extendStroke({ x: 0.2, y: 0.2 })
    })

    const [stroke] = result.current.strokesFor('bruno')
    expect(stroke.userId).toBe('eu')
    expect(stroke.points).toHaveLength(2)
  })

  it('envia em lote no intervalo, repetindo o último ponto para não abrir furo entre lotes', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.extendStroke({ x: 0.2, y: 0.2 })
      vi.advanceTimersByTime(OFFICE_ANNOTATION_BATCH_MS)
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'screen-annotation',
      sharerId: 'bruno',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
    })

    act(() => {
      result.current.extendStroke({ x: 0.3, y: 0.3 })
      vi.advanceTimersByTime(OFFICE_ANNOTATION_BATCH_MS)
    })

    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 },
      ],
    })
  })

  it('endStroke fecha o traço na hora, com done', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.endStroke()
    })

    expect(sent.at(-1)).toMatchObject({ type: 'screen-annotation', done: true })
    expect(result.current.strokesFor('bruno')[0].doneAt).not.toBeNull()
  })

  it('sem identidade (youId nulo) não desenha nem envia — sessão ainda não pronta', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, null))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.endStroke()
    })

    expect(sent).toHaveLength(0)
    expect(result.current.strokesFor('bruno')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implemente o hook**

Crie `apps/web/src/office/annotation/useScreenAnnotations.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  OFFICE_ANNOTATION_ABANDON_MS,
  OFFICE_ANNOTATION_BATCH_MS,
  OFFICE_ANNOTATION_MAX_POINTS,
  OFFICE_ANNOTATION_STROKE_TTL_MS,
  type OfficeAnnotationPoint,
} from '@legends/shared'
import type { OfficeBridge } from '../OfficeBridge'
import { annotationColor } from './annotation-color'

export interface AnnotationStroke {
  strokeId: string
  userId: string
  sharerId: string
  points: OfficeAnnotationPoint[]
  color: string
  /** ms (Date.now) em que o traço terminou; `null` = ainda em andamento. */
  doneAt: number | null
  /** ms do último ponto recebido. */
  lastAt: number
}

export interface ScreenAnnotationsState {
  /** Traços vivos daquela tela, já podados por TTL. */
  strokesFor(sharerId: string): AnnotationStroke[]
  beginStroke(sharerId: string, point: OfficeAnnotationPoint): void
  extendStroke(point: OfficeAnnotationPoint): void
  endStroke(): void
}

interface LocalStroke {
  strokeId: string
  sharerId: string
  /** Pontos ainda não enviados, com o último já enviado na frente (continuidade). */
  pending: OfficeAnnotationPoint[]
}

/**
 * Traços vivos sobre telas compartilhadas: os que chegam pelo socket e os que
 * a própria pessoa está desenhando.
 *
 * O estado mora em ref, não em state: o canvas redesenha em rAF lendo daqui, e
 * um `setState` por ponto (dezenas por segundo) só geraria re-render inútil da
 * árvore inteira da grade. Nada persiste — traço terminado morre no TTL, e
 * quem entra no meio simplesmente não vê o que já passou.
 */
export function useScreenAnnotations(
  bridge: OfficeBridge,
  youId: string | null,
): ScreenAnnotationsState {
  const strokesRef = useRef<Map<string, AnnotationStroke>>(new Map())
  const localRef = useRef<LocalStroke | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const youIdRef = useRef(youId)
  youIdRef.current = youId

  const upsert = useCallback(
    (
      userId: string,
      sharerId: string,
      strokeId: string,
      points: OfficeAnnotationPoint[],
      done: boolean,
    ) => {
      const now = Date.now()
      const existing = strokesRef.current.get(strokeId)
      if (existing) {
        existing.points.push(...points)
        existing.lastAt = now
        if (done) existing.doneAt = now
        return
      }
      strokesRef.current.set(strokeId, {
        strokeId,
        userId,
        sharerId,
        points: [...points],
        color: annotationColor(userId),
        doneAt: done ? now : null,
        lastAt: now,
      })
    },
    [],
  )

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type !== 'screen-annotation') return
        upsert(
          message.userId,
          message.sharerId,
          message.strokeId,
          message.points,
          message.done === true,
        )
      }),
    [bridge, upsert],
  )

  const flush = useCallback(
    (done: boolean) => {
      const local = localRef.current
      if (!local) return
      // Um único ponto pendente que já foi enviado (a "cauda" de continuidade)
      // não é novidade: só vale mandar se o traço está fechando.
      if (local.pending.length <= 1 && !done) return
      while (local.pending.length > 0) {
        const chunk = local.pending.slice(0, OFFICE_ANNOTATION_MAX_POINTS)
        const rest = local.pending.slice(OFFICE_ANNOTATION_MAX_POINTS)
        const last = rest.length === 0
        bridge.emitClientMessage({
          type: 'screen-annotation',
          sharerId: local.sharerId,
          strokeId: local.strokeId,
          points: chunk,
          ...(done && last ? { done: true } : {}),
        })
        // Mantém o último ponto na frente do próximo lote: sem isso, a linha
        // fica com um furo na emenda entre um lote e o seguinte.
        local.pending = rest.length === 0 ? chunk.slice(-1) : rest
        if (rest.length === 0) break
      }
      if (done) local.pending = []
    },
    [bridge],
  )

  const stopTimer = useCallback(() => {
    if (flushTimerRef.current === null) return
    clearInterval(flushTimerRef.current)
    flushTimerRef.current = null
  }, [])

  const beginStroke = useCallback(
    (sharerId: string, point: OfficeAnnotationPoint) => {
      const userId = youIdRef.current
      if (!userId) return
      const strokeId = `${userId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
      localRef.current = { strokeId, sharerId, pending: [point] }
      upsert(userId, sharerId, strokeId, [point], false)
      stopTimer()
      flushTimerRef.current = setInterval(() => flush(false), OFFICE_ANNOTATION_BATCH_MS)
    },
    [flush, stopTimer, upsert],
  )

  const extendStroke = useCallback(
    (point: OfficeAnnotationPoint) => {
      const local = localRef.current
      const userId = youIdRef.current
      if (!local || !userId) return
      local.pending.push(point)
      upsert(userId, local.sharerId, local.strokeId, [point], false)
    },
    [upsert],
  )

  const endStroke = useCallback(() => {
    const local = localRef.current
    const userId = youIdRef.current
    if (!local || !userId) return
    flush(true)
    const stroke = strokesRef.current.get(local.strokeId)
    if (stroke) stroke.doneAt = Date.now()
    localRef.current = null
    stopTimer()
  }, [flush, stopTimer])

  useEffect(() => stopTimer, [stopTimer])

  const strokesFor = useCallback((sharerId: string): AnnotationStroke[] => {
    const now = Date.now()
    const result: AnnotationStroke[] = []
    for (const [strokeId, stroke] of strokesRef.current) {
      const expired =
        stroke.doneAt !== null
          ? now - stroke.doneAt > OFFICE_ANNOTATION_STROKE_TTL_MS
          : now - stroke.lastAt > OFFICE_ANNOTATION_ABANDON_MS
      if (expired) {
        strokesRef.current.delete(strokeId)
        continue
      }
      if (stroke.sharerId === sharerId) result.push(stroke)
    }
    return result
  }, [])

  return useMemo(
    () => ({ strokesFor, beginStroke, extendStroke, endStroke }),
    [strokesFor, beginStroke, extendStroke, endStroke],
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Esperado: sem saída.

Verificação (não rodar agora): `pnpm --filter @legends/web exec vitest run src/office/annotation/useScreenAnnotations.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/office/annotation/useScreenAnnotations.ts apps/web/src/office/annotation/useScreenAnnotations.test.ts
git commit -m "feat(web): estado e envio em lote dos traços de anotação"
```

---

### Task 7: Canvas de anotação

**Files:**
- Create: `apps/web/src/office/annotation/AnnotationCanvas.tsx`
- Create: `apps/web/src/office/annotation/AnnotationCanvas.test.tsx`

**Interfaces:**
- Consumes: `ScreenAnnotationsState` (Task 6), `videoContentRect`/`toNormalized`/`toLocal` (Task 4), `OFFICE_ANNOTATION_STROKE_TTL_MS` (Task 1).
- Produces:
  ```tsx
  function AnnotationCanvas(props: {
    sharerId: string
    annotations: ScreenAnnotationsState
    active: boolean
    videoRef: RefObject<HTMLVideoElement>
  }): JSX.Element
  ```

Notas de projeto:

- O canvas ocupa `absolute inset-0` do mesmo contêiner `relative` do vídeo, então casa exatamente com a caixa do `<video>`.
- `pointer-events` só quando `active` — com o modo desligado o overlay não intercepta nada.
- Redesenho em `requestAnimationFrame` lendo `annotations.strokesFor(sharerId)`; nenhum estado React no laço.
- Se o modo desligar com um traço aberto, o componente fecha o traço (`endStroke`) — quem desliga é o `MediaTiles`, que não conhece o ponteiro.
- `jsdom` não implementa canvas: o teste faz `HTMLCanvasElement.prototype.getContext` virar um mock e `requestAnimationFrame` rodar uma vez.

- [ ] **Step 1: Escreva o teste**

Crie `apps/web/src/office/annotation/AnnotationCanvas.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRef } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { AnnotationCanvas } from './AnnotationCanvas'
import type { ScreenAnnotationsState } from './useScreenAnnotations'

function fakeAnnotations(): ScreenAnnotationsState & {
  beginStroke: ReturnType<typeof vi.fn>
  extendStroke: ReturnType<typeof vi.fn>
  endStroke: ReturnType<typeof vi.fn>
} {
  return {
    strokesFor: () => [],
    beginStroke: vi.fn(),
    extendStroke: vi.fn(),
    endStroke: vi.fn(),
  }
}

/** jsdom não tem canvas 2d nem layout: o componente só precisa não explodir. */
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
    right: 200,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

function setup(active: boolean) {
  const annotations = fakeAnnotations()
  const videoRef = createRef<HTMLVideoElement>()
  const { container } = render(
    <>
      <video ref={videoRef} />
      <AnnotationCanvas sharerId="bruno" annotations={annotations} active={active} videoRef={videoRef} />
    </>,
  )
  const canvas = container.querySelector('canvas') as HTMLCanvasElement
  return { annotations, canvas }
}

describe('AnnotationCanvas', () => {
  it('arrastar com o modo ligado abre, estende e fecha o traço', () => {
    const { annotations, canvas } = setup(true)

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 120, clientY: 60, pointerId: 1 })

    expect(annotations.beginStroke).toHaveBeenCalledWith('bruno', expect.objectContaining({ x: expect.any(Number) }))
    expect(annotations.extendStroke).toHaveBeenCalled()
    expect(annotations.endStroke).toHaveBeenCalled()
  })

  it('com o modo desligado, o overlay não captura ponteiro nem desenha', () => {
    const { annotations, canvas } = setup(false)

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 })

    expect(annotations.beginStroke).not.toHaveBeenCalled()
    expect(canvas.style.pointerEvents).toBe('none')
  })

  it('mover sem ter começado um traço não estende nada', () => {
    const { annotations, canvas } = setup(true)

    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 })

    expect(annotations.extendStroke).not.toHaveBeenCalled()
  })

  it('sair da área com o botão pressionado fecha o traço', () => {
    const { annotations, canvas } = setup(true)

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerLeave(canvas, { clientX: 999, clientY: 999, pointerId: 1 })

    expect(annotations.endStroke).toHaveBeenCalled()
  })

  it('desligar o modo no meio do traço fecha o traço em vez de deixá-lo aberto', () => {
    const annotations = fakeAnnotations()
    const videoRef = createRef<HTMLVideoElement>()
    const { container, rerender } = render(
      <>
        <video ref={videoRef} />
        <AnnotationCanvas sharerId="bruno" annotations={annotations} active videoRef={videoRef} />
      </>,
    )
    const canvas = container.querySelector('canvas') as HTMLCanvasElement

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 })
    rerender(
      <>
        <video ref={videoRef} />
        <AnnotationCanvas sharerId="bruno" annotations={annotations} active={false} videoRef={videoRef} />
      </>,
    )

    expect(annotations.endStroke).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implemente o componente**

Crie `apps/web/src/office/annotation/AnnotationCanvas.tsx`:

```tsx
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { OFFICE_ANNOTATION_STROKE_TTL_MS, type OfficeAnnotationPoint } from '@legends/shared'
import { toLocal, toNormalized, videoContentRect } from './annotation-geometry'
import type { ScreenAnnotationsState } from './useScreenAnnotations'

const LINE_WIDTH = 4

/**
 * Overlay de desenho sobre a tela compartilhada em destaque. Único arquivo da
 * feature que toca DOM/Canvas: geometria, cor e estado vivem fora daqui.
 *
 * Redesenha em rAF lendo o ref do hook — não há estado React no laço, então
 * desenhar não re-renderiza a grade inteira a cada ponto.
 */
export function AnnotationCanvas({
  sharerId,
  annotations,
  active,
  videoRef,
}: {
  sharerId: string
  annotations: ScreenAnnotationsState
  active: boolean
  videoRef: RefObject<HTMLVideoElement>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)

  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return
      const context = canvas.getContext('2d')
      if (!context) return

      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const rect = videoContentRect({
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        clientWidth: width,
        clientHeight: height,
      })
      const now = Date.now()
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.lineWidth = LINE_WIDTH
      for (const stroke of annotations.strokesFor(sharerId)) {
        if (stroke.points.length === 0) continue
        // Traço em andamento fica opaco; terminado desaparece ao longo do TTL.
        const age = stroke.doneAt === null ? 0 : now - stroke.doneAt
        context.globalAlpha = Math.max(0, 1 - age / OFFICE_ANNOTATION_STROKE_TTL_MS)
        context.strokeStyle = stroke.color
        context.beginPath()
        const first = toLocal(stroke.points[0], rect)
        context.moveTo(first.x, first.y)
        for (const point of stroke.points.slice(1)) {
          const local = toLocal(point, rect)
          context.lineTo(local.x, local.y)
        }
        context.stroke()
      }
      context.globalAlpha = 1
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [annotations, sharerId, videoRef])

  // Modo desligado no meio de um traço (botão, P ou Esc): fecha o que estava
  // aberto, senão ele ficaria sem o lote final e só morreria pela rede de
  // segurança de traço abandonado, muito depois.
  useEffect(() => {
    if (active || !drawingRef.current) return
    drawingRef.current = false
    annotations.endStroke()
  }, [active, annotations])

  const pointAt = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): OfficeAnnotationPoint => {
      const canvas = event.currentTarget
      const bounds = canvas.getBoundingClientRect()
      const video = videoRef.current
      const rect = videoContentRect({
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        clientWidth: bounds.width,
        clientHeight: bounds.height,
      })
      return toNormalized({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, rect)
    },
    [videoRef],
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    // O clique não pode borbulhar: no tile em destaque ele mudaria o pin da grade.
    event.stopPropagation()
    event.preventDefault()
    drawingRef.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    annotations.beginStroke(sharerId, pointAt(event))
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active || !drawingRef.current) return
    annotations.extendStroke(pointAt(event))
  }

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    annotations.endStroke()
  }

  return (
    <canvas
      ref={canvasRef}
      data-testid="annotation-canvas"
      aria-hidden="true"
      className="absolute inset-0 z-10 h-full w-full"
      style={{ pointerEvents: active ? 'auto' : 'none', cursor: active ? 'crosshair' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={finish}
    />
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Esperado: sem saída.

Verificação (não rodar agora): `pnpm --filter @legends/web exec vitest run src/office/annotation/AnnotationCanvas.test.tsx`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/office/annotation/AnnotationCanvas.tsx apps/web/src/office/annotation/AnnotationCanvas.test.tsx
git commit -m "feat(web): canvas de anotação sobre a tela compartilhada"
```

---

### Task 8: Botão "Riscar" e overlay no `MediaTiles`

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx` (`VideoTile` ~linha 101-160; props do `MediaTiles` ~linha 381-420; efeito de `Escape` ~linha 491-498; bloco do tile em destaque ~linha 529-557)
- Test: `apps/web/src/office/media/MediaTiles.test.tsx` (novos casos)

**Interfaces:**
- Consumes: `ScreenAnnotationsState` (Task 6), `AnnotationCanvas` (Task 7).
- Produces: prop nova de `MediaTiles`: `annotations?: ScreenAnnotationsState`.

Notas de projeto:

- A identidade do dono da tela é `tile.userId` — vale tanto para a tela remota quanto para a própria (`sharerId` do tile local é a string `'local'`, que NÃO serve como identidade na rede).
- O botão só existe quando `expanded`, o destaque é `kind === 'screen'`, tem `userId` e a prop `annotations` foi passada.
- Atalho `P` (minúsculo ou maiúsculo) alterna; ignora quando há `ctrl/meta/alt` ou quando o foco está num campo de texto (o chat da sala vive na mesma tela).
- `Escape` com o modo ligado **desliga o modo** em vez de fechar a grade.
- O modo desliga sozinho quando o destaque muda, deixa de ser tela ou a grade recolhe.

- [ ] **Step 1: Escreva os testes**

Em `apps/web/src/office/media/MediaTiles.test.tsx`, acrescente ao fim do `describe('MediaTiles', ...)`:

```tsx
  function fakeAnnotations() {
    return { strokesFor: () => [], beginStroke: vi.fn(), extendStroke: vi.fn(), endStroke: vi.fn() }
  }

  it('sem tela compartilhada em destaque, não oferece riscar', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} annotations={fakeAnnotations()} />)

    expect(screen.queryByRole('button', { name: 'Riscar na tela' })).not.toBeInTheDocument()
  })

  it('com tela em destaque, o botão liga o overlay de anotação', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    const { container } = render(
      <MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} annotations={fakeAnnotations()} />,
    )

    expect(container.querySelector('[data-testid="annotation-canvas"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Riscar na tela' }))
    expect(document.querySelector('[data-testid="annotation-canvas"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Parar de riscar' })).toBeInTheDocument()
  })

  it('a tecla P alterna o modo de riscar', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} annotations={fakeAnnotations()} />)

    fireEvent.keyDown(window, { key: 'p' })
    expect(screen.getByRole('button', { name: 'Parar de riscar' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'p' })
    expect(screen.getByRole('button', { name: 'Riscar na tela' })).toBeInTheDocument()
  })

  it('Escape com o modo ligado sai do modo antes de fechar a grade', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(
      <MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} annotations={fakeAnnotations()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Riscar na tela' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Riscar na tela' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('sem a prop annotations, nada de riscar aparece (grade usada fora da sessão do escritório)', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Riscar na tela' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Deixe o `VideoTile` aceitar o overlay**

Em `apps/web/src/office/media/MediaTiles.tsx`, no `VideoTile`, acrescente a prop e renderize o canvas dentro do contêiner `relative` que já existe (o mesmo que embrulha `<video>`):

```tsx
function VideoTile({
  track,
  label,
  mirrored = false,
  onClick,
  className = 'w-40 shrink-0',
  videoClassName = 'w-full',
  raisedIndex = null,
  speaking = false,
  micOpen = null,
  volumeControl = null,
  annotation = null,
}: {
  track: RemoteVideoTrack | LocalVideoTrack
  label: string
  mirrored?: boolean
  onClick?: () => void
  className?: string
  videoClassName?: string
  raisedIndex?: number | null
  speaking?: boolean
  /** `null` = tile sem mic próprio (ex.: tela compartilhada) — sem selo. */
  micOpen?: boolean | null
  volumeControl?: { value: number; onChange: (volume: number) => void } | null
  /** Overlay de riscar — só o tile de tela em destaque recebe. */
  annotation?: { sharerId: string; state: ScreenAnnotationsState; active: boolean } | null
}) {
```

Dentro do `return`, logo depois do `<video ... />` e antes do `{volumeControl && ...}`:

```tsx
        {annotation && (
          <AnnotationCanvas
            sharerId={annotation.sharerId}
            annotations={annotation.state}
            active={annotation.active}
            videoRef={ref}
          />
        )}
```

E os imports no topo do arquivo:

```tsx
import { AnnotationCanvas } from '../annotation/AnnotationCanvas'
import type { ScreenAnnotationsState } from '../annotation/useScreenAnnotations'
```

- [ ] **Step 3: Acrescente a prop e o estado no `MediaTiles`**

Na assinatura de `MediaTiles`, junto das outras props (`remoteUserVolumes`, etc.), acrescente `annotations` na desestruturação e no tipo:

```tsx
  annotations,
```

```tsx
  /** Estado de anotação da sessão do escritório; ausente = feature indisponível nesta tela. */
  annotations?: ScreenAnnotationsState
```

Depois dos `useState` existentes de paginação/pin, acrescente:

```tsx
  const [annotating, setAnnotating] = useState(false)
```

Depois da linha `const featured = resolveFeatured(...)`, acrescente:

```tsx
  // Riscar só existe sobre tela compartilhada, e a identidade do dono é o
  // `userId` do tile — o `sharerId` do tile local é a string 'local', que não
  // serve como identidade na rede.
  const annotationSharerId =
    featured && featured.kind === 'screen' && featured.userId ? featured.userId : null
  const canAnnotate = expanded && annotations !== undefined && annotationSharerId !== null

  // Destaque trocou, deixou de ser tela ou a grade recolheu: sai do modo, senão
  // o botão volta ligado em cima de outra coisa.
  useEffect(() => {
    if (!canAnnotate) setAnnotating(false)
  }, [canAnnotate, annotationSharerId])
```

- [ ] **Step 4: Atalho `P` e `Escape`**

Substitua o efeito de `Escape` existente (hoje `if (e.key === 'Escape') onToggleExpanded()`) por:

```tsx
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true
      if (e.key === 'Escape') {
        // Com o modo ligado, Esc é "saia de riscar" — fechar a grade fica pro
        // segundo Esc, senão some tudo de uma vez sem querer.
        if (annotating) setAnnotating(false)
        else onToggleExpanded()
        return
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'p' && canAnnotate) setAnnotating((value) => !value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, onToggleExpanded, annotating, canAnnotate])
```

- [ ] **Step 5: Botão e overlay no tile em destaque**

No bloco do destaque, ao lado do botão "Recolher câmeras" (`absolute right-4 top-4`), acrescente:

```tsx
              {canAnnotate && (
                <button
                  type="button"
                  aria-label={annotating ? 'Parar de riscar' : 'Riscar na tela'}
                  title={annotating ? 'Parar de riscar (P)' : 'Riscar na tela (P)'}
                  onClick={() => setAnnotating((value) => !value)}
                  className={`absolute right-16 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full ${
                    annotating ? 'bg-primary text-on-primary' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <Icon name="draw" className="text-[22px]" />
                </button>
              )}
```

No `<VideoTile>` do destaque (o que recebe `data-testid="featured-tile"` no pai), acrescente a prop:

```tsx
                        annotation={
                          annotations && annotationSharerId
                            ? { sharerId: annotationSharerId, state: annotations, active: annotating }
                            : null
                        }
```

Não mexa nos `VideoTile` da barra lateral nem da grade uniforme — anotação é só no destaque.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Esperado: sem saída.

Verificação (não rodar agora): `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(web): botão de riscar e overlay no tile em destaque"
```

---

### Task 9: Ligar na página do escritório

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx` (imports no topo; hook perto de `useOfficeFloatingReactions` ~linha 117; uso do `<MediaTiles>` ~linha 478-494)

**Interfaces:**
- Consumes: `useScreenAnnotations` (Task 6), prop `annotations` do `MediaTiles` (Task 8).
- Produces: nada.

- [ ] **Step 1: Instancie o hook**

Em `apps/web/src/pages/OfficePage.tsx`, acrescente o import:

```tsx
import { useScreenAnnotations } from '../office/annotation/useScreenAnnotations'
```

E, junto dos outros hooks da sessão (perto de `const floatingReactions = useOfficeFloatingReactions(...)`, ~linha 117):

```tsx
  const annotations = useScreenAnnotations(bridge, youId)
```

- [ ] **Step 2: Passe para a grade**

No `<MediaTiles ... />` (~linha 478), acrescente a prop junto de `youId`:

```tsx
        annotations={annotations}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Esperado: sem saída.

- [ ] **Step 4: Verificação manual (duas abas)**

Suba o ambiente conforme a skill `verify` do projeto (`pnpm db:up`, `pnpm dev`, Node ≥ 20) e confira, com duas sessões diferentes na mesma sala de reunião:

1. A compartilha a tela; B abre a grade em tela cheia → a tela de A vem em destaque.
2. B clica em "Riscar" e arrasta → o traço aparece em B na hora e em A em seguida, na mesma posição relativa do conteúdo.
3. O traço some sozinho ~3 s depois de soltar, nos dois lados.
4. A também risca → os dois traços convivem, em cores diferentes.
5. `P` liga/desliga; primeiro `Esc` sai do modo, segundo fecha a grade.
6. A para de compartilhar → o botão some e o modo desliga sem erro no console.
7. Redimensione a janela de B no meio do traço → o traço acompanha o conteúdo, sem escorregar para a barra preta.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx
git commit -m "feat(web): liga a anotação da tela compartilhada na página do escritório"
```

---

## Verificação final (quando o autor pedir)

```bash
pnpm db:up
pnpm test
```

A suíte completa é lenta e depende do Postgres de pé; por decisão do autor deste plano, **não** rode os testes web durante a implementação — só typecheck.
