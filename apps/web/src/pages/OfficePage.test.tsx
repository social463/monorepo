import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { forwardRef, useEffect, useImperativeHandle, type ReactNode } from 'react'
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createEmptyMapDocumentV1,
  type ActiveOfficeMapDTO,
  type OfficeDeskDTO,
  type OfficeOccupant,
} from '@legends/shared'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import { OfficeBridge } from '../office/OfficeBridge'
import type { OfficeMediaState } from '../office/media/useOfficeMedia'
import type { OfficeBroadcastState } from '../office/media/useOfficeBroadcast'
import type { OfficeSessionValue } from '../office/session/OfficeSessionContext'
import type { InviteToastItem } from '../office/notifications/useOfficeInviteToasts'

// `OfficePage` lê `useAuth()` (Task "proteger estruturas do admin") pra montar
// o ator (`{ id, isAdmin }`) passado a `useOfficeMapEditing` — mesmo padrão de
// mock usado em `HomePage.test.tsx`/`AppLayout.test.tsx`. Papel LEGEND
// (não-admin) por padrão; a proteção admin-vs-comum já tem cobertura própria
// em `useOfficeMapEditing.test.ts`, não precisa ser reexercitada aqui.
vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: {
      id: 'u1',
      name: 'Test User',
      role: 'LEGEND',
      position: null,
      squad: null,
      photoUrl: null,
      avatarStyle: null,
      avatarSeed: null,
      avatarOptions: null,
      active: true,
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}))

const { apiFetchMock, useOfficeSessionMock, navigateMock, startDeskReminderPlacementMock, cancelDeskReminderPlacementMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  useOfficeSessionMock: vi.fn(),
  navigateMock: vi.fn(),
  startDeskReminderPlacementMock: vi.fn(),
  cancelDeskReminderPlacementMock: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

// Cena fake mínima (Task C6) — só o suficiente pra `useOfficeMapEditing.enter()`
// não estourar ao chamar `getScene()?.setEditing(...)`/`setEditMode(...)`.
const fakeSceneMock = {
  setEditing: vi.fn(),
  setEditMode: vi.fn(),
  discardLocalEdits: vi.fn(),
  setPublishedAreaOverlays: vi.fn(),
}

/**
 * Menor zoom que a cena reporta (`onMinZoomChange`) — no real depende do
 * tamanho do mapa e da janela. O padrão imita o mapa grande da EMR (80x60
 * tiles), que é o caso em que dá pra afastar bem além dos 60% que o controle
 * já cravou um dia.
 */
let canvasMinZoom = 0.47

vi.mock('../office/OfficeCanvas', () => ({
  OfficeCanvas: forwardRef<
    unknown,
    { zoom: number; focusUserId?: string | null; onMinZoomChange?: (minZoom: number) => void }
  >(function OfficeCanvasMock({ zoom, focusUserId, onMinZoomChange }, ref) {
    useEffect(() => {
      onMinZoomChange?.(canvasMinZoom)
      // Só no mount, como a cena faz no boot: o mínimo só muda quando a
      // janela muda de tamanho.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    // Posição fixa (não-nula) pra qualquer userId: os testes de balão de
    // câmera/indicador de tela dependem de `useCharacterScreenPositions`
    // resolver uma posição real — `null` simularia "fora do viewport", que
    // não é o cenário testado aqui.
    useImperativeHandle(
      ref,
      () => ({
        getScreenPosition: () => ({ x: 100, y: 100, zoom: 1 }),
        getScene: () => fakeSceneMock,
        zoomAtClientPoint: () => {},
        startDeskReminderPlacement: startDeskReminderPlacementMock,
        cancelDeskReminderPlacement: cancelDeskReminderPlacementMock,
      }),
      [],
    )
    return <div data-focus-user-id={focusUserId ?? ''} data-testid="office-canvas">zoom {zoom}</div>
  }),
}))

vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

vi.mock('../office/session/OfficeSessionContext', () => ({
  useOfficeSession: (...args: unknown[]) => useOfficeSessionMock(...args),
}))

// `useCharacterScreenPositions` (usado por balões de câmera e pelo indicador
// de tela) resolve posição via `requestAnimationFrame` — real no browser,
// mas assíncrono demais pra um teste síncrono. Stub que enfileira callbacks
// (em vez de invocá-los na hora, o que causaria recursão infinita: `tick`
// agenda o próprio próximo frame) — `flushScreenPositions()` dispara os
// callbacks pendentes manualmente.
let rafCallbacks: FrameRequestCallback[] = []
function flushScreenPositions() {
  const callbacks = rafCallbacks
  rafCallbacks = []
  callbacks.forEach((cb) => cb(0))
}

const occupants: OfficeOccupant[] = [
  {
    userId: 'ana',
    name: 'Ana Silva',
    // PIXEL — centro do tile (11,14). O occupant fala pixel desde o movimento
    // livre; o kart e a bola ao lado também.
    x: 368,
    y: 464,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
  },
  {
    userId: 'bruno',
    name: 'Bruno Costa',
    // PIXEL — centro do tile (12,14), ao lado da Ana.
    x: 400,
    y: 464,
    dir: 'up',
    avatarSeed: null,
    avatarOptions: null,
  },
]

const activeMap: ActiveOfficeMapDTO = {
  map: { id: 'map-1', name: 'Escritório' },
  publication: {
    id: 'publication-1',
    version: 1,
    schemaVersion: '1.0.0',
    createdAt: new Date(0).toISOString(),
    createdBy: null,
    active: true,
  },
  decorRevision: 0,
  document: createEmptyMapDocumentV1({ width: 25, height: 18 }),
  assets: [],
  rooms: [],
  desks: [],
  deskReminders: [],
}

const meetingRoomMap: ActiveOfficeMapDTO = {
  ...activeMap,
  document: {
    ...activeMap.document,
    objects: [
      ...activeMap.document.objects,
      {
        id: 'room-1',
        layerKey: 'meeting-rooms',
        type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 320, y: 416, width: 96, height: 96 },
        properties: {
          externalKey: 'sala-1',
          name: 'Sala de Reunião',
          status: 'OPEN',
          voiceEnabled: true,
          accessPolicy: 'OPEN',
        },
      },
    ],
  },
  rooms: [
    {
      id: 'room-sala-1',
      name: 'Sala de Reunião',
      externalKey: 'sala-1',
      status: 'OPEN',
      capacity: null,
      voiceEnabled: true,
      accessPolicy: 'OPEN',
      allowedUsers: [],
    },
  ],
  desks: [],
}

/** Track falso: só precisa responder a attach/detach, chamado no efeito do VideoTile. */
function fakeVideoTrack(): RemoteVideoTrack {
  return { attach: () => {}, detach: () => {} } as unknown as RemoteVideoTrack
}

function mediaState(overrides: Partial<OfficeMediaState> = {}): OfficeMediaState {
  return {
    status: 'connected',
    roomName: 'office-open',
    openRoom: 'office-open',
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
    audioInputDeviceId: null,
    videoInputDeviceId: null,
    toggleMic: vi.fn(async () => {}),
    toggleCamera: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async () => {}),
    applyMicEnabled: vi.fn(async () => {}),
    setAudioInputDevice: vi.fn(async () => {}),
    setVideoInputDevice: vi.fn(async () => {}),
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
    toggleSpeaker: vi.fn(async () => {}),
    ...overrides,
  }
}

let interactionsMock: Record<string, unknown>
vi.mock('../office/useOfficeInteractions', () => ({
  useOfficeInteractions: () => interactionsMock,
}))

let inviteToastsMock: { queue: InviteToastItem[]; dismiss: (id: string) => void } = { queue: [], dismiss: vi.fn() }
vi.mock('../office/notifications/useOfficeInviteToasts', () => ({
  useOfficeInviteToasts: () => inviteToastsMock,
}))

import { OfficePage } from './OfficePage'

function sessionValue(overrides: Partial<OfficeSessionValue> = {}): OfficeSessionValue {
  return {
    status: 'active',
    enterOffice: vi.fn(),
    leaveOffice: vi.fn(),
    exitOffice: vi.fn(),
    bridge: new OfficeBridge(),
    activeMap,
    activeMapLoading: false,
    occupants,
    karts: [],
    balls: [],
    youId: 'ana',
    connected: true,
    editorUserIds: [],
    isGuest: false,
    media: mediaState(),
    broadcast: broadcastState(),
    canBroadcast: false,
    cameraBackground: {
      background: 'none',
      setBackground: vi.fn(),
      supported: true,
      error: false,
    },
    roomChat: {
      messages: [],
      canSend: true,
      sendMessage: vi.fn(() => true),
    },
    raisedHands: {
      queue: [],
      raised: false,
      // Realista pro caso padrão do fixture (fora de sala/zona privada).
      canRaise: false,
      toggle: vi.fn(),
    },
    roomLock: {
      locked: false,
      lockedRoomIds: [],
      // Mesmo motivo do `canRaise`: o fixture nasce fora de sala de reunião.
      canLock: false,
      toggle: vi.fn(),
      knocks: [],
      respond: vi.fn(),
    },
    roomModeration: {
      managers: [],
      currentManager: null,
      // Como `canLock`: o fixture nasce fora de sala de reunião.
      canRemove: false,
      remove: vi.fn(),
      removedFrom: null,
    },
    roomAudio: {
      track: null,
      isMine: false,
      // Como o `canLock`: o fixture nasce fora de sala de reunião.
      canStart: false,
      start: vi.fn(),
      stop: vi.fn(),
      setPaused: vi.fn(),
      advanceItem: vi.fn(),
      error: null,
      clearError: vi.fn(),
    },
    setUserStatus: vi.fn(),
    setCharacterName: vi.fn(),
    leaveGuestSession: vi.fn(),
    devices: {
      audioInputs: [],
      audioOutputs: [],
      videoInputs: [],
      supportsAudioOutputSelection: true,
    },
    audioOutputDeviceId: null,
    setAudioOutputDevice: vi.fn(),
    remoteUserVolumes: {
      getUserVolume: vi.fn(() => 100),
      setUserVolume: vi.fn(),
    },
    ...overrides,
  }
}

function renderPage(overrides: Partial<OfficeSessionValue> = {}) {
  useOfficeSessionMock.mockReturnValue(sessionValue(overrides))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const makeUi = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OfficePage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const result = render(makeUi())
  return {
    ...result,
    rerenderWithSession: (nextOverrides: Partial<OfficeSessionValue>) => {
      useOfficeSessionMock.mockReturnValue(sessionValue(nextOverrides))
      result.rerender(makeUi())
    },
  }
}

describe('OfficePage', () => {
  beforeEach(() => {
    canvasMinZoom = 0.47
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    navigateMock.mockClear()
    fakeSceneMock.setEditing.mockClear()
    fakeSceneMock.setEditMode.mockClear()
    startDeskReminderPlacementMock.mockReset()
    startDeskReminderPlacementMock.mockReturnValue(true)
    cancelDeskReminderPlacementMock.mockReset()
    apiFetchMock.mockReset()
    apiFetchMock.mockImplementation((path: string) =>
      path === '/users' ? Promise.resolve({ users: [] }) : Promise.reject(new Error(`apiFetch inesperado: ${path}`)),
    )
    useOfficeSessionMock.mockReset()
    interactionsMock = {
      desks: [],
      selected: null,
      selectedEntry: null,
      selectedDesk: null,
      selectedDeskReminder: null,
      deskReminders: [],
      incomingCall: null,
      toast: null,
      openCard: () => {},
      closeCard: () => {},
      closeDeskCard: () => {},
      closeDeskReminder: () => {},
      claimSelectedDesk: () => {},
      releaseSelectedDesk: () => {},
      addDeskReminder: vi.fn(),
      removeDeskReminder: vi.fn(),
      openDeskReminder: vi.fn(),
      call: () => {},
      follow: () => {},
      viewProfile: () => {},
      acceptCall: () => {},
      refuseCall: () => {},
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it('mostra o mapa e quem está no escritório', () => {
    renderPage()

    expect(screen.getByTestId('office-canvas')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir pessoas online' }))
    expect(screen.getAllByText(/Ana Silva/).length).toBeGreaterThan(0)
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
    expect(screen.getAllByText(/2 pessoas no escritório/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Ativar microfone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compartilhar tela' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /alto-falante/i })).not.toBeInTheDocument()
  })

  it('salva lembrete só depois de escolher a posição livre do presente na mesa', async () => {
    const desk: OfficeDeskDTO = {
      id: 'desk-1',
      name: 'Mesa 1',
      externalKey: 'mesa-1',
      claimedBy: { id: 'bia', name: 'Bia Souza' },
    }
    const addDeskReminder = vi.fn()
    interactionsMock = {
      ...interactionsMock,
      desks: [desk],
      selectedDesk: desk,
      closeDeskCard: vi.fn(),
      addDeskReminder,
    }
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/users') return Promise.resolve({ users: [] })
      if (path === '/office/desks/desk-1/reminders') {
        return Promise.resolve({
          reminder: {
            id: 'reminder-1',
            deskId: 'desk-1',
            deskExternalKey: 'mesa-1',
            giftPosition: { x: 0.37, y: 0.62 },
            sender: { id: 'ana', name: 'Ana Silva' },
            recipientId: 'bia',
            createdAt: '2026-07-31T00:00:00.000Z',
          },
        })
      }
      return Promise.reject(new Error(`apiFetch inesperado: ${path}`))
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Deixar lembrete' }))
    fireEvent.change(screen.getByPlaceholderText('Escreva uma mensagem para a pessoa...'), {
      target: { value: 'Passando para agradecer.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar lembrete' }))

    expect(startDeskReminderPlacementMock).toHaveBeenCalledWith('mesa-1', expect.any(Function))
    expect(apiFetchMock).not.toHaveBeenCalledWith('/office/desks/desk-1/reminders', expect.anything())
    expect(screen.getByText(/Clique na mesa de Bia Souza para salvar/)).toBeInTheDocument()

    act(() => {
      startDeskReminderPlacementMock.mock.calls[0]?.[1]({ x: 0.37, y: 0.62 })
    })

    await waitFor(() => expect(addDeskReminder).toHaveBeenCalledWith(expect.objectContaining({ id: 'reminder-1' })))
    expect(apiFetchMock).toHaveBeenCalledWith('/office/desks/desk-1/reminders', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Passando para agradecer.',
        giftPosition: { x: 0.37, y: 0.62 },
      }),
    })
  })

  it('usa o alias só no badge do personagem no mapa', () => {
    const aliasedOccupants = occupants.map((o) =>
      o.userId === 'bruno' ? { ...o, characterName: 'Bug Hunter' } : o,
    )
    interactionsMock = { ...interactionsMock, selected: aliasedOccupants[1] }

    renderPage({ occupants: aliasedOccupants })
    act(() => flushScreenPositions())

    expect(screen.getByRole('figure', { name: 'Bug Hunter' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Ações para Bruno Costa' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir pessoas online' }))
    expect(screen.getAllByText('Bruno Costa')).toHaveLength(2)
    expect(screen.queryByText('Bug Hunter', { selector: 'p' })).not.toBeInTheDocument()
  })

  it('envia emoji da barra como reaction para preservar o visual próprio', () => {
    const bridge = new OfficeBridge()
    const onClientMessage = vi.fn()
    bridge.onClientMessage(onClientMessage)
    renderPage({ bridge })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reagir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reagir com 👋' }))

    expect(onClientMessage).toHaveBeenCalledWith({
      type: 'nearby-message',
      text: '👋',
      kind: 'reaction',
    })
  })

  it('mostra a ação contextual e monta no kart próximo com E', () => {
    const bridge = new OfficeBridge()
    const onClientMessage = vi.fn()
    bridge.onClientMessage(onClientMessage)
    renderPage({
      bridge,
      karts: [{ id: 'kart-1', x: 400, y: 464, dir: 'up' }],
    })

    expect(screen.getByText(/para dirigir/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'e' })
    expect(onClientMessage).toHaveBeenCalledWith({ type: 'ride-kart' })
  })

  it('mostra os três gestos da bola ao alcance e envia cada um', () => {
    const bridge = new OfficeBridge()
    const onClientMessage = vi.fn()
    bridge.onClientMessage(onClientMessage)
    // Ana está em (11,14); a bola encostada nela.
    renderPage({ bridge, balls: [{ id: 'ball-1', x: 400, y: 464, vx: 0, vy: 0 }] })

    fireEvent.click(screen.getByRole('button', { name: /tocar/ }))
    expect(onClientMessage).toHaveBeenCalledWith({ type: 'kick-ball', power: 'touch' })

    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyUp(window, { key: 'x' })
    expect(onClientMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'kick-ball', power: 'kick' }))

    fireEvent.click(screen.getByRole('button', { name: /por cima/ }))
    expect(onClientMessage).toHaveBeenCalledWith({ type: 'kick-ball', power: 'lob' })
  })

  // A bola tem teclas próprias (Z/X/C) justamente para não disputar a barra:
  // perto dela, o push-to-talk continua sendo push-to-talk.
  it('perto da bola, Espaço continua abrindo o microfone', () => {
    const bridge = new OfficeBridge()
    const onClientMessage = vi.fn()
    bridge.onClientMessage(onClientMessage)
    const applyMicEnabled = vi.fn(async () => {})
    renderPage({
      bridge,
      balls: [{ id: 'ball-1', x: 400, y: 464, vx: 0, vy: 0 }],
      media: mediaState({ applyMicEnabled }),
    })

    fireEvent.keyDown(window, { code: 'Space' })

    expect(applyMicEnabled).toHaveBeenCalledWith(true)
    expect(onClientMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'kick-ball' }),
    )
  })

  it('fora da grade não usa reação flutuante em HTML', () => {
    const bridge = new OfficeBridge()
    const { container } = renderPage({ activeMap, bridge })

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })
    })

    expect(container.querySelectorAll('[data-office-float-reaction]')).toHaveLength(0)
  })

  it('não mostra reação flutuante dentro da sala quando a grade está fechada', () => {
    const bridge = new OfficeBridge()
    const { container } = renderPage({ activeMap: meetingRoomMap, bridge })

    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })
    })
    expect(container.querySelectorAll('[data-office-float-reaction]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    expect(container.querySelectorAll('[data-office-float-reaction]')).toHaveLength(0)
  })

  it('mostra reação flutuante quando a grade está aberta', () => {
    const bridge = new OfficeBridge()
    const { container } = renderPage({ activeMap: meetingRoomMap, bridge })

    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    act(() => {
      bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })
    })

    expect(container.querySelectorAll('[data-office-float-reaction]')).toHaveLength(1)
    expect(screen.getByText('👋')).toBeInTheDocument()
  })

  it('clicar no chip de identidade da MediaBar navega para a edição de personagem', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Seu status e personagem' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar personagem' }))
    expect(navigateMock).toHaveBeenCalledWith('/personagem')
  })

  it('atalho Enter abre o Chat por perto quando o foco não está em campo de texto', () => {
    renderPage()

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.getByText('Chat por perto')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Mensagem...')).toHaveFocus()
  })

  it('atalho Enter não interfere quando o foco já está em um input', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir pessoas online' }))
    const search = screen.getByPlaceholderText('Buscar pessoas')
    search.focus()

    fireEvent.keyDown(search, { key: 'Enter' })

    expect(screen.queryByText('Chat por perto')).not.toBeInTheDocument()
  })

  // Espaço é "segurar pra falar" (`applyMicEnabled`), NÃO alterna o mic — quem
  // alterna é o M (`toggleMic`), coberto logo abaixo.
  it('atalho Espaço abre o mic enquanto pressionado e fecha ao soltar', () => {
    const applyMicEnabled = vi.fn(async () => {})
    renderPage({ media: mediaState({ applyMicEnabled }) })

    fireEvent.keyDown(window, { code: 'Space' })
    expect(applyMicEnabled).toHaveBeenNthCalledWith(1, true)

    fireEvent.keyUp(window, { code: 'Space' })
    expect(applyMicEnabled).toHaveBeenNthCalledWith(2, false)
    expect(applyMicEnabled).toHaveBeenCalledTimes(2)
  })

  it('atalho Espaço fecha o mic no blur da janela (alt-tab segurando a barra)', () => {
    const applyMicEnabled = vi.fn(async () => {})
    renderPage({ media: mediaState({ applyMicEnabled }) })

    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.blur(window)

    expect(applyMicEnabled).toHaveBeenNthCalledWith(2, false)
  })

  it('atalho Espaço não faz nada com foco em um campo de texto', () => {
    const applyMicEnabled = vi.fn(async () => {})
    renderPage({ media: mediaState({ applyMicEnabled }) })
    fireEvent.click(screen.getByRole('button', { name: 'Expandir pessoas online' }))
    const search = screen.getByPlaceholderText('Buscar pessoas')
    search.focus()

    fireEvent.keyDown(search, { code: 'Space' })

    expect(applyMicEnabled).not.toHaveBeenCalled()
  })

  it('atalho Espaço não faz nada sem áudio conectado', () => {
    const applyMicEnabled = vi.fn(async () => {})
    renderPage({ media: mediaState({ applyMicEnabled, status: 'connecting' }) })

    fireEvent.keyDown(window, { code: 'Space' })

    expect(applyMicEnabled).not.toHaveBeenCalled()
  })

  it('atalho M liga/desliga o microfone', () => {
    const toggleMic = vi.fn(async () => {})
    renderPage({ media: mediaState({ toggleMic }) })

    fireEvent.keyDown(window, { key: 'm' })

    expect(toggleMic).toHaveBeenCalledTimes(1)
  })

  it('atalho M não faz nada sem áudio conectado', () => {
    const toggleMic = vi.fn(async () => {})
    renderPage({ media: mediaState({ toggleMic, status: 'connecting' }) })

    fireEvent.keyDown(window, { key: 'm' })

    expect(toggleMic).not.toHaveBeenCalled()
  })

  it('atalho L tranca/destranca a sala quando disponível', () => {
    const toggle = vi.fn()
    renderPage({ roomLock: { locked: false, lockedRoomIds: [], canLock: true, toggle, knocks: [], respond: vi.fn() } })

    fireEvent.keyDown(window, { key: 'l' })

    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('atalho L não faz nada fora de uma sala travável', () => {
    const toggle = vi.fn()
    renderPage({ roomLock: { locked: false, lockedRoomIds: [], canLock: false, toggle, knocks: [], respond: vi.fn() } })

    fireEvent.keyDown(window, { key: 'l' })

    expect(toggle).not.toHaveBeenCalled()
  })

  it('atalho H levanta/abaixa a mão quando disponível', () => {
    const toggle = vi.fn()
    renderPage({ raisedHands: { queue: [], raised: false, canRaise: true, toggle } })

    fireEvent.keyDown(window, { key: 'h' })

    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('atalho H não faz nada fora de uma zona que permite levantar a mão', () => {
    const toggle = vi.fn()
    renderPage({ raisedHands: { queue: [], raised: false, canRaise: false, toggle } })

    fireEvent.keyDown(window, { key: 'h' })

    expect(toggle).not.toHaveBeenCalled()
  })

  it('atalho H não interfere quando o foco está em um input', () => {
    const toggle = vi.fn()
    renderPage({ raisedHands: { queue: [], raised: false, canRaise: true, toggle } })
    fireEvent.click(screen.getByRole('button', { name: 'Expandir pessoas online' }))
    const search = screen.getByPlaceholderText('Buscar pessoas')
    search.focus()

    fireEvent.keyDown(search, { key: 'h' })

    expect(toggle).not.toHaveBeenCalled()
  })

  it('abre Configurações pelo rail e mostra a aba de atalhos', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }))

    expect(screen.getByRole('heading', { name: 'Configurações' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Atalhos' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Mover personagem')).toBeInTheDocument()
    expect(screen.getByText('Levantar ou abaixar a mão')).toBeInTheDocument()
  })

  it('enquanto a sessão não está ativa (ou o mapa está carregando), mostra o placeholder', () => {
    renderPage({ status: 'idle' })
    expect(screen.getByText('Carregando mapa do escritório…')).toBeInTheDocument()
    expect(screen.queryByTestId('office-canvas')).not.toBeInTheDocument()
  })

  it('sem mapa ativo, mostra o aviso de nenhum mapa publicado', () => {
    renderPage({ activeMap: null })
    expect(
      screen.getByText('Nenhum mapa ativo está disponível. Peça a um administrador para publicar um mapa.'),
    ).toBeInTheDocument()
  })

  it('chama enterOffice ao montar', () => {
    const enterOffice = vi.fn()
    renderPage({ enterOffice })
    expect(enterOffice).toHaveBeenCalledOnce()
  })

  it('permite recolher e expandir a sidebar de pessoas online', () => {
    renderPage()

    expect(screen.queryByPlaceholderText('Buscar pessoas')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir pessoas online' }))
    expect(screen.getByPlaceholderText('Buscar pessoas')).toBeInTheDocument()
    expect(screen.getByText(/Online \(\d+\)/)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Recolher pessoas online' })[0])
    expect(screen.queryByPlaceholderText('Buscar pessoas')).not.toBeInTheDocument()
  })

  it('permite controlar o zoom pelo scroll do mouse', () => {
    renderPage()

    // Zoom padrão mais afastado (estilo Gather) — 70%, não mais 100%.
    expect(screen.getByText('70%')).toBeInTheDocument()

    fireEvent.wheel(screen.getByTestId('office-canvas').parentElement!, { deltaY: -100 })
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByTestId('office-canvas')).toHaveTextContent('zoom 0.8')

    fireEvent.wheel(screen.getByTestId('office-canvas').parentElement!, { deltaY: 100 })
    expect(screen.getByText('70%')).toBeInTheDocument()

    fireEvent.wheel(screen.getByTestId('office-canvas').parentElement!, { deltaY: 100 })
    expect(screen.getByText('60%')).toBeInTheDocument()

    // Afastar não para nos 60%: o limite é o que a cena reporta, ou seja o
    // ponto em que o mapa cabe inteiro na tela.
    for (let i = 0; i < 10; i += 1) {
      fireEvent.wheel(screen.getByTestId('office-canvas').parentElement!, { deltaY: 100 })
    }
    expect(screen.getByText('47%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /diminuir zoom/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }))
    fireEvent.click(screen.getByRole('button', { name: /centralizar zoom/i }))
    expect(screen.getByText('70%')).toBeInTheDocument()
  })

  it('num mapa que já cabe na tela, afastar não é oferecido', () => {
    canvasMinZoom = 1
    renderPage()

    // O padrão de 70% sobe pro mínimo assim que a cena reporta que não há o
    // que afastar — senão o controle mostraria um zoom que a cena não aplica.
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /diminuir zoom/i })).toBeDisabled()

    fireEvent.wheel(screen.getByTestId('office-canvas').parentElement!, { deltaY: 100 })
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('aproximar é contínuo: cada passo muda o zoom, sem pular de degrau', () => {
    renderPage()

    const zoomIn = screen.getByRole('button', { name: /aumentar zoom/i })
    for (const percent of ['80%', '90%', '100%', '110%', '120%', '130%']) {
      fireEvent.click(zoomIn)
      expect(screen.getByText(percent)).toBeInTheDocument()
      expect(screen.getByTestId('office-canvas')).toHaveTextContent(
        `zoom ${Number.parseInt(percent, 10) / 100}`,
      )
    }
  })

  it('mostra o banner quando alguém está no alto-falante', () => {
    renderPage({
      broadcast: broadcastState({ available: true, speakers: ['Guilherme', 'Isabel'] }),
    })
    expect(screen.getByRole('status')).toHaveTextContent('Guilherme, Isabel no alto-falante')
  })

  it('mostra o popup de chamada recebida', () => {
    interactionsMock = { ...interactionsMock, incomingCall: { userId: 'ana', name: 'Ana' } }
    renderPage()
    expect(screen.getByRole('alertdialog', { name: /Ana/ })).toBeInTheDocument()
  })

  it('foca o personagem selecionado no mapa e posiciona o card no topo direito', () => {
    interactionsMock = { ...interactionsMock, selected: occupants[1] }

    renderPage()

    expect(screen.getByTestId('office-canvas')).toHaveAttribute('data-focus-user-id', 'bruno')
    expect(screen.getByRole('dialog', { name: 'Ações para Bruno Costa' }).parentElement).toHaveClass('right-3')
    expect(screen.getByRole('dialog', { name: 'Ações para Bruno Costa' }).parentElement).toHaveClass('top-3')
  })

  it('repassa canBroadcast e broadcast da sessão para a MediaBar', () => {
    renderPage({
      canBroadcast: true,
      broadcast: broadcastState({ available: true }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menuitem', { name: /alto-falante/i })).toBeInTheDocument()
  })

  it('repassa devices/audioOutputDeviceId/setAudioOutputDevice da sessão pra MediaBar', () => {
    const setAudioOutputDevice = vi.fn()
    renderPage({
      devices: {
        audioInputs: [],
        audioOutputs: [{ deviceId: 'out1', label: 'Fone' }],
        videoInputs: [],
        supportsAudioOutputSelection: true,
      },
      audioOutputDeviceId: 'out1',
      setAudioOutputDevice,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Escolher saída de áudio' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fone/ }))

    expect(setAudioOutputDevice).toHaveBeenCalledWith('out1')
  })

  it('mostra o botão "Editar mapa" e ele aciona o modo de edição ao clicar', async () => {
    // Task 9: sem lock exclusivo — `enter()` semeia a sessão a partir do mapa
    // ativo publicado (`GET /office/map`), não mais de um lock + draft.
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/users') return Promise.resolve({ users: [] })
      if (path === '/office/map') return Promise.resolve(activeMap)
      return Promise.reject(new Error(`apiFetch inesperado: ${path}`))
    })

    renderPage()

    const editButton = screen.getByRole('button', { name: 'Editar mapa' })
    expect(editButton).toBeInTheDocument()

    fireEvent.click(editButton)

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/office/map'))
    await waitFor(() => expect(fakeSceneMock.setEditing).toHaveBeenCalledWith(true, expect.anything()))
  })

  it('emite set-editing ao entrar e sair do modo de edição (Task 11)', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/users') return Promise.resolve({ users: [] })
      if (path === '/office/map') return Promise.resolve(activeMap)
      return Promise.reject(new Error(`apiFetch inesperado: ${path}`))
    })
    const bridge = new OfficeBridge()
    const emitSpy = vi.spyOn(bridge, 'emitClientMessage')

    renderPage({ bridge })

    fireEvent.click(screen.getByRole('button', { name: 'Editar mapa' }))
    await waitFor(() => expect(fakeSceneMock.setEditing).toHaveBeenCalledWith(true, expect.anything()))
    expect(emitSpy).toHaveBeenCalledWith({ type: 'set-editing', editing: true })

    fireEvent.click(screen.getByRole('button', { name: 'Fechar sem salvar' }))
    expect(emitSpy).toHaveBeenCalledWith({ type: 'set-editing', editing: false })
  })

  it('sem estar em sala de reunião, o botão de grade não aparece', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: 'Abrir grade de câmeras' })).not.toBeInTheDocument()
  })

  it('dentro de uma sala de reunião, o botão de grade aparece no rail com o contador de participantes da sala', () => {
    renderPage({ activeMap: meetingRoomMap })
    const button = screen.getByRole('button', { name: 'Abrir grade de câmeras' })
    expect(button).toHaveTextContent('1')
    expect(button.title).toContain('1 na sala')
  })

  it('clicar no botão de grade abre a grade expandida de câmeras', () => {
    renderPage({ activeMap: meetingRoomMap })

    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recolher grade de câmeras' })).toBeInTheDocument()
  })

  // Painel aberto = o `h2` do RoomChatPanel/RoomPeoplePanel. Buscar por TEXTO
  // aqui pega também o tooltip do botão da MediaBar (um `span role="tooltip"`
  // com o mesmo "Chat da sala", sempre no DOM e só escondido por opacity), o
  // que dava falso positivo de "painel aberto" — daí `role: 'heading'`.
  it('a grade nasce com chat fechado; abrir pessoas e chat alterna os painéis', () => {
    renderPage({ activeMap: meetingRoomMap })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.queryByRole('heading', { name: 'Chat da sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Pessoas na sala/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir pessoas da sala' }))
    expect(screen.queryByRole('heading', { name: 'Chat da sala' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Pessoas na sala/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar pessoas da sala' }))
    expect(screen.queryByRole('heading', { name: /Pessoas na sala/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(screen.getByRole('heading', { name: 'Chat da sala' })).toBeInTheDocument()
  })

  it('envia pelo estado de chat da sessão a mensagem digitada no painel', () => {
    const sendMessage = vi.fn(() => true)
    renderPage({
      activeMap: meetingRoomMap,
      roomChat: { messages: [], canSend: true, sendMessage },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))

    fireEvent.change(screen.getByPlaceholderText('Mensagem...'), { target: { value: 'oi da sala' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))

    expect(sendMessage).toHaveBeenCalledWith('oi da sala')
  })

  it('sinaliza mensagem nova no botão de chat quando o painel está fechado', () => {
    const { rerenderWithSession } = renderPage({ activeMap: meetingRoomMap })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    const chatButton = screen.getByRole('button', { name: 'Abrir chat da sala' })
    expect(chatButton.querySelector('.bg-error')).toBeNull()

    rerenderWithSession({
      activeMap: meetingRoomMap,
      roomChat: {
        messages: [{ userId: 'bruno', name: 'Bruno Costa', text: 'cheguei', sentAt: new Date(0).toISOString() }],
        canSend: true,
        sendMessage: vi.fn(() => true),
      },
    })

    expect(screen.getByRole('button', { name: 'Abrir chat da sala' }).querySelector('.bg-error')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(screen.getByRole('button', { name: 'Fechar chat da sala' }).querySelector('.bg-error')).toBeNull()
  })

  it('mensagem nova com o chat fechado mostra a prévia, e clicar nela abre o chat', () => {
    const { rerenderWithSession } = renderPage({ activeMap: meetingRoomMap })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerenderWithSession({
      activeMap: meetingRoomMap,
      roomChat: {
        messages: [{ userId: 'bruno', name: 'Bruno Costa', text: 'bora começar?', sentAt: new Date(0).toISOString() }],
        canSend: true,
        sendMessage: vi.fn(() => true),
      },
    })

    expect(screen.getByText('bora começar?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala — nova mensagem de Bruno Costa' }))

    expect(screen.getByRole('heading', { name: 'Chat da sala' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Abrir chat da sala — nova mensagem de Bruno Costa' }),
    ).not.toBeInTheDocument()
  })

  it('fechar a grade reseta o painel — reabrir volta sem chat/pessoas, não herda "people"', () => {
    renderPage({ activeMap: meetingRoomMap })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir pessoas da sala' }))
    expect(screen.getByRole('heading', { name: /Pessoas na sala/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.queryByRole('heading', { name: 'Chat da sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Pessoas na sala/ })).not.toBeInTheDocument()
  })

  it('a lista de pessoas da sala mostra só quem está na mesma sala', () => {
    renderPage({ activeMap: meetingRoomMap })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir pessoas da sala' }))

    // "Ana Silva" também aparece no tile de avatar da grade (é você mesma na
    // sala) — escopamos ao painel de pessoas pra checar só a lista da sala.
    const panelHeading = screen.getByRole('heading', { name: 'Pessoas na sala (2)' })
    const panel = within(panelHeading.closest('aside')!)
    expect(panelHeading).toBeInTheDocument()
    expect(panel.getByText('Ana Silva')).toBeInTheDocument()
    expect(panel.getByText('Bruno Costa')).toBeInTheDocument()
  })

  it('a MediaBar continua acima (z-index maior) da grade expandida, não escondida atrás dela', () => {
    renderPage({ activeMap: meetingRoomMap })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    const micButton = screen.getByRole('button', { name: 'Ativar microfone' })
    expect(micButton.closest('[class*="z-[60]"]')).not.toBeNull()
  })

  it('cliques na MediaBar não vazam para o canvas por baixo', () => {
    renderPage()
    const micButton = screen.getByRole('button', { name: 'Ativar microfone' })
    const event = createEvent.pointerDown(micButton)
    const stopPropagation = vi.spyOn(event, 'stopPropagation')

    fireEvent(micButton, event)

    expect(stopPropagation).toHaveBeenCalled()
  })

  it('entrar numa sala com tela já compartilhada abre a grade sozinha, com a tela em destaque', () => {
    renderPage({
      activeMap: meetingRoomMap,
      media: mediaState({
        remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack(), screenAudioTrack: null, micOpen: false, speaking: false }],
      }),
    })

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bruno Costa')
  })

  it('entrar numa sala compartilhando a própria tela abre a grade sozinha, com a tela em destaque', () => {
    renderPage({
      activeMap: meetingRoomMap,
      media: mediaState({ localScreenTrack: fakeVideoTrack() as unknown as LocalVideoTrack }),
    })

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Ana Silva')
  })

  it('entrar numa sala sem tela compartilhada não abre a grade sozinha', () => {
    renderPage({ activeMap: meetingRoomMap })
    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()
  })

  it('"Agendar reunião" aparece com a grade de câmeras fechada (o normal ao entrar na sala)', () => {
    renderPage({ activeMap: meetingRoomMap })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))

    expect(screen.getByRole('menuitem', { name: 'Agendar reunião' })).toBeInTheDocument()
  })

  it('agendar com a grade aberta recolhe a grade — senão o modal nasce atrás das câmeras', async () => {
    apiFetchMock.mockImplementation((path: string) =>
      path.startsWith('/office/meetings') ? Promise.resolve([]) : Promise.resolve({ users: [] }),
    )
    renderPage({ activeMap: meetingRoomMap })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Agendar reunião' }))

    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: /Reuniões da sala/ })).toBeInTheDocument()
  })

  it('começar a compartilhar tela já dentro da sala abre a grade sozinha, mesmo se tinha sido fechada manualmente', () => {
    const bridge = new OfficeBridge()
    const { rerenderWithSession } = renderPage({ activeMap: meetingRoomMap, bridge })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recolher grade de câmeras' }))
    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()

    rerenderWithSession({
      activeMap: meetingRoomMap,
      bridge,
      media: mediaState({
        remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack(), screenAudioTrack: null, micOpen: false, speaking: false }],
      }),
    })

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bruno Costa')
  })

  it('fechar a grade manualmente enquanto o MESMO compartilhamento continua ativo não a reabre sozinha', () => {
    const bridge = new OfficeBridge()
    const remotes = [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack(), screenAudioTrack: null, micOpen: false, speaking: false }]
    const { rerenderWithSession } = renderPage({ activeMap: meetingRoomMap, bridge, media: mediaState({ remotes }) })
    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher grade de câmeras' }))
    rerenderWithSession({ activeMap: meetingRoomMap, bridge, media: mediaState({ remotes }) })

    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()
  })

  it('fora de sala de reunião, sem ninguém compartilhando, não há indicador de tela', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /Tela de .* — clique para ver/ })).not.toBeInTheDocument()
  })

  it('fora de sala de reunião, compartilhar a própria tela ganha um indicador clicável sobre o próprio personagem', () => {
    renderPage({ media: mediaState({ localScreenTrack: fakeVideoTrack() as unknown as LocalVideoTrack }) })
    act(() => flushScreenPositions())
    expect(screen.getByRole('button', { name: 'Tela de Ana Silva — clique para ver' })).toBeInTheDocument()
  })

  it('fora de sala de reunião, alguém compartilhando tela por perto ganha um indicador clicável', () => {
    renderPage({
      media: mediaState({
        remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack(), screenAudioTrack: null, micOpen: false, speaking: false }],
      }),
    })
    // `useCharacterScreenPositions` só resolve a posição depois de um frame
    // de `requestAnimationFrame` (stubado em `beforeEach`) — sem isso, o
    // indicador renderiza `null` (posição ainda vazia).
    act(() => flushScreenPositions())
    expect(screen.getByRole('button', { name: 'Tela de Bruno Costa — clique para ver' })).toBeInTheDocument()
  })

  it('clicar no indicador da área aberta abre a grade sem chat/pessoas', () => {
    renderPage({
      media: mediaState({
        remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack(), screenAudioTrack: null, micOpen: false, speaking: false }],
      }),
    })
    act(() => flushScreenPositions())
    fireEvent.click(screen.getByRole('button', { name: 'Tela de Bruno Costa — clique para ver' }))

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir chat da sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Abrir pessoas da sala' })).not.toBeInTheDocument()
  })

  it('na área aberta, a grade expandida mostra só quem está perto — gente longe (fora do raio) não aparece como avatar', () => {
    const carla: OfficeOccupant = { userId: 'carla', name: 'Carla', x: 24, y: 14, dir: 'down', avatarSeed: null, avatarOptions: null }
    renderPage({
      occupants: [...occupants, carla],
      media: mediaState({
        remotes: [
          { userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack(), screenAudioTrack: null, micOpen: false, speaking: false },
          { userId: 'carla', name: 'Carla', audioTrack: null, cameraTrack: null, screenTrack: null, screenAudioTrack: null, micOpen: false, speaking: false },
        ],
      }),
    })
    act(() => flushScreenPositions())
    fireEvent.click(screen.getByRole('button', { name: 'Tela de Bruno Costa — clique para ver' }))

    const grid = screen.getByRole('region', { name: 'Câmeras em tela cheia' })
    expect(within(grid).getByText('Bruno Costa')).toBeInTheDocument()
    expect(within(grid).queryByText('Carla')).not.toBeInTheDocument()
  })

  it('entrar numa sala de reunião com a grade da área aberta já aberta ganha chat/pessoas', () => {
    const remotes = [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack(), screenAudioTrack: null, micOpen: false, speaking: false }]
    const { rerenderWithSession } = renderPage({ media: mediaState({ remotes }) })
    act(() => flushScreenPositions())
    fireEvent.click(screen.getByRole('button', { name: 'Tela de Bruno Costa — clique para ver' }))
    expect(screen.queryByRole('button', { name: 'Abrir chat da sala' })).not.toBeInTheDocument()

    // Mesmas coordenadas de Ana/Bruno, agora dentro de uma zona de reunião —
    // `camerasExpanded` persiste (mesmo componente), só `inMeetingRoom` muda.
    rerenderWithSession({ activeMap: meetingRoomMap, media: mediaState({ remotes }) })

    expect(screen.getByRole('button', { name: 'Abrir chat da sala' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Chat da sala' })).not.toBeInTheDocument()
  })

  it('fora de sala de reunião, o menu não oferece compartilhar áudio', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.queryByRole('menuitem', { name: 'Compartilhar áudio' })).not.toBeInTheDocument()
  })

  it('dentro da sala, compartilhar áudio abre o modal e o link vai pro hook', async () => {
    const start = vi.fn()
    const roomAudio = {
      track: null,
      isMine: false,
      canStart: true,
      start,
      stop: vi.fn(),
      setPaused: vi.fn(),
      advanceItem: vi.fn(),
      error: null,
      clearError: vi.fn(),
    }
    const { rerenderWithSession } = renderPage({ activeMap: meetingRoomMap, roomAudio })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Compartilhar áudio' }))

    const dialog = screen.getByRole('dialog', { name: 'Compartilhar áudio na sala' })
    fireEvent.change(within(dialog).getByLabelText('Link do YouTube'), {
      target: { value: 'https://youtu.be/dQw4w9WgXcQ' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tocar na sala' }))

    expect(start).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ')
    // Ainda aberto: a resposta do servidor não chegou, e é ela que decide.
    expect(screen.getByRole('dialog', { name: 'Compartilhar áudio na sala' })).toBeInTheDocument()

    // Faixa no ar e é minha — aí sim o modal cumpriu o papel.
    rerenderWithSession({
      activeMap: meetingRoomMap,
      roomAudio: {
        ...roomAudio,
        isMine: true,
        canStart: false,
        track: {
          videoId: 'dQw4w9WgXcQ',
          startedByUserId: 'ana',
          startedByName: 'Ana',
          positionSeconds: 0,
          paused: false,
          playlistId: null,
          playlistIndex: 0,
          isMine: true,
          key: 'dQw4w9WgXcQ:ana:1',
          originMs: Date.now(),
        },
      },
    })

    expect(screen.queryByRole('dialog', { name: 'Compartilhar áudio na sala' })).not.toBeInTheDocument()
  })

  it('recusa do servidor aparece no modal, que continua aberto', () => {
    const roomAudio = {
      track: null,
      isMine: false,
      canStart: true,
      start: vi.fn(),
      stop: vi.fn(),
      setPaused: vi.fn(),
      advanceItem: vi.fn(),
      error: null as string | null,
      clearError: vi.fn(),
    }
    const { rerenderWithSession } = renderPage({ activeMap: meetingRoomMap, roomAudio })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Compartilhar áudio' }))

    // Sem isso, a recusa de uma tentativa anterior apareceria já na abertura.
    expect(roomAudio.clearError).toHaveBeenCalled()

    rerenderWithSession({
      activeMap: meetingRoomMap,
      roomAudio: { ...roomAudio, error: 'Espere alguns segundos antes de tocar outro áudio.' },
    })

    const dialog = screen.getByRole('dialog', { name: 'Compartilhar áudio na sala' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Espere alguns segundos antes de tocar outro áudio.',
    )
  })

  it('com faixa de outra pessoa no ar, o item mostra quem está tocando', () => {
    renderPage({
      activeMap: meetingRoomMap,
      roomAudio: {
        track: {
          videoId: 'dQw4w9WgXcQ',
          startedByUserId: 'bruno',
          startedByName: 'Bruno Costa',
          positionSeconds: 12,
          paused: false,
          playlistId: null,
          playlistIndex: 0,
          isMine: false,
          key: 'dQw4w9WgXcQ:bruno:1',
          originMs: Date.now() - 12_000,
        },
        isMine: false,
        canStart: false,
        start: vi.fn(),
        stop: vi.fn(),
        setPaused: vi.fn(),
        advanceItem: vi.fn(),
        error: null,
        clearError: vi.fn(),
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menuitem', { name: 'Bruno Costa está tocando' })).toBeDisabled()
  })

  it('fora de sala de reunião ou zona privada (canRaise=false), o botão de levantar a mão não aparece', () => {
    renderPage() // fixture default: canRaise false
    expect(screen.queryByRole('menuitem', { name: 'Levantar a mão' })).not.toBeInTheDocument()
  })

  it('dentro de sala/zona (canRaise=true), o botão de levantar a mão aparece', () => {
    renderPage({ raisedHands: { queue: [], raised: false, canRaise: true, toggle: vi.fn() } })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menuitem', { name: 'Levantar a mão' })).toBeInTheDocument()
  })

  it('clicar no botão de levantar a mão chama raisedHands.toggle', () => {
    const toggle = vi.fn()
    renderPage({ raisedHands: { queue: [], raised: false, canRaise: true, toggle } })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Levantar a mão' }))

    expect(toggle).toHaveBeenCalledOnce()
  })

  it('sem canRaise, o contador não aparece mesmo com a fila cheia (fila só existe dentro de zona)', () => {
    renderPage({
      raisedHands: { queue: ['ana', 'bruno'], raised: false, canRaise: false, toggle: vi.fn() },
    })
    expect(screen.queryByRole('button', { name: /fila de mãos levantadas/ })).not.toBeInTheDocument()
  })

  it('sem mãos levantadas, o contador não aparece mesmo dentro da sala', () => {
    renderPage({
      activeMap: meetingRoomMap,
      raisedHands: { queue: [], raised: false, canRaise: true, toggle: vi.fn() },
    })
    expect(screen.queryByRole('button', { name: /fila de mãos levantadas/ })).not.toBeInTheDocument()
  })

  it('mostra o contador de mãos levantadas e expande a lista ao clicar', () => {
    renderPage({
      activeMap: meetingRoomMap,
      raisedHands: { queue: ['ana', 'bruno'], raised: false, canRaise: true, toggle: vi.fn() },
    })
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir fila de mãos levantadas' }))

    const queueList = within(screen.getByRole('list'))
    expect(queueList.getByText('Ana Silva')).toBeInTheDocument()
    expect(queueList.getByText('Bruno Costa')).toBeInTheDocument()
  })

  it('a própria mão levantada abre a fila sozinha, sem precisar clicar', () => {
    renderPage({
      activeMap: meetingRoomMap,
      raisedHands: { queue: ['ana'], raised: true, canRaise: true, toggle: vi.fn() },
    })
    expect(within(screen.getByRole('list')).getByText('Ana Silva')).toBeInTheDocument()
  })

  it('convidado sai para a tela de agradecimento sem limpar o acesso temporário', () => {
    const leaveOffice = vi.fn()
    renderPage({ isGuest: true, leaveOffice })

    fireEvent.click(screen.getByRole('button', { name: 'Sair do escritório' }))

    expect(leaveOffice).toHaveBeenCalledOnce()
    expect(navigateMock).toHaveBeenCalledWith('/convidado/obrigado')
  })

  it('mostra o sino de notificações pra usuário autenticado, mas não pra convidado', () => {
    const { rerenderWithSession } = renderPage({ isGuest: false })
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument()

    rerenderWithSession({ isGuest: true })
    expect(screen.queryByRole('button', { name: 'Notificações' })).not.toBeInTheDocument()
  })

  it('mostra o toast de convite quando há um na fila, mas não pra convidado', () => {
    const dismiss = vi.fn()
    inviteToastsMock = {
      queue: [{ id: 'n1', type: 'RETRO_INVITED', title: 'Você foi convidado para a retrospectiva "Sprint 12"', link: '/retrospectivas/room1' }],
      dismiss,
    }
    const { rerenderWithSession } = renderPage({ isGuest: false })
    expect(screen.getByText(/convidado para a retrospectiva/i)).toBeInTheDocument()

    rerenderWithSession({ isGuest: true })
    expect(screen.queryByText(/convidado para a retrospectiva/i)).not.toBeInTheDocument()
  })
})
