import { useEffect, useRef, useState } from 'react'
import {
  builtinTilesetAsset,
  officeAssetCategories,
  officeAssetsForTileSize,
  officeAssetTilesetId,
  type OfficeAssetCatalogEntry,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import type { SelectedTileRegion } from '../editing/useOfficeMapEditing'

/** Cache de imagens de tileset por URL — evita recarregar a mesma sheet por thumbnail. */
const imageCache = new Map<string, Promise<HTMLImageElement>>()
function loadTilesetImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
  imageCache.set(url, promise)
  return promise
}

/** Thumbnail de um asset: desenha a região de tiles do sheet num canvas, preservando o aspecto. */
function AssetThumbnail({ asset, tileSize, size = 56 }: { asset: OfficeAssetCatalogEntry; tileSize: number; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const tileset = builtinTilesetAsset(officeAssetTilesetId(asset.sheet, tileSize))
    if (!tileset) return
    let cancelled = false
    void loadTilesetImage(tileset.url).then((img) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (cancelled || !canvas || !ctx) return
      const tw = tileset.tileWidth
      const sw = asset.cols * tw
      const sh = asset.rows * tw
      const scale = Math.min(size / sw, size / sh)
      const dw = sw * scale
      const dh = sh * scale
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(img, asset.col * tw, asset.row * tw, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh)
    })
    return () => {
      cancelled = true
    }
  }, [asset, tileSize, size])
  return <canvas ref={canvasRef} width={size} height={size} className="h-14 w-14 [image-rendering:pixelated]" aria-hidden />
}

export interface AssetPaletteProps {
  /** Tamanho de tile do mapa — escolhe a variante do sheet e o pixel do thumbnail. */
  tileSize: number
  selected: SelectedTileRegion | null
  onSelect: (region: SelectedTileRegion) => void
  /** Clicar de novo no asset já selecionado solta a seleção (volta ao "cursor normal" — review PR 10555). */
  onDeselect: () => void
  onClearAll: () => void
}

/**
 * Paleta de assets prontos (estilo Gather): abas por categoria + grade de
 * thumbnails clicáveis. Clicar seleciona a região do asset — o placement de
 * grupo (mobília atômica) coloca todos os slices alinhados. Substitui a escolha
 * de tiles crus da `TilesetPalette` no fluxo de mobília.
 */
/** Normaliza para busca: minúsculas, sem acento. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export default function AssetPalette({ tileSize, selected, onSelect, onDeselect, onClearAll }: AssetPaletteProps) {
  const allAssets = officeAssetsForTileSize(tileSize)
  const categories = officeAssetCategories(allAssets)
  const [activeCategory, setActiveCategory] = useState(categories[0]?.category ?? '')
  const [query, setQuery] = useState('')

  const trimmed = normalize(query.trim())
  // Busca ignora a categoria ativa e varre tudo (nome + categoria). Sem busca,
  // mostra a aba selecionada.
  const visible = trimmed
    ? allAssets.filter((a) => normalize(a.name).includes(trimmed) || normalize(a.category).includes(trimmed))
    : (categories.find((c) => c.category === activeCategory) ?? categories[0])?.entries ?? []

  const isSelected = (asset: OfficeAssetCatalogEntry) =>
    selected != null &&
    selected.assetId === officeAssetTilesetId(asset.sheet, tileSize) &&
    selected.col === asset.col &&
    selected.row === asset.row &&
    selected.cols === asset.cols &&
    selected.rows === asset.rows

  return (
    <section aria-label="Assets do escritório">
      <div className="relative mb-sm">
        <Icon
          name="search"
          className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar móvel…"
          aria-label="Buscar asset"
          className="w-full rounded-full border border-outline-variant/40 bg-surface-container-high py-xs pl-9 pr-sm font-label text-label-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
        />
      </div>

      {!trimmed && (
        <div className="mb-sm flex flex-wrap gap-xs" role="tablist" aria-label="Categorias">
          {categories.map((category) => {
            const activeTab = category.category === activeCategory
            return (
              <button
                key={category.category}
                type="button"
                role="tab"
                aria-selected={activeTab}
                onClick={() => setActiveCategory(category.category)}
                className={`rounded-full px-md py-xs font-label text-label-sm transition-colors ${
                  activeTab
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                }`}
              >
                {category.category}
              </button>
            )
          })}
        </div>
      )}

      {trimmed && visible.length === 0 ? (
        <p className="py-lg text-center font-label text-label-sm text-on-surface-variant">Nenhum móvel encontrado.</p>
      ) : (
        <div className="grid grid-cols-3 gap-sm">
          {visible.map((asset) => {
            const selectedAsset = isSelected(asset)
            return (
              <button
                key={asset.id}
                type="button"
                aria-pressed={selectedAsset}
                title={selectedAsset ? `${asset.name} (clique para soltar)` : asset.name}
                onClick={() =>
                  selectedAsset
                    ? onDeselect()
                    : onSelect({
                        assetId: officeAssetTilesetId(asset.sheet, tileSize),
                        col: asset.col,
                        row: asset.row,
                        cols: asset.cols,
                        rows: asset.rows,
                        category: asset.category,
                      })
                }
                className={`flex flex-col items-center gap-xs rounded-xl border p-xs transition-colors ${
                  selectedAsset
                    ? 'border-primary bg-primary-container'
                    : 'border-outline-variant/40 bg-surface-container-high hover:bg-surface-container-highest'
                }`}
              >
                <AssetThumbnail asset={asset} tileSize={tileSize} />
                <span
                  className={`w-full truncate text-center font-label text-[11px] font-medium leading-tight ${
                    selectedAsset ? 'text-on-primary-container' : 'text-on-surface'
                  }`}
                >
                  {asset.name}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onClearAll}
        title="Remove a mobília que você adicionou nesta sessão (ainda não salva)"
        className="mt-md flex w-full items-center justify-center gap-xs rounded-full border border-outline-variant/40 px-md py-sm font-label text-label-sm text-on-surface-variant transition-colors hover:bg-error-container/60 hover:text-on-error-container"
      >
        <Icon name="delete_sweep" className="text-[18px]" />
        Limpar tudo
      </button>
    </section>
  )
}
