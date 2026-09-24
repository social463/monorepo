import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  CERTIFICATE_REJECTION_REASON_MAX_LENGTH,
  CERTIFICATE_REQUEST_STATUSES,
  CERTIFICATE_TEMPLATE_NAME_MAX_LENGTH,
  CERTIFICATE_TEMPLATE_TITLE_MAX_LENGTH,
} from '@legends/shared'
import {
  CertificateError,
  approveCertificateRequest,
  createCertificateTemplate,
  deleteCertificateTemplate,
  listCertificateRequests,
  listCertificateTemplates,
  rejectCertificateRequest,
  updateCertificateTemplate,
  type CertificateActor,
} from '../services/certificate-request-service'
import type { CourseActor } from '../services/course-admin-service'

/**
 * Modelos de certificado — CRUD restrito a ADMIN (`requireAdmin`, nunca
 * `requireAdminOrSubadmin`): modelo de certificado é documento da empresa
 * inteira, diferente da autoria de curso em `courses-admin.ts`. A fila de
 * aprovação (Task 9, abaixo) já segue o escopo do CURSO, então usa
 * `requireAdminOrSubadmin` — o mesmo gate de `courses-admin.ts`.
 */

function actorFrom(request: FastifyRequest): CertificateActor {
  return { id: request.user.sub, companyId: request.user.companyId }
}

/** Ator da fila: precisa de papel e setor — a aprovação/recusa segue o escopo do curso. */
function courseActorFrom(request: FastifyRequest): CourseActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

const idParamsSchema = z.object({ id: z.string().min(1) })
const statusQuerySchema = z.object({ status: z.enum(CERTIFICATE_REQUEST_STATUSES).optional() })
const rejectBodySchema = z.object({
  rejectionReason: z.string().trim().min(1).max(CERTIFICATE_REJECTION_REASON_MAX_LENGTH),
})

const templateBodySchema = z.object({
  name: z.string().trim().min(1).max(CERTIFICATE_TEMPLATE_NAME_MAX_LENGTH),
  title: z.string().trim().min(1).max(CERTIFICATE_TEMPLATE_TITLE_MAX_LENGTH),
  backgroundUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  // Cor de destaque interpolada direto num atributo SVG pelo renderer — restrita a hex
  // (o que um seletor de cor de admin produz), não texto livre. Vazia, herda a
  // cor institucional da empresa.
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-f]{3,8}$/i, 'Informe uma cor em hexadecimal (ex.: #2f8b4d).')
    .nullable()
    .optional()
    .or(z.literal('')),
  signatureName: z.string().trim().min(1).max(120),
  signatureRole: z.string().trim().min(1).max(120),
  signatureImageUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  logoUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  isDefault: z.boolean().optional(),
})
const updateTemplateSchema = templateBodySchema.partial()

/** `''` de campo opcional do formulário vira `null` no banco — mesmo padrão de `courses-admin.ts`. */
function emptyToNull<T extends Record<string, unknown>>(data: T): T {
  const entries = Object.entries(data).map(([key, value]) => [key, value === '' ? null : value])
  return Object.fromEntries(entries) as T
}

export async function adminCertificateRoutes(app: FastifyInstance) {
  const gate = { onRequest: [app.authenticate, app.requireAdmin] }

  function handle(reply: { code: (n: number) => { send: (body: unknown) => unknown } }, err: unknown): unknown {
    if (err instanceof CertificateError) return reply.code(err.status).send({ message: err.message })
    throw err
  }

  app.get('/admin/certificate-templates', gate, async (request, reply) => {
    return reply.send({ templates: await listCertificateTemplates(actorFrom(request)) })
  })

  app.post('/admin/certificate-templates', gate, async (request, reply) => {
    const body = templateBodySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: body.error.flatten() })
    try {
      const template = await createCertificateTemplate(actorFrom(request), emptyToNull(body.data))
      return reply.code(201).send({ template })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.patch('/admin/certificate-templates/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = updateTemplateSchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const template = await updateCertificateTemplate(actorFrom(request), params.data.id, emptyToNull(body.data))
      return reply.send({ template })
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.delete('/admin/certificate-templates/:id', gate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteCertificateTemplate(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handle(reply, err)
    }
  })

  // Fila de aprovação: segue o escopo do curso, então SUBADMIN também entra
  // (diferente do CRUD de modelo acima, que é só ADMIN).
  const queueGate = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/certificate-requests', queueGate, async (request, reply) => {
    const query = statusQuerySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const requests = await listCertificateRequests(courseActorFrom(request), query.data.status)
    return reply.send({ requests })
  })

  app.post('/admin/certificate-requests/:id/approve', queueGate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const result = await approveCertificateRequest(courseActorFrom(request), params.data.id)
      return reply.send(result)
    } catch (err) {
      return handle(reply, err)
    }
  })

  app.post('/admin/certificate-requests/:id/reject', queueGate, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const body = rejectBodySchema.safeParse(request.body)
    if (!params.success || !body.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: body.success ? undefined : body.error.flatten() })
    }
    try {
      const requestDTO = await rejectCertificateRequest(courseActorFrom(request), params.data.id, body.data.rejectionReason)
      return reply.send({ request: requestDTO })
    } catch (err) {
      return handle(reply, err)
    }
  })
}
