import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { CultureHubPage } from './CultureHubPage'
import { apiFetch, ApiError } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

/**
 * Manifesto e Benefícios são para todo colaborador logado; só a aba Manuais
 * depende da feature `cultura` do setor. O default aqui é o caso comum (tem a
 * feature) — o caso sem ela tem teste próprio no fim do arquivo.
 */
const mockAuth = vi.hoisted(() => ({
  role: 'LEGEND' as string,
  sectorFeatures: ['cultura'] as string[],
  enabledFeatures: [] as string[],
}))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      role: mockAuth.role,
      sectorFeatures: mockAuth.sectorFeatures,
      enabledFeatures: mockAuth.enabledFeatures,
    },
  }),
}))

function wrap(ui: ReactNode, initialEntry = '/cultura') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const PAGE = {
  slug: 'manifesto',
  title: 'Manifesto cultural',
  subtitle: 'EMR: Evoluir com Propósito',
  body: '## Por que existimos\n\nAcreditamos no poder transformador da educação.',
  published: true,
  updatedAt: '2026-07-30T00:00:00.000Z',
}

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
  updatedAt: '2026-07-30T00:00:00.000Z',
}

const BENEFIT = {
  id: 'b1',
  title: 'CVV — 188',
  summary: 'Apoio emocional 24h',
  icon: 'favorite',
  body: '## Sobre o CVV\n\nAtendimento gratuito.',
  order: 0,
  published: true,
  updatedAt: '2026-07-30T00:00:00.000Z',
}

function routeApi(overrides: Partial<Record<string, unknown>> = {}) {
  mockApiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/culture/pages/')) return { page: overrides.page ?? PAGE }
    if (path === '/culture/manuals') return { manuals: overrides.manuals ?? [MANUAL] }
    if (path === '/culture/benefits') return { benefits: overrides.benefits ?? [BENEFIT] }
    if (path.endsWith('/download')) return { url: 'https://s3.exemplo.com/assinado' }
    throw new Error(`rota não mockada: ${path}`)
  })
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockAuth.role = 'LEGEND'
  mockAuth.sectorFeatures = ['cultura']
  mockAuth.enabledFeatures = []
})

describe('CultureHubPage', () => {
  it('abre na primeira aba visível', async () => {
    routeApi()
    wrap(<CultureHubPage />)

    expect(await screen.findByText('Código de Ética')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Manuais' })).toHaveAttribute('aria-selected', 'true')
    // O manifesto saiu do hub: virou tela própria.
    expect(screen.queryByRole('tab', { name: 'Manifesto' })).not.toBeInTheDocument()
  })

  it('o link antigo do manifesto redireciona para a tela própria', async () => {
    routeApi()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/cultura?aba=manifesto']}>
          <Routes>
            <Route path="/cultura" element={<CultureHubPage />} />
            <Route path="/manifesto" element={<p>tela do manifesto</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('tela do manifesto')).toBeInTheDocument()
  })

  it('respeita a aba pedida na URL', async () => {
    routeApi()
    wrap(<CultureHubPage />, '/cultura?aba=beneficios')

    expect(await screen.findByText('CVV — 188')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Benefícios' })).toHaveAttribute('aria-selected', 'true')
  })

  it('troca de aba ao clicar', async () => {
    routeApi()
    wrap(<CultureHubPage />)
    await screen.findByText('Código de Ética')

    await userEvent.click(screen.getByRole('tab', { name: 'Benefícios' }))

    expect(await screen.findByText('CVV — 188')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Benefícios' })).toHaveAttribute('aria-selected', 'true')
  })

  it('aba inválida na URL cai na primeira visível', async () => {
    routeApi()
    wrap(<CultureHubPage />, '/cultura?aba=inexistente')
    expect(await screen.findByText('Código de Ética')).toBeInTheDocument()
  })

  it('lista de manuais vazia mostra estado vazio', async () => {
    routeApi({ manuals: [] })
    wrap(<CultureHubPage />, '/cultura?aba=manuais')
    expect(await screen.findByText('Nenhum manual publicado')).toBeInTheDocument()
  })

  it('lista de benefícios vazia mostra estado vazio', async () => {
    routeApi({ benefits: [] })
    wrap(<CultureHubPage />, '/cultura?aba=beneficios')
    expect(await screen.findByText('Nenhum benefício publicado')).toBeInTheDocument()
  })

  it('mostra data de referência e tamanho do PDF no card do manual', async () => {
    routeApi()
    wrap(<CultureHubPage />, '/cultura?aba=manuais')
    expect(await screen.findByText('Atualizado em junho/2024 · 2,0 MB')).toBeInTheDocument()
  })

  it('"Ler manual" leva para a tela de leitura, sem abrir modal', async () => {
    routeApi()
    wrap(<CultureHubPage />, '/cultura?aba=manuais')
    await screen.findByText('Código de Ética')

    expect(screen.getByRole('link', { name: /Ler manual/ })).toHaveAttribute(
      'href',
      '/cultura/manuais/m1',
    )
    // O corpo não vem na listagem — quem mostra é a tela de leitura.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Texto do manual.')).not.toBeInTheDocument()
  })

  it('baixar PDF pede o link assinado pela rota autenticada', async () => {
    routeApi()
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign }, writable: true })

    wrap(<CultureHubPage />, '/cultura?aba=manuais')
    await screen.findByText('Código de Ética')

    await userEvent.click(screen.getByRole('button', { name: /PDF/ }))

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/culture/manuals/m1/download')
      expect(assign).toHaveBeenCalledWith('https://s3.exemplo.com/assinado')
    })
  })

  it('manual sem PDF não mostra o botão de download', async () => {
    routeApi({ manuals: [{ ...MANUAL, downloadPath: null, fileName: null, fileSize: null }] })
    wrap(<CultureHubPage />, '/cultura?aba=manuais')
    await screen.findByText('Código de Ética')

    expect(screen.queryByRole('button', { name: /PDF/ })).not.toBeInTheDocument()
    // "Ler manual" virou link para a tela de leitura.
    expect(screen.getByRole('link', { name: /Ler manual/ })).toBeInTheDocument()
  })

  it('benefício leva para a tela de detalhe, sem abrir modal', async () => {
    routeApi()
    wrap(<CultureHubPage />, '/cultura?aba=beneficios')

    const link = await screen.findByRole('link', { name: /CVV — 188/ })
    expect(link).toHaveAttribute('href', '/cultura/beneficios/b1')
    // O corpo não vem junto na listagem — quem mostra é a tela de detalhe.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/Atendimento gratuito/)).not.toBeInTheDocument()
  })

  it('sem a feature cultura, Kit visual e Benefícios continuam; Manuais some', async () => {
    mockAuth.sectorFeatures = []
    routeApi()
    wrap(<CultureHubPage />)

    expect(await screen.findByRole('tab', { name: 'Kit visual' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Benefícios' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Manuais' })).not.toBeInTheDocument()
  })

  it('sem a feature, pedir a aba de manuais pela URL cai na primeira visível', async () => {
    mockAuth.sectorFeatures = []
    routeApi()
    wrap(<CultureHubPage />, '/cultura?aba=manuais')

    expect(await screen.findByRole('tab', { name: 'Kit visual' })).toHaveAttribute('aria-selected', 'true')
  })
})
