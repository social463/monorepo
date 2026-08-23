import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuadrantPads } from './QuadrantPads'

describe('QuadrantPads', () => {
  it('mostra um pad por quadrante colorido e inicia o pull no pointerdown', () => {
    const onPullStart = vi.fn()
    render(<QuadrantPads onPullStart={onPullStart} />)
    const pads = screen.getAllByRole('button', { name: /novo card em/i })
    expect(pads).toHaveLength(4)
    fireEvent.pointerDown(screen.getByRole('button', { name: /novo card em o que foi ruim/i }))
    expect(onPullStart).toHaveBeenCalledTimes(1)
    expect(onPullStart.mock.calls[0][0]).toBe('went_bad')
  })
})
