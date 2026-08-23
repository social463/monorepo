import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FloatingReactionBar } from './FloatingReactionBar'
import { RETRO_FLOAT_REACTIONS } from '@legends/shared'

describe('FloatingReactionBar', () => {
  it('renderiza um botão por emoji e dispara onReact com o emoji clicado', () => {
    const onReact = vi.fn()
    render(<FloatingReactionBar onReact={onReact} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(RETRO_FLOAT_REACTIONS.length)
    fireEvent.click(screen.getByText('❤️'))
    expect(onReact).toHaveBeenCalledWith('❤️')
  })
})
