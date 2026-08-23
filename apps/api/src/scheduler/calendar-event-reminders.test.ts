import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { runCalendarEventReminderTick } from './calendar-event-reminders'

/** 9h em São Paulo (UTC−3) do dia civil pedido — a hora do disparo. */
function noveDaManha(ymd: string): Date {
  return new Date(`${ymd}T09:00:00-03:00`)
}

async function seedCenario(opts: {
  date: string
  reminderDaysBefore: number[]
  recurrence?: 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  sectorFeatures?: string[]
  restrito?: boolean
}) {
  const sector = await prisma.sector.create({
    data: {
      name: 'Setor Lembrete',
      slug: `setor-lembrete-${Math.round(opts.date.replace(/-/g, '') as unknown as number)}`,
      enabledFeatures: opts.sectorFeatures ?? ['calendario'],
    },
  })
  const user = await prisma.user.create({
    data: {
      name: 'Colega',
      email: `colega-${sector.id}@x.com`,
      passwordHash: 'x',
      sectorId: sector.id,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  const type = await prisma.calendarEventType.create({
    data: { name: 'Provas B2B', slug: `provas-${sector.id}`, icon: 'quiz', companyId: DEFAULT_COMPANY_ID },
  })
  const event = await prisma.calendarEvent.create({
    data: {
      title: 'Prova Inspirali',
      date: new Date(`${opts.date}T00:00:00.000Z`),
      typeId: type.id,
      createdById: user.id,
      companyId: DEFAULT_COMPANY_ID,
      recurrence: opts.recurrence ?? 'NONE',
      reminderDaysBefore: opts.reminderDaysBefore,
      sectors: opts.restrito ? { create: [{ sectorId: sector.id }] } : undefined,
    },
  })
  return { sector, user, type, event }
}

describe('lembrete de evento de calendário', () => {
  it('notifica na antecedência configurada', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [3] })

    await runCalendarEventReminderTick(noveDaManha('2026-09-07'))

    const notificacoes = await prisma.notification.findMany({ where: { userId: user.id } })
    expect(notificacoes).toHaveLength(1)
    expect(notificacoes[0].type).toBe('CALENDAR_EVENT_REMINDER')
    expect(notificacoes[0].title).toContain('Prova Inspirali')
    expect(notificacoes[0].link).toBe('/calendario?dia=2026-09-10')
  })

  it('não notifica em dia que não bate com a antecedência', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [3] })

    await runCalendarEventReminderTick(noveDaManha('2026-09-05'))

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0)
  })

  it('fora da hora do disparo não faz nada', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [3] })

    await runCalendarEventReminderTick(new Date('2026-09-07T18:00:00-03:00'))

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0)
  })

  it('escreve a antecedência do ponto de vista de quem lê hoje', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [7, 1, 0] })

    await runCalendarEventReminderTick(noveDaManha('2026-09-03'))
    await runCalendarEventReminderTick(noveDaManha('2026-09-09'))
    await runCalendarEventReminderTick(noveDaManha('2026-09-10'))

    const titulos = (
      await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })
    ).map((n) => n.title)
    expect(titulos).toEqual([
      'Provas B2B: "Prova Inspirali" é daqui a 7 dias',
      'Provas B2B: "Prova Inspirali" é amanhã',
      'Provas B2B: "Prova Inspirali" é hoje',
    ])
  })

  it('não repete o mesmo lembrete quando o tick roda de novo', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [3] })

    await runCalendarEventReminderTick(noveDaManha('2026-09-07'))
    await runCalendarEventReminderTick(noveDaManha('2026-09-07'))

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1)
    expect(await prisma.calendarEventReminderSent.count()).toBe(1)
  })

  it('dispara uma vez por antecedência configurada', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [7, 1] })

    await runCalendarEventReminderTick(noveDaManha('2026-09-03'))
    await runCalendarEventReminderTick(noveDaManha('2026-09-09'))

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(2)
  })

  it('evento recorrente notifica cada ocorrência', async () => {
    const { user } = await seedCenario({ date: '2026-09-01', reminderDaysBefore: [1], recurrence: 'WEEKLY' })

    // Véspera da primeira ocorrência e da segunda: são lembretes distintos.
    await runCalendarEventReminderTick(noveDaManha('2026-08-31'))
    await runCalendarEventReminderTick(noveDaManha('2026-09-07'))

    const notificacoes = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })
    expect(notificacoes).toHaveLength(2)
    const ocorrencias = await prisma.calendarEventReminderSent.findMany({ orderBy: { occurrenceDate: 'asc' } })
    expect(ocorrencias.map((o) => o.occurrenceDate.toISOString().slice(0, 10))).toEqual(['2026-09-01', '2026-09-08'])
  })

  it('não notifica setor sem a feature calendario', async () => {
    const { user } = await seedCenario({
      date: '2026-09-10',
      reminderDaysBefore: [3],
      sectorFeatures: ['votar'],
    })

    await runCalendarEventReminderTick(noveDaManha('2026-09-07'))

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0)
  })

  it('evento restrito a setores não alcança quem está fora do público', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [3], restrito: true })
    const outro = await prisma.sector.create({
      data: { name: 'Outro', slug: 'outro-lembrete', enabledFeatures: ['calendario'] },
    })
    const deFora = await prisma.user.create({
      data: {
        name: 'De fora',
        email: 'defora-lembrete@x.com',
        passwordHash: 'x',
        sectorId: outro.id,
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    await runCalendarEventReminderTick(noveDaManha('2026-09-07'))

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: deFora.id } })).toBe(0)
  })

  it('evento sem lembrete configurado nunca dispara', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [] })

    await runCalendarEventReminderTick(noveDaManha('2026-09-07'))
    await runCalendarEventReminderTick(noveDaManha('2026-09-10'))

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0)
  })

  it('usuário inativo não recebe', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [0] })
    await prisma.user.update({ where: { id: user.id }, data: { active: false } })

    await runCalendarEventReminderTick(noveDaManha('2026-09-10'))

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0)
  })

  it('evento de outra empresa não vaza para o setor daqui', async () => {
    const { user } = await seedCenario({ date: '2026-09-10', reminderDaysBefore: [3] })
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: 'outra-lembrete' } })
    const dono = await prisma.user.create({
      data: {
        name: 'Dono',
        email: 'dono-lembrete@x.com',
        passwordHash: 'x',
        sectorId: DEFAULT_SECTOR_ID,
        companyId: outra.id,
      },
    })
    const type = await prisma.calendarEventType.create({
      data: { name: 'Prazos', slug: 'prazos-outra', companyId: outra.id },
    })
    await prisma.calendarEvent.create({
      data: {
        title: 'Fechamento da outra',
        date: new Date('2026-09-10T00:00:00.000Z'),
        typeId: type.id,
        createdById: dono.id,
        companyId: outra.id,
        reminderDaysBefore: [3],
      },
    })

    await runCalendarEventReminderTick(noveDaManha('2026-09-07'))

    const recebidas = await prisma.notification.findMany({ where: { userId: user.id } })
    expect(recebidas).toHaveLength(1)
    expect(recebidas[0].title).toContain('Prova Inspirali')
  })
})
