import type { CorporatePostTag, Prisma } from '@prisma/client'
import {
  CORPORATE_POST_TAG_NAME_MAX_LENGTH,
  CORPORATE_POST_TAG_SEED,
  type CorporatePostTagDTO,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'

export class CorporatePostTagError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'CorporatePostTagError'
  }
}

export function toCorporatePostTagDTO(tag: CorporatePostTag): CorporatePostTagDTO {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    color: tag.color,
    active: tag.active,
    order: tag.order,
  }
}

/** Mesmo slug do resto do repo: sem acento, minúsculo, hífen no lugar do espaço. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function assertName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new CorporatePostTagError('Informe o nome da categoria.', 400)
  if (trimmed.length > CORPORATE_POST_TAG_NAME_MAX_LENGTH) {
    throw new CorporatePostTagError(
      `O nome precisa ter no máximo ${CORPORATE_POST_TAG_NAME_MAX_LENGTH} caracteres.`,
      400,
    )
  }
  return trimmed
}

function assertColor(value: string): string {
  const trimmed = value.trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    throw new CorporatePostTagError('Use uma cor em hexadecimal, como #6CE190.', 400)
  }
  return trimmed.toUpperCase()
}

/**
 * Catálogo inicial de uma empresa recém-criada.
 *
 * `skipDuplicates` porque a mesma provisão roda na migration de backfill das
 * empresas antigas (`20260824140000`) e no onboarding — mesma postura de
 * `provisionCategories`.
 */
export async function provisionCorporatePostTags(
  db: Pick<Prisma.TransactionClient, 'corporatePostTag'>,
  companyId: string,
): Promise<void> {
  await db.corporatePostTag.createMany({
    data: CORPORATE_POST_TAG_SEED.map((tag, order) => ({
      name: tag.name,
      slug: slugify(tag.name),
      color: tag.color,
      order,
      companyId,
    })),
    skipDuplicates: true,
  })
}

/**
 * `activeOnly` é o recorte de quem vai **usar** a lista (o seletor do editor, as
 * pílulas do Feed); a administração vê as inativas para poder religá-las.
 */
export function listCorporatePostTags(
  companyId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<CorporatePostTag[]> {
  return scopedPrisma(companyId).corporatePostTag.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  })
}

export async function createCorporatePostTag(
  input: { name: string; color?: string },
  companyId: string,
): Promise<CorporatePostTag> {
  const name = assertName(input.name)
  const slug = slugify(name)
  const db = scopedPrisma(companyId)
  const existing = await db.corporatePostTag.findFirst({ where: { slug } })
  if (existing) {
    throw new CorporatePostTagError(
      existing.active
        ? 'Já existe uma categoria com esse nome.'
        : 'Já existe uma categoria inativa com esse nome. Reative-a em vez de criar outra.',
      409,
    )
  }
  const last = await db.corporatePostTag.findFirst({ orderBy: { order: 'desc' }, select: { order: true } })
  return db.corporatePostTag.create({
    data: {
      name,
      slug,
      color: input.color ? assertColor(input.color) : '#6CE190',
      order: (last?.order ?? -1) + 1,
      companyId,
    },
  })
}

/**
 * Renomear **não** muda o slug, de propósito: é ele que a `@@unique` guarda e o
 * que sobreviveria a uma referência externa. Mesma regra de
 * `RecognitionCategory` — o slug não acompanha renomeação.
 */
export async function updateCorporatePostTag(
  id: string,
  input: { name?: string; color?: string; active?: boolean },
  companyId: string,
): Promise<CorporatePostTag> {
  const db = scopedPrisma(companyId)
  const tag = await db.corporatePostTag.findUnique({ where: { id } })
  if (!tag) throw new CorporatePostTagError('Categoria não encontrada.', 404)
  return db.corporatePostTag.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: assertName(input.name) } : {}),
      ...(input.color !== undefined ? { color: assertColor(input.color) } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  })
}

/**
 * A tag pedida existe e está utilizável nesta empresa?
 *
 * Chamado ao publicar e ao editar. Recusa tag **inativa** em post novo: a
 * desativação existe para tirar a categoria de circulação, e deixá-la entrar
 * pelo corpo da request seria a porta dos fundos disso. Post que já a usa
 * continua com ela — é história, não escolha nova.
 */
export async function assertUsableTag(tagId: string, companyId: string): Promise<void> {
  const tag = await scopedPrisma(companyId).corporatePostTag.findUnique({ where: { id: tagId } })
  if (!tag) throw new CorporatePostTagError('Categoria não encontrada.', 404)
  if (!tag.active) throw new CorporatePostTagError('Essa categoria está inativa.', 400)
}
