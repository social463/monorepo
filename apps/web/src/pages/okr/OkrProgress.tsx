import {
  OKR_CONFIDENCE_LABELS,
  contrastRatio,
  formatOkrAttainment,
  hexToOklch,
  isValidHex,
  oklchToHex,
  okrResultRatio,
  type OkrConfidenceLevel,
} from '@legends/shared'
import { Icon } from '../../components/Icon'

/**
 * Tom do rótulo e do texto sobre ele. A cor é do semáforo do ciclo — dado da
 * empresa, como a série de um gráfico —, então o contraste é calculado aqui e
 * não sai de token: o amarelo pede texto escuro, o vermelho pede branco.
 */
function labelTones(color: string): { background: string; text: string } {
  const oklch = hexToOklch(color)
  const background = oklchToHex({ ...oklch, l: Math.max(0, oklch.l - 0.1) })
  const text = contrastRatio(background, '#ffffff') >= contrastRatio(background, '#1b1b1f') ? '#ffffff' : '#1b1b1f'
  return { background, text }
}

/**
 * Barra de ATINGIMENTO, não de progresso linear: numa meta "menor é melhor" o
 * progresso de 150% é teto estourado, e desenhá-la cheia seria mentir. O rótulo
 * soma o que passou da meta (131%), mas a barra para em 100%.
 */
export function OkrProgressMeter({
  attainment,
  overshoot,
  color,
  label,
}: {
  attainment: number | null
  overshoot: number | null
  color: string | null
  label: string
}) {
  if (attainment == null) {
    return (
      <div className="rounded-md bg-surface-container-highest px-sm py-xs text-center font-label text-label-sm text-on-surface-variant">
        Meta não atualizada
      </div>
    )
  }
  const pct = Math.round(Math.min(attainment, 1) * 100)
  const text = formatOkrAttainment(okrResultRatio({ attainment, overshoot }))
  const valid = color != null && isValidHex(color)
  const tones = valid ? labelTones(color) : null

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={text}
      className={`relative h-6 w-full overflow-hidden rounded-md ${valid ? '' : 'bg-surface-container-highest'}`}
      style={valid ? { backgroundColor: `color-mix(in srgb, ${color} 28%, transparent)` } : undefined}
    >
      <div
        className={`h-full ${valid ? '' : 'bg-outline'}`}
        style={{ width: `${pct}%`, ...(valid ? { backgroundColor: color } : {}) }}
      />
      <span
        className={`absolute left-1 top-1/2 -translate-y-1/2 rounded px-1.5 font-label text-label-sm font-bold tabular-nums ${
          tones ? '' : 'bg-surface text-on-surface'
        }`}
        style={tones ? { backgroundColor: tones.background, color: tones.text } : undefined}
      >
        {text}
      </span>
    </div>
  )
}

/**
 * Ícone de cada confiança, na metáfora de tempo da ImpulseUp — do sol à
 * tempestade —, com o visto reservado para "concluído", que é fim de jornada e
 * não previsão. Fonte única: o seletor do check-in usa o mesmo mapa.
 */
export const OKR_CONFIDENCE_ICONS: Record<OkrConfidenceLevel, string> = {
  ON_TRACK: 'sunny',
  ATTENTION_REQUIRED: 'partly_cloudy_day',
  AT_RISK: 'thunderstorm',
  COMPLETED: 'task_alt',
}

const CONFIDENCE_STYLE: Record<OkrConfidenceLevel, { icon: string; className: string }> = {
  ON_TRACK: { icon: OKR_CONFIDENCE_ICONS.ON_TRACK, className: 'bg-primary-container text-on-primary-container' },
  ATTENTION_REQUIRED: {
    icon: OKR_CONFIDENCE_ICONS.ATTENTION_REQUIRED,
    className: 'bg-tertiary-container text-on-tertiary-container',
  },
  AT_RISK: { icon: OKR_CONFIDENCE_ICONS.AT_RISK, className: 'bg-error-container text-on-error-container' },
  COMPLETED: { icon: OKR_CONFIDENCE_ICONS.COMPLETED, className: 'bg-secondary-container text-on-secondary-container' },
}

/** Confiança declarada pelo responsável — é opinião, não cálculo. */
export function OkrConfidenceChip({ level }: { level: OkrConfidenceLevel | null }) {
  const style = level ? CONFIDENCE_STYLE[level] : { icon: 'help', className: 'bg-surface-container-highest text-on-surface-variant' }
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-sm py-0.5 font-label text-label-sm ${style.className}`}
    >
      <Icon name={style.icon} className="text-[14px]" />
      {level ? OKR_CONFIDENCE_LABELS[level] : 'Não definido'}
    </span>
  )
}
