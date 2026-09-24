import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InovaResourcesPage } from './InovaResourcesPage'

describe('InovaResourcesPage', () => {
  it('mostra o título e os 4 cards de recursos', () => {
    render(<InovaResourcesPage />)
    expect(screen.getByText('Recursos para evoluir')).toBeInTheDocument()
    expect(screen.getByText('Mentorias da Viver de IA')).toBeInTheDocument()
    expect(screen.getByText('Cursos e trilhas')).toBeInTheDocument()
    expect(screen.getByText('Comunidade de protagonistas')).toBeInTheDocument()
    expect(screen.getByText('Trilha AI First, Impulse UP')).toBeInTheDocument()
  })
})
