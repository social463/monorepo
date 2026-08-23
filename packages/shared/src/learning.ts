/**
 * Contrato da área de Aprendizado (visão do colaborador).
 *
 * O catálogo em si (autoria de curso, módulos, aulas) é gerido pela Central de
 * Cursos; aqui ficam só os DTOs que a pessoa consome: catálogo, inscrição,
 * player, progresso, avaliação e certificado.
 */

import { extractYouTubeId } from './office-audio-share'

export const COURSE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const
export type CourseLevel = (typeof COURSE_LEVELS)[number]

export const COURSE_LEVEL_LABELS: Record<CourseLevel, string> = {
  BEGINNER: 'Iniciante',
  INTERMEDIATE: 'Intermediário',
  ADVANCED: 'Avançado',
}

export const COURSE_LESSON_TYPES = ['VIDEO', 'TEXT'] as const
export type CourseLessonType = (typeof COURSE_LESSON_TYPES)[number]

export const COURSE_LESSON_TYPE_LABELS: Record<CourseLessonType, string> = {
  VIDEO: 'Vídeo',
  TEXT: 'Leitura',
}

export const COURSE_ENROLLMENT_STATUSES = ['IN_PROGRESS', 'COMPLETED'] as const
export type CourseEnrollmentStatus = (typeof COURSE_ENROLLMENT_STATUSES)[number]

export const COURSE_ENROLLMENT_STATUS_LABELS: Record<CourseEnrollmentStatus, string> = {
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
}

export const MIN_COURSE_RATING = 1
export const MAX_COURSE_RATING = 5
export const MAX_COURSE_RATING_COMMENT_LENGTH = 500

/** Prefixo do código público do certificado (`EMR-XXXXXXXX`). */
export const CERTIFICATE_CODE_PREFIX = 'EMR-'

export interface CourseEnrollmentSummary {
  status: CourseEnrollmentStatus
  progressPct: number
  completedAt: string | null
  lastAccessedAt: string | null
  lastLessonId: string | null
}

export interface CourseCardDTO {
  id: string
  title: string
  shortDescription: string | null
  coverUrl: string | null
  category: string
  level: CourseLevel
  durationMinutes: number
  instructorName: string | null
  competencies: string[]
  mandatory: boolean
  certificateEnabled: boolean
  averageRating: number
  totalRatings: number
  totalStudents: number
  favorite: boolean
  publishedAt: string | null
  /** Inscrição de quem está pedindo; `null` se ainda não se inscreveu. */
  enrollment: CourseEnrollmentSummary | null
}

export interface CourseLessonDTO {
  id: string
  moduleId: string
  title: string
  description: string | null
  type: CourseLessonType
  videoUrl: string | null
  contentHtml: string | null
  durationMinutes: number
  sortOrder: number
  completed: boolean
  /** Id do quiz formativo desta aula, se houver — `null` quando a aula não tem quiz. */
  quizId: string | null
}

export interface CourseModuleDTO {
  id: string
  title: string
  description: string | null
  sortOrder: number
  lessons: CourseLessonDTO[]
}

export interface CourseRatingDTO {
  rating: number
  comment: string | null
  updatedAt: string
}

export interface CourseDetailDTO extends CourseCardDTO {
  description: string | null
  objectives: string[]
  prerequisites: string | null
  instructorBio: string | null
  modules: CourseModuleDTO[]
  totalLessons: number
  completedLessons: number
  myRating: CourseRatingDTO | null
  certificate: CertificateDTO | null
  /** Id do quiz final do curso (`lessonId: null`), se houver — condiciona o certificado. */
  finalQuizId: string | null
}

export interface EnrollmentDTO {
  id: string
  courseId: string
  status: CourseEnrollmentStatus
  progressPct: number
  startedAt: string
  completedAt: string | null
  lastAccessedAt: string | null
  lastLessonId: string | null
  course: CourseCardDTO
}

export interface LearningTrackDTO {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  category: string
  competencies: string[]
  courses: CourseCardDTO[]
  /** Média do progresso da pessoa nos cursos da trilha (0–100). */
  progressPct: number
}

export interface CertificateDTO {
  id: string
  code: string
  title: string
  hours: number
  issuedAt: string
  courseId: string | null
  imageUrl: string | null
  userName: string
}

/** Dados do certificado expostos na verificação pública (sem login). */
export interface PublicCertificateDTO {
  code: string
  title: string
  hours: number
  issuedAt: string
  userName: string
  companyName: string
  imageUrl: string | null
}

export interface LearningSummaryDTO {
  /** Minutos de aula concluídos no mês corrente. */
  monthMinutes: number
  certificates: number
  inProgress: number
  pendingMandatory: number
}

// ---------------------------------------------------------------------------
// Autoria de curso (admin)
// ---------------------------------------------------------------------------

export const COURSE_TITLE_MAX_LENGTH = 120
export const COURSE_SHORT_DESCRIPTION_MAX_LENGTH = 240
export const COURSE_CATEGORY_MAX_LENGTH = 60
export const LESSON_TITLE_MAX_LENGTH = 120
export const MAX_LESSON_DURATION_MINUTES = 600

export interface AdminCourseLessonDTO {
  id: string
  moduleId: string
  title: string
  description: string | null
  type: CourseLessonType
  videoUrl: string | null
  contentHtml: string | null
  durationMinutes: number
  sortOrder: number
}

export interface AdminCourseModuleDTO {
  id: string
  title: string
  description: string | null
  sortOrder: number
  lessons: AdminCourseLessonDTO[]
}

export interface AdminCourseDTO {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  description: string | null
  coverUrl: string | null
  category: string
  level: CourseLevel
  competencies: string[]
  objectives: string[]
  prerequisites: string | null
  instructorName: string | null
  instructorBio: string | null
  mandatory: boolean
  certificateEnabled: boolean
  published: boolean
  publishedAt: string | null
  /** Soma da duração das aulas — derivada, não é campo de formulário. */
  durationMinutes: number
  totalLessons: number
  enrolledCount: number
  modules: AdminCourseModuleDTO[]
  /** Nulo = curso da empresa toda. Preenchido = só o setor enxerga (ver "Recorte por setor"). */
  sectorId: string | null
  /** `true` = concluir não emite na hora; cria uma solicitação na fila de aprovação. */
  requiresCertificateApproval: boolean
  /** Modelo visual do certificado deste curso; nulo cai no `isDefault` da empresa. */
  certificateTemplateId: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminCourseListItemDTO {
  id: string
  title: string
  category: string
  level: CourseLevel
  published: boolean
  mandatory: boolean
  durationMinutes: number
  totalLessons: number
  enrolledCount: number
  updatedAt: string
}

export interface CreateCourseRequest {
  title: string
  category: string
  level?: CourseLevel
  shortDescription?: string | null
  description?: string | null
  coverUrl?: string | null
  competencies?: string[]
  objectives?: string[]
  prerequisites?: string | null
  instructorName?: string | null
  instructorBio?: string | null
  mandatory?: boolean
  certificateEnabled?: boolean
  /**
   * Setor do curso; nulo = empresa toda. SUBADMIN só grava no próprio setor —
   * pedir outro aqui é ignorado pelo service, não recusado. ADMIN/SUPER_ADMIN
   * escolhem livremente, inclusive nulo.
   */
  sectorId?: string | null
  /**
   * `true` tira o curso da emissão automática: concluir cria uma
   * `CertificateRequest` PENDENTE em vez de emitir o certificado (ver
   * `course-certificate.ts`).
   */
  requiresCertificateApproval?: boolean
  /**
   * Modelo visual do certificado deste curso. Nulo cai no `isDefault` da
   * empresa e, na falta dele, no visual embutido. Precisa ser um modelo da
   * MESMA empresa — id de fora é recusado (404), nunca gravado.
   */
  certificateTemplateId?: string | null
}

export interface UpdateCourseRequest extends Partial<CreateCourseRequest> {
  published?: boolean
}

export interface CreateCourseModuleRequest {
  title: string
  description?: string | null
}

export type UpdateCourseModuleRequest = Partial<CreateCourseModuleRequest> & { sortOrder?: number }

export interface CreateCourseLessonRequest {
  title: string
  type: CourseLessonType
  description?: string | null
  /** Link como se copia do navegador; o player normaliza (ver `toVideoEmbedUrl`). */
  videoUrl?: string | null
  contentHtml?: string | null
  durationMinutes?: number
}

export type UpdateCourseLessonRequest = Partial<CreateCourseLessonRequest> & { sortOrder?: number }

export interface AdminCourseListResponse {
  courses: AdminCourseListItemDTO[]
}

export interface AdminCourseResponse {
  course: AdminCourseDTO
}

export interface CourseCatalogFilters {
  search?: string
  category?: string
  level?: CourseLevel
  competency?: string
  onlyMandatory?: boolean
  onlyFavorites?: boolean
}

export interface CourseListResponse {
  courses: CourseCardDTO[]
  categories: string[]
  competencies: string[]
}

export interface CourseDetailResponse {
  course: CourseDetailDTO
}

export interface EnrollResponse {
  enrollment: EnrollmentDTO
}

export interface CompleteLessonRequest {
  /** `false` desmarca a aula (a pessoa reabriu e quer corrigir). */
  completed?: boolean
}

export interface CompleteLessonResponse {
  progressPct: number
  completedLessons: number
  totalLessons: number
  status: CourseEnrollmentStatus
  certificate: CertificateDTO | null
}

export interface RateCourseRequest {
  rating: number
  comment?: string | null
}

export interface RateCourseResponse {
  rating: CourseRatingDTO
  averageRating: number
  totalRatings: number
}

export interface MyLearningResponse {
  enrollments: EnrollmentDTO[]
  summary: LearningSummaryDTO
}

export interface LearningHomeResponse {
  summary: LearningSummaryDTO
  continueLearning: EnrollmentDTO[]
  mandatory: CourseCardDTO[]
  recommended: CourseCardDTO[]
  newest: CourseCardDTO[]
  popular: CourseCardDTO[]
  tracks: LearningTrackDTO[]
}

export interface LearningTracksResponse {
  tracks: LearningTrackDTO[]
}

export interface LearningTrackResponse {
  track: LearningTrackDTO
}

export interface CertificateListResponse {
  certificates: CertificateDTO[]
}

export interface PublicCertificateResponse {
  certificate: PublicCertificateDTO
}

/** Horas de certificado a partir da duração do curso — sempre ao menos 1h. */
export function certificateHoursFor(durationMinutes: number): number {
  return Math.max(1, Math.round(durationMinutes / 60))
}

/**
 * Normaliza a URL do vídeo da aula para a forma que pode ser embutida no player.
 *
 * Quem cadastra a aula cola o link que copiou do navegador
 * (`youtube.com/watch?v=…`, `youtu.be/…`, `vimeo.com/…`) — e essas URLs **não**
 * podem ir num `<iframe>`: o YouTube recusa a página `/watch` com
 * `X-Frame-Options`, e o vídeo simplesmente não abre. A conversão para `/embed/`
 * vive aqui, no contrato, porque o player e o CMS de curso precisam da mesma regra.
 *
 * O instante inicial (`?t=90`, `#t=90`) é preservado como `start`. URL que já está
 * embutível, ou de host desconhecido, passa direto.
 */
export function toVideoEmbedUrl(rawUrl: string): string {
  const url = rawUrl.trim()
  if (!url) return url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  const host = parsed.hostname.replace(/^www\./, '')
  const startSeconds = parseVideoStart(parsed)

  const withStart = (embedUrl: string): string => {
    if (startSeconds == null) return embedUrl
    const separator = embedUrl.includes('?') ? '&' : '?'
    return `${embedUrl}${separator}start=${startSeconds}`
  }

  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be'
  ) {
    // Já embutível: /embed/ID — não mexe (evita duplicar o `start` já existente).
    if (parsed.pathname.startsWith('/embed/')) return url
    // Onde o id mora em cada forma de link é regra do contrato (`extractYouTubeId`),
    // compartilhada com o áudio da sala do escritório.
    const id = extractYouTubeId(url)
    return id ? withStart(`https://www.youtube.com/embed/${id}`) : url
  }

  if (host === 'vimeo.com') {
    const id = parsed.pathname.match(/^\/(\d+)/)?.[1]
    return id ? `https://player.vimeo.com/video/${id}` : url
  }

  return url
}

/** Lê o instante inicial de `?t=`/`?start=`/`#t=` em segundos (aceita `1h2m3s`). */
function parseVideoStart(parsed: URL): number | null {
  const raw = parsed.searchParams.get('t') ?? parsed.searchParams.get('start') ?? parsed.hash.match(/^#t=(.+)$/)?.[1]
  if (!raw) return null

  if (/^\d+$/.test(raw)) return Number(raw)

  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!match || !match.slice(1).some(Boolean)) return null
  const [hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0) || 0)
  return hours * 3600 + minutes * 60 + seconds
}
