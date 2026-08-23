import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NotificationsPage } from './NotificationsPage'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

const unread = { id: 'n1', type: 'BADGE_EARNED', title: 'Você conquistou o selo "Incansável"!', link: '/selos', read: false, createdAt: '2026-06-17T00:00:00.000Z', actor: null }
const read = { id: 'n2', type: 'FEEDBACK_REACTION', title: 'Bia reagiu a um feedback seu', link: '/perfil/bia', read: true, createdAt: '2026-06-16T00:00:00.000Z', actor: null }

describe('NotificationsPage', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('lista as não-lidas (aba padrão) e linka cada item', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 1 } as never
      return { items: [unread], unreadCount: 1, nextCursor: null } as never
    })
    wrap(<NotificationsPage />)
    const title = await screen.findByText(/Incansável/i)
    expect(title.closest('a')).toHaveAttribute('href', '/selos')
  })

  it('placeholder específico quando não há não-lidas', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationsPage />)
    expect(await screen.findByText(/Tudo em dia/i)).toBeInTheDocument()
  })

  it('a aba "Lidas" busca read=true e mostra placeholder próprio quando vazia', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      if (path.includes('read=true')) return { items: [], unreadCount: 0, nextCursor: null } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationsPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lidas' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.stringContaining('read=true')))
    expect(await screen.findByText(/Nenhuma notificação lida ainda/i)).toBeInTheDocument()
  })

  it('clicar numa não-lida a marca como lida', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 1 } as never
      if (path.endsWith('/read')) return { unreadCount: 0 } as never
      return { items: [unread], unreadCount: 1, nextCursor: null } as never
    })
    wrap(<NotificationsPage />)
    fireEvent.click(await screen.findByText(/Incansável/i))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/notifications/n1/read', { method: 'POST' }))
  })

  it('"Marcar todas como lidas" chama o endpoint', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 2 } as never
      if (path === '/notifications/read') return { unreadCount: 0 } as never
      return { items: [unread, { ...read, read: false }], unreadCount: 2, nextCursor: null } as never
    })
    wrap(<NotificationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Marcar todas como lidas/i }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/notifications/read', { method: 'POST' }))
  })

  it('"Limpar" aparece na aba Lidas com itens e chama o DELETE', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, opts?: RequestInit) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      if (path === '/notifications/read' && opts?.method === 'DELETE') return undefined as never
      if (path.includes('read=true')) return { items: [read], unreadCount: 0, nextCursor: null } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationsPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lidas' }))
    fireEvent.click(await screen.findByRole('button', { name: /Limpar/i }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/notifications/read', { method: 'DELETE' }))
  })
})
