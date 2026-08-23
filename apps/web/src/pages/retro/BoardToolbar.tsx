import type { JSX } from 'react'

export type RetroTool = 'cursor' | 'shape' | 'react' | 'vote'

const CursorIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 3l7 17 2.5-6.5L20 11 4 3z" />
  </svg>
)
const ReactIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" />
    <line x1="15" y1="9" x2="15.01" y2="9" />
  </svg>
)
const ShapeIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="5" width="8" height="8" rx="1.5" />
    <path d="M16 11l4 7H12l4-7z" />
  </svg>
)
const VoteIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16V8" />
    <path d="M8.5 11.5L12 8l3.5 3.5" />
  </svg>
)

const TOOLS: { id: RetroTool; label: string; icon: () => JSX.Element }[] = [
  { id: 'cursor', label: 'Cursor', icon: CursorIcon },
  { id: 'shape', label: 'Adicionar forma', icon: ShapeIcon },
  { id: 'react', label: 'Reagir', icon: ReactIcon },
  { id: 'vote', label: 'Votar', icon: VoteIcon },
]

export function BoardToolbar({ tool, onSelectTool }: { tool: RetroTool; onSelectTool: (t: RetroTool) => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-outline-variant/40 bg-surface-container p-1.5 shadow-lg">
      {TOOLS.map(({ id, label, icon: Icon }) => {
        const active = tool === id
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onSelectTool(id)}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              active ? 'bg-surface-container-highest text-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            <Icon />
          </button>
        )
      })}
    </div>
  )
}
