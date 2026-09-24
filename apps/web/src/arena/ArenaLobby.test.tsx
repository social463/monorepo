import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ArenaLobbyServerMessage } from '@legends/shared'
import { ArenaLobby } from './ArenaLobby'

const send = vi.fn()
let handler: (message: ArenaLobbyServerMessage) => void = () => {}
vi.mock('./useArenaLobbySocket', () => ({
  useArenaLobbySocket: (_enabled: boolean, onMessage: (m: ArenaLobbyServerMessage) => void) => {
    handler = onMessage
    return { connected: true, send }
  },
}))

const useArenaMediaMock = vi.fn()
vi.mock('./media/useArenaMedia', () => ({
  useArenaMedia: (options: unknown) => useArenaMediaMock(options),
}))

const you = { userId: 'ana', name: 'Ana' }

/** O socket entrega fora do React: sem `act`, o estado não chega à tela. */
function entregar(message: ArenaLobbyServerMessage) {
  act(() => handler(message))
}

const welcome: ArenaLobbyServerMessage = {
  type: 'welcome',
  youId: 'ana',
  members: [{ userId: 'ana', name: 'Ana' }],
}

beforeEach(() => {
  send.mockClear()
  useArenaMediaMock.mockReset()
  useArenaMediaMock.mockReturnValue({
    status: 'connected',
    micEnabled: false,
    micError: false,
    cameraEnabled: false,
    cameraError: false,
    remotes: [],
    localCameraTrack: null,
    localSpeaking: false,
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(),
    audioInputDeviceId: null,
    videoInputDeviceId: null,
    setAudioInputDevice: vi.fn(),
    setVideoInputDevice: vi.fn(),
  })
})

function montar() {
  return render(<ArenaLobby you={you} onEntrar={<button type="button">mata-mata</button>} />)
}

describe('ArenaLobby', () => {
  it('mostra os modos e o chat do saguão lado a lado', () => {
    montar()
    expect(screen.getByRole('button', { name: 'mata-mata' })).toBeInTheDocument()
    expect(screen.getByText('Chat do saguão')).toBeInTheDocument()
  })

  /**
   * O token do LiveKit é autorizado pela presença no hub: pedir antes do
   * `welcome` volta 409, e a voz nunca subiria.
   */
  it('só conecta a voz depois do welcome', () => {
    montar()
    expect(useArenaMediaMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ arenaId: null, spatial: false }),
    )

    entregar(welcome)

    expect(useArenaMediaMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ arenaId: 'lobby', spatial: false }),
    )
  })

  it('a voz do saguão NÃO é espacial — ninguém tem posição no menu', () => {
    montar()
    entregar(welcome)
    expect(useArenaMediaMock.mock.calls.every(([options]) => options.spatial === false)).toBe(true)
  })

  it('lista quem chega e some com quem sai', () => {
    montar()
    entregar(welcome)
    entregar({ type: 'joined', member: { userId: 'bruno', name: 'Bruno' } })

    // A lista fica atrás do botão de chat: o painel é o mesmo espaço.
    fireEvent.click(screen.getByRole('button', { name: 'Fechar chat do saguão' }))
    expect(screen.getByText('Bruno')).toBeInTheDocument()

    entregar({ type: 'left', userId: 'bruno' })
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument()
  })

  it('escrever manda pelo socket e aparece na hora', () => {
    montar()
    entregar(welcome)

    fireEvent.change(screen.getByPlaceholderText('Mensagem...'), { target: { value: 'bora?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))

    expect(send).toHaveBeenCalledWith({ type: 'chat', text: 'bora?' })
    expect(screen.getByText('bora?')).toBeInTheDocument()
  })

  it('mensagem de outro aparece na conversa', () => {
    montar()
    entregar(welcome)
    entregar({
      type: 'chat',
      userId: 'bruno',
      name: 'Bruno',
      text: 'cheguei',
      sentAt: new Date().toISOString(),
    })

    expect(screen.getByText('cheguei')).toBeInTheDocument()
  })
})
