# Seleção de dispositivos de áudio e câmera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o usuário escolher, dentro do escritório virtual, qual microfone, câmera e saída de áudio usar — com a escolha persistida e reaplicada, e a troca de dispositivo acontecendo sem cair a chamada.

**Architecture:** Novo hook `useMediaDevices` enumera os dispositivos do navegador; um módulo `devicePreferences` guarda a escolha no localStorage; `useOfficeMedia` cria as tracks já com o `deviceId` preferido e expõe setters que usam `Room.switchActiveDevice` (LiveKit) para trocar ao vivo; a saída de áudio é aplicada via `HTMLMediaElement.setSinkId` tanto no `<audio>` simples (`RemoteAudio`) quanto — via um segundo `<audio>` alimentado por um `MediaStreamAudioDestinationNode` — no grafo de áudio espacial (`spatialAudio.ts`), preservando o ganho/pan já calibrado. Três novos controles na `MediaBar`: mic vira botão duplo com menu, o menu de câmera existente ganha uma seção de dispositivo, e um botão novo cobre a saída (só em navegadores com suporte a `setSinkId`).

**Tech Stack:** React 18, `livekit-client` 2.x (hand-rolled, sem `@livekit/components-react`), Web Audio API, Vitest + Testing Library.

## Global Constraints

- Mensagens ao usuário em português.
- TypeScript strict; sem `any` novo além dos casts pontuais já necessários pra `setSinkId` (API ainda não tipada em todo `lib.dom.d.ts`).
- Escolha de dispositivo persistida em localStorage (`office:preferred-audio-input`, `office:preferred-audio-output`, `office:preferred-video-input`), mesmo padrão de `MIC_PREFERENCE_STORAGE_KEY` já existente.
- Saída de áudio vale tanto pra `RemoteAudio` (salas/zonas) quanto pra `SpatialRemoteAudio` (espaço aberto) — mesma escolha nos dois lugares.
- Botão de saída de áudio só aparece quando o navegador suporta `setSinkId` (feature-detect, não faz sentido mostrar controle que não funciona).
- Durante a implementação, rodar só o(s) arquivo(s) de teste do que foi alterado — a suíte completa (`pnpm test`) só entra como verificação final.

---

### Task 1: `useMediaDevices` — enumeração de dispositivos

**Files:**
- Create: `apps/web/src/office/media/useMediaDevices.ts`
- Test: `apps/web/src/office/media/useMediaDevices.test.ts`

**Interfaces:**
- Produces: `MediaDeviceOption { deviceId: string; label: string }`, `MediaDevicesState { audioInputs: MediaDeviceOption[]; audioOutputs: MediaDeviceOption[]; videoInputs: MediaDeviceOption[]; supportsAudioOutputSelection: boolean }`, `useMediaDevices(): MediaDevicesState`.

- [ ] **Step 1: Escrever o teste**

Crie `apps/web/src/office/media/useMediaDevices.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMediaDevices } from './useMediaDevices'

function device(kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: '', toJSON: () => ({}) } as MediaDeviceInfo
}

let listeners: Record<string, () => void> = {}
let enumerateMock = vi.fn()

beforeEach(() => {
  listeners = {}
  enumerateMock = vi.fn().mockResolvedValue([])
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      enumerateDevices: enumerateMock,
      addEventListener: (event: string, cb: () => void) => {
        listeners[event] = cb
      },
      removeEventListener: vi.fn(),
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('useMediaDevices', () => {
  it('separa os dispositivos por tipo', async () => {
    enumerateMock.mockResolvedValue([
      device('audioinput', 'mic1', 'Mic USB'),
      device('audiooutput', 'out1', 'Fone'),
      device('videoinput', 'cam1', 'Webcam'),
    ])
    const { result } = renderHook(() => useMediaDevices())

    await waitFor(() => expect(result.current.audioInputs).toHaveLength(1))
    expect(result.current.audioInputs).toEqual([{ deviceId: 'mic1', label: 'Mic USB' }])
    expect(result.current.audioOutputs).toEqual([{ deviceId: 'out1', label: 'Fone' }])
    expect(result.current.videoInputs).toEqual([{ deviceId: 'cam1', label: 'Webcam' }])
  })

  it('usa rótulo de fallback numerado quando label vem vazio (sem permissão concedida ainda)', async () => {
    enumerateMock.mockResolvedValue([device('audioinput', 'mic1', ''), device('audioinput', 'mic2', '')])
    const { result } = renderHook(() => useMediaDevices())

    await waitFor(() => expect(result.current.audioInputs).toHaveLength(2))
    expect(result.current.audioInputs).toEqual([
      { deviceId: 'mic1', label: 'Microfone 1' },
      { deviceId: 'mic2', label: 'Microfone 2' },
    ])
  })

  it('reenumera quando o navegador dispara devicechange', async () => {
    enumerateMock.mockResolvedValue([])
    const { result } = renderHook(() => useMediaDevices())
    await waitFor(() => expect(enumerateMock).toHaveBeenCalledOnce())

    enumerateMock.mockResolvedValue([device('videoinput', 'cam1', 'Nova câmera')])
    listeners.devicechange()

    await waitFor(() => expect(result.current.videoInputs).toHaveLength(1))
  })

  it('reflete se o navegador suporta trocar a saída de áudio (setSinkId)', () => {
    const original = (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
    ;(HTMLMediaElement.prototype as unknown as { setSinkId: () => Promise<void> }).setSinkId = () =>
      Promise.resolve()
    try {
      const { result } = renderHook(() => useMediaDevices())
      expect(result.current.supportsAudioOutputSelection).toBe(true)
    } finally {
      if (original === undefined) delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
      else (HTMLMediaElement.prototype as unknown as { setSinkId: unknown }).setSinkId = original
    }
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useMediaDevices.test.ts`
Expected: FAIL (módulo `./useMediaDevices` não existe).

- [ ] **Step 3: Implementar o hook**

Crie `apps/web/src/office/media/useMediaDevices.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'

export interface MediaDeviceOption {
  deviceId: string
  label: string
}

export interface MediaDevicesState {
  audioInputs: MediaDeviceOption[]
  audioOutputs: MediaDeviceOption[]
  videoInputs: MediaDeviceOption[]
  /** `setSinkId` só existe em navegadores baseados em Chromium — Firefox/Safari não suportam trocar a saída de áudio. */
  supportsAudioOutputSelection: boolean
}

const KIND_LABELS: Record<MediaDeviceKind, string> = {
  audioinput: 'Microfone',
  audiooutput: 'Saída de áudio',
  videoinput: 'Câmera',
}

function toOptions(devices: MediaDeviceInfo[], kind: MediaDeviceKind): MediaDeviceOption[] {
  return devices
    .filter((d) => d.kind === kind)
    .map((d, index) => ({ deviceId: d.deviceId, label: d.label || `${KIND_LABELS[kind]} ${index + 1}` }))
}

/**
 * Enumera os dispositivos de mídia disponíveis (mic, câmera, saída de áudio) e
 * mantém a lista em dia sozinha, escutando `devicechange` (plugar/desplugar
 * fone, webcam etc.). Rótulos só vêm preenchidos pelo navegador depois de
 * alguma permissão de mic/câmera já concedida nesta sessão — sem isso, cai no
 * rótulo de fallback numerado.
 */
export function useMediaDevices(): MediaDevicesState {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [supportsAudioOutputSelection] = useState(
    () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,
  )

  const refresh = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    void navigator.mediaDevices
      .enumerateDevices()
      .then(setDevices)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    if (!navigator.mediaDevices) return
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh])

  return {
    audioInputs: toOptions(devices, 'audioinput'),
    audioOutputs: toOptions(devices, 'audiooutput'),
    videoInputs: toOptions(devices, 'videoinput'),
    supportsAudioOutputSelection,
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useMediaDevices.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/useMediaDevices.ts apps/web/src/office/media/useMediaDevices.test.ts
git commit -m "feat(escritório): hook useMediaDevices para enumerar mic/câmera/saída de áudio"
```

---

### Task 2: `devicePreferences` — persistência da escolha

**Files:**
- Create: `apps/web/src/office/media/devicePreferences.ts`
- Test: `apps/web/src/office/media/devicePreferences.test.ts`

**Interfaces:**
- Produces: `DevicePreferenceKind = 'audioInput' | 'audioOutput' | 'videoInput'`, `readDevicePreference(kind): string | null`, `writeDevicePreference(kind, deviceId: string | null): void`.

- [ ] **Step 1: Escrever o teste**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { readDevicePreference, writeDevicePreference } from './devicePreferences'

beforeEach(() => localStorage.clear())

describe('devicePreferences', () => {
  it('retorna null quando nada foi salvo', () => {
    expect(readDevicePreference('audioInput')).toBeNull()
  })

  it('grava e lê cada chave de forma independente', () => {
    writeDevicePreference('audioInput', 'mic1')
    writeDevicePreference('audioOutput', 'out1')
    writeDevicePreference('videoInput', 'cam1')

    expect(readDevicePreference('audioInput')).toBe('mic1')
    expect(readDevicePreference('audioOutput')).toBe('out1')
    expect(readDevicePreference('videoInput')).toBe('cam1')
  })

  it('deviceId null limpa a preferência salva', () => {
    writeDevicePreference('audioInput', 'mic1')
    writeDevicePreference('audioInput', null)
    expect(readDevicePreference('audioInput')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/devicePreferences.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
const STORAGE_KEYS = {
  audioInput: 'office:preferred-audio-input',
  audioOutput: 'office:preferred-audio-output',
  videoInput: 'office:preferred-video-input',
} as const

export type DevicePreferenceKind = keyof typeof STORAGE_KEYS

export function readDevicePreference(kind: DevicePreferenceKind): string | null {
  return localStorage.getItem(STORAGE_KEYS[kind])
}

export function writeDevicePreference(kind: DevicePreferenceKind, deviceId: string | null): void {
  if (deviceId) localStorage.setItem(STORAGE_KEYS[kind], deviceId)
  else localStorage.removeItem(STORAGE_KEYS[kind])
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/devicePreferences.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/devicePreferences.ts apps/web/src/office/media/devicePreferences.test.ts
git commit -m "feat(escritório): persiste a preferência de mic/câmera/saída de áudio"
```

---

### Task 3: `audioSink` — helper de `setSinkId`

**Files:**
- Create: `apps/web/src/office/media/audioSink.ts`
- Test: `apps/web/src/office/media/audioSink.test.ts`

**Interfaces:**
- Produces: `applyAudioSink(el: HTMLMediaElement, deviceId: string | null): Promise<void>` — no-op quando `deviceId` é `null` (padrão do sistema, nada a fazer) ou a API não existe; nunca lança (falha silenciosa se o dispositivo sumiu entre a escolha e a aplicação).

- [ ] **Step 1: Escrever o teste**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAudioSink } from './audioSink'

function withFakeSetSinkId(impl: (id: string) => Promise<void>) {
  ;(HTMLMediaElement.prototype as unknown as { setSinkId: typeof impl }).setSinkId = impl
}

afterEach(() => {
  delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
})

describe('applyAudioSink', () => {
  it('chama setSinkId com o deviceId quando a API existe', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    withFakeSetSinkId(setSinkId)
    const el = document.createElement('audio')

    await applyAudioSink(el, 'out-1')

    expect(setSinkId).toHaveBeenCalledWith('out-1')
  })

  it('deviceId null (padrão do sistema) não chama setSinkId', async () => {
    const setSinkId = vi.fn()
    withFakeSetSinkId(setSinkId)
    const el = document.createElement('audio')

    await applyAudioSink(el, null)

    expect(setSinkId).not.toHaveBeenCalled()
  })

  it('sem a API no navegador, não lança', async () => {
    const el = document.createElement('audio')
    await expect(applyAudioSink(el, 'out-1')).resolves.toBeUndefined()
  })

  it('setSinkId rejeitando (dispositivo sumiu) não lança', async () => {
    withFakeSetSinkId(() => Promise.reject(new Error('device gone')))
    const el = document.createElement('audio')

    await expect(applyAudioSink(el, 'out-1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/audioSink.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
/**
 * Aplica a saída de áudio escolhida a um elemento `<audio>`, se o navegador
 * suportar `setSinkId` (só Chromium — Firefox/Safari não têm essa API).
 * `deviceId` null = padrão do sistema, nada a fazer (já é o comportamento
 * default do elemento). Nunca lança: o dispositivo pode ter sido desplugado
 * entre a escolha e a aplicação — nesse caso mantém o sink anterior.
 */
export async function applyAudioSink(el: HTMLMediaElement, deviceId: string | null): Promise<void> {
  if (deviceId === null) return
  const withSinkId = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }
  if (typeof withSinkId.setSinkId !== 'function') return
  try {
    await withSinkId.setSinkId(deviceId)
  } catch {
    // dispositivo pode ter sumido entre a escolha e a aplicação — ignora
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/audioSink.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/audioSink.ts apps/web/src/office/media/audioSink.test.ts
git commit -m "feat(escritório): helper applyAudioSink (setSinkId com feature-detect)"
```

---

### Task 4: `RemoteAudio` — aplica a saída escolhida

**Files:**
- Modify: `apps/web/src/office/media/RemoteAudio.tsx`
- Create: `apps/web/src/office/media/RemoteAudio.test.tsx`

**Interfaces:**
- Consumes: `applyAudioSink` (Task 3).
- Produces: `RemoteAudio({ track, outputDeviceId?: string | null })` — `outputDeviceId` default `null`.

- [ ] **Step 1: Escrever o teste**

Crie `apps/web/src/office/media/RemoteAudio.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { RemoteAudioTrack } from 'livekit-client'
import { RemoteAudio } from './RemoteAudio'

function fakeTrack(): RemoteAudioTrack {
  return { attach: vi.fn(), detach: vi.fn() } as unknown as RemoteAudioTrack
}

function withFakeSetSinkId(impl: (id: string) => Promise<void>) {
  ;(HTMLMediaElement.prototype as unknown as { setSinkId: typeof impl }).setSinkId = impl
}

afterEach(() => {
  delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
})

describe('RemoteAudio', () => {
  it('anexa a track ao elemento de áudio', () => {
    const track = fakeTrack()
    render(<RemoteAudio track={track} />)
    expect(track.attach).toHaveBeenCalledOnce()
  })

  it('chama setSinkId com o outputDeviceId quando a API existe', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    withFakeSetSinkId(setSinkId)

    render(<RemoteAudio track={fakeTrack()} outputDeviceId="out-1" />)

    await waitFor(() => expect(setSinkId).toHaveBeenCalledWith('out-1'))
  })

  it('sem outputDeviceId (padrão do sistema), não chama setSinkId', async () => {
    const setSinkId = vi.fn()
    withFakeSetSinkId(setSinkId)

    render(<RemoteAudio track={fakeTrack()} />)
    await Promise.resolve()

    expect(setSinkId).not.toHaveBeenCalled()
  })

  it('não quebra quando o navegador não suporta setSinkId', () => {
    expect(() => render(<RemoteAudio track={fakeTrack()} outputDeviceId="out-1" />)).not.toThrow()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/RemoteAudio.test.tsx`
Expected: FAIL (o teste de `setSinkId` — `RemoteAudio` ainda não aceita/aplica `outputDeviceId`).

- [ ] **Step 3: Implementar**

Substitua `apps/web/src/office/media/RemoteAudio.tsx` inteiro por:

```tsx
import { useEffect, useRef } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'
import { applyAudioSink } from './audioSink'

/** Anexa um track de áudio a um <audio> invisível enquanto montado. */
export function RemoteAudio({
  track,
  outputDeviceId = null,
}: {
  track: RemoteAudioTrack
  outputDeviceId?: string | null
}) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    void applyAudioSink(el, outputDeviceId)
  }, [outputDeviceId])

  return <audio ref={ref} autoPlay className="hidden" />
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/RemoteAudio.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/RemoteAudio.tsx apps/web/src/office/media/RemoteAudio.test.tsx
git commit -m "feat(escritório): RemoteAudio aplica a saída de áudio escolhida"
```

---

### Task 5: `spatialAudio.ts` — grafo passa por um destino que aceita `setSinkId`

**Files:**
- Modify: `apps/web/src/office/media/spatialAudio.ts`
- Modify: `apps/web/src/office/media/spatialAudio.test.ts`

**Interfaces:**
- Consumes: `applyAudioSink` (Task 3).
- Produces: `SpatialAudioGraph.setOutputDevice(deviceId: string | null): void` (novo); `createSpatialAudioGraph(mediaStreamTrack, outputDeviceId?: string | null)`.

- [ ] **Step 1: Atualizar `installFakeAudio()` e os testes existentes de `createSpatialAudioGraph`**

Em `apps/web/src/office/media/spatialAudio.test.ts`, troque a função `installFakeAudio` e todo o bloco `describe('createSpatialAudioGraph', ...)` por:

```ts
function installFakeAudio() {
  const gainNode = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } }
  const pannerNode = { connect: vi.fn(), disconnect: vi.fn(), pan: { value: 0 } }
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() }
  const destinationNode = { stream: {} }
  const ctx = {
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createMediaStreamSource: vi.fn(() => sourceNode),
    createGain: vi.fn(() => gainNode),
    createStereoPanner: vi.fn(() => pannerNode),
    createMediaStreamDestination: vi.fn(() => destinationNode),
  }
  vi.stubGlobal('AudioContext', vi.fn(() => ctx))
  vi.stubGlobal('MediaStream', vi.fn((tracks: unknown[]) => ({ tracks })))
  return { ctx, gainNode, pannerNode, sourceNode, destinationNode }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  document.querySelectorAll('audio').forEach((el) => el.remove())
  delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId
})

describe('createSpatialAudioGraph', () => {
  it('conecta fonte → ganho → pan → um destino de stream (não mais ctx.destination direto)', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)

    expect(graph).not.toBeNull()
    expect(fake.sourceNode.connect).toHaveBeenCalledWith(fake.gainNode)
    expect(fake.gainNode.connect).toHaveBeenCalledWith(fake.pannerNode)
    expect(fake.pannerNode.connect).toHaveBeenCalledWith(fake.destinationNode)
  })

  it('cria dois <audio>: um mutado (keep-alive da track bruta) e outro audível ligado ao stream processado', async () => {
    installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    createSpatialAudioGraph({} as MediaStreamTrack)

    const sinks = Array.from(document.getElementsByTagName('audio'))
    expect(sinks).toHaveLength(2)
    const [keepAlive, output] = sinks
    expect(keepAlive.muted).toBe(true)
    expect(keepAlive.srcObject).not.toBeNull()
    expect(output.muted).toBe(false)
    expect(output.srcObject).not.toBeNull()
  })

  it('update() ajusta gain.value e pan.value com as mesmas fórmulas de computeGain/computePan', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!

    graph.update(1, 0)

    expect(fake.gainNode.gain.value).toBeCloseTo(computeGain(1, 0))
    expect(fake.pannerNode.pan.value).toBeCloseTo(computePan(1))
  })

  it('setOutputDevice chama setSinkId só no <audio> de saída (não no keep-alive)', async () => {
    installFakeAudio()
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    ;(HTMLMediaElement.prototype as unknown as { setSinkId: typeof setSinkId }).setSinkId = setSinkId
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!
    setSinkId.mockClear()

    graph.setOutputDevice('out-1')
    await Promise.resolve()

    expect(setSinkId).toHaveBeenCalledTimes(1)
    expect(setSinkId).toHaveBeenCalledWith('out-1')
  })

  it('dispose() desconecta todos os nós e remove os dois <audio> do DOM', async () => {
    const fake = installFakeAudio()
    const { createSpatialAudioGraph } = await import('./spatialAudio')
    const graph = createSpatialAudioGraph({} as MediaStreamTrack)!

    graph.dispose()

    expect(fake.sourceNode.disconnect).toHaveBeenCalledOnce()
    expect(fake.gainNode.disconnect).toHaveBeenCalledOnce()
    expect(fake.pannerNode.disconnect).toHaveBeenCalledOnce()
    expect(document.getElementsByTagName('audio')).toHaveLength(0)
  })

  it('retorna null sem Web Audio API no navegador', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { createSpatialAudioGraph } = await import('./spatialAudio')

    expect(createSpatialAudioGraph({} as MediaStreamTrack)).toBeNull()
  })
})
```

(Os blocos `describe('computeGain', ...)` e `describe('computePan', ...)` no topo do arquivo não mudam.)

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/spatialAudio.test.ts`
Expected: FAIL (implementação ainda liga direto em `ctx.destination`, só cria 1 `<audio>`, e `setOutputDevice` não existe).

- [ ] **Step 3: Implementar**

Substitua `apps/web/src/office/media/spatialAudio.ts` a partir da definição de `SpatialAudioGraph` até o fim do arquivo:

```ts
import { applyAudioSink } from './audioSink'

export interface SpatialAudioGraph {
  /** `dx`/`dy` em tiles — mesma unidade de `computeGain`/`computePan`. */
  update(dx: number, dy: number): void
  /** Troca a saída de áudio (alto-falante/fone) sem recriar o grafo. */
  setOutputDevice(deviceId: string | null): void
  dispose(): void
}

/**
 * Grafo fonte → ganho → pan → saída para uma track remota. `null` sem Web
 * Audio API disponível — quem chama cai de volta para `<audio>` simples
 * (ver `SpatialRemoteAudio`).
 */
export function createSpatialAudioGraph(
  mediaStreamTrack: MediaStreamTrack,
  outputDeviceId: string | null = null,
): SpatialAudioGraph | null {
  const ctx = getAudioContext()
  if (!ctx) return null

  const stream = new MediaStream([mediaStreamTrack])
  const source = ctx.createMediaStreamSource(stream)
  const gain = ctx.createGain()
  const panner = ctx.createStereoPanner()
  // Destino em stream (não mais `ctx.destination` fixo no dispositivo padrão do
  // sistema) — é o que permite escolher a saída via `setSinkId` no <audio>
  // "outputSink" abaixo, sem perder o ganho/pan já aplicados no grafo.
  const destination = ctx.createMediaStreamDestination()
  source.connect(gain)
  gain.connect(panner)
  panner.connect(destination)

  // Track remota de WebRTC sem NENHUM elemento de mídia associado pode ficar
  // muda no Chrome (o pipeline só "bombeia" dados com um sink de mídia real
  // consumindo a track) — mesmo com o grafo Web Audio corretamente ligado.
  // Este <audio> mutado existe só para manter a track viva; fica escondido
  // no DOM e nunca toca som próprio (senão duplicava o áudio do grafo).
  const keepAliveSink = document.createElement('audio')
  keepAliveSink.srcObject = stream
  keepAliveSink.muted = true
  keepAliveSink.autoplay = true
  keepAliveSink.hidden = true
  document.body.appendChild(keepAliveSink)

  // Este <audio> é quem realmente toca (ganho + pan já aplicados no stream
  // processado) — e é nele que `setSinkId` escolhe o dispositivo de saída.
  const outputSink = document.createElement('audio')
  outputSink.srcObject = destination.stream
  outputSink.autoplay = true
  outputSink.hidden = true
  document.body.appendChild(outputSink)
  void applyAudioSink(outputSink, outputDeviceId)

  return {
    update(dx, dy) {
      gain.gain.value = computeGain(dx, dy)
      panner.pan.value = computePan(dx)
    },
    setOutputDevice(deviceId) {
      void applyAudioSink(outputSink, deviceId)
    },
    dispose() {
      source.disconnect()
      gain.disconnect()
      panner.disconnect()
      keepAliveSink.srcObject = null
      keepAliveSink.remove()
      outputSink.srcObject = null
      outputSink.remove()
    },
  }
}
```

(As funções `computeGain`, `computePan` e `getAudioContext` no início do arquivo não mudam — mantenha-as como estão.)

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/spatialAudio.test.ts`
Expected: PASS (todos os testes de `computeGain`/`computePan`/`createSpatialAudioGraph`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/spatialAudio.ts apps/web/src/office/media/spatialAudio.test.ts
git commit -m "feat(escritório): áudio espacial passa a suportar troca de saída (setSinkId)"
```

---

### Task 6: `SpatialRemoteAudio` — repassa a saída escolhida

**Files:**
- Modify: `apps/web/src/office/media/SpatialRemoteAudio.tsx`
- Modify: `apps/web/src/office/media/SpatialRemoteAudio.test.tsx`

**Interfaces:**
- Consumes: `createSpatialAudioGraph`, `SpatialAudioGraph.setOutputDevice` (Task 5); `RemoteAudio` (Task 4, já aceita `outputDeviceId`).
- Produces: `SpatialRemoteAudio({ track, you, occupant, outputDeviceId?: string | null })`.

- [ ] **Step 1: Adicionar o teste**

Em `apps/web/src/office/media/SpatialRemoteAudio.test.tsx`, adicione (após o `it('monta o grafo...')` existente):

```tsx
it('passa o outputDeviceId pro createSpatialAudioGraph e chama setOutputDevice quando ele muda, sem recriar o grafo', () => {
  const setOutputDeviceMock = vi.fn()
  createSpatialAudioGraphMock.mockReturnValue({
    update: updateMock,
    dispose: disposeMock,
    setOutputDevice: setOutputDeviceMock,
  })
  const track = fakeTrack()
  const { rerender } = render(
    <SpatialRemoteAudio
      track={track}
      you={occupant('you', 10, 10)}
      occupant={occupant('ana', 11, 10)}
      outputDeviceId="out-1"
    />,
  )

  expect(createSpatialAudioGraphMock).toHaveBeenCalledWith(track.mediaStreamTrack, 'out-1')

  rerender(
    <SpatialRemoteAudio
      track={track}
      you={occupant('you', 10, 10)}
      occupant={occupant('ana', 11, 10)}
      outputDeviceId="out-2"
    />,
  )

  expect(setOutputDeviceMock).toHaveBeenCalledWith('out-2')
  expect(createSpatialAudioGraphMock).toHaveBeenCalledOnce() // não recria o grafo só por causa da saída
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/SpatialRemoteAudio.test.tsx`
Expected: FAIL (`SpatialRemoteAudio` ainda não aceita/repassa `outputDeviceId`).

- [ ] **Step 3: Implementar**

Substitua `apps/web/src/office/media/SpatialRemoteAudio.tsx` inteiro por:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'
import type { OfficeOccupant } from '@legends/shared'
import { createSpatialAudioGraph, type SpatialAudioGraph } from './spatialAudio'
import { RemoteAudio } from './RemoteAudio'

/**
 * Variante de `RemoteAudio` para o espaço aberto: toca via Web Audio API
 * (ganho + pan estéreo por posição relativa) em vez de `<audio>` simples —
 * por isso não renderiza nada quando o grafo existe (a saída já vai pro
 * `<audio>` interno do grafo, ver `spatialAudio.ts`). Sem Web Audio
 * disponível, cai de volta para `RemoteAudio` (nunca os dois ao mesmo tempo,
 * senão o áudio toca em dobro).
 */
export function SpatialRemoteAudio({
  track,
  you,
  occupant,
  outputDeviceId = null,
}: {
  track: RemoteAudioTrack
  you: OfficeOccupant
  occupant: OfficeOccupant
  outputDeviceId?: string | null
}) {
  const graphRef = useRef<SpatialAudioGraph | null>(null)
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    const graph = createSpatialAudioGraph(track.mediaStreamTrack, outputDeviceId)
    graphRef.current = graph
    setAvailable(graph !== null)
    return () => {
      graph?.dispose()
      graphRef.current = null
    }
    // outputDeviceId só é usado como valor INICIAL do grafo aqui — trocas
    // subsequentes são aplicadas pelo effect abaixo via setOutputDevice, sem
    // recriar o grafo (senão o áudio piscaria a cada troca de dispositivo).
  }, [track])

  useEffect(() => {
    graphRef.current?.update(occupant.x - you.x, occupant.y - you.y)
  }, [you.x, you.y, occupant.x, occupant.y])

  useEffect(() => {
    graphRef.current?.setOutputDevice(outputDeviceId)
  }, [outputDeviceId])

  if (!available) return <RemoteAudio track={track} outputDeviceId={outputDeviceId} />
  return null
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/SpatialRemoteAudio.test.tsx`
Expected: PASS (todos os testes, incluindo o novo).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/SpatialRemoteAudio.tsx apps/web/src/office/media/SpatialRemoteAudio.test.tsx
git commit -m "feat(escritório): SpatialRemoteAudio repassa a saída de áudio escolhida"
```

---

### Task 7: `useOfficeMedia` — cria tracks com o dispositivo preferido e troca ao vivo

**Files:**
- Modify: `apps/web/src/office/media/useOfficeMedia.ts`
- Modify: `apps/web/src/office/media/useOfficeMedia.test.ts`

**Interfaces:**
- Consumes: `readDevicePreference`, `writeDevicePreference` (Task 2).
- Produces: `OfficeMediaState.audioInputDeviceId: string | null`, `OfficeMediaState.videoInputDeviceId: string | null`, `OfficeMediaState.setAudioInputDevice(deviceId: string | null): Promise<void>`, `OfficeMediaState.setVideoInputDevice(deviceId: string | null): Promise<void>`.

- [ ] **Step 1: Estender o fake do LiveKit com `switchActiveDevice`**

Em `apps/web/src/office/media/useOfficeMedia.test.ts`, dentro da classe `FakeRoom` (bloco `vi.hoisted`), adicione o campo e o método (logo após `disconnected = false`):

```ts
    switchActiveDeviceCalls: Array<{ kind: string; deviceId: string }> = []
```

E, logo após o método `async disconnect() { this.disconnected = true }`:

```ts
    async switchActiveDevice(kind: string, deviceId: string) {
      this.switchActiveDeviceCalls.push({ kind, deviceId })
      return true
    }
```

- [ ] **Step 2: Adicionar os testes de dispositivo**

No `describe('useOfficeMedia', ...)`, adicione (após o teste `'conecta em office-open (autoSubscribe off) e publica o mic MUTADO'`):

```ts
  it('cria o mic já com o deviceId preferido salvo em localStorage', async () => {
    localStorage.setItem('office:preferred-audio-input', 'mic-preferido')
    renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    expect(createLocalAudioTrackMock).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'mic-preferido' }))
  })

  it('setAudioInputDevice persiste a escolha e troca o dispositivo ativo via switchActiveDevice', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)

    await act(async () => {
      await result.current.setAudioInputDevice('mic-novo')
    })

    expect(localStorage.getItem('office:preferred-audio-input')).toBe('mic-novo')
    const room = FakeRoom.instances.at(-1)!
    expect(room.switchActiveDeviceCalls).toContainEqual({ kind: 'audioinput', deviceId: 'mic-novo' })
    expect(result.current.audioInputDeviceId).toBe('mic-novo')
  })

  it('setVideoInputDevice só troca o dispositivo ativo se a câmera já estiver ligada; sempre persiste', async () => {
    const { result } = renderHook(() => useOfficeMedia([occupant('you', 12, 14)], 'you', true))
    await settle(600)
    const room = FakeRoom.instances.at(-1)!

    await act(async () => {
      await result.current.setVideoInputDevice('cam-nova')
    })
    expect(room.switchActiveDeviceCalls).toHaveLength(0) // câmera desligada: só persiste
    expect(localStorage.getItem('office:preferred-video-input')).toBe('cam-nova')

    await act(async () => {
      await result.current.toggleCamera()
    })
    expect(setCameraEnabledMock).toHaveBeenCalledWith(true, { deviceId: 'cam-nova' })
  })
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts`
Expected: FAIL nos 3 testes novos (`setAudioInputDevice`/`setVideoInputDevice`/`audioInputDeviceId` não existem; `createLocalAudioTrack` não recebe `deviceId`; `setCameraEnabled` não recebe o segundo argumento).

- [ ] **Step 4: Implementar em `useOfficeMedia.ts`**

Adicione o import no topo do arquivo (junto aos demais imports locais):

```ts
import { readDevicePreference, writeDevicePreference } from './devicePreferences'
```

Adicione os dois novos campos à interface `OfficeMediaState` (logo após `applyMicEnabled(enabled: boolean): Promise<void>`):

```ts
  /** `null` = usando o padrão do sistema. */
  audioInputDeviceId: string | null
  videoInputDeviceId: string | null
  setAudioInputDevice(deviceId: string | null): Promise<void>
  setVideoInputDevice(deviceId: string | null): Promise<void>
```

Dentro da função `useOfficeMedia`, logo após a declaração de `const [micEnabled, setMicEnabled] = useState(readMicPreference)`, adicione os dois novos estados:

```ts
  const [audioInputDeviceId, setAudioInputDeviceIdState] = useState<string | null>(() =>
    readDevicePreference('audioInput'),
  )
  const [videoInputDeviceId, setVideoInputDeviceIdState] = useState<string | null>(() =>
    readDevicePreference('videoInput'),
  )
```

Logo após a declaração de `const youIdRef = useRef(youId); youIdRef.current = youId`, adicione os refs espelho (mesmo padrão já usado para evitar closures obsoletas dentro de `connectTo`/`toggleCamera`):

```ts
  const audioInputDeviceIdRef = useRef(audioInputDeviceId)
  audioInputDeviceIdRef.current = audioInputDeviceId
  const videoInputDeviceIdRef = useRef(videoInputDeviceId)
  videoInputDeviceIdRef.current = videoInputDeviceId
```

Na criação da track de microfone dentro de `connectTo` (dentro do `try` que chama `createLocalAudioTrack()`), troque:

```ts
          const track = await createLocalAudioTrack()
```

por:

```ts
          const track = await createLocalAudioTrack({
            deviceId: audioInputDeviceIdRef.current ?? undefined,
          })
```

Em `toggleCamera`, troque:

```ts
  const toggleCamera = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !cameraEnabled
    try {
      await room.localParticipant.setCameraEnabled(next)
      setCameraEnabled(next)
      setCameraError(false)
    } catch {
      setCameraEnabled(false)
      setCameraError(true)
    }
  }, [cameraEnabled])
```

por:

```ts
  const toggleCamera = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !cameraEnabled
    try {
      await room.localParticipant.setCameraEnabled(
        next,
        next && videoInputDeviceIdRef.current ? { deviceId: videoInputDeviceIdRef.current } : undefined,
      )
      setCameraEnabled(next)
      setCameraError(false)
    } catch {
      setCameraEnabled(false)
      setCameraError(true)
    }
  }, [cameraEnabled])
```

Adicione os dois novos setters, logo após `applyMicEnabled` (antes do `return`):

```ts
  /**
   * Troca o microfone em uso. Persiste sempre; só chama `switchActiveDevice`
   * (troca ao vivo, sem cair a chamada) quando já existe uma track de mic
   * publicada — sem isso, é só a preferência para a próxima vez.
   */
  const setAudioInputDevice = useCallback(async (deviceId: string | null) => {
    writeDevicePreference('audioInput', deviceId)
    setAudioInputDeviceIdState(deviceId)
    const room = roomRef.current
    if (!room || !micTrackRef.current) return
    await room.switchActiveDevice('audioinput', deviceId ?? 'default')
  }, [])

  /**
   * Troca a câmera em uso. Persiste sempre; só chama `switchActiveDevice`
   * quando a câmera já está ligada — trocar a preferência não deve ligar a
   * câmera sozinha.
   */
  const setVideoInputDevice = useCallback(
    async (deviceId: string | null) => {
      writeDevicePreference('videoInput', deviceId)
      setVideoInputDeviceIdState(deviceId)
      const room = roomRef.current
      if (!room || !cameraEnabled) return
      await room.switchActiveDevice('videoinput', deviceId ?? 'default')
    },
    [cameraEnabled],
  )
```

No `return` final do hook, adicione os quatro novos campos (logo após `applyMicEnabled,`):

```ts
    audioInputDeviceId,
    videoInputDeviceId,
    setAudioInputDevice,
    setVideoInputDevice,
```

- [ ] **Step 5: Verificar `switchActiveDevice` contra o `livekit-client` instalado**

Antes de rodar os testes, confirme que a assinatura usada (`room.switchActiveDevice(kind, deviceId, exact?)`, sentinela `'default'` para "voltar ao padrão do sistema") bate com o pacote instalado:

Run: `grep -n "switchActiveDevice" node_modules/.pnpm/livekit-client@*/node_modules/livekit-client/dist/src/room/Room.d.ts`

Se o comportamento do sentinela `'default'` divergir do esperado (ex.: precisar de string vazia, ou de omitir o argumento), ajuste os dois setters acima de acordo — o teste do Step 2 já cobre o caso feliz e não depende do valor exato do sentinela (usa um mock simples), então o ajuste é só no código de produção.

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/useOfficeMedia.test.ts`
Expected: PASS (arquivo inteiro — confirme que os testes pré-existentes continuam passando também).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeMedia.test.ts
git commit -m "feat(escritório): useOfficeMedia cria tracks com o dispositivo preferido e troca ao vivo"
```

---

### Task 8: `OfficeSessionContext` — dispositivos e saída de áudio na sessão

**Files:**
- Modify: `apps/web/src/office/session/OfficeSessionContext.tsx`
- Modify: `apps/web/src/office/session/OfficeSessionContext.test.tsx`

**Interfaces:**
- Consumes: `useMediaDevices`, `MediaDevicesState` (Task 1); `readDevicePreference`, `writeDevicePreference` (Task 2); `RemoteAudio`/`SpatialRemoteAudio` já aceitando `outputDeviceId` (Tasks 4/6).
- Produces: `OfficeSessionValue.devices: MediaDevicesState`, `OfficeSessionValue.audioOutputDeviceId: string | null`, `OfficeSessionValue.setAudioOutputDevice(deviceId: string | null): void`.

- [ ] **Step 1: Adicionar o mock de `useMediaDevices` e o novo teste**

Em `apps/web/src/office/session/OfficeSessionContext.test.tsx`, adicione ao bloco de `vi.mock` no topo (junto aos demais):

```ts
vi.mock('../media/useMediaDevices', () => ({ useMediaDevices: vi.fn() }))
```

E o import correspondente junto aos demais imports de hooks mockados:

```ts
import { useMediaDevices } from '../media/useMediaDevices'
```

No `beforeEach`, adicione o retorno padrão do mock (junto aos demais `vi.mocked(...).mockReturnValue(...)`):

```ts
  vi.mocked(useMediaDevices).mockReturnValue({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
    supportsAudioOutputSelection: true,
  })
```

Adicione o novo teste (em qualquer ponto do `describe('OfficeSessionProvider', ...)`):

```tsx
  it('setAudioOutputDevice persiste a escolha e atualiza o valor exposto pelo contexto', () => {
    function OutputHarness() {
      const session = useOfficeSession()
      return (
        <div>
          <span data-testid="output-device">{session.audioOutputDeviceId ?? 'default'}</span>
          <button onClick={() => session.setAudioOutputDevice('out-2')}>trocar saída</button>
        </div>
      )
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OfficeSessionProvider>
          <OutputHarness />
        </OfficeSessionProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('output-device').textContent).toBe('default')
    fireEvent.click(screen.getByText('trocar saída'))
    expect(screen.getByTestId('output-device').textContent).toBe('out-2')
    expect(localStorage.getItem('office:preferred-audio-output')).toBe('out-2')
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/session/OfficeSessionContext.test.tsx`
Expected: FAIL (o teste novo — `useOfficeSession()` ainda não expõe `audioOutputDeviceId`/`setAudioOutputDevice`; os demais testes já existentes devem continuar passando).

- [ ] **Step 3: Implementar em `OfficeSessionContext.tsx`**

Adicione os imports (junto aos demais de `../media/...`):

```ts
import { useMediaDevices, type MediaDevicesState } from '../media/useMediaDevices'
import { readDevicePreference, writeDevicePreference } from '../media/devicePreferences'
```

Estenda a interface `OfficeSessionValue` (logo após `cameraBackground: CameraBackgroundState`):

```ts
  devices: MediaDevicesState
  audioOutputDeviceId: string | null
  setAudioOutputDevice(deviceId: string | null): void
```

Dentro de `OfficeSessionProvider`, logo após `const cameraBackground = useCameraBackground(media.localCameraTrack)`, adicione:

```ts
  const devices = useMediaDevices()
  const [audioOutputDeviceId, setAudioOutputDeviceIdState] = useState<string | null>(() =>
    readDevicePreference('audioOutput'),
  )
  const setAudioOutputDevice = useCallback((deviceId: string | null) => {
    writeDevicePreference('audioOutput', deviceId)
    setAudioOutputDeviceIdState(deviceId)
  }, [])
```

No objeto retornado por `useMemo` (`const value = useMemo<OfficeSessionValue>(() => ({...`), adicione os três campos (logo após `cameraBackground,`):

```ts
      devices,
      audioOutputDeviceId,
      setAudioOutputDevice,
```

E no array de dependências do mesmo `useMemo` (logo após `cameraBackground,`):

```ts
      devices,
      audioOutputDeviceId,
      setAudioOutputDevice,
```

Por fim, no JSX que renderiza `RemoteAudio`/`SpatialRemoteAudio`, adicione `outputDeviceId={audioOutputDeviceId}` nas três ocorrências:

```tsx
      {media.remotes.map((r) => {
        if (!r.audioTrack) return null
        const remoteOccupant = isOpenRoom ? occupants.find((o) => o.userId === r.userId) : undefined
        if (isOpenRoom && you && remoteOccupant) {
          return (
            <SpatialRemoteAudio
              key={`a-${r.userId}`}
              track={r.audioTrack}
              you={you}
              occupant={remoteOccupant}
              outputDeviceId={audioOutputDeviceId}
            />
          )
        }
        return <RemoteAudio key={`a-${r.userId}`} track={r.audioTrack} outputDeviceId={audioOutputDeviceId} />
      })}
      {media.remotes.map(
        (r) =>
          r.screenAudioTrack && (
            <RemoteAudio key={`sa-${r.userId}`} track={r.screenAudioTrack} outputDeviceId={audioOutputDeviceId} />
          ),
      )}
      {broadcast.broadcastTracks.map((track, index) => (
        <RemoteAudio key={track.sid ?? `b-${index}`} track={track} outputDeviceId={audioOutputDeviceId} />
      ))}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/session/OfficeSessionContext.test.tsx`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/session/OfficeSessionContext.tsx apps/web/src/office/session/OfficeSessionContext.test.tsx
git commit -m "feat(escritório): OfficeSessionContext expõe dispositivos e saída de áudio da sessão"
```

---

### Task 9: `DeviceMenu` — popover genérico de escolha de dispositivo

**Files:**
- Create: `apps/web/src/office/media/DeviceMenu.tsx`
- Test: `apps/web/src/office/media/DeviceMenu.test.tsx`

**Interfaces:**
- Consumes: `MediaDeviceOption` (Task 1).
- Produces: `DeviceMenu({ label, devices, selectedDeviceId, onSelect, onClose, rootAttr })` — reutilizado pelo menu de microfone e pelo de saída de áudio (Task 10).

- [ ] **Step 1: Escrever o teste**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeviceMenu } from './DeviceMenu'

const onClose = vi.fn()
const onSelect = vi.fn()
const devices = [
  { deviceId: 'mic1', label: 'Microfone USB' },
  { deviceId: 'mic2', label: 'Microfone do notebook' },
]

beforeEach(() => vi.clearAllMocks())

describe('DeviceMenu', () => {
  it('lista "Padrão do sistema" + os dispositivos, com check na opção ativa', () => {
    render(
      <DeviceMenu
        label="Microfone"
        devices={devices}
        selectedDeviceId="mic2"
        onSelect={onSelect}
        onClose={onClose}
        rootAttr="data-mic-menu-root"
      />,
    )
    expect(screen.getByRole('menuitemradio', { name: /Padrão do sistema/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /Microfone do notebook/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemradio', { name: /Microfone USB/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('selecionar um dispositivo chama onSelect com o deviceId', () => {
    render(
      <DeviceMenu
        label="Microfone"
        devices={devices}
        selectedDeviceId={null}
        onSelect={onSelect}
        onClose={onClose}
        rootAttr="data-mic-menu-root"
      />,
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Microfone USB/ }))
    expect(onSelect).toHaveBeenCalledWith('mic1')
  })

  it('selecionar "Padrão do sistema" chama onSelect com null', () => {
    render(
      <DeviceMenu
        label="Microfone"
        devices={devices}
        selectedDeviceId="mic1"
        onSelect={onSelect}
        onClose={onClose}
        rootAttr="data-mic-menu-root"
      />,
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Padrão do sistema/ }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('Esc fecha o menu', () => {
    render(
      <DeviceMenu
        label="Microfone"
        devices={devices}
        selectedDeviceId={null}
        onSelect={onSelect}
        onClose={onClose}
        rootAttr="data-mic-menu-root"
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clique fora do container com rootAttr fecha o menu', () => {
    render(
      <div>
        <div data-mic-menu-root>
          <DeviceMenu
            label="Microfone"
            devices={devices}
            selectedDeviceId={null}
            onSelect={onSelect}
            onClose={onClose}
            rootAttr="data-mic-menu-root"
          />
        </div>
        <button type="button">fora</button>
      </div>,
    )
    fireEvent.mouseDown(screen.getByText('fora'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/DeviceMenu.test.tsx`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```tsx
import { useEffect } from 'react'
import { Icon } from '../../components/Icon'
import type { MediaDeviceOption } from './useMediaDevices'

/**
 * Popover genérico de escolha de dispositivo (mic ou saída de áudio), mesmo
 * padrão do menu de fundo virtual da câmera (`CameraBackgroundMenu`): fecha
 * em Esc/clique fora do container marcado com `rootAttr`, `aria-checked` na
 * opção ativa.
 */
export function DeviceMenu({
  label,
  devices,
  selectedDeviceId,
  onSelect,
  onClose,
  rootAttr,
}: {
  label: string
  devices: MediaDeviceOption[]
  selectedDeviceId: string | null
  onSelect: (deviceId: string | null) => void
  onClose: () => void
  /** Atributo `data-*` do container que NÃO deve fechar o menu ao ser clicado (ex.: `data-mic-menu-root`). */
  rootAttr: string
}) {
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest(`[${rootAttr}]`)) onClose()
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
  }, [onClose, rootAttr])

  return (
    <div
      role="menu"
      aria-label={label}
      className="absolute bottom-[calc(100%+0.35rem)] left-1/2 z-20 w-60 -translate-x-1/2 overflow-hidden rounded-xl border border-white/15 bg-[#262626]/95 p-1 shadow-xl backdrop-blur"
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selectedDeviceId === null}
        onClick={() => onSelect(null)}
        className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
          selectedDeviceId === null ? 'bg-primary/90 text-on-primary' : 'text-white/85 hover:bg-white/10'
        }`}
      >
        <Icon name="settings_suggest" className="text-[18px]" />
        <span className="min-w-0 flex-1 truncate">Padrão do sistema</span>
        {selectedDeviceId === null && <Icon name="check" className="text-[16px]" />}
      </button>
      {devices.map((device) => {
        const active = selectedDeviceId === device.deviceId
        return (
          <button
            key={device.deviceId}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => onSelect(device.deviceId)}
            className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
              active ? 'bg-primary/90 text-on-primary' : 'text-white/85 hover:bg-white/10'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{device.label}</span>
            {active && <Icon name="check" className="text-[16px]" />}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/DeviceMenu.test.tsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/DeviceMenu.tsx apps/web/src/office/media/DeviceMenu.test.tsx
git commit -m "feat(escritório): popover genérico DeviceMenu (escolha de mic/saída de áudio)"
```

---

### Task 10: `CameraBackgroundMenu` — seção de dispositivo de câmera

**Files:**
- Modify: `apps/web/src/office/media/CameraBackgroundMenu.tsx`
- Modify: `apps/web/src/office/media/CameraBackgroundMenu.test.tsx`

**Interfaces:**
- Consumes: `MediaDeviceOption` (Task 1).
- Produces: `CameraBackgroundMenu` ganha os props opcionais `videoDevices?`, `selectedVideoDeviceId?`, `onSelectVideoDevice?` — sem `onSelectVideoDevice`, comportamento idêntico ao atual (nenhuma seção nova renderiza).

- [ ] **Step 1: Adicionar os testes**

Em `apps/web/src/office/media/CameraBackgroundMenu.test.tsx`, adicione (dentro do `describe('CameraBackgroundMenu', ...)`):

```tsx
  it('sem onSelectVideoDevice, não mostra seção de câmera (comportamento existente preservado)', () => {
    render(<CameraBackgroundMenu state={makeState()} onClose={onClose} />)
    expect(screen.queryByText('Câmera')).not.toBeInTheDocument()
  })

  it('com onSelectVideoDevice, lista os dispositivos de vídeo com "Padrão do sistema" e o item ativo marcado', () => {
    const onSelectVideoDevice = vi.fn()
    render(
      <CameraBackgroundMenu
        state={makeState()}
        onClose={onClose}
        videoDevices={[{ deviceId: 'cam1', label: 'Webcam USB' }]}
        selectedVideoDeviceId="cam1"
        onSelectVideoDevice={onSelectVideoDevice}
      />,
    )
    expect(screen.getByRole('menuitemradio', { name: /Webcam USB/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: /Padrão do sistema/ })).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Webcam USB/ }))
    expect(onSelectVideoDevice).toHaveBeenCalledWith('cam1')
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/CameraBackgroundMenu.test.tsx`
Expected: FAIL nos 2 testes novos (props ainda não existem); os 5 testes já existentes continuam passando.

- [ ] **Step 3: Implementar**

Substitua `apps/web/src/office/media/CameraBackgroundMenu.tsx` inteiro por:

```tsx
import { useEffect } from 'react'
import { Icon } from '../../components/Icon'
import { CAMERA_BACKGROUNDS, type CameraBackgroundId } from './camera-backgrounds'
import type { CameraBackgroundState } from './useCameraBackground'
import type { MediaDeviceOption } from './useMediaDevices'

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
 * `videoDevices`/`onSelectVideoDevice` são opcionais: sem eles, só a lista de
 * fundos aparece (comportamento original, preservado para quem já usa este
 * componente sem escolha de câmera).
 */
export function CameraBackgroundMenu({
  state,
  onClose,
  videoDevices = [],
  selectedVideoDeviceId = null,
  onSelectVideoDevice,
}: {
  state: CameraBackgroundState
  onClose: () => void
  videoDevices?: MediaDeviceOption[]
  selectedVideoDeviceId?: string | null
  onSelectVideoDevice?: (deviceId: string | null) => void
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
      {onSelectVideoDevice && (
        <>
          <p className="px-sm pb-1 pt-xs font-label text-[11px] uppercase tracking-wide text-white/45">Câmera</p>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selectedVideoDeviceId === null}
            onClick={() => onSelectVideoDevice(null)}
            className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
              selectedVideoDeviceId === null ? 'bg-primary/90 text-on-primary' : 'text-white/85 hover:bg-white/10'
            }`}
          >
            <Icon name="settings_suggest" className="text-[18px]" />
            <span className="min-w-0 flex-1 truncate">Padrão do sistema</span>
            {selectedVideoDeviceId === null && <Icon name="check" className="text-[16px]" />}
          </button>
          {videoDevices.map((device) => {
            const active = selectedVideoDeviceId === device.deviceId
            return (
              <button
                key={device.deviceId}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => onSelectVideoDevice(device.deviceId)}
                className={`flex w-full items-center gap-sm rounded-md px-sm py-xs text-left font-label text-label-sm transition-colors ${
                  active ? 'bg-primary/90 text-on-primary' : 'text-white/85 hover:bg-white/10'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{device.label}</span>
                {active && <Icon name="check" className="text-[16px]" />}
              </button>
            )
          })}
          <div className="my-1 h-px bg-white/10" />
          <p className="px-sm pb-1 pt-1 font-label text-[11px] uppercase tracking-wide text-white/45">
            Fundo virtual
          </p>
        </>
      )}
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

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/CameraBackgroundMenu.test.tsx`
Expected: PASS (7/7 — os 5 originais + os 2 novos).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/CameraBackgroundMenu.tsx apps/web/src/office/media/CameraBackgroundMenu.test.tsx
git commit -m "feat(escritório): CameraBackgroundMenu ganha seção de escolha de câmera"
```

---

### Task 11: `MediaBar` — botão de mic vira duplo, botão novo de saída de áudio

**Files:**
- Modify: `apps/web/src/office/media/MediaBar.tsx`
- Modify: `apps/web/src/office/media/MediaBar.test.tsx`

**Interfaces:**
- Consumes: `DeviceMenu` (Task 9); `CameraBackgroundMenu` com os novos props (Task 10); `MediaDevicesState` (Task 1); `OfficeMediaState.audioInputDeviceId`/`videoInputDeviceId`/`setAudioInputDevice`/`setVideoInputDevice` (Task 7).
- Produces: `MediaBar` ganha os props `devices: MediaDevicesState`, `audioOutputDeviceId: string | null`, `onSelectAudioOutput: (deviceId: string | null) => void`.

- [ ] **Step 1: Ler o arquivo de teste existente para confirmar como os props de `media`/`cameraBackground` são montados hoje**

Run: `sed -n '1,80p' apps/web/src/office/media/MediaBar.test.tsx`

Localize a função/objeto que monta os props padrão passados pro `<MediaBar>` nos testes (provavelmente algo como `function baseProps()`/`function renderBar()` construindo `media`, `broadcast`, `cameraBackground`). Você vai estender esse mesmo objeto com `devices` e `audioOutputDeviceId`/`onSelectAudioOutput` — sem isso, os testes existentes quebram por prop faltando (TypeScript) assim que o Step 3 adicionar os novos props obrigatórios ao componente.

- [ ] **Step 2: Adicionar os testes novos**

No objeto/função que monta os props padrão de `media` (identificado no Step 1), garanta que ele inclua `audioInputDeviceId: null`, `videoInputDeviceId: null`, `setAudioInputDevice: vi.fn()`, `setVideoInputDevice: vi.fn()` (mesmo padrão dos demais campos de `OfficeMediaState` já mockados ali). Adicione também, nos props passados ao `<MediaBar>`:

```tsx
devices={{ audioInputs: [], audioOutputs: [], videoInputs: [], supportsAudioOutputSelection: true }}
audioOutputDeviceId={null}
onSelectAudioOutput={vi.fn()}
```

E, no `describe('MediaBar', ...)`, adicione:

```tsx
  it('a setinha do microfone abre o menu de entradas de áudio; escolher uma chama setAudioInputDevice', () => {
    const media = { ...baseMediaState(), status: 'connected' as const, audioInputDeviceId: null }
    render(
      <MediaBar
        {...baseProps()}
        media={media}
        devices={{
          audioInputs: [{ deviceId: 'mic1', label: 'Mic USB' }],
          audioOutputs: [],
          videoInputs: [],
          supportsAudioOutputSelection: true,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Escolher microfone' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Mic USB/ }))

    expect(media.setAudioInputDevice).toHaveBeenCalledWith('mic1')
  })

  it('botão de saída de áudio some quando o navegador não suporta setSinkId', () => {
    render(
      <MediaBar
        {...baseProps()}
        devices={{ audioInputs: [], audioOutputs: [], videoInputs: [], supportsAudioOutputSelection: false }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Escolher saída de áudio' })).not.toBeInTheDocument()
  })

  it('botão de saída de áudio abre o menu de saídas; escolher uma chama onSelectAudioOutput', () => {
    const onSelectAudioOutput = vi.fn()
    render(
      <MediaBar
        {...baseProps()}
        onSelectAudioOutput={onSelectAudioOutput}
        devices={{
          audioInputs: [],
          audioOutputs: [{ deviceId: 'out1', label: 'Fone' }],
          videoInputs: [],
          supportsAudioOutputSelection: true,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Escolher saída de áudio' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fone/ }))

    expect(onSelectAudioOutput).toHaveBeenCalledWith('out1')
  })

  it('o menu de câmera recebe os dispositivos de vídeo e chama setVideoInputDevice ao escolher um', () => {
    const media = { ...baseMediaState(), status: 'connected' as const, videoInputDeviceId: null }
    render(
      <MediaBar
        {...baseProps()}
        media={media}
        devices={{
          audioInputs: [],
          audioOutputs: [],
          videoInputs: [{ deviceId: 'cam1', label: 'Webcam' }],
          supportsAudioOutputSelection: true,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Efeitos de fundo da câmera' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Webcam/ }))

    expect(media.setVideoInputDevice).toHaveBeenCalledWith('cam1')
  })
```

Ajuste os nomes `baseProps()`/`baseMediaState()` acima para os nomes reais identificados no Step 1 (podem ter nomes diferentes nesse arquivo).

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx`
Expected: FAIL (props/botões novos ainda não existem).

- [ ] **Step 4: Implementar em `MediaBar.tsx`**

Adicione os imports (junto aos demais):

```ts
import { DeviceMenu } from './DeviceMenu'
import type { MediaDevicesState } from './useMediaDevices'
```

No destructure de props da função `MediaBar` e no bloco de tipos correspondente, adicione:

```ts
  devices,
  audioOutputDeviceId,
  onSelectAudioOutput,
```

```ts
  devices: MediaDevicesState
  audioOutputDeviceId: string | null
  onSelectAudioOutput: (deviceId: string | null) => void
```

Logo após `const [showBackgroundMenu, setShowBackgroundMenu] = useState(false)`, adicione:

```ts
  const [showMicMenu, setShowMicMenu] = useState(false)
  const [showAudioOutputMenu, setShowAudioOutputMenu] = useState(false)
```

Substitua o botão único de microfone (bloco `<button ... aria-label={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'} ...>`) por:

```tsx
        <div className="relative flex items-center" data-mic-menu-root>
          <button
            type="button"
            aria-label={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
            title={micLocked ? 'Microfone desativado na área de silêncio' : mediaControlsDisabled ? mediaDisabledTitle : broadcast.speakerEnabled ? 'Silenciado enquanto o alto-falante está ligado' : media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
            className={`${
              !media.micEnabled && !micDisabled
                ? 'group relative flex h-10 w-10 items-center justify-center rounded-l-xl border border-error/60 bg-error/20 text-error transition-all'
                : `${toolButtonCls(media.micEnabled)} rounded-r-none`
            } disabled:cursor-not-allowed disabled:opacity-45 ${media.localSpeaking ? 'mic-speaking' : ''}`}
            disabled={micDisabled}
            onClick={() => void media.toggleMic()}
          >
            <Icon name={media.micEnabled ? 'mic' : 'mic_off'} className="text-[20px]" />
          </button>
          <button
            type="button"
            aria-label="Escolher microfone"
            title="Escolher microfone"
            aria-haspopup="menu"
            aria-expanded={showMicMenu}
            disabled={mediaControlsDisabled}
            onClick={() => setShowMicMenu((current) => !current)}
            className="flex h-10 w-5 items-center justify-center rounded-r-xl border border-l-0 border-white/5 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Icon name="expand_less" className="text-[16px]" />
          </button>
          {showMicMenu && (
            <DeviceMenu
              label="Escolher microfone"
              devices={devices.audioInputs}
              selectedDeviceId={media.audioInputDeviceId}
              onSelect={(id) => {
                void media.setAudioInputDevice(id)
                setShowMicMenu(false)
              }}
              onClose={() => setShowMicMenu(false)}
              rootAttr="data-mic-menu-root"
            />
          )}
        </div>
```

No bloco do menu de câmera, atualize a chamada de `<CameraBackgroundMenu>`:

```tsx
          {showBackgroundMenu && (
            <CameraBackgroundMenu
              state={cameraBackground}
              onClose={() => setShowBackgroundMenu(false)}
              videoDevices={devices.videoInputs}
              selectedVideoDeviceId={media.videoInputDeviceId}
              onSelectVideoDevice={(id) => void media.setVideoInputDevice(id)}
            />
          )}
```

Logo após o bloco `<div className="relative flex items-center" data-camera-bg-root>...</div>` (o split button de câmera inteiro), adicione o botão novo de saída de áudio:

```tsx
        {devices.supportsAudioOutputSelection && (
          <div className="relative flex items-center" data-audio-output-menu-root>
            <button
              type="button"
              aria-label="Escolher saída de áudio"
              title="Escolher saída de áudio"
              aria-haspopup="menu"
              aria-expanded={showAudioOutputMenu}
              onClick={() => setShowAudioOutputMenu((current) => !current)}
              className={toolButtonCls(showAudioOutputMenu)}
            >
              <Icon name="volume_up" className="text-[20px]" />
            </button>
            {showAudioOutputMenu && (
              <DeviceMenu
                label="Escolher saída de áudio"
                devices={devices.audioOutputs}
                selectedDeviceId={audioOutputDeviceId}
                onSelect={(id) => {
                  onSelectAudioOutput(id)
                  setShowAudioOutputMenu(false)
                }}
                onClose={() => setShowAudioOutputMenu(false)}
                rootAttr="data-audio-output-menu-root"
              />
            )}
          </div>
        )}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx`
Expected: PASS (arquivo inteiro — confirme que os testes pré-existentes continuam passando).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx
git commit -m "feat(escritório): MediaBar ganha seletor de microfone e de saída de áudio"
```

---

### Task 12: `OfficePage` — liga os novos dados da sessão na `MediaBar`

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `OfficeSessionValue.devices`/`audioOutputDeviceId`/`setAudioOutputDevice` (Task 8); `MediaBar` com os novos props (Task 11).

- [ ] **Step 1: Ler o mock de `useOfficeSession` usado em `OfficePage.test.tsx`**

Run: `grep -n "useOfficeSession\|mockReturnValue" apps/web/src/pages/OfficePage.test.tsx | head -20`

Localize onde o retorno de `useOfficeSession()` é montado para os testes (provavelmente uma função helper tipo `sessionValue()`/`baseSession()`). Adicione ali `devices: { audioInputs: [], audioOutputs: [], videoInputs: [], supportsAudioOutputSelection: true }`, `audioOutputDeviceId: null`, `setAudioOutputDevice: vi.fn()` — sem isso, o TypeScript vai reclamar de props faltando assim que o Step 3 adicionar os novos campos obrigatórios em `OfficeSessionValue` (já feito na Task 8) forem exigidos pelo componente.

- [ ] **Step 2: Adicionar o teste**

No `describe('OfficePage', ...)`, adicione:

```tsx
  it('repassa devices/audioOutputDeviceId/setAudioOutputDevice da sessão pra MediaBar', () => {
    const setAudioOutputDevice = vi.fn()
    mockUseOfficeSession({
      devices: {
        audioInputs: [],
        audioOutputs: [{ deviceId: 'out1', label: 'Fone' }],
        videoInputs: [],
        supportsAudioOutputSelection: true,
      },
      audioOutputDeviceId: 'out1',
      setAudioOutputDevice,
    })
    render(<OfficePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Escolher saída de áudio' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fone/ }))

    expect(setAudioOutputDevice).toHaveBeenCalledWith('out1')
  })
```

Ajuste `mockUseOfficeSession(...)` para o padrão real de mock desse arquivo (identificado no Step 1) — pode ser `vi.mocked(useOfficeSession).mockReturnValue({...})` diretamente em vez de uma função helper.

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: FAIL (o teste novo — `MediaBar` ainda não recebe esses props de `OfficePage`).

- [ ] **Step 4: Implementar em `OfficePage.tsx`**

No destructure de `useOfficeSession()` no topo de `OfficePage`, adicione:

```ts
    devices,
    audioOutputDeviceId,
    setAudioOutputDevice,
```

Na chamada de `<MediaBar ...>`, adicione:

```tsx
          devices={devices}
          audioOutputDeviceId={audioOutputDeviceId}
          onSelectAudioOutput={setAudioOutputDevice}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: PASS (arquivo inteiro).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(escritório): liga seleção de dispositivos da sessão na MediaBar"
```

---

### Task 13: Verificação final

**Files:** nenhum (só execução).

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 2: Suíte completa do workspace web**

Run: `pnpm --filter @legends/web test`
Expected: todos os testes passam (ignore o flake conhecido e já documentado do worker do Vitest/tinypool, se aparecer, contanto que não haja linha `FAIL`).

- [ ] **Step 3: Verificação manual (recomendado)**

Run: `pnpm dev`, entre no escritório com mais de um microfone/câmera/fone conectados na máquina (ou simule via `chrome://settings` fake devices), confirme:
- A setinha do mic abre a lista de entradas e troca sem cair a chamada.
- O menu de câmera lista as câmeras acima dos fundos virtuais.
- O botão de saída de áudio aparece (Chrome) e troca a saída tanto dentro de uma sala quanto no espaço aberto.
- Fechar e reabrir o escritório mantém a escolha.

---

## Self-Review

**Cobertura do spec:** as 3 escolhas (mic, câmera, saída) cobertas — persistência (Task 2), troca ao vivo via `switchActiveDevice` (Task 7), saída aplicada tanto em `RemoteAudio` (Task 4) quanto no áudio espacial via `MediaStreamAudioDestinationNode` (Tasks 5-6), UI seguindo o padrão de popover existente (Tasks 9-11), fonte de verdade (`OfficeSessionContext`) e consumidor (`OfficePage`) ligados (Tasks 8, 12). O risco do spec sobre o sentinela `'default'` do `switchActiveDevice` foi endereçado como um passo de verificação explícito na Task 7 (Step 5), não deixado como suposição.

**Placeholders:** nenhum "TBD"/"implementar depois" restante — os únicos pontos que pedem `grep`/leitura antes de editar (Tasks 11 e 12, sobre os helpers de prop dos testes existentes) são para confirmar a forma exata de um arquivo de teste grande antes de uma edição cirúrgica, não lacunas de design.

**Consistência de tipos:** `MediaDeviceOption`/`MediaDevicesState` (Task 1) usados sem alteração em `DeviceMenu` (Task 9), `CameraBackgroundMenu` (Task 10), `MediaBar` (Task 11) e `OfficeSessionContext` (Task 8). `applyAudioSink` (Task 3) é o único ponto que chama `setSinkId` e é reusado por `RemoteAudio` (Task 4) e `spatialAudio.ts` (Task 5) — nenhuma duplicação da lógica de feature-detect. `SpatialAudioGraph.setOutputDevice` (Task 5) é consumido exatamente uma vez, por `SpatialRemoteAudio` (Task 6).
