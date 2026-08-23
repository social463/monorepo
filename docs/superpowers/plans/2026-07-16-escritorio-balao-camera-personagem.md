# Balão de câmera acompanhando o personagem no mapa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sempre que alguém (local ou remoto) liga a câmera, em qualquer lugar do mapa do escritório (sala ou espaço aberto), um balão de vídeo aparece acima do personagem dela e a acompanha em tempo real, escalando com o zoom do mapa. Isso substitui o preview flutuante de hoje (`SelfCameraPreview`) e a faixa lateral de câmeras recém-implementada (`useMediaStripWidth` + faixa compacta do `MediaTiles`).

**Architecture:** `OfficeScene` (Phaser) ganha um método `getScreenPosition(userId)` que converte a posição mundo do personagem (já tweened/animada) pra pixels de tela, usando scroll/zoom da câmera Phaser — construído sobre uma função pura `computeScreenPosition` (testável isoladamente, sem precisar instanciar Phaser). `OfficeCanvas` expõe esse método pro React via `forwardRef`/`useImperativeHandle` (hoje o `sceneRef` é 100% interno). Um novo hook `useCharacterScreenPositions` faz polling via `requestAnimationFrame` chamando esse método pra cada usuário com câmera ativa, e `OfficePage.tsx` usa o resultado pra posicionar um `CharacterVideoBubble` (novo componente, `<video>` real posicionado via `style`) por cima do canvas, pra cada pessoa com `cameraTrack`/`localCameraTrack` ativo. A faixa compacta de `MediaTiles` e o preview flutuante são removidos; a grade expandida em tela cheia de `MediaTiles` (`buildTiles`/`resolveFeatured`/overlay) permanece intocada, para reaproveitamento futuro.

**Tech Stack:** React 18 + TypeScript, Phaser 3, Vitest + Testing Library (`apps/web`), Tailwind CSS.

## Global Constraints

- Balão aparece pra **local e remotos igualmente**, em sala e em espaço aberto — sem mudança na lógica de assinatura de tracks (`useOfficeMedia.ts`, proximidade/autoSubscribe já existentes).
- Balão só aparece pra quem está **visível no viewport atual** do mapa (posição fora da tela → sem balão).
- Balão **escala com o zoom do mapa** — tamanho e deslocamento vertical usam o MESMO fator de zoom que `computeScreenPosition` usa pra calcular a posição (o `camera.zoom` efetivo do Phaser, não o valor bruto de `zoom` do `OfficePage`, que pode divergir por causa do `coverZoom`).
- Deslocamento vertical do balão usa o mesmo valor já validado visualmente pelo balão de pensamento do Phaser (`OfficeScene`, offset local `-60`), garantindo consistência visual com o que já existe.
- Removido nesta feature (substituído pelo balão): `SelfCameraPreview.tsx` (+ teste), `useMediaStripWidth.ts` (+ teste), o bloco de faixa compacta em `MediaTiles.tsx`, a prop `showAllPresent`, e o mecanismo de dialog separado de tela compartilhada (`expandedId`/`expandedScreen`) — este último vira uma lacuna temporária aceita (sem indicação de tela compartilhada até o próximo spec do "botão de grade"), não é regressão a corrigir aqui.
- A grade expandida em tela cheia de `MediaTiles.tsx` (`buildTiles`, `resolveFeatured`, overlay via `createPortal`) permanece sem nenhuma mudança de comportamento.
- Mensagens/labels voltados ao usuário em português.

---

### Task 1: `computeScreenPosition` (função pura) + `OfficeScene.getScreenPosition`

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`
- Test: `apps/web/src/office/scenes/OfficeScene.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `export interface ScreenPosition { x: number; y: number; zoom: number }`, `export function computeScreenPosition(containerX: number, containerY: number, camera: { scrollX: number; scrollY: number; zoom: number }, viewport: { width: number; height: number }): ScreenPosition | null`, e o método de instância `OfficeScene.getScreenPosition(userId: string): ScreenPosition | null` — consumidos pela Task 2 (`OfficeCanvas`).

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao final de `apps/web/src/office/scenes/OfficeScene.test.ts` (após o `describe('officeMapTileFrame', ...)`  existente, importando `computeScreenPosition` no topo do arquivo junto ao import já existente):

```ts
import { officeMapTileFrame } from './officeMapTiles'
import { computeScreenPosition } from './OfficeScene'
```

E adicione o novo `describe` ao final do arquivo:

```ts
describe('computeScreenPosition', () => {
  it('converte posição de mundo pra tela considerando scroll e zoom', () => {
    const result = computeScreenPosition(
      100,
      200,
      { scrollX: 20, scrollY: 20, zoom: 2 },
      { width: 800, height: 600 },
    )
    expect(result).toEqual({ x: 160, y: 360, zoom: 2 })
  })

  it('retorna null quando a posição cai fora do viewport (negativa)', () => {
    const result = computeScreenPosition(
      -100,
      -100,
      { scrollX: 0, scrollY: 0, zoom: 1 },
      { width: 800, height: 600 },
    )
    expect(result).toBeNull()
  })

  it('retorna null quando a posição excede a largura ou a altura do viewport', () => {
    expect(
      computeScreenPosition(2000, 100, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }),
    ).toBeNull()
    expect(
      computeScreenPosition(100, 2000, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }),
    ).toBeNull()
  })

  it('com zoom 1 e scroll 0, a posição de tela é igual à posição de mundo', () => {
    const result = computeScreenPosition(
      50,
      75,
      { scrollX: 0, scrollY: 0, zoom: 1 },
      { width: 800, height: 600 },
    )
    expect(result).toEqual({ x: 50, y: 75, zoom: 1 })
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts`
Expected: FAIL — `computeScreenPosition` ainda não é exportado por `OfficeScene.ts` (erro de import).

- [ ] **Step 3: Implementar a função pura e o método de instância**

Em `apps/web/src/office/scenes/OfficeScene.ts`, adicione logo após a função `tileCenter` (que já existe, por volta da linha 64-70):

```ts
export interface ScreenPosition {
  x: number
  y: number
  zoom: number
}

/**
 * Converte a posição MUNDO de um personagem (a posição atual do seu
 * Container, já animada/tweened) pra pixels de TELA, considerando o
 * scroll e o zoom atuais da câmera do Phaser. Retorna `null` se a posição
 * cair fora do viewport — quem está fora da tela não precisa de balão.
 */
export function computeScreenPosition(
  containerX: number,
  containerY: number,
  camera: { scrollX: number; scrollY: number; zoom: number },
  viewport: { width: number; height: number },
): ScreenPosition | null {
  const x = (containerX - camera.scrollX) * camera.zoom
  const y = (containerY - camera.scrollY) * camera.zoom
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return null
  return { x, y, zoom: camera.zoom }
}
```

Depois, dentro da classe `OfficeScene` (por exemplo, logo após o método `setCameraZoom`, por volta da linha 101-104), adicione:

```ts
  /**
   * Posição de tela do personagem `userId` agora — usada pra posicionar o
   * balão de vídeo (elemento DOM) por cima do canvas. `null` se o
   * personagem não existe ou está fora do viewport atual.
   */
  getScreenPosition(userId: string): ScreenPosition | null {
    const view = this.characters.get(userId)
    if (!view) return null
    const cam = this.cameras.main
    return computeScreenPosition(
      view.container.x,
      view.container.y,
      { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom },
      { width: this.scale.width, height: this.scale.height },
    )
  }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts`
Expected: todos os testes (os pré-existentes de `officeMapTileFrame` + os 4 novos de `computeScreenPosition`) passam.

- [ ] **Step 5: Rodar o typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (o método `getScreenPosition` não é chamado por ninguém ainda, mas deve compilar).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/scenes/OfficeScene.test.ts
git commit -m "feat(office): OfficeScene expõe posição de tela do personagem (getScreenPosition)"
```

---

### Task 2: `OfficeCanvas` expõe `getScreenPosition` via `forwardRef`

**Files:**
- Modify: `apps/web/src/office/OfficeCanvas.tsx`

**Interfaces:**
- Consumes: `OfficeScene.getScreenPosition` (Task 1).
- Produces: `export interface OfficeCanvasHandle { getScreenPosition(userId: string): ScreenPosition | null }`; `OfficeCanvas` passa a ser `forwardRef<OfficeCanvasHandle, OfficeCanvasProps>` — consumidos pela Task 3 (hook) e Task 6 (`OfficePage.tsx`).

- [ ] **Step 1: Ler o arquivo atual**

Leia `apps/web/src/office/OfficeCanvas.tsx` por completo antes de editar (é um arquivo pequeno, ~100 linhas) — a assinatura exportada muda de função simples pra `forwardRef`, então é mais seguro reescrever o arquivo inteiro do que aplicar um diff pontual.

- [ ] **Step 2: Reescrever `OfficeCanvas.tsx` com `forwardRef`**

Substitua o conteúdo inteiro de `apps/web/src/office/OfficeCanvas.tsx` por:

```tsx
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { MapDocumentV1, OfficeMapAssetDTO } from '@legends/shared'
import type { OfficeBridge } from './OfficeBridge'
import type { ScreenPosition } from './scenes/OfficeScene'

export interface OfficeCanvasHandle {
  /** Posição de tela do personagem `userId` agora, ou `null` se não existir/estiver fora do viewport. */
  getScreenPosition(userId: string): ScreenPosition | null
}

interface OfficeCanvasProps {
  bridge: OfficeBridge
  zoom: number
  inputLocked?: boolean
  focusUserId?: string | null
  document: MapDocumentV1
  assets: OfficeMapAssetDTO[]
}

/**
 * Monta o jogo UMA vez e o destrói no unmount. O `bridge` é a única via de
 * comunicação — nenhuma prop que muda entra aqui, então o React nunca
 * re-renderiza o Phaser.
 *
 * O `import()` dinâmico mantém o Phaser (~350 kB gzip) fora do bundle principal:
 * só quem abre o escritório paga por ele.
 *
 * Expõe `getScreenPosition` via `forwardRef` — é a única leitura de estado
 * que o React precisa fazer de volta do Phaser (pra posicionar balões de
 * vídeo por cima do canvas); tudo o mais é bridge (dados de jogo) ou
 * chamada de método imperativa (comandos de UI: zoom, foco, lock).
 */
export const OfficeCanvas = forwardRef<OfficeCanvasHandle, OfficeCanvasProps>(function OfficeCanvas(
  { bridge, zoom, inputLocked = false, focusUserId = null, document, assets },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<import('./scenes/OfficeScene').OfficeScene | null>(null)
  const zoomRef = useRef(zoom)
  const focusUserIdRef = useRef<string | null>(focusUserId)

  useImperativeHandle(
    ref,
    () => ({
      getScreenPosition: (userId: string) => sceneRef.current?.getScreenPosition(userId) ?? null,
    }),
    [],
  )

  useEffect(() => {
    zoomRef.current = zoom
    sceneRef.current?.setCameraZoom(zoom)
  }, [zoom])

  useEffect(() => {
    focusUserIdRef.current = focusUserId
    sceneRef.current?.setFocusUser(focusUserId)
  }, [focusUserId])

  useEffect(() => {
    bridge.setMovementLocked(inputLocked)
    sceneRef.current?.setInputLocked(inputLocked)
    return () => {
      bridge.setMovementLocked(false)
    }
  }, [bridge, inputLocked])

  useEffect(() => {
    let game: import('phaser').Game | null = null
    let resizeObserver: ResizeObserver | null = null
    let cancelled = false

    void (async () => {
      const [{ default: Phaser }, { OfficeScene }] = await Promise.all([
        import('phaser'),
        import('./scenes/OfficeScene'),
      ])
      if (cancelled || !hostRef.current) return

      const scene = new OfficeScene(bridge, document, assets)
      scene.setCameraZoom(zoomRef.current)
      scene.setInputLocked(inputLocked)
      scene.setFocusUser(focusUserIdRef.current)
      sceneRef.current = scene
      const width = hostRef.current.clientWidth || document.map.width * document.map.tileWidth
      const height = hostRef.current.clientHeight || document.map.height * document.map.tileHeight
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width,
        height,
        backgroundColor: '#15151a',
        pixelArt: true,
        scale: {
          mode: Phaser.Scale.RESIZE,
        },
        scene,
      })

      resizeObserver = new ResizeObserver(([entry]) => {
        const { width: nextWidth, height: nextHeight } = entry.contentRect
        if (nextWidth > 0 && nextHeight > 0) {
          game?.scale.resize(nextWidth, nextHeight)
        }
      })
      resizeObserver.observe(hostRef.current)
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      game?.destroy(true)
      game = null
      sceneRef.current = null
    }
  }, [assets, bridge, document])

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden bg-surface-container-highest"
      aria-label="Mapa do escritório"
    />
  )
})
```

Note: o único conteúdo novo é a interface `OfficeCanvasHandle`, o `forwardRef` na declaração exportada, e o `useImperativeHandle`. Toda a lógica interna (efeitos de zoom/foco/inputLocked, montagem do Phaser, resize observer, cleanup) é idêntica à versão anterior.

- [ ] **Step 3: Rodar o typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (nenhum consumidor passa `ref` ainda, `forwardRef` aceita ausência de ref normalmente).

- [ ] **Step 4: Rodar a suíte completa do web**

Run: `pnpm --filter @legends/web test -- --run`
Expected: todos os testes passam — `OfficePage.test.tsx` usa um mock de `OfficeCanvas` que substitui o módulo inteiro (não é afetado pela mudança de assinatura, já que o mock não implementa `forwardRef`; isso só passará a importar quando `OfficePage.tsx` tentar anexar uma `ref`, o que só acontece na Task 6).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/OfficeCanvas.tsx
git commit -m "feat(office): OfficeCanvas expõe getScreenPosition via forwardRef"
```

---

### Task 3: `useCharacterScreenPositions` — polling de posição via `requestAnimationFrame`

**Files:**
- Create: `apps/web/src/office/media/useCharacterScreenPositions.ts`
- Test: `apps/web/src/office/media/useCharacterScreenPositions.test.tsx`

**Interfaces:**
- Consumes: `OfficeCanvasHandle` (Task 2, só o tipo, pra anotar o `RefObject`).
- Produces: `useCharacterScreenPositions(canvasRef: RefObject<OfficeCanvasHandle | null>, userIds: string[]): Map<string, ScreenPosition | null>` — consumido pela Task 6 (`OfficePage.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/web/src/office/media/useCharacterScreenPositions.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCharacterScreenPositions } from './useCharacterScreenPositions'
import type { OfficeCanvasHandle } from '../OfficeCanvas'

describe('useCharacterScreenPositions', () => {
  let rafCallbacks: FrameRequestCallback[]
  let rafId: number

  beforeEach(() => {
    rafCallbacks = []
    rafId = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return ++rafId
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function tick() {
    const callbacks = rafCallbacks
    rafCallbacks = []
    callbacks.forEach((cb) => cb(0))
  }

  function fakeCanvasRef(getScreenPosition: OfficeCanvasHandle['getScreenPosition']) {
    return { current: { getScreenPosition } }
  }

  it('antes do primeiro frame processar, o mapa vem vazio', () => {
    const canvasRef = fakeCanvasRef(() => ({ x: 1, y: 2, zoom: 1 }))
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))
    expect(result.current.size).toBe(0)
  })

  it('depois de um frame, popula o mapa com o retorno de getScreenPosition', () => {
    const canvasRef = fakeCanvasRef(() => ({ x: 10, y: 20, zoom: 1.5 }))
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))

    act(() => tick())

    expect(result.current.get('ana')).toEqual({ x: 10, y: 20, zoom: 1.5 })
  })

  it('userId sem posição (getScreenPosition retorna null) fica null no mapa', () => {
    const canvasRef = fakeCanvasRef(() => null)
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))

    act(() => tick())

    expect(result.current.get('ana')).toBeNull()
  })

  it('consulta a posição de cada userId da lista', () => {
    const getScreenPosition = vi.fn((userId: string) => ({ x: userId.length, y: 0, zoom: 1 }))
    const canvasRef = fakeCanvasRef(getScreenPosition)
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana', 'bob']))

    act(() => tick())

    expect(result.current.get('ana')).toEqual({ x: 3, y: 0, zoom: 1 })
    expect(result.current.get('bob')).toEqual({ x: 3, y: 0, zoom: 1 })
    expect(getScreenPosition).toHaveBeenCalledWith('ana')
    expect(getScreenPosition).toHaveBeenCalledWith('bob')
  })

  it('lista vazia de userIds não agenda frame nenhum', () => {
    const rafSpy = vi.fn()
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    renderHook(() => useCharacterScreenPositions({ current: null }, []))
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('cancela o frame agendado no unmount', () => {
    const cancelSpy = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelSpy)
    const canvasRef = fakeCanvasRef(() => null)
    const { unmount } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))
    unmount()
    expect(cancelSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useCharacterScreenPositions.test.tsx`
Expected: FAIL — o módulo `./useCharacterScreenPositions` ainda não existe.

- [ ] **Step 3: Implementar o hook**

Crie `apps/web/src/office/media/useCharacterScreenPositions.ts`:

```ts
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { OfficeCanvasHandle } from '../OfficeCanvas'
import type { ScreenPosition } from '../scenes/OfficeScene'

/**
 * Poll de posição de tela via `requestAnimationFrame` — sincroniza balões
 * de vídeo (DOM) com a posição do personagem no canvas do Phaser, que não
 * emite nenhum evento reativo pra "personagem se moveu na tela" (zoom e
 * scroll da câmera também mudam a posição, sem disparar nada no React).
 */
export function useCharacterScreenPositions(
  canvasRef: RefObject<OfficeCanvasHandle | null>,
  userIds: string[],
): Map<string, ScreenPosition | null> {
  const [positions, setPositions] = useState<Map<string, ScreenPosition | null>>(new Map())
  const userIdsRef = useRef(userIds)
  userIdsRef.current = userIds

  useEffect(() => {
    if (userIds.length === 0) {
      setPositions(new Map())
      return
    }
    let frame: number
    const tick = () => {
      const canvas = canvasRef.current
      const next = new Map<string, ScreenPosition | null>()
      for (const userId of userIdsRef.current) {
        next.set(userId, canvas?.getScreenPosition(userId) ?? null)
      }
      setPositions(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, userIds.length])

  return positions
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useCharacterScreenPositions.test.tsx`
Expected: todos os 6 testes passam.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/useCharacterScreenPositions.ts apps/web/src/office/media/useCharacterScreenPositions.test.tsx
git commit -m "feat(office): hook de polling de posição de tela do personagem"
```

---

### Task 4: `CharacterVideoBubble` — balão de vídeo posicionado

**Files:**
- Create: `apps/web/src/office/media/CharacterVideoBubble.tsx`
- Test: `apps/web/src/office/media/CharacterVideoBubble.test.tsx`

**Interfaces:**
- Consumes: `ScreenPosition` (tipo, de `../scenes/OfficeScene`, já existe da Task 1).
- Produces: `CharacterVideoBubble({ track, name, position, mirrored }): JSX.Element | null` — consumido pela Task 6 (`OfficePage.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/web/src/office/media/CharacterVideoBubble.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CharacterVideoBubble } from './CharacterVideoBubble'
import type { RemoteVideoTrack } from 'livekit-client'

function fakeVideoTrack(): RemoteVideoTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteVideoTrack
}

describe('CharacterVideoBubble', () => {
  it('sem posição (fora do viewport), não renderiza nada', () => {
    const { container } = render(
      <CharacterVideoBubble track={fakeVideoTrack()} name="Ana" position={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('com posição, anexa o track ao <video>', () => {
    const track = fakeVideoTrack()
    render(<CharacterVideoBubble track={track} name="Ana" position={{ x: 100, y: 200, zoom: 1 }} />)

    const video = screen.getByRole('figure', { name: 'Ana' }).querySelector('video')
    expect(video).not.toBeNull()
    expect(track.attach).toHaveBeenCalledWith(video)
  })

  it('tamanho do balão escala com o zoom da posição', () => {
    render(
      <CharacterVideoBubble track={fakeVideoTrack()} name="Ana" position={{ x: 0, y: 0, zoom: 1 }} />,
    )
    const figureZoom1 = screen.getByRole('figure', { name: 'Ana' })
    const boxZoom1 = figureZoom1.querySelector('div') as HTMLElement

    const { unmount } = render(<div />)
    unmount()

    render(
      <CharacterVideoBubble track={fakeVideoTrack()} name="Bob" position={{ x: 0, y: 0, zoom: 2 }} />,
    )
    const figureZoom2 = screen.getByRole('figure', { name: 'Bob' })
    const boxZoom2 = figureZoom2.querySelector('div') as HTMLElement

    expect(parseFloat(boxZoom2.style.width)).toBe(parseFloat(boxZoom1.style.width) * 2)
  })

  it('mirrored aplica espelhamento no vídeo', () => {
    render(
      <CharacterVideoBubble
        track={fakeVideoTrack()}
        name="Você"
        position={{ x: 0, y: 0, zoom: 1 }}
        mirrored
      />,
    )
    const video = screen.getByRole('figure', { name: 'Você' }).querySelector('video')
    expect(video?.className).toContain('scale-x-[-1]')
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/CharacterVideoBubble.test.tsx`
Expected: FAIL — o módulo `./CharacterVideoBubble` ainda não existe.

- [ ] **Step 3: Implementar o componente**

Crie `apps/web/src/office/media/CharacterVideoBubble.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import type { ScreenPosition } from '../scenes/OfficeScene'

/** Tamanho do balão (px) em zoom 1. */
const BUBBLE_BASE_SIZE = 64
/**
 * Deslocamento vertical (px em zoom 1) do balão acima do personagem — o
 * MESMO valor local (`-60`) já usado pelo balão de pensamento dentro do
 * Phaser (`OfficeScene.showNearbyBubble`), pra ficar visualmente
 * consistente com algo que já existe e já foi validado.
 */
const BUBBLE_BASE_OFFSET_Y = 60

/**
 * Balão de vídeo ao vivo, posicionado por cima do canvas do Phaser,
 * acompanhando a posição de tela do personagem (`position`, calculada por
 * `useCharacterScreenPositions`). Não renderiza nada se `position` for
 * `null` (personagem fora do viewport atual).
 */
export function CharacterVideoBubble({
  track,
  name,
  position,
  mirrored = false,
}: {
  track: RemoteVideoTrack | LocalVideoTrack
  name: string
  position: ScreenPosition | null
  mirrored?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])

  if (!position) return null

  const size = BUBBLE_BASE_SIZE * position.zoom
  const offsetY = BUBBLE_BASE_OFFSET_Y * position.zoom

  return (
    <figure
      aria-label={name}
      className="pointer-events-none absolute flex flex-col items-center"
      style={{ left: position.x, top: position.y - offsetY, transform: 'translateX(-50%)' }}
    >
      <div
        className="overflow-hidden rounded-lg border-2 border-primary bg-black shadow-lg"
        style={{ width: size, height: size }}
      >
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={mirrored}
          className={`h-full w-full object-cover ${mirrored ? 'scale-x-[-1]' : ''}`}
        />
      </div>
      <div className="-mt-px h-2 w-2 rotate-45 border-b-2 border-r-2 border-primary bg-black" />
    </figure>
  )
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/CharacterVideoBubble.test.tsx`
Expected: todos os 4 testes passam.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/CharacterVideoBubble.tsx apps/web/src/office/media/CharacterVideoBubble.test.tsx
git commit -m "feat(office): componente de balão de vídeo posicionado sobre o personagem"
```

---

### Task 5: `MediaTiles` — remover faixa compacta, `showAllPresent` e dialog de tela separado

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx` (reescrita completa)
- Modify: `apps/web/src/office/media/MediaTiles.test.tsx` (reescrita completa)

**Interfaces:**
- Consumes: nada novo.
- Produces: `MediaTiles({ remotes, local, expanded, onToggleExpanded })` — SEM `showAllPresent`. Consumido pela Task 6 (`OfficePage.tsx`, que para de passar `showAllPresent`).

- [ ] **Step 1: Escrever/ajustar os testes primeiro**

Substitua o conteúdo inteiro de `apps/web/src/office/media/MediaTiles.test.tsx` por:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MediaTiles } from './MediaTiles'
import type { RemoteMedia } from './useOfficeMedia'
import type { LocalVideoTrack, RemoteAudioTrack, RemoteVideoTrack } from 'livekit-client'

/** Track falso: só precisa responder a attach/detach, que os componentes chamam no efeito. */
function fakeVideoTrack(): RemoteVideoTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteVideoTrack
}

function fakeLocalVideoTrack(): LocalVideoTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as LocalVideoTrack
}

function fakeAudioTrack(): RemoteAudioTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteAudioTrack
}

function remote(overrides: Partial<RemoteMedia> = {}): RemoteMedia {
  return {
    userId: 'a',
    name: 'Ana',
    audioTrack: null,
    cameraTrack: null,
    screenTrack: null,
    ...overrides,
  }
}

describe('MediaTiles', () => {
  it('renderiza áudio remoto como <audio> invisível (attach chamado), sem nada visível quando não expandido', () => {
    const audioTrack = fakeAudioTrack()
    const remotes = [remote({ audioTrack })]
    const { container } = render(<MediaTiles remotes={remotes} />)

    const audioEl = container.querySelector('audio')
    expect(audioEl).not.toBeNull()
    expect(audioTrack.attach).toHaveBeenCalledWith(audioEl)

    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
  })

  it('não expandido, nada é renderizado além dos áudios (faixa compacta foi removida)', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    const { container } = render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={vi.fn()} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
  })

  it('expanded=true renderiza a grade em tela cheia com botão de recolher', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recolher câmeras' }))
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('a grade expandida é renderizada via portal direto no document.body (evita ficar presa num ancestral com transform)', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    const { container } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const region = screen.getByRole('region', { name: 'Câmeras em tela cheia' })
    expect(container.contains(region)).toBe(false)
    expect(document.body.contains(region)).toBe(true)
  })

  it('Escape recolhe quando expandido; não faz nada quando já recolhido', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    const { rerender } = render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={onToggleExpanded} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).not.toHaveBeenCalled()

    rerender(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('auto-recolhe quando ninguém mais tem câmera/tela visível enquanto expandido', () => {
    const onToggleExpanded = vi.fn()
    const { rerender } = render(
      <MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={onToggleExpanded} />,
    )
    expect(onToggleExpanded).not.toHaveBeenCalled()

    rerender(<MediaTiles remotes={[remote()]} expanded onToggleExpanded={onToggleExpanded} />)
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('na grade expandida, com `local` presente o próprio tile aparece primeiro e espelhado', () => {
    const localTrack = fakeLocalVideoTrack()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(
      <MediaTiles
        remotes={remotes}
        local={{ track: localTrack, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    expect(figures[0]).toHaveTextContent('Você')

    const localVideo = figures[0].querySelector('video')
    expect(localTrack.attach).toHaveBeenCalledWith(localVideo)
    expect(localVideo?.className).toContain('scale-x-[-1]')

    const remoteVideo = figures[1].querySelector('video')
    expect(remoteVideo?.className).not.toContain('scale-x-[-1]')
  })

  it('clicar num tile de câmera na grade expandida o destaca (layout de duas colunas)', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    // Sem tela compartilhada: nasce em grid uniforme (nenhum destaque).
    expect(screen.queryByTestId('featured-tile')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Bob'))
    const featured = screen.getByTestId('featured-tile')
    expect(featured).toHaveTextContent('Bob')
  })

  it('clicar numa tela compartilhada na grade expandida a destaca', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Tela de Ana'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Ana')
  })

  it('grade expandida nasce com a tela compartilhada em destaque, se houver uma', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', screenTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bob')
  })

  it('quando o destaque perde toda mídia, troca pra outro tile com mídia; sem nenhum, volta pro grid uniforme', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack() }),
    ]
    const { rerender } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Bob'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Bob')

    rerender(
      <MediaTiles
        remotes={[remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob' })]}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Ana')

    rerender(
      <MediaTiles
        remotes={[remote({ userId: 'a', name: 'Ana' }), remote({ userId: 'b', name: 'Bob' })]}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('featured-tile')).not.toBeInTheDocument()
  })

  it('pin manual num avatar é permitido, e clicar num avatar sem mídia também destaca', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob' })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Bob'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Bob')
  })

  it('o pin de destaque reseta toda vez que a grade expande de novo', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob', screenTrack: fakeVideoTrack() })]
    const onToggleExpanded = vi.fn()
    const { rerender } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    fireEvent.click(screen.getByText('Ana'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Ana')

    rerender(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={onToggleExpanded} />)
    rerender(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bob')
  })

  it('destaque automático de tela compartilhada (sem clique) também recupera pra câmera quando a tela some', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', screenTrack: fakeVideoTrack() }),
    ]
    const { rerender } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bob')

    rerender(
      <MediaTiles
        remotes={[remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob' })]}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Ana')
  })

  it('na grade expandida, quem não tem câmera/tela vira quadrado de avatar (iniciais)', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana Silva', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob' }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    const bobFigure = figures.find((f) => f.textContent?.includes('Bob'))!
    expect(bobFigure.querySelector('video')).toBeNull()
    expect(bobFigure.textContent).toContain('B')
  })

  it('na grade expandida, o próprio usuário sem câmera também vira quadrado de avatar', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(
      <MediaTiles
        remotes={remotes}
        local={{ track: null, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    const selfFigure = figures.find((f) => f.textContent?.includes('Você'))!
    expect(selfFigure.querySelector('video')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: FAIL nos testes que dependem do comportamento novo (ex.: "não expandido, nada é renderizado..." falha porque a faixa compacta ainda existe).

- [ ] **Step 3: Reescrever `MediaTiles.tsx`**

Substitua o conteúdo inteiro de `apps/web/src/office/media/MediaTiles.tsx` por:

```tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import type { AvatarStyleKey, AvatarOptions } from '@legends/shared'
import type { RemoteMedia } from './useOfficeMedia'
import { RemoteAudio } from './RemoteAudio'
import { Icon } from '../../components/Icon'
import { Avatar, type AvatarSource } from '../../components/Avatar'

function VideoTile({
  track,
  label,
  mirrored = false,
  onClick,
  className = 'w-40 shrink-0',
  videoClassName = 'w-full',
}: {
  track: RemoteVideoTrack | LocalVideoTrack
  label: string
  mirrored?: boolean
  onClick?: () => void
  className?: string
  videoClassName?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <figure className={`${className} cursor-pointer`} onClick={onClick}>
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`${videoClassName} rounded-md bg-black ${mirrored ? 'scale-x-[-1]' : ''}`}
      />
      <figcaption className="truncate font-label text-label-sm text-on-surface-variant">{label}</figcaption>
    </figure>
  )
}

function AvatarTile({
  user,
  label,
  onClick,
  className = 'w-40 shrink-0',
  fill = false,
}: {
  user: AvatarSource
  label: string
  onClick?: () => void
  className?: string
  fill?: boolean
}) {
  return (
    <figure className={`${className} cursor-pointer`} onClick={onClick}>
      <div
        className={`flex items-center justify-center overflow-hidden rounded-md bg-surface-container-highest ${
          fill ? 'h-full w-full' : 'aspect-square w-full'
        }`}
      >
        <Avatar user={user} initialsClassName="font-label text-label-lg font-bold text-primary" />
      </div>
      <figcaption className="truncate font-label text-label-sm text-on-surface-variant">{label}</figcaption>
    </figure>
  )
}

type TileKind = 'camera' | 'screen' | 'avatar'

interface Tile {
  key: string
  kind: TileKind
  label: string
  track: RemoteVideoTrack | LocalVideoTrack | null
  mirrored: boolean
  avatar: AvatarSource
}

function buildTiles(
  remotes: RemoteMedia[],
  local?: {
    track: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: AvatarOptions | null
  } | null,
): Tile[] {
  const tiles: Tile[] = []
  if (local) {
    tiles.push({
      key: 'local',
      kind: local.track ? 'camera' : 'avatar',
      label: local.name,
      track: local.track,
      mirrored: true,
      avatar: local,
    })
  }
  for (const r of remotes) {
    if (r.cameraTrack) {
      tiles.push({ key: `cam:${r.userId}`, kind: 'camera', label: r.name, track: r.cameraTrack, mirrored: false, avatar: r })
    }
    if (r.screenTrack) {
      tiles.push({
        key: `screen:${r.userId}`,
        kind: 'screen',
        label: `Tela de ${r.name}`,
        track: r.screenTrack,
        mirrored: false,
        avatar: r,
      })
    }
    if (!r.cameraTrack && !r.screenTrack) {
      tiles.push({ key: `avatar:${r.userId}`, kind: 'avatar', label: r.name, track: null, mirrored: false, avatar: r })
    }
  }
  return tiles
}

function resolveFeatured(tiles: Tile[], pin: string | null): Tile | null {
  const pinned = pin ? tiles.find((t) => t.key === pin) : undefined
  if (pinned) return pinned
  // Sem pin nenhum ainda (grade recém-aberta): só uma tela compartilhada
  // justifica destacar algo sozinha — câmeras não roubam o grid uniforme.
  if (!pin) return tiles.find((t) => t.kind === 'screen') ?? null
  // Pin existia mas o alvo sumiu (perdeu mídia/saiu): recupera pra qualquer
  // mídia ativa restante antes de desistir e voltar pro grid uniforme.
  return tiles.find((t) => t.kind === 'screen') ?? tiles.find((t) => t.kind === 'camera') ?? null
}

/**
 * Grade de câmeras em tela cheia (Meet-style). Fora do modo `expanded`,
 * não renderiza nada visível (câmeras aparecem como balão sobre o
 * personagem no mapa — ver `CharacterVideoBubble`); esta grade existe só
 * pra quando alguém pede uma visão consolidada de todo mundo.
 */
export function MediaTiles({
  remotes,
  local,
  expanded = false,
  onToggleExpanded = () => {},
}: {
  remotes: RemoteMedia[]
  local?: {
    track: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: AvatarOptions | null
  } | null
  expanded?: boolean
  onToggleExpanded?: () => void
}) {
  const [featuredPin, setFeaturedPin] = useState<string | null>(null)

  // Reseta o destaque toda vez que a grade expande de novo — nunca herda o
  // pin de uma sessão anterior de tela cheia.
  useEffect(() => {
    if (expanded) setFeaturedPin(null)
  }, [expanded])

  const tiles = buildTiles(remotes, local)
  const hasVisible = tiles.some((t) => t.kind !== 'avatar')

  // Ninguém mais tem câmera/tela visível enquanto a grade está aberta: recolhe
  // sozinha, senão fica uma grade vazia ocupando a tela.
  useEffect(() => {
    if (expanded && !hasVisible) onToggleExpanded()
  }, [expanded, hasVisible, onToggleExpanded])

  const featured = resolveFeatured(tiles, featuredPin)

  // Destaque automático (Fluxo 1, tela compartilhada no cold-start) só existe
  // "de fato" quando comprometido no pin — senão, ao a tela sumir, a
  // recuperação (Fluxo 4) não consegue distinguir "nunca destacou nada" de
  // "algo era destacado e sumiu", e cai direto pro grid uniforme mesmo
  // havendo outra câmera ativa. Comprometer o resultado automático assim que
  // ele aparece resolve isso sem duplicar a lógica de fallback.
  useEffect(() => {
    if (expanded && featuredPin === null && featured) setFeaturedPin(featured.key)
  }, [expanded, featuredPin, featured])

  // Nota: diferente de uma versão anterior (que tinha um dialog separado só
  // pra tela compartilhada), aqui um pin comprometido que ficou "stale"
  // (alvo sumiu, destaque recuperou pra outro tile) pode ressurgir se aquele
  // mesmo alvo voltar a ter mídia — decisão deliberada, no estilo Meet:
  // reapresentar uma tela chama atenção de novo.

  // Esc fecha a grade em tela cheia, mesmo padrão usado no CharacterCard.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleExpanded()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, onToggleExpanded])

  return (
    <div>
      {remotes.map((r) => r.audioTrack && <RemoteAudio key={`a-${r.userId}`} track={r.audioTrack} />)}

      {expanded && hasVisible && createPortal(
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/90 p-lg"
          role="region"
          aria-label="Câmeras em tela cheia"
        >
          <button
            type="button"
            aria-label="Recolher câmeras"
            onClick={onToggleExpanded}
            className="fixed right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <Icon name="fullscreen_exit" className="text-[22px]" />
          </button>
          {featured ? (
            <div className="flex h-full gap-md">
              <div className="flex min-w-0 flex-1 flex-col" data-testid="featured-tile">
                {featured.kind === 'avatar' ? (
                  <AvatarTile user={featured.avatar} label={featured.label} className="flex h-full flex-1 flex-col" fill />
                ) : (
                  <VideoTile
                    track={featured.track!}
                    label={featured.label}
                    mirrored={featured.mirrored}
                    className="flex h-full flex-1 flex-col"
                    videoClassName="min-h-0 flex-1 object-contain"
                  />
                )}
              </div>
              <div className="flex w-56 shrink-0 flex-col gap-sm overflow-y-auto">
                {tiles
                  .filter((t) => t.key !== featured.key)
                  .map((t) =>
                    t.kind === 'avatar' ? (
                      <AvatarTile key={t.key} user={t.avatar} label={t.label} className="w-full" onClick={() => setFeaturedPin(t.key)} />
                    ) : (
                      <VideoTile
                        key={t.key}
                        track={t.track!}
                        label={t.label}
                        mirrored={t.mirrored}
                        className="w-full"
                        onClick={() => setFeaturedPin(t.key)}
                      />
                    ),
                  )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-md">
              {tiles.map((tile) =>
                tile.kind === 'avatar' ? (
                  <AvatarTile key={tile.key} user={tile.avatar} label={tile.label} className="w-full" onClick={() => setFeaturedPin(tile.key)} />
                ) : (
                  <VideoTile
                    key={tile.key}
                    track={tile.track!}
                    label={tile.label}
                    mirrored={tile.mirrored}
                    className="w-full"
                    onClick={() => setFeaturedPin(tile.key)}
                  />
                ),
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
```

Mudanças em relação à versão anterior: removida a prop `showAllPresent`; removido o bloco `{hasVisible && !expanded && (...)}` (faixa compacta); removido o estado `expandedId`/`expandedScreen` e seu efeito de limpeza; removido o bloco `{expandedScreen && (...)}` (dialog separado de tela compartilhada); `hasVisible` simplificado pra `tiles.some((t) => t.kind !== 'avatar')`. O resto (grade expandida, destaque, `buildTiles`, `resolveFeatured`) é idêntico.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: todos os testes passam.

- [ ] **Step 5: Rodar o typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: erro esperado em `apps/web/src/pages/OfficePage.tsx` (ainda passa `showAllPresent` pro `MediaTiles`) — isso é esperado, resolvido na Task 6. Confirme que o ÚNICO erro novo é sobre a prop `showAllPresent` em `OfficePage.tsx`; qualquer outro erro é uma regressão real desta task.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "refactor(office): MediaTiles perde faixa compacta, showAllPresent e dialog de tela"
```

---

### Task 6: `OfficePage` — balões de vídeo, remoção do preview/faixa antigos

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx`
- Delete: `apps/web/src/office/media/SelfCameraPreview.tsx`
- Delete: `apps/web/src/office/media/SelfCameraPreview.test.tsx`
- Delete: `apps/web/src/office/media/useMediaStripWidth.ts`
- Delete: `apps/web/src/office/media/useMediaStripWidth.test.tsx`

**Interfaces:**
- Consumes: `OfficeCanvasHandle` (Task 2), `useCharacterScreenPositions` (Task 3), `CharacterVideoBubble` (Task 4), `MediaTiles` sem `showAllPresent` (Task 5).
- Produces: nada consumido por tarefas futuras — última tarefa do plano.

- [ ] **Step 1: Deletar os arquivos substituídos**

```bash
rm apps/web/src/office/media/SelfCameraPreview.tsx
rm apps/web/src/office/media/SelfCameraPreview.test.tsx
rm apps/web/src/office/media/useMediaStripWidth.ts
rm apps/web/src/office/media/useMediaStripWidth.test.tsx
```

- [ ] **Step 2: Atualizar os imports em `OfficePage.tsx`**

Em `apps/web/src/pages/OfficePage.tsx`, substitua o bloco de imports (linhas 1-21):

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import { mapZoneAt, isLeaderRole, type ActiveOfficeMapDTO, type OfficeConfigDTO } from '@legends/shared'
import { Icon } from '../components/Icon'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { OfficeBridge } from '../office/OfficeBridge'
import { OfficeCanvas, type OfficeCanvasHandle } from '../office/OfficeCanvas'
import { useOfficeSocket } from '../office/useOfficeSocket'
import { useOfficeMedia } from '../office/media/useOfficeMedia'
import { useOfficeBroadcast } from '../office/media/useOfficeBroadcast'
import { useCharacterScreenPositions } from '../office/media/useCharacterScreenPositions'
import { CharacterVideoBubble } from '../office/media/CharacterVideoBubble'
import { MediaBar } from '../office/media/MediaBar'
import { MediaTiles } from '../office/media/MediaTiles'
import { BroadcastBanner } from '../office/media/BroadcastBanner'
import { useOfficeInteractions } from '../office/useOfficeInteractions'
import { CharacterCard } from '../office/CharacterCard'
import { IncomingCallPopup } from '../office/IncomingCallPopup'
import { PeopleList } from '../office/PeopleList'
```

(`useMemo` e o import de tipos do `livekit-client` são novos — usados no Step 4; `SelfCameraPreview`/`useMediaStripWidth` saem; `OfficeCanvasHandle` e os dois novos módulos de `office/media` entram.)

- [ ] **Step 3: Remover o hook de resize e adicionar o `canvasRef`**

Localize (por volta da linha 58-59):

```tsx
  const [camerasExpanded, setCamerasExpanded] = useState(false)
  const mediaStripWidth = useMediaStripWidth()
```

Substitua por:

```tsx
  const [camerasExpanded, setCamerasExpanded] = useState(false)
  const canvasRef = useRef<OfficeCanvasHandle>(null)
```

- [ ] **Step 4: Montar a lista de balões de câmera ativos e suas posições**

Logo após o bloco que já calcula `local` (por volta da linha 69-79, que termina em `: null`), adicione:

```tsx
  const cameraBubbles = useMemo(() => {
    const entries: Array<{ userId: string; track: LocalVideoTrack | RemoteVideoTrack; name: string; mirrored: boolean }> = []
    if (selfCamera) {
      entries.push({ userId: youId ?? 'you', track: selfCamera.track, name: selfCamera.name, mirrored: true })
    }
    for (const r of media.remotes) {
      if (r.cameraTrack) entries.push({ userId: r.userId, track: r.cameraTrack, name: r.name, mirrored: false })
    }
    return entries
  }, [selfCamera, media.remotes, youId])

  const cameraBubbleUserIds = useMemo(() => cameraBubbles.map((b) => b.userId), [cameraBubbles])
  const screenPositions = useCharacterScreenPositions(canvasRef, cameraBubbleUserIds)
```

Note que `selfCamera` já existe (calculado logo acima, a partir de `media.cameraEnabled && media.localCameraTrack`) e agora se aplica **em qualquer lugar do mapa** (não só fora de sala — `selfCamera` nunca foi condicionado a `inMeetingRoom`, só o antigo `<SelfCameraPreview>` era renderizado condicionalmente com `!inMeetingRoom &&`).

- [ ] **Step 5: Remover o preview flutuante antigo e renderizar os balões**

Localize (por volta da linha 143-145):

```tsx
      {!inMeetingRoom && selfCamera && (
        <SelfCameraPreview track={selfCamera.track} name={selfCamera.name} />
      )}
```

Substitua por:

```tsx
      <div className="pointer-events-none absolute inset-0 z-10">
        {cameraBubbles.map((b) => (
          <CharacterVideoBubble
            key={b.userId}
            track={b.track}
            name={b.name}
            mirrored={b.mirrored}
            position={screenPositions.get(b.userId) ?? null}
          />
        ))}
      </div>
```

- [ ] **Step 6: Simplificar o container da faixa de câmeras**

Localize o bloco (por volta das linhas 243-272):

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

Substitua por:

```tsx
      {/* Grade de câmeras em tela cheia (Meet-style) — sem UI própria de
          gatilho ainda (vem numa feature separada); `camerasExpanded` só é
          alternado programaticamente por enquanto. Fora do modo expandido,
          este componente não renderiza nada visível. */}
      <MediaTiles
        remotes={media.remotes}
        local={local}
        expanded={camerasExpanded}
        onToggleExpanded={() => setCamerasExpanded((value) => !value)}
      />
```

- [ ] **Step 7: Passar o `ref` pro `OfficeCanvas`**

Localize a chamada de `<OfficeCanvas>` (por volta das linhas 130-137) e adicione `ref={canvasRef}`:

```tsx
      <OfficeCanvas
        ref={canvasRef}
        bridge={bridge}
        document={activeMap.document}
        assets={activeMap.assets}
        zoom={zoom}
        inputLocked={nearbyChatOpen}
        focusUserId={interactions.selected?.userId ?? null}
      />
```

- [ ] **Step 8: Atualizar o mock de `OfficeCanvas` em `OfficePage.test.tsx`**

Em `apps/web/src/pages/OfficePage.test.tsx`, substitua o mock (linhas 12-16):

```tsx
vi.mock('../office/OfficeCanvas', () => ({
  OfficeCanvas: ({ zoom, focusUserId }: { zoom: number; focusUserId?: string | null }) => (
    <div data-focus-user-id={focusUserId ?? ''} data-testid="office-canvas">zoom {zoom}</div>
  ),
}))
```

por (agora com `forwardRef`, evitando o warning "Function components cannot be given refs"):

```tsx
vi.mock('../office/OfficeCanvas', () => ({
  OfficeCanvas: forwardRef<unknown, { zoom: number; focusUserId?: string | null }>(function OfficeCanvasMock(
    { zoom, focusUserId },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ getScreenPosition: () => null }), [])
    return <div data-focus-user-id={focusUserId ?? ''} data-testid="office-canvas">zoom {zoom}</div>
  }),
}))
```

Adicione o import de `forwardRef`/`useImperativeHandle` no topo do arquivo de teste (junto ao `import { describe, ... } from 'vitest'`):

```tsx
import { forwardRef, useImperativeHandle } from 'react'
```

- [ ] **Step 9: Rodar a suíte completa do web**

Run: `pnpm --filter @legends/web test -- --run`
Expected: todos os testes passam.

- [ ] **Step 10: Rodar o typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 11: Verificação manual**

Suba a stack local (`pnpm db:up` se necessário, depois `pnpm dev`), entre no escritório com duas sessões/abas. Confirme: ligando a câmera de qualquer uma das duas, em qualquer lugar do mapa (sala ou espaço aberto), aparece um balão de vídeo acima do personagem dela, que acompanha o personagem andando; o balão cresce/encolhe junto com o zoom do mapa; quem sai do viewport (rola o mapa/personagem sai da tela) não mostra mais balão; nenhum preview flutuante nem faixa lateral aparecem mais.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git rm apps/web/src/office/media/SelfCameraPreview.tsx apps/web/src/office/media/SelfCameraPreview.test.tsx apps/web/src/office/media/useMediaStripWidth.ts apps/web/src/office/media/useMediaStripWidth.test.tsx
git commit -m "feat(office): balão de vídeo acompanha o personagem no mapa (substitui preview e faixa lateral)"
```
