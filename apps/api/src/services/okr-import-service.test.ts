import { describe, expect, it } from 'vitest'
import { planImpulseUpImport } from '../lib/impulseup-okr'
import { fixtureSnapshot } from '../lib/impulseup-okr.fixture'
import { prisma } from '../lib/prisma'
import { importImpulseUpPlan } from './okr-import-service'

async function people() {
  for (const email of ['dev@emr.com', 'lider@emr.com', 'lucca@emr.com']) {
    await prisma.user.create({ data: { name: email, email: email.toUpperCase(), passwordHash: 'x' } })
  }
}

describe('importImpulseUpPlan', () => {
  it('dry-run não grava nada e relata o que criaria', async () => {
    await people()
    const report = await importImpulseUpPlan(planImpulseUpImport(fixtureSnapshot()), { companyId: 'company-emr', apply: false })
    expect(report.counts.objectives.created).toBe(4)
    expect(report.counts.checkIns.created).toBe(6)
    expect(report.checkIns).toEqual({ total: 6, withoutValue: 3, synthetic: 2 })
    expect(report.unmatchedEmails).toEqual(['criadora@emr.com', 'fantasma@emr.com'])
    expect(await prisma.okrCycle.count()).toBe(0)
  })

  it('aplica, casa pessoas por e-mail sem caixa, e reimportar não duplica nem muda nada', async () => {
    await people()
    const plan = planImpulseUpImport(fixtureSnapshot())
    const first = await importImpulseUpPlan(plan, { companyId: 'company-emr', apply: true })
    expect(first.counts.cycle.created).toBe(1)
    expect(first.skippedDependencies).toBe(1)

    const squad = await prisma.okrObjective.findFirstOrThrow({ where: { externalId: 'obj-bugs-squad' } })
    const setor = await prisma.okrObjective.findFirstOrThrow({ where: { externalId: 'obj-bugs-setor' } })
    expect(squad.parentId).toBe(setor.id)
    expect(squad.path).toEqual([setor.id, squad.id])
    const dev = await prisma.user.findFirstOrThrow({ where: { email: 'DEV@EMR.COM' } })
    expect(await prisma.okrAssignment.count({ where: { subjectId: squad.id, personId: dev.id, role: 'ASSIGNED_TO' } })).toBe(1)
    const calc = await prisma.okrKeyResult.findFirstOrThrow({ where: { externalId: 'kr-iniciativas' } })
    expect(await prisma.okrKrDependency.count({ where: { keyResultId: calc.id } })).toBe(2)
    const valued = await prisma.okrCheckIn.findFirstOrThrow({ where: { externalId: 'c-valor' } })
    expect(valued).toMatchObject({ value: 8.3, source: 'IMPULSEUP_IMPORT' })

    const again = await importImpulseUpPlan(planImpulseUpImport(fixtureSnapshot()), { companyId: 'company-emr', apply: true })
    for (const counts of Object.values(again.counts)) {
      expect(counts, JSON.stringify(again.counts)).toMatchObject({ created: 0, updated: 0, removed: 0 })
    }
    expect(await prisma.okrCheckIn.count()).toBe(6)
    expect(await prisma.okrObjective.count()).toBe(4)
  })

  it('reimportação atualiza o que mudou na origem e restaura objetivo apagado aqui', async () => {
    await people()
    await importImpulseUpPlan(planImpulseUpImport(fixtureSnapshot()), { companyId: 'company-emr', apply: true })
    await prisma.okrObjective.updateMany({ where: { externalId: 'obj-receita' }, data: { deletedAt: new Date() } })

    const changed = fixtureSnapshot()
    changed.objectives[0].keyResults![0].metric.target = 12
    changed.objectives[1].people!.OWNER = []
    const report = await importImpulseUpPlan(planImpulseUpImport(changed), { companyId: 'company-emr', apply: true })
    expect(report.counts.keyResults.updated).toBe(1)
    expect(report.counts.objectives.updated).toBe(1)
    expect(report.counts.assignments.removed).toBe(1)
    expect((await prisma.okrKeyResult.findFirstOrThrow({ where: { externalId: 'kr-bugs-setor' } })).target).toBe(12)
    expect((await prisma.okrObjective.findFirstOrThrow({ where: { externalId: 'obj-receita' } })).deletedAt).toBeNull()
  })
})
