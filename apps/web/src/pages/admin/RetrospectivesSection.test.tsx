import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RetrospectivesSection } from './RetrospectivesSection'

vi.mock('../../lib/retro-api', () => ({
  listAdminRetroRooms: vi.fn(),
  updateAdminRetroRoom: vi.fn(),
  hardDeleteAdminRetroRoom: vi.fn(),
  deleteRetroRoom: vi.fn(),
}))
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn().mockResolvedValue({ squads: [] }) }
})

import { listAdminRetroRooms, hardDeleteAdminRetroRoom, deleteRetroRoom } from '../../lib/retro-api'

const room = {
  id: 'r1', title: 'Retrospectiva Sprint 10 - Squad Inovação', sprint: 10,
  squads: [{ id: 's1', name: 'Inovação' }], status: 'OPEN', anonymous: false,
  votesPerParticipant: 3, createdAt: new Date().toISOString(), concludedAt: null,
  creator: { id: 'u1', name: 'Lia' }, participantCount: 2, myRole: 'OBSERVER',
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><RetrospectivesSection /></QueryClientProvider>)
}

describe('RetrospectivesSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista as salas e deleta após confirmar', async () => {
    ;(listAdminRetroRooms as any).mockResolvedValue({ rooms: [room] })
    ;(hardDeleteAdminRetroRoom as any).mockResolvedValue(undefined)
    renderSection()

    expect(await screen.findByText(/Retrospectiva Sprint 10/)).toBeInTheDocument()
    // row "Deletar" opens the modal
    fireEvent.click(screen.getByRole('button', { name: 'Deletar' }))
    // confirm inside the dialog
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deletar' }))
    await waitFor(() => expect(hardDeleteAdminRetroRoom).toHaveBeenCalledWith('r1'))
  })

  it('arquiva após confirmar', async () => {
    ;(listAdminRetroRooms as any).mockResolvedValue({ rooms: [room] })
    ;(deleteRetroRoom as any).mockResolvedValue(undefined)
    renderSection()

    expect(await screen.findByText(/Retrospectiva Sprint 10/)).toBeInTheDocument()
    // row "Arquivar" opens the modal
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }))
    // confirm inside the dialog
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }))
    await waitFor(() => expect(deleteRetroRoom).toHaveBeenCalledWith('r1'))
    expect(hardDeleteAdminRetroRoom).not.toHaveBeenCalled()
  })

  it('estado vazio', async () => {
    ;(listAdminRetroRooms as any).mockResolvedValue({ rooms: [] })
    renderSection()
    expect(await screen.findByText('Nenhuma sala por aqui ainda.')).toBeInTheDocument()
  })
})
