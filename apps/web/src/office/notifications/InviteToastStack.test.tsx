import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InviteToastStack } from './InviteToastStack'
import { useMarkRead } from '../../lib/use-notifications'

vi.mock('../../lib/use-notifications', () => ({ useMarkRead: vi.fn() }))
const useMarkReadMock = vi.mocked(useMarkRead)

const items = [
  { id: 'n1', type: 'RETRO_INVITED' as const, title: 'Você foi convidado para a retrospectiva "Sprint 12"', link: '/retrospectivas/room1' },
]

function renderStack(dismiss = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    dismiss,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <InviteToastStack queue={items} dismiss={dismiss} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  useMarkReadMock.mockReturnValue({ mutate: vi.fn() } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

it('renderiza o título e o rótulo de call-to-action do tipo', () => {
  renderStack()
  expect(screen.getByText(/convidado para a retrospectiva/i)).toBeInTheDocument()
  expect(screen.getByText('Clique para participar')).toBeInTheDocument()
})

it('clicar navega (link do card) e marca como lida', () => {
  const markReadMutate = vi.fn()
  useMarkReadMock.mockReturnValue({ mutate: markReadMutate } as never)
  renderStack()
  fireEvent.click(screen.getByRole('link'))
  expect(markReadMutate).toHaveBeenCalledWith('n1')
})

it('X dispensa sem marcar como lida', () => {
  const markReadMutate = vi.fn()
  useMarkReadMock.mockReturnValue({ mutate: markReadMutate } as never)
  const dismiss = vi.fn()
  renderStack(dismiss)
  fireEvent.click(screen.getByRole('button', { name: 'Dispensar convite' }))
  expect(dismiss).toHaveBeenCalledWith('n1')
  expect(markReadMutate).not.toHaveBeenCalled()
})

it('some sozinho depois de ~10s', () => {
  const dismiss = vi.fn()
  renderStack(dismiss)
  vi.advanceTimersByTime(10_000)
  expect(dismiss).toHaveBeenCalledWith('n1')
})
