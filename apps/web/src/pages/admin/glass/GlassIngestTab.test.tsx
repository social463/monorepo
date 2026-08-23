import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlassParseResponse } from '@legends/shared'

// Convenção das telas de admin do repo (ver BenchmarkAgentSection.test.tsx):
// o módulo de API é trocado por factory, não espionado.
vi.mock('../../../lib/glass-api', () => ({
  parseGlassReview: vi.fn(),
  createGlassReview: vi.fn(),
}))

import { GlassIngestTab } from './GlassIngestTab'
import { createGlassReview, parseGlassReview } from '../../../lib/glass-api'

const parseMock = vi.mocked(parseGlassReview)
const createMock = vi.mocked(createGlassReview)

const DRAFT: GlassParseResponse['draft'] = {
  reviewDate: '2026-03-12',
  rating: 2,
  role: 'Analista de Suporte',
  level: 'Pleno',
  sector: 'Atendimento',
  tenure: 'DE_1_A_3_ANOS',
  status: 'ATIVO',
  recommends: false,
  leadershipApproval: false,
  title: 'Muita cobrança',
  positives: 'Time unido',
  negatives: 'Jornada puxada',
  advice: 'Ouçam a base',
  sentiment: 'NEGATIVO',
  themesPositive: ['AMBIENTE_EQUIPE'],
  themesNegative: ['SOBRECARGA'],
  aiSummary: 'Time bom, jornada pesada.',
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GlassIngestTab />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GlassIngestTab', () => {
  it('mostra os campos extraídos antes de gravar', async () => {
    parseMock.mockResolvedValue({ draft: DRAFT, missingFields: [] })

    renderTab()
    await userEvent.type(screen.getByLabelText(/avaliação/i), 'texto colado')
    await userEvent.click(screen.getByRole('button', { name: /interpretar/i }))

    await waitFor(() => expect(screen.getByDisplayValue('Atendimento')).toBeInTheDocument())
    expect(parseMock).toHaveBeenCalledWith({ raw: 'texto colado' })
    // Interpretar não grava.
    expect(createMock).not.toHaveBeenCalled()
  })

  it('destaca os campos faltantes e bloqueia a confirmação', async () => {
    parseMock.mockResolvedValue({
      draft: { ...DRAFT, sector: null, role: null, tenure: null },
      missingFields: ['sector', 'role', 'tenure'],
    })

    renderTab()
    await userEvent.type(screen.getByLabelText(/avaliação/i), 'texto')
    await userEvent.click(screen.getByRole('button', { name: /interpretar/i }))

    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent(/complete/i)
    expect(within(aviso).getByText(/Setor/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled()
  })

  it('libera a confirmação depois de completar o que faltava', async () => {
    parseMock.mockResolvedValue({ draft: { ...DRAFT, sector: null }, missingFields: ['sector'] })
    createMock.mockResolvedValue({ review: { ...DRAFT, id: '1', alerts: [], createdAt: '' } })

    renderTab()
    await userEvent.type(screen.getByLabelText(/avaliação/i), 'texto')
    await userEvent.click(screen.getByRole('button', { name: /interpretar/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled())

    await userEvent.type(screen.getByLabelText(/^setor/i), 'Atendimento')
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0].sector).toBe('Atendimento')
  })

  it('mostra o erro em português quando a extração falha', async () => {
    parseMock.mockRejectedValue(Object.assign(new Error('Não consegui interpretar essa avaliação.'), { status: 502 }))

    renderTab()
    await userEvent.type(screen.getByLabelText(/avaliação/i), 'lixo')
    await userEvent.click(screen.getByRole('button', { name: /interpretar/i }))

    await waitFor(() => expect(screen.getByText(/não consegui interpretar/i)).toBeInTheDocument())
  })
})
