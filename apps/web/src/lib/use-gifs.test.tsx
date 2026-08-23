import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useGifsEnabled } from './use-gifs'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useGifsEnabled', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true }),
    } as Response)
  })

  it('retorna true quando /gifs/config diz enabled', async () => {
    const { result } = renderHook(() => useGifsEnabled(), { wrapper })
    await waitFor(() => expect(result.current).toBe(true))
  })
})
