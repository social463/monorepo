import type { Course, CourseEnrollment, Prisma } from '@prisma/client'
import {
  MAX_COURSE_RATING,
  MIN_COURSE_RATING,
  type CertificateDTO,
  type CourseCardDTO,
  type CourseCatalogFilters,
  type CourseDetailDTO,
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
import { notifyBadgesEarned } from './notification-service'
import { ensureCertificateRequestForEnrollment, resolveCertificateTemplateForCourse } from './certificate-request-service'
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
}

const EMPTY_RATING = { average: 0, total: 0 }

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
export function visibleCourseWhere(
  viewerSectorId: string | null,
  ...extraFilters: Prisma.CourseWhereInput[]
): Prisma.CourseWhereInput {
  return {
    AND: [
      { published: true },
      { OR: [{ sectorId: null }, { sectorId: viewerSectorId }] },
      ...extraFilters,
    ],
  }
}

/**
 * Setor de quem lê. Resolvido aqui dentro (e não recebido no `Viewer`) para que
 * nenhum chamador novo consiga esquecer o recorte: é uma busca por chave primária.
 */
export async function viewerSectorId(viewer: Viewer): Promise<string | null> {
  const user = await scopedPrisma(viewer.companyId).user.findUnique({
    where: { id: viewer.userId },
    select: { sectorId: true },
  })
  return user?.sectorId ?? null
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
    }
  }

  const [ratingRows, studentRows, favoriteRows, enrollmentRows, lessonRows, progressRows] = await Promise.all([
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

  const where: Prisma.CourseWhereInput = visibleCourseWhere(await viewerSectorId(viewer), {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.onlyMandatory ? { mandatory: true } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { shortDescription: { contains: search, mode: 'insensitive' as const } },
            { category: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  })

  const all = await db.course.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }] })
  const context = await loadCatalogContext(viewer, all.map((course) => course.id))

  // Competência mora numa coluna Json (string[]); o filtro é aplicado em memória
  // porque o catálogo interno é pequeno e a busca por elemento de array em Json
  // não indexa de qualquer forma.
  const competencyFilter = filters.competency?.trim().toLowerCase()
  let courses = all
  if (competencyFilter) {
    courses = courses.filter((course) =>
      toStringArray(course.competencies).some((item) => item.toLowerCase() === competencyFilter),
    )
  }
  if (search) {
    const term = search.toLowerCase()
    // A busca livre também cobre competência, que o `where` do Prisma não alcança.
    const byCompetency = all.filter((course) =>
      toStringArray(course.competencies).some((item) => item.toLowerCase().includes(term)),
    )
    const seen = new Set(courses.map((course) => course.id))
    courses = [...courses, ...byCompetency.filter((course) => !seen.has(course.id))]
  }
  if (filters.onlyFavorites) {
    courses = courses.filter((course) => context.favorites.has(course.id))
  }

  return {
    courses: toCards(courses, context),
    categories: [...new Set(all.map((course) => course.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    competencies: [...new Set(all.flatMap((course) => toStringArray(course.competencies)))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    ),
  }
}

async function findPublishedCourse(viewer: Viewer, courseId: string): Promise<Course> {
  const course = await scopedPrisma(viewer.companyId).course.findFirst({
    where: visibleCourseWhere(await viewerSectorId(viewer), { id: courseId }),
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

  const [context, progressRows, myRating, certificate, quizzes] = await Promise.all([
    loadCatalogContext(viewer, [courseId]),
    db.lessonProgress.findMany({ where: { userId: viewer.userId, courseId }, select: { lessonId: true } }),
    db.courseRating.findUnique({ where: { userId_courseId: { userId: viewer.userId, courseId } } }),
    db.certificate.findUnique({
      where: { userId_courseId: { userId: viewer.userId, courseId } },
      include: { user: { select: { name: true } } },
    }),
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
    quizByLessonId,
    finalQuizId,
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
    where: { id: lessonId, course: visibleCourseWhere(await viewerSectorId(viewer)) },
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
 * Concede/revoga os selos de curso e avisa a pessoa. Best-effort dos dois lados:
 * nem a avaliação do selo nem a notificação derrubam a marcação da aula.
 */
async function syncLearningBadges(viewer: Viewer): Promise<void> {
  try {
    const { awarded } = await syncCourseBadgesForUser(viewer.userId)
    if (awarded.length === 0) return
    await notifyBadgesEarned(viewer.userId, awarded.map((entry) => entry.badgeId), viewer.companyId)
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
        await resolveCertificateTemplateForCourse(viewer.companyId, course),
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
    where: { userId: viewer.userId, course: visibleCourseWhere(await viewerSectorId(viewer)) },
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
  const sectorId = await viewerSectorId(viewer)

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
    where: { published: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      // O recorte entra no vínculo: curso fora do alcance nem chega à trilha,
      // nem entra na contagem de progresso dela.
      courses: {
        where: { course: visibleCourseWhere(await viewerSectorId(viewer)) },
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
        .filter((link) => link.course.published)
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
