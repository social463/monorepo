import { useId, useState } from 'react'
import type { BadgeDTO } from '@legends/shared'
import { badgeArt, badgeAccentColor } from '../lib/badge-art'

/** Pontos de uma estrela de 5 pontas centrada em (0,0). */
function starPoints(outer: number, inner: number): string {
  const pts: string[] = []
  for (let i = 0; i < 5; i++) {
    const ao = ((-90 + i * 72) * Math.PI) / 180
    pts.push(`${(outer * Math.cos(ao)).toFixed(2)},${(outer * Math.sin(ao)).toFixed(2)}`)
    const ai = ((-90 + i * 72 + 36) * Math.PI) / 180
    pts.push(`${(inner * Math.cos(ai)).toFixed(2)},${(inner * Math.sin(ai)).toFixed(2)}`)
  }
  return pts.join(' ')
}

/** Motivo geométrico de fallback (selos cuja iconKey não está no catálogo). */
function Motif({ kind }: { kind: BadgeDTO['kind'] }) {
  if (kind === 'IMPACT') return <polygon points={starPoints(17, 7)} />
  if (kind === 'HIGHLIGHT') return <polygon points={starPoints(18, 7.5)} />
  if (kind === 'RECURRENCE') {
    return (
      <>
        <circle r="17" fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2.4" />
        <polygon points={starPoints(10.5, 4.4)} />
      </>
    )
  }
  // CATEGORY → escudo
  return <path d="M -13,-14 L 13,-14 L 13,1 Q 13,11 0,16 Q -13,11 -13,1 Z" />
}

interface BadgeEmblemProps {
  badge: Pick<BadgeDTO, 'iconKey' | 'kind' | 'name'>
  /** Lado do emblema em px. */
  size?: number
}

const RIVETS = Array.from({ length: 12 }, (_, i) => (i * 30 + 15) * (Math.PI / 180))
// Faíscas decorativas: posição angular (graus), raio e tamanho.
const SPARKLES = [
  { a: -62, r: 47, s: 3.8 },
  { a: 26, r: 48, s: 3.0 },
  { a: 152, r: 46, s: 3.4 },
  { a: 212, r: 47, s: 2.6 },
  { a: 96, r: 48, s: 2.2 },
]

/** Estrela de 4 pontas (faísca) centrada em (0,0). */
function sparkPoints(s: number): string {
  const c = s * 0.28
  return `0,${-s} ${c},${-c} ${s},0 ${c},${c} 0,${s} ${-c},${c} ${-s},0 ${-c},${-c}`
}

export function BadgeEmblem({ badge, size = 64 }: BadgeEmblemProps) {
  const art = badgeArt(badge.iconKey)
  const color = badgeAccentColor(badge.iconKey, badge.kind)
  const uid = useId().replace(/:/g, '')
  // Se a ilustração (PNG) não carregar, cai no motivo geométrico. Guardamos o
  // src que falhou (não um boolean) para reabilitar a imagem quando a arte muda.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showArt = art ? failedSrc !== art.src : false

  return (
    <span
      className="badge-emblem inline-block shrink-0"
      style={{ width: size, height: size, ['--emblem-color' as string]: color }}
      title={badge.name}
      aria-label={badge.name}
      role="img"
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id={`dome-${uid}`} cx="38%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
            <stop offset="32%" stopColor={color} />
            <stop offset="78%" stopColor={color} />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.45" />
          </radialGradient>
          {/* poço recuado: cor do selo em tom escuro, luz acumulada embaixo */}
          <radialGradient id={`well-${uid}`} cx="50%" cy="74%" r="78%">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="62%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
          </radialGradient>
          {/* aro 3D: gradiente vertical (topo iluminado, base sombreada) */}
          <linearGradient id={`band-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="38%" stopColor={color} />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id={`ribbon-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id={`shine-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <filter id={`emb-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="0.6" floodColor="#000000" floodOpacity="0.45" />
          </filter>
          {/* relevo do ícone: borda no formato da silhueta + sombra projetada */}
          <filter id={`relief-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
            <feMorphology in="SourceAlpha" operator="dilate" radius="2.2" result="dilate" />
            {/* sombra de relevo (silhueta deslocada + borrada) */}
            <feOffset in="dilate" dx="0" dy="1.3" result="off" />
            <feGaussianBlur in="off" stdDeviation="0.9" result="blur" />
            <feFlood floodColor="#000000" floodOpacity="0.5" result="shadeColor" />
            <feComposite in="shadeColor" in2="blur" operator="in" result="shadow" />
            {/* borda no formato do ícone, na cor do selo */}
            <feFlood floodColor={color} floodOpacity="0.95" result="rimColor" />
            <feComposite in="rimColor" in2="dilate" operator="in" result="rim" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="rim" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id={`dome-clip-${uid}`}>
            <circle cx="0" cy="0" r="32" />
          </clipPath>
        </defs>

        <g transform="translate(50,50)">
          {/* fita (ribbon) decorativa na base */}
          <g>
            <polygon points="-15,30 -6,30 -9,49 -19,43" fill={`url(#ribbon-${uid})`} />
            <polygon points="15,30 6,30 9,49 19,43" fill={`url(#ribbon-${uid})`} />
          </g>

          {/* sombra externa sutil do medalhão */}
          <circle r="46.5" fill="#000000" fillOpacity="0.18" />
          {/* aro 3D grosso e arredondado (banda iluminada de cima) */}
          <circle r="46" fill={`url(#band-${uid})`} />
          {/* realce especular no topo do aro */}
          <circle
            r="45"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.6"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray="135 999"
            transform="rotate(-158)"
          />
          {/* sombra na base do aro (dá volume) */}
          <circle
            r="45"
            fill="none"
            stroke="#000000"
            strokeOpacity="0.3"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray="90 999"
            transform="rotate(40)"
          />
          {/* rebites (estudos abaulados) */}
          {RIVETS.map((a, i) => (
            <g key={i} transform={`translate(${(40 * Math.cos(a)).toFixed(2)},${(40 * Math.sin(a)).toFixed(2)})`}>
              <circle r="2.8" fill="#000000" fillOpacity="0.3" />
              <circle cx="-0.4" cy="-0.4" r="2.4" fill={`url(#dome-${uid})`} />
              <circle cx="-0.9" cy="-1" r="0.8" fill="#ffffff" fillOpacity="0.85" />
            </g>
          ))}
          {/* canaleta recuada (degrau para o centro) */}
          <circle r="34" fill="#000000" fillOpacity="0.32" />
          {/* lábio interno elevado ao redor do centro */}
          <circle r="33.4" fill="none" stroke={color} strokeOpacity="0.6" strokeWidth="1.6" />
          {/* poço recuado: cor do selo escurecida + profundidade */}
          <g clipPath={`url(#dome-clip-${uid})`}>
            <circle r="32" fill="#0d1014" />
            <circle r="32" fill={`url(#well-${uid})`} />
            {/* sombra interna no topo (o lábio projeta sombra no poço) */}
            <ellipse cx="0" cy="-16" rx="34" ry="18" fill="#000000" opacity="0.32" />
            {/* leve reflexo da cor acumulado no fundo */}
            <ellipse cx="0" cy="16" rx="22" ry="9" fill={color} opacity="0.2" />
          </g>

          {/* centro: ilustração 3D do catálogo, ou motivo geométrico (fallback) */}
          {showArt && art ? (
            <image
              href={art.src}
              x="-28"
              y="-28"
              width="56"
              height="56"
              clipPath={`url(#dome-clip-${uid})`}
              filter={`url(#relief-${uid})`}
              preserveAspectRatio="xMidYMid meet"
              onError={() => setFailedSrc(art.src)}
            />
          ) : (
            <g fill="#ffffff" fillOpacity="0.92" filter={`url(#emb-${uid})`}>
              <Motif kind={badge.kind} />
            </g>
          )}

          {/* faíscas */}
          {SPARKLES.map((sp, i) => {
            const rad = (sp.a * Math.PI) / 180
            const x = (sp.r * Math.cos(rad)).toFixed(2)
            const y = (sp.r * Math.sin(rad)).toFixed(2)
            return (
              <polygon
                key={i}
                points={sparkPoints(sp.s)}
                fill="#ffffff"
                fillOpacity="0.85"
                transform={`translate(${x},${y})`}
              />
            )
          })}

          {/* brilho varrendo o medalhão */}
          <g clipPath={`url(#dome-clip-${uid})`}>
            <g transform="rotate(-18)">
              <rect x="-9" y="-50" width="18" height="100" fill={`url(#shine-${uid})`}>
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="-48 0; 60 0; 60 0"
                  keyTimes="0; 0.4; 1"
                  dur="3.6s"
                  repeatCount="indefinite"
                />
              </rect>
            </g>
          </g>
        </g>
      </svg>
    </span>
  )
}
