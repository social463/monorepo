import { useEffect, useMemo } from 'react'
import type { MapDocumentV1, OfficeOccupant } from '@legends/shared'

export interface NearbyLink {
  id: string
  label: string
  url: string
}

/**
 * Interpretação de runtime dos objetos `link` do mapa: quando o SEU personagem
 * está na célula do link (ou adjacente), expõe o link para a UI mostrar o
 * prompt "Aperte E"; a tecla E abre a URL em nova aba. Só afeta o usuário local.
 */
export function useOfficeLinks(
  you: OfficeOccupant | null,
  document: MapDocumentV1 | null | undefined,
  enabled = true,
): { nearbyLink: NearbyLink | null } {
  const tileWidth = document?.map.tileWidth ?? 32
  const tileHeight = document?.map.tileHeight ?? 32

  const links = useMemo(() => {
    if (!document) return [] as { id: string; label: string; url: string; col: number; row: number }[]
    return document.objects.flatMap((object) => {
      if (object.type !== 'link' || object.geometry.kind !== 'point') return []
      return [{
        id: object.id,
        label: object.properties.label,
        url: object.properties.url,
        col: Math.floor(object.geometry.x / tileWidth),
        row: Math.floor(object.geometry.y / tileHeight),
      }]
    })
  }, [document, tileWidth, tileHeight])

  const nearbyLink = useMemo<NearbyLink | null>(() => {
    if (!enabled || !you) return null
    const hit = links.find((link) => Math.abs(link.col - you.x) <= 1 && Math.abs(link.row - you.y) <= 1)
    return hit ? { id: hit.id, label: hit.label, url: hit.url } : null
  }, [enabled, you, links])

  useEffect(() => {
    if (!nearbyLink) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e') return
      window.open(nearbyLink.url, '_blank', 'noopener')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nearbyLink])

  return { nearbyLink }
}
