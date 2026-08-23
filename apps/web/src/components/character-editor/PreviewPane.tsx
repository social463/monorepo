import type { CharacterOptions } from '@legends/shared'
import { CharacterPreview } from '../CharacterPreview'
import { Icon } from '../Icon'

/**
 * Coluna do preview.
 * - Padrão: personagem grande animado + Aleatório + créditos (desktop).
 * - `compact`: personagem menor numa linha enxuta com o botão Aleatório —
 *   sem créditos. Usado no bloco sticky do mobile, onde o espaço é escasso
 *   e o guarda-roupa precisa ficar visível.
 */
export function PreviewPane({
  options,
  onRandom,
  compact = false,
}: {
  options: CharacterOptions
  onRandom: () => void
  compact?: boolean
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-md">
        <CharacterPreview options={options} size={128} />
        <div className="flex flex-1 items-center justify-end gap-sm">
          <button
            type="button"
            onClick={onRandom}
            className="inline-flex items-center gap-sm rounded-md border border-outline-variant/50 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary"
          >
            <Icon name="shuffle" className="text-[18px]" />
            Aleatório
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-lg">
      <CharacterPreview options={options} size={224} />
      <button
        type="button"
        onClick={onRandom}
        className="inline-flex items-center gap-sm rounded-md border border-outline-variant/50 px-md py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary"
      >
        <Icon name="shuffle" className="text-[18px]" />
        Aleatório
      </button>
      <a
        href="/lpc/CREDITS.txt"
        target="_blank"
        rel="noreferrer"
        className="font-label text-label-sm text-on-surface-variant underline hover:text-primary"
      >
        Arte: Liberated Pixel Cup — créditos
      </a>
    </div>
  )
}
