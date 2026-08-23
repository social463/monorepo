import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  CULTURE_BODY_MAX_LENGTH,
  CULTURE_DESCRIPTION_MAX_LENGTH,
  CULTURE_ICON_MAX_LENGTH,
  CULTURE_REFERENCE_LABEL_MAX_LENGTH,
  CULTURE_SUBTITLE_MAX_LENGTH,
  CULTURE_SUMMARY_MAX_LENGTH,
  CULTURE_TITLE_MAX_LENGTH,
  CULTURE_VISUAL_ASSET_FILE_NAME_MAX_LENGTH,
  CULTURE_VISUAL_ASSET_FITS,
  CULTURE_PERSONAL_ASSET_KINDS,
  isCulturePageSlug,
  isFullAdmin,
} from '@legends/shared'
import {
  CultureError,
  createBenefit,
  createManual,
  createPersonalAsset,
  createVisualAsset,
  deleteBenefit,
  deleteManual,
  deletePersonalAsset,
  deleteVisualAsset,
  getPageForAdmin,
  getPersonalAssetForViewer,
  getPublishedManual,
  getPublishedPage,
  listBenefitsForAdmin,
  listManualsForAdmin,
  listPublishedBenefits,
  listPublishedManuals,
  listPersonalAssetsFor,
  listPersonalAssetsForAdmin,
  listPublishedVisualAssets,
  listVisualAssetsForAdmin,
  reorderBenefits,
  reorderManuals,
  reorderVisualAssets,
  updateBenefit,
  updateManual,
  updatePersonalAsset,
  updateVisualAsset,
  upsertPage,
} from '../services/culture-service'
import { recordAuditLog } from '../services/audit-log-service'
import { presignDocumentDownload, s3Config } from '../lib/s3-client'
import {
  toCultureBenefitDTO,
  toCultureManualDTO,
  toCulturePageDTO,
  toCulturePersonalAssetAdminDTO,
  toCulturePersonalAssetDTO,
  toCultureVisualAssetDTO,
} from '../lib/serialize'

const slugParamsSchema = z.object({ slug: z.string().min(1) })
const idParamsSchema = z.object({ id: z.string().min(1) })

const upsertPageSchema = z.object({
  title: z.string().trim().min(1).max(CULTURE_TITLE_MAX_LENGTH),
  subtitle: z.string().trim().max(CULTURE_SUBTITLE_MAX_LENGTH).nullable().optional(),
  body: z.string().min(1).max(CULTURE_BODY_MAX_LENGTH),
  published: z.boolean().optional(),
})

const manualBaseSchema = {
  title: z.string().trim().min(1).max(CULTURE_TITLE_MAX_LENGTH),
  description: z.string().trim().min(1).max(CULTURE_DESCRIPTION_MAX_LENGTH),
  body: z.string().max(CULTURE_BODY_MAX_LENGTH).nullable().optional(),
  referenceLabel: z.string().trim().max(CULTURE_REFERENCE_LABEL_MAX_LENGTH).nullable().optional(),
  fileKey: z.string().trim().max(500).nullable().optional(),
  fileName: z.string().trim().max(255).nullable().optional(),
  fileSize: z.number().int().positive().nullable().optional(),
  published: z.boolean().optional(),
}
const createManualSchema = z.object(manualBaseSchema)
const updateManualSchema = z.object(manualBaseSchema).partial()

const benefitBaseSchema = {
  title: z.string().trim().min(1).max(CULTURE_TITLE_MAX_LENGTH),
  summary: z.string().trim().min(1).max(CULTURE_SUMMARY_MAX_LENGTH),
  icon: z.string().trim().max(CULTURE_ICON_MAX_LENGTH).nullable().optional(),
  body: z.string().min(1).max(CULTURE_BODY_MAX_LENGTH),
  published: z.boolean().optional(),
}
const createBenefitSchema = z.object(benefitBaseSchema)
const updateBenefitSchema = z.object(benefitBaseSchema).partial()

const visualAssetBaseSchema = {
  title: z.string().trim().min(1).max(CULTURE_TITLE_MAX_LENGTH),
  description: z.string().trim().min(1).max(CULTURE_DESCRIPTION_MAX_LENGTH),
  // A chave vem do presign; o service ainda confere se ela é desta empresa.
  storageKey: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(CULTURE_VISUAL_ASSET_FILE_NAME_MAX_LENGTH),
  fit: z.enum(CULTURE_VISUAL_ASSET_FITS).optional(),
  published: z.boolean().optional(),
}
const createVisualAssetSchema = z.object(visualAssetBaseSchema)
const updateVisualAssetSchema = z.object(visualAssetBaseSchema).partial()

const createPersonalAssetSchema = z.object({
  recipientId: z.string().min(1),
  title: z.string().trim().min(1).max(CULTURE_TITLE_MAX_LENGTH),
  description: z.string().trim().max(CULTURE_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  // A chave vem do presign; o service confere empresa E destinatário.
  storageKey: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().nullable().optional(),
  kind: z.enum(CULTURE_PERSONAL_ASSET_KINDS),
})
/** Só texto: trocar o destinatário é outra entrega, não uma edição. */
const updatePersonalAssetSchema = z
  .object({
    title: z.string().trim().min(1).max(CULTURE_TITLE_MAX_LENGTH).optional(),
    description: z.string().trim().max(CULTURE_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nada para atualizar' })

const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1) })

/** Erro de domínio → resposta; o resto sobe. */
function handleCultureError(err: unknown, reply: FastifyReply) {
  if (err instanceof CultureError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function cultureRoutes(app: FastifyInstance) {
  /**
   * Manifesto e benefícios são a identidade da empresa: **todo mundo que está
   * logado lê**, sem depender de feature de setor. Só a edição é restrita.
   */
  const publicReadGuard = { onRequest: [app.authenticate] }
  /** Manual é documento operacional — segue na feature `cultura` do setor. */
  const readGuard = { onRequest: [app.authenticate, app.requireFeature('cultura')] }
  /**
   * Toda a gestão de Cultura é área de Gente e Gestão: ADMIN global, ou SUBADMIN
   * do setor com `gente-gestao`. Antes manifesto e benefícios exigiam ADMIN
   * global, o que deixava o próprio time de G&G de fora do que ele produz.
   */
  const cultureAdminGuard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  /**
   * Quem pede um material pessoal, do jeito que o service precisa. `canAdminister`
   * repete a regra de `requireSectorFeature('gente-gestao')` de propósito: o
   * decorator é um guard (deixa passar ou barra), e aqui a MESMA rota atende
   * dois papéis — o dono do material e quem administra.
   */
  function personalViewer(request: { user: { sub: string; companyId: string; role: string; features?: string[] } }) {
    return {
      userId: request.user.sub,
      companyId: request.user.companyId,
      canAdminister:
        isFullAdmin(request.user) ||
        (request.user.role === 'SUBADMIN' && (request.user.features ?? []).includes('gente-gestao')),
    }
  }

  // ------------------------------------------------------ leitura (colaborador)

  app.get('/culture/pages/:slug', publicReadGuard, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params)
    if (!params.success || !isCulturePageSlug(params.data.slug)) {
      return reply.code(404).send({ message: 'Conteúdo não encontrado.' })
    }
    try {
      const page = await getPublishedPage(params.data.slug, request.user.companyId)
      return reply.send({ page: toCulturePageDTO(page) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.get('/culture/manuals', readGuard, async (request, reply) => {
    const manuals = await listPublishedManuals(request.user.companyId)
    return reply.send({ manuals: manuals.map(toCultureManualDTO) })
  })

  app.get('/culture/benefits', publicReadGuard, async (request, reply) => {
    const benefits = await listPublishedBenefits(request.user.companyId)
    return reply.send({ benefits: benefits.map(toCultureBenefitDTO) })
  })

  /**
   * Kit visual: leitura aberta a todo mundo logado, como manifesto e benefícios.
   * São os arquivos oficiais da marca — quem não puder baixá-los vai recortar o
   * logo de um print, que é exatamente o que o kit existe para evitar.
   */
  app.get('/culture/visual-assets', publicReadGuard, async (request, reply) => {
    const assets = await listPublishedVisualAssets(request.user.companyId)
    return reply.send({ assets: assets.map(toCultureVisualAssetDTO) })
  })

  /**
   * Link de download do PDF. O arquivo não é público: só depois de conferir
   * sessão e feature é que emitimos um link assinado de curta duração.
   *
   * Devolve JSON (e não um 302) de propósito: o access token vive só em memória
   * no front e viaja no header, o que um `<a href>` não faria.
   */
  app.get('/culture/manuals/:id/download', readGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const manual = await getPublishedManual(params.data.id, request.user.companyId)
      if (!manual.fileKey) return reply.code(404).send({ message: 'Este manual não tem arquivo anexado.' })
      if (!s3Config()) return reply.code(503).send({ message: 'Download de arquivos indisponível.' })
      const url = await presignDocumentDownload({ key: manual.fileKey, fileName: manual.fileName })
      return reply.send({ url })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  // ------------------------------------------------------------------- admin

  app.get('/admin/culture/pages/:slug', cultureAdminGuard, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params)
    if (!params.success || !isCulturePageSlug(params.data.slug)) {
      return reply.code(404).send({ message: 'Conteúdo não encontrado.' })
    }
    const page = await getPageForAdmin(params.data.slug, request.user.companyId)
    return reply.send({ page: page ? toCulturePageDTO(page) : null })
  })

  app.put('/admin/culture/pages/:slug', cultureAdminGuard, async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params)
    if (!params.success || !isCulturePageSlug(params.data.slug)) {
      return reply.code(404).send({ message: 'Conteúdo não encontrado.' })
    }
    const parsed = upsertPageSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const before = await getPageForAdmin(params.data.slug, request.user.companyId)
    const page = await upsertPage(params.data.slug, parsed.data, request.user.companyId, request.user.sub)
    await recordAuditLog({
      actorId: request.user.sub,
      entityType: 'CulturePage',
      entityId: page.id,
      action: before ? 'UPDATE' : 'CREATE',
      before: before ? toCulturePageDTO(before) : undefined,
      after: toCulturePageDTO(page),
      companyId: request.user.companyId,
    })
    return reply.send({ page: toCulturePageDTO(page) })
  })

  app.get('/admin/culture/manuals', cultureAdminGuard, async (request, reply) => {
    const manuals = await listManualsForAdmin(request.user.companyId)
    return reply.send({ manuals: manuals.map(toCultureManualDTO) })
  })

  app.post('/admin/culture/manuals', cultureAdminGuard, async (request, reply) => {
    const parsed = createManualSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const manual = await createManual(parsed.data, request.user.companyId)
    await recordAuditLog({
      actorId: request.user.sub,
      entityType: 'CultureManual',
      entityId: manual.id,
      action: 'CREATE',
      after: toCultureManualDTO(manual),
      companyId: request.user.companyId,
    })
    return reply.code(201).send({ manual: toCultureManualDTO(manual) })
  })

  app.patch('/admin/culture/manuals/:id', cultureAdminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const parsed = updateManualSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const manual = await updateManual(params.data.id, parsed.data, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CultureManual',
        entityId: manual.id,
        action: 'UPDATE',
        after: toCultureManualDTO(manual),
        companyId: request.user.companyId,
      })
      return reply.send({ manual: toCultureManualDTO(manual) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.delete('/admin/culture/manuals/:id', cultureAdminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const manual = await deleteManual(params.data.id, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CultureManual',
        entityId: manual.id,
        action: 'DELETE',
        before: toCultureManualDTO(manual),
        companyId: request.user.companyId,
      })
      return reply.code(204).send()
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.post('/admin/culture/manuals/reorder', cultureAdminGuard, async (request, reply) => {
    const parsed = reorderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const manuals = await reorderManuals(parsed.data.ids, request.user.companyId)
      return reply.send({ manuals: manuals.map(toCultureManualDTO) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.get('/admin/culture/benefits', cultureAdminGuard, async (request, reply) => {
    const benefits = await listBenefitsForAdmin(request.user.companyId)
    return reply.send({ benefits: benefits.map(toCultureBenefitDTO) })
  })

  app.post('/admin/culture/benefits', cultureAdminGuard, async (request, reply) => {
    const parsed = createBenefitSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const benefit = await createBenefit(parsed.data, request.user.companyId)
    await recordAuditLog({
      actorId: request.user.sub,
      entityType: 'CultureBenefit',
      entityId: benefit.id,
      action: 'CREATE',
      after: toCultureBenefitDTO(benefit),
      companyId: request.user.companyId,
    })
    return reply.code(201).send({ benefit: toCultureBenefitDTO(benefit) })
  })

  app.patch('/admin/culture/benefits/:id', cultureAdminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const parsed = updateBenefitSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const benefit = await updateBenefit(params.data.id, parsed.data, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CultureBenefit',
        entityId: benefit.id,
        action: 'UPDATE',
        after: toCultureBenefitDTO(benefit),
        companyId: request.user.companyId,
      })
      return reply.send({ benefit: toCultureBenefitDTO(benefit) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.delete('/admin/culture/benefits/:id', cultureAdminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const benefit = await deleteBenefit(params.data.id, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CultureBenefit',
        entityId: benefit.id,
        action: 'DELETE',
        before: toCultureBenefitDTO(benefit),
        companyId: request.user.companyId,
      })
      return reply.code(204).send()
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.post('/admin/culture/benefits/reorder', cultureAdminGuard, async (request, reply) => {
    const parsed = reorderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const benefits = await reorderBenefits(parsed.data.ids, request.user.companyId)
      return reply.send({ benefits: benefits.map(toCultureBenefitDTO) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  /**
   * Material pessoal do viewer. Sem guard de admin: a rota é do destinatário, e
   * o recorte é o `sub` do token — não há parâmetro para apontar para outra
   * pessoa, então não há como pedir o material de um colega.
   */
  app.get('/culture/personal-assets', publicReadGuard, async (request, reply) => {
    const assets = await listPersonalAssetsFor(request.user.sub, request.user.companyId)
    return reply.send({ assets: await Promise.all(assets.map(toCulturePersonalAssetDTO)) })
  })

  /**
   * Download do material pessoal: link assinado de curta duração, emitido só
   * depois de conferir QUEM está pedindo — o destinatário ou quem administra
   * Cultura. Guard só de sessão porque a decisão tem dois caminhos válidos e é
   * do service; `requireSectorFeature` sozinho barraria o próprio dono.
   */
  app.get('/culture/personal-assets/:id/download', publicReadGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const asset = await getPersonalAssetForViewer(personalViewer(request), params.data.id)
      if (!s3Config()) return reply.code(503).send({ message: 'Download indisponível.' })
      const url = await presignDocumentDownload({ key: asset.storageKey, fileName: asset.fileName })
      return reply.send({ url })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.get('/admin/culture/personal-assets', cultureAdminGuard, async (request, reply) => {
    const query = z.object({ userId: z.string().min(1).optional() }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const assets = await listPersonalAssetsForAdmin(request.user.companyId, query.data.userId)
    return reply.send({ assets: await Promise.all(assets.map(toCulturePersonalAssetAdminDTO)) })
  })

  app.post('/admin/culture/personal-assets', cultureAdminGuard, async (request, reply) => {
    const parsed = createPersonalAssetSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const asset = await createPersonalAsset(parsed.data, request.user.companyId, request.user.sub)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CulturePersonalAsset',
        entityId: asset.id,
        action: 'CREATE',
        // Só metadado na auditoria: título, destinatário e nome do arquivo. O
        // log é lido por quem audita, e o conteúdo é de uma pessoa só.
        after: { title: asset.title, recipientId: asset.recipientId, fileName: asset.fileName },
        companyId: request.user.companyId,
      })
      return reply.code(201).send({ asset: await toCulturePersonalAssetAdminDTO(asset) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.patch('/admin/culture/personal-assets/:id', cultureAdminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const parsed = updatePersonalAssetSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const asset = await updatePersonalAsset(params.data.id, parsed.data, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CulturePersonalAsset',
        entityId: asset.id,
        action: 'UPDATE',
        after: { title: asset.title, recipientId: asset.recipientId },
        companyId: request.user.companyId,
      })
      return reply.send({ asset: await toCulturePersonalAssetAdminDTO(asset) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.delete('/admin/culture/personal-assets/:id', cultureAdminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const asset = await deletePersonalAsset(params.data.id, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CulturePersonalAsset',
        entityId: asset.id,
        action: 'DELETE',
        before: { title: asset.title, recipientId: asset.recipientId, fileName: asset.fileName },
        companyId: request.user.companyId,
      })
      return reply.code(204).send()
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.get('/admin/culture/visual-assets', cultureAdminGuard, async (request, reply) => {
    const assets = await listVisualAssetsForAdmin(request.user.companyId)
    return reply.send({ assets: assets.map(toCultureVisualAssetDTO) })
  })

  app.post('/admin/culture/visual-assets', cultureAdminGuard, async (request, reply) => {
    const parsed = createVisualAssetSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const asset = await createVisualAsset(parsed.data, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CultureVisualAsset',
        entityId: asset.id,
        action: 'CREATE',
        after: toCultureVisualAssetDTO(asset),
        companyId: request.user.companyId,
      })
      return reply.code(201).send({ asset: toCultureVisualAssetDTO(asset) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.patch('/admin/culture/visual-assets/:id', cultureAdminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const parsed = updateVisualAssetSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const asset = await updateVisualAsset(params.data.id, parsed.data, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CultureVisualAsset',
        entityId: asset.id,
        action: 'UPDATE',
        after: toCultureVisualAssetDTO(asset),
        companyId: request.user.companyId,
      })
      return reply.send({ asset: toCultureVisualAssetDTO(asset) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.delete('/admin/culture/visual-assets/:id', cultureAdminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      const asset = await deleteVisualAsset(params.data.id, request.user.companyId)
      await recordAuditLog({
        actorId: request.user.sub,
        entityType: 'CultureVisualAsset',
        entityId: asset.id,
        action: 'DELETE',
        before: toCultureVisualAssetDTO(asset),
        companyId: request.user.companyId,
      })
      return reply.code(204).send()
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })

  app.post('/admin/culture/visual-assets/reorder', cultureAdminGuard, async (request, reply) => {
    const parsed = reorderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const assets = await reorderVisualAssets(parsed.data.ids, request.user.companyId)
      return reply.send({ assets: assets.map(toCultureVisualAssetDTO) })
    } catch (err) {
      return handleCultureError(err, reply)
    }
  })
}
