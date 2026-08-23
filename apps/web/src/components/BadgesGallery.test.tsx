import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { BadgesGallery } from './BadgesGallery'
import { apiFetch } from '../lib/api'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Ana' }, loading: false, login: vi.fn(), logout: vi.fn() }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function setupFetch() {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/badges') {
      return Promise.resolve({
        badges: [
          { id: 'b1', slug: 'conector', name: 'Conector do Time', description: '5 em colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', requirement: 'Receba 5 votos em Colaboração', progress: { current: 5, target: 5 } },
          { id: 'b2', slug: 'reconhecido', name: 'Reconhecido', description: '10 no total', kind: 'IMPACT', iconKey: 'star', threshold: 10, categorySlug: null, requirement: 'Receba 10 votos no total', progress: { current: 4, target: 10 } },
        ],
      })
    }
    if (path === '/users/u1/badges') {
      return Promise.resolve({
        badges: [
          {
            id: 'ub1',
            awardedAt: '2026-06-01T00:00:00.000Z',
            badge: { id: 'b1', slug: 'conector', name: 'Conector do Time', description: '5 em colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao' },
          },
        ],
      })
    }
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

function renderGallery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BadgesGallery />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BadgesGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('shows the catalog and marks earned badges', async () => {
    renderGallery()
    expect(await screen.findByText('Conector do Time')).toBeInTheDocument()
    expect(screen.getByText('Reconhecido')).toBeInTheDocument()
    const earned = await screen.findAllByText(/conquistado/i)
    expect(earned).toHaveLength(1)
  })

  it('shows the requirement, the progress for unearned badges, and the badge emblems', async () => {
    renderGallery()
    expect(await screen.findByText('Receba 10 votos no total')).toBeInTheDocument()
    // selo não conquistado mostra progresso "4/10"
    expect(screen.getByText('4/10')).toBeInTheDocument()
    // emblema de cada selo é renderizado (BadgeEmblem usa role="img")
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2)
  })

  it('mostra chips só dos tipos presentes no catálogo e filtra a lista', async () => {
    renderGallery()
    expect(await screen.findByRole('button', { name: 'Categoria' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Impacto' })).toBeInTheDocument()
    // Nenhum selo de ofensiva no catálogo → nenhum chip de ofensiva.
    expect(screen.queryByRole('button', { name: 'Ofensiva' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Impacto' }))
    expect(screen.getByText('Reconhecido')).toBeInTheDocument()
    expect(screen.queryByText('Conector do Time')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByText('Conector do Time')).toBeInTheDocument()
  })

  it('mostra estado vazio quando o filtro não casa com nenhum selo', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges') {
        return Promise.resolve({
          badges: [
            { id: 'b1', slug: 'conector', name: 'Conector do Time', description: 'x', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', requirement: 'r', progress: null },
            { id: 'b2', slug: 'reconhecido', name: 'Reconhecido', description: 'y', kind: 'IMPACT', iconKey: 'star', threshold: 10, categorySlug: null, requirement: 'r', progress: null },
          ],
        })
      }
      return Promise.resolve({ badges: [] })
    })
    renderGallery()

    await userEvent.click(await screen.findByRole('button', { name: 'Impacto' }))
    expect(screen.queryByText('Conector do Time')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    expect(screen.getByText('Conector do Time')).toBeInTheDocument()
    expect(screen.queryByText('Reconhecido')).toBeNull()
  })
})
