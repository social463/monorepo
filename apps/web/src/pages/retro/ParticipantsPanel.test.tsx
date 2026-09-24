import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PublicUser, RetroParticipantDTO } from '@legends/shared'
import { ParticipantsPanel } from './ParticipantsPanel'

const pub = (id: string, name: string): PublicUser => ({
  id, name, email: `${id}@x`, role: 'LEGEND', area: null, position: null, positionCategory: null, squad: null,
  photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '', leftAt: null, enabledFeatures: [], sectorId: 'sector-dev-produto', companyId: 'company-emr', companyName: null, sectorFeatures: [], adminAccess: false,
})
const participants: RetroParticipantDTO[] = [
  { user: pub('l1', 'Lia'), isCreator: true },
  { user: pub('d1', 'Dan'), isCreator: false },
]
const invitable: PublicUser[] = [pub('b1', 'Bia')]

describe('ParticipantsPanel', () => {
  it('lista participantes (criador sem remover) e dispara onRemove', () => {
    const onRemove = vi.fn()
    render(<ParticipantsPanel participants={participants} invitable={invitable} onAdd={() => {}} onRemove={onRemove} onClose={() => {}} />)
    expect(screen.getByText('Lia')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remover Lia/i })).toBeNull() // criador
    fireEvent.click(screen.getByRole('button', { name: /Remover Dan/i }))
    expect(onRemove).toHaveBeenCalledWith('d1')
  })

  it('lista convidáveis e dispara onAdd; fechar dispara onClose', () => {
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(<ParticipantsPanel participants={participants} invitable={invitable} onAdd={onAdd} onRemove={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Adicionar Bia/i }))
    expect(onAdd).toHaveBeenCalledWith('b1')
    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
