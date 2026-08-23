import type { RetroCursor } from '../../lib/useRetroSocket'
import type { Pan } from './use-canvas-viewport'
import { worldToScreen } from './use-canvas-viewport'

export function LiveCursors({ cursors, pan, zoom }: { cursors: RetroCursor[]; pan: Pan; zoom: number }) {
  return (
    <>
      {cursors.map((c) => {
        const s = worldToScreen(c.x, c.y, pan, zoom)
        return (
          <div key={c.userId} className="pointer-events-none absolute z-50" style={{ left: s.x, top: s.y }}>
            <div className="h-3 w-3 rotate-45 rounded-sm bg-primary" />
            <span className="ml-3 rounded bg-primary px-1.5 py-0.5 font-label text-[10px] text-on-primary">{c.name}</span>
          </div>
        )
      })}
    </>
  )
}
