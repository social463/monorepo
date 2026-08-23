import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BoardInstructions } from './BoardInstructions'

describe('BoardInstructions', () => {
  it('mostra o título e os passos', () => {
    render(<BoardInstructions title="Retro Sprint 9" />)
    expect(screen.getByText('Retro Sprint 9')).toBeInTheDocument()
    expect(screen.getByText(/Escolha o tópico/i)).toBeInTheDocument()
    expect(screen.getByText(/Registrem as Ações/i)).toBeInTheDocument()
  })
})
