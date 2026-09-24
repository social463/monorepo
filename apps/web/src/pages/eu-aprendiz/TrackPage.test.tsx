import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApprenticeTrackDTO, ApprenticeTrackMeetingDTO } from '@legends/shared'
import { fetchApprenticeTrack } from '../../lib/apprentice-api'
import { TrackPage } from './TrackPage'

vi.mock('../../lib/apprentice-api', () => ({
  fetchApprenticeTrack: vi.fn(),
}))

const fetchMock = fetchApprenticeTrack as unknown as Mock

function meeting(over: Partial<ApprenticeTrackMeetingDTO> = {}): ApprenticeTrackMeetingDTO {
  return {
    id: 'm1',
    order: 1,
    title: 'Onde eu estou',
    theme: 'Diagnóstico',
    objectives: ['Nomear o próprio momento'],
    deliverable: 'Mapa de Forças preenchido',
    scheduledOn: '2026-09-15',
    status: 'PROXIMO',
    accessReleased: true,
    surveyOpen: false,
    slideUrl: null,
    unlocked: true,
    activityCount: 3,
    submittedCount: 1,
    surveyAnswered: false,
    completed: false,
    ...over,
  }
}

function track(over: Partial<ApprenticeTrackDTO> = {}): ApprenticeTrackDTO {
  return {
    viewer: {
      userId: 'u1',
      isApprentice: true,
      isFacilitator: false,
      classId: 'c1',
      className: 'Turma A · Manhã',
    },
    meetings: [meeting()],
    makeups: [],
    contractSigned: false,
    ...over,
  }
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('TrackPage', () => {
  it('mostra o progresso do encontro liberado e abre o resumo antes de entrar', async () => {
    fetchMock.mockResolvedValue(track())
    wrap(<TrackPage />)

    expect(await screen.findByText('Onde eu estou')).toBeInTheDocument()
    expect(screen.getByText(/1\/3 fichas enviadas/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Onde eu estou/ }))

    const dialog = screen.getByRole('dialog', { name: /Encontro 1 — Onde eu estou/ })
    expect(within(dialog).getByText('Encontro 1 · 15/09/2026')).toBeInTheDocument()
    expect(within(dialog).getByText('Diagnóstico')).toBeInTheDocument()
    expect(within(dialog).getByText('Nomear o próprio momento')).toBeInTheDocument()
    expect(within(dialog).getByText('Mapa de Forças preenchido')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Abrir o encontro' })).toHaveAttribute(
      'href',
      '/eu-aprendiz/encontro/m1',
    )
  })

  it('o resumo fecha no X, no Esc e no clique fora', async () => {
    fetchMock.mockResolvedValue(track())
    wrap(<TrackPage />)
    const card = await screen.findByRole('button', { name: /Onde eu estou/ })

    fireEvent.click(card)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(card)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(card)
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('encontro bloqueado explica a trava e não vira link', async () => {
    fetchMock.mockResolvedValue(
      track({ meetings: [meeting({ unlocked: false, submittedCount: 0 })] }),
    )
    wrap(<TrackPage />)

    expect(await screen.findByText('Bloqueado')).toBeInTheDocument()
    expect(screen.getByText(/será liberado após a realização do encontro anterior/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Onde eu estou/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Onde eu estou/ })).not.toBeInTheDocument()
  })

  it('reposição agendada aparece no topo da trilha', async () => {
    fetchMock.mockResolvedValue(
      track({
        makeups: [
          {
            id: 'r1',
            meetingId: 'm1',
            meetingOrder: 1,
            scheduledAt: '2026-09-20T14:00:00.000Z',
            attendees: [],
          },
        ],
      }),
    )
    wrap(<TrackPage />)

    expect(await screen.findByText(/Reposição do Encontro 1/)).toBeInTheDocument()
  })

  it('"Você está aqui" marca o primeiro encontro não concluído', async () => {
    fetchMock.mockResolvedValue(
      track({
        meetings: [
          meeting({ id: 'm1', order: 1, completed: true }),
          meeting({ id: 'm2', order: 2, title: 'Minha voz', completed: false }),
        ],
      }),
    )
    wrap(<TrackPage />)

    expect(await screen.findByText('Você está aqui')).toBeInTheDocument()
    // Um só: o marcador é do encontro atual, não de todos os pendentes.
    expect(screen.getAllByText('Você está aqui')).toHaveLength(1)
  })
})
