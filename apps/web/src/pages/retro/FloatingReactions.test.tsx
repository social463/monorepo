import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FloatingReactions } from './FloatingReactions'
import type { RetroParticipantDTO } from '@legends/shared'

const participants: RetroParticipantDTO[] = [
  {
    user: {
      id: 'u1', name: 'Dan Silva', email: 'd@x.com', role: 'LEGEND',
      area: null, position: null, positionCategory: null, squad: null,
      photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
      active: true, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null, enabledFeatures: [], sectorId: 'sector-dev-produto', companyId: 'company-emr', companyName: null, sectorFeatures: [], adminAccess: false,
    },
    isCreator: false,
  },
]

describe('FloatingReactions', () => {
  it('renderiza um item por reação com emoji e primeiro nome', () => {
    render(
      <FloatingReactions
        reactions={[{ id: 'r1', userId: 'u1', name: 'Dan Silva', emoji: '❤️', xPercent: 20 }]}
        participants={participants}
      />,
    )
    expect(screen.getByText('❤️')).toBeInTheDocument()
    expect(screen.getByText('Dan')).toBeInTheDocument()
  })

  it('sem reações não renderiza nenhum item', () => {
    const { container } = render(<FloatingReactions reactions={[]} participants={participants} />)
    expect(container.querySelectorAll('[data-float-reaction]')).toHaveLength(0)
  })
})
