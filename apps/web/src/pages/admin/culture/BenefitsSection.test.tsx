import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { BenefitsSection } from './BenefitsSection'
import { apiFetch } from '../../../lib/api'

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const BENEFIT = {
  id: 'b1',
  title: 'CVV — 188',
  summary: 'Apoio emocional 24h',
  icon: 'favorite',
  body: '## Sobre o CVV',
  order: 0,
  published: true,
  updatedAt: '2026-07-30T00:00:00.000Z',
}

const OUTRO = { ...BENEFIT, id: 'b2', title: 'Wellhub', order: 1 }

beforeEach(() => {
  mockApiFetch.mockReset()
})

describe('BenefitsSection', () => {
  it('lista os benefícios cadastrados', async () => {
    mockApiFetch.mockResolvedValue({ benefits: [BENEFIT, OUTRO] })
    wrap(<BenefitsSection />)

    expect(await screen.findByText('CVV — 188')).toBeInTheDocument()
    expect(screen.getByText('Wellhub')).toBeInTheDocument()
  })

  it('cria benefício via POST com ícone', async () => {
    mockApiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { benefit: BENEFIT }
      return { benefits: [] }
    })
    wrap(<BenefitsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Novo benefício' }))
    await userEvent.type(screen.getByPlaceholderText('CVV — 188'), 'Wellhub')
    await userEvent.type(screen.getByPlaceholderText(/Atendimento 24h/), 'Academias e apps')
    await userEvent.type(screen.getByPlaceholderText('volunteer_activism'), 'fitness_center')
    await userEvent.type(screen.getByPlaceholderText(/O que é/), 'Detalhe do benefício')
    await userEvent.click(screen.getByRole('button', { name: 'Criar benefício' }))

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body.title).toBe('Wellhub')
      expect(body.icon).toBe('fitness_center')
      expect(body.body).toBe('Detalhe do benefício')
    })
  })

  it('exige título, resumo e conteúdo', async () => {
    mockApiFetch.mockResolvedValue({ benefits: [] })
    wrap(<BenefitsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Novo benefício' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar benefício' }))

    expect(await screen.findByText('Título, resumo e conteúdo são obrigatórios.')).toBeInTheDocument()
  })

  it('mostra preview do detalhe em Markdown', async () => {
    mockApiFetch.mockResolvedValue({ benefits: [] })
    wrap(<BenefitsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Novo benefício' }))
    await userEvent.type(screen.getByPlaceholderText(/O que é/), '## Como funciona')

    expect(await screen.findByRole('heading', { name: 'Como funciona' })).toBeInTheDocument()
  })

  it('reordena mandando a nova lista de ids', async () => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith('/reorder')) return { benefits: [OUTRO, BENEFIT] }
      return { benefits: [BENEFIT, OUTRO] }
    })
    wrap(<BenefitsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Subir Wellhub' }))

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([path]) => (path as string).endsWith('/reorder'))
      expect(JSON.parse((call![1] as RequestInit).body as string).ids).toEqual(['b2', 'b1'])
    })
  })
})
