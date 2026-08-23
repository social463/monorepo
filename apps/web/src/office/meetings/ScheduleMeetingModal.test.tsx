import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OfficeMeetingDTO, PublicUser } from '@legends/shared'
import { ScheduleMeetingModal } from './ScheduleMeetingModal'
import { ApiError } from '../../lib/api'
import * as api from './api'
import * as officeRoomsApi from '../../lib/office-rooms-api'

vi.mock('./api')
// `fetchOfficeRooms` mora em lib/, fora de `./api` — só entra em jogo quando
// a sala é escolhida no formulário (roomExternalKey null), então os 17
// testes de sala fixa nem chegam a chamá-lo (a query fica `enabled: false`).
vi.mock('../../lib/office-rooms-api')

const meeting: OfficeMeetingDTO = {
  id: 'mtg1',
  roomExternalKey: 'aurora',
  roomName: 'Aurora',
  title: 'Planning',
  agenda: null,
  startsAt: '2099-01-10T14:00:00.000Z',
  endsAt: '2099-01-10T15:00:00.000Z',
  canceled: false,
  organizer: { id: 'u1', name: 'Ana' },
  participants: [],
  googleCalendarUrl: 'https://calendar.google.com/x',
  outlookCalendarUrl: 'https://outlook.office.com/x',
  icsPath: '/office/meetings/mtg1/ics',
}

function user(id: string, name: string, sectorName = 'Desenvolvimento'): PublicUser {
  return { id, name, email: `${id}@x.com`, role: 'LEGEND', sectorName } as PublicUser
}

/** A mesma reunião, com alguém convidado — só organizador e convidados baixam o .ics. */
function convidando(id: string): OfficeMeetingDTO {
  return { ...meeting, participants: [{ id, name: 'Bruno' }] }
}

function renderModal(youId = 'u1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ScheduleMeetingModal roomExternalKey="aurora" roomName="Aurora" youId={youId} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

/**
 * Fluxo do calendário: sem sala fixa — o `MeetingForm` oferece o `Select`.
 * Sem `initialDateLocal` de propósito: o pré-preenchimento é coberto no teste
 * do `CalendarPage`, e aqui um campo já preenchido só atrapalharia o
 * `userEvent.type` (que digita em cima do que já está lá).
 */
function renderFreeModal(youId = 'u1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <ScheduleMeetingModal roomExternalKey={null} roomName={null} youId={youId} onClose={() => {}} />
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

/** A agenda e o painel pós-criação têm as mesmas ações — escopo evita ambiguidade. */
function agenda() {
  return screen.getByRole('region', { name: 'Próximas nesta sala' })
}

beforeEach(() => {
  // vi.mock('./api') dá mocks persistentes entre testes — sem isso, a
  // contagem de chamadas do teste de conflito herda as do teste anterior.
  vi.clearAllMocks()
  vi.mocked(api.fetchRoomMeetings).mockResolvedValue([])
  vi.mocked(api.createMeeting).mockResolvedValue(meeting)
  vi.mocked(api.updateMeeting).mockResolvedValue(meeting)
  vi.mocked(api.cancelMeeting).mockResolvedValue({ ...meeting, canceled: true })
  vi.mocked(api.fetchCompanyUsers).mockResolvedValue({
    users: [user('u1', 'Ana'), user('u2', 'Bruno'), user('u3', 'Carla')],
  })
  vi.mocked(officeRoomsApi.fetchOfficeRooms).mockResolvedValue({
    rooms: [
      { externalKey: 'sala-1', name: 'Sala 1', capacity: 4, status: 'OPEN', voiceEnabled: true },
      { externalKey: 'sala-2', name: 'Sala 2', capacity: null, status: 'OPEN', voiceEnabled: false },
    ],
  })
})

describe('ScheduleMeetingModal', () => {
  it('lista as reuniões já marcadas na sala', async () => {
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([meeting])
    renderModal()
    expect(await screen.findByText('Planning')).toBeInTheDocument()
  })

  it('cria a reunião e mostra os botões de exportar para a agenda', async () => {
    const u = userEvent.setup()
    renderModal()

    await u.type(screen.getByLabelText('Título'), 'Planning')
    await u.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:00')
    await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

    await waitFor(() => expect(api.createMeeting).toHaveBeenCalled())
    const painel = await screen.findByRole('region', { name: 'Reunião marcada' })
    expect(within(painel).getByRole('link', { name: /Google Calendar/ })).toHaveAttribute(
      'href',
      'https://calendar.google.com/x',
    )
    expect(within(painel).getByRole('button', { name: /Baixar \.ics/ })).toBeInTheDocument()
  })

  it('em conflito, avisa e só marca depois de confirmar', async () => {
    const u = userEvent.setup()
    vi.mocked(api.createMeeting)
      .mockRejectedValueOnce(
        new ApiError(409, 'A sala já tem reunião marcada nesse horário', {
          message: 'A sala já tem reunião marcada nesse horário',
          conflicts: [meeting],
        }),
      )
      .mockResolvedValueOnce(meeting)

    renderModal()
    await u.type(screen.getByLabelText('Título'), 'Outra')
    await u.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:30')
    await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

    expect(await screen.findByText(/já tem reunião marcada/)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Marcar mesmo assim' }))

    await waitFor(() => expect(api.createMeeting).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.createMeeting).mock.calls[1]![0].force).toBe(true)
  })

  it('editar o formulário depois do conflito descarta o aviso — "Marcar mesmo assim" some, não reenvia payload desatualizado', async () => {
    const u = userEvent.setup()
    vi.mocked(api.createMeeting).mockRejectedValueOnce(
      new ApiError(409, 'A sala já tem reunião marcada nesse horário', {
        message: 'A sala já tem reunião marcada nesse horário',
        conflicts: [meeting],
      }),
    )

    renderModal()
    await u.type(screen.getByLabelText('Título'), 'Outra')
    await u.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:30')
    await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

    expect(await screen.findByText(/já tem reunião marcada/)).toBeInTheDocument()

    // O aviso e o botão de confirmar descrevem o payload que gerou o 409
    // (horário 14:30). Mudar o horário invalida esse payload congelado — o
    // comportamento implementado é o aviso (e o botão "Marcar mesmo assim")
    // sumirem, forçando a pessoa a submeter de novo e passar pela checagem
    // do backend com o horário atual.
    fireEvent.change(screen.getByLabelText('Data e hora'), { target: { value: '2099-01-10T15:00' } })

    expect(screen.queryByText(/já tem reunião marcada/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar mesmo assim' })).not.toBeInTheDocument()
    // Nenhuma chamada extra: nem o horário velho (14:30) nem o novo (15:00)
    // foram forçados sem antes passar de novo pela checagem de conflito.
    expect(api.createMeeting).toHaveBeenCalledTimes(1)
  })

  it('convida quem não está no escritório agora: a lista vem de /users', async () => {
    const u = userEvent.setup()
    renderModal()

    // Carla nunca apareceu como ocupante da sala e mesmo assim é convidável.
    await u.click(await screen.findByLabelText('Carla'))
    await u.type(screen.getByLabelText('Título'), 'Planning')
    await u.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:00')
    await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

    await waitFor(() => expect(api.createMeeting).toHaveBeenCalled())
    expect(vi.mocked(api.createMeeting).mock.calls[0]![0].participantIds).toEqual(['u3'])
  })

  it('não oferece o próprio organizador como convidado e filtra a lista por nome', async () => {
    const u = userEvent.setup()
    renderModal('u1')

    expect(await screen.findByLabelText('Bruno')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ana')).not.toBeInTheDocument()

    await u.type(screen.getByLabelText('Filtrar pessoas'), 'car')
    expect(screen.queryByLabelText('Bruno')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Carla')).toBeInTheDocument()
  })

  it('o filtro ignora acento nos dois sentidos', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchCompanyUsers).mockResolvedValue({
      users: [user('u1', 'Ana'), user('u2', 'Cauã Récio'), user('u3', 'Joao Silva')],
    })
    renderModal('u1')

    // Termo sem acento acha o nome acentuado…
    await u.type(await screen.findByLabelText('Filtrar pessoas'), 'caua')
    expect(screen.getByLabelText('Cauã Récio')).toBeInTheDocument()
    expect(screen.queryByLabelText('Joao Silva')).not.toBeInTheDocument()

    // …e o termo acentuado acha o nome sem acento.
    await u.clear(screen.getByLabelText('Filtrar pessoas'))
    await u.type(screen.getByLabelText('Filtrar pessoas'), 'joão')
    expect(screen.getByLabelText('Joao Silva')).toBeInTheDocument()
  })

  it('escolher alguém limpa a busca — o normal é procurar a próxima pessoa', async () => {
    const u = userEvent.setup()
    renderModal('u1')

    const busca = await screen.findByLabelText('Filtrar pessoas')
    await u.type(busca, 'car')
    await u.click(screen.getByLabelText('Carla'))

    expect(busca).toHaveValue('')
    // E a lista volta inteira, sem o filtro que já cumpriu o papel.
    expect(screen.getByLabelText('Bruno')).toBeInTheDocument()
  })

  it('mantém visível quem já foi escolhido mesmo quando o filtro o esconde', async () => {
    const u = userEvent.setup()
    renderModal()

    await u.click(await screen.findByLabelText('Bruno'))
    await u.type(screen.getByLabelText('Filtrar pessoas'), 'car')

    expect(screen.queryByLabelText('Bruno')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remover Bruno' })).toBeInTheDocument()
  })

  describe('convidar setor inteiro e empresa inteira', () => {
    beforeEach(() => {
      vi.mocked(api.fetchCompanyUsers).mockResolvedValue({
        users: [
          user('u1', 'Ana', 'Desenvolvimento'),
          user('u2', 'Bruno', 'Desenvolvimento'),
          user('u3', 'Carla', 'Gente e Gestão'),
          user('u4', 'Davi', 'Gente e Gestão'),
        ],
      })
    })

    it('marca o setor inteiro num clique, sem tocar nos outros setores', async () => {
      const u = userEvent.setup()
      renderModal('u1')

      await u.click(await screen.findByLabelText(/Gente e Gestão/))
      await u.type(screen.getByLabelText('Título'), 'Planning')
      await u.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:00')
      await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

      await waitFor(() => expect(api.createMeeting).toHaveBeenCalled())
      expect(vi.mocked(api.createMeeting).mock.calls[0]![0].participantIds).toEqual(['u3', 'u4'])
    })

    it('empresa inteira convida todo mundo menos o organizador', async () => {
      const u = userEvent.setup()
      renderModal('u1')

      // A contagem não inclui Ana: quem marca não se convida.
      await u.click(await screen.findByLabelText('Empresa inteira (3)'))
      await u.type(screen.getByLabelText('Título'), 'Town hall')
      await u.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:00')
      await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

      await waitFor(() => expect(api.createMeeting).toHaveBeenCalled())
      expect(vi.mocked(api.createMeeting).mock.calls[0]![0].participantIds).toEqual(['u2', 'u3', 'u4'])
    })

    it('setor com parte marcada aparece como parcial, e desmarcar o cabeçalho tira só aquele setor', async () => {
      const u = userEvent.setup()
      renderModal('u1')

      await u.click(await screen.findByLabelText('Carla'))
      const setor = screen.getByLabelText(/Gente e Gestão/)
      expect(setor).toBePartiallyChecked()

      // Do parcial, o clique completa o setor…
      await u.click(setor)
      expect(screen.getByLabelText('Davi')).toBeChecked()
      // …e o seguinte o esvazia, sem mexer em quem foi escolhido à mão fora dele.
      await u.click(screen.getByLabelText('Bruno'))
      await u.click(screen.getByLabelText(/Gente e Gestão/))
      expect(screen.getByLabelText('Carla')).not.toBeChecked()
      expect(screen.getByLabelText('Bruno')).toBeChecked()
    })

    it('o cabeçalho age sobre o setor inteiro, não só sobre quem o filtro deixou à vista', async () => {
      const u = userEvent.setup()
      renderModal('u1')

      // Filtro esconde Davi; o cabeçalho continua dizendo "(2)" e é isso que ele marca.
      await u.type(await screen.findByLabelText('Filtrar pessoas'), 'carla')
      await u.click(screen.getByLabelText('Gente e Gestão (2)'))

      expect(screen.getByRole('button', { name: 'Remover Carla' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remover Davi' })).toBeInTheDocument()
    })

    it('"Limpar" esvazia a seleção inteira', async () => {
      const u = userEvent.setup()
      renderModal('u1')

      await u.click(await screen.findByLabelText('Empresa inteira (3)'))
      expect(screen.getByText('3 escolhidos')).toBeInTheDocument()

      await u.click(screen.getByRole('button', { name: 'Limpar' }))
      expect(screen.queryByText('3 escolhidos')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Bruno')).not.toBeChecked()
    })
  })

  it('oferece exportar para a agenda em cada linha, não só logo após criar', async () => {
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([convidando('u2')])
    renderModal('u2') // convidado, não o organizador: nunca passa pela criação

    const linha = await within(agenda()).findByRole('listitem')
    expect(within(linha).getByRole('link', { name: /Google Calendar/ })).toHaveAttribute(
      'href',
      'https://calendar.google.com/x',
    )
    expect(within(linha).getByRole('button', { name: /Baixar \.ics/ })).toBeInTheDocument()
  })

  it('reunião alheia não oferece o .ics — a rota responde 403 a quem não participa', async () => {
    // Sala movimentada: a agenda lista reunião de todo mundo, e a de Ana com
    // Bruno não é da Carla. Botão que só sabe falhar não é oferecido.
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([convidando('u2')])
    renderModal('u3')

    const linha = await within(agenda()).findByRole('listitem')
    expect(within(linha).queryByRole('button', { name: /Baixar \.ics/ })).not.toBeInTheDocument()
    // O resto continua: o link do Google sai do DTO e não passa por rota protegida.
    expect(within(linha).getByRole('link', { name: /Google Calendar/ })).toBeInTheDocument()
    expect(within(linha).getByRole('button', { name: 'Copiar link da sala' })).toBeInTheDocument()
  })

  it('download que falha mostra o erro em vez de rejeitar em silêncio', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([convidando('u2')])
    vi.mocked(api.downloadMeetingIcs).mockRejectedValue(new ApiError(403, 'Você não participa desta reunião'))
    renderModal('u2')

    const linha = await within(agenda()).findByRole('listitem')
    await u.click(within(linha).getByRole('button', { name: /Baixar \.ics/ }))

    expect(await within(linha).findByText('Você não participa desta reunião')).toBeInTheDocument()
  })

  it('reunião cancelada continua oferecendo o .ics — é ele que avisa o Outlook', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([{ ...convidando('u2'), canceled: true }])
    renderModal('u2')

    const linha = await within(agenda()).findByRole('listitem')
    const baixar = within(linha).getByRole('button', { name: 'Baixar .ics do cancelamento' })
    await u.click(baixar)
    expect(api.downloadMeetingIcs).toHaveBeenCalled()
    // Nada de "adicionar" um compromisso que não existe mais.
    expect(within(linha).queryByRole('link', { name: /Google Calendar/ })).not.toBeInTheDocument()
  })

  it('organizador edita a reunião com o formulário pré-preenchido', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([
      { ...meeting, agenda: 'Revisar o board', participants: [{ id: 'u2', name: 'Bruno' }] },
    ])
    renderModal('u1')

    await u.click(await within(agenda()).findByRole('button', { name: 'Editar' }))

    expect(screen.getByLabelText('Título')).toHaveValue('Planning')
    expect(screen.getByLabelText('Pauta (opcional)')).toHaveValue('Revisar o board')
    expect(screen.getByLabelText('Bruno')).toBeChecked()

    await u.clear(screen.getByLabelText('Título'))
    await u.type(screen.getByLabelText('Título'), 'Planning revisada')
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(api.updateMeeting).toHaveBeenCalled())
    const [id, body] = vi.mocked(api.updateMeeting).mock.calls[0]!
    expect(id).toBe('mtg1')
    expect(body.title).toBe('Planning revisada')
    expect(body.participantIds).toEqual(['u2'])
    // Volta ao modo "nova reunião" depois de salvar.
    expect(await screen.findByRole('button', { name: 'Marcar reunião' })).toBeInTheDocument()
  })

  it('conflito na edição usa o mesmo "Marcar mesmo assim", com o payload congelado', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([meeting])
    vi.mocked(api.updateMeeting)
      .mockRejectedValueOnce(
        new ApiError(409, 'A sala já tem reunião marcada nesse horário', {
          message: 'A sala já tem reunião marcada nesse horário',
          conflicts: [meeting],
        }),
      )
      .mockResolvedValueOnce(meeting)

    renderModal('u1')
    await u.click(await within(agenda()).findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Data e hora'), { target: { value: '2099-01-10T16:00' } })
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText(/já tem reunião marcada/)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Marcar mesmo assim' }))

    await waitFor(() => expect(api.updateMeeting).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.updateMeeting).mock.calls[1]![1].force).toBe(true)
    expect(vi.mocked(api.updateMeeting).mock.calls[1]![1].startsAt).toBe(
      vi.mocked(api.updateMeeting).mock.calls[0]![1].startsAt,
    )
  })

  it('409 sem conflitos vira mensagem de erro, não banner de conflito', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([meeting])
    // PATCH e DELETE respondem 409 para "Reunião já cancelada" — sem `conflicts`
    // no corpo. Tratar isso como conflito de horário mostraria um banner vazio
    // com um "Marcar mesmo assim" que não resolve nada.
    vi.mocked(api.updateMeeting).mockRejectedValueOnce(
      new ApiError(409, 'Reunião já cancelada', { message: 'Reunião já cancelada' }),
    )

    renderModal('u1')
    await u.click(await within(agenda()).findByRole('button', { name: 'Editar' }))
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText('Reunião já cancelada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar mesmo assim' })).not.toBeInTheDocument()
  })

  it('cancelar a reunião em edição não deixa o banner de conflito órfão', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([meeting])
    vi.mocked(api.updateMeeting).mockRejectedValueOnce(
      new ApiError(409, 'A sala já tem reunião marcada nesse horário', {
        message: 'A sala já tem reunião marcada nesse horário',
        conflicts: [meeting],
      }),
    )

    renderModal('u1')
    await u.click(await within(agenda()).findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Data e hora'), { target: { value: '2099-01-10T16:00' } })
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(await screen.findByText(/já tem reunião marcada/)).toBeInTheDocument()

    await u.click(within(agenda()).getByRole('button', { name: 'Cancelar' }))

    // O aviso falava de uma reunião que acabou de cair, e o "Marcar mesmo
    // assim" mandaria um PATCH nela — os dois somem junto com o modo de edição.
    await waitFor(() => expect(screen.queryByText(/já tem reunião marcada/)).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Marcar mesmo assim' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar reunião' })).toBeInTheDocument()
  })

  it('sair da edição limpa a mensagem de erro', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([meeting])
    vi.mocked(api.updateMeeting).mockRejectedValueOnce(new ApiError(400, 'Escolha um horário no futuro'))

    renderModal('u1')
    await u.click(await within(agenda()).findByRole('button', { name: 'Editar' }))
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(await screen.findByText('Escolha um horário no futuro')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Cancelar edição' }))
    expect(screen.queryByText('Escolha um horário no futuro')).not.toBeInTheDocument()
  })

  it('cancelar que falha mostra o erro em vez de não fazer nada', async () => {
    const u = userEvent.setup()
    vi.mocked(api.fetchRoomMeetings).mockResolvedValue([meeting])
    vi.mocked(api.cancelMeeting).mockRejectedValue(new ApiError(409, 'Reunião já cancelada'))

    renderModal('u1')
    await u.click(await within(agenda()).findByRole('button', { name: 'Cancelar' }))

    expect(await screen.findByText('Reunião já cancelada')).toBeInTheDocument()
  })

  describe('sala escolhida no formulário (fluxo do calendário, roomExternalKey nulo)', () => {
    it('sem sala escolhida a agenda do topo não busca; escolher a sala carrega a agenda dela', async () => {
      const u = userEvent.setup()
      const meetingSala1: OfficeMeetingDTO = { ...meeting, id: 'm-sala1', roomExternalKey: 'sala-1', title: 'Retro Sala 1' }
      // Só a sala-1 tem reunião — provar que a busca usa a sala escolhida, não uma fixa.
      vi.mocked(api.fetchRoomMeetings).mockImplementation((room: string) =>
        Promise.resolve(room === 'sala-1' ? [meetingSala1] : []),
      )

      renderFreeModal()

      // Sem sala ainda: `useRoomMeetings(null)` fica `enabled: false` — nenhuma busca acontece.
      expect(api.fetchRoomMeetings).not.toHaveBeenCalled()

      await u.click(await screen.findByLabelText('Sala'))
      await u.click(await screen.findByRole('option', { name: /sala 1/i }))

      expect(await within(agenda()).findByText('Retro Sala 1')).toBeInTheDocument()
      expect(api.fetchRoomMeetings).toHaveBeenCalledWith('sala-1')
    })

    it('escolher a sala fecha o dropdown', async () => {
      const u = userEvent.setup()
      renderFreeModal()

      await u.click(await screen.findByLabelText('Sala'))
      await u.click(await screen.findByRole('option', { name: /sala 1/i }))

      // O campo já viveu embrulhado num `<label>`: o clique na opção fechava a
      // lista e o rótulo reencaminhava o mesmo clique ao combobox, que reabria.
      // (`queryByRole('option')` não serve aqui: o `<select>` nativo de Duração
      // também tem options — o que precisa sumir é a caixa do combobox.)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Sala')).toHaveAttribute('aria-expanded', 'false')
    })

    it('criar reunião no fluxo livre invalida a queryKey do calendário', async () => {
      const u = userEvent.setup()
      const { client } = renderFreeModal()
      const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

      await u.click(await screen.findByLabelText('Sala'))
      await u.click(await screen.findByRole('option', { name: /sala 1/i }))
      await u.type(screen.getByLabelText('Título'), 'Planning')
      await u.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:00')
      await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

      await waitFor(() => expect(api.createMeeting).toHaveBeenCalled())
      // A queryKey da sala já é invalidada pelo hook (`useCreateMeeting`) — esta
      // é a invalidação extra, manual, pra `useCalendarData` também atualizar.
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['calendar-meetings'] })
    })

    it('trocar de sala em "Marcar outra" faz a segunda criação usar a sala nova — no POST e na invalidação', async () => {
      const u = userEvent.setup()
      renderFreeModal()

      await u.click(await screen.findByLabelText('Sala'))
      await u.click(await screen.findByRole('option', { name: /sala 1/i }))
      await u.type(screen.getByLabelText('Título'), 'Primeira')
      await u.type(screen.getByLabelText('Data e hora'), '2099-01-10T14:00')
      await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

      await waitFor(() => expect(api.createMeeting).toHaveBeenCalledTimes(1))
      expect(vi.mocked(api.createMeeting).mock.calls[0]![0].roomExternalKey).toBe('sala-1')

      await u.click(await screen.findByRole('button', { name: 'Marcar outra' }))
      await u.click(await screen.findByLabelText('Sala'))
      await u.click(await screen.findByRole('option', { name: /sala 2/i }))
      await u.type(screen.getByLabelText('Título'), 'Segunda')
      await u.type(screen.getByLabelText('Data e hora'), '2099-01-11T14:00')
      await u.click(screen.getByRole('button', { name: 'Marcar reunião' }))

      await waitFor(() => expect(api.createMeeting).toHaveBeenCalledTimes(2))
      // O POST da segunda reunião foi pra sala nova...
      expect(vi.mocked(api.createMeeting).mock.calls[1]![0].roomExternalKey).toBe('sala-2')
      // ...e a agenda/invalidação do topo seguiram junto (não ficaram presas à sala-1).
      expect(api.fetchRoomMeetings).toHaveBeenCalledWith('sala-2')
    })

    it('entrar em edição esconde o seletor de sala — o PATCH não muda de sala', async () => {
      const u = userEvent.setup()
      vi.mocked(api.fetchRoomMeetings).mockResolvedValue([{ ...meeting, roomExternalKey: 'sala-1' }])

      renderFreeModal('u1')
      await u.click(await screen.findByLabelText('Sala'))
      await u.click(await screen.findByRole('option', { name: /sala 1/i }))

      await u.click(await within(agenda()).findByRole('button', { name: 'Editar' }))

      expect(screen.queryByLabelText('Sala')).not.toBeInTheDocument()
    })
  })
})
