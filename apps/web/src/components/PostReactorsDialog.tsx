import { useEffect } from 'react'
import { Icon } from './Icon'
import { ReactorsList } from './ReactorsList'
import { useCorporatePostReactors } from '../lib/use-corporate-mural'

/**
 * "Quem reagiu" a partir do card do feed. Antes o card mostrava só a fileira de
 * avatares (teto de 8) e a contagem: com nove reações, a nona pessoa não
 * aparecia em lugar nenhum.
 *
 * A lista é aberta a quem enxerga o post — o servidor confere o público-alvo
 * do comunicado, o mesmo recorte dos comentários.
 */
export function PostReactorsDialog({ postId, onClose }: { postId: string; onClose: () => void }) {
  const reactors = useCorporatePostReactors(postId)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Quem reagiu"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl">
        <div className="mb-md flex items-center justify-between gap-sm">
          <h2 className="font-headline text-title-md text-on-surface">Quem reagiu</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {reactors.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
          {reactors.isError && (
            <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              Erro ao carregar quem reagiu.
            </p>
          )}
          {reactors.data && <ReactorsList items={reactors.data.items} total={reactors.data.total} />}
        </div>
      </div>
    </div>
  )
}
