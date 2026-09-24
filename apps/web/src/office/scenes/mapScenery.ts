import Phaser from 'phaser'
import type { MapDocumentV1, MapObjectV1, OfficeMapAssetDTO } from '@legends/shared'
import { officeMapTileFrame } from './officeMapTiles'

/**
 * Desenho do CENÁRIO de um mapa publicado: as camadas de tile e os
 * tile-objects, com opacidade, profundidade, espelhamento e giro.
 *
 * Mora fora da `OfficeScene` porque o cenário não é do escritório — é do
 * documento. A arena joga o mesmo formato de mapa com outro runtime, e sem
 * isto teria uma segunda cópia da leitura de tileset: qualquer mudança no
 * formato precisaria ser feita em dois lugares, e a que ficasse para trás
 * apareceria como mapa desenhado errado só numa das telas.
 *
 * O que NÃO entra aqui é o que tem semântica de produto — mesa, zona, link,
 * bola, kart. Isso é ciclo de vida de cada tela, e cada uma trata do seu.
 */

/** Prefixo da textura de um asset de mapa. Único ponto que forma essa key. */
export function mapAssetTextureKey(assetId: string): string {
  return `office-map-asset-${assetId}`
}

/**
 * Garante as texturas dos assets do mapa. Assíncrono porque o `Loader` do
 * Phaser é assíncrono — quem chama no `create()` precisa esperar antes de
 * desenhar, senão desenha com textura ausente e some tudo.
 */
export function ensureMapAssets(
  scene: Phaser.Scene,
  assets: readonly OfficeMapAssetDTO[],
): Promise<void> {
  const missing = assets.filter((asset) => !scene.textures.exists(mapAssetTextureKey(asset.id)))
  if (missing.length === 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    for (const asset of missing) scene.load.image(mapAssetTextureKey(asset.id), asset.url)
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve())
    scene.load.start()
  })
}

export interface MapSceneryOptions {
  /**
   * Chance de a tela desenhar um tile-object do seu jeito (o escritório troca
   * bola e kart por sprites próprios). Devolver `null` deixa o desenho padrão.
   */
  overrideObject?(object: MapObjectV1, assetId: string): Phaser.GameObjects.Image | null
}

export interface MapScenery {
  /** Tudo que foi criado, para destruir de uma vez ao redesenhar. */
  images: Phaser.GameObjects.Image[]
  /** Só os tile-objects, por id — quem precisa mexer numa peça depois. */
  byObjectId: Map<string, Phaser.GameObjects.Image>
}

export function renderMapScenery(
  scene: Phaser.Scene,
  document: MapDocumentV1,
  assets: readonly OfficeMapAssetDTO[],
  options: MapSceneryOptions = {},
): MapScenery {
  const images: Phaser.GameObjects.Image[] = []
  const byObjectId = new Map<string, Phaser.GameObjects.Image>()
  const tilesets = new Map(document.tilesets.map((tileset) => [tileset.id, tileset]))
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const layerByKey = new Map(document.layers.map((layer) => [layer.key, layer]))

  /** Recorte do tile dentro do sheet, registrado uma vez por textura. */
  const frameFor = (tilesetId: string, tileIndex: number) => {
    const tileset = tilesets.get(tilesetId)
    const asset = tileset ? assetById.get(tileset.assetId) : null
    const frame = tileset ? officeMapTileFrame(tileset, tileIndex) : null
    if (!tileset || !asset || !frame) return null
    const textureKey = mapAssetTextureKey(asset.id)
    const texture = scene.textures.get(textureKey)
    if (!texture.has(frame.key)) {
      texture.add(frame.key, 0, frame.x, frame.y, frame.width, frame.height)
    }
    return { textureKey, frameKey: frame.key, assetId: tileset.assetId }
  }

  for (const layer of [...document.layers].sort((a, b) => a.zIndex - b.zIndex)) {
    if (!layer.visible || layer.type !== 'tile') continue
    layer.data.forEach((reference, index) => {
      if (!reference) return
      // A referência é `<tilesetId>:<tileIndex>`, e o id pode conter `:`
      // (`builtin:office/...`) — daí o último separador, não o primeiro.
      const separator = reference.lastIndexOf(':')
      const cut = frameFor(reference.slice(0, separator), Number(reference.slice(separator + 1)))
      if (!cut) return
      const x = index % document.map.width
      const y = Math.floor(index / document.map.width)
      images.push(
        scene.add
          .image(
            x * document.map.tileWidth + document.map.tileWidth / 2,
            y * document.map.tileHeight + document.map.tileHeight / 2,
            cut.textureKey,
            cut.frameKey,
          )
          .setDisplaySize(document.map.tileWidth, document.map.tileHeight)
          .setAlpha(layer.opacity)
          .setDepth(layer.zIndex),
      )
    })
  }

  for (const object of document.objects) {
    if (object.type !== 'tile-object') continue
    const layer = layerByKey.get(object.layerKey)
    if (!layer?.visible) continue
    const tileset = tilesets.get(object.properties.tilesetId)
    if (!tileset) continue

    const centerX = object.geometry.x + object.geometry.width / 2
    const centerY = object.geometry.y + object.geometry.height / 2

    const override = options.overrideObject?.(object, tileset.assetId)
    if (override) {
      override.setAlpha(layer.opacity).setDepth(layer.zIndex)
      images.push(override)
      byObjectId.set(object.id, override)
      continue
    }

    const cut = frameFor(object.properties.tilesetId, object.properties.tileIndex)
    if (!cut) continue
    const image = scene.add
      .image(centerX, centerY, cut.textureKey, cut.frameKey)
      .setDisplaySize(object.geometry.width, object.geometry.height)
      .setAlpha(layer.opacity)
      .setDepth(layer.zIndex)
    // Flip é local ao sprite e o ângulo vem depois — é exatamente o modelo
    // assumido pela composição em `flipOrientation` (`H ∘ R(θ) = R(-θ) ∘ H`).
    image.setFlipX(object.properties.flipX ?? false)
    image.setAngle(object.properties.rotation ?? 0)
    images.push(image)
    byObjectId.set(object.id, image)
  }

  return { images, byObjectId }
}
