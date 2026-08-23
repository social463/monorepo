import { useParams } from 'react-router-dom'
import { BackButton } from '../../components/BackButton'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { ScrollToTopButton } from '../../components/ScrollToTopButton'
import { Skeleton } from '../../components/Skeleton'
import { useCultureBenefits } from '../../lib/use-culture'

/** Destino quando a tela foi aberta direto pela URL, sem histórico interno. */
const VOLTAR = '/cultura?aba=beneficios'

/**
 * Tela cheia de um benefício. Antes o corpo abria num modal, o que não se
 * sustenta: o plano de saúde sozinho tem ~6 mil caracteres e cinco tabelas, que
 * num diálogo viram rolagem dentro de rolagem.
 *
 * Os dados vêm da mesma query da listagem: são poucos benefícios, já estão em
 * cache quando se navega a partir do card, e evita um endpoint novo só para isso.
 */
export function BenefitDetailPage() {
  const { benefitId } = useParams<{ benefitId: string }>()
  const { data, isLoading, isError } = useCultureBenefits()

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
        <p className="text-body-md text-error">Erro ao carregar o benefício.</p>
      </section>
    )
  }

  const benefit = data?.benefits.find((item) => item.id === benefitId)

  // Id inexistente ou benefício despublicado: não é erro, é conteúdo que saiu do ar.
  if (!benefit) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-md p-lg md:p-xl">
        <BackButton fallback={VOLTAR} className="-ml-sm" />
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
          <h1 className="font-headline text-headline-md text-on-surface">Benefício não encontrado</h1>
          <p className="mt-sm text-body-md text-on-surface-variant">
            Ele pode ter sido despublicado. Veja a lista completa em Benefícios.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-lg p-lg md:p-xl">
      <header className="flex items-start gap-sm">
        <BackButton fallback={VOLTAR} className="-ml-sm mt-1" />
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Icon name={benefit.icon || 'volunteer_activism'} className="text-[26px]" />
        </span>
        <div className="min-w-0">
          <h1 className="font-headline text-headline-lg text-on-surface">{benefit.title}</h1>
          <p className="mt-xs text-body-md text-on-surface-variant">{benefit.summary}</p>
        </div>
      </header>

      <article className="rounded-xl border border-outline-variant/30 bg-surface-container p-lg md:p-xl">
        <Markdown content={benefit.body} />
      </article>

      <ScrollToTopButton />
    </section>
  )
}
