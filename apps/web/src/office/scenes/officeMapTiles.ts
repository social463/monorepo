import type { MapDocumentV1 } from '@legends/shared'

interface MapTileFrame {
  key: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Resolve um tile do atlas para um frame real do Phaser. Usar um frame, em vez
 * de crop na textura inteira, mantém o tamanho correto quando a imagem recebe
 * setDisplaySize no runtime do escritório.
 */
export function officeMapTileFrame(
  tileset: MapDocumentV1['tilesets'][number],
  tileIndex: number,
): MapTileFrame | null {
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= tileset.tileCount) {
    return null
  }

  return {
    key: `${tileset.id}-${tileIndex}`,
    x: (tileIndex % tileset.columns) * tileset.tileWidth,
    y: Math.floor(tileIndex / tileset.columns) * tileset.tileHeight,
    width: tileset.tileWidth,
    height: tileset.tileHeight,
  }
}
