import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { defaultCharacterFromSeed, type CharacterOptions } from '@legends/shared'
import { WardrobePanel } from './WardrobePanel'

vi.mock('./LayerThumb', () => ({
  LayerThumb: () => <div data-testid="thumb" />,
}))

function renderPanel(initial?: CharacterOptions) {
  const options = initial ?? defaultCharacterFromSeed('teste')
  const onChange = vi.fn()
  render(<WardrobePanel options={options} onChange={onChange} />)
  return { options, onChange }
}

describe('WardrobePanel', () => {
  it('mostra grupos, categorias e a grade da categoria ativa', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Equipamento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fantasia' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Corpo', pressed: true })).toBeInTheDocument()
  })

  it('busca filtra a grade de itens', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cabelo' }))
    fireEvent.change(screen.getByLabelText('Buscar item…'), { target: { value: 'afro' } })
    expect(await screen.findByRole('button', { name: /Afro/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Curly/ })).not.toBeInTheDocument()
  })

  it('clicar num item chama onChange com o item aplicado', () => {
    const { onChange } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: /^Afro$/ }))
    const next = onChange.mock.lastCall?.[0] as CharacterOptions
    expect(next.items.hair?.item).toBe('hair_afro')
  })

  it('trocar o corpo dropa itens incompatíveis e realoca categoria stale', () => {
    const base = defaultCharacterFromSeed('teste')
    const withBeard = {
      ...base,
      bodyType: 'male' as const,
      items: { ...base.items, beard: { item: 'beards_beard', variant: 'black' } },
    }
    const onChange = vi.fn()
    // Host controlado: reflete onChange de volta em `options`, como o
    // CharacterEditorPage (pai real) faz — WardrobePanel não guarda bodyType/items,
    // então sem esse eco a grade nunca refletiria a troca de corpo.
    function Host({ onChangeSpy }: { onChangeSpy: Mock }) {
      const [options, setOptions] = useState<CharacterOptions>(withBeard)
      return (
        <WardrobePanel
          options={options}
          onChange={(next) => {
            onChangeSpy(next)
            setOptions(next)
          }}
        />
      )
    }
    render(<Host onChangeSpy={onChange} />)
    // seleciona a categoria beard, depois troca para um corpo sem barba
    fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Barba' }))
    fireEvent.click(screen.getByRole('button', { name: 'Criança' }))
    const next = onChange.mock.lastCall?.[0] as CharacterOptions
    expect(next.bodyType).toBe('child')
    expect(next.items.beard).toBeUndefined()
    // categoria ativa realocada: "Barba" some e o fallback (primeira categoria
    // do grupo ativo com itens pra child = "Cabelo") fica pressed — cobre o
    // branch `if (itemsForCategory(category, bt).length === 0)` do changeBodyType
    expect(screen.queryByRole('button', { name: 'Barba' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cabelo', pressed: true })).toBeInTheDocument()
  })

  it('variantes do item selecionado chamam onChange com a variante', () => {
    const base = defaultCharacterFromSeed('teste')
    const withHair = { ...base, items: { ...base.items, hair: { item: 'hair_afro', variant: 'blonde' } } }
    const onChange = vi.fn()
    render(<WardrobePanel options={withHair} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rosto & Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cabelo' }))
    fireEvent.click(screen.getByRole('button', { name: 'variante ash' }))
    const next = onChange.mock.lastCall?.[0] as CharacterOptions
    expect(next.items.hair).toEqual({ item: 'hair_afro', variant: 'ash' })
  })
})
