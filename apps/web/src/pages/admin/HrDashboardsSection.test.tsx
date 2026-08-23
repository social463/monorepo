import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string, sectorId: 'sector-admin' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mockAuth.role, name: 'Admin', sectorId: mockAuth.sectorId } }),
}))

import { HrDashboardsSection } from './HrDashboardsSection'

const ALLOWED = ['app.powerbi.com', 'lookerstudio.google.com']

function dashboard(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1',
    title: 'Headcount',
    description: 'Pessoas ativas por setor',
    embedUrl: 'https://app.powerbi.com/view?r=abc',
    height: 720,
    sortOrder: 10,
    sectorId: null,
    sectorName: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...over,
  }
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <HrDashboardsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetchMock.mockReset()
  mockAuth.role = 'ADMIN'
  mockAuth.sectorId = 'sector-admin'
})

describe('HrDashboardsSection', () => {
  it('mostra estado vazio com a ação de cadastrar o primeiro painel', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/admin/hr-dashboards')) return Promise.resolve({ dashboards: [], allowedHosts: ALLOWED })
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    expect(await screen.findByText('Nenhum painel cadastrado ainda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cadastrar o primeiro painel' })).toBeInTheDocument()
  })

  it('renderiza os iframes na ordem de sortOrder, em sandbox e sem navegação no topo', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/admin/hr-dashboards')) {
        return Promise.resolve({
          dashboards: [
            dashboard({ id: 'd1', title: 'Headcount', sortOrder: 10 }),
            dashboard({
              id: 'd2',
              title: 'Turnover',
              sortOrder: 20,
              sectorId: 's1',
              sectorName: 'Gente e Gestão',
              embedUrl: 'https://lookerstudio.google.com/embed/reporting/xyz',
            }),
          ],
          allowedHosts: ALLOWED,
        })
      }
      return Promise.resolve({ sectors: [{ id: 's1', name: 'Gente e Gestão' }] })
    })

    const { container } = renderSection()

    await screen.findByText('Headcount')
    const iframes = Array.from(container.querySelectorAll('iframe'))
    expect(iframes.map((f) => f.getAttribute('title'))).toEqual(['Headcount', 'Turnover'])

    for (const frame of iframes) {
      const sandbox = frame.getAttribute('sandbox') ?? ''
      expect(sandbox).toBe('allow-scripts allow-same-origin')
      expect(sandbox).not.toContain('allow-top-navigation')
      expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(frame.getAttribute('loading')).toBe('lazy')
    }

    expect(iframes[0].getAttribute('height')).toBe('720')
    expect(screen.getByText('Gente e Gestão')).toBeInTheDocument()
  })

  it('mostra a mensagem de erro do backend ao cadastrar URL recusada', async () => {
    apiFetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.startsWith('/admin/hr-dashboards') && init?.method === 'POST') {
        return Promise.reject(new Error('O endereço evil.com não está entre as ferramentas liberadas.'))
      }
      if (path.startsWith('/admin/hr-dashboards')) return Promise.resolve({ dashboards: [], allowedHosts: ALLOWED })
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar o primeiro painel' }))
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Painel' } })
    fireEvent.change(screen.getByLabelText('URL de embed'), { target: { value: 'https://evil.com/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar painel' }))

    await waitFor(() =>
      expect(screen.getByText('O endereço evil.com não está entre as ferramentas liberadas.')).toBeInTheDocument(),
    )
  })

  it('some o erro de uma submissão recusada ao reabrir o formulário para outro painel', async () => {
    apiFetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.startsWith('/admin/hr-dashboards/') && init?.method === 'PATCH') {
        return Promise.reject(new Error('O endereço evil.com não está entre as ferramentas liberadas.'))
      }
      if (path.startsWith('/admin/hr-dashboards')) {
        return Promise.resolve({
          dashboards: [
            dashboard({ id: 'd1', title: 'Headcount', sortOrder: 10 }),
            dashboard({ id: 'd2', title: 'Turnover', sortOrder: 20 }),
          ],
          allowedHosts: ALLOWED,
        })
      }
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    await screen.findByText('Headcount')

    // Edita o painel A (Headcount), submete e toma a recusa do backend.
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Salvar painel' }))
    await waitFor(() =>
      expect(screen.getByText('O endereço evil.com não está entre as ferramentas liberadas.')).toBeInTheDocument(),
    )

    // Sem cancelar, abre a edição do painel B (Turnover): o erro velho, de A,
    // não pode continuar visível — o admin não teria como saber que não é do B.
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[1])

    expect(
      screen.queryByText('O endereço evil.com não está entre as ferramentas liberadas.'),
    ).not.toBeInTheDocument()
  })

  it('some o erro de uma submissão recusada ao clicar em "Novo painel"', async () => {
    apiFetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.startsWith('/admin/hr-dashboards/') && init?.method === 'PATCH') {
        return Promise.reject(new Error('O endereço evil.com não está entre as ferramentas liberadas.'))
      }
      if (path.startsWith('/admin/hr-dashboards')) {
        return Promise.resolve({
          dashboards: [dashboard({ id: 'd1', title: 'Headcount', sortOrder: 10 })],
          allowedHosts: ALLOWED,
        })
      }
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    await screen.findByText('Headcount')

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar painel' }))
    await waitFor(() =>
      expect(screen.getByText('O endereço evil.com não está entre as ferramentas liberadas.')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Novo painel' }))

    expect(
      screen.queryByText('O endereço evil.com não está entre as ferramentas liberadas.'),
    ).not.toBeInTheDocument()
  })

  it('mostra a mensagem de erro do backend quando excluir é recusado', async () => {
    apiFetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.startsWith('/admin/hr-dashboards/') && init?.method === 'DELETE') {
        return Promise.reject(new Error('Você só pode gerenciar painéis do seu setor.'))
      }
      if (path.startsWith('/admin/hr-dashboards')) {
        return Promise.resolve({
          dashboards: [dashboard({ id: 'd1', title: 'Headcount' })],
          allowedHosts: ALLOWED,
        })
      }
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    await screen.findByText('Headcount')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))

    await waitFor(() =>
      expect(screen.getByText('Você só pode gerenciar painéis do seu setor.')).toBeInTheDocument(),
    )
  })

  it('esconde Editar/Excluir do SUBADMIN num painel da empresa, mas mostra no do próprio setor', async () => {
    mockAuth.role = 'SUBADMIN'
    mockAuth.sectorId = 's1'
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/admin/hr-dashboards')) {
        return Promise.resolve({
          dashboards: [
            dashboard({ id: 'd1', title: 'Painel da empresa', sectorId: null }),
            dashboard({ id: 'd2', title: 'Painel do meu setor', sectorId: 's1', sectorName: 'Gente e Gestão' }),
          ],
          allowedHosts: ALLOWED,
        })
      }
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    await screen.findByText('Painel da empresa')
    const companyArticle = screen.getByText('Painel da empresa').closest('article') as HTMLElement
    const sectorArticle = screen.getByText('Painel do meu setor').closest('article') as HTMLElement

    // Painel da empresa: SUBADMIN não gerencia (o backend recusaria), então nem oferece.
    expect(within(companyArticle).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(within(companyArticle).queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(within(companyArticle).getByRole('link', { name: 'Abrir em nova aba' })).toBeInTheDocument()

    // Painel do próprio setor: pode gerenciar.
    expect(within(sectorArticle).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(within(sectorArticle).getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
  })

  it('exige confirmação antes de chamar a API para excluir', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/admin/hr-dashboards')) {
        return Promise.resolve({
          dashboards: [dashboard({ id: 'd1', title: 'Headcount' })],
          allowedHosts: ALLOWED,
        })
      }
      return Promise.resolve({ sectors: [] })
    })

    renderSection()

    await screen.findByText('Headcount')
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    // Só troca para o estado de confirmação — a API não é chamada ainda.
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/admin/hr-dashboards/d1'), expect.objectContaining({ method: 'DELETE' }))
    expect(screen.getByRole('button', { name: 'Confirmar exclusão' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()

    // Cancelar também não chama a API, e volta ao estado normal.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/admin/hr-dashboards/d1'), expect.objectContaining({ method: 'DELETE' }))
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument()

    // Só ao confirmar de fato é que a API é chamada.
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/hr-dashboards/d1', { method: 'DELETE' }),
    )
  })
})
