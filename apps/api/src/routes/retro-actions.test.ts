import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function actionCard(roomId: string, authorId: string, responsibleId: string) {
  return prisma.retroCard.create({ data: { roomId, authorId, text: 'o', color: 'blue', x: 0, y: 0, actionPlan: 'P', actionResponsible: responsibleId, actionDueDate: '2026-07-01' } })
}

describe('PATCH /retro/actions/:cardId', () => {
  it('só o responsável conclui; grava actionDone/doneAt', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('Lia', 'LEAD'); const dev = await user('Dan'); const other = await user('Ed')
      const squad = await prisma.squad.create({ data: { name: 'S', slug: 's' } })
      const room = await prisma.retroRoom.create({ data: { sprint: 5, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
      const card = await actionCard(room.id, lead.id, dev.id)

      const otherTk = app.jwt.sign({ sub: other.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const forbidden = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${otherTk}` }, payload: { done: true } })
      expect(forbidden.statusCode).toBe(403)

      const devTk = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const ok = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${devTk}` }, payload: { done: true } })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().action).toMatchObject({ done: true, sprint: 5 })
      const saved = await prisma.retroCard.findUnique({ where: { id: card.id } })
      expect(saved!.actionDone).toBe(true)
      expect(saved!.actionDoneAt).not.toBeNull()
    } finally {
      await app.close()
    }
  })

  it('limpa campos de auditoria ao desmarcar como concluído', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('Lia2', 'LEAD'); const dev = await user('Dan2'); const auditor = await user('Aud', 'LEAD')
      const squad = await prisma.squad.create({ data: { name: 'S2', slug: 's2' } })
      const room = await prisma.retroRoom.create({ data: { sprint: 6, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })

      // card já com auditoria preenchida
      const card = await prisma.retroCard.create({
        data: {
          roomId: room.id, authorId: lead.id, text: 'o', color: 'blue', x: 0, y: 0,
          actionPlan: 'P', actionResponsible: dev.id, actionDueDate: '2026-07-01',
          actionDone: true, actionDoneAt: new Date(),
          auditStatus: 'VALIDATED', auditedById: auditor.id, auditedAt: new Date(),
        },
      })

      const devTk = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${devTk}` }, payload: { done: false } })
      expect(res.statusCode).toBe(200)

      const saved = await prisma.retroCard.findUnique({ where: { id: card.id } })
      expect(saved!.actionDone).toBe(false)
      expect(saved!.actionDoneAt).toBeNull()
      expect(saved!.auditStatus).toBeNull()
      expect(saved!.auditedById).toBeNull()
      expect(saved!.auditedAt).toBeNull()
    } finally {
      await app.close()
    }
  })

  it('retorna 404 quando a sala da ação está arquivada', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('LiaArq2', 'LEAD'); const dev = await user('DanArq2')
      const squad = await prisma.squad.create({ data: { name: 'SArq2', slug: 's-arq2' } })
      const room = await prisma.retroRoom.create({
        data: {
          sprint: 20, createdById: lead.id, anonymous: true, votesPerParticipant: 3,
          status: 'CONCLUDED', concludedAt: new Date(),
          squads: { create: { squadId: squad.id } },
        },
      })
      const card = await actionCard(room.id, lead.id, dev.id)

      // archive the room
      await prisma.retroRoom.update({ where: { id: room.id }, data: { archivedAt: new Date() } })

      const devTk = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${devTk}` }, payload: { done: true } })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('PATCH /retro/actions/:cardId grava a nota sem resetar auditoria', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('LiaN', 'LEAD'); const dev = await user('DanN')
      const squad = await prisma.squad.create({ data: { name: 'SN', slug: 's-n' } })
      const room = await prisma.retroRoom.create({ data: { sprint: 7, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
      const card = await prisma.retroCard.create({ data: { roomId: room.id, authorId: lead.id, text: 'p', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer X', actionResponsible: dev.id, actionDueDate: '2026-07-01', actionDone: true, auditStatus: 'VALIDATED', auditedById: lead.id, auditedAt: new Date() } })

      const token = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { note: 'Tratei com o time' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().action.note).toBe('Tratei com o time')
      const after = await prisma.retroCard.findUnique({ where: { id: card.id } })
      expect(after?.actionNote).toBe('Tratei com o time')
      expect(after?.auditStatus).toBe('VALIDATED') // nota não resetou auditoria
    } finally { await app.close() }
  })

  /**
   * Arquivar é o que segura o tamanho da lista do perfil — e por isso não pode
   * virar atalho para sumir com pendência: a regra "só concluída" é do
   * servidor, não do botão.
   */
  describe('arquivar', () => {
    async function cenario(sufixo: string, done: boolean) {
      const app = buildApp(); await app.ready()
      const lead = await user(`LiaA${sufixo}`, 'LEAD'); const dev = await user(`DanA${sufixo}`)
      const squad = await prisma.squad.create({ data: { name: `SA${sufixo}`, slug: `s-a-${sufixo}` } })
      const room = await prisma.retroRoom.create({ data: { sprint: 9, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
      const card = await prisma.retroCard.create({ data: { roomId: room.id, authorId: lead.id, text: 'p', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer Z', actionResponsible: dev.id, actionDueDate: '2026-07-03', actionDone: done, actionDoneAt: done ? new Date() : null } })
      const token = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      return { app, card, dev, token }
    }

    it('arquiva a concluída e some da listagem do perfil, sem sair do arquivo', async () => {
      const { app, card, dev, token } = await cenario('1', true)
      try {
        const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { archived: true } })
        expect(res.statusCode).toBe(200)
        expect(res.json().action.archivedAt).not.toBeNull()

        const perfil = await app.inject({ method: 'GET', url: `/users/${dev.id}/profile`, headers: { authorization: `Bearer ${token}` } })
        expect(perfil.json().actions).toHaveLength(0)
        expect(perfil.json().archivedActionCount).toBe(1)

        const arquivadas = await app.inject({ method: 'GET', url: '/retro/actions/archived', headers: { authorization: `Bearer ${token}` } })
        expect(arquivadas.json().actions.map((a: { id: string }) => a.id)).toEqual([card.id])
      } finally { await app.close() }
    })

    it('recusa arquivar ação pendente (409)', async () => {
      const { app, card, token } = await cenario('2', false)
      try {
        const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { archived: true } })
        expect(res.statusCode).toBe(409)
        const saved = await prisma.retroCard.findUnique({ where: { id: card.id } })
        expect(saved!.actionArchivedAt).toBeNull()
      } finally { await app.close() }
    })

    it('desarquiva de volta para a lista ativa', async () => {
      const { app, card, dev, token } = await cenario('3', true)
      try {
        await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { archived: true } })
        const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { archived: false } })
        expect(res.statusCode).toBe(200)
        expect(res.json().action.archivedAt).toBeNull()

        const perfil = await app.inject({ method: 'GET', url: `/users/${dev.id}/profile`, headers: { authorization: `Bearer ${token}` } })
        expect(perfil.json().actions).toHaveLength(1)
      } finally { await app.close() }
    })

    /** Reabrir traz de volta: ação pendente escondida é ação esquecida. */
    it('desmarcar como concluída também desarquiva', async () => {
      const { app, card, dev, token } = await cenario('4', true)
      try {
        await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { archived: true } })
        await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { done: false } })

        const saved = await prisma.retroCard.findUnique({ where: { id: card.id } })
        expect(saved!.actionArchivedAt).toBeNull()
        const perfil = await app.inject({ method: 'GET', url: `/users/${dev.id}/profile`, headers: { authorization: `Bearer ${token}` } })
        expect(perfil.json().actions).toHaveLength(1)
      } finally { await app.close() }
    })
  })

  it('PATCH /retro/actions/:cardId nota só pelo responsável', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('LiaX', 'LEAD'); const dev = await user('DanX'); const outro = await user('OutroX')
      const squad = await prisma.squad.create({ data: { name: 'SX', slug: 's-x' } })
      const room = await prisma.retroRoom.create({ data: { sprint: 8, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
      const card = await prisma.retroCard.create({ data: { roomId: room.id, authorId: lead.id, text: 'p', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer Y', actionResponsible: dev.id, actionDueDate: '2026-07-02' } })

      const token = app.jwt.sign({ sub: outro.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { note: 'x' } })
      expect(res.statusCode).toBe(403)
    } finally { await app.close() }
  })
})
