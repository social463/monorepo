import { useEffect, useState, type ReactNode } from 'react'
import {
  officeTilesetCategories, isBuiltinTilesetAssetId,
  type OfficeMapAssetDTO, type MapTilesetV1, type OfficeTilesetCatalogEntry,
} from '@legends/shared'
import { Icon } from '../../components/Icon'

const CELL = 32

/** Região retangular de tiles selecionada, em coordenadas de tile do tileset. */
export interface TileRegion {
  col: number
  row: number
  cols: number
  rows: number
}

export interface TilesetPaletteProps {
  mapAssets: OfficeMapAssetDTO[]
  mapTilesets: MapTilesetV1[]
  /** Tile size do mapa ativo — só mostramos tilesets padrão desse tamanho
   * (a validação exige `tileset.tileWidth === map.tileWidth`). */
  mapTileWidth: number
  selected: ({ assetId: string } & TileRegion) | null
  onSelectTile: (pick: {
    entry: OfficeTilesetCatalogEntry | OfficeMapAssetDTO
    isBuiltin: boolean
  } & TileRegion) => void
}

function regionFromIndices(a: number, b: number, columns: number): TileRegion {
  const ac = a % columns
  const ar = Math.floor(a / columns)
  const bc = b % columns
  const br = Math.floor(b / columns)
  return {
    col: Math.min(ac, bc),
    row: Math.min(ar, br),
    cols: Math.abs(ac - bc) + 1,
    rows: Math.abs(ar - br) + 1,
  }
}

/**
 * Arraste de região numa grade de tiles: `pointerdown` numa célula abre a
 * região, `pointerenter` nas vizinhas estende, soltar em qualquer lugar
 * (listener global) fecha. Compartilhado com a paleta do tileset selecionado
 * no editor do admin, para as duas grades escolherem bloco do mesmo jeito.
 */
export function useTileRegionDrag(
  columns: number,
  onSelectRegion: (region: TileRegion) => void,
) {
  const [drag, setDrag] = useState<{ start: number; current: number } | null>(null)

  useEffect(() => {
    if (!drag) return
    const finish = () => {
      onSelectRegion(regionFromIndices(drag.start, drag.current, columns))
      setDrag(null)
    }
    window.addEventListener('pointerup', finish)
    return () => window.removeEventListener('pointerup', finish)
  }, [drag, columns, onSelectRegion])

  return {
    /** Região sendo arrastada agora, ou `null` fora de um arraste. */
    dragRegion: drag ? regionFromIndices(drag.start, drag.current, columns) : null,
    /** Handlers da célula de índice `i`. */
    cellHandlers: (i: number) => ({
      onPointerDown: () => setDrag({ start: i, current: i }),
      onPointerEnter: () => setDrag((d) => (d ? { ...d, current: i } : d)),
    }),
  }
}

function TileGrid(props: {
  url: string; columns: number; tileCount: number; tileWidth: number; tileHeight: number
  selectedRegion: TileRegion | null
  onSelectRegion: (region: TileRegion) => void
}) {
  const { url, columns, tileCount, tileWidth, tileHeight, selectedRegion, onSelectRegion } = props
  const scaleW = (CELL / tileWidth) * columns * tileWidth
  const { dragRegion, cellHandlers } = useTileRegionDrag(columns, onSelectRegion)

  const region = dragRegion ?? selectedRegion
  const inRegion = (i: number) => {
    if (!region) return false
    const c = i % columns
    const r = Math.floor(i / columns)
    return c >= region.col && c < region.col + region.cols && r >= region.row && r < region.row + region.rows
  }

  return (
    <div className="max-h-60 overflow-auto rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-xs">
      <div
        className="grid w-max"
        style={{ gridTemplateColumns: `repeat(${columns}, ${CELL}px)`, gap: 1, userSelect: 'none', touchAction: 'none' }}
      >
        {Array.from({ length: tileCount }, (_, i) => {
          const col = i % columns
          const row = Math.floor(i / columns)
          const isSelected = inRegion(i)
          return (
            <button
              key={i}
              type="button"
              data-testid="tileset-cell"
              aria-pressed={isSelected}
              draggable={false}
              {...cellHandlers(i)}
              style={{
                width: CELL, height: CELL,
                backgroundImage: `url(${url})`,
                backgroundSize: `${scaleW}px auto`,
                backgroundPosition: `-${col * CELL}px -${row * CELL}px`,
                imageRendering: 'pixelated',
                border: isSelected ? '2px solid #52fba2' : '1px solid rgba(60,74,63,0.6)',
                outline: isSelected ? '2px solid #52fba2' : 'none',
                outlineOffset: -2,
                boxShadow: isSelected ? '0 0 0 2px rgba(82,251,162,0.45)' : 'none',
                position: 'relative',
                zIndex: isSelected ? 1 : 0,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function CollapsibleTileset(props: {
  id: string; name: string; open: boolean; onToggle: () => void
  grid: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-high">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.open}
        className="flex w-full items-center justify-between px-md py-sm text-left font-body text-body-sm text-on-surface transition-colors hover:bg-surface-container-highest"
      >
        <span className="truncate">{props.name}</span>
        <Icon
          name="expand_more"
          className={`text-[20px] text-on-surface-variant transition-transform ${props.open ? 'rotate-180' : ''}`}
        />
      </button>
      {props.open && <div className="px-xs pb-xs">{props.grid}</div>}
    </section>
  )
}

export default function TilesetPalette({ mapAssets, mapTilesets, mapTileWidth, selected, onSelectTile }: TilesetPaletteProps) {
  const [open, setOpen] = useState<string | null>(null)
  const catalogGroups = officeTilesetCategories()
    .map((group) => ({ ...group, entries: group.entries.filter((e) => e.tileWidth === mapTileWidth) }))
    .filter((group) => group.entries.length > 0)
  // "Assets do mapa" é só para assets próprios (upload/legado). Os builtins já
  // aparecem em "Tilesets padrão" acima — não repetir.
  const uploadedAssets = mapAssets.filter((asset) => !isBuiltinTilesetAssetId(asset.id))

  return (
    <div className="space-y-md">
      <div>
        <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Tilesets padrão</p>
        <p className="mt-1 text-label-sm text-on-surface-variant">Arraste para escolher vários tiles.</p>
      </div>

      {catalogGroups.length === 0 && (
        <p className="rounded-lg bg-surface-container-high px-md py-sm text-label-sm text-on-surface-variant">
          Nenhum tileset padrão para tiles de {mapTileWidth}px.
        </p>
      )}

      {catalogGroups.map((group) => (
        <div key={group.category} className="space-y-sm">
          <p className="font-label text-label-sm text-on-surface-variant">{group.category}</p>
          <div className="space-y-sm">
            {group.entries.map((entry) => (
              <CollapsibleTileset
                key={entry.id}
                id={entry.id}
                name={entry.name}
                open={open === entry.id}
                onToggle={() => setOpen(open === entry.id ? null : entry.id)}
                grid={
                  <TileGrid
                    url={entry.url} columns={entry.columns} tileCount={entry.tileCount}
                    tileWidth={entry.tileWidth} tileHeight={entry.tileHeight}
                    selectedRegion={selected?.assetId === entry.assetId ? selected : null}
                    onSelectRegion={(region) => onSelectTile({ entry, isBuiltin: true, ...region })}
                  />
                }
              />
            ))}
          </div>
        </div>
      ))}

      {uploadedAssets.length > 0 && (
        <div className="space-y-sm">
          <p className="font-label text-label-sm text-on-surface-variant">Assets do mapa</p>
          <div className="space-y-sm">
            {uploadedAssets.map((asset) => {
              const ts = mapTilesets.find((t) => t.assetId === asset.id)
              const columns = ts?.columns ?? Math.max(1, Math.floor(asset.width / 32))
              const tileCount = ts?.tileCount ?? columns * Math.floor(asset.height / 32)
              return (
                <CollapsibleTileset
                  key={asset.id}
                  id={asset.id}
                  name={asset.fileName}
                  open={open === asset.id}
                  onToggle={() => setOpen(open === asset.id ? null : asset.id)}
                  grid={
                    <TileGrid
                      url={asset.url} columns={columns} tileCount={tileCount}
                      tileWidth={ts?.tileWidth ?? 32} tileHeight={ts?.tileHeight ?? 32}
                      selectedRegion={selected?.assetId === asset.id ? selected : null}
                      onSelectRegion={(region) => onSelectTile({ entry: asset, isBuiltin: false, ...region })}
                    />
                  }
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
