import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useOfficeInviteToasts } from './useOfficeInviteToasts'
import { useUnreadNotificationsPoll } from '../../lib/use-notifications'
import { useCurrentPeriod } from '../../lib/use-current-period'
import { getRetroRoom } from '../../lib/retro-api'

vi.mock('../../lib/use-notifications', () => ({ useUnreadNotificationsPoll: vi.fn() }))
vi.mock('../../lib/use-current-period', () => ({ useCurrentPeriod: vi.fn() }))
vi.mock('../../lib/retro-api', () => ({ getRetroRoom: vi.fn() }))

const unreadPollMock = vi.mocked(useUnreadNotificationsPoll)
const currentPeriodMock = vi.mocked(useCurrentPeriod)
const getRetroRoomMock = vi.mocked(getRetroRoom)

function notif(over: Partial<{ id: string; type: string; title: string; link: string | null }> = {}) {
  return {
    id: 'n1',
    type: 'RETRO_INVITED',
    title: 'Você foi convidado para a retrospectiva "Sprint 12"',
    link: '/retrospectivas/room1',
    read: false,
    createdAt: '2026-07-21T00:00:00.000Z',
    actor: null,
    ...over,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  currentPeriodMock.mockReturnValue({ period: null, votingOpen: false, isLoading: false })
  getRetroRoomMock.mockResolvedValue({ room: { status: 'OPEN' } } as never)
})

it('ignora tipos que não são convite de retro/votação', async () => {
  unreadPollMock.mockReturnValue({
    data: { items: [notif({ type: 'FEEDBACK_RECEIVED', title: 'Você recebeu um feedback' })], unreadCount: 1, nextCursor: null },
  } as never)
  const { result } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(result.current.queue).toHaveLength(0))
})

it('retro aberta entra na fila; retro fechada não entra', async () => {
  getRetroRoomMock.mockResolvedValueOnce({ room: { status: 'CONCLUDED' } } as never)
  unreadPollMock.mockReturnValue({
    data: { items: [notif()], unreadCount: 1, nextCursor: null },
  } as never)
  const { result } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(getRetroRoomMock).toHaveBeenCalledWith('room1'))
  expect(result.current.queue).toHaveLength(0)
})

it('votação aberta entra na fila; votação fechada não entra', async () => {
  currentPeriodMock.mockReturnValue({ period: { id: 'p1' } as never, votingOpen: true, isLoading: false })
  unreadPollMock.mockReturnValue({
    data: {
      items: [notif({ id: 'n2', type: 'PERIOD_OPENED', title: 'A votação de Julho está aberta!', link: '/votar' })],
      unreadCount: 1,
      nextCursor: null,
    },
  } as never)
  const { result } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(result.current.queue).toHaveLength(1))
  expect(result.current.queue[0]).toMatchObject({ id: 'n2', type: 'PERIOD_OPENED', link: '/votar' })
})

it('período de votação ainda carregando não descarta o candidato; ele entra na fila quando o período resolve como aberto', async () => {
  currentPeriodMock.mockReturnValue({ period: null, votingOpen: false, isLoading: true })
  unreadPollMock.mockReturnValue({
    data: {
      items: [notif({ id: 'n2', type: 'PERIOD_OPENED', title: 'A votação de Julho está aberta!', link: '/votar' })],
      unreadCount: 1,
      nextCursor: null,
    },
  } as never)
  const { result, rerender } = renderHook(() => useOfficeInviteToasts(), { wrapper })

  // Enquanto o período ainda está carregando, o candidato não pode ser
  // marcado como "checked"/"seen" — precisa continuar elegível.
  expect(result.current.queue).toHaveLength(0)

  currentPeriodMock.mockReturnValue({ period: { id: 'p1' } as never, votingOpen: true, isLoading: false })
  rerender()

  await waitFor(() => expect(result.current.queue).toHaveLength(1))
  expect(result.current.queue[0]).toMatchObject({ id: 'n2', type: 'PERIOD_OPENED', link: '/votar' })
})

it('checagem "ainda aberta" falhando descarta o candidato silenciosamente', async () => {
  getRetroRoomMock.mockRejectedValueOnce(new Error('404'))
  unreadPollMock.mockReturnValue({
    data: { items: [notif()], unreadCount: 1, nextCursor: null },
  } as never)
  const { result } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(getRetroRoomMock).toHaveBeenCalled())
  expect(result.current.queue).toHaveLength(0)
})

it('dismiss remove da fila e não reaparece mesmo que o próximo poll ainda traga como não-lido', async () => {
  currentPeriodMock.mockReturnValue({ period: { id: 'p1' } as never, votingOpen: true, isLoading: false })
  const item = notif({ id: 'n2', type: 'PERIOD_OPENED', title: 'A votação de Julho está aberta!', link: '/votar' })
  unreadPollMock.mockReturnValue({
    data: { items: [item], unreadCount: 1, nextCursor: null },
  } as never)
  const { result, rerender } = renderHook(() => useOfficeInviteToasts(), { wrapper })
  await waitFor(() => expect(result.current.queue).toHaveLength(1))

  act(() => result.current.dismiss('n2'))
  expect(result.current.queue).toHaveLength(0)

  rerender()
  expect(result.current.queue).toHaveLength(0)
})
