import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NewOneOnOneModal } from './NewOneOnOneModal'

vi.mock('../../lib/one-on-one-api', () => ({ createOneOnOne: vi.fn() }))
vi.mock('../../office/meetings/api', () => ({ fetchCompanyUsers: vi.fn() }))

const { createOneOnOne } = await import('../../lib/one-on-one-api')
const { fetchCompanyUsers } = await import('../../office/meetings/api')

function pessoa(over: Record<string, unknown>) {
  return {
    id: 'x',
    name: 'X',
    email: null,
    role: 'LEGEND',
    area: null,
    position: null,
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    active: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
    sectorId: 's1',
    companyId: 'c1',
    ...over,
  }
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NewOneOnOneModal onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchCompanyUsers).mockResolvedValue({
    users: [
      pessoa({ id: 'u2', name: 'Bruno Dias', position: 'Dev', sectorName: 'Desenvolvimento de Produto' }),
      pessoa({ id: 'u3', name: 'Carla Nunes', position: 'Analista de RH', sectorName: 'Gente e Gestão' }),
    ] as never,
  })
})

describe('NewOneOnOneModal', () => {
  it('marca um 1:1 com a pessoa escolhida na lista', async () => {
    vi.mocked(createOneOnOne).mockResolvedValue({ seriesId: 's1', meetings: [] })

    renderModal()
    await userEvent.click(await screen.findByRole('button', { name: /Bruno Dias/ }))
    await userEvent.type(screen.getByLabelText(/data/i), '2026-08-10')
    await userEvent.type(screen.getByLabelText(/hor[áa]rio/i), '10:00')
    await userEvent.click(screen.getByRole('button', { name: 'Marcar' }))

    expect(createOneOnOne).toHaveBeenCalledWith(
      expect.objectContaining({ counterpartId: 'u2', date: '2026-08-10', startTime: '10:00', recurrence: 'NONE' }),
    )
  })

  it('mostra o cargo e agrupa a lista por setor', async () => {
    renderModal()

    expect(await screen.findByText('Desenvolvimento de Produto')).toBeInTheDocument()
    expect(screen.getByText('Gente e Gestão')).toBeInTheDocument()
    expect(screen.getByText('Analista de RH')).toBeInTheDocument()
  })

  it('filtra a lista pela busca, por nome ou cargo', async () => {
    renderModal()
    await screen.findByRole('button', { name: /Bruno Dias/ })

    await userEvent.type(screen.getByLabelText(/procurar pessoa/i), 'analista')

    expect(screen.getByRole('button', { name: /Carla Nunes/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bruno Dias/ })).not.toBeInTheDocument()
  })

  /** Escolhida a pessoa, a lista dá lugar ao cartão dela — com opção de trocar. */
  it('mostra quem foi escolhido e permite trocar', async () => {
    renderModal()
    await userEvent.click(await screen.findByRole('button', { name: /Bruno Dias/ }))

    expect(screen.getByText('Bruno Dias')).toBeInTheDocument()
    expect(screen.queryByLabelText(/procurar pessoa/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /trocar bruno dias/i }))
    expect(screen.getByLabelText(/procurar pessoa/i)).toBeInTheDocument()
  })

  it('recusa o envio sem pessoa escolhida, sem chamar a API', async () => {
    renderModal()
    await userEvent.type(await screen.findByLabelText(/data/i), '2026-08-10')
    await userEvent.type(screen.getByLabelText(/hor[áa]rio/i), '10:00')
    await userEvent.click(screen.getByRole('button', { name: 'Marcar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/escolha com quem/i)
    expect(createOneOnOne).not.toHaveBeenCalled()
  })

  it('pede número de encontros quando escolhe um ritmo', async () => {
    renderModal()
    await userEvent.selectOptions(await screen.findByLabelText(/ritmo/i), 'WEEKLY')

    expect(screen.getByLabelText(/quantos encontros/i)).toBeInTheDocument()
  })
})
