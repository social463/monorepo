import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi, type Mock, describe, it, expect, beforeEach } from 'vitest'
import { CorporateMuralReachTab } from './CorporateMuralReachTab'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

beforeEach(() => {
  vi.clearAllMocks()
  mockApiFetch.mockResolvedValue({
    items: [
      { postId: 'p1', excerpt: 'aviso de férias coletivas', readers: 12, readPct: 25, comments: 3, reactions: 7, createdAt: '2026-07-30T12:00:00.000Z' },
    ],
    audience: 48,
    total: 1,
  })
})

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      {/* O detalhe de quem reagiu leva ao perfil da pessoa — o Link precisa de router. */}
      <MemoryRouter>
        <CorporateMuralReachTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CorporateMuralReachTab', () => {
  it('mostra leitores únicos, percentual e o denominador', async () => {
    renderTab()
    expect(await screen.findByText('aviso de férias coletivas')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText(/48 pessoas/)).toBeInTheDocument()
  })

  it('não expõe nome de quem leu', async () => {
    renderTab()
    await screen.findByText('aviso de férias coletivas')
    expect(screen.queryByText(/quem leu/i)).not.toBeInTheDocument()
  })

  it('inverte a ordem ao clicar no cabeçalho de data', async () => {
    renderTab()
    await screen.findByText('aviso de férias coletivas')
    fireEvent.click(screen.getByRole('button', { name: /data/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/corporate-posts/reach?sort=date_asc&page=1&pageSize=20'),
    )
  })

  it('avança de página e busca a próxima leva de posts', async () => {
    mockApiFetch.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => ({
        postId: `p${i}`,
        excerpt: `post ${i}`,
        readers: 1,
        readPct: 10,
        comments: 0,
        reactions: 0,
        createdAt: '2026-07-30T12:00:00.000Z',
      })),
      audience: 48,
      total: 25,
    })
    renderTab()
    await screen.findByText('post 0')
    expect(screen.getByText(/Mostrando 1–20 de 25/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenLastCalledWith('/admin/corporate-posts/reach?sort=date_desc&page=2&pageSize=20'),
    )
  })

  it('reseta para a página 1 ao trocar a ordenação', async () => {
    mockApiFetch.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => ({
        postId: `p${i}`,
        excerpt: `post ${i}`,
        readers: 1,
        readPct: 10,
        comments: 0,
        reactions: 0,
        createdAt: '2026-07-30T12:00:00.000Z',
      })),
      audience: 48,
      total: 25,
    })
    renderTab()
    await screen.findByText('post 0')

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenLastCalledWith('/admin/corporate-posts/reach?sort=date_desc&page=2&pageSize=20'),
    )
    await screen.findByText('post 0')

    fireEvent.click(screen.getByRole('button', { name: /data/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenLastCalledWith('/admin/corporate-posts/reach?sort=date_asc&page=1&pageSize=20'),
    )
  })

  it('envia o pageSize do cliente na primeira busca', async () => {
    renderTab()
    await screen.findByText('aviso de férias coletivas')
    expect(mockApiFetch).toHaveBeenCalledWith('/admin/corporate-posts/reach?sort=date_desc&page=1&pageSize=20')
  })

  it('mantém a paginação com um jeito de voltar quando uma página além da primeira vem vazia', async () => {
    // Cenário: a página 1 tem posts (total=25), mas a página 2 volta vazia — ex.:
    // outro admin apagou o post entre um refetch e outro. O painel não pode sumir
    // com a paginação, senão o admin fica sem volta para a página 1.
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('page=2')) {
        return Promise.resolve({ items: [], audience: 48, total: 25 })
      }
      return Promise.resolve({
        items: Array.from({ length: 20 }, (_, i) => ({
          postId: `p${i}`,
          excerpt: `post ${i}`,
          readers: 1,
          readPct: 10,
          comments: 0,
          reactions: 0,
          createdAt: '2026-07-30T12:00:00.000Z',
        })),
        audience: 48,
        total: 25,
      })
    })
    renderTab()
    await screen.findByText('post 0')

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))

    expect(await screen.findByText('Nenhum comunicado nesta página.')).toBeInTheDocument()
    // A mensagem de "vazio geral" (que substituiria a tela inteira) não pode aparecer aqui.
    expect(screen.queryByText('Nenhum comunicado publicado ainda.')).not.toBeInTheDocument()
    // E o caminho de volta continua disponível e funcional.
    const backButton = screen.getByRole('button', { name: 'Anterior' })
    expect(backButton).toBeEnabled()

    fireEvent.click(backButton)
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenLastCalledWith('/admin/corporate-posts/reach?sort=date_desc&page=1&pageSize=20'),
    )
    await screen.findByText('post 0')
  })
})

const REACTOR = {
  id: 'u2',
  name: 'Carla',
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
}

/** Reach + as duas listas de detalhe: reações (rota admin) e comentários (rota do feed). */
function setupDetailFetch(overrides: { reactorsTotal?: number } = {}) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/admin/corporate-posts/reach')) {
      return Promise.resolve({
        items: [
          { postId: 'p1', excerpt: 'comunicado medido', readers: 5, readPct: 50, comments: 1, reactions: 2, audience: 10, createdAt: '2026-07-30T12:00:00.000Z' },
          { postId: 'p2', excerpt: 'comunicado sem eco', readers: 1, readPct: 10, comments: 0, reactions: 0, audience: 10, createdAt: '2026-07-29T12:00:00.000Z' },
        ],
        audience: 10,
        total: 2,
      })
    }
    if (path === '/corporate-posts/p1/reactions') {
      return Promise.resolve({
        items: [{ user: REACTOR, sectorName: 'Produto', emoji: '💚', createdAt: '2026-07-30T13:00:00.000Z' }],
        total: overrides.reactorsTotal ?? 1,
      })
    }
    if (path.startsWith('/corporate-posts/p1/comments')) {
      return Promise.resolve({
        items: [
          {
            id: 'c1',
            author: { ...REACTOR, id: 'u3', name: 'Bruno' },
            content: 'ótimo comunicado',
            gif: null,
            image: null,
            createdAt: '2026-07-30T14:00:00.000Z',
            reactions: [],
            mentions: [],
          },
        ],
        hasMore: false,
      })
    }
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

describe('CorporateMuralReachTab: quem reagiu e quem comentou', () => {
  beforeEach(() => {
    setupDetailFetch()
  })

  it('clicar no número de reações abre a lista de quem reagiu', async () => {
    renderTab()
    fireEvent.click(await screen.findByLabelText('Ver quem reagiu: comunicado medido'))

    expect(await screen.findByText('Carla')).toBeInTheDocument()
    expect(screen.getByText(/Produto/)).toBeInTheDocument()
    expect(screen.getByText('💚')).toBeInTheDocument()
  })

  it('clicar no número de comentários abre a lista de quem comentou', async () => {
    renderTab()
    fireEvent.click(await screen.findByLabelText('Ver quem comentou: comunicado medido'))

    expect(await screen.findByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText('ótimo comunicado')).toBeInTheDocument()
  })

  it('dá para trocar de lista dentro do modal, sem fechar e reabrir', async () => {
    renderTab()
    fireEvent.click(await screen.findByLabelText('Ver quem reagiu: comunicado medido'))
    await screen.findByText('Carla')

    fireEvent.click(screen.getByRole('tab', { name: 'Comentários' }))
    expect(await screen.findByText('ótimo comunicado')).toBeInTheDocument()
  })

  it('zero não vira botão — o modal abriria vazio', async () => {
    renderTab()
    await screen.findByText('comunicado sem eco')
    expect(screen.queryByLabelText('Ver quem reagiu: comunicado sem eco')).toBeNull()
    expect(screen.queryByLabelText('Ver quem comentou: comunicado sem eco')).toBeNull()
  })

  it('avisa quando a lista de reações vem truncada pelo servidor', async () => {
    setupDetailFetch({ reactorsTotal: 340 })
    renderTab()
    fireEvent.click(await screen.findByLabelText('Ver quem reagiu: comunicado medido'))

    expect(await screen.findByText(/1 reações mais recentes de 340/)).toBeInTheDocument()
  })

  it('Esc fecha o modal', async () => {
    renderTab()
    fireEvent.click(await screen.findByLabelText('Ver quem reagiu: comunicado medido'))
    await screen.findByText('Carla')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
