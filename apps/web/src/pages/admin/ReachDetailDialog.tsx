import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { ReactorsList } from '../../components/ReactorsList'
import { useCorporatePostComments, useCorporatePostReactors } from '../../lib/use-corporate-mural'

export type ReachDetailMode = 'reactions' | 'comments'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Quem reagiu e quem comentou num comunicado — o detalhe por trás dos números
 * da tabela de alcance. Duas listas no mesmo modal porque a pergunta da G&G é a
 * mesma ("quem, afinal?") e a coluna clicada só decide por qual delas abre.
 *
 * As duas listas vêm das rotas do próprio feed, que quem modera enxerga
 * inteiras — o recorte por público-alvo não vale para admin/subadmin. A de
 * reações é a mesma que o card do feed abre em "N reações" (`ReactorsList` é
 * compartilhada), então o painel não tem uma segunda versão da mesma tela.
 */
export function ReachDetailDialog({
  postId,
  excerpt,
  mode,
  onChangeMode,
  onClose,
}: {
  postId: string
  excerpt: string
  mode: ReachDetailMode
  onChangeMode: (mode: ReachDetailMode) => void
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const reactors = useCorporatePostReactors(mode === 'reactions' ? postId : null)
  const comments = useCorporatePostComments(postId, mode === 'comments')
  const commentItems = comments.data?.pages.flatMap((page) => page.items) ?? []

  const isLoading = mode === 'reactions' ? reactors.isLoading : comments.isLoading
  const isError = mode === 'reactions' ? reactors.isError : comments.isError

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe do alcance do comunicado"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl">
        <div className="mb-sm flex items-start justify-between gap-sm">
          <div className="min-w-0">
            <h2 className="font-headline text-title-md text-on-surface">Quem participou</h2>
            <p className="mt-1 truncate text-body-sm text-on-surface-variant">{excerpt}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>

        <div role="tablist" aria-label="Detalhe do alcance" className="mb-md flex gap-xs border-b border-outline-variant/40">
          {(
            [
              { id: 'reactions' as const, label: 'Reações' },
              { id: 'comments' as const, label: 'Comentários' },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => onChangeMode(t.id)}
              className={`-mb-px border-b-2 px-sm py-xs font-label text-label-md transition-colors ${
                mode === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
          {isError && (
            <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              Erro ao carregar a lista.
            </p>
          )}

          {mode === 'reactions' && !isLoading && !isError && reactors.data && (
            <ReactorsList items={reactors.data.items} total={reactors.data.total} />
          )}

          {mode === 'comments' && !isLoading && !isError && (
            <>
              {commentItems.length === 0 && (
                <p className="text-body-sm text-on-surface-variant">Ninguém comentou este comunicado ainda.</p>
              )}
              <ul className="flex flex-col divide-y divide-outline-variant/20">
                {commentItems.map((comment) => (
                  <li key={comment.id} className="flex gap-sm py-sm">
                    <Link
                      to={`/perfil/${comment.author.id}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest"
                    >
                      <Avatar user={comment.author} />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-xs">
                        <Link
                          to={`/perfil/${comment.author.id}`}
                          className="truncate font-label text-label-md text-on-surface hover:underline"
                        >
                          {comment.author.name}
                        </Link>
                        <span className="shrink-0 text-on-surface-variant">·</span>
                        <span className="shrink-0 font-label text-label-sm text-on-surface-variant">
                          {formatDateTime(comment.createdAt)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-body-sm text-on-surface">{comment.content}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {comments.hasNextPage && (
                <button
                  type="button"
                  onClick={() => comments.fetchNextPage()}
                  disabled={comments.isFetchingNextPage}
                  className="mt-sm font-label text-label-md text-primary hover:underline disabled:opacity-50"
                >
                  {comments.isFetchingNextPage ? 'Carregando…' : 'Ver mais comentários'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
