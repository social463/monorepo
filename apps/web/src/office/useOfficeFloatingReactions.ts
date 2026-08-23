import { useEffect, useRef, useState } from 'react'
import { isWithinProximity, type OfficeOccupant } from '@legends/shared'
import type { OfficeBridge } from './OfficeBridge'
import { makeOfficeFloatingReaction, OFFICE_FLOAT_REACTION_TTL_MS, type OfficeFloatingReaction } from './office-floating-reactions'

/**
 * Reações rápidas (`nearby-message` com `kind: 'reaction'`) como reações
 * flutuantes em HTML — ver `office-floating-reactions.ts` pro porquê. Fala e
 * pensamento continuam desenhados pelo Phaser (`OfficeScene.showNearbyBubble`),
 * só reação foi movida pra cá.
 *
 * O backend faz broadcast de reação pra todo mundo conectado no escritório
 * (mesma lógica de `nearby-message` de fala/pensamento, pensada pro mapa
 * aberto) — quem escopa por sala/proximidade é o cliente, igual já faz
 * `nearbyRemotesForGrid` pros vídeos da grade. Dentro de sala/zona,
 * `zoneOccupantIds` restringe a quem está na mesma zona; no espaço aberto,
 * filtra por `isWithinProximity`.
 */
export function useOfficeFloatingReactions(
  bridge: OfficeBridge,
  occupants: OfficeOccupant[],
  you: OfficeOccupant | null,
  zoneOccupantIds: Set<string> | null,
  enabled = true,
): OfficeFloatingReaction[] {
  const [reactions, setReactions] = useState<OfficeFloatingReaction[]>([])
  const seqRef = useRef(0)
  const occupantsRef = useRef(occupants)
  occupantsRef.current = occupants
  const youRef = useRef(you)
  youRef.current = you
  const zoneOccupantIdsRef = useRef(zoneOccupantIds)
  zoneOccupantIdsRef.current = zoneOccupantIds

  useEffect(() => {
    if (!enabled) {
      setReactions([])
      return
    }
    return bridge.onServerMessage((message) => {
      if (message.type !== 'nearby-message' || message.kind !== 'reaction') return
      const currentYou = youRef.current
      const currentZoneOccupantIds = zoneOccupantIdsRef.current
      if (currentZoneOccupantIds) {
        if (!currentZoneOccupantIds.has(message.userId)) return
      } else if (currentYou) {
        const occupant = occupantsRef.current.find((o) => o.userId === message.userId)
        if (!occupant || !isWithinProximity(currentYou.x, currentYou.y, occupant.x, occupant.y)) return
      }
      seqRef.current += 1
      const occupant = occupantsRef.current.find((o) => o.userId === message.userId)
      const item = makeOfficeFloatingReaction(
        {
          userId: message.userId,
          name: occupant?.characterName ?? occupant?.name ?? '',
          photoUrl: occupant?.photoUrl ?? null,
          avatarStyle: occupant?.avatarStyle ?? null,
          avatarSeed: occupant?.avatarSeed ?? null,
          avatarOptions: occupant?.avatarOptions ?? null,
          emoji: message.text,
        },
        { id: `ofr-${seqRef.current}`, rand: Math.random() },
      )
      setReactions((current) => [...current, item])
      setTimeout(() => {
        setReactions((current) => current.filter((r) => r.id !== item.id))
      }, OFFICE_FLOAT_REACTION_TTL_MS)
    })
  }, [bridge, enabled])

  return reactions
}
