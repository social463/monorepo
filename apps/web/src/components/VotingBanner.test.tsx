import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { VotingBanner } from './VotingBanner'
import * as api from '../lib/api'

function routePeriods(current: unknown) {
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/periods/current') return { period: current }
    throw new Error(`unexpected ${path}`)
  })
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VotingBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-26T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra faixa de votação aberta com prazo e link para votar', async () => {
    routePeriods({
      id: 'p1', monthRef: '2026-06', startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-06-30T23:59:59.000Z', status: 'OPEN', state: 'OPEN', editable: true,
    })
    wrap(<VotingBanner />)

    const banner = await screen.findByTestId('voting-banner-open')
    expect(banner).toHaveAttribute('href', '/votar')
    expect(banner).toHaveTextContent(/votação aberta/i)
    // De 26/06 até 30/06 ≈ 5 dias restantes.
    expect(banner).toHaveTextContent(/faltam 5 dias/i)
  })

  it('não renderiza nada quando não há votação aberta', () => {
    routePeriods(null)
    const { container } = wrap(<VotingBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
