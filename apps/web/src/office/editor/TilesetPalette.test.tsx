import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OFFICE_TILESET_CATALOG } from '@legends/shared'
import TilesetPalette from './TilesetPalette'

describe('TilesetPalette', () => {
  it('clique simples seleciona uma região 1x1 e emite builtin', () => {
    const onSelectTile = vi.fn()
    // usa um tileset do catálogo e passa o mesmo tile size do mapa, pois o
    // palette filtra por `mapTileWidth`.
    const first = OFFICE_TILESET_CATALOG[0]
    render(
      <TilesetPalette
        mapAssets={[]}
        mapTilesets={[]}
        mapTileWidth={first.tileWidth}
        selected={null}
        onSelectTile={onSelectTile}
      />,
    )
    fireEvent.click(screen.getByText(first.name))
    const cells = screen.getAllByTestId('tileset-cell')
    fireEvent.pointerDown(cells[0])
    fireEvent.pointerUp(window)
    expect(onSelectTile).toHaveBeenCalledWith(
      expect.objectContaining({ isBuiltin: true, col: 0, row: 0, cols: 1, rows: 1 }),
    )
  })

  it('arrastar seleciona um bloco de vários tiles', () => {
    const onSelectTile = vi.fn()
    const first = OFFICE_TILESET_CATALOG[0]
    render(
      <TilesetPalette
        mapAssets={[]}
        mapTilesets={[]}
        mapTileWidth={first.tileWidth}
        selected={null}
        onSelectTile={onSelectTile}
      />,
    )
    fireEvent.click(screen.getByText(first.name))
    const cells = screen.getAllByTestId('tileset-cell')
    // células 0 e 1 estão na mesma linha (columns >= 2) → região 2x1
    fireEvent.pointerDown(cells[0])
    fireEvent.pointerEnter(cells[1])
    fireEvent.pointerUp(window)
    expect(onSelectTile).toHaveBeenLastCalledWith(
      expect.objectContaining({ isBuiltin: true, col: 0, row: 0, cols: 2, rows: 1 }),
    )
  })
})
