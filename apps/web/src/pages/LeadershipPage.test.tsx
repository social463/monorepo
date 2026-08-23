import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { LeadershipPage } from './LeadershipPage'

// Os painéis são testados nos próprios arquivos; aqui só interessa qual aba os
// monta — sem eles, o teste viraria um teste de rede.
vi.mock('./profile/SquadMoodPanel', () => ({ SquadMoodPanel: () => <div>painel de humor</div> }))
vi.mock('./profile/TeamVacationsPanel', () => ({ TeamVacationsPanel: () => <div>painel de férias</div> }))
vi.mock('./leadership/TeamIndicatorsTab', () => ({ TeamIndicatorsTab: () => <div>indicadores do time</div> }))

function renderPage() {
  return render(
    <MemoryRouter>
      <LeadershipPage />
    </MemoryRouter>,
  )
}

describe('LeadershipPage', () => {
  it('abre em "Meu time", com humor, férias e atalhos', () => {
    renderPage()

    expect(screen.getByRole('tab', { name: /Meu time/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('painel de humor')).toBeInTheDocument()
    expect(screen.getByText('painel de férias')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /1:1/ })).toHaveAttribute('href', '/1-1')
    // O organograma daqui é o dos diretos, não a empresa inteira em `/time`.
    expect(screen.getByRole('link', { name: /Organograma/ })).toHaveAttribute('href', '/lideranca/organograma')
    expect(screen.queryByText('indicadores do time')).not.toBeInTheDocument()
  })

  it('troca para a aba de indicadores', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('tab', { name: /Indicadores/ }))

    expect(screen.getByText('indicadores do time')).toBeInTheDocument()
    expect(screen.queryByText('painel de humor')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Indicadores/ })).toHaveAttribute('aria-selected', 'true')
  })
})
