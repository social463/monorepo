import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Mock } from 'vitest'
import type { CalendarEventOccurrenceDTO } from '@legends/shared'
import { CalendarPage } from './CalendarPage'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

// Papel do usuário é variável por teste: é ele que decide se o botão "Novo
// evento" aparece (admin, subadmin do bloco e liderança cadastram; o resto não).
const authUser = {
  id: 'u1',
  name: 'Ana',
  role: 'LEGEND',
  sectorFeatures: [] as string[],
  enabledFeatures: [] as string[],
  adminAccess: false,
}
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: authUser, loading: false, login: vi.fn(), logout: vi.fn(), setUser: vi.fn() }),
}))

// A marca é resolvida por contexto (BrandProvider) e a tela só a usa no
// subtítulo — mockar evita subir o provider inteiro por causa de uma palavra.
vi.mock('../../components/BrandLogo', () => ({ BrandName: () => <>EMR</> }))

const TIPOS = [
  { id: 't-cultura', name: 'Cultura', slug: 'cultura', icon: 'diversity_3', color: '#14b8a6' },
  { id: 't-campanha', name: 'Campanha', slug: 'campanha', icon: 'ads_click', color: '#f59e0b' },
]

function occ(over: Partial<CalendarEventOccurrenceDTO> = {}): CalendarEventOccurrenceDTO {
  return {
    eventId: 'e1',
    iso: '2026-08-12',
    endIso: '2026-08-12',
    title: 'Semana da Cultura',
    description: '',
    startTime: null,
    endTime: null,
    typeSlug: 'cultura',
    typeName: 'Cultura',
    typeIcon: 'diversity_3',
    color: '#14b8a6',
    audienceTags: [],
    isInternalComm: false,
    createdById: 'u9',
    createdByName: 'Bia',
    createdAt: '2026-08-01T12:00:00.000Z',
    ...over,
  }
}

let occurrences: CalendarEventOccurrenceDTO[] = []

function routeApi() {
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/calendar/events?')) return Promise.resolve({ occurrences, types: TIPOS })
    if (path.startsWith('/sectors')) return Promise.resolve({ sectors: [] })
    return Promise.reject(new Error(`rota não mockada: ${path}`))
  })
}

/**
 * Escolhe uma opção num filtro da tela. Os filtros são o `SelectMenu` do app,
 * não `<select>` nativo, então não há `selectOptions`: abre o gatilho pelo nome
 * acessível e clica na opção pelo rótulo.
 */
async function pick(user: ReturnType<typeof userEvent.setup>, campo: string, opcao: string) {
  await user.click(screen.getByRole('combobox', { name: campo }))
  const listbox = await screen.findByRole('listbox', { name: campo })
  await user.click(within(listbox).getByRole('button', { name: opcao }))
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // `shouldAdvanceTime` deixa o relógio andar sozinho: o `userEvent` espera em
  // timers de verdade, e sem isso todo clique trava.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 7, 12, 10, 0, 0))
  mockApiFetch.mockReset()
  authUser.role = 'LEGEND'
  authUser.sectorFeatures = []
  authUser.adminAccess = false
  occurrences = [occ()]
  routeApi()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CalendarPage', () => {
  it('anuncia o propósito novo no subtítulo', async () => {
    renderPage()
    expect(await screen.findByText(/Ações, datas comemorativas e eventos da/)).toBeInTheDocument()
  })

  it('desenha os eventos cadastrados do mês', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /Semana da Cultura/ })).toBeInTheDocument()
  })

  it('não busca mais aniversário, tempo de casa, férias, reunião nem 1:1', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Semana da Cultura/ })
    const chamadas = mockApiFetch.mock.calls.map(([path]) => String(path))
    expect(chamadas.some((p) => p.startsWith('/celebrations'))).toBe(false)
    expect(chamadas.some((p) => p.startsWith('/vacations'))).toBe(false)
    expect(chamadas.some((p) => p.startsWith('/office/meetings'))).toBe(false)
    expect(chamadas.some((p) => p.includes('one-on-one'))).toBe(false)
  })

  it('não tem mais o painel "Selecione um dia"', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Semana da Cultura/ })
    expect(screen.queryByText(/Selecione um dia/)).not.toBeInTheDocument()
  })

  it('abre o detalhe do evento clicado', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Semana da Cultura/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Semana da Cultura' })
    expect(within(dialog).getByText('12 de agosto de 2026')).toBeInTheDocument()
    expect(within(dialog).getByText('Dia todo')).toBeInTheDocument()
    // Sem tag, o público é a empresa inteira — e a tela diz isso.
    expect(within(dialog).getByText('Todos')).toBeInTheDocument()
  })

  it('quem não pode cadastrar não vê o botão nem o de editar', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Semana da Cultura/ }))

    expect(screen.queryByRole('button', { name: 'Novo evento' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument()
  })

  it('admin vê "Novo evento" e pode editar o de outra pessoa', async () => {
    authUser.role = 'ADMIN'
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()

    expect(await screen.findByRole('button', { name: 'Novo evento' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Semana da Cultura/ }))
    expect(await screen.findByRole('button', { name: /Editar/ })).toBeInTheDocument()
  })

  it('excluir pede confirmação antes de apagar o cadastro', async () => {
    authUser.role = 'ADMIN'
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Semana da Cultura/ }))

    await user.click(await screen.findByRole('button', { name: /^Excluir$/ }))
    // O clique sozinho não apaga: excluir some com o cadastro inteiro, não com a
    // ocorrência clicada.
    expect(mockApiFetch.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE')).toBe(false)

    mockApiFetch.mockImplementation(() => Promise.resolve({}))
    await user.click(screen.getByRole('button', { name: /Confirmar exclusão/ }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/calendar/events/e1', expect.objectContaining({ method: 'DELETE' })),
    )
  })

  it('marca a Ação de Comunicação Interna que chegou até aqui', async () => {
    occurrences = [occ({ isInternalComm: true })]
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Semana da Cultura/ }))
    expect(await screen.findByText(/Comunicação Interna/)).toBeInTheDocument()
  })

  it('filtra por categoria', async () => {
    occurrences = [occ(), occ({ eventId: 'e2', title: 'Campanha do Agasalho', typeSlug: 'campanha' })]
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await screen.findByRole('button', { name: /Semana da Cultura/ })

    await pick(user, 'Categoria', 'Campanha')
    expect(screen.queryByRole('button', { name: /Semana da Cultura/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Campanha do Agasalho/ })).toBeInTheDocument()
  })

  it('filtra por público-alvo', async () => {
    occurrences = [
      occ({ eventId: 'e2', title: 'Rito dos Gestores', audienceTags: ['Líder', 'G&G'] }),
      occ({ eventId: 'e3', title: 'Só do CEO', audienceTags: ['CEO'] }),
    ]
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await screen.findByRole('button', { name: /Rito dos Gestores/ })

    await pick(user, 'Público-alvo', 'Líder')
    expect(screen.getByRole('button', { name: /Rito dos Gestores/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Só do CEO/ })).not.toBeInTheDocument()
  })

  it('navega direto pelo seletor de mês e ano, e volta com "Ir para hoje"', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await screen.findByRole('button', { name: /Semana da Cultura/ })

    await pick(user, 'Ano', '2027')
    await pick(user, 'Mês', 'Novembro')
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/novembro de 2027/))
    // Uma janela nova é uma busca nova — a grade não fica com os dados de agosto.
    expect(mockApiFetch.mock.calls.some(([p]) => String(p).includes('from=2027-10'))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Ir para hoje' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/agosto de 2026/))
  })

  it('a semana e o dia mostram a faixa "Dia todo" para evento sem horário', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await screen.findByRole('button', { name: /Semana da Cultura/ })

    await user.click(screen.getByRole('button', { name: 'Semana' }))
    const faixa = await screen.findByText('Dia todo')
    expect(faixa).toBeInTheDocument()
    // O evento sem horário fica na faixa, e não numa faixa de horário.
    expect(screen.getByRole('button', { name: /Semana da Cultura/ })).toBeInTheDocument()
  })

  it('a grade de horas posiciona o evento com horário', async () => {
    occurrences = [occ({ startTime: '14:00', endTime: '15:30' })]
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await screen.findByRole('button', { name: /Semana da Cultura/ })

    await user.click(screen.getByRole('button', { name: 'Hoje' }))
    const botao = await screen.findByRole('button', { name: /Semana da Cultura/ })
    // 14h com a grade começando às 6h e 44px por hora: (14−6)×44 = 352px.
    expect(botao).toHaveStyle({ top: '352px' })
  })
})
