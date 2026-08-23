import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock, describe, it, expect, beforeEach } from 'vitest'
import { RetrosPage, RetroSprintPage } from './RetrosPage'
import { listRetroRooms } from '../lib/retro-api'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'l1', name: 'Lia', role }, loading: false }),
}))
vi.mock('../lib/retro-api', () => ({
  listRetroRooms: vi.fn(),
  listRetroSquads: vi.fn(() => Promise.resolve({ squads: [] })),
  listInvitableUsers: vi.fn(() => Promise.resolve({ users: [] })),
  createRetroRoom: vi.fn(),
  deleteRetroRoom: vi.fn(async () => undefined),
}))

// mutable role shared between tests
let role = 'LEAD'

function room(id: string, sprint: number, squadName: string) {
  return {
    id, title: `Retrospectiva Sprint ${sprint} - Squad ${squadName}`, sprint,
    squads: [{ id: 's' + id, name: squadName }], status: 'OPEN', anonymous: false,
    votesPerParticipant: 3, createdAt: '2026-06-01T00:00:00.000Z', concludedAt: null,
    creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR',
  }
}

it('agrupa salas por sprint e mostra a contagem', async () => {
  role = 'LEAD'
  ;(listRetroRooms as unknown as Mock).mockResolvedValue({
    rooms: [room('a', 23, 'Inovação'), room('b', 23, 'B2B'), room('c', 22, 'Inovação')],
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RetrosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Sprint 23')).toBeInTheDocument()
  expect(screen.getByText('Sprint 22')).toBeInTheDocument()
  expect(screen.getByText('2 salas')).toBeInTheDocument()
  expect(screen.getByText('1 sala')).toBeInTheDocument()
})

// ── New tests for the archive (soft-delete) feature ──────────────────────────

const adminRoom = {
  id: 'r1', sprint: 42, squads: [{ id: 's1', name: 'Inovação' }], status: 'OPEN' as const,
  anonymous: false, votesPerParticipant: 3, createdAt: '', concludedAt: null,
  creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR' as const,
}

import * as api from '../lib/retro-api'

function renderSprint() {
  ;(listRetroRooms as unknown as Mock).mockResolvedValue({ rooms: [adminRoom] })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/retrospectivas/sprint/42']}>
        <Routes>
          <Route path="/retrospectivas/sprint/:sprint" element={<RetroSprintPage />} />
          <Route path="/retrospectivas" element={<div>Voltar</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RetroSprintPage — arquivar sala (admin)', () => {
  beforeEach(() => { role = 'ADMIN'; vi.clearAllMocks() })

  it('admin confirma e arquiva a sala', async () => {
    renderSprint()
    const trash = await screen.findByRole('button', { name: /arquivar sala/i })
    fireEvent.click(trash)
    fireEvent.click(await screen.findByRole('button', { name: /^arquivar$/i }))
    await waitFor(() => expect(api.deleteRetroRoom).toHaveBeenCalledWith('r1'))
  })

  it('não-admin não vê o botão de arquivar', async () => {
    role = 'LEGEND'
    renderSprint()
    await screen.findByText('Inovação')
    expect(screen.queryByRole('button', { name: /arquivar sala/i })).toBeNull()
  })
})
