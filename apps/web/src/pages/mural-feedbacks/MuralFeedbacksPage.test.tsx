import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MuralFeedbacksPage } from './MuralFeedbacksPage'
import * as api from '../../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

function person(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    email: null,
    role: 'LEGEND',
    area: null,
    position: 'Dev',
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    active: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
    sectorId: 's1',
    sectorName: 'Produto',
    companyId: 'company-emr',
    companyName: null,
    enabledFeatures: [],
    sectorFeatures: [],
    ...overrides,
  }
}

function sharedFeedback(id: string, message: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    author: person('u2', 'Maria'),
    target: person('u3', 'Mariana'),
    targets: [person('u3', 'Mariana')],
    message,
    category: 'ELOGIO',
    categories: [],
    customCategory: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    sharedAt: '2026-07-02T00:00:00.000Z',
    reactions: [],
    commentCount: 0,
    ...overrides,
  }
}

const CATEGORIES = {
  categories: [
    { id: 'c1', name: 'Liderança', order: 1, active: true },
    { id: 'c2', name: 'Gratidão', order: 2, active: true },
  ],
}

/** Roteia por URL: mural, catálogo, colegas, setores, recebidos/enviados e criação. */
function mockApi(handlers: {
  wall?: (url: string) => unknown
  users?: unknown
  received?: unknown
  sent?: unknown
  create?: (url: string) => unknown
  /** Empresa com chave de IA cadastrada — o que libera "Escrever com IA". */
  aiConfigured?: boolean
}) {
  return vi.spyOn(api, 'apiFetch').mockImplementation((async (url: string, options?: RequestInit) => {
    if (url.startsWith('/feedbacks/mural')) {
      return handlers.wall?.(url) ?? { feedbacks: [], hasMore: false }
    }
    if (url.startsWith('/feedbacks/received')) return handlers.received ?? { feedbacks: [], hasMore: false }
    if (url.startsWith('/feedbacks/sent')) return handlers.sent ?? { feedbacks: [], hasMore: false }
    if (url === '/categories') return CATEGORIES
    if (url === '/users/company') return handlers.users ?? { users: [] }
    if (url === '/ai/status') return { configured: handlers.aiConfigured ?? false }
    if (url === '/sectors') return { sectors: [{ id: 's1', name: 'Produto' }] }
    if (options?.method === 'POST') return handlers.create?.(url) ?? { feedback: { id: 'new' } }
    return {}
  }) as unknown as typeof api.apiFetch)
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openTab(name: RegExp) {
  fireEvent.click(await screen.findByRole('tab', { name }))
}

/** Abre o seletor de categorias e marca uma pela lista. */
async function escolherCategoria(name: string) {
  fireEvent.click(await screen.findByRole('combobox', { name: /categorias do feedback/i }))
  fireEvent.click(await screen.findByRole('button', { name }))
}

describe('MuralFeedbacksPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue({ user: person('u1', 'Ana') })
  })

  it('abre no Mural (não no formulário) e pagina', async () => {
    mockApi({
      wall: (url) =>
        url.includes('offset=0')
          ? { feedbacks: [sharedFeedback('f1', 'Primeiro feedback da lista paginada.')], hasMore: true }
          : { feedbacks: [sharedFeedback('f2', 'Segundo feedback da lista paginada.')], hasMore: false },
    })

    wrap(<MuralFeedbacksPage />)

    // O mural é o conteúdo principal: o formulário saiu da frente e virou aba.
    expect(await screen.findByText(/Primeiro feedback/i)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /reconheça um colega/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /carregar mais/i }))
    expect(await screen.findByText(/Segundo feedback/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: /carregar mais/i })).toBeNull())
  })

  it('busca e filtro viajam para o servidor', async () => {
    const spy = mockApi({})
    wrap(<MuralFeedbacksPage />)

    fireEvent.change(await screen.findByPlaceholderText(/buscar por colega/i), { target: { value: 'incidente' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Categoria' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Gratidão' }))
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('q=incidente')),
    )
    expect(spy.mock.calls.some(([url]) => String(url).includes('categoryId=c2'))).toBe(true)
  })

  it('envia reconhecimento grupal com competências e público', async () => {
    const spy = mockApi({ users: { users: [person('u9', 'Brenna'), person('u8', 'Caio')] } })

    wrap(<MuralFeedbacksPage />)
    await openTab(/enviar/i)

    fireEvent.change(await screen.findByRole('combobox', { name: /para quem é o feedback/i }), {
      target: { value: 'brenna' },
    })
    fireEvent.click(await screen.findByRole('button', { name: /brenna/i }))
    fireEvent.change(screen.getByRole('combobox', { name: /para quem é o feedback/i }), {
      target: { value: 'caio' },
    })
    fireEvent.click(await screen.findByRole('button', { name: /caio/i }))

    await escolherCategoria('Liderança')
    fireEvent.change(screen.getByLabelText(/mensagem do feedback/i), {
      target: { value: 'Seguraram a virada do sistema no fim de semana com muita calma.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /enviar feedback/i }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/users/u9/feedbacks', expect.objectContaining({ method: 'POST' })),
    )
    const [, options] = spy.mock.calls.find(([url]) => url === '/users/u9/feedbacks')!
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      message: 'Seguraram a virada do sistema no fim de semana com muita calma.',
      category: 'ELOGIO',
      targetIds: ['u8'],
      categoryIds: ['c1'],
      isPublic: true,
    })
  })

  it('lista o setor inteiro ao abrir o seletor, não só os primeiros nomes', async () => {
    // Regressão: o teto de 8 resultados fazia a lista aberta esconder metade do
    // setor — quem estava depois da 8ª posição alfabética só aparecia digitando.
    const colegas = Array.from({ length: 12 }, (_, i) => person(`u${i}`, `Colega ${String(i).padStart(2, '0')}`))
    mockApi({ users: { users: [...colegas, person('uk', 'Karina')] } })

    wrap(<MuralFeedbacksPage />)
    await openTab(/enviar/i)

    fireEvent.focus(await screen.findByRole('combobox', { name: /para quem é o feedback/i }))

    expect(await screen.findByRole('button', { name: /karina/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /colega 11/i })).toBeInTheDocument()
  })

  it('seletor de categorias abre com busca e marca pela lista', async () => {
    mockApi({})
    wrap(<MuralFeedbacksPage />)
    await openTab(/enviar/i)

    // Fechado, o campo só anuncia o que fazer — o catálogo inteiro não fica à mostra.
    const trigger = await screen.findByRole('combobox', { name: /categorias do feedback/i })
    expect(screen.getByText('Selecione as categorias…')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /liderança/i })).toBeNull()

    fireEvent.click(trigger)
    fireEvent.change(screen.getByPlaceholderText(/buscar categoria/i), { target: { value: 'grat' } })
    expect(screen.queryByRole('option', { name: /liderança/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Gratidão' }))

    expect(screen.getByRole('option', { name: 'Gratidão' })).toHaveAttribute('aria-selected', 'true')
  })

  it('só oferece "Escrever com IA" quando a empresa tem chave cadastrada', async () => {
    mockApi({})
    const { unmount } = wrap(<MuralFeedbacksPage />)
    await openTab(/enviar/i)
    expect(await screen.findByLabelText(/mensagem do feedback/i)).toBeInTheDocument()
    // Sem chave, o botão nem aparece: ele responderia 503 mandando falar com o
    // admin, e quem escreve o reconhecimento não é quem cadastra a chave.
    expect(screen.queryByRole('button', { name: /escrever com ia/i })).toBeNull()
    unmount()

    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue({ user: person('u1', 'Ana') })
    mockApi({ aiConfigured: true })
    wrap(<MuralFeedbacksPage />)
    await openTab(/enviar/i)
    expect(await screen.findByRole('button', { name: /escrever com ia/i })).toBeInTheDocument()
  })

  it('exige destinatário antes de enviar', async () => {
    mockApi({})
    wrap(<MuralFeedbacksPage />)
    await openTab(/enviar/i)

    await escolherCategoria('Liderança')
    fireEvent.change(screen.getByLabelText(/mensagem do feedback/i), {
      target: { value: 'Mensagem longa o bastante para passar na validação.' },
    })
    fireEvent.submit(screen.getByRole('form', { name: /reconheça um colega/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/escolha para quem/i)
  })

  it('"Recebidos" vazio traz a copy oficial da G&G', async () => {
    mockApi({})
    wrap(<MuralFeedbacksPage />)
    await openTab(/recebidos/i)

    expect(await screen.findByText(/Você ainda não recebeu feedbacks/i)).toBeInTheDocument()
    expect(screen.getByText(/dando um feedback a um colega/i)).toBeInTheDocument()
  })

  it('"Enviados" mostra o que a pessoa escreveu, marcando o que está privado', async () => {
    mockApi({
      sent: {
        feedbacks: [sharedFeedback('f9', 'Reconhecimento que ainda não foi ao mural.', { sharedAt: null })],
        hasMore: false,
      },
    })
    wrap(<MuralFeedbacksPage />)
    await openTab(/enviados/i)

    expect(await screen.findByText(/ainda não foi ao mural/i)).toBeInTheDocument()
    expect(screen.getByText('Privado')).toBeInTheDocument()
  })

  it('esconde a aba Enviar de administradores', async () => {
    mockApi({})
    mockUseAuth.mockReturnValue({ user: person('a1', 'Admin', { role: 'ADMIN' }) })

    wrap(<MuralFeedbacksPage />)

    expect(await screen.findByRole('heading', { name: /mural de feedbacks/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /enviar/i })).toBeNull()
  })
})
