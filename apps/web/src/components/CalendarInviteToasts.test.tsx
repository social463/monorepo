import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CalendarInviteToasts } from './CalendarInviteToasts'
import { useUnreadNotificationsPoll } from '../lib/use-notifications'

vi.mock('../lib/use-notifications', () => ({ useUnreadNotificationsPoll: vi.fn() }))
const poll = useUnreadNotificationsPoll as unknown as Mock

function notificacao(id: string, type: string, title = 'Você foi convidado: "Prova Inspirali"') {
  return { id, type, title, link: '/calendario?dia=2026-09-10', read: false, createdAt: '', actor: null }
}

function renderToasts() {
  return render(
    <MemoryRouter>
      <CalendarInviteToasts />
    </MemoryRouter>,
  )
}

describe('CalendarInviteToasts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mostra o convite de evento como pop-up', () => {
    poll.mockReturnValue({ data: { items: [notificacao('n1', 'CALENDAR_EVENT_INVITED')] } })

    renderToasts()

    expect(screen.getByText('Convite de evento')).toBeInTheDocument()
    expect(screen.getByText(/Prova Inspirali/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver no calendário' })).toHaveAttribute(
      'href',
      '/calendario?dia=2026-09-10',
    )
  })

  it('nenhum outro tipo de notificação vira pop-up', () => {
    // Se qualquer tipo virasse, cada feedback recebido abriria uma janelinha.
    poll.mockReturnValue({
      data: {
        items: [
          notificacao('n1', 'FEEDBACK_RECEIVED'),
          notificacao('n2', 'CALENDAR_EVENT_REMINDER'),
          notificacao('n3', 'CORPORATE_POST_PUBLISHED'),
        ],
      },
    })

    renderToasts()

    expect(screen.queryByText('Convite de evento')).not.toBeInTheDocument()
  })

  it('fechar tira o aviso da tela sem marcar a notificação como lida', async () => {
    poll.mockReturnValue({ data: { items: [notificacao('n1', 'CALENDAR_EVENT_INVITED')] } })
    renderToasts()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))

    expect(screen.queryByText('Convite de evento')).not.toBeInTheDocument()
    // Nenhuma chamada de "marcar lida": o convite continua no sininho, que é
    // onde ele deve poder ser reencontrado.
    expect(poll).toHaveBeenCalled()
  })

  it('sem convite não desenha nada', () => {
    poll.mockReturnValue({ data: { items: [] } })
    const { container } = renderToasts()
    expect(container).toBeEmptyDOMElement()
  })
})
