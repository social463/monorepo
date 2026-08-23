import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OfficeFloatingReactions } from './OfficeFloatingReactions'
import type { OfficeFloatingReaction } from './office-floating-reactions'

function reaction(over: Partial<OfficeFloatingReaction> = {}): OfficeFloatingReaction {
  return {
    id: 'r1',
    userId: 'ana',
    name: 'Ana Silva',
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    emoji: '❤️',
    xPercent: 20,
    ...over,
  }
}

describe('OfficeFloatingReactions', () => {
  it('renderiza um item por reação com emoji e nome', () => {
    render(<OfficeFloatingReactions reactions={[reaction()]} />)
    expect(screen.getByText('❤️')).toBeInTheDocument()
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
  })

  it('sem reações não renderiza nenhum item', () => {
    const { container } = render(<OfficeFloatingReactions reactions={[]} />)
    expect(container.querySelectorAll('[data-office-float-reaction]')).toHaveLength(0)
  })

  it('sem nome resolvido (occupant desconhecido), mostra só o emoji, sem badge vazio', () => {
    render(<OfficeFloatingReactions reactions={[reaction({ name: '' })]} />)
    expect(screen.getByText('❤️')).toBeInTheDocument()
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument()
  })
})
