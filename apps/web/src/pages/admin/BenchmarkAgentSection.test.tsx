import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AgentConversationDTO, BenchmarkPracticeDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { BenchmarkAgentSection } from './BenchmarkAgentSection'

const askAgent = vi.fn()
const listAgentConversations = vi.fn()
const getAgentConversation = vi.fn()
const listBenchmarkPractices = vi.fn()
const createBenchmarkPractice = vi.fn()
const deleteBenchmarkPractice = vi.fn()

vi.mock('../../lib/agent-api', () => ({
  askAgent: (agent: string, body: unknown) => askAgent(agent, body),
  listAgentConversations: (agent: string) => listAgentConversations(agent),
  getAgentConversation: (agent: string, id: string) => getAgentConversation(agent, id),
  listBenchmarkPractices: () => listBenchmarkPractices(),
  createBenchmarkPractice: (body: unknown) => createBenchmarkPractice(body),
  deleteBenchmarkPractice: (id: string) => deleteBenchmarkPractice(id),
}))

const practice = (over: Partial<BenchmarkPracticeDTO> = {}): BenchmarkPracticeDTO => ({
  id: 'p1',
  category: 'Reconhecimento',
  title: 'Day off de aniversário',
  description: 'Folga no mês do aniversário',
  channel: 'Teams',
  tags: ['mensal'],
  createdById: 'u1',
  createdByName: 'Ana',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  ...over,
})

const conversation = (over: Partial<AgentConversationDTO> = {}): AgentConversationDTO => ({
  id: 'c1',
  agent: 'benchmark',
  title: 'Benchmark de saúde mental',
  messageCount: 2,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  messages: [
    { id: 'm1', role: 'user', content: 'Benchmark de saúde mental', createdAt: '2026-08-01T12:00:00.000Z' },
    {
      id: 'm2',
      role: 'assistant',
      content: '## Resumo executivo\n\n| Empresa | Ação |\n|---|---|\n| Nubank | Terapia |',
      createdAt: '2026-08-01T12:00:01.000Z',
    },
  ],
  ...over,
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BenchmarkAgentSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listBenchmarkPractices.mockResolvedValue({ practices: [] })
  listAgentConversations.mockResolvedValue({ conversations: [] })
  askAgent.mockResolvedValue({ conversation: conversation() })
  getAgentConversation.mockResolvedValue({ conversation: conversation() })
})

describe('BenchmarkAgentSection', () => {
  it('envia a pergunta e renderiza a resposta em markdown, com tabela', async () => {
    renderSection()

    await userEvent.type(screen.getByLabelText('Pergunta para o agente'), 'Benchmark de saúde mental')
    await userEvent.click(screen.getByLabelText('Enviar pergunta'))

    await waitFor(() => expect(askAgent).toHaveBeenCalledWith('benchmark', { message: 'Benchmark de saúde mental' }))

    expect(await screen.findByText('Resumo executivo')).toBeInTheDocument()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(await screen.findByRole('columnheader', { name: 'Empresa' })).toBeInTheDocument()
  })

  it('continua a conversa mandando o conversationId', async () => {
    renderSection()

    await userEvent.type(screen.getByLabelText('Pergunta para o agente'), 'Primeira')
    await userEvent.click(screen.getByLabelText('Enviar pergunta'))
    await waitFor(() => expect(askAgent).toHaveBeenCalledTimes(1))

    await userEvent.type(screen.getByLabelText('Pergunta para o agente'), 'Segunda')
    await userEvent.click(screen.getByLabelText('Enviar pergunta'))

    await waitFor(() =>
      expect(askAgent).toHaveBeenLastCalledWith('benchmark', { message: 'Segunda', conversationId: 'c1' }),
    )
  })

  it('erro da IA vira mensagem na tela, não tela quebrada', async () => {
    askAgent.mockRejectedValue(
      new ApiError(429, 'Limite de requisições da IA atingido. Tente novamente em instantes.'),
    )
    renderSection()

    await userEvent.type(screen.getByLabelText('Pergunta para o agente'), 'Pergunta')
    await userEvent.click(screen.getByLabelText('Enviar pergunta'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Limite de requisições da IA atingido')
    // O campo de pergunta continua utilizável.
    expect(screen.getByLabelText('Pergunta para o agente')).toBeEnabled()
  })

  it('agente não configurado explica o que fazer', async () => {
    askAgent.mockRejectedValue(
      new ApiError(
        503,
        'Agente de IA não configurado. Peça a um administrador para cadastrar a chave da API em Administração › Inteligência Artificial.',
      ),
    )
    renderSection()

    await userEvent.type(screen.getByLabelText('Pergunta para o agente'), 'Pergunta')
    await userEvent.click(screen.getByLabelText('Enviar pergunta'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Agente de IA não configurado')
  })

  it('aba de práticas lista o inventário e cadastra uma nova', async () => {
    listBenchmarkPractices.mockResolvedValue({ practices: [practice()] })
    createBenchmarkPractice.mockResolvedValue({ practice: practice({ id: 'p2', title: 'Nova' }) })
    renderSection()

    await userEvent.click(await screen.findByRole('tab', { name: /Práticas internas \(1\)/ }))
    expect(screen.getByText('Day off de aniversário')).toBeInTheDocument()
    expect(screen.getByText('#mensal')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Título da prática'), 'Café com a liderança')
    await userEvent.type(screen.getByLabelText('Tags da prática'), 'mensal, presencial')
    await userEvent.click(screen.getByLabelText('Adicionar prática'))

    await waitFor(() =>
      expect(createBenchmarkPractice).toHaveBeenCalledWith({
        category: 'Cultura organizacional',
        title: 'Café com a liderança',
        description: null,
        channel: null,
        tags: ['mensal', 'presencial'],
      }),
    )
  })

  it('inventário vazio explica para que serve cadastrar', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('tab', { name: /Práticas internas \(0\)/ }))
    expect(screen.getByText(/Nenhuma prática cadastrada ainda/)).toBeInTheDocument()
  })
})
