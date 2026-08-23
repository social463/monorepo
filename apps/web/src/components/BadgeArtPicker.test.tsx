import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BadgeArtPicker } from './BadgeArtPicker'
import { BADGE_ART, badgeArt } from '../lib/badge-art'

describe('BadgeArtPicker', () => {
  it('renderiza um botão por ilustração do catálogo', () => {
    render(<BadgeArtPicker value="" onChange={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(BADGE_ART.length)
  })

  it('dispara onChange com a chave ao clicar', () => {
    const onChange = vi.fn()
    render(<BadgeArtPicker value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: badgeArt('rocket')!.label }))
    expect(onChange).toHaveBeenCalledWith('rocket')
  })

  it('marca a ilustração selecionada com aria-pressed', () => {
    render(<BadgeArtPicker value="rocket" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: badgeArt('rocket')!.label })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('mostra o label como fallback se a imagem falhar ao carregar', () => {
    render(<BadgeArtPicker value="" onChange={() => {}} />)
    const button = screen.getByRole('button', { name: badgeArt('rocket')!.label })
    const img = button.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img!)
    expect(button.querySelector('img')).toBeNull()
    expect(button).toHaveTextContent(badgeArt('rocket')!.label)
  })
})
