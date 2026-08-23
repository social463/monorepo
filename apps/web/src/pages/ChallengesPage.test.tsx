import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import type { MyChallengeDTO } from '@legends/shared'
import { ChallengesPage } from './ChallengesPage'
import { apiFetch } from '../lib/api'
import { uploadChallengeEvidence } from '../lib/upload'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/upload')>()
  return { ...actual, uploadChallengeEvidence: vi.fn() }
})
const mockUploadEvidence = uploadChallengeEvidence as unknown as Mock

const challenge: MyChallengeDTO = {
  id: 'c1',
  title: 'Ler um livro técnico',
  description: 'Leia e conte o que aprendeu.',
  category: 'Cultura',
  detailsMarkdown: null,
  imageUrl: null,
  position: 0,
  requiresReview: true,
  isPrivate: false,
  isFeatured: false,
  rewardCoins: 150,
  isActive: true,
  startsAt: null,
  endsAt: null,
  sectorId: null,
  sectorName: null,
  submissionCount: 0,
  mySubmission: null,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChallengesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
  mockUploadEvidence.mockReset()
})

describe('ChallengesPage', () => {
  it('lista os desafios abertos com a recompensa', async () => {
    vi.mocked(apiFetch).mockResolvedValue([challenge])
    renderPage()

    expect(await screen.findByText('Ler um livro técnico')).toBeInTheDocument()
    expect(screen.getByText(/150/)).toBeInTheDocument()
  })

  it('envia a participação com a nota', async () => {
    vi.mocked(apiFetch).mockResolvedValue([challenge])
    renderPage()
    await screen.findByText('Ler um livro técnico')

    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))
    await userEvent.type(screen.getByLabelText(/conte como foi/i), 'Li o livro inteiro.')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar participação' }))

    await waitFor(() => {
      // apiFetch recebe RequestInit: o corpo já vai serializado.
      expect(apiFetch).toHaveBeenCalledWith('/challenges/c1/submissions', {
        method: 'POST',
        body: JSON.stringify({ note: 'Li o livro inteiro.' }),
      })
    })
  })

  it('mostra o motivo quando a participação foi rejeitada', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      {
        ...challenge,
        mySubmission: {
          id: 's1',
          status: 'REJECTED',
          note: null,
          evidenceUrl: null,
          submittedAt: '2026-08-01T12:00:00.000Z',
          reviewedAt: '2026-08-01T13:00:00.000Z',
          rejectionReason: 'A evidência não confere.',
          user: { id: 'u1', name: 'Ana', email: 'ana@x.com', photoUrl: null },
          challenge: { id: 'c1', title: 'Ler um livro técnico', rewardCoins: 150 },
          reviewedBy: { id: 'a1', name: 'Admin' },
        },
      },
    ])
    renderPage()

    expect(await screen.findByText('A evidência não confere.')).toBeInTheDocument()
    // Rejeitada libera nova tentativa.
    expect(screen.getByRole('button', { name: 'Participar' })).toBeInTheDocument()
  })

  it('não oferece participar em desafio inativo, mesmo sem submissão prévia', async () => {
    vi.mocked(apiFetch).mockResolvedValue([{ ...challenge, isActive: false }])
    renderPage()

    expect(await screen.findByText('Ler um livro técnico')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Participar' })).not.toBeInTheDocument()
    expect(screen.getByText(/encerrado/i)).toBeInTheDocument()
  })

  it('não oferece participar em desafio ainda não iniciado (startsAt no futuro)', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      { ...challenge, startsAt: '2099-01-01T00:00:00.000Z' },
    ])
    renderPage()

    expect(await screen.findByText('Ler um livro técnico')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Participar' })).not.toBeInTheDocument()
  })

  it('não oferece participar em desafio com janela encerrada (endsAt no passado)', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      { ...challenge, endsAt: '2020-01-01T00:00:00.000Z' },
    ])
    renderPage()

    expect(await screen.findByText('Ler um livro técnico')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Participar' })).not.toBeInTheDocument()
  })

  it('desafio inativo com submissão aprovada permanece visível e só leitura', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      {
        ...challenge,
        isActive: false,
        mySubmission: {
          id: 's1',
          status: 'APPROVED',
          note: null,
          evidenceUrl: null,
          submittedAt: '2026-08-01T12:00:00.000Z',
          reviewedAt: '2026-08-01T13:00:00.000Z',
          rejectionReason: null,
          user: { id: 'u1', name: 'Ana', email: 'ana@x.com', photoUrl: null },
          challenge: { id: 'c1', title: 'Ler um livro técnico', rewardCoins: 150 },
          reviewedBy: { id: 'a1', name: 'Admin' },
        },
      },
    ])
    renderPage()

    expect(await screen.findByText('Ler um livro técnico')).toBeInTheDocument()
    expect(screen.getByText('Aprovada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Participar' })).not.toBeInTheDocument()
  })

  it('não oferece participar quando já existe pendente', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      {
        ...challenge,
        mySubmission: {
          id: 's1',
          status: 'PENDING',
          note: 'Feito.',
          evidenceUrl: null,
          submittedAt: '2026-08-01T12:00:00.000Z',
          reviewedAt: null,
          rejectionReason: null,
          user: { id: 'u1', name: 'Ana', email: 'ana@x.com', photoUrl: null },
          challenge: { id: 'c1', title: 'Ler um livro técnico', rewardCoins: 150 },
          reviewedBy: null,
        },
      },
    ])
    renderPage()

    expect(await screen.findByText(/em análise/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Participar' })).not.toBeInTheDocument()
  })

  it('mostra a categoria do desafio', async () => {
    vi.mocked(apiFetch).mockResolvedValue([challenge])
    renderPage()

    expect(await screen.findByText('Cultura')).toBeInTheDocument()
  })

  it('mostra a capa quando há imageUrl e omite quando não há', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      { ...challenge, id: 'c1', imageUrl: null },
      { ...challenge, id: 'c2', title: 'Com capa', imageUrl: 'https://cdn.example.com/capa.png' },
    ])
    const { container } = renderPage()

    await screen.findByText('Ler um livro técnico')
    // `alt=""` é decorativo por design (a imagem some do papel "img" da
    // árvore de acessibilidade) — por isso a busca é por tag, não por role.
    const images = container.querySelectorAll('img')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('src', 'https://cdn.example.com/capa.png')
    expect(images[0]).toHaveAttribute('alt', '')
  })

  it('marca visualmente o desafio em destaque', async () => {
    vi.mocked(apiFetch).mockResolvedValue([{ ...challenge, isFeatured: true }])
    renderPage()

    expect(await screen.findByText('Em destaque')).toBeInTheDocument()
  })

  it('renderiza o detalhe em Markdown como elementos React, nunca como script', async () => {
    const user = userEvent.setup()
    vi.mocked(apiFetch).mockResolvedValue([
      { ...challenge, detailsMarkdown: '## Regras\n\n<script>window.__x = 1</script>' },
    ])
    const { container } = renderPage()
    await screen.findByText('Ler um livro técnico')

    await user.click(screen.getByRole('button', { name: 'Ver detalhe' }))

    expect(await screen.findByText('Regras')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { __x?: number }).__x).toBeUndefined()
  })

  it('some o campo de evidência quando o upload não está configurado', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/challenges') return Promise.resolve([challenge])
      if (path === '/uploads/config') return Promise.resolve({ enabled: false, maxBytes: 0, allowedContentTypes: [] })
      return Promise.resolve(null)
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Participar' }))

    expect(screen.queryByLabelText(/evidência/i)).not.toBeInTheDocument()
  })

  it('anexa evidência e envia a chave devolvida pelo upload junto da participação', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/challenges') return Promise.resolve([challenge])
      if (path === '/uploads/config') {
        return Promise.resolve({ enabled: true, maxBytes: 20 * 1024 * 1024, allowedContentTypes: ['application/pdf'] })
      }
      if (path === '/challenges/c1/submissions') return Promise.resolve({})
      return Promise.resolve(null)
    })
    mockUploadEvidence.mockResolvedValue({ key: 'challenges/u1/prova.pdf', fileName: 'prova.pdf', fileSize: 2048 })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Participar' }))
    const file = new File(['conteudo'], 'prova.pdf', { type: 'application/pdf' })
    await userEvent.upload(await screen.findByLabelText(/evidência/i), file)
    expect(await screen.findByText('Arquivo: prova.pdf')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Enviar participação' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/challenges/c1/submissions', {
        method: 'POST',
        body: JSON.stringify({ evidenceKey: 'challenges/u1/prova.pdf' }),
      })
    })
  })

  it('mostra erro quando o upload da evidência falha, sem travar o formulário', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/challenges') return Promise.resolve([challenge])
      if (path === '/uploads/config') {
        return Promise.resolve({ enabled: true, maxBytes: 20 * 1024 * 1024, allowedContentTypes: ['application/pdf'] })
      }
      return Promise.resolve(null)
    })
    mockUploadEvidence.mockRejectedValue(new Error('Falha ao enviar o arquivo.'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Participar' }))
    const file = new File(['conteudo'], 'prova.pdf', { type: 'application/pdf' })
    await userEvent.upload(await screen.findByLabelText(/evidência/i), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao enviar o arquivo.')
    expect(screen.getByRole('button', { name: 'Enviar participação' })).not.toBeDisabled()
  })
})
