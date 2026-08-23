import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createEmptyMapDocumentV1, defaultCharacterFromSeed, type OfficeOccupant } from '@legends/shared'
import { OfficeBridge } from '../OfficeBridge'
import { useOfficeSocket } from '../useOfficeSocket'
import { useOfficeMedia, type OfficeMediaState } from '../media/useOfficeMedia'
import { useOfficeBroadcast, type OfficeBroadcastState } from '../media/useOfficeBroadcast'
import { useCameraBackground, type CameraBackgroundState } from '../media/useCameraBackground'
import { useMediaDevices } from '../media/useMediaDevices'
import { useRoomChat } from '../media/useRoomChat'
import { useRaisedHands } from '../media/useRaisedHands'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import { clearOfficeGuestSession, readOfficeGuestSession } from '../../lib/officeGuestSession'
import { OfficeSessionProvider, useOfficeSession } from './OfficeSessionContext'

vi.mock('../useOfficeSocket', () => ({ useOfficeSocket: vi.fn() }))
vi.mock('../media/useOfficeMedia', () => ({ useOfficeMedia: vi.fn() }))
vi.mock('../media/useOfficeBroadcast', () => ({ useOfficeBroadcast: vi.fn() }))
vi.mock('../media/useCameraBackground', () => ({ useCameraBackground: vi.fn() }))
vi.mock('../media/useMediaDevices', () => ({ useMediaDevices: vi.fn() }))
vi.mock('../media/useRoomChat', () => ({ useRoomChat: vi.fn() }))
vi.mock('../media/useRaisedHands', () => ({ useRaisedHands: vi.fn() }))
vi.mock('../media/RemoteAudio', () => ({
  RemoteAudio: ({ volume }: { volume?: number }) => <div data-testid="remote-audio" data-volume={volume ?? 1} />,
}))
vi.mock('../media/SpatialRemoteAudio', () => ({
  SpatialRemoteAudio: ({ volume }: { volume?: number }) => (
    <div data-testid="spatial-remote-audio" data-volume={volume ?? 1} />
  ),
}))
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/officeGuestSession', () => ({
  readOfficeGuestSession: vi.fn(() => null),
  saveOfficeGuestSession: vi.fn(),
  clearOfficeGuestSession: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function occupant(id: string): OfficeOccupant {
  return { userId: id, name: id, x: 0, y: 0, dir: 'down' } as OfficeOccupant
}

function mediaState(overrides: Partial<OfficeMediaState> = {}): OfficeMediaState {
  return {
    status: 'off',
    roomName: null,
    openRoom: null,
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
    localSpeaking: false,
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreenShare: vi.fn(),
    applyMicEnabled: vi.fn(),
    audioInputDeviceId: null,
    videoInputDeviceId: null,
    setAudioInputDevice: vi.fn(),
    setVideoInputDevice: vi.fn(),
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
      <button onClick={session.exitOffice}>encerrar</button>
    </div>
  )
}

function renderProvider(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <OfficeSessionProvider>
          <Harness />
        </OfficeSessionProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(useOfficeSocket).mockReturnValue({
    occupants: [],
    youId: null,
    connected: false,
    editorUserIds: [],
    karts: [],
    balls: [],
  })
  vi.mocked(useOfficeMedia).mockReturnValue(mediaState())
  vi.mocked(useOfficeBroadcast).mockReturnValue(broadcastState())
  vi.mocked(useCameraBackground).mockReturnValue({
    background: 'none',
    setBackground: vi.fn(),
    supported: true,
    error: false,
  } satisfies CameraBackgroundState)
  vi.mocked(useMediaDevices).mockReturnValue({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
    supportsAudioOutputSelection: true,
  })
  vi.mocked(useRoomChat).mockReturnValue({ messages: [], canSend: false, sendMessage: vi.fn(() => false) })
  vi.mocked(useRaisedHands).mockReturnValue({ queue: [], raised: false, canRaise: false, toggle: vi.fn() })
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', name: 'Ana', role: 'MEMBER' },
  } as unknown as ReturnType<typeof useAuth>)
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === '/office/map') {
      return {
        map: { id: 'map1', name: 'Escritório' },
        publication: { id: 'pub1' },
        document: createEmptyMapDocumentV1(),
        assets: [],
        rooms: [],
      }
    }
    if (path === '/office/config') return { broadcastEnabled: false }
    throw new Error(`apiFetch inesperado: ${String(path)}`)
  })
})

describe('OfficeSessionProvider', () => {
  it('começa idle, sem consultar mapa e com mapId nulo no socket', () => {
    renderProvider()
    expect(screen.getByTestId('status').textContent).toBe('idle')
    expect(apiFetch).not.toHaveBeenCalled()
    expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBeNull()
  })

  it('o fundo virtual da câmera mora na sessão, seguindo o track da mídia', () => {
    // No PiP a câmera religa com a OfficePage desmontada — o hook precisa
    // viver aqui para reaplicar o processor no track novo.
    renderProvider()
    expect(vi.mocked(useCameraBackground)).toHaveBeenLastCalledWith(null)
  })

  it('enterOffice ativa a sessão e conecta o socket ao mapId (estável entre publicações)', async () => {
    renderProvider()
    fireEvent.click(screen.getByText('entrar'))
    expect(screen.getByTestId('status').textContent).toBe('active')
    await waitFor(() => {
      expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBe('map1')
    })
  })

  it('leaveOffice volta a idle, zera o mapId e troca o bridge', async () => {
    renderProvider()
    fireEvent.click(screen.getByText('entrar'))
    await waitFor(() => {
      expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBe('map1')
    })
    const bridgeBefore = vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[0]

    fireEvent.click(screen.getByText('sair'))
    expect(screen.getByTestId('status').textContent).toBe('idle')
    const lastCall = vi.mocked(useOfficeSocket).mock.calls.at(-1)
    expect(lastCall?.[1]).toBeNull()
    expect(lastCall?.[0]).not.toBe(bridgeBefore)
  })

  it('exitOffice avisa o socket que a saída foi intencional antes de trocar o bridge', async () => {
    renderProvider()
    fireEvent.click(screen.getByText('entrar'))
    await waitFor(() => {
      expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBe('map1')
    })
    const bridgeBefore = vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[0] as OfficeBridge
    const sent: unknown[] = []
    bridgeBefore.onClientMessage((message) => sent.push(message))

    fireEvent.click(screen.getByText('encerrar'))

    expect(sent).toContainEqual({ type: 'leave-office' })
  })

  it('logout encerra a sessão', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = () => (
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <OfficeSessionProvider>
            <Harness />
          </OfficeSessionProvider>
        </QueryClientProvider>
      </MemoryRouter>
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

  it('map-decor-updated (publicação de decoração) refaz o fetch mas mantém o mesmo mapId nos hooks (sem derrubar LiveKit/WS)', async () => {
    renderProvider()
    fireEvent.click(screen.getByText('entrar'))
    await waitFor(() => {
      expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBe('map1')
    })
    const bridge = vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[0] as OfficeBridge
    const mapFetchesBefore = vi
      .mocked(apiFetch)
      .mock.calls.filter(([path]) => path === '/office/map').length

    // Publicar uma decoração no mundo real muda `publication.id` mas NÃO
    // `map.id` — é exatamente esse cenário que causava o bug (reconexão de
    // LiveKit/WS por causa de uma chave que não deveria ter mudado).
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/office/map') {
        return {
          map: { id: 'map1', name: 'Escritório' },
          publication: { id: 'pub2' },
          document: createEmptyMapDocumentV1(),
          assets: [],
          rooms: [],
        }
      }
      if (path === '/office/config') return { broadcastEnabled: false }
      throw new Error(`apiFetch inesperado: ${String(path)}`)
    })

    act(() => {
      bridge.emitServerMessage({ type: 'map-decor-updated' } as never)
    })

    await waitFor(() => {
      const mapFetchesAfter = vi
        .mocked(apiFetch)
        .mock.calls.filter(([path]) => path === '/office/map').length
      expect(mapFetchesAfter).toBeGreaterThan(mapFetchesBefore)
    })
    // Mesmo depois do refetch (novo publication.id), o mapId passado ao
    // socket e à mídia continua 'map1' — nenhuma reconexão é sinalizada.
    expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBe('map1')
    expect(vi.mocked(useOfficeMedia).mock.calls.at(-1)?.[4]).toBe('map1')
  })

  it('map-decor-updated chegando com edição suja adia o refetch e dispara quando a edição deixa de estar suja', async () => {
    // Reproduz a corrida real: o broadcast do PRÓPRIO Salvar pode chegar
    // ANTES do React propagar `dirty: false` até o bridge — sem isto, o
    // refetch some pra sempre e a mobília recém-salva fica com a "moldura"
    // de edição pendente até um F5.
    renderProvider()
    fireEvent.click(screen.getByText('entrar'))
    await waitFor(() => {
      expect(vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[1]).toBe('map1')
    })
    const bridge = vi.mocked(useOfficeSocket).mock.calls.at(-1)?.[0] as OfficeBridge

    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/office/map') {
        return {
          map: { id: 'map1', name: 'Escritório' },
          publication: { id: 'pub2' },
          document: createEmptyMapDocumentV1(),
          assets: [],
          rooms: [],
        }
      }
      if (path === '/office/config') return { broadcastEnabled: false }
      throw new Error(`apiFetch inesperado: ${String(path)}`)
    })

    bridge.setEditingDirty(true)
    const mapFetchesBefore = vi.mocked(apiFetch).mock.calls.filter(([path]) => path === '/office/map').length

    act(() => {
      bridge.emitServerMessage({ type: 'map-decor-updated' } as never)
    })
    // Enquanto ainda está "sujo", o refetch não dispara.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === '/office/map').length).toBe(mapFetchesBefore)

    // `save()` bem-sucedido chama isto — dispara o refetch que ficou pendente.
    act(() => {
      bridge.setEditingDirty(false)
    })
    await waitFor(() => {
      const mapFetchesAfter = vi.mocked(apiFetch).mock.calls.filter(([path]) => path === '/office/map').length
      expect(mapFetchesAfter).toBeGreaterThan(mapFetchesBefore)
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

  it('desliga o broadcast em sessões já abertas quando o interruptor do admin muda', async () => {
    vi.mocked(useOfficeSocket).mockReturnValue({
      occupants: [occupant('ana')],
      youId: 'ana',
      connected: true,
      editorUserIds: [],
      karts: [],
      balls: [],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['office', 'config'], { broadcastEnabled: true })

    renderProvider(client)
    fireEvent.click(screen.getByText('entrar'))

    await waitFor(() => {
      expect(vi.mocked(useOfficeBroadcast)).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      )
    })

    act(() => {
      client.setQueryData(['office', 'config'], { broadcastEnabled: false })
    })

    await waitFor(() => {
      expect(vi.mocked(useOfficeBroadcast)).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false }),
      )
    })
  })

  it('renderiza os áudios remotos (mic + tela) e do broadcast no provider', () => {
    vi.mocked(useOfficeMedia).mockReturnValue(
      mediaState({
        remotes: [
          {
            userId: 'u2',
            name: 'Bia',
            audioTrack: {} as never,
            cameraTrack: null,
            screenTrack: null,
            screenAudioTrack: {} as never,
            micOpen: false,
            speaking: false,
          },
        ],
      }),
    )
    vi.mocked(useOfficeBroadcast).mockReturnValue(
      broadcastState({ broadcastTracks: [{} as never] }),
    )
    renderProvider()
    // mic remoto + áudio da tela remota + track de broadcast
    expect(screen.getAllByTestId('remote-audio')).toHaveLength(3)
  })

  it('no espaço aberto, com sua posição e a do remoto conhecidas, usa SpatialRemoteAudio para o áudio do mic', () => {
    vi.mocked(useOfficeSocket).mockReturnValue({
      occupants: [occupant('you'), occupant('ana')],
      youId: 'you',
      connected: true,
      editorUserIds: [],
      karts: [],
      balls: [],
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
      editorUserIds: [],
      karts: [],
      balls: [],
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
        <MemoryRouter>
          <OfficeSessionProvider>
            <OutputHarness />
          </OfficeSessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('output-device').textContent).toBe('default')
    fireEvent.click(screen.getByText('trocar saída'))
    expect(screen.getByTestId('output-device').textContent).toBe('out-2')
    expect(localStorage.getItem('office:preferred-audio-output')).toBe('out-2')
  })

  it('volume remoto salvo no localStorage é aplicado ao áudio do usuário', () => {
    localStorage.setItem('office:remote-user-volumes', JSON.stringify({ ana: 35 }))
    vi.mocked(useOfficeSocket).mockReturnValue({
      occupants: [occupant('you'), occupant('ana')],
      youId: 'you',
      connected: true,
      editorUserIds: [],
      karts: [],
      balls: [],
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
            screenAudioTrack: {} as never,
            micOpen: true,
            speaking: false,
          },
        ],
      }),
    )

    renderProvider()

    expect(screen.getAllByTestId('remote-audio').map((el) => el.dataset.volume)).toEqual(['0.35', '0.35'])
  })
})

describe('sessão de convidado — expiração', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>)
    mockNavigate.mockClear()
    vi.mocked(clearOfficeGuestSession).mockClear()
  })

  it('encerra a sessão e navega para a página de agradecimento quando o convite expira', () => {
    vi.useFakeTimers()
    try {
      const now = Date.now()
      vi.mocked(readOfficeGuestSession).mockReturnValue({
        token: 'guest-token',
        expiresAt: new Date(now + 1000).toISOString(),
        guest: {
          id: 'guest:1',
          name: 'Visitante',
          presetId: 'p1',
          avatarSeed: 's1',
          avatarOptions: defaultCharacterFromSeed('s1'),
        },
      })

      render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <OfficeSessionProvider>
              <Harness />
            </OfficeSessionProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      )

      expect(mockNavigate).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(clearOfficeGuestSession).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/convidado/obrigado', { replace: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('não agenda nada quando não há sessão de convidado', () => {
    vi.useFakeTimers()
    try {
      vi.mocked(readOfficeGuestSession).mockReturnValue(null)

      render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <OfficeSessionProvider>
              <Harness />
            </OfficeSessionProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      )

      act(() => {
        vi.advanceTimersByTime(60_000)
      })

      expect(mockNavigate).not.toHaveBeenCalled()
      expect(clearOfficeGuestSession).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
