import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { getOkrPersonResults } from '../../lib/okr-api'
import { CyclePicker } from './CyclePicker'
import { OkrEmpty, OkrResultModePicker, OkrResults } from './OkrPage'
import { useOkrCycle } from './use-okr-cycle'
import { isOkrResultMode, type OkrResultMode } from './okr-view'

/** Metas de uma pessoa no ciclo — só o que quem está vendo pode enxergar. */
export function OkrPersonPage() {
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedMode = searchParams.get('resultado')
  const mode: OkrResultMode = isOkrResultMode(requestedMode) ? requestedMode : 'acumulado'
  const { cycles, cycle, selectCycle, isLoading: loadingCycles } = useOkrCycle()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['okr', 'person', id, cycle?.id],
    queryFn: () => getOkrPersonResults(id, cycle!.id),
    enabled: !!cycle && !!id,
  })
  const objectives = data?.results.objectives ?? []

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <Link to="/metas?aba=ciclo" className="inline-flex items-center gap-xs self-start font-label text-label-md text-primary">
        <Icon name="arrow_back" className="text-[18px]" /> Metas do ciclo
      </Link>
      <h1 className="font-headline text-headline-lg text-on-surface md:text-headline-xl">
        {data ? `Metas de ${data.results.person.name}` : 'Metas'}
      </h1>
      {cycle && (
        <div className="flex flex-wrap items-start gap-md">
          <OkrResultModePicker
            mode={mode}
            onSelect={(next) => {
              const params = new URLSearchParams(searchParams)
              params.set('resultado', next)
              setSearchParams(params, { replace: true })
            }}
          />
          <CyclePicker cycles={cycles} cycle={cycle} onSelect={selectCycle} />
        </div>
      )}

      {(loadingCycles || isLoading) && <Skeleton className="h-40 w-full" />}
      {isError && <OkrEmpty>Não foi possível carregar as metas desta pessoa.</OkrEmpty>}
      {data && objectives.length === 0 && <OkrEmpty>Nenhuma meta desta pessoa neste ciclo.</OkrEmpty>}
      {cycle && objectives.length > 0 && (
        <OkrResults objectives={objectives} cycle={cycle} mode={mode} title="Metas por escopo" />
      )}
    </section>
  )
}
