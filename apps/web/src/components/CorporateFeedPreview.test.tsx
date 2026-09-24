import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { CorporateFeedPreview } from './CorporateFeedPreview'
import * as api from '../lib/api'

const AUTOR = {
  id: 'u9',
  name: 'Maria Yasmin',
  email: null,
  role: 'LEGEND',
  area: null,
  position: null,
  squad: null,
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  active: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
  leftAt: null,
  sectorId: 's1',
  sectorName: 'G&G',
  companyId: 'company-emr',
  companyName: null,
  enabledFeatures: [],
  sectorFeatures: [],
}

const CORPO_LONGO =
  'Realizaremos um encontro online dia 19/08 focado em aprofundar nosso conhecimento sobre os produtos ' +
  'da EMR. Dominar as soluções que oferecemos é essencial para garantirmos entregas de alto impacto, ' +
  'alinhar nossa comunicação interna e fortalecer nossa atuação no mercado.'

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    author: AUTOR,
    authorSectorName: 'G&G',
    title: 'Treinamento de Produtos EMR!',
    content: CORPO_LONGO,
    body: null,
    gif: null,
    image: null,
    attachments: [],
    status: 'PUBLISHED',
    audience: 'ALL',
    audienceSectors: [],
    createdAt: '2026-08-18T18:10:00.000Z',
    editedAt: null,
    pinnedAt: null,
    collapsible: true,
    reactions: [],
    reactors: [],
    reactorCount: 0,
    commentCount: 0,
    viewerRead: true,
    tag: null,
    mentions: [],
    ...overrides,
  }
}

function wrap(items: unknown[]) {
  vi.spyOn(api, 'apiFetch').mockResolvedValue({
    items,
    nextCursor: null,
    canPublish: true,
    canPublishDirectly: true,
  } as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CorporateFeedPreview />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CorporateFeedPreview', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra o título do comunicado e resume o corpo em duas linhas', async () => {
    wrap([post()])

    // O título vem do campo do post — antes a prévia usava a primeira linha do
    // texto, e post escrito num parágrafo só virava um bloco em negrito na Home.
    expect(await screen.findByText('Treinamento de Produtos EMR!')).toBeInTheDocument()
    const corpo = screen.getByText(/Realizaremos um encontro online/)
    expect(corpo.className).toContain('line-clamp-2')
    expect(corpo.className).not.toContain('font-semibold')
  })

  it('sem título gravado, a primeira linha vira o título e sai do corpo', async () => {
    wrap([post({ title: null, content: 'Aviso rápido\nDetalhe que fica no resumo.' })])

    expect(await screen.findByText('Aviso rápido')).toBeInTheDocument()
    expect(screen.getByText('Detalhe que fica no resumo.')).toBeInTheDocument()
  })

  it('imagem anexada vira miniatura ao lado, não banner', async () => {
    wrap([post({ attachments: [{ id: 'a1', kind: 'IMAGE', url: 'https://cdn/x.png', name: 'x', mimeType: 'image/png', sizeBytes: 1 }] })])

    await screen.findByText('Treinamento de Produtos EMR!')
    const thumb = document.querySelector<HTMLImageElement>('img[src="https://cdn/x.png"]')
    expect(thumb).not.toBeNull()
    // Miniatura ao lado do texto, e não a imagem em largura cheia como no mural.
    expect(thumb!.className).toContain('h-16')
    expect(thumb!.className).not.toContain('w-full')
  })

  it('marca "Novo" o comunicado que a pessoa ainda não abriu', async () => {
    // Quem responde se já leu é o servidor (`CorporatePostRead`), não a Home.
    wrap([post({ id: 'p1', viewerRead: false }), post({ id: 'p2', title: 'Já lido', viewerRead: true })])

    const naoLido = await screen.findByText('Treinamento de Produtos EMR!')
    expect(within(naoLido.closest('li')!).getByText('Novo')).toBeInTheDocument()
    const lido = screen.getByText('Já lido')
    expect(within(lido.closest('li')!).queryByText('Novo')).not.toBeInTheDocument()
  })
})
