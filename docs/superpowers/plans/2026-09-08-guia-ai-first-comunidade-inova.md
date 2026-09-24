# Guia AI First dentro da Comunidade INOVA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar o submódulo "Bússola AI First" (`src/guia/` no `codigo-fonte-inova-emr.zip`) como uma aba nova ("Guia") dentro do board da Comunidade INOVA, com 11 seções de conteúdo, reescrito nos tokens visuais do Legends.

**Architecture:** Conteúdo estático (catálogos TS portados quase como estão) + páginas React novas em `apps/web/src/pages/inova/guia/`, penduradas como rotas filhas de `/comunidade-inova` já existente. Sem mudança de backend/Prisma — tudo client-side, com favoritos e progresso do quiz de maturidade em `localStorage`.

**Tech Stack:** React 18 + React Router 6 (rotas aninhadas), Tailwind (tokens do Legends: `surface-*`, `on-surface*`, `primary`, `outline-variant`), Vitest + Testing Library, `@legends/shared` para o catálogo de eventos.

**Spec:** `docs/superpowers/specs/2026-09-08-guia-ai-first-comunidade-inova-design.md`

## Global Constraints

- Fonte do conteúdo original: `~/Downloads/codigo-fonte-inova-emr.zip` (arquivo local do usuário) — todo comando `unzip -p` deste plano lê dessa ZIP.
- `apps/web` não usa `lucide-react` nem um alias `@/`; usa o componente `Icon` (Material Symbols Outlined) e imports relativos. Nenhuma dependência nova entra no `package.json` — os ícones do original viram nomes de Material Symbols equivalentes.
- Não existe `cn`/`clsx` no repo; um helper local `cx` pequeno é criado dentro de `pages/inova/guia/lib/`, escopado ao módulo.
- Visual: sem CSS próprio novo (nada de `guia.css`), sem seções "hero escuras" (`surface-dark`) — cabeçalho de página simples (`<header><h1/><p/></header>`), mesmo padrão de `InovaResourcesPage`/`InovaHowToPage`. Cards usam `rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg`.
- Sem paginação de rede: todo o conteúdo é array estático carregado no bundle.
- O link de cadastro externo de cases (`CASE_REGISTRATION_URL`, projeto original) **não** é portado — a vitrine de Casos fica "começa vazia de propósito", sem link externo.
- Eventos de analytics novos (6, ver Task 1) usam `trackEvent` de `apps/web/src/lib/analytics.ts` — no-op silencioso sem `VITE_GA4_MEASUREMENT_ID`, então nenhum teste depende de rede.
- `InovaGuiaLayout` **não** precisa checar `inovaModuleEnabled`/slug EMR de novo — o `InovaLayout` pai (`apps/web/src/pages/inova/InovaLayout.tsx`) já redireciona antes de qualquer rota filha renderizar.

---

## Task 1: Eventos de analytics do Guia (`@legends/shared`)

**Files:**
- Modify: `packages/shared/src/analytics.ts`

**Interfaces:**
- Produces: 6 nomes novos em `WEB_ANALYTICS_EVENT_NAMES`/`ANALYTICS_EVENT_NAMES`/`AnalyticsEventMap`, consumidos pelas Tasks 5, 7, 8, 11, 13, 14 via `trackEvent(name, props)`.
  - `inova_guia_bussola_completada: { caminho: 'ia' | 'ia-pessoa' | 'pessoa' }`
  - `inova_guia_situacao_aberta: { situacaoId: string }`
  - `inova_guia_prompt_copiado: { promptId: string }`
  - `inova_guia_maturidade_respondida: { nivel: number }`
  - `inova_guia_lideranca_aberta: Record<string, never>`
  - `inova_guia_seguranca_aberta: Record<string, never>`

- [ ] **Step 1: Rodar o teste existente para conferir a linha de base**

Run: `pnpm --filter @legends/shared exec vitest run analytics -t "catálogo de eventos"`
Expected: PASS (nada mudou ainda)

- [ ] **Step 2: Adicionar as entradas ao `AnalyticsEventMap`**

Em `packages/shared/src/analytics.ts`, dentro da interface `AnalyticsEventMap`, logo após o bloco `admin_screen_viewed: { screen: string }`:

```typescript
  // Guia AI First (Comunidade INOVA) — conteúdo de referência, restrito à EMR.
  inova_guia_bussola_completada: { caminho: 'ia' | 'ia-pessoa' | 'pessoa' }
  inova_guia_situacao_aberta: { situacaoId: string }
  inova_guia_prompt_copiado: { promptId: string }
  inova_guia_maturidade_respondida: { nivel: number }
  inova_guia_lideranca_aberta: Record<string, never>
  inova_guia_seguranca_aberta: Record<string, never>
```

- [ ] **Step 3: Adicionar os nomes a `ANALYTICS_EVENT_NAMES`**

Logo após `'admin_screen_viewed',` na lista `ANALYTICS_EVENT_NAMES`:

```typescript
  'inova_guia_bussola_completada',
  'inova_guia_situacao_aberta',
  'inova_guia_prompt_copiado',
  'inova_guia_maturidade_respondida',
  'inova_guia_lideranca_aberta',
  'inova_guia_seguranca_aberta',
```

- [ ] **Step 4: Adicionar os mesmos 6 nomes a `WEB_ANALYTICS_EVENT_NAMES`**

No array `WEB_ANALYTICS_EVENT_NAMES` (todos os eventos do Guia são emitidos pelo front):

```typescript
  'inova_guia_bussola_completada',
  'inova_guia_situacao_aberta',
  'inova_guia_prompt_copiado',
  'inova_guia_maturidade_respondida',
  'inova_guia_lideranca_aberta',
  'inova_guia_seguranca_aberta',
```

- [ ] **Step 5: Adicionar os rótulos em `ANALYTICS_EVENT_LABELS`**

```typescript
  inova_guia_bussola_completada: 'Bússola do Guia concluída',
  inova_guia_situacao_aberta: 'Situação do Guia aberta',
  inova_guia_prompt_copiado: 'Prompt do Guia copiado',
  inova_guia_maturidade_respondida: 'Autodiagnóstico de maturidade respondido',
  inova_guia_lideranca_aberta: 'Seção de Liderança do Guia aberta',
  inova_guia_seguranca_aberta: 'Seção de Segurança do Guia aberta',
```

- [ ] **Step 6: Rodar os testes para confirmar formato e cobertura**

Run: `pnpm --filter @legends/shared exec vitest run analytics`
Expected: PASS — os 6 nomes passam nas checagens de formato do GA4 (minúsculas/dígitos/`_`, ≤40 caracteres, sem prefixo reservado) e de presença em `WEB_ANALYTICS_EVENT_NAMES` ⊆ `ANALYTICS_EVENT_NAMES`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/analytics.ts
git commit -m "feat(inova): eventos de analytics do Guia AI First"
```

---

## Task 2: Conteúdo estático do Guia (catálogos TS)

**Files:**
- Create: `apps/web/src/pages/inova/guia/content/types.ts`
- Create: `apps/web/src/pages/inova/guia/content/library.ts`
- Create: `apps/web/src/pages/inova/guia/content/prompts.ts`
- Create: `apps/web/src/pages/inova/guia/content/faqs.ts`
- Create: `apps/web/src/pages/inova/guia/content/situations.ts`
- Create: `apps/web/src/pages/inova/guia/content/videos.ts`
- Create: `apps/web/src/pages/inova/guia/content/cases.ts`

**Interfaces:**
- Produces (tipos, `content/types.ts`): `PathId`, `Category`, `AreaId`, `Status`, `Situation`, `PromptItem`, `VideoItem`, `CaseItem`, `FaqItem`, `ExerciseItem`.
- Produces (`content/library.ts`): `paths`, `GOLDEN_RULE`, `areas`, `areaName(id)`, `cycleSteps`, `deliveryChecklist`, `maturityLevels`, `maturityQuestions`, `maturityScale`, `behaviorsDo`, `behaviorsDont`, `behaviorQuiz`, `leadershipBlocks`, `leadershipQuestions`, `leadershipChecklist`, `headcountQuestions`, `securitySemaphore`, `sensitiveInfo`, `securityPractices`, `exercises`, `exerciseById(id)`, `aiRoles`, `glossary`, `convictions`, `principles`, `weeklyChallenge`, `weeklyDiscovery`, `microcopy`.
- Produces (`content/prompts.ts`): `promptCategories`, `prompts: PromptItem[]`, `promptById(id)`.
- Produces (`content/faqs.ts`): `faqs: FaqItem[]`, `faqById(id)`, `faqCategories`.
- Produces (`content/situations.ts`): `situations: Situation[]`, `situationBySlug(slug)`, `situationById(id)`.
- Produces (`content/videos.ts`): `videos: VideoItem[]`, `videoById(id)`.
- Produces (`content/cases.ts`): `cases: CaseItem[]` (vazio), `caseById(id)`, `caseFields`, `inovaCycle`. **Sem** `CASE_REGISTRATION_URL` — não é portado.

Esses 7 arquivos são catálogos de dados estáticos (texto do original), portados quase como estão — reescrever à mão introduziria risco de erro de transcrição sem ganho algum (ver spec). São mecânicos: extrair do zip e ajustar só import/exports conforme abaixo.

- [ ] **Step 1: Criar a pasta e portar `types.ts` (verbatim)**

```bash
mkdir -p apps/web/src/pages/inova/guia/content
unzip -p ~/Downloads/codigo-fonte-inova-emr.zip src/guia/content/types.ts > apps/web/src/pages/inova/guia/content/types.ts
```

Conferir que o arquivo não tem nenhum import (é autocontido) — se tiver, é sinal de zip diferente do esperado; parar e investigar antes de seguir.

- [ ] **Step 2: Portar `library.ts`**

```bash
unzip -p ~/Downloads/codigo-fonte-inova-emr.zip src/guia/content/library.ts > apps/web/src/pages/inova/guia/content/library.ts
```

O arquivo já importa `import type { AreaId, ExerciseItem, PathId } from "./types";` — caminho relativo correto sem edição.

- [ ] **Step 3: Portar `prompts.ts`, `faqs.ts`, `situations.ts`, `videos.ts`**

```bash
unzip -p ~/Downloads/codigo-fonte-inova-emr.zip src/guia/content/prompts.ts > apps/web/src/pages/inova/guia/content/prompts.ts
unzip -p ~/Downloads/codigo-fonte-inova-emr.zip src/guia/content/faqs.ts > apps/web/src/pages/inova/guia/content/faqs.ts
unzip -p ~/Downloads/codigo-fonte-inova-emr.zip src/guia/content/situations.ts > apps/web/src/pages/inova/guia/content/situations.ts
unzip -p ~/Downloads/codigo-fonte-inova-emr.zip src/guia/content/videos.ts > apps/web/src/pages/inova/guia/content/videos.ts
```

Todos importam só `import type { X } from "./types";` — sem edição de import necessária.

- [ ] **Step 4: Portar `cases.ts` removendo o link externo de cadastro**

```bash
unzip -p ~/Downloads/codigo-fonte-inova-emr.zip src/guia/content/cases.ts > apps/web/src/pages/inova/guia/content/cases.ts
```

Editar o arquivo resultante: remover as duas linhas do `CASE_REGISTRATION_URL` (o comentário `// Link oficial de registro...` e a constante em si). O arquivo final deve exportar só `cases`, `caseById`, `caseFields`, `inovaCycle`.

- [ ] **Step 5: Checar o typecheck do workspace web**

Run: `pnpm --filter @legends/web exec tsc -p tsconfig.json --noEmit`
Expected: sem erros nos arquivos de `content/` (podem aparecer erros em outros arquivos ainda não criados neste plano — nesse caso, confirme que os únicos erros restantes citam caminhos de `pages/inova/guia/components`, `pages/inova/guia/pages` ou `pages/inova/guia/lib`, que só existem a partir da Task 3).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/content
git commit -m "feat(inova): porta o conteúdo estático do Guia AI First"
```

---

## Task 3: Helper `cx` e hook de estado local (`useGuiaLocalState`)

**Files:**
- Create: `apps/web/src/pages/inova/guia/lib/cx.ts`
- Create: `apps/web/src/pages/inova/guia/lib/useGuiaLocalState.ts`
- Test: `apps/web/src/pages/inova/guia/lib/useGuiaLocalState.test.ts`

**Interfaces:**
- Consumes: nada (base do módulo).
- Produces:
  - `cx(...parts: Array<string | false | null | undefined>): string`
  - `useGuiaLocalState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void]`
  - `useGuiaFavorites(kind: 'prompt' | 'situation'): { ids: string[]; has: (id: string) => boolean; toggle: (id: string) => void }`

- [ ] **Step 1: Criar o helper `cx`**

```typescript
// apps/web/src/pages/inova/guia/lib/cx.ts
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
```

- [ ] **Step 2: Escrever o teste do hook, com falha esperada**

```typescript
// apps/web/src/pages/inova/guia/lib/useGuiaLocalState.test.ts
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useGuiaFavorites, useGuiaLocalState } from './useGuiaLocalState'

describe('useGuiaLocalState', () => {
  beforeEach(() => window.localStorage.clear())

  it('inicia com o valor padrão quando não há nada salvo', () => {
    const { result } = renderHook(() => useGuiaLocalState('teste', 0))
    expect(result.current[0]).toBe(0)
  })

  it('persiste e recarrega o valor salvo', () => {
    const { result, unmount } = renderHook(() => useGuiaLocalState('contador', 0))
    act(() => result.current[1](5))
    expect(result.current[0]).toBe(5)
    unmount()

    const { result: reloaded } = renderHook(() => useGuiaLocalState('contador', 0))
    expect(reloaded.current[0]).toBe(5)
  })

  it('aceita função atualizadora', () => {
    const { result } = renderHook(() => useGuiaLocalState('lista', [] as string[]))
    act(() => result.current[1]((prev) => [...prev, 'a']))
    expect(result.current[0]).toEqual(['a'])
  })
})

describe('useGuiaFavorites', () => {
  beforeEach(() => window.localStorage.clear())

  it('começa vazio e alterna favoritos', () => {
    const { result } = renderHook(() => useGuiaFavorites('prompt'))
    expect(result.current.has('p1')).toBe(false)

    act(() => result.current.toggle('p1'))
    expect(result.current.has('p1')).toBe(true)
    expect(result.current.ids).toEqual(['p1'])

    act(() => result.current.toggle('p1'))
    expect(result.current.has('p1')).toBe(false)
  })

  it('mantém prompt e situação em chaves separadas', () => {
    const { result: promptFavs } = renderHook(() => useGuiaFavorites('prompt'))
    const { result: situationFavs } = renderHook(() => useGuiaFavorites('situation'))
    act(() => promptFavs.current.toggle('x'))
    expect(situationFavs.current.has('x')).toBe(false)
  })
})
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/lib/useGuiaLocalState.test.ts`
Expected: FAIL — módulo `useGuiaLocalState.ts` não existe ainda.

- [ ] **Step 4: Implementar o hook**

```typescript
// apps/web/src/pages/inova/guia/lib/useGuiaLocalState.ts
import { useCallback, useEffect, useState } from 'react'

const PREFIX = 'legends-inova-guia:'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Estado que só existe no navegador da pessoa — nada disto sobe para o servidor. */
export function useGuiaLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read<T>(key, initial))

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          window.localStorage.setItem(PREFIX + key, JSON.stringify(resolved))
        } catch {
          /* storage indisponível: segue só em memória */
        }
        return resolved
      })
    },
    [key],
  )

  return [value, update] as const
}

export function useGuiaFavorites(kind: 'prompt' | 'situation') {
  const [ids, setIds] = useGuiaLocalState<string[]>(`fav-${kind}`, [])
  const toggle = useCallback(
    (id: string) => setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [setIds],
  )
  return { ids, toggle, has: (id: string) => ids.includes(id) }
}
```

Nota: diferente do `useLocalState` original (que hidrata em `useEffect` para evitar mismatch de SSR), o Legends é uma SPA pura sem SSR — ler direto no `useState` inicial é seguro e mais simples.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/lib/useGuiaLocalState.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/lib
git commit -m "feat(inova): hook de estado local e helper de classes do Guia"
```

---

## Task 4: Componentes visuais compartilhados

**Files:**
- Create: `apps/web/src/pages/inova/guia/components/SectionHeading.tsx`
- Create: `apps/web/src/pages/inova/guia/components/Chip.tsx`
- Create: `apps/web/src/pages/inova/guia/components/PathBadge.tsx`
- Create: `apps/web/src/pages/inova/guia/components/CopyPromptButton.tsx`
- Create: `apps/web/src/pages/inova/guia/components/HelpfulFeedback.tsx`
- Create: `apps/web/src/pages/inova/guia/components/StatBar.tsx`
- Test: `apps/web/src/pages/inova/guia/components/CopyPromptButton.test.tsx`
- Test: `apps/web/src/pages/inova/guia/components/HelpfulFeedback.test.tsx`

**Interfaces:**
- Consumes: `cx` (Task 3), `paths` de `content/library.ts` (Task 2), `Icon` de `../../../../components/Icon`, `trackEvent` de `../../../../lib/analytics`.
- Produces:
  - `SectionHeading({ eyebrow?, title, description?, action? }): JSX.Element`
  - `Chip({ children, active?, onClick? }): JSX.Element`
  - `PathBadge({ path: PathId }): JSX.Element`
  - `CopyPromptButton({ text, promptId, label? }): JSX.Element`
  - `HelpfulFeedback({ contentId, contentType }): JSX.Element`
  - `StatBar({ value: number, label: string }): JSX.Element`

- [ ] **Step 1: `SectionHeading`, `Chip`, `PathBadge`, `StatBar` (sem estado/interação de rede — sem teste dedicado, cobertos pelos testes de página)**

```tsx
// apps/web/src/pages/inova/guia/components/SectionHeading.tsx
import type { ReactNode } from 'react'

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-sm md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">{eyebrow}</p>
        ) : null}
        <h2 className="mt-1 font-headline text-headline-md text-on-surface">{title}</h2>
        {description ? <p className="mt-2 text-body-md text-on-surface-variant">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
```

```tsx
// apps/web/src/pages/inova/guia/components/Chip.tsx
import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export function Chip({
  children,
  active,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex min-h-9 items-center rounded-full border px-lg py-xs font-label text-label-md transition-colors',
        active
          ? 'border-primary bg-primary text-on-primary'
          : 'border-outline-variant/60 bg-surface text-on-surface-variant hover:border-primary/60',
      )}
    >
      {children}
    </button>
  )
}
```

```tsx
// apps/web/src/pages/inova/guia/components/PathBadge.tsx
import type { PathId } from '../content/types'
import { paths } from '../content/library'
import { cx } from '../lib/cx'

const pathTone: Record<PathId, string> = {
  ia: 'border-approved/60 bg-approved-tint text-approved',
  'ia-pessoa': 'border-primary/50 bg-primary/10 text-primary',
  pessoa: 'border-warn/50 bg-warn/10 text-warn',
}

export function PathBadge({ path }: { path: PathId }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-xs rounded-full border px-md py-xs font-label text-label-sm font-bold',
        pathTone[path],
      )}
    >
      {paths[path].label}
    </span>
  )
}
```

```tsx
// apps/web/src/pages/inova/guia/components/StatBar.tsx
export function StatBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div>
      <div className="flex items-center justify-between text-body-sm text-on-surface-variant">
        <span>{label}</span>
        <span>{Math.round(clamped)}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-container-high">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}
```

Verifique `approved`/`warn` como tokens de cor já usados no repo (ex.: `apps/web/src/pages/inova/InovaAdminPanelPage.tsx`, que já referencia avisos com essas classes) antes de assumir o nome — se o token real tiver outro nome, ajuste os três arquivos acima para o nome existente.

- [ ] **Step 2: Escrever os testes de `CopyPromptButton` e `HelpfulFeedback`, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/components/CopyPromptButton.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyPromptButton } from './CopyPromptButton'
import * as analytics from '../../../../lib/analytics'

describe('CopyPromptButton', () => {
  beforeEach(() => {
    vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('copia o texto e avisa que copiou', async () => {
    render(<CopyPromptButton text="conteúdo do prompt" promptId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: /copiar prompt/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('conteúdo do prompt')
    expect(analytics.trackEvent).toHaveBeenCalledWith('inova_guia_prompt_copiado', { promptId: 'p1' })
    expect(await screen.findByText(/prompt copiado/i)).toBeInTheDocument()
  })
})
```

```tsx
// apps/web/src/pages/inova/guia/components/HelpfulFeedback.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { HelpfulFeedback } from './HelpfulFeedback'

describe('HelpfulFeedback', () => {
  it('pergunta se ajudou e mostra agradecimento após responder', async () => {
    render(<HelpfulFeedback contentId="c1" contentType="situacao" />)
    expect(screen.getByText('Isso ajudou?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /sim/i }))
    expect(screen.getByText(/obrigado/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/components/CopyPromptButton.test.tsx src/pages/inova/guia/components/HelpfulFeedback.test.tsx`
Expected: FAIL — `CopyPromptButton.tsx`/`HelpfulFeedback.tsx` não existem ainda.

- [ ] **Step 4: Implementar `CopyPromptButton` e `HelpfulFeedback`**

```tsx
// apps/web/src/pages/inova/guia/components/CopyPromptButton.tsx
import { useState } from 'react'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { cx } from '../lib/cx'

export function CopyPromptButton({
  text,
  promptId,
  label = 'Copiar prompt',
}: {
  text: string
  promptId: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard bloqueado pelo navegador */
    }
    setCopied(true)
    trackEvent('inova_guia_prompt_copiado', { promptId })
    window.setTimeout(() => setCopied(false), 2200)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cx(
        'inline-flex min-h-11 items-center gap-sm rounded-full px-lg font-label text-label-md font-bold transition-colors',
        copied ? 'bg-approved text-on-primary' : 'bg-primary text-on-primary hover:brightness-95',
      )}
    >
      <Icon name={copied ? 'check' : 'content_copy'} className="text-[18px]" />
      {copied ? 'Prompt copiado' : label}
    </button>
  )
}
```

```tsx
// apps/web/src/pages/inova/guia/components/HelpfulFeedback.tsx
import { useState } from 'react'
import { Icon } from '../../../../components/Icon'

export function HelpfulFeedback({ contentId, contentType }: { contentId: string; contentType: string }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null)

  return (
    <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg" data-content-id={contentId} data-content-type={contentType}>
      {answer === null ? (
        <div className="flex flex-wrap items-center gap-sm">
          <span className="font-label text-label-md font-bold text-on-surface">Isso ajudou?</span>
          <button
            type="button"
            onClick={() => setAnswer('yes')}
            className="inline-flex min-h-9 items-center gap-xs rounded-full border border-outline-variant/60 px-md text-label-md hover:border-primary/60"
          >
            <Icon name="thumb_up" className="text-[16px]" /> Sim
          </button>
          <button
            type="button"
            onClick={() => setAnswer('no')}
            className="inline-flex min-h-9 items-center gap-xs rounded-full border border-outline-variant/60 px-md text-label-md hover:border-primary/60"
          >
            <Icon name="thumb_down" className="text-[16px]" /> Não
          </button>
        </div>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          {answer === 'yes' ? 'Obrigado! Isso ajuda a melhorar o Guia.' : 'Obrigado pelo retorno — vamos revisar esse conteúdo.'}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/components/CopyPromptButton.test.tsx src/pages/inova/guia/components/HelpfulFeedback.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/components
git commit -m "feat(inova): componentes visuais compartilhados do Guia"
```

---

## Task 5: `CompassWizard` (Bússola de decisão)

**Files:**
- Create: `apps/web/src/pages/inova/guia/components/CompassWizard.tsx`
- Test: `apps/web/src/pages/inova/guia/components/CompassWizard.test.tsx`

**Interfaces:**
- Consumes: `PathBadge`, `CopyPromptButton`, `HelpfulFeedback` (Task 4); `paths`, `GOLDEN_RULE` de `content/library.ts`; `situations` de `content/situations.ts`; `promptById` de `content/prompts.ts`; `trackEvent` (Task 1); `Icon`.
- Produces:
  - `decideCompassPath(people: 'decide' | 'impacta' | 'nao', impact: 'alto' | 'medio' | 'baixo', review: 'sim' | 'nao'): PathId` (função pura exportada para teste)
  - `CompassWizard(): JSX.Element` — usado pelas Tasks 6 (Home) e 7 (Bússola)

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/components/CompassWizard.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CompassWizard, decideCompassPath } from './CompassWizard'
import * as analytics from '../../../../lib/analytics'

describe('decideCompassPath', () => {
  it('decide "pessoa" quando a situação decide algo sobre alguém', () => {
    expect(decideCompassPath('decide', 'baixo', 'sim')).toBe('pessoa')
  })

  it('decide "ia" quando o impacto é baixo, não envolve pessoas e passa por revisão', () => {
    expect(decideCompassPath('nao', 'baixo', 'sim')).toBe('ia')
  })

  it('decide "ia-pessoa" quando não há revisão e o impacto não é alto', () => {
    expect(decideCompassPath('nao', 'baixo', 'nao')).toBe('ia-pessoa')
  })
})

describe('CompassWizard', () => {
  it('percorre as três perguntas e mostra o resultado, disparando o evento', async () => {
    vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    render(<CompassWizard />)

    await userEvent.click(screen.getByRole('button', { name: /não, é sobre conteúdo/i }))
    await userEvent.click(screen.getByRole('button', { name: /baixo/i }))
    await userEvent.click(screen.getByRole('button', { name: /sim, eu reviso e assino/i }))

    expect(await screen.findByRole('heading', { level: 3 })).toBeInTheDocument()
    expect(analytics.trackEvent).toHaveBeenCalledWith('inova_guia_bussola_completada', { caminho: 'ia' })
  })
})
```

Ajuste o segundo `it` se o texto exato dos botões (do conteúdo portado na Task 2) divergir do que está descrito aqui — confira em `content/library.ts` os rótulos reais das opções antes de fechar o teste; o essencial a garantir é: 3 cliques → resultado visível → `trackEvent` chamado com o caminho certo.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/components/CompassWizard.test.tsx`
Expected: FAIL — `CompassWizard.tsx` não existe.

- [ ] **Step 3: Implementar `CompassWizard`**

```tsx
// apps/web/src/pages/inova/guia/components/CompassWizard.tsx
import { useMemo, useState } from 'react'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { GOLDEN_RULE, paths } from '../content/library'
import { promptById } from '../content/prompts'
import { situations } from '../content/situations'
import type { PathId, Situation } from '../content/types'
import { cx } from '../lib/cx'
import { CopyPromptButton } from './CopyPromptButton'
import { HelpfulFeedback } from './HelpfulFeedback'
import { PathBadge } from './PathBadge'

type PeopleAnswer = 'decide' | 'impacta' | 'nao'
type ImpactAnswer = 'alto' | 'medio' | 'baixo'
type ReviewAnswer = 'sim' | 'nao'

const QUESTIONS = {
  people: {
    title: 'Essa situação envolve pessoas?',
    help: 'Pense em quem sente o resultado: um colega, um aluno, o seu time.',
    options: [
      { id: 'decide' as const, label: 'Sim, decide algo sobre alguém', detail: 'Feedback, avaliação, promoção, mérito, desligamento, conflito.' },
      { id: 'impacta' as const, label: 'Em parte, afeta pessoas indiretamente', detail: 'Comunicação, processo do time, mudança de rotina, atendimento.' },
      { id: 'nao' as const, label: 'Não, é sobre conteúdo, dados ou organização', detail: 'Textos, planilhas, pesquisa, estruturação, estudo.' },
    ],
  },
  impact: {
    title: 'Qual o impacto se sair errado?',
    help: 'Sem drama e sem minimizar: qual o tamanho real do estrago?',
    options: [
      { id: 'alto' as const, label: 'Alto', detail: 'Afeta carreira, relação, imagem institucional, dinheiro ou risco legal.' },
      { id: 'medio' as const, label: 'Médio', detail: 'Gera retrabalho, ruído ou uma decisão que precisaria ser revista.' },
      { id: 'baixo' as const, label: 'Baixo', detail: 'Dá para corrigir rápido, sem consequências relevantes.' },
    ],
  },
  review: {
    title: 'O resultado passa pela sua revisão antes de ir adiante?',
    help: 'Você lê, ajusta e assume a entrega, ou ela sai direto?',
    options: [
      { id: 'sim' as const, label: 'Sim, eu reviso e assino', detail: 'Você é a última pessoa antes da entrega.' },
      { id: 'nao' as const, label: 'Não tenho como validar sozinho', detail: 'Falta contexto, dado ou autoridade para confirmar.' },
    ],
  },
}

export function decideCompassPath(people: PeopleAnswer, impact: ImpactAnswer, review: ReviewAnswer): PathId {
  if (people === 'decide') return 'pessoa'
  if (impact === 'alto') return review === 'sim' && people === 'nao' ? 'ia-pessoa' : 'pessoa'
  if (people === 'impacta') return 'ia-pessoa'
  if (impact === 'medio') return 'ia-pessoa'
  return review === 'sim' ? 'ia' : 'ia-pessoa'
}

export function CompassWizard() {
  const [step, setStep] = useState(0)
  const [people, setPeople] = useState<PeopleAnswer | null>(null)
  const [impact, setImpact] = useState<ImpactAnswer | null>(null)
  const [review, setReview] = useState<ReviewAnswer | null>(null)
  const [result, setResult] = useState<PathId | null>(null)

  const related: Situation[] = useMemo(() => {
    if (!result) return []
    return situations.filter((s) => s.path === result).slice(0, 3)
  }, [result])

  function reset() {
    setStep(0)
    setPeople(null)
    setImpact(null)
    setReview(null)
    setResult(null)
  }

  function goResult(p: PeopleAnswer, i: ImpactAnswer, r: ReviewAnswer) {
    const path = decideCompassPath(p, i, r)
    trackEvent('inova_guia_bussola_completada', { caminho: path })
    setResult(path)
    setStep(3)
  }

  if (step === 3 && result) {
    const info = paths[result]
    const firstPrompt = related[0]?.promptIds?.[0] ? promptById(related[0].promptIds[0]) : undefined
    return (
      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <PathBadge path={result} />
        <h3 className="mt-md font-headline text-headline-sm text-on-surface">{info.message}</h3>
        <p className="mt-sm text-body-md text-on-surface-variant">{info.when}</p>
        <p className="mt-md rounded-xl border-l-4 border-approved bg-surface p-md text-body-sm text-on-surface-variant">
          <strong className="font-bold text-on-surface">Regra de ouro. </strong>
          {GOLDEN_RULE}
        </p>

        {related.length > 0 ? (
          <ul className="mt-lg grid gap-md sm:grid-cols-3">
            {related.map((s) => (
              <li key={s.id} className="rounded-xl border border-outline-variant/40 bg-surface p-md">
                <PathBadge path={s.path} />
                <p className="mt-sm font-label text-label-md font-bold text-on-surface">{s.title}</p>
                <p className="mt-xs line-clamp-2 text-body-sm text-on-surface-variant">{s.summary}</p>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-lg flex flex-wrap items-center gap-sm">
          {firstPrompt ? <CopyPromptButton text={firstPrompt.text} promptId={firstPrompt.id} label="Copiar prompt sugerido" /> : null}
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center gap-xs rounded-full border border-outline-variant/60 px-lg font-label text-label-md text-primary hover:border-primary/60"
          >
            <Icon name="restart_alt" className="text-[18px]" /> Testar outra situação
          </button>
        </div>

        <div className="mt-lg">
          <HelpfulFeedback contentId={`compass-${result}`} contentType="bussola" />
        </div>
      </div>
    )
  }

  const [key, setter] = step === 0 ? (['people', setPeople] as const) : step === 1 ? (['impact', setImpact] as const) : (['review', setReview] as const)
  const question = QUESTIONS[key]
  const value = key === 'people' ? people : key === 'impact' ? impact : review

  return (
    <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <h3 className="font-headline text-headline-sm text-on-surface">{question.title}</h3>
      <p className="mt-sm text-body-md text-on-surface-variant">{question.help}</p>
      <div className="mt-lg grid gap-sm">
        {question.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              // @ts-expect-error -- id pertence ao domínio do setter correspondente
              setter(opt.id)
              if (key === 'people') setStep(1)
              else if (key === 'impact') setStep(2)
              else if (people && impact) goResult(people, impact, opt.id as ReviewAnswer)
            }}
            className={cx(
              'rounded-xl border p-md text-left transition-colors',
              value === opt.id ? 'border-primary bg-surface' : 'border-outline-variant/40 bg-surface hover:border-primary/60',
            )}
          >
            <span className="block font-label text-label-md font-bold text-on-surface">{opt.label}</span>
            <span className="mt-1 block text-body-sm text-on-surface-variant">{opt.detail}</span>
          </button>
        ))}
      </div>
      {step > 0 ? (
        <button
          type="button"
          onClick={() => setStep((s) => s - 1)}
          className="mt-lg inline-flex items-center gap-xs text-body-sm text-on-surface-variant hover:text-primary"
        >
          <Icon name="arrow_back" className="text-[18px]" /> Voltar
        </button>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/components/CompassWizard.test.tsx`
Expected: PASS — ajuste os textos do teste (Step 1) contra o texto real renderizado se necessário, mas sem alterar o comportamento verificado (3 perguntas → resultado → evento).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/inova/guia/components/CompassWizard.tsx apps/web/src/pages/inova/guia/components/CompassWizard.test.tsx
git commit -m "feat(inova): bússola de decisão do Guia"
```

---

## Task 6: `InovaGuiaLayout`, item de nav e página Início

**Files:**
- Create: `apps/web/src/pages/inova/guia/InovaGuiaLayout.tsx`
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaHomePage.tsx`
- Test: `apps/web/src/pages/inova/guia/InovaGuiaLayout.test.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaHomePage.test.tsx`
- Modify: `apps/web/src/pages/inova/InovaLayout.tsx`
- Modify: `apps/web/src/pages/inova/InovaLayout.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `CompassWizard` (Task 5), `SectionHeading` (Task 4), `paths`, `GOLDEN_RULE`, `convictions` (Task 2).
- Produces: rota `/comunidade-inova/guia` (índice) e o layout `InovaGuiaLayout` que hospeda as rotas das Tasks 7–16 via `<Outlet />`.

- [ ] **Step 1: Escrever os testes do sub-layout e da Home, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/InovaGuiaLayout.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaLayout } from './InovaGuiaLayout'

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/comunidade-inova/guia']}>
      <Routes>
        <Route path="/comunidade-inova/guia" element={<InovaGuiaLayout />}>
          <Route index element={<p>início do guia</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('InovaGuiaLayout', () => {
  it('mostra a sub-navegação com as 11 seções', () => {
    renderLayout()
    for (const label of [
      'Início',
      'Bússola',
      'Situações',
      'Na prática',
      'Vídeos',
      'Prompts',
      'Maturidade',
      'Liderança',
      'Segurança',
      'Casos',
      'Guia completo',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})
```

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaHomePage.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaHomePage } from './InovaGuiaHomePage'

describe('InovaGuiaHomePage', () => {
  it('mostra a pergunta central e a bússola embutida', () => {
    render(
      <MemoryRouter>
        <InovaGuiaHomePage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/quem deve ajudar primeiro/i)).toBeInTheDocument()
    expect(screen.getByText('Essa situação envolve pessoas?')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/InovaGuiaLayout.test.tsx src/pages/inova/guia/pages/InovaGuiaHomePage.test.tsx`
Expected: FAIL — os arquivos ainda não existem.

- [ ] **Step 3: Implementar `InovaGuiaLayout`**

```tsx
// apps/web/src/pages/inova/guia/InovaGuiaLayout.tsx
import { NavLink, Outlet } from 'react-router-dom'
import { cx } from './lib/cx'

const SECTIONS = [
  { to: '.', label: 'Início', end: true },
  { to: 'bussola', label: 'Bússola' },
  { to: 'situacoes', label: 'Situações' },
  { to: 'na-pratica', label: 'Na prática' },
  { to: 'videos', label: 'Vídeos' },
  { to: 'prompts', label: 'Prompts' },
  { to: 'maturidade', label: 'Maturidade' },
  { to: 'lideranca', label: 'Liderança' },
  { to: 'seguranca', label: 'Segurança' },
  { to: 'cases', label: 'Casos' },
  { to: 'completo', label: 'Guia completo' },
]

const subTabCls = ({ isActive }: { isActive: boolean }) =>
  cx(
    'whitespace-nowrap rounded-full px-md py-xs font-label text-label-sm font-bold transition-colors',
    isActive ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container',
  )

/**
 * Sub-navegação do Guia AI First, dentro de `/comunidade-inova/guia`. A trava
 * de módulo/empresa já aconteceu no `InovaLayout` pai — aqui é só o conteúdo.
 */
export function InovaGuiaLayout() {
  return (
    <div className="flex flex-col gap-lg">
      <nav className="flex flex-wrap gap-xs overflow-x-auto" aria-label="Seções do Guia AI First">
        {SECTIONS.map((s) => (
          <NavLink key={s.label} to={s.to} end={s.end} className={subTabCls}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
```

- [ ] **Step 4: Implementar `InovaGuiaHomePage`**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaHomePage.tsx
import { Link } from 'react-router-dom'
import { Icon } from '../../../../components/Icon'
import { CompassWizard } from '../components/CompassWizard'
import { SectionHeading } from '../components/SectionHeading'
import { GOLDEN_RULE, convictions, paths } from '../content/library'

const ENTRADAS = [
  { to: 'bussola', label: 'Não sei por onde começar', detail: 'Três perguntas rápidas e um caminho claro para a sua situação.', icon: 'explore' },
  { to: 'situacoes', label: 'Tenho uma situação específica', detail: 'Busque o seu caso e veja o papel da IA, o papel humano e o risco.', icon: 'auto_awesome' },
  { to: 'seguranca', label: 'Posso compartilhar esse dado?', detail: 'O semáforo do que pode, do que exige validação e do que nunca pode.', icon: 'verified_user' },
] as const

export function InovaGuiaHomePage() {
  return (
    <div className="flex flex-col gap-2xl">
      <header>
        <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Cultura AI First</p>
        <h1 className="mt-1 font-headline text-headline-lg text-on-surface">
          Quem deve ajudar primeiro: a IA, a IA com pessoas, ou uma pessoa?
        </h1>
        <p className="mt-2 max-w-2xl text-body-md text-on-surface-variant">
          Traga uma dúvida real do seu dia. Em poucos segundos você descobre por onde começar, e sai daqui com um
          próximo passo concreto.
        </p>
      </header>

      <div className="grid gap-md md:grid-cols-3">
        {ENTRADAS.map((e) => (
          <Link
            key={e.to}
            to={e.to}
            className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg transition-colors hover:border-primary/60"
          >
            <Icon name={e.icon} className="text-[24px] text-primary" />
            <p className="mt-sm font-label text-label-lg font-bold text-on-surface">{e.label}</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{e.detail}</p>
          </Link>
        ))}
      </div>

      <section>
        <SectionHeading
          eyebrow="Experimente agora"
          title="Uma dúvida real, um caminho em segundos"
          description="A Bússola não decide por você. Ela mostra onde a IA ajuda, onde você decide e quando é hora de chamar alguém."
        />
        <div className="mt-lg">
          <CompassWizard />
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Os três caminhos" title="Nenhum é melhor. O erro é usar o errado." />
        <div className="mt-lg grid gap-md lg:grid-cols-3">
          {Object.values(paths).map((p) => (
            <article key={p.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <h3 className="font-headline text-headline-sm text-on-surface">{p.label}</h3>
              <p className="mt-sm text-body-md text-on-surface-variant">{p.message}</p>
            </article>
          ))}
        </div>
        <p className="mt-md rounded-xl border-l-4 border-approved bg-surface-container-low p-lg text-body-md text-on-surface-variant">
          <strong className="font-bold text-on-surface">Regra de ouro. </strong>
          {GOLDEN_RULE}
        </p>
      </section>

      <section>
        <SectionHeading eyebrow="Por que isso importa" title="Pessoas primeiro. Sempre." />
        <ul className="mt-lg grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {convictions.map((c) => (
            <li key={c.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <p className="font-label text-label-lg font-bold text-on-surface">{c.title}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{c.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/InovaGuiaLayout.test.tsx src/pages/inova/guia/pages/InovaGuiaHomePage.test.tsx`
Expected: PASS

- [ ] **Step 6: Adicionar o item "Guia" na sub-nav do `InovaLayout`**

Em `apps/web/src/pages/inova/InovaLayout.tsx`, adicionar entre as abas "Recursos" e "Como usar":

```tsx
        <NavLink to="/comunidade-inova/guia" className={tabCls}>
          Guia
        </NavLink>
```

Atualizar o teste `InovaLayout.test.tsx` (primeiro `it`) acrescentando:

```tsx
    expect(screen.getByRole('link', { name: /^guia$/i })).toBeInTheDocument()
```

- [ ] **Step 7: Registrar as rotas no `App.tsx`**

Em `apps/web/src/App.tsx`, adicionar os imports (perto dos outros imports de `pages/inova`):

```tsx
import { InovaGuiaLayout } from './pages/inova/guia/InovaGuiaLayout'
import { InovaGuiaHomePage } from './pages/inova/guia/pages/InovaGuiaHomePage'
```

E, dentro do bloco `<Route path="/comunidade-inova" element={<InovaLayout />}>`, depois de `recursos`:

```tsx
                      <Route path="guia" element={<InovaGuiaLayout />}>
                        <Route index element={<InovaGuiaHomePage />} />
                      </Route>
```

- [ ] **Step 8: Rodar os testes afetados**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaLayout.test.tsx src/pages/inova/guia`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/inova/guia/InovaGuiaLayout.tsx apps/web/src/pages/inova/guia/InovaGuiaLayout.test.tsx \
  apps/web/src/pages/inova/guia/pages/InovaGuiaHomePage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaHomePage.test.tsx \
  apps/web/src/pages/inova/InovaLayout.tsx apps/web/src/pages/inova/InovaLayout.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): sub-navegação e página Início do Guia AI First"
```

---

## Task 7: Página Bússola

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaBussolaPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaBussolaPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `CompassWizard`, `SectionHeading` (Task 4/5), `paths` (Task 2).
- Produces: rota `/comunidade-inova/guia/bussola`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaBussolaPage.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaBussolaPage } from './InovaGuiaBussolaPage'

describe('InovaGuiaBussolaPage', () => {
  it('mostra o título e a bússola', () => {
    render(
      <MemoryRouter>
        <InovaGuiaBussolaPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Quem deve ajudar primeiro?')).toBeInTheDocument()
    expect(screen.getByText('Essa situação envolve pessoas?')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaBussolaPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaBussolaPage.tsx
import { CompassWizard } from '../components/CompassWizard'
import { SectionHeading } from '../components/SectionHeading'
import { paths } from '../content/library'

export function InovaGuiaBussolaPage() {
  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Bússola de decisão"
        title="Quem deve ajudar primeiro?"
        description="A dúvida real não é “a IA consegue fazer isso?”, e sim “quem deve começar?”. Descreva sua situação e responda três perguntas."
      />

      <CompassWizard />

      <section>
        <SectionHeading eyebrow="Os três caminhos" title="O que cada resposta significa" />
        <div className="mt-lg grid gap-md lg:grid-cols-3">
          {Object.values(paths).map((p) => (
            <article key={p.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <h3 className="font-headline text-headline-sm text-on-surface">{p.label}</h3>
              <p className="mt-sm text-body-md text-on-surface-variant">{p.message}</p>
              <p className="mt-md border-t border-outline-variant/40 pt-md text-body-sm text-on-surface-variant">
                <strong className="font-bold text-on-surface">Quando. </strong>
                {p.when}
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                <strong className="font-bold text-on-surface">Exemplos. </strong>
                {p.examples}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaBussolaPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota**

Em `App.tsx`, importar `InovaGuiaBussolaPage` e adicionar dentro do bloco `guia`:

```tsx
                        <Route path="bussola" element={<InovaGuiaBussolaPage />} />
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaBussolaPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaBussolaPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Bússola do Guia AI First"
```

---

## Task 8: Página Situações

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaSituacoesPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaSituacoesPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `Chip`, `PathBadge`, `CopyPromptButton`, `HelpfulFeedback`, `SectionHeading` (Task 4); `useGuiaFavorites` (Task 3); `situations`, `areaName`, `paths` (Task 2); `promptById`, `faqById`; `trackEvent`.
- Produces: rota `/comunidade-inova/guia/situacoes`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaSituacoesPage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InovaGuiaSituacoesPage } from './InovaGuiaSituacoesPage'
import { situations } from '../content/situations'
import * as analytics from '../../../../lib/analytics'

describe('InovaGuiaSituacoesPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
  })

  it('lista as situações e filtra por busca', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaSituacoesPage />
      </MemoryRouter>,
    )
    const primeira = situations[0]!
    expect(screen.getByText(primeira.title)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/buscar situações/i), 'palavra-que-nao-existe-em-nenhuma-situacao')
    expect(screen.queryByText(primeira.title)).not.toBeInTheDocument()
    expect(screen.getByText(/não achamos essa situação/i)).toBeInTheDocument()
  })

  it('abre o detalhe e dispara o evento de analytics', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaSituacoesPage />
      </MemoryRouter>,
    )
    const primeira = situations[0]!
    await userEvent.click(screen.getAllByRole('button', { name: /ver caminho/i })[0]!)

    expect(analytics.trackEvent).toHaveBeenCalledWith('inova_guia_situacao_aberta', { situacaoId: primeira.id })
    expect(screen.getByRole('heading', { name: primeira.title })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaSituacoesPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaSituacoesPage.tsx
import { useMemo, useState } from 'react'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { Chip } from '../components/Chip'
import { CopyPromptButton } from '../components/CopyPromptButton'
import { HelpfulFeedback } from '../components/HelpfulFeedback'
import { PathBadge } from '../components/PathBadge'
import { SectionHeading } from '../components/SectionHeading'
import { faqById } from '../content/faqs'
import { areaName, paths } from '../content/library'
import { promptById } from '../content/prompts'
import { situations } from '../content/situations'
import type { PathId, Situation } from '../content/types'
import { useGuiaFavorites } from '../lib/useGuiaLocalState'

const PATH_FILTERS: { id: PathId | 'todos'; label: string }[] = [
  { id: 'todos', label: 'Todos os caminhos' },
  { id: 'ia', label: paths.ia.short },
  { id: 'ia-pessoa', label: paths['ia-pessoa'].short },
  { id: 'pessoa', label: paths.pessoa.short },
]

export function InovaGuiaSituacoesPage() {
  const [query, setQuery] = useState('')
  const [path, setPath] = useState<PathId | 'todos'>('todos')
  const [category, setCategory] = useState('todas')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [active, setActive] = useState<Situation | null>(null)
  const favorites = useGuiaFavorites('situation')

  const categories = useMemo(() => ['todas', ...Array.from(new Set(situations.map((x) => x.category)))], [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return situations.filter((item) => {
      if (path !== 'todos' && item.path !== path) return false
      if (category !== 'todas' && item.category !== category) return false
      if (onlyFavorites && !favorites.has(item.id)) return false
      if (!q) return true
      return [item.title, item.summary, item.aiRole, item.humanRole, ...item.tags].join(' ').toLowerCase().includes(q)
    })
  }, [query, path, category, onlyFavorites, favorites])

  function open(item: Situation) {
    trackEvent('inova_guia_situacao_aberta', { situacaoId: item.id })
    setActive(item)
  }

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Minha situação"
        title="Encontre o seu caso e saiba por onde começar"
        description="Situações reais do cotidiano, com caminho recomendado, papel da IA, papel humano, risco e prompt inicial."
      />

      <div className="flex flex-col gap-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar: feedback, planilha, reunião, promoção…"
          aria-label="Buscar situações"
          className="min-h-11 w-full rounded-full border border-outline-variant/60 bg-surface px-lg text-body-md outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-xs">
          {PATH_FILTERS.map((f) => (
            <Chip key={f.id} active={path === f.id} onClick={() => setPath(f.id)}>
              {f.label}
            </Chip>
          ))}
          <Chip active={onlyFavorites} onClick={() => setOnlyFavorites((v) => !v)}>
            Meus salvos
          </Chip>
        </div>
        <div className="flex flex-wrap gap-xs">
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c === 'todas' ? 'Todas as categorias' : c}
            </Chip>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/60 p-2xl text-center">
          <p className="font-headline text-headline-sm text-on-surface">Não achamos essa situação por aqui.</p>
          <p className="mt-sm text-body-md text-on-surface-variant">
            Abra a Bússola e responda três perguntas — funciona mesmo para casos que ainda não mapeamos.
          </p>
        </div>
      ) : (
        <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <li key={item.id}>
              <article className="flex h-full flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <div className="flex items-start justify-between gap-sm">
                  <PathBadge path={item.path} />
                  <button
                    type="button"
                    aria-label={favorites.has(item.id) ? 'Remover dos salvos' : 'Salvar situação'}
                    onClick={() => favorites.toggle(item.id)}
                    className="rounded-full p-xs text-on-surface-variant hover:text-primary"
                  >
                    <Icon name="favorite" filled={favorites.has(item.id)} className="text-[18px]" />
                  </button>
                </div>
                <h3 className="mt-md font-headline text-headline-sm text-on-surface">{item.title}</h3>
                <p className="mt-sm flex-1 text-body-sm text-on-surface-variant">{item.summary}</p>
                <div className="mt-md flex items-center justify-between gap-sm border-t border-outline-variant/40 pt-md">
                  <span className="text-body-sm text-on-surface-variant">
                    {item.category} · {areaName(item.area)}
                  </span>
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="font-label text-label-sm font-bold text-primary hover:underline"
                  >
                    Ver caminho
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {active ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md" role="dialog" aria-modal="true">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-xl">
            <div className="flex items-start justify-between gap-md">
              <PathBadge path={active.path} />
              <button type="button" onClick={() => setActive(null)} aria-label="Fechar" className="text-on-surface-variant hover:text-on-surface">
                <Icon name="close" className="text-[20px]" />
              </button>
            </div>
            <h3 className="mt-md font-headline text-headline-md text-on-surface">{active.title}</h3>
            <p className="mt-sm text-body-md text-on-surface-variant">{active.summary}</p>

            <dl className="mt-lg grid gap-md sm:grid-cols-2">
              <SituationDetail label="O que a IA faz bem aqui" value={active.aiRole} />
              <SituationDetail label="O que continua humano" value={active.humanRole} />
              <SituationDetail label="Quando envolver a liderança" value={active.leadershipTrigger} />
              <SituationDetail label="Risco a observar" value={active.risk} />
            </dl>

            <div className="mt-lg rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Prompt inicial</p>
              <p className="mt-sm whitespace-pre-line text-body-md text-on-surface-variant">{active.prompt}</p>
              <div className="mt-md">
                <CopyPromptButton
                  text={active.promptIds?.[0] ? (promptById(active.promptIds[0])?.text ?? active.prompt) : active.prompt}
                  promptId={active.promptIds?.[0] ?? active.id}
                />
              </div>
            </div>

            {(active.faqIds ?? []).length > 0 ? (
              <div className="mt-lg">
                <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Dúvidas relacionadas</p>
                <ul className="mt-sm space-y-sm">
                  {(active.faqIds ?? [])
                    .map((id) => faqById(id))
                    .filter((f): f is NonNullable<typeof f> => Boolean(f))
                    .map((f) => (
                      <li key={f.id} className="rounded-xl border border-outline-variant/40 p-md">
                        <p className="font-label text-label-md font-bold text-on-surface">{f.question}</p>
                        <p className="mt-1 text-body-sm text-on-surface-variant">{f.answer[0]}</p>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-lg">
              <HelpfulFeedback contentId={active.id} contentType="situacao" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SituationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 p-md">
      <dt className="font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">{label}</dt>
      <dd className="mt-1 text-body-sm text-on-surface">{value}</dd>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaSituacoesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="situacoes" element={<InovaGuiaSituacoesPage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaSituacoesPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaSituacoesPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Situações do Guia AI First"
```

---

## Task 9: Página Na Prática (ciclo, comportamentos, exercícios, por área)

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaNaPraticaPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaNaPraticaPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `Chip`, `CopyPromptButton`, `SectionHeading`; `areaName`, `areas`, `behaviorQuiz`, `behaviorsDo`, `behaviorsDont`, `cycleSteps`, `deliveryChecklist`, `exercises`, `weeklyChallenge`, `weeklyDiscovery` (`content/library.ts`); `promptById`; `useGuiaLocalState` (Task 3).
- Produces: `NaPraticaSections(): JSX.Element` **exportado** (Task 15/Cases reaproveita), rota `/comunidade-inova/guia/na-pratica`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaNaPraticaPage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { InovaGuiaNaPraticaPage } from './InovaGuiaNaPraticaPage'
import { exercises } from '../content/library'

describe('InovaGuiaNaPraticaPage', () => {
  beforeEach(() => window.localStorage.clear())

  it('mostra o ciclo por padrão e troca de aba para Exercícios', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaNaPraticaPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Do princípio ao hábito')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Exercícios' }))
    expect(screen.getByText(exercises[0]!.title)).toBeInTheDocument()
  })

  it('marca um exercício como feito e persiste', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaNaPraticaPage />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Exercícios' }))
    await userEvent.click(screen.getAllByRole('button', { name: /marcar como feito/i })[0]!)
    expect(screen.getAllByRole('button', { name: /^feito$/i })[0]).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaNaPraticaPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaNaPraticaPage.tsx
import { useMemo, useState } from 'react'
import { Icon } from '../../../../components/Icon'
import { Chip } from '../components/Chip'
import { CopyPromptButton } from '../components/CopyPromptButton'
import { SectionHeading } from '../components/SectionHeading'
import {
  areaName,
  areas,
  behaviorQuiz,
  behaviorsDo,
  behaviorsDont,
  cycleSteps,
  deliveryChecklist,
  exercises,
  weeklyChallenge,
  weeklyDiscovery,
} from '../content/library'
import { promptById } from '../content/prompts'
import { cx } from '../lib/cx'
import { useGuiaLocalState } from '../lib/useGuiaLocalState'

type Tab = 'ciclo' | 'comportamentos' | 'exercicios' | 'areas'

const TABS: { id: Tab; label: string }[] = [
  { id: 'ciclo', label: 'Ciclo AI First' },
  { id: 'comportamentos', label: 'Comportamentos' },
  { id: 'exercicios', label: 'Exercícios' },
  { id: 'areas', label: 'Por área' },
]

export function NaPraticaSections() {
  const [tab, setTab] = useState<Tab>('ciclo')
  const challengePrompt = promptById(weeklyChallenge.promptId)
  const discoveryPrompt = promptById(weeklyDiscovery.promptId)

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="AI First na prática"
        title="Do princípio ao hábito"
        description="Aqui a cultura vira rotina: um ciclo para seguir, comportamentos para reconhecer, exercícios curtos para praticar."
      />

      <div className="grid gap-md lg:grid-cols-2">
        <article className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">{weeklyChallenge.title}</p>
          <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{weeklyChallenge.text}</h3>
          <p className="mt-sm text-body-md text-on-surface-variant">{weeklyChallenge.instruction}</p>
          {challengePrompt ? (
            <div className="mt-md">
              <CopyPromptButton text={challengePrompt.text} promptId={challengePrompt.id} label="Copiar prompt do desafio" />
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl bg-primary p-lg text-on-primary">
          <p className="font-label text-label-md font-bold uppercase tracking-wide">{weeklyDiscovery.title}</p>
          <h3 className="mt-sm font-headline text-headline-sm">{weeklyDiscovery.highlight}</h3>
          <p className="mt-sm text-body-sm">{weeklyDiscovery.text}</p>
          {discoveryPrompt ? (
            <div className="mt-md">
              <CopyPromptButton text={discoveryPrompt.text} promptId={discoveryPrompt.id} label="Copiar prompt do crítico" />
            </div>
          ) : null}
        </article>
      </div>

      <div>
        <div className="flex flex-wrap gap-xs">
          {TABS.map((t) => (
            <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </Chip>
          ))}
        </div>
        <div className="mt-lg">
          {tab === 'ciclo' && <CycleTab />}
          {tab === 'comportamentos' && <BehaviorsTab />}
          {tab === 'exercicios' && <ExercisesTab />}
          {tab === 'areas' && <AreasTab />}
        </div>
      </div>
    </div>
  )
}

function CycleTab() {
  const [checked, setChecked] = useGuiaLocalState<string[]>('checklist-entrega', [])

  return (
    <div className="grid gap-lg lg:grid-cols-[1.15fr_1fr]">
      <ol className="space-y-sm">
        {cycleSteps.map((step) => (
          <li key={step.n} className="flex gap-md rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{step.n}</span>
            <div>
              <p className="font-label text-label-md font-bold text-on-surface">{step.title}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <aside className="h-fit rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Checklist antes de entregar</p>
        <ul className="mt-md space-y-xs">
          {deliveryChecklist.map((item) => {
            const isChecked = checked.includes(item)
            return (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => setChecked((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]))}
                  aria-pressed={isChecked}
                  className={cx(
                    'flex w-full items-start gap-sm rounded-xl border p-sm text-left text-body-sm',
                    isChecked ? 'border-primary bg-surface text-on-surface' : 'border-outline-variant/40 bg-surface text-on-surface-variant',
                  )}
                >
                  <Icon name="check_circle" filled={isChecked} className="mt-0.5 shrink-0 text-[18px]" />
                  <span>{item}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
    </div>
  )
}

function BehaviorsTab() {
  const [answers, setAnswers] = useState<Record<string, boolean>>({})

  return (
    <div className="flex flex-col gap-2xl">
      <div className="grid gap-md lg:grid-cols-2">
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Comportamentos que fazem a diferença</p>
          <ul className="mt-md space-y-sm">
            {behaviorsDo.map((b) => (
              <li key={b} className="flex gap-sm text-body-sm text-on-surface-variant">
                <Icon name="check_circle" className="mt-0.5 shrink-0 text-[18px] text-approved" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-warn">O que não é AI First</p>
          <ul className="mt-md space-y-sm">
            {behaviorsDont.map((b) => (
              <li key={b} className="flex gap-sm text-body-sm text-on-surface-variant">
                <Icon name="cancel" className="mt-0.5 shrink-0 text-[18px] text-warn" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <SectionHeading eyebrow="Isso é AI First?" title="Seis cenários para calibrar o olhar" description="Responda e veja a explicação." />
        <ul className="mt-lg grid gap-md lg:grid-cols-2">
          {behaviorQuiz.map((q) => {
            const answered = q.id in answers
            const correct = answers[q.id] === q.isAiFirst
            return (
              <li key={q.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="text-body-sm text-on-surface">{q.scenario}</p>
                {!answered ? (
                  <div className="mt-md flex gap-sm">
                    <button type="button" onClick={() => setAnswers((a) => ({ ...a, [q.id]: true }))} className="min-h-9 rounded-full border border-outline-variant/60 px-md text-label-sm hover:border-primary/60">
                      É AI First
                    </button>
                    <button type="button" onClick={() => setAnswers((a) => ({ ...a, [q.id]: false }))} className="min-h-9 rounded-full border border-outline-variant/60 px-md text-label-sm hover:border-primary/60">
                      Não é
                    </button>
                  </div>
                ) : (
                  <div className={cx('mt-md rounded-xl border-l-4 p-sm text-body-sm', correct ? 'border-approved bg-approved-tint text-on-surface' : 'border-warn bg-surface text-on-surface-variant')}>
                    <strong className="font-bold">{correct ? 'Isso mesmo. ' : 'Quase lá. '}</strong>
                    {q.explanation}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function ExercisesTab() {
  const [done, setDone] = useGuiaLocalState<string[]>('exercicios-feitos', [])

  return (
    <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
      {exercises.map((ex) => {
        const complete = done.includes(ex.id)
        return (
          <li key={ex.id}>
            <article className={cx('flex h-full flex-col rounded-2xl border bg-surface-container-low p-lg', complete ? 'border-primary' : 'border-outline-variant/40')}>
              <span className="inline-flex items-center gap-xs text-body-sm text-on-surface-variant">
                <Icon name="schedule" className="text-[16px]" /> {ex.minutes} min
              </span>
              <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{ex.title}</h3>
              <p className="mt-sm flex-1 text-body-sm text-on-surface-variant">{ex.description}</p>
              <button
                type="button"
                onClick={() => setDone((prev) => (complete ? prev.filter((x) => x !== ex.id) : [...prev, ex.id]))}
                className={cx(
                  'mt-md inline-flex min-h-9 items-center justify-center gap-xs rounded-full border px-md text-label-sm',
                  complete ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/60',
                )}
              >
                <Icon name="check_circle" className="text-[16px]" /> {complete ? 'Feito' : 'Marcar como feito'}
              </button>
            </article>
          </li>
        )
      })}
    </ul>
  )
}

function AreasTab() {
  const [selected, setSelected] = useState(areas[0]!.id)
  const area = useMemo(() => areas.find((a) => a.id === selected) ?? areas[0]!, [selected])

  return (
    <div className="grid gap-lg lg:grid-cols-[260px_1fr]">
      <ul className="flex gap-xs overflow-x-auto lg:flex-col">
        {areas.map((a) => (
          <li key={a.id} className="shrink-0">
            <button
              type="button"
              onClick={() => setSelected(a.id)}
              className={cx(
                'w-full whitespace-nowrap rounded-full border px-md py-sm text-left text-label-sm lg:whitespace-normal lg:rounded-xl',
                a.id === selected ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant/60 bg-surface text-on-surface-variant hover:border-primary/60',
              )}
            >
              {a.name}
            </button>
          </li>
        ))}
      </ul>

      <article className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <h3 className="font-headline text-headline-sm text-on-surface">{area.name}</h3>
        <p className="mt-sm text-body-md text-on-surface-variant">{area.help}</p>
        <div className="mt-md grid gap-md sm:grid-cols-2">
          <div className="rounded-xl border border-outline-variant/40 bg-surface p-md">
            <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">Exemplos de uso</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{area.examples}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/40 bg-surface p-md">
            <p className="font-label text-label-sm font-bold uppercase tracking-wide text-warn">O que continua humano</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{area.human}</p>
          </div>
        </div>
      </article>
    </div>
  )
}

export function InovaGuiaNaPraticaPage() {
  return <NaPraticaSections />
}
```

Nota: `areaName` é importado mas não usado diretamente nesta página (é usado por `InovaGuiaVideosPage`, Task 10) — remova o import se o linter/`tsc --noEmit` acusar import não utilizado.

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaNaPraticaPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="na-pratica" element={<InovaGuiaNaPraticaPage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaNaPraticaPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaNaPraticaPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Na Prática do Guia AI First"
```

---

## Task 10: Página Vídeos

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaVideosPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaVideosPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `SectionHeading`; `videos` (`content/videos.ts`); `areaName` (`content/library.ts`).
- Produces: `VideosSection(): JSX.Element` **exportado** (reaproveitado por nenhuma outra task, mas mantido como componente separado para paridade com o original), rota `/comunidade-inova/guia/videos`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaVideosPage.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InovaGuiaVideosPage } from './InovaGuiaVideosPage'
import { videos } from '../content/videos'

describe('InovaGuiaVideosPage', () => {
  it('lista os vídeos do catálogo', () => {
    render(<InovaGuiaVideosPage />)
    expect(screen.getByText(videos[0]!.title)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaVideosPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaVideosPage.tsx
import { Icon } from '../../../../components/Icon'
import { SectionHeading } from '../components/SectionHeading'
import { areaName } from '../content/library'
import { videos } from '../content/videos'

export function VideosSection() {
  return (
    <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
      {videos.map((v) => (
        <li key={v.id}>
          <article className="flex h-full flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
            <div className="grid aspect-video place-items-center rounded-xl bg-primary/10">
              <Icon name="play_circle" className="text-[40px] text-primary" />
            </div>
            <p className="mt-md font-label text-label-sm font-bold uppercase tracking-wide text-primary">
              {v.category} · {v.duration} · {areaName(v.area)}
            </p>
            <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{v.title}</h3>
            <p className="mt-sm flex-1 text-body-sm text-on-surface-variant">{v.description}</p>
            <p className="mt-md border-t border-outline-variant/40 pt-sm text-body-sm text-on-surface-variant">
              <strong className="font-bold text-on-surface">Comportamento. </strong>
              {v.behavior}
            </p>
            <span className="mt-md inline-flex w-fit rounded-full border border-outline-variant/60 px-md py-1 text-label-sm text-on-surface-variant">
              {v.status === 'publicado' ? 'Disponível' : 'Em breve'}
            </span>
          </article>
        </li>
      ))}
    </ul>
  )
}

export function InovaGuiaVideosPage() {
  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading eyebrow="Biblioteca audiovisual" title="Vídeos" description="Conteúdos curtos para entender comportamentos AI First e aplicar no dia a dia." />
      <VideosSection />
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaVideosPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="videos" element={<InovaGuiaVideosPage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaVideosPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaVideosPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Vídeos do Guia AI First"
```

---

## Task 11: Página Prompts

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaPromptsPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaPromptsPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `Chip`, `CopyPromptButton`, `SectionHeading`; `promptCategories`, `prompts` (`content/prompts.ts`); `aiRoles`, `areaName` (`content/library.ts`); `useGuiaFavorites`; `trackEvent`.
- Produces: rota `/comunidade-inova/guia/prompts`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaPromptsPage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { InovaGuiaPromptsPage } from './InovaGuiaPromptsPage'
import { prompts } from '../content/prompts'

describe('InovaGuiaPromptsPage', () => {
  beforeEach(() => window.localStorage.clear())

  it('lista os prompts e filtra por busca', async () => {
    render(<InovaGuiaPromptsPage />)
    const primeiro = prompts[0]!
    expect(screen.getByText(primeiro.title)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/buscar prompts/i), 'termo-inexistente-em-qualquer-prompt')
    expect(screen.queryByText(primeiro.title)).not.toBeInTheDocument()
  })

  it('favorita um prompt', async () => {
    render(<InovaGuiaPromptsPage />)
    const primeiro = prompts[0]!
    await userEvent.click(screen.getByRole('button', { name: `Salvar prompt` }))
    expect(screen.getByRole('button', { name: 'Remover dos salvos' })).toBeInTheDocument()
    void primeiro
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaPromptsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaPromptsPage.tsx
import { useMemo, useState } from 'react'
import { Icon } from '../../../../components/Icon'
import { Chip } from '../components/Chip'
import { CopyPromptButton } from '../components/CopyPromptButton'
import { SectionHeading } from '../components/SectionHeading'
import { aiRoles, areaName } from '../content/library'
import { promptCategories, prompts } from '../content/prompts'
import { useGuiaFavorites } from '../lib/useGuiaLocalState'

const PCTFR = [
  { letter: 'P', name: 'Papel', description: 'Defina qual papel específico a IA deve assumir (ex: especialista em FP&A).' },
  { letter: 'C', name: 'Contexto', description: 'Forneça setor, tamanho da empresa, sistemas e objetivo para evitar interpretações erradas.' },
  { letter: 'T', name: 'Tarefa', description: 'Ação clara, direta e mensurável (ex: analise as 10 maiores variações).' },
  { letter: 'F', name: 'Formato', description: 'Como a resposta deve ser entregue (ex: tabela, bullets, resumo executivo).' },
  { letter: 'R', name: 'Restrições', description: 'Regras e limites (ex: não invente dados, limite a 500 palavras).' },
] as const

const PCTFR_TEMPLATE = `Papel: Atue como [papel específico].
Contexto: [contexto necessário para compreender o problema].
Tarefa: [verbo de ação + resultado esperado + escopo].
Formato: Entregue em [formato desejado].
Restrições: [regras, limites e premissas a respeitar].`

export function InovaGuiaPromptsPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('todas')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const favorites = useGuiaFavorites('prompt')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return prompts.filter((item) => {
      if (category !== 'todas' && item.category !== category) return false
      if (onlyFavorites && !favorites.has(item.id)) return false
      if (!q) return true
      return [item.title, item.description, item.whenToUse, item.text, ...item.tags].join(' ').toLowerCase().includes(q)
    })
  }, [query, category, onlyFavorites, favorites])

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Prompt Lab"
        title="Prompts prontos para as tarefas reais"
        description="Copie, ajuste as variáveis entre colchetes e valide o resultado."
      />

      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Metodologia: regra PCTFR</p>
        <p className="mt-1 text-body-sm text-on-surface-variant">A estrutura ideal para construir prompts eficientes e precisos.</p>
        <ul className="mt-lg grid gap-md sm:grid-cols-2 lg:grid-cols-5">
          {PCTFR.map((step) => (
            <li key={step.letter} className="rounded-xl border border-outline-variant/40 bg-surface p-md">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{step.letter}</span>
              <p className="mt-sm font-label text-label-md font-bold text-on-surface">{step.name}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{step.description}</p>
            </li>
          ))}
        </ul>
        <div className="mt-lg rounded-xl border border-outline-variant/40 bg-surface p-md">
          <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">Estrutura-base</p>
          <pre className="mt-sm whitespace-pre-wrap font-sans text-body-sm text-on-surface">{PCTFR_TEMPLATE}</pre>
          <div className="mt-md">
            <CopyPromptButton text={PCTFR_TEMPLATE} promptId="pctfr-estrutura-base" label="Copiar estrutura" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar prompt por tarefa, área ou palavra-chave"
          aria-label="Buscar prompts"
          className="min-h-11 w-full rounded-full border border-outline-variant/60 bg-surface px-lg text-body-md outline-none focus:border-primary"
        />
        <div className="mt-md flex flex-wrap gap-xs">
          <Chip active={category === 'todas'} onClick={() => setCategory('todas')}>
            Todas as tarefas
          </Chip>
          {promptCategories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
          <Chip active={onlyFavorites} onClick={() => setOnlyFavorites((v) => !v)}>
            Meus salvos
          </Chip>
        </div>
      </div>

      <ul className="grid gap-md lg:grid-cols-2">
        {filtered.map((item) => (
          <li key={item.id}>
            <article className="flex h-full flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <div className="flex items-start justify-between gap-sm">
                <div>
                  <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">
                    {item.category} · {areaName(item.area)}
                  </p>
                  <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{item.title}</h3>
                </div>
                <button
                  type="button"
                  aria-label={favorites.has(item.id) ? 'Remover dos salvos' : 'Salvar prompt'}
                  onClick={() => favorites.toggle(item.id)}
                  className="rounded-full p-xs text-on-surface-variant hover:text-primary"
                >
                  <Icon name="favorite" filled={favorites.has(item.id)} className="text-[18px]" />
                </button>
              </div>

              <p className="mt-sm text-body-sm text-on-surface-variant">{item.description}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                <strong className="font-bold text-on-surface">Quando usar. </strong>
                {item.whenToUse}
              </p>

              <pre className="mt-md flex-1 whitespace-pre-wrap rounded-xl border border-outline-variant/40 bg-surface p-md text-body-sm text-on-surface">{item.text}</pre>

              {item.variables.length > 0 ? (
                <div className="mt-sm flex flex-wrap gap-xs">
                  {item.variables.map((v) => (
                    <span key={v} className="rounded-full border border-outline-variant/60 px-sm py-1 text-label-sm text-on-surface-variant">
                      {v}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-md">
                <CopyPromptButton text={item.text} promptId={item.id} />
              </div>
            </article>
          </li>
        ))}
      </ul>

      <section>
        <SectionHeading eyebrow="Papéis da IA" title="Peça à IA que assuma um papel" />
        <ul className="mt-lg grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {aiRoles.map((r) => (
            <li key={r.role} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <p className="font-label text-label-md font-bold text-on-surface">{r.role}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{r.when}</p>
              <p className="mt-sm text-body-sm text-primary">{r.questions}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaPromptsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="prompts" element={<InovaGuiaPromptsPage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaPromptsPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaPromptsPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Prompts do Guia AI First"
```

---

## Task 12: Página Maturidade

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaMaturidadePage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaMaturidadePage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `SectionHeading`, `StatBar`; `exerciseById`, `maturityLevels`, `maturityQuestions`, `maturityScale` (`content/library.ts`); `useGuiaLocalState`; `trackEvent`.
- Produces: `levelFromScore(score: number): number` (função pura exportada para teste), rota `/comunidade-inova/guia/maturidade`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaMaturidadePage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InovaGuiaMaturidadePage, levelFromScore } from './InovaGuiaMaturidadePage'
import { maturityQuestions } from '../content/library'
import * as analytics from '../../../../lib/analytics'

describe('levelFromScore', () => {
  it('calcula o nível 1 para a pontuação mínima', () => {
    expect(levelFromScore(maturityQuestions.length * 1)).toBe(1)
  })

  it('calcula o nível 5 para a pontuação máxima', () => {
    expect(levelFromScore(maturityQuestions.length * 5)).toBe(5)
  })
})

describe('InovaGuiaMaturidadePage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
  })

  it('mostra o nível após responder as dez perguntas com nota máxima', async () => {
    render(<InovaGuiaMaturidadePage />)

    for (let i = 0; i < maturityQuestions.length; i++) {
      const grupo = screen.getAllByRole('button', { name: 'Já faz parte da minha rotina' })
      await userEvent.click(grupo[i]!)
    }

    expect(await screen.findByText(/nível 5/i)).toBeInTheDocument()
    expect(analytics.trackEvent).toHaveBeenCalledWith('inova_guia_maturidade_respondida', { nivel: 5 })
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaMaturidadePage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaMaturidadePage.tsx
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { SectionHeading } from '../components/SectionHeading'
import { StatBar } from '../components/StatBar'
import { exerciseById, maturityLevels, maturityQuestions, maturityScale } from '../content/library'
import { cx } from '../lib/cx'
import { useGuiaLocalState } from '../lib/useGuiaLocalState'

export function levelFromScore(score: number) {
  const pct = (score / (maturityQuestions.length * 5)) * 100
  if (pct < 32) return 1
  if (pct < 50) return 2
  if (pct < 68) return 3
  if (pct < 86) return 4
  return 5
}

export function InovaGuiaMaturidadePage() {
  const [answers, setAnswers] = useGuiaLocalState<Record<string, number>>('maturidade', {})
  const answered = Object.keys(answers).length
  const complete = answered === maturityQuestions.length
  const score = Object.values(answers).reduce((a, b) => a + b, 0)
  const level = complete ? levelFromScore(score) : null
  const levelInfo = level ? maturityLevels.find((l) => l.level === level)! : null
  const exercise = levelInfo?.exerciseId ? exerciseById(levelInfo.exerciseId) : undefined

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Autodiagnóstico"
        title="Qual é o seu momento AI First?"
        description="Dez perguntas, resposta honesta. Não existe nota, ranking nem envio para gestores — a resposta fica só neste navegador."
      />

      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <StatBar value={(answered / maturityQuestions.length) * 100} label={`${answered} de ${maturityQuestions.length} respondidas`} />

        <ol className="mt-lg space-y-md">
          {maturityQuestions.map((q, i) => (
            <li key={q}>
              <p className="text-body-md text-on-surface">
                <span className="mr-sm text-on-surface-variant">{i + 1}.</span>
                {q}
              </p>
              <div className="mt-sm flex flex-wrap gap-xs">
                {maturityScale.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setAnswers((prev) => {
                        const next = { ...prev, [`q${i}`]: opt.value }
                        if (Object.keys(next).length === maturityQuestions.length) {
                          trackEvent('inova_guia_maturidade_respondida', {
                            nivel: levelFromScore(Object.values(next).reduce((a, b) => a + b, 0)),
                          })
                        }
                        return next
                      })
                    }}
                    className={cx(
                      'min-h-9 rounded-full border px-md text-label-sm',
                      answers[`q${i}`] === opt.value ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant/60 bg-surface text-on-surface-variant hover:border-primary/60',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {complete && levelInfo ? (
          <div className="mt-2xl rounded-2xl border border-outline-variant/40 bg-surface p-lg">
            <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Seu momento</p>
            <h3 className="mt-sm font-headline text-headline-md text-on-surface">
              Nível {levelInfo.level} · {levelInfo.name}
            </h3>
            <p className="mt-sm text-body-md text-on-surface-variant">{levelInfo.description}</p>
            <div className="mt-lg grid gap-md sm:grid-cols-2">
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
                <p className="font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Sua força</p>
                <p className="mt-1 text-body-sm text-on-surface">{levelInfo.strengths}</p>
              </div>
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
                <p className="font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Próximo passo</p>
                <p className="mt-1 text-body-sm text-on-surface">{levelInfo.nextStep}</p>
              </div>
            </div>
            <ul className="mt-lg space-y-xs">
              {levelInfo.actions.map((a) => (
                <li key={a} className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-sm text-body-sm text-on-surface-variant">
                  {a}
                </li>
              ))}
            </ul>
            {exercise ? (
              <p className="mt-lg text-body-sm text-on-surface-variant">
                <strong className="font-bold text-on-surface">Exercício sugerido. </strong>
                {exercise.title}, {exercise.description}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setAnswers({})}
              className="mt-lg inline-flex min-h-11 items-center gap-xs rounded-full border border-outline-variant/60 px-lg font-label text-label-md text-primary hover:border-primary/60"
            >
              <Icon name="restart_alt" className="text-[18px]" /> Refazer
            </button>
          </div>
        ) : null}
      </div>

      <section>
        <SectionHeading eyebrow="Os cinco níveis" title="Todo mundo começa em algum lugar" />
        <ul className="mt-lg grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {maturityLevels.map((l) => (
            <li key={l.level}>
              <article className={cx('h-full rounded-2xl border bg-surface-container-low p-lg', level === l.level ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/40')}>
                <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">Nível {l.level}</p>
                <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{l.name}</h3>
                <p className="mt-sm text-body-sm text-on-surface-variant">{l.description}</p>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaMaturidadePage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="maturidade" element={<InovaGuiaMaturidadePage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaMaturidadePage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaMaturidadePage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Maturidade do Guia AI First"
```

---

## Task 13: Página Liderança

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaLiderancaPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaLiderancaPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `SectionHeading`; `headcountQuestions`, `leadershipBlocks`, `leadershipChecklist`, `leadershipQuestions` (`content/library.ts`); `trackEvent`.
- Produces: rota `/comunidade-inova/guia/lideranca`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaLiderancaPage.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InovaGuiaLiderancaPage } from './InovaGuiaLiderancaPage'
import * as analytics from '../../../../lib/analytics'

describe('InovaGuiaLiderancaPage', () => {
  it('mostra o título e dispara o evento de seção aberta', () => {
    const spy = vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    render(<InovaGuiaLiderancaPage />)
    expect(screen.getByText('A transformação começa pelo exemplo')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith('inova_guia_lideranca_aberta', {})
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaLiderancaPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaLiderancaPage.tsx
import { useEffect } from 'react'
import { trackEvent } from '../../../../lib/analytics'
import { SectionHeading } from '../components/SectionHeading'
import { headcountQuestions, leadershipBlocks, leadershipChecklist, leadershipQuestions } from '../content/library'

export function InovaGuiaLiderancaPage() {
  useEffect(() => trackEvent('inova_guia_lideranca_aberta', {}), [])

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Liderança"
        title="A transformação começa pelo exemplo"
        description="Ninguém segue quem não pratica. Liderar AI First é usar, perguntar, destravar e continuar assumindo as decisões que são suas."
      />

      <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-4">
        {leadershipBlocks.map((b) => (
          <li key={b.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
            <p className="font-label text-label-md font-bold text-on-surface">{b.title}</p>
            <p className="mt-1 text-body-sm text-on-surface-variant">{b.detail}</p>
          </li>
        ))}
      </ul>

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Perguntas que desenvolvem" title="Estimule com perguntas, não com respostas prontas" />
          <ul className="mt-lg space-y-xs">
            {leadershipQuestions.map((q) => (
              <li key={q} className="rounded-xl border-l-4 border-approved bg-surface-container-low p-md text-on-surface">
                {q}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="Antes de pedir headcount" title="Sete perguntas honestas" />
          <ol className="mt-lg space-y-xs">
            {headcountQuestions.map((q, i) => (
              <li key={q} className="flex gap-sm rounded-xl border border-outline-variant/40 bg-surface-container-low p-md text-body-sm text-on-surface-variant">
                <span className="font-bold text-primary">{i + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <section>
        <SectionHeading
          eyebrow="Checklist da liderança"
          title="Seis perguntas para revisitar todo mês"
          description="Sem burocracia: o que você observa e a evidência que mostra que está acontecendo."
        />
        <ul className="mt-lg grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {leadershipChecklist.map((c) => (
            <li key={c.question} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <p className="font-label text-label-md font-bold text-on-surface">{c.question}</p>
              <p className="mt-sm text-body-sm text-on-surface-variant">
                <strong className="font-bold text-primary">Evidência. </strong>
                {c.evidence}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaLiderancaPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="lideranca" element={<InovaGuiaLiderancaPage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaLiderancaPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaLiderancaPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Liderança do Guia AI First"
```

---

## Task 14: Página Segurança

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaSegurancaPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaSegurancaPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `SectionHeading`; `securityPractices`, `securitySemaphore`, `sensitiveInfo` (`content/library.ts`); `trackEvent`.
- Produces: rota `/comunidade-inova/guia/seguranca`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaSegurancaPage.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InovaGuiaSegurancaPage } from './InovaGuiaSegurancaPage'
import * as analytics from '../../../../lib/analytics'

describe('InovaGuiaSegurancaPage', () => {
  it('mostra o título e dispara o evento de seção aberta', () => {
    const spy = vi.spyOn(analytics, 'trackEvent').mockImplementation(() => {})
    render(<InovaGuiaSegurancaPage />)
    expect(screen.getByText('Antes de compartilhar, confira')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith('inova_guia_seguranca_aberta', {})
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaSegurancaPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaSegurancaPage.tsx
import { useEffect } from 'react'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { SectionHeading } from '../components/SectionHeading'
import { securityPractices, securitySemaphore, sensitiveInfo } from '../content/library'

const BLOCKS = [
  { key: 'pode', data: securitySemaphore.pode, icon: 'verified_user', tone: 'border-approved/60 bg-approved-tint' },
  { key: 'validacao', data: securitySemaphore.validacao, icon: 'help', tone: 'border-outline-variant/40 bg-surface-container-low' },
  { key: 'naoPode', data: securitySemaphore.naoPode, icon: 'gpp_bad', tone: 'border-warn/60 bg-surface' },
] as const

export function InovaGuiaSegurancaPage() {
  useEffect(() => trackEvent('inova_guia_seguranca_aberta', {}), [])

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Segurança"
        title="Antes de compartilhar, confira"
        description="Proteger informação é proteger confiança. Se não tiver certeza se pode compartilhar, a resposta mais segura é não compartilhar ainda."
      />

      <div className="grid gap-md lg:grid-cols-3">
        {BLOCKS.map(({ key, data, icon, tone }) => (
          <article key={key} className={`rounded-2xl border p-lg ${tone}`}>
            <Icon name={icon} className="text-[24px] text-on-surface" />
            <h2 className="mt-md font-headline text-headline-sm text-on-surface">{data.label}</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">{data.subtitle}</p>
            <ul className="mt-md space-y-sm">
              {data.items.map((i) => (
                <li key={i} className="rounded-xl border border-outline-variant/40 bg-surface p-sm text-body-sm text-on-surface-variant">
                  {i}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Informações sensíveis" title="O que exige cuidado redobrado" />
          <ul className="mt-lg space-y-sm">
            {sensitiveInfo.map((i) => (
              <li key={i.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="font-label text-label-md font-bold text-on-surface">{i.title}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{i.detail}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="Boas práticas" title="Cinco hábitos que evitam problema" />
          <ol className="mt-lg space-y-sm">
            {securityPractices.map((p, i) => (
              <li key={p} className="flex gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-label-sm font-bold text-primary">{i + 1}</span>
                <p className="text-body-sm text-on-surface-variant">{p}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaSegurancaPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="seguranca" element={<InovaGuiaSegurancaPage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaSegurancaPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaSegurancaPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Segurança do Guia AI First"
```

---

## Task 15: Página Casos

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaCasesPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaCasesPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `SectionHeading`; `caseFields`, `cases`, `inovaCycle` (`content/cases.ts`, **sem** `CASE_REGISTRATION_URL`); `NaPraticaSections` (Task 9, reaproveitado como no original).
- Produces: rota `/comunidade-inova/guia/cases`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaCasesPage.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaCasesPage } from './InovaGuiaCasesPage'

describe('InovaGuiaCasesPage', () => {
  it('mostra a vitrine vazia de propósito, sem link externo de cadastro', () => {
    render(
      <MemoryRouter>
        <InovaGuiaCasesPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/esta vitrine começa vazia de propósito/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /registrar um case/i })).not.toBeInTheDocument()
    expect(screen.getByText('O ciclo da aprendizagem coletiva')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaCasesPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaCasesPage.tsx
import { SectionHeading } from '../components/SectionHeading'
import { caseFields, cases, inovaCycle } from '../content/cases'
import { NaPraticaSections } from './InovaGuiaNaPraticaPage'

export function InovaGuiaCasesPage() {
  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Comunidade AI First"
        title="AI First acontecendo na INOVA"
        description="Esta vitrine começa vazia de propósito: os cases aqui serão os reais, registrados pelas áreas. Uma vitória rápida conta: um prompt que poupa uma hora por semana, um processo simplificado, uma análise que ficou melhor."
      />

      {cases.length > 0 ? (
        <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {cases.map((c) => (
            <li key={c.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <h3 className="font-headline text-headline-sm text-on-surface">{c.title}</h3>
              <p className="mt-sm text-body-sm text-on-surface-variant">{c.problem}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Trilha INOVA" title="O ciclo da aprendizagem coletiva" />
          <ol className="mt-lg space-y-sm">
            {inovaCycle.map((s, i) => (
              <li key={s.step} className="flex gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-label-sm font-bold text-primary">{i + 1}</span>
                <div>
                  <p className="font-label text-label-md font-bold text-on-surface">{s.step}</p>
                  <p className="mt-1 text-body-sm text-on-surface-variant">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <SectionHeading eyebrow="Como registrar" title="O que um bom case precisa ter" />
          <ul className="mt-lg space-y-sm">
            {caseFields.map((f) => (
              <li key={f.field} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="font-label text-label-md font-bold text-on-surface">{f.field}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{f.describe}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <NaPraticaSections />
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaCasesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="cases" element={<InovaGuiaCasesPage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaCasesPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaCasesPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Casos do Guia AI First"
```

---

## Task 16: Página Guia Completo (convicções, princípios, FAQ, glossário)

**Files:**
- Create: `apps/web/src/pages/inova/guia/pages/InovaGuiaCompletoPage.tsx`
- Test: `apps/web/src/pages/inova/guia/pages/InovaGuiaCompletoPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `Chip`, `SectionHeading`; `faqCategories`, `faqs` (`content/faqs.ts`); `convictions`, `glossary`, `microcopy`, `principles` (`content/library.ts`).
- Produces: rota `/comunidade-inova/guia/completo`.

- [ ] **Step 1: Escrever o teste, com falha esperada**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaCompletoPage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InovaGuiaCompletoPage } from './InovaGuiaCompletoPage'
import { faqs } from '../content/faqs'

describe('InovaGuiaCompletoPage', () => {
  it('mostra a primeira pergunta fechada e abre ao clicar', async () => {
    render(<InovaGuiaCompletoPage />)
    const primeira = faqs[0]!
    expect(screen.getByText(primeira.question)).toBeInTheDocument()
    expect(screen.queryByText(primeira.answer[0]!)).not.toBeInTheDocument()

    await userEvent.click(screen.getByText(primeira.question))
    expect(screen.getByText(primeira.answer[0]!)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaCompletoPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

```tsx
// apps/web/src/pages/inova/guia/pages/InovaGuiaCompletoPage.tsx
import { useState } from 'react'
import { Chip } from '../components/Chip'
import { SectionHeading } from '../components/SectionHeading'
import { faqCategories, faqs } from '../content/faqs'
import { convictions, glossary, microcopy, principles } from '../content/library'
import { cx } from '../lib/cx'

export function InovaGuiaCompletoPage() {
  const [category, setCategory] = useState('todas')
  const [open, setOpen] = useState<string | null>(null)
  const visible = faqs.filter((f) => category === 'todas' || f.category === category)

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Guia AI First"
        title="Por que isso importa e como pensamos"
        description="As convicções que sustentam a cultura, os princípios que guiam o uso e as respostas para as dúvidas que todo mundo tem."
      />

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Convicções" title="No que acreditamos" />
          <ul className="mt-lg space-y-sm">
            {convictions.map((c) => (
              <li key={c.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="font-label text-label-md font-bold text-on-surface">{c.title}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{c.detail}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionHeading eyebrow="Princípios" title="Como usamos IA" />
          <ul className="mt-lg space-y-sm">
            {principles.map((p) => (
              <li key={p.title} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <p className="font-label text-label-md font-bold text-on-surface">{p.title}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{p.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section>
        <SectionHeading
          eyebrow="Perguntas honestas"
          title="As dúvidas que aparecem de verdade"
          description="Sem rodeios: carreira, confiança na IA, uso diário, segurança, ética e aprendizado."
        />
        <div className="mt-lg flex flex-wrap gap-xs">
          <Chip active={category === 'todas'} onClick={() => setCategory('todas')}>
            Todas
          </Chip>
          {faqCategories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
        <ul className="mt-lg space-y-sm">
          {visible.map((f) => {
            const isOpen = open === f.id
            return (
              <li key={f.id} className={cx('rounded-2xl border bg-surface-container-low', isOpen ? 'border-primary' : 'border-outline-variant/40')}>
                <button type="button" onClick={() => setOpen(isOpen ? null : f.id)} aria-expanded={isOpen} className="flex w-full items-start justify-between gap-md p-lg text-left">
                  <span className="font-label text-label-md font-bold text-on-surface">{f.question}</span>
                  <span className="shrink-0 text-on-surface-variant">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen ? (
                  <div className="space-y-sm border-t border-outline-variant/40 p-lg text-body-md text-on-surface-variant">
                    {f.answer.map((a, i) => (
                      <p key={i}>{a}</p>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      <div className="grid gap-2xl lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Glossário" title="Palavras que você vai ouvir" />
          <dl className="mt-lg space-y-sm">
            {glossary.map((g) => (
              <div key={g.term} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <dt className="font-label text-label-md font-bold text-on-surface">{g.term}</dt>
                <dd className="mt-1 text-body-sm text-on-surface-variant">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <SectionHeading eyebrow="Para levar" title="Frases que resumem a cultura" />
          <ul className="mt-lg flex flex-wrap gap-xs">
            {microcopy.map((m) => (
              <li key={m} className="rounded-full border border-outline-variant/60 bg-surface-container-low px-lg py-sm text-label-md text-on-surface">
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/guia/pages/InovaGuiaCompletoPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Registrar a rota** (`App.tsx`: import + `<Route path="completo" element={<InovaGuiaCompletoPage />} />`)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/guia/pages/InovaGuiaCompletoPage.tsx apps/web/src/pages/inova/guia/pages/InovaGuiaCompletoPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): página Guia Completo do Guia AI First"
```

---

## Task 17: Integração final

**Files:**
- Modify: (nenhum — só verificação)

**Interfaces:**
- Consumes: tudo das Tasks 1–16.
- Produces: confirmação de que o módulo inteiro builda, typecheck limpa e a suíte completa passa.

- [ ] **Step 1: Typecheck do workspace web**

Run: `pnpm --filter @legends/web exec tsc -p tsconfig.json --noEmit`
Expected: sem erros

- [ ] **Step 2: Typecheck do shared**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros (ajuste o comando ao script real de `packages/shared/package.json` se `--noEmit` sozinho não bastar — confira `tsconfig.json` do pacote)

- [ ] **Step 3: Suíte completa do web**

Run: `pnpm --filter @legends/web test`
Expected: PASS — inclui todos os testes novos das Tasks 3–16 e o `InovaLayout.test.tsx` atualizado (Task 6).

- [ ] **Step 4: Suíte completa do shared**

Run: `pnpm --filter @legends/shared test`
Expected: PASS

- [ ] **Step 5: Build de produção do web (garante que o bundle fecha com o conteúdo novo)**

Run: `pnpm --filter @legends/web run build`
Expected: build conclui sem erro

- [ ] **Step 6: Suíte completa do monorepo (verificação final, com Postgres de pé)**

Run: `pnpm db:up && pnpm test`
Expected: PASS em todos os workspaces (api/web/shared)

- [ ] **Step 7: Commit final, se sobrar algo pendente de ajuste feito durante a integração**

```bash
git status
# se houver ajustes de integração não commitados ainda:
git add -A
git commit -m "fix(inova): ajustes finais de integração do Guia AI First"
```
