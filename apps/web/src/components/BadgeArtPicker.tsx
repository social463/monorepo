import { useState } from 'react'
import { BADGE_ART } from '../lib/badge-art'

interface BadgeArtPickerProps {
  /** Chave da ilustração atualmente selecionada (badge.iconKey). */
  value: string
  onChange: (key: string) => void
}

export function BadgeArtPicker({ value, onChange }: BadgeArtPickerProps) {
  // Chaves cuja imagem (PNG) não carregou: mostramos o label como fallback,
  // para o admin ainda conseguir escolher antes dos assets existirem.
  const [failed, setFailed] = useState<Record<string, boolean>>({})

  return (
    <div
      role="group"
      aria-label="Escolher ilustração do selo"
      className="grid grid-cols-6 gap-xs sm:grid-cols-8 lg:grid-cols-10"
    >
      {BADGE_ART.map((art) => (
        <button
          key={art.key}
          type="button"
          aria-label={art.label}
          aria-pressed={value === art.key}
          onClick={() => onChange(art.key)}
          className={`flex aspect-square items-center justify-center overflow-hidden rounded-md border-2 bg-surface-container-highest p-0.5 transition-all ${
            value === art.key
              ? 'border-primary'
              : 'border-transparent hover:border-outline-variant/50'
          }`}
        >
          {failed[art.key] ? (
            <span className="px-1 text-center font-label text-label-sm text-on-surface-variant">
              {art.label}
            </span>
          ) : (
            <img
              src={art.src}
              alt={art.label}
              className="h-full w-full object-contain"
              onError={() => setFailed((f) => ({ ...f, [art.key]: true }))}
            />
          )}
        </button>
      ))}
    </div>
  )
}
