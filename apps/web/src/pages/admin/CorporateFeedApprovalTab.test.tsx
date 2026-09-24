import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { PendingCorporatePostDTO } from '@legends/shared'
import { CorporateFeedApprovalTab } from './CorporateFeedApprovalTab'
import * as api from '../../lib/api'

const author = {
  id: 'u2', name: 'Bia', email: 'b@x.com', role: 'LEGEND' as const, area: null, position: null, positionCategory: null,
  squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
  active: true, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null, sectorId: 's1',
  companyId: 'c1', companyName: null, enabledFeatures: [], sectorFeatures: [], adminAccess: false,
}

const pendente: PendingCorporatePostDTO = {
  id: 'p1',
  author,
  authorSectorName: 'Produto',
  title: 'Mutirão de doação',
  content: 'Vamos juntar agasalhos',
  body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Vamos juntar agasalhos' }] }] },
  gif: null,
  image: null,
  poll: null,
  attachments: [],
  status: 'PENDING',
  publishAt: null,
  audience: 'ALL',
  audienceSectors: [],
  createdAt: '2026-08-17T12:00:00.000Z',
  editedAt: null,
  pinnedAt: null,
  collapsible: false,
  reactions: [],
  reactors: [],
  reactorCount: 0,
  commentCount: 0,
  viewerRead: true,
  tag: null,
  mentions: [],
  rejectionReason: null,
  reviewedAt: null,
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CorporateFeedApprovalTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CorporateFeedApprovalTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lista os pendentes e aprova pela ação do card', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ items: [pendente] })
    wrap()

    expect(await screen.findByText('Mutirão de doação')).toBeInTheDocument()
    expect(screen.getByText('Vamos juntar agasalhos')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e publicar' }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/corporate-posts/p1/approve', { method: 'POST' }),
    )
  })

  it('recusar pede o motivo antes de mandar', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ items: [pendente] })
    wrap()
    await screen.findByText('Mutirão de doação')

    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    fireEvent.change(screen.getByLabelText(/motivo da recusa/i), { target: { value: 'Fora do tom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recusa' }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/corporate-posts/p1/reject', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Fora do tom' }),
      }),
    )
  })

  it('fila vazia diz que não há nada aguardando', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ items: [] })
    wrap()

    expect(await screen.findByText('Nenhum comunicado aguardando aprovação.')).toBeInTheDocument()
  })
})
