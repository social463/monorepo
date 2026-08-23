import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoardToolbar } from './BoardToolbar'

describe('BoardToolbar', () => {
  it('mostra as ferramentas e marca a ativa', () => {
    render(<BoardToolbar tool="vote" onSelectTool={() => {}} />)
    expect(screen.getByRole('button', { name: /cursor/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: /adicionar post-it/i })).toBeNull()
    expect(screen.getByRole('button', { name: /adicionar forma/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reagir/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /votar/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('dispara onSelectTool com a ferramenta clicada', () => {
    const onSelectTool = vi.fn()
    render(<BoardToolbar tool="cursor" onSelectTool={onSelectTool} />)
    fireEvent.click(screen.getByRole('button', { name: /votar/i }))
    expect(onSelectTool).toHaveBeenCalledWith('vote')
  })
})
