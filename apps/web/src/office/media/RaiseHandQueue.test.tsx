import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { RaiseHandQueue } from './RaiseHandQueue'

const ana: OfficeOccupant = {
  userId: 'ana',
  name: 'Ana Silva',
  x: 1,
  y: 1,
  dir: 'down',
  avatarSeed: null,
  avatarOptions: null,
}
const bruno: OfficeOccupant = {
  userId: 'bruno',
  name: 'Bruno Costa',
  x: 2,
  y: 1,
  dir: 'down',
  avatarSeed: null,
  avatarOptions: null,
}

describe('RaiseHandQueue', () => {
  it('fila vazia não renderiza nada', () => {
    const { container } = render(<RaiseHandQueue queue={[]} occupants={[ana, bruno]} raised={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra o contador com o tamanho da fila', () => {
    render(<RaiseHandQueue queue={['ana', 'bruno']} occupants={[ana, bruno]} raised={false} />)
    expect(screen.getByRole('button', { name: 'Expandir fila de mãos levantadas' })).toHaveTextContent('2')
  })

  it('clicar expande a lista na ordem da fila; nomes não aparecem antes de expandir', () => {
    render(<RaiseHandQueue queue={['bruno', 'ana']} occupants={[ana, bruno]} raised={false} />)
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir fila de mãos levantadas' }))

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Bruno Costa')
    expect(items[1]).toHaveTextContent('Ana Silva')
  })

  it('clicar de novo recolhe a lista', () => {
    render(<RaiseHandQueue queue={['ana']} occupants={[ana, bruno]} raised={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expandir fila de mãos levantadas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recolher fila de mãos levantadas' }))
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument()
  })

  it('raised=true já abre a lista sozinha, sem precisar clicar', () => {
    render(<RaiseHandQueue queue={['ana']} occupants={[ana, bruno]} raised={true} />)
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recolher fila de mãos levantadas' })).toBeInTheDocument()
  })

  it('raised=false não abre a lista sozinha', () => {
    render(<RaiseHandQueue queue={['ana']} occupants={[ana, bruno]} raised={false} />)
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument()
  })
})
