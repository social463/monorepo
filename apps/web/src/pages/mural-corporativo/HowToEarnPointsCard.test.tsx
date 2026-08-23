import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { HowToEarnPointsCard } from './HowToEarnPointsCard'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function rule(event: string, amount: number) {
  return { event, amount, capWindow: 'NONE', capAmount: null }
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('HowToEarnPointsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mostra o valor que a EMPRESA paga, não o número do desenho', async () => {
    mockApiFetch.mockResolvedValue({
      rules: [
        rule('CORPORATE_POST_REACTION', 1),
        rule('CORPORATE_POST_COMMENT', 2),
        rule('CORPORATE_POST_READ_FULL', 7),
      ],
    })
    wrap(<HowToEarnPointsCard />)

    expect(await screen.findByText('Ler conteúdo completo')).toBeInTheDocument()
    expect(screen.getByText('+7')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('omite a linha do evento cuja regra está desligada', async () => {
    mockApiFetch.mockResolvedValue({ rules: [rule('CORPORATE_POST_COMMENT', 2)] })
    wrap(<HowToEarnPointsCard />)

    expect(await screen.findByText('Comentar')).toBeInTheDocument()
    expect(screen.queryByText('Reagir')).not.toBeInTheDocument()
    expect(screen.queryByText('Ler conteúdo completo')).not.toBeInTheDocument()
  })

  it('some inteiro quando a empresa não paga nenhuma das três', async () => {
    // Regra de outro domínio: existe XP na empresa, só não no Feed.
    mockApiFetch.mockResolvedValue({ rules: [rule('MOOD_ANSWERED', 15)] })
    const { container } = wrap(<HowToEarnPointsCard />)

    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/xp/rules'))
    expect(container).toBeEmptyDOMElement()
  })
})
