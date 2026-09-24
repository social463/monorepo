import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CorporatePostPollDTO } from '@legends/shared'
import { CorporatePostPollCard } from './CorporatePostPollCard'
import * as hooks from '../../lib/use-corporate-mural'

const votar = vi.fn()

function mockHooks(overrides: { isError?: boolean; data?: unknown } = {}) {
  vi.spyOn(hooks, 'useVoteCorporatePostPoll').mockReturnValue({
    mutate: votar,
    isPending: false,
    isError: overrides.isError ?? false,
    error: overrides.isError ? new Error('Você já votou nesta enquete.') : null,
    data: overrides.data,
  } as never)
  vi.spyOn(hooks, 'useCorporatePostPollVotes').mockReturnValue({
    data: {
      pollId: 'p1',
      question: 'Qual logo?',
      totalVotes: 1,
      options: [
        { optionId: 'o1', text: 'Azul', voters: [] },
        {
          optionId: 'o2',
          text: 'Verde',
          voters: [
            { id: 'u1', name: 'Ana Souza', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
          ],
        },
      ],
    },
    isLoading: false,
    isError: false,
  } as never)
}

function poll(overrides: Partial<CorporatePostPollDTO> = {}): CorporatePostPollDTO {
  return {
    id: 'p1',
    question: 'Qual logo?',
    hasVoted: false,
    selectedOptionId: null,
    totalVotes: null,
    canVote: true,
    options: [
      { id: 'o1', text: 'Azul', voteCount: null, percentage: null },
      { id: 'o2', text: 'Verde', voteCount: null, percentage: null },
    ],
    ...overrides,
  }
}

function renderCard(p: CorporatePostPollDTO) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CorporatePostPollCard postId="post-1" poll={p} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  votar.mockReset()
  mockHooks()
})

describe('CorporatePostPollCard', () => {
  // O resultado é escondido pela API, não pela tela: antes do voto o DTO chega
  // com contagem e percentual nulos, e não há o que renderizar.
  it('não mostra resultado antes do voto, e envia a opção escolhida', async () => {
    renderCard(poll())

    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(screen.queryByText(/total:/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Verde' }))
    fireEvent.click(screen.getByRole('button', { name: 'Votar' }))

    await waitFor(() => expect(votar).toHaveBeenCalledWith({ postId: 'post-1', optionId: 'o2' }))
  })

  it('depois do voto mostra percentual, contagem e a escolha marcada', () => {
    renderCard(
      poll({
        hasVoted: true,
        selectedOptionId: 'o2',
        totalVotes: 3,
        options: [
          { id: 'o1', text: 'Azul', voteCount: 1, percentage: 33 },
          { id: 'o2', text: 'Verde', voteCount: 2, percentage: 67 },
        ],
      }),
    )

    expect(screen.getByText('33% (1)')).toBeInTheDocument()
    expect(screen.getByText('67% (2)')).toBeInTheDocument()
    expect(screen.getByText('Total: 3 votos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Votar' })).not.toBeInTheDocument()
  })

  // No Feed, quem modera enxerga post fora do próprio alcance. Ele vê a
  // enquete, mas não vota — e a tela precisa dizer por quê, em vez de oferecer
  // um botão que a API recusa.
  it('sem permissão de voto, não há botão Votar e a razão aparece', () => {
    renderCard(poll({ canVote: false }))

    expect(screen.queryByRole('button', { name: 'Votar' })).not.toBeInTheDocument()
    expect(screen.getByText(/de outro público/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Azul' })).toBeDisabled()
  })

  it('"Ver votos" lista quem votou, agrupado por opção', async () => {
    renderCard(poll({ hasVoted: true, selectedOptionId: 'o2', totalVotes: 1 }))

    fireEvent.click(screen.getByRole('button', { name: /ver votos/i }))

    expect(await screen.findByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('Azul · 0')).toBeInTheDocument()
  })

  it('erro do voto aparece sem derrubar a enquete', () => {
    mockHooks({ isError: true })
    renderCard(poll())

    expect(screen.getByRole('alert')).toHaveTextContent('Você já votou nesta enquete.')
    expect(screen.getByRole('button', { name: 'Votar' })).toBeInTheDocument()
  })
})
