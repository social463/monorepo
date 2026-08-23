import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KnowledgeEntryDTO } from '@legends/shared'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string, sectorId: 'sector-admin' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mockAuth.role, name: 'Admin', sectorId: mockAuth.sectorId } }),
}))

import { KnowledgeBaseSection } from './KnowledgeBaseSection'

const ENTRADA: KnowledgeEntryDTO = {
  id: 'k1',
  category: 'Férias',
  question: 'Quantos dias de férias?',
  answer: 'São 30 dias corridos.',
  keywords: ['ferias'],
  isActive: true,
  sectorId: null,
  sectorName: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

const GAPS = {
  unanswered: [
    {
      normalized: 'quantos dias de licenca paternidade',
      sample: 'Quantos dias de licença paternidade?',
      count: 5,
      lastAskedAt: '2026-07-30T12:00:00.000Z',
    },
  ],
  frequent: [],
  negative: [{ entry: ENTRADA, negativeCount: 4, comments: ['não diz do período aquisitivo'] }],
}

const ENTRADA_SETOR: KnowledgeEntryDTO = {
  ...ENTRADA,
  id: 'k2',
  question: 'Como peço reembolso de setor?',
  sectorId: 's1',
  sectorName: 'Gente e Gestão',
}

const SECTORS = [{ id: 's1', name: 'Gente e Gestão' }]

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeBaseSection />
    </QueryClientProvider>,
  )
}

function mockApi(entries: KnowledgeEntryDTO[] = [ENTRADA]) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path.startsWith('/admin/knowledge')) {
      return Promise.resolve({ entries, categories: ['Férias'] })
    }
    if (path.startsWith('/admin/assistant/gaps')) return Promise.resolve(GAPS)
    if (path.startsWith('/admin/sectors')) return Promise.resolve({ sectors: SECTORS })
    return Promise.resolve({ sectors: [] })
  })
}

beforeEach(() => {
  apiFetchMock.mockReset()
  mockAuth.role = 'ADMIN'
  mockAuth.sectorId = 'sector-admin'
})

describe('KnowledgeBaseSection', () => {
  it('lista as entradas da base, com setor e status', async () => {
    mockApi()
    renderSection()

    expect(await screen.findByText('Quantos dias de férias?')).toBeTruthy()
    expect(screen.getByText('Férias')).toBeTruthy()
    expect(screen.getByText('Toda a empresa')).toBeTruthy()
    expect(screen.getByText('Ativa')).toBeTruthy()
  })

  it('cria uma entrada nova com o corpo serializado corretamente', async () => {
    mockApi([])
    renderSection()
    await screen.findByRole('button', { name: 'Nova entrada' })

    fireEvent.click(screen.getByRole('button', { name: 'Nova entrada' }))
    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Como peço reembolso?' } })
    fireEvent.change(screen.getByLabelText('Resposta'), { target: { value: 'Pelo portal, até o dia 20.' } })
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Financeiro' } })
    fireEvent.change(screen.getByLabelText('Palavras-chave (separadas por vírgula)'), {
      target: { value: 'reembolso, portal' },
    })
    fireEvent.click(screen.getByLabelText('Ativa'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/knowledge', {
        method: 'POST',
        body: JSON.stringify({
          category: 'Financeiro',
          question: 'Como peço reembolso?',
          answer: 'Pelo portal, até o dia 20.',
          keywords: ['reembolso', 'portal'],
          isActive: false,
          sectorId: null,
        }),
      })
    })
  })

  it('mostra as lacunas agrupadas com contagem', async () => {
    mockApi()
    renderSection()
    await screen.findByText('Quantos dias de férias?')

    fireEvent.click(screen.getByRole('button', { name: 'Lacunas' }))

    expect(await screen.findByText('Quantos dias de licença paternidade?')).toBeTruthy()
    expect(screen.getByText('5×')).toBeTruthy()
    expect(screen.getByText('não diz do período aquisitivo')).toBeTruthy()
  })

  it('troca a janela das lacunas e refaz a busca com o novo período', async () => {
    mockApi()
    renderSection()
    await screen.findByText('Quantos dias de férias?')
    fireEvent.click(screen.getByRole('button', { name: 'Lacunas' }))
    await screen.findByText('Quantos dias de licença paternidade?')

    apiFetchMock.mockClear()
    fireEvent.change(screen.getByLabelText('Janela'), { target: { value: '7' } })

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/assistant/gaps?days=7')
    })
  })

  it('atalho "Criar entrada" na lacuna sem resposta preenche a pergunta na aba Base', async () => {
    mockApi()
    renderSection()
    await screen.findByText('Quantos dias de férias?')
    fireEvent.click(screen.getByRole('button', { name: 'Lacunas' }))
    await screen.findByText('Quantos dias de licença paternidade?')

    fireEvent.click(screen.getByRole('button', { name: 'Criar entrada' }))

    expect(await screen.findByRole('button', { name: 'Salvar' })).toBeTruthy()
    expect(screen.getByLabelText('Pergunta')).toHaveValue('Quantos dias de licença paternidade?')
  })

  it('trava o setor no formulário para SUBADMIN e envia o setor certo no POST', async () => {
    mockAuth.role = 'SUBADMIN'
    mockAuth.sectorId = 's1'
    mockApi([])
    renderSection()
    await screen.findByRole('button', { name: 'Nova entrada' })

    fireEvent.click(screen.getByRole('button', { name: 'Nova entrada' }))

    const sectorField = screen.getByLabelText('Setor')
    expect(sectorField).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Como funciona o vale-cultura?' } })
    fireEvent.change(screen.getByLabelText('Resposta'), { target: { value: 'Direto no cartão, todo dia 5.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/knowledge', {
        method: 'POST',
        body: JSON.stringify({
          category: null,
          question: 'Como funciona o vale-cultura?',
          answer: 'Direto no cartão, todo dia 5.',
          keywords: [],
          isActive: true,
          sectorId: 's1',
        }),
      })
    })
  })

  describe('exclusão com confirmação', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('não apaga a entrada quando a confirmação é recusada', async () => {
      mockApi()
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderSection()
      await screen.findByText('Quantos dias de férias?')

      fireEvent.click(screen.getByRole('button', { name: 'Apagar' }))

      expect(window.confirm).toHaveBeenCalled()
      expect(apiFetchMock).not.toHaveBeenCalledWith('/admin/knowledge/k1', expect.objectContaining({ method: 'DELETE' }))
    })

    it('apaga a entrada quando a confirmação é aceita', async () => {
      mockApi()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      renderSection()
      await screen.findByText('Quantos dias de férias?')

      fireEvent.click(screen.getByRole('button', { name: 'Apagar' }))

      await waitFor(() => {
        expect(apiFetchMock).toHaveBeenCalledWith('/admin/knowledge/k1', { method: 'DELETE' })
      })
    })

    it('mostra mensagem quando a exclusão falha (ex.: SUBADMIN barrado com 403)', async () => {
      apiFetchMock.mockImplementation((path: string, options?: { method?: string }) => {
        if (options?.method === 'DELETE') {
          return Promise.reject(new Error('Você só pode gerenciar entradas do seu setor.'))
        }
        if (path.startsWith('/admin/knowledge')) return Promise.resolve({ entries: [ENTRADA], categories: ['Férias'] })
        if (path.startsWith('/admin/assistant/gaps')) return Promise.resolve(GAPS)
        if (path.startsWith('/admin/sectors')) return Promise.resolve({ sectors: SECTORS })
        return Promise.resolve({ sectors: [] })
      })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      renderSection()
      await screen.findByText('Quantos dias de férias?')

      fireEvent.click(screen.getByRole('button', { name: 'Apagar' }))

      expect(await screen.findByText('Você só pode gerenciar entradas do seu setor.')).toBeTruthy()
    })
  })

  it('SUBADMIN não vê ações na entrada da empresa, mas vê na do próprio setor', async () => {
    mockAuth.role = 'SUBADMIN'
    mockAuth.sectorId = 's1'
    mockApi([ENTRADA, ENTRADA_SETOR])
    renderSection()

    await screen.findByText('Quantos dias de férias?')
    await screen.findByText('Como peço reembolso de setor?')

    const linhaEmpresa = screen.getByText('Quantos dias de férias?').closest('li')!
    const linhaSetor = screen.getByText('Como peço reembolso de setor?').closest('li')!

    expect(within(linhaEmpresa).queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(within(linhaEmpresa).queryByRole('button', { name: 'Apagar' })).toBeNull()
    expect(within(linhaSetor).getByRole('button', { name: 'Editar' })).toBeTruthy()
    expect(within(linhaSetor).getByRole('button', { name: 'Apagar' })).toBeTruthy()
  })
})
