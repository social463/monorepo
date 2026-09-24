import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock, describe, it, expect, beforeEach } from 'vitest'
import { PROFILE_FEEDBACK_PAGE_SIZE as PAGE_SIZE } from '@legends/shared'
import { FeedbackSection } from './FeedbackSection'
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
  commentCount: 0,
}

const FEEDBACK2 = {
  id: 'f2',
  author: { id: 'dev2', name: 'Bruno', email: 'b@e.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
  message: 'Segundo feedback carregado na próxima página.',
  category: 'ORIENTACAO',
  categories: [],
  customCategory: null,
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  sharedAt: null,
  reactions: [],
  commentCount: 0,
}

const CATEGORIES = [
  { id: 'c1', name: 'Comunicação', order: 1, active: true },
  { id: 'c2', name: 'Liderança', order: 2, active: true },
]

function renderSection(targetId = 'lead1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FeedbackSection targetId={targetId} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('FeedbackSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    authUser = { id: 'dev1', name: 'Ana', role: 'LEGEND' }
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/users/lead1/feedbacks')) {
        return Promise.resolve({ feedbacks: [FEEDBACK], hasMore: false, total: 1, offset: 0 })
      }
      if (path === '/categories') return Promise.resolve({ categories: CATEGORIES })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
  })

  it('renderiza a lista com autor e a mensagem', async () => {
    renderSection()
    expect(await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('mostra editar/excluir nos feedbacks do próprio autor', async () => {
    renderSection()
    expect(await screen.findByLabelText('Editar feedback')).toBeInTheDocument()
    expect(screen.getByLabelText('Excluir feedback')).toBeInTheDocument()
  })

  it('ADMIN vê excluir mas não editar em feedback de terceiro', async () => {
    authUser = { id: 'adm', name: 'Adm', role: 'ADMIN' }
    renderSection()
    expect(await screen.findByLabelText('Excluir feedback')).toBeInTheDocument()
    expect(screen.queryByLabelText('Editar feedback')).not.toBeInTheDocument()
  })

  it('navega entre as páginas e mostra "página X de Y"', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      const offset = Number(new URL('http://x/' + path).searchParams.get('offset') ?? '0')
      if (path.startsWith('/users/lead1/feedbacks')) {
        // 10 no total = 2 páginas de PAGE_SIZE.
        if (offset === 0) return Promise.resolve({ feedbacks: [FEEDBACK], hasMore: true, total: 10, offset: 0 })
        return Promise.resolve({ feedbacks: [FEEDBACK2], hasMore: false, total: 10, offset: PAGE_SIZE })
      }
      if (path === '/categories') return Promise.resolve({ categories: CATEGORIES })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderSection()
    expect(await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')).toBeInTheDocument()
    expect(screen.getByText(/página 1 de 2/)).toBeInTheDocument()
    // Na primeira página não há para onde voltar.
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }))
    expect(await screen.findByText('Segundo feedback carregado na próxima página.')).toBeInTheDocument()
    // Só a página atual fica no DOM: é o que trava a altura do card.
    expect(screen.queryByText('Conduziu o incidente com calma e comunicou bem o time.')).not.toBeInTheDocument()
    expect(screen.getByText(/página 2 de 2/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /Próxima/ })).toBeDisabled())
  })

  // Responder a um feedback já existia no mural; no perfil vale para o que a
  // pessoa recebeu E para o que ela escreveu, inclusive privado — a permissão
  // é a mesma do feedback, e quem decide é o servidor.
  describe('responder a um feedback', () => {
    const COMMENT = {
      id: 'cm1',
      author: { id: 'dev2', name: 'Bruno', email: 'b@e.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' },
      message: 'Obrigado pelo retorno, ajudou demais.',
      createdAt: '2026-06-03T00:00:00.000Z',
    }

    function mockComComentarios(comments = [COMMENT], feedback = FEEDBACK) {
      mockApiFetch.mockImplementation((path: string) => {
        if (path.startsWith('/users/lead1/feedbacks')) {
          return Promise.resolve({ feedbacks: [feedback], hasMore: false, total: 1, offset: 0 })
        }
        if (path === '/categories') return Promise.resolve({ categories: CATEGORIES })
        if (path === '/feedbacks/f1/comments') return Promise.resolve({ comments })
        return Promise.reject(new Error(`unexpected ${path}`))
      })
    }

    it('abre a conversa e lista as respostas que já existem', async () => {
      mockComComentarios()
      renderSection()
      await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')

      fireEvent.click(screen.getByLabelText('Responder'))

      expect(await screen.findByText('Obrigado pelo retorno, ajudou demais.')).toBeInTheDocument()
      expect(mockApiFetch).toHaveBeenCalledWith('/feedbacks/f1/comments')
    })

    it('escrever uma resposta manda para o servidor', async () => {
      mockComComentarios([])
      renderSection()
      await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
      fireEvent.click(screen.getByLabelText('Responder'))

      const input = await screen.findByLabelText('Escrever uma resposta')
      fireEvent.change(input, { target: { value: 'Combinado!' } })
      fireEvent.submit(input.closest('form') as HTMLFormElement)

      await waitFor(() =>
        expect(mockApiFetch).toHaveBeenCalledWith('/feedbacks/f1/comments', {
          method: 'POST',
          body: JSON.stringify({ message: 'Combinado!' }),
        }),
      )
    })

    // O contador vem do feedback, não da lista de respostas: sem recarregar a
    // página do perfil ele ficaria para trás depois de responder.
    it('depois de responder, recarrega a lista do perfil para atualizar o contador', async () => {
      mockComComentarios([])
      renderSection()
      await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
      fireEvent.click(screen.getByLabelText('Responder'))
      const chamadasAntes = mockApiFetch.mock.calls.filter((c) => String(c[0]).startsWith('/users/lead1/feedbacks')).length

      const input = await screen.findByLabelText('Escrever uma resposta')
      fireEvent.change(input, { target: { value: 'Combinado!' } })
      fireEvent.submit(input.closest('form') as HTMLFormElement)

      await waitFor(() => {
        const depois = mockApiFetch.mock.calls.filter((c) => String(c[0]).startsWith('/users/lead1/feedbacks')).length
        expect(depois).toBeGreaterThan(chamadasAntes)
      })
    })

    it('o botão mostra quantas respostas o feedback já tem', async () => {
      mockComComentarios([COMMENT], { ...FEEDBACK, commentCount: 3 })
      renderSection()
      await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')

      expect(screen.getByLabelText('Responder')).toHaveTextContent('3')
    })

    it('a conversa só abre depois do clique', async () => {
      mockComComentarios()
      renderSection()
      await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')

      expect(screen.queryByLabelText('Escrever uma resposta')).not.toBeInTheDocument()
      expect(mockApiFetch).not.toHaveBeenCalledWith('/feedbacks/f1/comments')
    })
  })

  it('não mostra paginação quando tudo cabe numa página', async () => {
    renderSection()
    await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
    expect(screen.queryByRole('navigation', { name: /Paginação/ })).not.toBeInTheDocument()
  })

  it('filtrar por categoria vai ao servidor e volta para a primeira página', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/users/lead1/feedbacks')) {
        return Promise.resolve({ feedbacks: [FEEDBACK], hasMore: true, total: 12, offset: 0 })
      }
      if (path === '/categories') return Promise.resolve({ categories: CATEGORIES })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderSection()
    await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }))
    await waitFor(() => expect(screen.getByText(/página 2 de 3/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('combobox', { name: 'Filtrar por categoria' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Liderança' }))

    await waitFor(() =>
      expect(mockApiFetch.mock.calls.some(([p]) => p.includes('categoryId=c2') && p.includes('offset=0'))).toBe(true),
    )
    expect(screen.getByText(/página 1 de/)).toBeInTheDocument()
  })

  /**
   * Deep-link do mural: com paginação numerada o front não sabe em que página o
   * feedback caiu — quem resolve é o servidor, por `anchor`.
   */
  it('abre pela âncora quando vem do mural e não varre página por página', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/users/lead1/feedbacks')) {
        if (path.includes('anchor=f2')) {
          return Promise.resolve({ feedbacks: [FEEDBACK2], hasMore: false, total: 8, offset: PAGE_SIZE })
        }
        return Promise.resolve({ feedbacks: [FEEDBACK], hasMore: true, total: 8, offset: 0 })
      }
      if (path === '/categories') return Promise.resolve({ categories: CATEGORIES })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <FeedbackSection targetId="lead1" highlightId="f2" />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Segundo feedback carregado na próxima página.')).toBeInTheDocument()
    // A página veio direto do servidor: uma chamada só, com a âncora.
    const chamadas = mockApiFetch.mock.calls.filter(([p]) => p.startsWith('/users/lead1/feedbacks'))
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0][0]).toContain('anchor=f2')
    // E a página adotada é a que o servidor disse.
    expect(screen.getByText(/página 2 de 2/)).toBeInTheDocument()
  })

  it('exibe o badge da categoria no item de feedback', async () => {
    // Renderiza como o próprio alvo (lead1): o formulário (e o seletor de categoria) fica oculto,
    // então o único "Positivo" na tela é o badge do feedback.
    authUser = { id: 'lead1', name: 'Líder', role: 'LEAD' }
    renderSection('lead1')
    await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
    expect(screen.queryByLabelText('Seu feedback')).not.toBeInTheDocument()
    expect(screen.getByText('Positivo')).toBeInTheDocument()
  })

  it('mostra botão Compartilhar para o alvo em feedback público', async () => {
    authUser = { id: 'lead1', name: 'Líder', role: 'LEAD' }
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/users/lead1/feedbacks'))
        return Promise.resolve({ feedbacks: [{ ...FEEDBACK, sharedAt: null, reactions: [] }], hasMore: false })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderSection('lead1')
    expect(await screen.findByRole('button', { name: /compartilhar/i })).toBeInTheDocument()
  })

  it('não mostra botão Compartilhar para quem não é o alvo', async () => {
    // authUser = dev1, targetId = lead1 → não é o alvo
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/users/lead1/feedbacks'))
        return Promise.resolve({ feedbacks: [{ ...FEEDBACK, sharedAt: null, reactions: [] }], hasMore: false })
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderSection('lead1')
    await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
    expect(screen.queryByRole('button', { name: /compartilhar/i })).not.toBeInTheDocument()
  })

  it('destaca o feedback indicado por highlightId (deep-link do mural)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <FeedbackSection targetId="lead1" highlightId="f1" />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Conduziu o incidente com calma e comunicou bem o time.')
    expect(document.getElementById('feedback-f1')).toHaveClass('mural-highlight')
  })

  it('edita um feedback inline (Editar → textarea preenchido → Salvar → PATCH)', async () => {
    mockApiFetch.mockImplementation((path: string, options?: { method?: string; body?: string }) => {
      if (path === '/feedbacks/f1' && options?.method === 'PATCH') return Promise.resolve({ feedback: FEEDBACK })
      if (path.startsWith('/users/lead1/feedbacks')) {
        return Promise.resolve({ feedbacks: [FEEDBACK], hasMore: false, total: 1, offset: 0 })
      }
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    renderSection()
    fireEvent.click(await screen.findByLabelText('Editar feedback'))
    // A mensagem vira um textarea inline já preenchido com o conteúdo atual.
    const editArea = screen.getByLabelText('Editar mensagem do feedback') as HTMLTextAreaElement
    expect(editArea.value).toBe(FEEDBACK.message)
    fireEvent.change(editArea, { target: { value: 'Mensagem revisada e suficientemente longa.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([p, o]) => p === '/feedbacks/f1' && o?.method === 'PATCH')
      expect(call).toBeTruthy()
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
        message: 'Mensagem revisada e suficientemente longa.',
      })
    })
  })

  it('exibe os chips de competência no card do feedback', async () => {
    renderSection()
    expect(await screen.findByText('Comunicação')).toBeInTheDocument()
  })
})
