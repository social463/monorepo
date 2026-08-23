import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  acceptProposal,
  cancelMeeting,
  createSeries,
  declineProposal,
  rescheduleMeeting,
  respondToInvite,
} from './one-on-one-service'

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', companyId: DEFAULT_COMPANY_ID },
  })
}
const viewerOf = (user: { id: string }) => ({ userId: user.id, companyId: DEFAULT_COMPANY_ID })

/** Ana marca; Bruno é o convidado. Três terças quinzenais às 10:00 de São Paulo. */
async function serieDeTres() {
  const ana = await makeUser('Ana')
  const bruno = await makeUser('Bruno')
  const { meetings, seriesId } = await createSeries(viewerOf(ana), {
    counterpartId: bruno.id,
    date: '2026-08-11',
    startTime: '10:00',
    durationMinutes: 30,
    recurrence: 'BIWEEKLY',
    recurrenceCount: 3,
  })
  return { ana, bruno, meetings, seriesId }
}

const serie = (id: string) => prisma.oneOnOneSeries.findUniqueOrThrow({ where: { id } })
const encontro = (id: string) => prisma.oneOnOneMeeting.findUniqueOrThrow({ where: { id } })

describe('1:1 — aceite de convite', () => {
  it('série nasce pendente, e só do lado do convidado', async () => {
    const { ana, bruno, meetings, seriesId } = await serieDeTres()

    expect((await serie(seriesId)).inviteeResponse).toBe('PENDING')
    // Quem marcou não responde ao próprio convite.
    expect(meetings[0].viewerIsInvitee).toBe(false)
    expect(meetings[0].inviteeResponse).toBe('PENDING')
    await expect(
      respondToInvite(viewerOf(ana), meetings[0].id, { response: 'ACCEPTED' }, 'this'),
    ).rejects.toMatchObject({ status: 403 })

    const doBruno = await respondToInvite(viewerOf(bruno), meetings[0].id, { response: 'ACCEPTED' }, 'this')
    expect(doBruno.viewerIsInvitee).toBe(true)
  })

  /** Uma resposta com escopo `future` responde pela série — é o que evita 52 pendências. */
  it('aceitar com escopo future grava na série, não em cada ocorrência', async () => {
    const { bruno, meetings, seriesId } = await serieDeTres()

    await respondToInvite(viewerOf(bruno), meetings[0].id, { response: 'ACCEPTED' }, 'future')

    expect((await serie(seriesId)).inviteeResponse).toBe('ACCEPTED')
    // Nenhuma ocorrência precisou de override: todas seguem a série.
    for (const m of meetings) expect((await encontro(m.id)).inviteeResponse).toBeNull()
  })

  it('recusar só esta ocorrência não mexe na série nem nas outras', async () => {
    const { bruno, meetings, seriesId } = await serieDeTres()
    await respondToInvite(viewerOf(bruno), meetings[0].id, { response: 'ACCEPTED' }, 'future')

    await respondToInvite(
      viewerOf(bruno),
      meetings[1].id,
      { response: 'DECLINED', declineNote: 'Viagem' },
      'this',
    )

    expect((await serie(seriesId)).inviteeResponse).toBe('ACCEPTED')
    expect((await encontro(meetings[1].id)).inviteeResponse).toBe('DECLINED')
    expect((await encontro(meetings[1].id)).declineNote).toBe('Viagem')
    expect((await encontro(meetings[2].id)).inviteeResponse).toBeNull()
  })

  /**
   * A ação mais recente vence. Sem limpar os overrides, "recusei aquela semana"
   * sobreviveria a um "aceito a série toda" feito depois — a pessoa veria de pé
   * uma recusa que ela acabou de desfazer.
   */
  it('responder com future apaga as exceções que estavam à frente', async () => {
    const { bruno, meetings, seriesId } = await serieDeTres()
    await respondToInvite(viewerOf(bruno), meetings[2].id, { response: 'DECLINED' }, 'this')

    await respondToInvite(viewerOf(bruno), meetings[0].id, { response: 'ACCEPTED' }, 'future')

    expect((await serie(seriesId)).inviteeResponse).toBe('ACCEPTED')
    expect((await encontro(meetings[2].id)).inviteeResponse).toBeNull()
  })

  it('remarcar devolve o convite para pendente', async () => {
    const { ana, bruno, meetings, seriesId } = await serieDeTres()
    await respondToInvite(viewerOf(bruno), meetings[0].id, { response: 'ACCEPTED' }, 'future')

    await rescheduleMeeting(
      viewerOf(ana),
      meetings[0].id,
      { date: '2026-08-12', startTime: '15:00', durationMinutes: 30 },
      'future',
    )

    expect((await serie(seriesId)).inviteeResponse).toBe('PENDING')
  })

  it('sugestão de horário só vale ao recusar, e não pode ser o horário atual', async () => {
    const { bruno, meetings } = await serieDeTres()

    await expect(
      respondToInvite(
        viewerOf(bruno),
        meetings[0].id,
        { response: 'ACCEPTED', proposedStartsAt: '2026-08-11T17:00:00.000Z' },
        'this',
      ),
    ).rejects.toMatchObject({ status: 400 })

    const atual = (await encontro(meetings[0].id)).startsAt.toISOString()
    await expect(
      respondToInvite(viewerOf(bruno), meetings[0].id, { response: 'DECLINED', proposedStartsAt: atual }, 'this'),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('terceiro não responde ao convite de um par que não é o dele', async () => {
    const { meetings } = await serieDeTres()
    const carla = await makeUser('Carla')

    await expect(
      respondToInvite(viewerOf(carla), meetings[0].id, { response: 'ACCEPTED' }, 'this'),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('encontro cancelado não aceita resposta', async () => {
    const { ana, bruno, meetings } = await serieDeTres()
    await cancelMeeting(viewerOf(ana), meetings[0].id, 'this')

    await expect(
      respondToInvite(viewerOf(bruno), meetings[0].id, { response: 'ACCEPTED' }, 'this'),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('1:1 — contraproposta de horário', () => {
  /** Bruno recusa a terça das 10:00 e sugere quinta às 14:00 (17:00Z). */
  async function comSugestao() {
    const ctx = await serieDeTres()
    await respondToInvite(
      viewerOf(ctx.bruno),
      ctx.meetings[0].id,
      { response: 'DECLINED', proposedStartsAt: '2026-08-13T17:00:00.000Z', declineNote: 'Terça não dá' },
      'this',
    )
    return ctx
  }

  it('só quem marcou decide sobre a sugestão', async () => {
    const { bruno, meetings } = await comSugestao()

    await expect(acceptProposal(viewerOf(bruno), meetings[0].id, 'this')).rejects.toMatchObject({ status: 403 })
    await expect(declineProposal(viewerOf(bruno), meetings[0].id)).rejects.toMatchObject({ status: 403 })
  })

  it('aceitar a sugestão remarca e já deixa aceito — quem propôs não aceita duas vezes', async () => {
    const { ana, meetings } = await comSugestao()

    const resultado = await acceptProposal(viewerOf(ana), meetings[0].id, 'this')

    expect(resultado.startsAt).toBe('2026-08-13T17:00:00.000Z')
    expect(resultado.inviteeResponse).toBe('ACCEPTED')
    const depois = await encontro(meetings[0].id)
    expect(depois.proposedStartsAt).toBeNull()
    expect(depois.declineNote).toBeNull()
  })

  /**
   * O caso que mais geraria ida e volta — "esse dia da semana não funciona" —
   * resolvido numa rodada: o mesmo deslocamento vale para as seguintes, e a
   * série quinzenal de terça vira quinzenal de quinta.
   */
  it('aceitar movendo a série desloca as seguintes pelo mesmo intervalo', async () => {
    const { ana, meetings } = await comSugestao()

    await acceptProposal(viewerOf(ana), meetings[0].id, 'future')

    const todos = await prisma.oneOnOneMeeting.findMany({ orderBy: { startsAt: 'asc' } })
    // +2 dias e +4 horas em todas: terça 10:00 → quinta 14:00.
    expect(todos.map((m) => m.startsAt.toISOString())).toEqual([
      '2026-08-13T17:00:00.000Z',
      '2026-08-27T17:00:00.000Z',
      '2026-09-10T17:00:00.000Z',
    ])
    expect((await serie(todos[0].seriesId)).inviteeResponse).toBe('ACCEPTED')
  })

  it('descartar a sugestão devolve a pendência sem mexer no horário', async () => {
    const { ana, meetings } = await comSugestao()
    const antes = (await encontro(meetings[0].id)).startsAt.toISOString()

    const resultado = await declineProposal(viewerOf(ana), meetings[0].id)

    expect(resultado.startsAt).toBe(antes)
    expect(resultado.inviteeResponse).toBe('PENDING')
    expect((await encontro(meetings[0].id)).proposedStartsAt).toBeNull()
  })

  it('sem sugestão gravada não há o que aceitar nem descartar', async () => {
    const { ana, meetings } = await serieDeTres()

    await expect(acceptProposal(viewerOf(ana), meetings[0].id, 'this')).rejects.toMatchObject({ status: 400 })
    await expect(declineProposal(viewerOf(ana), meetings[0].id)).rejects.toMatchObject({ status: 400 })
  })

  it('avisa quem marcou, com a sugestão no título', async () => {
    const { ana } = await comSugestao()

    const notificacao = await prisma.notification.findFirstOrThrow({ where: { type: 'ONE_ON_ONE_RESPONDED' } })
    expect(notificacao.userId).toBe(ana.id)
    // 17:00Z é 14:00 em São Paulo, no dia 13/08.
    expect(notificacao.title).toBe('Bruno não pode às 10:00 e sugeriu 14:00 de 13/08')
  })

  it('avisa o convidado quando a sugestão dele é decidida', async () => {
    const { ana, bruno, meetings } = await comSugestao()

    await acceptProposal(viewerOf(ana), meetings[0].id, 'this')

    const notificacao = await prisma.notification.findFirstOrThrow({
      where: { type: 'ONE_ON_ONE_PROPOSAL_ACCEPTED' },
    })
    expect(notificacao.userId).toBe(bruno.id)
    expect(notificacao.title).toContain('Ana')
  })
})
