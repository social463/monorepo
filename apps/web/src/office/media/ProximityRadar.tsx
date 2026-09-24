import { useState } from 'react'
import { isWithinProximityTiles, PROXIMITY_RADIUS, type OfficeOccupant, tileOfPixel } from '@legends/shared'

/** Diâmetro do círculo de proximidade, em px (colapsado / expandido). */
const RADAR_SIZE = 96
const EXPANDED_RADAR_SIZE = 160
/** O ponto que representa você: sempre uma bolinha pequena, sem inicial. */
const YOU_DOT_SIZE = 7
/** Bolinha dos demais: pequena e sem letra no modo normal; maior e com a
 * inicial do nome quando o radar está expandido. */
const OTHER_DOT_SIZE = 10
const OTHER_DOT_SIZE_EXPANDED = 22

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

/**
 * Miniatura no canto inferior esquerdo: quem está dentro do raio de
 * proximidade vira uma bolinha verde — estilo "People in earshot" do
 * Gather. Seu próprio ponto (centro) muda de cor conforme o microfone está
 * aberto (verde vibrante, com contraste sobre o fundo do círculo) ou mudo,
 * e nunca mostra letra. Clicável: o painel inteiro cresce
 * (não só o círculo) e, expandido, as bolinhas dos outros passam a mostrar
 * a inicial do nome. Painel abstrato (sem desenhar o mapa real).
 */
export function ProximityRadar({
  you,
  occupants,
  micEnabled,
  tileSize,
}: {
  you: OfficeOccupant | null
  occupants: OfficeOccupant[]
  micEnabled: boolean
  /** Tile do mapa ATIVO, em pixels — a régua do `tileOfPixel`. */
  tileSize: number
}) {
  const [expanded, setExpanded] = useState(false)

  if (!you) return null

  // O alcance da voz é medido em TILE, como todo alcance do escritório; o
  // occupant fala PIXEL desde o movimento livre.
  const youTile = tileOfPixel(you, tileSize)
  const nearby = occupants.filter((o) => {
    if (o.userId === you.userId) return false
    const tile = tileOfPixel(o, tileSize)
    return isWithinProximityTiles(youTile.x, youTile.y, tile.x, tile.y)
  })
  const size = expanded ? EXPANDED_RADAR_SIZE : RADAR_SIZE
  const otherDotSize = expanded ? OTHER_DOT_SIZE_EXPANDED : OTHER_DOT_SIZE

  return (
    <div className="group relative">
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 mb-2 w-max max-w-[180px] rounded-lg bg-inverse-surface px-sm py-1 text-center font-label text-label-sm text-inverse-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        Pessoas ao alcance da voz
      </span>
      <button
        type="button"
        aria-label="Radar de proximidade — pessoas por perto"
        aria-pressed={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="block rounded-xl border border-outline-variant bg-surface-container p-sm shadow-2xl backdrop-blur transition-all duration-200"
      >
        <div
          data-testid="radar-circle"
          className={`relative rounded-full border border-dashed transition-all duration-200 ${
            micEnabled ? 'border-green-400/70 bg-green-500/30' : 'border-outline-variant'
          }`}
          style={{ width: size, height: size }}
        >
          {nearby.map((o) => {
            // Em TILE também na POSIÇÃO do ponto: `PROXIMITY_RADIUS` é o raio
            // em tiles, e dividir uma diferença em pixel por ele encolheria
            // todo mundo para o centro do radar.
            const tile = tileOfPixel(o, tileSize)
            const dx = (tile.x - youTile.x) / PROXIMITY_RADIUS
            const dy = (tile.y - youTile.y) / PROXIMITY_RADIUS
            const left = size / 2 + (dx * size) / 2 - otherDotSize / 2
            const top = size / 2 + (dy * size) / 2 - otherDotSize / 2
            return (
              <span
                key={o.userId}
                data-testid={`radar-dot-${o.userId}`}
                title={o.name}
                // Par invertido: o ponto contrasta com o painel em qualquer tema.
                // Branco cravado sumia agora que o painel segue a superfície.
                className="absolute flex items-center justify-center rounded-full bg-on-surface font-label text-[10px] font-bold leading-none text-surface"
                style={{ width: otherDotSize, height: otherDotSize, left, top }}
              >
                {expanded ? initial(o.name) : null}
              </span>
            )
          })}
          <span
            data-testid="radar-you"
            title={you.name}
            className={`absolute rounded-full ring-1 ring-outline ${micEnabled ? 'bg-emerald-400' : 'bg-on-surface-variant'}`}
            style={{
              width: YOU_DOT_SIZE,
              height: YOU_DOT_SIZE,
              left: size / 2 - YOU_DOT_SIZE / 2,
              top: size / 2 - YOU_DOT_SIZE / 2,
            }}
          />
        </div>
      </button>
    </div>
  )
}
