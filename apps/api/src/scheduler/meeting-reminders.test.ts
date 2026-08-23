import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { runMeetingReminderTick } from './meeting-reminders'

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
}

const AGORA = new Date('2099-01-10T13:55:00.000Z')

/** Reunião às 14:00 — 5 min à frente de AGORA, dentro da janela de 10 min. */
async function makeMeeting(organizerId: string, participantIds: string[], startsAt = new Date('2099-01-10T14:00:00.000Z')) {
  return prisma.officeMeeting.create({
    data: {
      companyId: DEFAULT_COMPANY_ID,
      roomExternalKey: 'aurora',
      roomName: 'Aurora',
      title: 'Planning',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      organizerId,
      participants: { create: participantIds.map((userId) => ({ userId })) },
    },
  })
}

describe('runMeetingReminderTick', () => {
  it('notifica organizador e participantes na janela de 10 minutos', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await makeMeeting(ana.id, [bruno.id])

    await runMeetingReminderTick(AGORA)

    const notifications = await prisma.notification.findMany({ where: { type: 'MEETING_REMINDER' } })
    expect(notifications.map((n) => n.userId).sort()).toEqual([ana.id, bruno.id].sort())
    expect(notifications[0]!.link).toBe('/escritorio?sala=aurora')
    // A hora entra no título, em São Paulo (14:00Z = 11:00): a notificação fica
    // no sino até ser lida, e "começa em instantes" envelhece mal.
    expect(notifications[0]!.title).toBe('"Planning" começa às 11:00 na sala Aurora')
  })

  it('não repete o lembrete em ticks seguintes', async () => {
    const ana = await makeUser('Ana')
    await makeMeeting(ana.id, [])

    await runMeetingReminderTick(AGORA)
    await runMeetingReminderTick(new Date('2099-01-10T13:56:00.000Z'))

    expect(await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } })).toBe(1)
  })

  it('ignora reunião fora da janela', async () => {
    const ana = await makeUser('Ana')
    await makeMeeting(ana.id, [], new Date('2099-01-10T16:00:00.000Z'))

    await runMeetingReminderTick(AGORA)

    expect(await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } })).toBe(0)
  })

  it('ignora reunião cancelada', async () => {
    const ana = await makeUser('Ana')
    const meeting = await makeMeeting(ana.id, [])
    await prisma.officeMeeting.update({ where: { id: meeting.id }, data: { canceledAt: new Date() } })

    await runMeetingReminderTick(AGORA)

    expect(await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } })).toBe(0)
  })

  it('dois ticks concorrentes não duplicam o lembrete', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await makeMeeting(ana.id, [bruno.id])

    await Promise.all([runMeetingReminderTick(AGORA), runMeetingReminderTick(AGORA)])

    expect(await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } })).toBe(2)
  })
})
