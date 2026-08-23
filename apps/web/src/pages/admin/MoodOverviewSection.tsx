import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  MoodCommentDTO,
  MoodLevel,
  MoodOverviewDTO,
  MoodOverviewResponse,
  MoodReasonSliceDTO,
  MoodTrendPointDTO,
  SectorDTO,
} from '@legends/shared'
import {
  MOOD_ANONYMITY_MIN,
  MOOD_OPTIONS,
  MOOD_REASON_LABELS,
  MOOD_REASON_UNSET_LABEL,
  MOOD_SCORES,
  isSectorAdminOnly,} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Panel } from './shared'

/**
 * Escala divergente da carinha: vermelho (pior) → laranja → cinza neutro →
 * verde (melhor). Não é paleta categórica — a ordem carrega significado, por
 * isso o cinza fica no meio. Toda marca colorida vem acompanhada de emoji e
 * rótulo, então a identidade nunca depende só da cor.
 */
const MOOD_COLORS: Record<MoodLevel, string> = {
  HARD: '#ff6b5e',
  LOW: '#ffb36d',
  NEUTRAL: '#859587',
  GOOD: '#25de88',
  GREAT: '#52fba2',
}

// Mesma cor do token `tertiary-container`. O ranking de motivos é uma lista
// ordenada, não categórica: uma cor só, a identidade vem do rótulo.
const REASON_BAR_COLOR = '#ffb36d'

const WINDOW_OPTIONS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
]

const SUPPRESSED_TEXT = `Poucas respostas para exibir (mínimo de ${MOOD_ANONYMITY_MIN}).`

const MOOD_BY_LEVEL = new Map(MOOD_OPTIONS.map((option) => [option.value, option]))

/** Rótulo da carinha mais próxima de uma média (ex.: 3.7 → "Bem"). */
function nearestMoodOption(average: number) {
  const rounded = Math.min(5, Math.max(1, Math.round(average)))
  return MOOD_OPTIONS.find((option) => MOOD_SCORES[option.value] === rounded) ?? null
}

function shortDate(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
}

function relativeDay(daysAgo: number): string {
  if (daysAgo <= 0) return 'hoje'
  if (daysAgo === 1) return 'ontem'
  return `há ${daysAgo} dias`
}

// ----- Cartões de indicador -----

function MetricCard({ icon, label, value, hint }: { icon: string; label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-xs rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <p className="flex items-center gap-xs font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
        <Icon name={icon} className="text-[18px]" />
        {label}
      </p>
      <p className="font-headline text-headline-lg text-on-surface">{value}</p>
      <p className="text-body-sm text-on-surface-variant">{hint}</p>
    </div>
  )
}

// ----- Série de tendência -----

const CHART_W = 720
const CHART_H = 240
const PAD = { left: 26, right: 12, top: 12, bottom: 26 }
const PLOT_W = CHART_W - PAD.left - PAD.right
const PLOT_H = CHART_H - PAD.top - PAD.bottom
const Y_TICKS = [1, 2, 3, 4, 5]

function TrendChart({ trend }: { trend: MoodTrendPointDTO[] }) {
  const [hovered, setHovered] = useState<number | null>(null)

  const xOf = (index: number) => PAD.left + (trend.length > 1 ? (index / (trend.length - 1)) * PLOT_W : PLOT_W / 2)
  const yOf = (value: number) => PAD.top + ((5 - value) / 4) * PLOT_H
  const baseline = yOf(1)

  // A linha é interrompida em dia sem registro e em dia suprimido pelo piso —
  // ligar os pontos por cima inventaria uma tendência que o dado não tem.
  const segments = useMemo(() => {
    const result: { index: number; x: number; y: number }[][] = []
    let current: { index: number; x: number; y: number }[] = []
    trend.forEach((point, index) => {
      if (point.average === null) {
        if (current.length > 0) result.push(current)
        current = []
        return
      }
      current.push({ index, x: xOf(index), y: yOf(point.average) })
    })
    if (current.length > 0) result.push(current)
    return result
  }, [trend])

  const labelEvery = Math.max(1, Math.ceil(trend.length / 6))
  const hoveredPoint = hovered !== null ? trend[hovered] : null

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Tendência do humor médio ao longo de ${trend.length} dias, numa escala de 1 a 5.`}
      >
        <defs>
          <linearGradient id="mood-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MOOD_COLORS.GREAT} stopOpacity="0.28" />
            <stop offset="100%" stopColor={MOOD_COLORS.GREAT} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {Y_TICKS.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={yOf(tick)}
              y2={yOf(tick)}
              stroke="currentColor"
              strokeWidth="1"
              className="text-outline-variant/30"
            />
            <text
              x={PAD.left - 8}
              y={yOf(tick) + 4}
              textAnchor="end"
              className="fill-on-surface-variant text-[11px]"
            >
              {tick}
            </text>
          </g>
        ))}

        {segments.map((segment) => {
          const line = segment.map((p) => `${p.x},${p.y}`).join(' ')
          const area = `M ${segment[0].x},${baseline} L ${line.split(' ').join(' L ')} L ${segment[segment.length - 1].x},${baseline} Z`
          return (
            <g key={`seg-${segment[0].index}`}>
              <path d={area} fill="url(#mood-trend-fill)" />
              <polyline points={line} fill="none" stroke={MOOD_COLORS.GREAT} strokeWidth="2" strokeLinejoin="round" />
              {segment.map((p) => (
                <circle
                  key={p.index}
                  cx={p.x}
                  cy={p.y}
                  r={hovered === p.index ? 5 : 3}
                  fill={MOOD_COLORS.GREAT}
                  stroke="#182028"
                  strokeWidth="2"
                />
              ))}
            </g>
          )
        })}

        {trend.map((point, index) =>
          index % labelEvery === 0 ? (
            <text
              key={`x-${point.day}`}
              x={xOf(index)}
              y={CHART_H - 6}
              textAnchor="middle"
              className="fill-on-surface-variant text-[11px]"
            >
              {shortDate(point.day)}
            </text>
          ) : null,
        )}

        {hovered !== null && (
          <line
            x1={xOf(hovered)}
            x2={xOf(hovered)}
            y1={PAD.top}
            y2={baseline}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 3"
            className="text-outline"
          />
        )}

        {/* Alvos de hover: uma faixa por dia, bem maior que o ponto desenhado. */}
        {trend.map((point, index) => (
          <rect
            key={`hit-${point.day}`}
            x={xOf(index) - PLOT_W / Math.max(trend.length, 1) / 2}
            y={PAD.top}
            width={PLOT_W / Math.max(trend.length, 1)}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>
              {point.average !== null
                ? `${shortDate(point.day)}: média ${point.average.toFixed(2)} (${point.count} registros)`
                : point.suppressed
                  ? `${shortDate(point.day)}: ${SUPPRESSED_TEXT}`
                  : `${shortDate(point.day)}: sem registros`}
            </title>
          </rect>
        ))}
      </svg>

      {hoveredPoint && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-outline-variant/40 bg-surface-container-highest px-sm py-xs font-label text-label-sm text-on-surface shadow-lg"
          style={{ left: `${(xOf(hovered as number) / CHART_W) * 100}%`, top: 0 }}
        >
          <span className="text-on-surface-variant">{shortDate(hoveredPoint.day)}</span>{' '}
          {hoveredPoint.average !== null ? (
            <>
              <span className="font-bold">{hoveredPoint.average.toFixed(2)}</span>
              <span className="text-on-surface-variant"> · {hoveredPoint.count} registros</span>
            </>
          ) : hoveredPoint.suppressed ? (
            <span className="text-on-surface-variant">poucas respostas</span>
          ) : (
            <span className="text-on-surface-variant">sem registros</span>
          )}
        </div>
      )}
    </div>
  )
}

// ----- Listas de barras (distribuição e motivos) -----

/**
 * Linha de barra rotulada: rótulo e números em cima, barra de largura cheia
 * embaixo. Duas linhas por item em vez de uma — a barra ganha a largura toda
 * (comparação mais honesta) e a lista ocupa a altura do card, que divide a
 * linha do grid com o gráfico de tendência, bem mais alto.
 */
function BarRow({
  label,
  percent,
  count,
  color,
  ratio,
}: {
  label: ReactNode
  percent: number
  count: number
  color: string
  ratio: number
}) {
  return (
    <li>
      <div className="mb-xs flex items-baseline justify-between gap-sm">
        <span className="truncate font-label text-label-md text-on-surface">{label}</span>
        <span className="shrink-0 font-label text-label-sm text-on-surface-variant">
          {percent}% · {count}
        </span>
      </div>
      <span className="block h-3 overflow-hidden rounded-full bg-surface-container-highest">
        <span className="block h-full rounded-full" style={{ width: `${ratio * 100}%`, background: color }} />
      </span>
    </li>
  )
}

function CountLine({ children }: { children: ReactNode }) {
  return <p className="mb-md font-label text-label-sm text-on-surface-variant">{children}</p>
}

// ----- Distribuição de hoje -----

function TodayDistribution({ overview }: { overview: MoodOverviewDTO }) {
  const total = overview.todayDistribution.reduce((sum, slice) => sum + slice.count, 0)
  if (total === 0) {
    return <p className="py-lg text-center text-body-sm text-on-surface-variant">{SUPPRESSED_TEXT}</p>
  }
  const max = Math.max(...overview.todayDistribution.map((slice) => slice.count), 1)
  // Mesma ordem da escala que a pessoa vê ao registrar (pior → melhor), para as
  // duas telas lerem igual.
  const byMood = new Map(overview.todayDistribution.map((slice) => [slice.mood, slice]))
  const slices = MOOD_OPTIONS.map((option) => byMood.get(option.value)).filter(
    (slice): slice is NonNullable<typeof slice> => slice !== undefined,
  )

  return (
    <div>
      <CountLine>
        {total} {total === 1 ? 'registro' : 'registros'} hoje
      </CountLine>
      <ul className="flex flex-col gap-md">
        {slices.map((slice) => {
          const option = MOOD_BY_LEVEL.get(slice.mood)
          return (
            <BarRow
              key={slice.mood}
              label={
                <>
                  <span aria-hidden>{option?.emoji} </span>
                  {option?.label}
                </>
              }
              percent={slice.percent}
              count={slice.count}
              color={MOOD_COLORS[slice.mood]}
              ratio={slice.count / max}
            />
          )
        })}
      </ul>
    </div>
  )
}

// ----- Ranking de motivos -----

function ReasonRanking({ reasons }: { reasons: MoodReasonSliceDTO[] }) {
  if (reasons.length === 0) {
    return (
      <p className="py-lg text-center text-body-sm text-on-surface-variant">
        Nenhum motivo de mal-estar reportado no período (ou respostas insuficientes para exibir).
      </p>
    )
  }
  const max = Math.max(...reasons.map((slice) => slice.count), 1)
  const total = reasons.reduce((sum, slice) => sum + slice.count, 0)

  return (
    <div>
      <CountLine>
        {total} {total === 1 ? 'registro negativo' : 'registros negativos'} no período
      </CountLine>
      <ul className="flex flex-col gap-md">
        {reasons.map((slice) => (
          <BarRow
            key={slice.reason ?? '__nao-informado__'}
            label={slice.reason ? MOOD_REASON_LABELS[slice.reason] : MOOD_REASON_UNSET_LABEL}
            percent={slice.percent}
            count={slice.count}
            color={REASON_BAR_COLOR}
            ratio={slice.count / max}
          />
        ))}
      </ul>
    </div>
  )
}

// ----- Comentários anônimos -----

function CommentList({ comments }: { comments: MoodCommentDTO[] }) {
  if (comments.length === 0) {
    return (
      <p className="py-lg text-center text-body-sm text-on-surface-variant">
        Sem comentários no período. Quando alguém deixar um relato, ele aparece aqui — sempre sem autor.
      </p>
    )
  }

  return (
    <ul className="flex max-h-[420px] flex-col gap-sm overflow-y-auto pr-1">
      {comments.map((comment) => {
        const option = MOOD_BY_LEVEL.get(comment.mood)
        return (
          <li key={comment.id} className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <div className="flex flex-wrap items-center justify-between gap-xs">
              <span
                className="inline-flex items-center gap-xs rounded-full px-sm py-[2px] font-label text-label-sm text-[#0c141b]"
                style={{ background: MOOD_COLORS[comment.mood] }}
              >
                <span aria-hidden>{option?.emoji}</span>
                {option?.label}
              </span>
              <span className="font-label text-label-sm text-on-surface-variant">{relativeDay(comment.daysAgo)}</span>
            </div>
            {comment.reason && (
              <p className="mt-sm font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                Motivo: <span className="normal-case text-on-surface">{MOOD_REASON_LABELS[comment.reason]}</span>
              </p>
            )}
            <p className="mt-xs whitespace-pre-wrap text-body-sm text-on-surface">{comment.note}</p>
          </li>
        )
      })}
    </ul>
  )
}

// ----- Página -----

export function MoodOverviewSection() {
  const { user } = useAuth()
  const isSubadmin = isSectorAdminOnly(user)
  const [days, setDays] = useState('30')
  const [sectorId, setSectorId] = useState('')

  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
    enabled: !isSubadmin,
  })

  const query = useQuery({
    queryKey: ['admin', 'mood-overview', days, sectorId],
    queryFn: () => {
      const params = new URLSearchParams({ days })
      if (sectorId) params.set('sectorId', sectorId)
      return apiFetch<MoodOverviewResponse>(`/admin/mood/overview?${params.toString()}`)
    },
  })

  const overview = query.data?.overview ?? null
  const sectorOptions = [
    { value: '', label: 'Todos os setores' },
    ...(sectorsQuery.data?.sectors ?? []).map((sector) => ({ value: sector.id, label: sector.name })),
  ]

  const weekMood = overview?.weekAverage !== null && overview ? nearestMoodOption(overview.weekAverage) : null

  return (
    <section className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Termômetro de humor</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Visão agregada do clima. Nenhum registro é identificável: recortes com menos de {MOOD_ANONYMITY_MIN}{' '}
          respostas não são exibidos, e comentários aparecem sem autor.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-md">
        <div className="w-48">
          <Select options={WINDOW_OPTIONS} value={days} onChange={setDays} ariaLabel="Janela do período" />
        </div>
        {!isSubadmin && (
          <div className="w-64">
            <Select options={sectorOptions} value={sectorId} onChange={setSectorId} ariaLabel="Filtrar por setor" />
          </div>
        )}
      </div>

      {query.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {query.isError && (
        <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          Erro ao carregar o termômetro de humor.
        </div>
      )}

      {overview && !query.isError && (
        <>
          <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              icon="mood"
              label="Humor médio (7 dias)"
              value={overview.weekAverage !== null ? overview.weekAverage.toFixed(2) : '—'}
              hint={weekMood ? `${weekMood.emoji} ${weekMood.label}` : SUPPRESSED_TEXT}
            />
            <MetricCard
              icon="group"
              label="Participação de hoje"
              value={overview.participationToday ? `${overview.participationToday.percent}%` : '—'}
              hint={
                overview.participationToday
                  ? `${overview.participationToday.responded} de ${overview.participationToday.total} pessoas registraram`
                  : SUPPRESSED_TEXT
              }
            />
            <MetricCard
              icon="trending_up"
              label="Registros no período"
              value={String(overview.totalEntries)}
              hint={`Últimos ${overview.days} dias`}
            />
          </div>

          <div className="grid gap-lg lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel title="Tendência do clima">
                {overview.totalEntries === 0 ? (
                  <p className="py-lg text-center text-body-sm text-on-surface-variant">{SUPPRESSED_TEXT}</p>
                ) : (
                  <TrendChart trend={overview.trend} />
                )}
              </Panel>
            </div>
            <Panel title="Distribuição de hoje">
              <TodayDistribution overview={overview} />
            </Panel>
          </div>

          <div className="grid gap-lg lg:grid-cols-5">
            <div className="lg:col-span-2">
              <Panel title="Motivos declarados">
                <ReasonRanking reasons={overview.reasons} />
              </Panel>
            </div>
            <div className="lg:col-span-3">
              <Panel title="Comentários anônimos">
                <CommentList comments={overview.comments} />
              </Panel>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
