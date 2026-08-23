import { RETRO_CARD_COLORS, type RetroCardColor } from '@legends/shared'

// Padronização: a cor de um post-it é definida pelo quadrante onde ele está.
// went_bad usa vermelho (fora da paleta de RetroCardColor, por isso classe direta).
export const REGION_CARD_COLOR_CLASS: Record<string, string> = {
  went_well: 'bg-emerald-200 border-emerald-300',
  went_bad: 'bg-red-200 border-red-300',
  start: 'bg-sky-200 border-sky-300',
  stop: 'bg-amber-200 border-amber-300',
}

export const CARD_COLOR_CLASS: Record<RetroCardColor, string> = {
  yellow: 'bg-amber-200 border-amber-300',
  pink: 'bg-pink-200 border-pink-300',
  green: 'bg-emerald-200 border-emerald-300',
  blue: 'bg-sky-200 border-sky-300',
  purple: 'bg-violet-200 border-violet-300',
  orange: 'bg-orange-200 border-orange-300',
}

export const SHAPE_COLOR_CLASS: Record<RetroCardColor, { fill: string; stroke: string; text: string; soft: string }> = {
  yellow: { fill: 'fill-amber-300', stroke: 'stroke-amber-500', text: 'text-amber-500', soft: 'bg-amber-100' },
  pink: { fill: 'fill-pink-300', stroke: 'stroke-pink-500', text: 'text-pink-500', soft: 'bg-pink-100' },
  green: { fill: 'fill-emerald-300', stroke: 'stroke-emerald-500', text: 'text-emerald-500', soft: 'bg-emerald-100' },
  blue: { fill: 'fill-sky-300', stroke: 'stroke-sky-500', text: 'text-sky-500', soft: 'bg-sky-100' },
  purple: { fill: 'fill-violet-300', stroke: 'stroke-violet-500', text: 'text-violet-500', soft: 'bg-violet-100' },
  orange: { fill: 'fill-orange-300', stroke: 'stroke-orange-500', text: 'text-orange-500', soft: 'bg-orange-100' },
}

export const CARRYOVER_CARD_CLASS: Record<'validate' | 'overdue', string> = {
  validate: 'bg-violet-200 border-violet-400 ring-2 ring-violet-400/50',
  overdue: 'bg-red-200 border-red-500 ring-2 ring-red-500/50',
}

export function ColorPalette({ onPick, disabled }: { onPick: (c: RetroCardColor) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container px-3 py-2 shadow-lg">
      <span className="mr-1 font-label text-label-sm text-on-surface-variant">Novo post-it:</span>
      {RETRO_CARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          aria-label={`Criar post-it ${c}`}
          onClick={() => onPick(c)}
          className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-40 ${CARD_COLOR_CLASS[c]}`}
        />
      ))}
    </div>
  )
}
