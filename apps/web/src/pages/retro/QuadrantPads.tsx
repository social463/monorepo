import { RETRO_REGIONS } from '@legends/shared'

// Um "bloco de notas adesivas" por quadrante (estilo Miro): pressionar + arrastar pega
// um novo card já na cor do quadrante. No hover a ponta inferior direita do card dobra,
// crescendo de forma contínua (transform — sem piscar). Base "empilhada" embaixo.
type PadColor = { light: string; base: string; dark: string; band: string; band2: string }

const PAD_COLORS: Record<string, PadColor> = {
  went_well: { light: '#bbf7e0', base: '#6ee7b7', dark: '#0f9f74', band: '#10b981', band2: '#047857' },
  went_bad: { light: '#fed7d7', base: '#fca5a5', dark: '#e03b3b', band: '#ef5a5a', band2: '#c01f1f' },
  start: { light: '#cdeafe', base: '#7dd3fc', dark: '#0c93d6', band: '#38bdf8', band2: '#0277b6' },
  stop: { light: '#fdee8c', base: '#fadf45', dark: '#d9b400', band: '#cfa81f', band2: '#a9810c' },
}

const PAD_QUADS = RETRO_REGIONS.filter((r) => PAD_COLORS[r.id])

const PAD_SIZE = 122
const PAD_MARGIN = 16

// Geometria da dobra (repouso). O canto fica em (106, BASE_Y); cresce no hover via
// transform scale a partir desse canto — por isso a borda inferior é reta (anima liso).
const BASE_Y = 92
const FLAP_D = `M80 ${BASE_Y} L106 70 L106 ${BASE_Y} Z`
const CREASE_D = `M80 ${BASE_Y} L106 70`

function StickyPad({ id, c }: { id: string; c: PadColor }) {
  return (
    <svg viewBox="0 0 112 128" className="h-full w-full overflow-visible">
      <defs>
        <linearGradient id={`sheet-${id}`} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor={c.light} />
          <stop offset="1" stopColor={c.base} />
        </linearGradient>
        {/* sombra sobre a folha de baixo (mesma cor do card), mais escura no vinco */}
        <linearGradient id={`fsh-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.5" stopColor="#000" stopOpacity="0.45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`band-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.band} />
          <stop offset="1" stopColor={c.band2} />
        </linearGradient>
        <filter id={`ds-${id}`} x="-25%" y="-25%" width="150%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#000" floodOpacity="0.2" />
        </filter>
      </defs>

      {/* base (pilha) — encostada no card (sem folga) */}
      <rect x="6" y={BASE_Y - 2} width="100" height="22" rx="5" fill={`url(#band-${id})`} />
      <rect x="6" y={BASE_Y - 2} width="100" height="3" rx="1.5" fill="#fff" opacity="0.18" />
      <rect x="8" y={BASE_Y + 8} width="96" height="1.6" fill="#000" opacity="0.1" />

      {/* sombra de contato do card na base */}
      <ellipse cx="56" cy={BASE_Y} rx="48" ry="3.5" fill="#000" opacity="0.14" />

      {/* corpo do card (estático) */}
      <path
        d={`M6 16 Q6 9 13 9 L99 9 Q106 9 106 16 L106 ${BASE_Y - 4} Q106 ${BASE_Y} 102 ${BASE_Y} L10 ${BASE_Y} Q6 ${BASE_Y} 6 ${BASE_Y - 6} Z`}
        fill={`url(#sheet-${id})`}
        filter={`url(#ds-${id})`}
      />

      {/* dobra: revela a folha de baixo (mesma cor) com sombra no vinco; cresce suave no hover */}
      <g className="transition-transform duration-500 ease-[cubic-bezier(.22,.7,.3,1)] [transform-box:fill-box] [transform-origin:100%_100%] group-hover:scale-[1.95]">
        <path d={FLAP_D} fill={c.base} />
        <path d={FLAP_D} fill={`url(#fsh-${id})`} />
        <path d={CREASE_D} stroke={c.dark} strokeWidth="0.7" opacity="0.5" fill="none" />
      </g>
    </svg>
  )
}

export function QuadrantPads({ onPullStart }: { onPullStart: (regionId: string, clientX: number, clientY: number) => void }) {
  return (
    <>
      {PAD_QUADS.map((r) => (
        <button
          key={r.id}
          type="button"
          aria-label={`Novo card em ${r.label}`}
          title={`Arraste para criar um card em ${r.label}`}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onPullStart(r.id, e.clientX, e.clientY)
          }}
          className="group absolute cursor-grab outline-none active:cursor-grabbing"
          style={{ left: r.x + r.w - PAD_SIZE - PAD_MARGIN, top: r.y + PAD_MARGIN, width: PAD_SIZE, height: PAD_SIZE }}
        >
          <StickyPad id={r.id} c={PAD_COLORS[r.id]} />
        </button>
      ))}
    </>
  )
}
