import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Mock } from 'vitest'
import { TopEngagementCard } from './TopEngagementCard'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function entry(
  name: string,
  position: number,
  points: number,
  online: boolean,
  sectorName = 'Desenvolvimento de Produto',
) {
  return {
    position,
    points,
    online,
    level: { name: 'Bronze', color: '#8C5A2B', next: 'Prata', min: 0, nextMin: 500, remaining: 500 - points, progress: 0 },
    user: {
      id: `u-${name}`,
      name,
      email: null,
      role: 'LEGEND',
      area: null,
      position: null,
      squad: null,
      photoUrl: null,
      avatarStyle: null,
      avatarSeed: null,
      avatarOptions: null,
      active: true,
      joinedAt: '2026-01-01T00:00:00.000Z',
      leftAt: null,
      sectorId: 's1',
      sectorName,
      companyId: 'company-emr',
      companyName: null,
      enabledFeatures: [],
      sectorFeatures: [],
      adminAccess: false,
    },
  }
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TopEngagementCard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TopEngagementCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mostra posição, setor, status de presença e pontuação de cada pessoa', async () => {
    mockApiFetch.mockResolvedValue({
      entries: [entry('Ana', 1, 300, true, 'Gente e Gestão'), entry('Bruno', 2, 120, false, 'Comercial')],
      total: 2,
      me: null,
    })
    wrap()

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Gente e Gestão')).toBeInTheDocument()
    expect(screen.getByText('Comercial')).toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()

    // Um verde e um cinza: a regra do bloco pede os DOIS estados desenhados.
    expect(screen.getByLabelText('On-line na plataforma')).toBeInTheDocument()
    expect(screen.getByLabelText('Inativo')).toBeInTheDocument()

    expect(screen.getByLabelText('1º lugar')).toBeInTheDocument()
    expect(screen.getByLabelText('2º lugar')).toBeInTheDocument()
  })

  it('pede só os 5 primeiros', async () => {
    mockApiFetch.mockResolvedValue({ entries: [], total: 0, me: null })
    wrap()
    await screen.findByText(/Ninguém pontuou ainda/)
    expect(mockApiFetch).toHaveBeenCalledWith('/ranking?limit=5')
  })

  it('mostra a própria posição só para quem está fora da lista exibida', async () => {
    mockApiFetch.mockResolvedValue({
      entries: [entry('Ana', 1, 300, true)],
      total: 12,
      me: { position: 9, points: 40 },
    })
    wrap()
    expect(await screen.findByText(/Você está em/)).toBeInTheDocument()
    expect(screen.getByText('9º')).toBeInTheDocument()
  })

  it('não repete a posição de quem já aparece na lista', async () => {
    mockApiFetch.mockResolvedValue({
      entries: [entry('Ana', 1, 300, true)],
      total: 3,
      me: { position: 1, points: 300 },
    })
    wrap()
    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.queryByText(/Você está em/)).not.toBeInTheDocument()
  })

  it('some enquanto carrega e quando a chamada falha', async () => {
    mockApiFetch.mockRejectedValue(new Error('falhou'))
    const { container } = wrap()
    expect(container).toBeEmptyDOMElement()
  })

  it('convida a pontuar quando o placar está vazio', async () => {
    mockApiFetch.mockResolvedValue({ entries: [], total: 0, me: null })
    wrap()
    expect(await screen.findByText(/Ninguém pontuou ainda/)).toBeInTheDocument()
    expect(screen.getByText('Ver ranking completo')).toBeInTheDocument()
  })
})
