import type { OfficeRoomDTO } from '@legends/shared'

/**
 * Como uma sala está trancada. Os dois estados existem no produto e se
 * comportam de forma diferente na hora de entrar, então não podem ter o mesmo
 * desenho:
 *
 * - `session`: alguém que está DENTRO trancou (`set-room-lock`). A entrada é
 *   recusada com `locked`, e quem chega pode bater na porta.
 * - `admin`: a sala está `LOCKED` no cadastro, mexida por um admin no editor
 *   de mapas. A recusa é `admin-locked` e não há a quem pedir — mostrar o
 *   mesmo cadeado das outras faria a pessoa atravessar o escritório pra bater
 *   numa porta que nunca abre.
 */
export type ZoneLockKind = 'session' | 'admin'

/**
 * Zonas trancadas do mapa, por `externalKey` — a chave que a cena conhece.
 *
 * A tradução é necessária porque as duas pontas falam identificadores
 * diferentes: `room-lock-changed` manda o id da linha `OfficeRoom`, e o mapa
 * só conhece `externalKey`. `rooms` é a ponte (é o mesmo casamento que o
 * `OfficeSessionContext` faz pra descobrir em que sala você está).
 *
 * A tranca administrativa vence a de sessão: se as duas valem, quem chega não
 * entra de jeito nenhum, e o cadeado tem que dizer isso.
 */
export function lockedZonesByExternalKey(
  rooms: readonly OfficeRoomDTO[],
  lockedRoomIds: readonly string[],
): Map<string, ZoneLockKind> {
  const locked = new Set(lockedRoomIds)
  const zones = new Map<string, ZoneLockKind>()
  for (const room of rooms) {
    if (room.status === 'LOCKED') zones.set(room.externalKey, 'admin')
    else if (locked.has(room.id)) zones.set(room.externalKey, 'session')
  }
  return zones
}

/** Se duas leituras dão no mesmo — evita reenviar o estado pra cena a cada render. */
export function sameLockedZones(
  a: ReadonlyMap<string, ZoneLockKind>,
  b: ReadonlyMap<string, ZoneLockKind>,
): boolean {
  if (a.size !== b.size) return false
  for (const [key, kind] of a) if (b.get(key) !== kind) return false
  return true
}
