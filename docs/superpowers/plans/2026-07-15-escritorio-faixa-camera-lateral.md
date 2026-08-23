# Faixa de câmeras lateral direita (vertical, redimensionável) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A faixa compacta de câmeras (`MediaTiles`) deixa de ficar no topo horizontal e passa a ficar ancorada no canto superior direito, em coluna vertical com os tiles num grid que reflui, redimensionável por arraste (largura entre 160px e quase a tela toda), com a largura persistida em `localStorage`.

**Architecture:** Um novo hook `useMediaStripWidth` (em `apps/web/src/office/media`) guarda a largura em px (lida/persistida em `localStorage`) e expõe handlers `onPointerDown`/`onPointerMove`/`onPointerUp` pra uma alça de arraste — mesmo padrão já usado em `SelfCameraPreview.tsx` (handlers ligados diretamente ao elemento arrastável, com `setPointerCapture`, sem listeners globais em `window`). `OfficePage.tsx` usa esse hook, reposiciona o container de `<MediaTiles>` pro canto superior direito com a largura controlada por `style`, e renderiza a alça de arraste. Dentro de `MediaTiles.tsx`, o bloco da faixa compacta troca de fileira horizontal (`flex ... overflow-x-auto`) pra grid vertical (`grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] ... overflow-y-auto`), com o botão de expandir fixo acima da lista. `BroadcastBanner` perde o prop `pushDown` (não tem mais razão de existir, já que a faixa não ocupa mais o topo).

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library (`apps/web`), Tailwind CSS.

## Global Constraints

- Largura mínima da faixa: `160px` (cabe exatamente 1 tile por linha, mesmo breakpoint usado no `minmax` do grid).
- Largura máxima: `window.innerWidth - 16`.
- Largura persistida em `localStorage` sob a chave `office-media-strip-width`; sem valor salvo, padrão inicial é `160px`.
- Arraste implementado com handlers `onPointerDown`/`onPointerMove`/`onPointerUp` no próprio elemento da alça (padrão já usado em `apps/web/src/office/media/SelfCameraPreview.tsx`), com `event.currentTarget.setPointerCapture?.(event.pointerId)` — não usar listeners globais em `window`.
- Grid de tiles usa `grid-cols-[repeat(auto-fit,minmax(160px,1fr))]` (mesmo breakpoint da largura mínima).
- Altura da lista de tiles limitada a `max-h-[70vh]` com scroll vertical; o botão de expandir fica fora dessa área de scroll (sempre visível, topo da coluna).
- Grade expandida em tela cheia (overlay) não muda — layout, testes e comportamento intactos.
- `hasVisible`, `showAllPresent`, `buildTiles`, `AvatarTile`/`VideoTile` não mudam de lógica — só o container/layout da faixa compacta.
- Mensagens/labels voltados ao usuário em português.

---

### Task 1: `useMediaStripWidth` — hook de largura redimensionável com persistência

**Files:**
- Create: `apps/web/src/office/media/useMediaStripWidth.ts`
- Test: `apps/web/src/office/media/useMediaStripWidth.test.tsx`

**Interfaces:**
- Consumes: `window.localStorage`, `window.innerWidth`.
- Produces: `useMediaStripWidth(): { width: number; onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void; onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void; onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void }` e a constante exportada `MEDIA_STRIP_MIN_WIDTH = 160` — consumidos pela Task 4 (`OfficePage.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/web/src/office/media/useMediaStripWidth.test.tsx`. O teste usa um pequeno componente-harness que renderiza a alça (mesmo padrão de teste usado em `SelfCameraPreview.test.tsx`, que testa arraste via `fireEvent.pointerDown/pointerMove/pointerUp` no elemento real, não chamando o hook isoladamente):

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useMediaStripWidth, MEDIA_STRIP_MIN_WIDTH } from './useMediaStripWidth'

const STORAGE_KEY = 'office-media-strip-width'

function Harness() {
  const { width, onPointerDown, onPointerMove, onPointerUp } = useMediaStripWidth()
  return (
    <div
      data-testid="handle"
      data-width={width}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

describe('useMediaStripWidth', () => {
  const originalInnerWidth = window.innerWidth

  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true })
  })

  it('sem valor salvo, começa na largura mínima', () => {
    const { getByTestId } = render(<Harness />)
    expect(getByTestId('handle').dataset.width).toBe(String(MEDIA_STRIP_MIN_WIDTH))
  })

  it('lê a largura salva em localStorage', () => {
    window.localStorage.setItem(STORAGE_KEY, '400')
    const { getByTestId } = render(<Harness />)
    expect(getByTestId('handle').dataset.width).toBe('400')
  })

  it('valor salvo abaixo do mínimo é clampado pro mínimo', () => {
    window.localStorage.setItem(STORAGE_KEY, '10')
    const { getByTestId } = render(<Harness />)
    expect(getByTestId('handle').dataset.width).toBe(String(MEDIA_STRIP_MIN_WIDTH))
  })

  it('valor salvo acima do máximo (innerWidth - 16) é clampado pro máximo', () => {
    window.localStorage.setItem(STORAGE_KEY, '5000')
    const { getByTestId } = render(<Harness />)
    expect(getByTestId('handle').dataset.width).toBe(String(1200 - 16))
  })

  it('arrastar a alça pra esquerda (dx negativo) alarga a faixa', () => {
    const { getByTestId } = render(<Harness />)
    const handle = getByTestId('handle')

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 }) // moveu 100px pra esquerda

    expect(handle.dataset.width).toBe(String(MEDIA_STRIP_MIN_WIDTH + 100))
  })

  it('arrastar a alça pra direita (dx positivo) estreita a faixa, sem passar do mínimo', () => {
    window.localStorage.setItem(STORAGE_KEY, '300')
    const { getByTestId } = render(<Harness />)
    const handle = getByTestId('handle')

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800 }) // moveu 300px pra direita

    expect(handle.dataset.width).toBe(String(MEDIA_STRIP_MIN_WIDTH))
  })

  it('pointermove sem pointerdown antes não muda a largura', () => {
    const { getByTestId } = render(<Harness />)
    const handle = getByTestId('handle')

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 999 })

    expect(handle.dataset.width).toBe(String(MEDIA_STRIP_MIN_WIDTH))
  })

  it('depois de pointerup, mover o mouse não muda mais a largura', () => {
    const { getByTestId } = render(<Harness />)
    const handle = getByTestId('handle')

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 })

    expect(handle.dataset.width).toBe(String(MEDIA_STRIP_MIN_WIDTH))
  })

  it('persiste a largura em localStorage a cada mudança', () => {
    const { getByTestId } = render(<Harness />)
    const handle = getByTestId('handle')

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(MEDIA_STRIP_MIN_WIDTH + 50))
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useMediaStripWidth.test.tsx`
Expected: FAIL — o módulo `./useMediaStripWidth` ainda não existe.

- [ ] **Step 3: Implementar o hook**

Crie `apps/web/src/office/media/useMediaStripWidth.ts`:

```ts
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

const STORAGE_KEY = 'office-media-strip-width'
const RESIZE_MARGIN = 16

export const MEDIA_STRIP_MIN_WIDTH = 160

function clampWidth(width: number): number {
  const max = window.innerWidth - RESIZE_MARGIN
  return Math.min(max, Math.max(MEDIA_STRIP_MIN_WIDTH, width))
}

function readStoredWidth(): number {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const parsed = raw ? Number(raw) : NaN
  return clampWidth(Number.isFinite(parsed) ? parsed : MEDIA_STRIP_MIN_WIDTH)
}

/**
 * Largura (px) da faixa lateral de câmeras: redimensionável por arraste na
 * alça (mesmo padrão de `SelfCameraPreview.tsx` — handlers no próprio
 * elemento, `setPointerCapture`, sem listeners globais) e persistida em
 * localStorage entre sessões. Arrastar a alça pra esquerda alarga a faixa.
 */
export function useMediaStripWidth(): {
  width: number
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
} {
  const [width, setWidth] = useState(readStoredWidth)
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(width))
  }, [width])

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    // Alça na borda ESQUERDA: mover pra esquerda (dx negativo) alarga.
    const dx = event.clientX - drag.startX
    setWidth(clampWidth(drag.startWidth - dx))
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  return { width, onPointerDown, onPointerMove, onPointerUp }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useMediaStripWidth.test.tsx`
Expected: todos os 9 testes passam.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/useMediaStripWidth.ts apps/web/src/office/media/useMediaStripWidth.test.tsx
git commit -m "feat(office): hook de largura redimensionável pra faixa lateral de câmeras"
```

---

### Task 2: `MediaTiles` — faixa compacta em coluna vertical com grid

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx:228-256` (bloco da faixa compacta)
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: nada novo — mesmo `tiles`/`buildTiles`/`hasVisible`/`showAllPresent` já existentes.
- Produces: nenhuma mudança de props públicas de `MediaTiles` — só o markup interno da faixa compacta. A Task 4 depende apenas do container externo que `OfficePage.tsx` já controla (não de nada novo exportado aqui).

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao final de `apps/web/src/office/media/MediaTiles.test.tsx` (dentro do `describe`, após o último `it`):

```tsx
  it('faixa compacta: botão de expandir fica antes da lista de tiles no DOM (topo da coluna)', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Expandir câmeras' })
    const figure = screen.getAllByRole('figure')[0]
    // compareDocumentPosition: bit 4 (Node.DOCUMENT_POSITION_FOLLOWING) indica que `figure` vem DEPOIS de `button`.
    expect(button.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('faixa compacta: lista de tiles fica num grid (não mais fileira horizontal)', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    const { container } = render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={vi.fn()} />)

    const grid = container.querySelector('.grid')
    expect(grid).not.toBeNull()
    expect(container.querySelector('.overflow-x-auto')).toBeNull()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: os 2 testes novos falham (layout ainda é `flex ... overflow-x-auto`, sem `.grid`).

- [ ] **Step 3: Trocar o layout da faixa compacta**

Em `apps/web/src/office/media/MediaTiles.tsx`, substitua o bloco (linhas 228-256):

```tsx
      {hasVisible && !expanded && (
        <div className="flex items-center gap-sm rounded-lg bg-surface-container p-md">
          <div className="flex flex-1 gap-md overflow-x-auto">
            {tiles
              .filter((t) => showAllPresent || t.kind !== 'avatar')
              .map((t) =>
                t.kind === 'avatar' ? (
                  <AvatarTile key={t.key} user={t.avatar} label={t.label} />
                ) : (
                  <VideoTile
                    key={t.key}
                    track={t.track!}
                    label={t.label}
                    mirrored={t.mirrored}
                    onClick={t.kind === 'screen' ? () => setExpandedId((t.avatar as RemoteMedia).userId) : undefined}
                  />
                ),
              )}
          </div>
          <button
            type="button"
            aria-label="Expandir câmeras"
            onClick={onToggleExpanded}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="fullscreen" className="text-[20px]" />
          </button>
        </div>
      )}
```

por:

```tsx
      {hasVisible && !expanded && (
        <div className="flex flex-col gap-sm rounded-lg bg-surface-container p-md">
          <button
            type="button"
            aria-label="Expandir câmeras"
            onClick={onToggleExpanded}
            className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="fullscreen" className="text-[20px]" />
          </button>
          <div className="grid max-h-[70vh] grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-md overflow-y-auto">
            {tiles
              .filter((t) => showAllPresent || t.kind !== 'avatar')
              .map((t) =>
                t.kind === 'avatar' ? (
                  <AvatarTile key={t.key} user={t.avatar} label={t.label} className="w-full" />
                ) : (
                  <VideoTile
                    key={t.key}
                    track={t.track!}
                    label={t.label}
                    mirrored={t.mirrored}
                    className="w-full"
                    onClick={t.kind === 'screen' ? () => setExpandedId((t.avatar as RemoteMedia).userId) : undefined}
                  />
                ),
              )}
          </div>
        </div>
      )}
```

Note que `className="w-full"` é passado explicitamente pra `AvatarTile`/`VideoTile` (em vez do default `w-40 shrink-0`), do mesmo jeito que a grade expandida já faz — é o grid (`minmax(160px,1fr)`) que controla a largura de cada tile agora, não mais uma largura fixa por tile.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: todos os testes (pré-existentes + os 2 novos) passam.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(office): faixa compacta de câmeras vira grid vertical"
```

---

### Task 3: `BroadcastBanner` — remover `pushDown`

**Files:**
- Modify: `apps/web/src/office/media/BroadcastBanner.tsx`
- Test: `apps/web/src/office/media/BroadcastBanner.test.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `BroadcastBanner({ speakers, tracks })` sem o prop `pushDown` — a Task 4 (`OfficePage.tsx`) para de passar esse prop.

- [ ] **Step 1: Atualizar o teste primeiro (remover casos de `pushDown`)**

Substitua o conteúdo de `apps/web/src/office/media/BroadcastBanner.test.tsx` por:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BroadcastBanner } from './BroadcastBanner'

describe('BroadcastBanner', () => {
  it('usa top-4', () => {
    render(<BroadcastBanner speakers={['Ana']} tracks={[]} />)
    expect(screen.getByRole('status')).toHaveClass('top-4')
  })

  it('sem speakers, não renderiza nada visível', () => {
    const { container } = render(<BroadcastBanner speakers={[]} tracks={[]} />)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar o teste**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/BroadcastBanner.test.tsx`
Expected: passa mesmo antes da Step 3 (o componente atual aceita `pushDown` como prop opcional não utilizado nestes casos; nada aqui força um "red" — o objetivo desta task é simplificar o componente removendo o prop morto, não um bugfix). Prossiga para a Step 3.

- [ ] **Step 3: Remover `pushDown` do componente**

Substitua `apps/web/src/office/media/BroadcastBanner.tsx` inteiro por:

```tsx
import type { RemoteAudioTrack } from 'livekit-client'
import { RemoteAudio } from './RemoteAudio'

/** Aviso global de "alguém no alto-falante" + os áudios do broadcast. */
export function BroadcastBanner({
  speakers,
  tracks,
}: {
  speakers: string[]
  tracks: RemoteAudioTrack[]
}) {
  return (
    <>
      {tracks.map((track, index) => (
        <RemoteAudio key={track.sid ?? index} track={track} />
      ))}
      {speakers.length > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-primary/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur"
        >
          📢 {speakers.join(', ')} no alto-falante
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/BroadcastBanner.test.tsx`
Expected: os 2 testes passam.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/BroadcastBanner.tsx apps/web/src/office/media/BroadcastBanner.test.tsx
git commit -m "refactor(office): remover pushDown do BroadcastBanner (faixa não ocupa mais o topo)"
```

---

### Task 4: `OfficePage` — reposicionar a faixa, ligar o resize e remover `topMediaVisible`

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx` (imports, `topMediaVisible`, chamada de `<BroadcastBanner>`, container de `<MediaTiles>`)

**Interfaces:**
- Consumes: `useMediaStripWidth()` (Task 1) → `{ width: number; onPointerDown; onPointerMove; onPointerUp }`; `BroadcastBanner({ speakers, tracks })` sem `pushDown` (Task 3).
- Produces: nada consumido por tarefas futuras — última tarefa do plano.

- [ ] **Step 1: Adicionar o import e o hook**

Em `apps/web/src/pages/OfficePage.tsx`, adicione o import junto aos demais de `../office/media/*` (perto da linha 16):

```tsx
import { useMediaStripWidth } from '../office/media/useMediaStripWidth'
```

Dentro do componente `OfficePage`, logo após a declaração de `const [camerasExpanded, setCamerasExpanded] = useState(false)` (por volta da linha 57), adicione:

```tsx
  const mediaStripWidth = useMediaStripWidth()
```

- [ ] **Step 2: Remover `topMediaVisible` e o prop `pushDown`**

Localize o bloco (por volta das linhas 78-84):

```tsx
  // Mesma condição que o MediaTiles usa internamente pra decidir se a faixa
  // do topo aparece — calculada aqui só pra avisar o BroadcastBanner, sem
  // expor o hasVisible do MediaTiles pra fora dele. Em sala/zona, presença já
  // basta (ver MediaTiles/showAllPresent); no espaço aberto, só mídia ativa.
  const topMediaVisible = inMeetingRoom
    ? local !== null || media.remotes.length > 0
    : media.remotes.some((r) => r.cameraTrack || r.screenTrack)
```

Remova esse bloco inteiro (a faixa deixa de ocupar o topo, então o `BroadcastBanner` não precisa mais saber se ela está visível).

Localize a chamada de `<BroadcastBanner>` (por volta da linha 144-148):

```tsx
      <BroadcastBanner
        speakers={broadcast.speakers}
        tracks={broadcast.broadcastTracks}
        pushDown={topMediaVisible}
      />
```

Substitua por:

```tsx
      <BroadcastBanner
        speakers={broadcast.speakers}
        tracks={broadcast.broadcastTracks}
      />
```

- [ ] **Step 3: Reposicionar o container de `<MediaTiles>` pro canto superior direito, com largura controlada e alça de arraste**

Localize o bloco (por volta das linhas 250-264):

```tsx
      {/* Câmeras: faixa fina no topo (ou grade em tela cheia quando
          expandida) — fora do fluxo dos controles, sem competir por espaço
          embaixo. */}
      <div
        className="absolute top-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
        onWheel={(event) => event.stopPropagation()}
      >
        <MediaTiles
          remotes={media.remotes}
          local={local}
          expanded={camerasExpanded}
          onToggleExpanded={() => setCamerasExpanded((value) => !value)}
          showAllPresent={inMeetingRoom}
        />
      </div>
```

Substitua por:

```tsx
      {/* Câmeras: faixa fina na lateral direita (ou grade em tela cheia
          quando expandida) — fora do fluxo dos controles, redimensionável
          por arraste na borda esquerda. */}
      <div
        className="absolute top-3 right-3 z-10 flex gap-sm"
        style={{ width: camerasExpanded ? undefined : mediaStripWidth.width }}
        onWheel={(event) => event.stopPropagation()}
      >
        {!camerasExpanded && (
          <div
            role="separator"
            aria-label="Redimensionar faixa de câmeras"
            aria-orientation="vertical"
            onPointerDown={mediaStripWidth.onPointerDown}
            onPointerMove={mediaStripWidth.onPointerMove}
            onPointerUp={mediaStripWidth.onPointerUp}
            onPointerCancel={mediaStripWidth.onPointerUp}
            className="w-1 shrink-0 cursor-col-resize touch-none select-none self-stretch rounded-full bg-outline-variant/40 hover:bg-outline-variant"
          />
        )}
        <div className="min-w-0 flex-1">
          <MediaTiles
            remotes={media.remotes}
            local={local}
            expanded={camerasExpanded}
            onToggleExpanded={() => setCamerasExpanded((value) => !value)}
            showAllPresent={inMeetingRoom}
          />
        </div>
      </div>
```

Note que a alça só aparece quando a faixa não está expandida (`!camerasExpanded`) — a grade em tela cheia é um overlay via portal (`createPortal(..., document.body)`) e não é afetada pela largura deste container; por isso `style={{ width: ... }}` também só se aplica quando `!camerasExpanded` (`undefined` deixa a largura livre, sem afetar o overlay).

- [ ] **Step 4: Rodar a suíte de testes do web**

Run: `pnpm --filter @legends/web test -- --run`
Expected: todos os testes passam (nenhum teste de `OfficePage.test.tsx` referenciava `topMediaVisible`/`pushDown` diretamente, conforme checado antes de escrever este plano).

- [ ] **Step 5: Rodar o typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Verificação manual**

Suba a stack local (`pnpm db:up` se necessário, depois `pnpm dev`), entre no escritório, vá pra uma sala de reunião com câmera ligada. Confirme: a faixa aparece no canto superior direito, em coluna; arrastar a alça na borda esquerda pra esquerda alarga a faixa (mais tiles por linha se houver mais gente), pra direita estreita até o mínimo; soltar o mouse e recarregar a página mantém a largura escolhida; o botão de expandir continua abrindo a grade em tela cheia normalmente; o aviso de "alguém no alto-falante" (se aplicável) sempre aparece no topo, sem descer.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx
git commit -m "feat(office): faixa de câmeras na lateral direita, redimensionável por arraste"
```
