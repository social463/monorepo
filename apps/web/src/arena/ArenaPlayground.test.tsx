import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

// A cena traz o Phaser junto (import estático), e o Phaser não sobe em jsdom.
// Aqui o que se testa é o COMPONENTE — se ele monta, ou se explode e leva a
// árvore inteira com ele (que é como uma tela fica preta em produção).
vi.mock('phaser', () => ({
  default: {
    Game: class {
      scale = { resize() {} }
      destroy() {}
    },
    Scale: { RESIZE: 0 },
    AUTO: 0,
  },
}))
/** A última cena montada — é por ela que o teste finge a chegada do servidor. */
let cena: { ready?: () => void; inputEnabled: boolean } | null = null
vi.mock('./ArenaScene', () => ({
  ArenaScene: class {
    ready?: () => void
    inputEnabled = true
    constructor() {
      cena = this as unknown as { ready?: () => void; inputEnabled: boolean }
    }
    setSpeed() {}
    setShowCollision() {}
    setDebugListener() {}
    setZoomListener() {}
    setMatchListener() {}
    setReadyListener(listener: () => void) {
      this.ready = listener
    }
    setSender() {}
    setMinimapListener() {}
    setGoalListener() {}
    setRaceNoticeListener() {}
    setInputEnabled(enabled: boolean) {
      this.inputEnabled = enabled
    }
    presence() {
      return { youId: 'u1', you: { x: 0, y: 0 }, outros: [] }
    }
    getScreenPosition() {
      return { x: 10, y: 10, zoom: 2 }
    }
    resetForNewSession() {}
    handleServerMessage() {}
  },
}))
/** O saguão tem socket e mídia próprios — aqui só importa que ele aparece. */
vi.mock('./useArenaLobbySocket', () => ({
  useArenaLobbySocket: () => ({ connected: true, send: vi.fn() }),
}))
const mediaStub = {
  status: 'connected' as const,
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
}
vi.mock('./media/useArenaMedia', () => ({ useArenaMedia: () => mediaStub }))
vi.mock('./useArenaSocket', () => ({
  useArenaSocket: () => ({ connected: false, send: vi.fn() }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana', avatarStyle: null, avatarSeed: null, avatarOptions: null },
  }),
}))
import { ArenaPlayground } from './ArenaPlayground'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ArenaPlayground />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ArenaPlayground', () => {
  // O cenário é GERADO (`arenaMapDocument`), não buscado: a página não depende
  // de mapa publicado nem de rede para desenhar.
  // A tela abre no MENU: entrar em campo só porque a página carregou poria a
  // pessoa numa partida antes de ela escolher o que quer jogar.
  it('abre no menu de modos, sem conectar', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: /mata-mata/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pegue a bandeira/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /futebol/i })).toBeInTheDocument()
  })

  // O futebol é o modo para quem não quer atirar — o cartão precisa dizer
  // isso antes de a pessoa entrar em campo e procurar o gatilho.
  it('o cartão do futebol promete bola, não tiro', async () => {
    renderPage()

    const cartao = await screen.findByRole('button', { name: /futebol/i })
    expect(cartao).toHaveTextContent(/sem tiro/i)
    // Os dois gestos de pé, e onde eles estão: mouse E teclado.
    expect(cartao).toHaveTextContent(/chuta/i)
    expect(cartao).toHaveTextContent(/passa/i)
  })

  // A corrida é o segundo modo sem tiro, e o único em que os controles NÃO são
  // os do resto do produto: o cartão é o único lugar onde isso cabe antes de a
  // pessoa estar numa curva descobrindo que W não é "para cima".
  it('o cartão da corrida promete pilotagem e explica os controles', async () => {
    renderPage()

    const cartao = await screen.findByRole('button', { name: /corrida de kart/i })
    expect(cartao).toHaveTextContent(/sem tiro/i)
    expect(cartao).toHaveTextContent(/acelera/i)
    expect(cartao).toHaveTextContent(/freio de mão/i)
    // Desatolar precisa estar escrito: sem abate não há renascimento, e um kart
    // preso na barreira não tem outra saída.
    expect(cartao).toHaveTextContent(/desatola/i)
  })

  it('o menu oferece a volta ao escritório', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: /voltar ao escritório/i })).toBeInTheDocument()
  })

  // O intervalo entre escolher o modo e o servidor responder é onde o
  // personagem andava sozinho e era puxado de volta. Agora é carregamento.
  it('escolher um modo leva ao carregamento, não direto ao jogo', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /mata-mata/i }))

    expect(await screen.findByText(/entrando na arena/i)).toBeInTheDocument()
  })

  // Sem a saída a arena vira beco sem volta: é o único controle que não pode
  // sumir junto com o painel de depuração.
  // O diagnóstico fica escondido: a tela é do jogo, não da ferramenta. Mas ele
  // continua alcançável — foi o contador de pendentes que denunciou a arena
  // muda, e vai ser preciso de novo.
  it('o diagnóstico só aparece com F3', async () => {
    renderPage()
    await screen.findByRole('button', { name: /mata-mata/i })

    expect(screen.queryByText(/pendente/i)).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'F3' })
    expect(await screen.findByText(/pendente/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'F3' })
    expect(screen.queryByText(/pendente/i)).not.toBeInTheDocument()
  })

  // A rota fica FORA do AppLayout, então nada acima dela dá altura. Com
  // `h-full` o contêiner nasce com 0px e o `overflow-hidden` corta a tela
  // inteira — foi exatamente assim que ela ficou preta.
  it('a raiz tem altura de viewport própria', async () => {
    const { container } = renderPage()
    await screen.findByRole('button', { name: /mata-mata/i })

    await waitFor(() => {
      const root = container.firstElementChild as HTMLElement
      expect(root.className).toContain('h-screen')
      expect(root.className).not.toContain('h-full')
    })
  })
  // O menu É o saguão: quem está esperando para jogar pode conversar por texto
  // e por voz, em vez de olhar para uma tela de espera sozinho.
  it('o menu traz o saguão junto dos modos', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: /mata-mata/i })).toBeInTheDocument()
    expect(screen.getByText('Chat do saguão')).toBeInTheDocument()
  })

  it('em campo, a barra de voz e câmera aparece', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /mata-mata/i }))
    // O servidor respondeu: é o `ready` da cena que tira a tela de carregamento.
    await waitFor(() => expect(cena?.ready).toBeTypeOf('function'))
    act(() => cena?.ready?.())

    expect(await screen.findByRole('button', { name: 'Ligar microfone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ligar câmera' })).toBeInTheDocument()
  })

  /**
   * Digitar "was" com a cena ouvindo sairia andando — e o `addCapture` do WASD
   * engoliria as próprias letras antes de elas chegarem ao campo.
   */
  it('o foco no chat cala o teclado da cena', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /mata-mata/i }))
    await waitFor(() => expect(cena?.ready).toBeTypeOf('function'))
    act(() => cena?.ready?.())

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir chat' }))
    const campo = await screen.findByRole('textbox')

    fireEvent.focus(campo)
    expect(cena?.inputEnabled).toBe(false)

    fireEvent.blur(campo)
    expect(cena?.inputEnabled).toBe(true)
  })
})
