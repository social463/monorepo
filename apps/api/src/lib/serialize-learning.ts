import type {
  Certificate,
  CertificateRequest,
  Course,
  CourseEnrollment,
  CourseLesson,
  CourseModule,
  CourseRating,
  LearningTrack,
} from '@prisma/client'
import type {
  CertificateDTO,
  CourseCardDTO,
  CourseDetailDTO,
  CourseEnrollmentSummary,
  CourseLessonDTO,
  CourseInstructorRef,
  CourseModuleDTO,
  CourseRatingDTO,
  EnrollmentDTO,
  LearningTrackDTO,
  PublicCertificateDTO,
} from '@legends/shared'
import { parseCourseLessonBlocks } from '@legends/shared'

/** Lê uma coluna Json que guarda `string[]` (competências, objetivos). */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** Percentual do curso derivado das aulas concluídas — nunca de um contador salvo. */
export function courseProgressPct(completedLessons: number, totalLessons: number): number {
  if (totalLessons <= 0) return 0
  return Math.min(100, Math.round((completedLessons / totalLessons) * 100))
}

export interface CourseCardExtras {
  favorite: boolean
  enrollment: CourseEnrollment | null
  progressPct: number
  averageRating: number
  totalRatings: number
  totalStudents: number
  /** Soma da duração das aulas — derivada, o curso não guarda um total próprio. */
  durationMinutes: number
  /**
   * Catálogo já resolvido (Documento 4, seções 9.6 e 9.7). Vem de fora porque o
   * serializer é síncrono e puro: quem consulta é o service, que já carrega o
   * curso com os includes e evita um N+1 por card.
   */
  categoryName: string | null
  competencies: string[]
  instructors: CourseInstructorRef[]
}

function toEnrollmentSummary(enrollment: CourseEnrollment, progressPct: number): CourseEnrollmentSummary {
  return {
    status: enrollment.status,
    progressPct,
    completedAt: enrollment.completedAt?.toISOString() ?? null,
    lastAccessedAt: enrollment.lastAccessedAt?.toISOString() ?? null,
    lastLessonId: enrollment.lastLessonId,
  }
}

export function toCourseCardDTO(course: Course, extras: CourseCardExtras): CourseCardDTO {
  return {
    id: course.id,
    title: course.title,
    shortDescription: course.shortDescription,
    coverUrl: course.coverUrl,
    icon: course.icon,
    primaryColor: course.primaryColor,
    // Nomes, não ids: o card e o detalhe só exibem. Quem trabalha com id é a
    // autoria (`AdminCourseDTO`), que é formulário.
    category: extras.categoryName,
    level: course.level,
    instructorName: extras.instructors[0]?.name ?? null,
    durationMinutes: extras.durationMinutes,
    competencies: extras.competencies,
    mandatory: course.mandatory,
    certificateEnabled: course.certificateEnabled,
    averageRating: extras.averageRating,
    totalRatings: extras.totalRatings,
    totalStudents: extras.totalStudents,
    favorite: extras.favorite,
    publishedAt: course.publishedAt?.toISOString() ?? null,
    enrollment: extras.enrollment ? toEnrollmentSummary(extras.enrollment, extras.progressPct) : null,
  }
}

export function toCourseLessonDTO(lesson: CourseLesson, completed: boolean, quizId: string | null = null): CourseLessonDTO {
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    title: lesson.title,
    description: lesson.description,
    // `parse` e não cast: `contentBlocks` é Json, e bloco que não casa com o
    // formato é descartado em vez de derrubar a aula (ver o módulo do bloco).
    blocks: parseCourseLessonBlocks(lesson.contentBlocks),
    durationMinutes: lesson.durationMinutes,
    sortOrder: lesson.sortOrder,
    completed,
    quizId,
  }
}

export function toCourseModuleDTO(
  module: CourseModule & { lessons: CourseLesson[] },
  completedLessonIds: Set<string>,
  /** Aula → id do quiz daquela aula, quando houver (quiz final não entra aqui). */
  quizByLessonId: Map<string, string> = new Map(),
): CourseModuleDTO {
  return {
    id: module.id,
    title: module.title,
    description: module.description,
    sortOrder: module.sortOrder,
    lessons: module.lessons.map((lesson) =>
      toCourseLessonDTO(lesson, completedLessonIds.has(lesson.id), quizByLessonId.get(lesson.id) ?? null),
    ),
  }
}

export function toCourseRatingDTO(rating: CourseRating): CourseRatingDTO {
  return {
    rating: rating.rating,
    comment: rating.comment,
    updatedAt: rating.updatedAt.toISOString(),
  }
}

export function toCourseDetailDTO(
  course: Course & { modules: (CourseModule & { lessons: CourseLesson[] })[] },
  extras: CourseCardExtras & {
    completedLessonIds: Set<string>
    totalLessons: number
    myRating: CourseRating | null
    certificate: (Certificate & { user: { name: string } }) | null
    /** Solicitação de certificado desta pessoa neste curso, quando existe. */
    certificateRequest?: CertificateRequest | null
    /** Aula → id do quiz daquela aula, quando houver. */
    quizByLessonId?: Map<string, string>
    /** Id do quiz final do curso (`lessonId: null`), quando houver. */
    finalQuizId?: string | null
  },
): CourseDetailDTO {
  return {
    ...toCourseCardDTO(course, extras),
    description: course.description,
    objectives: toStringArray(course.objectives),
    prerequisites: course.prerequisites,
    bannerUrl: course.bannerUrl,
    introVideoUrl: course.introVideoUrl,
    instructors: extras.instructors,
    modules: course.modules.map((module) =>
      toCourseModuleDTO(module, extras.completedLessonIds, extras.quizByLessonId),
    ),
    totalLessons: extras.totalLessons,
    completedLessons: extras.completedLessonIds.size,
    myRating: extras.myRating ? toCourseRatingDTO(extras.myRating) : null,
    certificate: extras.certificate ? toCertificateDTO(extras.certificate) : null,
    certificateRequest: extras.certificateRequest
      ? {
          status: extras.certificateRequest.status,
          rejectionReason: extras.certificateRequest.rejectionReason,
          createdAt: extras.certificateRequest.createdAt.toISOString(),
        }
      : null,
    finalQuizId: extras.finalQuizId ?? null,
  }
}

export function toEnrollmentDTO(enrollment: CourseEnrollment, course: CourseCardDTO, progressPct: number): EnrollmentDTO {
  return {
    id: enrollment.id,
    courseId: enrollment.courseId,
    status: enrollment.status,
    progressPct,
    startedAt: enrollment.startedAt.toISOString(),
    completedAt: enrollment.completedAt?.toISOString() ?? null,
    lastAccessedAt: enrollment.lastAccessedAt?.toISOString() ?? null,
    lastLessonId: enrollment.lastLessonId,
    course,
  }
}

export function toCertificateDTO(certificate: Certificate & { user: { name: string } }): CertificateDTO {
  return {
    id: certificate.id,
    code: certificate.code,
    title: certificate.title,
    hours: certificate.hours,
    issuedAt: certificate.issuedAt.toISOString(),
    courseId: certificate.courseId,
    imageUrl: certificate.imageUrl,
    userName: certificate.user.name,
  }
}

export function toPublicCertificateDTO(
  certificate: Certificate & { user: { name: string }; company: { name: string } },
): PublicCertificateDTO {
  return {
    code: certificate.code,
    title: certificate.title,
    hours: certificate.hours,
    issuedAt: certificate.issuedAt.toISOString(),
    userName: certificate.user.name,
    companyName: certificate.company.name,
    imageUrl: certificate.imageUrl,
  }
}

export function toLearningTrackDTO(track: LearningTrack, courses: CourseCardDTO[]): LearningTrackDTO {
  const progressPct =
    courses.length === 0
      ? 0
      : Math.round(courses.reduce((sum, course) => sum + (course.enrollment?.progressPct ?? 0), 0) / courses.length)
  return {
    id: track.id,
    title: track.title,
    description: track.description,
    coverUrl: track.coverUrl,
    category: track.category,
    competencies: toStringArray(track.competencies),
    courses,
    progressPct,
  }
}
