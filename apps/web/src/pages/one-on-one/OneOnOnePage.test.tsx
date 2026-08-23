import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { OneOnOneMeetingSummaryDTO, OneOnOnePersonDTO } from '@legends/shared'
import { OneOnOnePage } from './OneOnOnePage'

/** Pessoa do 1:1 sem personagem nem foto — o `<Avatar>` cai nas iniciais. */
function pessoa(id: string, name: string, position: string | null = null): OneOnOnePersonDTO {
  return { id, name, photoUrl: null, position, avatarStyle: null, avatarSeed: null, avatarOptions: null }
}

vi.mock('../../lib/one-on-one-api', () => ({
  listOneOnOnes: vi.fn(),
  cancelOneOnOne: vi.fn(),
  rescheduleOneOnOne: vi.fn(),
}))

// O tempo real tem teste próprio (`useOneOnOneSocket.test.tsx`); aqui ele só
// abriria um WebSocket de verdade e deixaria timers de reconexão para trás.
vi.mock('../../lib/useOneOnOneSocket', () => ({ useOneOnOneSocket: () => {} }))

const { cancelOneOnOne, listOneOnOnes } = await import('../../lib/one-on-one-api')

/**
 * O `endsAt` acompanha o `startsAt` (30 min, a duração padrão de uma série) em
 * vez de ficar cravado: é ele que decide se o encontro já é passado, e um fim
 * congelado enquanto o teste move só o início produzia encontro que "termina"
 * antes de começar.
 */
function meeting(over: Partial<OneOnOneMeetingSummaryDTO> = {}): OneOnOneMeetingSummaryDTO {
  const startsAt = over.startsAt ?? '2026-08-10T13:00:00.000Z'
  return {
    id: 'm1',
    seriesId: 's1',
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
    status: 'SCHEDULED',
    recurrence: 'WEEKLY',
    counterpart: pessoa('u2', 'Bruno', 'Dev'),
    openActionCount: 2,
    topicCount: 3,
    inviteeResponse: 'ACCEPTED',
    viewerIsInvitee: false,
    proposedStartsAt: null,
    declineNote: null,
    ...over,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OneOnOnePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('OneOnOnePage', () => {
  it('mostra o próximo 1:1 com a pessoa e as ações em aberto', async () => {
    vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: [meeting()] })

    renderPage()

    expect(await screen.findByText('Bruno')).toBeInTheDocument()
    expect(screen.getByText(/2 ações em aberto/i)).toBeInTheDocument()
  })

  it('convida a marcar quando não há nenhum 1:1', async () => {
    vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: [] })

    renderPage()

    expect(await screen.findByText(/nenhum 1:1 marcado/i)).toBeInTheDocument()
  })

  /**
   * O aviso de pauta é o único acionável enquanto ainda dá tempo de preparar —
   * e por isso não aparece no que já passou, onde não há mais o que fazer.
   */
  it('avisa "sem pauta" no encontro futuro e não no que já passou', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', startsAt: '2026-08-13T13:00:00.000Z', topicCount: 0 }),
        meeting({ id: 'm2', startsAt: '2026-08-01T13:00:00.000Z', topicCount: 0, status: 'DONE' }),
      ],
    })

    renderPage()

    const aviso = await screen.findByText('Sem pauta')
    expect(aviso.closest('[data-meeting-card]')).toHaveAttribute('data-meeting-card', 'm1')
    expect(screen.getAllByText('Sem pauta')).toHaveLength(1)
    expect(screen.getByText('Realizado').closest('[data-meeting-card]')).toHaveAttribute('data-meeting-card', 'm2')
  })

  it('marca a pauta como pronta quando o encontro já tem tópicos', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [meeting({ id: 'm1', startsAt: '2026-08-13T13:00:00.000Z', topicCount: 2 })],
    })

    renderPage()

    expect(await screen.findByText('Pauta pronta')).toBeInTheDocument()
    expect(screen.queryByText('Sem pauta')).not.toBeInTheDocument()
  })

  /**
   * A 1:1 das 13h30 com 30 min: às 13h31 ela estava sendo jogada no histórico,
   * esmaecida e com "Ver resumo", enquanto acontecia. O corte é o FIM.
   */
  describe('encontro em andamento', () => {
    const emCurso = () =>
      meeting({ id: 'm1', startsAt: '2026-08-10T13:30:00.000Z', endsAt: '2026-08-10T14:00:00.000Z' })

    it('fica em destaque, e não no histórico, entre o início e o fim', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-10T13:31:00.000Z').getTime())
      vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: [emCurso()] })

      renderPage()

      expect(await screen.findByText('Acontecendo agora')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /agora e a seguir/i })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /histórico recente/i })).not.toBeInTheDocument()
      // Continua acionável: a pauta, não o resumo.
      expect(screen.getByText('Abrir pauta')).toBeInTheDocument()
      expect(screen.queryByText('Ver resumo')).not.toBeInTheDocument()
    })

    it('mostra até que horas vai', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-10T13:31:00.000Z').getTime())
      vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: [emCurso()] })

      renderPage()

      expect(await screen.findByText(/até \d{2}:\d{2}$/)).toBeInTheDocument()
    })

    it('só vai para o histórico depois do fim', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-10T14:00:00.000Z').getTime())
      vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: [emCurso()] })

      renderPage()

      expect(await screen.findByRole('heading', { name: /histórico recente/i })).toBeInTheDocument()
      expect(screen.queryByText('Acontecendo agora')).not.toBeInTheDocument()
      expect(screen.getByText('Ver resumo')).toBeInTheDocument()
    })

    /** A pendência é tratada NO encontro que está rolando — não no seguinte. */
    it('leva o selo de pendência para o encontro em andamento', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-10T13:31:00.000Z').getTime())
      vi.mocked(listOneOnOnes).mockResolvedValue({
        meetings: [emCurso(), meeting({ id: 'm2', startsAt: '2026-08-17T13:30:00.000Z' })],
      })

      renderPage()
      await screen.findAllByText('Bruno')

      const selos = screen.getAllByText(/2 ações em aberto/i)
      expect(selos).toHaveLength(1)
      expect(selos[0].closest('[data-meeting-card]')).toHaveAttribute('data-meeting-card', 'm1')
    })
  })

  it('escreve "Hoje" e "Amanhã" em vez da data cheia', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', startsAt: '2026-08-06T18:00:00.000Z' }),
        meeting({ id: 'm2', startsAt: '2026-08-07T13:00:00.000Z' }),
      ],
    })

    renderPage()

    expect(await screen.findByText(/^Hoje, /)).toBeInTheDocument()
    expect(screen.getByText(/^Amanhã, /)).toBeInTheDocument()
  })

  describe('corte dos próximos', () => {
    /** Uma série semanal sozinha enche a tela; o corte é o que segura isso. */
    function serieSemanal(quantidade: number) {
      const primeiro = new Date('2026-08-10T13:00:00.000Z').getTime()
      return Array.from({ length: quantidade }, (_, i) =>
        meeting({
          id: `m${i}`,
          startsAt: new Date(primeiro + i * 7 * 86_400_000).toISOString(),
          openActionCount: 0,
        }),
      )
    }

    it('mostra só os 5 primeiros e dobra o resto', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
      vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: serieSemanal(8) })

      renderPage()

      expect(await screen.findAllByText('Bruno')).toHaveLength(5)
      expect(screen.getByRole('button', { name: /ver mais 3 encontros/i })).toHaveAttribute('aria-expanded', 'false')
    })

    it('expande e recolhe pelo botão', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
      vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: serieSemanal(8) })

      renderPage()
      await userEvent.click(await screen.findByRole('button', { name: /ver mais/i }))

      expect(screen.getAllByText('Bruno')).toHaveLength(8)

      await userEvent.click(screen.getByRole('button', { name: /ver menos/i }))
      expect(screen.getAllByText('Bruno')).toHaveLength(5)
    })

    it('sem excedente, não oferece botão nenhum', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
      vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: serieSemanal(5) })

      renderPage()
      await screen.findAllByText('Bruno')

      expect(screen.queryByRole('button', { name: /ver mais|ver menos/i })).not.toBeInTheDocument()
    })

    /**
     * O selo de pendência existe para a cobrança não sumir da tela. Se ele cai
     * num encontro dobrado, o botão precisa dizer isso — senão o corte
     * reintroduz exatamente o problema que o selo resolve.
     */
    it('anuncia no botão a pendência que ficou dobrada', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
      const proximos = serieSemanal(6)
      vi.mocked(listOneOnOnes).mockResolvedValue({
        meetings: [
          ...proximos,
          // Só esta pessoa tem pendência, e o encontro dela é o mais distante:
          // cai fora dos 5 primeiros.
          meeting({
            id: 'mx',
            startsAt: '2026-11-01T13:00:00.000Z',
            counterpart: pessoa('u3', 'Carla', 'PO'),
            openActionCount: 4,
          }),
        ],
      })

      renderPage()

      expect(await screen.findByRole('button', { name: /ver mais 2 encontros · 1 com ação em aberto/i })).toBeInTheDocument()
    })
  })

  /**
   * A contagem de pendências é do PAR, então vem igual em toda ocorrência da
   * série. O selo marca ONDE aquilo vai ser tratado — o próximo encontro — em
   * vez de repetir em cada linha da lista.
   */
  it('mostra o selo de pendência só no próximo encontro da pessoa', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', startsAt: '2026-08-13T13:00:00.000Z' }),
        meeting({ id: 'm2', startsAt: '2026-08-20T13:00:00.000Z' }),
        meeting({ id: 'm3', startsAt: '2026-08-27T13:00:00.000Z' }),
      ],
    })

    renderPage()
    await screen.findAllByText('Bruno')

    expect(screen.getAllByText(/2 ações em aberto/i)).toHaveLength(1)
  })

  it('dá um selo para cada pessoa — o próximo encontro de cada uma', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', startsAt: '2026-08-13T13:00:00.000Z' }),
        meeting({ id: 'm2', startsAt: '2026-08-20T13:00:00.000Z' }),
        meeting({
          id: 'm3',
          seriesId: 's2',
          startsAt: '2026-08-14T13:00:00.000Z',
          counterpart: pessoa('u3', 'Carla', 'PO'),
          openActionCount: 1,
        }),
      ],
    })

    renderPage()
    await screen.findAllByText('Bruno')

    expect(screen.getAllByText(/2 ações em aberto/i)).toHaveLength(1)
    expect(screen.getAllByText(/1 ação em aberto/i)).toHaveLength(1)
  })

  /** Sem encontro futuro, a pendência não pode sumir da tela: cai no último passado. */
  it('sem próximo encontro, o selo fica no encontro mais recente do passado', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-30T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', startsAt: '2026-08-13T13:00:00.000Z' }),
        meeting({ id: 'm2', startsAt: '2026-08-20T13:00:00.000Z' }),
      ],
    })

    renderPage()
    await screen.findAllByText('Bruno')

    const selos = screen.getAllByText(/2 ações em aberto/i)
    expect(selos).toHaveLength(1)
    // O card do selo é o do dia 20 (o mais recente), não o do dia 13.
    expect(selos[0].closest('[data-meeting-card]')).toHaveAttribute('data-meeting-card', 'm2')
  })

  it('cancela um 1:1 pelo menu do card, com o escopo escolhido', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({ meetings: [meeting()] })
    vi.mocked(cancelOneOnOne).mockResolvedValue(undefined)

    renderPage()
    await screen.findByText('Bruno')

    await userEvent.click(screen.getByRole('button', { name: /ações do 1:1 com bruno/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /cancelar 1:1/i }))

    // A série é semanal, então o escopo aparece — e o padrão é o mais conservador.
    await userEvent.click(screen.getByRole('radio', { name: /este e os seguintes/i }))
    await userEvent.click(screen.getByRole('button', { name: /^cancelar 1:1$/i }))

    await waitFor(() => expect(cancelOneOnOne).toHaveBeenCalledWith('m1', 'future'))
  })

  it('encontro avulso não pergunta escopo, e encontro realizado não tem menu', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', recurrence: 'NONE' }),
        meeting({ id: 'm2', status: 'DONE', counterpart: pessoa('u3', 'Carla') }),
      ],
    })

    renderPage()
    await screen.findByText('Bruno')

    expect(screen.queryByRole('button', { name: /ações do 1:1 com carla/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /ações do 1:1 com bruno/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /cancelar 1:1/i }))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
  /**
   * "Este e os seguintes" pode valer por um encontro só (quando as posteriores
   * já foram canceladas) ou por dez. Sem dizer quantos, o resultado parece um
   * escopo que não funcionou — foi exatamente o que aconteceu em HML.
   */
  it('diz quantos encontros cada escopo atinge', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', startsAt: '2026-08-13T13:00:00.000Z', endsAt: '2026-08-13T13:30:00.000Z' }),
        meeting({ id: 'm2', startsAt: '2026-08-20T13:00:00.000Z', endsAt: '2026-08-20T13:30:00.000Z' }),
        meeting({ id: 'm3', startsAt: '2026-08-27T13:00:00.000Z', endsAt: '2026-08-27T13:30:00.000Z' }),
      ],
    })

    renderPage()
    await screen.findAllByText('Bruno')

    // Menu do segundo encontro: sobram ele e o terceiro.
    await userEvent.click(screen.getAllByRole('button', { name: /ações do 1:1 com bruno/i })[1])
    await userEvent.click(screen.getByRole('menuitem', { name: /cancelar 1:1/i }))

    expect(await screen.findByText('Cancela 2 encontros, de 20/08 a 27/08.')).toBeInTheDocument()
    expect(screen.getByText('Cancela 3 encontros, de 13/08 a 27/08.')).toBeInTheDocument()
  })

  it('"toda a série" cancela a partir da primeira ocorrência ainda agendada', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(cancelOneOnOne).mockResolvedValue(undefined)
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', startsAt: '2026-08-13T13:00:00.000Z', endsAt: '2026-08-13T13:30:00.000Z' }),
        meeting({ id: 'm2', startsAt: '2026-08-20T13:00:00.000Z', endsAt: '2026-08-20T13:30:00.000Z' }),
      ],
    })

    renderPage()
    await screen.findAllByText('Bruno')

    await userEvent.click(screen.getAllByRole('button', { name: /ações do 1:1 com bruno/i })[1])
    await userEvent.click(screen.getByRole('menuitem', { name: /cancelar 1:1/i }))
    await userEvent.click(await screen.findByRole('radio', { name: /toda a série/i }))
    await userEvent.click(screen.getByRole('button', { name: /^cancelar 1:1$/i }))

    // Mira o m1 (o primeiro agendado) com `future` — a API não tem escopo de série.
    await waitFor(() => expect(cancelOneOnOne).toHaveBeenCalledWith('m1', 'future'))
  })

  it('no primeiro encontro da série, "toda a série" não aparece — seria o mesmo que "os seguintes"', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-06T12:00:00.000Z').getTime())
    vi.mocked(listOneOnOnes).mockResolvedValue({
      meetings: [
        meeting({ id: 'm1', startsAt: '2026-08-13T13:00:00.000Z', endsAt: '2026-08-13T13:30:00.000Z' }),
        meeting({ id: 'm2', startsAt: '2026-08-20T13:00:00.000Z', endsAt: '2026-08-20T13:30:00.000Z' }),
      ],
    })

    renderPage()
    await screen.findAllByText('Bruno')

    await userEvent.click(screen.getAllByRole('button', { name: /ações do 1:1 com bruno/i })[0])
    await userEvent.click(screen.getByRole('menuitem', { name: /cancelar 1:1/i }))

    expect(await screen.findByText('Cancela 2 encontros, de 13/08 a 20/08.')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /toda a série/i })).not.toBeInTheDocument()
  })
})
