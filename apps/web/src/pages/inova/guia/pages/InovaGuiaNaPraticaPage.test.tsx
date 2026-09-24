import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { InovaGuiaNaPraticaPage } from './InovaGuiaNaPraticaPage'
import { exercises } from '../content/library'

describe('InovaGuiaNaPraticaPage', () => {
  beforeEach(() => window.localStorage.clear())

  it('mostra o ciclo por padrão e troca de aba para Exercícios', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaNaPraticaPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('Do princípio ao hábito')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Exercícios' }))
    expect(screen.getByText(exercises[0]!.title)).toBeInTheDocument()
  })

  it('marca um exercício como feito e persiste', async () => {
    render(
      <MemoryRouter>
        <InovaGuiaNaPraticaPage />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Exercícios' }))
    await userEvent.click(screen.getAllByRole('button', { name: /marcar como feito/i })[0]!)
    expect(screen.getAllByRole('button', { name: /^feito$/i })[0]).toBeInTheDocument()
  })
})
