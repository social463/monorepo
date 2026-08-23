import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StoreOrdersTab } from './StoreOrdersTab'
import * as api from '../../lib/api'

const ORDERS = {
  orders: [
    { id: 'o1', status: 'PENDING', productId: 'p1', productTitle: 'Fone', pricePaid: 100,
      imageUrl: null, handledAt: null, createdAt: '2026-08-01T12:00:00.000Z',
      adminNotes: null, user: { id: 'u1', name: 'Ana', email: 'ana@x.com' }, handledBy: null },
    { id: 'o2', status: 'PENDING', productId: 'p2', productTitle: 'Day off', pricePaid: 500,
      imageUrl: null, handledAt: null, createdAt: '2026-08-01T13:00:00.000Z',
      adminNotes: null, user: { id: 'u2', name: 'Bia', email: 'bia@x.com' }, handledBy: null },
  ],
  total: 2, page: 1, pageSize: 20,
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StoreOrdersTab />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/store/orders')) return ORDERS as never
    if (path.startsWith('/admin/store/products')) return { products: [] } as never
    throw new Error(`rota inesperada: ${path}`)
  })
})

describe('StoreOrdersTab', () => {
  it('lista os pedidos com pessoa e preço congelado', async () => {
    renderTab()
    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Fone')).toBeInTheDocument()
    expect(screen.getByText('100 coins')).toBeInTheDocument()
  })

  it('aprova em lote e relata quantos passaram', async () => {
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/admin/store/orders/batch' && options?.method === 'POST') {
        return { succeeded: ['o1'], failed: [{ id: 'o2', message: 'Não é possível mudar o pedido para este status.' }] } as never
      }
      if (path.startsWith('/admin/store/orders')) return ORDERS as never
      throw new Error(`rota inesperada: ${path}`)
    })

    renderTab()
    await screen.findByText('Ana')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar pedido de Ana' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar pedido de Bia' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar selecionados' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 de 2 pedidos atualizados')
    })
    expect(screen.getByRole('status')).toHaveTextContent('Não é possível mudar o pedido para este status.')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/admin/store/orders/batch',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  // Achado #2 da revisão final: sem isso, uma seleção feita antes de trocar o
  // filtro de status continuava "ativa" — o toolbar de lote agiria sobre ids
  // que a G&G não vê mais na tela, e "Cancelar selecionados" credita coins.
  it('troca de filtro de status limpa a seleção e some com o toolbar de lote', async () => {
    renderTab()
    await screen.findByText('Ana')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar pedido de Ana' }))
    expect(screen.getByRole('button', { name: 'Aprovar selecionados' })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Status', { selector: 'select' }), 'DELIVERED')

    expect(screen.queryByRole('button', { name: 'Aprovar selecionados' })).not.toBeInTheDocument()
  })

  it('trocar de página limpa a seleção e some com o toolbar de lote', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/store/orders')) return { ...ORDERS, total: 40 } as never
      if (path.startsWith('/admin/store/products')) return { products: [] } as never
      throw new Error(`rota inesperada: ${path}`)
    })

    renderTab()
    await screen.findByText('Ana')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar pedido de Ana' }))
    expect(screen.getByRole('button', { name: 'Aprovar selecionados' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }))

    expect(screen.queryByRole('button', { name: 'Aprovar selecionados' })).not.toBeInTheDocument()
  })

  // Achado #3 da revisão final: `exportCsv` não tinha try/catch — uma falha
  // (rede, 500) sumia como rejeição não tratada, sem nada visível na tela.
  it('mostra erro quando a exportação de CSV falha', async () => {
    vi.spyOn(api, 'apiFetchBlob').mockRejectedValue(new Error('Não foi possível baixar o arquivo'))

    renderTab()
    await screen.findByText('Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível baixar o arquivo')
    })
  })

  it('mostra erro e limpa o relatório antigo quando o lote falha', async () => {
    let batchCalls = 0
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/admin/store/orders/batch' && options?.method === 'POST') {
        batchCalls += 1
        // Primeira chamada: sucesso, deixa um relatório na tela. Segunda: falha.
        if (batchCalls === 1) return { succeeded: ['o1'], failed: [] } as never
        throw new Error('Falha de rede ao enviar o lote.')
      }
      if (path.startsWith('/admin/store/orders')) return ORDERS as never
      throw new Error(`rota inesperada: ${path}`)
    })

    renderTab()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar pedido de Ana' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar selecionados' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 de 1 pedidos atualizados')
    })

    // Nova ação, desta vez falha: o relatório do sucesso anterior não pode
    // continuar na tela como se fosse o resultado desta chamada.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar pedido de Bia' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar selecionados' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Falha de rede ao enviar o lote.')
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
