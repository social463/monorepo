import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { scopedPrisma } from '../lib/tenant-scope'
import { listShowcase } from '../services/profile-service'
import { sectorNamesFor } from '../lib/sector-features'
import { toAwardedBadgeDTO, toPublicUser } from '../lib/serialize'
import { getXpPointsForUsers } from '../services/xp-service'
import { computeLevel } from '@legends/shared'

const showcaseQuerySchema = z.object({ former: z.string().optional(), sectorId: z.string().optional() })

export async function userRoutes(app: FastifyInstance) {
  // Com ?scope=company, devolve os colegas da empresa inteira (menções do mural
  // corporativo, que não é setorizado). THIRD_PARTY nunca escolhe: sempre o próprio setor.
  app.get('/users', { onRequest: [app.authenticate] }, async (request, reply) => {
    const scope = (request.query as { scope?: string }).scope
    const companyWide = scope === 'company' && request.user.role !== 'THIRD_PARTY'
    const users = await scopedPrisma(request.user.companyId).user.findMany({
      // Time: colegas do mesmo setor, menos admins. Inclui lideranças (LEAD), que fazem parte do
      // time e têm perfil, mas não recebem votos (filtradas na tela de votação).
      where: {
        active: true,
        role: { notIn: ['ADMIN', 'SUBADMIN'] },
        id: { not: request.user.sub },
        ...(companyWide ? {} : { sectorId: request.user.sectorId }),
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map((u) => toPublicUser(u)) })
  })

  // Colegas da empresa inteira (todos os setores), para escolher o destinatário no
  // Mural de Feedbacks. Terceirizado fica restrito ao próprio setor, como em /users/showcase.
  //
  // Com ?scope=all a lista deixa de ser a de *destinatários de feedback* e passa a ser a
  // de *pessoas da empresa*: entram você mesmo e os admins. As duas exclusões são regra de
  // feedback (ninguém dá feedback a si mesmo; admin não participa), e vazavam para campos
  // que escolhem uma pessoa qualquer — quem cadastra projeto no Inova costuma ser o próprio
  // responsável e não se achava na busca. O que NÃO muda: inativo continua fora e
  // terceirizado continua preso ao próprio setor.
  app.get('/users/company', { onRequest: [app.authenticate] }, async (request, reply) => {
    const everyone = (request.query as { scope?: string }).scope === 'all'
    const users = await scopedPrisma(request.user.companyId).user.findMany({
      where: {
        active: true,
        ...(everyone ? {} : { role: { notIn: ['ADMIN', 'SUBADMIN'] }, id: { not: request.user.sub } }),
        ...(request.user.role === 'THIRD_PARTY' ? { sectorId: request.user.sectorId } : {}),
      },
      orderBy: { name: 'asc' },
    })
    const sectorNames = await sectorNamesFor(users.map((u) => u.sectorId))
    return reply.send({
      users: users.map((u) => toPublicUser(u, [], { sectorName: sectorNames.get(u.sectorId) ?? '' })),
    })
  })

  // Galeria de conquistas: devs ativos com reconhecimentos e selos agregados.
  // Com ?former=1 (ou true), retorna ex-lendas em vez dos ativos.
  // Com ?sectorId=<id>, mostra outro setor (padrão: o próprio); ?sectorId=all mostra todos.
  // THIRD_PARTY nunca escolhe: o parâmetro é ignorado, sempre vê o próprio setor.
  app.get('/users/showcase', { onRequest: [app.authenticate, app.requireFeature('lendas')] }, async (request, reply) => {
    const parsed = showcaseQuerySchema.safeParse(request.query)
    const former = parsed.success ? parsed.data.former : undefined
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const rows = await listShowcase({
      former: former === '1' || former === 'true',
      sectorId,
      companyId: request.user.companyId,
    })
    const sectorNames = await sectorNamesFor(rows.map((row) => row.user.sectorId))
    // Pontos de todo mundo numa query só: é o que evita o N+1 que uma galeria
    // de dezenas de pessoas provocaria se cada card buscasse o próprio saldo.
    const points = await getXpPointsForUsers(
      rows.map((row) => row.user.id),
      request.user.companyId,
    )
    return reply.send({
      entries: rows.map((row) => {
        const total = points.get(row.user.id) ?? 0
        return {
          user: toPublicUser(row.user, [], { sectorName: sectorNames.get(row.user.sectorId) ?? '' }),
          feedbacksReceived: row.feedbacksReceived,
          badges: row.badges.map(toAwardedBadgeDTO),
          xp: { points: total, level: computeLevel(total) },
        }
      }),
    })
  })
}
