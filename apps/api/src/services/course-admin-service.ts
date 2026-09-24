import type { Course, CourseLesson, CourseModule, Prisma } from '@prisma/client'
import {
  isPositionCategory,
  isPublishedStatus,
  MAX_COURSE_AUDIENCE_SECTORS,
  MAX_COURSE_COMPETENCIES,
  MAX_COURSE_INSTRUCTORS,
  MAX_LESSON_DURATION_MINUTES,
  parseCourseLessonBlocks,
  type AdminCourseDTO,
  type AdminCourseListItemDTO,
  type CreateCourseLessonRequest,
  type CreateCourseModuleRequest,
  type CreateCourseRequest,
  type UpdateCourseLessonRequest,
  type UpdateCourseModuleRequest,
  type UpdateCourseRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { slugify } from '../lib/slug'
import { toStringArray } from '../lib/serialize-learning'
import { INSTRUCTOR_REF_SELECT, toInstructorRef } from './learning-service'
import { recordAuditLog } from './audit-log-service'
import { runAutoEnrollmentForCourse } from './course-auto-enrollment-service'

export class CourseAdminError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'CourseAdminError'
  }
}

/**
 * Quem está agindo. `role`/`sectorId` decidem o recorte (só importam quando
 * `role === 'SUBADMIN'`); `id` vai para o audit log; `companyId` escopa tudo
 * via `scopedPrisma`.
 */
export interface CourseActor {
  id: string
  role: string
  sectorId: string
  companyId: string
}

const COURSE_INCLUDE = {
  modules: { orderBy: { sortOrder: 'asc' as const }, include: { lessons: { orderBy: { sortOrder: 'asc' as const } } } },
  courseCategory: { select: { name: true } },
  competencyLinks: { select: { competencyId: true } },
  instructorLinks: {
    orderBy: { sortOrder: 'asc' as const },
    select: { instructor: { select: INSTRUCTOR_REF_SELECT } },
  },
  audienceSectors: { select: { sectorId: true } },
} satisfies Prisma.CourseInclude

type CourseWithContent = Prisma.CourseGetPayload<{ include: typeof COURSE_INCLUDE }>

/**
 * Recorte de LEITURA: SUBADMIN alcança curso do próprio setor **e** curso sem
 * setor (da empresa toda). ADMIN e SUPER_ADMIN alcançam tudo.
 *
 * Só serve para consultar — nunca para uma função mutante. Ver
 * `writableCourseWhere` logo abaixo: foi compartilhar um único predicado entre
 * leitura e escrita que abriu a brecha na fatia anterior deste épico (SUBADMIN
 * conseguia editar/publicar curso da empresa toda porque a leitura
 * legitimamente inclui esse curso).
 */
export function readableCourseWhere(actor: CourseActor, ...extraFilters: Prisma.CourseWhereInput[]): Prisma.CourseWhereInput {
  if (actor.role !== 'SUBADMIN') {
    return extraFilters.length > 0 ? { AND: extraFilters } : {}
  }
  return { AND: [{ OR: [{ sectorId: null }, { sectorId: actor.sectorId }] }, ...extraFilters] }
}

/**
 * Recorte de ESCRITA: SUBADMIN alcança **só** curso do próprio setor — nunca o
 * curso sem setor, mesmo que ele apareça na leitura. ADMIN e SUPER_ADMIN
 * alcançam tudo. Todo `findFirst`/`findUnique` que antecede uma mutação (de
 * `Course`, `CourseModule` ou `CourseLesson`) passa por aqui, não por
 * `readableCourseWhere`.
 */
export function writableCourseWhere(actor: CourseActor, ...extraFilters: Prisma.CourseWhereInput[]): Prisma.CourseWhereInput {
  if (actor.role !== 'SUBADMIN') {
    return extraFilters.length > 0 ? { AND: extraFilters } : {}
  }
  return { AND: [{ sectorId: actor.sectorId }, ...extraFilters] }
}

function toAdminCourseDTO(course: CourseWithContent, enrolledCount: number): AdminCourseDTO {
  const lessons = course.modules.flatMap((courseModule) => courseModule.lessons)
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    shortDescription: course.shortDescription,
    description: course.description,
    coverUrl: course.coverUrl,
    categoryId: course.categoryId,
    categoryName: course.courseCategory?.name ?? null,
    level: course.level,
    competencyIds: course.competencyLinks.map((link) => link.competencyId),
    objectives: toStringArray(course.objectives),
    prerequisites: course.prerequisites,
    instructors: course.instructorLinks.map((link) => toInstructorRef(link.instructor)),
    mandatory: course.mandatory,
    audienceSectorIds: course.audienceSectors.map((link) => link.sectorId),
    audiencePositionCategories: course.audiencePositionCategories,
    recommendedFor: course.recommendedFor,
    autoEnroll: course.autoEnroll,
    certificateEnabled: course.certificateEnabled,
    status: course.status,
    rewardPoints: course.rewardPoints,
    rewardCoins: course.rewardCoins,
    bannerUrl: course.bannerUrl,
    introVideoUrl: course.introVideoUrl,
    icon: course.icon,
    primaryColor: course.primaryColor,
    published: isPublishedStatus(course.status),
    publishedAt: course.publishedAt?.toISOString() ?? null,
    durationMinutes: lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
    totalLessons: lessons.length,
    enrolledCount,
    modules: course.modules.map((courseModule) => ({
      id: courseModule.id,
      title: courseModule.title,
      description: courseModule.description,
      sortOrder: courseModule.sortOrder,
      lessons: courseModule.lessons.map((lesson) => ({
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        description: lesson.description,
        blocks: parseCourseLessonBlocks(lesson.contentBlocks),
        durationMinutes: lesson.durationMinutes,
        sortOrder: lesson.sortOrder,
      })),
    })),
    sectorId: course.sectorId,
    requiresCertificateApproval: course.requiresCertificateApproval,
    certificateTemplateId: course.certificateTemplateId,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  }
}

/** Busca de LEITURA: usa `readableCourseWhere`. Ver as regras no topo do arquivo. */
async function loadCourse(actor: CourseActor, courseId: string): Promise<CourseWithContent> {
  const course = await scopedPrisma(actor.companyId).course.findFirst({
    where: readableCourseWhere(actor, { id: courseId }),
    include: COURSE_INCLUDE,
  })
  if (!course) throw new CourseAdminError('Curso não encontrado.', 404)
  return course
}

/** Busca de ESCRITA: usa `writableCourseWhere`. Precede toda mutação de `Course`. */
async function loadCourseForWrite(actor: CourseActor, courseId: string): Promise<CourseWithContent> {
  const course = await scopedPrisma(actor.companyId).course.findFirst({
    where: writableCourseWhere(actor, { id: courseId }),
    include: COURSE_INCLUDE,
  })
  if (!course) throw new CourseAdminError('Curso não encontrado.', 404)
  return course
}

/**
 * Monta a resposta de um curso já alcançado. Sempre com `readableCourseWhere`:
 * quando chamada depois de uma mutação, o ator já passou pelo recorte de
 * escrita para chegar até aqui, então o de leitura (mais amplo) não reabre
 * nenhuma porta.
 */
async function courseResponse(actor: CourseActor, courseId: string): Promise<AdminCourseDTO> {
  const db = scopedPrisma(actor.companyId)
  const [course, enrolledCount] = await Promise.all([
    loadCourse(actor, courseId),
    db.courseEnrollment.count({ where: { courseId } }),
  ])
  return toAdminCourseDTO(course, enrolledCount)
}

export async function listCoursesForAdmin(actor: CourseActor): Promise<AdminCourseListItemDTO[]> {
  const db = scopedPrisma(actor.companyId)
  const courses = await db.course.findMany({
    where: readableCourseWhere(actor),
    orderBy: { updatedAt: 'desc' },
    include: COURSE_INCLUDE,
  })
  const enrollments = await db.courseEnrollment.groupBy({ by: ['courseId'], _count: { _all: true } })
  const enrolledByCourse = new Map(enrollments.map((row) => [row.courseId, row._count._all]))

  return courses.map((course) => {
    const lessons = course.modules.flatMap((courseModule) => courseModule.lessons)
    return {
      id: course.id,
      title: course.title,
      category: course.courseCategory?.name ?? null,
      level: course.level,
      status: course.status,
      published: isPublishedStatus(course.status),
      mandatory: course.mandatory,
      durationMinutes: lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
      totalLessons: lessons.length,
      enrolledCount: enrolledByCourse.get(course.id) ?? 0,
      updatedAt: course.updatedAt.toISOString(),
    }
  })
}

export function getCourseForAdmin(actor: CourseActor, courseId: string): Promise<AdminCourseDTO> {
  return courseResponse(actor, courseId)
}

/** Slug único por empresa: acrescenta sufixo quando o desejado já existe. */
async function uniqueSlug(companyId: string, title: string, ignoreCourseId?: string): Promise<string> {
  const base = slugify(title) || 'curso'
  const db = scopedPrisma(companyId)
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const existing = await db.course.findFirst({ where: { slug: candidate }, select: { id: true } })
    if (!existing || existing.id === ignoreCourseId) return candidate
  }
  throw new CourseAdminError('Não foi possível gerar um identificador para este curso.')
}

function normalizeList(values: string[] | undefined): Prisma.InputJsonValue | undefined {
  if (values === undefined) return undefined
  return values.map((value) => value.trim()).filter(Boolean)
}

/**
 * O `scopedPrisma` injeta o companyId na LINHA criada, mas não restringe o
 * alvo de uma FK — sem isto um ADMIN da empresa A gravaria um curso apontando
 * pro setor da empresa B: a escrita passa, e o curso some do catálogo de todo
 * mundo em silêncio (nenhum usuário da empresa A tem aquele `sectorId`). Um id
 * inexistente, por sua vez, virava P2003 cru → 500.
 *
 * Mesma forma do `assertSectorExists` que a `main` já usa em
 * `challenge-service.ts` (commit 1ba06ddf) e em `hr-dashboard-service.ts`:
 * `findFirst` escopado + 404 de domínio, nunca 403 (ver o recorte por setor no
 * topo do arquivo).
 */
async function assertSectorExists(companyId: string, sectorId: string | null): Promise<void> {
  if (sectorId === null) return
  const sector = await scopedPrisma(companyId).sector.findFirst({ where: { id: sectorId } })
  if (!sector) throw new CourseAdminError('Setor não encontrado.', 404)
}

/**
 * Mesmo motivo (e mesma forma) de `assertSectorExists`, para o modelo de
 * certificado: `Course.certificateTemplateId` é uma FK que o `scopedPrisma`
 * não restringe. Um id de modelo de outra empresa gravado aqui vazaria o
 * visual (nome, assinatura, logo) dela no certificado emitido — documento que
 * a pessoa publica fora. Fora do alcance é 404, nunca 403.
 */
async function assertCertificateTemplateExists(companyId: string, templateId: string | null): Promise<void> {
  if (templateId === null) return
  const template = await scopedPrisma(companyId).certificateTemplate.findFirst({ where: { id: templateId } })
  if (!template) throw new CourseAdminError('Modelo de certificado não encontrado.', 404)
}

/**
 * Categoria vem do catálogo (Documento 4, seção 9.6), então o id é conferido
 * antes de gravar: um id de outra empresa viraria FK inválida, e um id
 * inventado gravaria um vínculo que nenhuma tela resolve. Nulo é permitido — a
 * categoria deixou de ser obrigatória junto com o texto livre.
 */
async function resolveCategoryId(companyId: string, categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null
  const categoria = await scopedPrisma(companyId).courseCategory.findFirst({ where: { id: categoryId } })
  if (!categoria) throw new CourseAdminError('Categoria não encontrada.', 404)
  return categoria.id
}

/**
 * Regrava os vínculos N:N do curso com o catálogo (competências e instrutores).
 *
 * Apaga e recria em vez de calcular o delta: a lista chega inteira do
 * formulário, as tabelas de ligação não têm dado próprio a preservar (só a
 * ordem, que vem junto), e um delta acertado a mão é onde a duplicata mora.
 *
 * Ids são conferidos contra o catálogo DA EMPRESA. Sem isso, um id de outro
 * tenant viraria vínculo válido no banco e vazaria nome de outra empresa na
 * tela do curso.
 */
/**
 * Só os valores da lista fechada entram. Um valor de fora viraria segmentação
 * que nunca casa com ninguém — e sem erro visível, porque o curso simplesmente
 * sumiria de todo mundo.
 */
/** `normalizeList` devolve `InputJsonValue` (é para coluna Json); aqui a coluna
 *  é `String[]` nativo, então a lista sai como array mesmo. */
function normalizeStringArray(valores: string[] | undefined): string[] | undefined {
  if (valores === undefined) return undefined
  return [...new Set(valores.map((v) => v.trim()).filter(Boolean))]
}

function normalizePositionCategories(valores: string[] | undefined): string[] | undefined {
  if (valores === undefined) return undefined
  const limpos = [...new Set(valores.map((v) => v.trim()).filter(Boolean))]
  const invalido = limpos.find((v) => !isPositionCategory(v))
  if (invalido) throw new CourseAdminError(`Categoria de cargo desconhecida: ${invalido}.`)
  return limpos
}

async function syncCourseCatalogLinks(
  companyId: string,
  courseId: string,
  data: { competencyIds?: string[]; instructorIds?: string[]; audienceSectorIds?: string[] },
): Promise<void> {
  const db = scopedPrisma(companyId)

  if (data.competencyIds !== undefined) {
    const ids = [...new Set(data.competencyIds)]
    if (ids.length > MAX_COURSE_COMPETENCIES) {
      throw new CourseAdminError(`Escolha no máximo ${MAX_COURSE_COMPETENCIES} competências.`)
    }
    const validas = await db.competency.findMany({ where: { id: { in: ids } }, select: { id: true } })
    if (validas.length !== ids.length) throw new CourseAdminError('Competência não encontrada.', 404)
    await db.courseCompetency.deleteMany({ where: { courseId } })
    if (ids.length > 0) {
      await db.courseCompetency.createMany({ data: ids.map((competencyId) => ({ courseId, competencyId })) })
    }
  }

  if (data.audienceSectorIds !== undefined) {
    const ids = [...new Set(data.audienceSectorIds)]
    if (ids.length > MAX_COURSE_AUDIENCE_SECTORS) {
      throw new CourseAdminError(`Escolha no máximo ${MAX_COURSE_AUDIENCE_SECTORS} setores.`)
    }
    const validos = await db.sector.findMany({ where: { id: { in: ids } }, select: { id: true } })
    if (validos.length !== ids.length) throw new CourseAdminError('Setor não encontrado.', 404)
    await db.courseAudienceSector.deleteMany({ where: { courseId } })
    if (ids.length > 0) {
      await db.courseAudienceSector.createMany({ data: ids.map((sectorId) => ({ courseId, sectorId })) })
    }
  }

  if (data.instructorIds !== undefined) {
    const ids = [...new Set(data.instructorIds)]
    if (ids.length > MAX_COURSE_INSTRUCTORS) {
      throw new CourseAdminError(`Escolha no máximo ${MAX_COURSE_INSTRUCTORS} instrutores.`)
    }
    const validos = await db.instructor.findMany({ where: { id: { in: ids } }, select: { id: true } })
    if (validos.length !== ids.length) throw new CourseAdminError('Instrutor não encontrado.', 404)
    await db.courseInstructor.deleteMany({ where: { courseId } })
    if (ids.length > 0) {
      // `sortOrder` guarda a ordem em que vieram: o primeiro é o principal, e é
      // ele que aparece sozinho no card do catálogo.
      await db.courseInstructor.createMany({
        data: ids.map((instructorId, index) => ({ courseId, instructorId, sortOrder: index })),
      })
    }
  }
}

export async function createCourse(input: { data: CreateCourseRequest; actor: CourseActor }): Promise<AdminCourseDTO> {
  const title = input.data.title.trim()
  if (!title) throw new CourseAdminError('Informe o título do curso.')

  // Curso nasce no setor de quem cria: SUBADMIN nunca escolhe, um `sectorId`
  // pedido por ele para outro setor é ignorado (não recusado). ADMIN e
  // SUPER_ADMIN escolhem livremente, inclusive nulo (empresa toda).
  const sectorId = input.actor.role === 'SUBADMIN' ? input.actor.sectorId : (input.data.sectorId ?? null)
  await assertSectorExists(input.actor.companyId, sectorId)

  const certificateTemplateId = input.data.certificateTemplateId ?? null
  await assertCertificateTemplateExists(input.actor.companyId, certificateTemplateId)

  const course = await scopedPrisma(input.actor.companyId).course.create({
    data: {
      title,
      categoryId: await resolveCategoryId(input.actor.companyId, input.data.categoryId ?? null),
      slug: await uniqueSlug(input.actor.companyId, title),
      level: input.data.level ?? 'BEGINNER',
      shortDescription: input.data.shortDescription?.trim() || null,
      description: input.data.description?.trim() || null,
      coverUrl: input.data.coverUrl?.trim() || null,
      objectives: normalizeList(input.data.objectives) ?? [],
      prerequisites: input.data.prerequisites?.trim() || null,
      bannerUrl: input.data.bannerUrl?.trim() || null,
      introVideoUrl: input.data.introVideoUrl?.trim() || null,
      icon: input.data.icon?.trim() || null,
      primaryColor: input.data.primaryColor?.trim() || null,
      rewardPoints: input.data.rewardPoints ?? undefined,
      rewardCoins: input.data.rewardCoins ?? undefined,
      audiencePositionCategories: normalizePositionCategories(input.data.audiencePositionCategories) ?? [],
      recommendedFor: normalizeStringArray(input.data.recommendedFor) ?? [],
      autoEnroll: input.data.autoEnroll ?? false,
      mandatory: input.data.mandatory ?? false,
      certificateEnabled: input.data.certificateEnabled ?? true,
      requiresCertificateApproval: input.data.requiresCertificateApproval ?? false,
      certificateTemplateId,
      sectorId,
      // Curso nasce em rascunho: só aparece no catálogo quando o admin publica.
      status: 'DRAFT',
    },
  })

  await syncCourseCatalogLinks(input.actor.companyId, course.id, input.data)

  await recordAuditLog({
    actorId: input.actor.id,
    entityType: 'Course',
    entityId: course.id,
    action: 'CREATE',
    after: course,
    companyId: input.actor.companyId,
  })
  return courseResponse(input.actor, course.id)
}

export async function updateCourse(input: {
  courseId: string
  data: UpdateCourseRequest
  actor: CourseActor
}): Promise<AdminCourseDTO> {
  const before = await loadCourseForWrite(input.actor, input.courseId)
  const data: Prisma.CourseUncheckedUpdateInput = {}

  if (input.data.title !== undefined) {
    const title = input.data.title.trim()
    if (!title) throw new CourseAdminError('Informe o título do curso.')
    data.title = title
  }
  if (input.data.categoryId !== undefined) {
    data.categoryId = await resolveCategoryId(input.actor.companyId, input.data.categoryId)
  }
  if (input.data.level !== undefined) data.level = input.data.level
  if (input.data.shortDescription !== undefined) data.shortDescription = input.data.shortDescription?.trim() || null
  if (input.data.description !== undefined) data.description = input.data.description?.trim() || null
  if (input.data.coverUrl !== undefined) data.coverUrl = input.data.coverUrl?.trim() || null
  if (input.data.objectives !== undefined) data.objectives = normalizeList(input.data.objectives)
  if (input.data.prerequisites !== undefined) data.prerequisites = input.data.prerequisites?.trim() || null
  if (input.data.audiencePositionCategories !== undefined) {
    data.audiencePositionCategories = normalizePositionCategories(input.data.audiencePositionCategories)
  }
  if (input.data.bannerUrl !== undefined) data.bannerUrl = input.data.bannerUrl?.trim() || null
  if (input.data.introVideoUrl !== undefined) data.introVideoUrl = input.data.introVideoUrl?.trim() || null
  if (input.data.icon !== undefined) data.icon = input.data.icon?.trim() || null
  if (input.data.primaryColor !== undefined) data.primaryColor = input.data.primaryColor?.trim() || null
  if (input.data.rewardPoints !== undefined) data.rewardPoints = input.data.rewardPoints
  if (input.data.rewardCoins !== undefined) data.rewardCoins = input.data.rewardCoins
  if (input.data.recommendedFor !== undefined) {
    data.recommendedFor = normalizeStringArray(input.data.recommendedFor)
  }
  if (input.data.autoEnroll !== undefined) data.autoEnroll = input.data.autoEnroll
  if (input.data.mandatory !== undefined) data.mandatory = input.data.mandatory
  if (input.data.certificateEnabled !== undefined) data.certificateEnabled = input.data.certificateEnabled
  if (input.data.requiresCertificateApproval !== undefined) {
    data.requiresCertificateApproval = input.data.requiresCertificateApproval
  }
  // Trocar o modelo NÃO mexe em certificado já emitido: a resolução do visual
  // só roda numa criação de verdade de `Certificate` (ver `issueCertificate`,
  // atrás do flag `created`). O campo aqui vale para as próximas emissões.
  if (input.data.certificateTemplateId !== undefined) {
    await assertCertificateTemplateExists(input.actor.companyId, input.data.certificateTemplateId)
    data.certificateTemplateId = input.data.certificateTemplateId
  }
  // SUBADMIN só grava no próprio setor: um `sectorId` pedido para mover o
  // curso é ignorado (não recusado), o curso fica onde estava. ADMIN e
  // SUPER_ADMIN movem livremente, inclusive para nulo (empresa toda).
  if (input.data.sectorId !== undefined && input.actor.role !== 'SUBADMIN') {
    // Só valida o destino quando ele vai mesmo ser gravado: para SUBADMIN o
    // campo é ignorado (linha acima), então continua sendo ignorado — e não
    // recusado — mesmo com um id inválido.
    await assertSectorExists(input.actor.companyId, input.data.sectorId)
    data.sectorId = input.data.sectorId
  }

  if (input.data.status !== undefined && input.data.status !== before.status) {
    // A guarda continua valendo para PUBLICAR, e só para ela: mandar um curso
    // vazio para revisão é justamente o que os estados intermediários servem
    // para permitir.
    if (input.data.status === 'PUBLISHED' && before.modules.flatMap((m) => m.lessons).length === 0) {
      throw new CourseAdminError('Adicione ao menos uma aula antes de publicar o curso.', 409)
    }
    data.status = input.data.status
    // `publishedAt` é a PRIMEIRA publicação: ordena "Novos cursos" e não deve
    // pular para o topo a cada republicação — nem ser reescrito por um trânsito
    // entre rascunho e revisão.
    if (input.data.status === 'PUBLISHED' && !before.publishedAt) data.publishedAt = new Date()
  }

  const updated = await scopedPrisma(input.actor.companyId).course.update({ where: { id: input.courseId }, data })
  await syncCourseCatalogLinks(input.actor.companyId, input.courseId, input.data)
  // Ligar a matrícula automática e só ver efeito no dia seguinte confundiria
  // quem acabou de configurar — o tick horário cobre só quem entra depois.
  // Best-effort: falhar em matricular não desfaz o salvamento do curso.
  try {
    await runAutoEnrollmentForCourse(input.courseId)
  } catch (err) {
    console.error('[course-admin-service] Falha na matrícula automática após salvar.', err)
  }
  await recordAuditLog({
    actorId: input.actor.id,
    entityType: 'Course',
    entityId: input.courseId,
    action: 'UPDATE',
    before,
    after: updated,
    companyId: input.actor.companyId,
  })
  return courseResponse(input.actor, input.courseId)
}

export async function deleteCourse(input: { courseId: string; actor: CourseActor }): Promise<void> {
  const db = scopedPrisma(input.actor.companyId)
  const course = await loadCourseForWrite(input.actor, input.courseId)
  const enrolled = await db.courseEnrollment.count({ where: { courseId: input.courseId } })
  if (enrolled > 0) {
    throw new CourseAdminError(
      'Não é possível excluir um curso com pessoas inscritas. Despublique-o para tirá-lo do catálogo.',
      409,
    )
  }
  await db.course.delete({ where: { id: input.courseId } })
  await recordAuditLog({
    actorId: input.actor.id,
    entityType: 'Course',
    entityId: input.courseId,
    action: 'DELETE',
    before: course,
    companyId: input.actor.companyId,
  })
}

// ---------------------------------------------------------------------------
// Módulos e aulas
// ---------------------------------------------------------------------------

async function nextSortOrder(rows: { sortOrder: number }[]): Promise<number> {
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1
}

export async function createModule(input: {
  courseId: string
  data: CreateCourseModuleRequest
  actor: CourseActor
}): Promise<AdminCourseDTO> {
  // Módulo pertence a um curso: a mutação escapa a regra de setor se resolver
  // o curso pela leitura em vez da escrita — por isso `loadCourseForWrite`, não
  // `loadCourse`.
  const course = await loadCourseForWrite(input.actor, input.courseId)
  const title = input.data.title.trim()
  if (!title) throw new CourseAdminError('Informe o título do módulo.')

  await scopedPrisma(input.actor.companyId).courseModule.create({
    data: {
      courseId: input.courseId,
      title,
      description: input.data.description?.trim() || null,
      sortOrder: await nextSortOrder(course.modules),
    },
  })
  return courseResponse(input.actor, input.courseId)
}

/**
 * Resolve o módulo pelo curso dono, com o recorte de ESCRITA aplicado ao
 * curso (via filtro na relação `course`) — não só pelo `companyId`.
 */
async function findModuleForWrite(actor: CourseActor, moduleId: string) {
  const courseModule = await scopedPrisma(actor.companyId).courseModule.findFirst({
    where: { id: moduleId, course: writableCourseWhere(actor) },
  })
  if (!courseModule) throw new CourseAdminError('Módulo não encontrado.', 404)
  return courseModule
}

export async function updateModule(input: {
  moduleId: string
  data: UpdateCourseModuleRequest
  actor: CourseActor
}): Promise<AdminCourseDTO> {
  const courseModule = await findModuleForWrite(input.actor, input.moduleId)
  const data: Prisma.CourseModuleUpdateInput = {}
  if (input.data.title !== undefined) {
    const title = input.data.title.trim()
    if (!title) throw new CourseAdminError('Informe o título do módulo.')
    data.title = title
  }
  if (input.data.description !== undefined) data.description = input.data.description?.trim() || null
  if (input.data.sortOrder !== undefined) data.sortOrder = input.data.sortOrder

  await scopedPrisma(input.actor.companyId).courseModule.update({ where: { id: input.moduleId }, data })
  return courseResponse(input.actor, courseModule.courseId)
}

export async function deleteModule(input: { moduleId: string; actor: CourseActor }): Promise<AdminCourseDTO> {
  const courseModule = await findModuleForWrite(input.actor, input.moduleId)
  // As aulas do módulo saem junto (onDelete: Cascade), e com elas o progresso.
  await scopedPrisma(input.actor.companyId).courseModule.delete({ where: { id: input.moduleId } })
  return courseResponse(input.actor, courseModule.courseId)
}

function validateLessonDuration(minutes: number | undefined): void {
  if (minutes === undefined) return
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_LESSON_DURATION_MINUTES) {
    throw new CourseAdminError(`A duração da aula precisa ser de 0 a ${MAX_LESSON_DURATION_MINUTES} minutos.`)
  }
}

export async function createLesson(input: {
  moduleId: string
  data: CreateCourseLessonRequest
  actor: CourseActor
}): Promise<AdminCourseDTO> {
  const courseModule = await findModuleForWrite(input.actor, input.moduleId)
  const title = input.data.title.trim()
  if (!title) throw new CourseAdminError('Informe o título da aula.')
  validateLessonDuration(input.data.durationMinutes)

  const db = scopedPrisma(input.actor.companyId)
  const siblings = await db.courseLesson.findMany({ where: { moduleId: input.moduleId }, select: { sortOrder: true } })

  await db.courseLesson.create({
    data: {
      courseId: courseModule.courseId,
      moduleId: input.moduleId,
      title,
      description: input.data.description?.trim() || null,
      contentBlocks: input.data.blocks ?? [],
      durationMinutes: input.data.durationMinutes ?? 0,
      sortOrder: await nextSortOrder(siblings),
    },
  })
  return courseResponse(input.actor, courseModule.courseId)
}

/** Mesma lógica de `findModuleForWrite`, mas resolvendo pela aula. */
async function findLessonForWrite(actor: CourseActor, lessonId: string) {
  const lesson = await scopedPrisma(actor.companyId).courseLesson.findFirst({
    where: { id: lessonId, course: writableCourseWhere(actor) },
  })
  if (!lesson) throw new CourseAdminError('Aula não encontrada.', 404)
  return lesson
}

export async function updateLesson(input: {
  lessonId: string
  data: UpdateCourseLessonRequest
  actor: CourseActor
}): Promise<AdminCourseDTO> {
  const db = scopedPrisma(input.actor.companyId)
  const lesson = await findLessonForWrite(input.actor, input.lessonId)
  validateLessonDuration(input.data.durationMinutes)

  const data: Prisma.CourseLessonUpdateInput = {}
  if (input.data.title !== undefined) {
    const title = input.data.title.trim()
    if (!title) throw new CourseAdminError('Informe o título da aula.')
    data.title = title
  }
  if (input.data.description !== undefined) data.description = input.data.description?.trim() || null
  // A lista inteira é regravada: o editor manda o documento da aula, não um
  // patch de bloco. `[]` é apagar o conteúdo, e é intenção legítima.
  if (input.data.blocks !== undefined) data.contentBlocks = input.data.blocks
  if (input.data.durationMinutes !== undefined) data.durationMinutes = input.data.durationMinutes
  if (input.data.sortOrder !== undefined) data.sortOrder = input.data.sortOrder

  await db.courseLesson.update({ where: { id: input.lessonId }, data })
  return courseResponse(input.actor, lesson.courseId)
}

export async function deleteLesson(input: { lessonId: string; actor: CourseActor }): Promise<AdminCourseDTO> {
  const db = scopedPrisma(input.actor.companyId)
  const lesson = await findLessonForWrite(input.actor, input.lessonId)
  await db.courseLesson.delete({ where: { id: input.lessonId } })
  return courseResponse(input.actor, lesson.courseId)
}
