import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

import { MapsSection } from './MapsSection'

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><MapsSection /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation((path: string) => {
    if (path === '/admin/office-maps') {
      return Promise.resolve({
        maps: [{
          id: 'map-1',
          name: 'Matriz',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          publications: [{
            id: 'publication-1', version: 1, schemaVersion: '1.0.0',
            createdAt: new Date(0).toISOString(), createdBy: null, active: true,
          }],
        }],
      })
    }
    if (path === '/admin/office-rooms') return Promise.resolve({ rooms: [] })
    if (path === '/admin/users') return Promise.resolve({ users: [] })
    return Promise.resolve({})
  })
})

describe('MapsSection', () => {
  it('lista versões e oferece o editor em uma aba administrativa independente', async () => {
    renderSection()
    expect(await screen.findByText('Matriz')).toBeInTheDocument()
    expect(screen.getByText('ATIVA')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/admin/mapas/map-1/editar')
    expect(screen.getByText(/ainda não possui salas/i)).toBeInTheDocument()
  })

  it('cria um mapa com dimensões e tile configuráveis', async () => {
    renderSection()
    await screen.findByText('Matriz')
    fireEvent.click(screen.getByRole('button', { name: '+ Novo mapa' }))
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Filial' } })
    fireEvent.change(screen.getByLabelText('Largura'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Altura'), { target: { value: '24' } })
    fireEvent.click(screen.getByLabelText('Tile'))
    fireEvent.click(screen.getByRole('option', { name: '48 × 48 px' }))
    fireEvent.click(screen.getByRole('button', { name: 'Criar mapa' }))
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      '/admin/office-maps',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Filial', width: 30, height: 24, tileSize: 48 }),
      }),
    ))
  })
})
