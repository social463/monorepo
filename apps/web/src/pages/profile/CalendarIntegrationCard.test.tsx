import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CalendarIntegrationStateDTO } from '@legends/shared'
import { CalendarIntegrationCard } from './CalendarIntegrationCard'

const getCalendarIntegration = vi.fn()
const startCalendarConnect = vi.fn()
const disconnectCalendar = vi.fn()

vi.mock('../../lib/calendar-api', () => ({
  getCalendarIntegration: () => getCalendarIntegration(),
  startCalendarConnect: (p: string) => startCalendarConnect(p),
  disconnectCalendar: (p: string) => disconnectCalendar(p),
}))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CalendarIntegrationCard />
    </QueryClientProvider>,
  )
}

const state = (over: Partial<CalendarIntegrationStateDTO> = {}): CalendarIntegrationStateDTO => ({
  connections: [],
  available: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  startCalendarConnect.mockResolvedValue({ authorizeUrl: 'https://accounts.google.com/authorize' })
  disconnectCalendar.mockResolvedValue(undefined)
})

describe('CalendarIntegrationCard', () => {
  it('avisa quando a empresa não configurou nenhum provedor', async () => {
    getCalendarIntegration.mockResolvedValue(state())
    renderCard()
    expect(await screen.findByText(/administrador ainda não configurou/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /conectar/i })).not.toBeInTheDocument()
  })

  it('oferece conectar no provedor disponível e navega para a authorizeUrl', async () => {
    getCalendarIntegration.mockResolvedValue(state({ available: ['google'] }))
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign, href: '' }, writable: true })

    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: /conectar google calendar/i }))

    await waitFor(() => expect(startCalendarConnect).toHaveBeenCalledWith('google'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/authorize'))
  })

  it('mostra a conta conectada e permite desconectar', async () => {
    getCalendarIntegration.mockResolvedValue(
      state({
        available: ['google'],
        connections: [
          { provider: 'google', accountEmail: 'ana@empresa.com', status: 'active', publishEnabled: true, lastSyncAt: null },
        ],
      }),
    )
    renderCard()
    expect(await screen.findByText('ana@empresa.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /desconectar google calendar/i }))
    await waitFor(() => expect(disconnectCalendar).toHaveBeenCalledWith('google'))
  })

  it('pede reconexão quando o acesso expirou', async () => {
    getCalendarIntegration.mockResolvedValue(
      state({
        available: ['google'],
        connections: [
          {
            provider: 'google',
            accountEmail: 'ana@empresa.com',
            status: 'needs_reauth',
            publishEnabled: true,
            lastSyncAt: null,
          },
        ],
      }),
    )
    renderCard()
    expect(await screen.findByText(/acesso expirou/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reconectar google calendar/i })).toBeInTheDocument()
  })
})
