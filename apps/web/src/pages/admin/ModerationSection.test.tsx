import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { ModerationSection } from './ModerationSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/votes' && !method) {
      return Promise.resolve({
        votes: [{ id: 'v1', voter: { id: 'u2', name: 'Carla' }, voted: { id: 'u3', name: 'Bruno' }, categories: [{ id: 'c1', name: 'Colaboração', slug: 'colaboracao' }], justification: 'texto a moderar', createdAt: '2026-06-02T00:00:00.000Z', periodId: 'p1', monthRef: '2026-06' }],
      })
    }
    if (path === '/admin/votes/v1' && method === 'DELETE') {
      return Promise.resolve({})
    }
    if (path.startsWith('/admin/corporate-posts/reach')) {
      return Promise.resolve({
        items: [{ postId: 'p1', excerpt: 'comunicado medido', readers: 5, readPct: 50, comments: 1, reactions: 2, createdAt: '2026-07-30T12:00:00.000Z' }],
        audience: 10,
        total: 1,
      })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ModerationSection />
    </QueryClientProvider>,
  )
}

describe('ModerationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('lista votos para moderação', async () => {
    renderSection()
    expect(await screen.findByText(/texto a moderar/)).toBeInTheDocument()
  })

  it('removes a vote in moderation', async () => {
    renderSection()
    await screen.findByText(/texto a moderar/)
    fireEvent.click(screen.getByRole('button', { name: /remover/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/votes/v1', expect.objectContaining({ method: 'DELETE' })),
    )
  })

  it('abre na aba de votos', async () => {
    renderSection()
    expect(await screen.findByText(/texto a moderar/)).toBeInTheDocument()
    expect(screen.queryByText('comunicado medido')).not.toBeInTheDocument()
  })

  it('troca para a aba de alcance do feed e mostra os números', async () => {
    renderSection()
    await screen.findByText(/texto a moderar/)
    fireEvent.click(screen.getByRole('tab', { name: 'Alcance do feed' }))
    expect(await screen.findByText('comunicado medido')).toBeInTheDocument()
  })
})
