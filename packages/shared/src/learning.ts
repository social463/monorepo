/**
 * Contrato da área de Aprendizado (visão do colaborador).
 *
 * O catálogo em si (autoria de curso, módulos, aulas) é gerido pela Central de
 * Cursos; aqui ficam só os DTOs que a pessoa consome: catálogo, inscrição,
 * player, progresso, avaliação e certificado.
 */

import type { CourseLessonBlock } from './course-lesson-block'
import { extractYouTubeId } from './office-audio-share'

export const COURSE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const
export type CourseLevel = (typeof COURSE_LEVELS)[number]

export const COURSE_LEVEL_LABELS: Record<CourseLevel, string> = {
  BEGINNER: 'Iniciante',
  INTERMEDIATE: 'Intermediário',
  ADVANCED: 'Avançado',
}

/**
 * Ciclo de vida do curso (Documento 4, seção 9.6).
 *
 * Era `Course.published`, um booleano. O documento pede cinco estados — e é
 * explícito sobre os rótulos: o protótipo os mostra em inglês e em formato
 * técnico (`review`, `pending_approval`, `archived`), e a implementação
 * padroniza em português.
 *
 * **Só `PUBLISHED` aparece para o aluno.** Os outros quatro são etapas da
 * autoria: o que muda entre eles é o que a G&G vê na fila de trabalho, não o
 * que o colaborador enxerga no catálogo. Por isso `isPublishedStatus` existe —
 * ela é a tradução do antigo `published`, e é ela que os `where` usam.
 */
export const COURSE_STATUSES = ['DRAFT', 'REVIEW', 'PENDING_APPROVAL', 'PUBLISHED', 'ARCHIVED'] as const
export type CourseStatus = (typeof COURSE_STATUSES)[number]

export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  DRAFT: 'Rascunho',
  REVIEW: 'Em revisão',
  PENDING_APPROVAL: 'Aguardando aprovação',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

/** Quem enxerga o curso no catálogo. Um estado, e não uma lista: publicar é um só. */
export function isPublishedStatus(status: CourseStatus): boolean {
  return status === 'PUBLISHED'
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
  /** Emoji e cor da identidade visual (seção 9.6): vestem o card sem capa. */
  icon: string | null
  primaryColor: string | null
  /** Nome da categoria do catálogo; nulo quando o curso ainda não tem uma. */
  category: string | null
  level: CourseLevel
  durationMinutes: number
  /** Primeiro instrutor do curso — é o que cabe no card. */
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

/** Instrutor como as telas o exibem — derivado do catálogo (seção 9.7). */
export interface CourseInstructorRef {
  id: string
  name: string
  photoUrl: string | null
  bio: string | null
}

export interface CourseLessonDTO {
  id: string
  moduleId: string
  title: string
  description: string | null
  /**
   * Conteúdo da aula, em ordem. Substituiu `type`/`videoUrl`/`contentHtml`
   * (Documento 4, seção 9.1) — o formato da aula agora se deriva daqui, por
   * `lessonKindOf`, porque uma aula com vídeo E texto não cabe numa coluna só.
   */
  blocks: CourseLessonBlock[]
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
  /**
   * SUPERADO em 08/09/2026: o curso passou a ter UMA imagem, e ela é a
   * `coverUrl`. O campo nunca chegou a ser desenhado em lugar nenhum do
   * portal, e o formulário do admin não o escreve mais — a coluna fica no
   * banco para não perder o que já foi digitado. Não religue: uma segunda
   * imagem por curso é exatamente o que a G&G pediu para acabar.
   */
  bannerUrl: string | null
  /** Vídeo de apresentação do curso — não é aula; abre antes de começar. */
  introVideoUrl: string | null
  /** Todos os instrutores, na ordem — a 9.7 permite mais de um por curso. */
  instructors: CourseInstructorRef[]
  modules: CourseModuleDTO[]
  totalLessons: number
  completedLessons: number
  myRating: CourseRatingDTO | null
  certificate: CertificateDTO | null
  /**
   * A solicitação de certificado DESTA pessoa neste curso, quando existe
   * (Documento 4, seção 9.3). Só o que a tela do aluno precisa mostrar —
   * a fila completa é `CertificateRequestDTO`, documento de admin.
   */
  certificateRequest: MyCertificateRequestDTO | null
  /** Id do quiz final do curso (`lessonId: null`), se houver — condiciona o certificado. */
  finalQuizId: string | null
}

/** Estado da solicitação de certificado, do ponto de vista de quem pediu. */
export interface MyCertificateRequestDTO {
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  createdAt: string
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
  category: string | null
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
  blocks: CourseLessonBlock[]
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
  categoryId: string | null
  /** Resolvido para exibir sem uma segunda consulta na tela. */
  categoryName: string | null
  level: CourseLevel
  competencyIds: string[]
  objectives: string[]
  prerequisites: string | null
  instructors: CourseInstructorRef[]
  mandatory: boolean
  status: CourseStatus
  /** Recompensa ao concluir (seção 9.6). Zero = sem recompensa. */
  rewardPoints: number
  rewardCoins: number
  /**
   * SUPERADO em 08/09/2026: o curso passou a ter UMA imagem, e ela é a
   * `coverUrl`. O campo nunca chegou a ser desenhado em lugar nenhum do
   * portal, e o formulário do admin não o escreve mais — a coluna fica no
   * banco para não perder o que já foi digitado. Não religue: uma segunda
   * imagem por curso é exatamente o que a G&G pediu para acabar.
   */
  bannerUrl: string | null
  introVideoUrl: string | null
  icon: string | null
  primaryColor: string | null
  /**
   * Público-alvo (Documento 4, seção 9.2). `sectorId` continua sendo o setor
   * DONO do curso — quem administra —, e estes são os setores que também o
   * enxergam. Lista vazia em qualquer um dos dois = sem restrição por ele.
   */
  audienceSectorIds: string[]
  audiencePositionCategories: string[]
  /** Rótulo, não regra de acesso. */
  recommendedFor: string[]
  /** Matricula sozinho quem entra no público-alvo. */
  autoEnroll: boolean
  certificateEnabled: boolean
  /** Derivado de `status` — mantido porque as telas do aluno perguntam isso. */
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
  category: string | null
  level: CourseLevel
  status: CourseStatus
  published: boolean
  mandatory: boolean
  durationMinutes: number
  totalLessons: number
  enrolledCount: number
  updatedAt: string
}

export interface CreateCourseRequest {
  title: string
  categoryId?: string | null
  level?: CourseLevel
  shortDescription?: string | null
  description?: string | null
  coverUrl?: string | null
  /** Ids do catálogo de competências; a lista inteira é regravada a cada save. */
  competencyIds?: string[]
  objectives?: string[]
  prerequisites?: string | null
  /** Ids do catálogo de instrutores, na ordem — o primeiro é o principal. */
  instructorIds?: string[]
  rewardPoints?: number
  rewardCoins?: number
  /**
   * SUPERADO em 08/09/2026: o curso passou a ter UMA imagem, e ela é a
   * `coverUrl`. O campo nunca chegou a ser desenhado em lugar nenhum do
   * portal, e o formulário do admin não o escreve mais — a coluna fica no
   * banco para não perder o que já foi digitado. Não religue: uma segunda
   * imagem por curso é exatamente o que a G&G pediu para acabar.
   */
  bannerUrl?: string | null
  introVideoUrl?: string | null
  /** Emoji. */
  icon?: string | null
  /** Hex `#rrggbb`. */
  primaryColor?: string | null
  audienceSectorIds?: string[]
  audiencePositionCategories?: string[]
  recommendedFor?: string[]
  autoEnroll?: boolean
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
  /**
   * Substituiu `published?: boolean` (Documento 4, seção 9.6). Publicar virou
   * "mandar o status para `PUBLISHED`", e despublicar virou escolher para onde
   * o curso volta — rascunho, revisão ou arquivo — em vez de um único destino
   * implícito.
   */
  status?: CourseStatus
}

export interface CreateCourseModuleRequest {
  title: string
  description?: string | null
}

export type UpdateCourseModuleRequest = Partial<CreateCourseModuleRequest> & { sortOrder?: number }

export interface CreateCourseLessonRequest {
  title: string
  description?: string | null
  /** Ausente = aula sem conteúdo ainda; o editor grava a lista inteira a cada salvamento. */
  blocks?: CourseLessonBlock[]
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
