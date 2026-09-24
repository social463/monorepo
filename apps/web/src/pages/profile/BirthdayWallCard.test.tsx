import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { BirthdayWallCard } from './BirthdayWallCard'
import * as api from '../../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

function author(id: string, name: string) {
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
  }
}

function greeting(id: string, name: string, message: string) {
  return {
    id,
    author: author(`u-${id}`, name),
    message,
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    reactions: [],
    canEdit: false,
    canDelete: false,
  }
}

const OCORRENCIA_HOJE = {
  kind: 'BIRTH' as const,
  year: 2026,
  date: '2026-08-31',
  years: null,
  isToday: true,
  isOpen: true,
  greetingCount: 1,
}

function mockApi(wall: Record<string, unknown>) {
  return vi.spyOn(api, 'apiFetch').mockImplementation((async (url: string) => {
    if (url.includes('/birthday-wall')) return wall
    return {}
  }) as unknown as typeof api.apiFetch)
}

function wrap(autoFocus = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BirthdayWallCard targetId="alvo" targetName="Victoria Fernandes" autoFocus={autoFocus} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BirthdayWallCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue({ user: { id: 'eu', name: 'Lucca', role: 'LEGEND' } })
  })

  it('mostra o mural do dia, as assinaturas e as frases prontas', async () => {
    mockApi({
      occurrences: [OCORRENCIA_HOJE],
      selected: OCORRENCIA_HOJE,
      greetings: [greeting('g1', 'Ana', 'Feliz aniversário! 🎉')],
      canSign: true,
      mySignatureId: null,
    })

    wrap()

    expect(await screen.findByText('Mural de aniversário')).toBeInTheDocument()
    expect(screen.getByText(/É hoje!/)).toBeInTheDocument()
    expect(screen.getByText('Feliz aniversário! 🎉')).toBeInTheDocument()
    // A frase pronta é rascunho, não resposta pronta.
    expect(screen.getByRole('button', { name: 'Parabéns! 🎉' })).toBeInTheDocument()
  })

  it('a frase pronta preenche o campo e o envio manda kind, ano e mensagem', async () => {
    const spy = mockApi({
      occurrences: [OCORRENCIA_HOJE],
      selected: OCORRENCIA_HOJE,
      greetings: [],
      canSign: true,
      mySignatureId: null,
    })

    wrap()

    fireEvent.click(await screen.findByRole('button', { name: 'Parabéns! 🎉' }))
    const campo = screen.getByLabelText(/Mensagem para Victoria/i)
    expect(campo).toHaveValue('Parabéns! 🎉')

    fireEvent.change(campo, { target: { value: 'Parabéns, Victoria! 🎂' } })
    fireEvent.click(screen.getByRole('button', { name: /assinar o mural/i }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/users/alvo/birthday-wall', expect.objectContaining({ method: 'POST' })),
    )
    const [, options] = spy.mock.calls.find(([, opt]) => (opt as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      kind: 'BIRTH',
      year: 2026,
      message: 'Parabéns, Victoria! 🎂',
    })
  })

  it('some do perfil quando a pessoa não tem mural nenhum', async () => {
    mockApi({ occurrences: [], selected: null, greetings: [], canSign: false, mySignatureId: null })

    wrap()

    await waitFor(() => expect(screen.queryByTestId('birthday-wall')).toBeNull())
  })

  it('mural fechado vira leitura, com o aviso no lugar do formulário', async () => {
    const fechado = { ...OCORRENCIA_HOJE, isToday: false, isOpen: false, date: '2025-08-31', year: 2025 }
    mockApi({
      occurrences: [fechado],
      selected: fechado,
      greetings: [greeting('g1', 'Ana', 'Parabéns!')],
      canSign: false,
      mySignatureId: null,
    })

    wrap()

    expect(await screen.findByText(/já está fechado para novas mensagens/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /assinar o mural/i })).toBeNull()
  })

  it('quem já assinou vê o próprio texto e o botão de atualizar', async () => {
    const minha = { ...greeting('g1', 'Lucca', 'Parabéns!'), canEdit: true, canDelete: true }
    mockApi({
      occurrences: [OCORRENCIA_HOJE],
      selected: OCORRENCIA_HOJE,
      greetings: [minha],
      canSign: true,
      mySignatureId: 'g1',
    })

    wrap()

    expect(await screen.findByLabelText(/Mensagem para Victoria/i)).toHaveValue('Parabéns!')
    expect(screen.getByRole('button', { name: /atualizar mensagem/i })).toBeInTheDocument()
  })

  it('com mais de um mural, o seletor de ocorrência aparece', async () => {
    const antigo = { ...OCORRENCIA_HOJE, year: 2025, date: '2025-08-31', isToday: false, isOpen: false }
    mockApi({
      occurrences: [OCORRENCIA_HOJE, antigo],
      selected: OCORRENCIA_HOJE,
      greetings: [],
      canSign: true,
      mySignatureId: null,
    })

    wrap()

    const seletor = await screen.findByLabelText('Mural')
    expect(seletor).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Aniversário 2025/ })).toBeInTheDocument()
  })

  // `?parabens=1` no perfil: quem veio do botão de festa da Home cai com o
  // cursor no campo, sem procurar o mural no meio da coluna.
  it('com autoFocus, rola até o mural e foca o campo de mensagem', async () => {
    const scrollIntoView = vi.fn()
    // jsdom não implementa scrollIntoView; sem o stub o efeito lançaria.
    Element.prototype.scrollIntoView = scrollIntoView
    mockApi({
      occurrences: [OCORRENCIA_HOJE],
      selected: OCORRENCIA_HOJE,
      greetings: [],
      canSign: true,
      mySignatureId: null,
    })

    wrap(true)

    const campo = await screen.findByLabelText('Mensagem para Victoria')
    await waitFor(() => expect(campo).toHaveFocus())
    expect(scrollIntoView).toHaveBeenCalled()
  })
})
