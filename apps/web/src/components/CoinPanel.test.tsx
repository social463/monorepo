import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { CoinPanel } from './CoinPanel'

/**
 * Documento 4, seção 10: o chip mostrava só EMR Coins, chamava o extrato de
 * "Últimos lançamentos" e não dizia de quando era o número.
 */

const state = vi.hoisted(() => ({
  balance: 120,
  points: 340,
  entries: [
    { id: 't1', kind: 'CREDIT', event: 'MOOD_CHECKIN', amount: 3, reason: null, actor: null, day: '2026-08-26', createdAt: '2026-08-26T17:30:00.000Z' },
  ] as { id: string; kind: string; event: string | null; amount: number; reason: null; actor: null; day: string; createdAt: string }[],
}))

vi.mock('../lib/use-coins', () => ({
  useCoinBalance: () => ({ data: { balance: state.balance } }),
  useCoinLedger: () => ({ data: { entries: state.entries } }),
}))
vi.mock('../lib/use-xp', () => ({
  useXpBalance: () => ({ data: { points: state.points } }),
}))

function renderPanel() {
  return render(
    <MemoryRouter>
      <CoinPanel onClose={() => {}} />
    </MemoryRouter>,
  )
}

describe('CoinPanel', () => {
  it('mostra as duas carteiras e os rótulos novos', () => {
    renderPanel()

    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('340')).toBeInTheDocument()
    expect(screen.getByText('Pontos')).toBeInTheDocument()
    expect(screen.getByText(/Como ganhar e usar suas EMR Coins/)).toBeInTheDocument()
    expect(screen.getByText('Suas últimas atividades')).toBeInTheDocument()
    expect(screen.queryByText('Últimos lançamentos')).not.toBeInTheDocument()
  })

  it('datar o saldo pelo último lançamento', () => {
    renderPanel()

    expect(screen.getByText(/^Atualizado em 26\/08\/2026 às/)).toBeInTheDocument()
  })

  it('omite "Atualizado em" na carteira sem lançamento nenhum', () => {
    state.entries = []
    renderPanel()

    expect(screen.queryByText(/Atualizado em/)).not.toBeInTheDocument()
    state.entries = [
      { id: 't1', kind: 'CREDIT', event: 'MOOD_CHECKIN', amount: 3, reason: null, actor: null, day: '2026-08-26', createdAt: '2026-08-26T17:30:00.000Z' },
    ]
  })
})
