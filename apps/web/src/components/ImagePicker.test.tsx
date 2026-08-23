import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImagePicker } from './ImagePicker'

describe('ImagePicker', () => {
  it('renderiza o botão Imagem', () => {
    render(<ImagePicker onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /imagem/i })).toBeInTheDocument()
  })

  it('desabilita o botão quando disabled', () => {
    render(<ImagePicker onSelect={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: /imagem/i })).toBeDisabled()
  })
})
