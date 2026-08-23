# Radar de Proximidade + Áudio Espacial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No espaço aberto do escritório virtual, mostrar um radar de proximidade (miniatura no canto inferior esquerdo) e tocar o áudio remoto com volume/pan estéreo por posição relativa; além disso, deixar o botão de microfone da `MediaBar` vermelho quando está mudo.

**Architecture:** Tudo client-side (`apps/web`), sem mudança de contrato/backend. Reaproveita `isWithinProximity`/`PROXIMITY_RADIUS`/`officeOpenRoom` já existentes em `@legends/shared` e as posições (`OfficeOccupant.x/y`) já sincronizadas via WS. Um novo componente puro (`ProximityRadar`) projeta ocupantes próximos num círculo SVG-like via CSS; um novo módulo (`spatialAudio.ts`) monta um grafo Web Audio API (`MediaStreamAudioSourceNode → GainNode → StereoPannerNode → destination`) por participante remoto, substituindo o `<audio>` simples só no espaço aberto — zonas continuam com `RemoteAudio` como está.

**Tech Stack:** React 18, TypeScript strict, Vitest + Testing Library, Web Audio API (`AudioContext`, `GainNode`, `StereoPannerNode`), Tailwind.

## Global Constraints

- Raio de proximidade: `PROXIMITY_RADIUS = 3` tiles, distância euclidiana pro áudio (`Math.hypot`), distância de Chebyshev pro radar (via `isWithinProximity`, já existente).
- Radar e áudio espacial só existem no **espaço aberto** (`media.roomName === media.openRoom`); dentro de zonas/salas fechadas, nada muda.
- Pan estéreo é só posição relativa na tela (`dx`); a direção que o avatar está olhando (`dir`) **não** entra na conta.
- Radar: painel abstrato (círculo tracejado + bolinhas), sem renderizar o mapa real. Sempre visível no espaço aberto (não depende do painel de mídia estar aberto).
- Ponto central do radar: cinza quando o mic está mudo, verde quando está aberto.
- Botão de mic na `MediaBar`: vermelho **só** quando mudo e habilitado — desabilitado continua com a opacidade reduzida de sempre, sem virar vermelho.
- Mensagens voltadas ao usuário em português; código sem comentários óbvios (só o "porquê" não-óbvio).

---

### Task 1: Expor `openRoom` no estado de `useOfficeMedia`

O hook já calcula a sala aberta (`const openRoom = mapId ? officeOpenRoom(mapId) : null`, `useOfficeMedia.ts:129`) mas não a expõe. As próximas tasks (radar e áudio espacial) precisam comparar `media.roomName === media.openRoom` para saber se estão no espaço aberto — sem duplicar o cálculo de `mapId`/`officeOpenRoom` em `OfficePage`/`OfficeSessionContext`.

**Files:**
- Modify: `apps/web/src/office/media/useOfficeMedia.ts:49-72` (interface `OfficeMediaState`), `apps/web/src/office/media/useOfficeMedia.ts:500-519` (objeto de retorno)
- Modify: `apps/web/src/office/media/useOfficeMedia.test.ts` (novo teste)
- Modify: `apps/web/src/office/media/MediaBar.test.tsx:9-28` (helper `mediaState`)
- Modify: `apps/web/src/office/session/OfficeSessionContext.test.tsx:32-53` (helper `mediaState`)
- Modify: `apps/web/src/pages/OfficePage.test.tsx:143-164` (helper `mediaState`)

**Interfaces:**
- Produces: `OfficeMediaState.openRoom: string | null` — sala LiveKit do espaço aberto para o mapa atual (`null` sem `mapId`). Tasks 3 e 6 consomem via `media.roomName === media.openRoom`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/office/media/useOfficeMedia.test.ts`, adicionar dentro do `describe('useOfficeMedia', () => { ... })`, como primeiro `it` (logo após a linha 167 `describe('useOfficeMedia', () => {`):

```ts
  it('expõe a sala aberta do mapa atual em `openRoom`', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    expect(result.current.openRoom).toBe('office-map-test-publication-open')
  })

```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts -t "expõe a sala aberta"`
Expected: FAIL — `result.current.openRoom` é `undefined` (propriedade não existe no objeto retornado).

- [ ] **Step 3: Adicionar o campo na interface**

Em `apps/web/src/office/media/useOfficeMedia.ts`, na interface `OfficeMediaState` (linhas 49-52 atuais):

```ts
export interface OfficeMediaState {
  status: OfficeMediaStatus
  roomName: string | null
  /** Sala LiveKit do espaço aberto do mapa atual — usada para saber se está
   * no espaço aberto (`roomName === openRoom`) sem recalcular a partir de
   * `mapId`. `null` sem mapa ativo. */
  openRoom: string | null
  micEnabled: boolean
```

- [ ] **Step 4: Retornar o campo**

Em `apps/web/src/office/media/useOfficeMedia.ts`, no objeto de retorno do hook (linhas ~500-503 atuais):

```ts
  return {
    status,
    roomName,
    openRoom,
    micEnabled,
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts -t "expõe a sala aberta"`
Expected: PASS

- [ ] **Step 6: Atualizar os três helpers `mediaState()` de teste que constroem `OfficeMediaState` completo**

Sem isso, `pnpm --filter @legends/web run build` (typecheck) falha nesses três arquivos — o literal não satisfaz mais a interface.

Em `apps/web/src/office/media/MediaBar.test.tsx:9-28`, dentro do objeto retornado por `mediaState()`, logo após `roomName: 'office-open',`:

```ts
    roomName: 'office-open',
    openRoom: 'office-open',
```

Em `apps/web/src/office/session/OfficeSessionContext.test.tsx:32-53`, dentro do objeto retornado por `mediaState()`, logo após `roomName: null,`:

```ts
    roomName: null,
    openRoom: null,
```

Em `apps/web/src/pages/OfficePage.test.tsx:143-164`, dentro do objeto retornado por `mediaState()`, logo após `roomName: 'office-open',`:

```ts
    roomName: 'office-open',
    openRoom: 'office-open',
```

- [ ] **Step 7: Rodar a suíte completa do workspace web e confirmar que nada quebrou**

Run: `pnpm --filter @legends/web test`
Expected: PASS (todos os testes existentes continuam passando)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeMedia.test.ts apps/web/src/office/media/MediaBar.test.tsx apps/web/src/office/session/OfficeSessionContext.test.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(escritório): expõe sala do espaço aberto em useOfficeMedia"
```

---

### Task 2: Componente `ProximityRadar`

**Files:**
- Create: `apps/web/src/office/media/ProximityRadar.tsx`
- Test: `apps/web/src/office/media/ProximityRadar.test.tsx`

**Interfaces:**
- Consumes: `isWithinProximity(ax, ay, bx, by): boolean`, `PROXIMITY_RADIUS: number`, `type OfficeOccupant` — todos de `@legends/shared`.
- Produces: `ProximityRadar({ you, occupants, micEnabled }: { you: OfficeOccupant | null; occupants: OfficeOccupant[]; micEnabled: boolean }): JSX.Element | null` — Task 3 consome este componente e essas props.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/office/media/ProximityRadar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { ProximityRadar } from './ProximityRadar'

function occupant(userId: string, x: number, y: number): OfficeOccupant {
  return { userId, name: userId, x, y, dir: 'down', avatarSeed: null, avatarOptions: null } as OfficeOccupant
}

describe('ProximityRadar', () => {
  it('sem `you`, não renderiza nada', () => {
    const { container } = render(<ProximityRadar you={null} occupants={[]} micEnabled={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra uma bolinha para quem está dentro do raio de proximidade', () => {
    const you = occupant('you', 10, 10)
    const ana = occupant('ana', 11, 10) // 1 tile de distância — dentro do raio (3)
    const { getByTestId, queryByTestId } = render(
      <ProximityRadar you={you} occupants={[you, ana]} micEnabled={false} />,
    )
    expect(getByTestId('radar-dot-ana')).toBeTruthy()
    expect(queryByTestId('radar-dot-you')).toBeNull() // você não aparece como "outro"
  })

  it('não mostra quem está fora do raio de proximidade', () => {
    const you = occupant('you', 10, 10)
    const longe = occupant('longe', 20, 20) // bem fora do raio (3)
    const { queryByTestId } = render(
      <ProximityRadar you={you} occupants={[you, longe]} micEnabled={false} />,
    )
    expect(queryByTestId('radar-dot-longe')).toBeNull()
  })

  it('ponto central fica cinza com o mic mudo e verde com o mic aberto', () => {
    const you = occupant('you', 10, 10)
    const { getByTestId, rerender } = render(
      <ProximityRadar you={you} occupants={[you]} micEnabled={false} />,
    )
    expect(getByTestId('radar-you').className).toContain('bg-white/40')

    rerender(<ProximityRadar you={you} occupants={[you]} micEnabled={true} />)
    expect(getByTestId('radar-you').className).toContain('bg-green-500')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/ProximityRadar.test.tsx`
Expected: FAIL — `Cannot find module './ProximityRadar'`.

- [ ] **Step 3: Implementar o componente**

Criar `apps/web/src/office/media/ProximityRadar.tsx`:

```tsx
import { isWithinProximity, PROXIMITY_RADIUS, type OfficeOccupant } from '@legends/shared'

/** Diâmetro do círculo de proximidade, em px. */
const RADAR_SIZE = 96
const DOT_SIZE = 8

/**
 * Miniatura no canto inferior esquerdo: quem está dentro do raio de
 * proximidade vira bolinha verde; o ponto central (você) muda de cor
 * conforme o microfone está aberto ou mudo — estilo "People in earshot" do
 * Gather. Painel abstrato (sem desenhar o mapa real).
 */
export function ProximityRadar({
  you,
  occupants,
  micEnabled,
}: {
  you: OfficeOccupant | null
  occupants: OfficeOccupant[]
  micEnabled: boolean
}) {
  if (!you) return null

  const nearby = occupants.filter(
    (o) => o.userId !== you.userId && isWithinProximity(you.x, you.y, o.x, o.y),
  )

  return (
    <div
      role="img"
      aria-label="Radar de proximidade — pessoas por perto"
      className="rounded-xl border border-white/10 bg-[#2f2f2f]/95 p-sm shadow-2xl backdrop-blur"
    >
      <div
        className="relative rounded-full border border-dashed border-white/30"
        style={{ width: RADAR_SIZE, height: RADAR_SIZE }}
      >
        {nearby.map((o) => {
          const dx = (o.x - you.x) / PROXIMITY_RADIUS
          const dy = (o.y - you.y) / PROXIMITY_RADIUS
          const left = RADAR_SIZE / 2 + (dx * RADAR_SIZE) / 2 - DOT_SIZE / 2
          const top = RADAR_SIZE / 2 + (dy * RADAR_SIZE) / 2 - DOT_SIZE / 2
          return (
            <span
              key={o.userId}
              data-testid={`radar-dot-${o.userId}`}
              aria-hidden
              className="absolute rounded-full bg-green-500"
              style={{ width: DOT_SIZE, height: DOT_SIZE, left, top }}
            />
          )
        })}
        <span
          data-testid="radar-you"
          aria-hidden
          className={`absolute rounded-full ${micEnabled ? 'bg-green-500' : 'bg-white/40'}`}
          style={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            left: RADAR_SIZE / 2 - DOT_SIZE / 2,
            top: RADAR_SIZE / 2 - DOT_SIZE / 2,
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/ProximityRadar.test.tsx`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/ProximityRadar.tsx apps/web/src/office/media/ProximityRadar.test.tsx
git commit -m "feat(escritório): componente ProximityRadar"
```

---

### Task 3: Montar `ProximityRadar` na `OfficePage`

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx:1-22` (imports), `apps/web/src/pages/OfficePage.tsx:351-352` (JSX)
- Modify: `apps/web/src/pages/OfficePage.test.tsx` (novo teste)

**Interfaces:**
- Consumes: `ProximityRadar` (Task 2), `media.roomName`/`media.openRoom` (Task 1), `you`/`occupants`/`media.micEnabled` (já disponíveis em `OfficePage.tsx:41-51,68`).

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/pages/OfficePage.test.tsx`, dentro do `describe('OfficePage', () => { ... })` (após o `beforeEach` que termina na linha 283), adicionar:

```tsx
  it('mostra o radar de proximidade no espaço aberto e some fora dele', () => {
    const { rerenderWithSession } = renderPage({
      media: mediaState({ roomName: 'office-open', openRoom: 'office-open', micEnabled: true }),
    })
    // youId padrão é 'ana' (11,14); bruno está em (12,14), 1 tile de distância.
    expect(screen.getByTestId('radar-dot-bruno')).toBeTruthy()

    rerenderWithSession({
      media: mediaState({ roomName: 'office-zone-reuniao-1', openRoom: 'office-open', micEnabled: true }),
    })
    expect(screen.queryByTestId('radar-dot-bruno')).toBeNull()
  })

```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx -t "radar de proximidade"`
Expected: FAIL — `radar-dot-bruno` não existe no DOM.

- [ ] **Step 3: Importar e montar o componente**

Em `apps/web/src/pages/OfficePage.tsx`, adicionar o import logo após a linha 10 (`import { MediaTiles } from '../office/media/MediaTiles'`):

```ts
import { MediaTiles } from '../office/media/MediaTiles'
import { ProximityRadar } from '../office/media/ProximityRadar'
```

Em `apps/web/src/pages/OfficePage.tsx`, entre o bloco do controle de zoom (que fecha em `OfficePage.tsx:351`, `</div>`) e o comentário `{/* \`canRaise\` já reflete... */}` (linha 353), inserir:

```tsx
      </div>

      {media.roomName !== null && media.roomName === media.openRoom && (
        <div className="absolute bottom-4 left-4 z-20">
          <ProximityRadar you={you} occupants={occupants} micEnabled={media.micEnabled} />
        </div>
      )}

      {/* `canRaise` já reflete "dentro de sala de reunião OU zona privada" —
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx -t "radar de proximidade"`
Expected: PASS

- [ ] **Step 5: Rodar a suíte completa de `OfficePage.test.tsx`**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: PASS (nenhum teste existente quebrou)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(escritório): mostra o radar de proximidade no espaço aberto"
```

---

### Task 4: `spatialAudio.ts` — fórmulas de ganho/pan e grafo Web Audio

**Files:**
- Create: `apps/web/src/office/media/spatialAudio.ts`
- Test: `apps/web/src/office/media/spatialAudio.test.ts`

**Interfaces:**
- Produces:
  - `computeGain(dx: number, dy: number): number` — 1 na mesma posição, cai linearmente a 0 na borda de `PROXIMITY_RADIUS`, nunca negativo.
  - `computePan(dx: number): number` — 0 no centro, `±1` clampado na borda de `PROXIMITY_RADIUS` (positivo = à direita).
  - `createSpatialAudioGraph(mediaStreamTrack: MediaStreamTrack): SpatialAudioGraph | null` — `null` sem Web Audio API disponível.
  - `interface SpatialAudioGraph { update(dx: number, dy: number): void; dispose(): void }`
  - Task 5 consome `createSpatialAudioGraph`, `SpatialAudioGraph`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/web/src/office/media/spatialAudio.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeGain, computePan } from './spatialAudio'
import { PROXIMITY_RADIUS } from '@legends/shared'

describe('computeGain', () => {
  it('gain 1 na mesma posição', () => {
    expect(computeGain(0, 0)).toBe(1)
  })
  it('gain 0 na borda do raio de proximidade', () => {
    expect(computeGain(PROXIMITY_RADIUS, 0)).toBe(0)
  })
  it('gain nunca fica negativo além do raio', () => {
    expect(computeGain(PROXIMITY_RADIUS * 2, 0)).toBe(0)
  })
  it('cai pela metade a meio caminho do raio', () => {
    expect(computeGain(PROXIMITY_RADIUS / 2, 0)).toBeCloseTo(0.5)
  })
})

describe('computePan', () => {
  it('pan 0 na mesma posição', () => {
    expect(computePan(0)).toBe(0)
  })
  it('pan positivo (direita) quando o outro está à direita', () => {
    expect(computePan(PROXIMITY_RADIUS)).toBe(1)
  })
  it('pan negativo (esquerda) quando o outro está à esquerda', () => {
    expect(computePan(-PROXIMITY_RADIUS)).toBe(-1)
  })
  it('clampa além do raio', () => {
    expect(computePan(PROXIMITY_RADIUS * 4)).toBe(1)
  })
})

function installFakeAudio() {
  const gainNode = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } }
  const pannerNode = { connect: vi.fn(), disconnect: vi.fn(), pan: { value: 0 } }
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() }
  const ctx = {
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createMediaStreamSource: vi.fn(() => sourceNode),
    createGain: vi.fn(() => gainNode),
    createStereoPanner: vi.fn(() => pannerNode),
  }
  vi.stubGlobal('AudioContext', vi.fn(() => ctx))
  vi.stubGlobal('MediaStream', vi.fn((tracks: unknown[]) => ({ tracks })))
  return { ctx, gainNode, pannerNode, sourceNode }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('createSpatialAudioGraph', () => {
  it('conecta fonte → ganho → pan → destino', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)

    expect(graph).not.toBeNull()
    expect(fake.sourceNode.connect).toHaveBeenCalledWith(fake.gainNode)
    expect(fake.gainNode.connect).toHaveBeenCalledWith(fake.pannerNode)
    expect(fake.pannerNode.connect).toHaveBeenCalledWith(fake.ctx.destination)
  })

  it('update() ajusta gain.value e pan.value com as mesmas fórmulas de computeGain/computePan', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!

    graph.update(1, 0)

    expect(fake.gainNode.gain.value).toBeCloseTo(computeGain(1, 0))
    expect(fake.pannerNode.pan.value).toBeCloseTo(computePan(1))
  })

  it('dispose() desconecta todos os nós', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!

    graph.dispose()

    expect(fake.sourceNode.disconnect).toHaveBeenCalledOnce()
    expect(fake.gainNode.disconnect).toHaveBeenCalledOnce()
    expect(fake.pannerNode.disconnect).toHaveBeenCalledOnce()
  })

  it('retorna null sem Web Audio API no navegador', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { createSpatialAudioGraph } = await import('./spatialAudio')

    expect(createSpatialAudioGraph({} as MediaStreamTrack)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/spatialAudio.test.ts`
Expected: FAIL — `Cannot find module './spatialAudio'`.

- [ ] **Step 3: Implementar `spatialAudio.ts`**

Criar `apps/web/src/office/media/spatialAudio.ts`:

```ts
import { PROXIMITY_RADIUS } from '@legends/shared'

/** Ganho por distância (euclidiana, em tiles): 1 perto, cai a 0 na borda do
 * raio de proximidade — some suavemente, sem o "estalo" do corte binário de
 * assinatura que já existe em `useOfficeMedia.applyProximity`. */
export function computeGain(dx: number, dy: number): number {
  const dist = Math.hypot(dx, dy)
  return Math.min(1, Math.max(0, 1 - dist / PROXIMITY_RADIUS))
}

/** Pan estéreo pela posição horizontal relativa (em tiles), clampado em
 * [-1, 1]. Só a posição na tela importa — a câmera do escritório não gira,
 * então a direção que o avatar está olhando não entra na conta. */
export function computePan(dx: number): number {
  return Math.min(1, Math.max(-1, dx / PROXIMITY_RADIUS))
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return null
  if (!audioContext) audioContext = new AudioContextCtor()
  void audioContext.resume()
  return audioContext
}

export interface SpatialAudioGraph {
  /** `dx`/`dy` em tiles — mesma unidade de `computeGain`/`computePan`. */
  update(dx: number, dy: number): void
  dispose(): void
}

/**
 * Grafo fonte → ganho → pan → saída para uma track remota. `null` sem Web
 * Audio API disponível — quem chama cai de volta para `<audio>` simples
 * (ver `SpatialRemoteAudio`).
 */
export function createSpatialAudioGraph(mediaStreamTrack: MediaStreamTrack): SpatialAudioGraph | null {
  const ctx = getAudioContext()
  if (!ctx) return null

  const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]))
  const gain = ctx.createGain()
  const panner = ctx.createStereoPanner()
  source.connect(gain)
  gain.connect(panner)
  panner.connect(ctx.destination)

  return {
    update(dx, dy) {
      gain.gain.value = computeGain(dx, dy)
      panner.pan.value = computePan(dx)
    },
    dispose() {
      source.disconnect()
      gain.disconnect()
      panner.disconnect()
    },
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/spatialAudio.test.ts`
Expected: PASS (12 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/spatialAudio.ts apps/web/src/office/media/spatialAudio.test.ts
git commit -m "feat(escritório): grafo Web Audio de pan/ganho por proximidade"
```

---

### Task 5: Componente `SpatialRemoteAudio`

**Files:**
- Create: `apps/web/src/office/media/SpatialRemoteAudio.tsx`
- Test: `apps/web/src/office/media/SpatialRemoteAudio.test.tsx`

**Interfaces:**
- Consumes: `createSpatialAudioGraph`, `type SpatialAudioGraph` (Task 4); `RemoteAudio` (`./RemoteAudio.tsx`, já existe).
- Produces: `SpatialRemoteAudio({ track, you, occupant }: { track: RemoteAudioTrack; you: OfficeOccupant; occupant: OfficeOccupant }): JSX.Element | null`. Task 6 consome este componente e essas props.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/web/src/office/media/SpatialRemoteAudio.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { RemoteAudioTrack } from 'livekit-client'
import type { OfficeOccupant } from '@legends/shared'
import { SpatialRemoteAudio } from './SpatialRemoteAudio'

const disposeMock = vi.fn()
const updateMock = vi.fn()
const createSpatialAudioGraphMock = vi.fn()
vi.mock('./spatialAudio', () => ({
  createSpatialAudioGraph: (...args: unknown[]) => createSpatialAudioGraphMock(...args),
}))
vi.mock('./RemoteAudio', () => ({
  RemoteAudio: () => <div data-testid="remote-audio-fallback" />,
}))

function occupant(userId: string, x: number, y: number): OfficeOccupant {
  return { userId, name: userId, x, y, dir: 'down', avatarSeed: null, avatarOptions: null } as OfficeOccupant
}

function fakeTrack(): RemoteAudioTrack {
  return { mediaStreamTrack: {} } as unknown as RemoteAudioTrack
}

describe('SpatialRemoteAudio', () => {
  beforeEach(() => {
    disposeMock.mockClear()
    updateMock.mockClear()
    createSpatialAudioGraphMock.mockReset()
  })

  it('monta o grafo, atualiza pela posição relativa e não renderiza <audio>', () => {
    createSpatialAudioGraphMock.mockReturnValue({ update: updateMock, dispose: disposeMock })
    const track = fakeTrack()
    const { container, rerender } = render(
      <SpatialRemoteAudio track={track} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce()
    expect(updateMock).toHaveBeenLastCalledWith(1, 0)
    expect(container).toBeEmptyDOMElement()

    rerender(<SpatialRemoteAudio track={track} you={occupant('you', 10, 10)} occupant={occupant('ana', 12, 10)} />)

    expect(updateMock).toHaveBeenLastCalledWith(2, 0)
    expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce() // não recria o grafo só por causa da posição
  })

  it('cai para RemoteAudio quando o navegador não tem Web Audio API', () => {
    createSpatialAudioGraphMock.mockReturnValue(null)
    const { getByTestId } = render(
      <SpatialRemoteAudio track={fakeTrack()} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    expect(getByTestId('remote-audio-fallback')).toBeTruthy()
  })

  it('desconecta o grafo ao desmontar', () => {
    createSpatialAudioGraphMock.mockReturnValue({ update: updateMock, dispose: disposeMock })
    const { unmount } = render(
      <SpatialRemoteAudio track={fakeTrack()} you={occupant('you', 10, 10)} occupant={occupant('ana', 11, 10)} />,
    )

    unmount()

    expect(disposeMock).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/SpatialRemoteAudio.test.tsx`
Expected: FAIL — `Cannot find module './SpatialRemoteAudio'`.

- [ ] **Step 3: Implementar o componente**

Criar `apps/web/src/office/media/SpatialRemoteAudio.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'
import type { OfficeOccupant } from '@legends/shared'
import { createSpatialAudioGraph, type SpatialAudioGraph } from './spatialAudio'
import { RemoteAudio } from './RemoteAudio'

/**
 * Variante de `RemoteAudio` para o espaço aberto: toca via Web Audio API
 * (ganho + pan estéreo por posição relativa) em vez de `<audio>` simples —
 * por isso não renderiza nada quando o grafo existe (a saída de áudio já
 * vai direto pro `AudioContext.destination`). Sem Web Audio disponível, cai
 * de volta para `RemoteAudio` (nunca os dois ao mesmo tempo, senão o áudio
 * toca em dobro).
 */
export function SpatialRemoteAudio({
  track,
  you,
  occupant,
}: {
  track: RemoteAudioTrack
  you: OfficeOccupant
  occupant: OfficeOccupant
}) {
  const graphRef = useRef<SpatialAudioGraph | null>(null)
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    const graph = createSpatialAudioGraph(track.mediaStreamTrack)
    graphRef.current = graph
    setAvailable(graph !== null)
    return () => {
      graph?.dispose()
      graphRef.current = null
    }
  }, [track])

  useEffect(() => {
    graphRef.current?.update(occupant.x - you.x, occupant.y - you.y)
  }, [you.x, you.y, occupant.x, occupant.y])

  if (!available) return <RemoteAudio track={track} />
  return null
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/SpatialRemoteAudio.test.tsx`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/SpatialRemoteAudio.tsx apps/web/src/office/media/SpatialRemoteAudio.test.tsx
git commit -m "feat(escritório): componente SpatialRemoteAudio"
```

---

### Task 6: Usar `SpatialRemoteAudio` no espaço aberto (`OfficeSessionContext`)

**Files:**
- Modify: `apps/web/src/office/session/OfficeSessionContext.tsx:26` (import), `apps/web/src/office/session/OfficeSessionContext.tsx:117` (variável `isOpenRoom`), `apps/web/src/office/session/OfficeSessionContext.tsx:223-238` (JSX de áudio)
- Modify: `apps/web/src/office/session/OfficeSessionContext.test.tsx` (mock de `SpatialRemoteAudio` + novo teste)

**Interfaces:**
- Consumes: `SpatialRemoteAudio` (Task 5), `media.openRoom` (Task 1).

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/office/session/OfficeSessionContext.test.tsx`, adicionar o mock de `SpatialRemoteAudio` logo após o mock de `RemoteAudio` (linhas 22-24 atuais):

```tsx
vi.mock('../media/RemoteAudio', () => ({
  RemoteAudio: () => <div data-testid="remote-audio" />,
}))
vi.mock('../media/SpatialRemoteAudio', () => ({
  SpatialRemoteAudio: () => <div data-testid="spatial-remote-audio" />,
}))
```

Depois, logo após o teste existente `it('renderiza os áudios remotos (mic + tela) e do broadcast no provider', ...)` (procurar por esse texto — usa o helper `renderProvider()` já definido no arquivo), adicionar:

```tsx
  it('no espaço aberto, com sua posição e a do remoto conhecidas, usa SpatialRemoteAudio para o áudio do mic', () => {
    vi.mocked(useOfficeSocket).mockReturnValue({
      occupants: [occupant('you'), occupant('ana')],
      youId: 'you',
      connected: true,
    })
    vi.mocked(useOfficeMedia).mockReturnValue(
      mediaState({
        roomName: 'office-open',
        openRoom: 'office-open',
        remotes: [
          {
            userId: 'ana',
            name: 'Ana',
            audioTrack: {} as never,
            cameraTrack: null,
            screenTrack: null,
            screenAudioTrack: null,
            micOpen: true,
            speaking: false,
          },
        ],
      }),
    )

    renderProvider()

    expect(screen.getByTestId('spatial-remote-audio')).toBeTruthy()
    expect(screen.queryByTestId('remote-audio')).toBeNull()
  })

  it('fora do espaço aberto (dentro de uma zona), continua usando RemoteAudio para o áudio do mic', () => {
    vi.mocked(useOfficeSocket).mockReturnValue({
      occupants: [occupant('you'), occupant('ana')],
      youId: 'you',
      connected: true,
    })
    vi.mocked(useOfficeMedia).mockReturnValue(
      mediaState({
        roomName: 'office-zone-reuniao-1',
        openRoom: 'office-open',
        remotes: [
          {
            userId: 'ana',
            name: 'Ana',
            audioTrack: {} as never,
            cameraTrack: null,
            screenTrack: null,
            screenAudioTrack: null,
            micOpen: true,
            speaking: false,
          },
        ],
      }),
    )

    renderProvider()

    expect(screen.getByTestId('remote-audio')).toBeTruthy()
    expect(screen.queryByTestId('spatial-remote-audio')).toBeNull()
  })

```

(`occupant(id)` é o helper já existente no arquivo — `apps/web/src/office/session/OfficeSessionContext.test.tsx:28-30` — que retorna `{ userId: id, name: id, x: 0, y: 0, dir: 'down' }`; `renderProvider()` já existe em `OfficeSessionContext.test.tsx:78-86` e cuida do `QueryClientProvider`/`OfficeSessionProvider`/`Harness`.)

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/session/OfficeSessionContext.test.tsx -t "usa SpatialRemoteAudio"`
Expected: FAIL — `spatial-remote-audio` não existe (hoje sempre renderiza `RemoteAudio`).

- [ ] **Step 3: Importar `SpatialRemoteAudio` e calcular `isOpenRoom`**

Em `apps/web/src/office/session/OfficeSessionContext.tsx:26`, logo após o import de `RemoteAudio`:

```ts
import { RemoteAudio } from '../media/RemoteAudio'
import { SpatialRemoteAudio } from '../media/SpatialRemoteAudio'
```

Em `apps/web/src/office/session/OfficeSessionContext.tsx:117`, logo após `const you = occupants.find((o) => o.userId === youId) ?? null`:

```ts
  const you = occupants.find((o) => o.userId === youId) ?? null
  // Áudio espacial só no espaço aberto — em zonas a sala já é isolada
  // (autoSubscribe) e o pan por posição não se aplica.
  const isOpenRoom = media.roomName !== null && media.roomName === media.openRoom
```

- [ ] **Step 4: Trocar `RemoteAudio` por `SpatialRemoteAudio` condicionalmente para o áudio do mic**

Em `apps/web/src/office/session/OfficeSessionContext.tsx:223-238`, substituir o bloco de retorno inteiro:

```tsx
  return (
    <OfficeSessionContext.Provider value={value}>
      {/* Áudio vive no provider (não na página): continua tocando no PiP e
          nunca duplica — MediaTiles/BroadcastBanner só cuidam do visual. */}
      {media.remotes.map((r) => {
        if (!r.audioTrack) return null
        const remoteOccupant = isOpenRoom ? occupants.find((o) => o.userId === r.userId) : undefined
        if (isOpenRoom && you && remoteOccupant) {
          return (
            <SpatialRemoteAudio key={`a-${r.userId}`} track={r.audioTrack} you={you} occupant={remoteOccupant} />
          )
        }
        return <RemoteAudio key={`a-${r.userId}`} track={r.audioTrack} />
      })}
      {media.remotes.map(
        (r) => r.screenAudioTrack && <RemoteAudio key={`sa-${r.userId}`} track={r.screenAudioTrack} />,
      )}
      {broadcast.broadcastTracks.map((track, index) => (
        <RemoteAudio key={track.sid ?? `b-${index}`} track={track} />
      ))}
      {children}
    </OfficeSessionContext.Provider>
  )
}
```

(Áudio de tela compartilhada e do alto-falante continuam sem espacialização — não são "a voz de alguém num lugar", são conteúdo/broadcast.)

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/session/OfficeSessionContext.test.tsx`
Expected: PASS (todos os testes do arquivo, incluindo o novo)

- [ ] **Step 6: Rodar a suíte completa do workspace web**

Run: `pnpm --filter @legends/web test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/session/OfficeSessionContext.tsx apps/web/src/office/session/OfficeSessionContext.test.tsx
git commit -m "feat(escritório): áudio espacial por proximidade no espaço aberto"
```

---

### Task 7: Botão de microfone vermelho quando mudo (`MediaBar`)

**Files:**
- Modify: `apps/web/src/office/media/MediaBar.tsx:321-332`
- Modify: `apps/web/src/office/media/MediaBar.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/office/media/MediaBar.test.tsx`, adicionar próximo aos outros testes de mic (após o teste que termina na linha 141, `it('nasce mutado e o botão ativa o microfone', ...)`):

```tsx
  it('botão do mic fica vermelho quando mudo e volta ao normal quando ativo', () => {
    const { rerender } = renderMediaBar({ media: mediaState({ micEnabled: false }) })
    const mic = screen.getByRole('button', { name: 'Ativar microfone' })
    expect(mic.className).toContain('border-error/60')
    expect(mic.className).toContain('text-error')

    rerender(
      <MediaBar
        media={mediaState({ micEnabled: true })}
        zoneName={null}
        broadcast={broadcastState({ available: false })}
        canBroadcast={false}
        you={{ name: 'Lucca Secco' }}
        onLeave={vi.fn()}
        cameraBackground={cameraBackgroundState()}
      />,
    )
    const micOn = screen.getByRole('button', { name: 'Silenciar microfone' })
    expect(micOn.className).not.toContain('border-error/60')
  })

  it('botão do mic não fica vermelho quando desabilitado (reconectando)', () => {
    renderMediaBar({ media: mediaState({ status: 'connecting', micEnabled: false }) })
    const mic = screen.getByRole('button', { name: 'Ativar microfone' })
    expect(mic.className).not.toContain('border-error/60')
  })

```

(`renderMediaBar` é o helper já existente no arquivo — `apps/web/src/office/media/MediaBar.test.tsx:41-100` — que chama `render(...)` e retorna o resultado do Testing Library, incluindo `rerender`.)

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx -t "vermelho"`
Expected: FAIL — a classe do botão não contém `border-error/60` (hoje usa o estilo neutro de `toolButtonCls(false)`).

- [ ] **Step 3: Implementar a mudança de estilo**

Em `apps/web/src/office/media/MediaBar.tsx:321-332`, o bloco atual é:

```tsx
        <button
          type="button"
          aria-label={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          title={micLocked ? 'Microfone desativado na área de silêncio' : mediaControlsDisabled ? mediaDisabledTitle : broadcast.speakerEnabled ? 'Silenciado enquanto o alto-falante está ligado' : media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          className={`${toolButtonCls(media.micEnabled)} disabled:cursor-not-allowed disabled:opacity-45 ${
            media.localSpeaking ? 'mic-speaking' : ''
          }`}
          disabled={micDisabled}
          onClick={() => void media.toggleMic()}
        >
          <Icon name={media.micEnabled ? 'mic' : 'mic_off'} className="text-[20px]" />
        </button>
```

Substituir pelo:

```tsx
        <button
          type="button"
          aria-label={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          title={micLocked ? 'Microfone desativado na área de silêncio' : mediaControlsDisabled ? mediaDisabledTitle : broadcast.speakerEnabled ? 'Silenciado enquanto o alto-falante está ligado' : media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          className={`${
            !media.micEnabled && !micDisabled
              ? 'group relative flex h-10 w-10 items-center justify-center rounded-xl border border-error/60 bg-error/20 text-error transition-all'
              : toolButtonCls(media.micEnabled)
          } disabled:cursor-not-allowed disabled:opacity-45 ${media.localSpeaking ? 'mic-speaking' : ''}`}
          disabled={micDisabled}
          onClick={() => void media.toggleMic()}
        >
          <Icon name={media.micEnabled ? 'mic' : 'mic_off'} className="text-[20px]" />
        </button>
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx`
Expected: PASS (todos os testes do arquivo, incluindo os dois novos)

- [ ] **Step 5: Rodar a suíte completa do workspace web e o build (typecheck)**

Run: `pnpm --filter @legends/web test && pnpm --filter @legends/web run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx
git commit -m "feat(escritório): botão de microfone fica vermelho quando mudo"
```

---

## Verificação final

- [ ] `pnpm --filter @legends/web test` — toda a suíte do web passa.
- [ ] `pnpm --filter @legends/web run build` — typecheck completo sem erros (ver `[build ≠ tsc](../../../CLAUDE.md)`-style gotcha: `pnpm test` sozinho não garante typecheck de DTOs/props novos).
- [ ] Manual: `pnpm dev`, abrir `/escritorio` com duas sessões (duas abas/usuários), andar até ficarem a poucos tiles um do outro no espaço aberto — o radar no canto inferior esquerdo mostra a bolinha verde da outra pessoa; abrir o mic muda o ponto central para verde; afastar-se além do raio remove a bolinha e reduz o áudio a zero suavemente; entrar numa sala de reunião esconde o radar; o botão de mic fica vermelho enquanto mudo.
