import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { BirthdaysCard } from './BirthdaysCard'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

// O card consulta quem está logado para decidir se mostra o botão de parabéns
// (`canSignBirthdayWall`): todo mundo, menos o próprio aniversariante.
const mockAuth = vi.hoisted(() => ({ user: { id: 'viewer', role: 'LEGEND' } as { id: string; role: string } | null }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: mockAuth.user }) }))

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function birthday(
  id: string,
  name: string,
  daysUntil: number,
  observedDate: string,
  position: string | null = 'Consultor',
  sectorName?: string,
  greetingCount = 0,
) {
  return {
    user: { id, name, position, sectorName, avatarStyle: null, avatarSeed: null, avatarOptions: null, photoUrl: null },
    day: Number(observedDate.slice(8, 10)),
    month: Number(observedDate.slice(5, 7)),
    daysUntil,
    observedDate,
    greetingCount,
  }
}

/** Resposta de /celebrations com só os aniversários (upcoming) preenchidos. */
function response(upcoming: unknown[], month: unknown[] = []) {
  return {
    referenceDay: '2026-07-30',
    birthdays: { month, upcoming },
    workAnniversaries: { month: [], upcoming: [] },
  }
}

describe('BirthdaysCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.user = { id: 'viewer', role: 'LEGEND' }
  })

  it('mostra o próximo aniversariante com setor, destaque "Hoje" e link pro calendário', async () => {
    mockApiFetch.mockResolvedValue(
      response([birthday('u1', 'Heitor Albanez', 0, '2026-07-30', 'Consultor', 'Operações')]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Heitor Albanez')).toBeInTheDocument()
    expect(screen.getByText('Operações')).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    // No chip "Hoje" a data absoluta some: seria a mesma informação duas vezes.
    expect(screen.queryByText(/30\/07\/2026/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver todos os aniversários/i })).toHaveAttribute(
      'href',
      '/aniversariantes',
    )
  })

  // O botão de festa é a ÚNICA ação da linha (o coração de "deixe um feedback"
  // saiu) e leva ao mural de aniversário do perfil, já com o campo em foco.
  it('leva ao mural de aniversário do perfil ao clicar no botão de festa', async () => {
    mockApiFetch.mockResolvedValue(response([birthday('u1', 'Heitor Albanez', 0, '2026-07-30')]))

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Heitor Albanez')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dê os parabéns a Heitor Albanez/i })).toHaveAttribute(
      'href',
      '/perfil/u1?parabens=1',
    )
    expect(screen.queryByRole('link', { name: /deixe um feedback/i })).not.toBeInTheDocument()
  })

  it('mostra "Amanhã" e "Em N dias" para datas futuras', async () => {
    mockApiFetch.mockResolvedValue(
      response([
        birthday('u1', 'Amanhã Pessoa', 1, '2026-07-31'),
        birthday('u2', 'Daqui A Pouco', 5, '2026-08-04'),
      ]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText(/^Amanhã · /)).toBeInTheDocument()
    expect(screen.getByText(/^Em 5 dias · /)).toBeInTheDocument()
  })

  // A lista é da empresa toda: o setor é o que diferencia colegas de outros times.
  // O cargo não aparece aqui (só no perfil) — a lista fica menos poluída.
  it('mostra só o setor como subtítulo, sem o cargo', async () => {
    mockApiFetch.mockResolvedValue(
      response([
        birthday('u1', 'Heitor Albanez', 0, '2026-07-30', 'Consultor', 'Operações'),
        birthday('u2', 'Ana Prado', 0, '2026-07-30', null, 'Gente e Gestão'),
      ]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Operações')).toBeInTheDocument()
    expect(screen.getByText('Gente e Gestão')).toBeInTheDocument()
    expect(screen.queryByText('Consultor')).toBeNull()
    expect(screen.queryByText(/consultor · operações/i)).toBeNull()
  })

  it('mostra no máximo 3 pessoas, mesmo com uma data cheia', async () => {
    // O servidor manda as 3 DATAS mais próximas inteiras — uma delas com quatro
    // aniversariantes traz os quatro. Quem corta por pessoa é o card.
    mockApiFetch.mockResolvedValue(
      response([
        birthday('u1', 'Ana', 0, '2026-07-30'),
        birthday('u2', 'Bruno', 0, '2026-07-30'),
        birthday('u3', 'Carla', 0, '2026-07-30'),
        birthday('u4', 'Duda', 0, '2026-07-30'),
      ]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText('Carla')).toBeInTheDocument()
    expect(screen.queryByText('Duda')).not.toBeInTheDocument()
    // Quem sobrou continua a um clique de distância.
    expect(screen.getByText('Ver todos os aniversários')).toBeInTheDocument()
  })

  it('oferece parabéns a quem faz aniversário, mas não a si mesmo', async () => {
    mockApiFetch.mockResolvedValue(
      response([
        birthday('u1', 'Ana', 0, '2026-07-30'),
        birthday('viewer', 'Eu Mesmo', 0, '2026-07-30'),
      ]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByRole('link', { name: /Dê os parabéns a Ana/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Dê os parabéns a Eu Mesmo/i })).not.toBeInTheDocument()
  })

  it('o ADMIN parabeniza: assinar o mural não é escrever feedback', async () => {
    mockAuth.user = { id: 'chefe', role: 'ADMIN' }
    mockApiFetch.mockResolvedValue(response([birthday('u1', 'Ana', 0, '2026-07-30')]))

    wrap(<BirthdaysCard />)

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    // O botão some para o próprio aniversariante, e só para ele: o mural é de
    // todo mundo, ao contrário do `FeedbackComposer`, que barra o ADMIN.
    expect(screen.getByRole('link', { name: /Dê os parabéns a Ana/i })).toBeInTheDocument()
  })

  it('mostra quantas pessoas já assinaram o mural de quem comemora hoje', async () => {
    mockApiFetch.mockResolvedValue(
      response([birthday('u1', 'Ana', 0, '2026-07-30', 'Consultor', 'Produto', 3)]),
    )

    wrap(<BirthdaysCard />)

    expect(await screen.findByText(/3 pessoas já assinaram o mural/i)).toBeInTheDocument()
  })

  it('mostra estado vazio quando não há próximo aniversariante, mantendo o link', async () => {
    mockApiFetch.mockResolvedValue(response([], [birthday('u1', 'Ana', 0, '2026-07-12')]))

    wrap(<BirthdaysCard />)

    expect(await screen.findByText(/nenhum aniversário chegando por aqui/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver todos os aniversários/i })).toBeInTheDocument()
  })

  it('não renderiza nada quando a chamada falha', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))

    wrap(<BirthdaysCard />)

    await vi.waitFor(() => {
      expect(screen.queryByTestId('birthdays-card')).toBeNull()
    })
    expect(screen.queryByText(/próximos aniversariantes/i)).toBeNull()
  })
})
