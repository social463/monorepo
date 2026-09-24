import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LOW_REACH_ALERT_DAYS,
  WEEKDAY_LABELS,
  XP_CURRENCY_LABEL,
  type AnalyticsWindowRequest,
  type CommunicationOverviewResponse,
  type CorporatePostTagDTO,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import {
  ChartCard,
  DistributionBars,
  DonutChart,
  EmptyState,
  StatCard,
} from '../../components/analytics/AnalyticsPrimitives'
import { windowKey } from '../../components/analytics/PeriodFilter'

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/**
 * Painel de **Comunicação Interna** (Documento 3, seção 4.8).
 *
 * Substitui o bloco simples "Alcance do Feed Corporativo" que ficava na aba
 * Engajamento — é exatamente o que ele supera, e manter os dois seria a mesma
 * duplicidade que a seção 6 mandou desfazer.
 *
 * O filtro de **categoria** é a tag da seção 13; por isso ela veio primeiro.
 */
export function CommunicationPanel({
  window: effWindow,
  sectorId,
}: {
  window: AnalyticsWindowRequest
  sectorId: string
}) {
  const [tagId, setTagId] = useState('')

  const tags = useQuery({
    queryKey: ['corporate-post-tags'],
    queryFn: () => apiFetch<{ tags: CorporatePostTagDTO[] }>('/corporate-post-tags'),
    staleTime: 5 * 60 * 1000,
  })

  const query = useQuery({
    queryKey: ['admin', 'communication', windowKey(effWindow), sectorId, tagId],
    queryFn: () => {
      const params = new URLSearchParams({ range: effWindow.range })
      if (effWindow.range === 'custom' && effWindow.from && effWindow.to) {
        params.set('from', effWindow.from)
        params.set('to', effWindow.to)
      }
      if (sectorId) params.set('sectorId', sectorId)
      if (tagId) params.set('tagId', tagId)
      return apiFetch<CommunicationOverviewResponse>(`/admin/communication/overview?${params.toString()}`)
    },
  })

  if (query.isLoading) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  if (query.isError || !query.data?.communication) {
    return (
      <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
        <Icon name="error" className="text-[20px]" />
        Erro ao carregar o painel de Comunicação Interna.
      </div>
    )
  }

  const data = query.data.communication

  return (
    <section className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <h3 className="font-headline text-headline-md text-on-surface">Comunicação Interna</h3>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Quem lê os comunicados, quando e de qual área.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-md">
          {/* Período e setor vêm do cabeçalho da página, como no Clima: aba desta
              tela não tem filtro de recorte próprio. Categoria fica, porque é
              dimensão só deste painel — nenhuma outra aba fala de tag. */}
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Categoria
            <Select
              ariaLabel="Categoria de comunicado"
              value={tagId}
              onChange={setTagId}
              options={[
                { value: '', label: 'Todas as categorias' },
                ...(tags.data?.tags ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
              ]}
            />
          </label>
        </div>
      </header>

      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="visibility"
          label="Taxa média de leitura"
          value={`${data.averageReadPct}%`}
          hint={`${data.postsPublished} comunicados no período`}
        />
        <StatCard
          icon="forum"
          label="Engajamento total"
          value={data.totalEngagement}
          hint="Reações + comentários"
        />
        <StatCard
          icon="trophy"
          label="Comunicado mais lido"
          value={data.mostRead ? `${data.mostRead.readPct}%` : '—'}
          hint={data.mostRead ? data.mostRead.excerpt : 'Nada publicado no período'}
        />
        {/* Pontos, e NÃO EMR Coins: nenhuma ação do Feed credita coins hoje —
            `CoinEvent` não tem evento de mural. Um card de coins mostraria zero
            para sempre (ver a spec dos Lotes C e D). */}
        <StatCard
          icon="stars"
          label={`${XP_CURRENCY_LABEL} distribuídos`}
          value={data.pointsAwarded}
          hint="Por reações, comentários e leituras completas"
        />
      </div>

      <ChartCard title="Leituras e interações" subtitle={`De ${data.from} a ${data.to}`}>
        <CommunicationSeries points={data.series} />
      </ChartCard>

      <div className="grid gap-lg lg:grid-cols-2">
        <ChartCard
          title="Alcance por setor"
          subtitle="Percentual de cada área que leu algum comunicado do período"
        >
          <DistributionBars
            slices={data.bySector.map((s) => ({
              key: s.sectorId,
              label: `${s.sectorName} — ${s.reachPct}%`,
              count: s.readers,
            }))}
            emptyMessage="Nenhum setor com leitura no período."
            showShare={false}
          />
        </ChartCard>
        <ChartCard title="Matriz de reações" subtitle="Como o time reage aos comunicados">
          <DonutChart slices={data.reactions} emptyMessage="Nenhuma reação no período." />
        </ChartCard>
      </div>

      <ChartCard title="Top 5 comunicados" subtitle="Por leituras, reações e comentários somados">
        {data.topPosts.length === 0 ? (
          <EmptyState message="Nenhum comunicado publicado no período." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant/40 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                  <th className="py-sm pr-md font-normal">Comunicado</th>
                  <th className="py-sm pr-md text-right font-normal">Leitura</th>
                  <th className="py-sm pr-md text-right font-normal">Reações</th>
                  <th className="py-sm text-right font-normal">Comentários</th>
                </tr>
              </thead>
              <tbody>
                {data.topPosts.map((post) => (
                  <tr key={post.postId} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-sm pr-md text-body-sm text-on-surface">
                      {post.excerpt}
                      <span className="ml-2 font-label text-label-sm text-on-surface-variant">
                        {dateLabel(post.createdAt)}
                      </span>
                    </td>
                    <td className="py-sm pr-md text-right font-label text-label-sm text-on-surface">
                      {post.readPct}%
                    </td>
                    <td className="py-sm pr-md text-right font-label text-label-sm text-on-surface">
                      {post.reactions}
                    </td>
                    <td className="py-sm text-right font-label text-label-sm text-on-surface">{post.comments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <div className="grid gap-lg lg:grid-cols-2">
        <ChartCard title="Melhor horário de envio" subtitle="Onde a taxa de leitura foi mais alta">
          {data.bestSendTime ? (
            <div className="flex flex-col gap-xs">
              <p className="font-headline text-headline-md text-on-surface">
                {WEEKDAY_LABELS[data.bestSendTime.weekday]}, {String(data.bestSendTime.hour).padStart(2, '0')}h
              </p>
              <p className="text-body-sm text-on-surface-variant">
                {data.bestSendTime.readPct}% de leitura média em {data.bestSendTime.posts} comunicados.
              </p>
            </div>
          ) : (
            // Com um ou dois comunicados no mesmo horário, "melhor horário" é
            // palpite. Dizer isso é mais útil do que apontar um vencedor de ruído.
            <EmptyState message="Ainda não há comunicados suficientes num mesmo horário para recomendar." />
          )}
        </ChartCard>

        <ChartCard
          title="Alerta de baixo alcance"
          subtitle={`Setores sem interagir há mais de ${LOW_REACH_ALERT_DAYS} dias`}
        >
          {data.lowReachSectors.length === 0 ? (
            <EmptyState message="Nenhum setor em alerta — todos interagiram recentemente." />
          ) : (
            <ul className="flex flex-col gap-sm">
              {data.lowReachSectors.map((sector) => (
                <li
                  key={sector.sectorId}
                  className="flex items-center justify-between gap-md rounded-lg border border-error/30 bg-error-container/10 px-md py-sm"
                >
                  <span className="text-body-sm text-on-surface">{sector.sectorName}</span>
                  <span className="font-label text-label-sm text-error">
                    {sector.daysSince === null ? 'nunca interagiu' : `há ${sector.daysSince} dias`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </section>
  )
}

/** Duas séries no mesmo eixo: leituras e interações por dia. */
function CommunicationSeries({ points }: { points: { day: string; reads: number; interactions: number }[] }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.reads, p.interactions]))
  const total = points.reduce((sum, p) => sum + p.reads + p.interactions, 0)
  if (total === 0) return <EmptyState message="Nenhuma leitura ou interação no período." />

  const W = 720
  const H = 180
  const step = points.length > 1 ? W / (points.length - 1) : 0
  const line = (key: 'reads' | 'interactions') =>
    points.map((p, i) => `${(i * step).toFixed(1)},${(H - (p[key] / max) * H).toFixed(1)}`).join(' ')

  return (
    <figure className="flex flex-col gap-xs">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-44 w-full" role="img" aria-label="Leituras e interações por dia">
        <polyline points={line('reads')} fill="none" stroke="#25de88" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <polyline
          points={line('interactions')}
          fill="none"
          stroke="#7cc6ff"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex flex-wrap justify-between gap-sm font-label text-label-sm text-on-surface-variant">
        <span>{points[0]?.day}</span>
        <span className="flex gap-md">
          <span className="flex items-center gap-xs">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: '#25de88' }} />
            Leituras
          </span>
          <span className="flex items-center gap-xs">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: '#7cc6ff' }} />
            Interações
          </span>
        </span>
        <span>{points[points.length - 1]?.day}</span>
      </div>
    </figure>
  )
}
