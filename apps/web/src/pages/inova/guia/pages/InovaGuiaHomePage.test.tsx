import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaHomePage } from './InovaGuiaHomePage'

describe('InovaGuiaHomePage', () => {
  it('mostra a pergunta central e a bússola embutida', () => {
    render(
      <MemoryRouter>
        <InovaGuiaHomePage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/quem deve ajudar primeiro/i)).toBeInTheDocument()
    expect(screen.getByText('Essa situação envolve pessoas?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /abrir a bússola/i })).toHaveAttribute('href', '/bussola')
    expect(screen.getByRole('link', { name: /ver situações do dia a dia/i })).toHaveAttribute('href', '/situacoes')
  })
})
