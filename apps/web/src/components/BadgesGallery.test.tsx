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
          { id: 'b1', slug: 'conector', name: 'Conector do Time', description: '5 em colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, requirement: 'Receba 5 votos em Colaboração', progress: { current: 5, target: 5 } },
          { id: 'b2', slug: 'reconhecido', name: 'Reconhecido', description: '10 no total', kind: 'IMPACT', iconKey: 'star', threshold: 10, categorySlug: null, badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, requirement: 'Receba 10 votos no total', progress: { current: 4, target: 10 } },
        ],
      })
    }
    if (path === '/users/u1/badges') {
      return Promise.resolve({
        badges: [
          {
            id: 'ub1',
            awardedAt: '2026-06-01T00:00:00.000Z',
            badge: { id: 'b1', slug: 'conector', name: 'Conector do Time', description: '5 em colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null },
          },
        ],
      })
    }
    if (path === '/me/badge-claims') return Promise.resolve({ claims: claims })
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

/** Reivindicações que o mock devolve — cada teste ajusta antes de renderizar. */
let claims: unknown[] = []

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
    claims = []
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
            { id: 'b1', slug: 'conector', name: 'Conector do Time', description: 'x', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao', badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, requirement: 'r', progress: null },
            { id: 'b2', slug: 'reconhecido', name: 'Reconhecido', description: 'y', kind: 'IMPACT', iconKey: 'star', threshold: 10, categorySlug: null, badgeCategoryId: null, badgeCategoryName: null, rewardPoints: null, rewardCoins: null, requirement: 'r', progress: null },
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

/**
 * Documento 4, seção 11.2: nem todo selo é contável pelo sistema, e o único
 * caminho para um selo de comportamento era pedir no Teams.
 */
describe('BadgesGallery — reivindicação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    claims = []
    setupFetch()
  })

  it('oferece "Reivindicar" só no selo que a pessoa ainda não tem', async () => {
    renderGallery()

    await screen.findByText('Conector do Time')
    // "Conector do Time" está conquistado; "Reconhecido" não.
    expect(screen.getAllByRole('button', { name: 'Reivindicar' })).toHaveLength(1)
  })

  it('solicitação em análise ocupa o lugar do botão', async () => {
    claims = [
      {
        id: 'c1',
        badge: { id: 'b2', slug: 'reconhecido', name: 'Reconhecido' },
        user: { id: 'u1', name: 'Ana' },
        story: 'Fiz.',
        attachmentUrl: null,
        attachmentKind: null,
        link: null,
        status: 'PENDING',
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]
    renderGallery()

    expect(await screen.findByText(/Solicitação em análise/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reivindicar' })).toBeNull()
  })

  it('recusada volta a oferecer o botão, com o motivo à vista', async () => {
    claims = [
      {
        id: 'c1',
        badge: { id: 'b2', slug: 'reconhecido', name: 'Reconhecido' },
        user: { id: 'u1', name: 'Ana' },
        story: 'Fiz.',
        attachmentUrl: null,
        attachmentKind: null,
        link: null,
        status: 'REJECTED',
        rejectionReason: 'Falta comprovação.',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]
    renderGallery()

    expect(await screen.findByText(/Falta comprovação\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reivindicar de novo' })).toBeInTheDocument()
  })

  it('abre o modal com os textos oficiais', async () => {
    renderGallery()

    await userEvent.click(await screen.findByRole('button', { name: 'Reivindicar' }))

    const modal = screen.getByRole('dialog')
    expect(modal).toHaveAccessibleName('Reivindicar "Reconhecido"')
    expect(
      screen.getByText(
        'Conte como você conquistou este emblema. Sua solicitação será analisada pelo time de Gente e Gestão.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Explique sua conquista: projeto, comportamento, resultado…'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Anexo — print, foto ou certificado (imagem ou PDF)')).toBeInTheDocument()
    expect(screen.getByLabelText('Ou cole um link (opcional)')).toBeInTheDocument()

    // Relato é obrigatório: sem ele o envio fica travado.
    const enviar = screen.getByRole('button', { name: 'Enviar solicitação' })
    expect(enviar).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Relato da conquista'), 'Liderei a virada.')
    expect(enviar).toBeEnabled()
  })
})
