import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { CourseDashboardDTO } from '@legends/shared'
import { CourseDashboardTab } from './CourseDashboardTab'
import * as learningApi from '../../lib/learning-api'

vi.mock('../../lib/learning-api', () => ({ getCourseDashboard: vi.fn() }))
const mockGet = learningApi.getCourseDashboard as unknown as Mock

function build(overrides: Partial<CourseDashboardDTO> = {}): CourseDashboardDTO {
  return {
    total: 0,
    byStatus: [
      { status: 'DRAFT', count: 0 },
      { status: 'REVIEW', count: 0 },
      { status: 'PENDING_APPROVAL', count: 0 },
      { status: 'PUBLISHED', count: 0 },
      { status: 'ARCHIVED', count: 0 },
    ],
    studentsEnrolled: 0,
    completionPct: 0,
    hoursOffered: 0,
    averageRating: 0,
    totalRatings: 0,
    mostEnrolled: [],
    mostAbandoned: [],
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CourseDashboardTab />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('CourseDashboardTab', () => {
  it('mostra os indicadores do catálogo', async () => {
    mockGet.mockResolvedValue({
      dashboard: build({ total: 12, studentsEnrolled: 87, completionPct: 63.5, hoursOffered: 41.5 }),
    })
    renderTab()

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText('63.5%')).toBeInTheDocument()
    expect(screen.getByText('41.5h')).toBeInTheDocument()
  })

  // Os cinco estados sempre aparecem: um que some faz o bloco mudar de forma a
  // cada leitura.
  it('lista os cinco estados em português, inclusive os zerados', async () => {
    mockGet.mockResolvedValue({
      dashboard: build({ byStatus: [{ status: 'PUBLISHED', count: 3 }, { status: 'ARCHIVED', count: 0 }] }),
    })
    renderTab()

    expect(await screen.findByText('Publicado')).toBeInTheDocument()
    expect(screen.getByText('Arquivado')).toBeInTheDocument()
  })

  // Sem avaliação, "0 / 5" seria mentira: ninguém deu nota zero.
  it('não inventa nota quando ninguém avaliou', async () => {
    mockGet.mockResolvedValue({ dashboard: build({ averageRating: 0, totalRatings: 0 }) })
    renderTab()

    expect(await screen.findByText('Ninguém avaliou ainda')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('mostra a nota quando há avaliação', async () => {
    mockGet.mockResolvedValue({ dashboard: build({ averageRating: 4.5, totalRatings: 8 }) })
    renderTab()

    expect(await screen.findByText('4.5 / 5')).toBeInTheDocument()
    expect(screen.getByText('8 avaliações')).toBeInTheDocument()
  })

  /**
   * O documento pede "cursos mais acessados". O portal não instrumenta abertura
   * de curso, então o título tem de dizer o que é medido de verdade — prometer
   * acesso e entregar inscrição seria pior do que renomear.
   */
  it('o bloco diz que mede inscrição, não acesso', async () => {
    mockGet.mockResolvedValue({
      dashboard: build({
        mostEnrolled: [{ courseId: 'c1', title: 'Liderança', enrollments: 30, abandonedPct: 0 }],
      }),
    })
    renderTab()

    expect(await screen.findByText('Cursos com mais inscritos')).toBeInTheDocument()
    expect(screen.getByText(/não registra abertura de curso/i)).toBeInTheDocument()
    expect(screen.getByText('30 inscritos')).toBeInTheDocument()
  })

  it('explica o critério do abandono e mostra o percentual', async () => {
    mockGet.mockResolvedValue({
      dashboard: build({
        mostAbandoned: [{ courseId: 'c2', title: 'Compliance', enrollments: 20, abandonedPct: 45 }],
      }),
    })
    renderTab()

    expect(await screen.findByText('45%')).toBeInTheDocument()
    expect(screen.getByText(/paradas há mais de 30 dias/i)).toBeInTheDocument()
  })

  it('estado vazio explica, em vez de mostrar tabela em branco', async () => {
    mockGet.mockResolvedValue({ dashboard: build() })
    renderTab()

    expect(await screen.findByText('Ninguém se inscreveu ainda.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum curso com abandono relevante.')).toBeInTheDocument()
  })
})
