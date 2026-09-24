/**
 * Temas do catálogo de selos (Documento 4, seções 11.3 e 11.4).
 *
 * O tema é a prateleira do Painel de Emblemas — a gaveta em que o selo aparece.
 * **Não é `RecognitionCategory`**, que é a categoria do FEEDBACK e é o que
 * `Badge.categorySlug` referencia; ver o comentário no schema.
 *
 * Desativa-se, não se apaga: o `slug` é o que a importação por planilha casa, e
 * apagar levaria a classificação dos selos junto (`onDelete: SetNull`).
 */

import type { BadgeCategoryDTO } from '@legends/shared'
import { BADGE_CATEGORY_NAME_MAX_LENGTH } from '@legends/shared'
import { slugify } from '../lib/slug'
import { scopedPrisma } from '../lib/tenant-scope'

export class BadgeCategoryError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'BadgeCategoryError'
  }
}

function assertName(name: string): string {
  const limpo = name.trim()
  if (!limpo) throw new BadgeCategoryError('Informe o nome do tema.', 400)
  if (limpo.length > BADGE_CATEGORY_NAME_MAX_LENGTH) {
    throw new BadgeCategoryError(`O nome do tema tem no máximo ${BADGE_CATEGORY_NAME_MAX_LENGTH} caracteres.`, 400)
  }
  return limpo
}

/**
 * Lista os temas com o contador de selos que o painel mostra.
 *
 * `includeInactive` existe porque a tela do admin precisa enxergar o que
 * desativou (para reativar), enquanto o formulário de selo só oferece os
 * ativos.
 */
export async function listBadgeCategories(
  companyId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<BadgeCategoryDTO[]> {
  const rows = await scopedPrisma(companyId).badgeCategory.findMany({
    where: opts.includeInactive ? {} : { active: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { badges: true } } },
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    order: row.order,
    active: row.active,
    badgeCount: row._count.badges,
  }))
}

export async function createBadgeCategory(companyId: string, name: string): Promise<BadgeCategoryDTO> {
  const limpo = assertName(name)
  const slug = slugify(limpo)
  if (!slug) throw new BadgeCategoryError('O nome do tema precisa ter letras ou números.', 400)

  const db = scopedPrisma(companyId)
  const existente = await db.badgeCategory.findFirst({ where: { slug } })
  if (existente) throw new BadgeCategoryError('Já existe um tema com esse nome.', 409)

  // O novo entra no fim da ordem — quem quiser reordenar renomeia a ordem na
  // tela; inserir no meio exigiria remanejar todos os vizinhos por nada.
  const ultimo = await db.badgeCategory.findFirst({ orderBy: { order: 'desc' }, select: { order: true } })
  const criado = await db.badgeCategory.create({
    data: { name: limpo, slug, order: (ultimo?.order ?? -1) + 1 },
  })
  return { id: criado.id, name: criado.name, slug: criado.slug, order: criado.order, active: criado.active, badgeCount: 0 }
}

/**
 * Renomeia ou (des)ativa o tema.
 *
 * **O `slug` não acompanha a renomeação**, de propósito e pelo mesmo motivo que
 * `RecognitionCategory` já faz: é o slug que a planilha de importação casa, e
 * mudá-lo faria a próxima importação criar um tema duplicado em vez de atualizar
 * o que existe.
 */
export async function updateBadgeCategory(
  companyId: string,
  id: string,
  input: { name?: string; active?: boolean; order?: number },
): Promise<BadgeCategoryDTO> {
  const db = scopedPrisma(companyId)
  const atual = await db.badgeCategory.findFirst({ where: { id } })
  if (!atual) throw new BadgeCategoryError('Tema não encontrado.', 404)

  const atualizado = await db.badgeCategory.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: assertName(input.name) } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
    },
    include: { _count: { select: { badges: true } } },
  })
  return {
    id: atualizado.id,
    name: atualizado.name,
    slug: atualizado.slug,
    order: atualizado.order,
    active: atualizado.active,
    badgeCount: atualizado._count.badges,
  }
}

/** Resolve o tema pelo NOME, para a importação por planilha. Null quando não existe. */
export async function findBadgeCategoryByName(companyId: string, name: string): Promise<{ id: string } | null> {
  const slug = slugify(name.trim())
  if (!slug) return null
  return scopedPrisma(companyId).badgeCategory.findFirst({ where: { slug }, select: { id: true } })
}
