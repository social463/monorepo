import { useState } from 'react'
import { EmptyState } from '../analytics/AnalyticsPrimitives'

/**
 * Gráficos exclusivos do painel administrativo do INOVA — mesma técnica de
 * `AnalyticsPrimitives.tsx` (SVG à mão, sem lib de chart), mas com forma de
 * dado diferente (valor formatado, não contagem+%), então ficam num arquivo
 * próprio em vez de inchar o do People Analytics.
 */

export function ValueBars({
  items,
  formatValue,
  emptyMessage,
}: {
  items: { key: string; label: string; value: number }[]
  formatValue: (value: number) => string
  emptyMessage: string
}) {
  const withValue = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value)
  if (withValue.length === 0) return <EmptyState message={emptyMessage} />
  const max = Math.max(...withValue.map((i) => i.value))

  return (
    <ul className="flex flex-col gap-sm">
      {withValue.map((item) => (
        // `title` é o tooltip barato: o rótulo é truncado em telas estreitas,
        // e passar o mouse na linha mostra setor e valor inteiros.
        <li
          key={item.key}
          title={`${item.label}: ${formatValue(item.value)}`}
          className="group flex items-center gap-md rounded-md hover:bg-surface-container-high"
        >
          <span className="w-32 shrink-0 truncate font-label text-label-sm text-on-surface-variant">{item.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
            <span
              className="block h-full rounded-full bg-primary transition-opacity group-hover:opacity-80"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </span>
          <span className="w-28 shrink-0 text-right font-label text-label-sm text-on-surface">{formatValue(item.value)}</span>
        </li>
      ))}
    </ul>
  )
}

export interface InovaTimelinePoint {
  month: string
  novosProjetos: number
  avancosDeFase: number
}

const CHART_WIDTH = 720
const CHART_HEIGHT = 180

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

/**
 * Evolução mensal: novos projetos e avanços de fase, como no original. As
 * linhas ficam no SVG esticado (`preserveAspectRatio="none"` + traço que não
 * escala); pontos e tooltip são HTML posicionado em %, senão o círculo
 * esticaria junto com o gráfico.
 */
export function InovaTimelineChart({ points }: { points: InovaTimelinePoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const totalNovos = points.reduce((sum, p) => sum + p.novosProjetos, 0)
  const totalAvancos = points.reduce((sum, p) => sum + p.avancosDeFase, 0)
  if (points.length === 0 || totalNovos + totalAvancos === 0) {
    return <EmptyState message="Nenhum projeto registrado no período." />
  }

  const max = Math.max(1, ...points.flatMap((p) => [p.novosProjetos, p.avancosDeFase]))
  // Um mês só vira um ponto no meio, não colado na borda esquerda.
  const xPct = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * 100 : 50)
  const yPct = (v: number) => 100 - (v / max) * 100
  const polyline = (valueOf: (p: InovaTimelinePoint) => number) =>
    points
      .map((p, i) => `${((xPct(i) / 100) * CHART_WIDTH).toFixed(1)},${((yPct(valueOf(p)) / 100) * CHART_HEIGHT).toFixed(1)}`)
      .join(' ')

  const series = [
    { key: 'novos', label: 'Novos Projetos', valueOf: (p: InovaTimelinePoint) => p.novosProjetos, stroke: 'stroke-primary', dot: 'bg-primary', dash: undefined },
    { key: 'avancos', label: 'Avanços de Fase', valueOf: (p: InovaTimelinePoint) => p.avancosDeFase, stroke: 'stroke-tertiary', dot: 'bg-tertiary', dash: '6 5' },
  ]
  const hovered = hover !== null ? points[hover] : null

  return (
    <figure className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center gap-md text-body-sm text-on-surface-variant">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative h-44 w-full" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          role="img"
          aria-label={`Evolução mensal: ${plural(totalNovos, 'novo projeto', 'novos projetos')} e ${plural(totalAvancos, 'avanço de fase', 'avanços de fase')} no período.`}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={CHART_WIDTH}
              y1={CHART_HEIGHT * f}
              y2={CHART_HEIGHT * f}
              className="stroke-outline-variant"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.map((s) => (
            <polyline
              key={s.key}
              points={polyline(s.valueOf)}
              fill="none"
              className={s.stroke}
              strokeWidth={2.5}
              strokeDasharray={s.dash}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hover !== null && (
            <line
              x1={(xPct(hover) / 100) * CHART_WIDTH}
              x2={(xPct(hover) / 100) * CHART_WIDTH}
              y1={0}
              y2={CHART_HEIGHT}
              className="stroke-outline"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {points.map((p, i) =>
          series.map((s) => (
            <span
              key={`${p.month}-${s.key}`}
              aria-hidden
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-container ${s.dot} ${
                hover === i ? 'h-3 w-3' : 'h-2 w-2'
              }`}
              style={{ left: `${xPct(i)}%`, top: `${yPct(s.valueOf(p))}%` }}
            />
          )),
        )}

        {/* Faixas de hover, uma por mês: a área de mira é a coluna inteira,
            não o pontinho. O `title` nativo cobre teclado/leitor de tela. */}
        <div className="absolute inset-0 flex">
          {points.map((p, i) => (
            <div
              key={p.month}
              className="h-full flex-1"
              title={`${p.month}: ${plural(p.novosProjetos, 'novo projeto', 'novos projetos')}, ${plural(p.avancosDeFase, 'avanço de fase', 'avanços de fase')}`}
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </div>

        {hovered && hover !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 min-w-[10rem] -translate-x-1/2 rounded-xl border border-outline-variant/60 bg-surface-container-high px-sm py-xs shadow-lg"
            style={{ left: `${Math.min(85, Math.max(15, xPct(hover)))}%` }}
          >
            <p className="font-label text-label-sm font-semibold text-on-surface">{hovered.month}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-xs text-body-sm text-on-surface-variant">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
                {s.label}: <span className="font-mono font-semibold text-on-surface">{s.valueOf(hovered)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-between text-body-sm text-on-surface-variant">
        {points.map((p) => (
          <span key={p.month}>{p.month}</span>
        ))}
      </div>
    </figure>
  )
}

export interface InovaCategoryGroup {
  category: string
  projects: { id: string; title: string; sector: string }[]
}

/**
 * "Tipos de Projetos": chips com a contagem por categoria e, embaixo, uma
 * barra por categoria que abre a lista dos projetos dela — no original era o
 * tooltip do gráfico. Aqui abre no hover E no clique, porque tooltip de hover
 * não existe no celular nem no teclado.
 */
export function InovaCategoryBreakdown({
  groups,
  showSector,
  emptyMessage,
}: {
  groups: InovaCategoryGroup[]
  /** Com um setor já filtrado, repetir o setor em cada projeto é ruído. */
  showSector: boolean
  emptyMessage: string
}) {
  // Hover mostra; clique fixa aberto (e é o único caminho no toque e no
  // teclado). Um estado só fazia o clique fechar o que o hover acabara de abrir.
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const sorted = [...groups].filter((g) => g.projects.length > 0).sort((a, b) => b.projects.length - a.projects.length)
  if (sorted.length === 0) return <EmptyState message={emptyMessage} />
  const max = sorted[0].projects.length

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap gap-xs">
        {sorted.map((g) => (
          <span
            key={g.category}
            className="inline-flex items-center gap-xs rounded-full border border-primary/20 bg-primary/10 px-md py-xs"
          >
            <span className="font-mono text-label-md font-bold text-primary">{g.projects.length}</span>
            <span className="text-body-sm text-on-surface">{g.category}</span>
          </span>
        ))}
      </div>
      <ul className="flex flex-col gap-xs">
        {sorted.map((g) => {
          const expanded = hovered === g.category || pinned === g.category
          const listId = `inova-categoria-${g.category.replace(/[^a-zA-Z0-9]+/g, '-')}`
          return (
            <li
              key={g.category}
              onMouseEnter={() => setHovered(g.category)}
              onMouseLeave={() => setHovered((atual) => (atual === g.category ? null : atual))}
              className="rounded-lg hover:bg-surface-container-high"
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setPinned((atual) => (atual === g.category ? null : g.category))}
                className="flex w-full items-center gap-md px-xs py-xs text-left"
              >
                <span className="w-40 shrink-0 truncate font-label text-label-sm text-on-surface-variant">{g.category}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(g.projects.length / max) * 100}%` }} />
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-label-sm font-bold text-on-surface">{g.projects.length}</span>
              </button>
              {expanded && (
                <ul id={listId} className="mx-xs mb-xs flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface p-sm">
                  {g.projects.map((p) => (
                    <li key={p.id} className="text-body-sm text-on-surface">
                      • {p.title}
                      {showSector && <span className="text-on-surface-variant"> · {p.sector}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
