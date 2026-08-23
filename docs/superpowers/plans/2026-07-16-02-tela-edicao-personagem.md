# Tela de edição de personagem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o modal `AvatarPicker` por uma tela dedicada `/personagem` com preview grande animado e guarda-roupa em duas colunas.

**Architecture:** O miolo do editor sai do modal em três componentes controlados (`WardrobePanel`, `PreviewPane`, `PresetsRow`) sob `components/character-editor/`, junto com os helpers já existentes (`catalogView.ts`, `LayerThumb.tsx`, movidos sem mudança de lógica). Uma página nova (`CharacterEditorPage`) é a única dona do estado (`options`, dirty, save) e registra a rota `/personagem` dentro do grupo `AppLayout`. O modal é deletado no final. Nenhuma mudança em `@legends/shared`, API ou contrato.

**Tech Stack:** React 18 + react-router-dom 6 (`BrowserRouter` clássico — sem `useBlocker`), TanStack Query, Tailwind, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-16-tela-edicao-personagem-design.md` — leia antes.

## Global Constraints

- Branch: `feat/tela-edicao-personagem` (worktree `.claude/worktrees/avatar-creation-customization-419891`).
- Node ≥ 20 (`source ~/.nvm/nvm.sh && nvm use 20` — shell default é 18).
- Mensagens de UI em pt-BR; labels de item do catálogo ficam em inglês.
- Rota nova: **`/personagem`**, protegida, DENTRO do grupo `AppLayout` (herda menu).
- Guard de saída: cobre Cancelar/botões da tela via `window.confirm('Descartar alterações?')` + `beforeunload` quando dirty. Navegação global (menu) NÃO é interceptada — limitação aceita do spec.
- Dirty = `characterSignature(options) !== characterSignature(initial)`.
- Save: PATCH `/auth/me` com `{avatarStyle:'lpc', avatarSeed: user?.avatarSeed ?? randomSeed(), avatarOptions: options}` → `setUser` + `invalidateQueries(['profile'])` + `navigate('/perfil/'+user.id)`.
- Zero mudança em `@legends/shared`, `apps/api`, catálogo ou assets.
- Cada task termina com a suite web verde: `pnpm --filter @legends/web test`.
- Testes da API não são afetados; não precisa de Postgres neste plano.

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `apps/web/src/components/avatar-picker/*` | mover (git mv) → `components/character-editor/` |
| `apps/web/src/components/character-editor/WardrobePanel.tsx` (+test) | criar — miolo do editor, controlado |
| `apps/web/src/components/character-editor/PresetsRow.tsx` | criar — 6 prontos + Embaralhar |
| `apps/web/src/components/character-editor/PreviewPane.tsx` (+test) | criar — preview grande + ações |
| `apps/web/src/pages/CharacterEditorPage.tsx` (+test) | criar — estado, save, guard, layout |
| `apps/web/src/App.tsx` | rota `/personagem` |
| `apps/web/src/pages/ProfilePage.tsx` (+test) | botão navega; modal sai |
| `apps/web/src/components/AvatarPicker.tsx` (+test) | deletar (Task 5) |

---

### Task 1: Mover avatar-picker → character-editor

**Files:**
- Move: `apps/web/src/components/avatar-picker/` → `apps/web/src/components/character-editor/` (catalogView.ts, catalogView.test.ts, LayerThumb.tsx)
- Modify: `apps/web/src/components/AvatarPicker.tsx:20-21` (imports)

**Interfaces:**
- Produces: mesmos exports em path novo — `./character-editor/catalogView` (`searchItems`, `setItem`, `applyBodyType`, `randomCharacter`), `./character-editor/LayerThumb` (`LayerThumb`, `thumbLayerFolders`).

- [ ] **Step 1: Mover com git mv**

```bash
cd .claude/worktrees/avatar-creation-customization-419891
git mv apps/web/src/components/avatar-picker apps/web/src/components/character-editor
```

- [ ] **Step 2: Atualizar imports do AvatarPicker**

Em `apps/web/src/components/AvatarPicker.tsx`, trocar:

```ts
import { LayerThumb } from './character-editor/LayerThumb'
import { applyBodyType, randomCharacter, searchItems, setItem } from './character-editor/catalogView'
```

Conferir se mais alguém importa o path antigo: `grep -rn "avatar-picker" apps/web/src` — deve retornar vazio após o ajuste.

- [ ] **Step 3: Suite web**

Run: `pnpm --filter @legends/web test`
Expected: PASS completo (nenhum comportamento mudou).

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src/components
git commit -m "refactor(web): move helpers do editor de personagem para character-editor/"
```

---

### Task 2: Extrair WardrobePanel (controlado) do AvatarPicker

**Files:**
- Create: `apps/web/src/components/character-editor/WardrobePanel.tsx`
- Test: `apps/web/src/components/character-editor/WardrobePanel.test.tsx`
- Modify: `apps/web/src/components/AvatarPicker.tsx` (modo custom passa a renderizar `<WardrobePanel/>`)

**Interfaces:**
- Consumes: `catalogView` e `LayerThumb` (Task 1); `CATEGORY_GROUPS`, `categoryLabel`, `itemsForCategory`, `CATALOG_BY_ID`, `BODY_TYPES`, `BODY_TYPE_LABELS` de `@legends/shared`.
- Produces: `WardrobePanel({ options, onChange }: { options: CharacterOptions; onChange: (next: CharacterOptions) => void })` — estado de UI (grupo/categoria/busca) vive DENTRO do painel; as options vivem no pai.

- [ ] **Step 1: Escrever o teste**

Criar `WardrobePanel.test.tsx` — migração dos casos do `AvatarPicker.test.tsx` que exercitam o miolo (leia o teste atual e reaproveite a infra de mocks de `lib/character` e `LayerThumb`; a diferença é que o host agora é controlado):

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CATALOG_BY_ID, defaultCharacterFromSeed, type CharacterOptions } from '@legends/shared'
import { WardrobePanel } from './WardrobePanel'

vi.mock('./LayerThumb', () => ({
  LayerThumb: () => <div data-testid="thumb" />,
}))

function renderPanel(initial?: CharacterOptions) {
  const options = initial ?? defaultCharacterFromSeed('teste')
  const onChange = vi.fn()
  render(<WardrobePanel options={options} onChange={onChange} />)
  return { options, onChange }
}

describe('WardrobePanel', () => {
  it('mostra grupos, categorias e a grade da categoria ativa', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Equipamento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fantasia' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Corpo', pressed: true })).toBeInTheDocument()
  })

  it('busca filtra a grade de itens', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cabelo' }))
    fireEvent.change(screen.getByLabelText('Buscar item…'), { target: { value: 'afro' } })
    expect(await screen.findByRole('button', { name: /Afro/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Curly/ })).not.toBeInTheDocument()
  })

  it('clicar num item chama onChange com o item aplicado', () => {
    const { onChange } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: /^Afro$/ }))
    const next = onChange.mock.lastCall?.[0] as CharacterOptions
    expect(next.items.hair?.item).toBe('hair_afro')
  })

  it('trocar o corpo dropa itens incompatíveis e realoca categoria stale', () => {
    const base = defaultCharacterFromSeed('teste')
    const withBeard = {
      ...base,
      bodyType: 'male' as const,
      items: { ...base.items, beard: { item: 'beards_beard', variant: 'black' } },
    }
    const onChange = vi.fn()
    render(<WardrobePanel options={withBeard} onChange={onChange} />)
    // seleciona a categoria beard, depois troca para um corpo sem barba
    fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Barba' }))
    fireEvent.click(screen.getByRole('button', { name: 'Criança' }))
    const next = onChange.mock.lastCall?.[0] as CharacterOptions
    expect(next.bodyType).toBe('child')
    expect(next.items.beard).toBeUndefined()
    // categoria ativa realocada: alguma categoria com itens fica pressed
    expect(screen.queryByRole('button', { name: 'Barba' })).not.toBeInTheDocument()
  })

  it('variantes do item selecionado chamam onChange com a variante', () => {
    const base = defaultCharacterFromSeed('teste')
    const withHair = { ...base, items: { ...base.items, hair: { item: 'hair_afro', variant: 'blonde' } } }
    const onChange = vi.fn()
    render(<WardrobePanel options={withHair} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'variante ash' }))
    const next = onChange.mock.lastCall?.[0] as CharacterOptions
    expect(next.items.hair).toEqual({ item: 'hair_afro', variant: 'ash' })
  })
})
```

Nota: nomes de labels ("Barba", "Criança", "Curly") vêm de `CATEGORY_LABELS`/`BODY_TYPE_LABELS`/catálogo — se algum não bater com a realidade (ex.: label real do item de cabelo), consulte `packages/shared/src/lpc-catalog.json` e ajuste O TESTE.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- WardrobePanel`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `WardrobePanel.tsx`**

Extração literal do modo custom do `AvatarPicker.tsx` atual (leia-o; blocos numerados 1–6 e as funções `selectGroup`/`changeBodyType`/`pickItem`/`chipClass`), com esta assinatura e estado:

```tsx
import { useMemo, useState } from 'react'
import {
  BODY_TYPES,
  BODY_TYPE_LABELS,
  CATALOG_BY_ID,
  CATEGORY_GROUPS,
  categoryLabel,
  itemsForCategory,
  type BodyType,
  type CharacterOptions,
} from '@legends/shared'
import { LayerThumb } from './LayerThumb'
import { applyBodyType, searchItems, setItem } from './catalogView'

/** Classe compartilhada dos botões-chip (corpo, abas de grupo, categorias). */
function chipClass(active: boolean): string {
  return `rounded-md border px-md py-xs font-label text-label-sm transition-colors ${
    active
      ? 'border-primary bg-primary text-on-primary'
      : 'border-outline-variant/50 bg-surface-container-high text-on-surface'
  }`
}

/**
 * Guarda-roupa controlado: corpo, grupos, categorias, busca, grade e
 * variantes. As options vivem no pai (página); grupo/categoria/busca são
 * estado de UI local.
 */
export function WardrobePanel({
  options,
  onChange,
}: {
  options: CharacterOptions
  onChange: (next: CharacterOptions) => void
}) {
  const [group, setGroup] = useState(CATEGORY_GROUPS[0].key)
  const [category, setCategory] = useState<string>('body')
  const [query, setQuery] = useState('')
  // ... (copiar de AvatarPicker: activeGroup, availableItems, selected,
  //      selectedEntry, selectGroup, changeBodyType, pickItem — trocando
  //      setOptions(x) por onChange(x))
  // JSX: blocos 1–6 do AvatarPicker (corpos, grupos, chips, busca, grade
  // com "Nenhum", variantes) idênticos, sem preview/Aleatório/save/rodapé.
}
```

O comentário acima delimita a extração — o código já existe no AvatarPicker; mover, não reescrever. `changeBodyType` e `pickItem` mantêm a lógica atual (realocação de categoria stale; `applyBodyType` no body).

- [ ] **Step 4: AvatarPicker usa o painel**

No `AvatarPicker.tsx`, o branch `mode === 'custom'` vira:

```tsx
<div className="mb-lg flex flex-col gap-lg">
  <CharacterPreview options={options} />
  <WardrobePanel options={options} onChange={setOptions} />
  <div className="flex">
    <button type="button" onClick={() => setOptions(randomCharacter())} className="...">
      <Icon name="shuffle" className="text-[18px]" />
      Aleatório
    </button>
  </div>
  <CreditsLink />
</div>
```

Remover do AvatarPicker o estado/funções que migraram (group/category/query, selectGroup, changeBodyType, pickItem, chipClass, imports órfãos). O `AvatarPicker.test.tsx` atual deve continuar passando (mesmos roles/labels renderizados); se algum caso duplicar o que o `WardrobePanel.test.tsx` agora cobre, DELETE o duplicado do teste do AvatarPicker e registre no report.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/web test`
Expected: PASS completo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components
git commit -m "refactor(web): extrai WardrobePanel controlado do AvatarPicker"
```

---

### Task 3: PresetsRow e PreviewPane

**Files:**
- Create: `apps/web/src/components/character-editor/PresetsRow.tsx`
- Create: `apps/web/src/components/character-editor/PreviewPane.tsx`
- Test: `apps/web/src/components/character-editor/PreviewPane.test.tsx`

**Interfaces:**
- Consumes: `randomCharacter` (catalogView), `useCharacterPortrait`, `CharacterPreview` (prop `size` já existe, default 160), `Icon`.
- Produces:
  - `PresetsRow({ onPick }: { onPick: (options: CharacterOptions) => void })` — 6 retratos sorteados + botão "Embaralhar".
  - `PreviewPane({ options, onRandom, onPick }: { options: CharacterOptions; onRandom: () => void; onPick: (options: CharacterOptions) => void })` — preview `size={224}` + label do corpo + Aleatório + PresetsRow + créditos.

- [ ] **Step 1: Escrever o teste**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultCharacterFromSeed, isCharacterOptions } from '@legends/shared'
import { PreviewPane } from './PreviewPane'

vi.mock('../CharacterPreview', () => ({
  CharacterPreview: ({ size }: { size?: number }) => <div data-testid="preview" data-size={size} />,
}))
vi.mock('../../hooks/useCharacterPortrait', () => ({
  useCharacterPortrait: () => 'data:image/png;base64,x',
}))

describe('PreviewPane', () => {
  it('renderiza preview grande, Aleatório e 6 prontos', () => {
    render(<PreviewPane options={defaultCharacterFromSeed('a')} onRandom={vi.fn()} onPick={vi.fn()} />)
    expect(screen.getByTestId('preview').dataset.size).toBe('224')
    expect(screen.getByRole('button', { name: 'Aleatório' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Usar personagem pronto/ })).toHaveLength(6)
    expect(screen.getByRole('link', { name: /créditos/ })).toBeInTheDocument()
  })

  it('clicar num pronto chama onPick com options válidas; Embaralhar troca a fileira', () => {
    const onPick = vi.fn()
    render(<PreviewPane options={defaultCharacterFromSeed('a')} onRandom={vi.fn()} onPick={onPick} />)
    fireEvent.click(screen.getAllByRole('button', { name: /Usar personagem pronto/ })[0])
    expect(isCharacterOptions(onPick.mock.lastCall?.[0])).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Embaralhar' }))
    expect(screen.getAllByRole('button', { name: /Usar personagem pronto/ })).toHaveLength(6)
  })

  it('Aleatório chama onRandom', () => {
    const onRandom = vi.fn()
    render(<PreviewPane options={defaultCharacterFromSeed('a')} onRandom={onRandom} onPick={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Aleatório' }))
    expect(onRandom).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- PreviewPane`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar**

`PresetsRow.tsx` (o `PortraitImg` migra do AvatarPicker para cá):

```tsx
import { useState } from 'react'
import type { CharacterOptions } from '@legends/shared'
import { useCharacterPortrait } from '../../hooks/useCharacterPortrait'
import { Icon } from '../Icon'
import { randomCharacter } from './catalogView'

function PortraitImg({ options }: { options: CharacterOptions }) {
  const uri = useCharacterPortrait({ name: 'preview', avatarStyle: 'lpc', avatarOptions: options })
  if (!uri) return <div className="h-full w-full animate-pulse bg-surface-container-highest" />
  return <img src={uri} alt="" className="h-full w-full object-cover" />
}

/** Atalho "Prontos": 6 personagens sorteados; clicar carrega no editor. */
export function PresetsRow({ onPick }: { onPick: (options: CharacterOptions) => void }) {
  const [sets, setSets] = useState<CharacterOptions[]>(() => Array.from({ length: 6 }, randomCharacter))
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center justify-between">
        <span className="font-label text-label-md text-on-surface">Prontos</span>
        <button
          type="button"
          onClick={() => setSets(Array.from({ length: 6 }, randomCharacter))}
          className="inline-flex items-center gap-xs rounded-md border border-outline-variant/50 px-sm py-xs font-label text-label-sm text-on-surface transition-colors hover:border-primary"
        >
          <Icon name="shuffle" className="text-[16px]" />
          Embaralhar
        </button>
      </div>
      <div className="grid grid-cols-6 gap-sm">
        {sets.map((set, idx) => (
          <button
            key={idx}
            type="button"
            aria-label={`Usar personagem pronto ${idx + 1}`}
            onClick={() => onPick(set)}
            className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border-2 border-transparent bg-surface-container-highest transition-all hover:border-primary"
          >
            <PortraitImg options={set} />
          </button>
        ))}
      </div>
    </div>
  )
}
```

`PreviewPane.tsx`:

```tsx
import { BODY_TYPE_LABELS, type CharacterOptions } from '@legends/shared'
import { CharacterPreview } from '../CharacterPreview'
import { Icon } from '../Icon'
import { PresetsRow } from './PresetsRow'

/** Coluna do preview: personagem grande animado + Aleatório + Prontos + créditos. */
export function PreviewPane({
  options,
  onRandom,
  onPick,
}: {
  options: CharacterOptions
  onRandom: () => void
  onPick: (options: CharacterOptions) => void
}) {
  return (
    <div className="flex flex-col items-center gap-lg">
      <CharacterPreview options={options} size={224} />
      <span className="font-label text-label-md text-on-surface-variant">
        {BODY_TYPE_LABELS[options.bodyType]}
      </span>
      <button
        type="button"
        onClick={onRandom}
        className="inline-flex items-center gap-sm rounded-md border border-outline-variant/50 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary"
      >
        <Icon name="shuffle" className="text-[18px]" />
        Aleatório
      </button>
      <div className="w-full">
        <PresetsRow onPick={onPick} />
      </div>
      <a
        href="/lpc/CREDITS.txt"
        target="_blank"
        rel="noreferrer"
        className="font-label text-label-sm text-on-surface-variant underline hover:text-primary"
      >
        Arte: Liberated Pixel Cup — créditos
      </a>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web test -- PreviewPane`
Expected: PASS. Rodar também a suite completa do web: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/character-editor
git commit -m "feat(web): PreviewPane e PresetsRow do editor de personagem"
```

---

### Task 4: CharacterEditorPage + rota /personagem

**Files:**
- Create: `apps/web/src/pages/CharacterEditorPage.tsx`
- Test: `apps/web/src/pages/CharacterEditorPage.test.tsx`
- Modify: `apps/web/src/App.tsx` (rota no grupo `AppLayout`, junto a `/perfil/:id`)

**Interfaces:**
- Consumes: `WardrobePanel` (Task 2), `PreviewPane` (Task 3), `randomCharacter` (catalogView), `resolveCharacterOptions`, `characterSignature`, `defaultCharacterFromSeed`, `apiFetch`/`ApiError`, `useAuth`, `useNavigate`, `useQueryClient`.
- Produces: rota `/personagem` renderizando a página; export `CharacterEditorPage`.

- [ ] **Step 1: Escrever o teste**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultCharacterFromSeed } from '@legends/shared'
import { CharacterEditorPage } from './CharacterEditorPage'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))
const apiFetch = vi.fn()
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}))
const setUser = vi.fn()
const user = { id: 'u1', name: 'Erika', avatarStyle: 'lpc', avatarSeed: 'erika', avatarOptions: defaultCharacterFromSeed('erika') }
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user, setUser }) }))
vi.mock('../components/character-editor/LayerThumb', () => ({ LayerThumb: () => <div /> }))
vi.mock('../components/CharacterPreview', () => ({ CharacterPreview: () => <div data-testid="preview" /> }))
vi.mock('../hooks/useCharacterPortrait', async (orig) => ({
  ...(await orig()),
  useCharacterPortrait: () => 'data:image/png;base64,x',
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/personagem']}>
      <Routes>
        <Route path="/personagem" element={<CharacterEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('CharacterEditorPage', () => {
  it('renderiza preview e guarda-roupa', () => {
    renderPage()
    expect(screen.getByTestId('preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })

  it('sem mudanças, Cancelar navega direto sem confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/perfil/u1')
  })

  it('com mudanças, Cancelar pede confirmação e só navega no ok', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Aleatório' })) // marca dirty
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(confirmSpy).toHaveBeenCalledWith('Descartar alterações?')
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(navigate).toHaveBeenCalledWith('/perfil/u1')
  })

  it('salvar faz PATCH v2, atualiza o usuário e navega ao perfil', async () => {
    apiFetch.mockResolvedValueOnce({ user: { ...user, name: 'Erika!' } })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/perfil/u1'))
    const [path, init] = apiFetch.mock.calls[0]
    expect(path).toBe('/auth/me')
    const body = JSON.parse((init as { body: string }).body)
    expect(body.avatarStyle).toBe('lpc')
    expect(body.avatarOptions.items.body).toBeTruthy()
    expect(setUser).toHaveBeenCalled()
  })

  it('após salvar, sair não pede confirmação (dirty resetado pela navegação)', async () => {
    apiFetch.mockResolvedValueOnce({ user })
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Aleatório' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
```

Nota: a página usa `useQueryClient` — envolva o render com `QueryClientProvider` (crie um `QueryClient` de teste) se o hook reclamar; siga o padrão dos outros testes de página do repo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- CharacterEditorPage`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar a página**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  characterSignature,
  defaultCharacterFromSeed,
  type CharacterOptions,
  type PublicUser,
} from '@legends/shared'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { resolveCharacterOptions } from '../hooks/useCharacterPortrait'
import { PreviewPane } from '../components/character-editor/PreviewPane'
import { WardrobePanel } from '../components/character-editor/WardrobePanel'
import { randomCharacter } from '../components/character-editor/catalogView'

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Tela de edição de personagem (substitui o antigo modal AvatarPicker). */
export function CharacterEditorPage() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const initial = useMemo(
    () => (user ? resolveCharacterOptions(user) : null) ?? defaultCharacterFromSeed(user?.avatarSeed ?? 'preview'),
    [user],
  )
  const [options, setOptions] = useState<CharacterOptions>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = characterSignature(options) !== characterSignature(initial)
  const profilePath = `/perfil/${user?.id ?? ''}`

  // Fechar/recarregar a aba com edição pendente: aviso nativo do navegador.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function leave() {
    if (dirty && !window.confirm('Descartar alterações?')) return
    navigate(profilePath)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch<{ user: PublicUser }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          avatarStyle: 'lpc' as const,
          avatarSeed: user?.avatarSeed ?? randomSeed(),
          avatarOptions: options,
        }),
      })
      setUser(res.user)
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      navigate(profilePath)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-lg p-lg">
      <h2 className="font-headline text-headline-md text-on-surface">Editar personagem</h2>
      <div className="flex flex-col gap-lg lg:grid lg:grid-cols-[320px,1fr] lg:items-start">
        {/* Coluna do preview: sticky no desktop e no mobile (compacta no topo). */}
        <div className="sticky top-0 z-10 -mx-lg bg-surface px-lg py-sm lg:top-lg lg:z-auto lg:m-0 lg:rounded-xl lg:border lg:border-outline-variant/40 lg:bg-surface-container lg:p-lg">
          <PreviewPane
            options={options}
            onRandom={() => setOptions(randomCharacter())}
            onPick={(preset) => setOptions(preset)}
          />
          {error && <p className="mt-md font-label text-label-sm text-error">{error}</p>}
          <div className="mt-lg flex justify-end gap-sm">
            <button
              type="button"
              onClick={leave}
              className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
          <WardrobePanel options={options} onChange={setOptions} />
        </div>
      </div>
    </div>
  )
}
```

Ajuste fino permitido no JSX/classes para bater com o visual do app (mesmo vocabulário Tailwind das páginas vizinhas) — o CONTRATO (sticky, duas colunas ≥lg, Salvar/Cancelar na coluna do preview, erro visível) é fixo.

- [ ] **Step 4: Registrar a rota**

Em `apps/web/src/App.tsx`, dentro do grupo `AppLayout` (junto a `/perfil/:id`):

```tsx
<Route path="/personagem" element={<CharacterEditorPage />} />
```

(+ import `CharacterEditorPage` no topo, seguindo o estilo dos demais.)

Depois, adicionar um caso ao teste de rotas do App (leia `apps/web/src/App.routing.test.tsx` — ou o arquivo equivalente que testa navegação de rotas — e siga o padrão existente): usuário autenticado navegando para `/personagem` renderiza a tela (assert num elemento estável da página, ex. heading "Editar personagem"). Se o padrão do arquivo exigir mocks pesados do editor, mocke `LayerThumb`/`CharacterPreview` como nos outros testes.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/web test`
Expected: PASS completo (página nova + suites existentes).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/CharacterEditorPage.tsx apps/web/src/pages/CharacterEditorPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): tela /personagem com preview grande e guarda-roupa em duas colunas"
```

---

### Task 5: ProfilePage navega + deletar o modal

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx` (botão ~193 navega; estado `pickerOpen` e render ~580 saem; import do AvatarPicker sai)
- Delete: `apps/web/src/components/AvatarPicker.tsx`, `apps/web/src/components/AvatarPicker.test.tsx`
- Modify: `apps/web/src/pages/ProfilePage.test.tsx` (casos do modal viram navegação)

**Interfaces:**
- Consumes: rota `/personagem` (Task 4).

- [ ] **Step 1: Atualizar o teste do ProfilePage**

Localizar os casos que clicam em "Editar avatar" e esperam o dialog; trocar por expectativa de navegação. O ProfilePage é renderizado com `MemoryRouter` nos testes — adicionar uma rota sentinela:

```tsx
// no render de teste:
<MemoryRouter initialEntries={[`/perfil/${ownUserId}`]}>
  <Routes>
    <Route path="/perfil/:id" element={<ProfilePage />} />
    <Route path="/personagem" element={<div data-testid="editor-page" />} />
  </Routes>
</MemoryRouter>

// caso:
it('botão Editar avatar navega para a tela de personagem', async () => {
  // render do perfil próprio…
  fireEvent.click(await screen.findByRole('button', { name: 'Editar avatar' }))
  expect(screen.getByTestId('editor-page')).toBeInTheDocument()
})
```

(Adaptar à infra real do `ProfilePage.test.tsx` — leia-o primeiro; se o botão virar `Link`, o role muda para `link`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web test -- ProfilePage`
Expected: FAIL — botão ainda abre modal.

- [ ] **Step 3: Trocar botão por navegação e remover o modal**

Em `ProfilePage.tsx`: o botão "Editar avatar" (linha ~193) troca `onClick={() => setPickerOpen(true)}` por `onClick={() => navigate('/personagem')}` (a página já usa `useNavigate`? se não, importar). Remover: `const [pickerOpen, setPickerOpen] = useState(false)`, o render `{pickerOpen && <AvatarPicker …/>}` (~580) e o import.

```bash
git rm apps/web/src/components/AvatarPicker.tsx apps/web/src/components/AvatarPicker.test.tsx
```

Conferir consumidores restantes: `grep -rn "AvatarPicker" apps/web/src` → vazio.

- [ ] **Step 4: Suite completa do web + build**

Run: `pnpm --filter @legends/web test && pnpm --filter @legends/web run build`
Expected: testes PASS; build/typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): perfil navega para /personagem; modal AvatarPicker removido"
```

---

### Task 6: Verificação no browser

**Files:** nenhum novo (ajustes pontuais se algo falhar).

- [ ] **Step 1: Suite completa do monorepo**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && pnpm test`
Expected: shared + web + api verdes (Postgres: container legends-db).

- [ ] **Step 2: Subir e verificar (skill `verify` do projeto)**

Checklist manual (tools de Browser):
1. Login; perfil próprio → clicar "Editar avatar" → cai em `/personagem` com layout de duas colunas (desktop 1280px).
2. Preview grande animado; "Girar" muda a direção; trocar cabelo/roupa atualiza o preview.
3. Clicar num "Pronto" carrega o personagem; "Embaralhar" troca a fileira.
4. Cancelar com mudanças → confirm aparece; cancelar permanece; confirmar volta ao perfil.
5. Salvar → volta ao perfil com retrato atualizado (PATCH 200 na aba Network).
6. `resize_window` para mobile (375px): preview compacto sticky no topo, guarda-roupa abaixo, Salvar acessível.
7. Console sem erros novos durante o fluxo.

- [ ] **Step 3: Ajustes + commit final (se houver)**

```bash
git add -A apps/web/src && git commit -m "fix(web): ajustes da verificação manual da tela de personagem"
```
