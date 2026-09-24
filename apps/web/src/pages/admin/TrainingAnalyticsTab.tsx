import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AnalyticsWindowRequest, TrainingOverviewResponse } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import {
  ChartCard,
  DistributionBars,
  EmptyState,
  StatCard,
} from '../../components/analytics/AnalyticsPrimitives'
import { windowKey } from '../../components/analytics/PeriodFilter'

/**
 * Analytics de **Treinamento e Desenvolvimento** (Documento 4, seção 9.5) — a
 * trilha de Desenvolvimento & IA da área de analytics.
 *
 * Ciclo, De/Até e Setor vêm da seção, e valem para todas as abas ao mesmo
 * tempo: são exatamente os três primeiros filtros que o documento lista. O
 * quarto, **Cargo**, é desta aba e só dela.
 *
 * "Telas mais acessadas" NÃO se repete aqui: ele já existe na aba Engajamento,
 * da mesma seção, e dois números para a mesma coisa divergem no primeiro
 * ajuste.
 */
export function TrainingAnalyticsTab({
  window: effWindow,
  sectorId,
}: {
  window: AnalyticsWindowRequest
  sectorId: string
}) {
  const [position, setPosition] = useState('')

  const query = useQuery({
    queryKey: ['admin', 'training', windowKey(effWindow), sectorId, position],
    queryFn: () => {
      const params = new URLSearchParams({ range: effWindow.range })
      if (effWindow.range === 'custom' && effWindow.from && effWindow.to) {
        params.set('from', effWindow.from)
        params.set('to', effWindow.to)
      }
      if (sectorId) params.set('sectorId', sectorId)
      if (position) params.set('position', position)
      return apiFetch<TrainingOverviewResponse>(`/admin/people/training?${params.toString()}`)
    },
  })

  if (query.isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  if (query.isError || !query.data?.training) {
    return (
      <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
        <Icon name="error" className="text-[20px]" />
        Erro ao carregar o painel de Treinamentos.
      </div>
    )
  }

  const data = query.data.training
  const cargos = query.data.positions

  return (
    <section className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <h2 className="font-headline text-headline-md text-on-surface">Treinamentos</h2>
          <p className="text-body-sm text-on-surface-variant">
            Conclusões no período, por setor e por curso.
          </p>
        </div>

        {/* O seletor de cargo é desta aba: os outros painéis não o oferecem, e
            acrescentá-lo a todos mudaria o contrato de quatro telas por uma. */}
        {cargos.length > 0 && (
          <div className="flex items-center gap-sm">
            <span className="font-label text-label-sm text-on-surface-variant">Cargo</span>
            <Select
              ariaLabel="Cargo"
              className="w-56"
              value={position}
              onChange={setPosition}
              options={[
                { value: '', label: 'Todos os cargos' },
                ...cargos.map((cargo) => ({ value: cargo, label: cargo })),
              ]}
            />
          </div>
        )}
      </header>

      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Treinamentos cadastrados"
          value={data.coursesPublished}
          hint="Cursos publicados no catálogo"
          icon="school"
        />
        <StatCard
          label="Média de conclusões por colaborador"
          value={data.completionsPerCollaborator.toLocaleString('pt-BR')}
          hint={`${data.completions} ${data.completions === 1 ? 'conclusão' : 'conclusões'} no período`}
          icon="task_alt"
        />
        <StatCard
          label="Obrigatórios finalizados"
          value={`${data.mandatoryCompletedPct}%`}
          hint={
            data.mandatoryEnrollments > 0
              ? `de ${data.mandatoryEnrollments} ${data.mandatoryEnrollments === 1 ? 'inscrição' : 'inscrições'} em curso obrigatório`
              : 'Nenhuma inscrição em curso obrigatório'
          }
          icon="verified"
        />
      </div>

      <ChartCard
        title="Conclusões por setor"
        subtitle="Pelo setor de quem concluiu — a pergunta é qual área se desenvolveu."
      >
        <DistributionBars
          slices={data.completionsBySector.map((slice) => ({
            key: slice.sectorId,
            label: slice.sectorName,
            count: slice.completions,
          }))}
          emptyMessage="Nenhuma conclusão no período."
        />
      </ChartCard>

      <ChartCard title="Cursos com mais conclusões">
        {data.topCourses.length === 0 ? (
          <EmptyState message="Nenhuma conclusão no período." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                  <th className="py-1 pr-md">Curso</th>
                  <th className="py-1 pr-md">Obrigatório</th>
                  <th className="py-1 text-right">Conclusões</th>
                </tr>
              </thead>
              <tbody>
                {data.topCourses.map((curso) => (
                  <tr key={curso.courseId} className="border-t border-outline-variant/20">
                    <td className="py-1 pr-md text-on-surface">{curso.title}</td>
                    <td className="py-1 pr-md text-on-surface-variant">
                      {curso.mandatory ? 'Sim' : '—'}
                    </td>
                    <td className="py-1 text-right text-on-surface">{curso.completions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </section>
  )
}
