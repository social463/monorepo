import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { Prisma } from '@prisma/client'
import {
  MAP_DOCUMENT_V1_LIMITS,
  OFFICE_DECOR_REVISION_RING,
  OFFICE_MAP_PUBLICATION_LIMIT,
  MapDocumentV1StructuralSchema,
  assertOnlyDecorationChanged,
  assertProtectedObjectsUntouched,
  builtinTilesetAsset,
  builtinAssetToDTO,
  isBuiltinTilesetAssetId,
  createEmptyMapDocumentV1,
  ensureReservedLayers,
  mergeAdminDraft,
  mergeDecoration,
  validateMapDocumentV1,
  type ActiveOfficeMapDTO,
  type MapDocumentV1,
  type MapObjectV1,
  isFullAdmin,
  type MapTileSize,
  type OfficeMapAssetDTO,
  type OfficeMapDraftDTO,
  type OfficeMapLockDTO,
  type OfficeMapPublicationDTO,
  type OfficeMapSummaryDTO,
  type OfficeDecorSaveResultDTO,
  type OfficeRoomDTO,
  type OfficeDeskDTO,
  type OfficeDeskReminderDetailDTO,
  type OfficeDeskReminderSummaryDTO,
  type UserRole,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { deleteS3Object, publicUrlFor, putS3Object, s3Config } from '../lib/s3-client'
import { getOfficeHub } from '../lib/office-hub'
import { recordAuditLog } from './audit-log-service'
import { createNotification } from './notification-service'

export class OfficeMapError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export interface UploadedOfficeMapAsset {
  buffer: Buffer
  mimetype: string
  filename: string
}

interface InspectedImage {
  extension: 'png' | 'webp'
  mimeType: 'image/png' | 'image/webp'
  width: number
  height: number
}

const publicationSelect = {
  id: true,
  version: true,
  schemaVersion: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.OfficeMapPublicationSelect

function fail(message: string, status: number, code: string, details?: Record<string, unknown>): never {
  throw new OfficeMapError(message, status, code, details)
}

/** Rótulo pt-BR das coleções do documento que têm teto próprio. */
const DOCUMENT_COLLECTION_LABELS: Record<string, string> = {
  tilesets: 'conjuntos de mobília',
  objects: 'objetos',
  layers: 'camadas',
}

/**
 * Mensagem do 400 de documento malformado. Estourar um teto (`maxTilesets`,
 * `maxObjects`, `maxLayers`) é a falha estrutural que o usuário de fato provoca
 * decorando, e o genérico "Documento inválido" não dava pista nenhuma de por
 * que o Salvar parou de funcionar — quem batia no teto de conjuntos ficava sem
 * saber que bastava apagar as peças de um conjunto. As demais falhas continuam
 * no genérico: são bug de cliente, não algo que o usuário conserte.
 */
function describeMalformedDocument(error: { issues: { code: string; path: (string | number)[]; maximum?: unknown }[] }): string {
  const limit = error.issues.find(
    (issue) => issue.code === 'too_big' && issue.path.length === 1 && typeof issue.path[0] === 'string' && issue.path[0] in DOCUMENT_COLLECTION_LABELS,
  )
  if (!limit) return 'Documento inválido'
  const label = DOCUMENT_COLLECTION_LABELS[limit.path[0] as string]
  return `O mapa excede o limite de ${String(limit.maximum)} ${label}`
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function checksum(content: Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

function asPublication(
  row: { id: string; version: number; schemaVersion: string; createdAt: Date; createdBy: { id: string; name: string } | null },
  activeId: string | null,
): OfficeMapPublicationDTO {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    active: row.id === activeId,
  }
}

function assetUrl(storageKey: string): string {
  if (storageKey === 'builtin:legacy-office-tileset') return '/office/legacy-office-tileset.svg'
  const builtin = builtinTilesetAsset(storageKey)
  if (builtin) return builtin.url
  const cfg = s3Config()
  if (!cfg) return ''
  return publicUrlFor(storageKey, cfg)
}

function asAsset(row: {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  width: number
  height: number
  checksum: string
  storageKey: string
}): OfficeMapAssetDTO {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    url: assetUrl(row.storageKey),
  }
}

function inspectImage(file: UploadedOfficeMapAsset): InspectedImage {
  const { buffer } = file
  if (buffer.length === 0) fail('A imagem enviada está vazia', 400, 'ASSET_EMPTY')
  if (buffer.length > MAP_DOCUMENT_V1_LIMITS.maxAssetBytes) {
    fail('O asset excede o limite de 10 MB', 413, 'ASSET_TOO_LARGE')
  }

  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  ) {
    if (file.mimetype !== 'image/png') fail('O MIME não corresponde à imagem PNG', 400, 'ASSET_MIME_INVALID')
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    if (width < 1 || height < 1 || width * height > 100_000_000) {
      fail('As dimensões da imagem não são seguras', 400, 'ASSET_DIMENSIONS_INVALID')
    }
    return { extension: 'png', mimeType: 'image/png', width, height }
  }

  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    if (file.mimetype !== 'image/webp') fail('O MIME não corresponde à imagem WebP', 400, 'ASSET_MIME_INVALID')
    const kind = buffer.toString('ascii', 12, 16)
    let width = 0
    let height = 0
    if (kind === 'VP8X') {
      width = 1 + buffer.readUIntLE(24, 3)
      height = 1 + buffer.readUIntLE(27, 3)
    } else if (kind === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21)
      width = 1 + (bits & 0x3fff)
      height = 1 + ((bits >> 14) & 0x3fff)
    } else if (kind === 'VP8 ' && buffer.toString('hex', 23, 26) === '9d012a') {
      width = buffer.readUInt16LE(26) & 0x3fff
      height = buffer.readUInt16LE(28) & 0x3fff
    }
    if (width < 1 || height < 1 || width * height > 100_000_000) {
      fail('A imagem WebP é inválida', 400, 'ASSET_INVALID')
    }
    return { extension: 'webp', mimeType: 'image/webp', width, height }
  }

  fail('Somente imagens PNG e WebP válidas são aceitas', 400, 'ASSET_INVALID')
}

function withBuiltinAssets(document: MapDocumentV1, assets: OfficeMapAssetDTO[]): OfficeMapAssetDTO[] {
  const present = new Set(assets.map((asset) => asset.id))
  const extra: OfficeMapAssetDTO[] = []
  for (const tileset of document.tilesets) {
    const builtin = builtinTilesetAsset(tileset.assetId)
    if (builtin && !present.has(builtin.assetId)) {
      present.add(builtin.assetId)
      extra.push(builtinAssetToDTO(builtin))
    }
  }
  return extra.length ? [...assets, ...extra] : assets
}

async function activePublicationId(companyId: string): Promise<string | null> {
  const row = await prisma.officeSetting.findUnique({ where: { companyId }, select: { activeMapPublicationId: true } })
  return row?.activeMapPublicationId ?? null
}

async function requireMap(mapId: string, companyId: string) {
  const map = await scopedPrisma(companyId).officeMap.findUnique({ where: { id: mapId }, select: { id: true, name: true } })
  if (!map) fail('Mapa não encontrado', 404, 'MAP_NOT_FOUND')
  return map
}

async function validateDocument(
  mapId: string,
  input: unknown,
  companyId: string,
  db: ReturnType<typeof scopedPrisma> | Prisma.TransactionClient = scopedPrisma(companyId),
) {
  const structural = MapDocumentV1StructuralSchema.safeParse(input)
  if (!structural.success) {
    const result = validateMapDocumentV1(input)
    return { valid: false, errors: result.errors.map((error) => ({ ...error })), document: null, assets: [] }
  }

  // Mapas criados antes de uma nova layer reservada (ex.: `desks`) existir
  // não a têm no documento salvo; preenche automaticamente em vez de exigir
  // uma migração manual por mapa.
  const healed = ensureReservedLayers(structural.data)
  const result = validateMapDocumentV1(healed)
  const errors: Array<{ code: string; message: string; path: string; objectId?: string; layerKey?: string }> =
    result.errors.map((error) => ({ ...error }))

  // Builtins (catálogo) não têm linha em OfficeMapAsset: resolve dims pelo
  // catálogo e não os inclui na busca por-mapId nem no `assets` retornado.
  const allIds = [...new Set(healed.tilesets.map((tileset) => tileset.assetId))]
  const dbIds = allIds.filter((id) => !isBuiltinTilesetAssetId(id))
  const assets = dbIds.length
    ? await db.officeMapAsset.findMany({ where: { mapId, id: { in: dbIds } } })
    : []
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  healed.tilesets.forEach((tileset, index) => {
    const builtin = builtinTilesetAsset(tileset.assetId)
    const dims = builtin
      ? { width: builtin.width, height: builtin.height }
      : byId.get(tileset.assetId)
    if (!dims) {
      errors.push({ code: 'ASSET_NOT_FOUND', path: `tilesets[${index}].assetId`, message: 'O asset do tileset não pertence a este mapa' })
      return
    }
    const columns = Math.floor(dims.width / tileset.tileWidth)
    const rows = Math.floor(dims.height / tileset.tileHeight)
    if (columns !== tileset.columns || columns * rows !== tileset.tileCount) {
      errors.push({ code: 'ASSET_DIMENSIONS_INVALID', path: `tilesets[${index}]`, message: 'A grade do tileset não corresponde às dimensões da imagem' })
    }
  })
  return { valid: errors.length === 0, errors, document: healed, assets }
}

export async function listOfficeMaps(companyId: string): Promise<OfficeMapSummaryDTO[]> {
  const [activeId, maps] = await Promise.all([
    activePublicationId(companyId),
    scopedPrisma(companyId).officeMap.findMany({
      orderBy: { createdAt: 'asc' },
      include: { publications: { orderBy: { version: 'desc' }, select: publicationSelect } },
    }),
  ])
  return maps.map((map) => ({
    id: map.id,
    name: map.name,
    createdAt: map.createdAt.toISOString(),
    updatedAt: map.updatedAt.toISOString(),
    publications: map.publications.map((publication) => asPublication(publication, activeId)),
  }))
}

export async function createOfficeMap(
  input: { name: string; width: number; height: number; tileSize: MapTileSize },
  userId: string,
  companyId: string,
): Promise<OfficeMapSummaryDTO> {
  const document = createEmptyMapDocumentV1({
    width: input.width,
    height: input.height,
    tileSize: input.tileSize,
  })
  const map = await scopedPrisma(companyId).officeMap.create({
    data: {
      name: input.name.trim(),
      draft: {
        create: {
          document: document as unknown as Prisma.InputJsonValue,
          lastEditedById: userId,
          companyId,
        },
      },
    },
  })
  await recordAuditLog({ actorId: userId, entityType: 'OfficeMap', entityId: map.id, action: 'CREATE', after: map, companyId })
  return {
    id: map.id,
    name: map.name,
    createdAt: map.createdAt.toISOString(),
    updatedAt: map.updatedAt.toISOString(),
    publications: [],
  }
}

export async function renameOfficeMap(mapId: string, name: string, actorId: string, companyId: string) {
  const before = await requireMap(mapId, companyId)
  const map = await scopedPrisma(companyId).officeMap.update({ where: { id: mapId }, data: { name: name.trim() } })
  await recordAuditLog({ actorId, entityType: 'OfficeMap', entityId: mapId, action: 'UPDATE', before, after: map, companyId })
  return { ...map, createdAt: map.createdAt.toISOString(), updatedAt: map.updatedAt.toISOString() }
}

export async function deleteOfficeMap(mapId: string, actorId: string, companyId: string): Promise<void> {
  const before = await requireMap(mapId, companyId)
  const db = scopedPrisma(companyId)
  const active = await prisma.officeSetting.findFirst({
    where: { companyId, activeMapPublication: { mapId } },
    select: { companyId: true },
  })
  if (active) fail('Ative outro mapa antes de excluir este', 409, 'MAP_IS_ACTIVE')
  const assets = await db.officeMapAsset.findMany({ where: { mapId }, select: { storageKey: true } })
  await db.$transaction(async (tx) => {
    await tx.officeMapPublicationAsset.deleteMany({ where: { publication: { mapId } } })
    await tx.officeMap.delete({ where: { id: mapId } })
    await recordAuditLog({ actorId, entityType: 'OfficeMap', entityId: mapId, action: 'DELETE', before, companyId, tx: tx as unknown as Prisma.TransactionClient })
  })
  await Promise.allSettled(
    assets.filter(({ storageKey }) => !storageKey.startsWith('builtin:')).map(({ storageKey }) => deleteS3Object(storageKey)),
  )
}

export async function getOfficeMapDraft(mapId: string, companyId: string): Promise<OfficeMapDraftDTO> {
  const map = await requireMap(mapId, companyId)
  const db = scopedPrisma(companyId)
  let draft = await db.officeMapDraft.findUnique({
    where: { mapId },
    include: { lastEditedBy: { select: { id: true, name: true } } },
  })
  if (!draft) {
    const document = createEmptyMapDocumentV1()
    draft = await db.officeMapDraft.create({
      data: { mapId, document: document as unknown as Prisma.InputJsonValue },
      include: { lastEditedBy: { select: { id: true, name: true } } },
    })
  } else {
    // Mapas criados antes de uma nova layer reservada existir (ex.: `desks`)
    // não a têm no documento salvo; preenche e persiste ao abrir o rascunho.
    const structural = MapDocumentV1StructuralSchema.safeParse(draft.document)
    if (structural.success) {
      const healed = ensureReservedLayers(structural.data)
      if (JSON.stringify(healed) !== JSON.stringify(structural.data)) {
        draft = await db.officeMapDraft.update({
          where: { mapId },
          data: { document: healed as unknown as Prisma.InputJsonValue },
          include: { lastEditedBy: { select: { id: true, name: true } } },
        })
      }
    }
  }
  // Rebase sobre o mapa vivo: sem isto o admin abre o editor num documento
  // congelado no último publish e não enxerga nada do que foi decorado pelo
  // mapa desde então — e publicar aquilo apagaria tudo.
  const rebased = await rebaseDraftOnActiveMap(mapId, draft, companyId)
  if (rebased && JSON.stringify(rebased.document) !== JSON.stringify(draft.document)) {
    draft = await db.officeMapDraft.update({
      where: { mapId },
      data: {
        document: rebased.document as unknown as Prisma.InputJsonValue,
        basePublicationId: rebased.anchor.publicationId,
        baseDecorRevision: rebased.anchor.decorRevision,
      },
      include: { lastEditedBy: { select: { id: true, name: true } } },
    })
  } else if (rebased && draft.basePublicationId !== rebased.anchor.publicationId) {
    // Documento idêntico, âncora ausente/velha (rascunho de antes desta
    // feature): só carimba a âncora, para o próximo merge ser 3-vias de verdade.
    draft = await db.officeMapDraft.update({
      where: { mapId },
      data: { basePublicationId: rebased.anchor.publicationId, baseDecorRevision: rebased.anchor.decorRevision },
      include: { lastEditedBy: { select: { id: true, name: true } } },
    })
  }
  return {
    map,
    revision: draft.revision,
    document: draft.document as unknown as MapDocumentV1,
    savedAt: draft.savedAt.toISOString(),
    updatedBy: draft.lastEditedBy,
    basePublicationId: draft.basePublicationId,
    baseDecorRevision: draft.baseDecorRevision,
  }
}

type DraftAnchor = { basePublicationId: string | null; baseDecorRevision: number | null }

/**
 * Mescla o rascunho do admin com o `mapData` da publicação ativa — o mesmo
 * merge 3-vias da decoração colaborativa, mas com a AUTORIDADE invertida:
 * a estrutura sai do rascunho (`mergeAdminDraft`), porque mudar a topologia do
 * mapa é exatamente o que o editor do admin faz.
 *
 * `base` sai da âncora gravada no rascunho (`basePublicationId` +
 * `baseDecorRevision`) via anel de revisões. Quando a âncora não existe
 * (rascunho anterior a esta feature), aponta para OUTRA publicação, ou a
 * revisão já foi podada do anel, não há como distinguir "o admin apagou isto"
 * de "isto nasceu depois que ele abriu": cai no modo aditivo, que une os dois
 * documentos sem remover nada. Perde-se a remoção daquela sessão; não se perde
 * mobília.
 *
 * Devolve `null` quando este mapa não é o publicado/ativo — aí o rascunho é a
 * única fonte e não há o que mesclar.
 */
async function rebaseDraftOnActiveMap(
  mapId: string,
  draft: { document: Prisma.JsonValue } & DraftAnchor,
  companyId: string,
  client?: Prisma.TransactionClient,
): Promise<{ document: MapDocumentV1; anchor: { publicationId: string; decorRevision: number } } | null> {
  const db = client ?? scopedPrisma(companyId)
  const active = await db.officeMapPublication.findFirst({
    where: { mapId, activeSetting: { companyId } },
    select: { id: true, decorRevision: true, mapData: true },
  })
  if (!active) return null

  const mine = canonicalDocument(draft.document)
  const theirs = canonicalDocument(active.mapData)
  const anchor = { publicationId: active.id, decorRevision: active.decorRevision }

  const anchoredHere = draft.basePublicationId === active.id && draft.baseDecorRevision !== null
  if (anchoredHere && draft.baseDecorRevision === active.decorRevision) {
    // Ninguém decorou desde que o rascunho foi ancorado: `theirs` É a base.
    return { document: mergeAdminDraft(theirs, mine, theirs), anchor }
  }
  if (anchoredHere) {
    const snapshot = await db.officeMapDecorRevision.findUnique({
      where: { publicationId_revision: { publicationId: active.id, revision: draft.baseDecorRevision as number } },
      select: { mapData: true },
    })
    if (snapshot) return { document: mergeAdminDraft(canonicalDocument(snapshot.mapData), mine, theirs), anchor }
  }
  return { document: mergeAdminDraft(theirs, mine, theirs, { additive: true }), anchor }
}

async function requireLock(mapId: string, userId: string, lockToken: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const lock = await db.officeMapEditLock.findFirst({
    where: { mapId, userId, tokenHash: tokenHash(lockToken), expiresAt: { gt: new Date() } },
  })
  if (!lock) {
    const current = await db.officeMapEditLock.findUnique({
      where: { mapId },
      include: { user: { select: { id: true, name: true } } },
    })
    fail('O lock de edição expirou ou pertence a outra pessoa', 423, 'MAP_LOCKED', {
      expiresAt: current?.expiresAt.toISOString() ?? null,
      owner: current?.user ?? null,
    })
  }
}

export async function saveOfficeMapDraft(
  mapId: string,
  input: { revision: number; document: unknown },
  userId: string,
  lockToken: string,
  companyId: string,
) {
  await requireMap(mapId, companyId)
  await requireLock(mapId, userId, lockToken, companyId)
  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    const validation = validateMapDocumentV1(input.document)
    fail('A estrutura do documento é inválida', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
  }
  const validation = await validateDocument(mapId, structural.data, companyId)
  if (validation.errors.some((error) => error.code === 'DOCUMENT_TOO_LARGE')) {
    fail('O documento excede o limite de 10 MB', 413, 'DOCUMENT_TOO_LARGE')
  }
  const savedAt = new Date()
  const updated = await scopedPrisma(companyId).officeMapDraft.updateMany({
    where: { mapId, revision: input.revision },
    data: {
      document: (validation.document ?? structural.data) as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
      savedAt,
      lastEditedById: userId,
    },
  })
  if (updated.count !== 1) {
    const current = await scopedPrisma(companyId).officeMapDraft.findUnique({ where: { mapId }, select: { revision: true } })
    fail('O rascunho foi alterado por outra requisição', 409, 'DRAFT_REVISION_CONFLICT', {
      expectedRevision: input.revision,
      currentRevision: current?.revision ?? null,
    })
  }
  return {
    revision: input.revision + 1,
    savedAt: savedAt.toISOString(),
    validationSummary: { valid: validation.valid, errorCount: validation.errors.length },
  }
}

export async function getActiveMapIdForEditing(companyId: string): Promise<string> {
  const setting = await prisma.officeSetting.findUnique({
    where: { companyId },
    select: { activeMapPublication: { select: { mapId: true } } },
  })
  const mapId = setting?.activeMapPublication?.mapId
  if (!mapId) fail('Nenhum mapa foi publicado para o escritório', 404, 'ACTIVE_MAP_NOT_FOUND')
  return mapId
}

// Normaliza via o schema estrutural: o Postgres (jsonb) reordena as chaves de
// objetos aninhados ao persistir/ler (ordena por tamanho e depois alfabeticamente),
// então comparar um documento lido do banco "cru" contra um documento recém
// validado pelo Zod (que serializa na ordem declarada no schema) pode acusar
// diffs estruturais falsos (ex.: `geometry: { kind, x, y }` vira `{ x, y, kind }`
// após o round-trip). Sempre re-parseamos ambos os lados antes do guard para
// que a comparação por JSON.stringify seja estável.
function canonicalDocument(document: unknown): MapDocumentV1 {
  const structural = MapDocumentV1StructuralSchema.safeParse(document)
  if (!structural.success) return document as MapDocumentV1
  // Preenche layers reservadas ausentes (ex.: `desks`, adicionada depois que
  // o mapa foi publicado) para que os dois lados do guard tenham a MESMA
  // topologia — senão o `ensureReservedLayers` aplicado só a um lado faz o
  // guard acusar `LAYER_TOPOLOGY_CHANGED` em qualquer edição de decoração.
  return ensureReservedLayers(structural.data)
}

async function activeDocument(companyId: string): Promise<MapDocumentV1> {
  const active = await getActiveOfficeMap(companyId)
  return canonicalDocument(active.document)
}

/**
 * Quem edita o mapa. `adminAccess` (acesso administrativo delegado) vale como
 * ADMIN aqui: mexer na estrutura publicada é ação de administração.
 */
export interface OfficeMapActor {
  id: string
  role: UserRole
  adminAccess?: boolean
}

/**
 * Server é a AUTORIDADE sobre autoria: objeto existente mantém o `createdBy`
 * de `previous` (imutável — impede forjar); objeto novo recebe o ator. Assim
 * um comum não consegue se passar por admin nem reatribuir peça alheia.
 */
function stampObjectOwnership(
  previous: MapDocumentV1,
  next: MapDocumentV1,
  actor: OfficeMapActor,
): MapDocumentV1 {
  const prevById = new Map(previous.objects.map((o) => [o.id, o]))
  return {
    ...next,
    objects: next.objects.map((o): MapObjectV1 => {
      const prev = prevById.get(o.id)
      return prev
        ? { ...o, createdBy: prev.createdBy ?? null }
        : { ...o, createdBy: { id: actor.id, role: actor.role } }
    }),
  }
}

export async function saveOfficeDecorationDraft(
  input: { revision: number; document: unknown },
  actor: OfficeMapActor,
  lockToken: string,
  companyId: string,
) {
  const mapId = await getActiveMapIdForEditing(companyId)
  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    const validation = validateMapDocumentV1(input.document)
    fail('A estrutura do documento é inválida', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
  }
  const previous = await activeDocument(companyId)
  const stamped = stampObjectOwnership(previous, canonicalDocument(structural.data), actor)
  const guard = assertOnlyDecorationChanged(previous, stamped, { isAdmin: isFullAdmin(actor) })
  if (!guard.ok) fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
  return saveOfficeMapDraft(mapId, { revision: input.revision, document: stamped }, actor.id, lockToken, companyId)
}

export async function publishOfficeDecoration(revision: number, actor: OfficeMapActor, companyId: string) {
  const mapId = await getActiveMapIdForEditing(companyId)
  const draft = await scopedPrisma(companyId).officeMapDraft.findUnique({ where: { mapId } })
  if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
  const previous = await activeDocument(companyId)
  const next = canonicalDocument(draft.document)
  const guard = assertOnlyDecorationChanged(previous, next, { isAdmin: isFullAdmin(actor) })
  if (!guard.ok) fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
  return publishOfficeMap(mapId, revision, actor.id, true, companyId, { soft: true })
}

/**
 * Outro save de decoração avançou o `decorRevision` entre a leitura e a
 * escrita desta transação. Não vaza para a rota: `mergeAndPublishDecoration`
 * refaz o ciclo (ler → mesclar → gravar) com o estado novo.
 */
class DecorRevisionConflict extends Error {}

const DECOR_SAVE_MAX_ATTEMPTS = 3

/**
 * Dois saves simultâneos na mesma revisão colidem de DUAS formas, e as duas
 * significam a mesma coisa — "alguém salvou primeiro, refaça o merge":
 *
 * - a guarda otimista devolve `count === 0` (`DecorRevisionConflict`);
 * - o Postgres, em `Serializable`, aborta a transação perdedora ANTES disso e
 *   o Prisma converte em `P2034`. Este é o caminho que realmente acontece com
 *   duas requisições concorrentes de verdade — sem tratá-lo, uma das pessoas
 *   leva 500 e perde a edição em vez de o retry rodar.
 */
function isRetryableDecorConflict(err: unknown): boolean {
  if (err instanceof DecorRevisionConflict) return true
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
}

/**
 * Reconcilia `OfficeRoom`/`OfficeDesk` de uma publicação que continua a MESMA
 * (save de decoração in-place), casando por `externalKey`:
 *
 * - chave nova no documento vira linha nova;
 * - chave que sumiu do documento tem a linha apagada (a cascata leva
 *   `accessGrants` e `claim` junto);
 * - chave que permanece mantém a linha. Só o `name` acompanha o documento —
 *   `status`, `capacity`, `voiceEnabled`, `accessPolicy` e as concessões são
 *   administrados por `updateOfficeRoom`, e a claim da mesa pertence a quem
 *   sentou nela.
 *
 * É o que separa este caminho do `materializePublication`, que recria tudo
 * porque a publicação de destino é outra.
 */
async function reconcilePublicationEntities(
  tx: Prisma.TransactionClient,
  publicationId: string,
  document: MapDocumentV1,
) {
  const rooms = new Map<string, Extract<MapObjectV1, { type: 'meeting-room' }>>()
  const desks = new Map<string, Extract<MapObjectV1, { type: 'desk' }>>()
  for (const object of document.objects) {
    if (object.type === 'meeting-room') rooms.set(object.properties.externalKey, object)
    else if (object.type === 'desk') desks.set(object.properties.externalKey, object)
  }

  const existingRooms = await tx.officeRoom.findMany({
    where: { mapPublicationId: publicationId },
    select: { id: true, externalKey: true, name: true },
  })
  const goneRooms = existingRooms.filter((room) => !rooms.has(room.externalKey))
  if (goneRooms.length) {
    await tx.officeRoom.deleteMany({ where: { id: { in: goneRooms.map((room) => room.id) } } })
  }
  const knownRoomKeys = new Set(existingRooms.map((room) => room.externalKey))
  const newRooms = [...rooms.entries()].filter(([externalKey]) => !knownRoomKeys.has(externalKey))
  if (newRooms.length) {
    await tx.officeRoom.createMany({
      data: newRooms.map(([externalKey, object]) => ({
        mapPublicationId: publicationId,
        externalKey,
        name: object.properties.name,
        status: object.properties.status,
        capacity: object.properties.capacity ?? null,
        voiceEnabled: object.properties.voiceEnabled,
        accessPolicy: object.properties.accessPolicy,
      })),
    })
  }
  for (const room of existingRooms) {
    const object = rooms.get(room.externalKey)
    if (!object || object.properties.name === room.name) continue
    await tx.officeRoom.update({ where: { id: room.id }, data: { name: object.properties.name } })
  }

  const existingDesks = await tx.officeDesk.findMany({
    where: { mapPublicationId: publicationId },
    select: { id: true, externalKey: true, name: true },
  })
  const goneDesks = existingDesks.filter((desk) => !desks.has(desk.externalKey))
  if (goneDesks.length) {
    await tx.officeDesk.deleteMany({ where: { id: { in: goneDesks.map((desk) => desk.id) } } })
  }
  const knownDeskKeys = new Set(existingDesks.map((desk) => desk.externalKey))
  const newDesks = [...desks.entries()].filter(([externalKey]) => !knownDeskKeys.has(externalKey))
  if (newDesks.length) {
    await tx.officeDesk.createMany({
      data: newDesks.map(([externalKey, object]) => ({
        mapPublicationId: publicationId,
        externalKey,
        name: object.properties.name,
      })),
    })
  }
  for (const desk of existingDesks) {
    const object = desks.get(desk.externalKey)
    if (!object || object.properties.name === desk.name) continue
    await tx.officeDesk.update({ where: { id: desk.id }, data: { name: object.properties.name } })
  }
}

/**
 * Empurra o documento que acabou de ser substituído no anel de revisões e
 * descarta o que passar de `OFFICE_DECOR_REVISION_RING`.
 */
async function pushDecorRevision(
  tx: Prisma.TransactionClient,
  publicationId: string,
  revision: number,
  mapData: Prisma.InputJsonValue,
  createdById: string,
) {
  await tx.officeMapDecorRevision.create({ data: { publicationId, revision, mapData, createdById } })
  const oldest = await tx.officeMapDecorRevision.findMany({
    where: { publicationId },
    orderBy: { revision: 'desc' },
    skip: OFFICE_DECOR_REVISION_RING,
    select: { id: true },
  })
  if (oldest.length) {
    await tx.officeMapDecorRevision.deleteMany({ where: { id: { in: oldest.map((row) => row.id) } } })
  }
}

/**
 * Salvamento colaborativo de decoração. Faz um merge 3-vias (base = revisão
 * que o editor abriu; mine = documento local; theirs = documento ativo) e
 * grava o resultado IN-PLACE na publicação ativa — sem criar publicação nova
 * (card 22041). `base`/`theirs` sempre passam por `canonicalDocument`, assim
 * como `mine`: sem isso, a mesma comparação de reordenação de chaves do
 * Postgres (ver comentário de `canonicalDocument`) faria o guard estrutural
 * acusar falsos positivos (ex.: `SPAWN_CHANGED`) em qualquer merge legítimo.
 */
export async function mergeAndPublishDecoration(
  input: { baseRevision: number; document: unknown; basePublicationId?: string },
  actor: OfficeMapActor,
  companyId: string,
): Promise<OfficeDecorSaveResultDTO> {
  const mapId = await getActiveMapIdForEditing(companyId)

  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    fail(describeMalformedDocument(structural.error), 400, 'MAP_DOCUMENT_MALFORMED', {
      issues: structural.error.issues,
    })
  }
  const mineRaw: MapDocumentV1 = canonicalDocument(structural.data)

  let result: OfficeDecorSaveResultDTO | null = null
  let publicationId = ''
  for (let attempt = 1; attempt <= DECOR_SAVE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const saved = await scopedPrisma(companyId).$transaction(async (tx) => {
        const client = tx as unknown as Prisma.TransactionClient
        const active = await client.officeMapPublication.findFirst({
          where: { mapId, activeSetting: { companyId } },
          select: { id: true, decorRevision: true, mapData: true },
        })
        if (!active) fail('Nenhum mapa foi publicado para o escritório', 404, 'ACTIVE_MAP_NOT_FOUND')

        const theirs = canonicalDocument(active.mapData)
        // Sem ninguém no meio, o que o editor abriu é o que está gravado.
        // Com alguém no meio, a base é o snapshot do anel daquela revisão.
        //
        // Quando não dá pra saber contra o que o cliente editou, o merge vira
        // ADITIVO. Duas situações levam a isso, e as duas são reais:
        //
        // - a âncora é de OUTRA publicação (o admin publicou enquanto a pessoa
        //   decorava). Publicação nova nasce com `decorRevision` 0, então a
        //   âncora bate por coincidência numérica e nem chegaria ao anel;
        // - a revisão já saiu do anel (mais de OFFICE_DECOR_REVISION_RING saves
        //   atrás).
        //
        // Antes, os dois casos caíam num 2-vias com `base = theirs` COM
        // remoções: todo objeto do mapa vivo ausente do documento do cliente
        // parecia remoção dele, e o Salvar de quem estava decorando revertia o
        // publish inteiro do admin.
        const anchoredHere = input.basePublicationId === undefined || input.basePublicationId === active.id
        let base = theirs
        let additive = !anchoredHere
        if (anchoredHere && input.baseRevision !== active.decorRevision) {
          const snapshot = await client.officeMapDecorRevision.findUnique({
            where: { publicationId_revision: { publicationId: active.id, revision: input.baseRevision } },
            select: { mapData: true },
          })
          if (snapshot) base = canonicalDocument(snapshot.mapData)
          else additive = true
        }

        const mine = stampObjectOwnership(base, mineRaw, actor)

        // Guarda contra a MINHA edição em relação ao que eu abri (`base`), não
        // contra o resultado do merge: `mergeDecoration` sempre herda map/layers
        // de `theirs`, então uma edição estrutural minha desapareceria em
        // silêncio no merge em vez de ser rejeitada — e comparar contra `theirs`
        // também acusaria falso positivo se OUTRO save (ex.: do admin) mudou
        // a estrutura enquanto eu editava, sem culpa minha.
        //
        // No modo aditivo não existe base confiável: `base` É `theirs`, então
        // as checagens estruturais acusariam justamente a mudança do admin e
        // devolveriam 403 a quem não fez nada de errado. Ali sobra só a parte
        // que o merge de fato aplica — usuário comum não altera objeto
        // protegido — e só sobre os objetos que os dois lados conhecem.
        const isAdmin = isFullAdmin(actor)
        let guard
        if (additive) {
          const mineIds = new Set(mine.objects.map((o) => o.id))
          guard = assertProtectedObjectsUntouched(
            base.objects.filter((o) => mineIds.has(o.id)),
            mine.objects,
            { isAdmin },
          )
        } else {
          guard = assertOnlyDecorationChanged(base, mine, { isAdmin })
        }
        if (!guard.ok) {
          fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
        }

        const merged = mergeDecoration(base, mine, theirs, { additive })
        const validation = await validateDocument(mapId, merged, companyId, client)
        if (!validation.valid || !validation.document) {
          fail('O mapa possui erros e não pode ser publicado', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
        }
        const document = validation.document as MapDocumentV1

        // Guarda otimista: a transação é Serializable, mas contar as linhas
        // afetadas torna a corrida explícita e independente do nível de
        // isolamento — `count === 0` significa que o `decorRevision` mudou
        // debaixo desta leitura.
        const written = await client.officeMapPublication.updateMany({
          where: { id: active.id, decorRevision: active.decorRevision },
          data: {
            mapData: document as unknown as Prisma.InputJsonValue,
            decorRevision: active.decorRevision + 1,
          },
        })
        if (written.count === 0) throw new DecorRevisionConflict()

        await pushDecorRevision(
          client,
          active.id,
          active.decorRevision,
          active.mapData as Prisma.InputJsonValue,
          actor.id,
        )
        await reconcilePublicationEntities(client, active.id, document)

        return { publicationId: active.id, decorRevision: active.decorRevision + 1, document }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...PUBLISH_TRANSACTION_TIMEOUT })

      publicationId = saved.publicationId
      result = { decorRevision: saved.decorRevision, document: saved.document }
      break
    } catch (err) {
      if (!isRetryableDecorConflict(err)) throw err
      if (attempt < DECOR_SAVE_MAX_ATTEMPTS) continue
      fail('Outra edição foi salva primeiro — recarregue o mapa', 409, 'DECOR_REVISION_CONFLICT')
    }
  }
  if (!result) fail('Não foi possível salvar a decoração', 409, 'DECOR_REVISION_CONFLICT')

  // Publicação suave: mantém presença e faz refresh suave em todos (inclusive
  // editores sem alterações locais).
  getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), false, true)
  getOfficeHub(companyId).broadcastMapDecorUpdated(publicationId)

  return result
}

export async function acquireOfficeMapLock(mapId: string, userId: string, companyId: string): Promise<OfficeMapLockDTO> {
  await requireMap(mapId, companyId)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
  if (!user) fail('Usuário não encontrado', 404, 'USER_NOT_FOUND')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + MAP_DOCUMENT_V1_LIMITS.editLockTtlMs)
  const lockToken = randomBytes(32).toString('base64url')
  const db = scopedPrisma(companyId)
  const existing = await db.officeMapEditLock.findUnique({
    where: { mapId },
    include: { user: { select: { id: true, name: true } } },
  })
  if (existing && existing.expiresAt > now && existing.userId !== userId) {
    fail('Este mapa já está sendo editado', 423, 'MAP_LOCKED', {
      expiresAt: existing.expiresAt.toISOString(),
      owner: existing.user,
    })
  }
  // `OfficeMapEditLock` é tenant-scoped, e `scopedPrisma` não suporta `upsert` (levanta
  // `TenantScopeError` de propósito) — `find` já foi feito acima (`existing`), decide
  // entre `create`/`update` explicitamente.
  if (existing) {
    await db.officeMapEditLock.update({
      where: { mapId },
      data: { userId, tokenHash: tokenHash(lockToken), expiresAt },
    })
  } else {
    try {
      await db.officeMapEditLock.create({
        data: { mapId, userId, tokenHash: tokenHash(lockToken), expiresAt },
      })
    } catch (err) {
      // catch P2002: handles concurrent-acquire race (two acquireOfficeMapLock calls can
      // both see `existing === null` above before either inserts; the second insert
      // violates the unique constraint on mapId — translate to the same domain error the
      // synchronous `existing` check above would have thrown).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const current = await db.officeMapEditLock.findUnique({
          where: { mapId },
          include: { user: { select: { id: true, name: true } } },
        })
        fail('Este mapa já está sendo editado', 423, 'MAP_LOCKED', {
          expiresAt: current?.expiresAt.toISOString() ?? null,
          owner: current?.user ?? null,
        })
      }
      throw err
    }
  }
  return { lockToken, expiresAt: expiresAt.toISOString(), owner: user }
}

export async function heartbeatOfficeMapLock(mapId: string, userId: string, lockToken: string, companyId: string) {
  await requireLock(mapId, userId, lockToken, companyId)
  const expiresAt = new Date(Date.now() + MAP_DOCUMENT_V1_LIMITS.editLockTtlMs)
  await scopedPrisma(companyId).officeMapEditLock.update({ where: { mapId }, data: { expiresAt } })
  return { expiresAt: expiresAt.toISOString() }
}

export async function releaseOfficeMapLock(mapId: string, userId: string, lockToken: string, companyId: string) {
  const deleted = await scopedPrisma(companyId).officeMapEditLock.deleteMany({
    where: { mapId, userId, tokenHash: tokenHash(lockToken) },
  })
  if (deleted.count !== 1) fail('Lock de edição inválido', 423, 'MAP_LOCKED')
}

export async function listOfficeMapAssets(mapId: string, companyId: string): Promise<OfficeMapAssetDTO[]> {
  await requireMap(mapId, companyId)
  const db = scopedPrisma(companyId)
  const [assets, draft] = await Promise.all([
    db.officeMapAsset.findMany({ where: { mapId }, orderBy: { createdAt: 'asc' } }),
    db.officeMapDraft.findUnique({ where: { mapId }, select: { document: true } }),
  ])
  const dto = assets.map(asAsset)
  // Builtins não têm linha em OfficeMapAsset, mas o editor resolve a textura de
  // cada tileset por esta listagem: sem eles a mobília do rascunho fica invisível.
  const structural = MapDocumentV1StructuralSchema.safeParse(draft?.document)
  return structural.success ? withBuiltinAssets(structural.data, dto) : dto
}

export async function uploadOfficeMapAsset(mapId: string, userId: string, file: UploadedOfficeMapAsset, companyId: string) {
  await requireMap(mapId, companyId)
  const db = scopedPrisma(companyId)
  const cfg = s3Config()
  if (!cfg) fail('O armazenamento S3 não está configurado', 503, 'S3_DISABLED')
  const image = inspectImage(file)
  const digest = checksum(file.buffer)
  const existing = await db.officeMapAsset.findUnique({
    where: { mapId_checksum: { mapId, checksum: digest } },
  })
  if (existing) return asAsset(existing)
  const aggregate = await db.officeMapAsset.aggregate({ where: { mapId }, _sum: { sizeBytes: true } })
  if ((aggregate._sum.sizeBytes ?? 0) + file.buffer.length > MAP_DOCUMENT_V1_LIMITS.maxAssetsBytesPerMap) {
    fail('Os assets deste mapa excedem o limite de 100 MB', 413, 'MAP_ASSETS_TOO_LARGE')
  }
  const id = randomUUID()
  const key = `office-maps/${mapId}/${id}.${image.extension}`
  await putS3Object({ key, contentType: image.mimeType, body: file.buffer })
  try {
    const asset = await db.officeMapAsset.create({
      data: {
        id,
        mapId,
        fileName: basename(file.filename.replaceAll('\\', '/')).slice(0, 255) || `tileset.${image.extension}`,
        mimeType: image.mimeType,
        sizeBytes: file.buffer.length,
        width: image.width,
        height: image.height,
        checksum: digest,
        storageKey: key,
        createdById: userId,
      },
    })
    await recordAuditLog({ actorId: userId, entityType: 'OfficeMapAsset', entityId: asset.id, action: 'CREATE', after: asset, companyId })
    return asAsset(asset)
  } catch (error) {
    await deleteS3Object(key).catch(() => undefined)
    throw error
  }
}

export async function deleteOfficeMapAsset(mapId: string, assetId: string, actorId: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const asset = await db.officeMapAsset.findFirst({
    where: { id: assetId, mapId },
    include: { _count: { select: { publicationLinks: true } } },
  })
  if (!asset) fail('Asset não encontrado', 404, 'ASSET_NOT_FOUND')
  if (asset._count.publicationLinks > 0) fail('Assets publicados não podem ser excluídos', 409, 'ASSET_IS_PUBLISHED')
  await db.officeMapAsset.delete({ where: { id: assetId } })
  await recordAuditLog({ actorId, entityType: 'OfficeMapAsset', entityId: assetId, action: 'DELETE', before: asset, companyId })
  if (!asset.storageKey.startsWith('builtin:')) await deleteS3Object(asset.storageKey).catch(() => undefined)
}

export async function validateOfficeMapDraft(mapId: string, revision: number, companyId: string) {
  await requireMap(mapId, companyId)
  const draft = await scopedPrisma(companyId).officeMapDraft.findUnique({ where: { mapId } })
  if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
  if (draft.revision !== revision) {
    fail('A revisão informada não é a atual', 409, 'DRAFT_REVISION_CONFLICT', { currentRevision: draft.revision })
  }
  const result = await validateDocument(mapId, draft.document, companyId)
  return { valid: result.valid, errors: result.errors }
}

type PublicationValidation = Omit<Awaited<ReturnType<typeof validateDocument>>, 'document'> & {
  document: NonNullable<Awaited<ReturnType<typeof validateDocument>>['document']>
}

/**
 * `materializePublication` faz várias idas e vindas sequenciais ao banco
 * (lookups + criações em lote) dentro de UMA transação interativa. O padrão
 * do Prisma (`maxWait: 2s`, `timeout: 5s`) já se mostrou curto demais contra
 * um banco com latência de rede real (não localhost) — a transação fecha no
 * meio (`Transaction API error: ... refers to an old closed transaction`)
 * mesmo depois de reduzir os round-trips pra criação de salas/mesas em lote
 * (`createMany`). Publicar mapa é uma ação rara/administrativa, não um
 * caminho quente, então vale trocar latência por uma folga maior de timeout
 * em vez de tentar espremer mais round-trips.
 */
const PUBLISH_TRANSACTION_TIMEOUT = { maxWait: 10_000, timeout: 30_000 } as const

/**
 * Mantém no máximo `OFFICE_MAP_PUBLICATION_LIMIT` publicações por mapa: a
 * recém-criada, a ATIVA e, completando o teto, as mais recentes por `version`.
 *
 * A ATIVA nunca é podada, mesmo quando já saiu da janela das mais recentes
 * (admin reativou uma versão antiga à mão): `OfficeSetting.activeMapPublicationId`
 * é `SetNull`, então apagá-la deixaria o escritório sem mapa em vez de dar erro.
 * Nesse caso ela OCUPA uma das vagas — o teto é `OFFICE_MAP_PUBLICATION_LIMIT`
 * de verdade, e a mais antiga da janela é quem sai.
 *
 * Com o save de decoração fora deste caminho (grava in-place), publicação
 * voltou a ser rara e a poda quase nunca tem trabalho — mas fecha o teto.
 */
async function pruneMapPublications(
  tx: Prisma.TransactionClient,
  mapId: string,
  keepId: string,
  activeId: string | null,
) {
  // Lê só a janela (`take`) e apaga por exclusão (`notIn`), sem varrer as
  // publicações antigas: dentro de uma transação Serializable, um SELECT
  // aberto sobre todas as linhas do mapa amplia o predicate lock do SSI a
  // ponto de o próprio `create` desta publicação abortar com P2034.
  const recent = await tx.officeMapPublication.findMany({
    where: { mapId },
    orderBy: { version: 'desc' },
    take: OFFICE_MAP_PUBLICATION_LIMIT,
    select: { id: true },
  })
  const keep = new Set(recent.map((row) => row.id))
  keep.add(keepId)
  if (activeId && !keep.has(activeId)) {
    // A ativa saiu da janela (admin reativou uma versão antiga): ela toma a
    // vaga da mais antiga da janela em vez de estourar o teto.
    const oldestInWindow = recent[recent.length - 1]
    if (oldestInWindow && oldestInWindow.id !== keepId) keep.delete(oldestInWindow.id)
    keep.add(activeId)
  }
  await tx.officeMapPublication.deleteMany({ where: { mapId, id: { notIn: [...keep] } } })
}

async function materializePublication(
  tx: Prisma.TransactionClient,
  mapId: string,
  map: Awaited<ReturnType<typeof requireMap>>,
  userId: string,
  activate: boolean,
  validation: PublicationValidation,
  companyId: string,
) {
  const latest = await tx.officeMapPublication.aggregate({ where: { mapId }, _max: { version: true } })
  const version = (latest._max.version ?? 0) + 1
  const setting = await prisma.officeSetting.findUnique({ where: { companyId }, select: { activeMapPublicationId: true } })
  const previousRooms = setting?.activeMapPublicationId
    ? await tx.officeRoom.findMany({
        where: { mapPublicationId: setting.activeMapPublicationId },
        include: { accessGrants: { select: { userId: true } } },
      })
    : []
  const previousByKey = new Map(previousRooms.map((room) => [room.externalKey, room]))
  const previousDesks = setting?.activeMapPublicationId
    ? await tx.officeDesk.findMany({
        where: { mapPublicationId: setting.activeMapPublicationId },
        include: { claim: true },
      })
    : []
  const previousDeskByKey = new Map(previousDesks.map((desk) => [desk.externalKey, desk]))
  const publication = await tx.officeMapPublication.create({
    data: {
      mapId,
      createdById: userId,
      version,
      schemaVersion: validation.document.schemaVersion,
      mapData: validation.document as unknown as Prisma.InputJsonValue,
    },
    select: publicationSelect,
  })
  await recordAuditLog({ actorId: userId, entityType: 'OfficeMapPublication', entityId: publication.id, action: 'CREATE', after: publication, companyId, tx })
  if (validation.assets.length) {
    await tx.officeMapPublicationAsset.createMany({
      data: validation.assets.map((asset) => ({ publicationId: publication.id, assetId: asset.id })),
    })
  }
  // Antes, cada sala/mesa era um `create` (+ eventuais `create`s de claim)
  // AWAITADO individualmente dentro desta MESMA transação interativa — em
  // mapas com bastante mobília/mesas, N round-trips sequenciais ao Postgres
  // (mais ainda contra um banco remoto/homolog) estouram o timeout padrão de
  // 5s do Prisma pra transações interativas, e a transação fecha no meio do
  // loop ("Transaction not found ... refere-se a uma transação já fechada").
  // Agora todo mundo é montado em memória com um `id` já gerado (cuid é só
  // convenção do Prisma — um `randomUUID()` nosso serve igual como PK) e
  // inserido em lote (`createMany`), então o custo em round-trips não cresce
  // com o tamanho do mapa. `createMany` é interceptado por `scopedPrisma` —
  // `companyId` é injetado em cada linha automaticamente contanto que `tx`
  // venha de `scopedPrisma(companyId).$transaction(...)` (ver publishOfficeMap
  // / mergeAndPublishDecoration).
  const roomsToCreate: Prisma.OfficeRoomCreateManyInput[] = []
  const roomAccessGrants: Prisma.OfficeRoomAccessGrantCreateManyInput[] = []
  const desksToCreate: Prisma.OfficeDeskCreateManyInput[] = []
  const deskClaims: Prisma.OfficeDeskClaimCreateManyInput[] = []
  const claimUserIdsToReplace: string[] = []
  for (const object of validation.document.objects) {
    if (object.type === 'meeting-room') {
      const previous = previousByKey.get(object.properties.externalKey)
      const roomId = randomUUID()
      roomsToCreate.push({
        id: roomId,
        mapPublicationId: publication.id,
        externalKey: object.properties.externalKey,
        name: object.properties.name,
        status: previous?.status ?? object.properties.status,
        capacity: previous?.capacity ?? object.properties.capacity ?? null,
        voiceEnabled: previous?.voiceEnabled ?? object.properties.voiceEnabled,
        accessPolicy: previous?.accessPolicy ?? object.properties.accessPolicy,
      })
      for (const { userId: grantedUserId } of previous?.accessGrants ?? []) {
        roomAccessGrants.push({ roomId, userId: grantedUserId })
      }
      continue
    }
    if (object.type === 'desk') {
      const previous = previousDeskByKey.get(object.properties.externalKey)
      const deskId = randomUUID()
      desksToCreate.push({
        id: deskId,
        mapPublicationId: publication.id,
        externalKey: object.properties.externalKey,
        name: object.properties.name,
      })
      if (previous?.claim) {
        // A claim anterior ainda existe presa à mesa antiga (superada por esta
        // publicação) — `userId` é @unique em OfficeDeskClaim, então precisa sumir
        // antes do create abaixo, senão republicar com uma mesa ocupada quebra com
        // violação de unicidade.
        claimUserIdsToReplace.push(previous.claim.userId)
        deskClaims.push({ deskId, userId: previous.claim.userId })
      }
    }
  }
  if (roomsToCreate.length) await tx.officeRoom.createMany({ data: roomsToCreate })
  if (roomAccessGrants.length) await tx.officeRoomAccessGrant.createMany({ data: roomAccessGrants })
  if (desksToCreate.length) await tx.officeDesk.createMany({ data: desksToCreate })
  if (claimUserIdsToReplace.length) {
    await tx.officeDeskClaim.deleteMany({ where: { userId: { in: claimUserIdsToReplace } } })
  }
  if (deskClaims.length) await tx.officeDeskClaim.createMany({ data: deskClaims })
  if (activate) {
    // Mapa novo, reivindicações zeradas: quem tinha mesa com o mesmo
    // `externalKey` acabou de ser migrado logo acima; o resto ficaria preso a
    // uma mesa que não existe mais no mapa ativo — invisível na tela, sem como
    // abandonar, e ocupando o @unique por usuário. Foi assim que 22 pessoas
    // travaram em HML.
    await tx.officeDeskClaim.deleteMany({ where: { desk: { mapPublicationId: { not: publication.id } } } })
  }
  const roomsCreated = roomsToCreate.length
  const desksCreated = desksToCreate.length
  await pruneMapPublications(tx, mapId, publication.id, activate ? publication.id : setting?.activeMapPublicationId ?? null)
  if (activate) {
    // Precisa ser `tx`, não `prisma`: `publication` foi criada NESTA MESMA
    // transação ainda não commitada — via `prisma` (outra conexão), a FK
    // `activeMapPublicationId` não enxerga a linha e o upsert quebra com
    // "Foreign key constraint violated".
    await tx.officeSetting.upsert({
      where: { companyId },
      create: { companyId, activeMapPublicationId: publication.id },
      update: { activeMapPublicationId: publication.id },
    })
  }
  return {
    publication: asPublication(publication, activate ? publication.id : setting?.activeMapPublicationId ?? null),
    version,
    roomsCreated,
    desksCreated,
    activated: activate,
    map,
  }
}

export async function publishOfficeMap(
  mapId: string,
  revision: number,
  userId: string,
  activate: boolean,
  companyId: string,
  options: { soft?: boolean } = {},
) {
  const map = await requireMap(mapId, companyId)
  const result = await scopedPrisma(companyId).$transaction(async (tx) => {
    const draft = await tx.officeMapDraft.findUnique({ where: { mapId } })
    if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
    if (draft.revision !== revision) {
      fail('A revisão informada não é a atual', 409, 'DRAFT_REVISION_CONFLICT', { currentRevision: draft.revision })
    }
    // Dentro da transação de propósito: um save de decoração que caia entre a
    // leitura e o commit precisa fazer o Serializable abortar ESTE publish, não
    // ser silenciosamente sobrescrito por ele. Publicar é raro e o admin vê o
    // erro e repete; decoração perdida ninguém vê. São as mesmas leituras que
    // `mergeAndPublishDecoration` já faz sob Serializable.
    const rebased = await rebaseDraftOnActiveMap(mapId, draft, companyId, tx as unknown as Prisma.TransactionClient)
    const toPublish = rebased?.document ?? draft.document
    const validation = await validateDocument(mapId, toPublish, companyId, tx as unknown as Prisma.TransactionClient)
    if (!validation.valid || !validation.document) {
      fail('O mapa possui erros e não pode ser publicado', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
    }
    const published = await materializePublication(tx as unknown as Prisma.TransactionClient, mapId, map, userId, activate, validation, companyId)
    // O rascunho passa a ser exatamente o que foi publicado, ancorado na
    // publicação nova (que nasce com `decorRevision` 0). Sem isto o editor
    // aberto continuaria com o documento pré-merge e o autosave seguinte
    // desfaria o merge. A `revision` NÃO muda de propósito: o cliente adota
    // `document` na resposta e segue com a revisão que já tem em mãos.
    await tx.officeMapDraft.update({
      where: { mapId },
      data: {
        document: validation.document as unknown as Prisma.InputJsonValue,
        // Publicar sem ativar não mexe no mapa vivo: a âncora atual continua
        // valendo e não pode ser trocada pela publicação recém-criada.
        ...(activate ? { basePublicationId: published.publication.id, baseDecorRevision: 0 } : {}),
      },
    })
    return { ...published, document: validation.document }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...PUBLISH_TRANSACTION_TIMEOUT })
  if (activate) {
    if (options.soft) {
      // keepPresence: não desconecta ninguém; o broadcast abaixo alcança as
      // entries preservadas para um refresh suave (sem reload).
      getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), false, true)
      getOfficeHub(companyId).broadcastMapDecorUpdated(result.publication.id)
    } else {
      getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), true)
    }
  }
  return result
}

export async function listOfficeMapPublications(mapId: string, companyId: string) {
  await requireMap(mapId, companyId)
  const [activeId, publications] = await Promise.all([
    activePublicationId(companyId),
    scopedPrisma(companyId).officeMapPublication.findMany({ where: { mapId }, orderBy: { version: 'desc' }, select: publicationSelect }),
  ])
  return publications.map((publication) => asPublication(publication, activeId))
}

export async function getOfficeMapPublication(mapId: string, publicationId: string, companyId: string) {
  const publication = await scopedPrisma(companyId).officeMapPublication.findFirst({
    where: { id: publicationId, mapId },
    include: {
      createdBy: { select: { id: true, name: true } },
      assetLinks: { include: { asset: true } },
      rooms: { include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } } },
      map: { select: { id: true, name: true } },
    },
  })
  if (!publication) fail('Publicação não encontrada', 404, 'PUBLICATION_NOT_FOUND')
  const activeId = await activePublicationId(companyId)
  const document = publication.mapData as unknown as MapDocumentV1
  return {
    ...asPublication(publication, activeId),
    map: publication.map,
    document,
    assets: withBuiltinAssets(document, publication.assetLinks.map(({ asset }) => asAsset(asset))),
    rooms: publication.rooms.map(asRoom),
  }
}

export async function activateOfficeMapPublication(publicationId: string, actorId: string, companyId: string) {
  const publication = await scopedPrisma(companyId).officeMapPublication.findUnique({ where: { id: publicationId }, select: { id: true, mapId: true } })
  if (!publication) fail('Publicação não encontrada', 404, 'PUBLICATION_NOT_FOUND')
  await prisma.officeSetting.upsert({
    where: { companyId },
    create: { companyId, activeMapPublicationId: publication.id },
    update: { activeMapPublicationId: publication.id },
  })
  await recordAuditLog({ actorId, entityType: 'OfficeMapPublication', entityId: publication.id, action: 'UPDATE', after: { activated: true }, companyId })
  getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), true)
  return { activeMapPublicationId: publication.id, mapId: publication.mapId }
}

function asRoom(room: {
  id: string
  name: string
  externalKey: string
  status: 'OPEN' | 'LOCKED'
  capacity: number | null
  voiceEnabled: boolean
  accessPolicy: 'OPEN' | 'ALLOWLIST'
  accessGrants: Array<{ user: { id: string; name: string } }>
}): OfficeRoomDTO {
  return {
    id: room.id,
    name: room.name,
    externalKey: room.externalKey,
    status: room.status,
    capacity: room.capacity,
    voiceEnabled: room.voiceEnabled,
    accessPolicy: room.accessPolicy,
    allowedUsers: room.accessGrants.map(({ user }) => user),
  }
}

export async function listActiveOfficeRooms(companyId: string): Promise<OfficeRoomDTO[]> {
  const activeId = await activePublicationId(companyId)
  if (!activeId) return []
  const rooms = await scopedPrisma(companyId).officeRoom.findMany({
    where: { mapPublicationId: activeId },
    orderBy: { name: 'asc' },
    include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } },
  })
  return rooms.map(asRoom)
}

function asDesk(desk: {
  id: string
  name: string
  externalKey: string
  claim: { user: { id: string; name: string } } | null
}): OfficeDeskDTO {
  return {
    id: desk.id,
    name: desk.name,
    externalKey: desk.externalKey,
    claimedBy: desk.claim?.user ?? null,
  }
}

function asDeskReminderSummary(reminder: {
  id: string
  deskId: string
  giftX: number
  giftY: number
  createdAt: Date
  sender: { id: string; name: string }
  recipientId: string
  desk: { externalKey: string }
}): OfficeDeskReminderSummaryDTO {
  return {
    id: reminder.id,
    deskId: reminder.deskId,
    deskExternalKey: reminder.desk.externalKey,
    giftPosition: { x: reminder.giftX, y: reminder.giftY },
    sender: reminder.sender,
    recipientId: reminder.recipientId,
    createdAt: reminder.createdAt.toISOString(),
  }
}

function asDeskReminderDetail(
  reminder: {
    id: string
    deskId: string
    createdAt: Date
    sender: { id: string; name: string }
    recipientId: string
    message: string
    giftX: number
    giftY: number
    desk: { externalKey: string }
  },
  canRead: boolean,
): OfficeDeskReminderDetailDTO {
  return {
    ...asDeskReminderSummary(reminder),
    message: canRead ? reminder.message : null,
    canRead,
  }
}

export async function listActiveOfficeDesks(companyId: string): Promise<OfficeDeskDTO[]> {
  const activeId = await activePublicationId(companyId)
  if (!activeId) return []
  const desks = await scopedPrisma(companyId).officeDesk.findMany({
    where: { mapPublicationId: activeId },
    orderBy: { name: 'asc' },
    include: { claim: { include: { user: { select: { id: true, name: true } } } } },
  })
  return desks.map(asDesk)
}

export async function listActiveOfficeDeskReminders(companyId: string): Promise<OfficeDeskReminderSummaryDTO[]> {
  const activeId = await activePublicationId(companyId)
  if (!activeId) return []
  const reminders = await scopedPrisma(companyId).officeDeskReminder.findMany({
    where: {
      readAt: null,
      desk: {
        mapPublicationId: activeId,
        claim: { isNot: null },
      },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      sender: { select: { id: true, name: true } },
      desk: { select: { externalKey: true } },
    },
  })
  return reminders.map(asDeskReminderSummary)
}

export async function claimOfficeDesk(deskId: string, userId: string, companyId: string): Promise<OfficeDeskDTO> {
  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const desk = await db.officeDesk.findFirst({ where: { id: deskId, mapPublicationId: activeId ?? '__none__' } })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  const existingClaimOnDesk = await db.officeDeskClaim.findUnique({ where: { deskId } })
  if (existingClaimOnDesk) fail('Esta mesa já está ocupada', 409, 'DESK_ALREADY_CLAIMED')
  // O bloqueio é por MAPA ATIVO, não por usuário no banco inteiro. `userId` é
  // @unique em OfficeDeskClaim (uma mesa por pessoa), mas a claim vive presa a
  // uma mesa de UMA publicação: quando o mapa muda, a que não foi migrada para
  // a publicação nova não vale mais. Contá-la travava a pessoa para sempre —
  // barrava o claim aqui e o release recusava a mesa antiga com 404. Por isso a
  // claim superada é apagada em vez de recusar: sem isso o @unique derrubaria o
  // create abaixo com P2002.
  const existingClaimByUser = await db.officeDeskClaim.findUnique({
    where: { userId },
    include: { desk: { select: { mapPublicationId: true } } },
  })
  if (existingClaimByUser) {
    if (existingClaimByUser.desk.mapPublicationId === activeId) {
      fail('Você já ocupa outra mesa — abandone-a antes de reivindicar outra', 409, 'DESK_USER_ALREADY_HAS_DESK')
    }
    await db.officeDeskClaim.delete({ where: { userId } })
  }
  try {
    await db.officeDeskClaim.create({ data: { deskId, userId } })
  } catch (err) {
    // catch P2002: handles concurrent-claim race (two claimOfficeDesk calls can both
    // pass the findUnique checks above before either inserts; the second insert
    // violates the unique constraint on deskId or userId — translate to the same
    // domain error the synchronous check would have thrown).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = err.meta?.target
      const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : []
      if (fields.includes('userId')) {
        fail('Você já ocupa outra mesa — abandone-a antes de reivindicar outra', 409, 'DESK_USER_ALREADY_HAS_DESK')
      }
      fail('Esta mesa já está ocupada', 409, 'DESK_ALREADY_CLAIMED')
    }
    throw err
  }
  const updated = await db.officeDesk.findUniqueOrThrow({
    where: { id: deskId },
    include: { claim: { include: { user: { select: { id: true, name: true } } } } },
  })
  return asDesk(updated)
}

export async function createOfficeDeskReminder(
  deskId: string,
  senderId: string,
  message: string,
  giftPosition: { x: number; y: number },
  companyId: string,
): Promise<OfficeDeskReminderSummaryDTO> {
  const trimmed = message.trim()
  if (trimmed.length < 1) fail('Escreva uma mensagem para deixar o lembrete', 400, 'DESK_REMINDER_MESSAGE_REQUIRED')
  if (trimmed.length > 500) fail('O lembrete pode ter no máximo 500 caracteres', 400, 'DESK_REMINDER_MESSAGE_TOO_LONG')

  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const desk = await db.officeDesk.findFirst({
    where: { id: deskId, mapPublicationId: activeId ?? '__none__' },
    include: {
      claim: { include: { user: { select: { id: true, name: true } } } },
    },
  })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  if (!desk.claim) fail('Só é possível deixar lembrete em uma mesa reivindicada', 409, 'DESK_NOT_CLAIMED')
  if (desk.claim.userId === senderId) fail('Você não pode deixar lembrete na sua própria mesa', 403, 'DESK_REMINDER_OWN_DESK')

  const reminder = await db.officeDeskReminder.create({
    data: {
      deskId,
      senderId,
      recipientId: desk.claim.userId,
      message: trimmed,
      giftX: giftPosition.x,
      giftY: giftPosition.y,
    },
    include: {
      sender: { select: { id: true, name: true } },
      desk: { select: { externalKey: true } },
    },
  })

  await createNotification({
    userId: desk.claim.userId,
    type: 'OFFICE_DESK_REMINDER_RECEIVED',
    actorId: senderId,
    title: `${reminder.sender.name} deixou um lembrete para você na sua mesa.`,
    link: '/escritorio',
    metadata: { reminderId: reminder.id, deskId, deskExternalKey: desk.externalKey },
    companyId,
  })

  return asDeskReminderSummary(reminder)
}

export async function getOfficeDeskReminder(
  reminderId: string,
  viewerId: string,
  companyId: string,
): Promise<OfficeDeskReminderDetailDTO> {
  const reminder = await scopedPrisma(companyId).officeDeskReminder.findFirst({
    where: { id: reminderId, readAt: null },
    include: {
      sender: { select: { id: true, name: true } },
      desk: { select: { externalKey: true, mapPublicationId: true } },
    },
  })
  const activeId = await activePublicationId(companyId)
  if (!reminder || reminder.desk.mapPublicationId !== activeId) {
    fail('Lembrete não encontrado', 404, 'DESK_REMINDER_NOT_FOUND')
  }
  return asDeskReminderDetail(reminder, reminder.recipientId === viewerId)
}

export async function readOfficeDeskReminder(
  reminderId: string,
  readerId: string,
  companyId: string,
): Promise<OfficeDeskReminderSummaryDTO> {
  const db = scopedPrisma(companyId)
  const reminder = await db.officeDeskReminder.findFirst({
    where: { id: reminderId },
    include: {
      sender: { select: { id: true, name: true } },
      recipient: { select: { id: true, name: true } },
      desk: { select: { externalKey: true, mapPublicationId: true } },
    },
  })
  const activeId = await activePublicationId(companyId)
  if (!reminder || reminder.desk.mapPublicationId !== activeId) {
    fail('Lembrete não encontrado', 404, 'DESK_REMINDER_NOT_FOUND')
  }
  if (reminder.recipientId !== readerId) fail('Só o dono da mesa pode ler este lembrete', 403, 'DESK_REMINDER_NOT_RECIPIENT')

  if (!reminder.readAt) {
    const updated = await db.officeDeskReminder.updateMany({
      where: { id: reminderId, readAt: null },
      data: { readAt: new Date() },
    })
    if (updated.count > 0) {
      await createNotification({
        userId: reminder.senderId,
        type: 'OFFICE_DESK_REMINDER_READ',
        actorId: readerId,
        title: `Seu lembrete foi lido por ${reminder.recipient.name}.`,
        link: '/escritorio',
        metadata: { reminderId, deskId: reminder.deskId, deskExternalKey: reminder.desk.externalKey },
        companyId,
      })
    }
  }

  return asDeskReminderSummary(reminder)
}

export async function releaseOfficeDesk(deskId: string, userId: string, companyId: string): Promise<OfficeDeskDTO> {
  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const desk = await db.officeDesk.findFirst({
    where: { id: deskId, mapPublicationId: activeId ?? '__none__' },
    include: { claim: true },
  })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  if (!desk.claim) fail('Esta mesa não está ocupada', 409, 'DESK_NOT_CLAIMED')
  if (desk.claim.userId !== userId) fail('Você não ocupa esta mesa', 403, 'DESK_NOT_OWNER')
  await db.$transaction([
    db.officeDeskReminder.deleteMany({ where: { deskId, readAt: null } }),
    db.officeDeskClaim.delete({ where: { deskId } }),
  ])
  return asDesk({ ...desk, claim: null })
}

export async function adminReleaseOfficeDesk(deskId: string, actorId: string, companyId: string): Promise<OfficeDeskDTO> {
  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const desk = await db.officeDesk.findFirst({
    where: { id: deskId, mapPublicationId: activeId ?? '__none__' },
    include: { claim: true },
  })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  if (!desk.claim) fail('Esta mesa não está ocupada', 409, 'DESK_NOT_CLAIMED')
  await db.$transaction([
    db.officeDeskReminder.deleteMany({ where: { deskId, readAt: null } }),
    db.officeDeskClaim.delete({ where: { deskId } }),
  ])
  await recordAuditLog({ actorId, entityType: 'OfficeDeskClaim', entityId: desk.id, action: 'DELETE', before: desk.claim, companyId })
  return asDesk({ ...desk, claim: null })
}

export async function updateOfficeRoom(
  roomId: string,
  input: {
    status?: 'OPEN' | 'LOCKED'
    capacity?: number | null
    voiceEnabled?: boolean
    accessPolicy?: 'OPEN' | 'ALLOWLIST'
    allowedUserIds?: string[]
  },
  actorId: string,
  companyId: string,
) {
  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const room = await db.officeRoom.findFirst({ where: { id: roomId, mapPublicationId: activeId ?? '__none__' } })
  if (!room) fail('Sala ativa não encontrada', 404, 'ROOM_NOT_FOUND')
  const { allowedUserIds, ...data } = input
  if (allowedUserIds) {
    const count = await prisma.user.count({ where: { id: { in: allowedUserIds }, active: true, companyId } })
    if (count !== new Set(allowedUserIds).size) fail('A lista contém usuários inválidos', 400, 'ROOM_USERS_INVALID')
  }
  await db.$transaction(async (tx) => {
    await tx.officeRoom.update({ where: { id: roomId }, data })
    if (allowedUserIds) {
      await tx.officeRoomAccessGrant.deleteMany({ where: { roomId } })
      if (allowedUserIds.length) {
        await tx.officeRoomAccessGrant.createMany({
          data: [...new Set(allowedUserIds)].map((userId) => ({ roomId, userId })),
        })
      }
    }
    await recordAuditLog({ actorId, entityType: 'OfficeRoom', entityId: roomId, action: 'UPDATE', before: room, after: data, companyId, tx: tx as unknown as Prisma.TransactionClient })
  })
  const updated = await db.officeRoom.findUniqueOrThrow({
    where: { id: roomId },
    include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } },
  })
  // Atualiza as regras autoritativas sem desconectar quem já está na mesma publicação.
  getOfficeHub(companyId).configure(await getActiveOfficeMap(companyId), false)
  return asRoom(updated)
}

export async function getActiveOfficeMap(companyId: string): Promise<ActiveOfficeMapDTO> {
  const setting = await prisma.officeSetting.findUnique({
    where: { companyId },
    include: {
      activeMapPublication: {
        include: {
          createdBy: { select: { id: true, name: true } },
          map: { select: { id: true, name: true } },
          assetLinks: { include: { asset: true } },
          rooms: {
            include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } },
          },
          desks: {
            include: { claim: { include: { user: { select: { id: true, name: true } } } } },
          },
        },
      },
    },
  })
  const publication = setting?.activeMapPublication
  if (!publication) fail('Nenhum mapa foi publicado para o escritório', 404, 'ACTIVE_MAP_NOT_FOUND')
  const rooms = publication.rooms.map(asRoom)
  const document = publication.mapData as unknown as MapDocumentV1
  const dbAssets = publication.assetLinks.map(({ asset }) => asAsset(asset))
  const desks = publication.desks.map(asDesk)
  const deskReminders = await listActiveOfficeDeskReminders(companyId)
  return {
    map: publication.map,
    publication: asPublication(publication, publication.id),
    decorRevision: publication.decorRevision,
    document,
    assets: withBuiltinAssets(document, dbAssets),
    rooms,
    desks,
    deskReminders,
  }
}
