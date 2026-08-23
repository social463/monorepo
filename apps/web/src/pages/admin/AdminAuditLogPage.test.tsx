import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AdminAuditLogPage } from './AdminAuditLogPage'
import * as api from '../../lib/api'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminAuditLogPage />
    </QueryClientProvider>,
  )
}

// Autores retornados por /admin/audit-log/actors — só quem já aparece como
// actorId em algum evento, incluindo admins (o caso que o filtro precisa cobrir).
const actorsResponse = {
  actors: [
    { id: 'u1', name: 'Ana' },
    { id: 'u2', name: 'Bia' },
  ],
}

describe('AdminAuditLogPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lista os eventos e expande o antes/depois ao clicar', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/admin/audit-log/actors')) return Promise.resolve(actorsResponse) as never
      return Promise.resolve({
        entries: [
          {
            id: 'e1',
            actor: { id: 'u1', name: 'Ana' },
            entityType: 'Category',
            entityId: 'c1',
            action: 'UPDATE',
            before: { active: true },
            after: { active: false },
            createdAt: '2027-05-01T12:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 30,
      }) as never
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Editou')).toBeInTheDocument())
    expect(screen.getByText('Ana', { selector: 'strong' })).toBeInTheDocument()
    // Tipo em pt-BR; sem nome legível no payload, o alvo cai no id.
    expect(screen.getByText('Categoria')).toBeInTheDocument()
    expect(screen.getByText('c1')).toBeInTheDocument()
    // O que mudou, sem precisar abrir o diff.
    expect(screen.getByText(/Alterou: ativo/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ver detalhes/i }))
    expect(await screen.findByText(/"active": true/)).toBeInTheDocument()
    expect(screen.getByText(/"active": false/)).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('/admin/audit-log'))
  })

  it('trata before nulo (CREATE) como "não existia antes", sem quebrar em campo nulo', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/admin/audit-log/actors')) return Promise.resolve(actorsResponse) as never
      return Promise.resolve({
        entries: [
          {
            id: 'e2',
            actor: { id: 'u2', name: 'Bia' },
            entityType: 'Badge',
            entityId: 'b1',
            action: 'CREATE',
            before: null,
            after: { name: 'Selo novo' },
            createdAt: '2027-05-01T12:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 30,
      }) as never
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Criou')).toBeInTheDocument())
    expect(screen.getByText('Bia', { selector: 'strong' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ver detalhes/i }))
    expect(await screen.findByText(/não existia antes/i)).toBeInTheDocument()
    expect(screen.getByText(/"name": "Selo novo"/)).toBeInTheDocument()
  })

  it('trata after nulo (DELETE) como "não existe mais", sem quebrar em campo nulo', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/admin/audit-log/actors')) return Promise.resolve(actorsResponse) as never
      return Promise.resolve({
        entries: [
          {
            id: 'e3',
            actor: { id: 'u2', name: 'Bia' },
            entityType: 'Badge',
            entityId: 'b1',
            action: 'DELETE',
            before: { name: 'Selo antigo' },
            after: null,
            createdAt: '2027-05-01T12:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 30,
      }) as never
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Excluiu')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ver detalhes/i }))
    expect(await screen.findByText(/"name": "Selo antigo"/)).toBeInTheDocument()
    expect(screen.getByText(/não existe mais/i)).toBeInTheDocument()
  })

  it('popula o filtro de autor com admins vindos de /admin/audit-log/actors (não com /admin/users, que os exclui)', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/admin/audit-log/actors')) return Promise.resolve(actorsResponse) as never
      if (path.startsWith('/admin/users')) throw new Error('não deveria chamar /admin/users: exclui admins do resultado')
      return Promise.resolve({ entries: [], total: 0, page: 1, pageSize: 30 }) as never
    })
    renderPage()
    fireEvent.click(await screen.findByLabelText('Filtrar por autor'))
    expect(await screen.findByRole('option', { name: 'Ana' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Bia' })).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith('/admin/audit-log/actors')
  })

  it('refaz a busca com actorId, entityType e intervalo de datas ao filtrar', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/admin/audit-log/actors')) return Promise.resolve(actorsResponse) as never
      return Promise.resolve({ entries: [], total: 0, page: 1, pageSize: 30 }) as never
    })
    renderPage()
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('/admin/audit-log')))

    fireEvent.click(screen.getByLabelText('Filtrar por autor'))
    fireEvent.click(await screen.findByRole('option', { name: 'Bia' }))
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('actorId=u2')),
    )

    fireEvent.click(screen.getByLabelText('Filtrar por tipo de entidade'))
    fireEvent.click(await screen.findByRole('option', { name: 'Setor' }))
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('entityType=Sector')),
    )

    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2027-01-01' } })
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('from=2027-01-01')))

    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2027-01-31' } })
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('to=2027-01-31')))
  })

  it('lista CorporatePost e CorporatePostComment no filtro de tipo de entidade (auditoria de moderação do mural)', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/admin/audit-log/actors')) return Promise.resolve(actorsResponse) as never
      return Promise.resolve({ entries: [], total: 0, page: 1, pageSize: 30 }) as never
    })
    renderPage()
    fireEvent.click(await screen.findByLabelText('Filtrar por tipo de entidade'))
    expect(await screen.findByRole('option', { name: 'Publicação do feed' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Comentário do feed' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'Publicação do feed' }))
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('entityType=CorporatePost')),
    )
  })

  it('mostra mensagem quando não há eventos', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path.startsWith('/admin/audit-log/actors')) return Promise.resolve(actorsResponse) as never
      return Promise.resolve({ entries: [], total: 0, page: 1, pageSize: 30 }) as never
    })
    renderPage()
    expect(await screen.findByText('Nenhum evento encontrado.')).toBeInTheDocument()
  })
})
