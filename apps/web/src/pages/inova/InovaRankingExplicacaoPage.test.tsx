import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InovaRankingExplicacaoPage } from './InovaRankingExplicacaoPage'

describe('InovaRankingExplicacaoPage', () => {
  it('mostra a pontuação de todas as 6 fases', () => {
    render(<InovaRankingExplicacaoPage />)
    expect(screen.getByText('Ideia do Projeto')).toBeInTheDocument()
    expect(screen.getByText('Concluído')).toBeInTheDocument()
  })

  it('mostra o exemplo de cálculo com o total correto', () => {
    render(<InovaRankingExplicacaoPage />)
    // TESTING_SOLUTION (3) + ROUTINE_USE (4) + IDEA (1) = 8
    expect(screen.getByText('8 pontos')).toBeInTheDocument()
  })
})
