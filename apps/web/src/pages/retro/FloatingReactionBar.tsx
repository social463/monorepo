import { RETRO_FLOAT_REACTIONS } from '@legends/shared'

const LABELS: Record<string, string> = {
  '👍': 'Reagir com joinha',
  '❤️': 'Reagir com coração',
  '😂': 'Reagir com risada',
  '😮': 'Reagir com uau',
  '😢': 'Reagir com tristeza',
  '👏': 'Reagir com palmas',
  '🎉': 'Reagir com festa',
}

export function FloatingReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container-highest/95 px-2 py-1 shadow-lg">
      {RETRO_FLOAT_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={LABELS[emoji] ?? `Reagir com ${emoji}`}
          onClick={() => onReact(emoji)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-xl transition-transform hover:scale-125 hover:bg-white/10"
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
