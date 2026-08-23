import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { useCultureBenefits } from '../../lib/use-culture'

/**
 * Vitrine dos benefícios. O detalhe abre em tela própria
 * (`/cultura/beneficios/:id`), não em modal: o corpo é longo — o plano de saúde
 * tem cinco tabelas — e diálogo com rolagem interna é ruim de ler e impossível
 * de compartilhar por link.
 */
export function BenefitsTab() {
  const { data, isLoading, isError } = useCultureBenefits()

  if (isLoading) {
    return (
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    )
  }

  if (isError) {
    return <p className="text-body-md text-error">Erro ao carregar os benefícios.</p>
  }

  const benefits = data?.benefits ?? []

  if (benefits.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
        <h2 className="font-headline text-headline-md text-on-surface">Nenhum benefício publicado</h2>
        <p className="mt-sm text-body-md text-on-surface-variant">
          Os canais de apoio e programas de bem-estar aparecem aqui assim que forem publicados.
        </p>
      </div>
    )
  }

  return (
    <ul className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
      {benefits.map((benefit) => (
        <li key={benefit.id}>
          <Link
            to={`/cultura/beneficios/${benefit.id}`}
            className="flex h-full w-full flex-col gap-sm rounded-xl border border-outline-variant/30 bg-surface-container p-lg text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Icon name={benefit.icon || 'volunteer_activism'} className="text-[22px]" />
            </span>
            <h3 className="font-headline text-label-lg text-on-surface">{benefit.title}</h3>
            <p className="text-body-sm text-on-surface-variant">{benefit.summary}</p>
            <span className="mt-auto flex items-center gap-xs pt-sm font-label text-label-sm text-primary">
              Ver detalhes
              <Icon name="chevron_right" className="text-[16px]" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
