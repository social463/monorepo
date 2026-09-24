import type { Course, CourseEnrollment, Prisma } from '@prisma/client'
import {
  MAX_COURSE_RATING,
  MIN_COURSE_RATING,
  type CertificateDTO,
  type CourseCardDTO,
  type CourseCatalogFilters,
  type CourseDetailDTO,
  type CourseInstructorRef,
  type CourseRatingDTO,
  type EnrollmentDTO,
  type LearningHomeResponse,
  type LearningSummaryDTO,
  type LearningTrackDTO,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { monthRefOf, todayInSaoPaulo, monthInstantBoundsInSaoPaulo } from '../lib/sao-paulo-date'
import { createCertificateRecord, hasUnpassedFinalQuiz, renderAndStoreCertificate } from '../lib/certificate-issuer'
import { syncCourseBadgesForUser } from './badge-service'
import { awardFixedCoins } from './coin-service'
import { awardFixedXp } from './xp-service'
import { settleBadgesEarned } from './badge-reward-service'
import {
  ensureCertificateRequestForEnrollment,
  resolveCertificateTemplateForCourse,
  toCertificateTemplateVisual,
} from './certificate-request-service'
import {
  courseProgressPct,
  toCertificateDTO,
  toCourseCardDTO,
  toCourseDetailDTO,
  toCourseRatingDTO,
  toEnrollmentDTO,
  toLearningTrackDTO,
  toStringArray,
  type CourseCardExtras,
} from '../lib/serialize-learning'

export class LearningError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'LearningError'
  }
}

export interface Viewer {
  userId: string
  companyId: string
}

/** Agregados por curso usados pra montar o card (avaliação, alunos, favorito, minha inscrição). */
interface CatalogContext {
  ratings: Map<string, { average: number; total: number }>
  students: Map<string, number>
  favorites: Set<string>
  enrollments: Map<string, CourseEnrollment>
  totalLessons: Map<string, number>
  completedLessons: Map<string, number>
  /** Duração do curso = soma das aulas. Derivada, nunca guardada no `Course`. */
  durationMinutes: Map<string, number>
  /**
   * Catálogo resolvido em lote (Documento 4, 9.6 e 9.7). Em lote, e não por
   * card, porque um catálogo de cinquenta cursos faria cinquenta consultas de
   * categoria e cinquenta de instrutor — o N+1 clássico.
   */
  categoryNames: Map<string, string>
  competencies: Map<string, string[]>
  instructors: Map<string, CourseInstructorRef[]>
}

const EMPTY_RATING = { average: 0, total: 0 }

const ordenarPtBr = (valores: Iterable<string>): string[] =>
  [...valores].sort((a, b) => a.localeCompare(b, 'pt-BR'))


/**
 * `select` do instrutor como as telas o exibem. Quando ele é colaborador
 * (`userId` preenchido), nome e foto vêm do `User` — a 9.7 pede que a base de
 * pessoas seja a fonte, e não uma cópia que envelhece.
 */
export const INSTRUCTOR_REF_SELECT = {
  id: true,
  name: true,
  photoUrl: true,
  bio: true,
  user: { select: { name: true, photoUrl: true } },
} as const

export function toInstructorRef(instructor: {
  id: string
  name: string
  photoUrl: string | null
  bio: string | null
  user: { name: string; photoUrl: string | null } | null
}): CourseInstructorRef {
  return {
    id: instructor.id,
    name: instructor.user?.name ?? instructor.name,
    photoUrl: instructor.user?.photoUrl ?? instructor.photoUrl,
    bio: instructor.bio,
  }
}

/** Agrupa linhas de uma tabela de ligação num Map por curso. */
function agrupar<T, V>(rows: T[], chave: (row: T) => string, valor: (row: T) => V): Map<string, V[]> {
  const mapa = new Map<string, V[]>()
  for (const row of rows) {
    const atual = mapa.get(chave(row)) ?? []
    atual.push(valor(row))
    mapa.set(chave(row), atual)
  }
  return mapa
}

/**
 * Recorte por setor na leitura, em um lugar só: a pessoa enxerga curso com
 * `sectorId` nulo (curso da empresa inteira) ou igual ao setor dela. Curso fora
 * do alcance se comporta como inexistente — 404, nunca 403, porque 403 já
 * confirmaria que o curso existe.
 *
 * Os filtros de quem chama entram por `extraFilters`, **nunca** por spread no
 * objeto devolvido: tudo vira item de um único `AND`, então nenhuma chave pode
 * sobrescrever outra. Espalhar seria a armadilha — o catálogo já usa `OR` na raiz
 * do `where` para a busca livre, e bastaria um filtro futuro trazer `OR` (ou `AND`)
 * para o recorte sumir em silêncio, sem erro e sem teste vermelho.
 */
/**
 * Quem enxerga o quê, num lugar só (Documento 4, seção 9.2).
 *
 * Duas restrições independentes, e as duas precisam passar:
 *
 * 1. **Setor** — o dono (`sectorId`) OU um dos setores de público. Nulo no dono
 *    e lista vazia no público = empresa toda.
 * 2. **Categoria do cargo** — lista vazia = sem restrição.
 *
 * **ATENÇÃO OPERACIONAL:** curso restrito por cargo fica invisível para quem
 * está com `positionCategory` vazio — que é todo mundo até a importação de
 * colaboradores rodar com a coluna nova. É a mesma pegadinha do `managerId` e
 * dos painéis da Liderança, e é comportamento correto: quem não tem o atributo
 * não casa com a restrição.
 */
export function visibleCourseWhere(
  viewer: { sectorId: string | null; positionCategory: string | null },
  ...extraFilters: Prisma.CourseWhereInput[]
): Prisma.CourseWhereInput {
  return {
    AND: [
      { status: 'PUBLISHED' },
      {
        OR: [
          { sectorId: null, audienceSectors: { none: {} } },
          { sectorId: viewer.sectorId },
          ...(viewer.sectorId ? [{ audienceSectors: { some: { sectorId: viewer.sectorId } } }] : []),
        ],
      },
      {
        OR: [
          { audiencePositionCategories: { isEmpty: true } },
          ...(viewer.positionCategory
            ? [{ audiencePositionCategories: { has: viewer.positionCategory } }]
            : []),
        ],
      },
      ...extraFilters,
    ],
  }
}

/**
 * Setor de quem lê. Resolvido aqui dentro (e não recebido no `Viewer`) para que
 * nenhum chamador novo consiga esquecer o recorte: é uma busca por chave primária.
 */
export async function viewerScope(
  viewer: Viewer,
): Promise<{ sectorId: string | null; positionCategory: string | null }> {
  const user = await scopedPrisma(viewer.companyId).user.findUnique({
    where: { id: viewer.userId },
    select: { sectorId: true, positionCategory: true },
  })
  return { sectorId: user?.sectorId ?? null, positionCategory: user?.positionCategory ?? null }
}

async function loadCatalogContext(viewer: Viewer, courseIds: string[]): Promise<CatalogContext> {
  const db = scopedPrisma(viewer.companyId)
  if (courseIds.length === 0) {
    return {
      ratings: new Map(),
      students: new Map(),
      favorites: new Set(),
      enrollments: new Map(),
      totalLessons: new Map(),
      completedLessons: new Map(),
      durationMinutes: new Map(),
      categoryNames: new Map(),
      competencies: new Map(),
      instructors: new Map(),
    }
  }

  const [
    ratingRows,
    studentRows,
    favoriteRows,
    enrollmentRows,
    lessonRows,
    progressRows,
    categoryRows,
    competencyRows,
    instructorRows,
  ] = await Promise.all([
    db.courseRating.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds } },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    db.courseEnrollment.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds } },
      _count: { _all: true },
    }),
    db.courseFavorite.findMany({ where: { userId: viewer.userId, courseId: { in: courseIds } }, select: { courseId: true } }),
    db.courseEnrollment.findMany({ where: { userId: viewer.userId, courseId: { in: courseIds } } }),
    db.courseLesson.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds } },
      _count: { _all: true },
      _sum: { durationMinutes: true },
    }),
    db.lessonProgress.groupBy({
      by: ['courseId'],
      where: { userId: viewer.userId, courseId: { in: courseIds } },
      _count: { _all: true },
    }),
    db.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, courseCategory: { select: { name: true } } },
    }),
    db.courseCompetency.findMany({
      where: { courseId: { in: courseIds } },
      select: { courseId: true, competency: { select: { name: true } } },
      orderBy: { competency: { name: 'asc' } },
    }),
    db.courseInstructor.findMany({
      where: { courseId: { in: courseIds } },
      select: {
        courseId: true,
        instructor: { select: INSTRUCTOR_REF_SELECT },
      },
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  return {
    ratings: new Map(
      ratingRows.map((row) => [
        row.courseId,
        { average: Math.round((row._avg.rating ?? 0) * 10) / 10, total: row._count._all },
      ]),
    ),
    students: new Map(studentRows.map((row) => [row.courseId, row._count._all])),
    favorites: new Set(favoriteRows.map((row) => row.courseId)),
    enrollments: new Map(enrollmentRows.map((row) => [row.courseId, row])),
    totalLessons: new Map(lessonRows.map((row) => [row.courseId, row._count._all])),
    completedLessons: new Map(progressRows.map((row) => [row.courseId, row._count._all])),
    durationMinutes: new Map(lessonRows.map((row) => [row.courseId, row._sum.durationMinutes ?? 0])),
    categoryNames: new Map(
      categoryRows.flatMap((row) => (row.courseCategory ? [[row.id, row.courseCategory.name] as const] : [])),
    ),
    competencies: agrupar(competencyRows, (row) => row.courseId, (row) => row.competency.name),
    instructors: agrupar(instructorRows, (row) => row.courseId, (row) => toInstructorRef(row.instructor)),
  }
}

function cardExtras(courseId: string, context: CatalogContext): CourseCardExtras {
  const rating = context.ratings.get(courseId) ?? EMPTY_RATING
  return {
    favorite: context.favorites.has(courseId),
    enrollment: context.enrollments.get(courseId) ?? null,
    progressPct: courseProgressPct(context.completedLessons.get(courseId) ?? 0, context.totalLessons.get(courseId) ?? 0),
    averageRating: rating.average,
    totalRatings: rating.total,
    totalStudents: context.students.get(courseId) ?? 0,
    durationMinutes: context.durationMinutes.get(courseId) ?? 0,
    categoryName: context.categoryNames.get(courseId) ?? null,
    competencies: context.competencies.get(courseId) ?? [],
    instructors: context.instructors.get(courseId) ?? [],
  }
}

function toCards(courses: Course[], context: CatalogContext): CourseCardDTO[] {
  return courses.map((course) => toCourseCardDTO(course, cardExtras(course.id, context)))
}

export async function listCourses(
  viewer: Viewer,
  filters: CourseCatalogFilters = {},
): Promise<{ courses: CourseCardDTO[]; categories: string[]; competencies: string[] }> {
  const db = scopedPrisma(viewer.companyId)
  const search = filters.search?.trim()

  const where: Prisma.CourseWhereInput = visibleCourseWhere(await viewerScope(viewer), {
    ...(filters.category ? { courseCategory: { name: filters.category } } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.onlyMandatory ? { mandatory: true } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { shortDescription: { contains: search, mode: 'insensitive' as const } },
            { courseCategory: { name: { contains: search, mode: 'insensitive' as const } } },
            // Competência virou relação (Documento 4, seção 9.6): a busca por
            // ela passou a caber no `where`. Antes era coluna Json, e precisava
            // de uma segunda passada em memória.
            {
              competencyLinks: {
                some: { competency: { name: { contains: search, mode: 'insensitive' as const } } },
              },
            },
          ],
        }
      : {}),
    ...(filters.competency
      ? { competencyLinks: { some: { competency: { name: filters.competency } } } }
      : {}),
  })

  const all = await db.course.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }] })
  const context = await loadCatalogContext(viewer, all.map((course) => course.id))

  let courses = all
  if (filters.onlyFavorites) {
    courses = courses.filter((course) => context.favorites.has(course.id))
  }

  return {
    courses: toCards(courses, context),
    // Das categorias e competências dos cursos VISÍVEIS, e não do catálogo
    // inteiro da empresa. É o que impede a opção de filtro de revelar a
    // existência de um curso de outro setor — e, de quebra, o que evita oferecer
    // um filtro que não devolveria nada.
    categories: ordenarPtBr(new Set([...context.categoryNames.values()])),
    competencies: ordenarPtBr(new Set([...context.competencies.values()].flat())),
  }
}

async function findPublishedCourse(viewer: Viewer, courseId: string): Promise<Course> {
  const course = await scopedPrisma(viewer.companyId).course.findFirst({
    where: visibleCourseWhere(await viewerScope(viewer), { id: courseId }),
  })
  // Curso em rascunho — ou de outro setor — é tratado como inexistente: não vaza
  // a existência por URL direta.
  if (!course) throw new LearningError('Curso não encontrado.', 404)
  return course
}

export async function getCourseDetail(viewer: Viewer, courseId: string): Promise<CourseDetailDTO> {
  const db = scopedPrisma(viewer.companyId)
  await findPublishedCourse(viewer, courseId)

  const course = await db.course.findUnique({
    where: { id: courseId },
    include: { modules: { orderBy: { sortOrder: 'asc' }, include: { lessons: { orderBy: { sortOrder: 'asc' } } } } },
  })
  if (!course) throw new LearningError('Curso não encontrado.', 404)

  const [context, progressRows, myRating, certificate, certificateRequest, quizzes] = await Promise.all([
    loadCatalogContext(viewer, [courseId]),
    db.lessonProgress.findMany({ where: { userId: viewer.userId, courseId }, select: { lessonId: true } }),
    db.courseRating.findUnique({ where: { userId_courseId: { userId: viewer.userId, courseId } } }),
    db.certificate.findUnique({
      where: { userId_courseId: { userId: viewer.userId, courseId } },
      include: { user: { select: { name: true } } },
    }),
    db.certificateRequest.findFirst({ where: { userId: viewer.userId, courseId } }),
    db.courseQuiz.findMany({ where: { courseId }, select: { id: true, lessonId: true } }),
  ])

  // Um quiz por aula (`lessonId` preenchido) + no máximo um quiz final
  // (`lessonId: null`) — a pessoa só precisa do id pra navegar até ele.
  const quizByLessonId = new Map(
    quizzes.filter((quiz) => quiz.lessonId != null).map((quiz) => [quiz.lessonId as string, quiz.id]),
  )
  const finalQuizId = quizzes.find((quiz) => quiz.lessonId == null)?.id ?? null

  return toCourseDetailDTO(course, {
    ...cardExtras(courseId, context),
    completedLessonIds: new Set(progressRows.map((row) => row.lessonId)),
    totalLessons: context.totalLessons.get(courseId) ?? 0,
    myRating,
    certificate,
    certificateRequest,
    quizByLessonId,
    finalQuizId,
  })
}

/**
 * Pedido explícito de certificado, feito pela pessoa ao concluir o curso
 * (Documento 4, seção 9.3).
 *
 * A emissão automática continua onde estava (`issueCertificate`, chamada por
 * `setLessonCompletion`): quem concluir um curso que não exige aprovação
 * recebe o certificado sem pedir nada. O que faltava era o caminho manual —
 * a fila existia, mas só o servidor sabia enfileirar, e quem esperava não
 * tinha o que clicar nem o que ler.
 *
 * Idempotente pelo mesmo motivo que `ensureCertificateRequestForEnrollment`:
 * o par (inscrição, solicitação) é único, e pedir de novo é no-op — ou
 * reabertura, quando a anterior foi recusada.
 */
export async function requestCertificate(viewer: Viewer, courseId: string): Promise<void> {
  const db = scopedPrisma(viewer.companyId)
  const course = await findPublishedCourse(viewer, courseId)

  if (!course.certificateEnabled) {
    throw new LearningError('Este curso não emite certificado.', 400)
  }

  const enrollment = await db.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: viewer.userId, courseId } },
  })
  if (!enrollment || enrollment.status !== 'COMPLETED') {
    throw new LearningError('Conclua o curso antes de solicitar o certificado.', 400)
  }

  // Certificado já emitido não vira pedido: não há o que aprovar.
  const existing = await db.certificate.findUnique({
    where: { userId_courseId: { userId: viewer.userId, courseId } },
  })
  if (existing) return

  await ensureCertificateRequestForEnrollment(db, {
    enrollmentId: enrollment.id,
    userId: viewer.userId,
    courseId,
  })
}

export async function enrollInCourse(viewer: Viewer, courseId: string): Promise<EnrollmentDTO> {
  const db = scopedPrisma(viewer.companyId)
  const course = await findPublishedCourse(viewer, courseId)

  // Segunda inscrição no mesmo curso não cria uma segunda linha.
  let enrollment = await db.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: viewer.userId, courseId } },
  })
  if (!enrollment) {
    try {
      enrollment = await db.courseEnrollment.create({
        data: { userId: viewer.userId, courseId, lastAccessedAt: new Date() },
      })
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err
      enrollment = await db.courseEnrollment.findUniqueOrThrow({
        where: { userId_courseId: { userId: viewer.userId, courseId } },
      })
    }
  }

  const context = await loadCatalogContext(viewer, [courseId])
  const extras = cardExtras(courseId, context)
  return toEnrollmentDTO(enrollment, toCourseCardDTO(course, extras), extras.progressPct)
}

/** Marca (ou desmarca) uma aula. Idempotente: reabrir e marcar de novo não conta duas vezes. */
export async function setLessonCompletion(
  viewer: Viewer,
  lessonId: string,
  completed: boolean,
): Promise<{
  progressPct: number
  completedLessons: number
  totalLessons: number
  status: CourseEnrollment['status']
  certificate: CertificateDTO | null
}> {
  const db = scopedPrisma(viewer.companyId)
  const lesson = await db.courseLesson.findFirst({
    where: { id: lessonId, course: visibleCourseWhere(await viewerScope(viewer)) },
    include: { course: true },
  })
  // Aula de curso em rascunho — ou de outro setor — é inexistente para quem lê.
  if (!lesson) throw new LearningError('Aula não encontrada.', 404)

  const enrollment = await db.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: viewer.userId, courseId: lesson.courseId } },
  })
  if (!enrollment) throw new LearningError('Inscreva-se no curso antes de acompanhar as aulas.', 409)

  if (completed) {
    const existing = await db.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: viewer.userId, lessonId } },
    })
    if (!existing) {
      try {
        await db.lessonProgress.create({ data: { userId: viewer.userId, lessonId, courseId: lesson.courseId } })
      } catch (err) {
        // P2002 = alguém marcou a mesma aula em paralelo; segue idempotente.
        if ((err as { code?: string }).code !== 'P2002') throw err
      }
    }
  } else {
    await db.lessonProgress.deleteMany({ where: { userId: viewer.userId, lessonId } })
  }

  const [totalLessons, completedLessons] = await Promise.all([
    db.courseLesson.count({ where: { courseId: lesson.courseId } }),
    db.lessonProgress.count({ where: { userId: viewer.userId, courseId: lesson.courseId } }),
  ])

  const finished = totalLessons > 0 && completedLessons >= totalLessons
  const updated = await db.courseEnrollment.update({
    where: { id: enrollment.id },
    data: {
      lastAccessedAt: new Date(),
      lastLessonId: lessonId,
      status: finished ? 'COMPLETED' : 'IN_PROGRESS',
      // Só carimba a conclusão na primeira vez; desmarcar uma aula limpa a data.
      completedAt: finished ? (enrollment.completedAt ?? new Date()) : null,
    },
  })

  const certificate = finished ? await issueCertificate(viewer, lesson.course) : null
  // Recompensa do curso (Documento 4, seção 9.6) antes dos selos: os dois são
  // best-effort pelo mesmo motivo — falhar aqui não pode desfazer o progresso
  // que a pessoa acabou de registrar.
  if (finished) await awardCourseReward(viewer, lesson.course)
  // Selos de Aprendizado: best-effort, igual à avaliação pós-voto — falhar aqui
  // não pode desfazer o progresso que a pessoa acabou de registrar.
  await syncLearningBadges(viewer)

  return {
    progressPct: courseProgressPct(completedLessons, totalLessons),
    completedLessons,
    totalLessons,
    status: updated.status,
    certificate,
  }
}

/**
 * Credita a recompensa do curso concluído (Documento 4, seção 9.6).
 *
 * **Idempotente sem esforço próprio:** o `dedupeKey` é `COURSE_COMPLETED:<id do
 * curso>` e `CoinTransaction`/`XpTransaction` têm `@@unique([userId,
 * dedupeKey])`. Reconcluir o curso — desmarcar uma aula e marcar de novo — não
 * paga duas vezes, e não é preciso perguntar antes se já pagou.
 *
 * **Não é `CoinRule`.** Aquela só sabe valor fixo por evento, e aqui o valor é
 * do curso. Mesmo caso do desafio e do selo, que também usam
 * `awardFixedCoins`/`awardFixedXp` — por isso `COURSE_COMPLETED` fica de fora
 * de `COIN_RULE_EVENTS`: uma regra criada para ele não teria efeito nenhum.
 *
 * Zero em qualquer um dos dois não gera lançamento: `awardFixed*` devolve
 * `SKIPPED`, e um extrato com "0 EMR Coins" seria ruído.
 */
async function awardCourseReward(
  viewer: Viewer,
  course: { id: string; rewardPoints: number; rewardCoins: number },
): Promise<void> {
  try {
    await Promise.all([
      awardFixedCoins({
        userId: viewer.userId,
        companyId: viewer.companyId,
        amount: course.rewardCoins,
        event: 'COURSE_COMPLETED',
        reference: course.id,
      }),
      awardFixedXp({
        userId: viewer.userId,
        companyId: viewer.companyId,
        amount: course.rewardPoints,
        event: 'COURSE_COMPLETED',
        reference: course.id,
      }),
    ])
  } catch (err) {
    // Best-effort, como os selos: o progresso já foi gravado, e desfazê-lo por
    // causa de um crédito seria pior do que ficar sem o crédito.
    console.error('[learning-service] Falha ao creditar a recompensa do curso.', err)
  }
}

/**
 * Concede/revoga os selos de curso e avisa a pessoa. Best-effort dos dois lados:
 * nem a avaliação do selo nem a notificação derrubam a marcação da aula.
 */
async function syncLearningBadges(viewer: Viewer): Promise<void> {
  try {
    const { awarded } = await syncCourseBadgesForUser(viewer.userId)
    if (awarded.length === 0) return
    await settleBadgesEarned(viewer.userId, awarded.map((entry) => entry.badgeId), viewer.companyId)
  } catch {
    // silencioso de propósito
  }
}

/**
 * Emite o certificado da inscrição concluída. Idempotente pelo par (userId, courseId):
 * concluir de novo devolve o mesmo certificado, com o mesmo código.
 *
 * Ordem das guardas (Task 9): certificado desabilitado → inscrição não
 * concluída → quiz final reprovado/não feito → aprovação obrigatória (cria
 * `CertificateRequest` PENDING e não emite) → emite como sempre.
 */
export async function issueCertificate(viewer: Viewer, course: Course): Promise<CertificateDTO | null> {
  if (!course.certificateEnabled) return null
  const db = scopedPrisma(viewer.companyId)

  const existing = await db.certificate.findUnique({
    where: { userId_courseId: { userId: viewer.userId, courseId: course.id } },
    include: { user: { select: { name: true } } },
  })
  if (existing) return toCertificateDTO(existing)

  const enrollment = await db.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: viewer.userId, courseId: course.id } },
  })
  // Certificado só sai para inscrição concluída.
  if (!enrollment || enrollment.status !== 'COMPLETED') return null

  if (await hasUnpassedFinalQuiz(db, course.id, viewer.userId)) return null

  if (course.requiresCertificateApproval) {
    await ensureCertificateRequestForEnrollment(db, {
      enrollmentId: enrollment.id,
      userId: viewer.userId,
      courseId: course.id,
    })
    return null
  }

  const { certificate, created } = await createCertificateRecord(db, {
    userId: viewer.userId,
    courseId: course.id,
    courseTitle: course.title,
  })
  // O modelo visual (Task 8) só entra numa emissão de verdade, nunca ao
  // devolver um certificado já existente — é o que garante que um certificado
  // já emitido nunca muda de visual num re-render (ver `renderAndStoreCertificate`,
  // que só é chamada aqui, quando `created` é true).
  const withImage = created
    ? await renderAndStoreCertificate(
        viewer.companyId,
        certificate,
        course,
        await toCertificateTemplateVisual(
          viewer.companyId,
          await resolveCertificateTemplateForCourse(viewer.companyId, course),
        ),
      )
    : certificate
  return toCertificateDTO(withImage)
}

export async function rateCourse(
  viewer: Viewer,
  courseId: string,
  input: { rating: number; comment?: string | null },
): Promise<{ rating: CourseRatingDTO; averageRating: number; totalRatings: number }> {
  const db = scopedPrisma(viewer.companyId)
  await findPublishedCourse(viewer, courseId)
  if (!Number.isInteger(input.rating) || input.rating < MIN_COURSE_RATING || input.rating > MAX_COURSE_RATING) {
    throw new LearningError(`A nota precisa ser um número inteiro de ${MIN_COURSE_RATING} a ${MAX_COURSE_RATING}.`)
  }

  const comment = input.comment?.trim() || null
  const existing = await db.courseRating.findUnique({ where: { userId_courseId: { userId: viewer.userId, courseId } } })
  // Uma nota por pessoa por curso: avaliar de novo atualiza a existente.
  const rating = existing
    ? await db.courseRating.update({ where: { id: existing.id }, data: { rating: input.rating, comment } })
    : await db.courseRating.create({ data: { userId: viewer.userId, courseId, rating: input.rating, comment } })

  const aggregate = await db.courseRating.aggregate({
    where: { courseId },
    _avg: { rating: true },
    _count: { _all: true },
  })
  return {
    rating: toCourseRatingDTO(rating),
    averageRating: Math.round((aggregate._avg.rating ?? 0) * 10) / 10,
    totalRatings: aggregate._count._all,
  }
}

export async function setCourseFavorite(viewer: Viewer, courseId: string, favorite: boolean): Promise<void> {
  const db = scopedPrisma(viewer.companyId)
  await findPublishedCourse(viewer, courseId)
  if (favorite) {
    try {
      await db.courseFavorite.create({ data: { userId: viewer.userId, courseId } })
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err
    }
  } else {
    await db.courseFavorite.deleteMany({ where: { userId: viewer.userId, courseId } })
  }
}

async function listMyEnrollments(viewer: Viewer): Promise<{ enrollments: EnrollmentDTO[]; context: CatalogContext }> {
  const db = scopedPrisma(viewer.companyId)
  const rows = await db.courseEnrollment.findMany({
    where: { userId: viewer.userId, course: visibleCourseWhere(await viewerScope(viewer)) },
    include: { course: true },
    orderBy: [{ lastAccessedAt: 'desc' }, { startedAt: 'desc' }],
  })
  const context = await loadCatalogContext(viewer, rows.map((row) => row.courseId))
  const enrollments = rows.map((row) => {
    const extras = cardExtras(row.courseId, context)
    return toEnrollmentDTO(row, toCourseCardDTO(row.course, extras), extras.progressPct)
  })
  return { enrollments, context }
}

export async function learningSummary(viewer: Viewer): Promise<LearningSummaryDTO> {
  const db = scopedPrisma(viewer.companyId)
  const { start, endExclusive } = monthInstantBoundsInSaoPaulo(monthRefOf(todayInSaoPaulo().ymd))
  const sectorId = await viewerScope(viewer)

  const [monthProgress, certificates, enrollments, mandatoryCourses] = await Promise.all([
    db.lessonProgress.findMany({
      where: { userId: viewer.userId, completedAt: { gte: start, lt: endExclusive } },
      select: { lesson: { select: { durationMinutes: true } } },
    }),
    // Certificado emitido e minutos já estudados NÃO levam o recorte de propósito:
    // são registro do que a pessoa fez, não catálogo. Sumir com um certificado
    // porque a pessoa trocou de setor apagaria conquista (e ele segue verificável
    // pelo código público, fora de qualquer escopo).
    db.certificate.count({ where: { userId: viewer.userId } }),
    // As inscrições, sim: `inProgress` sai daqui e `continueLearning` (na home) sai
    // do `listMyEnrollments`, que é recortado — sem o mesmo recorte aqui, a tela
    // mostraria "1 em andamento" com a lista de continuar vazia.
    db.courseEnrollment.findMany({
      where: { userId: viewer.userId, course: visibleCourseWhere(sectorId) },
      select: { courseId: true, status: true },
    }),
    db.course.findMany({ where: visibleCourseWhere(sectorId, { mandatory: true }), select: { id: true } }),
  ])

  const completedCourseIds = new Set(
    enrollments.filter((enrollment) => enrollment.status === 'COMPLETED').map((enrollment) => enrollment.courseId),
  )
  return {
    monthMinutes: monthProgress.reduce((sum, row) => sum + row.lesson.durationMinutes, 0),
    certificates,
    inProgress: enrollments.filter((enrollment) => enrollment.status === 'IN_PROGRESS').length,
    pendingMandatory: mandatoryCourses.filter((course) => !completedCourseIds.has(course.id)).length,
  }
}

export async function myLearning(viewer: Viewer): Promise<{ enrollments: EnrollmentDTO[]; summary: LearningSummaryDTO }> {
  const [{ enrollments }, summary] = await Promise.all([listMyEnrollments(viewer), learningSummary(viewer)])
  return { enrollments, summary }
}

export async function learningHome(viewer: Viewer): Promise<LearningHomeResponse> {
  const [{ courses }, { enrollments }, summary, tracks] = await Promise.all([
    listCourses(viewer),
    listMyEnrollments(viewer),
    learningSummary(viewer),
    listTracks(viewer),
  ])

  const enrolledIds = new Set(enrollments.map((enrollment) => enrollment.courseId))
  const completedIds = new Set(
    enrollments.filter((enrollment) => enrollment.status === 'COMPLETED').map((enrollment) => enrollment.courseId),
  )

  return {
    summary,
    continueLearning: enrollments.filter((enrollment) => enrollment.status === 'IN_PROGRESS').slice(0, 3),
    mandatory: courses.filter((course) => course.mandatory && !completedIds.has(course.id)).slice(0, 6),
    recommended: courses.filter((course) => !enrolledIds.has(course.id)).slice(0, 6),
    newest: courses.slice(0, 6),
    popular: [...courses].sort((a, b) => b.totalStudents - a.totalStudents).slice(0, 6),
    tracks: tracks.slice(0, 3),
  }
}

export async function listTracks(viewer: Viewer): Promise<LearningTrackDTO[]> {
  const db = scopedPrisma(viewer.companyId)
  const tracks = await db.learningTrack.findMany({
    // `LearningTrack.published` continua booleano: o ciclo de cinco estados é do
    // CURSO (seção 9.6), e o documento não pede o mesmo para a trilha.
    where: { published: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      // O recorte entra no vínculo: curso fora do alcance nem chega à trilha,
      // nem entra na contagem de progresso dela.
      courses: {
        where: { course: visibleCourseWhere(await viewerScope(viewer)) },
        orderBy: { sortOrder: 'asc' },
        include: { course: true },
      },
    },
  })

  const courseIds = tracks.flatMap((track) => track.courses.map((link) => link.courseId))
  const context = await loadCatalogContext(viewer, [...new Set(courseIds)])

  return tracks.map((track) =>
    toLearningTrackDTO(
      track,
      track.courses
        .filter((link) => link.course.status === 'PUBLISHED')
        .map((link) => toCourseCardDTO(link.course, cardExtras(link.courseId, context))),
    ),
  )
}

export async function getTrack(viewer: Viewer, trackId: string): Promise<LearningTrackDTO> {
  const track = (await listTracks(viewer)).find((item) => item.id === trackId)
  if (!track) throw new LearningError('Trilha não encontrada.', 404)
  return track
}

export async function listCertificates(viewer: Viewer): Promise<CertificateDTO[]> {
  const rows = await scopedPrisma(viewer.companyId).certificate.findMany({
    where: { userId: viewer.userId },
    orderBy: { issuedAt: 'desc' },
    include: { user: { select: { name: true } } },
  })
  return rows.map(toCertificateDTO)
}

/**
 * Verificação pública do certificado (sem login, pro compartilhamento no LinkedIn):
 * a busca é pelo código, fora do escopo de empresa — por isso usa `prisma` direto.
 */
export async function findCertificateByCode(code: string) {
  const certificate = await prisma.certificate.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { user: { select: { name: true } }, company: { select: { name: true } } },
  })
  if (!certificate) throw new LearningError('Certificado não encontrado.', 404)
  return certificate
}
