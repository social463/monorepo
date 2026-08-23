import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'LEGEND' | 'LEAD' = 'LEAD') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function squad(name: string) {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase() } })
}
async function action(roomId: string, authorId: string, over: Record<string, unknown>) {
  return prisma.retroCard.create({ data: { roomId, authorId, text: 'o', color: 'blue', kind: 'note', x: 1200, y: 340, actionPlan: 'P', actionResponsible: authorId, actionDueDate: '2026-07-01', ...over } })
}

describe('GET /retro/rooms/:id/carryover', () => {
  it('classifica a validar (done) e vencida (prazo<=data da sala), só da mesma squad', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('Lia', 'LEAD')
      const sq = await squad('S'); const other = await squad('Other')
      const prev = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: sq.id } } } })
      const otherPrev = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: other.id } } } })
      const current = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, createdAt: new Date('2026-06-10'), squads: { create: { squadId: sq.id } } } })

      await action(prev.id, lead.id, { actionDone: true, actionDoneAt: new Date('2026-06-04'), actionPlan: 'Concluída' })
      await action(prev.id, lead.id, { actionDone: false, actionDueDate: '2026-06-05', actionPlan: 'Vencida' })
      await action(prev.id, lead.id, { actionDone: false, actionDueDate: '2026-12-31', actionPlan: 'Futura' })
      await action(otherPrev.id, lead.id, { actionDone: true, actionDoneAt: new Date(), actionPlan: 'OutraSquad' })

      const tk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/carryover`, headers: { authorization: `Bearer ${tk}` } })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.toValidate.map((i: { plan: string }) => i.plan)).toEqual(['Concluída'])
      expect(body.overdue.map((i: { plan: string }) => i.plan)).toEqual(['Vencida'])
      expect(body.toValidate[0]).toMatchObject({ type: 'validate', sprint: 5 })
      expect(body.overdue[0]).toMatchObject({ type: 'overdue', sprint: 5 })
    } finally { await app.close() }
  })
})

describe('POST /retro/rooms/:id/carryover/:cardId', () => {
  async function setup() {
    const app = buildApp(); await app.ready()
    const lead = await user('Lia', 'LEAD'); const dev = await user('Dan', 'LEGEND')
    const sq = await squad('S2')
    const prev = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: sq.id } } } })
    const current = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, createdAt: new Date('2026-06-10'), squads: { create: { squadId: sq.id } }, participants: { create: { userId: dev.id } } } })
    const act = await action(prev.id, lead.id, { actionDone: false, actionDueDate: '2026-06-05' })
    return { app, lead, dev, current, act }
  }

  it('DEV não resolve (403); LEAD reschedule muda prazo e tira de vencida', async () => {
    const { app, dev, lead, current, act } = await setup()
    try {
      const devTk = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const forbidden = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${devTk}` }, payload: { action: 'reschedule', dueDate: '2026-12-31' } })
      expect(forbidden.statusCode).toBe(403)

      const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const ok = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'reschedule', dueDate: '2026-12-31' } })
      expect(ok.statusCode).toBe(200)
      expect((await prisma.retroCard.findUnique({ where: { id: act.id } }))!.actionDueDate).toBe('2026-12-31')
      const list = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/carryover`, headers: { authorization: `Bearer ${leadTk}` } })
      expect(list.json().overdue).toHaveLength(0)
    } finally { await app.close() }
  })

  it('LEAD done marca concluída (vira a validar)', async () => {
    const { app, lead, current, act } = await setup()
    try {
      const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'done' } })
      expect(res.statusCode).toBe(200)
      expect((await prisma.retroCard.findUnique({ where: { id: act.id } }))!.actionDone).toBe(true)
      const list = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/carryover`, headers: { authorization: `Bearer ${leadTk}` } })
      expect(list.json().toValidate.map((i: { id: string }) => i.id)).toContain(act.id)
    } finally { await app.close() }
  })

  it('LEAD validate: auditStatus=VALIDATED, type=validate na resposta, some do toValidate', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('Lia2', 'LEAD')
      const sq = await squad('S3')
      const prev = await prisma.retroRoom.create({ data: { sprint: 7, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: sq.id } } } })
      const current = await prisma.retroRoom.create({ data: { sprint: 8, createdById: lead.id, anonymous: true, votesPerParticipant: 3, createdAt: new Date('2026-06-10'), squads: { create: { squadId: sq.id } } } })
      const act = await action(prev.id, lead.id, { actionDone: true, actionDoneAt: new Date('2026-06-04') })

      const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'validate' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().item.type).toBe('validate')
      const db = await prisma.retroCard.findUnique({ where: { id: act.id } })
      expect(db!.auditStatus).toBe('VALIDATED')

      const list = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/carryover`, headers: { authorization: `Bearer ${leadTk}` } })
      expect(list.json().toValidate.map((i: { id: string }) => i.id)).not.toContain(act.id)
    } finally { await app.close() }
  })

  it('LEAD reject: auditStatus=REJECTED, actionDone=false', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('Lia3', 'LEAD')
      const sq = await squad('S4')
      const prev = await prisma.retroRoom.create({ data: { sprint: 9, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date('2026-06-01'), createdAt: new Date('2026-05-20'), squads: { create: { squadId: sq.id } } } })
      const current = await prisma.retroRoom.create({ data: { sprint: 10, createdById: lead.id, anonymous: true, votesPerParticipant: 3, createdAt: new Date('2026-06-10'), squads: { create: { squadId: sq.id } } } })
      const act = await action(prev.id, lead.id, { actionDone: true, actionDoneAt: new Date('2026-06-04') })

      const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'reject' } })
      expect(res.statusCode).toBe(200)
      const db = await prisma.retroCard.findUnique({ where: { id: act.id } })
      expect(db!.auditStatus).toBe('REJECTED')
      expect(db!.actionDone).toBe(false)
    } finally { await app.close() }
  })

  it('reject → done: limpa o veredito de auditoria (reaparece em toValidate)', async () => {
    const { app, lead, current, act } = await setup()
    try {
      const leadTk = app.jwt.sign({ sub: lead.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })

      // 1. Mark as done first so it can be rejected
      await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'done' } })

      // 2. Reject it (sets auditStatus=REJECTED, actionDone=false)
      const rejectRes = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'reject' } })
      expect(rejectRes.statusCode).toBe(200)
      const afterReject = await prisma.retroCard.findUnique({ where: { id: act.id } })
      expect(afterReject!.auditStatus).toBe('REJECTED')
      expect(afterReject!.actionDone).toBe(false)

      // 3. Mark done again — must clear the audit verdict
      const doneRes = await app.inject({ method: 'POST', url: `/retro/rooms/${current.id}/carryover/${act.id}`, headers: { authorization: `Bearer ${leadTk}` }, payload: { action: 'done' } })
      expect(doneRes.statusCode).toBe(200)
      const afterDone = await prisma.retroCard.findUnique({ where: { id: act.id } })
      expect(afterDone!.actionDone).toBe(true)
      expect(afterDone!.auditStatus).toBeNull()

      // 4. Card must reappear in toValidate (not vanish from both lists)
      const list = await app.inject({ method: 'GET', url: `/retro/rooms/${current.id}/carryover`, headers: { authorization: `Bearer ${leadTk}` } })
      expect(list.json().toValidate.map((i: { id: string }) => i.id)).toContain(act.id)
    } finally { await app.close() }
  })
})
