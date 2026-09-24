import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi, type Mock } from 'vitest'
import { EVENT_PHOTO_MAX_BATCH } from '@legends/shared'
import { EventAlbumsSection } from './EventAlbumsSection'
import { apiFetch, ApiError } from '../../lib/api'
import { uploadEventPhoto, UploadError } from '../../lib/upload'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../../lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/upload')>()
  return { ...actual, uploadEventPhoto: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock
const mockUpload = uploadEventPhoto as unknown as Mock

const ALBUM = {
  id: 'a1',
  title: 'Confra 2026',
  description: 'Dois dias',
  eventDate: '2026-05-10T00:00:00.000Z',
  coverUrl: null,
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
  reactions: [],
  commentCount: 0,
}

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/event-albums' && !method) return Promise.resolve({ albums: [ALBUM] })
    if (path === '/event-albums/a1' && !method) return Promise.resolve({ album: ALBUM, photos: [PHOTO] })
    if (path === '/admin/event-albums' && method === 'POST') return Promise.resolve({ album: ALBUM })
    if (path === '/admin/event-albums/a1/photos' && method === 'POST') {
      return Promise.resolve({ photos: [{ id: 'f2', storageKey: 'k2.jpg' }] })
    }
    if (path === '/admin/event-albums/a1/cover' && method === 'PATCH') return Promise.resolve({ album: ALBUM })
    if (path === '/admin/event-albums/a1' && method === 'PATCH') return Promise.resolve({ album: ALBUM })
    if (path === '/admin/event-albums/a1' && method === 'DELETE') return Promise.resolve({})
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
  mockUpload.mockResolvedValue({ storageKey: 'k2.jpg', width: 400, height: 300 })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EventAlbumsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EventAlbumsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('lista os álbuns existentes', async () => {
    renderSection()
    expect(await screen.findByText('Confra 2026')).toBeInTheDocument()
  })

  it('cria um álbum novo', async () => {
    renderSection()
    await screen.findByText('Confra 2026')
    fireEvent.change(screen.getByLabelText(/título/i), { target: { value: 'Hackathon' } })
    fireEvent.click(screen.getByRole('button', { name: /criar álbum/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/event-albums', expect.objectContaining({ method: 'POST' })),
    )
  })

  it('sobe um lote de fotos e confirma as chaves na API', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    const input = await screen.findByLabelText(/adicionar fotos/i)
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/event-albums/a1/photos',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('fatia uma seleção maior que o lote máximo em várias confirmações', async () => {
    // EVENT_PHOTO_MAX_BATCH + 5 arquivos: prova que o cliente não sobe tudo e
    // manda um POST só (o Zod da rota rejeitaria com 400 e os objetos já
    // estariam órfãos no S3) — em vez disso fatia em levas de no máximo
    // EVENT_PHOTO_MAX_BATCH e confirma leva a leva.
    const total = EVENT_PHOTO_MAX_BATCH + 5
    const files = Array.from({ length: total }, (_, i) => new File([`${i}`], `foto${i}.jpg`, { type: 'image/jpeg' }))
    mockUpload.mockImplementation((file: File) =>
      Promise.resolve({ storageKey: `event-photos/company-emr/${file.name}`, width: 100, height: 100 }),
    )

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    const input = await screen.findByLabelText(/adicionar fotos/i)
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(total))

    const confirmCalls = mockApiFetch.mock.calls.filter(
      ([path, options]) => path === '/admin/event-albums/a1/photos' && (options as RequestInit | undefined)?.method === 'POST',
    )
    expect(confirmCalls.length).toBeGreaterThan(1)
    for (const [, options] of confirmCalls) {
      const body = JSON.parse((options as RequestInit).body as string) as { photos: unknown[] }
      expect(body.photos.length).toBeLessThanOrEqual(EVENT_PHOTO_MAX_BATCH)
    }
  })

  it('editar leva para a galeria, onde a capa aparece no tamanho real', async () => {
    renderSection()

    expect(await screen.findByRole('link', { name: /editar confra 2026/i })).toHaveAttribute(
      'href',
      '/galeria?editar=a1',
    )
  })

  it('define uma foto como capa', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    fireEvent.click(await screen.findByRole('button', { name: /definir como capa/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/event-albums/a1/cover',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
  })

  it('mostra o erro de um arquivo recusado sem derrubar o lote', async () => {
    // Três arquivos, o do meio falha: prova que o laço não para no primeiro
    // erro (uma implementação que abortasse cedo passaria com um arquivo só,
    // mas não chamaria uploadEventPhoto a 3ª vez nem confirmaria as duas
    // chaves que deram certo).
    mockUpload
      .mockResolvedValueOnce({ storageKey: 'k1.jpg', width: 100, height: 100 })
      .mockRejectedValueOnce(new Error('Formato não suportado. Use JPEG, PNG, WebP ou GIF.'))
      .mockResolvedValueOnce({ storageKey: 'k3.jpg', width: 100, height: 100 })

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    const input = await screen.findByLabelText(/adicionar fotos/i)
    const files = [
      new File(['1'], 'foto1.jpg', { type: 'image/jpeg' }),
      new File(['2'], 'foto2.pdf', { type: 'application/pdf' }),
      new File(['3'], 'foto3.jpg', { type: 'image/jpeg' }),
    ]
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(3))
    expect(await screen.findByText(/formato não suportado/i)).toBeInTheDocument()

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/admin/event-albums/a1/photos',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            photos: [
              { storageKey: 'k1.jpg', width: 100, height: 100 },
              { storageKey: 'k3.jpg', width: 100, height: 100 },
            ],
          }),
        }),
      ),
    )
  })

  it('401 no meio do lote ganha uma segunda tentativa e a foto entra', async () => {
    // O access token dura 15 min e um álbum de confra passa disso: o 401 do
    // meio do lote é a sessão se renovando, não a foto sendo recusada.
    mockUpload
      .mockRejectedValueOnce(new ApiError(401, 'Não autorizado'))
      .mockResolvedValueOnce({ storageKey: 'k1.jpg', width: 100, height: 100 })

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    const input = await screen.findByLabelText(/adicionar fotos/i)
    fireEvent.change(input, { target: { files: [new File(['1'], 'foto1.jpg', { type: 'image/jpeg' })] } })

    // A segunda tentativa espera `PHOTO_RETRY_DELAY_MS`, acima do 1s padrão do
    // findBy — daí o timeout explícito.
    await waitFor(() => expect(screen.getByText(/foto1\.jpg —/)).toHaveTextContent('enviada'), {
      timeout: 4000,
    })
    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/não autorizado/i)).not.toBeInTheDocument()
  }, 10_000)

  it('formato recusado não ganha segunda tentativa nem botão de reenviar', async () => {
    // Insistir no mesmo arquivo não muda nada e só atrasaria a fila.
    mockUpload.mockRejectedValue(
      new UploadError('Formato não suportado. Use JPEG, PNG, WebP ou GIF.'),
    )

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    const input = await screen.findByLabelText(/adicionar fotos/i)
    fireEvent.change(input, { target: { files: [new File(['1'], 'foto1.pdf', { type: 'application/pdf' })] } })

    expect(await screen.findByText(/formato não suportado/i)).toBeInTheDocument()
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /reenviar/i })).not.toBeInTheDocument()
  })

  it('reenvia só as fotos que falharam, sem repetir as que já entraram', async () => {
    // A chave no S3 nasce de um UUID novo a cada envio: reselecionar a pasta
    // inteira duplicaria no álbum tudo que já tinha entrado.
    mockUpload.mockImplementation((file: File) =>
      file.name === 'foto2.jpg'
        ? Promise.reject(new ApiError(503, 'Serviço indisponível.'))
        : Promise.resolve({ storageKey: `${file.name}.jpg`, width: 100, height: 100 }),
    )

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /gerenciar fotos de confra 2026/i }))
    const input = await screen.findByLabelText(/adicionar fotos/i)
    fireEvent.change(input, {
      target: {
        files: [
          new File(['1'], 'foto1.jpg', { type: 'image/jpeg' }),
          new File(['2'], 'foto2.jpg', { type: 'image/jpeg' }),
        ],
      },
    })

    const reenviar = await screen.findByRole('button', { name: /reenviar a foto que falhou/i })

    mockUpload.mockClear()
    mockUpload.mockResolvedValue({ storageKey: 'foto2.jpg', width: 100, height: 100 })
    fireEvent.click(reenviar)

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1))
    expect((mockUpload.mock.calls[0][0] as File).name).toBe('foto2.jpg')
    await waitFor(() => expect(screen.getByText(/foto2\.jpg —/)).toHaveTextContent('enviada'), {
      timeout: 4000,
    })
  }, 10_000)

  it('mostra erro quando a exclusão do álbum falha', async () => {
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/event-albums' && !method) return Promise.resolve({ albums: [ALBUM] })
      if (path === '/admin/event-albums/a1' && method === 'DELETE') {
        return Promise.reject(new ApiError(400, 'Álbum possui fotos vinculadas.'))
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /excluir álbum/i }))

    expect(await screen.findByText(/álbum possui fotos vinculadas/i)).toBeInTheDocument()
  })
})
