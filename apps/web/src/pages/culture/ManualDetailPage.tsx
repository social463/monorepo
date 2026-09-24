import { Link, useParams } from 'react-router-dom'
import { BackButton } from '../../components/BackButton'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { ScrollToTopButton } from '../../components/ScrollToTopButton'
import { Skeleton } from '../../components/Skeleton'
import { useCultureManuals } from '../../lib/use-culture'
import { formatSize, useManualDownload } from './manual-file'
import { useBonusCalculatorManualId } from './bonus-program'

/** Destino quando a tela foi aberta direto pela URL, sem histórico interno. */
const VOLTAR = '/cultura?aba=manuais'

/**
 * Leitura de um manual em tela cheia. Mesma razão do detalhe de benefício, só
 * que mais forte: o Código de Ética passa de 30 mil caracteres, e ler isso
 * dentro de um diálogo com rolagem própria é inviável.
 *
 * Reaproveita a query da listagem — poucos manuais, já em cache ao chegar pelo
 * card, e sem endpoint novo.
 */
export function ManualDetailPage() {
  const { manualId } = useParams<{ manualId: string }>()
  const { data, isLoading, isError } = useCultureManuals()
  const { download, error: downloadError } = useManualDownload()
  /**
   * A calculadora do Todos Pelos 9 aparece aqui, e só no manual que a G&G
   * escolheu em Administração — o mesmo hook que decide o botão no card da
   * lista, para os dois não discordarem sobre qual manual a abre.
   */
  const calculadoraManualId = useBonusCalculatorManualId()
  const temCalculadora = Boolean(manualId) && calculadoraManualId === manualId

  if (isLoading) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-lg p-lg md:p-xl">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </section>
    )
  }

  if (isError) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-md p-lg md:p-xl">
        <BackButton fallback={VOLTAR} className="-ml-sm" />
        <p className="text-body-md text-error">Erro ao carregar o manual.</p>
      </section>
    )
  }

  const manual = data?.manuals.find((item) => item.id === manualId)

  if (!manual) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-md p-lg md:p-xl">
        <BackButton fallback={VOLTAR} className="-ml-sm" />
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
          <h1 className="font-headline text-headline-md text-on-surface">Manual não encontrado</h1>
          <p className="mt-sm text-body-md text-on-surface-variant">
            Ele pode ter sido despublicado. Veja a lista completa em Manuais.
          </p>
        </div>
      </section>
    )
  }

  const size = formatSize(manual.fileSize)

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-lg p-lg md:p-xl">
      <header className="flex items-start gap-sm">
        <BackButton fallback={VOLTAR} className="-ml-sm mt-1" />
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Icon name="menu_book" className="text-[26px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-headline text-headline-lg text-on-surface">{manual.title}</h1>
          <p className="mt-xs text-body-md text-on-surface-variant">{manual.description}</p>
          {(manual.referenceLabel || size) && (
            <p className="mt-xs text-label-sm text-on-surface-variant">
              {[manual.referenceLabel, size].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {manual.downloadPath && (
          <button
            type="button"
            onClick={() => download(manual)}
            className="flex shrink-0 items-center gap-xs rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary hover:text-primary"
          >
            <Icon name="download" className="text-[18px]" />
            PDF
          </button>
        )}
      </header>

      {temCalculadora && (
        <Link
          to="/cultura/calculadora-todos-pelos-9"
          className="flex items-center gap-sm rounded-xl border border-primary/40 bg-primary/10 p-md text-on-surface transition-colors hover:border-primary"
        >
          <Icon name="calculate" className="text-[24px] text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block font-label text-label-lg text-primary">Simular o meu bônus</span>
            <span className="block text-body-sm text-on-surface-variant">
              A calculadora faz a conta deste manual com os seus números.
            </span>
          </span>
          <Icon name="chevron_right" className="text-[20px] text-on-surface-variant" />
        </Link>
      )}

      {downloadError && (
        <p role="alert" className="text-body-sm text-error">
          {downloadError}
        </p>
      )}

      <article className="rounded-xl border border-outline-variant/30 bg-surface-container p-lg md:p-xl">
        {manual.body ? (
          <Markdown content={manual.body} />
        ) : (
          <p className="text-body-md text-on-surface-variant">Este manual está disponível apenas em PDF.</p>
        )}
      </article>

      <ScrollToTopButton />
    </section>
  )
}
