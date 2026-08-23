import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { Select, type SelectOption } from './Select'

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Arthur Pedro' },
  { value: 'b', label: 'Diego Barreto' },
  { value: 'c', label: 'Emerson Marques' },
]

function setup(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  const onChange = vi.fn()
  render(
    <Select options={OPTIONS} value="" onChange={onChange} ariaLabel="Selecionar membro" placeholder="Selecione uma lenda..." searchable {...props} />,
  )
  return { onChange }
}

test('mostra o placeholder e abre/fecha ao clicar', () => {
  setup()
  const trigger = screen.getByRole('combobox', { name: 'Selecionar membro' })
  expect(trigger).toHaveTextContent('Selecione uma lenda...')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
})

test('lista as opções e seleciona ao clicar (onChange + fecha)', () => {
  const { onChange } = setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  expect(screen.getAllByRole('option')).toHaveLength(3)
  fireEvent.click(screen.getByRole('option', { name: 'Diego Barreto' }))
  expect(onChange).toHaveBeenCalledWith('b')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('mostra o label da opção selecionada', () => {
  setup({ value: 'c' })
  expect(screen.getByRole('combobox', { name: 'Selecionar membro' })).toHaveTextContent('Emerson Marques')
})

test('a busca filtra as opções', () => {
  setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  fireEvent.change(screen.getByLabelText('Buscar em Selecionar membro'), { target: { value: 'die' } })
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.getByRole('option', { name: 'Diego Barreto' })).toBeInTheDocument()
})

test('a busca ignora acento nos dois sentidos', () => {
  setup({ options: [{ value: 'sp', label: 'São Paulo' }, { value: 'jo', label: 'Joao Silva' }] })
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  const busca = screen.getByLabelText('Buscar em Selecionar membro')

  // Termo sem acento acha o rótulo acentuado…
  fireEvent.change(busca, { target: { value: 'sao' } })
  expect(screen.getByRole('option', { name: 'São Paulo' })).toBeInTheDocument()
  expect(screen.queryAllByRole('option')).toHaveLength(1)

  // …e o termo acentuado acha o rótulo sem acento.
  fireEvent.change(busca, { target: { value: 'joão' } })
  expect(screen.getByRole('option', { name: 'Joao Silva' })).toBeInTheDocument()
})

test('mostra "Nenhum resultado" quando a busca não casa', () => {
  setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  fireEvent.change(screen.getByLabelText('Buscar em Selecionar membro'), { target: { value: 'zzz' } })
  expect(screen.queryAllByRole('option')).toHaveLength(0)
  expect(screen.getByText('Nenhum resultado')).toBeInTheDocument()
})

test('Esc fecha a caixa', () => {
  setup()
  const trigger = screen.getByRole('combobox', { name: 'Selecionar membro' })
  fireEvent.click(trigger)
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('clicar fora fecha a caixa', () => {
  setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('teclado: ArrowDown move o destaque e Enter seleciona', () => {
  const { onChange } = setup()
  const trigger = screen.getByRole('combobox', { name: 'Selecionar membro' })
  fireEvent.click(trigger)
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(onChange).toHaveBeenCalledWith('b')
})

test('sem searchable não renderiza o campo de busca', () => {
  setup({ searchable: false })
  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar membro' }))
  expect(screen.queryByLabelText('Buscar em Selecionar membro')).not.toBeInTheDocument()
})
