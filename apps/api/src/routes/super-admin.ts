import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { slugify } from '../lib/slug'
import { hashPassword } from '../lib/password'
import { toCompanyAdmin, toPublicUser } from '../lib/serialize'
import { revokeAllForUser } from '../services/refresh-token-service'
import { getAdoptionOverview } from '../services/analytics-dashboard-service'
import { provisionCategories } from '../services/category-service'
import { provisionXpRules } from '../services/xp-admin-service'
import { ADOPTION_WINDOWS, DEFAULT_ADOPTION_WINDOW } from '@legends/shared'

/** Janela fechada num conjunto conhecido — não é intervalo livre do cliente. */
const adoptionQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine((value): value is (typeof ADOPTION_WINDOWS)[number] => (ADOPTION_WINDOWS as readonly number[]).includes(value))
    .default(DEFAULT_ADOPTION_WINDOW),
})

const createCompanySchema = z.object({
  name: z.string().min(1),
  admin: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
  }),
})

const updateCompanySchema = z
  .object({
    name: z.string().min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.active !== undefined, { message: 'Informe ao menos um campo.' })

const createCompanyAdminSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
})

const updateCompanyAdminSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Informe ao menos um campo.' })

/**
 * ADMIN da empresa informada. Qualquer outro papel (ou admin de outra empresa)
 * devolve `null` e vira 404 — o super admin gerencia contas *por empresa*, e uma
 * resposta diferente vazaria a existência de um usuário de outro tenant.
 */
async function findCompanyAdmin(companyId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || user.companyId !== companyId || user.role !== 'ADMIN') return null
  return user
}

/**
 * Empresa sem nenhum ADMIN ativo fica sem quem administre — e só o super admin
 * conseguiria destravar. Vale para desativar e para remover.
 */
async function isLastActiveAdmin(companyId: string, userId: string): Promise<boolean> {
  const activeAdmins = await prisma.user.count({ where: { companyId, role: 'ADMIN', active: true } })
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { active: true } })
  return Boolean(target?.active) && activeAdmins <= 1
}

export async function superAdminRoutes(app: FastifyInstance) {
  const superAdminOnly = { onRequest: [app.authenticate, app.requireSuperAdmin] }

  app.get('/super-admin/companies', superAdminOnly, async (_request, reply) => {
    const companies = await prisma.company.findMany({ orderBy: { name: 'asc' } })
    return reply.send({ companies })
  })

  /** Adoção por empresa e por setor. Cross-tenant — só a equipe interna vê. */
  app.get('/super-admin/analytics', superAdminOnly, async (request, reply) => {
    const parsed = adoptionQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Janela inválida', issues: parsed.error.flatten() })
    }
    const overview = await getAdoptionOverview(parsed.data.days)
    return reply.send(overview)
  })

  app.post('/super-admin/companies', superAdminOnly, async (request, reply) => {
    const parsed = createCompanySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const passwordHash = await hashPassword(parsed.data.admin.password)
    const companySlug = slugify(parsed.data.name)
    try {
      const { company, admin } = await prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { name: parsed.data.name, slug: companySlug },
        })
        const sector = await tx.sector.create({
          data: { name: 'Geral', slug: `geral-${companySlug}`, enabledFeatures: ['escritorio', 'calendario'], companyId: company.id },
        })
        const admin = await tx.user.create({
          data: {
            name: parsed.data.admin.name,
            email: parsed.data.admin.email,
            passwordHash,
            role: 'ADMIN',
            sectorId: sector.id,
            companyId: company.id,
          },
        })
        // Empresa nova já nasce com o catálogo de competências do Mural: sem
        // nenhuma categoria o envio de reconhecimento não fecha.
        await provisionCategories(tx, company.id)
        // … e com as regras de pontos: sem nenhuma, `awardXp` devolve NO_RULE e
        // a empresa nasce com a gamificação desligada sem ter escolhido isso.
        await provisionXpRules(tx, company.id)
        return { company, admin }
      })
      return reply.code(201).send({ company, admin: toPublicUser(admin) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe uma empresa ou usuário com esses dados.' })
      }
      throw err
    }
  })

  app.patch('/super-admin/companies/:id', superAdminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateCompanySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const data: Prisma.CompanyUpdateInput = {}
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name
      data.slug = slugify(parsed.data.name)
    }
    if (parsed.data.active !== undefined) data.active = parsed.data.active
    try {
      const company = await prisma.company.update({ where: { id }, data })
      return reply.send({ company })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.code(404).send({ message: 'Empresa não encontrada.' })
        if (err.code === 'P2002') return reply.code(409).send({ message: 'Já existe uma empresa com esse nome.' })
      }
      throw err
    }
  })

  app.get('/super-admin/companies/:id/admins', superAdminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const company = await prisma.company.findUnique({ where: { id } })
    if (!company) return reply.code(404).send({ message: 'Empresa não encontrada.' })

    // Inclui os inativos: são o histórico de quem administrou a empresa e o
    // caminho de volta (reativar) quando a remoção foi engano.
    const admins = await prisma.user.findMany({
      where: { companyId: id, role: 'ADMIN' },
      orderBy: { name: 'asc' },
    })
    return reply.send({ admins: admins.map(toCompanyAdmin) })
  })

  app.post('/super-admin/companies/:id/admins', superAdminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = createCompanyAdminSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const company = await prisma.company.findUnique({ where: { id } })
    if (!company) return reply.code(404).send({ message: 'Empresa não encontrada.' })

    // Todo usuário nasce num setor. O admin novo entra no primeiro da empresa
    // (a criada pelo POST /companies chama-se "Geral"); o papel ADMIN atravessa
    // setor, então isso é só ancoragem, não restrição de acesso.
    const sector = await prisma.sector.findFirst({ where: { companyId: id }, orderBy: { name: 'asc' } })
    if (!sector) return reply.code(400).send({ message: 'A empresa não tem nenhum setor cadastrado.' })

    try {
      const admin = await prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash: await hashPassword(parsed.data.password),
          role: 'ADMIN',
          sectorId: sector.id,
          companyId: id,
        },
      })
      return reply.code(201).send({ admin: toCompanyAdmin(admin) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe um usuário com esse e-mail.' })
      }
      throw err
    }
  })

  app.patch('/super-admin/companies/:id/admins/:userId', superAdminOnly, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string }
    const parsed = updateCompanyAdminSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const existing = await findCompanyAdmin(id, userId)
    if (!existing) return reply.code(404).send({ message: 'Administrador não encontrado.' })

    if (parsed.data.active === false && (await isLastActiveAdmin(id, userId))) {
      return reply.code(409).send({ message: 'A empresa precisa de pelo menos um administrador ativo.' })
    }

    const { password, ...rest } = parsed.data
    const data = password ? { ...rest, passwordHash: await hashPassword(password) } : rest
    try {
      const admin = await prisma.user.update({ where: { id: userId }, data })
      // Senha trocada ou acesso desativado derrubam as sessões abertas: o access
      // token vive 15 min, mas o refresh continuaria renovando sem isso.
      if (password || parsed.data.active === false) await revokeAllForUser(userId)
      return reply.send({ admin: toCompanyAdmin(admin) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe um usuário com esse e-mail.' })
      }
      throw err
    }
  })

  /**
   * Remoção é desativação, não `DELETE` no banco: um ADMIN acumula votos,
   * feedbacks, auditoria e mais de uma dezena de FKs, e apagar a linha ou
   * derrubaria a request ou levaria junto o histórico da empresa. `PATCH` com
   * `active: true` é o desfazer.
   */
  app.delete('/super-admin/companies/:id/admins/:userId', superAdminOnly, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string }
    const existing = await findCompanyAdmin(id, userId)
    if (!existing) return reply.code(404).send({ message: 'Administrador não encontrado.' })

    if (await isLastActiveAdmin(id, userId)) {
      return reply.code(409).send({ message: 'A empresa precisa de pelo menos um administrador ativo.' })
    }

    await prisma.user.update({ where: { id: userId }, data: { active: false } })
    await revokeAllForUser(userId)
    return reply.code(204).send()
  })

  app.get('/super-admin/companies/:id/dashboard', superAdminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const company = await prisma.company.findUnique({ where: { id } })
    if (!company) return reply.code(404).send({ message: 'Empresa não encontrada.' })

    const sectors = await prisma.sector.findMany({
      where: { companyId: id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { users: { where: { active: true } } } } },
    })
    const totalUsers = sectors.reduce((sum, s) => sum + s._count.users, 0)

    return reply.send({
      company,
      totalUsers,
      sectorBreakdown: sectors.map((s) => ({ sectorId: s.id, sectorName: s.name, userCount: s._count.users })),
    })
  })
}
