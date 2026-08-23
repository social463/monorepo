import type { JSX } from 'react'
import { RETRO_REACTION_EMOJIS, type RetroReactionEmoji } from '@legends/shared'

export type ReactionStamp = RetroReactionEmoji | 'eraser'

export function ReactionFlyout({ active, onSelect }: { active: ReactionStamp | null; onSelect: (v: ReactionStamp) => void }): JSX.Element {
  const cell = (selected: boolean) =>
    `flex h-9 w-9 items-center justify-center rounded-xl text-[18px] transition-colors ${
      selected ? 'bg-surface-container-highest ring-2 ring-primary' : 'hover:bg-surface-container-highest'
    }`
  return (
    <div className="w-72 rounded-2xl border border-outline-variant/40 bg-surface-container p-3 shadow-lg">
      <p className="mb-2 text-center font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Reações</p>
      <div className="grid grid-cols-6 gap-1">
        {RETRO_REACTION_EMOJIS.map((emoji) => (
          <button key={emoji} type="button" aria-label={`Reagir com ${emoji}`} aria-pressed={active === emoji} onClick={() => onSelect(emoji)} className={cell(active === emoji)}>
            {emoji}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label="Borracha"
        aria-pressed={active === 'eraser'}
        onClick={() => onSelect('eraser')}
        className={`mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-1.5 font-label text-label-sm transition-colors ${
          active === 'eraser' ? 'bg-surface-container-highest text-primary ring-2 ring-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'
        }`}
      >
        🧽 Borracha
      </button>
    </div>
  )
}
