import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RETRO_REACTION_EMOJIS } from '@legends/shared'
import { ReactionFlyout } from './ReactionFlyout'

describe('ReactionFlyout', () => {
  it('mostra todas as reações + borracha e marca a ativa', () => {
    render(<ReactionFlyout active="🔥" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /Reagir com 👍/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(RETRO_REACTION_EMOJIS.length + 1)
    expect(screen.getByRole('button', { name: /Reagir com 🔥/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('dispara onSelect com o emoji e com a borracha', () => {
    const onSelect = vi.fn()
    render(<ReactionFlyout active={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /Reagir com ❤️/ }))
    expect(onSelect).toHaveBeenCalledWith('❤️')
    fireEvent.click(screen.getByRole('button', { name: /Borracha/i }))
    expect(onSelect).toHaveBeenCalledWith('eraser')
  })
})
