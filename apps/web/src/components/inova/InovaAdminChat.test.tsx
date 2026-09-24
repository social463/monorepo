import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { InovaAdminChat } from './InovaAdminChat'
import * as inovaApi from '../../lib/inova-api'

vi.mock('../../lib/inova-api')

function renderChat(props: { projectIds?: string[]; scopeLabel?: string } = {}) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <InovaAdminChat {...props} />
    </QueryClientProvider>,
  )
}

const RESPOSTA = {
  conversation: {
    id: 'c1',
    agent: 'inova' as const,
    title: 'oi',
    messageCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [
      { id: 'm1', role: 'user' as const, content: 'oi', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', role: 'assistant' as const, content: '- **Marketing** avançou mais', createdAt: '2026-01-01T00:00:01.000Z' },
    ],
  },
}

describe('InovaAdminChat', () => {
  it('mostra as sugestões de pergunta quando não há conversa', async () => {
    vi.mocked(inovaApi.listInovaAdminChatConversations).mockResolvedValue({ conversations: [] })

    renderChat()

    await waitFor(() => expect(screen.getByText('O que mudou de abril para maio?')).toBeInTheDocument())
  })

  it('envia a pergunta e mostra a resposta', async () => {
    vi.mocked(inovaApi.listInovaAdminChatConversations).mockResolvedValue({ conversations: [] })
    vi.mocked(inovaApi.askInovaAdminChat).mockResolvedValue({
      conversation: {
        id: 'c1',
        agent: 'inova',
        title: 'oi',
        messageCount: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          { id: 'm1', role: 'user', content: 'oi', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'm2', role: 'assistant', content: 'Olá! Como posso ajudar?', createdAt: '2026-01-01T00:00:01.000Z' },
        ],
      },
    })

    renderChat()
    await waitFor(() => expect(screen.getByPlaceholderText(/Ex\.:/)).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/Ex\.:/), 'oi')
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }))

    await waitFor(() => expect(screen.getByText('Olá! Como posso ajudar?')).toBeInTheDocument())
  })

  it('mostra erro do backend quando a IA falha', async () => {
    vi.mocked(inovaApi.listInovaAdminChatConversations).mockResolvedValue({ conversations: [] })
    const { ApiError } = await import('../../lib/api')
    vi.mocked(inovaApi.askInovaAdminChat).mockRejectedValue(new ApiError(503, 'Agente de IA não configurado.'))

    renderChat()
    await waitFor(() => expect(screen.getByPlaceholderText(/Ex\.:/)).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/Ex\.:/), 'oi')
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }))

    await waitFor(() => expect(screen.getByText('Agente de IA não configurado.')).toBeInTheDocument())
  })

  it('mostra a resposta da IA como Markdown, sem os marcadores crus', async () => {
    vi.mocked(inovaApi.listInovaAdminChatConversations).mockResolvedValue({ conversations: [] })
    vi.mocked(inovaApi.askInovaAdminChat).mockResolvedValue(RESPOSTA)

    renderChat()
    await userEvent.type(await screen.findByPlaceholderText(/Ex\.:/), 'oi')
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }))

    const negrito = await screen.findByText('Marketing')
    expect(negrito.tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*Marketing\*\*/)).not.toBeInTheDocument()
  })

  it('manda o recorte do painel junto com a pergunta', async () => {
    vi.mocked(inovaApi.listInovaAdminChatConversations).mockResolvedValue({ conversations: [] })
    vi.mocked(inovaApi.askInovaAdminChat).mockResolvedValue(RESPOSTA)

    renderChat({ projectIds: ['p1', 'p2'], scopeLabel: 'Marketing' })
    expect(await screen.findByText(/Analisando o recorte do painel: Marketing/)).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/Ex\.:/), 'oi')
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }))

    await waitFor(() =>
      expect(inovaApi.askInovaAdminChat).toHaveBeenCalledWith({ message: 'oi', projectIds: ['p1', 'p2'] }),
    )
  })

  it('"Nova conversa" volta para a tela em branco com as sugestões', async () => {
    vi.mocked(inovaApi.listInovaAdminChatConversations).mockResolvedValue({ conversations: [] })
    vi.mocked(inovaApi.askInovaAdminChat).mockResolvedValue(RESPOSTA)

    renderChat()
    await userEvent.type(await screen.findByPlaceholderText(/Ex\.:/), 'oi')
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await screen.findByText('Marketing')
    expect(screen.queryByText('O que mudou de abril para maio?')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /nova conversa/i }))

    expect(screen.getByText('O que mudou de abril para maio?')).toBeInTheDocument()
    expect(screen.queryByText('Marketing')).not.toBeInTheDocument()
  })
})
