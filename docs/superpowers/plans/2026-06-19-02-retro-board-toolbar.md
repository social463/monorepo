# Toolbar lateral do board de retro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a paleta de cores fixa no rodapé do board por uma toolbar vertical à esquerda com três ferramentas selecionáveis (Cursor, Post-it, Reagir), cada uma abrindo seu flyout de opções.

**Architecture:** Frontend apenas. Três componentes novos de UI sem estado próprio de domínio (`BoardToolbar`, `StickyFlyout`, `ReactionFlyout`) controlados por estado em `RetroRoomPage` (`tool` + `activeReaction`). Reaproveita `createAtCenter` (criação de post-it) e `reactM` (toggle de reação) já existentes. Sem mudança de API/DB/contrato.

**Tech Stack:** React 18 + React Query + Tailwind; tipos/constantes de `@legends/shared` (`RETRO_CARD_COLORS`, `RETRO_REACTION_EMOJIS`, `RetroCardColor`, `RetroReactionEmoji`). Vitest + jsdom + Testing Library. Ícones em **SVG inline** (não há `lucide-react` no projeto).

## Global Constraints

- TypeScript **strict**, ESM puro. Mensagens ao usuário em **português**.
- **Só frontend.** Nenhuma mudança em API/Prisma/`@legends/shared`.
- Web build é type-checked (`tsc --noEmit && vite build`) — todo diff deve ficar type-clean.
- Sem nova dependência: ícones em SVG inline.
- Reações restritas às 6 de `RETRO_REACTION_EMOJIS`; cores às 6 de `RETRO_CARD_COLORS`.
- `CARD_COLOR_CLASS` continua exportado de `apps/web/src/pages/retro/ColorPalette.tsx` (consumido por `PostIt` e, agora, `StickyFlyout`). Não apagar esse export.
- Spec: `docs/superpowers/specs/2026-06-19-retro-board-toolbar-design.md`.

## Mapa de arquivos

- Create: `apps/web/src/pages/retro/BoardToolbar.tsx` — coluna de ferramentas; exporta `type RetroTool`.
- Create: `apps/web/src/pages/retro/StickyFlyout.tsx` — flyout de cores (reusa `CARD_COLOR_CLASS`).
- Create: `apps/web/src/pages/retro/ReactionFlyout.tsx` — flyout de reações + borracha; exporta `type ReactionStamp`.
- Modify: `apps/web/src/pages/RetroRoomPage.tsx` — estado `tool`/`activeReaction`, fiação, render da toolbar/flyouts, carimbo de reação no clique do card; remove a `ColorPalette` do rodapé.
- Tests: `BoardToolbar.test.tsx`, `StickyFlyout.test.tsx`, `ReactionFlyout.test.tsx` (novos); `RetroRoomPage.test.tsx` (ajuste).

> `ColorPalette.tsx` **não** é apagado: mantém o `export const CARD_COLOR_CLASS`. O componente `ColorPalette` fica sem uso (export ocioso, sem erro de lint/tsc) — não precisa remover.

---

### Task 1: BoardToolbar (coluna de ferramentas)

**Files:**
- Create: `apps/web/src/pages/retro/BoardToolbar.tsx`
- Test: `apps/web/src/pages/retro/BoardToolbar.test.tsx`

**Interfaces:**
- Produces:
  - `export type RetroTool = 'cursor' | 'postit' | 'react'`
  - `export function BoardToolbar({ tool, onSelectTool }: { tool: RetroTool; onSelectTool: (t: RetroTool) => void }): JSX.Element`
  - Cada botão tem `aria-label` (`Cursor` | `Adicionar post-it` | `Reagir`) e `aria-pressed={tool === id}`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/retro/BoardToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoardToolbar } from './BoardToolbar'

describe('BoardToolbar', () => {
  it('mostra as 3 ferramentas e marca a ativa', () => {
    render(<BoardToolbar tool="postit" onSelectTool={() => {}} />)
    expect(screen.getByRole('button', { name: /cursor/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /adicionar post-it/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /reagir/i })).toBeInTheDocument()
  })

  it('dispara onSelectTool com a ferramenta clicada', () => {
    const onSelectTool = vi.fn()
    render(<BoardToolbar tool="cursor" onSelectTool={onSelectTool} />)
    fireEvent.click(screen.getByRole('button', { name: /reagir/i }))
    expect(onSelectTool).toHaveBeenCalledWith('react')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/BoardToolbar.test.tsx`
Expected: FAIL — módulo `./BoardToolbar` inexistente.

- [ ] **Step 3: Implement BoardToolbar**

```tsx
// apps/web/src/pages/retro/BoardToolbar.tsx
import type { JSX } from 'react'

export type RetroTool = 'cursor' | 'postit' | 'react'

const CursorIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 3l7 17 2.5-6.5L20 11 4 3z" />
  </svg>
)
const StickyIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16v10l-6 6H4V4z" />
    <path d="M20 14h-6v6" />
  </svg>
)
const ReactIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" />
    <line x1="15" y1="9" x2="15.01" y2="9" />
  </svg>
)

const TOOLS: { id: RetroTool; label: string; icon: () => JSX.Element }[] = [
  { id: 'cursor', label: 'Cursor', icon: CursorIcon },
  { id: 'postit', label: 'Adicionar post-it', icon: StickyIcon },
  { id: 'react', label: 'Reagir', icon: ReactIcon },
]

export function BoardToolbar({ tool, onSelectTool }: { tool: RetroTool; onSelectTool: (t: RetroTool) => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-outline-variant/40 bg-surface-container p-1.5 shadow-lg">
      {TOOLS.map(({ id, label, icon: Icon }) => {
        const active = tool === id
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onSelectTool(id)}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              active ? 'bg-surface-container-highest text-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            <Icon />
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/BoardToolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/BoardToolbar.tsx apps/web/src/pages/retro/BoardToolbar.test.tsx
git commit -m "feat(web): BoardToolbar vertical (cursor, post-it, reagir)"
```

---

### Task 2: StickyFlyout (flyout de cores)

**Files:**
- Create: `apps/web/src/pages/retro/StickyFlyout.tsx`
- Test: `apps/web/src/pages/retro/StickyFlyout.test.tsx`

**Interfaces:**
- Consumes: `CARD_COLOR_CLASS` de `./ColorPalette`; `RETRO_CARD_COLORS`, `RetroCardColor` de `@legends/shared`.
- Produces: `export function StickyFlyout({ onPick, disabled }: { onPick: (c: RetroCardColor) => void; disabled?: boolean }): JSX.Element`. Cada swatch tem `aria-label={`Criar post-it ${c}`}` (mantém o rótulo já usado pelo teste da página).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/retro/StickyFlyout.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RETRO_CARD_COLORS } from '@legends/shared'
import { StickyFlyout } from './StickyFlyout'

describe('StickyFlyout', () => {
  it('mostra um swatch por cor e dispara onPick', () => {
    const onPick = vi.fn()
    render(<StickyFlyout onPick={onPick} />)
    expect(screen.getAllByRole('button')).toHaveLength(RETRO_CARD_COLORS.length)
    fireEvent.click(screen.getByRole('button', { name: /Criar post-it green/i }))
    expect(onPick).toHaveBeenCalledWith('green')
  })

  it('desabilita os swatches quando disabled', () => {
    render(<StickyFlyout onPick={() => {}} disabled />)
    expect(screen.getByRole('button', { name: /Criar post-it yellow/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/StickyFlyout.test.tsx`
Expected: FAIL — módulo `./StickyFlyout` inexistente.

- [ ] **Step 3: Implement StickyFlyout**

```tsx
// apps/web/src/pages/retro/StickyFlyout.tsx
import type { JSX } from 'react'
import { RETRO_CARD_COLORS, type RetroCardColor } from '@legends/shared'
import { CARD_COLOR_CLASS } from './ColorPalette'

export function StickyFlyout({ onPick, disabled }: { onPick: (c: RetroCardColor) => void; disabled?: boolean }): JSX.Element {
  return (
    <div className="w-44 rounded-2xl border border-outline-variant/40 bg-surface-container p-3 shadow-lg">
      <p className="mb-2 text-center font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Post-its</p>
      <div className="grid grid-cols-3 gap-2">
        {RETRO_CARD_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-label={`Criar post-it ${c}`}
            onClick={() => onPick(c)}
            className={`aspect-square rounded-md border-2 shadow-sm transition-transform hover:scale-105 disabled:opacity-40 ${CARD_COLOR_CLASS[c]}`}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/StickyFlyout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/StickyFlyout.tsx apps/web/src/pages/retro/StickyFlyout.test.tsx
git commit -m "feat(web): StickyFlyout com as 6 cores de post-it"
```

---

### Task 3: ReactionFlyout (flyout de reações + borracha)

**Files:**
- Create: `apps/web/src/pages/retro/ReactionFlyout.tsx`
- Test: `apps/web/src/pages/retro/ReactionFlyout.test.tsx`

**Interfaces:**
- Consumes: `RETRO_REACTION_EMOJIS`, `RetroReactionEmoji` de `@legends/shared`.
- Produces:
  - `export type ReactionStamp = RetroReactionEmoji | 'eraser'`
  - `export function ReactionFlyout({ active, onSelect }: { active: ReactionStamp | null; onSelect: (v: ReactionStamp) => void }): JSX.Element`
  - Emojis com `aria-label={`Reagir com ${emoji}`}`; borracha com `aria-label="Borracha"`. Botão ativo tem `aria-pressed={true}`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/retro/ReactionFlyout.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RETRO_REACTION_EMOJIS } from '@legends/shared'
import { ReactionFlyout } from './ReactionFlyout'

describe('ReactionFlyout', () => {
  it('mostra as 6 reações + borracha e marca a ativa', () => {
    render(<ReactionFlyout active="🔥" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /Reagir com 👍/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(RETRO_REACTION_EMOJIS.length + 1)
    expect(screen.getByRole('button', { name: /Reagir com 🔥/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('dispara onSelect com o emoji e com a borracha', () => {
    const onSelect = vi.fn()
    render(<ReactionFlyout active={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /Reagir com ❤️/ }))
    expect(onSelect).toHaveBeenCalledWith('❤️')
    fireEvent.click(screen.getByRole('button', { name: /Borracha/i }))
    expect(onSelect).toHaveBeenCalledWith('eraser')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/ReactionFlyout.test.tsx`
Expected: FAIL — módulo `./ReactionFlyout` inexistente.

- [ ] **Step 3: Implement ReactionFlyout**

```tsx
// apps/web/src/pages/retro/ReactionFlyout.tsx
import type { JSX } from 'react'
import { RETRO_REACTION_EMOJIS, type RetroReactionEmoji } from '@legends/shared'

export type ReactionStamp = RetroReactionEmoji | 'eraser'

export function ReactionFlyout({ active, onSelect }: { active: ReactionStamp | null; onSelect: (v: ReactionStamp) => void }): JSX.Element {
  const cell = (selected: boolean) =>
    `flex h-10 w-10 items-center justify-center rounded-xl text-[20px] transition-colors ${
      selected ? 'bg-surface-container-highest ring-2 ring-primary' : 'hover:bg-surface-container-highest'
    }`
  return (
    <div className="w-44 rounded-2xl border border-outline-variant/40 bg-surface-container p-3 shadow-lg">
      <p className="mb-2 text-center font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Reações</p>
      <div className="grid grid-cols-3 gap-1">
        {RETRO_REACTION_EMOJIS.map((emoji) => (
          <button key={emoji} type="button" aria-label={`Reagir com ${emoji}`} aria-pressed={active === emoji} onClick={() => onSelect(emoji)} className={cell(active === emoji)}>
            {emoji}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label="Borracha"
        aria-pressed={active === 'eraser'}
        onClick={() => onSelect('eraser')}
        className={`mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-1.5 font-label text-label-sm transition-colors ${
          active === 'eraser' ? 'bg-surface-container-highest text-primary ring-2 ring-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'
        }`}
      >
        🧽 Borracha
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/ReactionFlyout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/ReactionFlyout.tsx apps/web/src/pages/retro/ReactionFlyout.test.tsx
git commit -m "feat(web): ReactionFlyout com as 6 reações + borracha"
```

---

### Task 4: Fiação na RetroRoomPage (estado, toolbar, carimbo)

**Files:**
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Test: `apps/web/src/pages/RetroRoomPage.test.tsx`

**Interfaces:**
- Consumes: `BoardToolbar`, `RetroTool` (Task 1); `StickyFlyout` (Task 2); `ReactionFlyout`, `ReactionStamp` (Task 3); `createAtCenter`/`reactM` já existentes.
- Produces: `RetroRoomPage` com estado `tool`/`activeReaction`; render da toolbar + flyout no lugar da `ColorPalette` do rodapé; clique-carimbo nos cards no modo react.

- [ ] **Step 1: Update the test**

Em `apps/web/src/pages/RetroRoomPage.test.tsx`, **substitua** o caso existente `it('clicar numa cor da paleta cria post-it via API', ...)` por (agora a paleta vive no flyout do post-it, que só abre ao selecionar a ferramenta):

```tsx
  it('selecionar Post-it abre o flyout e clicar numa cor cria post-it via API', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    // sem ferramenta post-it ativa, o flyout de cores não está presente
    expect(screen.queryByRole('button', { name: /Criar post-it green/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /adicionar post-it/i }))
    fireEvent.click(screen.getByRole('button', { name: /Criar post-it green/i }))
    await waitFor(() => expect(api.createRetroCard).toHaveBeenCalled())
  })
```

E adicione, no mesmo `describe`, os casos de ferramenta/carimbo:

```tsx
  it('ferramenta inicial é cursor (flyouts fechados)', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    expect(screen.getByRole('button', { name: /cursor/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Post-its')).not.toBeInTheDocument()
    expect(screen.queryByText('Reações')).not.toBeInTheDocument()
  })

  it('com a ferramenta Reagir e um emoji ativo, clicar num card aplica a reação', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /reagir/i }))
    fireEvent.click(screen.getByRole('button', { name: /Reagir com 🔥/ }))
    fireEvent.pointerDown(screen.getByText('Deploy tranquilo'))
    await waitFor(() => expect(api.toggleRetroReaction).toHaveBeenCalledWith('r1', 'c1', '🔥'))
  })
```

> Garanta que `waitFor` e `fireEvent` continuam importados de `@testing-library/react` (já estão no topo do arquivo).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: FAIL — não há botões de ferramenta nem flyouts; `ColorPalette` aparece direto.

- [ ] **Step 3: Edit imports + state in RetroRoomPage**

Em `apps/web/src/pages/RetroRoomPage.tsx`:

Troque a primeira linha de import do React para incluir `useState`:

```tsx
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
```

**Remova** a linha `import { ColorPalette } from './retro/ColorPalette'` e **adicione**, junto dos outros imports de `./retro/*`:

```tsx
import { BoardToolbar, type RetroTool } from './retro/BoardToolbar'
import { StickyFlyout } from './retro/StickyFlyout'
import { ReactionFlyout, type ReactionStamp } from './retro/ReactionFlyout'
```

Logo após `const panning = useRef<...>(null)` (perto dos outros hooks no topo do componente), adicione o estado e o seletor de ferramenta:

```tsx
  const [tool, setTool] = useState<RetroTool>('cursor')
  const [activeReaction, setActiveReaction] = useState<ReactionStamp | null>(null)

  function selectTool(t: RetroTool) {
    setTool(t)
    if (t !== 'react') setActiveReaction(null)
  }
```

- [ ] **Step 4: Edit onCardPointerDown — carimbo de reação no modo react**

Substitua a função `onCardPointerDown` por:

```tsx
  function onCardPointerDown(e: ReactPointerEvent, card: RetroCardDTO) {
    if (!canWrite) return
    if (tool === 'react' && activeReaction) {
      if ((e.target as HTMLElement).closest('button')) return // deixa os botões inline do card agirem
      if (activeReaction === 'eraser') {
        card.reactions.filter((r) => r.reactedByMe).forEach((r) => reactM.mutate({ cardId: card.id, emoji: r.emoji }))
      } else {
        reactM.mutate({ cardId: card.id, emoji: activeReaction })
      }
      return
    }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const w = vp.toWorld(e.clientX, e.clientY, rect)
    drag.current = { cardId: card.id, offX: w.x - card.x, offY: w.y - card.y }
    socket.grab(card.id)
  }
```

- [ ] **Step 5: Edit JSX — cursor do canvas + toolbar/flyout no lugar da paleta**

No `<div>` do canvas (o que tem `ref={containerRef}`), troque o `style` para refletir o carimbo ativo:

```tsx
        style={{ cursor: tool === 'react' && activeReaction ? 'crosshair' : 'grab', touchAction: 'none' }}
```

E **substitua** todo o bloco final do rodapé:

```tsx
      {canWrite && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="pointer-events-auto">
            <ColorPalette onPick={createAtCenter} disabled={createM.isPending} />
          </div>
        </div>
      )}
```

por:

```tsx
      {canWrite && (
        <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
          <div className="pointer-events-auto flex items-start gap-2">
            <BoardToolbar tool={tool} onSelectTool={selectTool} />
            {tool === 'postit' && <StickyFlyout onPick={createAtCenter} disabled={createM.isPending} />}
            {tool === 'react' && <ReactionFlyout active={activeReaction} onSelect={setActiveReaction} />}
          </div>
        </div>
      )}
```

- [ ] **Step 6: Run test + full web build**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx` → PASS.
Run: `pnpm --filter @legends/web build` → type-clean + build ok.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(web): toolbar lateral com flyouts de post-it e reação no board"
```

---

## Self-Review (autor)

**Cobertura do spec:**
- Toolbar vertical à esquerda, 3 ferramentas, ativa destacada → Task 1 (`BoardToolbar`) + Task 4 (render `absolute left-4 top-1/2`).
- Cursor mantém arrasto/pan; cards com voto+reações inline → Task 4 (sem mudança no `PostIt`; `onCardPointerDown` só desvia no modo react).
- Post-it abre flyout de cores; clicar cria no centro → Task 2 (`StickyFlyout`) + Task 4 (`createAtCenter`).
- Reagir abre flyout (6 reações + borracha), carimbo no clique do card → Task 3 (`ReactionFlyout`) + Task 4 (`reactM`/eraser).
- Remove `ColorPalette` do rodapé, mantém `CARD_COLOR_CLASS` → Task 4 (remove import do componente; `StickyFlyout`/`PostIt` seguem usando o mapa).
- Só frontend, sem API/contrato → confirmado (nenhum arquivo em `apps/api`/`packages/shared`).

**Placeholder scan:** sem TODO/incompletos; todo passo de código tem código real.

**Type consistency:** `RetroTool` definido na Task 1 e importado na Task 4; `ReactionStamp` definido na Task 3 e usado em `activeReaction` (Task 4); `StickyFlyout.onPick: (c: RetroCardColor) => void` casa com `createAtCenter`; `ReactionFlyout.onSelect: (v: ReactionStamp) => void` casa com `setActiveReaction`; `reactM.mutate({ cardId, emoji })` recebe `RetroReactionEmoji` (no eraser, `r.emoji` das reações do card; no carimbo, `activeReaction` já narrowed para `RetroReactionEmoji` por exclusão do `'eraser'`).

**Riscos a validar na execução:**
- O carimbo usa `pointerDown` no corpo do card; o guard `closest('button')` evita conflito com os botões inline de voto/reação.
- `r.emoji` precisa ser `RetroReactionEmoji` no DTO (`RetroCardDTO.reactions[].emoji`); se for `string`, o `reactM` aceita mesmo assim em runtime, mas confirme o tipo no build (se reclamar, `as RetroReactionEmoji`).
- `import type { JSX } from 'react'` exige React 18 com os tipos atuais; se o tsconfig já tiver `JSX` global, o import é dispensável — remova se o build acusar conflito.
