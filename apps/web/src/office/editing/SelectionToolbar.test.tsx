import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SelectionToolbar from './SelectionToolbar'

describe('SelectionToolbar', () => {
  let nextFrame: FrameRequestCallback | null

  beforeEach(() => {
    nextFrame = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('expõe e dispara os quatro movimentos da pilha visual', () => {
    const onReorder = vi.fn()
    render(
      <SelectionToolbar
        canvasRef={{
          current: {
            getScene: () => ({
              worldToScreen: () => ({ x: 100, y: 80, zoom: 1 }),
            }),
          },
        } as any}
        bounds={{ x: 0, y: 0, width: 32, height: 32 }}
        onRotate={vi.fn()}
        onFlip={vi.fn()}
        onReorder={onReorder}
        onClear={vi.fn()}
        hasCollision={false}
        onRemoveCollision={vi.fn()}
      />,
    )

    act(() => {
      nextFrame?.(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Subir uma camada' }))
    fireEvent.click(screen.getByRole('button', { name: 'Trazer para frente de tudo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descer uma camada' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para trás de tudo' }))

    expect(onReorder.mock.calls.map(([direction]) => direction)).toEqual([
      'forward',
      'front',
      'backward',
      'back',
    ])
  })
})
