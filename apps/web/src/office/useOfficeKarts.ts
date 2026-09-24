import { useEffect, useMemo } from 'react'
import type { OfficeKart, OfficeOccupant } from '@legends/shared'
import type { OfficeBridge } from './OfficeBridge'

/**
 * Alcance para montar, em pixel. Um tile e meio: o servidor usa o mesmo, e o
 * cliente não pode oferecer o botão onde o servidor recusa.
 */
const KART_RIDE_REACH = 48

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function useOfficeKarts(
  bridge: OfficeBridge,
  you: OfficeOccupant | null,
  karts: readonly OfficeKart[],
  enabled = true,
): { nearbyKart: OfficeKart | null; riding: boolean; canInteract: boolean } {
  const riding = Boolean(you?.ridingKartId)
  const nearbyKart = useMemo(() => {
    if (!enabled || !you || riding) return null
    // Em PIXEL, como o servidor mede (`OfficeHub.rideKart`) — kart e pessoa
    // falam pixel desde o movimento livre. Ancorado no que sempre significou,
    // "um tile de distância", com a folga que um corpo contínuo pede: montar não
    // pode virar teste de pontaria.
    const distancia = (kart: OfficeKart) => Math.hypot(kart.x - you.x, kart.y - you.y)
    return (
      karts
        .filter((kart) => !kart.riderUserId && distancia(kart) <= KART_RIDE_REACH)
        .sort((a, b) => distancia(a) - distancia(b) || a.id.localeCompare(b.id))[0] ?? null
    )
  }, [enabled, karts, riding, you])
  const canInteract = enabled && (riding || nearbyKart !== null)

  useEffect(() => {
    if (!canInteract) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== 'e' || isTextInput(event.target)) return
      event.preventDefault()
      bridge.emitClientMessage({ type: 'ride-kart' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bridge, canInteract])

  return { nearbyKart, riding, canInteract }
}
