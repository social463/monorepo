/**
 * Catálogo da Central de Cursos: categorias, competências e instrutores
 * (Documento 4, seções 9.6 e 9.7).
 *
 * As três eram texto livre na tabela de curso. Aqui elas viram cadastro, com as
 * regras que o repo já aplica a todo model tenant-scoped:
 *
 * - **slug único por empresa**, gerado do nome e **não** reemitido em
 *   renomeação: é ele que a importação casa e o que sobrevive a "Liderança" →
 *   "Liderança e Gestão";
 * - **desativa-se, não se apaga** quando há curso atrás. Apagar levaria o
 *   vínculo junto, e o histórico do curso não é do catálogo.
 *
 * O instrutor tem uma regra a mais, da 9.7: quando ele é colaborador, `userId`
 * aponta para o `User` e nome, foto e área são **derivados** de lá. O cadastro
 * manual existe para quem é de fora.
 */

import type { Prisma } from '@prisma/client'
import {
  COMPETENCY_DESCRIPTION_MAX_LENGTH,
  COMPETENCY_NAME_MAX_LENGTH,
  COURSE_CATEGORY_NAME_MAX_LENGTH,
  INSTRUCTOR_BIO_MAX_LENGTH,
  INSTRUCTOR_NAME_MAX_LENGTH,
  MAX_INSTRUCTOR_EXPERTISE,
  type CompetencyDTO,
  type CourseCategoryDTO,
  type CreateCompetencyRequest,
  type CreateCourseCategoryRequest,
  type CreateInstructorRequest,
  type InstructorDTO,
  type UpdateCompetencyRequest,
  type UpdateCourseCategoryRequest,
  type UpdateInstructorRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { slugify } from '../lib/slug'
import { recordAuditLog } from './audit-log-service'
import type { CourseActor } from './course-admin-service'

export class CourseCatalogError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'CourseCatalogError'
  }
}

/**
 * Slug único dentro da empresa. Sufixa com `-2`, `-3`… em vez de recusar: quem
 * cadastra não deveria precisar inventar um nome diferente porque o slug bateu.
 */
async function uniqueSlug(
  companyId: string,
  nome: string,
  buscar: (slug: string) => Promise<{ id: string } | null>,
  ignorarId?: string,
): Promise<string> {
  const base = slugify(nome) || 'item'
  for (let sufixo = 0; sufixo < 100; sufixo += 1) {
    const candidato = sufixo === 0 ? base : `${base}-${sufixo + 1}`
    const existente = await buscar(candidato)
    if (!existente || existente.id === ignorarId) return candidato
  }
  throw new CourseCatalogError('Não foi possível gerar um identificador para este nome.')
}

function exigirNome(valor: string | null | undefined, teto: number, oQue: string): string {
  const nome = (valor ?? '').trim()
  if (!nome) throw new CourseCatalogError(`Informe o nome ${oQue}.`)
  if (nome.length > teto) throw new CourseCatalogError(`O nome passa de ${teto} caracteres.`)
  return nome
}

// --- Categorias --------------------------------------------------------------

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  icon: true,
  parentId: true,
  order: true,
  active: true,
  parent: { select: { name: true } },
  _count: { select: { courses: true } },
} satisfies Prisma.CourseCategorySelect

function toCategoryDTO(row: Prisma.CourseCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>): CourseCategoryDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    parentId: row.parentId,
    parentName: row.parent?.name ?? null,
    order: row.order,
    active: row.active,
    courseCount: row._count.courses,
  }
}

export async function listCourseCategories(actor: CourseActor): Promise<CourseCategoryDTO[]> {
  const rows = await scopedPrisma(actor.companyId).courseCategory.findMany({
    select: CATEGORY_SELECT,
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  })
  return rows.map(toCategoryDTO)
}

/**
 * Confere que o pai existe na empresa e que não vira ciclo. Só um nível: a
 * seção 9.6 pede categoria e subcategoria, e não uma árvore sem fim — permitir
 * neta significaria decidir como exibir uma hierarquia que ninguém pediu.
 */
async function resolveParent(companyId: string, parentId: string | null, selfId?: string): Promise<string | null> {
  if (!parentId) return null
  if (parentId === selfId) throw new CourseCatalogError('Uma categoria não pode ser a própria raiz.')
  const pai = await scopedPrisma(companyId).courseCategory.findFirst({ where: { id: parentId } })
  if (!pai) throw new CourseCatalogError('Categoria raiz não encontrada.', 404)
  if (pai.parentId) throw new CourseCatalogError('Uma subcategoria não pode ser raiz de outra.')
  return pai.id
}

export async function createCourseCategory(
  actor: CourseActor,
  input: CreateCourseCategoryRequest,
): Promise<CourseCategoryDTO> {
  const db = scopedPrisma(actor.companyId)
  const name = exigirNome(input.name, COURSE_CATEGORY_NAME_MAX_LENGTH, 'da categoria')
  const parentId = await resolveParent(actor.companyId, input.parentId ?? null)
  const slug = await uniqueSlug(actor.companyId, name, (s) =>
    db.courseCategory.findFirst({ where: { slug: s }, select: { id: true } }),
  )

  const row = await db.courseCategory.create({
    data: { name, slug, icon: input.icon?.trim() || null, parentId, order: input.order ?? 0 },
    select: CATEGORY_SELECT,
  })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'CourseCategory',
    entityId: row.id,
    action: 'CREATE',
    after: row,
    companyId: actor.companyId,
  })
  return toCategoryDTO(row)
}

export async function updateCourseCategory(
  actor: CourseActor,
  id: string,
  input: UpdateCourseCategoryRequest,
): Promise<CourseCategoryDTO> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.courseCategory.findFirst({ where: { id }, select: CATEGORY_SELECT })
  if (!before) throw new CourseCatalogError('Categoria não encontrada.', 404)

  const data: Prisma.CourseCategoryUncheckedUpdateInput = {}
  // O slug NÃO acompanha a renomeação, de propósito: é o identificador estável,
  // e trocá-lo quebraria a importação e qualquer referência externa.
  if (input.name !== undefined) data.name = exigirNome(input.name, COURSE_CATEGORY_NAME_MAX_LENGTH, 'da categoria')
  if (input.icon !== undefined) data.icon = input.icon?.trim() || null
  if (input.parentId !== undefined) data.parentId = await resolveParent(actor.companyId, input.parentId, id)
  if (input.order !== undefined) data.order = input.order
  if (input.active !== undefined) data.active = input.active

  const row = await db.courseCategory.update({ where: { id }, data, select: CATEGORY_SELECT })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'CourseCategory',
    entityId: id,
    action: 'UPDATE',
    before,
    after: row,
    companyId: actor.companyId,
  })
  return toCategoryDTO(row)
}

/**
 * Apagar só vale para categoria sem curso atrás. Com curso, o caminho é
 * desativar — apagar levaria o vínculo junto (a FK é `SetNull`) e a tela do
 * curso perderia a categoria sem que ninguém tivesse pedido isso.
 */
export async function deleteCourseCategory(actor: CourseActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const row = await db.courseCategory.findFirst({ where: { id }, select: CATEGORY_SELECT })
  if (!row) throw new CourseCatalogError('Categoria não encontrada.', 404)
  if (row._count.courses > 0) {
    throw new CourseCatalogError(
      `Esta categoria tem ${row._count.courses} curso(s). Desative-a em vez de excluir.`,
      409,
    )
  }
  const filhas = await db.courseCategory.count({ where: { parentId: id } })
  if (filhas > 0) throw new CourseCatalogError('Esta categoria tem subcategorias. Remova-as antes.', 409)

  await db.courseCategory.delete({ where: { id } })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'CourseCategory',
    entityId: id,
    action: 'DELETE',
    before: row,
    companyId: actor.companyId,
  })
}

// --- Competências ------------------------------------------------------------

const COMPETENCY_SELECT = {
  id: true,
  name: true,
  slug: true,
  icon: true,
  description: true,
  active: true,
  _count: { select: { courses: true } },
} satisfies Prisma.CompetencySelect

function toCompetencyDTO(row: Prisma.CompetencyGetPayload<{ select: typeof COMPETENCY_SELECT }>): CompetencyDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    description: row.description,
    active: row.active,
    courseCount: row._count.courses,
  }
}

export async function listCompetencies(actor: CourseActor): Promise<CompetencyDTO[]> {
  const rows = await scopedPrisma(actor.companyId).competency.findMany({
    select: COMPETENCY_SELECT,
    orderBy: { name: 'asc' },
  })
  return rows.map(toCompetencyDTO)
}

export async function createCompetency(
  actor: CourseActor,
  input: CreateCompetencyRequest,
): Promise<CompetencyDTO> {
  const db = scopedPrisma(actor.companyId)
  const name = exigirNome(input.name, COMPETENCY_NAME_MAX_LENGTH, 'da competência')
  const slug = await uniqueSlug(actor.companyId, name, (s) =>
    db.competency.findFirst({ where: { slug: s }, select: { id: true } }),
  )
  const row = await db.competency.create({
    data: {
      name,
      slug,
      icon: input.icon?.trim() || null,
      description: input.description?.trim().slice(0, COMPETENCY_DESCRIPTION_MAX_LENGTH) || null,
    },
    select: COMPETENCY_SELECT,
  })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'Competency',
    entityId: row.id,
    action: 'CREATE',
    after: row,
    companyId: actor.companyId,
  })
  return toCompetencyDTO(row)
}

export async function updateCompetency(
  actor: CourseActor,
  id: string,
  input: UpdateCompetencyRequest,
): Promise<CompetencyDTO> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.competency.findFirst({ where: { id }, select: COMPETENCY_SELECT })
  if (!before) throw new CourseCatalogError('Competência não encontrada.', 404)

  const data: Prisma.CompetencyUncheckedUpdateInput = {}
  if (input.name !== undefined) data.name = exigirNome(input.name, COMPETENCY_NAME_MAX_LENGTH, 'da competência')
  if (input.icon !== undefined) data.icon = input.icon?.trim() || null
  if (input.description !== undefined) {
    data.description = input.description?.trim().slice(0, COMPETENCY_DESCRIPTION_MAX_LENGTH) || null
  }
  if (input.active !== undefined) data.active = input.active

  const row = await db.competency.update({ where: { id }, data, select: COMPETENCY_SELECT })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'Competency',
    entityId: id,
    action: 'UPDATE',
    before,
    after: row,
    companyId: actor.companyId,
  })
  return toCompetencyDTO(row)
}

export async function deleteCompetency(actor: CourseActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const row = await db.competency.findFirst({ where: { id }, select: COMPETENCY_SELECT })
  if (!row) throw new CourseCatalogError('Competência não encontrada.', 404)
  if (row._count.courses > 0) {
    throw new CourseCatalogError(
      `Esta competência está em ${row._count.courses} curso(s). Desative-a em vez de excluir.`,
      409,
    )
  }
  await db.competency.delete({ where: { id } })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'Competency',
    entityId: id,
    action: 'DELETE',
    before: row,
    companyId: actor.companyId,
  })
}

// --- Instrutores -------------------------------------------------------------

const INSTRUCTOR_SELECT = {
  id: true,
  userId: true,
  name: true,
  email: true,
  photoUrl: true,
  bio: true,
  expertise: true,
  active: true,
  // A "área" da 9.7 é o SETOR da pessoa, não o enum `User.area` — aquele tem
  // dois valores (ENGINEERING/PRODUCT) e é legado de outra coisa. Setor é o que
  // a planilha de colaboradores chama de área e o que a tela mostra.
  user: { select: { name: true, email: true, photoUrl: true, sector: { select: { name: true } } } },
  _count: { select: { courses: true } },
} satisfies Prisma.InstructorSelect

/**
 * Nome, e-mail, foto e área do instrutor INTERNO vêm do `User`, não da cópia
 * gravada aqui (seção 9.7). A cópia continua existindo porque o vínculo é
 * `SetNull`: se a pessoa sair da empresa, o instrutor não perde o nome nos
 * cursos que já deu.
 */
function toInstructorDTO(row: Prisma.InstructorGetPayload<{ select: typeof INSTRUCTOR_SELECT }>): InstructorDTO {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user?.name ?? row.name,
    email: row.user?.email ?? row.email,
    photoUrl: row.user?.photoUrl ?? row.photoUrl,
    bio: row.bio,
    area: row.user?.sector?.name ?? null,
    expertise: row.expertise,
    active: row.active,
    courseCount: row._count.courses,
  }
}

export async function listInstructors(actor: CourseActor): Promise<InstructorDTO[]> {
  const rows = await scopedPrisma(actor.companyId).instructor.findMany({
    select: INSTRUCTOR_SELECT,
    orderBy: { name: 'asc' },
  })
  return rows.map(toInstructorDTO)
}

function normalizeExpertise(valores: string[] | undefined): string[] | undefined {
  if (valores === undefined) return undefined
  const limpos = [...new Set(valores.map((v) => v.trim()).filter(Boolean))]
  if (limpos.length > MAX_INSTRUCTOR_EXPERTISE) {
    throw new CourseCatalogError(`Informe no máximo ${MAX_INSTRUCTOR_EXPERTISE} áreas de expertise.`)
  }
  return limpos
}

export async function createInstructor(
  actor: CourseActor,
  input: CreateInstructorRequest,
): Promise<InstructorDTO> {
  const db = scopedPrisma(actor.companyId)

  // Interno: o `User` é a fonte, e o `name` gravado é só a cópia que sobrevive a
  // um desligamento. Externo: o nome é obrigatório, porque não há de onde tirar.
  let name: string
  let userId: string | null = null
  if (input.userId) {
    const user = await db.user.findFirst({ where: { id: input.userId } })
    if (!user) throw new CourseCatalogError('Colaborador não encontrado.', 404)
    const jaExiste = await db.instructor.findFirst({ where: { userId: user.id } })
    if (jaExiste) throw new CourseCatalogError('Este colaborador já está cadastrado como instrutor.', 409)
    userId = user.id
    name = user.name
  } else {
    name = exigirNome(input.name, INSTRUCTOR_NAME_MAX_LENGTH, 'do instrutor')
  }

  const row = await db.instructor.create({
    data: {
      userId,
      name,
      email: input.email?.trim() || null,
      photoUrl: input.photoUrl?.trim() || null,
      bio: input.bio?.trim().slice(0, INSTRUCTOR_BIO_MAX_LENGTH) || null,
      expertise: normalizeExpertise(input.expertise) ?? [],
    },
    select: INSTRUCTOR_SELECT,
  })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'Instructor',
    entityId: row.id,
    action: 'CREATE',
    after: row,
    companyId: actor.companyId,
  })
  return toInstructorDTO(row)
}

export async function updateInstructor(
  actor: CourseActor,
  id: string,
  input: UpdateInstructorRequest,
): Promise<InstructorDTO> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.instructor.findFirst({ where: { id }, select: INSTRUCTOR_SELECT })
  if (!before) throw new CourseCatalogError('Instrutor não encontrado.', 404)

  const data: Prisma.InstructorUncheckedUpdateInput = {}
  if (input.name !== undefined && !before.userId) {
    // Instrutor interno não tem nome editável aqui: a fonte é o cadastro de
    // pessoas, e deixar editar criaria duas verdades sobre a mesma pessoa.
    data.name = exigirNome(input.name, INSTRUCTOR_NAME_MAX_LENGTH, 'do instrutor')
  }
  if (input.email !== undefined && !before.userId) data.email = input.email?.trim() || null
  if (input.photoUrl !== undefined && !before.userId) data.photoUrl = input.photoUrl?.trim() || null
  if (input.bio !== undefined) data.bio = input.bio?.trim().slice(0, INSTRUCTOR_BIO_MAX_LENGTH) || null
  if (input.expertise !== undefined) data.expertise = normalizeExpertise(input.expertise)
  if (input.active !== undefined) data.active = input.active

  const row = await db.instructor.update({ where: { id }, data, select: INSTRUCTOR_SELECT })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'Instructor',
    entityId: id,
    action: 'UPDATE',
    before,
    after: row,
    companyId: actor.companyId,
  })
  return toInstructorDTO(row)
}

export async function deleteInstructor(actor: CourseActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const row = await db.instructor.findFirst({ where: { id }, select: INSTRUCTOR_SELECT })
  if (!row) throw new CourseCatalogError('Instrutor não encontrado.', 404)
  if (row._count.courses > 0) {
    throw new CourseCatalogError(
      `Este instrutor está em ${row._count.courses} curso(s). Desative-o em vez de excluir.`,
      409,
    )
  }
  await db.instructor.delete({ where: { id } })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'Instructor',
    entityId: id,
    action: 'DELETE',
    before: row,
    companyId: actor.companyId,
  })
}
