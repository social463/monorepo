import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InovaResponsabilidadesPage } from './InovaResponsabilidadesPage'

describe('InovaResponsabilidadesPage', () => {
  it('mostra os 4 papéis', () => {
    render(<InovaResponsabilidadesPage />)
    expect(screen.getByText('Gente & Gestão (T&D)')).toBeInTheDocument()
    expect(screen.getByText('Líder')).toBeInTheDocument()
    expect(screen.getByText('Responsáveis pelo Projeto')).toBeInTheDocument()
    expect(screen.getByText('Representante de Projetos do Setor')).toBeInTheDocument()
  })
})
