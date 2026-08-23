import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StreakIndicator } from './StreakIndicator'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('StreakIndicator', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra o número do streak atual', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      currentStreak: 7, bestStreak: 24, today: '2026-06-23', registeredToday: true,
    } as never)
    wrap(<StreakIndicator />)
    expect(await screen.findByText('7')).toBeInTheDocument()
  })

  it('não renderiza nada quando a query falha', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockRejectedValue(new Error('boom'))
    const { container } = wrap(<StreakIndicator />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
