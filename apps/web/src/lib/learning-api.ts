import type {
  AdminCourseListResponse,
  AdminCourseResponse,
  ApproveCertificateRequestResponse,
  CertificateRequestListResponse,
  CertificateRequestStatus,
  CertificateTemplateListResponse,
  CertificateTemplateResponse,
  CreateCertificateTemplateRequest,
  CreateCourseLessonRequest,
  CreateCourseModuleRequest,
  CreateCourseRequest,
  RejectCertificateRequestResponse,
  UpdateCertificateTemplateRequest,
  UpdateCourseLessonRequest,
  UpdateCourseModuleRequest,
  UpdateCourseRequest,
  CertificateListResponse,
  CompleteLessonResponse,
  CourseCatalogFilters,
  CourseDetailResponse,
  CourseListResponse,
  CourseQuizListResponse,
  CourseQuizResponse,
  CourseQuizWithQuestionsResponse,
  CreateQuizQuestionRequest,
  CreateQuizRequest,
  EnrollResponse,
  LearningHomeResponse,
  LearningTrackResponse,
  LearningTracksResponse,
  MyLearningResponse,
  PublicCertificateResponse,
  QuizAttemptResultResponse,
  QuizForRespondentResponse,
  QuizQuestionResponse,
  RateCourseRequest,
  RateCourseResponse,
  SubmitQuizAttemptRequest,
  UpdateQuizQuestionRequest,
  UpdateQuizRequest,
} from '@legends/shared'
import { apiFetch } from './api'

function toQuery(filters: CourseCatalogFilters): string {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.category) params.set('category', filters.category)
  if (filters.level) params.set('level', filters.level)
  if (filters.competency) params.set('competency', filters.competency)
  if (filters.onlyMandatory) params.set('onlyMandatory', 'true')
  if (filters.onlyFavorites) params.set('onlyFavorites', 'true')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function getLearningHome() {
  return apiFetch<LearningHomeResponse>('/learning/home')
}

export function listCourses(filters: CourseCatalogFilters = {}) {
  return apiFetch<CourseListResponse>(`/learning/courses${toQuery(filters)}`)
}

export function getCourse(id: string) {
  return apiFetch<CourseDetailResponse>(`/learning/courses/${id}`)
}

export function enrollInCourse(id: string) {
  return apiFetch<EnrollResponse>(`/learning/courses/${id}/enroll`, { method: 'POST' })
}

export function setLessonCompletion(lessonId: string, completed: boolean) {
  return apiFetch<CompleteLessonResponse>(`/learning/lessons/${lessonId}/complete`, {
    method: 'PUT',
    body: JSON.stringify({ completed }),
  })
}

export function rateCourse(id: string, body: RateCourseRequest) {
  return apiFetch<RateCourseResponse>(`/learning/courses/${id}/rating`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function setCourseFavorite(id: string, favorite: boolean) {
  return apiFetch<void>(`/learning/courses/${id}/favorite`, { method: favorite ? 'PUT' : 'DELETE' })
}

export function getMyLearning() {
  return apiFetch<MyLearningResponse>('/learning/me')
}

export function listTracks() {
  return apiFetch<LearningTracksResponse>('/learning/tracks')
}

export function getTrack(id: string) {
  return apiFetch<LearningTrackResponse>(`/learning/tracks/${id}`)
}

export function listCertificates() {
  return apiFetch<CertificateListResponse>('/learning/certificates')
}

/** Verificação pública do certificado — a rota não exige sessão. */
export function getPublicCertificate(code: string) {
  return apiFetch<PublicCertificateResponse>(`/learning/certificates/code/${encodeURIComponent(code)}`)
}

// --- Quiz — responder (consumo) ---------------------------------------------

/** Quiz como quem responde vê: sem gabarito nem explicação nas questões. */
export function getQuizForRespondent(quizId: string) {
  return apiFetch<QuizForRespondentResponse>(`/learning/quizzes/${quizId}`)
}

/** Submete as respostas escolhidas; a correção (nota, aprovação, explicação) vem do servidor. */
export function submitQuizAttempt(quizId: string, body: SubmitQuizAttemptRequest) {
  return apiFetch<QuizAttemptResultResponse>(`/learning/quizzes/${quizId}/attempts`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// --- Autoria de curso (admin) ----------------------------------------------

export function listCoursesForAdmin() {
  return apiFetch<AdminCourseListResponse>('/admin/courses')
}

export function getCourseForAdmin(id: string) {
  return apiFetch<AdminCourseResponse>(`/admin/courses/${id}`)
}

export function createCourse(body: CreateCourseRequest) {
  return apiFetch<AdminCourseResponse>('/admin/courses', { method: 'POST', body: JSON.stringify(body) })
}

export function updateCourse(id: string, body: UpdateCourseRequest) {
  return apiFetch<AdminCourseResponse>(`/admin/courses/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteCourse(id: string) {
  return apiFetch<void>(`/admin/courses/${id}`, { method: 'DELETE' })
}

export function createCourseModule(courseId: string, body: CreateCourseModuleRequest) {
  return apiFetch<AdminCourseResponse>(`/admin/courses/${courseId}/modules`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCourseModule(moduleId: string, body: UpdateCourseModuleRequest) {
  return apiFetch<AdminCourseResponse>(`/admin/course-modules/${moduleId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteCourseModule(moduleId: string) {
  return apiFetch<AdminCourseResponse>(`/admin/course-modules/${moduleId}`, { method: 'DELETE' })
}

export function createCourseLesson(moduleId: string, body: CreateCourseLessonRequest) {
  return apiFetch<AdminCourseResponse>(`/admin/course-modules/${moduleId}/lessons`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCourseLesson(lessonId: string, body: UpdateCourseLessonRequest) {
  return apiFetch<AdminCourseResponse>(`/admin/course-lessons/${lessonId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteCourseLesson(lessonId: string) {
  return apiFetch<AdminCourseResponse>(`/admin/course-lessons/${lessonId}`, { method: 'DELETE' })
}

// --- Autoria de quiz (admin) -------------------------------------------------

export function listCourseQuizzes(courseId: string) {
  return apiFetch<CourseQuizListResponse>(`/admin/courses/${courseId}/quizzes`)
}

export function createCourseQuiz(courseId: string, body: CreateQuizRequest) {
  return apiFetch<CourseQuizResponse>(`/admin/courses/${courseId}/quizzes`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getCourseQuiz(quizId: string) {
  return apiFetch<CourseQuizWithQuestionsResponse>(`/admin/course-quizzes/${quizId}`)
}

export function updateCourseQuiz(quizId: string, body: UpdateQuizRequest) {
  return apiFetch<CourseQuizResponse>(`/admin/course-quizzes/${quizId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteCourseQuiz(quizId: string) {
  return apiFetch<void>(`/admin/course-quizzes/${quizId}`, { method: 'DELETE' })
}

export function createQuizQuestion(quizId: string, body: CreateQuizQuestionRequest) {
  return apiFetch<QuizQuestionResponse>(`/admin/course-quizzes/${quizId}/questions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateQuizQuestion(questionId: string, body: UpdateQuizQuestionRequest) {
  return apiFetch<QuizQuestionResponse>(`/admin/course-questions/${questionId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteQuizQuestion(questionId: string) {
  return apiFetch<void>(`/admin/course-questions/${questionId}`, { method: 'DELETE' })
}

/** Envia a lista completa de ids na ordem nova — o service recusa qualquer subconjunto. */
export function reorderQuizQuestions(quizId: string, ids: string[]) {
  return apiFetch<void>(`/admin/course-quizzes/${quizId}/questions/order`, {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}

// --- Certificado — modelos e fila de aprovação (admin) ----------------------

export function listCertificateTemplates() {
  return apiFetch<CertificateTemplateListResponse>('/admin/certificate-templates')
}

export function createCertificateTemplate(body: CreateCertificateTemplateRequest) {
  return apiFetch<CertificateTemplateResponse>('/admin/certificate-templates', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateCertificateTemplate(id: string, body: UpdateCertificateTemplateRequest) {
  return apiFetch<CertificateTemplateResponse>(`/admin/certificate-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteCertificateTemplate(id: string) {
  return apiFetch<void>(`/admin/certificate-templates/${id}`, { method: 'DELETE' })
}

export function listCertificateRequests(status?: CertificateRequestStatus) {
  const query = status ? `?status=${status}` : ''
  return apiFetch<CertificateRequestListResponse>(`/admin/certificate-requests${query}`)
}

/** Aprovar reexecuta as guardas de elegibilidade no servidor — pode falhar com 409 mesmo numa linha PENDING. */
export function approveCertificateRequest(id: string) {
  return apiFetch<ApproveCertificateRequestResponse>(`/admin/certificate-requests/${id}/approve`, {
    method: 'POST',
  })
}

export function rejectCertificateRequest(id: string, rejectionReason: string) {
  return apiFetch<RejectCertificateRequestResponse>(`/admin/certificate-requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejectionReason }),
  })
}
