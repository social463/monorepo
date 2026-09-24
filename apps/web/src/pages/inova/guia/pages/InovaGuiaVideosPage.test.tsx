import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest'
import { InovaGuiaVideosPage } from './InovaGuiaVideosPage'
import { videos } from '../content/videos'
import { apiFetch } from '../../../../lib/api'

vi.mock('../../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/api')>('../../../../lib/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockAuth = vi.hoisted(() => ({ role: 'LEGEND' as string }))
vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role, adminAccess: false } }),
}))

const mockApiFetch = apiFetch as unknown as Mock

function renderPage(initialEntry = '/comunidade-inova/guia/videos') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <InovaGuiaVideosPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('InovaGuiaVideosPage', () => {
  beforeEach(() => {
    mockAuth.role = 'LEGEND'
    mockApiFetch.mockReset()
    mockApiFetch.mockResolvedValue({ videos: [] })
  })

  it('lista os vídeos do catálogo, sem sobrescrita nenhuma', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(videos[0]!.title)).toBeInTheDocument())
    expect(screen.getAllByText(/em breve/i).length).toBe(videos.length)
  })

  it('não mostra ações de admin para quem não administra', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(videos[0]!.title)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /novo card de vídeo/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enviar vídeo/i })).not.toBeInTheDocument()
  })

  it('mostra a sobrescrita do banco por cima do catálogo estático', async () => {
    mockApiFetch.mockResolvedValue({
      videos: [
        {
          id: 'row-1',
          videoId: videos[0]!.id,
          title: 'Título sobrescrito',
          description: null,
          category: null,
          duration: null,
          behavior: null,
          videoUrl: 'https://youtube.com/watch?v=abc',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Título sobrescrito')).toBeInTheDocument())
    expect(screen.getByText('Disponível')).toBeInTheDocument()
    // O resto (descrição etc.) continua vindo do catálogo — só o título foi sobrescrito.
    expect(screen.getByText(videos[0]!.description)).toBeInTheDocument()
  })

  it('mostra um card custom que só existe no banco (fora do catálogo)', async () => {
    mockApiFetch.mockResolvedValue({
      videos: [
        {
          id: 'row-2',
          videoId: 'custom-abc',
          title: 'Vídeo da comunidade',
          description: 'Gravado por um colega',
          category: 'Comunidade',
          duration: '3 min',
          behavior: null,
          videoUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Vídeo da comunidade')).toBeInTheDocument())
    expect(screen.getByText('Gravado por um colega')).toBeInTheDocument()
  })

  it('admin cria um card novo', async () => {
    mockAuth.role = 'ADMIN'
    mockApiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'POST' && path === '/inova/guia/videos') {
        return Promise.resolve({
          video: {
            id: 'row-3',
            videoId: 'custom-novo',
            title: 'Novo vídeo',
            description: null,
            category: null,
            duration: null,
            behavior: null,
            videoUrl: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        })
      }
      return Promise.resolve({ videos: [] })
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(videos[0]!.title)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /novo card de vídeo/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/inova/guia/videos', { method: 'POST' }),
    )
  })

  it('admin define um link para um vídeo do catálogo', async () => {
    mockAuth.role = 'ADMIN'
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('https://youtube.com/watch?v=xyz')
    renderPage()
    await waitFor(() => expect(screen.getByText(videos[0]!.title)).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /usar link/i })[0]!)

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/inova/guia/videos/${videos[0]!.id}`,
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ videoUrl: 'https://youtube.com/watch?v=xyz' }) }),
      ),
    )
    promptSpy.mockRestore()
  })

  it('admin remove só o vídeo de um card com vídeo, sem excluir o card', async () => {
    mockAuth.role = 'ADMIN'
    mockApiFetch.mockResolvedValue({
      videos: [
        {
          id: 'row-1',
          videoId: videos[0]!.id,
          title: null,
          description: null,
          category: null,
          duration: null,
          behavior: null,
          videoUrl: 'https://youtube.com/watch?v=abc',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Disponível')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /remover vídeo/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/inova/guia/videos/${videos[0]!.id}`,
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ videoUrl: null, storagePath: null }) }),
      ),
    )
    // Nunca chama DELETE para um card do catálogo — "remover vídeo" preserva o card.
    expect(mockApiFetch).not.toHaveBeenCalledWith(`/inova/guia/videos/${videos[0]!.id}`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('admin exclui um card custom inteiro', async () => {
    mockAuth.role = 'ADMIN'
    mockApiFetch.mockResolvedValue({
      videos: [
        {
          id: 'row-2',
          videoId: 'custom-abc',
          title: 'Card custom',
          description: null,
          category: null,
          duration: null,
          behavior: null,
          videoUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Card custom')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /excluir card/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/inova/guia/videos/custom-abc', expect.objectContaining({ method: 'DELETE' })),
    )
  })

  it('admin edita os textos de um card pelo diálogo', async () => {
    mockAuth.role = 'ADMIN'
    renderPage()
    await waitFor(() => expect(screen.getByText(videos[0]!.title)).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /editar textos/i })[0]!)
    const titleInput = screen.getByDisplayValue(videos[0]!.title)
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, 'Título editado')
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/inova/guia/videos/${videos[0]!.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            title: 'Título editado',
            description: videos[0]!.description,
            category: videos[0]!.category,
            duration: videos[0]!.duration,
            behavior: videos[0]!.behavior,
          }),
        }),
      ),
    )
  })

  it('destaca o vídeo do ?v= (busca global)', async () => {
    const alvo = videos[1]!
    renderPage(`/comunidade-inova/guia/videos?v=${alvo.id}`)
    await waitFor(() => expect(screen.getByText(alvo.title)).toBeInTheDocument())
    expect(screen.getByText(alvo.title).closest('article')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText(videos[0]!.title).closest('article')).not.toHaveAttribute('aria-current')
  })
})
