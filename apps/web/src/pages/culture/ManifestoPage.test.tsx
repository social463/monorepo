import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { ManifestoPage } from './ManifestoPage'
import { ApiError, apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const BODY = [
  '> **Existimos para transformar a educação médica.**',
  '',
  '## Por que existimos?',
  '',
  'Acreditamos no poder da educação.',
  '',
  '## Nossos valores',
  '',
  '### Agimos como donos',
  '',
  'Assumimos o resultado.',
].join('\n')

describe('ManifestoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockResolvedValue({
      page: { slug: 'manifesto', title: 'Manifesto cultural', subtitle: 'Evoluir com propósito', body: BODY },
    })
  })

  it('abre com título, subtítulo e a frase de abertura', async () => {
    wrap(<ManifestoPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Manifesto cultural' })).toBeInTheDocument()
    expect(screen.getByText('Evoluir com propósito')).toBeInTheDocument()
    expect(screen.getByText(/Existimos para transformar a educação médica/)).toBeInTheDocument()
  })

  it('quebra o texto em blocos numerados, um por seção', async () => {
    wrap(<ManifestoPage />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Por que existimos?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Nossos valores' })).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    // O `###` continua dentro do bloco, como subtítulo.
    expect(screen.getByRole('heading', { level: 3, name: 'Agimos como donos' })).toBeInTheDocument()
    expect(screen.getByText('Assumimos o resultado.')).toBeInTheDocument()
  })

  it('manifesto sem seção nenhuma sai inteiro, sem bloco', async () => {
    mockApiFetch.mockResolvedValue({
      page: { slug: 'manifesto', title: 'Manifesto', subtitle: null, body: 'Um parágrafo só.' },
    })

    wrap(<ManifestoPage />)

    expect(await screen.findByText('Um parágrafo só.')).toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('avisa quando ainda não há manifesto publicado', async () => {
    mockApiFetch.mockRejectedValue(new ApiError(404, 'Página não encontrada'))

    wrap(<ManifestoPage />)

    expect(await screen.findByText(/Manifesto ainda não publicado/)).toBeInTheDocument()
  })
})
