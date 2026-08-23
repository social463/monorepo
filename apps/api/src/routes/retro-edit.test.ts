import { describe, it, expect } from 'vitest'
import { RETRO_REGIONS, RETRO_ACTION_REGION_IDS } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function user(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
const region = RETRO_REGIONS.find((r) => (RETRO_ACTION_REGION_IDS as readonly string[]).includes(r.id))!
const AX = region.x + 10
const AY = region.y + 10

/** Cria sala + 1 action card (em região de ação) + 1 card comum, e conclui a sala. */
async function concludedRoomWithCards() {
  const creator = await user('Lia', 'LEAD')
  const squad = await prisma.squad.create({ data: { name: 'S', slug: 's' } })
  const room = await prisma.retroRoom.create({ data: { sprint: 1, createdById: creator.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } }, participants: { create: { userId: creator.id } } } })
  const action = await prisma.retroCard.create({ data: { roomId: room.id, authorId: creator.id, text: 'Origem', color: 'blue', kind: 'note', x: AX, y: AY, actionPlan: 'Plano', actionResponsible: creator.id, actionDueDate: '2026-07-01' } })
  const plain = await prisma.retroCard.create({ data: { roomId: room.id, authorId: creator.id, text: 'comum', color: 'yellow', kind: 'note', x: 50, y: 50 } })
  return { creator, room, action, plain }
}

describe('PATCH /retro/rooms/:id/cards/:cardId — pós-conclusão (LEAD)', () => {
  it('LEAD (não-criador) edita action card de sala concluída; grava editedBy/editedAt e RetroEdit', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, action } = await concludedRoomWithCards()
      const lead2 = await user('Léo', 'LEAD')
      const tk = app.jwt.sign({ sub: lead2.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${action.id}`, headers: { authorization: `Bearer ${tk}` }, payload: { actionPlan: 'Plano revisado' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().card.editedBy).toMatchObject({ id: lead2.id })
      const saved = await prisma.retroCard.findUnique({ where: { id: action.id } })
      expect(saved!.actionPlan).toBe('Plano revisado')
      expect(saved!.editedById).toBe(lead2.id)
      expect(saved!.editedAt).not.toBeNull()
      const edits = await prisma.retroEdit.findMany({ where: { roomId: room.id } })
      expect(edits).toHaveLength(1)
      expect(edits[0]).toMatchObject({ editorId: lead2.id, action: 'action.updated' })
    } finally { await app.close() }
  })

  it('LEAD não pode editar card NÃO-ação em sala concluída (409)', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, plain } = await concludedRoomWithCards()
      const lead2 = await user('Léo', 'LEAD')
      const tk = app.jwt.sign({ sub: lead2.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${plain.id}`, headers: { authorization: `Bearer ${tk}` }, payload: { text: 'x' } })
      expect(res.statusCode).toBe(409)
    } finally { await app.close() }
  })

  it('DEV não edita action card em sala concluída (409)', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, action } = await concludedRoomWithCards()
      const dev = await user('Dan', 'LEGEND')
      const tk = app.jwt.sign({ sub: dev.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      const res = await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${action.id}`, headers: { authorization: `Bearer ${tk}` }, payload: { actionPlan: 'nope' } })
      expect(res.statusCode).toBe(409)
    } finally { await app.close() }
  })
})

describe('GET /retro/rooms/:id/edits', () => {
  it('lista as edições em ordem desc; nega acesso a quem não vê a sala (404)', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, action, creator } = await concludedRoomWithCards()
      const lead2 = await user('Léo', 'LEAD')
      const tk2 = app.jwt.sign({ sub: lead2.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })
      await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${action.id}`, headers: { authorization: `Bearer ${tk2}` }, payload: { actionPlan: 'v2' } })

      const list = await app.inject({ method: 'GET', url: `/retro/rooms/${room.id}/edits`, headers: { authorization: `Bearer ${app.jwt.sign({ sub: creator.id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })}` } })
      expect(list.statusCode).toBe(200)
      expect(list.json().edits).toHaveLength(1)
      expect(list.json().edits[0]).toMatchObject({ editor: { id: lead2.id }, action: 'action.updated' })

      const stranger = await user('Estranho', 'LEGEND')
      const denied = await app.inject({ method: 'GET', url: `/retro/rooms/${room.id}/edits`, headers: { authorization: `Bearer ${app.jwt.sign({ sub: stranger.id, role: 'LEGEND', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })}` } })
      expect(denied.statusCode).toBe(404)
    } finally { await app.close() }
  })
})

describe('edição reflete no card-espelho (Ações)', () => {
  it('editar o plano regenera o texto do espelho; campo limpo também reflete (—)', async () => {
    const app = buildApp(); await app.ready()
    try {
      const { room, action } = await concludedRoomWithCards()
      // sala revelada (não anônima) para o texto do espelho não vir mascarado no DTO
      await prisma.retroRoom.update({ where: { id: room.id }, data: { anonymous: false } })
      // espelho com texto antigo, vinculado à origem
      const mirror = await prisma.retroCard.create({ data: { roomId: room.id, authorId: action.authorId, text: 'Plano: ANTIGO\nResponsável: x\nPrazo: y\n\nOrigem: Origem', color: 'blue', kind: 'note', x: 2360, y: 360 } })
      await prisma.retroCard.update({ where: { id: action.id }, data: { actionCardId: mirror.id } })
      const tk = app.jwt.sign({ sub: (await user('Léo', 'LEAD')).id, role: 'LEAD', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['retrospectivas'] })

      const edit = await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${action.id}`, headers: { authorization: `Bearer ${tk}` }, payload: { actionPlan: 'Plano NOVO' } })
      expect(edit.statusCode).toBe(200)
      expect(edit.json().actionCard.text).toContain('Plano NOVO')
      expect((await prisma.retroCard.findUnique({ where: { id: mirror.id } }))!.text).toContain('Plano NOVO')

      // limpar o responsável ainda reflete no espelho (mostra "—") em vez de ficar defasado
      const clear = await app.inject({ method: 'PATCH', url: `/retro/rooms/${room.id}/cards/${action.id}`, headers: { authorization: `Bearer ${tk}` }, payload: { actionResponsible: '' } })
      expect(clear.statusCode).toBe(200)
      expect(clear.json().actionCard.text).toContain('Responsável: —')
    } finally { await app.close() }
  })
})
