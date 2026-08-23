import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { MAP_DOCUMENT_V1_LIMITS, MapTileSizeSchema, type UserRole } from '@legends/shared'
import {
  OfficeMapError,
  acquireOfficeMapLock,
  activateOfficeMapPublication,
  adminReleaseOfficeDesk,
  claimOfficeDesk,
  createOfficeDeskReminder,
  createOfficeMap,
  deleteOfficeMap,
  deleteOfficeMapAsset,
  getActiveMapIdForEditing,
  getActiveOfficeMap,
  getOfficeDeskReminder,
  getOfficeMapDraft,
  getOfficeMapPublication,
  heartbeatOfficeMapLock,
  listActiveOfficeDesks,
  listActiveOfficeRooms,
  listOfficeMapAssets,
  listOfficeMapPublications,
  listOfficeMaps,
  mergeAndPublishDecoration,
  publishOfficeDecoration,
  publishOfficeMap,
  readOfficeDeskReminder,
  releaseOfficeDesk,
  releaseOfficeMapLock,
  renameOfficeMap,
  saveOfficeDecorationDraft,
  saveOfficeMapDraft,
  updateOfficeRoom,
  uploadOfficeMapAsset,
  validateOfficeMapDraft,
} from '../services/office-map-service'
import { getOfficeHub } from '../lib/office-hub'
import { toOfficeRoomOption } from '../lib/serialize'

/**
 * Teto de corpo das rotas que carregam o documento do mapa INTEIRO (rascunho do
 * admin e salvamento de decoração). O `bodyLimit` padrão do Fastify é 1 MiB, e
 * um escritório decorado já passa disso: cada objeto custa ~276 bytes, então o
 * mapa da EMR pesa 800 KB com 1684 objetos e estouraria o padrão bem antes de
 * chegar ao `maxObjects`. Fica um pouco ACIMA de `maxDocumentBytes` de
 * propósito: assim quem excede o documento recebe o 413 do serviço, com
 * mensagem em português, em vez do 413 genérico do Fastify.
 *
 * O nginx tem o mesmo padrão de 1 MB e precisa acompanhar — ver
 * `client_max_body_size` em `nginx/default.conf`.
 */
const DOCUMENT_BODY_LIMIT = MAP_DOCUMENT_V1_LIMITS.maxDocumentBytes + 512 * 1024

const idParams = z.object({ id: z.string().min(1) })
const assetParams = z.object({ id: z.string().min(1), assetId: z.string().min(1) })
const publicationParams = z.object({ id: z.string().min(1), publicationId: z.string().min(1) })
const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  width: z.number().int().min(MAP_DOCUMENT_V1_LIMITS.minMapWidthCells).max(MAP_DOCUMENT_V1_LIMITS.maxMapWidthCells),
  height: z.number().int().min(MAP_DOCUMENT_V1_LIMITS.minMapHeightCells).max(MAP_DOCUMENT_V1_LIMITS.maxMapHeightCells),
  tileSize: MapTileSizeSchema,
})
const renameSchema = z.object({ name: z.string().trim().min(2).max(120) })
const revisionSchema = z.object({ revision: z.number().int().nonnegative() })
const saveSchema = z.object({ revision: z.number().int().nonnegative(), document: z.unknown() })
const publishSchema = z.object({ revision: z.number().int().nonnegative(), activate: z.boolean() })
const activateSchema = z.object({ publicationId: z.string().min(1) })
const roomSchema = z.object({
  status: z.enum(['OPEN', 'LOCKED']).optional(),
  capacity: z.number().int().positive().nullable().optional(),
  voiceEnabled: z.boolean().optional(),
  accessPolicy: z.enum(['OPEN', 'ALLOWLIST']).optional(),
  allowedUserIds: z.array(z.string().min(1)).max(500).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Informe ao menos uma alteração')
const reminderSchema = z.object({
  message: z.string().trim().min(1).max(500),
  giftPosition: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }).optional(),
})

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

function lockToken(headers: Record<string, unknown>) {
  const value = headers['x-map-lock-token']
  return typeof value === 'string' ? value : ''
}

export async function officeMapRoutes(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof OfficeMapError) {
      return reply.code(error.status).send({ message: error.message, code: error.code, ...error.details })
    }
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({
        message: 'O asset excede o limite de 10 MB',
        code: 'ASSET_TOO_LARGE',
      })
    }
    throw error
  })

  const admin = { onRequest: [app.authenticate, app.requireAdmin] }

  app.get('/admin/office-maps', admin, async (request) => ({ maps: await listOfficeMaps(request.user.companyId) }))

  app.post('/admin/office-maps', admin, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    return reply.code(201).send({ map: await createOfficeMap(parsed.data, request.user.sub, request.user.companyId) })
  })

  app.patch('/admin/office-maps/:id', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = renameSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return { map: await renameOfficeMap(params.data.id, body.data.name, request.user.sub, request.user.companyId) }
  })

  app.delete('/admin/office-maps/:id', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    await deleteOfficeMap(parsed.data.id, request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })

  app.get('/admin/office-maps/:id/draft', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return getOfficeMapDraft(parsed.data.id, request.user.companyId)
  })

  app.put('/admin/office-maps/:id/draft', { ...admin, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = saveSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return saveOfficeMapDraft(
      params.data.id,
      { revision: body.data.revision, document: (request.body as { document: unknown }).document },
      request.user.sub,
      lockToken(request.headers),
      request.user.companyId,
    )
  })

  app.post('/admin/office-maps/:id/lock', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return acquireOfficeMapLock(parsed.data.id, request.user.sub, request.user.companyId)
  })

  app.post('/admin/office-maps/:id/lock/heartbeat', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return heartbeatOfficeMapLock(parsed.data.id, request.user.sub, lockToken(request.headers), request.user.companyId)
  })

  app.delete('/admin/office-maps/:id/lock', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    await releaseOfficeMapLock(parsed.data.id, request.user.sub, lockToken(request.headers), request.user.companyId)
    return reply.code(204).send()
  })

  app.get('/admin/office-maps/:id/assets', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return listOfficeMapAssets(parsed.data.id, request.user.companyId)
  })

  app.post('/admin/office-maps/:id/assets', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    const part = await request.file({ limits: { fileSize: MAP_DOCUMENT_V1_LIMITS.maxAssetBytes, files: 1 } })
    if (!part) return reply.code(400).send({ message: 'Envie uma imagem no campo file' })
    const buffer = await part.toBuffer()
    return reply.code(201).send(
      await uploadOfficeMapAsset(parsed.data.id, request.user.sub, {
        buffer,
        filename: part.filename,
        mimetype: part.mimetype,
      }, request.user.companyId),
    )
  })

  app.delete('/admin/office-maps/:id/assets/:assetId', admin, async (request, reply) => {
    const parsed = assetParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    await deleteOfficeMapAsset(parsed.data.id, parsed.data.assetId, request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })

  app.post('/admin/office-maps/:id/validate', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = revisionSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return validateOfficeMapDraft(params.data.id, body.data.revision, request.user.companyId)
  })

  app.get('/admin/office-maps/:id/publications', admin, async (request, reply) => {
    const parsed = idParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return listOfficeMapPublications(parsed.data.id, request.user.companyId)
  })

  app.post('/admin/office-maps/:id/publications', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = publishSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return reply.code(201).send(
      await publishOfficeMap(params.data.id, body.data.revision, request.user.sub, body.data.activate, request.user.companyId),
    )
  })

  app.get('/admin/office-maps/:id/publications/:publicationId', admin, async (request, reply) => {
    const parsed = publicationParams.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    return getOfficeMapPublication(parsed.data.id, parsed.data.publicationId, request.user.companyId)
  })

  app.patch('/admin/office-map-active', admin, async (request, reply) => {
    const parsed = activateSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    return activateOfficeMapPublication(parsed.data.publicationId, request.user.sub, request.user.companyId)
  })

  app.get('/admin/office-rooms', admin, async (request) => ({ rooms: await listActiveOfficeRooms(request.user.companyId) }))

  app.patch('/admin/office-rooms/:id', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = roomSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    return { room: await updateOfficeRoom(params.data.id, body.data, request.user.sub, request.user.companyId) }
  })

  app.get('/office/map', { onRequest: [app.authenticate, app.requireFeature('escritorio')] }, async (request) => getActiveOfficeMap(request.user.companyId))

  /**
   * As salas para o seletor de "marcar reunião". Não exige a feature
   * `escritorio`: quem usa o Calendário pode marcar numa sala sem ter o
   * escritório virtual habilitado. Convidado não marca reunião (mesma regra de
   * `/office/meetings`), então também não vê a lista.
   */
  app.get('/office/rooms', { onRequest: [app.authenticate] }, async (request, reply) => {
    if (request.user.role === 'GUEST') {
      return reply.code(403).send({ message: 'Convidado não vê as salas' })
    }
    const rooms = await listActiveOfficeRooms(request.user.companyId)
    return { rooms: rooms.map(toOfficeRoomOption) }
  })

  const member = { onRequest: [app.authenticate, app.requireFeature('escritorio')] }
  const decorSaveSchema = z.object({ revision: z.number().int().nonnegative(), document: z.unknown() })
  const decorPublishSchema = z.object({ revision: z.number().int().nonnegative() })
  const decorMergeSchema = z.object({
    baseRevision: z.number().int().nonnegative(),
    // Opcional por compatibilidade com aba antiga aberta: ausente é tratado
    // como âncora desconhecida, e o merge entra no modo aditivo.
    basePublicationId: z.string().min(1).optional(),
    document: z.unknown(),
  })

  app.get('/office/map/edit/draft', member, async (request) =>
    getOfficeMapDraft(await getActiveMapIdForEditing(request.user.companyId), request.user.companyId))

  app.post('/office/map/edit/lock', member, async (request) =>
    acquireOfficeMapLock(await getActiveMapIdForEditing(request.user.companyId), request.user.sub, request.user.companyId))

  app.post('/office/map/edit/lock/heartbeat', member, async (request) =>
    heartbeatOfficeMapLock(await getActiveMapIdForEditing(request.user.companyId), request.user.sub, lockToken(request.headers), request.user.companyId))

  app.delete('/office/map/edit/lock', member, async (request, reply) => {
    await releaseOfficeMapLock(await getActiveMapIdForEditing(request.user.companyId), request.user.sub, lockToken(request.headers), request.user.companyId)
    return reply.code(204).send()
  })

  app.put('/office/map/edit/draft', { ...member, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const body = decorSaveSchema.safeParse(request.body)
    if (!body.success) return badInput(reply, body.error)
    return saveOfficeDecorationDraft(
      { revision: body.data.revision, document: (request.body as { document: unknown }).document },
      { id: request.user.sub, role: request.user.role as UserRole, adminAccess: request.user.adminAccess },
      lockToken(request.headers),
      request.user.companyId,
    )
  })

  app.post('/office/map/edit/publish', member, async (request, reply) => {
    const body = decorPublishSchema.safeParse(request.body)
    if (!body.success) return badInput(reply, body.error)
    return publishOfficeDecoration(body.data.revision, { id: request.user.sub, role: request.user.role as UserRole, adminAccess: request.user.adminAccess }, request.user.companyId)
  })

  app.post('/office/map/edit/merge-publish', { ...member, bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const body = decorMergeSchema.safeParse(request.body)
    if (!body.success) return badInput(reply, body.error)
    return mergeAndPublishDecoration(
      {
        baseRevision: body.data.baseRevision,
        basePublicationId: body.data.basePublicationId,
        document: (request.body as { document: unknown }).document,
      },
      { id: request.user.sub, role: request.user.role as UserRole, adminAccess: request.user.adminAccess },
      request.user.companyId,
    )
  })

  app.get('/admin/office-desks', admin, async (request) => ({ desks: await listActiveOfficeDesks(request.user.companyId) }))

  app.delete('/admin/office-desks/:id/claim', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await adminReleaseOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    getOfficeHub(request.user.companyId).broadcastDeskReleased(desk.id, desk.externalKey)
    return { desk }
  })

  app.post('/office/desks/:id/claim', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await claimOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    if (desk.claimedBy) getOfficeHub(request.user.companyId).broadcastDeskClaimed(desk.id, desk.externalKey, desk.claimedBy)
    return { desk }
  })

  app.post('/office/desks/:id/release', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await releaseOfficeDesk(params.data.id, request.user.sub, request.user.companyId)
    getOfficeHub(request.user.companyId).broadcastDeskReleased(desk.id, desk.externalKey)
    return { desk }
  })

  app.post('/office/desks/:id/reminders', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    const body = reminderSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    const reminder = await createOfficeDeskReminder(
      params.data.id,
      request.user.sub,
      body.data.message,
      body.data.giftPosition ?? { x: 0.5, y: 0.35 },
      request.user.companyId,
    )
    getOfficeHub(request.user.companyId).broadcastDeskReminderCreated(reminder)
    return reply.code(201).send({ reminder })
  })

  app.get('/office/desk-reminders/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    return { reminder: await getOfficeDeskReminder(params.data.id, request.user.sub, request.user.companyId) }
  })

  app.post('/office/desk-reminders/:id/read', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const reminder = await readOfficeDeskReminder(params.data.id, request.user.sub, request.user.companyId)
    getOfficeHub(request.user.companyId).broadcastDeskReminderRead(
      reminder.id,
      reminder.deskId,
      reminder.deskExternalKey,
      reminder.sender.id,
      reminder.recipientId,
    )
    return { reminder }
  })
}
