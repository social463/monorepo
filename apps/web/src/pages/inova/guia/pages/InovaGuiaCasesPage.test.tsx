import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaCasesPage } from './InovaGuiaCasesPage'

describe('InovaGuiaCasesPage', () => {
  it('mostra a vitrine vazia de propósito, com o cadastro no formulário de projeto (e não no externo)', () => {
    render(
      <MemoryRouter>
        <InovaGuiaCasesPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/esta vitrine começa vazia de propósito/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /registrar um case/i })).toHaveAttribute('href', '/comunidade-inova/novo')
    expect(screen.getByText('O ciclo da aprendizagem coletiva')).toBeInTheDocument()
  })
})
