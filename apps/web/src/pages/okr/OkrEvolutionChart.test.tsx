import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { OkrCheckInDTO, OkrCycleDTO, OkrKeyResultDTO } from '@legends/shared'
import { OkrEvolutionChart } from './OkrEvolutionChart'

const cycle = { decimals: { percentage: 2, numeric: 2, currency: 2 } } as OkrCycleDTO

const keyResult = {
  id: 'kr1',
  name: '% de tasks no prazo',
  metricType: 'PERCENTAGE',
  unit: null,
  baseline: 0,
  target: 95,
  direction: 'HIGHER_IS_BETTER',
} as OkrKeyResultDTO

function checkIn(id: string, value: number | null, effectiveAt: string): OkrCheckInDTO {
  return {
    id,
    keyResultId: 'kr1',
    value,
    numerator: null,
    denominator: null,
    comment: null,
    author: null,
    effectiveAt,
    source: 'MANUAL',
    sourceRef: null,
    createdAt: `${effectiveAt}T12:00:00.000Z`,
    permissions: { updateCheckIn: false, deleteCheckIn: false },
  }
}

const serie = [checkIn('c3', 75, '2026-09-14'), checkIn('c2', 70, '2026-09-03'), checkIn('c1', 62, '2026-08-20')]

describe('OkrEvolutionChart', () => {
  it('desenha um ponto por check-in, em ordem de competência', () => {
    const { container } = render(<OkrEvolutionChart checkIns={serie} keyResult={keyResult} cycle={cycle} />)
    expect(container.querySelectorAll('circle')).toHaveLength(3)
    // A série vem do servidor em ordem decrescente; o gráfico é da esquerda para a direita.
    const points = container.querySelector('polyline')!.getAttribute('points')!.split(' ').map((p) => Number(p.split(',')[1]))
    expect(points[0]).toBeGreaterThan(points[1])
    expect(points[1]).toBeGreaterThan(points[2])
  })

  it('a meta é linha de referência, com rótulo', () => {
    const { container } = render(<OkrEvolutionChart checkIns={serie} keyResult={keyResult} cycle={cycle} />)
    expect(screen.getByText('Meta: 95%')).toBeInTheDocument()
    expect(container.querySelector('line[stroke-dasharray="6 4"]')).toBeInTheDocument()
  })

  it('numa meta com teto, o rótulo é "Teto"', () => {
    render(
      <OkrEvolutionChart checkIns={serie} keyResult={{ ...keyResult, direction: 'LOWER_IS_BETTER', target: 5 }} cycle={cycle} />,
    )
    expect(screen.getByText('Teto: 5%')).toBeInTheDocument()
  })

  it('a tabela repete a série, com meta, valor e resultado', () => {
    render(<OkrEvolutionChart checkIns={serie} keyResult={keyResult} cycle={cycle} />)
    const linha = (nome: string) => screen.getByRole('row', { name: new RegExp(`^${nome}`) })
    expect(within(linha('Atingido')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['62%', '70%', '75%'])
    // Resultado é atingimento, não o valor: 62 ÷ 95 = 65%.
    expect(within(linha('Resultado')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['65%', '74%', '79%'])
    expect(within(linha('Meta')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['95%', '95%', '95%'])
  })

  it('check-in só de comentário fica de fora do gráfico', () => {
    const { container } = render(
      <OkrEvolutionChart checkIns={[...serie, checkIn('c0', null, '2026-08-01')]} keyResult={keyResult} cycle={cycle} />,
    )
    expect(container.querySelectorAll('circle')).toHaveLength(3)
  })

  it('sem nenhum valor, diz que não há o que desenhar', () => {
    const { container } = render(
      <OkrEvolutionChart checkIns={[checkIn('c0', null, '2026-08-01')]} keyResult={keyResult} cycle={cycle} />,
    )
    expect(screen.getByText(/Ainda não há check-in com valor/)).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })
})
