import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { MuralBanner } from './MuralBanner'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

const user = { id: 'u1', name: 'Ana', email: 'a@x.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' }

describe('MuralBanner', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra placeholder do mural quando a lista vem vazia', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ items: [] })
    const { container } = wrap(<MuralBanner />)
    // Sem itens: aparece o placeholder, não o carrossel.
    expect(await screen.findByTestId('mural-banner-empty')).toBeInTheDocument()
    expect(screen.getByText(/o pulso do time aparece aqui/i)).toBeInTheDocument()
    expect(container.querySelector('[data-testid="mural-banner"]')).toBeNull()
  })

  it('mostra um item por vez e navega pelas setas', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      items: [
        { type: 'feedback', id: 'f1', timestamp: '2026-06-16T00:00:00.000Z', target: user, author: { ...user, id: 'u2', name: 'Bia' }, message: 'Mandou muito bem na entrega.', category: 'POSITIVO', reactions: [] },
        { type: 'badge', id: 'b1', timestamp: '2026-06-15T00:00:00.000Z', user, badge: { slug: 's', name: 'Incansável', description: 'd', iconKey: 'k', kind: 'IMPACT' } },
      ],
    })
    wrap(<MuralBanner />)

    // Primeiro item (feedback) visível; o selo ainda não está no DOM.
    const message = await screen.findByText(/Mandou muito bem/i)
    expect(message).toBeInTheDocument()
    expect(screen.queryByText('Incansável')).toBeNull()
    // O card leva ao perfil do alvo com o feedback destacado.
    expect(message.closest('a')).toHaveAttribute('href', '/perfil/u1?feedback=f1')

    // Navega para o segundo item pela seta.
    fireEvent.click(screen.getByRole('button', { name: /próximo item/i }))
    const badgeName = await screen.findByText('Incansável')
    expect(badgeName).toBeInTheDocument()
    expect(screen.queryByText(/Mandou muito bem/i)).toBeNull()
    // O card do selo leva ao perfil de quem conquistou, com o selo destacado.
    expect(badgeName.closest('a')).toHaveAttribute('href', '/perfil/u1?badge=b1')
  })

  it('mostra aviso de humor do dia sem expor o humor e leva ao perfil', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      items: [
        { type: 'mood', id: 'm1', timestamp: '2026-06-26T12:00:00.000Z', user: { ...user, id: 'u3', name: 'Caio' } },
      ],
    })
    wrap(<MuralBanner />)

    const text = await screen.findByText(/respondeu ao humor do dia/i)
    expect(text).toBeInTheDocument()
    expect(text).toHaveTextContent('Caio respondeu ao humor do dia')
    expect(text.closest('a')).toHaveAttribute('href', '/perfil/u3')
  })

  it('leva a resenha compartilhada ao post no feed, não ao perfil do autor', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      items: [
        {
          type: 'review',
          id: 'r1',
          timestamp: '2026-06-27T12:00:00.000Z',
          author: { ...user, id: 'u4', name: 'Dani' },
          content: 'Fechamos a sprint inteira sem bug em produção.',
          reactorCount: 3,
          sharers: [{ id: 'u5', name: 'Edu' }],
        },
      ],
    })
    wrap(<MuralBanner />)

    const content = await screen.findByText(/sem bug em produção/i)
    // Deep-link por hash: mesma convenção das notificações, que o ResenhaFeed resolve.
    expect(content.closest('a')).toHaveAttribute('href', '/resenha#r1')
  })
})
