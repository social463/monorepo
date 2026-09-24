import {
  APPRENTICE_CONTRACT_CLAUSE_MAX_LENGTH,
  APPRENTICE_CONTRACT_MAX_CLAUSES,
  APPRENTICE_REVIEW_STATUS_FIELD_ID,
  APPRENTICE_REVIEW_STATUSES,
  APPRENTICE_TITLE_MAX_LENGTH,
  apprenticeNps,
  asApprenticeValues,
  meetingStatusesOf,
  type ApprenticeActivityDTO,
  type ApprenticeActivityKind,
  type ApprenticeActivitySchema,
  type ApprenticeAttendanceDTO,
  type ApprenticeClassDTO,
  type ApprenticeMakeupDTO,
  type ApprenticeMeetingDTO,
  type ApprenticeOverviewDTO,
  type ApprenticePersonDTO,
  type ApprenticeReviewStatus,
  type ApprenticeSurveyLearned,
  type ApprenticeSurveyResultDTO,
} from '@legends/shared'
import { APPRENTICE_MATERIAL_PREFIX } from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'
import { ApprenticeError } from '../lib/apprentice-error'
import type { ApprenticeContext } from '../lib/apprentice-context'
import {
  toApprenticeActivityDTO,
  toApprenticeMeetingDTO,
  type ApprenticeActivityRow,
  type ApprenticeMeetingRow,
} from '../lib/serialize'
import { apprenticeToday, listApprenticePeople } from './apprentice-service'

function cleanText(value: string | undefined | null, max = APPRENTICE_TITLE_MAX_LENGTH): string {
  return (value ?? '').trim().slice(0, max)
}

// ---- Turmas e matrículas ----

export async function listApprenticeClasses(companyId: string): Promise<ApprenticeClassDTO[]> {
  const db = scopedPrisma(companyId)
  const classes = await db.apprenticeClass.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { enrollments: true } } },
  })
  return classes.map((row) => ({
    id: row.id,
    name: row.name,
    shift: row.shift,
    active: row.active,
    memberCount: row._count.enrollments,
  }))
}

export async function createApprenticeClass(
  companyId: string,
  input: { name: string; shift?: string | null },
): Promise<ApprenticeClassDTO> {
  const name = cleanText(input.name, 80)
  if (!name) throw new ApprenticeError('Informe o nome da turma.', 400)

  const db = scopedPrisma(companyId)
  const existing = await db.apprenticeClass.findFirst({ where: { name } })
  if (existing) throw new ApprenticeError('Já existe uma turma com esse nome.', 409)

  const created = await db.apprenticeClass.create({
    data: { name, shift: cleanText(input.shift, 40) || null },
  })
  return { id: created.id, name: created.name, shift: created.shift, active: created.active, memberCount: 0 }
}

export async function deleteApprenticeClass(companyId: string, classId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeClass.findFirst({ where: { id: classId } })
  if (!found) throw new ApprenticeError('Turma não encontrada.', 404)
  await db.apprenticeClass.delete({ where: { id: classId } })
}

/**
 * Matricula (ou remove, com `classId` nulo) um aprendiz. A unique é por empresa,
 * então trocar de turma é substituir a matrícula, não empilhar outra.
 */
export async function setApprenticeEnrollment(
  companyId: string,
  userId: string,
  classId: string | null,
): Promise<void> {
  const db = scopedPrisma(companyId)
  const people = await listApprenticePeople(companyId)
  if (!people.some((person) => person.id === userId)) {
    throw new ApprenticeError('Só quem tem o cargo de Jovem Aprendiz entra numa turma.', 400)
  }

  const existing = await db.apprenticeEnrollment.findFirst({ where: { userId } })
  if (!classId) {
    if (existing) await db.apprenticeEnrollment.delete({ where: { id: existing.id } })
    return
  }

  const turma = await db.apprenticeClass.findFirst({ where: { id: classId } })
  if (!turma) throw new ApprenticeError('Turma não encontrada.', 404)

  if (existing) {
    await db.apprenticeEnrollment.update({ where: { id: existing.id }, data: { classId } })
    return
  }
  await db.apprenticeEnrollment.create({ data: { userId, classId } })
}

// ---- Encontros ----

export interface MeetingInput {
  order?: number
  title?: string
  theme?: string
  objectives?: string[]
  deliverable?: string
  scheduledOn?: string | null
  slideUrl?: string | null
  slideKey?: string | null
  slideFileName?: string | null
}

/** A chave do S3 tem de ser da PRÓPRIA empresa — ver `addApprenticeMaterial`. */
function assertMaterialKey(companyId: string, key: string | null | undefined): string | null {
  const cleaned = cleanText(key, 500) || null
  if (!cleaned) return null
  if (!cleaned.startsWith(`${APPRENTICE_MATERIAL_PREFIX}/${companyId}/`)) {
    throw new ApprenticeError('Arquivo inválido. Envie de novo.', 400)
  }
  return cleaned
}

async function meetingDTOsOf(companyId: string, rows: ApprenticeMeetingRow[]): Promise<ApprenticeMeetingDTO[]> {
  const statuses = meetingStatusesOf(
    rows.map((meeting) => ({
      id: meeting.id,
      order: meeting.order,
      scheduledOn: meeting.scheduledOn ? meeting.scheduledOn.toISOString().slice(0, 10) : null,
    })),
    apprenticeToday(),
  )
  return rows.map((meeting) => toApprenticeMeetingDTO(meeting, statuses[meeting.id] ?? 'FUTURO'))
}

export async function listApprenticeMeetings(companyId: string): Promise<ApprenticeMeetingDTO[]> {
  const db = scopedPrisma(companyId)
  const rows = await db.apprenticeMeeting.findMany({ orderBy: { order: 'asc' } })
  return meetingDTOsOf(companyId, rows as ApprenticeMeetingRow[])
}

function dateOf(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) throw new ApprenticeError('Data inválida.', 400)
  return parsed
}

export async function createApprenticeMeeting(
  companyId: string,
  input: MeetingInput,
): Promise<ApprenticeMeetingDTO> {
  const title = cleanText(input.title)
  if (!title) throw new ApprenticeError('Informe o título do encontro.', 400)

  const db = scopedPrisma(companyId)
  const last = await db.apprenticeMeeting.findFirst({ orderBy: { order: 'desc' } })
  const order = input.order ?? (last?.order ?? 0) + 1

  const clash = await db.apprenticeMeeting.findFirst({ where: { order } })
  if (clash) throw new ApprenticeError(`Já existe um encontro na posição ${order}.`, 409)

  const created = await db.apprenticeMeeting.create({
    data: {
      order,
      title,
      theme: cleanText(input.theme, 400),
      objectives: (input.objectives ?? []).map((line) => cleanText(line, 600)).filter(Boolean),
      deliverable: cleanText(input.deliverable, 600),
      scheduledOn: dateOf(input.scheduledOn),
      slideUrl: cleanText(input.slideUrl, 600) || null,
    },
  })
  return (await meetingDTOsOf(companyId, [created as ApprenticeMeetingRow]))[0]!
}

export async function updateApprenticeMeeting(
  companyId: string,
  meetingId: string,
  input: MeetingInput,
): Promise<ApprenticeMeetingDTO> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeMeeting.findFirst({ where: { id: meetingId } })
  if (!found) throw new ApprenticeError('Encontro não encontrado.', 404)

  await db.apprenticeMeeting.update({
    where: { id: meetingId },
    data: {
      ...(input.title !== undefined ? { title: cleanText(input.title) } : {}),
      ...(input.theme !== undefined ? { theme: cleanText(input.theme, 400) } : {}),
      ...(input.objectives !== undefined
        ? { objectives: input.objectives.map((line) => cleanText(line, 600)).filter(Boolean) }
        : {}),
      ...(input.deliverable !== undefined ? { deliverable: cleanText(input.deliverable, 600) } : {}),
      ...(input.scheduledOn !== undefined ? { scheduledOn: dateOf(input.scheduledOn) } : {}),
      ...(input.slideUrl !== undefined ? { slideUrl: cleanText(input.slideUrl, 600) || null } : {}),
      ...(input.slideKey !== undefined
        ? {
            slideKey: assertMaterialKey(companyId, input.slideKey),
            slideFileName: cleanText(input.slideFileName, 260) || null,
          }
        : {}),
    },
  })
  return (await listApprenticeMeetings(companyId)).find((meeting) => meeting.id === meetingId)!
}

export async function deleteApprenticeMeeting(companyId: string, meetingId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeMeeting.findFirst({ where: { id: meetingId } })
  if (!found) throw new ApprenticeError('Encontro não encontrado.', 404)
  await db.apprenticeMeeting.delete({ where: { id: meetingId } })
}

/** Liga/desliga o acesso ao encontro ou a pesquisa dele. */
export async function toggleApprenticeMeetingFlag(
  companyId: string,
  meetingId: string,
  flag: 'accessReleased' | 'surveyOpen',
  value: boolean,
): Promise<ApprenticeMeetingDTO> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeMeeting.findFirst({ where: { id: meetingId } })
  if (!found) throw new ApprenticeError('Encontro não encontrado.', 404)
  await db.apprenticeMeeting.update({ where: { id: meetingId }, data: { [flag]: value } })
  return (await listApprenticeMeetings(companyId)).find((meeting) => meeting.id === meetingId)!
}

// ---- Materiais ----

export interface MaterialInput {
  name: string
  url?: string | null
  documentKey?: string | null
  fileName?: string | null
  contentType?: string | null
  sizeBytes?: number | null
}

/**
 * Link externo OU arquivo no S3 — exatamente um dos dois. A chave é conferida
 * pelo prefixo antes de gravar: sem isso, alguém mandaria a chave de um
 * documento de outra empresa e o anexaria ao encontro.
 */
export async function addApprenticeMaterial(
  companyId: string,
  meetingId: string,
  input: MaterialInput,
): Promise<void> {
  const name = cleanText(input.name, 200)
  const url = cleanText(input.url, 1000) || null
  const documentKey = cleanText(input.documentKey, 500) || null
  if (!name) throw new ApprenticeError('Informe o nome do material.', 400)
  if (!url && !documentKey) throw new ApprenticeError('Informe um link ou envie um arquivo.', 400)
  if (url && documentKey) {
    throw new ApprenticeError('Um material é link ou arquivo, não os dois.', 400)
  }
  if (documentKey && !documentKey.startsWith(`${APPRENTICE_MATERIAL_PREFIX}/${companyId}/`)) {
    throw new ApprenticeError('Arquivo inválido. Envie de novo.', 400)
  }

  const db = scopedPrisma(companyId)
  const meeting = await db.apprenticeMeeting.findFirst({ where: { id: meetingId } })
  if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)
  await db.apprenticeMeetingMaterial.create({
    data: {
      meetingId,
      name,
      url,
      documentKey,
      fileName: cleanText(input.fileName, 260) || null,
      contentType: cleanText(input.contentType, 120) || null,
      sizeBytes: input.sizeBytes ?? null,
    },
  })
}

export async function removeApprenticeMaterial(companyId: string, materialId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeMeetingMaterial.findFirst({ where: { id: materialId } })
  if (!found) throw new ApprenticeError('Material não encontrado.', 404)
  await db.apprenticeMeetingMaterial.delete({ where: { id: materialId } })
}

// ---- Fichas ----

export async function listApprenticeActivities(
  companyId: string,
  meetingId?: string,
): Promise<ApprenticeActivityDTO[]> {
  const db = scopedPrisma(companyId)
  const rows = await db.apprenticeActivity.findMany({
    where: meetingId ? { meetingId } : {},
    orderBy: [{ meetingId: 'asc' }, { order: 'asc' }],
  })
  return rows.map((row) => toApprenticeActivityDTO(row as ApprenticeActivityRow))
}

export interface ActivityInput {
  meetingId: string
  title: string
  kind?: ApprenticeActivityKind
  order?: number
  schema: ApprenticeActivitySchema
}

export async function createApprenticeActivity(
  companyId: string,
  input: ActivityInput,
): Promise<ApprenticeActivityDTO> {
  const title = cleanText(input.title)
  if (!title) throw new ApprenticeError('Informe o título da ficha.', 400)

  const db = scopedPrisma(companyId)
  const meeting = await db.apprenticeMeeting.findFirst({ where: { id: input.meetingId } })
  if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)

  // A revisão lê o compromisso do encontro anterior: no primeiro não há anterior.
  if (input.kind === 'REVIEW' && meeting.order <= 1) {
    throw new ApprenticeError('A revisão do compromisso só existe a partir do segundo encontro.', 400)
  }

  const last = await db.apprenticeActivity.findFirst({
    where: { meetingId: input.meetingId },
    orderBy: { order: 'desc' },
  })
  const created = await db.apprenticeActivity.create({
    data: {
      meetingId: input.meetingId,
      title,
      kind: input.kind ?? 'ACTIVITY',
      order: input.order ?? (last?.order ?? 0) + 1,
      schema: input.schema as object,
    },
  })
  return toApprenticeActivityDTO(created as ApprenticeActivityRow)
}

export async function updateApprenticeActivity(
  companyId: string,
  activityId: string,
  input: Partial<Omit<ActivityInput, 'meetingId'>>,
): Promise<ApprenticeActivityDTO> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeActivity.findFirst({ where: { id: activityId } })
  if (!found) throw new ApprenticeError('Ficha não encontrada.', 404)

  const updated = await db.apprenticeActivity.update({
    where: { id: activityId },
    data: {
      ...(input.title !== undefined ? { title: cleanText(input.title) } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.schema !== undefined ? { schema: input.schema as object } : {}),
    },
  })
  return toApprenticeActivityDTO(updated as ApprenticeActivityRow)
}

export async function deleteApprenticeActivity(companyId: string, activityId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeActivity.findFirst({ where: { id: activityId } })
  if (!found) throw new ApprenticeError('Ficha não encontrada.', 404)
  await db.apprenticeActivity.delete({ where: { id: activityId } })
}

// ---- Chamada e reposição ----

export async function listApprenticeAttendance(
  companyId: string,
  meetingId: string,
): Promise<ApprenticeAttendanceDTO[]> {
  const db = scopedPrisma(companyId)
  const meeting = await db.apprenticeMeeting.findFirst({ where: { id: meetingId } })
  if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)

  const [people, rows] = await Promise.all([
    listApprenticePeople(companyId),
    db.apprenticeAttendance.findMany({ where: { meetingId } }),
  ])
  const byUser = new Map(rows.map((row) => [row.userId, row]))

  // Devolve TODA a turma, inclusive quem ainda não foi chamado — a tela é a
  // chamada, e uma pessoa sem linha é justamente a que falta lançar.
  return people.map((person) => {
    const row = byUser.get(person.id)
    return {
      meetingId,
      person,
      present: row?.present ?? null,
      justification: row?.justification ?? null,
      needsMakeup: row?.needsMakeup ?? false,
    }
  })
}

export async function setApprenticeAttendance(
  context: ApprenticeContext,
  meetingId: string,
  userId: string,
  input: { present: boolean | null; justification?: string | null; needsMakeup?: boolean },
): Promise<ApprenticeAttendanceDTO[]> {
  const db = scopedPrisma(context.companyId)
  const meeting = await db.apprenticeMeeting.findFirst({ where: { id: meetingId } })
  if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)

  // Presente não carrega justificativa nem reposição — deixá-las gravadas faria
  // a tela mostrar motivo de falta para quem estava lá.
  const present = input.present
  const justification = present === false ? cleanText(input.justification, 200) || null : null
  const needsMakeup = present === false ? Boolean(input.needsMakeup) : false

  const existing = await db.apprenticeAttendance.findFirst({ where: { meetingId, userId } })
  if (existing) {
    await db.apprenticeAttendance.update({
      where: { id: existing.id },
      data: { present, justification, needsMakeup, recordedById: context.userId },
    })
  } else {
    await db.apprenticeAttendance.create({
      data: { meetingId, userId, present, justification, needsMakeup, recordedById: context.userId },
    })
  }
  return listApprenticeAttendance(context.companyId, meetingId)
}

export async function markAllPresent(
  context: ApprenticeContext,
  meetingId: string,
  classId: string | null,
): Promise<ApprenticeAttendanceDTO[]> {
  const people = await listApprenticePeople(context.companyId)
  const targets = classId ? people.filter((person) => person.classId === classId) : people
  for (const person of targets) {
    await setApprenticeAttendance(context, meetingId, person.id, { present: true })
  }
  return listApprenticeAttendance(context.companyId, meetingId)
}

export async function listApprenticeMakeups(companyId: string): Promise<ApprenticeMakeupDTO[]> {
  const db = scopedPrisma(companyId)
  const [makeups, people] = await Promise.all([
    db.apprenticeMakeup.findMany({
      include: { meeting: { select: { order: true } }, attendees: { select: { userId: true } } },
      orderBy: { scheduledAt: 'asc' },
    }),
    listApprenticePeople(companyId),
  ])
  const byId = new Map(people.map((person) => [person.id, person]))

  return makeups.map((makeup) => ({
    id: makeup.id,
    meetingId: makeup.meetingId,
    meetingOrder: makeup.meeting.order,
    scheduledAt: makeup.scheduledAt.toISOString(),
    attendees: makeup.attendees
      .map((attendee) => byId.get(attendee.userId))
      .filter((person): person is ApprenticePersonDTO => Boolean(person)),
  }))
}

export async function createApprenticeMakeup(
  context: ApprenticeContext,
  input: { meetingId: string; scheduledAt: string; userIds: string[] },
): Promise<ApprenticeMakeupDTO[]> {
  const db = scopedPrisma(context.companyId)
  const meeting = await db.apprenticeMeeting.findFirst({ where: { id: input.meetingId } })
  if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)

  const scheduledAt = new Date(input.scheduledAt)
  if (Number.isNaN(scheduledAt.getTime())) throw new ApprenticeError('Data da reposição inválida.', 400)
  if (input.userIds.length === 0) throw new ApprenticeError('Convoque pelo menos um aprendiz.', 400)

  const people = await listApprenticePeople(context.companyId)
  const valid = input.userIds.filter((id) => people.some((person) => person.id === id))
  if (valid.length === 0) throw new ApprenticeError('Nenhum aprendiz válido na convocação.', 400)

  await db.apprenticeMakeup.create({
    data: {
      meetingId: input.meetingId,
      scheduledAt,
      createdById: context.userId,
      attendees: { create: valid.map((userId) => ({ userId, companyId: context.companyId })) },
    },
  })
  return listApprenticeMakeups(context.companyId)
}

export async function deleteApprenticeMakeup(companyId: string, makeupId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeMakeup.findFirst({ where: { id: makeupId } })
  if (!found) throw new ApprenticeError('Reposição não encontrada.', 404)
  await db.apprenticeMakeup.delete({ where: { id: makeupId } })
}

// ---- Contrato ----

export async function updateApprenticeContract(
  context: ApprenticeContext,
  clauses: string[],
): Promise<string[]> {
  const cleaned = clauses
    .map((clause) => cleanText(clause, APPRENTICE_CONTRACT_CLAUSE_MAX_LENGTH))
    .filter(Boolean)
    .slice(0, APPRENTICE_CONTRACT_MAX_CLAUSES)

  const db = scopedPrisma(context.companyId)
  const existing = await db.apprenticeContract.findFirst()
  // `upsert` não passa pela extensão de isolamento — daí o findFirst + create/update.
  if (existing) {
    const updated = await db.apprenticeContract.update({
      where: { id: existing.id },
      data: { clauses: cleaned, updatedById: context.userId },
    })
    return updated.clauses
  }
  const created = await db.apprenticeContract.create({
    data: { clauses: cleaned, updatedById: context.userId },
  })
  return created.clauses
}

// ---- Painel ----

function summarizeSurvey(
  meetingId: string | null,
  rows: { score: number; takeaway: string; improvement: string; learned: ApprenticeSurveyLearned }[],
): ApprenticeSurveyResultDTO {
  const scores = rows.map((row) => row.score)
  const total = rows.length
  return {
    meetingId,
    total,
    averageScore: total > 0 ? Number((scores.reduce((sum, n) => sum + n, 0) / total).toFixed(1)) : null,
    nps: apprenticeNps(scores),
    promoters: scores.filter((score) => score >= 9).length,
    neutrals: scores.filter((score) => score >= 7 && score <= 8).length,
    detractors: scores.filter((score) => score <= 6).length,
    learned: {
      SIM: rows.filter((row) => row.learned === 'SIM').length,
      EM_PARTE: rows.filter((row) => row.learned === 'EM_PARTE').length,
      NAO: rows.filter((row) => row.learned === 'NAO').length,
    },
    takeaways: rows.map((row) => row.takeaway).filter(Boolean),
    improvements: rows.map((row) => row.improvement).filter(Boolean),
  }
}

export async function getApprenticeOverview(
  companyId: string,
  filters: { meetingId?: string; classId?: string; userId?: string },
): Promise<ApprenticeOverviewDTO> {
  const db = scopedPrisma(companyId)
  const people = await listApprenticePeople(companyId)
  const targets = people
    .filter((person) => !filters.classId || person.classId === filters.classId)
    .filter((person) => !filters.userId || person.id === filters.userId)
  const targetIds = targets.map((person) => person.id)

  const meetings = await db.apprenticeMeeting.findMany({
    where: filters.meetingId ? { id: filters.meetingId } : {},
    include: { activities: { select: { id: true, kind: true } } },
    orderBy: { order: 'asc' },
  })
  const meetingIds = meetings.map((meeting) => meeting.id)

  const [surveyRows, attendanceRows, submissionRows] = await Promise.all([
    db.apprenticeSurveyResponse.findMany({
      where: meetingIds.length > 0 ? { meetingId: { in: meetingIds } } : {},
      select: { score: true, takeaway: true, improvement: true, learned: true },
    }),
    db.apprenticeAttendance.findMany({
      where: {
        ...(meetingIds.length > 0 ? { meetingId: { in: meetingIds } } : {}),
        ...(targetIds.length > 0 ? { userId: { in: targetIds } } : {}),
        present: { not: null },
      },
      select: { present: true, justification: true },
    }),
    db.apprenticeSubmission.findMany({
      where: {
        submittedAt: { not: null },
        ...(targetIds.length > 0 ? { userId: { in: targetIds } } : {}),
        ...(meetingIds.length > 0 ? { activity: { meetingId: { in: meetingIds } } } : {}),
      },
      select: { values: true, activity: { select: { kind: true } } },
    }),
  ])

  const called = attendanceRows.length
  const present = attendanceRows.filter((row) => row.present === true).length
  const absences = called - present
  const justified = attendanceRows.filter(
    (row) => row.present === false && (row.justification ?? '').trim() !== '',
  ).length

  const expected = meetings.reduce((sum, meeting) => sum + meeting.activities.length * targets.length, 0)
  const submitted = submissionRows.length

  // Taxa de cumprimento: sai das REVISÕES enviadas, que é onde o aprendiz diz se
  // cumpriu o que tinha combinado. Sem revisão enviada não há o que contar.
  const reviewStatuses = submissionRows
    .filter((row) => row.activity.kind === 'REVIEW')
    .map((row) => asApprenticeValues(row.values)[APPRENTICE_REVIEW_STATUS_FIELD_ID])
    .filter((status): status is ApprenticeReviewStatus =>
      typeof status === 'string' && (APPRENTICE_REVIEW_STATUSES as readonly string[]).includes(status),
    )
  const fulfilled = reviewStatuses.filter((status) => status === 'Cumpri totalmente').length
  const partial = reviewStatuses.filter((status) => status === 'Cumpri parcialmente').length
  const unfulfilled = reviewStatuses.filter((status) => status === 'Não cumpri').length

  return {
    survey: summarizeSurvey(filters.meetingId ?? null, surveyRows),
    attendance: {
      called,
      present,
      absences,
      justifiedAbsences: justified,
      rate: called > 0 ? Math.round((present / called) * 100) : null,
    },
    activities: {
      submitted,
      expected,
      rate: expected > 0 ? Math.round((submitted / expected) * 100) : null,
    },
    commitments: {
      reviews: reviewStatuses.length,
      fulfilled,
      partial,
      unfulfilled,
      rate: reviewStatuses.length > 0 ? Math.round((fulfilled / reviewStatuses.length) * 100) : null,
    },
  }
}

/** Andamento nominal de um encontro: presença e fichas entregues, pessoa a pessoa. */
export interface ApprenticeProgressRow {
  person: ApprenticePersonDTO
  present: boolean | null
  submittedCount: number
  activityCount: number
  reviewStatus: ApprenticeReviewStatus | null
}

export async function getApprenticeProgress(
  companyId: string,
  meetingId: string,
): Promise<ApprenticeProgressRow[]> {
  const db = scopedPrisma(companyId)
  const meeting = await db.apprenticeMeeting.findFirst({
    where: { id: meetingId },
    include: { activities: { select: { id: true, kind: true } } },
  })
  if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)

  const people = await listApprenticePeople(companyId)
  const [attendances, submissions] = await Promise.all([
    db.apprenticeAttendance.findMany({ where: { meetingId }, select: { userId: true, present: true } }),
    db.apprenticeSubmission.findMany({
      where: { submittedAt: { not: null }, activity: { meetingId } },
      select: { userId: true, values: true, activity: { select: { kind: true } } },
    }),
  ])
  const presence = new Map(attendances.map((row) => [row.userId, row.present]))

  return people.map((person) => {
    const own = submissions.filter((row) => row.userId === person.id)
    const review = own.find((row) => row.activity.kind === 'REVIEW')
    const status = review ? asApprenticeValues(review.values)[APPRENTICE_REVIEW_STATUS_FIELD_ID] : null
    return {
      person,
      present: presence.get(person.id) ?? null,
      submittedCount: own.length,
      activityCount: meeting.activities.length,
      reviewStatus:
        typeof status === 'string' && (APPRENTICE_REVIEW_STATUSES as readonly string[]).includes(status)
          ? (status as ApprenticeReviewStatus)
          : null,
    }
  })
}
