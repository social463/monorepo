import type {
  CreateCultureBenefitRequest,
  CreateCultureManualRequest,
  CreateCulturePersonalAssetRequest,
  CreateCultureVisualAssetRequest,
  UpdateCultureBenefitRequest,
  UpdateCultureManualRequest,
  UpdateCulturePersonalAssetRequest,
  UpdateCultureVisualAssetRequest,
  UpsertCulturePageRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { deleteS3Object, s3Config } from '../lib/s3-client'

export class CultureError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'CultureError'
  }
}

// ---------------------------------------------------------------- páginas

/** Página publicada, como o colaborador vê. Rascunho não vaza para a leitura. */
export async function getPublishedPage(slug: string, companyId: string) {
  const page = await scopedPrisma(companyId).culturePage.findFirst({ where: { slug, published: true } })
  if (!page) throw new CultureError('Conteúdo ainda não publicado.', 404)
  return page
}

/** Página como o admin vê — inclui rascunho; null quando nunca foi escrita. */
export function getPageForAdmin(slug: string, companyId: string) {
  return scopedPrisma(companyId).culturePage.findFirst({ where: { slug } })
}

/**
 * Cria ou atualiza a página do slug. A extensão de isolamento não suporta
 * `upsert` (ver `tenant-scope.ts`), então o caminho é buscar e decidir.
 */
export async function upsertPage(
  slug: string,
  input: UpsertCulturePageRequest,
  companyId: string,
  actorId: string,
) {
  const db = scopedPrisma(companyId)
  const existing = await db.culturePage.findFirst({ where: { slug } })
  const data = {
    title: input.title,
    subtitle: input.subtitle ?? null,
    body: input.body,
    published: input.published ?? false,
    updatedById: actorId,
  }
  if (!existing) {
    return db.culturePage.create({ data: { slug, ...data } })
  }
  return db.culturePage.update({ where: { id: existing.id }, data })
}

// ---------------------------------------------------------------- manuais

export function listPublishedManuals(companyId: string) {
  return scopedPrisma(companyId).cultureManual.findMany({
    where: { published: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
}

export function listManualsForAdmin(companyId: string) {
  return scopedPrisma(companyId).cultureManual.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
}

/** Manual publicado por id — usado pelo download, que não pode servir rascunho. */
export async function getPublishedManual(id: string, companyId: string) {
  const manual = await scopedPrisma(companyId).cultureManual.findFirst({ where: { id, published: true } })
  if (!manual) throw new CultureError('Manual não encontrado.', 404)
  return manual
}

/** Próxima posição livre da lista (a nova entrada nasce no fim). */
async function nextManualOrder(companyId: string): Promise<number> {
  const last = await scopedPrisma(companyId).cultureManual.findFirst({
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  return last ? last.order + 1 : 0
}

export async function createManual(input: CreateCultureManualRequest, companyId: string) {
  return scopedPrisma(companyId).cultureManual.create({
    data: {
      title: input.title,
      description: input.description,
      body: input.body ?? null,
      referenceLabel: input.referenceLabel ?? null,
      fileKey: input.fileKey ?? null,
      fileName: input.fileName ?? null,
      fileSize: input.fileSize ?? null,
      published: input.published ?? true,
      order: await nextManualOrder(companyId),
    },
  })
}

export async function updateManual(id: string, input: UpdateCultureManualRequest, companyId: string) {
  const db = scopedPrisma(companyId)
  const existing = await db.cultureManual.findFirst({ where: { id } })
  if (!existing) throw new CultureError('Manual não encontrado.', 404)
  return db.cultureManual.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.body !== undefined ? { body: input.body ?? null } : {}),
      ...(input.referenceLabel !== undefined ? { referenceLabel: input.referenceLabel ?? null } : {}),
      ...(input.fileKey !== undefined ? { fileKey: input.fileKey ?? null } : {}),
      ...(input.fileName !== undefined ? { fileName: input.fileName ?? null } : {}),
      ...(input.fileSize !== undefined ? { fileSize: input.fileSize ?? null } : {}),
      ...(input.published !== undefined ? { published: input.published } : {}),
    },
  })
}

export async function deleteManual(id: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const existing = await db.cultureManual.findFirst({ where: { id } })
  if (!existing) throw new CultureError('Manual não encontrado.', 404)
  await db.cultureManual.delete({ where: { id } })
  return existing
}

export async function reorderManuals(ids: string[], companyId: string) {
  const db = scopedPrisma(companyId)
  const found = await db.cultureManual.findMany({ where: { id: { in: ids } }, select: { id: true } })
  if (found.length !== ids.length) {
    throw new CultureError('Lista de ordenação não confere com os manuais existentes.', 400)
  }
  await Promise.all(ids.map((id, index) => db.cultureManual.update({ where: { id }, data: { order: index } })))
  return listManualsForAdmin(companyId)
}

// ------------------------------------------------------------- benefícios

export function listPublishedBenefits(companyId: string) {
  return scopedPrisma(companyId).cultureBenefit.findMany({
    where: { published: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
}

export function listBenefitsForAdmin(companyId: string) {
  return scopedPrisma(companyId).cultureBenefit.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
}

async function nextBenefitOrder(companyId: string): Promise<number> {
  const last = await scopedPrisma(companyId).cultureBenefit.findFirst({
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  return last ? last.order + 1 : 0
}

export async function createBenefit(input: CreateCultureBenefitRequest, companyId: string) {
  return scopedPrisma(companyId).cultureBenefit.create({
    data: {
      title: input.title,
      summary: input.summary,
      icon: input.icon ?? null,
      body: input.body,
      published: input.published ?? true,
      order: await nextBenefitOrder(companyId),
    },
  })
}

export async function updateBenefit(id: string, input: UpdateCultureBenefitRequest, companyId: string) {
  const db = scopedPrisma(companyId)
  const existing = await db.cultureBenefit.findFirst({ where: { id } })
  if (!existing) throw new CultureError('Benefício não encontrado.', 404)
  return db.cultureBenefit.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.icon !== undefined ? { icon: input.icon ?? null } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.published !== undefined ? { published: input.published } : {}),
    },
  })
}

export async function deleteBenefit(id: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const existing = await db.cultureBenefit.findFirst({ where: { id } })
  if (!existing) throw new CultureError('Benefício não encontrado.', 404)
  await db.cultureBenefit.delete({ where: { id } })
  return existing
}

export async function reorderBenefits(ids: string[], companyId: string) {
  const db = scopedPrisma(companyId)
  const found = await db.cultureBenefit.findMany({ where: { id: { in: ids } }, select: { id: true } })
  if (found.length !== ids.length) {
    throw new CultureError('Lista de ordenação não confere com os benefícios existentes.', 400)
  }
  await Promise.all(ids.map((id, index) => db.cultureBenefit.update({ where: { id }, data: { order: index } })))
  return listBenefitsForAdmin(companyId)
}

// -------------------------------------------------------- kit de identidade

export function listPublishedVisualAssets(companyId: string) {
  return scopedPrisma(companyId).cultureVisualAsset.findMany({
    where: { published: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
}

export function listVisualAssetsForAdmin(companyId: string) {
  return scopedPrisma(companyId).cultureVisualAsset.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
}

async function nextVisualAssetOrder(companyId: string): Promise<number> {
  const last = await scopedPrisma(companyId).cultureVisualAsset.findFirst({
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  return last ? last.order + 1 : 0
}

/**
 * A chave precisa ter nascido no presign DESTA empresa. Sem esta checagem, um
 * POST direto apontaria `storageKey` para o objeto de outro tenant e a peça
 * apareceria no kit de quem não a enviou — mesma defesa que o
 * `challenge-service` faz no prefixo da evidência.
 */
function assertOwnKey(storageKey: string, companyId: string): void {
  if (!storageKey.startsWith(`visual-assets/${companyId}/`)) {
    throw new CultureError('Imagem inválida. Envie o arquivo de novo.', 400)
  }
}

export async function createVisualAsset(input: CreateCultureVisualAssetRequest, companyId: string) {
  assertOwnKey(input.storageKey, companyId)
  return scopedPrisma(companyId).cultureVisualAsset.create({
    data: {
      title: input.title,
      description: input.description,
      storageKey: input.storageKey,
      fileName: input.fileName,
      fit: input.fit ?? 'COVER',
      published: input.published ?? true,
      order: await nextVisualAssetOrder(companyId),
    },
  })
}

export async function updateVisualAsset(
  id: string,
  input: UpdateCultureVisualAssetRequest,
  companyId: string,
) {
  const db = scopedPrisma(companyId)
  const existing = await db.cultureVisualAsset.findFirst({ where: { id } })
  if (!existing) throw new CultureError('Peça do kit visual não encontrada.', 404)
  if (input.storageKey !== undefined) assertOwnKey(input.storageKey, companyId)
  return db.cultureVisualAsset.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.storageKey !== undefined ? { storageKey: input.storageKey } : {}),
      ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
      ...(input.fit !== undefined ? { fit: input.fit } : {}),
      ...(input.published !== undefined ? { published: input.published } : {}),
    },
  })
}

export async function deleteVisualAsset(id: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const existing = await db.cultureVisualAsset.findFirst({ where: { id } })
  if (!existing) throw new CultureError('Peça do kit visual não encontrada.', 404)
  await db.cultureVisualAsset.delete({ where: { id } })
  // Depois do banco, e best-effort: S3 não entra em transação. O pior caso é um
  // objeto sobrando no bucket — nunca um card fantasma na tela, que é o que a
  // ordem inversa produziria. Mesma decisão de `event-album-service`.
  if (s3Config()) {
    try {
      await deleteS3Object(existing.storageKey)
    } catch (err) {
      console.error('[culture] falha ao apagar peça do kit no storage', { key: existing.storageKey, err })
    }
  }
  return existing
}

// ----------------------------------------------------- material pessoal

/**
 * Quem está pedindo um material pessoal. `canAdminister` é decidido na rota
 * (mesma regra de `requireSectorFeature('gente-gestao')`) porque aqui o acesso
 * não é "ou uma coisa ou outra" que um guard resolveria: a MESMA rota atende o
 * destinatário e quem administra, e é o service que sabe qual dos dois é.
 */
export interface PersonalAssetViewer {
  userId: string
  companyId: string
  canAdminister: boolean
}

/** O que a pessoa recebeu. Mais novo primeiro: entrega recente é a que se procura. */
export function listPersonalAssetsFor(userId: string, companyId: string) {
  return scopedPrisma(companyId).culturePersonalAsset.findMany({
    where: { recipientId: userId },
    orderBy: { createdAt: 'desc' },
  })
}

/** Tudo, para a tela de administração — com o destinatário junto. */
export function listPersonalAssetsForAdmin(companyId: string, recipientId?: string) {
  return scopedPrisma(companyId).culturePersonalAsset.findMany({
    where: recipientId ? { recipientId } : {},
    include: { recipient: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * O material que este viewer pode abrir: o dono, ou quem administra Cultura.
 *
 * 404 (e não 403) para quem não pode: a existência de um material dirigido a
 * alguém já é informação sobre essa pessoa.
 */
export async function getPersonalAssetForViewer(viewer: PersonalAssetViewer, id: string) {
  const asset = await scopedPrisma(viewer.companyId).culturePersonalAsset.findFirst({ where: { id } })
  if (!asset) throw new CultureError('Material não encontrado.', 404)
  if (asset.recipientId !== viewer.userId && !viewer.canAdminister) {
    throw new CultureError('Material não encontrado.', 404)
  }
  return asset
}

/**
 * A chave precisa ter nascido no presign DESTA empresa E deste destinatário.
 * Sem a segunda metade, um POST direto anexaria à Ana um objeto enviado para o
 * Bruno — e o material pessoal é justamente o que não pode trocar de dono.
 */
function assertPersonalKey(storageKey: string, companyId: string, recipientId: string): void {
  if (!storageKey.startsWith(`personal-assets/${companyId}/${recipientId}/`)) {
    throw new CultureError('Arquivo inválido. Envie de novo.', 400)
  }
}

export async function createPersonalAsset(
  input: CreateCulturePersonalAssetRequest,
  companyId: string,
  actorId: string,
) {
  assertPersonalKey(input.storageKey, companyId, input.recipientId)
  const db = scopedPrisma(companyId)
  const destinatario = await db.user.findUnique({ where: { id: input.recipientId }, select: { id: true } })
  if (!destinatario) throw new CultureError('Pessoa não encontrada.', 404)

  return db.culturePersonalAsset.create({
    data: {
      recipientId: input.recipientId,
      title: input.title,
      description: input.description ?? null,
      storageKey: input.storageKey,
      fileName: input.fileName,
      fileSize: input.fileSize ?? null,
      kind: input.kind,
      createdById: actorId,
    },
    include: { recipient: { select: { id: true, name: true } } },
  })
}

/** Só texto — trocar o destinatário é outra entrega (ver o DTO em `@legends/shared`). */
export async function updatePersonalAsset(
  id: string,
  input: UpdateCulturePersonalAssetRequest,
  companyId: string,
) {
  const db = scopedPrisma(companyId)
  const existing = await db.culturePersonalAsset.findFirst({ where: { id } })
  if (!existing) throw new CultureError('Material não encontrado.', 404)
  return db.culturePersonalAsset.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    },
    include: { recipient: { select: { id: true, name: true } } },
  })
}

export async function deletePersonalAsset(id: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const existing = await db.culturePersonalAsset.findFirst({
    where: { id },
    include: { recipient: { select: { id: true, name: true } } },
  })
  if (!existing) throw new CultureError('Material não encontrado.', 404)
  await db.culturePersonalAsset.delete({ where: { id } })
  // Aqui apagar do storage importa mais que na peça global: é arquivo de uma
  // pessoa, e "excluído" precisa significar excluído. Ainda best-effort — S3 não
  // entra em transação —, mas a falha é logada para dar para agir.
  if (s3Config()) {
    try {
      await deleteS3Object(existing.storageKey)
    } catch (err) {
      console.error('[culture] falha ao apagar material pessoal no storage', {
        key: existing.storageKey,
        err,
      })
    }
  }
  return existing
}

export async function reorderVisualAssets(ids: string[], companyId: string) {
  const db = scopedPrisma(companyId)
  const found = await db.cultureVisualAsset.findMany({ where: { id: { in: ids } }, select: { id: true } })
  if (found.length !== ids.length) {
    throw new CultureError('Lista de ordenação não confere com as peças existentes.', 400)
  }
  await Promise.all(ids.map((id, index) => db.cultureVisualAsset.update({ where: { id }, data: { order: index } })))
  return listVisualAssetsForAdmin(companyId)
}
