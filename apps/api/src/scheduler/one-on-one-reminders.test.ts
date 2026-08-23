import { describe, expect, it, vi, afterEach } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { rescheduleMeeting } from '../services/one-on-one-service'
import { runOneOnOneReminderTick } from './one-on-one-reminders'

async function makeUser(name: string, teamsWebhookUrl: string | null = null) {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase()}@empresa.com`,
      passwordHash: 'x',
      companyId: DEFAULT_COMPANY_ID,
      teamsWebhookUrl,
    },
  })
}

const AGORA = new Date('2099-01-10T13:55:00.000Z')

/** Encontro às 14:00 — 5 min à frente de AGORA, dentro da janela de 10 min. */
async function makeMeeting(
  userAId: string,
  userBId: string,
  startsAt = new Date('2099-01-10T14:00:00.000Z'),
  status: 'SCHEDULED' | 'DONE' | 'CANCELED' = 'SCHEDULED',
) {
  const series = await prisma.oneOnOneSeries.create({
    data: { userAId, userBId, createdById: userAId, companyId: DEFAULT_COMPANY_ID },
  })
  return prisma.oneOnOneMeeting.create({
    data: {
      seriesId: series.id,
      companyId: DEFAULT_COMPANY_ID,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
      status,
    },
  })
}

const lembretes = () => prisma.notification.findMany({ where: { type: 'ONE_ON_ONE_REMINDER' } })

afterEach(() => vi.restoreAllMocks())

describe('runOneOnOneReminderTick', () => {
  it('avisa os dois lados, cada um com o nome do outro', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const meeting = await makeMeeting(ana.id, bruno.id)

    await runOneOnOneReminderTick(AGORA)

    const notificacoes = await lembretes()
    expect(notificacoes.map((n) => n.userId).sort()).toEqual([ana.id, bruno.id].sort())
    // A hora entra no título (e em São Paulo, não em UTC): a notificação fica no
    // sino até ser lida, e "começa em instantes" lido no dia seguinte é mentira.
    // 14:00Z é 11:00 em São Paulo.
    expect(notificacoes.find((n) => n.userId === ana.id)!.title).toBe('Seu 1:1 com Bruno começa às 11:00')
    expect(notificacoes.find((n) => n.userId === bruno.id)!.title).toBe('Seu 1:1 com Ana começa às 11:00')
    expect(notificacoes[0]!.link).toBe(`/1-1/${meeting.id}`)
  })

  /**
   * O pedido é explícito: lembrete de 1:1 é só do Legends. Quem tem webhook do
   * Teams recebe DM do convite e da ação combinada, mas não deste — senão o
   * aviso chega junto com o do calendário e com o do próprio Teams.
   */
  it('não espelha no Teams, mesmo com webhook configurado', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const ana = await makeUser('Ana', 'https://flow.example/ana')
    const bruno = await makeUser('Bruno', 'https://flow.example/bruno')
    await makeMeeting(ana.id, bruno.id)

    await runOneOnOneReminderTick(AGORA)

    expect(await lembretes()).toHaveLength(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('não repete o lembrete em ticks seguintes', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await makeMeeting(ana.id, bruno.id)

    await runOneOnOneReminderTick(AGORA)
    await runOneOnOneReminderTick(new Date('2099-01-10T13:56:00.000Z'))

    expect(await lembretes()).toHaveLength(2)
  })

  it('ignora encontro fora da janela de 10 minutos', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await makeMeeting(ana.id, bruno.id, new Date('2099-01-10T16:00:00.000Z'))

    await runOneOnOneReminderTick(AGORA)

    expect(await lembretes()).toHaveLength(0)
  })

  it('ignora encontro que já começou', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await makeMeeting(ana.id, bruno.id, new Date('2099-01-10T13:50:00.000Z'))

    await runOneOnOneReminderTick(AGORA)

    expect(await lembretes()).toHaveLength(0)
  })

  it('ignora encontro cancelado ou já realizado', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await makeMeeting(ana.id, bruno.id, new Date('2099-01-10T14:00:00.000Z'), 'CANCELED')
    const carla = await makeUser('Carla')
    await makeMeeting(carla.id, bruno.id, new Date('2099-01-10T14:00:00.000Z'), 'DONE')

    await runOneOnOneReminderTick(AGORA)

    expect(await lembretes()).toHaveLength(0)
  })

  /** Encontro recusado não vira lembrete: avisar sobre ele é ruído. */
  it('ignora encontro que o convidado recusou', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const meeting = await makeMeeting(ana.id, bruno.id)
    await prisma.oneOnOneMeeting.update({ where: { id: meeting.id }, data: { inviteeResponse: 'DECLINED' } })

    await runOneOnOneReminderTick(AGORA)

    expect(await lembretes()).toHaveLength(0)
  })

  it('a recusa da SÉRIE também cala o lembrete das ocorrências', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const meeting = await makeMeeting(ana.id, bruno.id)
    await prisma.oneOnOneSeries.update({
      where: { id: meeting.seriesId },
      data: { inviteeResponse: 'DECLINED' },
    })

    await runOneOnOneReminderTick(AGORA)

    expect(await lembretes()).toHaveLength(0)
  })

  /** Horário novo, lembrete novo — senão um encontro empurrado nunca mais avisa. */
  it('remarcar zera a reivindicação e o lembrete volta a valer', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const meeting = await makeMeeting(ana.id, bruno.id)

    await runOneOnOneReminderTick(AGORA)
    expect(await lembretes()).toHaveLength(2)

    await rescheduleMeeting(
      { userId: ana.id, companyId: DEFAULT_COMPANY_ID },
      meeting.id,
      { date: '2099-01-11', startTime: '11:00', durationMinutes: 30 },
      'this',
    )
    expect((await prisma.oneOnOneMeeting.findUniqueOrThrow({ where: { id: meeting.id } })).remindedAt).toBeNull()

    // 10:55 em São Paulo é 13:55Z — 5 minutos antes do novo horário.
    await runOneOnOneReminderTick(new Date('2099-01-11T13:55:00.000Z'))

    expect(await lembretes()).toHaveLength(4)
  })
})
