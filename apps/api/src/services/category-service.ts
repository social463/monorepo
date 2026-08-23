import { Prisma, type RecognitionCategory } from '@prisma/client'
import { RECOGNITION_CATEGORY_NAME_MAX_LENGTH, RECOGNITION_CATEGORY_SEED } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { slugify } from '../lib/slug'
import { recordAuditLog } from './audit-log-service'

/**
 * Catálogo de categorias da empresa, administrado pela G&G — **um só** para o
 * feedback e para o voto desde
 * `specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`. Antes eram
 * dois: este e um `Category` exclusivo da votação, com a mesma cara e outra
 * lista, o que obrigava a empresa a curar duas vezes o mesmo vocabulário.
 *
 * A lista inicial entra por **provisão**, não como constante no código: num
 * produto white label cravar as categorias da EMR no binário obrigaria um
 * deploy para cada cliente que quisesse a lista dele.
 *
 * Categoria **não é apagada, é desativada**: apagar levaria junto os chips dos
 * feedbacks já escritos (o `onDelete: Cascade` da tabela de junção) e as
 * categorias dos votos já apurados, reescrevendo o passado de quem foi
 * reconhecido.
 *
 * O modelo no banco continua se chamando `RecognitionCategory` — renomear é
 * outra migration, e está fora do escopo desta unificação.
 */

export class CategoryError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'CategoryError'
  }
}

function assertName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new CategoryError('O nome da categoria é obrigatório.', 400)
  if (trimmed.length > RECOGNITION_CATEGORY_NAME_MAX_LENGTH) {
    throw new CategoryError(
      `O nome precisa ter no máximo ${RECOGNITION_CATEGORY_NAME_MAX_LENGTH} caracteres.`,
      400,
    )
  }
  return trimmed
}

/**
 * Catálogo inicial de uma empresa recém-criada.
 *
 * Empresa sem nenhuma categoria trava o feedback (o envio exige ao menos uma) e
 * a votação junto — o único jeito de sair do zero seria alguém lembrar de abrir
 * Administração › Categorias antes do primeiro feedback.
 *
 * `skipDuplicates` porque a mesma provisão roda no backfill das empresas antigas
 * (migration `20260818090000`) e no seed de dev.
 */
export async function provisionCategories(
  db: Pick<Prisma.TransactionClient, 'recognitionCategory'>,
  companyId: string,
): Promise<void> {
  await db.recognitionCategory.createMany({
    data: RECOGNITION_CATEGORY_SEED.map((name, order) => ({ name, slug: slugify(name), order, companyId })),
    skipDuplicates: true,
  })
}

/**
 * `activeOnly` é o recorte de quem vai **usar** a lista (o composer de feedback,
 * a tela de votação); a administração enxerga as inativas para poder religá-las.
 */
export function listCategories(
  companyId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<RecognitionCategory[]> {
  return scopedPrisma(companyId).recognitionCategory.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  })
}

export function getCategory(id: string, companyId: string): Promise<RecognitionCategory | null> {
  return scopedPrisma(companyId).recognitionCategory.findUnique({ where: { id } })
}

export async function createCategory(input: {
  name: string
  description?: string
  order?: number
  actorId: string
  companyId: string
}): Promise<RecognitionCategory> {
  const name = assertName(input.name)
  const db = scopedPrisma(input.companyId)
  try {
    const created = await db.recognitionCategory.create({
      data: {
        name,
        slug: slugify(name),
        description: input.description?.trim() || null,
        order: input.order ?? 0,
        companyId: input.companyId,
      },
    })
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'RecognitionCategory',
      entityId: created.id,
      action: 'CREATE',
      after: { name: created.name, slug: created.slug, order: created.order, active: created.active },
      companyId: input.companyId,
    })
    return created
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CategoryError('Já existe uma categoria com esse nome.', 409)
    }
    throw err
  }
}

/**
 * O slug **não** acompanha a renomeação: os selos de categoria apontam para ele
 * (`Badge.categorySlug`), e trocá-lo faria o selo parar de contar do nada.
 */
export async function updateCategory(input: {
  id: string
  name?: string
  description?: string | null
  order?: number
  active?: boolean
  actorId: string
  companyId: string
}): Promise<RecognitionCategory> {
  const db = scopedPrisma(input.companyId)
  const before = await db.recognitionCategory.findUnique({ where: { id: input.id } })
  if (!before) throw new CategoryError('Categoria não encontrada.', 404)
  const name = input.name === undefined ? undefined : assertName(input.name)

  try {
    const updated = await db.recognitionCategory.update({
      where: { id: input.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    })
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'RecognitionCategory',
      entityId: input.id,
      action: 'UPDATE',
      before: { name: before.name, slug: before.slug, order: before.order, active: before.active },
      after: { name: updated.name, slug: updated.slug, order: updated.order, active: updated.active },
      companyId: input.companyId,
    })
    return updated
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CategoryError('Já existe uma categoria com esse nome.', 409)
    }
    throw err
  }
}
