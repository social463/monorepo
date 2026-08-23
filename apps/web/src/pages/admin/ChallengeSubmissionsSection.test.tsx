import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ChallengeSubmissionDTO } from '@legends/shared'
import { ChallengeSubmissionsSection } from './ChallengeSubmissionsSection'
import { apiFetch, apiFetchBlob } from '../../lib/api'

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn(), apiFetchBlob: vi.fn() }))

function submission(id: string, name: string): ChallengeSubmissionDTO {
  return {
    id,
    status: 'PENDING',
    note: 'Fiz!',
    evidenceUrl: null,
    submittedAt: '2026-08-01T12:00:00.000Z',
    reviewedAt: null,
    rejectionReason: null,
    user: { id: `u-${id}`, name, email: `${name}@x.com`, photoUrl: null },
    challenge: { id: 'c1', title: 'Ler um livro', rewardCoins: 150 },
    reviewedBy: null,
  }
}

/** Roteia a resposta por path: fila, desafios do filtro e mutações. */
function mockApi(page: { items: ChallengeSubmissionDTO[]; nextCursor: string | null }, overrides: Record<string, unknown> = {}) {
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    for (const [prefix, value] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) {
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
      }
    }
    if (path.startsWith('/admin/challenge-submissions')) return Promise.resolve(page)
    // `/admin/challenges` responde `{ challenges }`, não um array cru — mock com
    // o formato errado foi o que deixou o filtro quebrar em produção.
    if (path.startsWith('/admin/challenges')) return Promise.resolve({ challenges: [] })
    return Promise.resolve(null)
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChallengeSubmissionsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})

describe('ChallengeSubmissionsSection', () => {
  it('lista a fila de pendentes', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: null })
    renderSection()

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Ler um livro')).toBeInTheDocument()
  })

  it('busca a fila com o filtro de status da aba', async () => {
    mockApi({ items: [], nextCursor: null })
    renderSection()
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))

    await waitFor(() => {
      const paths = vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string)
      expect(paths.some((p) => p.startsWith('/admin/challenge-submissions?') && !p.includes('status='))).toBe(true)
    })
  })

  it('aprova uma submissão individual', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: null })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/admin/challenge-submissions/s1/approve', { method: 'POST' })
    })
  })

  it('limpa o banner de erro numa decisão bem-sucedida seguinte', async () => {
    let approveCalls = 0
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path.endsWith('/approve')) {
        approveCalls += 1
        return approveCalls === 1
          ? Promise.reject(new Error('Falha ao aprovar.'))
          : Promise.resolve({})
      }
      if (path.startsWith('/admin/challenge-submissions')) {
        return Promise.resolve({ items: [submission('s1', 'Ana')], nextCursor: null })
      }
      // `/admin/challenges` responde `{ challenges }`, não um array cru — mock com
    // o formato errado foi o que deixou o filtro quebrar em produção.
    if (path.startsWith('/admin/challenges')) return Promise.resolve({ challenges: [] })
      return Promise.resolve(null)
    })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao aprovar.')

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('limpa a seleção ao trocar o filtro de desafio', async () => {
    mockApi(
      { items: [submission('s1', 'Ana')], nextCursor: null },
      {
        '/admin/challenges': {
          challenges: [
            {
              id: 'c2',
              title: 'Outro desafio',
              description: '',
              rewardCoins: 50,
              active: true,
              startsAt: null,
              endsAt: null,
              sectorId: null,
              sectorName: null,
              submissionCount: 0,
            },
          ],
        },
      },
    )
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByLabelText('Selecionar Ana'))
    expect(screen.getByRole('button', { name: /aprovar selecionadas/i })).toBeInTheDocument()

    // Trocar o filtro dispara um fetch novo — as linhas visíveis mudam, e uma
    // seleção feita antes não pode sobreviver (senão "Aprovar selecionadas"
    // agiria sobre ids que o admin não vê mais na tela).
    await userEvent.click(screen.getByRole('combobox', { name: 'Desafio' }))
    await userEvent.click(screen.getByRole('option', { name: 'Outro desafio' }))

    expect(screen.queryByRole('button', { name: /aprovar selecionadas/i })).not.toBeInTheDocument()
  })

  it('exige motivo para rejeitar', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: null })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Rejeitar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar rejeição' }))

    expect(await screen.findByText(/informe o motivo/i)).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/reject'),
      expect.anything(),
    )
  })

  it('reporta sucessos e falhas do lote', async () => {
    mockApi(
      { items: [submission('s1', 'Ana'), submission('s2', 'Bruno')], nextCursor: null },
      { '/admin/challenge-submissions/batch': { succeeded: ['s1'], failed: [{ id: 's2', message: 'Esta participação já foi avaliada.' }] } },
    )
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByLabelText('Selecionar Ana'))
    await userEvent.click(screen.getByLabelText('Selecionar Bruno'))
    await userEvent.click(screen.getByRole('button', { name: /aprovar selecionadas/i }))

    expect(await screen.findByText(/1 aprovada/i)).toBeInTheDocument()
    expect(await screen.findByText(/Esta participação já foi avaliada\./)).toBeInTheDocument()
  })

  it('exporta o CSV pelo caminho autenticado, com os filtros da tela', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: null })
    vi.mocked(apiFetchBlob).mockResolvedValue({ blob: new Blob(['a;b']), filename: 'resultados-desafios.csv' })
    const createObjectURL = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => {
      // Nunca um <a href> cru: o token só vive em memória e daria 401.
      expect(apiFetchBlob).toHaveBeenCalledWith(
        expect.stringContaining('/admin/challenge-submissions/export.csv?status=PENDING'),
      )
    })
  })

  it('carrega a próxima página pelo cursor devolvido pelo servidor', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: 'CURSOR-2' })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))

    await waitFor(() => {
      const paths = vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string)
      expect(paths.some((p) => p.includes('cursor=CURSOR-2'))).toBe(true)
    })
  })
})
