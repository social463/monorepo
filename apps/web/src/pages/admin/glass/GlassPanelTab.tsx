import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  GLASS_ALERT_LABELS,
  GLASS_SENTIMENT_LABELS,
  GLASS_SENTIMENT_UNCLASSIFIED_LABEL,
  GLASS_STATUS_LABELS,
  GLASS_TENURE_LABELS,
  GLASS_THEME_LABELS,
  type GlassBreakdownRowDTO,
  type GlassReviewListResponse,
  type GlassSentiment,
  type GlassStatus,
  type GlassTenure,
} from '@legends/shared'
import { getGlassOverview, listGlassReviews } from '../../../lib/glass-api'
import { Panel } from '../shared'

const OVERVIEW_KEY = ['admin', 'glass', 'overview']
const CRITICOS_KEY = ['admin', 'glass', 'reviews', 'criticos']

/** Nota é vírgula em pt-BR. */
function formatRating(value: number | null): string {
  return value === null ? '—' : value.toFixed(1).replace('.', ',')
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

/** Linha antiga pode não ter sentimento — dizer isso é melhor que chutar neutro. */
function sentimentLabel(sentiment: GlassSentiment | null): string {
  return sentiment === null ? GLASS_SENTIMENT_UNCLASSIFIED_LABEL : GLASS_SENTIMENT_LABELS[sentiment]
}

/** As chaves de tempo e status são técnicas; a tela mostra português. */
function labelFor(dimension: 'tenure' | 'status' | 'plain', key: string): string {
  if (dimension === 'tenure') return GLASS_TENURE_LABELS[key as GlassTenure] ?? key
  if (dimension === 'status') return GLASS_STATUS_LABELS[key as GlassStatus] ?? key
  return key
}

export function GlassPanelTab() {
  const overviewQuery = useQuery({ queryKey: OVERVIEW_KEY, queryFn: () => getGlassOverview() })
  const criticosQuery = useQuery({ queryKey: CRITICOS_KEY, queryFn: () => listGlassReviews({ withAlerts: true }) })

  if (overviewQuery.isError) {
    return <p role="alert" className="text-body-sm text-error">Não consegui carregar o painel.</p>
  }
  // Guarda em `isSuccess`, não em `isLoading`: com `networkMode: 'online'` uma
  // carga offline deixa a query PAUSADA — `isLoading` e `isError` ambos falsos,
  // `data` undefined. O non-null assertion virava tela branca.
  if (!overviewQuery.isSuccess) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>

  const overview = overviewQuery.data.overview

  if (overview.totalReviews === 0) {
    return (
      <Panel title="Painel">
        <p className="text-body-sm text-on-surface-variant">
          Nenhuma avaliação cadastrada ainda. Use a aba Ingestão para colar a primeira.
        </p>
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Acumulado">
        <div className="grid gap-md sm:grid-cols-4">
          <Indicador titulo="Avaliações" valor={String(overview.totalReviews)} />
          <Indicador titulo="Nota média" valor={formatRating(overview.averageRating)} />
          <Indicador titulo="Recomendam" valor={formatPercent(overview.recommendRate)} />
          <Indicador titulo="Aprovam a liderança" valor={formatPercent(overview.leadershipApprovalRate)} />
        </div>
      </Panel>

      {overview.alerts.length > 0 && (
        <Panel title="Alertas">
          <ul className="flex flex-col gap-sm">
            {overview.alerts.map((alerta, index) => (
              <li
                key={`${alerta.key}-${alerta.scope ?? index}`}
                className="rounded-md bg-error-container px-lg py-md text-body-sm text-on-error-container"
              >
                <strong>{GLASS_ALERT_LABELS[alerta.key]}</strong>
                {alerta.scope ? ` — ${alerta.scope}` : ''} ({alerta.count} avaliação(ões))
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Tendência mensal">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-on-surface-variant">
              <th className="py-xs">Mês</th>
              <th className="py-xs">Nota média</th>
              <th className="py-xs">Avaliações</th>
            </tr>
          </thead>
          <tbody>
            {overview.trend.map((ponto) => (
              <tr key={ponto.month} className="border-t border-outline-variant/30">
                <td className="py-xs">{ponto.month}</td>
                <td className="py-xs">{formatRating(ponto.averageRating)}</td>
                <td className="py-xs">{ponto.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="grid gap-lg sm:grid-cols-2">
        <Recorte titulo="Por setor" linhas={overview.bySector} dimension="plain" />
        <Recorte titulo="Por cargo" linhas={overview.byRole} dimension="plain" />
        <Recorte titulo="Por tempo de casa" linhas={overview.byTenure} dimension="tenure" />
        <Recorte titulo="Por status" linhas={overview.byStatus} dimension="status" />
      </div>

      <div className="grid gap-lg sm:grid-cols-2">
        <Panel title="Temas negativos mais citados">
          <Temas itens={overview.topThemesNegative} />
        </Panel>
        <Panel title="Temas positivos mais citados">
          <Temas itens={overview.topThemesPositive} />
        </Panel>
      </div>

      {/* O cabeçalho usa `total`, a contagem do filtro inteiro: `reviews.length`
          é a página, cortada no limite do servidor, e diria "(50)" com 80
          avaliações alertando. */}
      <Panel title={`Avaliações com alerta${criticosQuery.data ? ` (${criticosQuery.data.total})` : ''}`}>
        <AvaliacoesComAlerta query={criticosQuery} />
      </Panel>
    </div>
  )
}

/**
 * Painel de alerta que falha em silêncio é o pior desfecho possível: requisição
 * quebrada lida como "está tudo bem". Por isso o erro tem texto próprio, e o
 * "nenhuma" só aparece quando a resposta chegou de verdade.
 */
function AvaliacoesComAlerta({
  query,
}: {
  query: UseQueryResult<GlassReviewListResponse>
}) {
  if (query.isError) {
    return (
      <p role="alert" className="text-body-sm text-error">
        Não consegui carregar as avaliações com alerta. Recarregue a página para tentar de novo.
      </p>
    )
  }
  if (!query.isSuccess) return <p className="text-body-sm text-on-surface-variant">Carregando…</p>
  if (query.data.reviews.length === 0) {
    return <p className="text-body-sm text-on-surface-variant">Nenhuma avaliação com alerta no momento.</p>
  }

  return (
    <ul className="flex flex-col gap-md">
      {query.data.reviews.map((review) => (
        <li key={review.id} className="rounded-md bg-surface-container-high px-lg py-md">
          <p className="text-label-sm text-on-surface-variant">
            {review.reviewDate ?? 'sem data'} · {review.sector ?? 'setor não informado'} ·{' '}
            {formatRating(review.rating)} · {sentimentLabel(review.sentiment)}
          </p>
          <p className="text-body-sm text-on-surface">{review.aiSummary ?? review.negatives}</p>
          <p className="mt-xs text-label-sm text-error">
            {review.alerts.map((key) => GLASS_ALERT_LABELS[key]).join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  )
}

function Indicador({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-md bg-surface-container-high px-lg py-md">
      <p className="text-label-sm text-on-surface-variant">{titulo}</p>
      <p className="font-headline text-headline-md text-on-surface">{valor}</p>
    </div>
  )
}

function Recorte({
  titulo,
  linhas,
  dimension,
}: {
  titulo: string
  linhas: GlassBreakdownRowDTO[]
  dimension: 'tenure' | 'status' | 'plain'
}) {
  return (
    <Panel title={titulo}>
      {linhas.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Sem dado preenchido.</p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {linhas.map((linha) => (
            <li key={linha.key} className="flex justify-between text-body-sm">
              <span className="text-on-surface">{labelFor(dimension, linha.key)}</span>
              <span className="text-on-surface-variant">
                {linha.count} · {formatRating(linha.averageRating)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Temas({ itens }: { itens: { theme: string; count: number }[] }) {
  if (itens.length === 0) return <p className="text-body-sm text-on-surface-variant">Nenhum tema ainda.</p>
  return (
    <ul className="flex flex-col gap-xs">
      {itens.map((item) => (
        <li key={item.theme} className="flex justify-between text-body-sm">
          <span className="text-on-surface">{GLASS_THEME_LABELS[item.theme] ?? item.theme}</span>
          <span className="text-on-surface-variant">{item.count}</span>
        </li>
      ))}
    </ul>
  )
}
