import { RETRO_REGIONS } from '@legends/shared'

const QUADS = RETRO_REGIONS.filter((r) => r.id !== 'actions')
const ACTIONS = RETRO_REGIONS.find((r) => r.id === 'actions')
const blockRight = Math.max(...QUADS.map((r) => r.x + r.w))
const arrowLeft = blockRight + 16
const arrowWidth = ACTIONS ? ACTIONS.x - arrowLeft - 16 : 0
const arrowTop = ACTIONS ? ACTIONS.y + ACTIONS.h / 2 : 0

export function RegionsBackground() {
  return (
    <>
      {RETRO_REGIONS.map((r) => (
        <div
          key={r.id}
          className="absolute rounded-2xl border-2 border-dashed border-outline-variant/40 bg-surface-container/30"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        >
          <span className="absolute left-4 top-3 font-label text-label-md font-bold uppercase tracking-wide text-on-surface-variant">
            {r.label}
          </span>
        </div>
      ))}
      {ACTIONS && arrowWidth > 0 && (
        <svg
          className="absolute text-outline-variant"
          style={{ left: arrowLeft, top: arrowTop - 12, width: arrowWidth, height: 24, overflow: 'visible' }}
          aria-hidden="true"
        >
          <line x1="0" y1="12" x2={arrowWidth - 8} y2="12" stroke="currentColor" strokeWidth="2" />
          <path
            d={`M ${arrowWidth - 12} 5 L ${arrowWidth} 12 L ${arrowWidth - 12} 19`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      )}
    </>
  )
}
