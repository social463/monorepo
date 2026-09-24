import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  MoodCommentDTO,
  MoodLevel,
  MoodOverviewDTO,
  MoodOverviewResponse,
  MoodReasonSliceDTO,
  MoodTrendPointDTO,
} from '@legends/shared'
import type { AnalyticsWindowRequest } from '@legends/shared'
import {
  MOOD_ANONYMITY_MIN,
  MOOD_OPTIONS,
  MOOD_OVERVIEW_MIN_DAYS,
  MOOD_REASON_LABELS,
  MOOD_REASON_UNSET_LABEL,
  MOOD_SCORES,
  PEOPLE_ANALYTICS_RANGE_DAYS,
} from '@legends/shared'
import { Link } from 'react-router-dom'
import { ApiError, apiFetch } from '../../lib/api'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { windowKey } from '../../components/analytics/PeriodFilter'
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

// ----- Comentários -----

/**
 * Os comentários do termômetro, **com autor** (Documento 3, seção 4.6). Serve
 * as duas caixas: "Causas de alerta" (só humor negativo) e "Comentários" (a
 * escala inteira); a diferença é só a lista que chega.
 */
function CommentList({ comments, emptyMessage }: { comments: MoodCommentDTO[]; emptyMessage: string }) {
  if (comments.length === 0) {
    return <p className="py-lg text-center text-body-sm text-on-surface-variant">{emptyMessage}</p>
  }

  return (
    <ul className="flex max-h-[420px] flex-col gap-sm overflow-y-auto pr-1">
      {comments.map((comment) => {
        const option = MOOD_BY_LEVEL.get(comment.mood)
        return (
          <li key={comment.id} className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <div className="flex flex-wrap items-center justify-between gap-xs">
              <span className="flex min-w-0 items-center gap-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest">
                  <Avatar user={comment.author} />
                </span>
                <span className="min-w-0">
                  <Link
                    to={`/perfil/${comment.author.id}`}
                    className="block truncate font-label text-label-md text-on-surface hover:text-primary hover:underline"
                  >
                    {comment.author.name}
                  </Link>
                  {comment.author.sectorName && (
                    <span className="block truncate text-label-sm text-on-surface-variant">
                      {comment.author.sectorName}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-sm">
                <span
                  className="inline-flex items-center gap-xs rounded-full px-sm py-[2px] font-label text-label-sm text-[#0c141b]"
                  style={{ background: MOOD_COLORS[comment.mood] }}
                >
                  <span aria-hidden>{option?.emoji}</span>
                  {option?.label}
                </span>
                <span className="font-label text-label-sm text-on-surface-variant">
                  {relativeDay(comment.daysAgo)}
                </span>
              </span>
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

/**
 * Quantos dias o recorte cobre, hoje incluso — a mesma conta que o `moodQuery`
 * faz para montar a query, isolada porque a tela também precisa saber se a
 * janela cabe no piso da API (`MOOD_OVERVIEW_MIN_DAYS`) ANTES de consultar.
 *
 * Cobre os três casos que caem abaixo do piso: o atalho "Hoje" (1 dia), um
 * período personalizado curto e "Este ano" nos primeiros dias de janeiro.
 */
function moodWindowDays(window: AnalyticsWindowRequest): number {
  if (window.range === 'custom' && window.from && window.to) {
    const from = new Date(`${window.from}T00:00:00.000Z`).getTime()
    const to = new Date(`${window.to}T00:00:00.000Z`).getTime()
    return Math.floor((to - from) / 86_400_000) + 1
  }
  if (window.range === 'ano') {
    const hoje = new Date()
    return Math.floor((hoje.getTime() - new Date(hoje.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1
  }
  return PEOPLE_ANALYTICS_RANGE_DAYS[window.range as keyof typeof PEOPLE_ANALYTICS_RANGE_DAYS] ?? 0
}

/**
 * A query do termômetro. A API dele fala em `days` (e agora `from`/`to`), não em
 * `range` — daí não dar para reusar o `windowQuery` do People Analytics: o
 * atalho vira número de dias aqui, do lado do cliente.
 */
function moodQuery(window: AnalyticsWindowRequest, sectorId: string): string {
  const params = new URLSearchParams()
  if (window.range === 'custom' && window.from && window.to) {
    params.set('from', window.from)
    params.set('to', window.to)
  } else if (window.range === 'ano') {
    // "Este ano" não tem número fixo de dias; mandamos as pontas explícitas.
    const hoje = new Date()
    params.set('from', `${hoje.getFullYear()}-01-01`)
    params.set(
      'to',
      `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`,
    )
  } else {
    params.set('days', String(PEOPLE_ANALYTICS_RANGE_DAYS[window.range as keyof typeof PEOPLE_ANALYTICS_RANGE_DAYS]))
  }
  if (sectorId) params.set('sectorId', sectorId)
  return params.toString()
}

// ----- Painel -----

/**
 * Termômetro de humor agregado — o painel completo (médias, tendência,
 * distribuição de hoje, motivos e comentários).
 *
 * Morava numa página própria em `/admin/clima`, com filtro de período e setor
 * próprios. Virou painel **controlado** quando a G&G apontou que o termômetro
 * existia em dois lugares (Documento 3, seção 6): quem manda no recorte agora é
 * a aba Clima de People Analytics, que já tem os dois filtros no cabeçalho.
 * Dois seletores de período na mesma tela — o da aba e o do painel — é
 * justamente a confusão que a desduplicação veio resolver.
 *
 * @param window Recorte de período, o mesmo objeto do filtro da tela — atalho
 * ou intervalo livre (seção 4.6 do Documento 3).
 * @param sectorId Setor do recorte; vazio = todos. O SUBADMIN nunca escolhe —
 * quem recorta é o token, na API.
 */
export function MoodOverviewSection({
  window,
  sectorId = '',
}: {
  window: AnalyticsWindowRequest
  sectorId?: string
}) {
  // A série do termômetro tem piso: abaixo dele a rota responde 400, e o painel
  // caía num "Erro ao carregar" que não dizia o que fazer. Aqui a consulta nem
  // sai — o aviso ocupa o lugar dela.
  //
  // Com MOOD_OVERVIEW_MIN_DAYS em 1 isto virou guarda de borda: sobra só o
  // recorte que a tela não soube medir (range desconhecido, janela sem as duas
  // pontas), que dá 0 dias. Continua valendo a pena — é ela que impede a tela
  // de pedir à API uma janela que a API recusa.
  const days = moodWindowDays(window)
  const janelaCurta = days < MOOD_OVERVIEW_MIN_DAYS

  const query = useQuery({
    queryKey: ['admin', 'mood-overview', windowKey(window), sectorId],
    queryFn: () => apiFetch<MoodOverviewResponse>(`/admin/mood/overview?${moodQuery(window, sectorId)}`),
    enabled: !janelaCurta,
  })

  const overview = query.data?.overview ?? null
  const weekMood = overview?.weekAverage !== null && overview ? nearestMoodOption(overview.weekAverage) : null

  return (
    <section className="flex flex-col gap-lg">
      <p className="text-body-md text-on-surface-variant">
        Médias, tendência e distribuição saem <strong className="font-label text-on-surface">sem piso de
        volume</strong>: um único registro no dia já aparece, inclusive Estressado(a) e Desanimado(a). Os
        comentários vêm identificados — trate a tela inteira como conversa reservada de Gente e Gestão.
      </p>

      {janelaCurta && (
        <div className="flex items-center gap-sm rounded-lg border border-outline-variant/40 bg-surface-container p-lg text-body-md text-on-surface-variant">
          <Icon name="info" className="text-[20px] text-on-surface-variant" />
          <span>
            Não consegui ler esse recorte de período. Escolha um dos atalhos ou informe as duas
            datas do período personalizado.
          </span>
        </div>
      )}

      {!janelaCurta && query.isLoading && (
        <p className="text-body-sm text-on-surface-variant">Carregando…</p>
      )}

      {query.isError && (
        <div className="flex items-center gap-sm rounded-lg border border-error/40 bg-error-container/20 p-lg text-on-error-container">
          <Icon name="error" className="text-[20px]" />
          {/* A mensagem da API na frente do texto fixo: foi o texto genérico que
              escondeu, por meses, que o erro era o período fora da janela. */}
          {query.error instanceof ApiError
            ? query.error.message
            : 'Erro ao carregar o termômetro de humor.'}
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

          {/* Duas caixas, como a seção 4.6 pede: a de alerta traz só o que veio
              de Estressado(a) e Desanimado(a) — é o que exige ação —, e a outra
              traz tudo o que foi escrito, da ponta negativa à positiva. */}
          <div className="grid gap-lg lg:grid-cols-2">
            <Panel title="Causas de alerta">
              <CommentList
                comments={overview.alertComments}
                emptyMessage="Ninguém registrou desânimo ou estresse com comentário no período."
              />
            </Panel>
            <Panel title="Comentários">
              <CommentList
                comments={overview.comments}
                emptyMessage="Sem comentários no período."
              />
            </Panel>
          </div>

          <Panel title="Motivos declarados">
            <ReasonRanking reasons={overview.reasons} />
          </Panel>
        </>
      )}
    </section>
  )
}
