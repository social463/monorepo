import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Mock } from 'vitest'
import { ManualDetailPage } from './ManualDetailPage'
import { apiFetch, ApiError } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

const MANUAL = {
  id: 'm1',
  title: 'Código de Ética',
  description: 'Princípios e valores',
  body: '## Conduta\n\nTexto do manual.',
  downloadPath: '/culture/manuals/m1/download',
  fileName: 'etica.pdf',
  fileSize: 2 * 1024 * 1024,
  referenceLabel: 'Atualizado em junho/2024',
  order: 0,
  published: true,
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/cultura/manuais/${id}`]}>
        <Routes>
          <Route path="/cultura/manuais/:manualId" element={<ManualDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockApiFetch.mockImplementation(async (path: string) => {
    if (path === '/culture/manuals') return { manuals: [MANUAL] }
    if (path.endsWith('/download')) return { url: 'https://s3.exemplo.com/assinado' }
    throw new Error(`rota não mockada: ${path}`)
  })
})

describe('ManualDetailPage', () => {
  it('lê o manual em tela cheia, com referência e tamanho — sem modal', async () => {
    wrap('m1')

    // Uma volta só, no padrão do projeto (era link de texto no topo e no rodapé).
    expect(await screen.findByRole('button', { name: 'Voltar' })).toBeInTheDocument()

    expect(await screen.findByRole('heading', { name: 'Código de Ética', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Atualizado em junho/2024 · 2,0 MB')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Conduta', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Texto do manual.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('baixa o PDF pela rota autenticada', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign }, writable: true })
    wrap('m1')
    await screen.findByRole('heading', { name: 'Código de Ética', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: /PDF/ }))

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/culture/manuals/m1/download')
      expect(assign).toHaveBeenCalledWith('https://s3.exemplo.com/assinado')
    })
  })

  it('manual só em PDF explica a ausência de corpo e não oferece leitura vazia', async () => {
    mockApiFetch.mockImplementation(async () => ({
      manuals: [{ ...MANUAL, body: null }],
    }))
    wrap('m1')
    expect(await screen.findByText('Este manual está disponível apenas em PDF.')).toBeInTheDocument()
  })

  it('manual sem PDF não mostra o botão de download', async () => {
    mockApiFetch.mockImplementation(async () => ({
      manuals: [{ ...MANUAL, downloadPath: null, fileName: null, fileSize: null }],
    }))
    wrap('m1')
    await screen.findByRole('heading', { name: 'Código de Ética', level: 1 })
    expect(screen.queryByRole('button', { name: /PDF/ })).not.toBeInTheDocument()
  })

  it('falha do download vira aviso, sem derrubar a leitura', async () => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === '/culture/manuals') return { manuals: [MANUAL] }
      throw new ApiError(503, 'indisponível')
    })
    wrap('m1')
    await screen.findByRole('heading', { name: 'Código de Ética', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: /PDF/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível baixar o arquivo')
    expect(screen.getByText('Texto do manual.')).toBeInTheDocument()
  })

  it('id inexistente mostra estado vazio com a volta', async () => {
    wrap('nao-existe')
    expect(await screen.findByRole('heading', { name: 'Manual não encontrado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument()
  })
})
