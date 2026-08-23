import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VoteFlyout } from './VoteFlyout'

describe('VoteFlyout', () => {
  it('mostra votos restantes e marca o modo ativo', () => {
    render(<VoteFlyout mode="add" onSelect={() => {}} remaining={2} />)
    expect(screen.getByText(/Votos restantes:\s*2/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^votar$/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /remover voto/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('dispara onSelect com add e remove', () => {
    const onSelect = vi.fn()
    render(<VoteFlyout mode="add" onSelect={onSelect} remaining={3} />)
    fireEvent.click(screen.getByRole('button', { name: /remover voto/i }))
    expect(onSelect).toHaveBeenCalledWith('remove')
    fireEvent.click(screen.getByRole('button', { name: /^votar$/i }))
    expect(onSelect).toHaveBeenCalledWith('add')
  })
})
