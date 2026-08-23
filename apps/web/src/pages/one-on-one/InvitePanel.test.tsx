import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OneOnOneMeetingSummaryDTO, OneOnOnePersonDTO } from '@legends/shared'
import { InvitePanel } from './InvitePanel'

function pessoa(id: string, name: string): OneOnOnePersonDTO {
  return { id, name, photoUrl: null, position: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }
}

vi.mock('../../lib/one-on-one-api', () => ({
  respondToOneOnOne: vi.fn(),
  acceptOneOnOneProposal: vi.fn(),
  declineOneOnOneProposal: vi.fn(),
}))

const api = await import('../../lib/one-on-one-api')

function meeting(over: Partial<OneOnOneMeetingSummaryDTO> = {}): OneOnOneMeetingSummaryDTO {
  return {
    id: 'm1',
    seriesId: 's1',
    startsAt: '2026-08-11T13:00:00.000Z',
    endsAt: '2026-08-11T13:30:00.000Z',
    status: 'SCHEDULED',
    recurrence: 'WEEKLY',
    counterpart: pessoa('u2', 'Bruno'),
    openActionCount: 0,
    topicCount: 0,
    inviteeResponse: 'PENDING',
    viewerIsInvitee: true,
    proposedStartsAt: null,
    declineNote: null,
    ...over,
  }
}

function renderPanel(over: Partial<OneOnOneMeetingSummaryDTO> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InvitePanel meeting={meeting(over)} />
    </QueryClientProvider>,
  )
}

/**
 * Sugestão de horário sempre à frente de hoje. O campo tem `min` de agora
 * (`InvitePanel.tsx`), então uma data cravada é aceita pela validação nativa só
 * até virar passado — depois disso o submit não sai e o teste falha sem nada ter
 * regredido. Foi o que aconteceu quando 13/08/2026 ficou para trás.
 */
function sugestaoFutura(): string {
  const data = new Date()
  data.setDate(data.getDate() + 7)
  const pad = (valor: number) => String(valor).padStart(2, '0')
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}T14:00`
}

beforeEach(() => vi.resetAllMocks())

describe('InvitePanel — lado do convidado', () => {
  /**
   * Aceitar assume a SÉRIE. Exigir uma resposta por ocorrência é exatamente a
   * fricção que a feature existe para remover.
   */
  it('aceitar uma série responde pela série inteira', async () => {
    vi.mocked(api.respondToOneOnOne).mockResolvedValue({ meeting: meeting() })

    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /aceitar a série/i }))

    await waitFor(() =>
      expect(api.respondToOneOnOne).toHaveBeenCalledWith('m1', { response: 'ACCEPTED' }, 'future'),
    )
  })

  it('encontro avulso aceita só a si mesmo', async () => {
    vi.mocked(api.respondToOneOnOne).mockResolvedValue({ meeting: meeting() })

    renderPanel({ recurrence: 'NONE' })
    await userEvent.click(screen.getByRole('button', { name: /^aceitar$/i }))

    await waitFor(() =>
      expect(api.respondToOneOnOne).toHaveBeenCalledWith('m1', { response: 'ACCEPTED' }, 'this'),
    )
  })

  /** Recusar assume só ESTA ocorrência: o caso comum é uma semana específica. */
  it('recusar manda sugestão e motivo, com escopo só deste encontro', async () => {
    vi.mocked(api.respondToOneOnOne).mockResolvedValue({ meeting: meeting() })

    const sugestao = sugestaoFutura()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /não posso/i }))
    await userEvent.type(screen.getByLabelText(/sugerir outro horário/i), sugestao)
    await userEvent.type(screen.getByLabelText(/motivo/i), 'Viagem')
    await userEvent.click(screen.getByRole('button', { name: /enviar recusa/i }))

    await waitFor(() => expect(api.respondToOneOnOne).toHaveBeenCalledTimes(1))
    const [id, body, scope] = vi.mocked(api.respondToOneOnOne).mock.calls[0]
    expect(id).toBe('m1')
    expect(scope).toBe('this')
    expect(body.response).toBe('DECLINED')
    expect(body.declineNote).toBe('Viagem')
    // O campo fala relógio local; o que viaja é o instante.
    expect(new Date(body.proposedStartsAt!).getTime()).toBe(new Date(sugestao).getTime())
  })

  it('deixa claro que recusar não cancela o encontro', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /não posso/i }))

    expect(screen.getByText(/recusar não cancela/i)).toBeInTheDocument()
  })

  it('convidado que já respondeu não vê o painel', () => {
    const { container } = renderPanel({ inviteeResponse: 'ACCEPTED' })
    expect(container).toBeEmptyDOMElement()
  })
})

describe('InvitePanel — lado de quem marcou', () => {
  const comoCriador = { viewerIsInvitee: false } as const

  it('não vê botão de aceitar o próprio convite, só o aguardo', () => {
    renderPanel(comoCriador)

    expect(screen.getByText(/aguardando a resposta de bruno/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /aceitar/i })).not.toBeInTheDocument()
  })

  it('some quando o convite já foi aceito', () => {
    const { container } = renderPanel({ ...comoCriador, inviteeResponse: 'ACCEPTED' })
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra a sugestão com as duas formas de aceitar', async () => {
    vi.mocked(api.acceptOneOnOneProposal).mockResolvedValue({ meeting: meeting() })

    renderPanel({
      ...comoCriador,
      inviteeResponse: 'DECLINED',
      proposedStartsAt: '2026-08-13T17:00:00.000Z',
      declineNote: 'Terça não dá',
    })

    expect(screen.getByText(/“Terça não dá”/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /aceitar e mover a série/i }))
    await waitFor(() => expect(api.acceptOneOnOneProposal).toHaveBeenCalledWith('m1', 'future'))

    await userEvent.click(screen.getByRole('button', { name: /aceitar só neste/i }))
    await waitFor(() => expect(api.acceptOneOnOneProposal).toHaveBeenCalledWith('m1', 'this'))
  })

  it('encontro avulso não oferece mover a série', () => {
    renderPanel({
      ...comoCriador,
      recurrence: 'NONE',
      inviteeResponse: 'DECLINED',
      proposedStartsAt: '2026-08-13T17:00:00.000Z',
    })

    expect(screen.queryByRole('button', { name: /mover a série/i })).not.toBeInTheDocument()
  })

  it('descartar a sugestão devolve a bola sem remarcar', async () => {
    vi.mocked(api.declineOneOnOneProposal).mockResolvedValue({ meeting: meeting() })

    renderPanel({ ...comoCriador, inviteeResponse: 'DECLINED', proposedStartsAt: '2026-08-13T17:00:00.000Z' })
    await userEvent.click(screen.getByRole('button', { name: /descartar/i }))

    await waitFor(() => expect(api.declineOneOnOneProposal).toHaveBeenCalledWith('m1'))
    expect(api.acceptOneOnOneProposal).not.toHaveBeenCalled()
  })

  it('recusa sem sugestão manda remarcar ou cancelar pelo menu', () => {
    renderPanel({ ...comoCriador, inviteeResponse: 'DECLINED', declineNote: 'Não consigo' })

    expect(screen.getByText(/bruno não pode neste horário/i)).toBeInTheDocument()
    expect(screen.getByText(/remarque ou cancele/i)).toBeInTheDocument()
  })
})
