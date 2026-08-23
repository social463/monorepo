import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { BadgeEmblem } from './BadgeEmblem'
import { badgeArt } from '../lib/badge-art'

describe('BadgeEmblem', () => {
  it('renderiza a ilustração do catálogo quando iconKey é conhecido', () => {
    const { container } = render(
      <BadgeEmblem badge={{ iconKey: 'rocket', kind: 'IMPACT', name: 'Foguete' }} />,
    )
    const img = container.querySelector('image')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('href')).toBe(badgeArt('rocket')!.src)
  })

  it('cai no motivo geométrico (sem <image>) quando iconKey não está no catálogo', () => {
    const { container } = render(
      <BadgeEmblem badge={{ iconKey: 'inexistente-xyz', kind: 'CATEGORY', name: 'X' }} />,
    )
    expect(container.querySelector('image')).toBeNull()
    // CATEGORY → motivo de escudo (<path>); nenhum outro <path> é usado no frame.
    expect(container.querySelector('path')).not.toBeNull()
  })

  it('aplica a cor de acento do catálogo via --emblem-color', () => {
    const { container } = render(
      <BadgeEmblem badge={{ iconKey: 'rocket', kind: 'IMPACT', name: 'Foguete' }} />,
    )
    const span = container.querySelector('span.badge-emblem') as HTMLElement
    expect(span.style.getPropertyValue('--emblem-color')).toBe(badgeArt('rocket')!.color)
  })

  it('cai no motivo geométrico se a ilustração falhar ao carregar', () => {
    const { container } = render(
      <BadgeEmblem badge={{ iconKey: 'rocket', kind: 'CATEGORY', name: 'Foguete' }} />,
    )
    const img = container.querySelector('image')
    expect(img).not.toBeNull()
    fireEvent.error(img!)
    // após o erro, não há mais <image>; CATEGORY desenha o escudo (<path>)
    expect(container.querySelector('image')).toBeNull()
    expect(container.querySelector('path')).not.toBeNull()
  })
})
