import { isWithinProximity, type OfficeOccupant } from '@legends/shared'
import type { RemoteMedia } from './media/useOfficeMedia'

/**
 * No espaço aberto, a grade expandida de câmeras (MediaTiles) deve mostrar só
 * quem está fisicamente por perto — mesma regra do chat de proximidade
 * (`isWithinProximity`). Sem esse filtro, TODO MUNDO conectado na sala
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
): RemoteMedia[] {
  if (inZone || !you) return remotes
  return remotes.filter((r) => {
    const occupant = occupants.find((o) => o.userId === r.userId)
    return !!occupant && isWithinProximity(you.x, you.y, occupant.x, occupant.y)
  })
}
