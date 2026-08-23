import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { useCultureManuals } from '../../lib/use-culture'
import { formatSize, useManualDownload } from './manual-file'

/**
 * Lista os manuais. A leitura abre em tela própria (`/cultura/manuais/:id`) e
 * não em modal: um Código de Ética passa de 40 mil caracteres. O download do
 * PDF fica aqui também, para quem só quer o arquivo.
 */
export function ManualsTab() {
  const { data, isLoading, isError } = useCultureManuals()
  const { download, error: downloadError } = useManualDownload()

  if (isLoading) {
    return (
      <div className="grid gap-md sm:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (isError) {
    return <p className="text-body-md text-error">Erro ao carregar os manuais.</p>
  }

  const manuals = data?.manuals ?? []

  if (manuals.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
        <h2 className="font-headline text-headline-md text-on-surface">Nenhum manual publicado</h2>
        <p className="mt-sm text-body-md text-on-surface-variant">
          Os documentos oficiais da empresa aparecem aqui assim que forem publicados.
        </p>
      </div>
    )
  }

  return (
    <>
      {downloadError && <p className="mb-md text-body-sm text-error">{downloadError}</p>}
      <ul className="grid gap-md sm:grid-cols-2">
        {manuals.map((manual) => {
          const size = formatSize(manual.fileSize)
          return (
            <li
              key={manual.id}
              className="flex flex-col gap-sm rounded-xl border border-outline-variant/30 bg-surface-container p-lg"
            >
              <div className="flex items-start gap-md">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon name="menu_book" className="text-[22px]" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-headline text-label-lg text-on-surface">{manual.title}</h3>
                  <p className="mt-xs text-body-sm text-on-surface-variant">{manual.description}</p>
                </div>
              </div>

              {(manual.referenceLabel || size) && (
                <p className="text-label-sm text-on-surface-variant">
                  {[manual.referenceLabel, size].filter(Boolean).join(' · ')}
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-sm pt-sm">
                {manual.body && (
                  <Link
                    to={`/cultura/manuais/${manual.id}`}
                    className="flex items-center gap-xs rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
                  >
                    Ler manual
                    <Icon name="chevron_right" className="text-[18px]" />
                  </Link>
                )}
                {manual.downloadPath && (
                  <button
                    type="button"
                    onClick={() => download(manual)}
                    className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary hover:text-primary"
                  >
                    <Icon name="download" className="text-[18px]" />
                    PDF
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
