import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from '../services/sector-service'
import { runVoteReminderTick } from './vote-reminders'

// Janela de 48h: 01/06 00:00Z → 03/06 00:00Z.
// midpoint = 02/06 00:00Z; closingStart (endsAt-1h) = 02/06 23:00Z.
const START = new Date('2026-06-01T00:00:00.000Z')
const END = new Date('2026-06-03T00:00:00.000Z')
const BEFORE_MID = new Date('2026-06-01T06:00:00.000Z')
const MIDWAY = new Date('2026-06-02T06:00:00.000Z')
const CLOSING = new Date('2026-06-02T23:30:00.000Z')

let counter = 0
async function makeUser(opts: { active?: boolean; role?: 'LEGEND' | 'ADMIN' | 'SUBADMIN'; sectorId?: string } = {}) {
  counter += 1
  return prisma.user.create({
    data: {
      name: `Dev ${counter}`,
      email: `dev-${counter}@empresa.com`,
      passwordHash: 'x',
      active: opts.active ?? true,
      role: opts.role ?? 'LEGEND',
      ...(opts.sectorId ? { sectorId: opts.sectorId } : {}),
    },
  })
}

async function makeOpenPeriod(sectorId?: string) {
  return prisma.votingPeriod.create({
    data: {
      monthRef: '2026-06',
      startsAt: START,
      endsAt: END,
      status: 'OPEN',
      ...(sectorId ? { sectorId } : {}),
    },
  })
}

async function castVote(voterId: string, periodId: string, votedId: string) {
  return prisma.vote.create({
    data: { voterId, votedId, periodId, justification: 'parabéns pelo trabalho excelente' },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('runVoteReminderTick', () => {
  it('no ponto médio, notifica quem não votou (MIDWAY)', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(MIDWAY)
    const notifs = await prisma.notification.findMany({ where: { userId: u.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0].type).toBe('VOTE_REMINDER_MIDWAY')
    expect(notifs[0].link).toBe('/votar')
  })

  it('na última hora, notifica quem não votou (CLOSING)', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(CLOSING)
    const notifs = await prisma.notification.findMany({ where: { userId: u.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0].type).toBe('VOTE_REMINDER_CLOSING')
  })

  it('não notifica quem já votou no período', async () => {
    const period = await makeOpenPeriod()
    const u = await makeUser()
    const colega = await makeUser()
    await castVote(u.id, period.id, colega.id)
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('é idempotente: segundo tick no mesmo marco não duplica', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(MIDWAY)
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
  })

  it('não notifica ADMIN', async () => {
    await makeOpenPeriod()
    const admin = await makeUser({ role: 'ADMIN' }) // 'ADMIN' is a valid UserRole
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: admin.id } })).toBe(0)
  })

  it('não notifica SUBADMIN', async () => {
    await makeOpenPeriod()
    const subadmin = await makeUser({ role: 'SUBADMIN' })
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: subadmin.id } })).toBe(0)
  })

  it('não notifica usuário inativo', async () => {
    await makeOpenPeriod()
    const u = await makeUser({ active: false })
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('no-op antes do ponto médio', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(BEFORE_MID)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('no-op quando não há período ativo', async () => {
    const u = await makeUser()
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('não duplica MIDWAY quando admin move a janela para frente no mesmo período', async () => {
    // Janela inicial: 01/06 → 03/06. MIDWAY em 02/06 06:00Z.
    const period = await makeOpenPeriod()
    const u = await makeUser()

    // Tick 1: dispara o lembrete de ponto médio na janela original.
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({
      where: { userId: u.id, type: 'VOTE_REMINDER_MIDWAY' },
    })).toBe(1)

    // Admin move a janela para frente: nova janela no futuro (2026-07-01 → 03).
    // O `createdAt` da notificação já criada (hora real do teste) ficará ANTES
    // do novo startsAt, então o dedup antigo (baseado em createdAt >= startsAt)
    // não encontraria a notificação e dispararia um duplicado.
    // Novo ponto médio: 2026-07-02 00:00Z; o tick é rodado nesse instante.
    const NEW_START = new Date('2026-07-01T00:00:00.000Z')
    const NEW_END = new Date('2026-07-03T00:00:00.000Z')
    const NEW_MIDWAY = new Date('2026-07-02T06:00:00.000Z')
    await prisma.votingPeriod.update({
      where: { id: period.id },
      data: { startsAt: NEW_START, endsAt: NEW_END },
    })

    // Tick 2: com a nova janela contendo um ponto médio válido — NÃO deve duplicar.
    await runVoteReminderTick(NEW_MIDWAY)
    expect(await prisma.notification.count({
      where: { userId: u.id, type: 'VOTE_REMINDER_MIDWAY' },
    })).toBe(1) // ainda exatamente 1 — dedup por periodId, não por startsAt
  })

  it('processa cada setor independentemente e nunca notifica usuário de outro setor', async () => {
    const actor = await makeUser({ role: 'ADMIN' })
    const sectorA = await createSector({ name: 'Setor Lembrete A', enabledFeatures: [], roles: ['LEGEND'] }, actor.id, DEFAULT_COMPANY_ID)
    const sectorB = await createSector({ name: 'Setor Lembrete B', enabledFeatures: [], roles: ['LEGEND'] }, actor.id, DEFAULT_COMPANY_ID)

    await makeOpenPeriod(sectorA.id)
    // Setor B não tem período aberto — não deve gerar nenhuma notificação pra ele.
    const userA = await makeUser({ sectorId: sectorA.id })
    const userB = await makeUser({ sectorId: sectorB.id })

    await runVoteReminderTick(MIDWAY)

    expect(await prisma.notification.count({ where: { userId: userA.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: userB.id } })).toBe(0)
  })
})
