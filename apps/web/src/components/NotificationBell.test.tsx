import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NotificationBell } from './NotificationBell'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

describe('NotificationBell', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra o contador de não-lidas', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 3 } as never
      return { items: [], unreadCount: 3, nextCursor: null } as never
    })
    wrap(<NotificationBell />)
    expect(await screen.findByText('3')).toBeInTheDocument()
  })

  it('abrir o sino chama markAllRead e lista os itens', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 1 } as never
      if (path === '/notifications/read') return { unreadCount: 0 } as never
      return {
        items: [{ id: 'n1', type: 'FEEDBACK_RECEIVED', title: 'Ana deixou um feedback pra você', link: '/perfil/u1?feedback=f1', read: false, createdAt: '2026-06-17T00:00:00.000Z', actor: null }],
        unreadCount: 1,
        nextCursor: null,
      } as never
    })
    wrap(<NotificationBell />)
    fireEvent.click(await screen.findByRole('button', { name: /notificaç/i }))
    expect(await screen.findByText(/Ana deixou um feedback/i)).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/notifications/read', { method: 'POST' }))
  })

  it('mostra estado vazio quando não há notificações', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationBell />)
    fireEvent.click(await screen.findByRole('button', { name: /notificaç/i }))
    expect(await screen.findByText(/Nenhuma notificação ainda/i)).toBeInTheDocument()
  })

  it('com anchor="right", o dropdown abre à direita do ícone', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationBell anchor="right" />)
    fireEvent.click(await screen.findByRole('button', { name: /notificaç/i }))

    const panel = screen.getByRole('menu')
    expect(panel).toHaveClass('left-full')
    expect(panel).not.toHaveClass('md:right-0')
  })

  it('sem anchor (ou "bottom"), o dropdown mantém o posicionamento atual', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationBell />)
    fireEvent.click(await screen.findByRole('button', { name: /notificaç/i }))

    const panel = screen.getByRole('menu')
    expect(panel).toHaveClass('md:right-0')
    expect(panel).not.toHaveClass('left-full')
  })

  it('variant="bare" mostra as classes de destaque ativo quando o dropdown está aberto', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationBell variant="bare" />)
    const button = await screen.findByRole('button', { name: /notificaç/i })
    expect(button).toHaveClass('h-11', 'w-11')
    expect(button).not.toHaveClass('border-primary-container/40', 'shadow-[0_0_15px_rgb(var(--brand-primary,37 222 136)/0.3)]')

    fireEvent.click(button)

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(button).toHaveClass('border-primary-container/40', 'bg-primary-container/20', 'text-primary', 'shadow-[0_0_15px_rgb(var(--brand-primary,37 222 136)/0.3)]')
  })

  it('variant="bare" mostra as classes inativas/hover quando o dropdown está fechado', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationBell variant="bare" />)
    const button = await screen.findByRole('button', { name: /notificaç/i })
    expect(button).toHaveClass('border-transparent', 'hover:border-primary-container/30', 'hover:bg-primary-container/10', 'hover:text-primary')
  })

  it('controlado (open=true), o dropdown aparece sem precisar clicar no botão', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    wrap(<NotificationBell open onOpenChange={vi.fn()} />)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('controlado, clicar no botão chama onOpenChange mas não abre sozinho (quem manda é o pai)', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/notifications/unread-count')) return { unreadCount: 0 } as never
      return { items: [], unreadCount: 0, nextCursor: null } as never
    })
    const onOpenChange = vi.fn()
    wrap(<NotificationBell open={false} onOpenChange={onOpenChange} />)
    fireEvent.click(await screen.findByRole('button', { name: /notificaç/i }))

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
