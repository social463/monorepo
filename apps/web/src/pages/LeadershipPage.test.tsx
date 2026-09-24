import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { LeadershipPage } from './LeadershipPage'

// Os painéis são testados nos próprios arquivos; aqui só interessa qual aba os
// monta — sem eles, o teste viraria um teste de rede.
vi.mock('./profile/SquadMoodPanel', () => ({ SquadMoodPanel: () => <div>painel de humor</div> }))
vi.mock('./leadership/TeamIndicatorsTab', () => ({ TeamIndicatorsTab: () => <div>indicadores do time</div> }))

const impulseUpUrl = vi.hoisted(() => ({ value: 'https://eu-medico-residente.impulseup.com/' }))
vi.mock('../lib/use-development-settings', () => ({
  useDevelopmentSettings: () => ({ data: { settings: { impulseUpUrl: impulseUpUrl.value } } }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <LeadershipPage />
    </MemoryRouter>,
  )
}

describe('LeadershipPage', () => {
  beforeEach(() => {
    impulseUpUrl.value = 'https://eu-medico-residente.impulseup.com/'
  })

  it('abre em "Meu time", com humor e atalhos', () => {
    renderPage()

    expect(screen.getByRole('tab', { name: /Meu time/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('painel de humor')).toBeInTheDocument()
    // 1:1 e PDI moram na ImpulseUp: apontados para `/1-1` e `/pdi`, o
    // `FeatureGate` das rotas devolvia todo mundo para a Home.
    expect(screen.getByRole('link', { name: /1:1/ })).toHaveAttribute(
      'href',
      'https://eu-medico-residente.impulseup.com/',
    )
    expect(screen.getByRole('link', { name: /PDI/ })).toHaveAttribute(
      'href',
      'https://eu-medico-residente.impulseup.com/',
    )
    // O organograma daqui é o dos diretos, não a empresa inteira em `/time`.
    expect(screen.getByRole('link', { name: /Organograma/ })).toHaveAttribute('href', '/lideranca/organograma')
    expect(screen.queryByText('indicadores do time')).not.toBeInTheDocument()
  })

  // A gestão de férias passou para o DP, em Administração › Férias. O líder não
  // lança período nem preenche a programação anual — sobrou leitura, no card da
  // Home e em "Férias do Mês".
  it('não tem mais aba de Férias', () => {
    renderPage()

    expect(screen.queryByRole('tab', { name: /Férias/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('esconde 1:1 e PDI quando a empresa não cadastrou a ImpulseUp', () => {
    impulseUpUrl.value = ''
    renderPage()

    expect(screen.queryByRole('link', { name: /1:1/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /PDI/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Organograma/ })).toBeInTheDocument()
  })

  it('troca para a aba de indicadores', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('tab', { name: /Indicadores/ }))

    expect(screen.getByText('indicadores do time')).toBeInTheDocument()
    expect(screen.queryByText('painel de humor')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Indicadores/ })).toHaveAttribute('aria-selected', 'true')
  })
})
