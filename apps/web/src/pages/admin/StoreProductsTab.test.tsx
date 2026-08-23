import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StoreProductsTab } from './StoreProductsTab'
import * as api from '../../lib/api'

const PRODUCT = {
  id: 'p1',
  title: 'Fone',
  description: null,
  category: 'Equipamento',
  priceInCoins: 100,
  stock: 10,
  imageUrl: null,
  isDigital: false,
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StoreProductsTab />
    </QueryClientProvider>,
  )
}

function findPatchCall(calls: unknown[][], path: string) {
  const call = calls.find(
    ([callPath, options]) => callPath === path && (options as RequestInit | undefined)?.method === 'PATCH',
  )
  if (!call) throw new Error(`nenhuma chamada PATCH encontrada para ${path}`)
  return JSON.parse((call[1] as RequestInit).body as string)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/admin/store/products') return { products: [PRODUCT] } as never
    if (path === '/uploads/config') return { enabled: false } as never
    throw new Error(`rota inesperada: ${path}`)
  })
})

describe('StoreProductsTab', () => {
  // Achado #1 da revisão final: reenviar `stock` incondicionalmente no PATCH
  // ressuscitava estoque já consumido por resgates feitos enquanto o form de
  // edição estava aberto. Editar só o título não pode carregar o `stock`.
  it('edita só o título e NÃO reenvia o estoque carregado', async () => {
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/admin/store/products' && options?.method === undefined) return { products: [PRODUCT] } as never
      if (path === '/uploads/config') return { enabled: false } as never
      if (path === '/admin/store/products/p1' && options?.method === 'PATCH') {
        return { product: { ...PRODUCT, title: 'Fone novo' } } as never
      }
      throw new Error(`rota inesperada: ${path} ${options?.method ?? ''}`)
    })

    renderTab()
    await screen.findByText('Fone')
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))

    const titleInput = screen.getByLabelText('Título')
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, 'Fone novo')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([p, o]) => p === '/admin/store/products/p1' && (o as RequestInit)?.method === 'PATCH',
        ),
      ).toBe(true)
    })

    const body = findPatchCall(fetchSpy.mock.calls, '/admin/store/products/p1')
    expect(body.title).toBe('Fone novo')
    expect(body.stock).toBeUndefined()
    expect(body.isActive).toBeUndefined()
    expect(body.isDigital).toBeUndefined()
  })

  it('edita o estoque quando o valor no form muda de verdade', async () => {
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/admin/store/products' && options?.method === undefined) return { products: [PRODUCT] } as never
      if (path === '/uploads/config') return { enabled: false } as never
      if (path === '/admin/store/products/p1' && options?.method === 'PATCH') {
        return { product: { ...PRODUCT, stock: 3 } } as never
      }
      throw new Error(`rota inesperada: ${path} ${options?.method ?? ''}`)
    })

    renderTab()
    await screen.findByText('Fone')
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))

    const stockInput = screen.getByLabelText('Estoque')
    await userEvent.clear(stockInput)
    await userEvent.type(stockInput, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([p, o]) => p === '/admin/store/products/p1' && (o as RequestInit)?.method === 'PATCH',
        ),
      ).toBe(true)
    })

    const body = findPatchCall(fetchSpy.mock.calls, '/admin/store/products/p1')
    expect(body.stock).toBe(3)
  })

  // Achado #4 da revisão final: apagar é irreversível (SetNull no productId dos
  // pedidos antigos) e não tinha confirmação nenhuma.
  it('pede confirmação antes de apagar e não chama DELETE se o admin cancela', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path === '/admin/store/products') return { products: [PRODUCT] } as never
      if (path === '/uploads/config') return { enabled: false } as never
      throw new Error(`rota inesperada: ${path}`)
    })

    renderTab()
    await screen.findByText('Fone')
    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }))

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Fone'))
    expect(
      fetchSpy.mock.calls.some(([, o]) => (o as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(false)
  })

  it('apaga quando o admin confirma', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/admin/store/products' && options?.method === undefined) return { products: [PRODUCT] } as never
      if (path === '/uploads/config') return { enabled: false } as never
      if (path === '/admin/store/products/p1' && options?.method === 'DELETE') return undefined as never
      throw new Error(`rota inesperada: ${path} ${options?.method ?? ''}`)
    })

    renderTab()
    await screen.findByText('Fone')
    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }))

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([p, o]) => p === '/admin/store/products/p1' && (o as RequestInit)?.method === 'DELETE',
        ),
      ).toBe(true)
    })
  })
})
