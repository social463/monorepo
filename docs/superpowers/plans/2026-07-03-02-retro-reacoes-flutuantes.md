# Reações flutuantes no board de retro (estilo Meet) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reações efêmeras "estilo Google Meet" no board de retro: clica num emoji e ele sobe uma fração da tela e some, transmitido a todos os presentes na sala em tempo real, mostrando quem reagiu.

**Architecture:** Espelha o canal efêmero dos cursores ao vivo — WebSocket existente da sala, relay em memória pelo `RetroHub`, sem banco. Novo par de mensagens `reaction.float` (cliente→servidor) / `reaction.floated` (servidor→todos, inclusive o autor). Front renderiza um overlay irmão do `<LiveCursors>` que anima cada reação para cima e a remove após ~2.5s.

**Tech Stack:** TypeScript ESM, `@legends/shared`, Fastify + `@fastify/websocket` + `ws` (testes), React 18 + Tailwind 3, Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-07-03-retro-reacoes-flutuantes-design.md](../specs/2026-07-03-retro-reacoes-flutuantes-design.md)

## Global Constraints

- TypeScript **strict**, ESM. Mensagens/`aria-label` voltados ao usuário em **português**.
- Contrato muda **primeiro** em `@legends/shared`; api e web consomem de lá.
- Feature **efêmera**: sem migration, sem tabela, sem endpoint REST novo.
- Não confundir com as reações **persistidas por card** (`reaction.changed`, `ReactionFlyout`, tool `react`). Nomes distintos: `reaction.float`/`reaction.floated`, componentes `FloatingReaction*`.
- 7 emojis, nesta ordem: `👍 ❤️ 😂 😮 😢 👏 🎉`.
- Reação sobe **uma fração da tela** (~38vh), nunca a tela inteira.
- Testes da API batem em **Postgres real** (`pnpm db:up` antes). Rodar `pnpm test` antes de concluir; typecheck com `tsc --noEmit` por workspace ao mexer em DTO/contrato.

---

### Task 1: Contrato compartilhado (`@legends/shared`)

**Files:**
- Modify: `packages/shared/src/retro.ts` (constante perto de `RETRO_REACTION_EMOJIS` na ~linha 48; `RetroClientMessage` ~linha 218; `RetroEvent` grupo efêmero ~linha 211-215)
- Test: `packages/shared/src/retro.test.ts` (já existe — adicionar um novo `describe`)

**Interfaces:**
- Produces:
  - `RETRO_FLOAT_REACTIONS: readonly ['👍','❤️','😂','😮','😢','👏','🎉']`
  - `type RetroFloatReaction = (typeof RETRO_FLOAT_REACTIONS)[number]`
  - `RetroClientMessage` ganha a variante `{ type: 'reaction.float'; emoji: string }`
  - `RetroEvent` ganha a variante `{ type: 'reaction.floated'; userId: string; name: string; emoji: string }`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao `packages/shared/src/retro.test.ts` (já existe) um novo `describe`. Garanta que `RETRO_FLOAT_REACTIONS` esteja no import de `./retro`:

```ts
import { describe, it, expect } from 'vitest'
import { RETRO_FLOAT_REACTIONS } from './retro'

describe('RETRO_FLOAT_REACTIONS', () => {
  it('tem os 7 emojis flutuantes na ordem definida', () => {
    expect(RETRO_FLOAT_REACTIONS).toEqual(['👍', '❤️', '😂', '😮', '😢', '👏', '🎉'])
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/shared test -- retro`
Expected: FAIL — `RETRO_FLOAT_REACTIONS` não existe (erro de import/undefined).

- [ ] **Step 3: Adicionar a constante e o tipo**

Em `packages/shared/src/retro.ts`, logo abaixo da linha de `RetroReactionEmoji` (após a definição de `RETRO_REACTION_EMOJIS`), adicionar:

```ts
/** Emojis das reações flutuantes efêmeras (estilo Meet). Distinto de RETRO_REACTION_EMOJIS (reações por card). */
export const RETRO_FLOAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🎉'] as const
export type RetroFloatReaction = (typeof RETRO_FLOAT_REACTIONS)[number]
```

- [ ] **Step 4: Adicionar a variante cliente→servidor**

Em `packages/shared/src/retro.ts`, no tipo `RetroClientMessage`, adicionar a última variante:

```ts
export type RetroClientMessage =
  | { type: 'cursor'; x: number; y: number }
  | { type: 'card.grab'; cardId: string }
  | { type: 'card.move'; cardId: string; x: number; y: number }
  | { type: 'card.drop'; cardId: string }
  | { type: 'reaction.float'; emoji: string }
```

- [ ] **Step 5: Adicionar a variante servidor→cliente**

Em `packages/shared/src/retro.ts`, no tipo `RetroEvent`, dentro do grupo `// efêmeros (relay, não persistem)`, adicionar após `card.unlocked`:

```ts
  | { type: 'reaction.floated'; userId: string; name: string; emoji: string }
```

- [ ] **Step 6: Rodar o teste + typecheck**

Run: `pnpm --filter @legends/shared test -- retro`
Expected: PASS.
Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/retro.ts packages/shared/src/retro.test.ts
git commit -m "feat(shared): contrato das reações flutuantes do board de retro"
```

---

### Task 2: Relay no WebSocket da API

**Files:**
- Modify: `apps/api/src/routes/retro-ws.ts:56-81` (o `switch (msg.type)`)
- Test: `apps/api/src/routes/retro-ws.test.ts` (adicionar um `it` ao `describe('retro websocket', ...)`)

**Interfaces:**
- Consumes: `RETRO_FLOAT_REACTIONS` de `@legends/shared` (Task 1); `retroHub.broadcast(roomId, build)` de `../lib/retro-hub`.
- Produces: quando o servidor recebe `{ type: 'reaction.float'; emoji }` com emoji válido, transmite `{ type: 'reaction.floated'; userId; name; emoji }` a **todos os presentes, inclusive o autor**.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao `describe('retro websocket', ...)` em `apps/api/src/routes/retro-ws.test.ts` (antes do `})` final da linha 135):

```ts
  it('relay de reaction.float chega em ambos os clientes (inclusive o autor) e ignora emoji inválido', async () => {
    const app = buildApp(); await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const lead = await prisma.user.create({ data: { name: 'Rea', email: 'rea@x.com', passwordHash: 'x', role: 'LEAD' } })
    const dev = await prisma.user.create({ data: { name: 'Bo', email: 'bo@x.com', passwordHash: 'x', role: 'LEGEND' } })
    const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD' })
    const devTk = app.jwt.sign({ sub: dev.id, role: 'LEGEND' })
    const squad = await prisma.squad.create({ data: { name: 'SquadR', slug: 'squadr' } })
    const created = await app.inject({ method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${leadTk}` }, payload: { sprint: 1, squadIds: [squad.id], votesPerParticipant: 3, participantIds: [dev.id] } })
    const roomId = created.json().room.id

    const wsA = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${leadTk}`)
    const wsB = new WebSocket(`ws://127.0.0.1:${port}/retro/rooms/${roomId}/ws?token=${devTk}`)
    await Promise.all([new Promise((r) => wsA.on('open', r)), new Promise((r) => wsB.on('open', r))])

    // A envia; ambos (A inclusive) recebem reaction.floated
    const onA = waitForMessage(wsA, (m) => m.type === 'reaction.floated' && m.emoji === '❤️')
    const onB = waitForMessage(wsB, (m) => m.type === 'reaction.floated' && m.emoji === '❤️')
    wsA.send(JSON.stringify({ type: 'reaction.float', emoji: '❤️' }))
    const [ma, mb] = await Promise.all([onA, onB])
    expect(ma).toMatchObject({ userId: lead.id, name: 'Rea', emoji: '❤️' })
    expect(mb).toMatchObject({ userId: lead.id, name: 'Rea', emoji: '❤️' })

    // emoji inválido: nenhum reaction.floated chega (usamos um cursor logo depois como "marco")
    const bogus: any[] = []
    wsB.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'reaction.floated') bogus.push(m) })
    wsA.send(JSON.stringify({ type: 'reaction.float', emoji: '💣' }))
    const cursorMark = waitForMessage(wsB, (m) => m.type === 'cursor.moved' && m.userId === lead.id)
    wsA.send(JSON.stringify({ type: 'cursor', x: 1, y: 1 }))
    await cursorMark
    expect(bogus).toHaveLength(0)

    wsA.close(); wsB.close(); await app.close()
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm db:up` (se o Postgres não estiver de pé) e depois
`pnpm --filter @legends/api test -- retro-ws`
Expected: FAIL — o servidor ainda não trata `reaction.float`, então `onA`/`onB` estouram timeout.

- [ ] **Step 3: Adicionar o import da constante**

Em `apps/api/src/routes/retro-ws.ts:2`, incluir `RETRO_FLOAT_REACTIONS` no import de `@legends/shared`:

```ts
import { type RetroClientMessage, isLeaderRole, RETRO_FLOAT_REACTIONS } from '@legends/shared'
```

- [ ] **Step 4: Adicionar o `case` no switch**

Em `apps/api/src/routes/retro-ws.ts`, dentro do `switch (msg.type)` (após o `case 'card.drop'` que termina na linha 80), adicionar:

```ts
          case 'reaction.float':
            if ((RETRO_FLOAT_REACTIONS as readonly string[]).includes(msg.emoji)) {
              retroHub.broadcast(roomId, () => ({ type: 'reaction.floated', userId, name, emoji: msg.emoji }))
            }
            break
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api test -- retro-ws`
Expected: PASS (incluindo o caso de emoji inválido).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/retro-ws.ts apps/api/src/routes/retro-ws.test.ts
git commit -m "feat(api): relay de reações flutuantes no WebSocket da retro"
```

---

### Task 3: Helper puro de reações flutuantes (web)

**Files:**
- Create: `apps/web/src/pages/retro/floating-reactions.ts`
- Test: `apps/web/src/pages/retro/floating-reactions.test.ts`

**Interfaces:**
- Consumes: nada de outras tasks (usa tipos de `@legends/shared`).
- Produces:
  - `interface FloatingReaction { id: string; userId: string; name: string; emoji: string; xPercent: number }`
  - `const FLOAT_REACTION_TTL_MS = 2500`
  - `const FLOAT_REACTION_THROTTLE_MS = 400`
  - `function makeFloatingReaction(input: { userId: string; name: string; emoji: string }, deps: { id: string; rand: number }): FloatingReaction` — `xPercent = 8 + Math.round(rand * 80)` (faixa 8–88).

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/pages/retro/floating-reactions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeFloatingReaction, FLOAT_REACTION_TTL_MS, FLOAT_REACTION_THROTTLE_MS } from './floating-reactions'

describe('makeFloatingReaction', () => {
  it('constrói a reação com id, dados e xPercent na faixa 8–88', () => {
    const r = makeFloatingReaction({ userId: 'u1', name: 'Dan', emoji: '❤️' }, { id: 'r1', rand: 0 })
    expect(r).toEqual({ id: 'r1', userId: 'u1', name: 'Dan', emoji: '❤️', xPercent: 8 })
    const r2 = makeFloatingReaction({ userId: 'u2', name: 'Ana', emoji: '🎉' }, { id: 'r2', rand: 1 })
    expect(r2.xPercent).toBe(88)
  })

  it('expõe TTL e throttle coerentes com a animação', () => {
    expect(FLOAT_REACTION_TTL_MS).toBe(2500)
    expect(FLOAT_REACTION_THROTTLE_MS).toBe(400)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- floating-reactions`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o helper**

Criar `apps/web/src/pages/retro/floating-reactions.ts`:

```ts
/** Reação flutuante efêmera (estilo Meet) — vive só no cliente enquanto anima. */
export interface FloatingReaction {
  id: string
  userId: string
  name: string
  emoji: string
  /** Posição horizontal de origem, em % da largura do overlay (sorteada localmente). */
  xPercent: number
}

/** Duração de vida = duração da animação de subida/fade. */
export const FLOAT_REACTION_TTL_MS = 2500
/** Intervalo mínimo entre envios do mesmo cliente (anti-spam). */
export const FLOAT_REACTION_THROTTLE_MS = 400

export function makeFloatingReaction(
  input: { userId: string; name: string; emoji: string },
  deps: { id: string; rand: number },
): FloatingReaction {
  return {
    id: deps.id,
    userId: input.userId,
    name: input.name,
    emoji: input.emoji,
    xPercent: 8 + Math.round(deps.rand * 80),
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- floating-reactions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/floating-reactions.ts apps/web/src/pages/retro/floating-reactions.test.ts
git commit -m "feat(web): helper puro das reações flutuantes"
```

---

### Task 4: Keyframe da animação + overlay `FloatingReactions`

**Files:**
- Modify: `apps/web/tailwind.config.ts` (bloco `theme.extend`)
- Create: `apps/web/src/pages/retro/FloatingReactions.tsx`
- Test: `apps/web/src/pages/retro/FloatingReactions.test.tsx`

**Interfaces:**
- Consumes: `FloatingReaction` de `./floating-reactions` (Task 3); `Avatar`/`AvatarSource` de `../../components/Avatar`; `RetroParticipantDTO` de `@legends/shared`.
- Produces: `function FloatingReactions({ reactions, participants }: { reactions: FloatingReaction[]; participants: RetroParticipantDTO[] }): JSX.Element` — overlay `absolute inset-0 overflow-hidden pointer-events-none z-50`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/pages/retro/FloatingReactions.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FloatingReactions } from './FloatingReactions'
import type { RetroParticipantDTO } from '@legends/shared'

const participants: RetroParticipantDTO[] = [
  {
    user: {
      id: 'u1', name: 'Dan Silva', email: 'd@x.com', role: 'LEGEND',
      area: null, position: null, squad: null,
      photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
      active: true, joinedAt: '2026-01-01T00:00:00.000Z',
    },
    isCreator: false,
  },
]

describe('FloatingReactions', () => {
  it('renderiza um item por reação com emoji e primeiro nome', () => {
    render(
      <FloatingReactions
        reactions={[{ id: 'r1', userId: 'u1', name: 'Dan Silva', emoji: '❤️', xPercent: 20 }]}
        participants={participants}
      />,
    )
    expect(screen.getByText('❤️')).toBeInTheDocument()
    expect(screen.getByText('Dan')).toBeInTheDocument()
  })

  it('sem reações não renderiza nenhum item', () => {
    const { container } = render(<FloatingReactions reactions={[]} participants={participants} />)
    expect(container.querySelectorAll('[data-float-reaction]')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- FloatingReactions`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Adicionar o keyframe no Tailwind**

Em `apps/web/tailwind.config.ts`, dentro de `theme.extend`, adicionar as chaves `keyframes` e `animation` (se já existirem, apenas acrescentar as entradas `retro-float`):

```js
      keyframes: {
        'retro-float': {
          '0%': { transform: 'translateY(0) scale(0.85)', opacity: '0' },
          '12%': { transform: 'translateY(-4vh) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-38vh) scale(1)', opacity: '0' },
        },
      },
      animation: {
        'retro-float': 'retro-float 2.5s ease-out forwards',
      },
```

- [ ] **Step 4: Implementar o overlay**

Criar `apps/web/src/pages/retro/FloatingReactions.tsx`:

```tsx
import type { RetroParticipantDTO } from '@legends/shared'
import { Avatar, type AvatarSource } from '../../components/Avatar'
import type { FloatingReaction } from './floating-reactions'

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name
}

export function FloatingReactions({
  reactions,
  participants,
}: {
  reactions: FloatingReaction[]
  participants: RetroParticipantDTO[]
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {reactions.map((r) => {
        const p = participants.find((x) => x.user.id === r.userId)
        const source: AvatarSource = p?.user ?? { name: r.name }
        return (
          <div
            key={r.id}
            data-float-reaction
            className="absolute bottom-2 flex animate-retro-float flex-col items-center gap-0.5"
            style={{ left: `${r.xPercent}%` }}
          >
            <span className="text-3xl leading-none drop-shadow">{r.emoji}</span>
            <span className="flex items-center gap-1 rounded-full bg-surface-container-highest/90 px-1.5 py-0.5 shadow">
              <span className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-zinc-700">
                <Avatar user={source} initialsClassName="text-[8px] font-bold text-white" />
              </span>
              <span className="font-label text-[10px] text-on-surface">{firstName(r.name)}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- FloatingReactions`
Expected: PASS (2 casos).

- [ ] **Step 6: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/src/pages/retro/FloatingReactions.tsx apps/web/src/pages/retro/FloatingReactions.test.tsx
git commit -m "feat(web): overlay e animação das reações flutuantes"
```

---

### Task 5: Barra de gatilho `FloatingReactionBar`

**Files:**
- Create: `apps/web/src/pages/retro/FloatingReactionBar.tsx`
- Test: `apps/web/src/pages/retro/FloatingReactionBar.test.tsx`

**Interfaces:**
- Consumes: `RETRO_FLOAT_REACTIONS` de `@legends/shared` (Task 1).
- Produces: `function FloatingReactionBar({ onReact }: { onReact: (emoji: string) => void }): JSX.Element` — pílula `absolute bottom-4 left-1/2 -translate-x-1/2 z-40` com 7 botões.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/pages/retro/FloatingReactionBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FloatingReactionBar } from './FloatingReactionBar'
import { RETRO_FLOAT_REACTIONS } from '@legends/shared'

describe('FloatingReactionBar', () => {
  it('renderiza um botão por emoji e dispara onReact com o emoji clicado', () => {
    const onReact = vi.fn()
    render(<FloatingReactionBar onReact={onReact} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(RETRO_FLOAT_REACTIONS.length)
    fireEvent.click(screen.getByText('❤️'))
    expect(onReact).toHaveBeenCalledWith('❤️')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- FloatingReactionBar`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar a barra**

Criar `apps/web/src/pages/retro/FloatingReactionBar.tsx`:

```tsx
import { RETRO_FLOAT_REACTIONS } from '@legends/shared'

const LABELS: Record<string, string> = {
  '👍': 'Reagir com joinha',
  '❤️': 'Reagir com coração',
  '😂': 'Reagir com risada',
  '😮': 'Reagir com uau',
  '😢': 'Reagir com tristeza',
  '👏': 'Reagir com palmas',
  '🎉': 'Reagir com festa',
}

export function FloatingReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container-highest/95 px-2 py-1 shadow-lg">
      {RETRO_FLOAT_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={LABELS[emoji] ?? `Reagir com ${emoji}`}
          onClick={() => onReact(emoji)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-xl transition-transform hover:scale-125 hover:bg-white/10"
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- FloatingReactionBar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/FloatingReactionBar.tsx apps/web/src/pages/retro/FloatingReactionBar.test.tsx
git commit -m "feat(web): barra de gatilho das reações flutuantes"
```

---

### Task 6: Ligar no hook `useRetroSocket`

**Files:**
- Modify: `apps/web/src/lib/useRetroSocket.ts` (imports; estado; handler `onmessage`; `send`; retorno da função e sua assinatura de tipo)
- Test: `apps/web/src/lib/useRetroSocket.test.tsx` (criar)

**Interfaces:**
- Consumes: `makeFloatingReaction`, `FloatingReaction`, `FLOAT_REACTION_TTL_MS`, `FLOAT_REACTION_THROTTLE_MS` de `../pages/retro/floating-reactions` (Task 3).
- Produces: o hook passa a retornar `floatingReactions: FloatingReaction[]` e `sendReaction: (emoji: string) => void`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/lib/useRetroSocket.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRetroSocket } from './useRetroSocket'

vi.mock('./api', () => ({
  getAccessToken: () => 'tok',
  refreshAccessToken: async () => {},
}))

// WebSocket falso controlável
class FakeWS {
  static last: FakeWS | null = null
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readyState = 1
  sent: string[] = []
  constructor(public url: string) { FakeWS.last = this }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3 }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient()
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useRetroSocket — reações flutuantes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as any).WebSocket = FakeWS as unknown as typeof WebSocket
    ;(globalThis as any).WebSocket.OPEN = 1
  })
  afterEach(() => { vi.useRealTimers(); FakeWS.last = null })

  it('reaction.floated entra na lista e sai após o TTL', async () => {
    const { result } = renderHook(() => useRetroSocket('room1'), { wrapper })
    // deixa o connect() assíncrono resolver e abrir o socket
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    act(() => { FakeWS.last?.onopen?.() })

    act(() => {
      FakeWS.last?.onmessage?.({ data: JSON.stringify({ type: 'reaction.floated', userId: 'u1', name: 'Dan', emoji: '❤️' }) })
    })
    expect(result.current.floatingReactions).toHaveLength(1)
    expect(result.current.floatingReactions[0]).toMatchObject({ userId: 'u1', emoji: '❤️' })

    act(() => { vi.advanceTimersByTime(2600) })
    expect(result.current.floatingReactions).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- useRetroSocket`
Expected: FAIL — `floatingReactions` é `undefined` no retorno do hook.

- [ ] **Step 3: Adicionar imports e estado**

Em `apps/web/src/lib/useRetroSocket.ts`, adicionar ao import de helpers (logo abaixo do import de `./api`, linha 10):

```ts
import {
  makeFloatingReaction,
  type FloatingReaction,
  FLOAT_REACTION_TTL_MS,
  FLOAT_REACTION_THROTTLE_MS,
} from '../pages/retro/floating-reactions'
```

Dentro do corpo do hook, junto aos outros `useState`/`useRef` (após a linha 57 `const [cursors, ...]`):

```ts
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([])
  const lastReactionAt = useRef(0)
  const reactionSeq = useRef(0)
```

- [ ] **Step 4: Tratar o evento recebido**

Em `apps/web/src/lib/useRetroSocket.ts`, no `ws.onmessage`, adicionar um ramo junto aos outros eventos efêmeros (após o bloco de `cursor.moved`, linha 113):

```ts
        if (e.type === 'reaction.floated') {
          reactionSeq.current += 1
          const item = makeFloatingReaction(
            { userId: e.userId, name: e.name, emoji: e.emoji },
            { id: `fr-${reactionSeq.current}`, rand: Math.random() },
          )
          setFloatingReactions((cur) => [...cur, item])
          setTimeout(() => setFloatingReactions((cur) => cur.filter((r) => r.id !== item.id)), FLOAT_REACTION_TTL_MS)
          return
        }
```

- [ ] **Step 5: Adicionar `sendReaction` e atualizar o retorno + assinatura**

Em `apps/web/src/lib/useRetroSocket.ts`, adicionar o callback junto aos outros (após `drop`, linha 174):

```ts
  const sendReaction = useCallback(
    (emoji: string) => {
      const now = Date.now()
      if (now - lastReactionAt.current < FLOAT_REACTION_THROTTLE_MS) return
      lastReactionAt.current = now
      send({ type: 'reaction.float', emoji })
    },
    [send],
  )
```

Atualizar a **assinatura de retorno** da função (linhas 46-54), acrescentando duas linhas ao objeto de tipo:

```ts
  cursors: RetroCursor[]
  floatingReactions: FloatingReaction[]
  lockOf: (cardId: string) => { byUserId: string; byName: string } | null
  sendCursor: (x: number, y: number) => void
  sendReaction: (emoji: string) => void
```

Atualizar o `return` final (linha 177):

```ts
  return { presentUserIds, cursors: Object.values(cursors), floatingReactions, lockOf, sendCursor, sendReaction, grab, move, drop }
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- useRetroSocket`
Expected: PASS.
Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/useRetroSocket.ts apps/web/src/lib/useRetroSocket.test.tsx
git commit -m "feat(web): reações flutuantes no hook useRetroSocket"
```

---

### Task 7: Montar no board (`RetroRoomPage`)

**Files:**
- Modify: `apps/web/src/pages/RetroRoomPage.tsx` (imports; render do overlay ao lado de `<LiveCursors>` na ~linha 579; render da barra dentro do container do viewport)

**Interfaces:**
- Consumes: `socket.floatingReactions` e `socket.sendReaction` (Task 6); `FloatingReactions` (Task 4); `FloatingReactionBar` (Task 5); `room.participants` (já disponível no `roomQuery.data`).

- [ ] **Step 1: Adicionar os imports**

Em `apps/web/src/pages/RetroRoomPage.tsx`, junto aos imports dos componentes de `./retro/*` (perto do import de `LiveCursors`), adicionar:

```ts
import { FloatingReactions } from './retro/FloatingReactions'
import { FloatingReactionBar } from './retro/FloatingReactionBar'
```

- [ ] **Step 2: Renderizar o overlay e a barra**

Em `apps/web/src/pages/RetroRoomPage.tsx`, logo após `<LiveCursors ... />` (linha 579) e antes de `<ZoomControls ... />`, adicionar:

```tsx
        <FloatingReactions reactions={socket.floatingReactions} participants={room.participants} />
        {canWrite && <FloatingReactionBar onReact={socket.sendReaction} />}
```

> `canWrite` já existe no componente e representa "sala aberta e o usuário pode interagir" — mesma guarda usada para os pads/edição. `room` é o `roomQuery.data.room` já desestruturado no corpo do componente (é a fonte de `room.cards`, `room.title` etc. usados nas linhas 537-540); use o mesmo `room` aqui. Se o identificador exato em escopo for outro (ex.: `roomQuery.data.room`), use o que já alimenta `room.cards` na linha 540.

- [ ] **Step 3: Verificar tipos e testes da web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.
Run: `pnpm --filter @legends/web test`
Expected: PASS (suíte da web verde; sem regressões).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/RetroRoomPage.tsx
git commit -m "feat(web): montar reações flutuantes no board de retro"
```

---

## Self-Review

- **Spec coverage:**
  - Contrato (constante + 2 variantes) → Task 1. ✔
  - Relay no servidor incluindo o autor + ignora inválido → Task 2. ✔
  - Helper (TTL, throttle, xPercent) → Task 3. ✔
  - Overlay que sobe ~38vh + emoji/avatar/nome → Task 4. ✔
  - Barra de gatilho embaixo-centro, 7 emojis, pt-BR → Task 5. ✔
  - `sendReaction` (throttle) + estado + remoção por TTL no hook → Task 6. ✔
  - Montagem no board (overlay + barra, guarda `canWrite`) → Task 7. ✔
  - Modo anônimo mantém nome/avatar: não requer código especial (a reação sempre carrega nome/avatar); coberto implicitamente. ✔
- **Placeholder scan:** sem TBD/TODO; todo passo de código traz o código completo. ✔
- **Type consistency:** `reaction.float` (cliente) e `reaction.floated` (servidor) usados de forma consistente em Tasks 1/2/6; `FloatingReaction` e `makeFloatingReaction` idênticos entre Tasks 3/4/6; `floatingReactions`/`sendReaction` idênticos entre Tasks 6/7. `RETRO_FLOAT_REACTIONS` idêntico em Tasks 1/2/5. ✔
- **Nota de risco (Task 7):** `RetroRoomPage` é grande e não tem teste unitário no repo; a montagem é verificada por `tsc` + suíte da web + execução real, não por teste de unidade dedicado (coerente com o padrão do repo). A animação (keyframe/vh) é visual e não é coberta por asserção — validar com smoke visual no app.
