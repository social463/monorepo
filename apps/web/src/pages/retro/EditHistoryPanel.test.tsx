import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditHistoryPanel } from './EditHistoryPanel'

const edits = [
  { id: 'e1', editor: { id: 'u2', name: 'Bia' }, action: 'action.updated', detail: 'Deploy tranquilo', createdAt: '2026-06-26T10:00:00.000Z' },
]

describe('EditHistoryPanel', () => {
  it('lista as edições com autor e detalhe', () => {
    render(<EditHistoryPanel edits={edits as any} onClose={vi.fn()} />)
    expect(screen.getByText(/Bia/)).toBeInTheDocument()
    expect(screen.getByText(/Deploy tranquilo/)).toBeInTheDocument()
  })
  it('estado vazio', () => {
    render(<EditHistoryPanel edits={[]} onClose={vi.fn()} />)
    expect(screen.getByText(/Nenhuma edição/i)).toBeInTheDocument()
  })
})
