import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import { VacationDialog } from './VacationDialog'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn(), ApiError: actual.ApiError }
})
const mockApiFetch = apiFetch as unknown as Mock

const ana = { id: 'u1', name: 'Ana' } as never

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('VacationDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cria um período para a pessoa', async () => {
    mockApiFetch.mockResolvedValue({ vacation: { id: 'v1' } })
    const onClose = vi.fn()
    wrap(<VacationDialog user={ana} vacation={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText(/início/i), '2026-08-03')
    await userEvent.type(screen.getByLabelText(/fim/i), '2026-08-14')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    // Observação não tocada (fica '' no estado) não deve virar string vazia
    // persistida — a chave some do corpo, e a rota resolve para `null`.
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/vacations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'u1', startDate: '2026-08-03', endDate: '2026-08-14' }),
      }),
    )
  })

  it('mostra a mensagem de erro da API', async () => {
    const { ApiError } = await import('../lib/api')
    // Assinatura real: ApiError(status, message, payload?) — ver apps/web/src/lib/api.ts.
    mockApiFetch.mockRejectedValue(new ApiError(400, 'Já existe um período de 2026-08-01 a 2026-08-10 para esta pessoa.'))
    wrap(<VacationDialog user={ana} vacation={null} onClose={() => {}} />)

    await userEvent.type(screen.getByLabelText(/início/i), '2026-08-03')
    await userEvent.type(screen.getByLabelText(/fim/i), '2026-08-14')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/já existe um período/i)
  })

  it('edita um período existente', async () => {
    mockApiFetch.mockResolvedValue({ vacation: { id: 'v1' } })
    wrap(
      <VacationDialog
        user={ana}
        vacation={{ id: 'v1', user: ana, startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' }}
        onClose={() => {}}
      />,
    )
    expect(screen.getByLabelText(/início/i)).toHaveValue('2026-08-03')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))
    expect(mockApiFetch).toHaveBeenCalledWith('/vacations/v1', expect.objectContaining({ method: 'PATCH' }))
  })

  it('limpar a observação na edição manda null, não string vazia', async () => {
    mockApiFetch.mockResolvedValue({ vacation: { id: 'v1' } })
    wrap(
      <VacationDialog
        user={ana}
        vacation={{ id: 'v1', user: ana, startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' }}
        onClose={() => {}}
      />,
    )
    await userEvent.clear(screen.getByLabelText(/observação/i))
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/vacations/v1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ startDate: '2026-08-03', endDate: '2026-08-14', note: null }),
      }),
    )
  })
})
