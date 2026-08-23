import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { LeadershipOverviewDTO } from '@legends/shared'
import { TeamIndicatorsTab } from './TeamIndicatorsTab'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function overviewFixture(patch: Partial<LeadershipOverviewDTO> = {}): LeadershipOverviewDTO {
  return {
    range: '30d',
    teamSize: 3,
    mood: {
      entries: 12,
      participants: 2,
      average: 4.2,
      distribution: [
        { key: 'HARD', label: 'Estressado(a)', count: 1 },
        { key: 'GREAT', label: 'Ótimo(a)', count: 11 },
      ],
      trend: [
        { day: '2026-06-23', average: 4, entries: 3 },
        { day: '2026-06-24', average: null, entries: 0 },
        { day: '2026-06-25', average: 4.5, entries: 9 },
      ],
    },
    feedbacks: { written: 7, received: 5 },
    topScreens: [
      { path: '/mural', label: 'Mural da empresa', accesses: 40, uniqueUsers: 3 },
      { path: '/votacao', label: 'Votação', accesses: 10, uniqueUsers: 2 },
    ],
    scores: {
      average: 350,
      perPerson: [
        { userId: 'u1', name: 'Ana Ribeiro', points: 600 },
        { userId: 'u2', name: 'Bruno Tavares', points: 450 },
        { userId: 'u3', name: 'Carla Menezes', points: 0 },
      ],
    },
    ...patch,
  }
}

/** O Select é um combobox próprio (não um `<select>` nativo). */
async function pickOption(comboboxName: string, optionName: string) {
  await userEvent.click(screen.getByRole('combobox', { name: comboboxName }))
  await userEvent.click(await screen.findByRole('option', { name: optionName }))
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TeamIndicatorsTab />
    </QueryClientProvider>,
  )
}

describe('TeamIndicatorsTab', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  it('mostra os indicadores do time', async () => {
    mockApiFetch.mockResolvedValue({ overview: overviewFixture() })
    renderTab()

    expect(await screen.findByRole('group', { name: 'Liderados' })).toHaveTextContent('3')
    expect(screen.getByRole('group', { name: 'Pontuação média' })).toHaveTextContent('350')
    expect(screen.getByRole('group', { name: 'Humor médio' })).toHaveTextContent('4.2/5')
    expect(screen.getByRole('group', { name: 'Participantes do termômetro' })).toHaveTextContent('2')
    expect(screen.getByRole('group', { name: 'Escritos pelo time' })).toHaveTextContent('7')
    expect(screen.getByRole('group', { name: 'Recebidos pelo time' })).toHaveTextContent('5')

    expect(screen.getByRole('heading', { name: 'Tendência do clima' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Termômetro de clima' })).toBeInTheDocument()
    expect(screen.getByText('Mural da empresa')).toBeInTheDocument()
  })

  it('lista a pontuação por pessoa sem percentual do total', async () => {
    mockApiFetch.mockResolvedValue({ overview: overviewFixture() })
    renderTab()

    const card = (await screen.findByRole('heading', { name: 'Pontuação por pessoa' })).closest('section')!
    const linhas = within(card).getAllByRole('listitem')
    expect(linhas[0]).toHaveTextContent('Ana Ribeiro')
    expect(linhas[0]).toHaveTextContent('600')
    // Percentual só faz sentido onde as fatias particionam um total.
    expect(linhas[0]).not.toHaveTextContent('%')
    expect(linhas).toHaveLength(3)
  })

  it('troca o período e refaz a busca', async () => {
    mockApiFetch.mockResolvedValue({ overview: overviewFixture() })
    renderTab()
    await screen.findByRole('group', { name: 'Liderados' })
    expect(mockApiFetch).toHaveBeenCalledWith('/me/team/analytics?range=30d')

    await pickOption('Período de análise', 'Últimos 7 dias')

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/me/team/analytics?range=7d'))
  })

  it('avisa quem não lidera ninguém em vez de mostrar zeros', async () => {
    mockApiFetch.mockResolvedValue({
      overview: overviewFixture({
        teamSize: 0,
        mood: { entries: 0, participants: 0, average: null, distribution: [], trend: [] },
        feedbacks: { written: 0, received: 0 },
        topScreens: [],
        scores: { average: 0, perPerson: [] },
      }),
    })
    renderTab()

    expect(await screen.findByText(/não tem liderados/i)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Liderados' })).not.toBeInTheDocument()
  })

  it('mostra erro quando a busca falha', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))
    renderTab()

    expect(await screen.findByText(/Erro ao carregar os indicadores/i)).toBeInTheDocument()
  })
})
