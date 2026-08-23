import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CalendarEventsSection } from './CalendarEventsSection'
import * as api from '../../lib/api'

// A seção lê `useAuth()` para decidir se mostra o toggle de Ação de Comunicação
// Interna — só o admin e o time de G&G marcam.
const authUser = { id: 'u1', name: 'Lucca', role: 'ADMIN', sectorFeatures: [] as string[], adminAccess: false }
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: authUser, loading: false, login: vi.fn(), logout: vi.fn(), setUser: vi.fn() }),
}))

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CalendarEventsSection />
    </QueryClientProvider>,
  )
}

const provas = { id: 't1', name: 'Provas B2B', slug: 'provas-b2b', icon: 'quiz', color: '#6366f1' }

const evento = {
  id: 'e1',
  title: 'Prova Inspirali',
  description: 'Prova do parceiro',
  date: '2026-09-10',
  endDate: null,
  startTime: '08:30',
  endTime: null,
  color: null,
  audienceTags: [] as string[],
  isInternalComm: false,
  type: provas,
  sectorIds: [] as string[],
  sectorNames: [] as string[],
  recurrence: 'NONE' as const,
  recurrenceUntil: null,
  recurrenceCount: null,
  reminderDaysBefore: [1, 7],
  createdById: 'u1',
  createdByName: 'Lucca Secco',
  createdAt: '2026-08-01T12:00:00.000Z',
}

const setores = { sectors: [{ id: 's1', name: 'Comercial', slug: 'comercial', active: true, enabledFeatures: [], roles: [] }] }

function mockApi(overrides: { events?: unknown[]; types?: unknown[] } = {}) {
  return vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
    if (path.startsWith('/sectors')) return Promise.resolve(setores) as never
    if (path.startsWith('/calendar/managed-events')) {
      return Promise.resolve({
        events: overrides.events ?? [evento],
        types: overrides.types ?? [provas],
      }) as never
    }
    return Promise.resolve({}) as never
  })
}

describe('CalendarEventsSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lista o evento com público, repetição e lembretes', async () => {
    mockApi()
    renderSection()

    expect(await screen.findByText('Prova Inspirali')).toBeInTheDocument()
    // Público vazio é a empresa inteira — a tela precisa dizer isso, não "nenhum".
    expect(screen.getByText(/Toda a empresa/)).toBeInTheDocument()
    expect(screen.getByText(/Não se repete/)).toBeInTheDocument()
    expect(screen.getByText(/1 dia antes, 7 dias antes/)).toBeInTheDocument()
    expect(screen.getByText(/10\/09\/2026 às 08:30/)).toBeInTheDocument()
  })

  it('mostra quem cadastrou e quando', async () => {
    mockApi()
    renderSection()

    expect(await screen.findByText('Adicionado por Lucca Secco em 01/08/2026')).toBeInTheDocument()
  })

  it('mostra o público quando o evento é restrito a setores', async () => {
    mockApi({ events: [{ ...evento, sectorIds: ['s1'], sectorNames: ['Comercial'] }] })
    renderSection()

    expect(await screen.findByText(/Comercial/)).toBeInTheDocument()
    expect(screen.queryByText(/Toda a empresa/)).not.toBeInTheDocument()
  })

  it('diz "Sem lembrete" quando nenhuma antecedência foi marcada', async () => {
    mockApi({ events: [{ ...evento, reminderDaysBefore: [] }] })
    renderSection()

    expect(await screen.findByText(/Sem lembrete/)).toBeInTheDocument()
  })

  it('cria um evento enviando data, tipo, público e lembrete', async () => {
    const fetchMock = mockApi({ events: [] })
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: /Novo evento/i }))
    await user.type(screen.getByLabelText(/Título/i), 'Prova nova')
    await user.type(screen.getByLabelText(/^Data início$/i), '2026-10-05')
    await user.click(screen.getByLabelText(/Comercial/i))
    await user.click(screen.getByLabelText(/7 dias antes/i))
    await user.click(screen.getByRole('button', { name: /Salvar/i }))

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find(
        ([path, init]) => path === '/calendar/events' && (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(chamada).toBeDefined()
      const body = JSON.parse((chamada![1] as RequestInit).body as string)
      expect(body.title).toBe('Prova nova')
      expect(body.date).toBe('2026-10-05')
      expect(body.typeId).toBe('t1')
      expect(body.sectorIds).toEqual(['s1'])
      expect(body.reminderDaysBefore).toEqual([7])
      // Campo opcional vazio vira null: string vazia não é hora, data nem cor, e
      // o Zod da rota recusaria.
      expect(body.startTime).toBeNull()
      expect(body.endDate).toBeNull()
      expect(body.endTime).toBeNull()
      // A cor vem preenchida pela categoria escolhida — sem ajuste manual.
      expect(body.color).toBe('#6366f1')
      expect(body.audienceTags).toEqual([])
      expect(body.isInternalComm).toBe(false)
    })
  })

  it('só mostra o fim da repetição quando há repetição', async () => {
    mockApi({ events: [] })
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: /Novo evento/i }))
    expect(screen.queryByLabelText(/Repetir até/i)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/Repetição/i), 'WEEKLY')
    expect(screen.getByLabelText(/Repetir até/i)).toBeInTheDocument()
  })

  it('sem tipo cadastrado, bloqueia a criação e explica por quê', async () => {
    mockApi({ events: [], types: [] })
    renderSection()

    expect(await screen.findByText(/Cadastre um tipo antes de criar eventos/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Novo evento/i })).toBeDisabled()
  })

  it('cria um tipo pelo painel de tipos', async () => {
    const fetchMock = mockApi({ types: [] })
    const user = userEvent.setup()
    renderSection()

    await user.type(await screen.findByLabelText(/Nome do tipo/i), 'Comunicados')
    await user.click(screen.getByRole('button', { name: /Adicionar/i }))

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find(([path]) => path === '/admin/calendar-event-types')
      expect(chamada).toBeDefined()
      expect(JSON.parse((chamada![1] as RequestInit).body as string)).toEqual({ name: 'Comunicados' })
    })
  })

  it('mostra a mensagem do servidor quando o salvamento falha', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/sectors')) return Promise.resolve(setores) as never
      if (path === '/calendar/events' && init?.method === 'POST') {
        return Promise.reject(new api.ApiError(404, 'Tipo de evento não encontrado.')) as never
      }
      if (path.startsWith('/calendar/managed-events')) {
        return Promise.resolve({ events: [], types: [provas] }) as never
      }
      return Promise.resolve({}) as never
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(await screen.findByRole('button', { name: /Novo evento/i }))
    await user.type(screen.getByLabelText(/Título/i), 'X')
    await user.type(screen.getByLabelText(/^Data início$/i), '2026-10-05')
    await user.click(screen.getByRole('button', { name: /Salvar/i }))

    // O banner junta ícone e texto no mesmo <p>, então casa por conteúdo.
    expect(await screen.findByRole('alert')).toHaveTextContent('Tipo de evento não encontrado.')
  })
})
