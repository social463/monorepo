import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { OfficeOccupant, ShowcaseEntry } from '@legends/shared'
import { CharacterCard } from './CharacterCard'

function occupant(overrides: Partial<OfficeOccupant> = {}): OfficeOccupant {
  return {
    userId: 'ana',
    name: 'Ana Silva',
    x: 1,
    y: 1,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
    ...overrides,
  }
}

describe('CharacterCard', () => {
  it('mostra controle de volume para outro usuário', () => {
    const setUserVolume = vi.fn()
    render(
      <CharacterCard
        occupant={occupant()}
        entry={null}
        isSelf={false}
        onCall={vi.fn()}
        onFollow={vi.fn()}
        onViewProfile={vi.fn()}
        onClose={vi.fn()}
        remoteUserVolumes={{
          getUserVolume: () => 70,
          setUserVolume,
        }}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Volume de Ana Silva' })
    expect(slider).toHaveValue('70')

    fireEvent.change(slider, { target: { value: '30' } })
    expect(setUserVolume).toHaveBeenCalledWith('ana', 30)
  })

  it('não mostra controle de volume no próprio card', () => {
    render(
      <CharacterCard
        occupant={occupant()}
        entry={null}
        isSelf
        onCall={vi.fn()}
        onFollow={vi.fn()}
        onViewProfile={vi.fn()}
        onClose={vi.fn()}
        remoteUserVolumes={{
          getUserVolume: () => 70,
          setUserVolume: vi.fn(),
        }}
      />,
    )

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })
})

describe('CharacterCard — foto e nível', () => {
  function entryOf(points: number): ShowcaseEntry {
    return {
      user: {
        id: 'ana',
        name: 'Ana Silva',
        position: 'Tech Lead',
        sectorName: 'Desenvolvimento de Produto',
        photoUrl: 'https://cdn.exemplo/ana.png',
        avatarStyle: null,
        avatarSeed: null,
        avatarOptions: null,
      } as ShowcaseEntry['user'],
      feedbacksReceived: 3,
      badges: [],
      xp: {
        points,
        level: { name: 'Prata', color: '#5F6B7A', next: 'Ouro', min: 500, nextMin: 1500, remaining: 300, progress: 70 },
      },
    }
  }

  function renderCard(entry: ShowcaseEntry) {
    return render(
      <MemoryRouter>
        <CharacterCard
          occupant={occupant()}
          entry={entry}
          isSelf={false}
          onCall={vi.fn()}
          onFollow={vi.fn()}
          onViewProfile={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    )
  }

  it('traz a foto da pessoa e o nível — é o único lugar do escritório com a foto', () => {
    renderCard(entryOf(1200))

    expect(screen.getByRole('img', { name: 'Ana Silva' })).toHaveAttribute(
      'src',
      'https://cdn.exemplo/ana.png',
    )
    expect(screen.getByText('Prata')).toBeInTheDocument()
  })

  it('sem ponto nenhum não afirma nível', () => {
    renderCard(entryOf(0))

    expect(screen.queryByText('Prata')).not.toBeInTheDocument()
  })
})
