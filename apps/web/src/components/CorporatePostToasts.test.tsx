import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { CorporatePostToasts } from './CorporatePostToasts'
import { CORPORATE_FEED_KEY } from '../lib/use-corporate-mural'
import * as api from '../lib/api'

/** WebSocket falso: guarda a instância para o teste empurrar eventos. */
class FakeWS {
  static instances: FakeWS[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) {
    FakeWS.instances.push(this)
  }
  close() {}
}

function wrap(ui: ReactNode, qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CorporatePostToasts', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    FakeWS.instances = []
    ;(globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS
    vi.spyOn(api, 'getAccessToken').mockReturnValue('tok')
    vi.spyOn(api, 'refreshAccessToken').mockResolvedValue(true)
  })

  it('abre UMA conexão de tempo real — é a do app inteiro, não a do feed', async () => {
    wrap(<CorporatePostToasts />, new QueryClient())

    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    expect(FakeWS.instances[0].url).toContain('/api/corporate-posts/ws?token=tok')
  })

  /**
   * O que fazia o feed ficar velho até o F5: o evento chegava na conexão do
   * toast, que não invalidava query nenhuma.
   */
  it('invalida o feed ao receber comunicado novo, esteja quem estiver na tela', async () => {
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      post: { id: 'p1', title: 'Mutirão de doação', content: 'texto', author: { name: 'Bia' } },
    })
    wrap(<CorporatePostToasts />, qc)

    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    FakeWS.instances[0].onmessage?.({ data: JSON.stringify({ type: 'feed:changed' }) })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: CORPORATE_FEED_KEY })
  })

  it('mostra o toast do comunicado publicado', async () => {
    const qc = new QueryClient()
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      post: { id: 'p1', title: 'Mutirão de doação', content: 'texto', author: { name: 'Bia' } },
    })
    wrap(<CorporatePostToasts />, qc)

    await waitFor(() => expect(FakeWS.instances.length).toBe(1))
    FakeWS.instances[0].onmessage?.({ data: JSON.stringify({ type: 'post:published', postId: 'p1' }) })

    expect(await screen.findByText('Mutirão de doação')).toBeInTheDocument()
    expect(screen.getByText('por Bia')).toBeInTheDocument()
  })
})
