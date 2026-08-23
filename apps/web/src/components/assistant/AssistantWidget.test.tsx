import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const mockAuth = vi.hoisted(() => ({
  role: 'LEGEND' as string,
  sectorFeatures: ['assistente'] as string[],
  enabledFeatures: [] as string[],
}))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      name: 'Pessoa',
      role: mockAuth.role,
      sectorFeatures: mockAuth.sectorFeatures,
      enabledFeatures: mockAuth.enabledFeatures,
    },
  }),
}))

import { AssistantWidget } from './AssistantWidget'

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AssistantWidget />
    </QueryClientProvider>,
  )
}

const TURNO_1 = {
  conversation: {
    id: 'c1',
    agent: 'assistant',
    title: 'quantos dias de férias?',
    messageCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    messages: [
      { id: 'm1', role: 'user', content: 'quantos dias de férias?', createdAt: '2026-01-01T00:00:00.000Z' },
      {
        id: 'm2',
        role: 'assistant',
        content: 'São 30 dias corridos após 12 meses.',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ],
  },
  queryId: 'q1',
}

/** Mocka os três endpoints que o widget consome, por caminho. */
function mockApi(chatResponse: unknown = TURNO_1) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === '/assistant/persona') return Promise.resolve({ name: 'Assistente de RH' })
    if (path === '/assistant/chat') return Promise.resolve(chatResponse)
    if (path.startsWith('/assistant/queries/')) return Promise.resolve(undefined)
    return Promise.resolve(undefined)
  })
}

beforeEach(() => {
  apiFetchMock.mockReset()
  mockAuth.role = 'LEGEND'
  mockAuth.sectorFeatures = ['assistente']
  mockAuth.enabledFeatures = []
})

describe('AssistantWidget', () => {
  it('não aparece para quem não tem a feature', () => {
    mockAuth.sectorFeatures = []
    mockApi()
    renderWidget()
    expect(screen.queryByRole('button', { name: /assistente/i })).toBeNull()
  })

  it('aparece para admin mesmo sem a feature ligada no setor', () => {
    mockAuth.sectorFeatures = []
    mockAuth.role = 'ADMIN'
    mockApi()
    renderWidget()
    expect(screen.getByRole('button', { name: /assistente/i })).toBeTruthy()
  })

  it('aparece para terceirizado com a feature na allowlist individual', () => {
    mockAuth.role = 'THIRD_PARTY'
    mockAuth.sectorFeatures = []
    mockAuth.enabledFeatures = ['assistente']
    mockApi()
    renderWidget()
    expect(screen.getByRole('button', { name: /assistente/i })).toBeTruthy()
  })

  it('manda a pergunta e mostra a resposta da conversa', async () => {
    mockApi()
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByPlaceholderText('Pergunte algo...'), {
      target: { value: 'quantos dias de férias?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(await screen.findByText('São 30 dias corridos após 12 meses.')).toBeTruthy()
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/assistant/chat',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renderiza a resposta estruturada: rótulo em negrito e um item por linha', async () => {
    // É o formato que o prompt pede ao modelo (ver `assistant-prompt.ts`) e o
    // que o portal EMR mostra. Sem negrito e sem quebra, a resposta chega como
    // um parágrafo corrido dentro da bolha.
    const estruturada = {
      ...TURNO_1,
      conversation: {
        ...TURNO_1.conversation,
        messages: [
          TURNO_1.conversation.messages[0],
          {
            ...TURNO_1.conversation.messages[1],
            content:
              '- **Elegibilidade:** CLT após 1 ano de admissão.\n- **Formatos:** 30 dias corridos; 20 + 10 de abono.',
          },
        ],
      },
    }
    mockApi(estruturada)
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByPlaceholderText('Pergunte algo...'), {
      target: { value: 'como funcionam as férias?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    const negrito = await screen.findByText('Elegibilidade:')
    expect(negrito.tagName).toBe('STRONG')
    expect(screen.getByText('Formatos:').tagName).toBe('STRONG')
    // Lista de verdade: cada item é um <li>, e não um hífen solto no texto.
    const item = negrito.closest('li')
    expect(item).not.toBeNull()
    expect(item!.closest('ul')!.querySelectorAll('li')).toHaveLength(2)
  })

  it('renderiza lista marcada com asterisco, que é o que o Gemini devolve', async () => {
    const comAsterisco = {
      ...TURNO_1,
      conversation: {
        ...TURNO_1.conversation,
        messages: [
          TURNO_1.conversation.messages[0],
          {
            ...TURNO_1.conversation.messages[1],
            content: '*   **Programação:** junto com a liderança.\n*   **Elegibilidade:** CLT após 1 ano.',
          },
        ],
      },
    }
    mockApi(comAsterisco)
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByPlaceholderText('Pergunte algo...'), { target: { value: 'férias' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    const item = (await screen.findByText('Programação:')).closest('li')
    expect(item).not.toBeNull()
    // O asterisco vira marcador da lista, não caractere visível na bolha.
    expect(item!.textContent).not.toContain('*')
  })

  it('mensagem de quem pergunta não é interpretada como marcação', async () => {
    mockApi()
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByPlaceholderText('Pergunte algo...'), {
      target: { value: '- **teste**' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(await screen.findByText('- **teste**')).toBeTruthy()
  })

  it('reinicia a conversa ao clicar em "Iniciar novo chat"', async () => {
    mockApi()
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByPlaceholderText('Pergunte algo...'), { target: { value: 'férias?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await screen.findByText('São 30 dias corridos após 12 meses.')

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar novo chat' }))

    expect(screen.queryByText('São 30 dias corridos após 12 meses.')).toBeNull()
  })

  it('envia o feedback negativo com comentário', async () => {
    mockApi()
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByPlaceholderText('Pergunte algo...'), { target: { value: 'férias?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await screen.findByText('São 30 dias corridos após 12 meses.')

    fireEvent.click(screen.getByRole('button', { name: 'Resposta não útil' }))
    fireEvent.change(await screen.findByPlaceholderText('Conte o que poderia ser melhor (opcional)'), {
      target: { value: 'faltou o período aquisitivo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }))

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/assistant/queries/q1/feedback',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('mostra a mensagem da API quando estoura o limite por hora', async () => {
    const { ApiError } = await import('../../lib/api')
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/assistant/persona') return Promise.resolve({ name: 'Assistente de RH' })
      if (path === '/assistant/chat')
        return Promise.reject(new ApiError(429, 'Você já fez 20 perguntas na última hora.'))
      return Promise.resolve(undefined)
    })
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByPlaceholderText('Pergunte algo...'), { target: { value: 'férias?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(await screen.findByText('Você já fez 20 perguntas na última hora.')).toBeTruthy()
  })

  it('desabilita "Enviar comentário" enquanto o feedback está em voo, evitando duplo clique', async () => {
    mockApi()
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByPlaceholderText('Pergunte algo...'), { target: { value: 'férias?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await screen.findByText('São 30 dias corridos após 12 meses.')

    fireEvent.click(screen.getByRole('button', { name: 'Resposta não útil' }))
    await screen.findByPlaceholderText('Conte o que poderia ser melhor (opcional)')

    let resolveFeedback: (() => void) | undefined
    apiFetchMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFeedback = () => resolve()
        }),
    )
    const botaoEnviar = screen.getByRole('button', { name: 'Enviar comentário' })
    fireEvent.click(botaoEnviar)

    // Desabilitado durante o envio: um segundo clique não dispara outra chamada,
    // que é o que hoje deixa o find-then-create do service estourar o @unique.
    await waitFor(() => expect(botaoEnviar).toBeDisabled())

    resolveFeedback?.()
    await waitFor(() => expect(botaoEnviar).not.toBeDisabled())
  })
})
