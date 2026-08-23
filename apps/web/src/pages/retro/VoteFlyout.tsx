import type { JSX } from 'react'

export type VoteMode = 'add' | 'remove'

export function VoteFlyout({ mode, onSelect, remaining }: { mode: VoteMode; onSelect: (m: VoteMode) => void; remaining: number }): JSX.Element {
  const cell = (selected: boolean) =>
    `flex flex-1 items-center justify-center gap-1 rounded-xl py-1.5 font-label text-label-sm transition-colors ${
      selected ? 'bg-surface-container-highest text-primary ring-2 ring-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'
    }`
  return (
    <div className="w-44 rounded-2xl border border-outline-variant/40 bg-surface-container p-3 shadow-lg">
      <p className="mb-2 text-center font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Votar</p>
      <div className="flex gap-1">
        <button type="button" aria-label="Votar" aria-pressed={mode === 'add'} onClick={() => onSelect('add')} className={cell(mode === 'add')}>
          ★ +1
        </button>
        <button type="button" aria-label="Remover voto" aria-pressed={mode === 'remove'} onClick={() => onSelect('remove')} className={cell(mode === 'remove')}>
          🧽 −1
        </button>
      </div>
      <p className="mt-2 text-center font-label text-label-sm text-on-surface-variant">Votos restantes: {remaining}</p>
    </div>
  )
}
