import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InovaHowToPage } from './InovaHowToPage'

describe('InovaHowToPage', () => {
  it('mostra o título e as seções de passo a passo', () => {
    render(<InovaHowToPage />)
    expect(screen.getByText('Como participar da transformação')).toBeInTheDocument()
    expect(screen.getByText('Como tirar sua ideia do papel')).toBeInTheDocument()
    expect(screen.getByText('Como evoluir seu projeto')).toBeInTheDocument()
    expect(screen.getByText('Registre sua jornada no diário')).toBeInTheDocument()
    expect(screen.getByText('Organize a execução com o Kanban')).toBeInTheDocument()
    expect(screen.getByText('Boas práticas para gerar impacto')).toBeInTheDocument()
  })

  it('embute o tutorial em vídeo pelo youtube-nocookie', () => {
    render(<InovaHowToPage />)
    const video = screen.getByTitle('Tutorial INOVA EMR: como criar e editar projetos')
    expect(video.tagName).toBe('IFRAME')
    expect(video).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/T6mA7gGg6rY')
  })
})
