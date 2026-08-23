import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CalendarSettingsDTO } from '@legends/shared'
import { CalendarSection } from './CalendarSection'

const getCalendarSettings = vi.fn()
const updateCalendarSettings = vi.fn()

vi.mock('../../lib/calendar-api', () => ({
  getCalendarSettings: () => getCalendarSettings(),
  updateCalendarSettings: (body: unknown) => updateCalendarSettings(body),
}))

const settings = (over: Partial<CalendarSettingsDTO> = {}): CalendarSettingsDTO => ({
  google: { configured: false, clientId: null, redirectUri: 'https://app/api/calendar/callback/google' },
  microsoft: {
    configured: false,
    clientId: null,
    tenantId: null,
    redirectUri: 'https://app/api/calendar/callback/microsoft',
  },
  ...over,
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CalendarSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  updateCalendarSettings.mockImplementation(async () => settings({ google: { configured: true, clientId: 'cid', redirectUri: 'https://app/api/calendar/callback/google' } }))
})

describe('CalendarSection', () => {
  it('mostra os redirect URIs que o admin precisa registrar', async () => {
    getCalendarSettings.mockResolvedValue(settings())
    renderSection()
    expect(await screen.findByText('https://app/api/calendar/callback/google')).toBeInTheDocument()
    expect(screen.getByText('https://app/api/calendar/callback/microsoft')).toBeInTheDocument()
  })

  it('envia client id e secret do Google', async () => {
    getCalendarSettings.mockResolvedValue(settings())
    renderSection()
    await userEvent.type(await screen.findByLabelText(/client id do google/i), 'cid')
    await userEvent.type(screen.getByLabelText(/client secret do google/i), 'csecret')
    await userEvent.click(screen.getByRole('button', { name: /salvar google calendar/i }))

    await waitFor(() =>
      expect(updateCalendarSettings).toHaveBeenCalledWith({ google: { clientId: 'cid', clientSecret: 'csecret' } }),
    )
  })

  it('com secret já configurado, salvar sem digitar não envia clientSecret', async () => {
    getCalendarSettings.mockResolvedValue(
      settings({ google: { configured: true, clientId: 'cid', redirectUri: 'https://app/api/calendar/callback/google' } }),
    )
    renderSection()
    await screen.findByDisplayValue('cid')
    expect(screen.getByLabelText(/client secret do google/i)).toHaveAttribute('placeholder', 'configurado')

    await userEvent.click(screen.getByRole('button', { name: /salvar google calendar/i }))
    await waitFor(() => expect(updateCalendarSettings).toHaveBeenCalledWith({ google: { clientId: 'cid' } }))
  })

  it('envia tenant id junto das credenciais da Microsoft', async () => {
    getCalendarSettings.mockResolvedValue(settings())
    renderSection()
    await userEvent.type(await screen.findByLabelText(/client id da microsoft/i), 'mid')
    await userEvent.type(screen.getByLabelText(/client secret da microsoft/i), 'msecret')
    await userEvent.type(screen.getByLabelText(/tenant id/i), 'tenant-1')
    await userEvent.click(screen.getByRole('button', { name: /salvar microsoft 365/i }))

    await waitFor(() =>
      expect(updateCalendarSettings).toHaveBeenCalledWith({
        microsoft: { clientId: 'mid', clientSecret: 'msecret', tenantId: 'tenant-1' },
      }),
    )
  })

  it('mantém o texto que a pessoa está digitando quando a query revalida', async () => {
    // Primeira carga: nada configurado. Depois que a Microsoft é salva, a
    // invalidação da query dispara um refetch cuja resposta reflete a
    // Microsoft agora configurada (conteúdo diferente do primeiro fetch, então
    // o react-query não pode reaproveitar a mesma referência por structural
    // sharing) — mas o Google continua sem credencial no servidor. Isso prova
    // que o texto de Google ainda não salvo sobrevive à revalidação.
    getCalendarSettings
      .mockResolvedValueOnce(settings())
      .mockResolvedValue(
        settings({
          microsoft: {
            configured: true,
            clientId: 'mid',
            tenantId: 'tenant-1',
            redirectUri: 'https://app/api/calendar/callback/microsoft',
          },
        }),
      )
    renderSection()

    const googleClientIdInput = await screen.findByLabelText(/client id do google/i)
    await userEvent.type(googleClientIdInput, 'ainda-nao-salvo')

    await userEvent.type(screen.getByLabelText(/client id da microsoft/i), 'mid')
    await userEvent.type(screen.getByLabelText(/tenant id/i), 'tenant-1')
    await userEvent.click(screen.getByRole('button', { name: /salvar microsoft 365/i }))

    await waitFor(() =>
      expect(updateCalendarSettings).toHaveBeenCalledWith({ microsoft: { clientId: 'mid', tenantId: 'tenant-1' } }),
    )
    // aguarda o refetch disparado pela invalidação após o save da Microsoft
    await waitFor(() => expect(getCalendarSettings.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.getByLabelText(/client id da microsoft/i)).toHaveValue('mid'))

    expect(googleClientIdInput).toHaveValue('ainda-nao-salvo')
  })

  it('salvar um provedor não apaga o secret digitado no outro', async () => {
    getCalendarSettings.mockResolvedValue(settings())
    renderSection()

    await userEvent.type(await screen.findByLabelText(/client id do google/i), 'cid')
    await userEvent.type(screen.getByLabelText(/client secret do google/i), 'gsecret')
    await userEvent.type(screen.getByLabelText(/client secret da microsoft/i), 'msecret')

    await userEvent.click(screen.getByRole('button', { name: /salvar google calendar/i }))
    await waitFor(() =>
      expect(updateCalendarSettings).toHaveBeenCalledWith({ google: { clientId: 'cid', clientSecret: 'gsecret' } }),
    )

    expect(screen.getByLabelText(/client secret do google/i)).toHaveValue('')
    expect(screen.getByLabelText(/client secret da microsoft/i)).toHaveValue('msecret')
  })
})
