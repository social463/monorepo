import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LeadershipOverviewResponse, PeopleAnalyticsRange } from '@legends/shared'
import { PEOPLE_ANALYTICS_RANGES, PEOPLE_ANALYTICS_RANGE_LABELS } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import {
  ChartCard,
  DistributionBars,
  EmptyState,
  MoodTrendChart,
  StatCard,
} from '../../components/analytics/AnalyticsPrimitives'

/**
 * Indicadores do time do líder — o mesmo conjunto de números do People
 * Analytics, recortado pelos liderados de quem está vendo.
 *
 * Todos os blocos compartilham UM recorte de período, como na tela de Gente e
 * Gestão: dois seletores independentes fariam a leitura comparar janelas
 * diferentes sem avisar.
 */
export function TeamIndicatorsTab() {
  const [range, setRange] = useState<PeopleAnalyticsRange>('30d')

  const query = useQuery({
    queryKey: ['leadership', 'team-analytics', range],
    queryFn: () => apiFetch<LeadershipOverviewResponse>(`/me/team/analytics?range=${range}`),
  })

  return (
    <section className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <p className="max-w-prose text-body-md text-on-surface-variant">
          Clima, reconhecimento e pontuação do seu time no período escolhido.
        </p>
        <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
          Período
          <Select
            ariaLabel="Período de análise"
            value={range}
            onChange={(value) => setRange(value as PeopleAnalyticsRange)}
            options={PEOPLE_ANALYTICS_RANGES.map((value) => ({
              value,
              label: PEOPLE_ANALYTICS_RANGE_LABELS[value],
            }))}
          />
        </label>
      </header>

      {query.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {query.isError && (
        <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          Erro ao carregar os indicadores do time.
        </div>
      )}

      {query.data && <Indicators overview={query.data.overview} range={range} />}
    </section>
  )
}

function Indicators({
  overview,
  range,
}: {
  overview: LeadershipOverviewResponse['overview']
  range: PeopleAnalyticsRange
}) {
  const { mood, feedbacks, topScreens, scores } = overview

  // Quem não lidera ninguém (ADMIN, Gente e Gestão) vê a tela, mas não tem
  // time: mostrar cartões zerados sugeriria um time parado, não um time ausente.
  if (overview.teamSize === 0) {
    return <EmptyState message="Você não tem liderados no momento — não há indicadores para mostrar." />
  }

  const periodLabel = PEOPLE_ANALYTICS_RANGE_LABELS[range]

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="groups" label="Liderados" value={overview.teamSize} hint="Pessoas ativas no seu time" />
        <StatCard
          icon="bar_chart"
          label="Pontuação média"
          value={scores.average}
          hint={`XP por pessoa · ${periodLabel.toLowerCase()}`}
        />
        <StatCard
          icon="sentiment_satisfied"
          label="Humor médio"
          value={mood.average === null ? '—' : `${mood.average.toFixed(1)}/5`}
          hint={`${mood.entries} registros no período`}
        />
        <StatCard
          icon="how_to_reg"
          label="Participantes do termômetro"
          value={mood.participants}
          hint={`de ${overview.teamSize} liderados`}
        />
      </div>

      <ChartCard title="Feedbacks no período" subtitle="Trocas do time no mural de feedbacks">
        <div className="grid gap-md sm:grid-cols-2">
          <StatCard icon="edit_note" label="Escritos pelo time" value={feedbacks.written} />
          <StatCard icon="reviews" label="Recebidos pelo time" value={feedbacks.received} />
        </div>
      </ChartCard>

      <ChartCard title="Tendência do clima" subtitle="Média diária na escala de 1 (triste) a 5 (ótimo)">
        <MoodTrendChart points={mood.trend} />
      </ChartCard>

      <ChartCard title="Termômetro de clima" subtitle="Distribuição das respostas de humor no período">
        <DistributionBars slices={mood.distribution} emptyMessage="Ninguém do time registrou o humor no período." />
      </ChartCard>

      <ChartCard title="Telas mais acessadas" subtitle="Onde o time passa o tempo no período">
        <DistributionBars
          slices={topScreens.map((screen) => ({ key: screen.path, label: screen.label, count: screen.accesses }))}
          emptyMessage="Nenhum acesso do time registrado no período."
        />
      </ChartCard>

      <ChartCard title="Pontuação por pessoa" subtitle={`XP ganho no período · ${periodLabel.toLowerCase()}`}>
        <DistributionBars
          slices={scores.perPerson.map((member) => ({
            key: member.userId,
            label: member.name,
            count: member.points,
          }))}
          emptyMessage="Ninguém do time pontuou no período."
          showShare={false}
        />
      </ChartCard>
    </div>
  )
}
