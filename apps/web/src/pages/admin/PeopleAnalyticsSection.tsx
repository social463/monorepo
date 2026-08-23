import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  EngagementOverviewResponse,
  PeopleAnalyticsRange,
  PeopleOverviewResponse,
  SectorDTO,
} from '@legends/shared'
import {isSectorAdminOnly, PEOPLE_ANALYTICS_RANGES, PEOPLE_ANALYTICS_RANGE_LABELS } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import {
  AccessHeatmap,
  AccessSeriesChart,
  ChartCard,
  MoodTrendChart,
  DistributionBars,
  EmptyState,
  RateBar,
  StatCard,
} from '../../components/analytics/AnalyticsPrimitives'
import { useAuth } from '../../auth/AuthContext'
import { CollaboratorsSection } from './CollaboratorsSection'

type TabKey = 'overview' | 'profile' | 'engagement'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Visão geral', icon: 'insights' },
  { key: 'profile', label: 'Ficha & Perfil', icon: 'group' },
  { key: 'engagement', label: 'Clima & Engajamento', icon: 'favorite' },
]

function buildQuery(range: PeopleAnalyticsRange, sectorId: string): string {
  const params = new URLSearchParams({ range })
  if (sectorId) params.set('sectorId', sectorId)
  return params.toString()
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// ----- Aba: Visão geral -----

function OverviewTab({ range, sectorId }: { range: PeopleAnalyticsRange; sectorId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'people', 'overview', range, sectorId],
    queryFn: () => apiFetch<PeopleOverviewResponse>(`/admin/people/overview?${buildQuery(range, sectorId)}`),
  })

  if (query.isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  if (query.isError) {
    return (
      <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
        <Icon name="error" className="text-[20px]" />
        Erro ao carregar a visão geral.
      </div>
    )
  }

  const overview = query.data!.overview
  const { votingAdoption } = overview

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="badge" label="Pessoas ativas" value={overview.activePeople} hint="Cadastros ativos no recorte" />
        <StatCard icon="person" label="Únicos em 7 dias" value={overview.uniqueUsers7d} hint="Acessaram na última semana" />
        <StatCard icon="groups" label="Únicos em 30 dias" value={overview.uniqueUsers30d} hint="Acessaram no último mês" />
        <StatCard
          icon="trending_up"
          label="Adesão"
          value={`${overview.adoptionRate}%`}
          hint="Únicos de 30 dias sobre pessoas ativas"
        />
      </div>

      <ChartCard title="Acessos por dia" subtitle={PEOPLE_ANALYTICS_RANGE_LABELS[range]}>
        <AccessSeriesChart points={overview.accessSeries} />
      </ChartCard>

      <ChartCard title="Mapa de calor de atividade" subtitle="Dia da semana × hora (horário de São Paulo)">
        <AccessHeatmap cells={overview.accessHeatmap} />
      </ChartCard>

      <div className="grid gap-lg lg:grid-cols-2">
        <ChartCard title="Adesão da votação" subtitle="Período de votação em aberto">
          {votingAdoption ? (
            <RateBar
              label={`Período ${votingAdoption.monthRef}`}
              rate={votingAdoption.rate}
              hint={`${votingAdoption.voted} de ${votingAdoption.eligible} pessoas elegíveis já votaram.`}
            />
          ) : (
            <EmptyState message="Nenhum período de votação ativo ou agendado no recorte." />
          )}
        </ChartCard>

        <ChartCard title="Feedbacks no período" subtitle="Trocas entre colegas na janela selecionada">
          <div className="grid grid-cols-2 gap-md">
            <StatCard icon="forum" label="Feedbacks" value={overview.feedbacksCount} />
            <StatCard icon="mood" label="Reações" value={overview.feedbackReactionsCount} />
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-lg lg:grid-cols-2">
        <ChartCard title="Distribuição por papel">
          <DistributionBars slices={overview.byRole} emptyMessage="Nenhuma pessoa ativa no recorte." />
        </ChartCard>
        <ChartCard title="Distribuição por squad">
          <DistributionBars slices={overview.bySquad} emptyMessage="Nenhuma pessoa ativa no recorte." />
        </ChartCard>
      </div>
    </div>
  )
}

// ----- Aba: Clima & Engajamento -----

function EngagementTab({ range, sectorId }: { range: PeopleAnalyticsRange; sectorId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'people', 'engagement', range, sectorId],
    queryFn: () => apiFetch<EngagementOverviewResponse>(`/admin/people/engagement?${buildQuery(range, sectorId)}`),
  })

  if (query.isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  if (query.isError) {
    return (
      <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
        <Icon name="error" className="text-[20px]" />
        Erro ao carregar clima e engajamento.
      </div>
    )
  }

  const { mood, muralReach, topScreens } = query.data!.engagement

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid gap-md sm:grid-cols-3">
        <StatCard
          icon="sentiment_satisfied"
          label="Humor médio"
          value={mood.average === null ? '—' : `${mood.average.toFixed(1)}/5`}
          hint={`${mood.entries} registros no período`}
        />
        <StatCard icon="how_to_reg" label="Participantes do termômetro" value={mood.participants} />
        <StatCard
          icon="visibility"
          label="Visitantes do Feed Corporativo"
          value={muralReach.uniqueViewers}
          hint="Pessoas distintas que abriram a tela"
        />
      </div>

      <ChartCard title="Tendência do clima" subtitle="Média diária na escala de 1 (triste) a 5 (ótimo)">
        <MoodTrendChart points={mood.trend} />
      </ChartCard>

      <ChartCard title="Termômetro de clima" subtitle="Distribuição das respostas de humor no período">
        <DistributionBars slices={mood.distribution} emptyMessage="Ninguém registrou o humor no período." />
      </ChartCard>

      <ChartCard
        title="Alcance do Feed Corporativo"
        subtitle={`${muralReach.postCount} comunicados publicados no período. Não há telemetria de visualização por post — o alcance por tela está acima.`}
      >
        {muralReach.posts.length === 0 ? (
          <EmptyState message="Nenhum comunicado publicado no período." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant/40 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                  <th className="py-sm pr-md font-normal">Comunicado</th>
                  <th className="py-sm pr-md font-normal">Autor</th>
                  <th className="py-sm pr-md text-right font-normal">Comentários</th>
                  <th className="py-sm pr-md text-right font-normal">Reações</th>
                  <th className="py-sm text-right font-normal">Pessoas</th>
                </tr>
              </thead>
              <tbody>
                {muralReach.posts.map((post) => (
                  <tr key={post.postId} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-sm pr-md font-body text-body-sm text-on-surface">
                      {post.excerpt}
                      <span className="ml-2 font-label text-label-sm text-on-surface-variant">
                        {dateLabel(post.createdAt)}
                      </span>
                    </td>
                    <td className="py-sm pr-md font-body text-body-sm text-on-surface-variant">{post.authorName}</td>
                    <td className="py-sm pr-md text-right font-label text-label-sm text-on-surface">{post.comments}</td>
                    <td className="py-sm pr-md text-right font-label text-label-sm text-on-surface">{post.reactions}</td>
                    <td className="py-sm text-right font-label text-label-sm text-on-surface">{post.engagedUsers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Telas mais acessadas" subtitle="Onde o time passa o tempo no período">
        {topScreens.length === 0 ? (
          <EmptyState message="Nenhum acesso registrado no período." />
        ) : (
          <DistributionBars
            slices={topScreens.map((screen) => ({
              key: screen.path,
              label: screen.label,
              count: screen.accesses,
            }))}
            emptyMessage="Nenhum acesso registrado no período."
          />
        )}
      </ChartCard>
    </div>
  )
}

// ----- Casca -----

export function PeopleAnalyticsSection() {
  const { user } = useAuth()
  const isSubadmin = isSectorAdminOnly(user)
  const [tab, setTab] = useState<TabKey>('overview')
  const [range, setRange] = useState<PeopleAnalyticsRange>('30d')
  // O SUBADMIN não escolhe setor: a API sempre usa o do token.
  const [sectorId, setSectorId] = useState('')

  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
    enabled: !isSubadmin,
  })
  const sectors = sectorsQuery.data?.sectors ?? []

  return (
    <section className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <h2 className="font-headline text-headline-lg text-on-surface">People Analytics</h2>
          <p className="mt-2 text-body-md text-on-surface-variant">
            Adoção, perfis e clima do time — tudo no mesmo recorte de período e setor.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-md">
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
          {!isSubadmin && (
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Setor
              <Select
                ariaLabel="Setor"
                value={sectorId}
                onChange={setSectorId}
                options={[
                  { value: '', label: 'Todos os setores' },
                  ...sectors.map((sector) => ({ value: sector.id, label: sector.name })),
                ]}
              />
            </label>
          )}
        </div>
      </header>

      <div role="tablist" aria-label="Seções do People Analytics" className="flex flex-wrap gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1">
        {TABS.map((item) => {
          const active = tab === item.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.key)}
              className={[
                'flex flex-1 items-center justify-center gap-xs rounded-lg px-md py-sm font-label text-label-md transition-colors',
                active
                  ? 'bg-primary/10 font-bold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              ].join(' ')}
            >
              <Icon name={item.icon} className="text-[18px]" />
              {item.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && <OverviewTab range={range} sectorId={sectorId} />}
      {/* A ficha é a listagem de pessoas que já existe — reusada, não duplicada. */}
      {tab === 'profile' && <CollaboratorsSection />}
      {tab === 'engagement' && <EngagementTab range={range} sectorId={sectorId} />}
    </section>
  )
}
