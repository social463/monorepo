# Blur e fundos virtuais na câmera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o usuário aplicar desfoque (leve/forte) ou a imagem institucional do EMR como fundo da própria câmera no escritório virtual — efeito no vídeo publicado, visível para todos.

**Architecture:** Um hook `useCameraBackground` (chamado na `OfficePage` ao lado do `useOfficeMedia`) aplica processors do pacote oficial `@livekit/track-processors` no `LocalVideoTrack` da câmera de forma declarativa (effect em `[track, background]`), com escolha persistida em `localStorage` e reaplicada quando a câmera religa. A UI é um split button no botão de câmera da `MediaBar` que abre o painel `CameraBackgroundMenu`. O pacote (MediaPipe/WASM) entra só por `import()` dinâmico.

**Tech Stack:** React 18, livekit-client v2, `@livekit/track-processors`, Tailwind, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-16-camera-fundo-virtual-design.md`

## Global Constraints

- TypeScript **strict**, ESM puro; monorepo pnpm — comandos a partir da raiz.
- Mensagens visíveis ao usuário em **português**; comentários pt-BR no estilo vizinho.
- Testes `*.test.ts(x)` colocados ao lado do código; web usa jsdom.
- `@livekit/track-processors` (e o MediaPipe que ele puxa) NÃO pode entrar no bundle principal (`index-*.js`) nem no chunk da `OfficePage` — só via `import()` dinâmico.
- Raios do blur: **leve = 5, forte = 15**. Chave de storage: **`legends:camera-background`**.
- Galeria: UMA imagem — id `emr`, label "Fundo EMR", src `/office/camera-backgrounds/emr.jpg` (asset já commitado em `apps/web/public/office/camera-backgrounds/emr.jpg`).
- Branch de trabalho: `feat/camera-fundo-virtual`. Commits em pt-BR terminando com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Dependência, catálogo e loader dinâmico

Instala `@livekit/track-processors`, verifica os exports reais do pacote, e cria o catálogo de fundos + o loader com cache (mesmo padrão de lazy-load usado no repo para módulos pesados).

**Files:**
- Modify: `apps/web/package.json` (via `pnpm add`)
- Create: `apps/web/src/office/media/camera-backgrounds.ts`
- Create: `apps/web/src/office/media/camera-backgrounds.test.ts`
- Create: `apps/web/src/office/media/track-processors-loader.ts`

**Interfaces:**
- Consumes: `@livekit/track-processors` (módulo inteiro, via `import()`).
- Produces (para Tasks 2–3):

```ts
// camera-backgrounds.ts
export type CameraBackgroundId = 'none' | 'blur-leve' | 'blur-forte' | `img:${string}`
export interface CameraBackgroundImage { id: string; label: string; src: string }
export const CAMERA_BACKGROUNDS: CameraBackgroundImage[]  // [{ id: 'emr', label: 'Fundo EMR', src: '/office/camera-backgrounds/emr.jpg' }]
export const CAMERA_BACKGROUND_STORAGE_KEY = 'legends:camera-background'
export function isCameraBackgroundId(value: string | null): value is CameraBackgroundId

// track-processors-loader.ts
export async function loadTrackProcessors(): Promise<typeof import('@livekit/track-processors')>
```

- [ ] **Step 1: Instalar e verificar os exports do pacote**

Run: `pnpm --filter @legends/web add @livekit/track-processors`
Depois: `pnpm --filter @legends/web exec node -e "import('@livekit/track-processors').then((m) => console.log(Object.keys(m).sort().join('\n')))"`
Expected: a lista contém `BackgroundBlur`, `VirtualBackground` e uma função de suporte (`supportsBackgroundProcessors` — em versões mais novas pode haver também `supportsModernBackgroundProcessors`). **Se os nomes divergirem** (ex.: só `BackgroundProcessor`/`ProcessorWrapper.isSupported`), adapte o mapeamento no hook da Task 2 mantendo o contrato do plano e registre a deviação no report.

- [ ] **Step 2: Escrever o teste do catálogo**

```ts
// apps/web/src/office/media/camera-backgrounds.test.ts
import { describe, expect, it } from 'vitest'
import { CAMERA_BACKGROUNDS, isCameraBackgroundId } from './camera-backgrounds'

describe('camera-backgrounds', () => {
  it('catálogo tem o fundo EMR com src servido de public/', () => {
    expect(CAMERA_BACKGROUNDS).toEqual([
      { id: 'emr', label: 'Fundo EMR', src: '/office/camera-backgrounds/emr.jpg' },
    ])
  })

  it('valida ids conhecidos e rejeita o resto', () => {
    expect(isCameraBackgroundId('none')).toBe(true)
    expect(isCameraBackgroundId('blur-leve')).toBe(true)
    expect(isCameraBackgroundId('blur-forte')).toBe(true)
    expect(isCameraBackgroundId('img:emr')).toBe(true)
    expect(isCameraBackgroundId('img:nao-existe')).toBe(false)
    expect(isCameraBackgroundId('qualquer-coisa')).toBe(false)
    expect(isCameraBackgroundId(null)).toBe(false)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/camera-backgrounds.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar catálogo e loader**

```ts
// apps/web/src/office/media/camera-backgrounds.ts
export type CameraBackgroundId = 'none' | 'blur-leve' | 'blur-forte' | `img:${string}`

export interface CameraBackgroundImage {
  id: string
  label: string
  src: string
}

/** Galeria fixa — hoje só o fundo institucional; lista para crescer sem mexer no resto. */
export const CAMERA_BACKGROUNDS: CameraBackgroundImage[] = [
  { id: 'emr', label: 'Fundo EMR', src: '/office/camera-backgrounds/emr.jpg' },
]

export const CAMERA_BACKGROUND_STORAGE_KEY = 'legends:camera-background'

export function isCameraBackgroundId(value: string | null): value is CameraBackgroundId {
  if (value === 'none' || value === 'blur-leve' || value === 'blur-forte') return true
  if (value?.startsWith('img:')) {
    return CAMERA_BACKGROUNDS.some((bg) => `img:${bg.id}` === value)
  }
  return false
}
```

```ts
// apps/web/src/office/media/track-processors-loader.ts
import type * as TrackProcessors from '@livekit/track-processors'

/**
 * Carrega o @livekit/track-processors sob demanda. O pacote puxa o MediaPipe
 * (WASM pesado) — só é baixado quando alguém aplica um efeito de fundo pela
 * primeira vez; nada dele entra no bundle principal.
 */
let cached: typeof TrackProcessors | null = null

export async function loadTrackProcessors(): Promise<typeof TrackProcessors> {
  if (!cached) cached = await import('@livekit/track-processors')
  return cached
}
```

- [ ] **Step 5: Rodar e ver passar + typecheck**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/camera-backgrounds.test.ts && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS / sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/office/media/camera-backgrounds.ts apps/web/src/office/media/camera-backgrounds.test.ts apps/web/src/office/media/track-processors-loader.ts
git commit -m "feat(web): catálogo de fundos de câmera e loader do track-processors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Hook `useCameraBackground`

O dono do efeito: estado + persistência + aplicação declarativa do processor no track atual.

**Files:**
- Create: `apps/web/src/office/media/useCameraBackground.ts`
- Create: `apps/web/src/office/media/useCameraBackground.test.ts`

**Interfaces:**
- Consumes: `loadTrackProcessors()` (Task 1), `CAMERA_BACKGROUNDS`/`CAMERA_BACKGROUND_STORAGE_KEY`/`isCameraBackgroundId` (Task 1), `LocalVideoTrack` (type, livekit-client).
- Produces (para Tasks 3–4):

```ts
export interface CameraBackgroundState {
  background: CameraBackgroundId
  setBackground(id: CameraBackgroundId): void
  supported: boolean
  error: boolean
}
export function useCameraBackground(localCameraTrack: LocalVideoTrack | null): CameraBackgroundState
```

- [ ] **Step 1: Escrever os testes**

```ts
// apps/web/src/office/media/useCameraBackground.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { LocalVideoTrack } from 'livekit-client'
import { CAMERA_BACKGROUND_STORAGE_KEY } from './camera-backgrounds'
import { loadTrackProcessors } from './track-processors-loader'
import { useCameraBackground } from './useCameraBackground'

vi.mock('./track-processors-loader', () => ({ loadTrackProcessors: vi.fn() }))

const blurInstance = { kind: 'blur' }
const virtualInstance = { kind: 'virtual' }
const processorsMock = {
  BackgroundBlur: vi.fn(() => blurInstance),
  VirtualBackground: vi.fn(() => virtualInstance),
  supportsBackgroundProcessors: vi.fn(() => true),
}

function fakeTrack() {
  return {
    setProcessor: vi.fn(async () => {}),
    stopProcessor: vi.fn(async () => {}),
  } as unknown as LocalVideoTrack
}

// jsdom não tem insertable streams — os testes os declaram para simular suporte.
function enableInsertableStreams() {
  ;(window as Record<string, unknown>).MediaStreamTrackProcessor = function () {}
  ;(window as Record<string, unknown>).MediaStreamTrackGenerator = function () {}
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(loadTrackProcessors).mockResolvedValue(processorsMock as never)
  enableInsertableStreams()
})

describe('useCameraBackground', () => {
  it('começa em none sem storage e não mexe no track', () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    expect(result.current.background).toBe('none')
    expect(result.current.supported).toBe(true)
    // none em track recém-criado: stopProcessor é inofensivo (pode ou não ser chamado);
    // o que NÃO pode acontecer é setProcessor.
    expect(track.setProcessor).not.toHaveBeenCalled()
  })

  it('blur-leve aplica BackgroundBlur(5) no track e persiste', async () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalledWith(blurInstance))
    expect(processorsMock.BackgroundBlur).toHaveBeenCalledWith(5)
    expect(localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)).toBe('blur-leve')
  })

  it('blur-forte usa raio 15', async () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-forte'))
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalled())
    expect(processorsMock.BackgroundBlur).toHaveBeenCalledWith(15)
  })

  it('img:emr usa VirtualBackground com o src do catálogo', async () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('img:emr'))
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalledWith(virtualInstance))
    expect(processorsMock.VirtualBackground).toHaveBeenCalledWith('/office/camera-backgrounds/emr.jpg')
  })

  it('voltar para none remove o processor', async () => {
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalled())
    act(() => result.current.setBackground('none'))
    await waitFor(() => expect(track.stopProcessor).toHaveBeenCalled())
    expect(localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)).toBe('none')
  })

  it('reaplica quando o track muda (câmera religada)', async () => {
    const trackA = fakeTrack()
    const { result, rerender } = renderHook(
      ({ track }: { track: LocalVideoTrack | null }) => useCameraBackground(track),
      { initialProps: { track: trackA as LocalVideoTrack | null } },
    )
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(trackA.setProcessor).toHaveBeenCalled())

    const trackB = fakeTrack()
    rerender({ track: trackB })
    await waitFor(() => expect(trackB.setProcessor).toHaveBeenCalledWith(blurInstance))
  })

  it('restaura do storage e aplica quando o track chega', async () => {
    localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, 'img:emr')
    const { result, rerender } = renderHook(
      ({ track }: { track: LocalVideoTrack | null }) => useCameraBackground(track),
      { initialProps: { track: null as LocalVideoTrack | null } },
    )
    expect(result.current.background).toBe('img:emr')

    const track = fakeTrack()
    rerender({ track })
    await waitFor(() => expect(track.setProcessor).toHaveBeenCalledWith(virtualInstance))
  })

  it('storage inválido vira none', () => {
    localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, 'img:nao-existe')
    const { result } = renderHook(() => useCameraBackground(null))
    expect(result.current.background).toBe('none')
  })

  it('falha no setProcessor: error=true e volta para none (estado e storage)', async () => {
    const track = fakeTrack()
    vi.mocked(track.setProcessor).mockRejectedValue(new Error('gpu'))
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.background).toBe('none')
    expect(localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)).toBe('none')
  })

  it('pacote reporta não suportado: supported vira false e nada é aplicado', async () => {
    processorsMock.supportsBackgroundProcessors.mockReturnValue(false)
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    act(() => result.current.setBackground('blur-leve'))
    await waitFor(() => expect(result.current.supported).toBe(false))
    expect(track.setProcessor).not.toHaveBeenCalled()
  })

  it('sem insertable streams no browser: supported=false e setBackground de efeito é ignorado', () => {
    delete (window as Record<string, unknown>).MediaStreamTrackProcessor
    delete (window as Record<string, unknown>).MediaStreamTrackGenerator
    const track = fakeTrack()
    const { result } = renderHook(() => useCameraBackground(track))
    expect(result.current.supported).toBe(false)
    act(() => result.current.setBackground('blur-leve'))
    expect(result.current.background).toBe('none')
    expect(track.setProcessor).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useCameraBackground.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o hook**

```ts
// apps/web/src/office/media/useCameraBackground.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalVideoTrack } from 'livekit-client'
import {
  CAMERA_BACKGROUNDS,
  CAMERA_BACKGROUND_STORAGE_KEY,
  isCameraBackgroundId,
  type CameraBackgroundId,
} from './camera-backgrounds'
import { loadTrackProcessors } from './track-processors-loader'

const BLUR_RADII = { 'blur-leve': 5, 'blur-forte': 15 } as const

export interface CameraBackgroundState {
  background: CameraBackgroundId
  setBackground(id: CameraBackgroundId): void
  supported: boolean
  error: boolean
}

/** Pré-checagem barata: os processors exigem insertable streams do browser. */
function hasInsertableStreams(): boolean {
  const w = window as Record<string, unknown>
  return (
    typeof w.MediaStreamTrackProcessor === 'function' &&
    typeof w.MediaStreamTrackGenerator === 'function'
  )
}

function readStoredBackground(): CameraBackgroundId {
  const raw = localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)
  return isCameraBackgroundId(raw) ? raw : 'none'
}

/**
 * Dono do efeito de fundo da câmera. Declarativo: o efeito garante que o
 * processor do track atual corresponde à escolha — religar a câmera (track
 * novo) reaplica sozinho. A escolha persiste em localStorage por dispositivo.
 * O efeito vai no track PUBLICADO: todos os participantes veem o fundo.
 */
export function useCameraBackground(
  localCameraTrack: LocalVideoTrack | null,
): CameraBackgroundState {
  const [background, setBackgroundState] = useState<CameraBackgroundId>(readStoredBackground)
  const [supported, setSupported] = useState(hasInsertableStreams)
  const [error, setError] = useState(false)
  // Geração invalida aplicações em voo quando track/escolha mudam no meio de
  // um await (mesmo padrão do useOfficeMedia).
  const generationRef = useRef(0)

  const setBackground = useCallback(
    (id: CameraBackgroundId) => {
      if (!supported && id !== 'none') return
      setError(false)
      setBackgroundState(id)
      localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, id)
    },
    [supported],
  )

  useEffect(() => {
    const track = localCameraTrack
    if (!track) return
    const gen = ++generationRef.current
    void (async () => {
      try {
        if (background === 'none') {
          await track.stopProcessor()
          return
        }
        const processors = await loadTrackProcessors()
        if (gen !== generationRef.current) return
        if (!processors.supportsBackgroundProcessors()) {
          setSupported(false)
          setBackgroundState('none')
          localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, 'none')
          return
        }
        const processor =
          background === 'blur-leve' || background === 'blur-forte'
            ? processors.BackgroundBlur(BLUR_RADII[background])
            : processors.VirtualBackground(
                CAMERA_BACKGROUNDS.find((bg) => `img:${bg.id}` === background)?.src ?? '',
              )
        await track.setProcessor(processor)
      } catch {
        if (gen !== generationRef.current) return
        // Falha ao aplicar (WASM não carregou, GPU): avisa e volta ao natural.
        setError(true)
        setBackgroundState('none')
        localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, 'none')
        void track.stopProcessor().catch(() => {})
      }
    })()
  }, [localCameraTrack, background])

  return { background, setBackground, supported, error }
}
```

- [ ] **Step 4: Rodar e ver passar + typecheck**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useCameraBackground.test.ts && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS (11 testes) / sem erros. Se o Step 1 da Task 1 revelou nomes de export diferentes, ajuste aqui e nos mocks mantendo o contrato.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/useCameraBackground.ts apps/web/src/office/media/useCameraBackground.test.ts
git commit -m "feat(web): hook de fundo virtual da câmera (blur e imagem EMR)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `CameraBackgroundMenu`

O painel de escolha, no mesmo padrão visual/comportamental do menu de modo do nearby chat da `MediaBar` (fecha em clique fora / Esc, `menuitemradio`).

**Files:**
- Create: `apps/web/src/office/media/CameraBackgroundMenu.tsx`
- Create: `apps/web/src/office/media/CameraBackgroundMenu.test.tsx`

**Interfaces:**
- Consumes: `CameraBackgroundState` (Task 2), `CAMERA_BACKGROUNDS` (Task 1).
- Produces: `CameraBackgroundMenu({ state, onClose }: { state: CameraBackgroundState; onClose(): void })` — renderizado pela MediaBar dentro de um container com `data-camera-bg-root` (o clique fora usa esse marcador).

- [ ] **Step 1: Escrever os testes**

```tsx
// apps/web/src/office/media/CameraBackgroundMenu.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { CameraBackgroundState } from './useCameraBackground'
import { CameraBackgroundMenu } from './CameraBackgroundMenu'

function makeState(overrides: Partial<CameraBackgroundState> = {}): CameraBackgroundState {
  return {
    background: 'none',
    setBackground: vi.fn(),
    supported: true,
    error: false,
    ...overrides,
  }
}

const onClose = vi.fn()

beforeEach(() => vi.clearAllMocks())

describe('CameraBackgroundMenu', () => {
  it('lista Nenhum, os dois blurs e o fundo EMR, com check na opção ativa', () => {
    render(<CameraBackgroundMenu state={makeState({ background: 'blur-leve' })} onClose={onClose} />)
    expect(screen.getByRole('menuitemradio', { name: /Nenhum/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Blur leve/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: /Blur forte/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /Fundo EMR/ })).toBeInTheDocument()
  })

  it('selecionar uma opção chama setBackground com o id', () => {
    const state = makeState()
    render(<CameraBackgroundMenu state={state} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fundo EMR/ }))
    expect(state.setBackground).toHaveBeenCalledWith('img:emr')
  })

  it('Esc fecha o menu', () => {
    render(<CameraBackgroundMenu state={makeState()} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clique fora do data-camera-bg-root fecha o menu', () => {
    render(
      <div>
        <div data-camera-bg-root>
          <CameraBackgroundMenu state={makeState()} onClose={onClose} />
        </div>
        <button type="button">fora</button>
      </div>,
    )
    fireEvent.mouseDown(screen.getByText('fora'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a miniatura do fundo EMR usa a imagem do catálogo', () => {
    const { container } = render(<CameraBackgroundMenu state={makeState()} onClose={onClose} />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/office/camera-backgrounds/emr.jpg')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/CameraBackgroundMenu.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o componente**

```tsx
// apps/web/src/office/media/CameraBackgroundMenu.tsx
import { useEffect } from 'react'
import { Icon } from '../../components/Icon'
import { CAMERA_BACKGROUNDS, type CameraBackgroundId } from './camera-backgrounds'
import type { CameraBackgroundState } from './useCameraBackground'

interface MenuOption {
  id: CameraBackgroundId
  label: string
  icon?: string
  src?: string
}

/**
 * Painel de efeitos de fundo da câmera. Renderizado dentro de um container
 * com `data-camera-bg-root` (split button da MediaBar); segue o padrão do
 * menu de modo do nearby chat: fecha em Esc/clique fora, não fecha ao
 * selecionar (dá para experimentar as opções vendo o próprio preview).
 */
export function CameraBackgroundMenu({
  state,
  onClose,
}: {
  state: CameraBackgroundState
  onClose: () => void
}) {
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-camera-bg-root]')) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  const options: MenuOption[] = [
    { id: 'none', label: 'Nenhum', icon: 'block' },
    { id: 'blur-leve', label: 'Blur leve', icon: 'blur_on' },
    { id: 'blur-forte', label: 'Blur forte', icon: 'blur_on' },
    ...CAMERA_BACKGROUNDS.map((bg) => ({
      id: `img:${bg.id}` as CameraBackgroundId,
      label: bg.label,
      src: bg.src,
    })),
  ]

  return (
    <div
      role="menu"
      aria-label="Efeitos de fundo da câmera"
      className="absolute bottom-[calc(100%+0.35rem)] left-1/2 z-20 w-60 -translate-x-1/2 overflow-hidden rounded-xl border border-white/15 bg-[#262626]/95 p-1 shadow-xl backdrop-blur"
    >
      {options.map((option) => {
        const active = state.background === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => state.setBackground(option.id)}
            className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
              active ? 'bg-primary/90 text-on-primary' : 'text-white/85 hover:bg-white/10'
            }`}
          >
            {option.src ? (
              <img src={option.src} alt="" className="h-8 w-14 shrink-0 rounded object-cover" />
            ) : (
              <Icon name={option.icon ?? 'block'} className="text-[18px]" />
            )}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {active && <Icon name="check" className="text-[16px]" />}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar + typecheck**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/CameraBackgroundMenu.test.tsx && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS (5 testes) / sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/CameraBackgroundMenu.tsx apps/web/src/office/media/CameraBackgroundMenu.test.tsx
git commit -m "feat(web): painel de efeitos de fundo da câmera

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Split button na MediaBar + wiring na OfficePage

Liga tudo: a `MediaBar` ganha o split button (toggle de câmera intacto + setinha que abre o menu) e a pill de erro; a `OfficePage` chama o hook e passa o estado.

**Files:**
- Modify: `apps/web/src/office/media/MediaBar.tsx` (botão de câmera, ~linhas 232–241; pills de erro, ~294–313; props)
- Modify: `apps/web/src/pages/OfficePage.tsx` (chamada do hook + prop)
- Test: `apps/web/src/office/media/MediaBar.test.tsx`
- Test: `apps/web/src/pages/OfficePage.test.tsx` (se existir — mockar o hook novo; se não existir, ignorar esta linha)

**Interfaces:**
- Consumes: `useCameraBackground`/`CameraBackgroundState` (Task 2), `CameraBackgroundMenu` (Task 3).
- Produces: `MediaBar` ganha a prop obrigatória `cameraBackground: CameraBackgroundState`. Nenhuma outra prop muda.

- [ ] **Step 1: Atualizar/escrever testes (vermelho primeiro)**

1. Em `MediaBar.test.tsx`: localizar o helper que monta as props da `MediaBar` e adicionar um default para a prop nova (ajustar ao padrão real do arquivo):

```tsx
const cameraBackground = {
  background: 'none' as const,
  setBackground: vi.fn(),
  supported: true,
  error: false,
}
// ...passar cameraBackground={cameraBackground} em todos os render(<MediaBar …/>)
```

2. Adicionar os testes novos no mesmo arquivo, usando o helper de props que o arquivo já tiver (abaixo, `renderBar(props)` representa o padrão existente de montar a MediaBar com media/broadcast mockados — adapte o nome ao real; `media.toggleCamera` é o `vi.fn()` do helper):

```tsx
  it('setinha de efeitos abre o painel de fundos sem afetar o toggle de câmera', () => {
    const { media } = renderBar({ cameraBackground })
    fireEvent.click(screen.getByRole('button', { name: 'Efeitos de fundo da câmera' }))
    expect(screen.getByRole('menu', { name: 'Efeitos de fundo da câmera' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ligar câmera' }))
    expect(media.toggleCamera).toHaveBeenCalledOnce()
  })

  it('setinha desabilitada quando não há suporte', () => {
    renderBar({ cameraBackground: { ...cameraBackground, supported: false } })
    const btn = screen.getByRole('button', { name: 'Efeitos de fundo da câmera' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'Seu navegador não suporta efeitos de fundo')
  })

  it('erro de fundo mostra a pill', () => {
    renderBar({ cameraBackground: { ...cameraBackground, error: true } })
    expect(screen.getByText('Não foi possível aplicar o fundo')).toBeInTheDocument()
  })
```

Se o arquivo não tiver um helper `renderBar`-like, monte as props inline seguindo o padrão dos testes existentes do próprio arquivo (todos montam `media`/`broadcast` mockados de alguma forma) — o cenário e as asserções acima ficam idênticos.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx`
Expected: FAIL — prop `cameraBackground` não existe / botão novo não encontrado.

- [ ] **Step 3: Implementar na MediaBar**

1. Imports e props:

```tsx
import { CameraBackgroundMenu } from './CameraBackgroundMenu'
import type { CameraBackgroundState } from './useCameraBackground'
```

Adicionar à lista de props (tipo e destructuring): `cameraBackground: CameraBackgroundState`.

2. Estado local: `const [showBackgroundMenu, setShowBackgroundMenu] = useState(false)`.

3. Substituir o botão de câmera atual (bloco `<button …videocam…>`) pelo grupo split (o botão principal fica IGUAL ao atual, só muda o arredondamento):

```tsx
        <div className="relative flex items-center" data-camera-bg-root>
          <button
            type="button"
            aria-label={media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
            title={mediaControlsDisabled ? mediaDisabledTitle : media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
            className={`${toolButtonCls(media.cameraEnabled)} rounded-r-none disabled:cursor-not-allowed disabled:opacity-45`}
            disabled={mediaControlsDisabled}
            onClick={() => void media.toggleCamera()}
          >
            <Icon name={media.cameraEnabled ? 'videocam' : 'videocam_off'} className="text-[20px]" />
          </button>
          <button
            type="button"
            aria-label="Efeitos de fundo da câmera"
            title={cameraBackground.supported ? 'Efeitos de fundo da câmera' : 'Seu navegador não suporta efeitos de fundo'}
            aria-haspopup="menu"
            aria-expanded={showBackgroundMenu}
            disabled={!cameraBackground.supported}
            onClick={() => setShowBackgroundMenu((current) => !current)}
            className="flex h-10 w-5 items-center justify-center rounded-r-xl border border-l-0 border-white/5 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Icon name="expand_less" className="text-[16px]" />
          </button>
          {showBackgroundMenu && (
            <CameraBackgroundMenu
              state={cameraBackground}
              onClose={() => setShowBackgroundMenu(false)}
            />
          )}
        </div>
```

4. Pill de erro, junto das existentes (`media.micError` etc.):

```tsx
      {cameraBackground.error && (
        <span className="rounded-full bg-[#2f2f2f]/95 px-sm py-xs font-label text-label-sm text-error shadow-lg">
          Não foi possível aplicar o fundo
        </span>
      )}
```

- [ ] **Step 4: Wiring na OfficePage**

```tsx
import { useCameraBackground } from '../office/media/useCameraBackground'
```

Logo após a chamada do `useOfficeMedia` (que produz `media`):

```tsx
  const cameraBackground = useCameraBackground(media.localCameraTrack)
```

E na `<MediaBar …>`: adicionar `cameraBackground={cameraBackground}`.

Se existir `OfficePage.test.tsx`, adicionar o mock do hook novo junto dos mocks existentes:

```tsx
vi.mock('../office/media/useCameraBackground', () => ({
  useCameraBackground: vi.fn(() => ({
    background: 'none',
    setBackground: vi.fn(),
    supported: true,
    error: false,
  })),
}))
```

- [ ] **Step 5: Rodar suíte do web + typecheck**

Run: `pnpm --filter @legends/web test && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS / sem erros.

- [ ] **Step 6: Build + checagem de chunks**

Run: `pnpm --filter @legends/web build && grep -l "BackgroundBlur" apps/web/dist/assets/*.js`
Expected: o grep lista APENAS chunk(s) separado(s) do track-processors/mediapipe — nem `index-*.js` nem o chunk da `OfficePage` podem aparecer. (Atenção: o NOME do chunk pode aparecer numa expressão `import()` — isso é esperado; o símbolo `BackgroundBlur` é o que não pode vazar.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(web): split button de efeitos de fundo na barra de mídia

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Assets do MediaPipe (self-host se viável) + verificação final

O spec pede preferência por self-host dos assets do MediaPipe (evitar CDN em produção), com fallback para o default do pacote se não for viável. Depois, verificação completa.

**Files:**
- Possibly create: `apps/web/public/mediapipe-vision/` (wasm fileset vendorizado)
- Possibly modify: `apps/web/src/office/media/useCameraBackground.ts` (passar caminhos de assets na criação dos processors)
- Possibly create/modify: `apps/web/scripts/` (script de vendorização, se necessário)

**Interfaces:**
- Consumes: opções de `BackgroundBlur`/`VirtualBackground` (verificadas no Step 1).
- Produces: decisão registrada — self-host aplicado OU CDN default documentado no spec.

- [ ] **Step 1: Investigar as opções de assets do pacote**

Run: `grep -rn "assetPaths\|wasm\|cdn\|jsdelivr" apps/web/node_modules/@livekit/track-processors/dist/*.d.ts | head -30`
E inspecionar as assinaturas de `BackgroundBlur`/`VirtualBackground` nos `.d.ts` (parâmetros além do raio/imagem — ex.: `segmenterOptions`, `assetPaths`).

- [ ] **Step 2: Decidir e aplicar**

- **Se** as assinaturas aceitarem caminhos de assets (fileset WASM/modelo): copiar os assets de `apps/web/node_modules/@mediapipe/tasks-vision/wasm/` para `apps/web/public/mediapipe-vision/` (commitá-los), e passar os caminhos na criação dos processors no `useCameraBackground` (constante `MEDIAPIPE_ASSETS_PATH = '/mediapipe-vision'`). Atualizar os testes do hook para as novas chamadas (ex.: `BackgroundBlur(5, …)` com o argumento extra — manter asserção com `expect.anything()` no argumento de assets ou afirmar o path exato).
- **Se não** houver como apontar assets locais: NÃO hackear. Atualizar o spec (`docs/superpowers/specs/2026-07-16-camera-fundo-virtual-design.md`, seção "Casos de borda") registrando que o default do pacote (CDN) é o caminho usado e por quê, e seguir adiante.

- [ ] **Step 3: Suíte completa do monorepo**

Run: `pnpm db:up && pnpm test`
Expected: PASS em api, web e shared (a API exige Postgres de pé).

- [ ] **Step 4: Verificação manual (requer Node ≥ 20 e browser com câmera real)**

1. `pnpm dev`; logar; ir a `/escritorio`; ligar a câmera.
2. Abrir a setinha ao lado do botão de câmera → painel com Nenhum / Blur leve / Blur forte / Fundo EMR.
3. Aplicar **Blur forte** → o próprio preview (balão/tile) mostra o fundo desfocado; com um segundo usuário na mesma sala, o vídeo recebido também aparece desfocado (efeito no track publicado).
4. Aplicar **Fundo EMR** → fundo troca pela imagem institucional.
5. Desligar e religar a câmera → o efeito volta sozinho.
6. Recarregar a página → a escolha persiste (localStorage) e aplica ao ligar a câmera.
7. Escolher **Nenhum** → fundo natural volta.
8. DevTools → aba Network: o download do WASM/modelo só acontece na primeira aplicação de efeito (lazy), e — se o self-host foi aplicado — vem do próprio host, não de CDN.

- [ ] **Step 5: Commit final e encerramento**

Ajustes da verificação manual entram como commits pequenos. Ao final, usar a skill superpowers:finishing-a-development-branch.

**Nota de convergência (não é passo):** quando a branch `feat/escritorio-pip` mergear (hooks de mídia sobem para o `OfficeSessionProvider`), a chamada `useCameraBackground(media.localCameraTrack)` deve subir junto para o provider — uma linha no call site; o hook em si não muda.
