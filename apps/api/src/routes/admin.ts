import type { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/password'
import { closeVotingPeriod, scheduleVotingPeriod, updateVotingPeriod, AdminServiceError } from '../services/admin-service'
import { voteInclude } from '../services/voting-service'
import { isPeriodEditable } from '../lib/period-state'
import { toAdminUser, toAwardedBadgeDTO, toBadgeDTO, toPeriodDTO, toPublicUser, toVoteDTO, toHighlightDTO, toSquadWithMembersDTO, toRetroRoomSummaryDTO, toSectorDTO, toAuditLogEntryDTO, toRecognitionCategoryDTO } from '../lib/serialize'
import { generateHighlightDraft, updateHighlightText, generateHighlightImage, publishHighlight, listPublishedHighlights, HighlightError } from '../services/highlight-service'
import { listSquads, createSquad, updateSquad, addMember, removeMember, SquadError } from '../services/squad-service'
import { listSectors, createSector, updateSector, SectorError } from '../services/sector-service'
import { grantBadgeManually, revokeManualBadge, listBadgesForUser, BadgeError } from '../services/badge-service'
import { listCategories, createCategory, updateCategory, CategoryError } from '../services/category-service'
import { listBadgesAdmin, getBadgeAdmin, createBadgeAdmin, updateBadgeAdmin, BadgeAdminError } from '../services/badge-admin-service'
import { findUserInCompany, scopedPrisma } from '../lib/tenant-scope'
import { notifyBadgesEarned, notifyPeriodOpened, notifyPeriodClosed } from '../services/notification-service'
import { USER_ROLES, AREAS, MIN_SPRINT, MAX_SPRINT, MIN_VOTES_PER_PARTICIPANT, MAX_VOTES_PER_PARTICIPANT, FEATURE_KEYS, DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, RECOGNITION_CATEGORY_NAME_MAX_LENGTH, canReceiveAdminAccess } from '@legends/shared'
import { listRoomsForAdmin, updateRoomAsAdmin, hardDeleteRoom, RetroError } from '../services/retro-service'
import {
  CalendarEventError,
  createEventType,
  deleteEventType,
  listEventTypes,
  updateEventType,
} from '../services/calendar-event-service'
import { retroHub } from '../lib/retro-hub'
import { getDevelopmentThursdaySettings, updateDevelopmentThursdaySettings } from '../services/development-thursday-service'
import { getOfficeSettings, setBroadcastEnabled } from '../services/office-setting-service'
import { listAuditLog, listAuditLogActors, recordAuditLog } from '../services/audit-log-service'
import { getAdminDashboard } from '../services/admin-dashboard-service'
import { getCalendarSettings, updateCalendarSettings } from '../services/calendar-settings-service'
import { getOrganizationSettings, updateOrganizationSettings, OrganizationSettingsError } from '../services/organization-settings-service'
import { assertManagerAssignable, OrganizationError } from '../services/organization-service'

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(RECOGNITION_CATEGORY_NAME_MAX_LENGTH),
  description: z.string().optional(),
  order: z.number().int().min(0).max(999).optional(),
})
const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(RECOGNITION_CATEGORY_NAME_MAX_LENGTH).optional(),
  description: z.string().nullable().optional(),
  order: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
})
const periodWindowSchema = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
})
const schedulePeriodSchema = periodWindowSchema.extend({
  monthRef: z.string().regex(/^\d{4}-\d{2}$/),
  sectorId: z.string().min(1).optional(),
})
const auditLogQuerySchema = z.object({
  actorId: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
})
const calendarSettingsSchema = z.object({
  google: z.object({ clientId: z.string().optional(), clientSecret: z.string().optional() }).optional(),
  microsoft: z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      tenantId: z.string().optional(),
    })
    .optional(),
})

/** Valida a janela [startsAt, endsAt]; retorna a mensagem de erro ou null. */
function windowError(startsAt: Date, endsAt: Date, now = new Date()): string | null {
  if (endsAt <= startsAt) return 'A data de fim deve ser depois do início.'
  if (endsAt <= now) return 'Não é possível agendar um período no passado.'
  return null
}
// URL do fluxo Power Automate (DM no Teams). String vazia é normalizada para null no handler.
const teamsWebhookUrlSchema = z.union([z.string().url(), z.literal('')]).nullable().optional()
// Data de nascimento (YYYY-MM-DD do input type="date"). String vazia => null (limpa o campo).
const birthDateSchema = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable()).optional()
const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  position: z.string().optional(),
  squad: z.string().optional(),
  // Data de entrada no time (pode ser anterior ao cadastro na plataforma).
  joinedAt: z.coerce.date().optional(),
  birthDate: birthDateSchema,
  role: z.enum(USER_ROLES).optional(),
  area: z.enum(AREAS).nullable().optional(),
  teamsWebhookUrl: teamsWebhookUrlSchema,
  sectorId: z.string().min(1).optional(),
  managerId: z.string().min(1).nullable().optional(),
  /**
   * Foto de cadastro da pessoa — é ela que identifica o colaborador em toda a
   * plataforma (o personagem LPC vale só no Escritório Virtual). Chega como URL
   * já hospedada: o upload em si passa por `/uploads/images/presign`, então
   * nenhum binário trafega por esta rota.
   */
  photoUrl: z.string().url().nullable().optional(),
})
const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  // Quando informada, redefine a senha do colaborador (mín. 8 caracteres).
  password: z.string().min(8).optional(),
  position: z.string().optional(),
  squad: z.string().optional(),
  active: z.boolean().optional(),
  joinedAt: z.coerce.date().optional(),
  // Data de saída do time. Setada => vira ex-lenda (entra no Hall da Fama); null => readmitida.
  leftAt: z.coerce.date().nullable().optional(),
  birthDate: birthDateSchema,
  role: z.enum(USER_ROLES).optional(),
  /**
   * Acesso administrativo delegado. Só o ADMIN por papel concede ou revoga, e
   * só sobre papel de colaborador — a rota valida as duas coisas.
   */
  adminAccess: z.boolean().optional(),
  area: z.enum(AREAS).nullable().optional(),
  teamsWebhookUrl: teamsWebhookUrlSchema,
  enabledFeatures: z.array(z.enum(FEATURE_KEYS)).optional(),
  sectorId: z.string().min(1).optional(),
  managerId: z.string().min(1).nullable().optional(),
  /**
   * Foto de cadastro da pessoa — é ela que identifica o colaborador em toda a
   * plataforma (o personagem LPC vale só no Escritório Virtual). Chega como URL
   * já hospedada: o upload em si passa por `/uploads/images/presign`, então
   * nenhum binário trafega por esta rota.
   */
  photoUrl: z.string().url().nullable().optional(),
})
// Tipos de selo que o admin pode criar/editar. HIGHLIGHT fica de fora de propósito
// (é gerido pelo sistema, no Destaque do Mês). Manter em sincronia com BADGE_KINDS.
const badgeKindSchema = z.enum(['CATEGORY', 'RECURRENCE', 'IMPACT', 'FEEDBACK', 'TENURE', 'STREAK'])
const highlightTextSchema = z.object({
  text: z.string().min(1).max(600),
  highlightMonthRef: z.string().regex(/^\d{4}-\d{2}$/).optional(),
})
const createBadgeSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  kind: badgeKindSchema,
  iconKey: z.string().min(1),
  threshold: z.number().int().min(0).optional(),
  categorySlug: z.string().nullable().optional(),
  global: z.boolean().optional(),
  sectorIds: z.array(z.string().min(1)).optional(),
})
const updateBadgeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  kind: badgeKindSchema.optional(),
  iconKey: z.string().min(1).optional(),
  threshold: z.number().int().min(0).optional(),
  categorySlug: z.string().nullable().optional(),
  global: z.boolean().optional(),
  sectorIds: z.array(z.string().min(1)).optional(),
})
const grantBadgeSchema = z.object({ badgeId: z.string().min(1) })
const createSquadSchema = z.object({ name: z.string().min(1), sectorId: z.string().min(1).optional() })
const updateSquadSchema = z.object({ name: z.string().min(1).optional(), active: z.boolean().optional(), leaderId: z.string().nullable().optional(), sectorId: z.string().min(1).optional() })
const addSquadMemberSchema = z.object({ userId: z.string().min(1) })
const createSectorSchema = z.object({
  name: z.string().min(1),
  enabledFeatures: z.array(z.enum(FEATURE_KEYS)).default([]),
  roles: z.array(z.enum(USER_ROLES)).default([]),
})
const updateSectorSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  responsibleId: z.string().min(1).nullable().optional(),
  enabledFeatures: z.array(z.enum(FEATURE_KEYS)).optional(),
  roles: z.array(z.enum(USER_ROLES)).optional(),
})
const updateOrganizationSettingsSchema = z.object({
  companyResponsibleIds: z.array(z.string().min(1)).max(20),
})
const updateRetroRoomSchema = z.object({
  sprint: z.number().int().min(MIN_SPRINT).max(MAX_SPRINT).optional(),
  squadIds: z.array(z.string()).min(1).max(50).optional(),
  votesPerParticipant: z.number().int().min(MIN_VOTES_PER_PARTICIPANT).max(MAX_VOTES_PER_PARTICIPANT).optional(),
})
const calendarEventTypeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(40).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
    .optional(),
})

const developmentThursdaySettingsSchema = z.object({
  teamsWebhookUrl: teamsWebhookUrlSchema,
})
const officeSettingsSchema = z.object({ broadcastEnabled: z.boolean() })
const MANAGEMENT_ROLES = new Set(['ADMIN', 'SUBADMIN'])

export async function adminRoutes(app: FastifyInstance) {
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }
  const adminOrSubadmin = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }
  /**
   * Bloco de Desenvolvimento de Produto: ADMIN global, ou SUBADMIN do setor com
   * a feature `desenvolvimento-produto`. Vale para a **administração** de
   * Retrospectivas e Quinta de Dev — a participação do colaborador continua nas
   * features `retrospectivas` e `quinta-desenvolvimento`.
   */
  const produtoAdmin = { onRequest: [app.authenticate, app.requireSectorFeature('desenvolvimento-produto')] }

  /** Bloco de Gente e Gestão: ADMIN global, ou SUBADMIN do setor com a feature. */
  const genteAdmin = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }


  /**
   * Catálogo de categorias da empresa — o mesmo para o feedback e para a
   * votação desde a unificação
   * (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`). Eram
   * duas telas com a mesma cara e listas diferentes.
   */
  app.get('/admin/categories', adminOrSubadmin, async (request, reply) => {
    const categories = await listCategories(request.user.companyId)
    return reply.send({ categories: categories.map(toRecognitionCategoryDTO) })
  })

  app.post('/admin/categories', adminOrSubadmin, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    try {
      const category = await createCategory({
        name: parsed.data.name,
        description: parsed.data.description,
        order: parsed.data.order,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.code(201).send({ category: toRecognitionCategoryDTO(category) })
    } catch (err) {
      if (err instanceof CategoryError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  // PATCH e não DELETE: categoria é **desativada**, nunca apagada — apagar
  // levaria junto os chips dos feedbacks já escritos e as categorias dos votos
  // já apurados.
  app.patch('/admin/categories/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    try {
      const category = await updateCategory({
        id,
        ...parsed.data,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.send({ category: toRecognitionCategoryDTO(category) })
    } catch (err) {
      if (err instanceof CategoryError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/squads', adminOrSubadmin, async (request, reply) => {
    const squads = await listSquads(request.user.companyId)
    const scoped = request.user.role === 'SUBADMIN' ? squads.filter((s) => s.sectorId === request.user.sectorId) : squads
    return reply.send({ squads: scoped.map(toSquadWithMembersDTO) })
  })

  app.get('/admin/development-thursday/settings', produtoAdmin, async (request, reply) => {
    return reply.send({ settings: await getDevelopmentThursdaySettings(request.user.companyId) })
  })

  app.patch('/admin/development-thursday/settings', produtoAdmin, async (request, reply) => {
    const parsed = developmentThursdaySettingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    const settings = await updateDevelopmentThursdaySettings({
      teamsWebhookUrl: parsed.data.teamsWebhookUrl ?? null,
      actorId: request.user.sub,
      companyId: request.user.companyId,
    })
    return reply.send({ settings })
  })

  app.get('/admin/office-settings', adminOnly, async (request) => {
    return getOfficeSettings(request.user.companyId)
  })

  app.patch('/admin/office-settings', adminOnly, async (request, reply) => {
    const parsed = officeSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    return setBroadcastEnabled(parsed.data.broadcastEnabled, request.user.sub, request.user.companyId)
  })

  app.post('/admin/squads', adminOrSubadmin, async (request, reply) => {
    const parsed = createSquadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    // ADMIN sem sectorId explícito: mesma regra de POST /admin/periods — mantém o
    // comportamento histórico só pra empresa default, exige escolha pras demais.
    const input =
      request.user.role === 'SUBADMIN'
        ? { ...parsed.data, sectorId: request.user.sectorId }
        : { ...parsed.data, sectorId: parsed.data.sectorId ?? (request.user.companyId === DEFAULT_COMPANY_ID ? DEFAULT_SECTOR_ID : undefined) }
    try {
      const squad = await createSquad(input, request.user.sub, request.user.companyId)
      return reply.code(201).send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/squads/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSquadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
      if (parsed.data.sectorId !== undefined && parsed.data.sectorId !== request.user.sectorId) {
        return reply.code(400).send({ message: 'Subadmin não pode mover uma squad para outro setor.' })
      }
    }
    try {
      const squad = await updateSquad(id, parsed.data, request.user.sub, request.user.companyId)
      return reply.send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/squads/:id/members', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = addSquadMemberSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
    }
    try {
      const squad = await addMember(id, parsed.data.userId, request.user.sub, request.user.companyId)
      return reply.code(201).send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/squads/:id/members/:userId', adminOrSubadmin, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string }
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
    }
    await removeMember(id, userId, request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })

  app.get('/admin/dashboard', adminOrSubadmin, async (request, reply) => {
    const sectorId = request.user.role === 'SUBADMIN' ? request.user.sectorId : undefined
    return reply.send(await getAdminDashboard(new Date(), request.user.companyId, sectorId))
  })

  app.get('/admin/sectors', adminOrSubadmin, async (request, reply) => {
    const sectors = await listSectors(request.user.companyId)
    return reply.send({ sectors: sectors.map(toSectorDTO) })
  })

  app.get('/admin/organization-settings', adminOnly, async (request, reply) => {
    return reply.send({ settings: await getOrganizationSettings(request.user.companyId) })
  })

  app.patch('/admin/organization-settings', adminOnly, async (request, reply) => {
    const parsed = updateOrganizationSettingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    try {
      const settings = await updateOrganizationSettings(
        parsed.data.companyResponsibleIds,
        request.user.sub,
        request.user.companyId,
      )
      return reply.send({ settings })
    } catch (err) {
      if (err instanceof OrganizationSettingsError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/sectors', adminOnly, async (request, reply) => {
    const parsed = createSectorSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    try {
      const sector = await createSector(parsed.data, request.user.sub, request.user.companyId)
      return reply.code(201).send({ sector: toSectorDTO(sector) })
    } catch (err) {
      if (err instanceof SectorError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/sectors/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSectorSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    try {
      const sector = await updateSector(id, parsed.data, request.user.sub, request.user.companyId)
      return reply.send({ sector: toSectorDTO(sector) })
    } catch (err) {
      if (err instanceof SectorError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/users', adminOrSubadmin, async (request, reply) => {
    // Só desenvolvedores: admins e terceirizados não são gerenciados como colaboradores.
    const isSubadmin = request.user.role === 'SUBADMIN'
    const users = await scopedPrisma(request.user.companyId).user.findMany({
      where: {
        role: { notIn: ['ADMIN', 'SUBADMIN', 'THIRD_PARTY'] },
        ...(isSubadmin ? { sectorId: request.user.sectorId } : {}),
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map(toAdminUser) })
  })

  // Quem tem poder aqui, numa tela só: as contas de administração e as que
  // receberam acesso delegado. Sem a segunda metade, responder "quem administra
  // esta empresa?" exigiria abrir a ficha de cada colaborador.
  app.get('/admin/administrators', adminOnly, async (request, reply) => {
    const users = await scopedPrisma(request.user.companyId).user.findMany({
      where: { OR: [{ role: { in: ['ADMIN', 'SUBADMIN'] } }, { adminAccess: true }] },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map(toAdminUser) })
  })

  app.get('/admin/third-party-users', adminOrSubadmin, async (request, reply) => {
    const users = await scopedPrisma(request.user.companyId).user.findMany({
      where: { role: 'THIRD_PARTY', ...(request.user.role === 'SUBADMIN' ? { sectorId: request.user.sectorId } : {}) },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map(toAdminUser) })
  })

  app.post('/admin/users', adminOrSubadmin, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const isSubadmin = request.user.role === 'SUBADMIN'
    if (isSubadmin && (parsed.data.role === 'ADMIN' || parsed.data.role === 'SUBADMIN')) {
      return reply.code(400).send({ message: 'Subadmin não pode criar contas Admin ou Subadmin.' })
    }
    // Mesma regra do PATCH: acesso delegado usa o painel, mas não cria conta de
    // administração (ver `PATCH /admin/users/:id`).
    if (!isSubadmin && request.user.role !== 'ADMIN' && (parsed.data.role === 'ADMIN' || parsed.data.role === 'SUBADMIN')) {
      return reply.code(403).send({ message: 'Apenas um administrador cria contas Admin ou Subadmin.' })
    }
    let sectorId: string
    if (isSubadmin) {
      sectorId = request.user.sectorId
    } else {
      if (!parsed.data.sectorId) {
        return reply.code(400).send({ message: 'Especifique o setor.' })
      }
      sectorId = parsed.data.sectorId
    }
    const effectiveRole = parsed.data.role ?? 'LEGEND'
    const sector = await scopedPrisma(request.user.companyId).sector.findUnique({ where: { id: sectorId }, include: { roles: true } })
    if (!sector) return reply.code(400).send({ message: 'Setor inválido.' })
    if (!MANAGEMENT_ROLES.has(effectiveRole) && !sector.roles.some((r) => r.role === effectiveRole)) {
      return reply.code(400).send({ message: 'Esse papel não está habilitado para o setor selecionado.' })
    }
    try {
      await assertManagerAssignable(request.user.companyId, null, parsed.data.managerId ?? null)
      const passwordHash = await hashPassword(parsed.data.password)
      const user = await prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          position: parsed.data.position,
          squad: parsed.data.squad,
          joinedAt: parsed.data.joinedAt,
          birthDate: parsed.data.birthDate,
          role: parsed.data.role,
          area: parsed.data.area,
          teamsWebhookUrl: parsed.data.teamsWebhookUrl || null,
          photoUrl: parsed.data.photoUrl ?? null,
          managerId: parsed.data.managerId ?? null,
          sectorId,
          companyId: request.user.companyId,
        },
      })
      const { passwordHash: _omit, ...safeUser } = user
      await recordAuditLog({ actorId: request.user.sub, entityType: 'User', entityId: user.id, action: 'CREATE', after: safeUser, companyId: request.user.companyId })
      return reply.code(201).send({ user: toAdminUser(user) })
    } catch (err) {
      if (err instanceof OrganizationError) return reply.code(err.status).send({ message: err.message })
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'E-mail já cadastrado.' })
      }
      throw err
    }
  })

  app.patch('/admin/users/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const isSubadmin = request.user.role === 'SUBADMIN'
    // Quem chega aqui sem ser ADMIN nem SUBADMIN entrou pelo acesso delegado —
    // a rota é guardada por `requireAdminOrSubadmin`.
    const isDelegatedAdmin = !isSubadmin && request.user.role !== 'ADMIN'
    // Um admin não pode remover o próprio papel de administrador (evita se trancar pra fora).
    if (request.user.role === 'ADMIN' && parsed.data.role && parsed.data.role !== 'ADMIN' && id === request.user.sub) {
      return reply.code(400).send({ message: 'Você não pode remover seu próprio papel de administrador.' })
    }
    if (isSubadmin && (parsed.data.role === 'ADMIN' || parsed.data.role === 'SUBADMIN')) {
      return reply.code(400).send({ message: 'Subadmin não pode promover para Admin ou Subadmin.' })
    }
    if (isSubadmin && parsed.data.sectorId !== undefined && parsed.data.sectorId !== request.user.sectorId) {
      return reply.code(400).send({ message: 'Subadmin não pode mover um colaborador para outro setor.' })
    }
    // Só o ADMIN por papel distribui acesso administrativo. Quem entrou pelo
    // acesso delegado usa o painel inteiro, mas não passa o poder adiante:
    // senão o privilégio se propagaria sozinho e a lista de quem administra
    // deixaria de ter dono.
    if (parsed.data.adminAccess !== undefined && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ message: 'Apenas um administrador concede acesso administrativo.' })
    }
    // Promover a Admin/Subadmin distribui o mesmo poder por outra porta. Sem
    // esta linha, quem tem acesso delegado contornaria a regra acima simplesmente
    // promovendo a si mesmo a ADMIN.
    if (isDelegatedAdmin && (parsed.data.role === 'ADMIN' || parsed.data.role === 'SUBADMIN')) {
      return reply.code(403).send({ message: 'Apenas um administrador promove para Admin ou Subadmin.' })
    }
    const existing = await scopedPrisma(request.user.companyId).user.findUnique({ where: { id } })
    if (!existing) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    if (isSubadmin && (existing.sectorId !== request.user.sectorId || existing.role === 'ADMIN' || existing.role === 'SUBADMIN')) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    const effectiveRole = parsed.data.role ?? existing.role
    if (parsed.data.role !== undefined || parsed.data.sectorId !== undefined) {
      const effectiveSectorId = parsed.data.sectorId ?? existing.sectorId
      const sector = await scopedPrisma(request.user.companyId).sector.findUnique({ where: { id: effectiveSectorId }, include: { roles: true } })
      if (!sector) return reply.code(400).send({ message: 'Setor inválido.' })
      if (!MANAGEMENT_ROLES.has(effectiveRole) && !sector.roles.some((r) => r.role === effectiveRole)) {
        return reply.code(400).send({ message: 'Esse papel não está habilitado para o setor selecionado.' })
      }
    }
    if (parsed.data.enabledFeatures !== undefined && effectiveRole !== 'THIRD_PARTY') {
      return reply.code(400).send({ message: 'enabledFeatures só é válido para o papel Terceirizado.' })
    }
    if (parsed.data.adminAccess === true && !canReceiveAdminAccess(effectiveRole)) {
      return reply
        .code(400)
        .send({ message: 'Acesso administrativo só pode ser concedido a Lenda, Líder, Gerente ou Head.' })
    }
    if (parsed.data.managerId !== undefined) {
      try {
        await assertManagerAssignable(request.user.companyId, id, parsed.data.managerId)
      } catch (err) {
        if (err instanceof OrganizationError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    }
    // A senha vai como hash; o campo em texto puro nunca é persistido.
    const { password, ...rest } = parsed.data
    if (rest.teamsWebhookUrl === '') rest.teamsWebhookUrl = null
    // Papel que sai da lista elegível derruba o acesso delegado junto: um flag
    // pendurado numa conta que não pode mais recebê-lo é privilégio invisível
    // esperando a próxima promoção.
    if (existing.adminAccess && !canReceiveAdminAccess(effectiveRole)) rest.adminAccess = false
    const data = password ? { ...rest, passwordHash: await hashPassword(password) } : rest
    try {
      const user = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data })
        if (!updated.active || updated.leftAt) {
          await tx.squadMember.deleteMany({ where: { userId: id } })
          await tx.squad.updateMany({ where: { leaderId: id }, data: { leaderId: null } })
        }
        const canRemainResponsible =
          updated.active
          && !updated.leftAt
          && (updated.role === 'HEAD' || updated.role === 'MANAGER' || updated.role === 'LEAD' || updated.role === 'LEGEND')
        if (!canRemainResponsible) {
          await tx.$executeRaw`
            DELETE FROM "CompanyResponsible"
            WHERE "companyId" = ${request.user.companyId} AND "userId" = ${id}
          `
          await tx.$executeRaw`
            UPDATE "Sector"
            SET "responsibleId" = NULL, "updatedAt" = NOW()
            WHERE "companyId" = ${request.user.companyId} AND "responsibleId" = ${id}
          `
        } else if (updated.sectorId !== existing.sectorId) {
          await tx.$executeRaw`
            UPDATE "Sector"
            SET "responsibleId" = NULL, "updatedAt" = NOW()
            WHERE "companyId" = ${request.user.companyId}
              AND "responsibleId" = ${id}
              AND "id" <> ${updated.sectorId}
          `
        }
        const { passwordHash: _b, ...safeBefore } = existing
        const { passwordHash: _a, ...safeAfter } = updated
        await recordAuditLog({ actorId: request.user.sub, entityType: 'User', entityId: id, action: 'UPDATE', before: safeBefore, after: safeAfter, companyId: request.user.companyId, tx })
        return updated
      })
      return reply.send({ user: toAdminUser(user) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.code(404).send({ message: 'Usuário não encontrado' })
        if (err.code === 'P2002') return reply.code(409).send({ message: 'E-mail já cadastrado.' })
      }
      throw err
    }
  })

  app.get('/admin/periods', adminOrSubadmin, async (request, reply) => {
    const { sectorId: queryScope } = request.query as { sectorId?: string }
    const sectorId = request.user.role === 'SUBADMIN' ? request.user.sectorId : queryScope
    const periods = await scopedPrisma(request.user.companyId).votingPeriod.findMany({
      where: sectorId ? { sectorId } : undefined,
      orderBy: { startsAt: 'desc' },
    })
    return reply.send({ periods: periods.map((p) => toPeriodDTO(p)) })
  })

  app.post('/admin/periods', adminOrSubadmin, async (request, reply) => {
    const parsed = schedulePeriodSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos (use monthRef YYYY-MM, startsAt e endsAt)' })
    }
    const { monthRef, startsAt, endsAt } = parsed.data
    // ADMIN sem sectorId explícito: mantém o comportamento histórico só pra empresa default
    // (setor "sector-dev-produto"), que é a companyId do próprio DEFAULT_SECTOR_ID — pra
    // qualquer outra empresa não há um setor "padrão" seguro pra assumir, então exige a escolha.
    const sectorId =
      request.user.role === 'SUBADMIN'
        ? request.user.sectorId
        : (parsed.data.sectorId ?? (request.user.companyId === DEFAULT_COMPANY_ID ? DEFAULT_SECTOR_ID : undefined))
    if (!sectorId) {
      return reply.code(400).send({ message: 'Informe o setor do período.' })
    }
    const invalid = windowError(startsAt, endsAt)
    if (invalid) return reply.code(400).send({ message: invalid })
    try {
      const period = await scheduleVotingPeriod({ sectorId, monthRef, startsAt, endsAt }, request.user.sub, request.user.companyId)
      try {
        await notifyPeriodOpened({ monthRef: period.monthRef, sectorId: period.sectorId, companyId: period.companyId })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.code(201).send({ period: toPeriodDTO(period) })
    } catch (err) {
      if (err instanceof AdminServiceError) return reply.code(err.status).send({ message: err.message })
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe um período para esse mês neste setor.' })
      }
      throw err
    }
  })

  app.patch('/admin/periods/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = periodWindowSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos (use startsAt e endsAt)' })
    }
    const existing = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ message: 'Período não encontrado' })
    if (request.user.role === 'SUBADMIN' && existing.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Período não encontrado' })
    }
    // Só mês atual ou futuro pode ser editado; meses passados são imutáveis.
    if (!isPeriodEditable(existing.monthRef, new Date())) {
      return reply.code(409).send({ message: 'Não é possível editar um período de um mês que já passou.' })
    }
    const { startsAt, endsAt } = parsed.data
    const invalid = windowError(startsAt, endsAt)
    if (invalid) return reply.code(400).send({ message: invalid })
    const period = await updateVotingPeriod(id, { startsAt, endsAt }, request.user.sub, request.user.companyId)
    return reply.send({ period: toPeriodDTO(period) })
  })

  app.post('/admin/periods/:id/close', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await closeVotingPeriod(id, request.user.sub, request.user.companyId)
      try {
        await notifyPeriodClosed({ monthRef: period.monthRef, sectorId: period.sectorId, companyId: period.companyId })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.send({ period: toPeriodDTO(period) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
      throw err
    }
  })

  function sendHighlightError(reply: FastifyReply, err: unknown) {
    if (err instanceof HighlightError) return reply.code(err.status).send({ message: err.message })
    throw err
  }

  app.get('/admin/periods/:id/highlight', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
    if (!period) return reply.code(404).send({ message: 'Período não encontrado' })
    if (request.user.role === 'SUBADMIN' && period.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Período não encontrado' })
    }
    const winner = period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null
    return reply.send({ highlight: toHighlightDTO({ period, winner }) })
  })

  app.post('/admin/periods/:id/highlight', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await generateHighlightDraft(id, request.user.sub, request.user.companyId)
      return reply.code(201).send({ highlight: toHighlightDTO({ period, winner: period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null }) })
    } catch (err) {
      return sendHighlightError(reply, err)
    }
  })

  app.patch('/admin/periods/:id/highlight', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    const parsed = highlightTextSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Texto inválido (1 a 600 caracteres).' })
    try {
      const period = await updateHighlightText(id, parsed.data.text, request.user.sub, request.user.companyId, parsed.data.highlightMonthRef)
      return reply.send({ highlight: toHighlightDTO({ period, winner: period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null }) })
    } catch (err) {
      return sendHighlightError(reply, err)
    }
  })

  app.post('/admin/periods/:id/highlight/image', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await generateHighlightImage(id, request.user.sub, request.user.companyId)
      return reply.send({ highlight: toHighlightDTO({ period, winner: period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null }) })
    } catch (err) {
      return sendHighlightError(reply, err)
    }
  })

  app.post('/admin/periods/:id/highlight/publish', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await publishHighlight(id, request.user.sub, request.user.companyId)
      return reply.send({ highlight: toHighlightDTO({ period, winner: period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null }) })
    } catch (err) {
      return sendHighlightError(reply, err)
    }
  })

  app.get('/admin/highlights', adminOnly, async (request, reply) => {
    const entries = await listPublishedHighlights(request.user.companyId)
    return reply.send({ highlights: entries.map(toHighlightDTO) })
  })

  app.get('/admin/votes', adminOrSubadmin, async (request, reply) => {
    const votes = await scopedPrisma(request.user.companyId).vote.findMany({
      include: voteInclude,
      where: request.user.role === 'SUBADMIN' ? { period: { sectorId: request.user.sectorId } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return reply.send({ votes: votes.map(toVoteDTO) })
  })

  app.delete('/admin/votes/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const before = await scopedPrisma(request.user.companyId).vote.findUnique({ where: { id }, include: { period: true } })
    if (!before) return reply.code(404).send({ message: 'Voto não encontrado' })
    if (request.user.role === 'SUBADMIN' && before.period.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Voto não encontrado' })
    }
    try {
      await scopedPrisma(request.user.companyId).vote.delete({ where: { id } })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Vote', entityId: id, action: 'DELETE', before, companyId: request.user.companyId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Voto não encontrado' })
      }
      throw err
    }
  })

  app.get('/admin/badges', adminOrSubadmin, async (request, reply) => {
    const badges = await listBadgesAdmin(
      request.user.companyId,
      request.user.role === 'SUBADMIN' ? { sectorId: request.user.sectorId } : undefined,
    )
    return reply.send({ badges: badges.map(toBadgeDTO) })
  })

  app.post('/admin/badges', adminOrSubadmin, async (request, reply) => {
    const parsed = createBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const isSubadmin = request.user.role === 'SUBADMIN'
    const global = isSubadmin ? false : (parsed.data.global ?? true)
    const sectorIds = isSubadmin ? [request.user.sectorId] : global ? [] : (parsed.data.sectorIds ?? [])
    try {
      const badge = await createBadgeAdmin(
        {
          name: parsed.data.name,
          description: parsed.data.description,
          kind: parsed.data.kind,
          iconKey: parsed.data.iconKey,
          threshold: parsed.data.threshold,
          categorySlug: parsed.data.categorySlug,
          global,
          sectorIds,
        },
        request.user.sub,
        request.user.companyId,
      )
      return reply.code(201).send({ badge: toBadgeDTO(badge) })
    } catch (err) {
      if (err instanceof BadgeAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/badges/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const before = await getBadgeAdmin(id, request.user.companyId)
    if (!before) return reply.code(404).send({ message: 'Selo não encontrado' })
    if (request.user.role === 'SUBADMIN') {
      const ownSectorOnly = !before.global && before.sectors.length === 1 && before.sectors[0].sectorId === request.user.sectorId
      if (!ownSectorOnly) {
        const visibleToSubadmin = before.global || before.sectors.some((s) => s.sectorId === request.user.sectorId)
        if (!visibleToSubadmin) {
          return reply.code(404).send({ message: 'Selo não encontrado' })
        }
        return reply.code(403).send({ message: 'Você só pode editar selos exclusivos do seu setor.' })
      }
    }
    try {
      const badge = await updateBadgeAdmin(id, parsed.data, request.user.sub, request.user.companyId)
      return reply.send({ badge: toBadgeDTO(badge) })
    } catch (err) {
      if (err instanceof BadgeAdminError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/badges/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = scopedPrisma(request.user.companyId)
    const before = await db.badge.findUnique({ where: { id } })
    if (!before) return reply.code(404).send({ message: 'Selo não encontrado' })
    try {
      // UserBadge não tem cascade: remove as concessões antes do selo.
      await db.$transaction(async (tx) => {
        await tx.userBadge.deleteMany({ where: { badgeId: id } })
        await tx.badge.delete({ where: { id } })
        // `tx` é o client estendido por `scopedPrisma`, mas `recordAuditLog` passa `companyId`
        // explícito no `data` do create — o cast só reconcilia com a assinatura de
        // `recordAuditLog` (`Prisma.TransactionClient`).
        await recordAuditLog({ actorId: request.user.sub, entityType: 'Badge', entityId: id, action: 'DELETE', before, companyId: request.user.companyId, tx: tx as unknown as Prisma.TransactionClient })
      })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Selo não encontrado' })
      }
      throw err
    }
  })

  app.get('/admin/users/:userId/badges', adminOnly, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const user = await findUserInCompany(request.user.companyId, userId)
    if (!user) return reply.code(404).send({ message: 'Usuário não encontrado' })
    const awarded = await listBadgesForUser(userId)
    return reply.send({ badges: awarded.map(toAwardedBadgeDTO) })
  })

  app.post('/admin/users/:userId/badges', adminOnly, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const parsed = grantBadgeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    const [user, badge] = await Promise.all([
      findUserInCompany(request.user.companyId, userId),
      prisma.badge.findUnique({ where: { id: parsed.data.badgeId } }),
    ])
    if (!user) return reply.code(404).send({ message: 'Usuário não encontrado' })
    if (!badge) return reply.code(404).send({ message: 'Selo não encontrado' })
    try {
      const awarded = await grantBadgeManually(userId, parsed.data.badgeId, request.user.sub)
      try {
        await notifyBadgesEarned(userId, [awarded.badgeId], request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.code(201).send({ badge: toAwardedBadgeDTO(awarded) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Este membro já possui esse selo.' })
      }
      throw err
    }
  })

  app.delete('/admin/users/:userId/badges/:userBadgeId', adminOnly, async (request, reply) => {
    const { userId, userBadgeId } = request.params as { userId: string; userBadgeId: string }
    try {
      await revokeManualBadge(userId, userBadgeId, request.user.sub, request.user.companyId)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof BadgeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/audit-log/actors', adminOnly, async (request, reply) => {
    const actors = await listAuditLogActors(request.user.companyId)
    return reply.send({ actors })
  })

  app.get('/admin/audit-log', adminOnly, async (request, reply) => {
    const parsed = auditLogQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    const { entries, total } = await listAuditLog(parsed.data, request.user.companyId)
    return reply.send({
      entries: entries.map(toAuditLogEntryDTO),
      total,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    })
  })

  app.get('/admin/retro/rooms', produtoAdmin, async (request, reply) => {
    const rooms = await listRoomsForAdmin(request.user.companyId)
    // admin não participa: papel OBSERVER apenas para satisfazer o DTO.
    return reply.send({ rooms: rooms.map((room) => toRetroRoomSummaryDTO(room, 'OBSERVER')) })
  })

  app.patch('/admin/retro/rooms/:id', produtoAdmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateRetroRoomSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    try {
      const room = await updateRoomAsAdmin({ roomId: id, actorId: request.user.sub, companyId: request.user.companyId, ...parsed.data })
      return reply.send({ room: toRetroRoomSummaryDTO(room, 'OBSERVER') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/retro/rooms/:id', produtoAdmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await hardDeleteRoom({ roomId: id, actorId: request.user.sub, companyId: request.user.companyId })
      retroHub.broadcast(id, () => ({ type: 'room.deleted' }))
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Catálogo de TIPOS de evento — continua restrito ao bloco de Desenvolvimento
   * de Produto, mesmo depois de a liderança ter ganhado o direito de cadastrar
   * eventos (ver `/calendar/events` em routes/calendar.ts). Tipo é taxonomia da
   * empresa e vira chip fixo na barra de filtros do calendário de todo mundo:
   * liberar isso para cada líder faria a barra crescer sem dono.
   */
  app.get('/admin/calendar-event-types', produtoAdmin, async (request, reply) => {
    return reply.send({ types: await listEventTypes(request.user.companyId) })
  })

  app.post('/admin/calendar-event-types', produtoAdmin, async (request, reply) => {
    const parsed = calendarEventTypeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    try {
      const type = await createEventType({
        data: parsed.data,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.code(201).send({ type })
    } catch (err) {
      if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/calendar-event-types/:id', produtoAdmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = calendarEventTypeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    try {
      const type = await updateEventType({
        id,
        data: parsed.data,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.send({ type })
    } catch (err) {
      if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/calendar-event-types/:id', produtoAdmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteEventType({ id, actorId: request.user.sub, companyId: request.user.companyId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CalendarEventError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/calendar-settings', adminOnly, async (request, reply) => {
    return reply.send(await getCalendarSettings(request.user.companyId))
  })

  app.put('/admin/calendar-settings', adminOnly, async (request, reply) => {
    const parsed = calendarSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const settings = await updateCalendarSettings({
      companyId: request.user.companyId,
      actorId: request.user.sub,
      body: parsed.data,
    })
    return reply.send(settings)
  })
}
