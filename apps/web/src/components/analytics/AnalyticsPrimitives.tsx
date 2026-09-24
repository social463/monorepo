import { useId, type ReactNode } from 'react'
import type {
  AccessHeatmapCellDTO,
  AccessSeriesPointDTO,
  DistributionSliceDTO,
  EngagementMoodTrendPointDTO,
  EngagementSeriesPointDTO,
} from '@legends/shared'
import { WEEKDAY_LABELS } from '@legends/shared'
import { Icon } from '../Icon'

/**
 * Primitivas de visualização do People Analytics.
 *
 * São SVG à mão de propósito (ver
 * `docs/superpowers/specs/2026-07-31-people-analytics-design.md`): o conjunto
 * de formas é pequeno, e uma lib de chart traria ~500 KB e um tema paralelo ao
 * design system para uma única tela de admin.
 */

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string | number
  hint?: string
  icon: string
}) {
  return (
    // `group` + aria-label mantêm rótulo, número e dica lidos como um bloco só.
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-xs rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
    >
      <span className="flex items-center gap-xs font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
        <Icon name={icon} className="text-[16px]" />
        {label}
      </span>
      <span className="font-headline text-headline-lg text-on-surface">{value}</span>
      {hint && <span className="font-body text-body-sm text-on-surface-variant">{hint}</span>}
    </div>
  )
}

export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <header>
        <h3 className="font-headline text-headline-md text-on-surface">{title}</h3>
        {subtitle && <p className="mt-1 font-body text-body-sm text-on-surface-variant">{subtitle}</p>}
      </header>
      {children}
    </section>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-sm rounded-lg border border-dashed border-outline-variant/50 p-lg font-body text-body-sm text-on-surface-variant">
      <Icon name="inbox" className="text-[18px]" />
      {message}
    </p>
  )
}

const CHART_WIDTH = 720
const CHART_HEIGHT = 180

function formatDayLabel(ymd: string): string {
  const [, month, day] = ymd.split('-')
  return `${day}/${month}`
}

/**
 * Série diária de acessos como área + linha. O `viewBox` faz o escalonamento
 * (o SVG é 100% de largura), então não há medição de layout — o que também
 * mantém o componente testável em jsdom.
 */
export function AccessSeriesChart({ points }: { points: AccessSeriesPointDTO[] }) {
  const gradientId = useId()
  const max = Math.max(1, ...points.map((point) => point.accesses))
  const total = points.reduce((sum, point) => sum + point.accesses, 0)

  if (points.length === 0 || total === 0) {
    return <EmptyState message="Nenhum acesso registrado no período." />
  }

  const stepX = points.length > 1 ? CHART_WIDTH / (points.length - 1) : 0
  const coords = points.map((point, index) => ({
    x: index * stepX,
    y: CHART_HEIGHT - (point.accesses / max) * CHART_HEIGHT,
    point,
  }))
  const line = coords.map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(' ')
  const area = `0,${CHART_HEIGHT} ${line} ${CHART_WIDTH},${CHART_HEIGHT}`

  return (
    <figure className="flex flex-col gap-xs">
      <figcaption className="sr-only">
        Acessos por dia, de {formatDayLabel(points[0].day)} a {formatDayLabel(points[points.length - 1].day)}. Pico de{' '}
        {max} acessos.
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        role="img"
        aria-label={`Série de acessos por dia. Total de ${total} acessos no período.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="text-primary">
          <polygon points={area} fill={`url(#${gradientId})`} />
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        {coords.map((coord) => (
          <title key={coord.point.day}>{`${formatDayLabel(coord.point.day)}: ${coord.point.accesses} acessos`}</title>
        ))}
      </svg>
      <div className="flex justify-between font-label text-label-sm text-on-surface-variant">
        <span>{formatDayLabel(points[0].day)}</span>
        <span>pico: {max}/dia</span>
        <span>{formatDayLabel(points[points.length - 1].day)}</span>
      </div>
    </figure>
  )
}

/**
 * Três séries diárias no mesmo eixo — feedbacks, reações e comentários —, o
 * gráfico de engajamento da aba Dashboard (seção 3 do Documento 3).
 *
 * Paleta categórica: cada série é uma coisa distinta, não um grau da mesma. A
 * legenda repete o nome ao lado do quadradinho porque a cor sozinha não pode
 * carregar a identidade da série.
 */
const ENGAGEMENT_SERIES = [
  { key: 'feedbacks' as const, label: 'Feedbacks', color: '#25de88' },
  { key: 'reactions' as const, label: 'Reações', color: '#7cc6ff' },
  { key: 'comments' as const, label: 'Comentários', color: '#ffb36d' },
]

export function EngagementSeriesChart({ points }: { points: EngagementSeriesPointDTO[] }) {
  const max = Math.max(
    1,
    ...points.flatMap((point) => [point.feedbacks, point.reactions, point.comments]),
  )
  const total = points.reduce(
    (sum, point) => sum + point.feedbacks + point.reactions + point.comments,
    0,
  )

  if (points.length === 0 || total === 0) {
    return <EmptyState message="Nenhuma interação registrada no período." />
  }

  const stepX = points.length > 1 ? CHART_WIDTH / (points.length - 1) : 0
  const lineFor = (key: (typeof ENGAGEMENT_SERIES)[number]['key']) =>
    points
      .map((point, index) => {
        const y = CHART_HEIGHT - (point[key] / max) * CHART_HEIGHT
        return `${(index * stepX).toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

  return (
    <figure className="flex flex-col gap-xs">
      <figcaption className="sr-only">
        Feedbacks, reações e comentários por dia, de {formatDayLabel(points[0].day)} a{' '}
        {formatDayLabel(points[points.length - 1].day)}.
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        role="img"
        aria-label={`Engajamento por dia. ${total} interações no período.`}
      >
        {ENGAGEMENT_SERIES.map((serie) => (
          <polyline
            key={serie.key}
            points={lineFor(serie.key)}
            fill="none"
            stroke={serie.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-sm font-label text-label-sm text-on-surface-variant">
        <span>{formatDayLabel(points[0].day)}</span>
        <span className="flex flex-wrap gap-md">
          {ENGAGEMENT_SERIES.map((serie) => (
            <span key={serie.key} className="flex items-center gap-xs">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: serie.color }}
              />
              {serie.label}
            </span>
          ))}
        </span>
        <span>{formatDayLabel(points[points.length - 1].day)}</span>
      </div>
    </figure>
  )
}

/**
 * Distribuição em barras horizontais proporcionais ao maior valor.
 *
 * `showShare` desliga o percentual do total, que só faz sentido quando as
 * fatias *particionam* algo (respostas de humor, acessos). Em ranking de
 * pontuação por pessoa ele leria como "fatia do bolo de XP do time", que não é
 * a pergunta.
 */
export function DistributionBars({
  slices,
  emptyMessage,
  showShare = true,
}: {
  slices: DistributionSliceDTO[]
  emptyMessage: string
  showShare?: boolean
}) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)
  if (total === 0) return <EmptyState message={emptyMessage} />
  const max = Math.max(...slices.map((slice) => slice.count))

  return (
    <ul className="flex flex-col gap-sm">
      {slices.map((slice) => (
        <li key={slice.key} className="flex items-center gap-md">
          <span className="w-32 shrink-0 truncate font-label text-label-sm text-on-surface-variant" title={slice.label}>
            {slice.label}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${max > 0 ? (slice.count / max) * 100 : 0}%` }}
            />
          </span>
          <span className="w-20 shrink-0 text-right font-label text-label-sm text-on-surface">
            {slice.count}
            {showShare && (
              <span className="ml-1 text-on-surface-variant">({Math.round((slice.count / total) * 100)}%)</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Tendência do clima: linha da média diária na escala 1–5.
 *
 * Dias sem registro (`average === null`) **quebram** a linha em vez de virar
 * zero — zero não existe na escala e leria como "time no fundo do poço". Cada
 * trecho contínuo vira uma `polyline` própria.
 */
export function MoodTrendChart({ points }: { points: EngagementMoodTrendPointDTO[] }) {
  const withData = points.filter((point) => point.average !== null)
  if (withData.length === 0) {
    return <EmptyState message="Ninguém registrou o humor no período." />
  }

  const stepX = points.length > 1 ? CHART_WIDTH / (points.length - 1) : 0
  // Escala fixa 1–5: o eixo é a própria escala de humor, não o intervalo dos
  // dados. Sem isso uma variação de 3.9→4.1 pareceria um desabamento.
  const toY = (average: number) => CHART_HEIGHT - ((average - 1) / 4) * CHART_HEIGHT

  const segments: string[][] = []
  let current: string[] = []
  points.forEach((point, index) => {
    if (point.average === null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push(`${(index * stepX).toFixed(1)},${toY(point.average).toFixed(1)}`)
  })
  if (current.length > 0) segments.push(current)

  const media = withData.reduce((sum, point) => sum + (point.average ?? 0), 0) / withData.length

  return (
    <figure className="flex flex-col gap-xs">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        role="img"
        aria-label={`Tendência do clima. Média de ${media.toFixed(1)} em ${withData.length} dias com registro.`}
      >
        {/* Linha do neutro (3) como referência visual. */}
        <line
          x1="0"
          y1={toY(3)}
          x2={CHART_WIDTH}
          y2={toY(3)}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 4"
          className="text-outline-variant"
          vectorEffect="non-scaling-stroke"
        />
        <g className="text-primary">
          {segments.map((segment) => (
            <polyline
              key={segment[0]}
              points={segment.join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
      <div className="flex justify-between font-label text-label-sm text-on-surface-variant">
        <span>{formatDayLabel(points[0].day)}</span>
        <span>média {media.toFixed(1)}/5 · linha tracejada = neutro</span>
        <span>{formatDayLabel(points[points.length - 1].day)}</span>
      </div>
    </figure>
  )
}

const HEATMAP_HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/**
 * Mapa de calor dia da semana × hora. A API manda só as células com acesso;
 * aqui a grade 7×24 é preenchida — inclusive madrugada, que fica visível em
 * vez de ser recortada (um acesso às 3h é justamente o que interessa ver).
 */
/**
 * Rosca de distribuição — a "matriz de reações" da seção 4.8 do Documento 3.
 *
 * Paleta categórica de seis, na ordem em que as fatias chegam (já ordenadas por
 * volume no servidor). O rótulo vai na legenda ao lado, com contagem e
 * percentual: cor sozinha não identifica fatia, e texto dentro de uma rosca de
 * 1% não cabe.
 */
const DONUT_COLORS = ['#25de88', '#7cc6ff', '#ffb36d', '#c89bff', '#ff8fa3', '#6ee7d7', '#859587']

export function DonutChart({
  slices,
  emptyMessage,
}: {
  slices: { key: string; label: string; count: number }[]
  emptyMessage: string
}) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)
  if (total === 0) return <EmptyState message={emptyMessage} />

  // SVG de círculo único com `stroke-dasharray`: cada fatia é um arco do mesmo
  // traço, deslocado pelo offset acumulado. Sem `path` com trigonometria e sem
  // biblioteca — a rosca é o único gráfico circular do produto.
  const RAIO = 60
  const CIRC = 2 * Math.PI * RAIO
  let offset = 0

  return (
    <div className="flex flex-wrap items-center gap-lg">
      <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0" role="img" aria-label={`Distribuição de ${total} reações`}>
        <g transform="rotate(-90 80 80)">
          {slices.map((slice, index) => {
            const fatia = (slice.count / total) * CIRC
            const dash = `${fatia} ${CIRC - fatia}`
            const el = (
              <circle
                key={slice.key}
                cx="80"
                cy="80"
                r={RAIO}
                fill="none"
                stroke={DONUT_COLORS[index % DONUT_COLORS.length]}
                strokeWidth="28"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            )
            offset += fatia
            return el
          })}
        </g>
      </svg>

      <ul className="flex min-w-0 flex-1 flex-col gap-xs">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-sm text-body-sm text-on-surface-variant">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-on-surface">{slice.label}</span>
            <span className="shrink-0 tabular-nums">
              {slice.count} · {Math.round((slice.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AccessHeatmap({ cells }: { cells: AccessHeatmapCellDTO[] }) {
  if (cells.length === 0) {
    return <EmptyState message="Nenhum acesso registrado no período." />
  }
  const byKey = new Map(cells.map((cell) => [`${cell.weekday}-${cell.hour}`, cell.accesses]))
  const max = Math.max(...cells.map((cell) => cell.accesses))

  return (
    // O `overflow-x-auto` fica num wrapper que envolve SÓ a tabela: quando
    // `overflow-x` deixa de ser `visible`, o CSS promove `overflow-y` a `auto`
    // junto — com a legenda dentro, a margem dela estourava alguns pixels e
    // aparecia uma barra de rolagem vertical no card inteiro.
    <div className="flex flex-col gap-sm">
      <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] font-label text-label-sm">
        <thead>
          <tr>
            <th className="sr-only">Dia da semana</th>
            {HEATMAP_HOURS.map((hour) => (
              <th key={hour} className="w-5 pb-1 text-center font-normal text-on-surface-variant">
                {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAY_LABELS.map((label, weekday) => (
            <tr key={label}>
              <th scope="row" className="pr-2 text-right font-normal text-on-surface-variant">
                {label}
              </th>
              {HEATMAP_HOURS.map((hour) => {
                const accesses = byKey.get(`${weekday}-${hour}`) ?? 0
                return (
                  <td key={hour} className="p-0">
                    <div
                      title={`${label} ${String(hour).padStart(2, '0')}h — ${accesses} acesso(s)`}
                      className="h-5 w-5 rounded-sm bg-primary"
                      // Opacidade proporcional ao pico; célula vazia fica num
                      // fantasma visível para a grade não ter buracos.
                      style={{ opacity: accesses === 0 ? 0.06 : 0.2 + (accesses / max) * 0.8 }}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="flex items-center justify-end gap-xs font-label text-label-sm text-on-surface-variant">
        <span>menos</span>
        {[0.2, 0.4, 0.6, 0.8, 1].map((opacity) => (
          <span key={opacity} className="h-3 w-3 rounded-sm bg-primary" style={{ opacity }} />
        ))}
        <span>mais (pico: {max})</span>
      </div>
    </div>
  )
}

/** Barra de progresso rotulada, para taxas (adesão, votação). */
export function RateBar({ label, rate, hint }: { label: string; rate: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-baseline justify-between gap-sm">
        <span className="font-label text-label-md text-on-surface">{label}</span>
        <span className="font-headline text-headline-md text-primary">{rate}%</span>
      </div>
      <span className="h-2 overflow-hidden rounded-full bg-surface-container-highest">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
      </span>
      {hint && <span className="font-body text-body-sm text-on-surface-variant">{hint}</span>}
    </div>
  )
}
