import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { ManifestoSection } from './ManifestoSection'
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

const PAGE = {
  slug: 'manifesto',
  title: 'Manifesto cultural',
  subtitle: 'EMR: Evoluir com Propósito',
  body: '## Por que existimos',
  published: true,
  updatedAt: '2026-07-30T00:00:00.000Z',
}

beforeEach(() => {
  mockApiFetch.mockReset()
})

describe('ManifestoSection', () => {
  it('carrega a página existente no formulário', async () => {
    mockApiFetch.mockResolvedValue({ page: PAGE })
    wrap(<ManifestoSection />)

    expect(await screen.findByDisplayValue('Manifesto cultural')).toBeInTheDocument()
    expect(screen.getByDisplayValue('EMR: Evoluir com Propósito')).toBeInTheDocument()
    expect(screen.getByDisplayValue('## Por que existimos')).toBeInTheDocument()
  })

  it('mostra o preview renderizado do Markdown digitado', async () => {
    mockApiFetch.mockResolvedValue({ page: null })
    wrap(<ManifestoSection />)

    const textarea = await screen.findByPlaceholderText(/Por que existimos/)
    await userEvent.type(textarea, '## Nossos valores')

    expect(await screen.findByRole('heading', { name: 'Nossos valores' })).toBeInTheDocument()
  })

  it('salva via PUT com o corpo e o estado de publicação', async () => {
    mockApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return { page: PAGE }
      return { page: null }
    })
    wrap(<ManifestoSection />)

    await userEvent.type(await screen.findByPlaceholderText('Manifesto cultural'), 'Manifesto')
    await userEvent.type(screen.getByPlaceholderText(/Por que existimos/), 'Conteúdo')
    await userEvent.click(screen.getByLabelText(/Publicado/))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
      expect(call).toBeDefined()
      expect(call![0]).toBe('/admin/culture/pages/manifesto')
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body.title).toBe('Manifesto')
      expect(body.body).toBe('Conteúdo')
      expect(body.published).toBe(true)
    })
    expect(await screen.findByText('Manifesto salvo.')).toBeInTheDocument()
  })

  it('não envia com título ou conteúdo vazio', async () => {
    mockApiFetch.mockResolvedValue({ page: null })
    wrap(<ManifestoSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Título e conteúdo são obrigatórios.')).toBeInTheDocument()
    expect(mockApiFetch.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PUT')).toBe(false)
  })
})
