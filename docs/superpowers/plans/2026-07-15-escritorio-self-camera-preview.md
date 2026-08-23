# Escritório — self-preview da câmera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar feedback visual de que a própria câmera está ligada — tile flutuante arrastável fora de sala de reunião, tile no grid do `MediaTiles` dentro dela.

**Architecture:** `useOfficeMedia` passa a rastrear o `LocalVideoTrack` de câmera via os eventos `LocalTrackPublished`/`LocalTrackUnpublished` da `Room` do LiveKit (mesmo padrão já usado para `screenShareEnabled`). `OfficePage` decide, com o `zoneName` que já calcula hoje, se o self-view vai para o novo componente flutuante `SelfCameraPreview` (espaço aberto) ou para o grid existente do `MediaTiles` (sala de reunião), evitando duplicar o self-view nos dois lugares ao mesmo tempo.

**Tech Stack:** React 18, TypeScript strict, `livekit-client` 2.x, Tailwind 3, Vitest + Testing Library (`jsdom`).

## Global Constraints

- TypeScript strict, ESM puro — sem `any`, tipos explícitos nas props novas.
- Mensagens/labels visíveis ao usuário em português ("Você").
- Sem persistir a posição do tile arrastável entre sessões (cortado do v1).
- Sem botão de minimizar separado — a única forma de tirar o self-view de cena é desligando a câmera na `MediaBar` (já existente).
- Só o tile **local** é espelhado (`scale-x-[-1]`); tiles remotos continuam sem espelhar.
- Rode `pnpm --filter @legends/web test` e, por mudar um DTO/props compartilhados entre componentes, `pnpm --filter @legends/web exec tsc --noEmit` antes de considerar cada task concluída (o `build`/Vitest não faz typecheck completo do projeto).

---

## Task 1: `useOfficeMedia` — rastrear o `LocalVideoTrack` da câmera

**Files:**
- Modify: `apps/web/src/office/media/useOfficeMedia.ts`
- Test: `apps/web/src/office/media/useOfficeMedia.test.ts`

**Interfaces:**
- Produces: `OfficeMediaState.localCameraTrack: LocalVideoTrack | null` — `null` enquanto a câmera está desligada ou durante troca de sala; populado pelo evento `LocalTrackPublished` com `source === Track.Source.Camera`.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/office/media/useOfficeMedia.test.ts`, localize o fim do arquivo:

```ts
    // idempotente: aplicar o estado atual não lança nem alterna
    await act(async () => { await result.current.applyMicEnabled(false) })
    expect(track.isMuted).toBe(true)
  })
})
```

Substitua por (adiciona dois testes novos antes do `})` final do `describe`):

```ts
    // idempotente: aplicar o estado atual não lança nem alterna
    await act(async () => { await result.current.applyMicEnabled(false) })
    expect(track.isMuted).toBe(true)
  })

  it('rastreia o track local de câmera via LocalTrackPublished/Unpublished', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    const fakeTrack = { attach: vi.fn(), detach: vi.fn() }

    expect(result.current.localCameraTrack).toBeNull()

    await act(async () => {
      room.emit('localTrackPublished', { source: 'camera', track: fakeTrack })
    })
    expect(result.current.localCameraTrack).toBe(fakeTrack)

    await act(async () => {
      room.emit('localTrackUnpublished', { source: 'camera' })
    })
    expect(result.current.localCameraTrack).toBeNull()
  })

  it('troca de sala zera o track local de câmera imediatamente (evita frame congelado)', async () => {
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] }, // espaço aberto
    })
    await settle(600)
    const openRoom = FakeRoom.instances.at(-1)!
    await act(async () => {
      openRoom.emit('localTrackPublished', { source: 'camera', track: { attach: vi.fn(), detach: vi.fn() } })
    })
    expect(result.current.localCameraTrack).not.toBeNull()

    rerender({ occ: [occupant('you', 18, 15)] }) // entra na sala de reunião
    await settle(600)

    expect(result.current.localCameraTrack).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts`
Expected: FAIL — `result.current.localCameraTrack` é `undefined` (propriedade não existe ainda no retorno do hook).

- [ ] **Step 3: Implementar `localCameraTrack` em `useOfficeMedia.ts`**

No topo do arquivo, o import de `livekit-client`:

```ts
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteAudioTrack,
  type RemoteVideoTrack,
} from 'livekit-client'
```

vira:

```ts
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteAudioTrack,
  type RemoteVideoTrack,
} from 'livekit-client'
```

A interface `OfficeMediaState`:

```ts
export interface OfficeMediaState {
  status: OfficeMediaStatus
  roomName: string | null
  micEnabled: boolean
  micError: boolean
  cameraEnabled: boolean
  cameraError: boolean
  screenShareEnabled: boolean
  screenShareError: boolean
  remotes: RemoteMedia[]
  toggleMic(): Promise<void>
  toggleCamera(): Promise<void>
  toggleScreenShare(): Promise<void>
  applyMicEnabled(enabled: boolean): Promise<void>
}
```

vira (adiciona `localCameraTrack` logo após `remotes`):

```ts
export interface OfficeMediaState {
  status: OfficeMediaStatus
  roomName: string | null
  micEnabled: boolean
  micError: boolean
  cameraEnabled: boolean
  cameraError: boolean
  screenShareEnabled: boolean
  screenShareError: boolean
  remotes: RemoteMedia[]
  localCameraTrack: LocalVideoTrack | null
  toggleMic(): Promise<void>
  toggleCamera(): Promise<void>
  toggleScreenShare(): Promise<void>
  applyMicEnabled(enabled: boolean): Promise<void>
}
```

O bloco de states, logo abaixo de `const [remotes, setRemotes] = useState<RemoteMedia[]>([])`:

```ts
  const [remotes, setRemotes] = useState<RemoteMedia[]>([])
  const [stableRoom, setStableRoom] = useState<string | null>(null)
```

vira:

```ts
  const [remotes, setRemotes] = useState<RemoteMedia[]>([])
  const [localCameraTrack, setLocalCameraTrack] = useState<LocalVideoTrack | null>(null)
  const [stableRoom, setStableRoom] = useState<string | null>(null)
```

No início de `connectTo`, o trecho:

```ts
      targetRoomRef.current = target
      setRemotes([])
      setStatus('connecting')
```

vira (zera o track local imediatamente — evita mostrar um frame congelado do track da sala antiga até o próximo `LocalTrackPublished`):

```ts
      targetRoomRef.current = target
      setRemotes([])
      setLocalCameraTrack(null)
      setStatus('connecting')
```

Os listeners de `LocalTrackPublished`/`LocalTrackUnpublished`:

```ts
          .on(RoomEvent.LocalTrackPublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              setScreenShareEnabled(true)
              setScreenShareError(false)
            }
          })
          .on(RoomEvent.LocalTrackUnpublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              setScreenShareEnabled(false)
            }
          })
```

viram:

```ts
          .on(RoomEvent.LocalTrackPublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              setScreenShareEnabled(true)
              setScreenShareError(false)
            }
            if (pub.source === Track.Source.Camera) {
              setLocalCameraTrack(pub.track as LocalVideoTrack)
            }
          })
          .on(RoomEvent.LocalTrackUnpublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              setScreenShareEnabled(false)
            }
            if (pub.source === Track.Source.Camera) {
              setLocalCameraTrack(null)
            }
          })
```

E o objeto de retorno do hook:

```ts
  return {
    status,
    roomName,
    micEnabled,
    micError,
    cameraEnabled,
    cameraError,
    screenShareEnabled,
    screenShareError,
    remotes,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    applyMicEnabled,
  }
```

vira:

```ts
  return {
    status,
    roomName,
    micEnabled,
    micError,
    cameraEnabled,
    cameraError,
    screenShareEnabled,
    screenShareError,
    remotes,
    localCameraTrack,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    applyMicEnabled,
  }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts`
Expected: PASS (todos os testes, os novos e os já existentes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeMedia.test.ts
git commit -m "feat(office): rastrear track local de câmera em useOfficeMedia"
```

---

## Task 2: `MediaTiles` — incluir o próprio tile de câmera no grid

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx`
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: `OfficeMediaState.localCameraTrack: LocalVideoTrack | null` (Task 1) — o chamador (`OfficePage`, Task 4) decide quando passar.
- Produces: `MediaTiles({ remotes, local? }: { remotes: RemoteMedia[]; local?: { track: LocalVideoTrack; name: string } | null })` — prop `local` nova, opcional.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/office/media/MediaTiles.test.tsx`, o topo do arquivo:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MediaTiles } from './MediaTiles'
import type { RemoteMedia } from './useOfficeMedia'
import type { RemoteAudioTrack, RemoteVideoTrack } from 'livekit-client'

/** Track falso: só precisa responder a attach/detach, que os componentes chamam no efeito. */
function fakeVideoTrack(): RemoteVideoTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteVideoTrack
}

function fakeAudioTrack(): RemoteAudioTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteAudioTrack
}
```

vira (acrescenta `LocalVideoTrack` e `fakeLocalVideoTrack`):

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
```

E, no final do arquivo, o fecho do `describe`:

```tsx
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
  })
})
```

vira (adiciona dois testes novos antes do `})` final):

```tsx
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
  })

  it('com `local` presente, o próprio tile aparece primeiro na fileira e espelhado', () => {
    const localTrack = fakeLocalVideoTrack()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} local={{ track: localTrack, name: 'Você' }} />)

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    expect(figures[0]).toHaveTextContent('Você')

    const localVideo = figures[0].querySelector('video')
    expect(localTrack.attach).toHaveBeenCalledWith(localVideo)
    expect(localVideo?.className).toContain('scale-x-[-1]')

    // Tile remoto continua sem espelhar.
    const remoteVideo = figures[1].querySelector('video')
    expect(remoteVideo?.className).not.toContain('scale-x-[-1]')
  })

  it('`local` sozinho (sem ninguém com câmera/tela) já é suficiente pra mostrar a faixa', () => {
    const { container } = render(
      <MediaTiles remotes={[remote()]} local={{ track: fakeLocalVideoTrack(), name: 'Você' }} />,
    )
    expect(container.querySelector('.bg-surface-container')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: FAIL — `MediaTiles` não aceita a prop `local` (TS) e o tile "Você" não é renderizado.

- [ ] **Step 3: Implementar `local` em `MediaTiles.tsx`**

Substitua o conteúdo inteiro de `apps/web/src/office/media/MediaTiles.tsx` por:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import type { RemoteMedia } from './useOfficeMedia'
import { RemoteAudio } from './RemoteAudio'

function VideoTile({
  track,
  label,
  mirrored = false,
  onClick,
}: {
  track: RemoteVideoTrack | LocalVideoTrack
  label: string
  mirrored?: boolean
  onClick?: () => void
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
    <figure className="w-40 shrink-0 cursor-pointer" onClick={onClick}>
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`w-full rounded-md bg-black ${mirrored ? 'scale-x-[-1]' : ''}`}
      />
      <figcaption className="truncate font-label text-label-sm text-on-surface-variant">{label}</figcaption>
    </figure>
  )
}

/**
 * Faixa com a mídia de quem você assina agora: áudios invisíveis, câmeras e
 * telas compartilhadas. Clicar numa tela expande num overlay. Dentro de uma
 * sala de reunião, `local` inclui seu próprio tile de câmera no grid.
 */
export function MediaTiles({
  remotes,
  local,
}: {
  remotes: RemoteMedia[]
  local?: { track: LocalVideoTrack; name: string } | null
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const expanded = remotes.find((r) => r.userId === expandedId)?.screenTrack ?? null

  // Quem estava expandido parou de compartilhar (ou saiu): fecha de vez, senão
  // um novo compartilhamento da mesma pessoa reabriria o overlay sozinho.
  useEffect(() => {
    if (expandedId && !remotes.some((r) => r.userId === expandedId && r.screenTrack)) {
      setExpandedId(null)
    }
  }, [remotes, expandedId])

  const hasVisible = !!local || remotes.some((r) => r.cameraTrack || r.screenTrack)

  return (
    <div>
      {remotes.map((r) => r.audioTrack && <RemoteAudio key={`a-${r.userId}`} track={r.audioTrack} />)}

      {hasVisible && (
        <div className="flex gap-md overflow-x-auto rounded-lg bg-surface-container p-md">
          {local && <VideoTile track={local.track} label={local.name} mirrored />}
          {remotes.map((r) => (
            <div key={r.userId} className="flex gap-md">
              {r.cameraTrack && <VideoTile track={r.cameraTrack} label={r.name} />}
              {r.screenTrack && (
                <VideoTile
                  track={r.screenTrack}
                  label={`Tela de ${r.name}`}
                  onClick={() => setExpandedId(r.userId)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-lg"
          onClick={() => setExpandedId(null)}
          role="dialog"
          aria-label="Tela compartilhada em destaque"
        >
          <VideoTile track={expanded} label="Clique para fechar" />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: PASS (todos os testes, os novos e os já existentes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(office): incluir o próprio tile de câmera no grid do MediaTiles"
```

---

## Task 3: `SelfCameraPreview` — tile flutuante arrastável

**Files:**
- Create: `apps/web/src/office/media/SelfCameraPreview.tsx`
- Test: `apps/web/src/office/media/SelfCameraPreview.test.tsx`

**Interfaces:**
- Consumes: `LocalVideoTrack` (de `livekit-client`, mesmo tipo produzido pela Task 1).
- Produces: `SelfCameraPreview({ track, name }: { track: LocalVideoTrack; name: string })` — componente React, sem estado externo; `OfficePage` (Task 4) monta/desmonta condicionalmente.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/web/src/office/media/SelfCameraPreview.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelfCameraPreview } from './SelfCameraPreview'
import type { LocalVideoTrack } from 'livekit-client'

function fakeLocalVideoTrack(): LocalVideoTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as LocalVideoTrack
}

describe('SelfCameraPreview', () => {
  it('anexa o track local ao <video> e aplica espelhamento', () => {
    const track = fakeLocalVideoTrack()
    const { container } = render(<SelfCameraPreview track={track} name="Lucca Secco" />)
    const video = container.querySelector('video')

    expect(video).not.toBeNull()
    expect(track.attach).toHaveBeenCalledWith(video)
    expect(video?.className).toContain('scale-x-[-1]')
  })

  it('mostra o label "Você" e as iniciais do nome', () => {
    render(<SelfCameraPreview track={fakeLocalVideoTrack()} name="Lucca Secco" />)
    expect(screen.getByText('Você')).toBeInTheDocument()
    expect(screen.getByText('LS')).toBeInTheDocument()
  })

  it('nasce no canto superior direito da viewport', () => {
    const { container } = render(<SelfCameraPreview track={fakeLocalVideoTrack()} name="Lucca" />)
    const root = container.firstElementChild as HTMLElement

    expect(root.style.left).toBe(`${window.innerWidth - 176 - 16}px`)
    expect(root.style.top).toBe('16px')
  })

  it('arrastar move o tile pela mesma quantidade do deslocamento do pointer', () => {
    const { container } = render(<SelfCameraPreview track={fakeLocalVideoTrack()} name="Lucca" />)
    const root = container.firstElementChild as HTMLElement
    const initialLeft = parseInt(root.style.left, 10)
    const initialTop = parseInt(root.style.top, 10)

    fireEvent.pointerDown(root, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 60, clientY: 130 }) // -40x, +30y
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 60, clientY: 130 })

    expect(parseInt(root.style.left, 10)).toBe(initialLeft - 40)
    expect(parseInt(root.style.top, 10)).toBe(initialTop + 30)
  })

  it('clampa a posição dentro dos limites da viewport ao arrastar além da borda', () => {
    const { container } = render(<SelfCameraPreview track={fakeLocalVideoTrack()} name="Lucca" />)
    const root = container.firstElementChild as HTMLElement
    const initialLeft = parseInt(root.style.left, 10)
    const initialTop = parseInt(root.style.top, 10)

    fireEvent.pointerDown(root, { pointerId: 1, clientX: initialLeft, clientY: initialTop })
    fireEvent.pointerMove(root, { pointerId: 1, clientX: -1000, clientY: -1000 })

    expect(parseInt(root.style.left, 10)).toBe(16)
    expect(parseInt(root.style.top, 10)).toBe(16)
  })

  it('pointermove sem pointerdown antes não move o tile', () => {
    const { container } = render(<SelfCameraPreview track={fakeLocalVideoTrack()} name="Lucca" />)
    const root = container.firstElementChild as HTMLElement
    const initialLeft = root.style.left

    fireEvent.pointerMove(root, { pointerId: 1, clientX: 60, clientY: 130 })

    expect(root.style.left).toBe(initialLeft)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/SelfCameraPreview.test.tsx`
Expected: FAIL — `Failed to resolve import "./SelfCameraPreview"` (o arquivo ainda não existe).

- [ ] **Step 3: Implementar `SelfCameraPreview.tsx`**

Crie `apps/web/src/office/media/SelfCameraPreview.tsx`:

```tsx
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { LocalVideoTrack } from 'livekit-client'

const PREVIEW_SIZE = 176
const EDGE_MARGIN = 16

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function defaultPosition(): { x: number; y: number } {
  return { x: window.innerWidth - PREVIEW_SIZE - EDGE_MARGIN, y: EDGE_MARGIN }
}

function clampToViewport(pos: { x: number; y: number }): { x: number; y: number } {
  return {
    x: clamp(pos.x, EDGE_MARGIN, window.innerWidth - PREVIEW_SIZE - EDGE_MARGIN),
    y: clamp(pos.y, EDGE_MARGIN, window.innerHeight - PREVIEW_SIZE - EDGE_MARGIN),
  }
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('')
      .slice(0, 2) || '?'
  )
}

/**
 * Preview flutuante e arrastável da própria câmera, mostrado no espaço
 * aberto (fora de sala de reunião) enquanto a câmera estiver ligada.
 */
export function SelfCameraPreview({ track, name }: { track: LocalVideoTrack; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [position, setPosition] = useState(defaultPosition)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])

  useEffect(() => {
    const onResize = () => setPosition((pos) => clampToViewport(pos))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition(
      clampToViewport({
        x: event.clientX - drag.offsetX,
        y: event.clientY - drag.offsetY,
      }),
    )
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  return (
    <div
      className="fixed z-20 cursor-grab touch-none select-none active:cursor-grabbing"
      style={{ left: position.x, top: position.y, width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full rounded-xl bg-black object-cover scale-x-[-1]"
      />
      <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full border-2 border-[#8bd3e6] bg-surface-container-high px-2 py-1 font-label text-label-sm text-on-surface shadow-lg">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
          {initialsOf(name)}
        </span>
        <span>Você</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/SelfCameraPreview.test.tsx`
Expected: PASS (todos os 6 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/SelfCameraPreview.tsx apps/web/src/office/media/SelfCameraPreview.test.tsx
git commit -m "feat(office): tile flutuante e arrastável do self-preview de câmera"
```

---

## Task 4: `OfficePage` — ligar o self-preview

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx` (mock de `useOfficeMedia` precisa da propriedade nova)

**Interfaces:**
- Consumes: `media.cameraEnabled`, `media.localCameraTrack` (Task 1); `SelfCameraPreview` (Task 3); `MediaTiles` com prop `local` (Task 2); `zoneName` (já existe em `OfficePage`, via `zoneAt`).

- [ ] **Step 1: Atualizar o mock de `useOfficeMedia` em `OfficePage.test.tsx` (torna o teste vermelho por incompatibilidade de tipo)**

Em `apps/web/src/pages/OfficePage.test.tsx`, o mock:

```tsx
vi.mock('../office/media/useOfficeMedia', () => ({
  useOfficeMedia: () => ({
    status: 'connected',
    roomName: 'office-open',
    micEnabled: false,
    micError: false,
    cameraEnabled: false,
    cameraError: false,
    screenShareEnabled: false,
    screenShareError: false,
    remotes: [],
    toggleMic: async () => {},
    toggleCamera: async () => {},
    toggleScreenShare: async () => {},
    applyMicEnabled: async () => {},
  }),
}))
```

vira:

```tsx
vi.mock('../office/media/useOfficeMedia', () => ({
  useOfficeMedia: () => ({
    status: 'connected',
    roomName: 'office-open',
    micEnabled: false,
    micError: false,
    cameraEnabled: false,
    cameraError: false,
    screenShareEnabled: false,
    screenShareError: false,
    remotes: [],
    localCameraTrack: null,
    toggleMic: async () => {},
    toggleCamera: async () => {},
    toggleScreenShare: async () => {},
    applyMicEnabled: async () => {},
  }),
}))
```

- [ ] **Step 2: Rodar o typecheck do web e confirmar que falha antes do wiring**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: FAIL — `Property 'localCameraTrack' is missing in type ... OfficeMediaState` no uso de `media.localCameraTrack` que ainda não existe em `OfficePage.tsx` (a falha real aparece no próximo passo; este comando aqui serve de baseline — rode de novo no Step 4 pra confirmar o PASS).

- [ ] **Step 3: Ligar `SelfCameraPreview` e o prop `local` do `MediaTiles` em `OfficePage.tsx`**

O bloco de imports:

```tsx
import { OfficeBridge } from '../office/OfficeBridge'
import { OfficeCanvas } from '../office/OfficeCanvas'
import { useOfficeSocket } from '../office/useOfficeSocket'
import { useOfficeMedia } from '../office/media/useOfficeMedia'
import { useOfficeBroadcast } from '../office/media/useOfficeBroadcast'
import { MediaBar } from '../office/media/MediaBar'
import { MediaTiles } from '../office/media/MediaTiles'
import { BroadcastBanner } from '../office/media/BroadcastBanner'
```

vira:

```tsx
import { OfficeBridge } from '../office/OfficeBridge'
import { OfficeCanvas } from '../office/OfficeCanvas'
import { useOfficeSocket } from '../office/useOfficeSocket'
import { useOfficeMedia } from '../office/media/useOfficeMedia'
import { useOfficeBroadcast } from '../office/media/useOfficeBroadcast'
import { MediaBar } from '../office/media/MediaBar'
import { MediaTiles } from '../office/media/MediaTiles'
import { SelfCameraPreview } from '../office/media/SelfCameraPreview'
import { BroadcastBanner } from '../office/media/BroadcastBanner'
```

O cálculo de `zoneName`:

```tsx
  const you = occupants.find((o) => o.userId === youId) ?? null
  const zoneName = you ? (zoneAt(you.x, you.y)?.name ?? null) : null
```

vira (adiciona `inMeetingRoom` e `selfCamera` logo depois):

```tsx
  const you = occupants.find((o) => o.userId === youId) ?? null
  const zoneName = you ? (zoneAt(you.x, you.y)?.name ?? null) : null
  const inMeetingRoom = zoneName !== null
  const selfCamera =
    media.cameraEnabled && media.localCameraTrack
      ? { track: media.localCameraTrack, name: you?.name ?? 'Você' }
      : null
```

A linha do `MediaTiles`:

```tsx
        <MediaTiles remotes={media.remotes} />
```

vira:

```tsx
        <MediaTiles remotes={media.remotes} local={inMeetingRoom ? selfCamera : null} />
```

E logo após `<BroadcastBanner speakers={broadcast.speakers} tracks={broadcast.broadcastTracks} />`:

```tsx
      <BroadcastBanner speakers={broadcast.speakers} tracks={broadcast.broadcastTracks} />
```

vira:

```tsx
      <BroadcastBanner speakers={broadcast.speakers} tracks={broadcast.broadcastTracks} />

      {!inMeetingRoom && selfCamera && (
        <SelfCameraPreview track={selfCamera.track} name={selfCamera.name} />
      )}
```

- [ ] **Step 4: Rodar o typecheck e os testes do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS — sem erros de tipo.

Run: `pnpm --filter @legends/web test`
Expected: PASS — toda a suíte do `apps/web`, incluindo `OfficePage.test.tsx`, `MediaTiles.test.tsx`, `useOfficeMedia.test.ts` e `SelfCameraPreview.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(office): ligar self-preview de câmera na OfficePage"
```

- [ ] **Step 6: Verificação manual (dois navegadores/abas, com Postgres e LiveKit de dev no ar)**

1. `pnpm db:up` e `pnpm dev` na raiz.
2. Login com dois usuários (ou duas abas anônimas), entrar no escritório.
3. Ligar a câmera no espaço aberto → o tile flutuante "Você" aparece no canto superior direito, espelhado, arrastável.
4. Andar até uma sala de reunião com a câmera ligada → o tile flutuante some; seu tile de câmera aparece no grid do `MediaTiles` junto com quem mais estiver na sala.
5. Desligar a câmera (em qualquer lugar) → os dois tiles somem.
6. Redimensionar a janela do navegador com o preview arrastado pra um canto → ele nunca fica fora da viewport.

---

## Self-Review

**Cobertura do spec:** rastreamento do `localCameraTrack` (Task 1), tile flutuante arrastável e espelhado fora de sala (Task 3, wiring na Task 4), tile no grid dentro de sala (Task 2, wiring na Task 4), reset do track ao trocar de sala (Task 1, teste dedicado), sem persistência de posição nem botão de minimizar (não implementados — conforme "Fora" do escopo). Todos os itens do "Escopo do v1" da spec têm task correspondente.

**Placeholders:** nenhum `TBD`/`TODO`; todo passo de código tem o código completo.

**Consistência de tipos:** `LocalVideoTrack` usado de forma consistente entre `useOfficeMedia.localCameraTrack` (Task 1), `MediaTiles`'s prop `local: { track: LocalVideoTrack; name: string }` (Task 2) e `SelfCameraPreview`'s prop `track: LocalVideoTrack` (Task 3); o objeto `selfCamera` montado em `OfficePage` (Task 4) bate exatamente com o shape que `MediaTiles.local` e `SelfCameraPreview` esperam.
