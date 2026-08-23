import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { GifResult } from '@legends/shared'
import { GifPicker } from './GifPicker'

const sample: GifResult[] = [
  { id: '1', url: 'https://media.giphy.com/a.gif', previewUrl: 'https://media.giphy.com/a-t.gif', width: 100, height: 80, description: 'gato' },
]

vi.mock('../lib/use-gifs', () => ({
  useGifSearch: () => ({ results: sample, fetchNextPage: vi.fn(), hasNextPage: false, isLoading: false }),
}))

describe('GifPicker', () => {
  it('renderiza a grade e chama onSelect ao clicar', () => {
    const onSelect = vi.fn()
    render(<GifPicker onSelect={onSelect} onClose={() => {}} />)
    const img = screen.getByAltText('gato')
    fireEvent.click(img)
    expect(onSelect).toHaveBeenCalledWith(sample[0])
  })

  it('mostra a atribuição do GIPHY', () => {
    render(<GifPicker onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/GIPHY/i)).toBeTruthy()
  })
})
