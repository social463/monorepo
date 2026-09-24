/**
 * Dashboard da Central de Cursos (Documento 4, seção 9.6).
 *
 * Responde **"o catálogo está saudável?"** — quantos cursos existem, em que
 * estado, e quanto do que começa termina. Não se confunde com o Analytics de
 * T&D (Lote C), que responde "o time se desenvolveu?" e mora em People
 * Analytics: são perguntas e públicos diferentes, e por isso duas telas.
 */

import { useQuery } from '@tanstack/react-query'
import { COURSE_STATUS_LABELS, type CourseDashboardRowDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { getCourseDashboard } from '../../lib/learning-api'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-outline-variant/30 bg-surface-container p-md">
      <span className="font-label text-label-sm text-on-surface-variant">{label}</span>
      <span className="font-headline text-headline-sm text-on-surface">{value}</span>
      {hint && <span className="text-body-sm text-on-surface-variant">{hint}</span>}
    </div>
  )
}

function CourseTable({
  title,
  hint,
  rows,
  empty,
  metric,
}: {
  title: string
  hint: string
  rows: CourseDashboardRowDTO[]
  empty: string
  metric: (row: CourseDashboardRowDTO) => string
}) {
  return (
    <section className="flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container p-md">
      <div>
        <h4 className="font-label text-label-lg text-on-surface">{title}</h4>
        <p className="text-body-sm text-on-surface-variant">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-body-sm italic text-on-surface-variant">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {rows.map((row) => (
            <li key={row.courseId} className="flex items-center justify-between gap-sm text-body-md">
              <span className="min-w-0 flex-1 truncate text-on-surface">{row.title}</span>
              <span className="shrink-0 font-label text-label-md text-on-surface-variant">{metric(row)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function CourseDashboardTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'course-dashboard'],
    queryFn: getCourseDashboard,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (isError || !data) return <p className="text-body-md text-error">Erro ao carregar os indicadores.</p>
  const d = data.dashboard

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total de cursos" value={String(d.total)} />
        <Stat
          label="Alunos inscritos"
          value={String(d.studentsEnrolled)}
          hint="Pessoas distintas, não inscrições"
        />
        <Stat
          label="Taxa média de conclusão"
          value={`${d.completionPct}%`}
          hint="Das inscrições feitas"
        />
        <Stat label="Horas ofertadas" value={`${d.hoursOffered}h`} hint="Só do que está publicado" />
        <Stat
          label="Avaliação média"
          value={d.totalRatings > 0 ? `${d.averageRating} / 5` : '—'}
          hint={d.totalRatings > 0 ? `${d.totalRatings} avaliações` : 'Ninguém avaliou ainda'}
        />
      </div>

      <section className="flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container p-md">
        <h4 className="font-label text-label-lg text-on-surface">Distribuição por status</h4>
        <ul className="flex flex-wrap gap-md">
          {d.byStatus.map((slice) => (
            <li key={slice.status} className="flex items-baseline gap-xs">
              <span className="font-headline text-title-lg text-on-surface">{slice.count}</span>
              <span className="text-body-sm text-on-surface-variant">
                {COURSE_STATUS_LABELS[slice.status]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-md lg:grid-cols-2">
        {/* O documento pede "cursos mais acessados"; o portal não instrumenta
            abertura de curso, então o título diz o que é medido de verdade. */}
        <CourseTable
          title="Cursos com mais inscritos"
          hint="O portal não registra abertura de curso; inscrição é o sinal mais próximo."
          rows={d.mostEnrolled}
          empty="Ninguém se inscreveu ainda."
          metric={(row) => `${row.enrollments} inscritos`}
        />
        <CourseTable
          title="Cursos com maior abandono"
          hint="Inscrições paradas há mais de 30 dias, entre cursos com pelo menos 5 inscritos."
          rows={d.mostAbandoned}
          empty="Nenhum curso com abandono relevante."
          metric={(row) => `${row.abandonedPct}%`}
        />
      </div>

      <p className="flex items-start gap-xs text-body-sm text-on-surface-variant">
        <Icon name="info" className="mt-0.5 text-[16px]" />
        <span>
          Estes números são do catálogo, sem recorte de período. Conclusões por setor e por cargo ficam em
          People Analytics › Treinamentos.
        </span>
      </p>
    </div>
  )
}
