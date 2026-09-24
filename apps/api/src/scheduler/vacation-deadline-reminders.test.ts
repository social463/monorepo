import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID, EMR_VACATION_POLICY } from '@legends/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { runVacationDeadlineReminderTick } from './vacation-deadline-reminders'

/**
 * O relógio do tick precisa ser o relógio de verdade.
 *
 * A dedupe pergunta "já avisei este gestor HOJE?", e quem carimba o `createdAt`
 * da notificação é o banco, com a hora real. Fixar o tick num 2027 imaginário
 * enquanto o banco grava hoje faria a dedupe nunca encontrar o próprio aviso —
 * um falso verde que só apareceria em produção, cobrando o gestor duas vezes.
 */
const HOJE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
/** 9h de São Paulo é meio-dia em UTC (UTC-3). */
const NOVE_DA_MANHA = new Date(`${HOJE}T12:00:00Z`)
const OUTRA_HORA = new Date(`${HOJE}T20:00:00Z`)

let seq = 0
async function pessoa(managerId?: string) {
  seq += 1
  return prisma.user.create({
    data: {
      name: `Pessoa ${seq}`,
      email: `vdr-${seq}-${Math.random()}@x.com`,
      passwordHash: 'x',
      sectorId: DEFAULT_SECTOR_ID,
      joinedAt: new Date('2025-04-08T00:00:00Z'),
      ...(managerId ? { managerId } : {}),
    },
  })
}

/** Campanha com o prazo a N dias de hoje. */
async function campanha(diasAteOPrazo: number) {
  const prazo = new Date(`${HOJE}T00:00:00Z`)
  prazo.setUTCDate(prazo.getUTCDate() + diasAteOPrazo)
  return prisma.vacationCampaign.create({
    data: {
      year: new Date(`${HOJE}T00:00:00Z`).getUTCFullYear() + 1,
      opensAt: new Date('2026-08-01T00:00:00Z'),
      deadline: prazo,
      companyId: DEFAULT_COMPANY_ID,
      policy: EMR_VACATION_POLICY as unknown as Prisma.InputJsonValue,
    },
  })
}

async function direito(userId: string) {
  return prisma.vacationEntitlement.create({
    data: {
      userId,
      companyId: DEFAULT_COMPANY_ID,
      acquisitionStart: new Date('2026-04-08T00:00:00Z'),
      acquisitionEnd: new Date('2027-04-07T00:00:00Z'),
      dueDate: new Date('2028-03-07T00:00:00Z'),
    },
  })
}

let lider: Awaited<ReturnType<typeof pessoa>>

beforeEach(async () => {
  lider = await pessoa()
})

describe('lembrete do prazo das férias', () => {
  it('cobra o gestor que tem gente sem programar', async () => {
    await campanha(7)
    const liderado = await pessoa(lider.id)
    await direito(liderado.id)

    const enviados = await runVacationDeadlineReminderTick(NOVE_DA_MANHA)

    expect(enviados).toBe(1)
    const aviso = await prisma.notification.findFirst({
      where: { userId: lider.id, type: 'VACATION_PLAN_DEADLINE' },
    })
    expect(aviso?.title).toContain('Faltam 7 dia(s)')
    expect(aviso?.title).toContain('1 pendente')
  })

  it('cobra o gestor, e não o colaborador', async () => {
    await campanha(7)
    const liderado = await pessoa(lider.id)
    await direito(liderado.id)

    await runVacationDeadlineReminderTick(NOVE_DA_MANHA)

    // Avisar a pessoa de que o líder dela está atrasado produz constrangimento
    // sem mudar nada.
    expect(
      await prisma.notification.count({ where: { userId: liderado.id, type: 'VACATION_PLAN_DEADLINE' } }),
    ).toBe(0)
  })

  it('não cobra quem já confirmou', async () => {
    const c = await campanha(7)
    const liderado = await pessoa(lider.id)
    const d = await direito(liderado.id)
    await prisma.vacationPlan.create({
      data: { campaignId: c.id, entitlementId: d.id, companyId: DEFAULT_COMPANY_ID, status: 'CONFIRMED' },
    })

    expect(await runVacationDeadlineReminderTick(NOVE_DA_MANHA)).toBe(0)
  })

  it('rascunho ainda conta como pendente', async () => {
    const c = await campanha(7)
    const liderado = await pessoa(lider.id)
    const d = await direito(liderado.id)
    await prisma.vacationPlan.create({
      data: { campaignId: c.id, entitlementId: d.id, companyId: DEFAULT_COMPANY_ID, status: 'DRAFT' },
    })

    expect(await runVacationDeadlineReminderTick(NOVE_DA_MANHA)).toBe(1)
  })

  it('só dispara nas antecedências combinadas', async () => {
    await campanha(9)
    const liderado = await pessoa(lider.id)
    await direito(liderado.id)

    expect(await runVacationDeadlineReminderTick(NOVE_DA_MANHA)).toBe(0)
  })

  it('avisa também no último dia', async () => {
    await campanha(0)
    const liderado = await pessoa(lider.id)
    await direito(liderado.id)

    await runVacationDeadlineReminderTick(NOVE_DA_MANHA)

    const aviso = await prisma.notification.findFirst({ where: { userId: lider.id } })
    expect(aviso?.title).toContain('Hoje é o último dia')
  })

  it('fora da hora do disparo não faz nada', async () => {
    await campanha(7)
    const liderado = await pessoa(lider.id)
    await direito(liderado.id)

    expect(await runVacationDeadlineReminderTick(OUTRA_HORA)).toBe(0)
  })

  it('dois ticks no mesmo dia não cobram duas vezes', async () => {
    await campanha(7)
    const liderado = await pessoa(lider.id)
    await direito(liderado.id)

    await runVacationDeadlineReminderTick(NOVE_DA_MANHA)
    const segunda = await runVacationDeadlineReminderTick(NOVE_DA_MANHA)

    expect(segunda).toBe(0)
    expect(await prisma.notification.count({ where: { userId: lider.id } })).toBe(1)
  })

  it('campanha bloqueada à mão não cobra ninguém', async () => {
    const c = await campanha(7)
    await prisma.vacationCampaign.update({ where: { id: c.id }, data: { manuallyLocked: true } })
    const liderado = await pessoa(lider.id)
    await direito(liderado.id)

    expect(await runVacationDeadlineReminderTick(NOVE_DA_MANHA)).toBe(0)
  })
})
