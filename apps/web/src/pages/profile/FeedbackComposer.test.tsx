import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock, describe, it, expect, beforeEach } from 'vitest'
import { FeedbackComposer } from './FeedbackComposer'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

let authUser: { id: string; name: string; role: string } | null = { id: 'dev1', name: 'Ana', role: 'LEGEND' }
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: authUser }),
}))

const mockApiFetch = apiFetch as unknown as Mock

const FEEDBACK = {
  id: 'f1',
  author: { id: 'dev1', name: 'Ana', email: 'a@e.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
  message: 'Conduziu o incidente com calma e comunicou bem o time.',
  category: 'POSITIVO',
  categories: [{ id: 'c1', name: 'Comunicação' }],
  customCategory: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  sharedAt: null,
  reactions: [],
}

const CATEGORIES = [
  { id: 'c1', name: 'Comunicação', order: 1, active: true },
  { id: 'c2', name: 'Liderança', order: 2, active: true },
]

function renderComposer(targetId = 'lead1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FeedbackComposer targetId={targetId} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('FeedbackComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    authUser = { id: 'dev1', name: 'Ana', role: 'LEGEND' }
    mockApiFetch.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.startsWith('/users/lead1/feedbacks') && options?.method === 'POST') {
        return Promise.resolve({ feedback: FEEDBACK })
      }
      if (path === '/categories') return Promise.resolve({ categories: CATEGORIES })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
  })

  it('mostra o campo único para quem pode escrever', async () => {
    renderComposer()
    expect(await screen.findByLabelText('Seu feedback')).toBeInTheDocument()
  })

  it('exibe o guia ligado por padrão', async () => {
    renderComposer()
    expect(await screen.findByText(/Um bom feedback costuma cobrir/)).toBeInTheDocument()
  })

  it('alterna o guia ao clicar no toggle', async () => {
    renderComposer()
    const toggle = await screen.findByRole('button', { name: /Guia ligado/ })
    fireEvent.click(toggle)
    expect(screen.queryByText(/Um bom feedback costuma cobrir/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guia desligado/ })).toBeInTheDocument()
  })

  it('não renderiza nada para ADMIN', () => {
    authUser = { id: 'adm', name: 'Adm', role: 'ADMIN' }
    const { container } = renderComposer()
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByLabelText('Seu feedback')).not.toBeInTheDocument()
  })

  it('não renderiza nada no próprio perfil', () => {
    authUser = { id: 'lead1', name: 'Líder', role: 'LEAD' }
    const { container } = renderComposer('lead1')
    expect(container).toBeEmptyDOMElement()
  })

  it('envia um novo feedback com { message, category, categoryIds }', async () => {
    renderComposer()
    fireEvent.change(await screen.findByLabelText('Seu feedback'), {
      target: { value: 'Feedback específico e suficientemente longo.' },
    })
    // Tipo é obrigatório: o envio fica bloqueado até escolher um.
    expect(screen.getByRole('button', { name: 'Enviar feedback' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Elogio' }))
    // E a categoria também, como no mural.
    expect(screen.getByRole('button', { name: 'Enviar feedback' })).toBeDisabled()
    fireEvent.click(screen.getByRole('combobox', { name: 'Categorias do feedback' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Comunicação' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }))
    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(
        ([p, o]) => p.startsWith('/users/lead1/feedbacks') && o?.method === 'POST',
      )
      expect(call).toBeTruthy()
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
        message: 'Feedback específico e suficientemente longo.',
        category: 'ELOGIO',
        categoryIds: ['c1'],
      })
    })
  })

  it('libera o envio só com a categoria personalizada, sem nenhuma do catálogo', async () => {
    renderComposer()
    fireEvent.change(await screen.findByLabelText('Seu feedback'), {
      target: { value: 'Feedback específico e suficientemente longo.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Elogio' }))
    expect(screen.getByRole('button', { name: 'Enviar feedback' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Categoria personalizada'), { target: { value: 'Mentoria' } })
    expect(screen.getByRole('button', { name: 'Enviar feedback' })).toBeEnabled()
  })

  it('envia as competências e a categoria personalizada escolhidas', async () => {
    renderComposer()
    fireEvent.change(await screen.findByLabelText('Seu feedback'), {
      target: { value: 'Feedback específico e suficientemente longo.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Elogio' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Categorias do feedback' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Liderança' }))
    fireEvent.change(screen.getByLabelText('Categoria personalizada'), { target: { value: 'Mentoria' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }))
    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(
        ([p, o]) => p.startsWith('/users/lead1/feedbacks') && o?.method === 'POST',
      )
      expect(call).toBeTruthy()
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
        message: 'Feedback específico e suficientemente longo.',
        category: 'ELOGIO',
        categoryIds: ['c2'],
        customCategory: 'Mentoria',
      })
    })
  })

  // O formulário limpa e a lista (outro componente) recarrega pela invalidação
  // de ['feedbacks', targetId] — é o único fio entre os dois cards.
  it('limpa os campos depois de enviar', async () => {
    renderComposer()
    const textarea = await screen.findByLabelText('Seu feedback')
    fireEvent.change(textarea, { target: { value: 'Feedback específico e suficientemente longo.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Elogio' }))
    fireEvent.change(screen.getByLabelText('Categoria personalizada'), { target: { value: 'Mentoria' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }))
    await waitFor(() => expect(textarea).toHaveValue(''))
    expect(screen.getByLabelText('Categoria personalizada')).toHaveValue('')
  })
})
