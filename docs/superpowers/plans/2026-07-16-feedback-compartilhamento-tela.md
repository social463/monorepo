# Feedback de Compartilhamento de Tela Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar feedback visual de compartilhamento de tela em três contextos do escritório virtual: autopreview dentro da sala de reunião, indicador+grid na área aberta do mapa, e priorização no PiP fora do `/escritorio`.

**Architecture:** Reaproveita a infraestrutura LiveKit já existente (`useOfficeMedia`, `MediaTiles`, `OfficePipWindow`). Adiciona ao hook uma track de tela local (espelhando o que já existe para câmera local) e um registro de "ordem de início" de compartilhamento (local + remoto), usado como critério de destaque em todos os três lugares que mostram tela compartilhada.

**Tech Stack:** React 18, TypeScript strict, LiveKit client (via `livekit-loader.ts`), Vitest + Testing Library (jsdom).

## Global Constraints

- Mensagens/labels voltados ao usuário em português (ex.: `Tela de <nome>`).
- TypeScript strict — sem `any`; tipos importados de `livekit-client` (`LocalVideoTrack`, `RemoteVideoTrack`) e `@legends/shared` onde já usados hoje.
- Testes Vitest + Testing Library colocados ao lado do código (`*.test.ts(x)`), seguindo os fakes já existentes em `useOfficeMedia.test.ts` (não reescrever o fake do LiveKit — só estender).
- Rode `pnpm --filter @legends/web test` (ou `pnpm test` na raiz) e `pnpm --filter @legends/web exec tsc --noEmit` antes de considerar cada task concluída — `pnpm build` sozinho não faz typecheck (ver `docs/superpowers` / memória do projeto).
- Não introduzir estado de "roomId" para a área aberta — a spec decidiu explicitamente que a área aberta não ganha chat/pessoas nesta feature.

---

### Task 1: `useOfficeMedia` — track de tela local + ordem de início do compartilhamento

**Files:**
- Modify: `apps/web/src/office/media/useOfficeMedia.ts`
- Test: `apps/web/src/office/media/useOfficeMedia.test.ts`
- Modify (fixture, só para manter o TypeScript feliz): `apps/web/src/pages/OfficePage.test.tsx:115-133` (`mediaState()` helper)

**Interfaces:**
- Produces: `OfficeMediaState.localScreenTrack: LocalVideoTrack | null` e `OfficeMediaState.screenShareOrder: ReadonlyMap<string, number>` (chave `'local'` para o próprio usuário, `participant.identity` — i.e. `userId` — para remotos; valor = ordem crescente de início, menor = começou primeiro). Consumido pelas Tasks 2, 3 e 5.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `apps/web/src/office/media/useOfficeMedia.test.ts` (dentro do mesmo `describe` existente, dep. estrutura atual do arquivo — inserir antes do fechamento do `describe`):

```ts
  it('rastreia o track local de tela via LocalTrackPublished/Unpublished', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    const fakeTrack = { attach: vi.fn(), detach: vi.fn() }

    expect(result.current.localScreenTrack).toBeNull()

    await act(async () => {
      room.emit('localTrackPublished', { source: 'screen_share', track: fakeTrack })
    })
    expect(result.current.localScreenTrack).toBe(fakeTrack)

    await act(async () => {
      room.emit('localTrackUnpublished', { source: 'screen_share' })
    })
    expect(result.current.localScreenTrack).toBeNull()
  })

  it('screenShareOrder registra quem compartilhou primeiro (local e remoto) e some ao encerrar', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!

    await act(async () => {
      room.emit('localTrackPublished', { source: 'screen_share', track: { attach: vi.fn(), detach: vi.fn() } })
    })
    expect(result.current.screenShareOrder.get('local')).toBe(0)

    const remoteParticipant = { identity: 'ana' }
    await act(async () => {
      room.emit('trackPublished', { source: 'screen_share' }, remoteParticipant)
    })
    expect(result.current.screenShareOrder.get('ana')).toBe(1)
    // ordem não muda se o mesmo remoto "republicar" (ex: TrackPublished duplicado)
    await act(async () => {
      room.emit('trackPublished', { source: 'screen_share' }, remoteParticipant)
    })
    expect(result.current.screenShareOrder.get('ana')).toBe(1)

    await act(async () => {
      room.emit('trackUnpublished', { source: 'screen_share' }, remoteParticipant)
    })
    expect(result.current.screenShareOrder.has('ana')).toBe(false)

    await act(async () => {
      room.emit('localTrackUnpublished', { source: 'screen_share' })
    })
    expect(result.current.screenShareOrder.has('local')).toBe(false)
  })

  it('trocar de sala zera a track local de tela e a ordem de compartilhamento', async () => {
    const { rerender, result } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 12, 14)] }, // espaço aberto
    })
    await settle(600)
    const openRoom = FakeRoom.instances.at(-1)!
    await act(async () => {
      openRoom.emit('localTrackPublished', { source: 'screen_share', track: { attach: vi.fn(), detach: vi.fn() } })
    })
    expect(result.current.localScreenTrack).not.toBeNull()
    expect(result.current.screenShareOrder.get('local')).toBe(0)

    rerender({ occ: [occupant('you', 18, 15)] }) // entra na zona reuniao-2
    await settle(600)

    expect(result.current.localScreenTrack).toBeNull()
    expect(result.current.screenShareOrder.has('local')).toBe(false)
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts`
Expected: FAIL — `localScreenTrack`/`screenShareOrder` são `undefined` (propriedades não existem ainda em `OfficeMediaState`).

- [ ] **Step 3: Implementar em `useOfficeMedia.ts`**

Adicionar import de `RemoteVideoTrack`/`RemoteTrackPublication`/`RemoteParticipant` (tipos, não valores) e os novos campos. Trecho completo com o contexto ao redor (linhas aproximadas do arquivo atual):

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrackPublication,
  RemoteVideoTrack,
  Room,
} from 'livekit-client'
```

Interface (adicionar dois campos, próximo a `localCameraTrack`):

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
  localScreenTrack: LocalVideoTrack | null
  /** Ordem de início do compartilhamento de tela: chave 'local' para o próprio
   * usuário, userId para remotos; menor valor = começou a compartilhar
   * primeiro. Usado como critério de destaque quando há múltiplas telas
   * ativas ao mesmo tempo (MediaTiles, grid da área aberta, PiP). */
  screenShareOrder: ReadonlyMap<string, number>
  toggleMic(): Promise<void>
  toggleCamera(): Promise<void>
  toggleScreenShare(): Promise<void>
  applyMicEnabled(enabled: boolean): Promise<void>
}
```

Novo estado/refs, logo abaixo de `localCameraTrack`:

```ts
  const [localCameraTrack, setLocalCameraTrack] = useState<LocalVideoTrack | null>(null)
  const [localScreenTrack, setLocalScreenTrack] = useState<LocalVideoTrack | null>(null)
  const [stableRoom, setStableRoom] = useState<string | null>(null)
  const screenShareOrderRef = useRef<Map<string, number>>(new Map())
  const screenShareCounterRef = useRef(0)
```

Em `connectTo`, no reset do topo (onde hoje zera `remotes`/`localCameraTrack` antes de conectar):

```ts
      setRemotes([])
      setLocalCameraTrack(null)
      setLocalScreenTrack(null)
      screenShareOrderRef.current = new Map()
      screenShareCounterRef.current = 0
      setStatus('connecting')
```

Nos listeners de `TrackPublished`/`TrackUnpublished` (hoje ignoram os argumentos — passam a recebê-los para rastrear ordem; guard opcional (`pub?.source`) preserva os testes existentes que chamam `room.emit('trackPublished')` sem argumentos):

```ts
          .on(RoomEvent.TrackPublished, (pub?: RemoteTrackPublication, participant?: RemoteParticipant) => {
            if (pub?.source === Track.Source.ScreenShare && participant && !screenShareOrderRef.current.has(participant.identity)) {
              screenShareOrderRef.current.set(participant.identity, screenShareCounterRef.current++)
            }
            applyProximity()
            syncRemotes()
          })
          .on(RoomEvent.TrackUnpublished, (pub?: RemoteTrackPublication, participant?: RemoteParticipant) => {
            if (pub?.source === Track.Source.ScreenShare && participant) {
              screenShareOrderRef.current.delete(participant.identity)
            }
            syncRemotes()
          })
```

Nos listeners `LocalTrackPublished`/`LocalTrackUnpublished` (adicionar tratamento de `ScreenShare` para track + ordem, ao lado do que já existe):

```ts
          .on(RoomEvent.LocalTrackPublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              setScreenShareEnabled(true)
              setScreenShareError(false)
              setLocalScreenTrack((pub.track as LocalVideoTrack | undefined) ?? null)
              if (!screenShareOrderRef.current.has('local')) {
                screenShareOrderRef.current.set('local', screenShareCounterRef.current++)
              }
            }
            if (pub.source === Track.Source.Camera) {
              setLocalCameraTrack((pub.track as LocalVideoTrack | undefined) ?? null)
            }
          })
          .on(RoomEvent.LocalTrackUnpublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              setScreenShareEnabled(false)
              setLocalScreenTrack(null)
              screenShareOrderRef.current.delete('local')
            }
            if (pub.source === Track.Source.Camera) {
              setLocalCameraTrack(null)
            }
          })
```

No reset de "sem sala" (`if (!stableRoom) { ... }`), adicionar ao final do bloco de resets:

```ts
      setLocalCameraTrack(null)
      setLocalScreenTrack(null)
      screenShareOrderRef.current = new Map()
      return
```

No `return` do hook, adicionar os dois novos campos:

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
    localScreenTrack,
    screenShareOrder: screenShareOrderRef.current,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    applyMicEnabled,
  }
```

- [ ] **Step 4: Atualizar o fixture de `OfficePage.test.tsx`**

Em `apps/web/src/pages/OfficePage.test.tsx`, a função `mediaState()` (linhas 115-133) precisa incluir os dois novos campos obrigatórios do tipo:

```ts
function mediaState(overrides: Partial<OfficeMediaState> = {}): OfficeMediaState {
  return {
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
    localScreenTrack: null,
    screenShareOrder: new Map(),
    toggleMic: vi.fn(async () => {}),
    toggleCamera: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async () => {}),
    applyMicEnabled: vi.fn(async () => {}),
    ...overrides,
  }
}
```

- [ ] **Step 5: Rodar os testes e o typecheck**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts src/pages/OfficePage.test.tsx`
Expected: PASS (todos os testes, incluindo os 3 novos e os já existentes).

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeMedia.test.ts apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(web): expõe track local de tela e ordem de início do compartilhamento"
```

---

### Task 2: `MediaTiles` — tile da própria tela + destaque por ordem de início

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx`
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: `RemoteMedia` (já existente), `OfficeMediaState.screenShareOrder` (Task 1) — tipo `ReadonlyMap<string, number>`.
- Produces: prop `local.screenTrack?: LocalVideoTrack | null` e prop `screenShareOrder?: ReadonlyMap<string, number>` em `MediaTiles`. Consumido pela Task 3 (`OfficePage`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `apps/web/src/office/media/MediaTiles.test.tsx` (usa os helpers `fakeVideoTrack`/`fakeLocalVideoTrack`/`remote` já existentes no topo do arquivo):

```ts
  it('com local.screenTrack, aparece um tile extra "Tela de <nome>" além do tile de câmera/avatar do próprio usuário', () => {
    const localCam = fakeLocalVideoTrack()
    const localScreen = fakeLocalVideoTrack()
    render(
      <MediaTiles
        remotes={[]}
        local={{ track: localCam, screenTrack: localScreen, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    expect(figures.some((f) => f.textContent === 'Tela de Você')).toBe(true)
  })

  it('sem câmera local mas com tela local, gera só o tile de tela (não duplica um tile de avatar)', () => {
    const localScreen = fakeLocalVideoTrack()
    render(
      <MediaTiles
        remotes={[]}
        local={{ track: null, screenTrack: localScreen, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(1)
    expect(figures[0]).toHaveTextContent('Tela de Você')
  })

  it('destaque com múltiplas telas ativas segue screenShareOrder (quem começou primeiro), não a ordem do array', () => {
    const remotes = [
      remote({ userId: 'ana', name: 'Ana', screenTrack: fakeVideoTrack() }),
      remote({ userId: 'bruno', name: 'Bruno', screenTrack: fakeVideoTrack() }),
    ]
    // Bruno aparece primeiro no array, mas Ana começou a compartilhar antes.
    const screenShareOrder = new Map([
      ['bruno', 1],
      ['ana', 0],
    ])
    render(
      <MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} screenShareOrder={screenShareOrder} />,
    )
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Ana')
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: FAIL — `local.screenTrack` e a prop `screenShareOrder` não existem ainda; destaque hoje pega o primeiro tile `screen` do array (Bruno), não o de Ana.

- [ ] **Step 3: Implementar em `MediaTiles.tsx`**

Tipo `Tile` ganha `sharerId` (identidade de quem compartilha, usada só para tiles `kind: 'screen'` no desempate de destaque):

```ts
interface Tile {
  key: string
  kind: TileKind
  label: string
  track: RemoteVideoTrack | LocalVideoTrack | null
  mirrored: boolean
  avatar: AvatarSource
  sharerId: string | null
}
```

`buildTiles` passa a aceitar `local.screenTrack` e monta um tile extra para ele; todo tile ganha `sharerId`:

```ts
function buildTiles(
  remotes: RemoteMedia[],
  local?: {
    track: LocalVideoTrack | null
    screenTrack?: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: CharacterOptions | null
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
      sharerId: null,
    })
    if (local.screenTrack) {
      tiles.push({
        key: 'local-screen',
        kind: 'screen',
        label: `Tela de ${local.name}`,
        track: local.screenTrack,
        mirrored: false,
        avatar: local,
        sharerId: 'local',
      })
    }
  }
  for (const r of remotes) {
    if (r.cameraTrack) {
      tiles.push({ key: `cam:${r.userId}`, kind: 'camera', label: r.name, track: r.cameraTrack, mirrored: false, avatar: r, sharerId: null })
    }
    if (r.screenTrack) {
      tiles.push({
        key: `screen:${r.userId}`,
        kind: 'screen',
        label: `Tela de ${r.name}`,
        track: r.screenTrack,
        mirrored: false,
        avatar: r,
        sharerId: r.userId,
      })
    }
    if (!r.cameraTrack && !r.screenTrack) {
      tiles.push({ key: `avatar:${r.userId}`, kind: 'avatar', label: r.name, track: null, mirrored: false, avatar: r, sharerId: null })
    }
  }
  return tiles
}
```

`resolveFeatured` passa a receber `screenShareOrder` e, entre os tiles `screen`, escolhe o de menor ordem (menor = começou primeiro; sem entrada no mapa, vai para o fim):

```ts
function earliestScreen(screens: Tile[], screenShareOrder: ReadonlyMap<string, number>): Tile {
  return screens.reduce((best, tile) => {
    const bestOrder = best.sharerId ? screenShareOrder.get(best.sharerId) ?? Infinity : Infinity
    const tileOrder = tile.sharerId ? screenShareOrder.get(tile.sharerId) ?? Infinity : Infinity
    return tileOrder < bestOrder ? tile : best
  })
}

function resolveFeatured(tiles: Tile[], pin: string | null, screenShareOrder: ReadonlyMap<string, number>): Tile | null {
  const pinned = pin ? tiles.find((t) => t.key === pin) : undefined
  if (pinned) return pinned
  const screens = tiles.filter((t) => t.kind === 'screen')
  // Sem pin nenhum ainda (grade recém-aberta): só uma tela compartilhada
  // justifica destacar algo sozinha — câmeras não roubam o grid uniforme.
  if (!pin) return screens.length > 0 ? earliestScreen(screens, screenShareOrder) : null
  // Pin existia mas o alvo sumiu (perdeu mídia/saiu): recupera pra qualquer
  // mídia ativa restante antes de desistir e voltar pro grid uniforme.
  if (screens.length > 0) return earliestScreen(screens, screenShareOrder)
  return tiles.find((t) => t.kind === 'camera') ?? null
}
```

Assinatura do componente ganha `local.screenTrack` no tipo e a nova prop `screenShareOrder`:

```ts
export function MediaTiles({
  remotes,
  local,
  expanded = false,
  onToggleExpanded = () => {},
  showAllPresent = false,
  screenShareOrder = new Map(),
  roomPanel = null,
  roomChatMessages = [],
  onSendRoomChatMessage = () => {},
  roomOccupants = [],
  onCloseRoomPanel = () => {},
}: {
  remotes: RemoteMedia[]
  local?: {
    track: LocalVideoTrack | null
    screenTrack?: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: CharacterOptions | null
  } | null
  expanded?: boolean
  onToggleExpanded?: () => void
  showAllPresent?: boolean
  screenShareOrder?: ReadonlyMap<string, number>
  roomPanel?: 'chat' | 'people' | null
  roomChatMessages?: RoomChatMessage[]
  onSendRoomChatMessage?: (text: string) => void
  roomOccupants?: OfficeOccupant[]
  onCloseRoomPanel?: () => void
}) {
```

E as duas chamadas de `resolveFeatured`/`buildTiles` já existentes no corpo do componente passam a incluir `screenShareOrder`:

```ts
  const tiles = buildTiles(remotes, local)
  ...
  const featured = resolveFeatured(tiles, featuredPin, screenShareOrder)
```

(nenhuma outra linha do JSX muda — `featured`/`tiles` já eram consumidos do mesmo jeito.)

- [ ] **Step 4: Rodar os testes**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: PASS (novos e antigos).

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(web): grade de mídia inclui a própria tela e destaca por ordem de início"
```

---

### Task 3: `OfficePage` — autopreview na sala + indicador e grid na área aberta

**Files:**
- Create: `apps/web/src/office/media/ScreenShareIndicator.tsx`
- Create: `apps/web/src/office/media/ScreenShareIndicator.test.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `useCharacterScreenPositions` (já existente, genérico por `userId`), `MediaTiles` com `local.screenTrack`/`screenShareOrder` (Task 2), `OfficeMediaState.localScreenTrack`/`screenShareOrder` (Task 1).
- Produces: componente `ScreenShareIndicator` (badge clicável por pessoa compartilhando na área aberta).

- [ ] **Step 1: Escrever o componente `ScreenShareIndicator` com teste (TDD dentro do próprio arquivo novo)**

Primeiro o teste, em `apps/web/src/office/media/ScreenShareIndicator.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScreenShareIndicator } from './ScreenShareIndicator'

describe('ScreenShareIndicator', () => {
  it('não renderiza nada sem posição (personagem fora do viewport)', () => {
    const { container } = render(
      <ScreenShareIndicator name="Ana" position={null} hasCameraBubble={false} onClick={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renderiza o rótulo "Tela de <nome>" e chama onClick ao clicar', () => {
    const onClick = vi.fn()
    render(
      <ScreenShareIndicator
        name="Ana"
        position={{ x: 100, y: 200, zoom: 1 }}
        hasCameraBubble={false}
        onClick={onClick}
      />,
    )
    const button = screen.getByRole('button', { name: 'Tela de Ana — clique para ver' })
    expect(button).toHaveTextContent('Tela de Ana')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('com bolha de câmera presente, desloca o indicador para o lado (não sobrepõe)', () => {
    const { rerender, container } = render(
      <ScreenShareIndicator
        name="Ana"
        position={{ x: 100, y: 200, zoom: 1 }}
        hasCameraBubble={false}
        onClick={vi.fn()}
      />,
    )
    const withoutBubble = container.querySelector('button')!.style.left

    rerender(
      <ScreenShareIndicator
        name="Ana"
        position={{ x: 100, y: 200, zoom: 1 }}
        hasCameraBubble
        onClick={vi.fn()}
      />,
    )
    const withBubble = container.querySelector('button')!.style.left
    expect(withBubble).not.toBe(withoutBubble)
  })
})
```

Run: `pnpm --filter @legends/web exec vitest run src/office/media/ScreenShareIndicator.test.tsx`
Expected: FAIL — o arquivo `ScreenShareIndicator.tsx` ainda não existe.

Agora o componente, em `apps/web/src/office/media/ScreenShareIndicator.tsx`:

```tsx
import type { ScreenPosition } from '../scenes/OfficeScene'
import { Icon } from '../../components/Icon'

/** Mesmo deslocamento vertical do balão de câmera (CharacterVideoBubble), para
 * o indicador flutuar na mesma altura acima do personagem quando não há
 * bolha de câmera concorrendo pelo espaço. */
const INDICATOR_OFFSET_Y = 90
/** Quando já existe uma bolha de câmera no mesmo ponto, desloca o indicador
 * para o lado em vez de competir pelo mesmo espaço (nunca sobrepõe). */
const INDICATOR_GAP_X = 60

/**
 * Badge clicável sobre o personagem que está compartilhando tela na área
 * aberta do mapa (fora de sala de reunião formal — dentro de sala, a própria
 * grade já cobre isso). Clicar abre o grid de mídia.
 */
export function ScreenShareIndicator({
  name,
  position,
  hasCameraBubble,
  onClick,
}: {
  name: string
  position: ScreenPosition | null
  hasCameraBubble: boolean
  onClick: () => void
}) {
  if (!position) return null

  const offsetY = INDICATOR_OFFSET_Y * position.zoom
  const offsetX = hasCameraBubble ? INDICATOR_GAP_X * position.zoom : 0

  return (
    <button
      type="button"
      aria-label={`Tela de ${name} — clique para ver`}
      onClick={onClick}
      className="pointer-events-auto absolute flex items-center gap-1 rounded-full border-2 border-primary bg-black/80 px-2 py-1 text-white shadow-lg"
      style={{
        left: position.x + offsetX,
        top: position.y - offsetY,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <Icon name="screen_share" className="text-[14px]" />
      <span className="max-w-[7rem] truncate font-label text-label-sm">Tela de {name}</span>
    </button>
  )
}
```

- [ ] **Step 2: Rodar o teste do novo componente**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/ScreenShareIndicator.test.tsx`
Expected: PASS.

- [ ] **Step 3: Escrever os testes que falham para `OfficePage`**

`OfficePage.test.tsx` já expõe `renderPage(overrides: Partial<OfficeSessionValue>)`, que retorna `{ ...result, rerenderWithSession }` (linhas 184-202 atuais) — `rerenderWithSession` chama `result.rerender` no MESMO componente montado (não desmonta, então `camerasExpanded` não reseta), exatamente o que a última prova abaixo precisa. `youId` default é `'ana'` (`sessionValue()`, linha 175); os `occupants` default são Ana (11,14) e Bruno (12,14) — Bruno é o "remoto" usado abaixo, nunca Ana (que é o próprio usuário). `activeMap` (sem zona) mantém `inMeetingRoom=false`; `meetingRoomMap` põe as mesmas coordenadas dentro de uma zona (já usado assim no teste "dentro de uma sala de reunião..." linha 334-337).

Adicionar ao `describe('OfficePage', ...)`:

```ts
  it('fora de sala de reunião, sem ninguém compartilhando, não há indicador de tela', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /Tela de .* — clique para ver/ })).not.toBeInTheDocument()
  })

  it('fora de sala de reunião, alguém compartilhando tela por perto ganha um indicador clicável', () => {
    renderPage({
      media: mediaState({
        remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack() }],
      }),
    })
    expect(screen.getByRole('button', { name: 'Tela de Bruno Costa — clique para ver' })).toBeInTheDocument()
  })

  it('clicar no indicador da área aberta abre a grade sem chat/pessoas', () => {
    renderPage({
      media: mediaState({
        remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack() }],
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Tela de Bruno Costa — clique para ver' }))

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir chat da sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir pessoas da sala' })).not.toBeInTheDocument()
  })

  it('entrar numa sala de reunião com a grade da área aberta já aberta ganha chat/pessoas', () => {
    const remotes = [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack() }]
    const { rerenderWithSession } = renderPage({ media: mediaState({ remotes }) })
    fireEvent.click(screen.getByRole('button', { name: 'Tela de Bruno Costa — clique para ver' }))
    expect(screen.queryByRole('button', { name: 'Abrir chat da sala' })).not.toBeInTheDocument()

    // Mesmas coordenadas de Ana/Bruno, agora dentro de uma zona de reunião —
    // `camerasExpanded` persiste (mesmo componente), só `inMeetingRoom` muda.
    rerenderWithSession({ activeMap: meetingRoomMap, media: mediaState({ remotes }) })

    expect(screen.getByText('Chat da sala')).toBeInTheDocument()
  })
```

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: FAIL — indicador não existe, `local` só é computado dentro de sala.

- [ ] **Step 5: Implementar em `OfficePage.tsx`**

Import do novo componente, ao lado dos outros imports de `office/media`:

```ts
import { ScreenShareIndicator } from '../office/media/ScreenShareIndicator'
```

Substituir o bloco `selfCamera`/`local` (linhas 72-86 atuais) por:

```ts
  const selfCamera =
    media.cameraEnabled && media.localCameraTrack
      ? { track: media.localCameraTrack, name: you?.name ?? 'Você' }
      : null
  // `local` não depende mais de `inMeetingRoom`: a grade (MediaTiles) só
  // renderiza algo quando `expanded`, e `showAllPresent=false` fora de sala
  // já evita que um tile de avatar sozinho force a grade a abrir sozinha —
  // ver comentário em MediaTiles sobre `hasVisible`.
  const local = you
    ? {
        name: you.name,
        track: selfCamera?.track ?? null,
        screenTrack: media.localScreenTrack,
        photoUrl: you.photoUrl,
        avatarStyle: you.avatarStyle,
        avatarSeed: you.avatarSeed,
        avatarOptions: you.avatarOptions,
      }
    : null
```

Logo abaixo de `cameraBubbleUserIds`/`screenPositions` (linhas 102-103 atuais), adicionar o cálculo dos indicadores de tela da área aberta:

```ts
  const cameraBubbleUserIds = useMemo(() => cameraBubbles.map((b) => b.userId), [cameraBubbles])
  const screenPositions = useCharacterScreenPositions(canvasRef, cameraBubbleUserIds)

  // Indicador de tela compartilhada na área aberta: só faz sentido fora de
  // sala de reunião formal (dentro de sala, o botão de grade já cobre isso).
  // Mostra só os OUTROS compartilhando — a própria tela não precisa de
  // indicador clicável sobre o próprio personagem.
  const screenSharers = useMemo(
    () => (inMeetingRoom ? [] : media.remotes.filter((r) => r.screenTrack).map((r) => ({ userId: r.userId, name: r.name }))),
    [inMeetingRoom, media.remotes],
  )
  const screenSharerUserIds = useMemo(() => screenSharers.map((s) => s.userId), [screenSharers])
  const screenSharerPositions = useCharacterScreenPositions(canvasRef, screenSharerUserIds)
```

Logo após o bloco dos balões de câmera (linhas 180-190 atuais), adicionar o bloco dos indicadores (mesmo wrapper `pointer-events-none`, cada indicador se torna clicável via sua própria classe `pointer-events-auto`, já definida no componente):

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
        {screenSharers.map((s) => (
          <ScreenShareIndicator
            key={s.userId}
            name={s.name}
            position={screenSharerPositions.get(s.userId) ?? null}
            hasCameraBubble={cameraBubbleUserIds.includes(s.userId)}
            onClick={() => setCamerasExpanded(true)}
          />
        ))}
      </div>
```

Ajustar o efeito que decide o `roomPanel` (linhas 145-148 atuais) para só nascer com chat quando a grade abriu DENTRO de uma sala — abrir via indicador da área aberta não ganha painel nenhum, mas entrar numa sala com a grade já aberta (borda) ganha:

```ts
  // A grade nasce no chat só quando é "de sala" (botão de grade ou
  // auto-abertura, ambos só dentro de `inMeetingRoom`); aberta pelo
  // indicador da área aberta, nasce sem painel — entrar numa sala com ela já
  // aberta ganha os recursos de sala nesse momento (reage a `inMeetingRoom`,
  // não só a `camerasExpanded`).
  useEffect(() => {
    if (!camerasExpanded) {
      setRoomPanel(null)
      return
    }
    setRoomPanel(inMeetingRoom ? 'chat' : null)
  }, [camerasExpanded, inMeetingRoom])
```

Passar `screenShareOrder` para `MediaTiles` (bloco `<MediaTiles ... />`, linhas 308-319 atuais):

```tsx
      <MediaTiles
        remotes={media.remotes}
        local={local}
        expanded={camerasExpanded}
        onToggleExpanded={() => setCamerasExpanded((value) => !value)}
        showAllPresent={inMeetingRoom}
        screenShareOrder={media.screenShareOrder}
        roomPanel={roomPanel}
        roomChatMessages={roomChat.messages}
        onSendRoomChatMessage={roomChat.sendMessage}
        roomOccupants={roomOccupants}
        onCloseRoomPanel={() => setRoomPanel(null)}
      />
```

E gatear `showRoomControls` da `MediaBar` (bloco `<MediaBar ... />`, linha 342 atual) para só aparecer dentro de sala, mesmo com a grade aberta pelo indicador da área aberta:

```tsx
          showRoomControls={camerasExpanded && inMeetingRoom}
```

- [ ] **Step 6: Rodar os testes e o typecheck**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx src/office/media/ScreenShareIndicator.test.tsx`
Expected: PASS.

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/media/ScreenShareIndicator.tsx apps/web/src/office/media/ScreenShareIndicator.test.tsx apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(web): indicador clicável de tela compartilhada na área aberta do mapa"
```

---

### Task 4: `OfficePipWindow` — prioriza tela compartilhada sobre câmeras

**Files:**
- Modify: `apps/web/src/office/pip/OfficePipWindow.tsx`
- Test: `apps/web/src/office/pip/OfficePipWindow.test.tsx`

**Interfaces:**
- Consumes: `OfficeMediaState.localScreenTrack`/`screenShareOrder` (Task 1), `RemoteMedia.screenTrack` (já existente).

- [ ] **Step 1: Escrever os testes que falham**

`OfficePipWindow.test.tsx` monta a sessão via `makeSession(overrides: Record<string, unknown> = {})` (linhas 19-57 atuais), que já tem um `media` default sem `localScreenTrack`/`screenShareOrder` — o cast `as unknown as OfficeSessionValue` no fim de `makeSession` deixa passar, mas os testes abaixo precisam informar os dois campos explicitamente quando exercitam esse caminho. Overrides de `media` substituem o objeto inteiro (não fazem merge profundo) — o padrão já usado no arquivo é `makeSession({ media: { ...makeSession().media, ... } })` (ver teste "renderiza tiles de quem está com câmera ligada", linhas 131-152). `renderAt(path, session)` é o helper de render existente.

Primeiro, adicionar `localScreenTrack: null` ao `media` default dentro de `makeSession` (linha 41 atual, junto de `localCameraTrack: null`):

```ts
      localCameraTrack: null,
      localScreenTrack: null,
```

Depois, adicionar ao `describe('OfficePipWindow', ...)`:

```ts
  it('com tela compartilhada remota ativa, mostra um único tile de tela no lugar do grid de câmeras', () => {
    const screenTrack = fakeVideoTrack()
    renderAt(
      '/',
      makeSession({
        media: {
          ...makeSession().media,
          cameraEnabled: true,
          localCameraTrack: fakeVideoTrack(),
          remotes: [{ userId: 'u2', name: 'Bia', audioTrack: null, cameraTrack: null, screenTrack }],
          screenShareOrder: new Map([['u2', 0]]),
        },
      }),
    )
    expect(screen.getByText('Tela de Bia')).toBeInTheDocument()
    expect(screen.queryByText('Você')).not.toBeInTheDocument()
  })

  it('com tela local e remota simultâneas, prioriza quem começou a compartilhar primeiro (screenShareOrder)', () => {
    renderAt(
      '/',
      makeSession({
        media: {
          ...makeSession().media,
          localScreenTrack: fakeVideoTrack(),
          remotes: [{ userId: 'u2', name: 'Bia', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack() }],
          screenShareOrder: new Map([
            ['u2', 0],
            ['local', 1],
          ]),
        },
      }),
    )
    expect(screen.getByText('Tela de Bia')).toBeInTheDocument()
  })

  it('sem tela compartilhada, mantém o comportamento atual de grid de câmeras', () => {
    renderAt(
      '/',
      makeSession({
        media: { ...makeSession().media, cameraEnabled: true, localCameraTrack: fakeVideoTrack() },
      }),
    )
    expect(screen.getByText('Você')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/pip/OfficePipWindow.test.tsx`
Expected: FAIL — hoje o PiP nunca renderiza tela compartilhada.

- [ ] **Step 3: Implementar em `OfficePipWindow.tsx`**

Dentro de `PipWindowBody`, antes do cálculo de `tiles`/`visible` (linhas 73-86 atuais), adicionar a resolução da tela em destaque:

```ts
  const screenSharers: Array<{ key: string; name: string; track: LocalVideoTrack | RemoteVideoTrack }> = []
  if (media.localScreenTrack) {
    screenSharers.push({ key: 'local', name: 'Você', track: media.localScreenTrack })
  }
  for (const r of media.remotes) {
    if (r.screenTrack) screenSharers.push({ key: r.userId, name: r.name, track: r.screenTrack })
  }
  const featuredScreen =
    screenSharers.length > 0
      ? screenSharers.reduce((best, s) => {
          const bestOrder = media.screenShareOrder.get(best.key) ?? Infinity
          const sOrder = media.screenShareOrder.get(s.key) ?? Infinity
          return sOrder < bestOrder ? s : best
        })
      : null

  const tiles: Array<{
    key: string
    name: string
    track: LocalVideoTrack | RemoteVideoTrack
    mirrored: boolean
  }> = []
```

(`media` já vem desestruturado de `session` na linha `const { media, broadcast, occupants, leaveOffice } = session`, logo acima deste trecho — usar essa variável.)

No JSX, substituir o bloco condicional `{visible.length > 0 ? (...) : (...)}` (linhas 181-224 atuais) por uma terceira ramificação antes das duas existentes:

```tsx
      {featuredScreen ? (
        <div className="relative aspect-video overflow-hidden bg-black">
          <PipVideo track={featuredScreen.track} mirrored={false} />
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-label text-[10px] text-white">
            Tela de {featuredScreen.name}
          </span>
        </div>
      ) : visible.length > 0 ? (
        <div
          className={`grid gap-px bg-outline-variant/20 ${
            visible.length + (hiddenCount > 0 ? 1 : 0) > 1 ? 'grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {visible.map((tile) => (
            <div key={tile.key} className="relative aspect-video overflow-hidden bg-black">
              <PipVideo track={tile.track} mirrored={tile.mirrored} />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-label text-[10px] text-white">
                {tile.name}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="flex aspect-video items-center justify-center bg-surface-container-high font-label text-label-md text-on-surface">
              +{hiddenCount}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-sm px-md py-sm">
          <div className="flex -space-x-2">
            {occupants.slice(0, 3).map((o) =>
              o.photoUrl ? (
                <img
                  key={o.userId}
                  src={o.photoUrl}
                  alt=""
                  className="h-7 w-7 rounded-full border-2 border-surface-container object-cover"
                />
              ) : (
                <span
                  key={o.userId}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface-container bg-surface-container-high font-label text-[10px] text-on-surface"
                >
                  {o.name.slice(0, 1).toUpperCase()}
                </span>
              ),
            )}
          </div>
          <p className="font-body text-body-sm text-on-surface-variant">{countLabel}</p>
        </div>
      )}
```

(Corpo do JSX inalterado além da nova ramificação — mic/câmera/controles do rodapé não mudam.)

- [ ] **Step 4: Rodar os testes e o typecheck**

Run: `pnpm --filter @legends/web exec vitest run src/office/pip/OfficePipWindow.test.tsx`
Expected: PASS.

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/pip/OfficePipWindow.tsx apps/web/src/office/pip/OfficePipWindow.test.tsx
git commit -m "feat(web): PiP prioriza tela compartilhada sobre câmeras"
```

---

### Task 5: Verificação manual end-to-end

**Files:** nenhum (só verificação, sem código novo).

- [ ] **Step 1: Rodar a suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os workspaces passam (API precisa do Postgres de pé — ver `AGENTS.md`).

- [ ] **Step 2: Subir a app e testar manualmente os três fluxos**

Run: `pnpm dev`

Com dois usuários (duas abas/sessões diferentes), verificar:
1. **Dentro de sala:** entrar numa sala de reunião com os dois usuários, ligar compartilhamento de tela no usuário A — a grade (que auto-abre) mostra o tile "Tela de A" tanto pra A quanto pra B.
2. **Área aberta:** usuário A anda para fora da sala e compartilha tela lá; usuário B, andando perto de A na área aberta, vê o indicador "Tela de A — clique para ver" flutuando perto do personagem de A (sem sobrepor a bolha de câmera de A, se A também estiver com câmera ligada); clicar abre a grade sem botões de chat/pessoas na MediaBar; fechar volta a andar normalmente.
3. **PiP:** usuário B navega para outra página do app (ex.: `/`) enquanto A compartilha tela — o PiP de B mostra a tela de A no lugar do grid de câmeras, com o label correto; A parar de compartilhar volta o PiP ao grid de câmeras.
4. **Múltiplas telas:** com A e um terceiro usuário C compartilhando ao mesmo tempo (A primeiro), confirmar que A fica em destaque nos três contextos acima (grade da sala, grade da área aberta, PiP).

Expected: os quatro fluxos funcionam como descrito, sem erros no console do navegador.

- [ ] **Step 3: Commit (se algum ajuste foi necessário durante a verificação manual)**

```bash
git add -A
git commit -m "fix(web): ajustes pós-verificação manual do feedback de compartilhamento de tela"
```

(Pular este commit se nenhum ajuste foi necessário.)
