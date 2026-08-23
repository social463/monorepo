import { useEffect, useMemo } from 'react'
import type { OfficeKart, OfficeOccupant } from '@legends/shared'
import type { OfficeBridge } from './OfficeBridge'

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
    return (
      karts
        .filter(
          (kart) =>
            !kart.riderUserId &&
            Math.abs(kart.x - you.x) <= 1 &&
            Math.abs(kart.y - you.y) <= 1,
        )
        .sort((a, b) => {
          const distanceA = Math.abs(a.x - you.x) + Math.abs(a.y - you.y)
          const distanceB = Math.abs(b.x - you.x) + Math.abs(b.y - you.y)
          return distanceA - distanceB || a.id.localeCompare(b.id)
        })[0] ?? null
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
