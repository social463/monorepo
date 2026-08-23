import { useEffect, useRef, useState } from 'react'
import {
  CHARACTER_FRAME_SIZE,
  CHARACTER_ROW_BY_DIRECTION,
  type BodyType,
  type LpcCatalogEntry,
} from '@legends/shared'
import { characterAssetUrl } from '../../lib/character'

const SIZE = CHARACTER_FRAME_SIZE // frame idle-down em tamanho natural (64px, CSS escala)
const thumbCache = new Map<string, Promise<string>>()

/**
 * Pastas a desenhar, na ordem correta (zPos asc — bg antes de fg). Exportado
 * só para teste: ~54 defs guardam fg antes de bg no JSON, então iterar
 * entry.layers na ordem de inserção pinta o fundo por cima da frente.
 */
export function thumbLayerFolders(entry: LpcCatalogEntry, bodyType: BodyType): string[] {
  return [...entry.layers]
    .sort((a, b) => a.zPos - b.zPos)
    .map((l) => l.paths[bodyType])
    .filter((f): f is string => Boolean(f))
}

function drawThumb(entry: LpcCatalogEntry, variant: string, bodyType: BodyType): Promise<string> {
  const key = `${entry.id}|${variant}|${bodyType}`
  const cached = thumbCache.get(key)
  if (cached) return cached
  const promise = (async () => {
    const folders = thumbLayerFolders(entry, bodyType)
    const images = await Promise.all(
      folders.map(
        (folder) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = () => reject(new Error(`falha ao carregar ${folder}/${variant}.png`))
            img.src = characterAssetUrl(`${folder}/${variant}.png`)
          }),
      ),
    )
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d indisponível')
    ctx.imageSmoothingEnabled = false
    const sy = CHARACTER_ROW_BY_DIRECTION.down * CHARACTER_FRAME_SIZE
    for (const img of images) ctx.drawImage(img, 0, sy, SIZE, SIZE, 0, 0, SIZE, SIZE)
    return canvas.toDataURL('image/png')
  })()
  promise.catch(() => thumbCache.delete(key))
  thumbCache.set(key, promise)
  return promise
}

/** Thumbnail do item isolado (frame parado de frente), carregado só quando visível. */
export function LayerThumb({
  entry,
  variant,
  bodyType,
}: {
  entry: LpcCatalogEntry
  variant: string
  bodyType: BodyType
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '128px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let alive = true
    drawThumb(entry, variant, bodyType)
      .then((u) => alive && setUri(u))
      .catch(() => alive && setUri(null))
    return () => {
      alive = false
    }
  }, [visible, entry, variant, bodyType])

  return (
    <div ref={ref} className="h-full w-full" style={{ imageRendering: 'pixelated' }}>
      {uri ? (
        <img src={uri} alt="" className="h-full w-full object-contain" />
      ) : (
        <div className="h-full w-full animate-pulse bg-surface-container-highest" />
      )}
    </div>
  )
}
