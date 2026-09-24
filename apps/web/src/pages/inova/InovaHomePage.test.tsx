import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InovaHomePage } from './InovaHomePage'

describe('InovaHomePage', () => {
  it('mostra o hero e os links de ação', () => {
    render(
      <MemoryRouter>
        <InovaHomePage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Transformando ideias em impacto real')
    expect(screen.getByRole('link', { name: /explorar projetos da comunidade/i })).toHaveAttribute(
      'href',
      '/comunidade-inova/projetos',
    )
    expect(screen.getByRole('link', { name: /tirar minha ideia do papel/i })).toHaveAttribute('href', '/comunidade-inova/novo')
  })

  it('mostra as seções institucionais (Cultura, Comitê de IA, Memórias, Jornada)', () => {
    render(
      <MemoryRouter>
        <InovaHomePage />
      </MemoryRouter>,
    )
    expect(screen.getByText('O que o INOVA tem a ver com a nossa cultura?')).toBeInTheDocument()
    expect(screen.getByText('Comitê de IA')).toBeInTheDocument()
    expect(screen.getByText('O caminho que já percorremos')).toBeInTheDocument()
    expect(screen.getByText('Sua jornada de transformação')).toBeInTheDocument()
  })

  it('abre a memória num overlay na própria página e fecha com Esc', () => {
    render(
      <MemoryRouter>
        <InovaHomePage />
      </MemoryRouter>,
    )
    // Não é mais link para aba nova: é botão que abre o overlay.
    expect(screen.queryByRole('link', { name: /ganhadores/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagem: Festival INOVA EMR 2025' }))
    const dialog = screen.getByRole('dialog', { name: 'Imagem: Festival INOVA EMR 2025' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fecha o overlay pelo botão Fechar e pelo clique fora da imagem', () => {
    render(
      <MemoryRouter>
        <InovaHomePage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagem: Ganhadores INOVA EMR 2025' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagem: Ganhadores INOVA EMR 2025' }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
