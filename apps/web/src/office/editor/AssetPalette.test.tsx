import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OFFICE_ASSET_CATALOG, officeAssetCategories, officeAssetTilesetId } from '@legends/shared'
import AssetPalette from './AssetPalette'

// Deriva os casos do próprio catálogo — resiliente a ajustes de curadoria.
// Usa assets de nome ÚNICO (nomes podem repetir entre variações) para os
// seletores por título não ficarem ambíguos.
const nameCounts = new Map<string, number>()
for (const a of OFFICE_ASSET_CATALOG) nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1)
const isUnique = (a: (typeof OFFICE_ASSET_CATALOG)[number]) => nameCounts.get(a.name) === 1

const categories = officeAssetCategories()
const firstCategory = categories.find((c) => c.entries.some(isUnique))!
const firstAsset = firstCategory.entries.find(isUnique)!
const otherCategory = categories.find((c) => c.category !== firstCategory.category && c.entries.some(isUnique))!
const otherAsset = otherCategory.entries.find(isUnique)!

describe('AssetPalette', () => {
  it('clicar num asset seleciona a região com o assetId do tamanho do mapa', () => {
    const onSelect = vi.fn()
    render(<AssetPalette tileSize={32} selected={null} onSelect={onSelect} onDeselect={() => {}} onClearAll={() => {}} />)

    fireEvent.click(screen.getByTitle(firstAsset.name))
    expect(onSelect).toHaveBeenCalledWith({
      assetId: officeAssetTilesetId(firstAsset.sheet, 32),
      col: firstAsset.col,
      row: firstAsset.row,
      cols: firstAsset.cols,
      rows: firstAsset.rows,
      category: firstAsset.category,
    })
  })

  it('clicar de novo no asset já selecionado dispara onDeselect em vez de onSelect', () => {
    const onSelect = vi.fn()
    const onDeselect = vi.fn()
    render(
      <AssetPalette
        tileSize={32}
        selected={{
          assetId: officeAssetTilesetId(firstAsset.sheet, 32),
          col: firstAsset.col,
          row: firstAsset.row,
          cols: firstAsset.cols,
          rows: firstAsset.rows,
          category: firstAsset.category,
        }}
        onSelect={onSelect}
        onDeselect={onDeselect}
        onClearAll={() => {}}
      />,
    )
    fireEvent.click(screen.getByTitle(`${firstAsset.name} (clique para soltar)`))
    expect(onDeselect).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('troca de categoria mostra os assets daquela aba', () => {
    render(<AssetPalette tileSize={32} selected={null} onSelect={() => {}} onDeselect={() => {}} onClearAll={() => {}} />)
    // Um asset de outra categoria não aparece na aba inicial…
    expect(screen.queryByTitle(otherAsset.name)).toBeNull()
    // …até trocar de aba.
    fireEvent.click(screen.getByRole('tab', { name: otherCategory.category }))
    expect(screen.getByTitle(otherAsset.name)).toBeTruthy()
  })

  it('busca varre todas as categorias e some com as abas enquanto pesquisa', () => {
    render(<AssetPalette tileSize={32} selected={null} onSelect={() => {}} onDeselect={() => {}} onClearAll={() => {}} />)
    const input = screen.getByRole('searchbox', { name: 'Buscar asset' })

    // Busca o asset de OUTRA categoria (que não aparece na aba inicial)…
    fireEvent.change(input, { target: { value: otherAsset.name } })
    expect(screen.getByTitle(otherAsset.name)).toBeTruthy()
    // …e as abas de categoria somem durante a busca.
    expect(screen.queryByRole('tablist')).toBeNull()

    // Busca sem resultado mostra o aviso.
    fireEvent.change(input, { target: { value: 'zzxqwzzz-nao-existe' } })
    expect(screen.getByText('Nenhum móvel encontrado.')).toBeTruthy()
  })

  it('"Limpar tudo" dispara onClearAll', () => {
    const onClearAll = vi.fn()
    render(<AssetPalette tileSize={32} selected={null} onSelect={() => {}} onDeselect={() => {}} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByText('Limpar tudo'))
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('todas as categorias do catálogo viram abas', () => {
    render(<AssetPalette tileSize={32} selected={null} onSelect={() => {}} onDeselect={() => {}} onClearAll={() => {}} />)
    for (const category of new Set(OFFICE_ASSET_CATALOG.map((a) => a.category))) {
      expect(screen.getByRole('tab', { name: category })).toBeTruthy()
    }
  })
})
