# Componente Select customizado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os 4 `<select>` nativos do Admin por um componente `Select` reutilizável, com caixa abaixo do campo, busca, navegação por teclado e acessibilidade.

**Architecture:** Um componente controlado `apps/web/src/components/Select.tsx` (genérico: options/value/onChange) que renderiza um botão-gatilho (`role="combobox"`) e uma caixa flutuante (`role="listbox"`) abaixo, com busca opcional e teclado completo. `BadgesSection.tsx` passa a usá-lo nos 4 selects. Os testes que selecionavam via `fireEvent.change` migram para abrir o dropdown e clicar na opção. Front-end apenas, sem mudança de back-end.

**Tech Stack:** React 18 (hooks, `useId`), Tailwind (tokens do tema), vitest + @testing-library/react.

**Estilo de código:** `Select.tsx` é novo em `apps/web/src/components/` — siga o estilo dos vizinhos (`Icon.tsx`, `BadgeEmblem.tsx`: aspas simples, sem ponto-e-vírgula). Ao editar `BadgesSection.tsx`, mantenha o estilo já presente no arquivo (aspas duplas, ponto-e-vírgula — foi reformatado pelo editor).

---

## Mapa de arquivos

- **Create** `apps/web/src/components/Select.tsx` — o componente.
- **Create** `apps/web/src/components/Select.test.tsx` — testes do componente.
- **Modify** `apps/web/src/pages/admin/BadgesSection.tsx` — troca os 4 `<select>`.
- **Modify** `apps/web/src/pages/AdminPage.test.tsx` — migra a interação de seleção (membro/selo).

---

## Task 1: Componente `Select` (TDD)

**Files:**
- Create: `apps/web/src/components/Select.tsx`
- Test: `apps/web/src/components/Select.test.tsx`

- [ ] **Step 1: Escrever os testes que falham**

`apps/web/src/components/Select.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { Select, type SelectOption } from './Select'

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Arthur Pedro' },
  { value: 'b', label: 'Diego Barreto' },
  { value: 'c', label: 'Emerson Marques' },
]

function setup(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  const onChange = vi.fn()
  render(
    <Select options={OPTIONS} value="" onChange={onChange} ariaLabel="Selecionar membro" placeholder="Selecione uma lenda..." searchable {...props} />,
  )
  return { onChange }
}

test('mostra o placeholder e abre/fecha ao clicar', () => {
  setup()
  const trigger = screen.getByRole('combobox', { name: 'Selecionar membro' })
  expect(trigger).toHaveTextContent('Selecione uma lenda...')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
})

test('lista as opções e seleciona ao clicar (onChange + fecha)', () => {
  const { onChange } = setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  expect(screen.getAllByRole('option')).toHaveLength(3)
  fireEvent.click(screen.getByRole('option', { name: 'Diego Barreto' }))
  expect(onChange).toHaveBeenCalledWith('b')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('mostra o label da opção selecionada', () => {
  setup({ value: 'c' })
  expect(screen.getByRole('combobox', { name: 'Selecionar membro' })).toHaveTextContent('Emerson Marques')
})

test('a busca filtra as opções', () => {
  setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  fireEvent.change(screen.getByLabelText('Buscar em Selecionar membro'), { target: { value: 'die' } })
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.getByRole('option', { name: 'Diego Barreto' })).toBeInTheDocument()
})

test('mostra "Nenhum resultado" quando a busca não casa', () => {
  setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  fireEvent.change(screen.getByLabelText('Buscar em Selecionar membro'), { target: { value: 'zzz' } })
  expect(screen.queryAllByRole('option')).toHaveLength(0)
  expect(screen.getByText('Nenhum resultado')).toBeInTheDocument()
})

test('Esc fecha a caixa', () => {
  setup()
  const trigger = screen.getByRole('combobox', { name: 'Selecionar membro' })
  fireEvent.click(trigger)
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('clicar fora fecha a caixa', () => {
  setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('teclado: ArrowDown move o destaque e Enter seleciona', () => {
  const { onChange } = setup()
  const trigger = screen.getByRole('combobox', { name: 'Selecionar membro' })
  fireEvent.click(trigger) // abre; destaque inicia na 1ª opção (índice 0)
  fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // índice 1
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(onChange).toHaveBeenCalledWith('b')
})

test('sem searchable não renderiza o campo de busca', () => {
  setup({ searchable: false })
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  expect(screen.queryByLabelText('Buscar em Selecionar membro')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run:
```bash
cd apps/web && pnpm test src/components/Select.test.tsx
```
Expected: FAIL — `./Select` não existe.

- [ ] **Step 3: Implementar `apps/web/src/components/Select.tsx`**

```tsx
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon'

export type SelectOption = { value: string; label: string }

interface SelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  searchable?: boolean
  disabled?: boolean
  className?: string
}

const triggerCls =
  'flex w-full items-center justify-between gap-sm rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50'

export function Select({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder = 'Selecione…',
  searchable,
  disabled,
  className = '',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const canSearch = searchable ?? options.length > 6
  const selected = options.find((o) => o.value === value) ?? null

  const filtered = useMemo(() => {
    if (!canSearch || !query.trim()) return options
    const q = query.trim().toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query, canSearch])

  // fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // ao abrir: limpa busca, destaca a opção selecionada e foca a busca
  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const idx = options.findIndex((o) => o.value === value)
    setHighlight(idx >= 0 ? idx : 0)
    if (canSearch) searchRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function choose(option: SelectOption) {
    onChange(option.value)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const opt = filtered[highlight]
      if (opt) choose(opt)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const activeId = filtered[highlight] ? `${listId}-opt-${highlight}` : undefined

  return (
    <div ref={wrapperRef} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={open ? activeId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
      >
        <span className={selected ? 'text-on-surface' : 'text-on-surface-variant'}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon
          name="expand_more"
          className={`text-[20px] text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-outline-variant/60 bg-surface-container-high shadow-lg">
          {canSearch && (
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              aria-label={`Buscar em ${ariaLabel}`}
              placeholder="Buscar…"
              className="w-full border-b border-outline-variant/40 bg-transparent px-3 py-2 text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
            />
          )}
          <ul role="listbox" id={listId} className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-body-sm text-on-surface-variant">Nenhum resultado</li>
            ) : (
              filtered.map((option, index) => {
                const isSelected = option.value === value
                const isHighlighted = index === highlight
                return (
                  <li
                    key={option.value}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(option)}
                    ref={
                      isHighlighted
                        ? (el) => {
                            el?.scrollIntoView?.({ block: 'nearest' })
                          }
                        : undefined
                    }
                    className={`flex cursor-pointer items-center gap-sm px-3 py-2 text-body-sm ${
                      isHighlighted ? 'bg-primary/10 text-primary' : 'text-on-surface'
                    }`}
                  >
                    <Icon name="check" className={`text-[16px] ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                    {option.label}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
```

> Notas: `el?.scrollIntoView?.({ block: 'nearest' })` usa optional chaining porque o jsdom não implementa `scrollIntoView` (evita erro nos testes). O `onKeyDown` no wrapper captura as teclas vindas do gatilho e do input de busca (bubbling); o `preventDefault` no `Enter` impede submit acidental do `<form>` que envolve alguns selects.

- [ ] **Step 4: Rodar e confirmar que passa**

Run:
```bash
cd apps/web && pnpm test src/components/Select.test.tsx
```
Expected: PASS (9 testes).

- [ ] **Step 5: Typecheck**

Run:
```bash
cd apps/web && pnpm exec tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/components/Select.tsx apps/web/src/components/Select.test.tsx
git commit -m "feat(web): componente Select customizado com busca e teclado"
```

---

## Task 2: Integrar o `Select` no BadgesSection + migrar os testes

**Files:**
- Modify: `apps/web/src/pages/admin/BadgesSection.tsx`
- Modify: `apps/web/src/pages/AdminPage.test.tsx`

> Mantenha o estilo do `BadgesSection.tsx` atual (aspas duplas, ponto-e-vírgula).

- [ ] **Step 1: Importar o `Select`**

No topo de `apps/web/src/pages/admin/BadgesSection.tsx`, adicione:
```tsx
import { Select } from "../../components/Select";
```

- [ ] **Step 2: Trocar o select de MEMBRO**

Substitua o `<select aria-label="Selecionar membro" …>…</select>` (o que tem as `<option>` de membros) por:
```tsx
<Select
  ariaLabel="Selecionar membro"
  placeholder="Selecione uma lenda..."
  className="mb-lg"
  value={memberId}
  options={members.map((member) => ({ value: member.id, label: member.name }))}
  onChange={(next) => {
    setMemberId(next);
    setBadgeId("");
    setError(null);
  }}
/>
```

- [ ] **Step 3: Trocar o select de SELO**

Substitua o `<select aria-label="Selecionar selo" …>…</select>` por:
```tsx
<Select
  ariaLabel="Selecionar selo"
  placeholder="Selecione um selo…"
  className="sm:flex-1"
  value={badgeId}
  options={badges.map((badge) => ({ value: badge.id, label: badge.name }))}
  onChange={(next) => setBadgeId(next)}
/>
```

- [ ] **Step 4: Trocar o select de TIPO DO SELO**

Substitua o `<select … aria-label="Tipo do selo">…</select>` por:
```tsx
<Select
  ariaLabel="Tipo do selo"
  value={badgeForm.kind}
  options={BADGE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
  onChange={(next) =>
    setBadgeForm({ ...badgeForm, kind: next as BadgeKind })
  }
/>
```
> `BADGE_KINDS` tem 3 itens, então a busca não aparece (auto: `length > 6`). O `kind` sempre tem valor, então não precisa de placeholder.

- [ ] **Step 5: Trocar o select de CATEGORIA**

Substitua o `<select … aria-label="Categoria do selo">…</select>` (dentro do `badgeForm.kind === "CATEGORY" && (...)`) por:
```tsx
<Select
  ariaLabel="Categoria do selo"
  placeholder="Selecione a categoria…"
  className="sm:col-span-2"
  value={badgeForm.categorySlug}
  options={categories.map((c) => ({ value: c.slug, label: c.name }))}
  onChange={(next) =>
    setBadgeForm({ ...badgeForm, categorySlug: next })
  }
/>
```

- [ ] **Step 6: Typecheck + rodar os testes (devem QUEBRAR nos de membro/selo)**

Run:
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test src/pages/AdminPage.test.tsx
```
Expected: typecheck limpo; alguns testes do AdminPage FALHAM — os que usavam `fireEvent.change` no select de membro/selo (agora não há mais `<select>`). Isso é esperado e corrigido no próximo passo. (Se algum teste de outra seção quebrar, NÃO é esperado — investigue.)

- [ ] **Step 7: Migrar os testes de seleção em `AdminPage.test.tsx`**

Leia o arquivo e localize os 3 testes que selecionam membro/selo. Onde antes havia algo como
`fireEvent.change(screen.getByLabelText('Selecionar membro'), { target: { value: 'u9' } })`,
troque pela interação de abrir + clicar na opção. Helper opcional no topo do arquivo (após os imports):
```tsx
async function pickOption(comboboxName: string, optionName: string) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}
```
Aplicar:
- **'lista os selos de um membro selecionado …'**: após `goToTab('Selos')`, `await pickOption('Selecionar membro', 'Diego Reis')` (o mock de `/admin/users` retorna o membro `u9` = "Diego Reis"). Mantenha a asserção de que o selo concedido aparece (ex.: `findByLabelText('Revogar selo Conector do Time')`).
- **'concede um selo ao membro selecionado (POST)'**: `await pickOption('Selecionar membro', 'Diego Reis')`, depois `await pickOption('Selecionar selo', 'Conector do Time')` (o mock de `/badges` retorna `b1` = "Conector do Time"), depois `fireEvent.click(screen.getByRole('button', { name: 'Conceder' }))`. Mantenha a asserção do POST para `/admin/users/u9/badges` com `body: JSON.stringify({ badgeId: 'b1' })`.
- **'revoga um selo manual do membro (DELETE)'**: `await pickOption('Selecionar membro', 'Diego Reis')`, depois clique no botão `findByLabelText('Revogar selo Conector do Time')`. Mantenha a asserção do DELETE para `/admin/users/u9/badges/ub1`.

> O mock atual (no `setupFetch`) já cobre `/admin/users`, `/badges`, `/admin/users/u9/badges` (GET/POST/DELETE). Como cada um retorna 1 item, a busca do `Select` não aparece (auto: `length > 6`), então basta abrir e clicar na opção. NÃO altere asserções de POST/DELETE — só a forma de selecionar.

- [ ] **Step 8: Rodar a suíte web completa**

Run:
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test
```
Expected: tudo verde (Select + AdminPage migrado + demais).

- [ ] **Step 9: Commit**
```bash
git add apps/web/src/pages/admin/BadgesSection.tsx apps/web/src/pages/AdminPage.test.tsx
git commit -m "feat(web): usa Select customizado nos campos do Admin"
```

---

## Verificação final

- [ ] **Suíte web + typecheck**
```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm test
```
Expected: verde. (API intocada.)

- [ ] **Verificação manual (dev servers em :3333/:5173)** — abrir Admin → "Atribuir selo manualmente": clicar no campo "Selecione uma lenda..." abre a caixa abaixo, com busca; digitar filtra; clicar/Enter seleciona; Esc/clicar fora fecham. Conferir também os selects de selo, tipo de selo e categoria (aba Selos → "+ Adicionar selo").
