import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MonthlyHighlightsTab, currentMonthRef, defaultMonthRef } from './MonthlyHighlightsTab'
import * as api from '../../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

function person(id: string, name: string) {
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

function highlight(id: string, name: string, groupName: string, message: string | null = null) {
  return {
    id,
    monthRef: '2026-08',
    person: person(`u-${id}`, name),
    group: { id: `g-${groupName}`, name: groupName },
    message,
    createdAt: '2026-08-01T00:00:00.000Z',
  }
}

function mockApi(response: Record<string, unknown>, months: string[] = [currentMonthRef()]) {
  return vi.spyOn(api, 'apiFetch').mockImplementation((async (url: string) => {
    if (url.startsWith('/monthly-highlights/months')) return { months }
    if (url.startsWith('/monthly-highlights')) return response
    if (url === '/users/company') return { users: [person('u9', 'Brenna'), person('u8', 'Caio')] }
    return {}
  }) as unknown as typeof api.apiFetch)
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MonthlyHighlightsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MonthlyHighlightsTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue({ user: { id: 'u1', name: 'Ana', role: 'LEGEND' } })
  })

  it('mostra todo mundo numa grade só, com o grupo etiquetado em cada card', async () => {
    mockApi({
      monthRef: '2026-08',
      total: 3,
      canManage: false,
      groups: [
        { group: { id: 'g-Produto', name: 'Produto' }, people: [highlight('h1', 'Bia', 'Produto'), highlight('h2', 'Caio', 'Produto')] },
        { group: { id: 'g-Receita', name: 'Receita' }, people: [highlight('h3', 'Duda', 'Receita')] },
      ],
    })

    wrap()

    expect(await screen.findByText('Bia')).toBeInTheDocument()
    expect(screen.getByText('Caio')).toBeInTheDocument()
    expect(screen.getByText('Duda')).toBeInTheDocument()
    // A etiqueta acompanha a pessoa: o grupo deixou de ser título de seção.
    expect(screen.getAllByText('Produto')).toHaveLength(2)
    expect(screen.getAllByText('Receita')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Produto' })).toBeNull()
  })

  it('mês vazio traz o texto oficial da G&G — sem botão para quem não administra', async () => {
    mockApi({ monthRef: '2026-08', total: 0, groups: [], canManage: false })

    wrap()

    expect(await screen.findByText(/Nenhum destaque cadastrado para/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /adicionar o primeiro/i })).toBeNull()
  })

  it('admin vê "Adicionar o primeiro" no vazio e cadastra em lote', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'a1', name: 'Admin', role: 'ADMIN' } })
    const spy = mockApi({ monthRef: '2026-08', total: 0, groups: [], canManage: true })

    wrap()

    fireEvent.click(await screen.findByRole('button', { name: /adicionar o primeiro/i }))
    fireEvent.click(await screen.findByRole('button', { name: /brenna/i }))
    fireEvent.click(screen.getByRole('button', { name: /caio/i }))
    fireEvent.click(screen.getByRole('button', { name: /salvar destaque/i }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/monthly-highlights', expect.objectContaining({ method: 'POST' })),
    )
    const [, options] = spy.mock.calls.find(([, opt]) => (opt as RequestInit | undefined)?.method === 'POST')!
    const body = JSON.parse((options as RequestInit).body as string)
    // Só os ids: nome, setor e foto vêm do cadastro na hora de exibir.
    expect(body.userIds).toEqual(['u9', 'u8'])
    expect(Object.keys(body).sort()).toEqual(['monthRef', 'userIds'])
  })

  it('abre no último mês registrado quando o mês corrente ainda está vazio', async () => {
    const current = currentMonthRef()
    const [year, month] = current.split('-').map(Number)
    const previous = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`
    const spy = mockApi(
      {
        monthRef: previous,
        total: 1,
        canManage: false,
        groups: [{ group: { id: 'g-Produto', name: 'Produto' }, people: [highlight('h1', 'Bia', 'Produto')] }],
      },
      [previous],
    )

    wrap()

    expect(await screen.findByText('Bia')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith(`/monthly-highlights?monthRef=${previous}`)
    expect(spy).not.toHaveBeenCalledWith(`/monthly-highlights?monthRef=${current}`)
    expect(screen.getByText(/mostrando os de/i)).toBeInTheDocument()
  })

  it('defaultMonthRef prefere o mês corrente e ignora mês futuro', () => {
    expect(defaultMonthRef(['2026-09', '2026-08', '2026-06'], '2026-08')).toBe('2026-08')
    expect(defaultMonthRef(['2026-09', '2026-07'], '2026-08')).toBe('2026-07')
    expect(defaultMonthRef([], '2026-08')).toBe('2026-08')
  })

  it('a justificativa aparece no card quando existe', async () => {
    mockApi({
      monthRef: '2026-08',
      total: 1,
      canManage: false,
      groups: [
        {
          group: { id: 'g-Produto', name: 'Produto' },
          people: [highlight('h1', 'Bia', 'Produto', 'Segurou a virada do sistema.')],
        },
      ],
    })

    wrap()

    expect(await screen.findByText(/Segurou a virada do sistema/)).toBeInTheDocument()
  })
})
