# Ajustes de UI do Board (print: tela cheia, 2×2, instruções, zoom) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aproximar o board de retrospectiva ao modelo do print — sala em tela cheia com navegação restrita a "Sair", layout 2×2 + Ações deslocada com seta, painel de instruções no topo e controles de zoom no canto inferior direito.

**Architecture:** Frontend apenas (+ ajuste de coordenadas em `RETRO_REGIONS`, constante de layout do `@legends/shared` consumida só pelo web). A rota `/retrospectivas/:id` sai do `AppLayout` e a `RetroRoomPage` desenha a própria top bar full-screen. Reaproveita o canvas pan/zoom existente.

**Tech Stack:** React 18 + React Router 6 + React Query + Tailwind; tipos/constantes em `@legends/shared`. Vitest + jsdom + Testing Library. Sem API/DB/migration.

## Global Constraints

- TypeScript strict, ESM. Mensagens ao usuário em **português**.
- **Só frontend** (+ coords de `RETRO_REGIONS` no shared). Nenhuma mudança em API/Prisma.
- Web build é type-checked (`tsc --noEmit && vite build`) — todo diff deve ficar type-clean.
- Coordenadas de regiões/instruções/seta vivem no **espaço do mundo** (acompanham pan/zoom); derivar posições das constantes, sem números mágicos soltos.
- Zoom clamp `[0.3, 2.5]` (já existe em `use-canvas-viewport.ts`).
- "Sair" navega para `/retrospectivas`; "centralizar" volta `pan`/`zoom` ao estado inicial.
- Spec: `docs/superpowers/specs/2026-06-19-retro-board-print-ui-design.md`.

## Estado atual (o que existe e será alterado)

- `packages/shared/src/retro.ts`: `RETRO_REGIONS` = 5 regiões **em fila** (`.map((r,i)=>({x:i*(360+32),y:0,w:360,h:680}))`).
- `apps/web/src/pages/retro/use-canvas-viewport.ts`: `useCanvasViewport()` com `pan` (init `{x:120,y:80}`), `zoom` (init `0.8`), `panBy`, `zoomAt(clientX,clientY,rect,deltaY)`, `toWorld`; `MIN_ZOOM=0.3`, `MAX_ZOOM=2.5`; + puras `worldToScreen`/`screenToWorld`.
- `apps/web/src/pages/retro/RegionsBackground.tsx`: mapeia `RETRO_REGIONS` para divs posicionados.
- `apps/web/src/pages/RetroRoomPage.tsx`: board com `<section className="...h-[calc(100vh-64px)]...">`, top `<header>` (status/título/online/Concluir), world layer (`RegionsBackground` + post-its), `LiveCursors`, paleta; usa `useCanvasViewport`, `containerRef`, refs `drag`/`dragPos`/`panning`.
- `apps/web/src/App.tsx`: `/retrospectivas/:id` está **dentro** do bloco `<Route element={<ProtectedRoute><AppLayout/></ProtectedRoute>}>` como `<Route path="/retrospectivas/:id" element={<DevOnly><RetroRoomPage /></DevOnly>} />`.

## Mapa de arquivos

- Modify: `packages/shared/src/retro.ts` — novas coords de `RETRO_REGIONS` (2×2 + Ações).
- Modify: `apps/web/src/pages/retro/use-canvas-viewport.ts` — `zoomIn`/`zoomOut`/`reset` + constantes iniciais.
- Create: `apps/web/src/pages/retro/BoardInstructions.tsx` — painel de instruções no mundo.
- Create: `apps/web/src/pages/retro/ZoomControls.tsx` — cluster de zoom.
- Modify: `apps/web/src/pages/retro/RegionsBackground.tsx` — render do novo layout + seta.
- Modify: `apps/web/src/pages/RetroRoomPage.tsx` — top bar full-screen + Sair + instruções + zoom + wiring.
- Modify: `apps/web/src/App.tsx` — mover a rota da sala para fora do `AppLayout`.

---

### Task 1: Layout das regiões (2×2 + Ações deslocada)

**Files:**
- Modify: `packages/shared/src/retro.ts`
- Test: `packages/shared/src/retro.test.ts`

**Interfaces:**
- Produces: `RETRO_REGIONS` com 5 itens; quadrantes `went_well`(0,280), `went_bad`(392,280), `start`(0,632), `stop`(392,632), todos `360×320`; `actions` em `(892,280)` `360×672`. `RetroRegion` shape inalterado (`id,label,x,y,w,h`).

- [ ] **Step 1: Update the test**

Adicione ao `packages/shared/src/retro.test.ts` (no `describe` existente):

```ts
it('dispõe 4 quadrantes em 2x2 e Ações deslocada à direita', () => {
  const byId = Object.fromEntries(RETRO_REGIONS.map((r) => [r.id, r]))
  // mesma linha de cima
  expect(byId.went_well.y).toBe(byId.went_bad.y)
  // mesma coluna da esquerda
  expect(byId.went_well.x).toBe(byId.start.x)
  // ruim à direita do bom; começar abaixo do bom
  expect(byId.went_bad.x).toBeGreaterThan(byId.went_well.x)
  expect(byId.start.y).toBeGreaterThan(byId.went_well.y)
  // Ações fica à direita de todos os quadrantes
  const maxQuadRight = Math.max(byId.went_well, byId.went_bad, byId.start, byId.stop).x ?? 0
  expect(byId.actions.x).toBeGreaterThan(byId.went_bad.x + byId.went_bad.w)
})
```

> Nota: mantém os asserts existentes (`RETRO_REGIONS` length 5, labels/x/w presentes).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/shared exec vitest run src/retro.test.ts`
Expected: FAIL — hoje todas as regiões têm `y:0` em fila, então `start.y > went_well.y` é falso.

- [ ] **Step 3: Replace the RETRO_REGIONS definition**

Em `packages/shared/src/retro.ts`, substitua o bloco que define `REGION_W/REGION_H/REGION_GAP` + `RETRO_REGIONS` por coordenadas explícitas:

```ts
/** Regiões de fundo do canvas — guia visual rotulado, SEM vínculo de dado. Coordenadas no mundo. */
export interface RetroRegion {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}
// Layout: 4 quadrantes (2×2) + Ações deslocada à direita. Instruções ocupam y 0..~240 (acima).
export const RETRO_REGIONS: RetroRegion[] = [
  { id: 'went_well', label: 'O que foi bom', x: 0, y: 280, w: 360, h: 320 },
  { id: 'went_bad', label: 'O que foi ruim', x: 392, y: 280, w: 360, h: 320 },
  { id: 'start', label: 'O que precisamos começar', x: 0, y: 632, w: 360, h: 320 },
  { id: 'stop', label: 'O que precisamos parar', x: 392, y: 632, w: 360, h: 320 },
  { id: 'actions', label: 'Ações', x: 892, y: 280, w: 360, h: 672 },
]
```

(Remova as constantes `REGION_W`/`REGION_H`/`REGION_GAP` e o `.map(...)`.)

- [ ] **Step 4: Run test + build**

Run: `pnpm --filter @legends/shared exec vitest run src/retro.test.ts` → PASS.
Run: `pnpm --filter @legends/shared build` → type-clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/retro.ts packages/shared/src/retro.test.ts
git commit -m "feat(shared): layout 2x2 + Ações deslocada nas RETRO_REGIONS"
```

---

### Task 2: Viewport — zoomIn / zoomOut / reset

**Files:**
- Modify: `apps/web/src/pages/retro/use-canvas-viewport.ts`
- Test: `apps/web/src/pages/retro/use-canvas-viewport.test.ts`

**Interfaces:**
- Consumes: `zoomAt` interno (já existe).
- Produces: `useCanvasViewport()` agora também retorna `zoomIn(rect: DOMRect): void`, `zoomOut(rect: DOMRect): void`, `reset(): void`. `pan`/`zoom`/`panBy`/`zoomAt`/`toWorld` inalterados. Constantes `INITIAL_PAN`/`INITIAL_ZOOM` usadas no estado inicial e no `reset`.

- [ ] **Step 1: Add failing tests**

Adicione ao `apps/web/src/pages/retro/use-canvas-viewport.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react'
import { useCanvasViewport } from './use-canvas-viewport'

const RECT = { left: 0, top: 0, width: 800, height: 600 } as DOMRect

describe('useCanvasViewport zoom controls', () => {
  it('zoomIn aumenta e respeita o teto 2.5; zoomOut diminui e respeita o piso 0.3', () => {
    const { result } = renderHook(() => useCanvasViewport())
    for (let i = 0; i < 30; i++) act(() => result.current.zoomIn(RECT))
    expect(result.current.zoom).toBeLessThanOrEqual(2.5)
    expect(result.current.zoom).toBeGreaterThan(0.8)
    for (let i = 0; i < 60; i++) act(() => result.current.zoomOut(RECT))
    expect(result.current.zoom).toBeGreaterThanOrEqual(0.3)
  })

  it('reset volta pan/zoom ao estado inicial', () => {
    const { result } = renderHook(() => useCanvasViewport())
    act(() => result.current.zoomIn(RECT))
    act(() => result.current.panBy(50, 50))
    act(() => result.current.reset())
    expect(result.current.zoom).toBe(0.8)
    expect(result.current.pan).toEqual({ x: 120, y: 80 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/use-canvas-viewport.test.ts`
Expected: FAIL — `zoomIn`/`reset` não existem.

- [ ] **Step 3: Implement the controls**

Em `apps/web/src/pages/retro/use-canvas-viewport.ts`:

Extraia as constantes iniciais (acima do hook, perto de `MIN_ZOOM`/`MAX_ZOOM`):

```ts
const INITIAL_PAN: Pan = { x: 120, y: 80 }
const INITIAL_ZOOM = 0.8
```

Troque os inicializadores de estado para usá-las:

```ts
  const [pan, setPan] = useState<Pan>(INITIAL_PAN)
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
```

Adicione, antes do `return`, reaproveitando `zoomAt` (zoom em torno do centro do rect):

```ts
  const zoomIn = useCallback(
    (rect: DOMRect) => zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, -1),
    [zoomAt],
  )
  const zoomOut = useCallback(
    (rect: DOMRect) => zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, 1),
    [zoomAt],
  )
  const reset = useCallback(() => {
    setPan(INITIAL_PAN)
    setZoom(INITIAL_ZOOM)
  }, [])
```

E inclua `zoomIn, zoomOut, reset` no objeto retornado.

> `zoomAt` usa o sinal de `deltaY` (`< 0` aproxima). Passar `-1`/`+1` reaproveita o passo e o clamp existentes.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/use-canvas-viewport.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/use-canvas-viewport.ts apps/web/src/pages/retro/use-canvas-viewport.test.ts
git commit -m "feat(web): zoomIn/zoomOut/reset no viewport do canvas"
```

---

### Task 3: Componentes — instruções, controles de zoom, seta nas regiões

**Files:**
- Create: `apps/web/src/pages/retro/BoardInstructions.tsx`
- Create: `apps/web/src/pages/retro/ZoomControls.tsx`
- Modify: `apps/web/src/pages/retro/RegionsBackground.tsx`
- Test: `apps/web/src/pages/retro/ZoomControls.test.tsx`, `apps/web/src/pages/retro/BoardInstructions.test.tsx`

**Interfaces:**
- Produces:
  - `BoardInstructions({ title }: { title: string })` — bloco absoluto no mundo (em `left:0, top:0`), título + 5 passos.
  - `ZoomControls({ zoom, onZoomIn, onZoomOut, onReset })` — cluster fixo bottom-right.
  - `RegionsBackground()` — agora também desenha a seta entre o bloco de quadrantes e Ações.

- [ ] **Step 1: Write the component tests**

```tsx
// apps/web/src/pages/retro/ZoomControls.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ZoomControls } from './ZoomControls'

describe('ZoomControls', () => {
  it('mostra o zoom em % e dispara os handlers', () => {
    const onZoomIn = vi.fn(), onZoomOut = vi.fn(), onReset = vi.fn()
    render(<ZoomControls zoom={0.8} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onReset} />)
    expect(screen.getByText('80%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }))
    fireEvent.click(screen.getByRole('button', { name: /diminuir zoom/i }))
    fireEvent.click(screen.getByRole('button', { name: /centralizar/i }))
    expect(onZoomIn).toHaveBeenCalled()
    expect(onZoomOut).toHaveBeenCalled()
    expect(onReset).toHaveBeenCalled()
  })
})
```

```tsx
// apps/web/src/pages/retro/BoardInstructions.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BoardInstructions } from './BoardInstructions'

describe('BoardInstructions', () => {
  it('mostra o título e os passos', () => {
    render(<BoardInstructions title="Retro Sprint 9" />)
    expect(screen.getByText('Retro Sprint 9')).toBeInTheDocument()
    expect(screen.getByText(/Escolha o tópico/i)).toBeInTheDocument()
    expect(screen.getByText(/Registrem as Ações/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/ZoomControls.test.tsx src/pages/retro/BoardInstructions.test.tsx`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implement BoardInstructions**

```tsx
// apps/web/src/pages/retro/BoardInstructions.tsx
const STEPS = [
  'Escolha o tópico da discussão (ex.: a última sprint).',
  'Cada pessoa adiciona post-its nas quatro áreas com ideias/feedback.',
  'Discutam em grupo e usem os votos para priorizar.',
  'Reajam aos post-its com que concordam.',
  'Registrem as Ações de acompanhamento a partir dos pontos mais votados.',
]

export function BoardInstructions({ title }: { title: string }) {
  return (
    <div className="absolute" style={{ left: 0, top: 0, width: 880 }}>
      <h3 className="font-headline text-title-lg text-primary">{title}</h3>
      <ol className="mt-2 space-y-1">
        {STEPS.map((s, i) => (
          <li key={i} className="text-body-sm text-on-surface-variant">
            <span className="font-bold text-on-surface">{i + 1}.</span> {s}
          </li>
        ))}
      </ol>
    </div>
  )
}
```

- [ ] **Step 4: Implement ZoomControls**

```tsx
// apps/web/src/pages/retro/ZoomControls.tsx
export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  const btn = 'flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest'
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container px-2 py-1 shadow-lg">
      <button type="button" aria-label="Centralizar" onClick={onReset} className={btn}>⌖</button>
      <button type="button" aria-label="Diminuir zoom" onClick={onZoomOut} className={btn}>−</button>
      <span className="min-w-[3.5ch] text-center font-label text-label-sm text-on-surface">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Aumentar zoom" onClick={onZoomIn} className={btn}>+</button>
    </div>
  )
}
```

- [ ] **Step 5: Add the arrow to RegionsBackground**

Substitua `apps/web/src/pages/retro/RegionsBackground.tsx` por:

```tsx
import { RETRO_REGIONS } from '@legends/shared'

const QUADS = RETRO_REGIONS.filter((r) => r.id !== 'actions')
const ACTIONS = RETRO_REGIONS.find((r) => r.id === 'actions')
const blockRight = Math.max(...QUADS.map((r) => r.x + r.w))
const arrowLeft = blockRight + 16
const arrowWidth = ACTIONS ? ACTIONS.x - arrowLeft - 16 : 0
const arrowTop = ACTIONS ? ACTIONS.y + ACTIONS.h / 2 : 0

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
      {ACTIONS && arrowWidth > 0 && (
        <svg
          className="absolute text-outline-variant"
          style={{ left: arrowLeft, top: arrowTop - 12, width: arrowWidth, height: 24, overflow: 'visible' }}
          aria-hidden="true"
        >
          <line x1="0" y1="12" x2={arrowWidth - 8} y2="12" stroke="currentColor" strokeWidth="2" />
          <path d={`M ${arrowWidth - 12} 5 L ${arrowWidth} 12 L ${arrowWidth - 12} 19`} fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
    </>
  )
}
```

- [ ] **Step 6: Run tests + verify**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/ZoomControls.test.tsx src/pages/retro/BoardInstructions.test.tsx` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/retro/BoardInstructions.tsx apps/web/src/pages/retro/ZoomControls.tsx apps/web/src/pages/retro/RegionsBackground.tsx apps/web/src/pages/retro/ZoomControls.test.tsx apps/web/src/pages/retro/BoardInstructions.test.tsx
git commit -m "feat(web): painel de instruções, controles de zoom e seta no fundo do board"
```

---

### Task 4: Sala em tela cheia + Sair + fiação (RetroRoomPage + rota)

**Files:**
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/pages/RetroRoomPage.test.tsx`

**Interfaces:**
- Consumes: `BoardInstructions`, `ZoomControls` (Task 3); `useCanvasViewport().zoomIn/zoomOut/reset` (Task 2); `useNavigate` (react-router-dom).
- Produces: `RetroRoomPage` full-screen com top bar própria (título/status/online/Concluir/**Sair**) + instruções no mundo + controles de zoom. Rota `/retrospectivas/:id` fora do `AppLayout`.

- [ ] **Step 1: Update the test**

Adicione/ajuste em `apps/web/src/pages/RetroRoomPage.test.tsx` (mantendo os mocks existentes de `retro-api`/`useRetroSocket`/`AuthContext`; o mock de `useRetroSocket` deve continuar retornando `{presentUserIds,cursors,lockOf,sendCursor,grab,move,drop}`). Adicione um spy de navegação:

```tsx
const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, useNavigate: () => navigateSpy }
})
```

Novos casos (dentro do `describe` existente):

```tsx
it('mostra o painel de instruções e os controles de zoom', async () => {
  renderPage()
  expect(await screen.findByText('Retro 1')).toBeInTheDocument()
  expect(screen.getByText(/Escolha o tópico/i)).toBeInTheDocument()
  expect(screen.getByText('80%')).toBeInTheDocument()
})

it('Sair navega para a lista de retrospectivas', async () => {
  renderPage()
  await screen.findByText('Retro 1')
  fireEvent.click(screen.getByRole('button', { name: /sair/i }))
  expect(navigateSpy).toHaveBeenCalledWith('/retrospectivas')
})

it('clicar + muda o zoom exibido', async () => {
  renderPage()
  await screen.findByText('Retro 1')
  fireEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }))
  // 0.8 -> ~0.88 -> exibe 88%
  expect(screen.getByText('88%')).toBeInTheDocument()
})
```

> Garanta que `fireEvent` está importado de `@testing-library/react`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: FAIL — sem instruções/zoom/Sair na página atual.

- [ ] **Step 3: Edit RetroRoomPage — imports, navigate, zoom handlers**

Abra `apps/web/src/pages/RetroRoomPage.tsx`. **Preserve toda a lógica existente** (query, `useRetroSocket`, refs `drag`/`dragPos`/`panning`, o `useEffect` de listeners, as mutations, `onCardPointerDown`/`onCanvasPointerDown`/`createAtCenter`).

No bloco de imports:
- Em `react-router-dom`, importe também `useNavigate`: `import { useParams, useNavigate } from 'react-router-dom'`.
- Adicione: `import { BoardInstructions } from './retro/BoardInstructions'` e `import { ZoomControls } from './retro/ZoomControls'`.

Logo após `const { user } = useAuth()` (ou perto dos outros hooks no topo do componente), adicione:

```tsx
  const navigate = useNavigate()

  function viewportRect(): DOMRect {
    return containerRef.current?.getBoundingClientRect() ?? ({ left: 0, top: 0, width: 800, height: 600 } as DOMRect)
  }
```

- [ ] **Step 4: Edit RetroRoomPage — replace the returned JSX**

Substitua todo o `return (<section ...> ... </section>)` final por (mantendo as variáveis já calculadas acima dele — `room`, `isFacilitator`, `canWrite`):

```tsx
  return (
    <section className="relative flex h-screen flex-col bg-surface">
      <header className="flex items-center justify-between gap-md border-b border-outline-variant/40 px-lg py-sm">
        <div>
          <span className="font-label text-[11px] uppercase tracking-wide text-primary">
            {room.status === 'OPEN' ? 'Aberta' : 'Concluída'}
          </span>
          <h2 className="font-headline text-headline-md text-on-surface">{room.title}</h2>
        </div>
        <div className="flex items-center gap-md">
          <span className="font-label text-label-sm text-on-surface-variant">{socket.presentUserIds.length} online</span>
          {room.status === 'OPEN' && (
            <span className="font-label text-label-sm text-on-surface-variant">Votos: {room.myRemainingVotes}</span>
          )}
          {isFacilitator && room.status === 'OPEN' && (
            <button type="button" onClick={() => concludeM.mutate()} className="rounded-md bg-primary px-lg py-sm font-label font-bold text-on-primary">
              Concluir
            </button>
          )}
          <button
            type="button"
            aria-label="Sair"
            onClick={() => navigate('/retrospectivas')}
            className="rounded-md border border-outline-variant/40 px-lg py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
          >
            Sair
          </button>
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
          <BoardInstructions title={room.title} />
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
        <ZoomControls
          zoom={vp.zoom}
          onZoomIn={() => vp.zoomIn(viewportRect())}
          onZoomOut={() => vp.zoomOut(viewportRect())}
          onReset={() => vp.reset()}
        />
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
```

> Observações: a `<section>` agora é `h-screen` (tela cheia). `ZoomControls` fica dentro do container do canvas (bottom-right). A paleta permanece centralizada embaixo. Nada da lógica de arrasto/pan/criação muda — só o chrome e os dois novos elementos.

- [ ] **Step 5: Move the route out of AppLayout in App.tsx**

Em `apps/web/src/App.tsx`:
- **Remova** a linha `<Route path="/retrospectivas/:id" element={<DevOnly><RetroRoomPage /></DevOnly>} />` de dentro do bloco `<Route element={<ProtectedRoute><AppLayout/></ProtectedRoute>}>`.
- **Adicione** uma rota full-screen irmã da de `/alterar-senha` (fora do `AppLayout`, mas dentro de `<ProtectedRoute>`):

```tsx
            <Route
              path="/retrospectivas/:id"
              element={
                <ProtectedRoute>
                  <DevOnly>
                    <RetroRoomPage />
                  </DevOnly>
                </ProtectedRoute>
              }
            />
```

Mantenha `/retrospectivas` (a lista) **dentro** do `AppLayout`. Confirme que `RetroRoomPage` e `DevOnly` continuam importados (já estão).

- [ ] **Step 6: Run test + full web build**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx` → PASS.
Run: `pnpm --filter @legends/web build` → type-clean + build ok.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/RetroRoomPage.tsx apps/web/src/App.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(web): sala em tela cheia com Sair + instruções e controles de zoom"
```

---

## Self-Review (autor)

**Cobertura do spec:**
- Tela cheia + nav restrita a Sair → Task 4 (rota fora do AppLayout + top bar própria com Sair).
- Layout 2×2 + Ações deslocada com seta → Task 1 (coords) + Task 3 (seta em RegionsBackground).
- Painel de instruções → Task 3 (BoardInstructions) + Task 4 (render no mundo).
- Controles de zoom → Task 2 (zoomIn/zoomOut/reset) + Task 3 (ZoomControls) + Task 4 (fiação).
- Só frontend, sem API/DB → confirmado (apenas `RETRO_REGIONS` no shared, consumido só pelo web).

**Placeholder scan:** sem TODO/incompletos; todo passo tem código real.

**Consistência de tipos:** `RetroRegion` inalterado; `useCanvasViewport` agora expõe `zoomIn(rect)/zoomOut(rect)/reset()`; `ZoomControls`/`BoardInstructions` props batem com a fiação na Task 4; `RegionsBackground` continua sem props. Query key e lógica de arrasto preservadas (Task 4 só mexe em imports, chrome e 2 elementos novos).

**Riscos a validar na execução:**
- Mover a rota: garantir que `ProtectedRoute` + `DevOnly` continuam envolvendo a sala e que a lista segue no layout.
- O teste "clicar + muda o zoom" assume passo de 1.1× (0.8→0.88→88%); se o passo do `zoomAt` mudar, ajustar o valor esperado.
- `BoardInstructions` em `top:0` e quadrantes em `y:280` — conferir no manual que as instruções aparecem acima dos quadrantes no zoom/pan inicial.
