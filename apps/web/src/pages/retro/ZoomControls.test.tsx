import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ZoomControls } from './ZoomControls'

describe('ZoomControls', () => {
  it('mostra o zoom em % e dispara os handlers', () => {
    const onZoomIn = vi.fn(), onZoomOut = vi.fn(), onReset = vi.fn()
    render(<ZoomControls zoom={0.8} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onReset} />)
    expect(screen.getByText('80%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /aumentar zoom/i }))
    fireEvent.click(screen.getByRole('button', { name: /diminuir zoom/i }))
    fireEvent.click(screen.getByRole('button', { name: /centralizar/i }))
    expect(onZoomIn).toHaveBeenCalled()
    expect(onZoomOut).toHaveBeenCalled()
    expect(onReset).toHaveBeenCalled()
  })
})
