import { useMemo, useState } from 'react'
import {
  formatOkrAttainment,
  formatOkrValue,
  okrAttainment,
  okrResultRatio,
  type OkrCheckInDTO,
  type OkrCycleDTO,
  type OkrKeyResultDTO,
} from '@legends/shared'
import { formatYmd } from './okr-format'

const CHART_W = 640
const CHART_H = 240
const PAD = { top: 16, right: 20, bottom: 32, left: 56 }
const PLOT_W = CHART_W - PAD.left - PAD.right
const PLOT_H = CHART_H - PAD.top - PAD.bottom

/**
 * Passo "redondo" para o eixo não cair em 3,33 e 6,67. O 2,5 está na escada de
 * propósito: sem ele, uma meta de 0 a 95 pulava de 20 para 50 e sobravam três
 * marcas no eixo inteiro.
 */
function niceStep(span: number): number {
  if (span <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(span))
  const normalized = span / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

function ticksFor(min: number, max: number): number[] {
  const step = niceStep((max - min) / 4)
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let value = start; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(10)))
  return ticks
}

const dayOf = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)

/**
 * Evolução do valor atingido: a série de check-ins no tempo, com a meta como
 * linha de referência. Uma série só, então nem legenda nem paleta categórica —
 * a cor é a da marca, e a meta é uma linha tracejada neutra.
 *
 * Check-in só de comentário não tem valor e fica de fora do gráfico (ele
 * continua na lista embaixo): um ponto em zero diria que a meta desabou.
 */
export function OkrEvolutionChart({
  checkIns,
  keyResult,
  cycle,
}: {
  checkIns: OkrCheckInDTO[]
  keyResult: OkrKeyResultDTO
  cycle: OkrCycleDTO
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const fmt = (value: number | null) => formatOkrValue(value, keyResult, cycle.decimals)
  /** Resultado daquele ponto pela mesma regra do servidor (teto inclusive). */
  const resultOf = (value: number) => formatOkrAttainment(okrResultRatio(okrAttainment(keyResult, value) ?? { attainment: 0, overshoot: 0 }))

  const points = useMemo(() => {
    const withValue = checkIns
      .filter((checkIn) => checkIn.value != null)
      .map((checkIn) => ({ checkIn, value: checkIn.value as number, time: dayOf(checkIn.effectiveAt) }))
      .sort((a, b) => a.time - b.time)
    return withValue
  }, [checkIns])

  const scale = useMemo(() => {
    if (points.length === 0) return null
    const values = points.map((point) => point.value)
    const low = Math.min(...values, keyResult.target, keyResult.baseline)
    const high = Math.max(...values, keyResult.target, keyResult.baseline)
    const ticks = ticksFor(low, high === low ? low + 1 : high)
    const min = ticks[0]
    const max = ticks[ticks.length - 1]
    const times = points.map((point) => point.time)
    const first = Math.min(...times)
    const last = Math.max(...times)
    return {
      ticks,
      yOf: (value: number) => PAD.top + PLOT_H - ((value - min) / (max - min || 1)) * PLOT_H,
      xOf: (time: number) => (last === first ? PAD.left + PLOT_W / 2 : PAD.left + ((time - first) / (last - first)) * PLOT_W),
    }
  }, [points, keyResult.target, keyResult.baseline])

  if (points.length === 0 || !scale) {
    return (
      <p className="font-body text-body-sm text-on-surface-variant">
        Ainda não há check-in com valor para desenhar a evolução.
      </p>
    )
  }

  const coords = points.map((point) => ({ ...point, x: scale.xOf(point.time), y: scale.yOf(point.value) }))
  const line = coords.map((point) => `${point.x},${point.y}`).join(' ')
  const hoveredPoint = hovered != null ? coords[hovered] : null
  const alvo = keyResult.direction === 'LOWER_IS_BETTER' ? 'Teto' : 'Meta'
  const targetY = scale.yOf(keyResult.target)
  const band = PLOT_W / coords.length

  return (
    <div className="flex flex-col gap-sm">
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Evolução de ${keyResult.name}: ${coords.length} check-ins, de ${fmt(coords[0].value)} em ${formatYmd(
            points[0].checkIn.effectiveAt,
          )} a ${fmt(coords[coords.length - 1].value)} em ${formatYmd(points[points.length - 1].checkIn.effectiveAt)}. ${alvo}: ${fmt(
            keyResult.target,
          )}.`}
        >
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={CHART_W - PAD.right}
                y1={scale.yOf(tick)}
                y2={scale.yOf(tick)}
                stroke="currentColor"
                strokeWidth="1"
                className="text-outline-variant/40"
              />
              <text x={PAD.left - 8} y={scale.yOf(tick) + 4} textAnchor="end" className="fill-on-surface-variant text-[11px]">
                {tick.toLocaleString('pt-BR')}
              </text>
            </g>
          ))}

          {/* Meta como referência, e não como série: tracejada e neutra. */}
          <line
            x1={PAD.left}
            x2={CHART_W - PAD.right}
            y1={targetY}
            y2={targetY}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="6 4"
            className="text-outline"
          />
          <text x={CHART_W - PAD.right} y={targetY - 6} textAnchor="end" className="fill-on-surface-variant text-[11px]">
            {alvo}: {fmt(keyResult.target)}
          </text>

          <polyline points={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-primary" />
          {coords.map((point, index) => (
            <circle
              key={point.checkIn.id}
              cx={point.x}
              cy={point.y}
              r={hovered === index ? 6 : 4}
              strokeWidth="2"
              className="fill-primary stroke-surface-container"
            />
          ))}

          <text x={PAD.left} y={CHART_H - 8} textAnchor="start" className="fill-on-surface-variant text-[11px]">
            {formatYmd(points[0].checkIn.effectiveAt)}
          </text>
          {coords.length > 1 && (
            <text x={CHART_W - PAD.right} y={CHART_H - 8} textAnchor="end" className="fill-on-surface-variant text-[11px]">
              {formatYmd(points[points.length - 1].checkIn.effectiveAt)}
            </text>
          )}

          {hoveredPoint && (
            <line
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 3"
              className="text-outline"
            />
          )}

          {/* Alvo de hover bem maior que o ponto, como no gráfico de humor. */}
          {coords.map((point, index) => (
            <rect
              key={`hit-${point.checkIn.id}`}
              x={point.x - band / 2}
              y={PAD.top}
              width={band}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              <title>
                {formatYmd(point.checkIn.effectiveAt)}: {fmt(point.value)}
              </title>
            </rect>
          ))}
        </svg>

        {hoveredPoint && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-outline-variant/40 bg-surface-container-highest px-sm py-xs font-label text-label-sm text-on-surface shadow-lg"
            style={{ left: `${(hoveredPoint.x / CHART_W) * 100}%`, top: 0 }}
          >
            <span className="text-on-surface-variant">{formatYmd(hoveredPoint.checkIn.effectiveAt)}</span>{' '}
            <span className="font-bold tabular-nums">{fmt(hoveredPoint.value)}</span>
          </div>
        )}
      </div>

      {/* A mesma série em tabela: é o que torna o gráfico legível sem enxergar cor. */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-left font-body text-body-sm text-on-surface">
          <caption className="sr-only">Valores de {keyResult.name} por data de referência</caption>
          <thead>
            <tr>
              <th scope="col" className="px-sm py-xs" />
              {coords.map((point) => (
                <th key={point.checkIn.id} scope="col" className="whitespace-nowrap px-sm py-xs text-center font-label text-label-sm">
                  {formatYmd(point.checkIn.effectiveAt)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-outline-variant/30">
              <th scope="row" className="px-sm py-xs font-label text-label-sm text-on-surface-variant">
                {alvo}
              </th>
              {coords.map((point) => (
                <td key={point.checkIn.id} className="whitespace-nowrap px-sm py-xs text-center tabular-nums">
                  {fmt(keyResult.target)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-outline-variant/30">
              <th scope="row" className="px-sm py-xs font-label text-label-sm text-on-surface-variant">
                Atingido
              </th>
              {coords.map((point) => (
                <td key={point.checkIn.id} className="whitespace-nowrap px-sm py-xs text-center tabular-nums">
                  {fmt(point.value)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-outline-variant/30">
              <th scope="row" className="px-sm py-xs font-label text-label-sm text-on-surface-variant">
                Resultado
              </th>
              {coords.map((point) => (
                <td key={point.checkIn.id} className="whitespace-nowrap px-sm py-xs text-center tabular-nums">
                  {resultOf(point.value)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
