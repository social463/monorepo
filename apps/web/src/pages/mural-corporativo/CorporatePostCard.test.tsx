import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { CorporatePostDTO } from '@legends/shared'
import { CorporatePostCard } from './CorporatePostCard'
import * as api from '../../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

vi.mock('./CorporatePostComments', () => ({
  CorporatePostComments: () => <div />,
}))

const author = {
  id: 'u2', name: 'Bia', email: 'b@x.com', role: 'HEAD' as const, area: null, position: null,
  squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null,
  avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z',
  leftAt: null, sectorId: 's1', companyId: 'c1', companyName: null,
  enabledFeatures: [], sectorFeatures: [], adminAccess: false,
}

function makePost(pinnedAt: string | null, overrides: Partial<CorporatePostDTO> = {}): CorporatePostDTO {
  return {
    id: 'p1',
    author,
    authorSectorName: 'Produto',
    title: null,
    content: 'Comunicado da empresa toda',
    body: null,
    gif: null,
    image: null,
    attachments: [],
    status: 'PUBLISHED',
    audience: 'ALL',
    audienceSectors: [],
    createdAt: '2026-07-20T00:00:00.000Z',
    editedAt: null,
    pinnedAt,
    collapsible: false,
    reactions: [],
    reactors: [],
    reactorCount: 0,
    commentCount: 0,
    mentions: [],
    ...overrides,
  }
}

function viewer(role: string, id = 'u1') {
  return {
    user: { id, name: 'Quem Vê', role },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }
}

function wrap(post: CorporatePostDTO) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ul>
          <CorporatePostCard post={post} />
        </ul>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CorporatePostCard: fixar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue(viewer('LEGEND'))
  })

  it('mostra a faixa "Fixado no topo" quando o post está fixado', () => {
    wrap(makePost('2026-08-01T10:00:00.000Z'))
    expect(screen.getByText('Fixado no topo')).toBeInTheDocument()
  })

  it('não mostra a faixa quando o post não está fixado', () => {
    wrap(makePost(null))
    expect(screen.queryByText('Fixado no topo')).not.toBeInTheDocument()
  })

  it('esconde a ação de fixar de quem não é admin', () => {
    wrap(makePost(null))
    expect(screen.queryByRole('button', { name: /fixar publicação/i })).not.toBeInTheDocument()
  })

  it('admin fixa o post pela ação do card', async () => {
    mockUseAuth.mockReturnValue(viewer('ADMIN'))
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ post: makePost('2026-08-01T10:00:00.000Z') })
    wrap(makePost(null))

    fireEvent.click(screen.getByRole('button', { name: 'Fixar publicação' }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/corporate-posts/p1/pin', { method: 'POST' }),
    )
  })

  it('subadmin desafixa o post fixado', async () => {
    mockUseAuth.mockReturnValue(viewer('SUBADMIN'))
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue({ post: makePost(null) })
    wrap(makePost('2026-08-01T10:00:00.000Z'))

    fireEvent.click(screen.getByRole('button', { name: 'Desafixar publicação' }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/corporate-posts/p1/pin', { method: 'DELETE' }),
    )
  })

  it('excluir confirma DENTRO do card, sem o diálogo do navegador', async () => {
    mockUseAuth.mockReturnValue(viewer('ADMIN'))
    const confirm = vi.spyOn(window, 'confirm')
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue(undefined)
    wrap(makePost(null))

    fireEvent.click(screen.getByRole('button', { name: 'Excluir publicação' }))
    expect(confirm).not.toHaveBeenCalled()
    // Só o passo de confirmação chama a API — o clique no ícone não apaga nada.
    expect(spy).not.toHaveBeenCalledWith('/corporate-posts/p1', { method: 'DELETE' })

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/corporate-posts/p1', { method: 'DELETE' }))
  })

  it('cancelar a exclusão devolve as ações do card', () => {
    mockUseAuth.mockReturnValue(viewer('ADMIN'))
    wrap(makePost(null))

    fireEvent.click(screen.getByRole('button', { name: 'Excluir publicação' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByRole('button', { name: 'Excluir publicação' })).toBeInTheDocument()
  })

  it('autor do próprio post sem ser admin: só a ação de excluir', () => {
    mockUseAuth.mockReturnValue(viewer('LEGEND', author.id))
    wrap(makePost(null))

    expect(screen.getByRole('button', { name: 'Excluir publicação' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /fixar publicação/i })).not.toBeInTheDocument()
  })

  it('mostra título e a assinatura com setor, data e hora, mais a marca "editado"', () => {
    wrap(
      makePost(null, {
        title: 'Mudança na academia parceira',
        editedAt: '2026-07-21T10:00:00.000Z',
      }),
    )

    expect(screen.getByText('Mudança na academia parceira')).toBeInTheDocument()
    // Setor · data e hora vivem na MESMA linha da assinatura, abaixo do nome.
    expect(screen.getByText(/Produto ·/)).toBeInTheDocument()
    expect(screen.getByText(/· editado/)).toBeInTheDocument()
  })

  it('corta o post longo e "Ver conteúdo completo" pede o crédito de leitura', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockResolvedValue(undefined)
    wrap(
      makePost(null, {
        collapsible: true,
        body: {
          blocks: ['l1', 'l2', 'l3', 'l4', 'l5'].map((text) => ({ type: 'paragraph' as const, spans: [{ text }] })),
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Ver conteúdo completo' }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('/corporate-posts/p1/read', {
        method: 'POST',
        body: JSON.stringify({ full: true }),
      }),
    )
    // Expandido, o botão some — não há o que ver de novo.
    expect(screen.queryByRole('button', { name: 'Ver conteúdo completo' })).not.toBeInTheDocument()
  })

  it('"Ver conteúdo completo" anuncia o valor da regra da empresa', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string) =>
      Promise.resolve(
        path === '/xp/rules'
          ? { rules: [{ event: 'CORPORATE_POST_READ_FULL', amount: 3, capWindow: 'NONE', capAmount: null }] }
          : undefined,
      ),
    )
    wrap(makePost(null, { collapsible: true }))

    expect(await screen.findByRole('button', { name: 'Ver conteúdo completo (+3 pts)' })).toBeInTheDocument()
  })

  it('desenha vídeo e documento anexados', () => {
    wrap(
      makePost(null, {
        attachments: [
          {
            id: 'a1',
            kind: 'VIDEO',
            url: 'https://cdn.x/v.mp4',
            name: 'video.mp4',
            contentType: 'video/mp4',
            size: 10,
            width: null,
            height: null,
          },
          {
            id: 'a2',
            kind: 'DOCUMENT',
            url: 'https://cdn.x/d.pdf',
            name: 'politica.pdf',
            contentType: 'application/pdf',
            size: 10,
            width: null,
            height: null,
          },
        ],
      }),
    )

    expect(screen.getByText('politica.pdf')).toBeInTheDocument()
    expect(document.querySelector('video')).toHaveAttribute('src', 'https://cdn.x/v.mp4')
  })

  it('admin vê editar, fixar e excluir — sem depender de hover', () => {
    mockUseAuth.mockReturnValue(viewer('ADMIN', author.id))
    wrap(makePost(null))

    for (const name of ['Editar publicação', 'Fixar publicação', 'Excluir publicação']) {
      const button = screen.getByRole('button', { name })
      // `opacity-0` só descobria as ações no hover: invisível no teclado e no toque.
      expect(button.className).not.toContain('opacity-0')
    }
  })

  it('compartilhar copia o link direto do comunicado', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    wrap(makePost(null))

    fireEvent.click(screen.getByRole('button', { name: /compartilhar/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/mural-corporativo#p1`))
    expect(await screen.findByText('Link copiado')).toBeInTheDocument()
  })
})

describe('CorporatePostCard: imagens', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue(viewer('LEGEND'))
    vi.spyOn(api, 'apiFetch').mockResolvedValue({} as never)
  })

  function postComImagens(): CorporatePostDTO {
    return makePost(null, {
      attachments: [
        {
          id: 'a1', kind: 'IMAGE', url: 'https://cdn/banner.png', name: 'banner.png',
          contentType: 'image/png', size: 1000, width: 1200, height: 400,
        },
        {
          id: 'a2', kind: 'IMAGE', url: 'https://cdn/foto.png', name: 'foto.png',
          contentType: 'image/png', size: 2000, width: 800, height: 800,
        },
        {
          id: 'a3', kind: 'DOCUMENT', url: 'https://cdn/pauta.pdf', name: 'pauta.pdf',
          contentType: 'application/pdf', size: 3000, width: null, height: null,
        },
      ],
    })
  }

  it('a foto do card é contida, não cortada — banner largo perderia a arte no crop', () => {
    wrap(postComImagens())
    expect(screen.getByAltText('banner.png').className).toContain('object-contain')
    expect(screen.getByAltText('banner.png').className).not.toContain('object-cover')
  })

  it('clicar na imagem abre o visualizador em tela cheia', () => {
    wrap(postComImagens())
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByLabelText('Ampliar imagem: banner.png'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', 'Imagem: banner.png')
    expect(screen.getByText('1 de 2')).toBeInTheDocument()
  })

  it('o visualizador navega só entre as fotos — o documento anexado fica de fora', () => {
    wrap(postComImagens())
    fireEvent.click(screen.getByLabelText('Ampliar imagem: banner.png'))

    fireEvent.click(screen.getByLabelText('Próxima imagem'))
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Imagem: foto.png')

    // Duas fotos e um PDF: a volta é para a primeira foto, não para o PDF.
    fireEvent.click(screen.getByLabelText('Próxima imagem'))
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Imagem: banner.png')
  })

  it('Esc fecha o visualizador', () => {
    wrap(postComImagens())
    fireEvent.click(screen.getByLabelText('Ampliar imagem: foto.png'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('CorporatePostCard: quem reagiu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseAuth.mockReturnValue(viewer('LEGEND'))
  })

  const reator = {
    id: 'u7', name: 'Carla Reatora', photoUrl: null,
    avatarStyle: null, avatarSeed: null, avatarOptions: null,
  }

  function postComReacoes(): CorporatePostDTO {
    return makePost(null, {
      reactorCount: 9,
      reactors: [reator],
      reactions: [{ emoji: '💚', count: 9, reactedByMe: false, users: [{ id: reator.id, name: reator.name }] }],
    })
  }

  it('clicar em "N reações" abre a lista de quem reagiu, com nome e foto', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/corporate-posts/p1/reactions') {
        return Promise.resolve({
          items: [{ user: reator, sectorName: 'Comercial', emoji: '💚', createdAt: '2026-07-30T13:00:00.000Z' }],
          total: 1,
        }) as never
      }
      return Promise.resolve({}) as never
    })

    wrap(postComReacoes())
    fireEvent.click(screen.getByLabelText('Ver quem reagiu'))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', 'Quem reagiu')
    expect(await screen.findByText('Carla Reatora')).toBeInTheDocument()
    expect(screen.getByText(/Comercial/)).toBeInTheDocument()
  })

  // A fileira de avatares para em 8: sem o aviso, "200 de 340" passaria por lista
  // completa. O mesmo texto vale no painel de alcance — a lista é compartilhada.
  it('avisa quando a lista vem truncada pelo servidor', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((path: string) => {
      if (path === '/corporate-posts/p1/reactions') {
        return Promise.resolve({
          items: [{ user: reator, sectorName: null, emoji: '💚', createdAt: '2026-07-30T13:00:00.000Z' }],
          total: 340,
        }) as never
      }
      return Promise.resolve({}) as never
    })

    wrap(postComReacoes())
    fireEvent.click(screen.getByLabelText('Ver quem reagiu'))

    expect(await screen.findByText(/1 reações mais recentes de 340/)).toBeInTheDocument()
  })

  it('sem reação nenhuma não há o que clicar', () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({} as never)
    wrap(makePost(null))
    expect(screen.queryByLabelText('Ver quem reagiu')).toBeNull()
  })
})
