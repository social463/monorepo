import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CarryoverCard } from './CarryoverCard'

const base = { id: 'a1', plan: 'Documentar deploy', note: null, dueDate: '2026-07-01', responsible: { id: 'u1', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }, sprint: 5, auditStatus: null } as const

describe('CarryoverCard', () => {
  it('a validar: Validar/Reprovar só para LEAD', () => {
    const onAction = vi.fn()
    const { rerender } = render(<CarryoverCard item={{ ...base, type: 'validate' }} canAct={false} onAction={onAction} />)
    expect(screen.getByText('Documentar deploy')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validar' })).toBeNull()
    rerender(<CarryoverCard item={{ ...base, type: 'validate' }} canAct onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }))
    expect(onAction).toHaveBeenCalledWith('a1', 'validate')
  })
  it('vencida: Concluir chama onAction(done)', () => {
    const onAction = vi.fn()
    render(<CarryoverCard item={{ ...base, type: 'overdue' }} canAct onAction={onAction} />)
    expect(screen.getByText(/Vencida/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    expect(onAction).toHaveBeenCalledWith('a1', 'done')
  })
  it('mostra a observação do responsável quando há nota', () => {
    render(<CarryoverCard item={{ ...base, type: 'validate', note: 'Falei com o time' }} canAct onAction={vi.fn()} />)
    expect(screen.getByText(/Observação do responsável:/)).toBeInTheDocument()
    expect(screen.getByText(/Falei com o time/)).toBeInTheDocument()
  })
  it('não mostra observação quando não há nota', () => {
    render(<CarryoverCard item={{ ...base, type: 'validate' }} canAct onAction={vi.fn()} />)
    expect(screen.queryByText(/Observação do responsável:/)).not.toBeInTheDocument()
  })
})
