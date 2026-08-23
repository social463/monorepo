import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultCharacterFromSeed } from '@legends/shared'
import { PreviewPane } from './PreviewPane'

vi.mock('../CharacterPreview', () => ({
  CharacterPreview: ({ size }: { size?: number }) => <div data-testid="preview" data-size={size} />,
}))

describe('PreviewPane', () => {
  it('renderiza preview grande, Aleatório e créditos', () => {
    render(<PreviewPane options={defaultCharacterFromSeed('a')} onRandom={vi.fn()} />)
    expect(screen.getByTestId('preview').dataset.size).toBe('224')
    expect(screen.getByRole('button', { name: 'Aleatório' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /créditos/ })).toBeInTheDocument()
  })

  it('Aleatório chama onRandom', () => {
    const onRandom = vi.fn()
    render(<PreviewPane options={defaultCharacterFromSeed('a')} onRandom={onRandom} />)
    fireEvent.click(screen.getByRole('button', { name: 'Aleatório' }))
    expect(onRandom).toHaveBeenCalled()
  })

  it('compact: preview menor (128), sem créditos', () => {
    const onRandom = vi.fn()
    render(<PreviewPane compact options={defaultCharacterFromSeed('a')} onRandom={onRandom} />)
    expect(screen.getByTestId('preview').dataset.size).toBe('128')
    fireEvent.click(screen.getByRole('button', { name: 'Aleatório' }))
    expect(onRandom).toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /créditos/ })).not.toBeInTheDocument()
  })
})
