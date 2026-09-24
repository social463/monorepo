import type {
  ApprenticeActivityDTO,
  ApprenticeActivityKind,
  ApprenticeActivitySchema,
  ApprenticeAttendanceDTO,
  ApprenticeClassDTO,
  ApprenticeContractDTO,
  ApprenticeMakeupDTO,
  ApprenticeMeetingDetailDTO,
  ApprenticeMeetingDTO,
  ApprenticeOverviewDTO,
  ApprenticePersonDTO,
  ApprenticePortfolioDTO,
  ApprenticePortfolioOverviewDTO,
  ApprenticeReviewStatus,
  ApprenticeJourneyDTO,
  ApprenticeSubmissionDTO,
  ApprenticeTaskCategory,
  ApprenticeTaskColumn,
  ApprenticeTaskDTO,
  ApprenticeSurveyLearned,
  ApprenticeTrackDTO,
  ApprenticeValues,
  ApprenticeWallDTO,
} from '@legends/shared'
import { apiFetch } from './api'

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

// ---- Aprendiz ----

export function fetchApprenticeTrack() {
  return apiFetch<ApprenticeTrackDTO>('/apprentice/track')
}

export function fetchApprenticeMeeting(meetingId: string) {
  return apiFetch<ApprenticeMeetingDetailDTO>(`/apprentice/meetings/${meetingId}`)
}

export function saveApprenticeSubmission(
  activityId: string,
  values: ApprenticeValues,
  submit: boolean,
) {
  return apiFetch<ApprenticeSubmissionDTO>(`/apprentice/activities/${activityId}/submission`, {
    method: 'PUT',
    ...json({ values, submit }),
  })
}

export function fetchApprenticeWall() {
  return apiFetch<ApprenticeWallDTO>('/apprentice/wall')
}

export function fetchApprenticeContract() {
  return apiFetch<ApprenticeContractDTO>('/apprentice/contract')
}

export function signApprenticeContract() {
  return apiFetch<ApprenticeContractDTO>('/apprentice/contract/signature', { method: 'POST' })
}

export function fetchApprenticePeople() {
  return apiFetch<ApprenticePersonDTO[]>('/apprentice/people')
}

export function fetchApprenticePortfolio(userId?: string) {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : ''
  return apiFetch<ApprenticePortfolioDTO>(`/apprentice/portfolio${query}`)
}

/** O portfólio da turma — só o facilitador. */
export function fetchApprenticePortfolioOverview() {
  return apiFetch<ApprenticePortfolioOverviewDTO>('/apprentice/portfolio/overview')
}

export function submitApprenticeSurvey(
  meetingId: string,
  body: { score: number; takeaway: string; improvement: string; learned: ApprenticeSurveyLearned },
) {
  return apiFetch<void>(`/apprentice/meetings/${meetingId}/survey`, {
    method: 'POST',
    ...json(body),
  })
}

// ---- Painel do facilitador ----

export function fetchApprenticeClasses() {
  return apiFetch<ApprenticeClassDTO[]>('/admin/apprentice/classes')
}

export function createApprenticeClass(body: { name: string; shift?: string | null }) {
  return apiFetch<ApprenticeClassDTO>('/admin/apprentice/classes', { method: 'POST', ...json(body) })
}

export function deleteApprenticeClass(classId: string) {
  return apiFetch<void>(`/admin/apprentice/classes/${classId}`, { method: 'DELETE' })
}

export function setApprenticeEnrollment(userId: string, classId: string | null) {
  return apiFetch<ApprenticePersonDTO[]>('/admin/apprentice/enrollments', {
    method: 'PUT',
    ...json({ userId, classId }),
  })
}

export function fetchAdminApprenticeMeetings() {
  return apiFetch<ApprenticeMeetingDTO[]>('/admin/apprentice/meetings')
}

export interface ApprenticeMeetingInput {
  order?: number
  title: string
  theme?: string
  objectives?: string[]
  deliverable?: string
  scheduledOn?: string | null
  slideUrl?: string | null
}

export function createApprenticeMeeting(body: ApprenticeMeetingInput) {
  return apiFetch<ApprenticeMeetingDTO>('/admin/apprentice/meetings', { method: 'POST', ...json(body) })
}

export function updateApprenticeMeeting(meetingId: string, body: Partial<ApprenticeMeetingInput>) {
  return apiFetch<ApprenticeMeetingDTO>(`/admin/apprentice/meetings/${meetingId}`, {
    method: 'PATCH',
    ...json(body),
  })
}

export function deleteApprenticeMeeting(meetingId: string) {
  return apiFetch<void>(`/admin/apprentice/meetings/${meetingId}`, { method: 'DELETE' })
}

export function setApprenticeMeetingFlag(
  meetingId: string,
  flag: 'accessReleased' | 'surveyOpen',
  value: boolean,
) {
  return apiFetch<ApprenticeMeetingDTO>(`/admin/apprentice/meetings/${meetingId}/flags`, {
    method: 'PUT',
    ...json({ flag, value }),
  })
}

export interface ApprenticeMaterialInput {
  name: string
  /** Link externo OU arquivo — o servidor recusa os dois juntos. */
  url?: string
  documentKey?: string
  fileName?: string
  contentType?: string
  sizeBytes?: number
}

export function addApprenticeMaterial(meetingId: string, body: ApprenticeMaterialInput) {
  return apiFetch<void>(`/admin/apprentice/meetings/${meetingId}/materials`, {
    method: 'POST',
    ...json(body),
  })
}

export function removeApprenticeMaterial(materialId: string) {
  return apiFetch<void>(`/admin/apprentice/materials/${materialId}`, { method: 'DELETE' })
}

export function fetchAdminApprenticeActivities(meetingId?: string) {
  const query = meetingId ? `?meetingId=${encodeURIComponent(meetingId)}` : ''
  return apiFetch<ApprenticeActivityDTO[]>(`/admin/apprentice/activities${query}`)
}

export function createApprenticeActivity(body: {
  meetingId: string
  title: string
  kind?: ApprenticeActivityKind
  order?: number
  schema: ApprenticeActivitySchema
}) {
  return apiFetch<ApprenticeActivityDTO>('/admin/apprentice/activities', {
    method: 'POST',
    ...json(body),
  })
}

export function updateApprenticeActivity(
  activityId: string,
  body: { title?: string; kind?: ApprenticeActivityKind; order?: number; schema?: ApprenticeActivitySchema },
) {
  return apiFetch<ApprenticeActivityDTO>(`/admin/apprentice/activities/${activityId}`, {
    method: 'PATCH',
    ...json(body),
  })
}

export function deleteApprenticeActivity(activityId: string) {
  return apiFetch<void>(`/admin/apprentice/activities/${activityId}`, { method: 'DELETE' })
}

export function fetchApprenticeAttendance(meetingId: string) {
  return apiFetch<ApprenticeAttendanceDTO[]>(`/admin/apprentice/meetings/${meetingId}/attendance`)
}

export function setApprenticeAttendance(
  meetingId: string,
  body: {
    userId: string
    present: boolean | null
    justification?: string | null
    needsMakeup?: boolean
  },
) {
  return apiFetch<ApprenticeAttendanceDTO[]>(`/admin/apprentice/meetings/${meetingId}/attendance`, {
    method: 'PUT',
    ...json(body),
  })
}

export function markAllPresent(meetingId: string, classId: string | null) {
  return apiFetch<ApprenticeAttendanceDTO[]>(
    `/admin/apprentice/meetings/${meetingId}/attendance/all-present`,
    { method: 'POST', ...json({ classId }) },
  )
}

export function fetchApprenticeMakeups() {
  return apiFetch<ApprenticeMakeupDTO[]>('/admin/apprentice/makeups')
}

export function createApprenticeMakeup(body: {
  meetingId: string
  scheduledAt: string
  userIds: string[]
}) {
  return apiFetch<ApprenticeMakeupDTO[]>('/admin/apprentice/makeups', { method: 'POST', ...json(body) })
}

export function deleteApprenticeMakeup(makeupId: string) {
  return apiFetch<void>(`/admin/apprentice/makeups/${makeupId}`, { method: 'DELETE' })
}

export function updateApprenticeContract(clauses: string[]) {
  return apiFetch<{ clauses: string[] }>('/admin/apprentice/contract', {
    method: 'PUT',
    ...json({ clauses }),
  })
}

export function fetchApprenticeOverview(filters: {
  meetingId?: string
  classId?: string
  userId?: string
}) {
  const params = new URLSearchParams()
  if (filters.meetingId) params.set('meetingId', filters.meetingId)
  if (filters.classId) params.set('classId', filters.classId)
  if (filters.userId) params.set('userId', filters.userId)
  const query = params.toString()
  return apiFetch<ApprenticeOverviewDTO>(`/admin/apprentice/overview${query ? `?${query}` : ''}`)
}

export interface ApprenticeProgressRowDTO {
  person: ApprenticePersonDTO
  present: boolean | null
  submittedCount: number
  activityCount: number
  reviewStatus: ApprenticeReviewStatus | null
}

export function fetchApprenticeProgress(meetingId: string) {
  return apiFetch<ApprenticeProgressRowDTO[]>(`/admin/apprentice/meetings/${meetingId}/progress`)
}

// ---- Fase 2: jornada, movimentações e quadro de gestão ----

export function fetchApprenticeJourneys() {
  return apiFetch<ApprenticeJourneyDTO[]>('/admin/apprentice/journeys')
}

export function saveApprenticeJourney(
  userId: string,
  body: { contractEndsOn?: string | null; activities?: string; notes?: string | null },
) {
  return apiFetch<ApprenticeJourneyDTO>(`/admin/apprentice/journeys/${userId}`, {
    method: 'PUT',
    ...json(body),
  })
}

export function createApprenticeSectorMove(body: {
  userId: string
  fromSector?: string
  toSector: string
  movedOn: string
  reason?: string
  responsibles?: string
}) {
  return apiFetch<ApprenticeJourneyDTO>('/admin/apprentice/sector-moves', {
    method: 'POST',
    ...json(body),
  })
}

export function deleteApprenticeSectorMove(moveId: string) {
  return apiFetch<void>(`/admin/apprentice/sector-moves/${moveId}`, { method: 'DELETE' })
}

export function fetchApprenticeTasks() {
  return apiFetch<ApprenticeTaskDTO[]>('/admin/apprentice/tasks')
}

export function createApprenticeTask(body: {
  title: string
  category?: ApprenticeTaskCategory
  meetingId?: string | null
  dueOn?: string | null
  items?: string[]
}) {
  return apiFetch<ApprenticeTaskDTO[]>('/admin/apprentice/tasks', { method: 'POST', ...json(body) })
}

export function updateApprenticeTask(
  taskId: string,
  body: {
    title?: string
    category?: ApprenticeTaskCategory
    meetingId?: string | null
    dueOn?: string | null
    boardColumn?: ApprenticeTaskColumn
    sortOrder?: number
  },
) {
  return apiFetch<ApprenticeTaskDTO[]>(`/admin/apprentice/tasks/${taskId}`, {
    method: 'PATCH',
    ...json(body),
  })
}

export function deleteApprenticeTask(taskId: string) {
  return apiFetch<void>(`/admin/apprentice/tasks/${taskId}`, { method: 'DELETE' })
}

export function toggleApprenticeTaskItem(itemId: string, done: boolean) {
  return apiFetch<ApprenticeTaskDTO[]>(`/admin/apprentice/task-items/${itemId}`, {
    method: 'PUT',
    ...json({ done }),
  })
}
