import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import { TeamVacationsPanel } from './TeamVacationsPanel'
import { apiFetch, ApiError } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn(), ApiError: actual.ApiError }
})
const mockApiFetch = apiFetch as unknown as Mock

const ana = { id: 'u1', name: 'Ana', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><TeamVacationsPanel /></QueryClientProvider>)
}

describe('TeamVacationsPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista os liderados e seus períodos', async () => {
    mockApiFetch.mockResolvedValue({
      groups: [{
        groupId: 'manager:u-lider', groupName: 'Meu time',
        members: [{ user: ana, vacations: [{ id: 'v1', user: ana, startDate: '2026-08-03', endDate: '2026-08-14', note: null }] }],
      }],
    })
    wrap()
    expect(await screen.findByText('Férias do time')).toBeInTheDocument()
    // Grupo único não ganha subtítulo: "Meu time" repetiria o título do painel.
    expect(screen.queryByText('Meu time')).not.toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText(/03\/08\/2026/)).toBeInTheDocument()
  })

  it('não renderiza nada para quem não lidera ninguém', async () => {
    mockApiFetch.mockResolvedValue({ groups: [] })
    const { container } = wrap()
    await new Promise((r) => setTimeout(r, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it('abre o diálogo de lançar férias', async () => {
    mockApiFetch.mockResolvedValue({
      groups: [{ groupId: 'manager:u-lider', groupName: 'Meu time', members: [{ user: ana, vacations: [] }] }],
    })
    wrap()
    await userEvent.click(await screen.findByRole('button', { name: /lançar férias para ana/i }))
    expect(screen.getByLabelText(/início/i)).toBeInTheDocument()
  })

  it('remoção que falha mostra erro em vez de sumir em silêncio', async () => {
    const vacation = { id: 'v1', user: ana, startDate: '2026-08-03', endDate: '2026-08-14', note: null }
    mockApiFetch.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'DELETE') return Promise.reject(new ApiError(403, 'Sem permissão para remover.'))
      return Promise.resolve({
        groups: [{ groupId: 'manager:u-lider', groupName: 'Meu time', members: [{ user: ana, vacations: [vacation] }] }],
      })
    })
    wrap()

    const removeButton = await screen.findByRole('button', {
      name: /remover férias de ana de 03\/08\/2026 a 14\/08\/2026/i,
    })
    await userEvent.click(removeButton)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão para remover.')
    // O período continua lá — não some da tela como se a remoção tivesse dado certo.
    expect(screen.getByText(/03\/08\/2026/)).toBeInTheDocument()
    await waitFor(() => expect(removeButton).not.toBeDisabled())
  })
})
