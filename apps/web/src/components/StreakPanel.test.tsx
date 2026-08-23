import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StreakPanel } from './StreakPanel'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Resposta do resumo com o calendário sempre vazio (o mês não importa aqui). */
function mockStreak(summary: Record<string, unknown>) {
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path === '/me/streak') return summary as never
    return { ref: '2026-06', days: [], count: 0 } as never
  })
}

describe('StreakPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra os cards de streak e marca os dias úteis com boost do mês', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path === '/me/streak') {
        return { currentStreak: 3, bestStreak: 24, today: '2026-06-23', registeredToday: true } as never
      }
      return { ref: '2026-06', days: ['2026-06-02', '2026-06-05'], count: 2 } as never
    })

    wrap(<StreakPanel onClose={() => {}} />)

    expect(await screen.findByText('Streak atual')).toBeInTheDocument()
    expect(screen.getByText('Melhor streak')).toBeInTheDocument()
    expect(screen.getByText('Boosts no mês')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(await screen.findByLabelText('2 de Junho — com boost')).toBeInTheDocument()
    expect(screen.getByLabelText('5 de Junho — com boost')).toBeInTheDocument()
  })

  it('não marca chama em dia de fim de semana, mesmo se vier nos days', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path === '/me/streak') {
        return { currentStreak: 1, bestStreak: 5, today: '2026-06-23', registeredToday: true } as never
      }
      // 06-06 é sábado — não deve ser marcado como boost
      return { ref: '2026-06', days: ['2026-06-05', '2026-06-06'], count: 1 } as never
    })

    wrap(<StreakPanel onClose={() => {}} />)

    expect(await screen.findByLabelText('5 de Junho — com boost')).toBeInTheDocument()
    expect(screen.queryByLabelText('6 de Junho — com boost')).not.toBeInTheDocument()
  })

  it('incentiva sem falar em segunda chance para quem já registrou hoje', async () => {
    // 2026-06-23 é uma terça-feira.
    mockStreak({ currentStreak: 4, bestStreak: 9, today: '2026-06-23', registeredToday: true })
    wrap(<StreakPanel onClose={() => {}} />)

    expect(await screen.findByText(/Você está há 4 dias úteis ativo/)).toBeInTheDocument()
    expect(screen.queryByText(/Segunda chance ativada/)).toBeNull()
  })

  it('anuncia a segunda chance no dia útil ainda sem registro', async () => {
    mockStreak({ currentStreak: 4, bestStreak: 9, today: '2026-06-23', registeredToday: false })
    wrap(<StreakPanel onClose={() => {}} />)

    expect(
      await screen.findByText(/Segunda chance ativada — não falte amanhã!/),
    ).toBeInTheDocument()
  })

  it('não anuncia segunda chance no fim de semana, quando não há o que quebrar', async () => {
    // 2026-06-20 é um sábado: ninguém registra e nada zera.
    mockStreak({ currentStreak: 4, bestStreak: 9, today: '2026-06-20', registeredToday: false })
    wrap(<StreakPanel onClose={() => {}} />)

    expect(await screen.findByText(/Você está há 4 dias úteis ativo/)).toBeInTheDocument()
    expect(screen.queryByText(/Segunda chance ativada/)).toBeNull()
  })

  it('leva ao Manual do Game em vez de repetir as regras', async () => {
    mockStreak({ currentStreak: 0, bestStreak: 0, today: '2026-06-23', registeredToday: false })
    wrap(<StreakPanel onClose={() => {}} />)

    expect(await screen.findByRole('link', { name: 'Como funciona o Streak' })).toHaveAttribute(
      'href',
      '/manual-game',
    )
  })
})
