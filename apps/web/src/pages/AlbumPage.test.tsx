import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { AlbumPage } from './AlbumPage'
import { apiFetch, ApiError } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockAuth = vi.hoisted(() => ({ role: 'LEGEND' as string, sectorFeatures: [] as string[] }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mockAuth.role, sectorFeatures: mockAuth.sectorFeatures } }),
}))

const mockApiFetch = apiFetch as unknown as Mock

const ALBUM = {
  id: 'a1',
  title: 'Confra 2026',
  description: 'Dois dias de festa',
  eventDate: '2026-05-10T00:00:00.000Z',
  coverUrl: 'https://cdn.exemplo.com/capa.jpg',
  cover: { fit: 'COVER', positionY: 50, scale: 100 },
  photoCount: 1,
  createdAt: '2026-05-11T00:00:00.000Z',
}
const PHOTO = {
  id: 'f1',
  albumId: 'a1',
  url: 'https://cdn.exemplo.com/k1.jpg',
  width: 800,
  height: 600,
  createdAt: '2026-05-11T00:00:00.000Z',
  reactions: [{ emoji: '🎉', count: 1, reactedByMe: false, users: [{ id: 'u2', name: 'Carla' }] }],
  commentCount: 1,
}
const COMMENT = {
  id: 'c1',
  photoId: 'f1',
  author: { id: 'u2', name: 'Carla', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
  body: 'que dia bom',
  createdAt: '2026-05-11T10:00:00.000Z',
  canDelete: false,
}

function setupFetch(overrides: { photos?: unknown[]; comments?: unknown[] } = {}) {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/event-albums/a1' && !method) {
      return Promise.resolve({ album: ALBUM, photos: overrides.photos ?? [PHOTO] })
    }
    if (path === '/event-albums/photos/f1/comments' && !method) {
      return Promise.resolve({ comments: overrides.comments ?? [COMMENT] })
    }
    if (path === '/event-albums/photos/f1/reactions') return Promise.resolve({})
    if (path === '/event-albums/photos/f1/comments' && method === 'POST') return Promise.resolve({})
    if (path === '/event-albums/comments/c1' && method === 'DELETE') return Promise.resolve({})
    if (path === '/admin/event-albums/a1/photos/f1' && method === 'DELETE') return Promise.resolve({})
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/galeria/a1']}>
        <Routes>
          <Route path="/galeria/:albumId" element={<AlbumPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openLightbox() {
  fireEvent.click(await screen.findByRole('button', { name: /ampliar foto 1/i }))
}

describe('AlbumPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.role = 'LEGEND'
    mockAuth.sectorFeatures = []
    setupFetch()
  })

  it('mostra o álbum e as fotos da rota', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Confra 2026' })).toBeInTheDocument()
    expect(screen.getByText('Dois dias de festa')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /ampliar foto 1/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /voltar para a galeria/i })).toHaveAttribute('href', '/galeria')
  })

  it('abre o lightbox e fecha com Esc', async () => {
    renderPage()
    await openLightbox()

    const dialog = await screen.findByRole('dialog')
    // `bg-scrim` não existe no tema: a classe não virava regra e o lightbox
    // abria transparente, com a galeria aparecendo por trás da foto.
    expect(dialog.className).toContain('bg-black/90')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reage à foto pelo seletor, no padrão do produto', async () => {
    renderPage()
    await openLightbox()

    // O padrão do feedback e da resenha: um gatilho que abre o seletor, em vez
    // dos 16 emojis sempre na tela.
    fireEvent.click(await screen.findByRole('button', { name: /adicionar reação/i }))
    fireEvent.click(screen.getByRole('button', { name: '👏' }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/event-albums/photos/f1/reactions',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('desreage com DELETE quando já tinha reagido — o toggle é a escolha do verbo', async () => {
    setupFetch({ photos: [{ ...PHOTO, reactions: [{ emoji: '🎉', count: 1, reactedByMe: true, users: [] }] }] })

    renderPage()
    await openLightbox()
    // A reação que já existe vira chip; clicar nela desfaz.
    fireEvent.click(await screen.findByRole('button', { name: /🎉/ }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/event-albums/photos/f1/reactions',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('comenta na foto e não oferece excluir comentário alheio', async () => {
    renderPage()
    await openLightbox()
    expect(await screen.findByText('que dia bom')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /excluir comentário de carla/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/escreva um comentário/i), { target: { value: 'saudade' } })
    fireEvent.click(screen.getByRole('button', { name: /comentar/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/event-albums/photos/f1/comments',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('mostra erro quando reagir falha', async () => {
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/event-albums/a1' && !method) return Promise.resolve({ album: ALBUM, photos: [PHOTO] })
      if (path === '/event-albums/photos/f1/comments' && !method) return Promise.resolve({ comments: [] })
      return Promise.reject(new ApiError(500, 'Erro ao reagir à foto.'))
    })

    renderPage()
    await openLightbox()
    fireEvent.click(await screen.findByRole('button', { name: /adicionar reação/i }))
    fireEvent.click(screen.getByRole('button', { name: '👏' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/erro ao reagir à foto/i)
  })

  it('baixar é de todo mundo, e sai por link assinado', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign }, writable: true })
    setupFetch()
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/event-albums/a1' && !method) return Promise.resolve({ album: ALBUM, photos: [PHOTO] })
      if (path === '/event-albums/photos/f1/comments' && !method) return Promise.resolve({ comments: [] })
      if (path === '/event-albums/photos/f1/download') {
        return Promise.resolve({ url: 'https://s3.exemplo.com/assinado?disposition=attachment' })
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })

    renderPage()
    await openLightbox()
    fireEvent.click(await screen.findByRole('button', { name: /baixar/i }))

    // O `<a download>` seria ignorado: a foto vem de outro domínio. Quem carrega
    // o `Content-Disposition: attachment` é a assinatura da API.
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://s3.exemplo.com/assinado?disposition=attachment'),
    )
  })

  it('as miniaturas se encaixam pela proporção real, sem recorte quadrado', async () => {
    renderPage()
    await screen.findByRole('button', { name: /ampliar foto 1/i })

    const thumb = document.querySelector('img[src="https://cdn.exemplo.com/k1.jpg"]') as HTMLImageElement
    expect(thumb).toHaveStyle({ aspectRatio: '800 / 600' })
    expect(thumb.className).not.toContain('aspect-square')
  })

  it('o comentário mostra autor e quando foi escrito', async () => {
    renderPage()
    await openLightbox()

    expect(await screen.findByText('que dia bom')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Carla' })).toHaveAttribute('href', '/perfil/u2')
  })

  it('colaborador não vê enviar fotos, área de arrastar nem excluir foto', async () => {
    renderPage()
    await screen.findByRole('button', { name: /ampliar foto 1/i })

    expect(screen.queryByLabelText(/enviar fotos/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/arraste fotos para cá/i)).not.toBeInTheDocument()

    await openLightbox()
    expect(screen.queryByRole('button', { name: /excluir foto/i })).not.toBeInTheDocument()
  })

  it('quem administra G&G envia fotos, arrasta e exclui foto', async () => {
    mockAuth.role = 'ADMIN'

    renderPage()
    await screen.findByRole('button', { name: /ampliar foto 1/i })

    expect(screen.getByText(/arraste fotos para cá ou use o botão acima/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/enviar fotos/i)).toBeInTheDocument()

    await openLightbox()
    fireEvent.click(screen.getByRole('button', { name: /excluir foto/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/event-albums/a1/photos/f1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('álbum vazio avisa em vez de mostrar grade em branco', async () => {
    setupFetch({ photos: [] })
    renderPage()

    expect(await screen.findByText(/nenhuma foto neste álbum ainda/i)).toBeInTheDocument()
  })
})
