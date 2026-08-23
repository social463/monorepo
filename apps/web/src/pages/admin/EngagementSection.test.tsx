import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Mock } from 'vitest'
import { EngagementSection } from './EngagementSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function person(id: string, name: string, sectorName = 'Gente e Gestão') {
  return {
    id,
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
  }
}

const OVERVIEW = {
  overview: {
    monthRef: '2026-08',
    people: 10,
    scored: 8,
    activeThisMonth: 6,
    totalPoints: 5_400,
    pointsThisMonth: 900,
    byEvent: [
      { event: 'VOTE_CAST', points: 3_000, credits: 60, people: 8 },
      { event: 'MOOD_ANSWERED', points: 2_400, credits: 240, people: 7 },
    ],
    bySector: [
      { sectorId: 's1', sectorName: 'Gente e Gestão', people: 6, scored: 5, points: 4_000, averagePoints: 667 },
      { sectorId: 's2', sectorName: 'Comercial', people: 4, scored: 3, points: 1_400, averagePoints: 350 },
    ],
    idle: [{ user: person('u9', 'Parada Silva'), points: 320, lastPointAt: '2026-05-04T12:00:00.000Z' }],
    top: [
      {
        position: 1,
        points: 1_600,
        online: true,
        level: { name: 'Ouro', color: '#8F6A00', next: 'Platina', min: 1500, nextMin: 3500, remaining: 1900, progress: 5 },
        user: person('u1', 'Ana Primeira'),
      },
    ],
  },
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EngagementSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EngagementSection (Administração › Engajamento)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockResolvedValue(OVERVIEW)
  })

  /** Valor do quadro de resumo cujo rótulo é `label`. */
  function tileValue(label: string): string {
    const tile = screen.getByText(label).closest('div')!.parentElement!
    return tile.querySelector('p')!.textContent ?? ''
  }

  it('resume adesão, pontos do mês e quem está fora do jogo', async () => {
    wrap()
    expect(await screen.findByText('Pessoas no ranking')).toBeInTheDocument()

    expect(tileValue('Pessoas no ranking')).toBe('10')
    expect(tileValue('Pontuaram no mês')).toBe('6')
    // 6 de 10 pontuaram: a adesão vem calculada, não como número solto.
    expect(screen.getByText(/60% do time/)).toBeInTheDocument()
    expect(tileValue('Pontos no mês')).toBe('900')
    // 10 pessoas menos as 6 que pontuaram.
    expect(tileValue('Fora do jogo no mês')).toBe('4')
  })

  it('mostra por onde os pontos entram, com o rótulo do evento', async () => {
    wrap()
    expect(await screen.findByText('Votar no período')).toBeInTheDocument()
    expect(screen.getByText('Registrar o humor do dia')).toBeInTheDocument()
    expect(screen.getByText('3.000')).toBeInTheDocument()
  })

  it('quebra por setor com quantos pontuaram', async () => {
    wrap()
    // O nome do setor também aparece nas linhas de pessoa; aqui interessa a
    // tabela por setor, que é a que traz o percentual de quem pontuou.
    const setores = (await screen.findByText('Por setor')).closest('section')!
    expect(within(setores).getByText('Gente e Gestão')).toBeInTheDocument()
    expect(within(setores).getByText('Comercial')).toBeInTheDocument()
    expect(within(setores).getByText('(83%)')).toBeInTheDocument()
    expect(within(setores).getByText('(75%)')).toBeInTheDocument()
  })

  it('lista quem não pontuou no mês, com o último ponto recebido', async () => {
    wrap()
    expect(await screen.findByText('Parada Silva')).toBeInTheDocument()
    expect(screen.getByText('04/05/2026')).toBeInTheDocument()
  })

  it('leva para as regras de XP, que é onde se muda o que cada ação vale', async () => {
    wrap()
    expect(await screen.findByRole('link', { name: 'Pontos (XP)' })).toHaveAttribute('href', '/admin/xp')
    expect(screen.getByRole('link', { name: 'Ver ranking completo' })).toHaveAttribute('href', '/ranking')
  })

  it('avisa quando o panorama não carrega', async () => {
    mockApiFetch.mockRejectedValue(new Error('falhou'))
    wrap()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível carregar/)
  })
})
