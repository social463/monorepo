import { render, screen, fireEvent } from '@testing-library/react'
import { groupBySectorMulti, SectorChecklist } from './shared'

describe('groupBySectorMulti', () => {
  const sectors = [
    { id: 's1', name: 'Comercial' },
    { id: 's2', name: 'Produto' },
  ]

  it('coloca item global só no grupo Global', () => {
    const items = [{ id: 'a', global: true, sectorIds: [] }]
    const groups = groupBySectorMulti(items, sectors)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: '__global__', name: 'Global' })
    expect(groups[0].items).toEqual(items)
  })

  it('item específico de dois setores aparece nos dois grupos', () => {
    const items = [{ id: 'b', global: false, sectorIds: ['s1', 's2'] }]
    const groups = groupBySectorMulti(items, sectors)
    const bySector = groups.filter((g) => g.key !== '__global__')
    expect(bySector).toHaveLength(2)
    expect(bySector.every((g) => g.items.some((i) => i.id === 'b'))).toBe(true)
  })

  it('não gera grupo Global quando não há item global', () => {
    const items = [{ id: 'c', global: false, sectorIds: ['s1'] }]
    const groups = groupBySectorMulti(items, sectors)
    expect(groups.find((g) => g.key === '__global__')).toBeUndefined()
  })

  it('não gera grupo de um setor sem nenhum item específico associado', () => {
    const items = [{ id: 'd', global: false, sectorIds: ['s1'] }]
    const groups = groupBySectorMulti(items, sectors)
    expect(groups.find((g) => g.name === 'Produto')).toBeUndefined()
  })

  it('item rascunho (não global, sem setor) aparece no grupo "Sem setor"', () => {
    const items = [{ id: 'e', global: false, sectorIds: [] }]
    const groups = groupBySectorMulti(items, sectors)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: '__sem-setor__', name: 'Sem setor' })
    expect(groups[0].items).toEqual(items)
  })

  it('item de setor específico não cai no grupo "Sem setor"', () => {
    const items = [{ id: 'f', global: false, sectorIds: ['s1'] }]
    const groups = groupBySectorMulti(items, sectors)
    expect(groups.find((g) => g.key === '__sem-setor__')).toBeUndefined()
  })
})

describe('SectorChecklist', () => {
  const sectors = [
    { id: 's1', name: 'Comercial' },
    { id: 's2', name: 'Produto' },
  ]

  it('mostra um checkbox por setor, marcado conforme selected', () => {
    render(<SectorChecklist sectors={sectors} selected={new Set(['s1'])} onToggle={() => {}} />)
    expect(screen.getByLabelText('Comercial')).toBeChecked()
    expect(screen.getByLabelText('Produto')).not.toBeChecked()
  })

  it('chama onToggle com o sectorId ao clicar', () => {
    const onToggle = vi.fn()
    render(<SectorChecklist sectors={sectors} selected={new Set()} onToggle={onToggle} />)
    fireEvent.click(screen.getByLabelText('Produto'))
    expect(onToggle).toHaveBeenCalledWith('s2')
  })
})
