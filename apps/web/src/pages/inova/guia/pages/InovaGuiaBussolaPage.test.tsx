import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaGuiaBussolaPage } from './InovaGuiaBussolaPage'

describe('InovaGuiaBussolaPage', () => {
  it('mostra o título e a bússola', () => {
    render(
      <MemoryRouter>
        <InovaGuiaBussolaPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Quem deve ajudar primeiro?')).toBeInTheDocument()
    expect(screen.getByText('Essa situação envolve pessoas?')).toBeInTheDocument()
  })
})
