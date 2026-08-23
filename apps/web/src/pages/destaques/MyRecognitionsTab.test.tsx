import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MyRecognitionsTab } from './MyRecognitionsTab'
import * as api from '../../lib/api'

function highlight(monthRef: string, message: string | null) {
  return {
    id: `h-${monthRef}`,
    monthRef,
    person: { id: 'u1', name: 'Ana' },
    group: { id: 'g1', name: 'Produto' },
    message,
    createdAt: '2026-08-01T00:00:00.000Z',
  }
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MyRecognitionsTab />
    </QueryClientProvider>,
  )
}

describe('MyRecognitionsTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lista os reconhecimentos com mês, grupo e justificativa', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      highlights: [highlight('2026-08', 'Segurou a virada do sistema.')],
    })

    wrap()

    expect(await screen.findByText('Agosto de 2026')).toBeInTheDocument()
    expect(screen.getByText('Produto')).toBeInTheDocument()
    expect(screen.getByText(/Segurou a virada do sistema/)).toBeInTheDocument()
  })

  it('sem reconhecimento, explica em vez de mostrar lista vazia', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ highlights: [] })

    wrap()

    expect(await screen.findByText(/ainda não foi destaque do mês/i)).toBeInTheDocument()
  })

  it('o filtro de mês vai para o servidor só quando é ligado', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ highlights: [] })

    wrap()
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/monthly-highlights/mine'))

    fireEvent.click(screen.getByLabelText(/filtrar por mês/i))

    await waitFor(() =>
      expect(spy.mock.calls.some(([url]) => String(url).includes('monthRef='))).toBe(true),
    )
  })
})
