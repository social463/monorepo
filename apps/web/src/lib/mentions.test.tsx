import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithMentions } from './mentions'

function renderNodes(nodes: React.ReactNode) {
  return render(<MemoryRouter>{nodes}</MemoryRouter>)
}

describe('renderWithMentions', () => {
  it('linka o nome mencionado para o perfil e mantém o resto do texto', () => {
    const { getByText, container } = renderNodes(
      renderWithMentions('boa @Karina Akina, mandou bem', [{ userId: 'u1', name: 'Karina Akina' }]),
    )
    const link = getByText('@Karina Akina').closest('a')
    expect(link).toHaveAttribute('href', '/perfil/u1')
    expect(container.textContent).toBe('boa @Karina Akina, mandou bem')
  })

  it('não linka @nome que não está na lista de menções', () => {
    const { queryByRole, container } = renderNodes(
      renderWithMentions('oi @Fulano', []),
    )
    expect(queryByRole('link')).toBeNull()
    expect(container.textContent).toBe('oi @Fulano')
  })
})
