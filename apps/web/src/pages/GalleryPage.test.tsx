import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { GalleryPage } from './GalleryPage'
import { apiFetch, ApiError } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

/** Papel do visitante: as ações de álbum são de quem administra G&G. */
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

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/event-albums' && !method) return Promise.resolve({ albums: [ALBUM] })
    if (path === '/admin/event-albums/a1') return Promise.resolve({})
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderPage(entry = '/galeria') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <GalleryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('GalleryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.role = 'LEGEND'
    mockAuth.sectorFeatures = []
    setupFetch()
  })

  it('mostra a grade de álbuns com capa e contagem', async () => {
    renderPage()
    expect(await screen.findByText('Confra 2026')).toBeInTheDocument()
    expect(screen.getByText(/1 foto/)).toBeInTheDocument()
  })

  it('o álbum abre em rota própria, para o link ser compartilhável', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /abrir álbum confra 2026/i })).toHaveAttribute(
      'href',
      '/galeria/a1',
    )
  })

  it('a capa sai com o enquadramento gravado pelo admin', async () => {
    mockApiFetch.mockImplementation(() =>
      Promise.resolve({ albums: [{ ...ALBUM, cover: { fit: 'CONTAIN', positionY: 20, scale: 150 } }] }),
    )

    renderPage()
    await screen.findByText('Confra 2026')

    const capa = document.querySelector('img[src="https://cdn.exemplo.com/capa.jpg"]') as HTMLImageElement
    expect(capa).toHaveStyle({ objectFit: 'contain', objectPosition: 'center 20%', transform: 'scale(1.5)' })
  })

  it('colaborador não vê editar nem excluir', async () => {
    renderPage()
    await screen.findByText('Confra 2026')

    expect(screen.queryByRole('button', { name: /editar confra 2026/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /excluir confra 2026/i })).not.toBeInTheDocument()
  })

  it('quem administra G&G vê editar e excluir sobre o álbum', async () => {
    mockAuth.role = 'SUBADMIN'
    mockAuth.sectorFeatures = ['gente-gestao']

    renderPage()
    await screen.findByText('Confra 2026')

    expect(screen.getByRole('button', { name: /editar confra 2026/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /excluir confra 2026/i })).toBeInTheDocument()
  })

  it('subadmin de outro setor não administra a galeria', async () => {
    mockAuth.role = 'SUBADMIN'
    mockAuth.sectorFeatures = ['desenvolvimento-produto']

    renderPage()
    await screen.findByText('Confra 2026')

    expect(screen.queryByRole('button', { name: /editar confra 2026/i })).not.toBeInTheDocument()
  })

  it('excluir pede confirmação antes de chamar a API', async () => {
    mockAuth.role = 'ADMIN'

    renderPage()
    await screen.findByText('Confra 2026')
    fireEvent.click(screen.getByRole('button', { name: /excluir confra 2026/i }))

    expect(await screen.findByRole('dialog', { name: /excluir confra 2026/i })).toBeInTheDocument()
    expect(mockApiFetch).not.toHaveBeenCalledWith('/admin/event-albums/a1', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: /excluir mesmo assim/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/event-albums/a1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('editar abre o formulário com os dados do álbum', async () => {
    mockAuth.role = 'ADMIN'

    renderPage()
    await screen.findByText('Confra 2026')
    fireEvent.click(screen.getByRole('button', { name: /editar confra 2026/i }))

    const dialog = await screen.findByRole('dialog', { name: /editar confra 2026/i })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText('Título')).toHaveValue('Confra 2026')
    expect(screen.getByLabelText('Data do evento')).toHaveValue('2026-05-10')
    expect(screen.getByLabelText('Imagem de capa')).toBeInTheDocument()
  })

  it('salvar a edição manda o PATCH com os campos e o enquadramento', async () => {
    mockAuth.role = 'ADMIN'

    renderPage()
    await screen.findByText('Confra 2026')
    fireEvent.click(screen.getByRole('button', { name: /editar confra 2026/i }))
    await screen.findByRole('dialog', { name: /editar confra 2026/i })

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Confra 2026 — Editada' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar alterações/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/event-albums/a1',
        expect.objectContaining({
          method: 'PATCH',
          // Sem imagem nova, `coverStorageKey` NÃO vai: mandá-la como null
          // apagaria a capa de quem só quis corrigir o título.
          body: JSON.stringify({
            title: 'Confra 2026 — Editada',
            description: 'Dois dias de festa',
            eventDate: '2026-05-10T00:00:00.000Z',
            cover: { fit: 'COVER', positionY: 50, scale: 100 },
          }),
        }),
      ),
    )
  })

  it('`?editar=` abre o formulário direto — é como o console manda para cá', async () => {
    mockAuth.role = 'ADMIN'

    renderPage('/galeria?editar=a1')

    expect(await screen.findByRole('dialog', { name: /editar confra 2026/i })).toBeInTheDocument()
  })

  it('mostra erro quando a busca de álbuns falha', async () => {
    mockApiFetch.mockImplementation(() => Promise.reject(new ApiError(500, 'Erro no servidor.')))

    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/erro ao carregar os álbuns/i)
  })
})
