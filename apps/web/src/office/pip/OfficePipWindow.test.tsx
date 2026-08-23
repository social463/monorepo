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
    exitOffice: vi.fn(),
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
      localScreenTrack: null,
      screenShareOrder: new Map(),
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

  it('o X encerra o escritório sem navegar', () => {
    const { session } = renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Sair do escritório' }))
    expect(session.exitOffice).toHaveBeenCalledOnce()
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
              screenAudioTrack: null,
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

  it('com tela compartilhada remota ativa, mostra um único tile de tela no lugar do grid de câmeras', () => {
    const screenTrack = fakeVideoTrack()
    renderAt(
      '/',
      makeSession({
        media: {
          ...makeSession().media,
          cameraEnabled: true,
          localCameraTrack: fakeVideoTrack(),
          remotes: [{ userId: 'u2', name: 'Bia', audioTrack: null, cameraTrack: null, screenTrack, screenAudioTrack: null }],
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
          remotes: [{ userId: 'u2', name: 'Bia', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack(), screenAudioTrack: null }],
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
})
