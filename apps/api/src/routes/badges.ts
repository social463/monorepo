import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  BADGE_CATEGORY_NAME_MAX_LENGTH,
  BADGE_CLAIM_REJECTION_REASON_MAX_LENGTH,
  BADGE_CLAIM_STATUSES,
  BADGE_CLAIM_STORY_MAX_LENGTH,
  CORPORATE_POST_ATTACHMENT_KINDS,
} from '@legends/shared'
import { getBadgeCatalog, listBadgesForUser } from '../services/badge-service'
import {
  BadgeClaimError,
  approveBadgeClaim,
  createBadgeClaim,
  listBadgeClaims,
  listMyBadgeClaims,
  rejectBadgeClaim,
} from '../services/badge-claim-service'
import {
  BadgeCategoryError,
  createBadgeCategory,
  listBadgeCategories,
  updateBadgeCategory,
} from '../services/badge-category-service'
import { findUserInCompany } from '../lib/tenant-scope'
import { toAwardedBadgeDTO, toBadgeCatalogEntryDTO } from '../lib/serialize'

const claimSchema = z.object({
  story: z.string().trim().min(1).max(BADGE_CLAIM_STORY_MAX_LENGTH),
  attachmentKey: z.string().trim().min(1).max(500).nullable().optional(),
  attachmentKind: z.enum(CORPORATE_POST_ATTACHMENT_KINDS).nullable().optional(),
  link: z.string().trim().url().max(500).nullable().optional().or(z.literal('')),
})

const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(BADGE_CLAIM_REJECTION_REASON_MAX_LENGTH),
})

const categorySchema = z.object({
  name: z.string().trim().min(1).max(BADGE_CATEGORY_NAME_MAX_LENGTH),
})

const categoryPatchSchema = z.object({
  name: z.string().trim().min(1).max(BADGE_CATEGORY_NAME_MAX_LENGTH).optional(),
  active: z.boolean().optional(),
  order: z.number().int().min(0).max(999).optional(),
})

export async function badgeRoutes(app: FastifyInstance) {
  app.get('/badges', { onRequest: [app.authenticate, app.requireFeature('selos')] }, async (request, reply) => {
    const catalog = await getBadgeCatalog(request.user.sub)
    return reply.send({ badges: catalog.map(toBadgeCatalogEntryDTO) })
  })

  app.get('/users/:id/badges', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const target = await findUserInCompany(request.user.companyId, id)
    if (!target) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    const awarded = await listBadgesForUser(id)
    return reply.send({ badges: awarded.map(toAwardedBadgeDTO) })
  })

  /** Temas do catálogo, para o formulário e a galeria. Só os ativos. */
  app.get('/badge-categories', { onRequest: [app.authenticate] }, async (request, reply) => {
    return reply.send({ categories: await listBadgeCategories(request.user.companyId) })
  })

  // ─────────────────── reivindicação (Documento 4, seção 11.2) ───────────────────

  app.post(
    '/badges/:id/claims',
    { onRequest: [app.authenticate, app.requireFeature('selos')] },
    async (request, reply) => {
      const parsed = claimSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      }
      const { id } = request.params as { id: string }
      try {
        const claim = await createBadgeClaim(
          { userId: request.user.sub, companyId: request.user.companyId },
          id,
          { ...parsed.data, link: parsed.data.link === '' ? null : parsed.data.link },
        )
        return reply.code(201).send({ claim })
      } catch (err) {
        if (err instanceof BadgeClaimError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.get('/me/badge-claims', { onRequest: [app.authenticate] }, async (request, reply) => {
    const claims = await listMyBadgeClaims({ userId: request.user.sub, companyId: request.user.companyId })
    return reply.send({ claims })
  })

  // ─────────────────────────── fila do admin ───────────────────────────

  const adminGate = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/badge-claims', adminGate, async (request, reply) => {
    const { status } = request.query as { status?: string }
    const filtro = (BADGE_CLAIM_STATUSES as readonly string[]).includes(status ?? '')
      ? (status as (typeof BADGE_CLAIM_STATUSES)[number])
      : undefined
    return reply.send({ claims: await listBadgeClaims(request.user.companyId, filtro) })
  })

  app.post('/admin/badge-claims/:id/approve', adminGate, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const claim = await approveBadgeClaim({ id: request.user.sub, companyId: request.user.companyId }, id)
      return reply.send({ claim })
    } catch (err) {
      if (err instanceof BadgeClaimError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/badge-claims/:id/reject', adminGate, async (request, reply) => {
    const parsed = rejectSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Informe o motivo da recusa.' })
    const { id } = request.params as { id: string }
    try {
      const claim = await rejectBadgeClaim(
        { id: request.user.sub, companyId: request.user.companyId },
        id,
        parsed.data.reason,
      )
      return reply.send({ claim })
    } catch (err) {
      if (err instanceof BadgeClaimError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // ─────────────── temas do catálogo (Documento 4, seção 11.4) ───────────────

  app.get('/admin/badge-categories', adminGate, async (request, reply) => {
    const categories = await listBadgeCategories(request.user.companyId, { includeInactive: true })
    return reply.send({ categories })
  })

  app.post('/admin/badge-categories', adminGate, async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Informe o nome do tema.' })
    try {
      return reply.code(201).send({ category: await createBadgeCategory(request.user.companyId, parsed.data.name) })
    } catch (err) {
      if (err instanceof BadgeCategoryError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/badge-categories/:id', adminGate, async (request, reply) => {
    const parsed = categoryPatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.' })
    const { id } = request.params as { id: string }
    try {
      return reply.send({ category: await updateBadgeCategory(request.user.companyId, id, parsed.data) })
    } catch (err) {
      if (err instanceof BadgeCategoryError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
