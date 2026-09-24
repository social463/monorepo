import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ValueBars, InovaTimelineChart, InovaCategoryBreakdown } from './InovaAdminCharts'

describe('ValueBars', () => {
  it('mostra o estado vazio quando não há valor', () => {
    render(<ValueBars items={[{ key: 'a', label: 'Ensino', value: 0 }]} formatValue={(v) => `${v}`} emptyMessage="Sem dados." />)
    expect(screen.getByText('Sem dados.')).toBeInTheDocument()
  })

  it('formata e ordena os valores', () => {
    render(
      <ValueBars
        items={[
          { key: 'a', label: 'Ensino', value: 100 },
          { key: 'b', label: 'CX', value: 300 },
        ]}
        formatValue={(v) => `R$ ${v}`}
        emptyMessage="Sem dados."
      />,
    )
    expect(screen.getByText('R$ 100')).toBeInTheDocument()
    expect(screen.getByText('R$ 300')).toBeInTheDocument()
    expect(screen.getByTitle('CX: R$ 300')).toBeInTheDocument()
  })
})

describe('InovaTimelineChart', () => {
  it('mostra o estado vazio sem pontos', () => {
    render(<InovaTimelineChart points={[]} />)
    expect(screen.getByText(/Nenhum projeto registrado/)).toBeInTheDocument()
  })

  const pontos = [
    { month: 'jan/26', novosProjetos: 2, avancosDeFase: 0 },
    { month: 'fev/26', novosProjetos: 5, avancosDeFase: 3 },
  ]

  it('traça as duas séries, com legenda', () => {
    render(<InovaTimelineChart points={pontos} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/7 novos projetos e 3 avanços de fase/)
    expect(screen.getByText('Novos Projetos')).toBeInTheDocument()
    expect(screen.getByText('Avanços de Fase')).toBeInTheDocument()
  })

  it('mês só com avanço de fase não é "vazio"', () => {
    render(<InovaTimelineChart points={[{ month: 'mar/26', novosProjetos: 0, avancosDeFase: 1 }]} />)
    expect(screen.queryByText(/Nenhum projeto registrado/)).not.toBeInTheDocument()
  })

  it('mostra os valores do mês no hover', () => {
    render(<InovaTimelineChart points={pontos} />)
    fireEvent.mouseEnter(screen.getByTitle(/^fev\/26:/))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('fev/26')
    expect(tooltip).toHaveTextContent('Novos Projetos: 5')
    expect(tooltip).toHaveTextContent('Avanços de Fase: 3')
  })
})

describe('InovaCategoryBreakdown', () => {
  const grupos = [
    { category: 'Análise de dados', projects: [{ id: '1', title: 'Painel de churn', sector: 'CX' }] },
    {
      category: 'Automação de processos',
      projects: [
        { id: '2', title: 'Robô de conciliação', sector: 'Estratégia e Finanças' },
        { id: '3', title: 'Triagem de tickets', sector: 'CX' },
      ],
    },
  ]

  it('mostra a contagem por categoria e abre a lista de projetos dela', async () => {
    render(<InovaCategoryBreakdown groups={grupos} showSector emptyMessage="Vazio." />)
    expect(screen.queryByText(/Robô de conciliação/)).not.toBeInTheDocument()

    const botoes = screen.getAllByRole('button')
    // Ordenado pela contagem: automação (2) antes de dados (1).
    expect(botoes[0]).toHaveTextContent('Automação de processos')
    await userEvent.click(botoes[0])

    expect(botoes[0]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Robô de conciliação/)).toBeInTheDocument()
    expect(screen.getByText(/· Estratégia e Finanças/)).toBeInTheDocument()
  })

  it('omite o setor quando o painel já está filtrado por um', async () => {
    render(<InovaCategoryBreakdown groups={grupos} showSector={false} emptyMessage="Vazio." />)
    await userEvent.click(screen.getAllByRole('button')[0])
    expect(screen.getByText(/Robô de conciliação/)).toBeInTheDocument()
    expect(screen.queryByText(/· Estratégia e Finanças/)).not.toBeInTheDocument()
  })
})
