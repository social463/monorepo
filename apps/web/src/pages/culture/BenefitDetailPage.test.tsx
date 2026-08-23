import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Mock } from 'vitest'
import { BenefitDetailPage } from './BenefitDetailPage'
import { apiFetch, ApiError } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

const PLANO = {
  id: 'b-plano',
  title: 'Plano de saúde',
  summary: 'Unimed para Pernambuco e Amil para os demais estados.',
  icon: 'health_and_safety',
  body: [
    '*Saúde Física, Mental e Emocional*',
    '',
    '## Unimed Recife · Pernambuco',
    '',
    '| Faixa etária | Colaborador (50%) |',
    '|---|---|',
    '| 0 a 18 anos | R$ 121,12 |',
    '| 59 anos ou mais | R$ 724,60 |',
  ].join('\n'),
  order: 2,
  published: true,
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/cultura/beneficios/${id}`]}>
        <Routes>
          <Route path="/cultura/beneficios/:benefitId" element={<BenefitDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(async () => ({ benefits: [PLANO] }))
})

describe('BenefitDetailPage', () => {
  it('mostra título, resumo e o corpo em markdown — sem modal', async () => {
    const { container } = wrap('b-plano')

    expect(await screen.findByRole('heading', { name: 'Plano de saúde', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/Unimed para Pernambuco/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // O conteúdo pesado que motivou a mudança: tabela renderizada em tela cheia.
    expect(container.querySelector('table')).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'R$ 724,60' })).toBeInTheDocument()
  })

  it('usa o BackButton do projeto, uma vez só', async () => {
    wrap('b-plano')
    await screen.findByRole('heading', { name: 'Plano de saúde', level: 1 })
    // Antes havia um link de texto no topo E no rodapé — repetição que poluía
    // telas curtas. Agora é a seta padrão, ao lado do título.
    expect(screen.getAllByRole('button', { name: 'Voltar' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: /Benefícios/ })).not.toBeInTheDocument()
  })

  it('id inexistente mostra estado vazio, não erro', async () => {
    wrap('nao-existe')
    expect(await screen.findByRole('heading', { name: 'Benefício não encontrado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument()
  })

  it('falha da API mostra mensagem, mantendo a volta', async () => {
    mockApiFetch.mockImplementation(async () => {
      throw new ApiError(500, 'boom')
    })
    wrap('b-plano')
    expect(await screen.findByText('Erro ao carregar o benefício.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument()
  })
})
