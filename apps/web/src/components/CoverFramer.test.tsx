import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_EVENT_ALBUM_COVER, type EventAlbumCover } from '@legends/shared'
import { CoverFramer } from './CoverFramer'
import { coverImageStyle } from '../lib/album-cover'

function setup(value: EventAlbumCover = DEFAULT_EVENT_ALBUM_COVER) {
  const onChange = vi.fn()
  render(<CoverFramer url="https://cdn.exemplo.com/capa.jpg" value={value} onChange={onChange} />)
  return { onChange }
}

describe('CoverFramer', () => {
  it('troca o modo entre preencher e encaixar', async () => {
    const { onChange } = setup()

    await userEvent.click(screen.getByRole('button', { name: /encaixar/i }))

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EVENT_ALBUM_COVER, fit: 'CONTAIN' })
    // O modo em vigor fica marcado, não só colorido.
    expect(screen.getByRole('button', { name: 'Preencher' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('ajusta zoom e posição vertical pelos controles', () => {
    const { onChange } = setup()

    const zoom = screen.getByRole('slider', { name: /zoom/i })
    const posicao = screen.getByRole('slider', { name: /posição vertical/i })

    expect(zoom).toHaveAttribute('min', '100')
    expect(zoom).toHaveAttribute('max', '250')
    expect(posicao).toHaveAttribute('max', '100')

    fireEvent.change(zoom, { target: { value: '180' } })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EVENT_ALBUM_COVER, scale: 180 })

    fireEvent.change(posicao, { target: { value: '15' } })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EVENT_ALBUM_COVER, positionY: 15 })
  })

  it('a prévia usa exatamente o estilo que a galeria vai aplicar', () => {
    const value: EventAlbumCover = { fit: 'CONTAIN', positionY: 20, scale: 150 }
    setup(value)

    const preview = screen.getByAltText('Prévia da capa')
    const expected = coverImageStyle(value)

    expect(preview).toHaveStyle({
      objectFit: expected.objectFit as string,
      objectPosition: expected.objectPosition as string,
      transform: expected.transform as string,
    })
  })
})

describe('coverImageStyle', () => {
  it('preencher corta, encaixar cabe inteira', () => {
    expect(coverImageStyle({ fit: 'COVER', positionY: 50, scale: 100 }).objectFit).toBe('cover')
    expect(coverImageStyle({ fit: 'CONTAIN', positionY: 50, scale: 100 }).objectFit).toBe('contain')
  })

  it('o zoom cresce a partir da posição escolhida, não do meio', () => {
    const style = coverImageStyle({ fit: 'COVER', positionY: 10, scale: 200 })
    expect(style.transform).toBe('scale(2)')
    expect(style.transformOrigin).toBe('center 10%')
    expect(style.objectPosition).toBe('center 10%')
  })
})
