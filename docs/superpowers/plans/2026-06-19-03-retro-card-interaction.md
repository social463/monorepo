# Card limpo + modelo de ferramentas (Cursor/Post-it/Reagir/Votar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o post-it limpo (sem controles inline) e mover criar/escrever/excluir/reagir/votar para um modelo de ferramenta selecionada, com a toolbar passando de 3 para 4 ferramentas (Cursor, Post-it, Reagir, Votar).

**Architecture:** Frontend apenas. `PostIt` vira componente **controlado** (estados `selected`/`editing` vindos da página) e read-only nos selos de voto/reação. A `RetroRoomPage` orquestra os 4 modos: seleção/edição/arrasto/exclusão no Cursor, carimbo no Reagir/Votar, e criação por clique no Post-it. Reaproveita as mutations e o socket já existentes; nenhum contrato/API muda.

**Tech Stack:** React 18 + React Query + Tailwind + TS ESM; tipos de `@legends/shared`. Vitest + jsdom + Testing Library. Ícones SVG inline.

## Global Constraints

- TypeScript **strict**, ESM puro. Mensagens ao usuário em **português**.
- **Só frontend.** Nenhuma mudança em `apps/api`, `packages/shared` ou Prisma.
- Web build type-checked (`tsc --noEmit && vite build`) — diff final type-clean.
- Sem nova dependência (ícones SVG inline).
- Reações restritas às 6 de `RETRO_REACTION_EMOJIS`; cores às 6 de `RETRO_CARD_COLORS`.
- `CARD_COLOR_CLASS` continua exportado de `apps/web/src/pages/retro/ColorPalette.tsx` (consumido por `PostIt` e `StickyFlyout`).
- DTO do card (`@legends/shared`): `RetroCardDTO` tem `text,x,y,color,author:{id,name}|null,mine,voteCount,myVotes,reactions:{emoji,count,reactedByMe}[]`. `voteM`/`reactM`/`editM`/`deleteM`/`createM` já existem na página.
- Spec: `docs/superpowers/specs/2026-06-19-retro-card-interaction-design.md`.

## Mapa de arquivos

- Modify: `apps/web/src/pages/retro/BoardToolbar.tsx` — 4º botão (Votar); `RetroTool += 'vote'`.
- Create: `apps/web/src/pages/retro/VoteFlyout.tsx` — votar/borracha + votos restantes; exporta `type VoteMode`.
- Modify: `apps/web/src/pages/retro/PostIt.tsx` — **reescrito** (limpo, controlado, selos read-only).
- Modify: `apps/web/src/pages/RetroRoomPage.tsx` — estado dos 4 modos, seleção/edição/exclusão, carimbo de voto, placement por clique.
- Tests: `BoardToolbar.test.tsx`, `VoteFlyout.test.tsx`, `PostIt.test.tsx`, `RetroRoomPage.test.tsx`.

**Ordem:** Task 1 (toolbar) → Task 2 (VoteFlyout) → Task 3 (PostIt limpo + interações cursor/voto) → Task 4 (placement). Task 3 consome o `'vote'` (Task 1) e o `VoteFlyout` (Task 2).

---

### Task 1: BoardToolbar — 4ª ferramenta (Votar)

**Files:**
- Modify: `apps/web/src/pages/retro/BoardToolbar.tsx`
- Test: `apps/web/src/pages/retro/BoardToolbar.test.tsx`

**Interfaces:**
- Produces: `type RetroTool = 'cursor' | 'postit' | 'react' | 'vote'`; `BoardToolbar` renderiza 4 botões; o botão Votar tem `aria-label="Votar"` e dispara `onSelectTool('vote')`.

- [ ] **Step 1: Update the test**

Substitua o conteúdo de `apps/web/src/pages/retro/BoardToolbar.test.tsx` por:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoardToolbar } from './BoardToolbar'

describe('BoardToolbar', () => {
  it('mostra as 4 ferramentas e marca a ativa', () => {
    render(<BoardToolbar tool="vote" onSelectTool={() => {}} />)
    expect(screen.getByRole('button', { name: /cursor/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /adicionar post-it/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reagir/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /votar/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('dispara onSelectTool com a ferramenta clicada', () => {
    const onSelectTool = vi.fn()
    render(<BoardToolbar tool="cursor" onSelectTool={onSelectTool} />)
    fireEvent.click(screen.getByRole('button', { name: /votar/i }))
    expect(onSelectTool).toHaveBeenCalledWith('vote')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/BoardToolbar.test.tsx`
Expected: FAIL — só há 3 ferramentas; não existe botão "Votar".

- [ ] **Step 3: Add the Votar tool**

Em `apps/web/src/pages/retro/BoardToolbar.tsx`:

Troque a definição do tipo para incluir `'vote'`:

```tsx
export type RetroTool = 'cursor' | 'postit' | 'react' | 'vote'
```

Adicione um ícone (junto dos outros ícones inline), uma seta pra cima num círculo:

```tsx
const VoteIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16V8" />
    <path d="M8.5 11.5L12 8l3.5 3.5" />
  </svg>
)
```

E adicione a entrada no array `TOOLS` (após a de `react`):

```tsx
  { id: 'vote', label: 'Votar', icon: VoteIcon },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/BoardToolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/BoardToolbar.tsx apps/web/src/pages/retro/BoardToolbar.test.tsx
git commit -m "feat(web): 4ª ferramenta Votar na BoardToolbar"
```

---

### Task 2: VoteFlyout (votar / borracha + votos restantes)

**Files:**
- Create: `apps/web/src/pages/retro/VoteFlyout.tsx`
- Test: `apps/web/src/pages/retro/VoteFlyout.test.tsx`

**Interfaces:**
- Produces:
  - `export type VoteMode = 'add' | 'remove'`
  - `export function VoteFlyout({ mode, onSelect, remaining }: { mode: VoteMode; onSelect: (m: VoteMode) => void; remaining: number }): JSX.Element`
  - Botões com `aria-label="Votar"` e `aria-label="Remover voto"`; `aria-pressed` no ativo; mostra "Votos restantes: {remaining}".

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/retro/VoteFlyout.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VoteFlyout } from './VoteFlyout'

describe('VoteFlyout', () => {
  it('mostra votos restantes e marca o modo ativo', () => {
    render(<VoteFlyout mode="add" onSelect={() => {}} remaining={2} />)
    expect(screen.getByText(/Votos restantes:\s*2/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^votar$/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /remover voto/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('dispara onSelect com add e remove', () => {
    const onSelect = vi.fn()
    render(<VoteFlyout mode="add" onSelect={onSelect} remaining={3} />)
    fireEvent.click(screen.getByRole('button', { name: /remover voto/i }))
    expect(onSelect).toHaveBeenCalledWith('remove')
    fireEvent.click(screen.getByRole('button', { name: /^votar$/i }))
    expect(onSelect).toHaveBeenCalledWith('add')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/VoteFlyout.test.tsx`
Expected: FAIL — módulo `./VoteFlyout` inexistente.

- [ ] **Step 3: Implement VoteFlyout**

```tsx
// apps/web/src/pages/retro/VoteFlyout.tsx
import type { JSX } from 'react'

export type VoteMode = 'add' | 'remove'

export function VoteFlyout({ mode, onSelect, remaining }: { mode: VoteMode; onSelect: (m: VoteMode) => void; remaining: number }): JSX.Element {
  const cell = (selected: boolean) =>
    `flex flex-1 items-center justify-center gap-1 rounded-xl py-1.5 font-label text-label-sm transition-colors ${
      selected ? 'bg-surface-container-highest text-primary ring-2 ring-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'
    }`
  return (
    <div className="w-44 rounded-2xl border border-outline-variant/40 bg-surface-container p-3 shadow-lg">
      <p className="mb-2 text-center font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Votar</p>
      <div className="flex gap-1">
        <button type="button" aria-label="Votar" aria-pressed={mode === 'add'} onClick={() => onSelect('add')} className={cell(mode === 'add')}>
          ★ +1
        </button>
        <button type="button" aria-label="Remover voto" aria-pressed={mode === 'remove'} onClick={() => onSelect('remove')} className={cell(mode === 'remove')}>
          🧽 −1
        </button>
      </div>
      <p className="mt-2 text-center font-label text-label-sm text-on-surface-variant">Votos restantes: {remaining}</p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/VoteFlyout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/VoteFlyout.tsx apps/web/src/pages/retro/VoteFlyout.test.tsx
git commit -m "feat(web): VoteFlyout (votar/borracha + votos restantes)"
```

---

### Task 3: PostIt limpo + interações de Cursor e Votar na RetroRoomPage

**Files:**
- Modify: `apps/web/src/pages/retro/PostIt.tsx`
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Test: `apps/web/src/pages/retro/PostIt.test.tsx`, `apps/web/src/pages/RetroRoomPage.test.tsx`

**Interfaces:**
- Consumes: `RetroTool` (inclui `'vote'`, Task 1); `VoteFlyout`, `VoteMode` (Task 2); `CARD_COLOR_CLASS` (`./ColorPalette`).
- Produces (novo `PostIt`):
  - `PostIt({ card, readOnly, lockedBy, selected, editing, editingText, onPointerDown, onEditChange, onEndEdit })` — sem `onVote`/`onReact`/`onDelete`/`onEdit`. `onEditChange: (text: string) => void`, `onEndEdit: () => void`. Container expõe atributo `data-selected` quando `selected`.

- [ ] **Step 1: Replace the PostIt test**

Substitua **todo** o conteúdo de `apps/web/src/pages/retro/PostIt.test.tsx` por:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PostIt } from './PostIt'
import type { RetroCardDTO } from '@legends/shared'

const base: RetroCardDTO = {
  id: 'c1', text: 'Deploy tranquilo', x: 0, y: 0, color: 'yellow',
  author: { id: 'u1', name: 'Dan' }, mine: true, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '',
}
const props = {
  readOnly: false, lockedBy: null, selected: false, editing: false, editingText: '',
  onPointerDown: vi.fn(), onEditChange: vi.fn(), onEndEdit: vi.fn(),
}

describe('PostIt (limpo)', () => {
  it('card limpo: mostra o texto e nenhum botão inline', () => {
    render(<PostIt card={base} {...props} />)
    expect(screen.getByText('Deploy tranquilo')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('selo de voto só aparece quando voteCount > 0', () => {
    const { rerender } = render(<PostIt card={base} {...props} />)
    expect(screen.queryByText(/★/)).toBeNull()
    rerender(<PostIt card={{ ...base, voteCount: 3 }} {...props} />)
    expect(screen.getByText(/★\s*3/)).toBeInTheDocument()
  })

  it('chip de reação só quando count > 0', () => {
    render(<PostIt card={{ ...base, reactions: [{ emoji: '🔥', count: 2, reactedByMe: false }, { emoji: '👍', count: 0, reactedByMe: false }] }} {...props} />)
    expect(screen.getByText(/🔥\s*2/)).toBeInTheDocument()
    expect(screen.queryByText(/👍/)).toBeNull()
  })

  it('editing mostra textarea e dispara onEndEdit no blur', () => {
    const onEndEdit = vi.fn()
    render(<PostIt card={base} {...props} editing editingText="oi" onEndEdit={onEndEdit} />)
    const ta = screen.getByRole('textbox')
    expect(ta).toHaveValue('oi')
    fireEvent.blur(ta)
    expect(onEndEdit).toHaveBeenCalled()
  })

  it('selected aplica a marca de seleção', () => {
    const { container } = render(<PostIt card={base} {...props} selected />)
    expect(container.querySelector('[data-selected]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/PostIt.test.tsx`
Expected: FAIL — props antigas (`onVote` etc.) e o card atual têm botões; `data-selected` não existe.

- [ ] **Step 3: Rewrite PostIt.tsx**

Substitua **todo** o conteúdo de `apps/web/src/pages/retro/PostIt.tsx` por:

```tsx
import { type PointerEvent as ReactPointerEvent } from 'react'
import { POSTIT_WIDTH, POSTIT_HEIGHT, type RetroCardColor, type RetroCardDTO } from '@legends/shared'
import { CARD_COLOR_CLASS } from './ColorPalette'

export function PostIt({
  card,
  readOnly,
  lockedBy,
  selected,
  editing,
  editingText,
  onPointerDown,
  onEditChange,
  onEndEdit,
}: {
  card: RetroCardDTO
  readOnly: boolean
  lockedBy: { byUserId: string; byName: string } | null
  selected: boolean
  editing: boolean
  editingText: string
  onPointerDown: (e: ReactPointerEvent) => void
  onEditChange: (text: string) => void
  onEndEdit: () => void
}) {
  const locked = lockedBy != null
  const colorClass = CARD_COLOR_CLASS[card.color as RetroCardColor] ?? CARD_COLOR_CLASS.yellow
  const authorLabel = card.mine ? 'Você' : card.author?.name ?? 'Anônimo'
  const reactions = card.reactions.filter((r) => r.count > 0)

  return (
    <div
      data-selected={selected || undefined}
      className={`absolute flex flex-col rounded-lg border-2 p-2 shadow-md ${colorClass} ${
        selected ? 'ring-2 ring-primary ring-offset-1' : ''
      } ${locked ? 'opacity-70 ring-2 ring-primary' : ''}`}
      style={{ left: card.x, top: card.y, width: POSTIT_WIDTH, minHeight: POSTIT_HEIGHT, touchAction: 'none' }}
      onPointerDown={(e) => {
        if (editing || locked || readOnly) return
        onPointerDown(e)
      }}
    >
      {locked && (
        <span className="absolute -top-5 left-0 rounded bg-primary px-1.5 py-0.5 font-label text-[10px] text-on-primary">
          {lockedBy!.byName} movendo
        </span>
      )}

      <span
        title={authorLabel}
        aria-label={authorLabel}
        className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-bold text-white shadow"
      >
        {authorLabel.charAt(0).toUpperCase()}
      </span>

      {editing ? (
        <textarea
          autoFocus
          value={editingText}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEndEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onEndEdit()
            }
          }}
          className="flex-1 resize-none rounded bg-white/60 p-1 text-body-sm text-zinc-900 outline-none"
          rows={5}
        />
      ) : (
        <p className="flex-1 whitespace-pre-wrap break-words text-body-sm text-zinc-900">{card.text}</p>
      )}

      {(card.voteCount > 0 || reactions.length > 0) && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {card.voteCount > 0 && (
            <span className="rounded-full bg-white/70 px-1.5 text-[11px] font-bold text-zinc-800">★ {card.voteCount}</span>
          )}
          {reactions.map((r) => (
            <span key={r.emoji} className="rounded-full bg-white/60 px-1 text-[12px] text-zinc-800">{r.emoji} {r.count}</span>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run PostIt test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/PostIt.test.tsx`
Expected: PASS (5/5).

> O web build ainda quebra aqui (a página usa as props antigas) — será corrigido no Step 7.

- [ ] **Step 5: Update the RetroRoomPage test**

Em `apps/web/src/pages/RetroRoomPage.test.tsx`:

(a) No fixture `room`, troque o card `c1` para ser **meu** (`mine: true`) para habilitar editar/excluir:

```tsx
  cards: [{ id: 'c1', text: 'Deploy tranquilo', x: 40, y: 50, color: 'yellow', author: { id: 'd1', name: 'Dan' }, mine: true, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '' }],
```

(b) **Remova** o teste `it('selecionar Post-it abre o flyout e clicar numa cor cria post-it via API', ...)` (a criação muda na Task 4; um novo teste de criação entra lá). Mantenha os testes de "ferramenta inicial é cursor", reação, Sair, instruções e zoom.

(c) Adicione, no `describe` existente, os casos de cursor/voto:

```tsx
  it('Cursor: 1º clique seleciona, 2º clique edita o card', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const card = screen.getByText('Deploy tranquilo').closest('[style]') as HTMLElement
    // 1º clique (pointerdown no card + pointerup sem mover) => seleciona
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    expect(document.querySelector('[data-selected]')).not.toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    // 2º clique => edita
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('Del exclui o card selecionado (e ignora durante a edição)', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    const card = screen.getByText('Deploy tranquilo').closest('[style]') as HTMLElement
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    fireEvent.keyDown(window, { key: 'Delete' })
    await waitFor(() => expect(api.deleteRetroCard).toHaveBeenCalledWith('r1', 'c1'))
  })

  it('Votar: ferramenta ativa + clique no card adiciona voto', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /votar/i }))
    const card = screen.getByText('Deploy tranquilo').closest('[style]') as HTMLElement
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(api.addRetroVote).toHaveBeenCalledWith('r1', 'c1'))
  })
```

> `screen.getByText('Deploy tranquilo').closest('[style]')` pega o `<div>` do PostIt (que tem `style` inline). `fireEvent.pointerUp(window)` dispara o listener global de pointerup.

- [ ] **Step 6: Run the page test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: FAIL — a página ainda passa props antigas ao `PostIt`, não tem estado de seleção/edição/voto nem o `VoteFlyout`.

- [ ] **Step 7: Edit RetroRoomPage.tsx (estado + interações Cursor/Votar)**

Aplique as edições abaixo em `apps/web/src/pages/RetroRoomPage.tsx`. **Preserve** as mutations (`createM/editM/deleteM/voteM/reactM/concludeM`), `useCanvasViewport`, `viewportRect`, top bar, zoom e o render do mundo.

**(7.1) Imports** — adicione (junto aos imports de `./retro/*`):

```tsx
import { VoteFlyout, type VoteMode } from './retro/VoteFlyout'
```

**(7.2) Tipo do ref de arrasto** — troque a declaração do ref `drag` por:

```tsx
  const drag = useRef<{ cardId: string; startX: number; startY: number; offX: number; offY: number; moved: boolean; onClick: () => void } | null>(null)
```

**(7.3) Estado** — logo após `const [activeReaction, setActiveReaction] = useState<ReactionStamp | null>(null)`, adicione:

```tsx
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [selectedMine, setSelectedMine] = useState(false)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [voteMode, setVoteMode] = useState<VoteMode>('add')
```

**(7.4) selectTool** — troque a função `selectTool` por (sai da edição ao trocar de ferramenta):

```tsx
  function selectTool(t: RetroTool) {
    setTool(t)
    if (t !== 'react') setActiveReaction(null)
    if (editingCardId) endEdit()
  }
```

**(7.5) Efeito de pointermove/pointerup** — substitua **todo** o `useEffect` de listeners globais por:

```tsx
  // Listeners globais de arrasto/pan. Distingue clique (sem mover) de arrasto por limiar de 4px.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      if (drag.current) {
        const d = drag.current
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
          d.moved = true
          socket.grab(d.cardId)
        }
        const w = vp.toWorld(e.clientX, e.clientY, rect)
        const x = w.x - d.offX
        const y = w.y - d.offY
        dragPos.current = { x, y }
        patch((c) => ({ room: { ...c.room, cards: c.room.cards.map((k) => (k.id === d.cardId ? { ...k, x, y } : k)) } }))
        socket.move(d.cardId, x, y)
      } else if (panning.current) {
        vp.panBy(e.clientX - panning.current.x, e.clientY - panning.current.y)
        panning.current = { x: e.clientX, y: e.clientY }
      } else {
        const w = vp.toWorld(e.clientX, e.clientY, rect)
        socket.sendCursor(w.x, w.y)
      }
    }
    function onUp() {
      if (drag.current) {
        const d = drag.current
        if (d.moved) {
          if (dragPos.current) updateRetroCardPosition(id, d.cardId, dragPos.current.x, dragPos.current.y).catch(() => {})
          socket.drop(d.cardId)
        } else {
          d.onClick()
        }
        drag.current = null
        dragPos.current = null
      }
      panning.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [id, vp, socket, qc])
```

**(7.6) Efeito de teclado (Del/Backspace)** — adicione um novo `useEffect` logo após o anterior:

```tsx
  // Excluir o card selecionado com Del/Backspace (fora da edição).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (editingCardId) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (!selectedCardId || !selectedMine) return
      e.preventDefault()
      deleteM.mutate(selectedCardId)
      setSelectedCardId(null)
      setSelectedMine(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingCardId, selectedCardId, selectedMine])
```

**(7.7) endEdit + handleCursorClick** — adicione estas funções perto de `onCardPointerDown` (após `const canWrite = ...`, dentro do componente; `endEdit` é declaração de função, pode ser referenciada por `selectTool`):

```tsx
  function endEdit() {
    const cardId = editingCardId
    if (!cardId) return
    const card = room.cards.find((c) => c.id === cardId)
    const next = editingText.trim()
    if (card && next && next !== card.text) editM.mutate({ cardId, text: next })
    setEditingCardId(null)
  }

  function handleCursorClick(card: RetroCardDTO) {
    if (editingCardId && editingCardId !== card.id) endEdit()
    if (selectedCardId !== card.id) {
      setSelectedCardId(card.id)
      setSelectedMine(card.mine)
      setEditingCardId(null)
    } else if (card.mine) {
      setEditingCardId(card.id)
      setEditingText(card.text)
    }
  }
```

**(7.8) onCardPointerDown** — substitua a função por (ramo react já existente + ramo vote + cursor com clique/arrasto):

```tsx
  function onCardPointerDown(e: ReactPointerEvent, card: RetroCardDTO) {
    if (!canWrite) return
    if (tool === 'react' && activeReaction) {
      if ((e.target as HTMLElement).closest('button')) return
      if (activeReaction === 'eraser') {
        card.reactions.filter((r) => r.reactedByMe).forEach((r) => reactM.mutate({ cardId: card.id, emoji: r.emoji }))
      } else {
        reactM.mutate({ cardId: card.id, emoji: activeReaction })
      }
      return
    }
    if (tool === 'vote') {
      if (voteMode === 'add') {
        if (room.myRemainingVotes > 0) voteM.mutate({ cardId: card.id, dir: 'add' })
      } else if (card.myVotes > 0) {
        voteM.mutate({ cardId: card.id, dir: 'remove' })
      }
      return
    }
    if (tool !== 'cursor') return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const w = vp.toWorld(e.clientX, e.clientY, rect)
    drag.current = {
      cardId: card.id,
      startX: e.clientX,
      startY: e.clientY,
      offX: w.x - card.x,
      offY: w.y - card.y,
      moved: false,
      onClick: () => handleCursorClick(card),
    }
  }
```

**(7.9) onCanvasPointerDown** — substitua por (clique no vazio desseleciona/sai da edição):

```tsx
  function onCanvasPointerDown(e: ReactPointerEvent) {
    if (e.target === containerRef.current || (e.target as HTMLElement).dataset.world === 'true') {
      if (editingCardId) endEdit()
      setSelectedCardId(null)
      setSelectedMine(false)
      panning.current = { x: e.clientX, y: e.clientY }
    }
  }
```

**(7.10) JSX — cursor do canvas:** troque o `style` do `<div ref={containerRef} ...>` por:

```tsx
        style={{ cursor: (tool === 'react' && activeReaction) || tool === 'vote' ? 'crosshair' : 'grab', touchAction: 'none' }}
```

**(7.11) JSX — PostIt:** troque o map de `room.cards` por:

```tsx
          {room.cards.map((card) => (
            <PostIt
              key={card.id}
              card={card}
              readOnly={!canWrite}
              lockedBy={socket.lockOf(card.id)}
              selected={selectedCardId === card.id}
              editing={editingCardId === card.id}
              editingText={editingText}
              onPointerDown={(e) => onCardPointerDown(e, card)}
              onEditChange={setEditingText}
              onEndEdit={endEdit}
            />
          ))}
```

**(7.12) JSX — flyouts:** no bloco da toolbar, adicione o `VoteFlyout` junto dos outros condicionais:

```tsx
            {tool === 'vote' && <VoteFlyout mode={voteMode} onSelect={setVoteMode} remaining={room.myRemainingVotes} />}
```

- [ ] **Step 8: Run the page test + full web build**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx src/pages/retro/PostIt.test.tsx` → PASS.
Run: `pnpm --filter @legends/web build` → type-clean + build ok.

> Se o `tsc` reclamar do ramo eraser (`r.emoji`), confira `RetroReactionSummary.emoji` (é `RetroReactionEmoji`, então não precisa de cast). Se reclamar de `editM`/`deleteM`/`voteM` não usados em algum ponto, confirme que os ramos acima os referenciam.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/retro/PostIt.tsx apps/web/src/pages/retro/PostIt.test.tsx apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(web): post-it limpo + seleção/edição/exclusão (cursor) e carimbo de voto"
```

---

### Task 4: Post-it por clique (armar cor + posicionar no clique)

**Files:**
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Test: `apps/web/src/pages/RetroRoomPage.test.tsx`

**Interfaces:**
- Consumes: `StickyFlyout` (`onPick: (c: RetroCardColor) => void`), `createM`, `viewportRect`, `vp.toWorld`, `POSTIT_WIDTH/HEIGHT`.
- Produces: estado `pendingColor`; selecionar cor arma e fecha o flyout; clique no board cria no ponto e seleciona o card novo.

- [ ] **Step 1: Update the test**

Em `apps/web/src/pages/RetroRoomPage.test.tsx`, adicione o caso de criação por clique (no `describe` existente):

```tsx
  it('Post-it: escolher cor arma e o clique no board cria o card', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /adicionar post-it/i }))
    fireEvent.click(screen.getByRole('button', { name: /Criar post-it green/i }))
    // armado: o flyout fechou e ainda não criou
    expect(screen.queryByRole('button', { name: /Criar post-it green/i })).toBeNull()
    expect(api.createRetroCard).not.toHaveBeenCalled()
    // clica no board (camada do mundo) => cria
    const world = container.querySelector('[data-world="true"]') as HTMLElement
    fireEvent.pointerDown(world, { clientX: 100, clientY: 100 })
    await waitFor(() => expect(api.createRetroCard).toHaveBeenCalled())
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: FAIL — hoje clicar a cor cria direto (não arma) e não fecha o flyout.

- [ ] **Step 3: Add pendingColor state + createAtPoint**

Em `apps/web/src/pages/RetroRoomPage.tsx`:

**(3.1)** Adicione o estado (junto dos demais `useState`):

```tsx
  const [pendingColor, setPendingColor] = useState<RetroCardColor | null>(null)
```

**(3.2)** Em `selectTool`, limpe a cor armada ao trocar de ferramenta — troque a função por:

```tsx
  function selectTool(t: RetroTool) {
    setTool(t)
    if (t !== 'react') setActiveReaction(null)
    if (t !== 'postit') setPendingColor(null)
    if (editingCardId) endEdit()
  }
```

**(3.3)** Faça o `createM` selecionar o card novo — troque o `onSuccess` do `createM` por:

```tsx
    onSuccess: ({ card }) => {
      patch((c) => ({ room: { ...c.room, cards: [...c.room.cards.filter((x) => x.id !== card.id), card] } }))
      setSelectedCardId(card.id)
      setSelectedMine(true)
    },
```

**(3.4)** Troque a função `createAtCenter` por `createAtPoint` (cria no ponto do clique):

```tsx
  function createAtPoint(color: RetroCardColor, clientX: number, clientY: number) {
    const rect = viewportRect()
    const w = vp.toWorld(clientX, clientY, rect)
    createM.mutate({ color, x: w.x - POSTIT_WIDTH / 2, y: w.y - POSTIT_HEIGHT / 2 })
  }
```

- [ ] **Step 4: Wire arming + placement**

**(4.1)** `onCanvasPointerDown` — troque por (cria quando armado; senão pan/deseleciona):

```tsx
  function onCanvasPointerDown(e: ReactPointerEvent) {
    const isWorld = e.target === containerRef.current || (e.target as HTMLElement).dataset.world === 'true'
    if (!isWorld) return
    if (tool === 'postit' && pendingColor) {
      createAtPoint(pendingColor, e.clientX, e.clientY)
      setPendingColor(null)
      setTool('cursor')
      return
    }
    if (editingCardId) endEdit()
    setSelectedCardId(null)
    setSelectedMine(false)
    panning.current = { x: e.clientX, y: e.clientY }
  }
```

**(4.2)** Cursor do canvas — inclua o estado armado; troque o `style` do `<div ref={containerRef} ...>` por:

```tsx
        style={{ cursor: (tool === 'react' && activeReaction) || tool === 'vote' || (tool === 'postit' && pendingColor) ? 'crosshair' : 'grab', touchAction: 'none' }}
```

**(4.3)** Flyout do Post-it — só aparece enquanto não há cor armada; e `onPick` arma. Troque o condicional do `StickyFlyout` por:

```tsx
            {tool === 'postit' && !pendingColor && <StickyFlyout onPick={setPendingColor} disabled={createM.isPending} />}
```

- [ ] **Step 5: Run test + full web build**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx` → PASS.
Run: `pnpm --filter @legends/web build` → type-clean + build ok.

> Se o `tsc` acusar `createAtCenter` removido mas ainda referenciado, garanta que o único uso era o `StickyFlyout` (agora `setPendingColor`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(web): criar post-it por clique no board (armar cor + posicionar)"
```

---

## Self-Review (autor)

**Cobertura do spec:**
- PostIt limpo + selos read-only condicionais → Task 3 (reescrita + testes de selo/chip).
- Estado dos 4 modos → Task 1 (`'vote'`), Task 3 (`tool/selected/editing/voteMode`), Task 4 (`pendingColor`).
- Cursor: 1º clique seleciona, 2º edita; arrasto por limiar; Del exclui (fora da edição); Esc/blur commitam → Task 3 (efeitos, `handleCursorClick`, `endEdit`, `onCardPointerDown`, keydown).
- Post-it: armar cor + criar no clique + voltar pro cursor selecionando o novo → Task 4.
- Reagir: inalterado (selo read-only no card) → Task 3 (display) reusa o carimbo existente.
- Votar: 4ª ferramenta + flyout (+/borracha + restantes) + clique aplica → Task 1/Task 2/Task 3.
- Só frontend, sem API/contrato → confirmado (nada em `apps/api`/`packages/shared`).

**Placeholder scan:** sem TODO/incompletos; todo passo tem código real.

**Type consistency:** `RetroTool` inclui `'vote'` (Task 1) e é o tipo de `tool`/`selectTool` (Task 3); `VoteMode` (Task 2) tipa `voteMode`/`VoteFlyout` (Task 3); `PostIt` novo expõe `onEditChange/onEndEdit/editingText/selected/editing` e a página passa exatamente isso (Task 3 §7.11); `createM.mutate({color,x,y})` casa com `createAtPoint` (Task 4); `voteM.mutate({cardId,dir})`, `reactM.mutate({cardId,emoji})`, `editM.mutate({cardId,text})`, `deleteM.mutate(cardId)` mantêm as assinaturas atuais; `r.emoji` é `RetroReactionEmoji` (sem cast).

**Riscos a validar na execução:**
- Clique vs. arrasto: `socket.grab` só dispara após passar o limiar (não trava em clique simples). Validar em `onMove`.
- Del global: ignora quando há `editingCardId` ou foco em `input/textarea` (não apaga card ao editar texto).
- `endEdit` é função declarada (hoisting) — `selectTool` pode chamá-la antes da definição textual.
- Entre Task 3 e Task 4 a criação fica "no clique da cor → ainda center"? Não: na Task 3 o `StickyFlyout` ainda usa `createAtCenter`; a Task 3 **não** mexe na criação (só remove inline/voto/reação e adiciona cursor/voto). A criação muda só na Task 4. Garantir que o teste de criação obsoleto foi removido na Task 3 (§Step 5b) e o novo entra na Task 4.
- `fireEvent.pointerUp(window)` nos testes exercita o listener global; confirmar que o `pointerDown` no card setou `drag.current` (sem mover) para cair no ramo de clique.
