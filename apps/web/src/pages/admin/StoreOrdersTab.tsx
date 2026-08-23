import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  STORE_ORDER_STATUSES,
  STORE_ORDER_STATUS_LABELS,
  type StoreOrderAdminListResponse,
  type StoreOrderBatchRequest,
  type StoreOrderBatchResult,
  type StoreOrderStatus,
} from '@legends/shared'
import { apiFetch, apiFetchBlob } from '../../lib/api'

const ADMIN_STORE_ORDERS_KEY = ['admin-store-orders']

export function StoreOrdersTab() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StoreOrderStatus | ''>('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [report, setReport] = useState<StoreOrderBatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const query = `?page=${page}${status ? `&status=${status}` : ''}`
  const { data, isLoading } = useQuery({
    queryKey: [...ADMIN_STORE_ORDERS_KEY, status, page],
    queryFn: () => apiFetch<StoreOrderAdminListResponse>(`/admin/store/orders${query}`),
  })

  /**
   * Troca de filtro ou de página troca as linhas visíveis na tela — uma
   * seleção feita antes disso não pode sobreviver: "Cancelar selecionados"
   * clicado depois agiria sobre ids que o admin não vê mais na tela (e aqui
   * isso credita coins e devolve estoque). Um único ponto para as três
   * transições (filtro, página anterior, página seguinte) evita que uma
   * futura esqueça de limpar. Mesmo racional de ChallengeSubmissionsSection.
   */
  function resetSelectionAndResult() {
    setSelected([])
    setReport(null)
    setError(null)
  }

  const batch = useMutation({
    mutationFn: (next: StoreOrderStatus) => {
      const body: StoreOrderBatchRequest = { ids: selected, status: next }
      // `adminNotes` só entra no corpo quando a G&G realmente digitou algo nesta
      // ação. Deixar o campo vazio e mandar `null` incondicionalmente apagaria a
      // nota de uma decisão anterior (ex.: aprovar com nota, depois entregar em
      // lote sem digitar de novo) — a chave omitida é o que preserva, ver PATCH
      // individual em admin-store.ts.
      const trimmed = notes.trim()
      if (trimmed !== '') body.adminNotes = trimmed
      return apiFetch<StoreOrderBatchResult>('/admin/store/orders/batch', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: (result) => {
      // O lote nunca é tudo-ou-nada: mostramos exatamente o que passou e o que não.
      setReport(result)
      setError(null)
      setSelected([])
      setNotes('')
      void queryClient.invalidateQueries({ queryKey: ADMIN_STORE_ORDERS_KEY })
    },
    onError: (err) => {
      // Sem isto, uma falha na própria chamada (rede, 500, refresh de token
      // que não colou) deixava a tela muda — ou pior, com o `report` de um
      // lote anterior ainda na tela, lido como se fosse o resultado desta
      // ação. Limpamos o relatório velho para não mentir sobre o que aconteceu agora.
      setReport(null)
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a ação em lote.')
    },
  })

  async function exportCsv() {
    try {
      const { blob, filename } = await apiFetchBlob(`/admin/store/orders/export${query}`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename ?? 'pedidos-loja.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      // `apiFetchBlob` lança em qualquer resposta não-OK; sem isto a falha some
      // como rejeição não tratada e a tela fica muda sobre o que aconteceu.
      setError(err instanceof Error ? err.message : 'Não foi possível exportar o CSV.')
    }
  }

  const orders = data?.orders ?? []

  return (
    <div>
      <div className="mb-md flex flex-wrap items-center gap-sm">
        <label className="text-label-md">
          Status
          <select
            className="ml-xs rounded-md bg-surface-container px-sm py-xs"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StoreOrderStatus | '')
              setPage(1)
              resetSelectionAndResult()
            }}
          >
            <option value="">Todos</option>
            {STORE_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{STORE_ORDER_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <button className="rounded-full px-md py-xs text-label-lg" onClick={exportCsv}>
          Exportar CSV
        </button>
      </div>

      {error && <p role="alert" className="mb-md text-body-sm text-error">{error}</p>}

      {report && (
        <div role="status" className="mb-md rounded-lg bg-surface-container p-md text-body-sm">
          <p>
            {report.succeeded.length} de {report.succeeded.length + report.failed.length} pedidos atualizados
          </p>
          {report.failed.map((f) => (
            <p key={f.id} className="text-on-surface-variant">{f.message}</p>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="mb-md flex flex-wrap items-center gap-sm">
          <input
            className="rounded-md bg-surface-container px-sm py-xs"
            placeholder="Nota interna (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="rounded-full bg-primary px-md py-xs text-label-lg text-on-primary"
            disabled={batch.isPending}
            onClick={() => batch.mutate('APPROVED')}
          >
            Aprovar selecionados
          </button>
          <button
            className="rounded-full px-md py-xs text-label-lg"
            disabled={batch.isPending}
            onClick={() => batch.mutate('DELIVERED')}
          >
            Marcar como entregues
          </button>
          <button
            className="rounded-full px-md py-xs text-label-lg text-error"
            disabled={batch.isPending}
            onClick={() => batch.mutate('CANCELLED')}
          >
            Cancelar selecionados
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-body-md text-on-surface-variant">Carregando…</p>
      ) : orders.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">Nenhum pedido nesse recorte.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center gap-md rounded-lg bg-surface-container p-md">
              <input
                type="checkbox"
                aria-label={`Selecionar pedido de ${order.user.name}`}
                checked={selected.includes(order.id)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked ? [...prev, order.id] : prev.filter((id) => id !== order.id),
                  )
                }
              />
              <div className="flex-1">
                <p className="text-title-sm">{order.user.name}</p>
                <p className="text-body-sm text-on-surface-variant">{order.productTitle}</p>
                {order.adminNotes && (
                  <p className="text-body-sm text-on-surface-variant">Nota: {order.adminNotes}</p>
                )}
              </div>
              <span className="text-body-sm">{order.pricePaid} coins</span>
              <span className="text-label-lg">{STORE_ORDER_STATUS_LABELS[order.status]}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-md flex items-center gap-sm">
        <button
          disabled={page === 1}
          onClick={() => {
            setPage((p) => p - 1)
            resetSelectionAndResult()
          }}
        >
          Anterior
        </button>
        <span className="text-body-sm">Página {page}</span>
        <button
          disabled={(data?.total ?? 0) <= page * (data?.pageSize ?? 20)}
          onClick={() => {
            setPage((p) => p + 1)
            resetSelectionAndResult()
          }}
        >
          Próxima
        </button>
      </div>
    </div>
  )
}
