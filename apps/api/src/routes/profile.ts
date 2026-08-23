import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MAX_FEATURED_BADGES } from '@legends/shared'
import { findUserInCompany } from '../lib/tenant-scope'
import {
  getUserProfile,
  listUserActions,
  countUserArchivedActions,
  setFeaturedBadges,
  ProfileError,
} from '../services/profile-service'
import { evaluateTenureBadgesForUser, listBadgesForUser } from '../services/badge-service'
import { notifyBadgesEarned } from '../services/notification-service'
import { getXpBalance } from '../services/xp-service'
import { sectorFeaturesFor, sectorNamesFor } from '../lib/sector-features'
import { squadLabel, toAwardedBadgeDTO, toPublicUser, toRetroActionItemDTO } from '../lib/serialize'

const featuredBadgesSchema = z.object({
  badgeIds: z.array(z.string()).max(MAX_FEATURED_BADGES),
})


export async function profileRoutes(app: FastifyInstance) {
  app.get('/users/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user = await findUserInCompany(request.user.companyId, id)
    if (!user) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    return reply.send({ user: toPublicUser(user) })
  })

  app.get('/users/:id/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const target = await findUserInCompany(request.user.companyId, id)
    if (!target) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    const profile = await getUserProfile(id)
    if (!profile) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    // Avaliação preguiçosa dos selos de tempo de casa: best-effort, nunca derruba o perfil.
    try {
      const awarded = await evaluateTenureBadgesForUser(id)
      if (awarded.length > 0) {
        await notifyBadgesEarned(id, awarded.map((b) => b.badgeId), request.user.companyId)
      }
    } catch (err) {
      request.log.error(err)
    }
    const badges = await listBadgesForUser(id)
    const actions = await listUserActions(id)
    const archivedActionCount = await countUserArchivedActions(id)
    const sectorFeatures = await sectorFeaturesFor(profile.user.sectorId)
    const votingEnabled = sectorFeatures.includes('votar')
    const sectorName = (await sectorNamesFor([profile.user.sectorId])).get(profile.user.sectorId) ?? ''
    // O nível é do dono do perfil, não do viewer: quem abre o perfil de um
    // colega vê a progressão DELE. Sem gate de feature, como na Home.
    const xp = await getXpBalance(id, request.user.companyId)
    return reply.send({
      user: toPublicUser(profile.user, [], { sectorName }),
      stats: {
        totalFeedbacksReceived: profile.totalFeedbacksReceived,
        monthsWithFeedback: profile.monthsWithFeedback,
      },
      xp,
      categoryBreakdown: profile.categoryBreakdown,
      months: profile.months,
      badges: badges.map(toAwardedBadgeDTO),
      actions: actions.map((c) => toRetroActionItemDTO(c, c.room.sprint, squadLabel(c.room.squads))),
      archivedActionCount,
      votingEnabled,
    })
  })

  app.put('/me/featured-badges', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = featuredBadgesSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const badges = await setFeaturedBadges(request.user.sub, parsed.data.badgeIds)
      return reply.send({ badges: badges.map(toAwardedBadgeDTO) })
    } catch (err) {
      if (err instanceof ProfileError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })
}
