import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { OFFICE_NEARBY_MESSAGE_MAX_LENGTH } from '@legends/shared'
import { MediaBar } from './MediaBar'
import type { OfficeMediaState } from './useOfficeMedia'
import type { OfficeBroadcastState } from './useOfficeBroadcast'
import type { CameraBackgroundState } from './useCameraBackground'
import type { MediaDevicesState } from './useMediaDevices'

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
    toggleMic: vi.fn(async () => {}),
    toggleCamera: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async () => {}),
    applyMicEnabled: vi.fn(async () => {}),
    audioInputDeviceId: null,
    videoInputDeviceId: null,
    setAudioInputDevice: vi.fn(async () => {}),
    setVideoInputDevice: vi.fn(async () => {}),
    ...overrides,
  }
}

function devicesState(overrides: Partial<MediaDevicesState> = {}): MediaDevicesState {
  return {
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
    supportsAudioOutputSelection: true,
    ...overrides,
  }
}

function broadcastState(overrides: Partial<OfficeBroadcastState> = {}): OfficeBroadcastState {
  return {
    available: true,
    speakerEnabled: false,
    speakerError: false,
    speakers: [],
    broadcastTracks: [],
    toggleSpeaker: vi.fn(async () => {}),
    ...overrides,
  }
}

function cameraBackgroundState(overrides: Partial<CameraBackgroundState> = {}): CameraBackgroundState {
  return {
    background: 'none',
    setBackground: vi.fn(),
    supported: true,
    error: false,
    ...overrides,
  }
}

function renderMediaBar({
  media = mediaState(),
  zoneName = null,
  silenced = false,
  micLocked = false,
  broadcast = broadcastState({ available: false }),
  canBroadcast = false,
  you = { name: 'Lucca Secco' },
  status,
  onSetStatus,
  onLeave = vi.fn(),
  onEditCharacter,
  nearbyChatOpen,
  onChatOpenChange,
  onNearbyMessage,
  onReaction,
  showRoomControls = false,
  roomPanel = null,
  roomChatUnread,
  roomChatUnreadCount,
  onToggleRoomChat,
  onToggleRoomPeople,
  canRaiseHand = false,
  raised = false,
  onToggleRaiseHand,
  canLockRoom = false,
  roomLocked = false,
  onToggleRoomLock,
  inMeetingRoom = false,
  canAnnotate = false,
  annotating = false,
  onToggleAnnotate,
  cameraBackground = cameraBackgroundState(),
  devices = devicesState(),
  audioOutputDeviceId = null,
  onSelectAudioOutput = vi.fn(),
}: Partial<ComponentProps<typeof MediaBar>> = {}) {
  return render(
    <MediaBar
      media={media}
      zoneName={zoneName}
      silenced={silenced}
      micLocked={micLocked}
      broadcast={broadcast}
      canBroadcast={canBroadcast}
      you={you}
      status={status}
      onSetStatus={onSetStatus}
      onLeave={onLeave}
      onEditCharacter={onEditCharacter}
      nearbyChatOpen={nearbyChatOpen}
      onChatOpenChange={onChatOpenChange}
      onNearbyMessage={onNearbyMessage}
      onReaction={onReaction}
      showRoomControls={showRoomControls}
      roomPanel={roomPanel}
      roomChatUnread={roomChatUnread}
      roomChatUnreadCount={roomChatUnreadCount}
      onToggleRoomChat={onToggleRoomChat}
      onToggleRoomPeople={onToggleRoomPeople}
      canRaiseHand={canRaiseHand}
      raised={raised}
      onToggleRaiseHand={onToggleRaiseHand}
      canLockRoom={canLockRoom}
      roomLocked={roomLocked}
      onToggleRoomLock={onToggleRoomLock}
      inMeetingRoom={inMeetingRoom}
      canAnnotate={canAnnotate}
      annotating={annotating}
      onToggleAnnotate={onToggleAnnotate}
      cameraBackground={cameraBackground}
      devices={devices}
      audioOutputDeviceId={audioOutputDeviceId}
      onSelectAudioOutput={onSelectAudioOutput}
    />,
  )
}

describe('MediaBar', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('clicar no chip abre o menu; "Editar personagem" chama onEditCharacter', () => {
    const onEditCharacter = vi.fn()
    renderMediaBar({ onEditCharacter })
    fireEvent.click(screen.getByRole('button', { name: 'Seu status e personagem' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar personagem' }))
    expect(onEditCharacter).toHaveBeenCalledOnce()
  })

  it('sem foto/personagem salvo, o chip mostra as iniciais do nome', () => {
    renderMediaBar({ you: { name: 'Lucca Secco' } })
    expect(screen.getByRole('button', { name: 'Seu status e personagem' })).toHaveTextContent('LS')
  })

  it('mesmo com foto cadastrada, o chip fica com o personagem', () => {
    renderMediaBar({ you: { name: 'Lucca Secco', photoUrl: 'https://example.com/foto.jpg' } })
    const chip = screen.getByRole('button', { name: 'Seu status e personagem' })
    // Dentro do escritório a identidade é o boneco: a foto só aparece no card
    // de resumo, ao clicar no personagem.
    expect(chip.querySelector('img')?.getAttribute('src')).not.toBe('https://example.com/foto.jpg')
  })

  it('o ponto no avatar reflete a presença, não o estado do áudio, e só "online" tem o glow', () => {
    const dot = (chip: HTMLElement) => chip.querySelector('.absolute.bottom-0.right-0')

    // áudio conectado, mas ausente → ponto amarelo (presença), não verde (áudio), sem glow
    const away = renderMediaBar({ status: 'away', media: mediaState({ status: 'connected' }) })
    const awayDot = dot(away.getByRole('button', { name: 'Seu status e personagem' }))
    expect(awayDot).toHaveClass('bg-yellow-400')
    expect(awayDot).not.toHaveClass('presence-online-pulse')

    away.unmount()
    const brb = renderMediaBar({ status: 'brb', media: mediaState({ status: 'connected' }) })
    const brbDot = dot(brb.getByRole('button', { name: 'Seu status e personagem' }))
    expect(brbDot).toHaveClass('bg-blue-500')
    expect(brbDot).not.toHaveClass('presence-online-pulse')

    brb.unmount()
    const online = renderMediaBar({ status: 'online', media: mediaState({ status: 'connected' }) })
    const onlineDot = dot(online.getByRole('button', { name: 'Seu status e personagem' }))
    expect(onlineDot).toHaveClass('bg-green-500')
    expect(onlineDot).toHaveClass('presence-online-pulse')
  })

  it('o texto do status no chip acompanha a cor da bolinha de presença', () => {
    const away = renderMediaBar({ status: 'away' })
    expect(away.getByText('Ausente')).toHaveClass('text-yellow-400')

    away.unmount()
    const brb = renderMediaBar({ status: 'brb' })
    expect(brb.getByText('Volto logo')).toHaveClass('text-blue-400')

    brb.unmount()
    const online = renderMediaBar({ status: 'online' })
    expect(online.getByText('Online')).toHaveClass('text-primary')
  })

  it('o menu do chip lista os 3 status, marca o atual e chama onSetStatus ao escolher outro', () => {
    const onSetStatus = vi.fn()
    renderMediaBar({ status: 'away', onSetStatus })
    fireEvent.click(screen.getByRole('button', { name: 'Seu status e personagem' }))

    expect(screen.getByRole('menuitemradio', { name: 'Ausente' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Online' })).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Online' }))
    expect(onSetStatus).toHaveBeenCalledWith('online')
    // menu fecha depois de escolher
    expect(screen.queryByRole('menuitemradio', { name: 'Online' })).not.toBeInTheDocument()
  })

  it('nasce mutado e o botão ativa o microfone', () => {
    const media = mediaState()
    renderMediaBar({ media })
    const mic = screen.getByRole('button', { name: 'Ativar microfone' })
    fireEvent.click(mic)
    expect(media.toggleMic).toHaveBeenCalledOnce()
  })

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
        devices={devicesState()}
        audioOutputDeviceId={null}
        onSelectAudioOutput={vi.fn()}
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

  it('mostra a zona atual e o estado dos toggles', () => {
    renderMediaBar({
      media: mediaState({ micEnabled: true, screenShareEnabled: true }),
      zoneName: 'Sala de Reunião 1',
    })
    expect(screen.getByText('Você está em: Sala de Reunião 1', { selector: '.sr-only' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Silenciar microfone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Parar de compartilhar' })).toBeInTheDocument()
  })

  it('avisa quando a permissão do mic foi negada e quando está sem áudio', () => {
    renderMediaBar({ media: mediaState({ micError: true, status: 'error' }) })
    expect(screen.getByText('Permissão de microfone negada')).toBeInTheDocument()
    expect(screen.getByText('Sem áudio — tentando reconectar', { selector: '.sr-only' })).toBeInTheDocument()
  })

  it('desabilita microfone e câmera enquanto a mídia reconecta', () => {
    const media = mediaState({ status: 'error' })
    renderMediaBar({ media })

    const mic = screen.getByRole('button', { name: 'Ativar microfone' })
    const camera = screen.getByRole('button', { name: 'Ligar câmera' })

    expect(mic).toBeDisabled()
    expect(camera).toBeDisabled()
    fireEvent.click(mic)
    fireEvent.click(camera)
    expect(media.toggleMic).not.toHaveBeenCalled()
    expect(media.toggleCamera).not.toHaveBeenCalled()
  })

  it('avisa quando a permissão da câmera foi negada', () => {
    renderMediaBar({ media: mediaState({ cameraError: true }) })
    expect(screen.getByText('Permissão de câmera negada')).toBeInTheDocument()
  })

  it('desabilita compartilhamento de tela enquanto a mídia reconecta', () => {
    const media = mediaState({ status: 'error' })
    renderMediaBar({ media })

    const screenShare = screen.getByRole('button', { name: 'Compartilhar tela' })

    expect(screenShare).toBeDisabled()
    fireEvent.click(screenShare)
    expect(media.toggleScreenShare).not.toHaveBeenCalled()
  })

  it('avisa quando o compartilhamento de tela falha', () => {
    renderMediaBar({ media: mediaState({ screenShareError: true }) })
    expect(screen.getByText('Não foi possível compartilhar a tela')).toBeInTheDocument()
  })

  it('abre reações e chat por perto a partir da toolbar', () => {
    const onChatOpenChange = vi.fn()
    const onReaction = vi.fn()
    renderMediaBar({ onChatOpenChange, onReaction })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reagir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reagir com 👋' }))
    expect(onReaction).toHaveBeenCalledWith('👋')
    expect(screen.queryByRole('button', { name: 'Reagir com 👋' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    expect(screen.getByText('Chat por perto')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Mensagem...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modo do chat por perto' })).toBeInTheDocument()
    expect(onChatOpenChange).toHaveBeenLastCalledWith(true)
  })

  it('usa as teclas 1 a 8 como atalhos para os emojis', () => {
    const onReaction = vi.fn()
    renderMediaBar({ onReaction })

    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8']) {
      fireEvent.keyDown(document, { key })
    }

    expect(onReaction.mock.calls.map(([reaction]) => reaction)).toEqual([
      '👋', '❤️', '🎉', '👍', '😂', '👏', '💯', '🔥',
    ])
  })

  it('não dispara atalho de reação enquanto o usuário está digitando', () => {
    const onReaction = vi.fn()
    renderMediaBar({ onReaction })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    fireEvent.keyDown(screen.getByPlaceholderText('Mensagem...'), { key: '1' })

    expect(onReaction).not.toHaveBeenCalled()
  })

  it('edita um emoji, salva localmente e usa a personalização na hotkey', () => {
    const onReaction = vi.fn()
    renderMediaBar({ onReaction })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reagir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar reação 1' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Emoji do atalho 1' }), {
      target: { value: '🤩' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar reação' }))
    fireEvent.keyDown(document, { key: '1' })

    expect(onReaction).toHaveBeenCalledWith('🤩')
    expect(JSON.parse(window.localStorage.getItem('legends.office.reactions.v1')!)[0]).toBe('🤩')
  })

  it('carrega emojis personalizados salvos localmente', () => {
    window.localStorage.setItem(
      'legends.office.reactions.v1',
      JSON.stringify(['🤩', '❤️', '🎉', '👍', '😂', '👏', '💯', '🔥']),
    )
    const onReaction = vi.fn()
    renderMediaBar({ onReaction })

    fireEvent.keyDown(document, { key: '1' })

    expect(onReaction).toHaveBeenCalledWith('🤩')
  })

  it('aceita chat por perto controlado por prop', () => {
    const onChatOpenChange = vi.fn()
    const { rerender } = renderMediaBar({ nearbyChatOpen: false, onChatOpenChange })
    expect(screen.queryByText('Chat por perto')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    expect(onChatOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByText('Chat por perto')).not.toBeInTheDocument()

    rerender(
      <MediaBar
        media={mediaState()}
        zoneName={null}
        broadcast={broadcastState({ available: false })}
        canBroadcast={false}
        onLeave={vi.fn()}
        nearbyChatOpen
        onChatOpenChange={onChatOpenChange}
        cameraBackground={cameraBackgroundState()}
        devices={devicesState()}
        audioOutputDeviceId={null}
        onSelectAudioOutput={vi.fn()}
      />,
    )
    expect(screen.getByText('Chat por perto')).toBeInTheDocument()
  })

  it('fecha o chat por perto com Esc', () => {
    renderMediaBar()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    expect(screen.getByText('Chat por perto')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText('Chat por perto')).not.toBeInTheDocument()
  })

  it('fecha o chat por perto com Esc mesmo com foco no input de mensagem', () => {
    renderMediaBar()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    const input = screen.getByPlaceholderText('Mensagem...')

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByText('Chat por perto')).not.toBeInTheDocument()
  })

  it('envia chat por perto para o balão do personagem sem fechar o input', () => {
    const onNearbyMessage = vi.fn()
    renderMediaBar({ onNearbyMessage })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    fireEvent.change(screen.getByPlaceholderText('Mensagem...'), { target: { value: 'opa' } })
    fireEvent.submit(screen.getByPlaceholderText('Mensagem...').closest('form')!)

    expect(onNearbyMessage).toHaveBeenCalledWith('opa', 'speech')
    expect(screen.queryByText('opa')).not.toBeInTheDocument()
    expect(screen.getByText('Sem mensagens por perto.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Mensagem...')).toHaveValue('')
  })

  it('mostra contador e limita o chat por perto pela mesma régua do balão', () => {
    renderMediaBar()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))

    const input = screen.getByPlaceholderText('Mensagem...')
    expect(input).toHaveAttribute('maxLength', String(OFFICE_NEARBY_MESSAGE_MAX_LENGTH))
    expect(screen.getByLabelText('Caracteres da mensagem')).toHaveTextContent(`0/${OFFICE_NEARBY_MESSAGE_MAX_LENGTH}`)

    fireEvent.change(input, { target: { value: 'OPA' } })
    expect(screen.getByLabelText('Caracteres da mensagem')).toHaveTextContent(`3/${OFFICE_NEARBY_MESSAGE_MAX_LENGTH}`)

    fireEvent.change(input, { target: { value: 'A'.repeat(OFFICE_NEARBY_MESSAGE_MAX_LENGTH + 10) } })
    expect(input).toHaveValue('A'.repeat(OFFICE_NEARBY_MESSAGE_MAX_LENGTH))
    expect(screen.getByLabelText('Caracteres da mensagem')).toHaveTextContent(
      `${OFFICE_NEARBY_MESSAGE_MAX_LENGTH}/${OFFICE_NEARBY_MESSAGE_MAX_LENGTH}`,
    )
  })

  it('fecha o chat por perto ao enviar com Enter sem texto', () => {
    const onNearbyMessage = vi.fn()
    renderMediaBar({ onNearbyMessage })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    fireEvent.submit(screen.getByPlaceholderText('Mensagem...').closest('form')!)

    expect(onNearbyMessage).not.toHaveBeenCalled()
    expect(screen.queryByText('Chat por perto')).not.toBeInTheDocument()
  })

  it('envia chat por perto como pensamento quando o modo Pensar está selecionado', () => {
    const onNearbyMessage = vi.fn()
    renderMediaBar({ onNearbyMessage })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir chat por perto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Modo do chat por perto' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Pensar' }))
    fireEvent.change(screen.getByPlaceholderText('Mensagem...'), { target: { value: 'volto em 15 min' } })
    fireEvent.submit(screen.getByPlaceholderText('Mensagem...').closest('form')!)

    expect(onNearbyMessage).toHaveBeenCalledWith('volto em 15 min', 'thought')
    expect(screen.queryByText('volto em 15 min')).not.toBeInTheDocument()
    expect(screen.getByText('Sem mensagens por perto.')).toBeInTheDocument()
  })

  it('concentra a saída na toolbar', () => {
    const onLeave = vi.fn()
    renderMediaBar({ onLeave })

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao app — você continua no escritório' }))
    expect(onLeave).toHaveBeenCalledOnce()
  })

  it('mostra o alto-falante só para liderança com broadcast disponível', () => {
    const broadcast = broadcastState()
    const { rerender } = renderMediaBar({ broadcast, canBroadcast: false })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.queryByRole('menuitem', { name: /alto-falante/i })).not.toBeInTheDocument()

    rerender(
      <MediaBar
        media={mediaState()}
        zoneName={null}
        broadcast={broadcast}
        canBroadcast
        you={{ name: 'Lucca Secco' }}
        onLeave={vi.fn()}
        cameraBackground={cameraBackgroundState()}
        devices={devicesState()}
        audioOutputDeviceId={null}
        onSelectAudioOutput={vi.fn()}
      />,
    )
    const button = screen.getByRole('menuitem', { name: 'Ligar alto-falante' })
    fireEvent.click(button)
    expect(broadcast.toggleSpeaker).toHaveBeenCalledOnce()
  })

  it('com o alto-falante ligado, o botão inverte e o mic local fica desabilitado', () => {
    renderMediaBar({
      media: mediaState({ micEnabled: false }),
      broadcast: broadcastState({ speakerEnabled: true }),
      canBroadcast: true,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menuitem', { name: 'Desligar alto-falante' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar microfone' })).toBeDisabled()
  })

  it('erro ao ligar o alto-falante vira aviso', () => {
    renderMediaBar({ broadcast: broadcastState({ speakerError: true }), canBroadcast: true })
    expect(screen.getByText('Não foi possível ligar o alto-falante')).toBeInTheDocument()
  })

  it('os botões de sala só aparecem quando showRoomControls é true', () => {
    renderMediaBar()
    expect(screen.queryByRole('button', { name: 'Abrir chat da sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir pessoas da sala' })).not.toBeInTheDocument()
  })

  it('com showRoomControls, os botões de sala aparecem e chamam os callbacks', () => {
    const onToggleRoomChat = vi.fn()
    const onToggleRoomPeople = vi.fn()
    // O botão de chat da barra fica visível com `inMeetingRoom` sozinho (ver
    // comentário em `onToggleRoomChat`, OfficePage.tsx) — "pessoas da sala"
    // (no menu Mais) continua atrás de `showRoomControls`.
    renderMediaBar({ inMeetingRoom: true, showRoomControls: true, onToggleRoomChat, onToggleRoomPeople })

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(onToggleRoomChat).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Abrir pessoas da sala' }))
    expect(onToggleRoomPeople).toHaveBeenCalledOnce()
  })

  it('o botão do painel ativo mostra o rótulo de fechar', () => {
    renderMediaBar({ inMeetingRoom: true, showRoomControls: true, roomPanel: 'chat' })
    expect(screen.getByRole('button', { name: 'Fechar chat da sala' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menuitem', { name: 'Abrir pessoas da sala' })).toBeInTheDocument()
  })

  it('mostra bolinha de notificação no chat da sala quando há mensagem nova e o painel está fechado', () => {
    const { rerender } = renderMediaBar({ inMeetingRoom: true, showRoomControls: true, roomChatUnread: true })
    const chatButton = screen.getByRole('button', { name: 'Abrir chat da sala' })
    expect(chatButton.querySelector('.bg-error')).not.toBeNull()

    rerender(
      <MediaBar
        media={mediaState()}
        zoneName={null}
        broadcast={broadcastState()}
        canBroadcast={false}
        onLeave={vi.fn()}
        cameraBackground={cameraBackgroundState()}
        devices={devicesState()}
        audioOutputDeviceId={null}
        onSelectAudioOutput={vi.fn()}
        inMeetingRoom
        showRoomControls
        roomPanel="chat"
        roomChatUnread
      />,
    )
    expect(screen.getByRole('button', { name: 'Fechar chat da sala' }).querySelector('.bg-error')).toBeNull()
  })

  it('mostra a quantidade de mensagens novas no badge do chat da sala', () => {
    renderMediaBar({
      inMeetingRoom: true,
      showRoomControls: true,
      roomChatUnread: true,
      roomChatUnreadCount: 3,
    })
    const chatButton = screen.getByRole('button', { name: 'Abrir chat da sala' })
    expect(chatButton.querySelector('.bg-error')).toHaveTextContent('3')
  })

  it('passa de 9 mensagens novas o badge vira "9+"', () => {
    renderMediaBar({
      inMeetingRoom: true,
      showRoomControls: true,
      roomChatUnread: true,
      roomChatUnreadCount: 12,
    })
    expect(
      screen.getByRole('button', { name: 'Abrir chat da sala' }).querySelector('.bg-error'),
    ).toHaveTextContent('9+')
  })

  it('setinha de efeitos abre o painel de fundos sem afetar o toggle de câmera', () => {
    const media = mediaState()
    renderMediaBar({ media })

    fireEvent.click(screen.getByRole('button', { name: 'Efeitos de fundo da câmera' }))
    expect(screen.getByRole('menu', { name: 'Efeitos de fundo da câmera' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ligar câmera' }))
    expect(media.toggleCamera).toHaveBeenCalledOnce()
  })

  it('setinha desabilitada quando não há suporte', () => {
    renderMediaBar({ cameraBackground: cameraBackgroundState({ supported: false }) })
    const btn = screen.getByRole('button', { name: 'Efeitos de fundo da câmera' })
    expect(btn).toBeDisabled()
    expect(within(btn).getByRole('tooltip')).toHaveTextContent('Seu navegador não suporta efeitos de fundo')
  })

  it('erro de fundo mostra a pill', () => {
    renderMediaBar({ cameraBackground: cameraBackgroundState({ error: true }) })
    expect(screen.getByText('Não foi possível aplicar o fundo')).toBeInTheDocument()
  })

  it('sem canRaiseHand, o botão de levantar a mão não aparece', () => {
    renderMediaBar()
    expect(screen.queryByRole('button', { name: 'Levantar a mão' })).not.toBeInTheDocument()
  })

  it('com canRaiseHand, mostra o botão de levantar a mão e dispara onToggleRaiseHand', () => {
    const onToggleRaiseHand = vi.fn()
    renderMediaBar({ canRaiseHand: true, raised: false, onToggleRaiseHand })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    const button = screen.getByRole('menuitem', { name: 'Levantar a mão' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(onToggleRaiseHand).toHaveBeenCalledOnce()
  })

  it('com a mão levantada, o botão mostra "Abaixar a mão"', () => {
    renderMediaBar({ canRaiseHand: true, raised: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menuitem', { name: 'Abaixar a mão' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('fora de sala de reunião, o cadeado não aparece', () => {
    renderMediaBar()
    expect(screen.queryByRole('button', { name: 'Trancar sala' })).not.toBeInTheDocument()
  })

  it('na sala, mostra o cadeado e dispara onToggleRoomLock', () => {
    const onToggleRoomLock = vi.fn()
    renderMediaBar({ canLockRoom: true, roomLocked: false, onToggleRoomLock })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    const button = screen.getByRole('menuitem', { name: 'Trancar sala' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(onToggleRoomLock).toHaveBeenCalledOnce()
  })

  it('com a sala trancada, o cadeado vira "Destrancar sala"', () => {
    renderMediaBar({ canLockRoom: true, roomLocked: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menuitem', { name: 'Destrancar sala' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a setinha do microfone abre o menu de entradas de áudio; escolher uma chama setAudioInputDevice', () => {
    const media = mediaState({ audioInputDeviceId: null })
    renderMediaBar({
      media,
      devices: devicesState({ audioInputs: [{ deviceId: 'mic1', label: 'Mic USB' }] }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Escolher microfone' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Mic USB/ }))

    expect(media.setAudioInputDevice).toHaveBeenCalledWith('mic1')
  })

  it('botão de saída de áudio some quando o navegador não suporta setSinkId', () => {
    renderMediaBar({ devices: devicesState({ supportsAudioOutputSelection: false }) })
    expect(screen.queryByRole('button', { name: 'Escolher saída de áudio' })).not.toBeInTheDocument()
  })

  it('botão de saída de áudio abre o menu de saídas; escolher uma chama onSelectAudioOutput', () => {
    const onSelectAudioOutput = vi.fn()
    renderMediaBar({
      onSelectAudioOutput,
      devices: devicesState({ audioOutputs: [{ deviceId: 'out1', label: 'Fone' }] }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Escolher saída de áudio' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fone/ }))

    expect(onSelectAudioOutput).toHaveBeenCalledWith('out1')
  })

  it('o menu de câmera recebe os dispositivos de vídeo e chama setVideoInputDevice ao escolher um', () => {
    const media = mediaState({ videoInputDeviceId: null })
    renderMediaBar({
      media,
      devices: devicesState({ videoInputs: [{ deviceId: 'cam1', label: 'Webcam' }] }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Efeitos de fundo da câmera' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Webcam/ }))

    expect(media.setVideoInputDevice).toHaveBeenCalledWith('cam1')
  })

  it('o container principal usa os tokens de tema surface/primary-container', () => {
    renderMediaBar()
    const container = screen.getByRole('button', { name: 'Ativar microfone' }).closest('div.rounded-full')
    expect(container).toHaveClass('bg-surface/70')
    expect(container).toHaveClass('border-primary-container/20')
  })

  it('compartilhar tela inativo fica neutro, com o destaque neon só no hover (highlightButtonCls)', () => {
    renderMediaBar()
    const button = screen.getByRole('button', { name: 'Compartilhar tela' })
    // Em token, e não em branco cravado: a barra é um pill que segue a
    // superfície da empresa, e num tenant de tema claro o branco sumia dentro
    // dela. O que este teste trava é o estado NEUTRO, não o hex.
    expect(button).toHaveClass('border-outline-variant')
    expect(button).toHaveClass('bg-surface-container-high')
    expect(button).toHaveClass('text-on-surface-variant')
    expect(button).toHaveClass('hover:border-primary-container/30')
    expect(button).toHaveClass('hover:bg-primary-container/10')
    expect(button).not.toHaveClass('border-primary-container/40')
  })

  it('compartilhar tela ativo mantém o destaque neon persistente (highlightButtonCls)', () => {
    renderMediaBar({ media: mediaState({ screenShareEnabled: true }) })
    const button = screen.getByRole('button', { name: 'Parar de compartilhar' })
    expect(button).toHaveClass('border-primary-container/40')
    expect(button).toHaveClass('bg-primary-container/20')
    expect(button).toHaveClass('shadow-[0_0_15px_rgb(var(--brand-primary,37 222 136)/0.3)]')
  })

  it('o botão Mais abre o menu com Reagir e Chat por perto sempre disponíveis', () => {
    renderMediaBar()
    expect(screen.queryByRole('menu', { name: 'Mais opções' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menu', { name: 'Mais opções' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Reagir' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Abrir chat por perto' })).toBeInTheDocument()
  })

  it('fora de uma sala de reunião, não tem botão fixo de Reagir na barra (só no menu Mais)', () => {
    renderMediaBar({ inMeetingRoom: false })
    expect(screen.queryByRole('button', { name: 'Reagir' })).not.toBeInTheDocument()
  })

  it('numa sala de reunião, Reagir ganha botão fixo na barra e abre o seletor de reações', () => {
    renderMediaBar({ inMeetingRoom: true })
    expect(screen.queryByRole('button', { name: 'Reagir com 👋' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reagir' }))
    expect(screen.getByRole('button', { name: 'Reagir com 👋' })).toBeInTheDocument()

    // some do menu Mais nesse mesmo estado — não fica duplicado.
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.queryByRole('menuitem', { name: 'Reagir' })).not.toBeInTheDocument()
  })

  it('sem canAnnotate, não mostra o botão de riscar', () => {
    renderMediaBar({ canAnnotate: false })
    expect(screen.queryByRole('button', { name: 'Riscar na tela' })).not.toBeInTheDocument()
  })

  it('com canAnnotate, o botão de riscar chama onToggleAnnotate', () => {
    const onToggleAnnotate = vi.fn()
    renderMediaBar({ canAnnotate: true, annotating: false, onToggleAnnotate })
    fireEvent.click(screen.getByRole('button', { name: 'Riscar na tela' }))
    expect(onToggleAnnotate).toHaveBeenCalledOnce()
  })

  it('com annotating ativo, o botão de riscar mostra "Parar de riscar"', () => {
    renderMediaBar({ canAnnotate: true, annotating: true })
    expect(screen.getByRole('button', { name: 'Parar de riscar' })).toBeInTheDocument()
  })

  it('numa sala de reunião com chat e riscar disponíveis, a ordem é compartilhar/reações/chat/riscar', () => {
    renderMediaBar({ inMeetingRoom: true, showRoomControls: true, canAnnotate: true })
    const order = [
      screen.getByRole('button', { name: 'Compartilhar tela' }),
      screen.getByRole('button', { name: 'Reagir' }),
      screen.getByRole('button', { name: 'Abrir chat da sala' }),
      screen.getByRole('button', { name: 'Riscar na tela' }),
    ]
    for (let i = 0; i < order.length - 1; i++) {
      // eslint-disable-next-line no-bitwise
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('Esc fecha o menu Mais', () => {
    renderMediaBar()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menu', { name: 'Mais opções' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Mais opções' })).not.toBeInTheDocument()
  })
  it('na sala de silêncio o rótulo explica o silêncio em vez de dizer que o áudio caiu', () => {
    // Sem sala de voz, `status` é 'off' — o rótulo padrão diria "Áudio
    // desligado" e o tooltip mandaria "entrar no escritório", onde a pessoa já está.
    renderMediaBar({
      media: mediaState({ status: 'off', roomName: null }),
      zoneName: 'Área de silêncio',
      silenced: true,
      micLocked: true,
    })

    expect(screen.getByText('Área de silêncio — sem som')).toBeInTheDocument()
    expect(screen.queryByText('Áudio desligado')).not.toBeInTheDocument()
    expect(screen.getByText('Microfone desativado na área de silêncio')).toBeInTheDocument()
  })
})
