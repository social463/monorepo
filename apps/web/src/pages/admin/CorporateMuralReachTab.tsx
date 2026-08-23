import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { useCorporateMuralReach } from '../../lib/use-corporate-mural'
import { ReachDetailDialog, type ReachDetailMode } from './ReachDetailDialog'

// Autoridade do tamanho de página: enviado ao servidor via `useCorporateMuralReach`
// (não presumido do default dele) e usado aqui para calcular "Mostrando X–Y de N".
const PAGE_SIZE = 20

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Número da tabela que abre a lista de quem está por trás dele. Zero não vira
 * botão: clicar levaria a um modal vazio, e o cursor de link prometeria algo
 * que não existe.
 */
function CountCell({ value, label, onClick }: { value: number; label: string; onClick: () => void }) {
  if (value === 0) return <span className="text-on-surface-variant">0</span>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="font-label text-label-md text-primary underline-offset-2 hover:underline"
    >
      {value}
    </button>
  )
}

/**
 * Alcance dos comunicados do mural: por post, quantas pessoas leram, comentaram
 * e reagiram. Reação e comentário abrem a lista nominal (quem foi); **leitura
 * não** — a lista de quem leu continua fora do contrato, de propósito: registro
 * de leitura é passivo, e nomear quem leu vira vigilância.
 */
export function CorporateMuralReachTab() {
  const [sort, setSort] = useState<'date_desc' | 'date_asc'>('date_desc')
  const [page, setPage] = useState(1)
  const reach = useCorporateMuralReach(sort, page, PAGE_SIZE)
  // Qual comunicado está aberto no detalhe, e por qual lista ele abriu.
  const [detail, setDetail] = useState<{ postId: string; excerpt: string; mode: ReachDetailMode } | null>(null)

  function changeSort(next: 'date_desc' | 'date_asc') {
    setSort(next)
    setPage(1) // inverter a ordenação com a página em 3 levaria a um recorte sem sentido
  }

  if (reach.isLoading) {
    return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  }
  if (reach.isError) {
    return (
      <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
        <Icon name="error" className="text-[16px]" />
        Erro ao carregar o alcance dos comunicados.
      </p>
    )
  }
  if (!reach.data) {
    return null
  }

  const { total, items, audience } = reach.data
  const isEmpty = items.length === 0

  // "Nenhum comunicado publicado ainda" só é verdade na página 1. Uma página
  // além da primeira vindo vazia (ex.: post apagado por outro admin entre
  // refetches) não pode reaproveitar essa mensagem — ela substituiria o painel
  // inteiro, inclusive a paginação, e o admin ficaria sem volta para a página 1.
  if (isEmpty && page === 1) {
    return <p className="text-body-sm text-on-surface-variant">Nenhum comunicado publicado ainda.</p>
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = isEmpty ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = isEmpty ? 0 : rangeStart + items.length - 1

  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-sm text-on-surface-variant">
        Base de {audience} pessoas ativas (terceirizados fora).
      </p>
      {isEmpty ? (
        <p className="text-body-sm text-on-surface-variant">Nenhum comunicado nesta página.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-outline-variant/40 font-label text-label-sm text-on-surface-variant">
                <th className="py-sm pr-md font-bold">Comunicado</th>
                <th className="py-sm pr-md font-bold">Leitores</th>
                <th className="py-sm pr-md font-bold">% da base</th>
                <th className="py-sm pr-md font-bold">Comentários</th>
                <th className="py-sm pr-md font-bold">Reações</th>
                <th className="py-sm font-bold">
                  <button
                    type="button"
                    onClick={() => changeSort(sort === 'date_desc' ? 'date_asc' : 'date_desc')}
                    className="flex items-center gap-xs text-on-surface-variant transition-colors hover:text-primary"
                  >
                    Data
                    <Icon
                      name={sort === 'date_desc' ? 'arrow_downward' : 'arrow_upward'}
                      className="text-[14px]"
                    />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.postId} className="border-b border-outline-variant/20 text-body-sm text-on-surface">
                  <td className="max-w-[20rem] truncate py-sm pr-md">{item.excerpt}</td>
                  <td className="py-sm pr-md">{item.readers}</td>
                  <td className="py-sm pr-md">{item.readPct}%</td>
                  <td className="py-sm pr-md">
                    <CountCell
                      value={item.comments}
                      label={`Ver quem comentou: ${item.excerpt}`}
                      onClick={() => setDetail({ postId: item.postId, excerpt: item.excerpt, mode: 'comments' })}
                    />
                  </td>
                  <td className="py-sm pr-md">
                    <CountCell
                      value={item.reactions}
                      label={`Ver quem reagiu: ${item.excerpt}`}
                      onClick={() => setDetail({ postId: item.postId, excerpt: item.excerpt, mode: 'reactions' })}
                    />
                  </td>
                  <td className="whitespace-nowrap py-sm text-on-surface-variant">{formatDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-sm">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant disabled:opacity-40"
        >
          Anterior
        </button>
        <span className="font-label text-label-sm text-on-surface-variant">
          {isEmpty ? 'Nenhum resultado nesta página' : `Mostrando ${rangeStart}–${rangeEnd} de ${total}`}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
      {detail && (
        <ReachDetailDialog
          postId={detail.postId}
          excerpt={detail.excerpt}
          mode={detail.mode}
          onChangeMode={(mode) => setDetail((d) => (d ? { ...d, mode } : d))}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}
