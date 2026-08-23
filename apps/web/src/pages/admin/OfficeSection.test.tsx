import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

import { OfficeSection } from './OfficeSection'

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <OfficeSection />
      </QueryClientProvider>,
    ),
  }
}

describe('OfficeSection', () => {
  it('mostra o estado atual e liga pelo switch', async () => {
    apiFetchMock.mockResolvedValueOnce({ broadcastEnabled: false }) // GET
    apiFetchMock.mockResolvedValueOnce({ broadcastEnabled: true })  // PATCH
    const { queryClient } = renderSection()

    const toggle = await screen.findByRole('switch', { name: 'Alto-falante do escritório' })
    // O botão nasce desabilitado (isLoading) — esperar o GET assentar antes de
    // clicar, senão o clique cai num botão ainda disabled e vira no-op.
    await waitFor(() => expect(toggle).not.toBeDisabled())
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/admin/office-settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ broadcastEnabled: true }) }),
    )
    expect(queryClient.getQueryData(['office', 'config'])).toEqual({ broadcastEnabled: true })
  })
})
