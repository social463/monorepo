import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  cancelMeeting,
  createActionItem,
  createSeries,
  listMeetings,
  markMeetingDone,
  rescheduleMeeting,
} from './one-on-one-service'

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', companyId: DEFAULT_COMPANY_ID },
  })
}
const viewerOf = (user: { id: string }) => ({ userId: user.id, companyId: DEFAULT_COMPANY_ID })

async function serieDeTres() {
  const ana = await makeUser('Ana')
  const bruno = await makeUser('Bruno')
  const { meetings, seriesId } = await createSeries(viewerOf(ana), {
    counterpartId: bruno.id,
    date: '2026-08-10',
    startTime: '10:00',
    durationMinutes: 30,
    recurrence: 'WEEKLY',
    recurrenceCount: 3,
  })
  return { ana, bruno, meetings, seriesId }
}

describe('one-on-one — remarcar e cancelar', () => {
  it('scope=this move só a ocorrência pedida', async () => {
    const { ana, meetings } = await serieDeTres()

    await rescheduleMeeting(viewerOf(ana), meetings[1].id, { date: '2026-08-19', startTime: '15:00', durationMinutes: 45 }, 'this')

    const lista = await listMeetings(viewerOf(ana), '2026-08-01', '2026-09-15')
    const datas = lista.map((m) => m.startsAt.slice(0, 10))
    expect(datas).toEqual(['2026-08-10', '2026-08-19', '2026-08-24'])
  })

  it('scope=future move a ocorrência e as seguintes, mantendo o intervalo', async () => {
    const { ana, meetings } = await serieDeTres()

    await rescheduleMeeting(viewerOf(ana), meetings[1].id, { date: '2026-08-18', startTime: '10:00', durationMinutes: 30 }, 'future')

    const lista = await listMeetings(viewerOf(ana), '2026-08-01', '2026-09-15')
    expect(lista.map((m) => m.startsAt.slice(0, 10))).toEqual(['2026-08-10', '2026-08-18', '2026-08-25'])
  })

  it('cancelar com scope=future tira as seguintes da listagem, sem tocar nas passadas', async () => {
    const { ana, meetings } = await serieDeTres()

    await cancelMeeting(viewerOf(ana), meetings[1].id, 'future')

    const lista = await listMeetings(viewerOf(ana), '2026-08-01', '2026-09-15')
    expect(lista.map((m) => m.startsAt.slice(0, 10))).toEqual(['2026-08-10'])
    expect(await prisma.oneOnOneMeeting.count({ where: { status: 'CANCELED' } })).toBe(2)
  })

  it('marcar como realizado não some da listagem', async () => {
    const { ana, meetings } = await serieDeTres()

    const feito = await markMeetingDone(viewerOf(ana), meetings[0].id)
    expect(feito.status).toBe('DONE')
    expect(await listMeetings(viewerOf(ana), '2026-08-01', '2026-09-15')).toHaveLength(3)
  })

  it('terceiro não remarca nem cancela', async () => {
    const { meetings } = await serieDeTres()
    const carla = await makeUser('Carla')

    await expect(cancelMeeting(viewerOf(carla), meetings[0].id, 'this')).rejects.toMatchObject({ status: 404 })
  })

  it('remarcar um 1:1 cancelado falha com 409', async () => {
    const { ana, meetings } = await serieDeTres()
    await cancelMeeting(viewerOf(ana), meetings[0].id, 'this')

    await expect(
      rescheduleMeeting(viewerOf(ana), meetings[0].id, { date: '2026-08-11', startTime: '10:00', durationMinutes: 30 }, 'this'),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('cancelar duas vezes falha na segunda com 409', async () => {
    const { ana, meetings } = await serieDeTres()
    await cancelMeeting(viewerOf(ana), meetings[0].id, 'this')

    await expect(cancelMeeting(viewerOf(ana), meetings[0].id, 'this')).rejects.toMatchObject({ status: 409 })
  })

  it('marcar como realizado um 1:1 cancelado falha com 409', async () => {
    const { ana, meetings } = await serieDeTres()
    await cancelMeeting(viewerOf(ana), meetings[0].id, 'this')

    await expect(markMeetingDone(viewerOf(ana), meetings[0].id)).rejects.toMatchObject({ status: 409 })
  })

  it('cancelar um 1:1 já realizado falha com 409', async () => {
    const { ana, meetings } = await serieDeTres()
    await markMeetingDone(viewerOf(ana), meetings[0].id)

    await expect(cancelMeeting(viewerOf(ana), meetings[0].id, 'this')).rejects.toMatchObject({ status: 409 })
  })

  it('remarcar com scope=future a partir de um encontro já realizado falha com 409 e não mexe nas seguintes', async () => {
    const { ana, meetings } = await serieDeTres()
    await markMeetingDone(viewerOf(ana), meetings[1].id)

    await expect(
      rescheduleMeeting(viewerOf(ana), meetings[1].id, { date: '2026-08-18', startTime: '10:00', durationMinutes: 30 }, 'future'),
    ).rejects.toMatchObject({ status: 409 })

    // a terceira ocorrência (ainda SCHEDULED) precisa continuar intocada
    const lista = await listMeetings(viewerOf(ana), '2026-08-01', '2026-09-15')
    expect(lista.map((m) => m.startsAt.slice(0, 10))).toEqual(['2026-08-10', '2026-08-17', '2026-08-24'])
  })

  it('remarcar devolve openActionCount de verdade, não zerado', async () => {
    const { ana, bruno, meetings } = await serieDeTres()
    await createActionItem(viewerOf(ana), meetings[0].id, { description: 'Combinado', ownerId: bruno.id, dueDate: null })

    const [atualizado] = await rescheduleMeeting(
      viewerOf(ana),
      meetings[1].id,
      { date: '2026-08-19', startTime: '15:00', durationMinutes: 45 },
      'this',
    )

    expect(atualizado.openActionCount).toBe(1)
  })

  it('marcar como realizado devolve openActionCount de verdade, não zerado', async () => {
    const { ana, bruno, meetings } = await serieDeTres()
    await createActionItem(viewerOf(ana), meetings[0].id, { description: 'Combinado', ownerId: bruno.id, dueDate: null })

    const feito = await markMeetingDone(viewerOf(ana), meetings[0].id)

    expect(feito.openActionCount).toBe(1)
  })
})

/**
 * O fuso do processo vira UTC de propósito: é o do contêiner de produção, e era
 * ele que fazia "10:30" ser gravado como 10:30Z e aparecer 07:30 na tela de quem
 * marcou. Em dev (TZ São Paulo) o bug não dava as caras.
 */
describe('one-on-one — a hora marcada é a hora de São Paulo', () => {
  const original = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'UTC'
  })
  afterAll(() => {
    process.env.TZ = original
  })

  it('grava 10:30 de São Paulo como 13:30Z, e não como 10:30Z', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')

    const { meetings } = await createSeries(viewerOf(ana), {
      counterpartId: bruno.id,
      date: '2026-08-12',
      startTime: '10:30',
      durationMinutes: 30,
      recurrence: 'NONE',
      recurrenceCount: null,
    })

    expect(meetings[0].startsAt).toBe('2026-08-12T13:30:00.000Z')
    expect(meetings[0].endsAt).toBe('2026-08-12T14:00:00.000Z')
  })

  it('remarcar também respeita o fuso de São Paulo', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const { meetings } = await createSeries(viewerOf(ana), {
      counterpartId: bruno.id,
      date: '2026-08-12',
      startTime: '10:30',
      durationMinutes: 30,
      recurrence: 'NONE',
      recurrenceCount: null,
    })

    const [remarcado] = await rescheduleMeeting(
      viewerOf(ana),
      meetings[0].id,
      { date: '2026-08-13', startTime: '16:00', durationMinutes: 60 },
      'this',
    )

    expect(remarcado.startsAt).toBe('2026-08-13T19:00:00.000Z')
  })

  it('encontro da noite continua no dia civil de São Paulo na listagem', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    // 22:00 de 12/08 em São Paulo é 01:00Z de 13/08: em UTC o encontro "muda de dia".
    await createSeries(viewerOf(ana), {
      counterpartId: bruno.id,
      date: '2026-08-12',
      startTime: '22:00',
      durationMinutes: 30,
      recurrence: 'NONE',
      recurrenceCount: null,
    })

    const lista = await listMeetings(viewerOf(ana), '2026-08-12', '2026-08-12')
    expect(lista).toHaveLength(1)
    expect(lista[0].startsAt).toBe('2026-08-13T01:00:00.000Z')
  })

  it('recorrência mensal ancora no dia do mês de São Paulo, não no de UTC', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    // Às 22h, um servidor em UTC leria "dia 13" e ancoraria a série no dia errado.
    const { meetings } = await createSeries(viewerOf(ana), {
      counterpartId: bruno.id,
      date: '2026-08-12',
      startTime: '22:00',
      durationMinutes: 30,
      recurrence: 'MONTHLY',
      recurrenceCount: 3,
    })

    expect(meetings.map((m) => m.startsAt)).toEqual([
      '2026-08-13T01:00:00.000Z',
      '2026-09-13T01:00:00.000Z',
      '2026-10-13T01:00:00.000Z',
    ])
  })
})
