import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MediaBarMoreMenu } from './MediaBarMoreMenu'

function baseProps(overrides: Partial<Parameters<typeof MediaBarMoreMenu>[0]> = {}) {
  return {
    onClose: vi.fn(),
    inMeetingRoom: false,
    showReactions: false,
    onToggleReactions: vi.fn(),
    showChat: false,
    onToggleChat: vi.fn(),
    canRaiseHand: false,
    raised: false,
    onToggleRaiseHand: vi.fn(),
    showRoomControls: false,
    roomPanel: null,
    onToggleRoomPeople: vi.fn(),
    canLockRoom: false,
    roomLocked: false,
    onToggleRoomLock: vi.fn(),
    supportsAudioOutputSelection: false,
    audioOutputs: [],
    audioOutputDeviceId: null,
    onSelectAudioOutput: vi.fn(),
    canBroadcast: false,
    broadcastAvailable: false,
    speakerEnabled: false,
    onToggleSpeaker: vi.fn(),
    ...overrides,
  }
}

function renderMenu(overrides: Partial<Parameters<typeof MediaBarMoreMenu>[0]> = {}) {
  return render(<MediaBarMoreMenu {...baseProps(overrides)} />)
}

beforeEach(() => vi.clearAllMocks())

describe('MediaBarMoreMenu', () => {
  it('sem nenhum item condicional disponível, sempre mostra Reagir e Chat por perto', () => {
    render(<MediaBarMoreMenu {...baseProps()} />)
    expect(screen.getByRole('menuitem', { name: 'Reagir' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Abrir chat por perto' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Levantar a mão' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Abrir pessoas da sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Trancar sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Escolher saída de áudio' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Ligar alto-falante' })).not.toBeInTheDocument()
  })

  it('numa sala de reunião, Reagir some do menu (ganhou botão fixo na barra)', () => {
    render(<MediaBarMoreMenu {...baseProps({ inMeetingRoom: true })} />)
    expect(screen.queryByRole('menuitem', { name: 'Reagir' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Abrir chat por perto' })).toBeInTheDocument()
  })

  it('Reagir dispara onToggleReactions e fecha o menu', () => {
    const onToggleReactions = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ onToggleReactions, onClose })} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reagir' }))
    expect(onToggleReactions).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Chat por perto dispara onToggleChat e fecha o menu', () => {
    const onToggleChat = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ onToggleChat, onClose })} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    expect(onToggleChat).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com canRaiseHand, Levantar a mão dispara onToggleRaiseHand e fecha o menu', () => {
    const onToggleRaiseHand = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ canRaiseHand: true, onToggleRaiseHand, onClose })} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Levantar a mão' }))
    expect(onToggleRaiseHand).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('mostra atalhos compactos nos itens de menu que possuem hotkey', () => {
    renderMenu({ canRaiseHand: true, canLockRoom: true })

    expect(screen.getByRole('menuitem', { name: 'Reagir' })).toHaveTextContent('1-8')
    expect(screen.getByRole('menuitem', { name: 'Abrir chat por perto' })).toHaveTextContent('Enter')
    expect(screen.getByRole('menuitem', { name: 'Levantar a mão' })).toHaveTextContent('H')
    expect(screen.getByRole('menuitem', { name: 'Trancar sala' })).toHaveTextContent('L')
  })

  it('com a mão levantada, mostra "Abaixar a mão"', () => {
    render(<MediaBarMoreMenu {...baseProps({ canRaiseHand: true, raised: true })} />)
    expect(screen.getByRole('menuitem', { name: 'Abaixar a mão' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('com showRoomControls, Participantes dispara onToggleRoomPeople e fecha o menu', () => {
    const onToggleRoomPeople = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ showRoomControls: true, onToggleRoomPeople, onClose })} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir pessoas da sala' }))
    expect(onToggleRoomPeople).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com o painel de pessoas aberto, mostra o rótulo de fechar', () => {
    render(<MediaBarMoreMenu {...baseProps({ showRoomControls: true, roomPanel: 'people' })} />)
    expect(screen.getByRole('menuitem', { name: 'Fechar pessoas da sala' })).toBeInTheDocument()
  })

  it('com canLockRoom, Trancar sala dispara onToggleRoomLock e fecha o menu', () => {
    const onToggleRoomLock = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ canLockRoom: true, onToggleRoomLock, onClose })} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trancar sala' }))
    expect(onToggleRoomLock).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com a sala trancada, mostra "Destrancar sala"', () => {
    render(<MediaBarMoreMenu {...baseProps({ canLockRoom: true, roomLocked: true })} />)
    expect(screen.getByRole('menuitem', { name: 'Destrancar sala' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('saída de áudio expande a lista de dispositivos sem fechar o menu; escolher um fecha', () => {
    const onSelectAudioOutput = vi.fn()
    const onClose = vi.fn()
    render(
      <MediaBarMoreMenu
        {...baseProps({
          supportsAudioOutputSelection: true,
          audioOutputs: [{ deviceId: 'out1', label: 'Fone' }],
          onSelectAudioOutput,
          onClose,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Escolher saída de áudio' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fone/ }))
    expect(onSelectAudioOutput).toHaveBeenCalledWith('out1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com broadcast disponível, Alto-falante dispara onToggleSpeaker e fecha o menu', () => {
    const onToggleSpeaker = vi.fn()
    const onClose = vi.fn()
    render(
      <MediaBarMoreMenu
        {...baseProps({ canBroadcast: true, broadcastAvailable: true, onToggleSpeaker, onClose })}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ligar alto-falante' }))
    expect(onToggleSpeaker).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com o alto-falante ligado, mostra "Desligar alto-falante"', () => {
    render(<MediaBarMoreMenu {...baseProps({ canBroadcast: true, broadcastAvailable: true, speakerEnabled: true })} />)
    expect(screen.getByRole('menuitem', { name: 'Desligar alto-falante' })).toBeInTheDocument()
  })

  it('Esc fecha o menu', () => {
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ onClose })} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clique fora do container marcado com data-more-menu-root fecha o menu', () => {
    const onClose = vi.fn()
    render(
      <div>
        <div data-more-menu-root>
          <MediaBarMoreMenu {...baseProps({ onClose })} />
        </div>
        <button type="button">fora</button>
      </div>,
    )
    fireEvent.mouseDown(screen.getByText('fora'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('oferece "Agendar reunião" dentro da sala e chama o handler', async () => {
    const user = userEvent.setup()
    const onScheduleMeeting = vi.fn()
    renderMenu({ inMeetingRoom: true, showRoomControls: true, onScheduleMeeting })

    await user.click(screen.getByRole('menuitem', { name: 'Agendar reunião' }))

    expect(onScheduleMeeting).toHaveBeenCalledOnce()
  })

  it('oferece "Agendar reunião" com a grade de câmeras fechada', async () => {
    // A grade nasce fechada (showRoomControls=false) ao entrar numa sala sem
    // ninguém compartilhando tela — o item precisa aparecer mesmo assim.
    const user = userEvent.setup()
    const onScheduleMeeting = vi.fn()
    renderMenu({ inMeetingRoom: true, showRoomControls: false, onScheduleMeeting })

    await user.click(screen.getByRole('menuitem', { name: 'Agendar reunião' }))

    expect(onScheduleMeeting).toHaveBeenCalledOnce()
  })

  it('não oferece "Agendar reunião" sem handler (fora de sala, convidado ou sala sem chave)', () => {
    renderMenu({ inMeetingRoom: false, onScheduleMeeting: undefined })
    expect(screen.queryByRole('menuitem', { name: 'Agendar reunião' })).not.toBeInTheDocument()
  })

  describe('áudio da sala', () => {
    const roomAudio = (overrides: Record<string, unknown> = {}) => ({
      canStart: true,
      isMine: false,
      startedByName: null,
      onShare: vi.fn(),
      onStop: vi.fn(),
      ...overrides,
    })

    it('não aparece fora de sala de reunião nem para convidado', () => {
      renderMenu({ roomAudio: undefined })
      expect(screen.queryByRole('menuitem', { name: 'Compartilhar áudio' })).not.toBeInTheDocument()
    })

    it('com a sala em silêncio, oferece compartilhar', async () => {
      const user = userEvent.setup()
      const audio = roomAudio()
      renderMenu({ inMeetingRoom: true, roomAudio: audio })

      await user.click(screen.getByRole('menuitem', { name: 'Compartilhar áudio' }))

      expect(audio.onShare).toHaveBeenCalledOnce()
    })

    it('com faixa sua no ar, o item vira parar', async () => {
      const user = userEvent.setup()
      const audio = roomAudio({ canStart: false, isMine: true, startedByName: 'Ana' })
      renderMenu({ inMeetingRoom: true, roomAudio: audio })

      await user.click(screen.getByRole('menuitem', { name: 'Parar áudio' }))

      expect(audio.onStop).toHaveBeenCalledOnce()
      expect(audio.onShare).not.toHaveBeenCalled()
    })

    it('com faixa de outra pessoa, mostra quem está tocando e não deixa clicar', () => {
      const audio = roomAudio({ canStart: false, isMine: false, startedByName: 'Bruno' })
      renderMenu({ inMeetingRoom: true, roomAudio: audio })

      const item = screen.getByRole('menuitem', { name: 'Bruno está tocando' })
      expect(item).toBeDisabled()
      fireEvent.click(item)
      expect(audio.onShare).not.toHaveBeenCalled()
    })
  })
})
