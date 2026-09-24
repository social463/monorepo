import { tileOfPixel, isWithinProximityTiles, type OfficeOccupant } from '@legends/shared'
import type { RemoteMedia } from './media/useOfficeMedia'

/**
 * No espaço aberto, a grade expandida de câmeras (MediaTiles) deve mostrar só
 * quem está fisicamente por perto — mesma regra do chat de proximidade
 * (`isWithinProximityTiles`). Sem esse filtro, TODO MUNDO conectado na sala
 * LiveKit do espaço aberto aparece como se estivesse na conversa, mesmo do
 * outro lado do mapa, fora do alcance de voz. Dentro de sala de reunião ou
 * zona privada (`inZone`), ninguém é filtrado — lá o áudio já é
 * autoSubscribe pra todo mundo presente, então a grade deve refletir isso.
 */
export function nearbyRemotesForGrid(
  remotes: RemoteMedia[],
  occupants: OfficeOccupant[],
  you: OfficeOccupant | null,
  inZone: boolean,
  /** Tile do mapa ATIVO, em pixels — a régua do `tileOfPixel`. */
  tileSize: number,
): RemoteMedia[] {
  if (inZone || !you) return remotes
  return remotes.filter((r) => {
    const occupant = occupants.find((o) => o.userId === r.userId)
    if (!occupant) return false
    // O alcance da grade é medido em TILE, como todo alcance do escritório.
    const meu = tileOfPixel(you, tileSize)
    const dele = tileOfPixel(occupant, tileSize)
    return isWithinProximityTiles(meu.x, meu.y, dele.x, dele.y)
  })
}
