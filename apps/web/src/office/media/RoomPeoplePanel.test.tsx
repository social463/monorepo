import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { RoomPeoplePanel } from './RoomPeoplePanel'

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

describe('RoomPeoplePanel', () => {
  it('mostra o total de pessoas no título e um item por ocupante', () => {
    render(
      <RoomPeoplePanel
        occupants={[occupant(), occupant({ userId: 'bruno', name: 'Bruno Costa' })]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Pessoas na sala (2)')).toBeInTheDocument()
    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
  })

  it('lista vazia mostra "(0)" e nenhum item', () => {
    render(<RoomPeoplePanel occupants={[]} onClose={vi.fn()} />)
    expect(screen.getByText('Pessoas na sala (0)')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('botão fechar chama onClose', () => {
    const onClose = vi.fn()
    render(<RoomPeoplePanel occupants={[occupant()]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel de pessoas da sala' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('mostra controle de volume para outras pessoas e esconde para você', () => {
    const setUserVolume = vi.fn()
    render(
      <RoomPeoplePanel
        occupants={[
          occupant({ userId: 'ana', name: 'Ana Silva' }),
          occupant({ userId: 'bruno', name: 'Bruno Costa' }),
        ]}
        youId="ana"
        remoteUserVolumes={{
          getUserVolume: (userId) => (userId === 'bruno' ? 45 : 100),
          setUserVolume,
        }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByRole('slider', { name: 'Volume de Ana Silva' })).not.toBeInTheDocument()
    const slider = screen.getByRole('slider', { name: 'Volume de Bruno Costa' })
    expect(slider).toHaveValue('45')

    fireEvent.change(slider, { target: { value: '25' } })
    expect(setUserVolume).toHaveBeenCalledWith('bruno', 25)
  })
})
