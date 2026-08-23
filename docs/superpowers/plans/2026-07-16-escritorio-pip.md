# Escritório em Picture-in-Picture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao clicar em "Sair" na barra do escritório, o usuário volta ao app e o escritório vira uma janela PiP flutuante (câmeras + áudio) que mantém WebSocket e LiveKit vivos; o X do PiP desconecta de vez.

**Architecture:** Um `OfficeSessionProvider` global (montado em `App.tsx` fora das `Routes`) passa a ser o dono de `OfficeBridge`, `useOfficeSocket`, `useOfficeMedia`, `useOfficeBroadcast` e dos elementos `<RemoteAudio>`; a `OfficePage` consome tudo do contexto. Um `OfficePipWindow` flutuante aparece quando a sessão está ativa e a rota não é `/escritorio`. Para o provider não puxar `livekit-client` (~110KB gzip) para o bundle principal, os dois hooks de mídia passam a carregar o LiveKit por `import()` dinâmico.

**Tech Stack:** React 18, react-router-dom 6, @tanstack/react-query, livekit-client, Tailwind, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-16-escritorio-pip-design.md`

## Global Constraints

- TypeScript **strict**, ESM puro; monorepo pnpm — comandos sempre a partir da raiz do repo.
- Mensagens visíveis ao usuário em **português** (pt-BR).
- Testes `*.test.ts(x)` **colocados ao lado** do código; web usa jsdom (não precisa de Postgres).
- Route fina, lógica no service/hook, seguir o estilo da camada vizinha.
- `livekit-client` e `phaser` NÃO podem entrar no bundle principal (chunk `index-*.js`).
- Dev local exige **Node ≥ 20** (com Node 18 o proxy do Vite quebra com ECONNREFUSED ::1).
- Branch de trabalho: `feat/escritorio-pip`. Commits em pt-BR terminando com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Loader dinâmico do livekit-client

Hoje `useOfficeMedia.ts` e `useOfficeBroadcast.ts` importam `livekit-client` estaticamente — ok enquanto só a `OfficePage` (lazy) os usava. Com o provider global importando esses hooks, o LiveKit iria para o bundle principal. Este task cria um loader com cache e converte os dois hooks para carregar o módulo sob demanda. Imports de **tipos** continuam estáticos (`import type` é apagado na compilação).

**Files:**
- Create: `apps/web/src/office/media/livekit-loader.ts`
- Create: `apps/web/src/office/media/livekit-loader.test.ts`
- Modify: `apps/web/src/office/media/useOfficeMedia.ts`
- Modify: `apps/web/src/office/media/useOfficeBroadcast.ts`

**Interfaces:**
- Consumes: `livekit-client` (módulo inteiro, via `import()`).
- Produces: `loadLiveKit(): Promise<typeof import('livekit-client')>` (carrega e cacheia) e `getLiveKit(): typeof import('livekit-client') | null` (acesso síncrono ao cache; `null` antes do primeiro load). Usados pelos dois hooks de mídia.

- [ ] **Step 1: Escrever o teste do loader**

```ts
// apps/web/src/office/media/livekit-loader.test.ts
import { describe, expect, it, vi } from 'vitest'
import { getLiveKit, loadLiveKit } from './livekit-loader'

vi.mock('livekit-client', () => ({ __marker: 'livekit-mock' }))

describe('livekit-loader', () => {
  it('é null antes do primeiro load e cacheia o módulo depois', async () => {
    expect(getLiveKit()).toBeNull()
    const mod = await loadLiveKit()
    expect(getLiveKit()).toBe(mod)
    await expect(loadLiveKit()).resolves.toBe(mod)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/livekit-loader.test.ts`
Expected: FAIL — `Cannot find module './livekit-loader'` (ou equivalente).

- [ ] **Step 3: Implementar o loader**

```ts
// apps/web/src/office/media/livekit-loader.ts
import type * as LiveKit from 'livekit-client'

/**
 * Carrega o livekit-client sob demanda. O provider de sessão do escritório
 * vive no bundle principal, mas o LiveKit (~110KB gzip) não pode ir junto —
 * só é baixado quando alguma sala realmente vai conectar.
 */
let cached: typeof LiveKit | null = null

export async function loadLiveKit(): Promise<typeof LiveKit> {
  if (!cached) cached = await import('livekit-client')
  return cached
}

/** Acesso síncrono para callbacks que não podem aguardar (ex.: syncRemotes). */
export function getLiveKit(): typeof LiveKit | null {
  return cached
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/livekit-loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Converter `useOfficeMedia.ts` para o loader**

Trocar o import do topo (linhas 1–11) — remover os valores runtime, manter só tipos, e importar o loader:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
} from 'livekit-client'
import { getLiveKit, loadLiveKit } from './livekit-loader'
```

Ajustes no corpo (o restante da lógica não muda):

1. Em `syncRemotes` (após o guard de `room`), obter `Track` do cache — a sala só existe depois de `connectTo` ter carregado o módulo:

```ts
    const lk = getLiveKit()
    if (!lk) {
      setRemotes([])
      return
    }
```

E usar `lk.Track.Source.Microphone` / `lk.Track.Source.Camera` / `lk.Track.Source.ScreenShare` no loop.

2. Em `connectTo`, logo após capturar a geração (`const gen = ++generationRef.current`) e antes de criar a `Room`, carregar o módulo. O `disconnect` da sala anterior e a limpeza de refs continuam onde estão; a ordem fica:

```ts
      const gen = ++generationRef.current
      void roomRef.current?.disconnect()
      roomRef.current = null
      micTrackRef.current = null
      targetRoomRef.current = target
      setRemotes([])
      setLocalCameraTrack(null)
      setStatus('connecting')
      let room: Room | null = null
      try {
        const { Room, RoomEvent, Track, createLocalAudioTrack } = await loadLiveKit()
        if (generationRef.current !== gen) return
        const { token, url } = await apiFetch<OfficeMediaTokenResponse>('/office/media-token', {
```

Como `Room` agora é um valor local do `try`, a declaração `let room: Room | null = null` precisa do TIPO importado: usar `import type { Room as RoomType } from 'livekit-client'` NÃO é necessário — basta declarar antes do `try` com o tipo type-only já importado:

```ts
import type {
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
  Room,
} from 'livekit-client'
```

e no `try` renomear o valor: `const { Room: LiveKitRoom, RoomEvent, Track, createLocalAudioTrack } = await loadLiveKit()` com `room = new LiveKitRoom()`.

3. Em `applyProximity` não há uso de `Track` — sem mudança. (Conferir: usa só `isWithinProximity` e `pub.setSubscribed`.)

4. Em `toggleMic`, no ramo sem track (permissão negada antes):

```ts
      try {
        const { createLocalAudioTrack } = await loadLiveKit()
        const fresh = await createLocalAudioTrack()
```

5. `roomRef`, `micTrackRef` etc. continuam com os mesmos tipos type-only.

- [ ] **Step 6: Converter `useOfficeBroadcast.ts` para o loader**

Import do topo vira:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalAudioTrack, RemoteAudioTrack } from 'livekit-client'
import { OFFICE_BROADCAST_ROOM, type OfficeMediaTokenResponse } from '@legends/shared'
import { getLiveKit, loadLiveKit } from './livekit-loader'
import { apiFetch } from '../../lib/api'
```

1. Em `syncBroadcast` (após o guard de `room`):

```ts
    const lk = getLiveKit()
    if (!lk) {
      setSpeakers([])
      setBroadcastTracks([])
      return
    }
```

E `if (pub.source !== lk.Track.Source.Microphone) continue`.

2. Em `connect` (dentro do `useEffect`), após `const gen = ++generationRef.current`:

```ts
      try {
        const { Room: LiveKitRoom, RoomEvent } = await loadLiveKit()
        if (generationRef.current !== gen) return
        const { token, url } = await apiFetch<OfficeMediaTokenResponse>('/office/media-token', {
```

e `const room = new LiveKitRoom()` com os mesmos `.on(RoomEvent.…)`.

3. Em `toggleSpeaker`, no ramo de ligar:

```ts
        try {
          const { createLocalAudioTrack } = await loadLiveKit()
          track = await createLocalAudioTrack()
```

- [ ] **Step 7: Rodar as suítes existentes dos dois hooks**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts src/office/media/useOfficeBroadcast.test.ts`
Expected: PASS — os testes mockam `livekit-client` com `vi.mock`, que também intercepta o `import()` dinâmico. Se algum teste falhar por ordem de load (ex.: `getLiveKit()` nulo), é bug da conversão — revisar os guards, não o teste.

- [ ] **Step 8: Typecheck e commit**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

```bash
git add apps/web/src/office/media/livekit-loader.ts apps/web/src/office/media/livekit-loader.test.ts apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeBroadcast.ts
git commit -m "refactor(web): carregar livekit-client sob demanda nos hooks de mídia

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `useOfficeSocket` zera o snapshot ao trocar de sessão

Com o hook morando num provider que nunca desmonta, `occupants`/`youId` ficariam com o estado da sessão anterior entre um `leaveOffice()` e o próximo welcome. O efeito passa a zerar o estado sempre que re-executa (bridge ou publicationId mudaram).

**Files:**
- Modify: `apps/web/src/office/useOfficeSocket.ts:31`
- Test: `apps/web/src/office/useOfficeSocket.test.ts`

**Interfaces:**
- Consumes: `OfficeBridge` (`emitServerMessage`, `onServerMessage`, `snapshot`).
- Produces: mesmo contrato de hoje — `useOfficeSocket(bridge, publicationId): { occupants, youId, connected }` — com a garantia nova: trocar `bridge` ou `publicationId` reseta `occupants` para `[]` e `youId` para `null`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final do `describe` existente em `useOfficeSocket.test.ts` (seguir os imports/helpers que o arquivo já tem — ele já usa `renderHook` ou equivalente com um bridge real; se usar outro padrão, adaptar mantendo o cenário):

```ts
  it('zera occupants e youId ao trocar de bridge (sessão nova)', () => {
    const bridgeA = new OfficeBridge()
    const { result, rerender } = renderHook(
      ({ bridge }: { bridge: OfficeBridge }) => useOfficeSocket(bridge, null),
      { initialProps: { bridge: bridgeA } },
    )

    act(() => {
      bridgeA.emitServerMessage({
        type: 'welcome',
        youId: 'u1',
        occupants: [{ userId: 'u1', name: 'Ana', x: 1, y: 1, dir: 'down' }],
      } as never)
    })
    expect(result.current.youId).toBe('u1')
    expect(result.current.occupants).toHaveLength(1)

    rerender({ bridge: new OfficeBridge() })
    expect(result.current.youId).toBeNull()
    expect(result.current.occupants).toHaveLength(0)
  })
```

(Com `publicationId: null` o hook não abre WebSocket nenhum — o teste não precisa mockar `WebSocket`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/useOfficeSocket.test.ts`
Expected: FAIL no teste novo — `youId` continua `'u1'` após o rerender.

- [ ] **Step 3: Implementar o reset**

Em `useOfficeSocket.ts`, primeiras linhas do `useEffect` (antes de `let closedByUs = false`):

```ts
  useEffect(() => {
    // Sessão nova (bridge/publicação trocados): o snapshot da anterior não
    // pode vazar — o estado volta a preencher com o próximo welcome.
    setOccupants([])
    setYouId(null)
    let closedByUs = false
```

- [ ] **Step 4: Rodar a suíte inteira do hook**

Run: `pnpm --filter @legends/web exec vitest run src/office/useOfficeSocket.test.ts`
Expected: PASS (novo e antigos).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/useOfficeSocket.ts apps/web/src/office/useOfficeSocket.test.ts
git commit -m "fix(web): useOfficeSocket zera o snapshot ao trocar de sessão

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `OfficeSessionProvider`

O provider global que segura a sessão do escritório entre rotas. Neste task ele é criado e testado isolado; a montagem em `App.tsx` e o rewire da página são o Task 4.

**Files:**
- Create: `apps/web/src/office/session/OfficeSessionContext.tsx`
- Create: `apps/web/src/office/session/OfficeSessionContext.test.tsx`

**Interfaces:**
- Consumes: `OfficeBridge` (classe), `useOfficeSocket(bridge, publicationId)`, `useOfficeMedia(occupants, youId, connected, document, publicationId): OfficeMediaState`, `useOfficeBroadcast({ enabled, micEnabled, setMicEnabled, youName }): OfficeBroadcastState`, `useAuth(): { user }`, `apiFetch`, `RemoteAudio`.
- Produces (para Tasks 4 e 5):

```ts
export type OfficeSessionStatus = 'idle' | 'active'

export interface OfficeSessionValue {
  status: OfficeSessionStatus
  enterOffice(): void
  leaveOffice(): void
  bridge: OfficeBridge
  activeMap: ActiveOfficeMapDTO | null
  activeMapLoading: boolean
  occupants: OfficeOccupant[]
  youId: string | null
  connected: boolean
  media: OfficeMediaState
  broadcast: OfficeBroadcastState
  canBroadcast: boolean
}

export function OfficeSessionProvider({ children }: { children: ReactNode }): JSX.Element
export function useOfficeSession(): OfficeSessionValue // lança se usado fora do provider
```

- [ ] **Step 1: Escrever os testes do provider**

```tsx
// apps/web/src/office/session/OfficeSessionContext.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OfficeOccupant } from '@legends/shared'
import { OfficeBridge } from '../OfficeBridge'
import { useOfficeSocket } from '../useOfficeSocket'
import { useOfficeMedia, type OfficeMediaState } from '../media/useOfficeMedia'
import { useOfficeBroadcast, type OfficeBroadcastState } from '../media/useOfficeBroadcast'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import { OfficeSessionProvider, useOfficeSession } from './OfficeSessionContext'

vi.mock('../useOfficeSocket', () => ({ useOfficeSocket: vi.fn() }))
vi.mock('../media/useOfficeMedia', () => ({ useOfficeMedia: vi.fn() }))
vi.mock('../media/useOfficeBroadcast', () => ({ useOfficeBroadcast: vi.fn() }))
vi.mock('../media/RemoteAudio', () => ({
  RemoteAudio: () => <div data-testid="remote-audio" />,
}))
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }))

function occupant(id: string): OfficeOccupant {
  return { userId: id, name: id, x: 0, y: 0, dir: 'down' } as OfficeOccupant
}

function mediaState(overrides: Partial<OfficeMediaState> = {}): OfficeMediaState {
  return {
    status: 'off',
    roomName: null,
    micEnabled: false,
    micError: false,
    cameraEnabled: false,
    cameraError: false,
    screenShareEnabled: false,
    screenShareError: false,
    remotes: [],
    localCameraTrack: null,
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreenShare: vi.fn(),
    applyMicEnabled: vi.fn(),
    ...overrides,
  }
}

function broadcastState(overrides: Partial<OfficeBroadcastState> = {}): OfficeBroadcastState {
  return {
    available: false,
    speakerEnabled: false,
    speakerError: false,
    speakers: [],
    broadcastTracks: [],
    toggleSpeaker: vi.fn(),
    ...overrides,
  }
}

function Harness() {
  const session = useOfficeSession()
  return (
    <div>
      <span data-testid="status">{session.status}</span>
      <button onClick={session.enterOffice}>entrar</button>
      <button onClick={session.leaveOffice}>sair</button>
    </div>
  )
}

function renderProvider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OfficeSessionProvider>
        <Harness />
      </OfficeSessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(useOfficeSocket).mockReturnValue({ occupants: [], youId: null, connected: false })
  vi.mocked(useOfficeMedia).mockReturnValue(mediaState())
  vi.mocked(useOfficeBroadcast).mockReturnValue(broadcastState())
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', name: 'Ana', role: 'MEMBER' },
  } as unknown as ReturnType<typeof useAuth>)
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === '/office/map') {
      return { publication: { id: 'pub1' }, document: null, assets: {} }
    }
    if (path === '/office/config') return { broadcastEnabled: false }
    throw new Error(`apiFetch inesperado: ${String(path)}`)
  })
})

describe('OfficeSessionProvider', () => {
  it('começa idle, sem consultar mapa e com publicationId nulo no socket', () => {
    renderProvider()
    expect(screen.getByTestId('status').textContent).toBe('idle')
    expect(apiFetch).not.toHaveBeenCalled()
    expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBeNull()
  })

  it('enterOffice ativa a sessão e conecta o socket ao mapa publicado', async () => {
    renderProvider()
    fireEvent.click(screen.getByText('entrar'))
    expect(screen.getByTestId('status').textContent).toBe('active')
    await waitFor(() => {
      expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBe('pub1')
    })
  })

  it('leaveOffice volta a idle, zera o publicationId e troca o bridge', async () => {
    renderProvider()
    fireEvent.click(screen.getByText('entrar'))
    await waitFor(() => {
      expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBe('pub1')
    })
    const bridgeBefore = vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[0]

    fireEvent.click(screen.getByText('sair'))
    expect(screen.getByTestId('status').textContent).toBe('idle')
    const lastCall = vi.mocked(useOfficeSocket).mock.calls.at(-1)
    expect(lastCall?.[1]).toBeNull()
    expect(lastCall?.[0]).not.toBe(bridgeBefore)
  })

  it('logout encerra a sessão', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = () => (
      <QueryClientProvider client={client}>
        <OfficeSessionProvider>
          <Harness />
        </OfficeSessionProvider>
      </QueryClientProvider>
    )
    const view = render(tree())
    fireEvent.click(screen.getByText('entrar'))
    expect(screen.getByTestId('status').textContent).toBe('active')

    vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>)
    view.rerender(tree())
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('idle')
    })
  })

  it('map-changed fora da rota do escritório encerra a sessão', async () => {
    renderProvider()
    fireEvent.click(screen.getByText('entrar'))
    const bridge = vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[0] as OfficeBridge
    // jsdom: window.location.pathname === '/' (minimizado)
    act(() => {
      bridge.emitServerMessage({ type: 'map-changed' } as never)
    })
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('idle')
    })
  })

  it('renderiza os áudios remotos e do broadcast no provider', () => {
    vi.mocked(useOfficeMedia).mockReturnValue(
      mediaState({
        remotes: [
          {
            userId: 'u2',
            name: 'Bia',
            audioTrack: {} as never,
            cameraTrack: null,
            screenTrack: null,
          },
        ],
      }),
    )
    vi.mocked(useOfficeBroadcast).mockReturnValue(
      broadcastState({ broadcastTracks: [{} as never] }),
    )
    renderProvider()
    expect(screen.getAllByTestId('remote-audio')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/session/OfficeSessionContext.test.tsx`
Expected: FAIL — módulo `./OfficeSessionContext` não existe.

- [ ] **Step 3: Implementar o provider**

```tsx
// apps/web/src/office/session/OfficeSessionContext.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  isLeaderRole,
  type ActiveOfficeMapDTO,
  type OfficeConfigDTO,
  type OfficeOccupant,
} from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import { OfficeBridge } from '../OfficeBridge'
import { useOfficeSocket } from '../useOfficeSocket'
import { useOfficeMedia, type OfficeMediaState } from '../media/useOfficeMedia'
import { useOfficeBroadcast, type OfficeBroadcastState } from '../media/useOfficeBroadcast'
import { RemoteAudio } from '../media/RemoteAudio'

const OFFICE_CONFIG_REFETCH_MS = 5000

export type OfficeSessionStatus = 'idle' | 'active'

export interface OfficeSessionValue {
  status: OfficeSessionStatus
  enterOffice(): void
  leaveOffice(): void
  bridge: OfficeBridge
  activeMap: ActiveOfficeMapDTO | null
  activeMapLoading: boolean
  occupants: OfficeOccupant[]
  youId: string | null
  connected: boolean
  media: OfficeMediaState
  broadcast: OfficeBroadcastState
  canBroadcast: boolean
}

const OfficeSessionContext = createContext<OfficeSessionValue | null>(null)

export function useOfficeSession(): OfficeSessionValue {
  const value = useContext(OfficeSessionContext)
  if (!value) throw new Error('useOfficeSession precisa estar dentro de <OfficeSessionProvider>')
  return value
}

/**
 * Dono da SESSÃO do escritório — bridge, WebSocket, mídia (LiveKit) e os
 * elementos de áudio. Vive acima das rotas para o escritório sobreviver à
 * navegação: sair da página minimiza (PiP); só `leaveOffice` desconecta.
 * O Phaser NÃO mora aqui — canvas é criado/destruído pela OfficePage.
 */
export function OfficeSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<OfficeSessionStatus>('idle')
  const [bridge, setBridge] = useState(() => new OfficeBridge())
  const { user } = useAuth()
  const active = status === 'active'

  const enterOffice = useCallback(() => setStatus('active'), [])
  const leaveOffice = useCallback(() => {
    setStatus('idle')
    // Bridge novo por sessão: o snapshot (ocupantes, youId) da sessão
    // encerrada não pode vazar para a próxima.
    setBridge(new OfficeBridge())
  }, [])

  const activeMapQuery = useQuery({
    queryKey: ['office', 'active-map'],
    queryFn: () => apiFetch<ActiveOfficeMapDTO>('/office/map'),
    enabled: active,
  })
  const activeMap = (active ? activeMapQuery.data : null) ?? null

  const { occupants, youId, connected } = useOfficeSocket(
    bridge,
    active ? (activeMap?.publication.id ?? null) : null,
  )
  const media = useOfficeMedia(
    occupants,
    youId,
    connected,
    activeMap?.document ?? null,
    active ? (activeMap?.publication.id ?? null) : null,
  )

  // Interruptor de custo do admin: fail-closed — sem config, sem broadcast.
  const { data: officeConfig } = useQuery({
    queryKey: ['office', 'config'],
    queryFn: () => apiFetch<OfficeConfigDTO>('/office/config'),
    refetchInterval: OFFICE_CONFIG_REFETCH_MS,
    refetchIntervalInBackground: true,
    enabled: active,
  })
  const you = occupants.find((o) => o.userId === youId) ?? null
  const canBroadcast = isLeaderRole(user?.role)
  const broadcast = useOfficeBroadcast({
    enabled: active && (officeConfig?.broadcastEnabled ?? false) && connected && you !== null,
    micEnabled: media.micEnabled,
    setMicEnabled: media.applyMicEnabled,
    youName: user?.name ?? null,
  })

  // map-changed: na página, recarrega (comportamento original da OfficePage);
  // minimizado, encerra a sessão — voltar reconecta já no mapa novo.
  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type !== 'map-changed') return
        if (window.location.pathname === '/escritorio') window.location.reload()
        else leaveOffice()
      }),
    [bridge, leaveOffice],
  )

  // Logout derruba a sessão — sem usuário não há presença nem mídia.
  useEffect(() => {
    if (active && !user) leaveOffice()
  }, [active, user, leaveOffice])

  const value = useMemo<OfficeSessionValue>(
    () => ({
      status,
      enterOffice,
      leaveOffice,
      bridge,
      activeMap,
      activeMapLoading: active && activeMapQuery.isLoading,
      occupants,
      youId,
      connected,
      media,
      broadcast,
      canBroadcast,
    }),
    [
      status,
      enterOffice,
      leaveOffice,
      bridge,
      activeMap,
      active,
      activeMapQuery.isLoading,
      occupants,
      youId,
      connected,
      media,
      broadcast,
      canBroadcast,
    ],
  )

  return (
    <OfficeSessionContext.Provider value={value}>
      {/* Áudio vive no provider (não na página): continua tocando no PiP e
          nunca duplica — MediaTiles/BroadcastBanner só cuidam do visual. */}
      {media.remotes.map(
        (r) => r.audioTrack && <RemoteAudio key={`a-${r.userId}`} track={r.audioTrack} />,
      )}
      {broadcast.broadcastTracks.map((track, index) => (
        <RemoteAudio key={track.sid ?? `b-${index}`} track={track} />
      ))}
      {children}
    </OfficeSessionContext.Provider>
  )
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/office/session/OfficeSessionContext.test.tsx`
Expected: PASS (6 testes).

- [ ] **Step 5: Typecheck e commit**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

```bash
git add apps/web/src/office/session/
git commit -m "feat(web): provider global de sessão do escritório

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Montar o provider e rewire da OfficePage (integração)

Liga o provider no `App.tsx`, faz a `OfficePage` consumir o contexto em vez de criar bridge/hooks, move o áudio para fora de `MediaTiles`/`BroadcastBanner` e ajusta a semântica do botão "Sair" na `MediaBar`.

**Files:**
- Modify: `apps/web/src/App.tsx:98-99, 203-204`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/office/media/MediaBar.tsx:283-291`
- Modify: `apps/web/src/office/media/MediaTiles.tsx:6, 217`
- Modify: `apps/web/src/office/media/BroadcastBanner.tsx`
- Test: `apps/web/src/office/media/MediaBar.test.tsx:177`
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`
- Test: `apps/web/src/office/media/BroadcastBanner.test.tsx`

**Interfaces:**
- Consumes: `OfficeSessionProvider`/`useOfficeSession` (Task 3).
- Produces: `BroadcastBanner({ speakers }: { speakers: string[] })` — a prop `tracks` deixa de existir (o áudio é do provider). `MediaBar` mantém a assinatura; muda só o rótulo do botão de sair.

- [ ] **Step 1: Atualizar os testes afetados (vermelho primeiro)**

1. `MediaBar.test.tsx` linha 177 — o botão de sair muda de rótulo:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao app — você continua no escritório' }))
```

2. `BroadcastBanner.test.tsx` — remover a prop `tracks`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BroadcastBanner } from './BroadcastBanner'

describe('BroadcastBanner', () => {
  it('usa top-4', () => {
    render(<BroadcastBanner speakers={['Ana']} />)
    expect(screen.getByRole('status')).toHaveClass('top-4')
  })

  it('sem speakers, não renderiza nada visível', () => {
    const { container } = render(<BroadcastBanner speakers={[]} />)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
```

3. `MediaTiles.test.tsx` — remover o teste que espera `<audio>` (o bloco que usa `fakeAudioTrack()` e afirma `audioTrack.attach` — por volta das linhas 33–39) e o helper `fakeAudioTrack` se ficar sem uso. O default `audioTrack: null` no helper `remote()` fica (o tipo `RemoteMedia` continua tendo o campo).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx src/office/media/BroadcastBanner.test.tsx src/office/media/MediaTiles.test.tsx`
Expected: FAIL — rótulo antigo na MediaBar; prop `tracks` obrigatória no banner.

- [ ] **Step 3: `MediaBar.tsx` — novo rótulo do botão de sair**

Substituir o botão das linhas 283–291 por:

```tsx
        <button
          type="button"
          aria-label="Voltar ao app — você continua no escritório"
          title="Voltar ao app — você continua no escritório"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-white/70 transition-colors hover:bg-error/20 hover:text-error"
          onClick={onLeave}
        >
          <Icon name="logout" className="text-[20px]" />
        </button>
```

- [ ] **Step 4: `BroadcastBanner.tsx` — só visual**

```tsx
/** Aviso global de "alguém no alto-falante" — o áudio é do OfficeSessionProvider. */
export function BroadcastBanner({ speakers }: { speakers: string[] }) {
  if (speakers.length === 0) return null
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-primary/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur"
    >
      📢 {speakers.join(', ')} no alto-falante
    </div>
  )
}
```

(Remover os imports de `RemoteAudioTrack` e `RemoteAudio`.)

- [ ] **Step 5: `MediaTiles.tsx` — remover o áudio**

Remover a linha 217 (`{remotes.map((r) => r.audioTrack && <RemoteAudio …>)}`) e o import `import { RemoteAudio } from './RemoteAudio'` (linha 6). Se `RemoteAudioTrack` ficar sem uso nos types do arquivo, remover do import de tipos também.

- [ ] **Step 6: `App.tsx` — montar o provider**

Adicionar o import:

```tsx
import { OfficeSessionProvider } from './office/session/OfficeSessionContext'
```

E envolver as `Routes` (linhas 98–204):

```tsx
        <BrowserRouter>
          <OfficeSessionProvider>
            <Routes>
              …(inalterado)…
            </Routes>
          </OfficeSessionProvider>
        </BrowserRouter>
```

- [ ] **Step 7: `OfficePage.tsx` — consumir o contexto**

Substituir imports e o início do componente. Novo bloco de imports (removem-se `useQuery`, `useAuth`, `apiFetch`, `OfficeBridge`, `useOfficeSocket`, `useOfficeMedia`, `useOfficeBroadcast`, `isLeaderRole`, `ActiveOfficeMapDTO`, `OfficeConfigDTO`; entra `useOfficeSession`):

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import { mapZoneAt } from '@legends/shared'
import { Icon } from '../components/Icon'
import { useOfficeSession } from '../office/session/OfficeSessionContext'
import { OfficeCanvas, type OfficeCanvasHandle } from '../office/OfficeCanvas'
import { useCharacterScreenPositions } from '../office/media/useCharacterScreenPositions'
import { CharacterVideoBubble } from '../office/media/CharacterVideoBubble'
import { MediaBar } from '../office/media/MediaBar'
import { MediaTiles } from '../office/media/MediaTiles'
import { BroadcastBanner } from '../office/media/BroadcastBanner'
import { useOfficeInteractions } from '../office/useOfficeInteractions'
import { CharacterCard } from '../office/CharacterCard'
import { IncomingCallPopup } from '../office/IncomingCallPopup'
import { PeopleList } from '../office/PeopleList'

const MIN_ZOOM = 0.6
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.1
const INITIAL_ZOOM = 1

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))))
}

export function OfficePage() {
  const navigate = useNavigate()
  const {
    status,
    enterOffice,
    bridge,
    activeMap,
    activeMapLoading,
    occupants,
    youId,
    connected,
    media,
    broadcast,
    canBroadcast,
  } = useOfficeSession()

  // Montar a página ativa (ou re-ativa) a sessão. Desmontar NÃO encerra —
  // sair da rota é minimizar (PiP); quem encerra é o X do PiP (leaveOffice).
  useEffect(() => {
    enterOffice()
  }, [enterOffice])

  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [nearbyChatOpen, setNearbyChatOpen] = useState(false)
  const [peopleSidebarOpen, setPeopleSidebarOpen] = useState(false)
  const [peopleSearch, setPeopleSearch] = useState('')
  const [camerasExpanded, setCamerasExpanded] = useState(false)
  const canvasRef = useRef<OfficeCanvasHandle>(null)
```

O que sai do componente (comparado ao atual):

- `bridgeRef`/criação do `OfficeBridge` (linhas 36–40) — vem do contexto.
- `activeMapQuery` (42–46) — `activeMap`/`activeMapLoading` vêm do contexto.
- Chamadas de `useOfficeSocket` (47) e `useOfficeMedia` (48–54) — contexto.
- `const { user } = useAuth()` e `const canBroadcast = isLeaderRole(user?.role)` (98–99) — contexto.
- Query de `office/config` (100–106) e `useOfficeBroadcast` (107–112) — contexto (a const `OFFICE_CONFIG_REFETCH_MS` do topo sai junto).
- O efeito de `map-changed` (125–127) — mora no provider agora.

O que muda nos guards de carregamento (substituindo `if (activeMapQuery.isLoading)`):

```tsx
  if (status !== 'active' || activeMapLoading) {
    return <p className="p-xl text-on-surface-variant">Carregando mapa do escritório…</p>
  }
  if (!activeMap) {
    return <p className="p-xl text-error">Nenhum mapa ativo está disponível. Peça a um administrador para publicar um mapa.</p>
  }
```

E a chamada do banner (linhas 157–160) perde a prop `tracks`:

```tsx
      <BroadcastBanner speakers={broadcast.speakers} />
```

Tudo o mais (zona, `selfCamera`, `cameraBubbles`, `interactions`, sidebar, zoom, `MediaTiles`, `MediaBar` com `onLeave={() => navigate('/')}`) fica como está — os nomes `occupants`, `youId`, `connected`, `media`, `broadcast`, `canBroadcast`, `bridge`, `activeMap` continuam válidos vindos do destructuring do contexto.

- [ ] **Step 8: Rodar os testes atualizados e a suíte do web**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx src/office/media/BroadcastBanner.test.tsx src/office/media/MediaTiles.test.tsx`
Expected: PASS.

Run: `pnpm --filter @legends/web test`
Expected: PASS em toda a suíte do web.

- [ ] **Step 9: Typecheck, build e commit**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

Run: `pnpm --filter @legends/web build && grep -l livekit apps/web/dist/assets/index-*.js || echo "bundle principal limpo"`
Expected: `bundle principal limpo` (o grep não pode achar livekit no chunk principal; se achar, o Task 1 vazou um import estático — corrigir antes de seguir).

```bash
git add apps/web/src/App.tsx apps/web/src/pages/OfficePage.tsx apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx apps/web/src/office/media/BroadcastBanner.tsx apps/web/src/office/media/BroadcastBanner.test.tsx
git commit -m "feat(web): sessão do escritório sobrevive à navegação (provider global)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `OfficePipWindow`

A janelinha flutuante: visível com sessão ativa fora de `/escritorio`; tiles de câmera (ou avatares + contagem), mic/câmera, expandir, X, arrastável.

**Files:**
- Create: `apps/web/src/office/pip/OfficePipWindow.tsx`
- Create: `apps/web/src/office/pip/OfficePipWindow.test.tsx`
- Modify: `apps/web/src/App.tsx` (montar o PiP ao lado das `Routes`)

**Interfaces:**
- Consumes: `useOfficeSession()` (Task 3): `status`, `leaveOffice`, `occupants`, `media` (`remotes[].cameraTrack`, `localCameraTrack`, `cameraEnabled`, `micEnabled`, `status`, `toggleMic`, `toggleCamera`), `broadcast.speakers`.
- Produces: `OfficePipWindow(): JSX.Element | null` — sem props; decide visibilidade sozinho via contexto + `useLocation`.

- [ ] **Step 1: Escrever os testes**

```tsx
// apps/web/src/office/pip/OfficePipWindow.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useOfficeSession, type OfficeSessionValue } from '../session/OfficeSessionContext'
import { OfficePipWindow } from './OfficePipWindow'

vi.mock('../session/OfficeSessionContext', () => ({ useOfficeSession: vi.fn() }))

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

function fakeVideoTrack() {
  return { attach: vi.fn(), detach: vi.fn() }
}

function makeSession(overrides: Record<string, unknown> = {}): OfficeSessionValue {
  return {
    status: 'active',
    enterOffice: vi.fn(),
    leaveOffice: vi.fn(),
    bridge: {},
    activeMap: null,
    activeMapLoading: false,
    occupants: [{ userId: 'u1', name: 'Ana', x: 0, y: 0, dir: 'down' }],
    youId: 'u1',
    connected: true,
    canBroadcast: false,
    media: {
      status: 'connected',
      roomName: null,
      micEnabled: false,
      micError: false,
      cameraEnabled: false,
      cameraError: false,
      screenShareEnabled: false,
      screenShareError: false,
      remotes: [],
      localCameraTrack: null,
      toggleMic: vi.fn(),
      toggleCamera: vi.fn(),
      toggleScreenShare: vi.fn(),
      applyMicEnabled: vi.fn(),
    },
    broadcast: {
      available: false,
      speakerEnabled: false,
      speakerError: false,
      speakers: [],
      broadcastTracks: [],
      toggleSpeaker: vi.fn(),
    },
    ...overrides,
  } as unknown as OfficeSessionValue
}

function renderAt(path: string, session: OfficeSessionValue = makeSession()) {
  vi.mocked(useOfficeSession).mockReturnValue(session)
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <OfficePipWindow />
    </MemoryRouter>,
  )
  return { session, ...view }
}

beforeEach(() => {
  navigateMock.mockClear()
})

describe('OfficePipWindow', () => {
  it('aparece fora do escritório com a sessão ativa', () => {
    renderAt('/')
    expect(
      screen.getByRole('complementary', { name: 'Escritório em miniatura' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 pessoa no escritório')).toBeInTheDocument()
  })

  it('não aparece na rota do escritório', () => {
    renderAt('/escritorio')
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('não aparece com a sessão idle', () => {
    renderAt('/', makeSession({ status: 'idle' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('o X sai do escritório sem navegar', () => {
    const { session } = renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Sair do escritório' }))
    expect(session.leaveOffice).toHaveBeenCalledOnce()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('o botão de expandir volta para o escritório', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao escritório' }))
    expect(navigateMock).toHaveBeenCalledWith('/escritorio')
  })

  it('clique no corpo (sem arrastar) volta para o escritório', () => {
    renderAt('/')
    const pip = screen.getByRole('complementary', { name: 'Escritório em miniatura' })
    fireEvent.pointerDown(pip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(pip, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(navigateMock).toHaveBeenCalledWith('/escritorio')
  })

  it('arrastar move a janela e não navega', () => {
    renderAt('/')
    const pip = screen.getByRole('complementary', { name: 'Escritório em miniatura' })
    fireEvent.pointerDown(pip, { clientX: 200, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(pip, { clientX: 140, clientY: 160, pointerId: 1 })
    fireEvent.pointerUp(pip, { clientX: 140, clientY: 160, pointerId: 1 })
    expect(navigateMock).not.toHaveBeenCalled()
    expect(pip.style.transform).toBe('translate(-60px, -40px)')
  })

  it('toggles de mic e câmera delegam ao media', () => {
    const { session } = renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Ativar microfone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ligar câmera' }))
    expect(session.media.toggleMic).toHaveBeenCalledOnce()
    expect(session.media.toggleCamera).toHaveBeenCalledOnce()
  })

  it('renderiza tiles de quem está com câmera ligada', () => {
    const track = fakeVideoTrack()
    renderAt(
      '/',
      makeSession({
        media: {
          ...makeSession().media,
          remotes: [
            {
              userId: 'u2',
              name: 'Bia',
              audioTrack: null,
              cameraTrack: track,
              screenTrack: null,
            },
          ],
        },
      }),
    )
    expect(screen.getByText('Bia')).toBeInTheDocument()
    expect(track.attach).toHaveBeenCalled()
  })

  it('mostra o indicador de alto-falante quando há speakers', () => {
    renderAt(
      '/',
      makeSession({ broadcast: { ...makeSession().broadcast, speakers: ['Ana'] } }),
    )
    expect(screen.getByLabelText('Alto-falante ativo')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/pip/OfficePipWindow.test.tsx`
Expected: FAIL — módulo `./OfficePipWindow` não existe.

- [ ] **Step 3: Implementar o componente**

```tsx
// apps/web/src/office/pip/OfficePipWindow.tsx
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import { Icon } from '../../components/Icon'
import { useOfficeSession, type OfficeSessionValue } from '../session/OfficeSessionContext'

const MARGIN = 16
const MAX_TILES = 4
const DRAG_THRESHOLD_PX = 4

const pipToolCls = (active: boolean) =>
  `flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
    active
      ? 'border-primary/70 bg-primary/20 text-primary'
      : 'border-outline-variant/40 bg-surface-container-high text-on-surface-variant hover:text-on-surface'
  }`

/** Anexa um track de vídeo enquanto montado — irmão do RemoteAudio. */
function PipVideo({
  track,
  mirrored,
}: {
  track: LocalVideoTrack | RemoteVideoTrack
  mirrored: boolean
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
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
    />
  )
}

/**
 * Escritório minimizado: janelinha flutuante com câmeras + controles, viva em
 * qualquer rota que não seja o próprio escritório. Clique volta para a página;
 * o X encerra a sessão (a saída de verdade).
 */
export function OfficePipWindow() {
  const session = useOfficeSession()
  const location = useLocation()
  if (session.status !== 'active' || location.pathname === '/escritorio') return null
  return <PipWindowBody session={session} />
}

function PipWindowBody({ session }: { session: OfficeSessionValue }) {
  const navigate = useNavigate()
  const { media, broadcast, occupants, leaveOffice } = session
  const containerRef = useRef<HTMLDivElement>(null)
  // Offset a partir da âncora (canto inferior direito); só em memória — volta
  // ao padrão ao remontar (reload ou passagem pelo /escritorio).
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{
    startX: number
    startY: number
    baseX: number
    baseY: number
    moved: boolean
  } | null>(null)

  const tiles: Array<{
    key: string
    name: string
    track: LocalVideoTrack | RemoteVideoTrack
    mirrored: boolean
  }> = []
  if (media.cameraEnabled && media.localCameraTrack) {
    tiles.push({ key: 'you', name: 'Você', track: media.localCameraTrack, mirrored: true })
  }
  for (const r of media.remotes) {
    if (r.cameraTrack) tiles.push({ key: r.userId, name: r.name, track: r.cameraTrack, mirrored: false })
  }
  const visible = tiles.length > MAX_TILES ? tiles.slice(0, MAX_TILES - 1) : tiles
  const hiddenCount = tiles.length - visible.length

  const count = occupants.length
  const countLabel = count === 1 ? '1 pessoa no escritório' : `${count} pessoas no escritório`
  const mediaControlsDisabled = media.status !== 'connected'

  function clampOffset(next: { x: number; y: number }): { x: number; y: number } {
    const el = containerRef.current
    if (!el) return next
    const rect = el.getBoundingClientRect()
    const minX = Math.min(0, -(window.innerWidth - rect.width - MARGIN * 2))
    const minY = Math.min(0, -(window.innerHeight - rect.height - MARGIN * 2))
    return {
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Botões cuidam do próprio clique; arrastar/expandir é só no corpo.
    if ((event.target as HTMLElement).closest('button')) return
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // jsdom não implementa pointer capture — inofensivo em teste.
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) drag.moved = true
    setOffset(clampOffset({ x: drag.baseX + dx, y: drag.baseY + dy }))
  }

  function onPointerUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (drag && !drag.moved) navigate('/escritorio')
  }

  return (
    <div
      ref={containerRef}
      role="complementary"
      aria-label="Escritório em miniatura"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className="fixed bottom-4 right-4 z-50 w-72 cursor-pointer touch-none select-none overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container/95 shadow-2xl backdrop-blur"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="flex items-center justify-between gap-sm px-md py-sm">
        <div className="flex min-w-0 items-center gap-xs">
          <Icon name="chair" className="shrink-0 text-[18px] text-primary" />
          <span className="truncate font-label text-label-sm text-on-surface">Escritório</span>
          {broadcast.speakers.length > 0 && (
            <Icon
              name="campaign"
              aria-label="Alto-falante ativo"
              className="shrink-0 text-[18px] text-primary"
            />
          )}
        </div>
        <div className="flex items-center gap-xs">
          <button
            type="button"
            aria-label="Voltar ao escritório"
            title="Voltar ao escritório"
            onClick={() => navigate('/escritorio')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="open_in_full" className="text-[16px]" />
          </button>
          <button
            type="button"
            aria-label="Sair do escritório"
            title="Sair do escritório"
            onClick={leaveOffice}
            className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-error/20 hover:text-error"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>
      </div>

      {visible.length > 0 ? (
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

      <div className="flex items-center justify-center gap-xs border-t border-outline-variant/20 px-md py-sm">
        <button
          type="button"
          aria-label={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          title={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          disabled={mediaControlsDisabled}
          onClick={() => void media.toggleMic()}
          className={pipToolCls(media.micEnabled)}
        >
          <Icon name={media.micEnabled ? 'mic' : 'mic_off'} className="text-[18px]" />
        </button>
        <button
          type="button"
          aria-label={media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          title={media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          disabled={mediaControlsDisabled}
          onClick={() => void media.toggleCamera()}
          className={pipToolCls(media.cameraEnabled)}
        >
          <Icon name={media.cameraEnabled ? 'videocam' : 'videocam_off'} className="text-[18px]" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/office/pip/OfficePipWindow.test.tsx`
Expected: PASS (10 testes).

- [ ] **Step 5: Montar no `App.tsx`**

Adicionar o import:

```tsx
import { OfficePipWindow } from './office/pip/OfficePipWindow'
```

E renderizar como irmão das `Routes`, dentro do provider:

```tsx
          <OfficeSessionProvider>
            <Routes>
              …(inalterado)…
            </Routes>
            <OfficePipWindow />
          </OfficeSessionProvider>
```

- [ ] **Step 6: Suíte completa do web + typecheck + commit**

Run: `pnpm --filter @legends/web test && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS / sem erros.

```bash
git add apps/web/src/office/pip/ apps/web/src/App.tsx
git commit -m "feat(web): janela PiP do escritório fora da rota /escritorio

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final

**Files:** nenhum novo — verificação e ajustes finais.

- [ ] **Step 1: Suíte completa do monorepo**

Run: `pnpm db:up && pnpm test`
Expected: PASS em api, web e shared (a API exige o Postgres de teste de pé).

- [ ] **Step 2: Build + checagem de bundle**

Run: `pnpm build && grep -l livekit apps/web/dist/assets/index-*.js || echo "bundle principal limpo"`
Expected: `bundle principal limpo`.

- [ ] **Step 3: Verificação manual (requer Node ≥ 20)**

1. `pnpm dev` (api 3333 + web 5173). Logar com um usuário do seed.
2. Ir a `/escritorio`, ligar o microfone, clicar no botão de sair (ícone `logout`) na barra inferior.
3. Esperado: navega para a Home com a janelinha PiP no canto inferior direito mostrando "N pessoa(s) no escritório"; com outra sessão/navegador na mesma sala com câmera ligada, o tile de vídeo aparece e o áudio continua.
4. Arrastar o PiP; clicar no corpo → volta a `/escritorio` com o avatar na mesma posição (sem novo "entrou no escritório" para os outros).
5. Sair de novo e clicar no X do PiP → PiP some; em outra sessão, o avatar desaparece do mapa.
6. Confirmar que em `/escritorio` o PiP não aparece.

- [ ] **Step 4: Commit final (se houver ajustes) e encerrar**

Ajustes achados na verificação manual entram como commits pequenos. Ao final, usar a skill superpowers:finishing-a-development-branch para decidir merge/PR.
