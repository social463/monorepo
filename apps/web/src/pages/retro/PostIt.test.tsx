import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PostIt } from './PostIt'
import type { RetroCardDTO } from '@legends/shared'

const base: RetroCardDTO = {
  id: 'c1', text: 'Deploy tranquilo', x: 0, y: 0, color: 'yellow',
  author: { id: 'u1', name: 'Dan', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
  mine: true, voteCount: 0, myVotes: 0, reactions: [], createdAt: '', updatedAt: '',
  editedBy: null, editedAt: null,
}
const props = {
  readOnly: false, lockedBy: null, selected: false, editing: false, editingText: '',
  onPointerDown: vi.fn(), onEditChange: vi.fn(), onEndEdit: vi.fn(),
}

describe('PostIt (limpo)', () => {
  it('card limpo: mostra o texto e nenhum botão inline', () => {
    render(<PostIt card={base} {...props} />)
    expect(screen.getByText('Deploy tranquilo')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('selo de voto só aparece quando voteCount > 0', () => {
    const { rerender } = render(<PostIt card={base} {...props} />)
    expect(screen.queryByText(/★/)).toBeNull()
    rerender(<PostIt card={{ ...base, voteCount: 3 }} {...props} />)
    expect(screen.getByText(/★\s*3/)).toBeInTheDocument()
  })

  it('chip de reação só quando count > 0', () => {
    render(<PostIt card={{ ...base, reactions: [{ emoji: '🔥', count: 2, reactedByMe: false }, { emoji: '👍', count: 0, reactedByMe: false }] }} {...props} />)
    expect(screen.getByText(/🔥\s*2/)).toBeInTheDocument()
    expect(screen.queryByText(/👍/)).toBeNull()
  })

  it('editing mostra textarea e dispara onEndEdit no blur', () => {
    const onEndEdit = vi.fn()
    render(<PostIt card={base} {...props} editing editingText="oi" onEndEdit={onEndEdit} />)
    const ta = screen.getByRole('textbox')
    expect(ta).toHaveValue('oi')
    fireEvent.blur(ta)
    expect(onEndEdit).toHaveBeenCalled()
  })

  it('selected aplica a marca de seleção', () => {
    const { container } = render(<PostIt card={base} {...props} selected />)
    expect(container.querySelector('[data-selected]')).not.toBeNull()
  })

  it('card mascarado esconde o texto e mostra o placeholder', () => {
    render(<PostIt card={{ ...base, mine: false, masked: true, text: '' }} {...props} />)
    expect(screen.queryByText('Deploy tranquilo')).toBeNull()
    expect(screen.getByLabelText('conteúdo oculto')).toBeInTheDocument()
  })

  it('renderiza forma como elemento visual sem texto editável', () => {
    render(<PostIt card={{ ...base, kind: 'shape', shape: 'diamond', shapeStyle: 'outline', width: 160, height: 104, text: '' }} {...props} />)
    expect(screen.getByLabelText('Forma diamond')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('formulário de ação: escolher responsável atualiza e persiste automaticamente (sem botão)', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    render(
      <PostIt
        card={base}
        {...props}
        actionForm={{
          value: { plan: '', responsible: '', dueDate: '' },
          users: [{ id: 'u1', name: 'Dan' }, { id: 'u2', name: 'Ana' }],
          onChange,
          onCommit,
        }}
      />,
    )
    const select = screen.getByRole('combobox')
    expect(screen.getByRole('option', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /salvar/i })).toBeNull()
    fireEvent.change(select, { target: { value: 'u2' } })
    expect(onChange).toHaveBeenCalledWith({ plan: '', responsible: 'u2', dueDate: '' })
    expect(onCommit).toHaveBeenCalledWith({ plan: '', responsible: 'u2', dueDate: '' })
  })

  it('formulário de ação: campo de sugestão persiste no blur', () => {
    const onCommit = vi.fn()
    render(
      <PostIt
        card={base}
        {...props}
        actionForm={{
          value: { plan: 'Revisar pipeline', responsible: '', dueDate: '' },
          users: [],
          onChange: vi.fn(),
          onCommit,
        }}
      />,
    )
    fireEvent.blur(screen.getByPlaceholderText('Plano'))
    expect(onCommit).toHaveBeenCalledWith({ plan: 'Revisar pipeline', responsible: '', dueDate: '' })
  })

  it('mostra "editado por" quando o card tem editedBy', () => {
    render(<PostIt {...props} card={{ ...base, editedBy: { id: 'u2', name: 'Bia' }, editedAt: '2026-06-26T10:00:00.000Z' }} />)
    expect(screen.getByText(/editado por Bia/i)).toBeInTheDocument()
  })

  it('mostra alça de resize para forma própria selecionada', () => {
    render(
      <PostIt
        card={{ ...base, kind: 'shape', shape: 'rectangle', width: 160, height: 104, text: '' }}
        {...props}
        selected
        onResizePointerDown={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /redimensionar forma/i })).toBeInTheDocument()
  })

  it('tooltip mostra o nome do autor num card de outro autor', () => {
    render(<PostIt {...props} card={{ ...base, mine: false }} />)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dan')
  })

  it('card mascarado: tooltip mostra "Anônimo", não o nome real', () => {
    render(<PostIt {...props} card={{ ...base, mine: false, masked: true, text: '' }} />)
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Anônimo')
    expect(tip).not.toHaveTextContent('Dan')
  })

  it('card próprio: tooltip mostra "Você"', () => {
    render(<PostIt {...props} card={base} />)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Você')
  })
})
