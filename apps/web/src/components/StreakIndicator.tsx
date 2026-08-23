import { useEffect, useRef, useState } from 'react'
import { useStreakSummary } from '../lib/use-streak'
import { StreakPanel } from './StreakPanel'

export function StreakIndicator() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const summary = useStreakSummary()

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Só aparece quando o resumo carregou: evita piscar "🔥 0" durante o load
  // e não polui o header em caso de erro.
  if (!summary.data) return null

  const streak = summary.data.currentStreak

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Ofensiva"
        className="flex items-center gap-sm rounded-full border-2 border-primary/40 px-md py-1.5 transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <span className="text-[20px] leading-none" aria-hidden>🔥</span>
        <span className="font-label text-label-lg font-bold text-on-surface">{streak}</span>
      </button>

      {open && <StreakPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
