import {
  APPRENTICE_COMMITMENT_FIELD_ID,
  APPRENTICE_POSITION_CATEGORY,
  APPRENTICE_SURVEY_MAX_SCORE,
  APPRENTICE_SURVEY_MIN_SCORE,
  APPRENTICE_TEXT_MAX_LENGTH,
  asApprenticeSchema,
  asApprenticeValues,
  canSubmitApprenticeActivity,
  deliveryStatusOf,
  isMeetingUnlocked,
  meetingStatusesOf,
  type ApprenticeContractDTO,
  type ApprenticeMeetingDetailDTO,
  type ApprenticePersonDTO,
  type ApprenticePortfolioDTO,
  type ApprenticePortfolioOverviewDTO,
  type ApprenticeSubmissionDTO,
  type ApprenticeSurveyLearned,
  type ApprenticeTrackDTO,
  type ApprenticeTrackMeetingDTO,
  type ApprenticeValues,
  type ApprenticeWallDTO,
  type ApprenticeWallEntryDTO,
} from '@legends/shared'
import { presignDocumentDownload, s3Config } from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'
import { ApprenticeError } from '../lib/apprentice-error'
import type { ApprenticeContext } from '../lib/apprentice-context'
import {
  toApprenticeActivityDTO,
  toApprenticeMaterialDTO,
  toApprenticeMeetingDTO,
  toApprenticeSubmissionDTO,
  type ApprenticeActivityRow,
  type ApprenticeMeetingRow,
  type ApprenticeSubmissionRow,
} from '../lib/serialize'

/** Data civil de hoje, no fuso de São Paulo — é o que decide o status do encontro. */
export function apprenticeToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Os aprendizes da empresa. Sai de `User.positionCategory`, e não de uma lista
 * própria: quem a planilha de colaboradores marca como Jovem Aprendiz está no
 * programa, sem cadastro em dois lugares.
 */
export async function listApprenticePeople(companyId: string): Promise<ApprenticePersonDTO[]> {
  const db = scopedPrisma(companyId)
  const users = await db.user.findMany({
    where: { positionCategory: APPRENTICE_POSITION_CATEGORY, active: true, leftAt: null },
    select: {
      id: true,
      name: true,
      photoUrl: true,
      apprenticeEnrollments: {
        select: { classId: true, class: { select: { name: true, shift: true } } },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  })

  return users.map((user) => {
    const enrollment = user.apprenticeEnrollments[0] ?? null
    return {
      id: user.id,
      name: user.name,
      photoUrl: user.photoUrl,
      classId: enrollment?.classId ?? null,
      className: enrollment
        ? [enrollment.class.name, enrollment.class.shift].filter(Boolean).join(' · ')
        : null,
    }
  })
}

interface MeetingProgress {
  activityCount: number
  submittedCount: number
  surveyAnswered: boolean
}

/**
 * Monta os encontros como uma pessoa os vê: status pela data, trava pela
 * presença no encontro anterior, e o progresso dela própria.
 */
async function buildTrackMeetings(
  context: ApprenticeContext,
  viewerId: string,
): Promise<ApprenticeTrackMeetingDTO[]> {
  const db = scopedPrisma(context.companyId)

  const meetings = await db.apprenticeMeeting.findMany({
    orderBy: { order: 'asc' },
    include: { activities: { select: { id: true } } },
  })
  if (meetings.length === 0) return []

  const meetingIds = meetings.map((meeting) => meeting.id)

  const [submissions, receipts, attendances] = await Promise.all([
    db.apprenticeSubmission.findMany({
      where: { userId: viewerId, submittedAt: { not: null }, activity: { meetingId: { in: meetingIds } } },
      select: { activity: { select: { meetingId: true } } },
    }),
    db.apprenticeSurveyReceipt.findMany({
      where: { userId: viewerId, meetingId: { in: meetingIds } },
      select: { meetingId: true },
    }),
    db.apprenticeAttendance.findMany({
      where: { userId: viewerId, meetingId: { in: meetingIds } },
      select: { meetingId: true, present: true },
    }),
  ])

  const submittedByMeeting = new Map<string, number>()
  for (const submission of submissions) {
    const id = submission.activity.meetingId
    submittedByMeeting.set(id, (submittedByMeeting.get(id) ?? 0) + 1)
  }
  const answered = new Set(receipts.map((receipt) => receipt.meetingId))
  const presenceByMeeting = new Map(attendances.map((row) => [row.meetingId, row.present]))

  const statuses = meetingStatusesOf(
    meetings.map((meeting) => ({
      id: meeting.id,
      order: meeting.order,
      scheduledOn: meeting.scheduledOn ? meeting.scheduledOn.toISOString().slice(0, 10) : null,
    })),
    apprenticeToday(),
  )

  return meetings.map((meeting, index) => {
    const previous = index > 0 ? meetings[index - 1] : null
    const progress: MeetingProgress = {
      activityCount: meeting.activities.length,
      submittedCount: submittedByMeeting.get(meeting.id) ?? 0,
      surveyAnswered: answered.has(meeting.id),
    }
    const unlocked = isMeetingUnlocked({
      accessReleased: meeting.accessReleased,
      order: meeting.order,
      isFacilitator: context.isFacilitator && !context.isApprentice,
      previousAttendance: previous ? (presenceByMeeting.get(previous.id) ?? null) : null,
    })

    return {
      ...toApprenticeMeetingDTO(meeting as ApprenticeMeetingRow, statuses[meeting.id] ?? 'FUTURO'),
      unlocked,
      activityCount: progress.activityCount,
      submittedCount: progress.submittedCount,
      surveyAnswered: progress.surveyAnswered,
      completed:
        progress.activityCount > 0 &&
        progress.submittedCount >= progress.activityCount &&
        progress.surveyAnswered,
    }
  })
}

export async function getApprenticeTrack(context: ApprenticeContext): Promise<ApprenticeTrackDTO> {
  const db = scopedPrisma(context.companyId)
  const meetings = await buildTrackMeetings(context, context.userId)

  const [makeups, contract] = await Promise.all([
    db.apprenticeMakeup.findMany({
      where: { attendees: { some: { userId: context.userId } } },
      include: { meeting: { select: { order: true } }, attendees: { select: { userId: true } } },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.apprenticeContract.findFirst({
      select: { id: true, signatures: { where: { userId: context.userId }, select: { id: true } } },
    }),
  ])

  const people = await listApprenticePeople(context.companyId)
  const peopleById = new Map(people.map((person) => [person.id, person]))

  return {
    viewer: {
      userId: context.userId,
      isApprentice: context.isApprentice,
      isFacilitator: context.isFacilitator,
      classId: context.classId,
      className: context.className,
    },
    meetings,
    makeups: makeups.map((makeup) => ({
      id: makeup.id,
      meetingId: makeup.meetingId,
      meetingOrder: makeup.meeting.order,
      scheduledAt: makeup.scheduledAt.toISOString(),
      attendees: makeup.attendees
        .map((attendee) => peopleById.get(attendee.userId))
        .filter((person): person is ApprenticePersonDTO => Boolean(person)),
    })),
    contractSigned: (contract?.signatures.length ?? 0) > 0,
  }
}

/** Situação de entrega de cada aprendiz num encontro — o Mural. Só status, nunca texto. */
async function wallEntriesFor(
  companyId: string,
  meetings: { id: string; order: number; title: string; deliverable: string; accessReleased: boolean }[],
  people: ApprenticePersonDTO[],
): Promise<ApprenticeWallEntryDTO[]> {
  const db = scopedPrisma(companyId)
  const meetingIds = meetings.map((meeting) => meeting.id)
  if (meetingIds.length === 0 || people.length === 0) return []

  const [activities, submissions] = await Promise.all([
    db.apprenticeActivity.findMany({
      where: { meetingId: { in: meetingIds } },
      select: { id: true, meetingId: true },
    }),
    db.apprenticeSubmission.findMany({
      where: {
        submittedAt: { not: null },
        userId: { in: people.map((person) => person.id) },
        activity: { meetingId: { in: meetingIds } },
      },
      select: { userId: true, submittedAt: true, activity: { select: { meetingId: true } } },
    }),
  ])

  const activityCount = new Map<string, number>()
  for (const activity of activities) {
    activityCount.set(activity.meetingId, (activityCount.get(activity.meetingId) ?? 0) + 1)
  }

  const key = (meetingId: string, userId: string) => `${meetingId}:${userId}`
  const submitted = new Map<string, { count: number; last: Date | null }>()
  for (const submission of submissions) {
    const mapKey = key(submission.activity.meetingId, submission.userId)
    const current = submitted.get(mapKey) ?? { count: 0, last: null }
    const last =
      submission.submittedAt && (!current.last || submission.submittedAt > current.last)
        ? submission.submittedAt
        : current.last
    submitted.set(mapKey, { count: current.count + 1, last })
  }

  const sorted = [...meetings].sort((a, b) => a.order - b.order)

  return sorted.flatMap((meeting, index) => {
    const next = sorted[index + 1]
    return people.map((person) => {
      const stats = submitted.get(key(meeting.id, person.id)) ?? { count: 0, last: null }
      const total = activityCount.get(meeting.id) ?? 0
      return {
        meetingId: meeting.id,
        meetingOrder: meeting.order,
        meetingTitle: meeting.title,
        deliverable: meeting.deliverable,
        person,
        status: deliveryStatusOf({
          submittedCount: stats.count,
          activityCount: total,
          nextMeetingReleased: Boolean(next?.accessReleased),
        }),
        submittedCount: stats.count,
        activityCount: total,
        lastSubmittedAt: stats.last ? stats.last.toISOString() : null,
      }
    })
  })
}

export async function getApprenticeWall(context: ApprenticeContext): Promise<ApprenticeWallDTO> {
  const db = scopedPrisma(context.companyId)
  const [meetings, people, classes] = await Promise.all([
    db.apprenticeMeeting.findMany({ orderBy: { order: 'asc' } }),
    listApprenticePeople(context.companyId),
    db.apprenticeClass.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { enrollments: true } } },
    }),
  ])

  // O mural só mostra encontro já liberado: um encontro fechado não tem entrega
  // atrasada, tem encontro que ainda não aconteceu.
  const visible = meetings.filter((meeting) => meeting.accessReleased || meeting.order === 1)
  const statuses = meetingStatusesOf(
    meetings.map((meeting) => ({
      id: meeting.id,
      order: meeting.order,
      scheduledOn: meeting.scheduledOn ? meeting.scheduledOn.toISOString().slice(0, 10) : null,
    })),
    apprenticeToday(),
  )

  return {
    entries: await wallEntriesFor(context.companyId, visible, people),
    classes: classes.map((row) => ({
      id: row.id,
      name: row.name,
      shift: row.shift,
      active: row.active,
      memberCount: row._count.enrollments,
    })),
    meetings: visible.map((meeting) =>
      toApprenticeMeetingDTO(meeting as ApprenticeMeetingRow, statuses[meeting.id] ?? 'FUTURO'),
    ),
  }
}

export async function getApprenticeMeetingDetail(
  context: ApprenticeContext,
  meetingId: string,
): Promise<ApprenticeMeetingDetailDTO> {
  const db = scopedPrisma(context.companyId)
  const meetings = await buildTrackMeetings(context, context.userId)
  const meeting = meetings.find((row) => row.id === meetingId)
  if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)
  if (!meeting.unlocked) throw new ApprenticeError('Este encontro ainda não foi liberado.', 403)

  const [materials, activities, submissions, people, receipt] = await Promise.all([
    db.apprenticeMeetingMaterial.findMany({ where: { meetingId }, orderBy: { createdAt: 'asc' } }),
    db.apprenticeActivity.findMany({ where: { meetingId }, orderBy: { order: 'asc' } }),
    db.apprenticeSubmission.findMany({
      where: { userId: context.userId, activity: { meetingId } },
    }),
    listApprenticePeople(context.companyId),
    db.apprenticeSurveyReceipt.findFirst({ where: { meetingId, userId: context.userId } }),
  ])

  // O que a pessoa combinou no Compromisso do Mês do encontro anterior — é o que
  // a ficha de revisão mostra no topo. Uma consulta só, e só quando faz sentido.
  let previousCommitment: string | null = null
  const previous = meetings.find((row) => row.order === meeting.order - 1)
  if (previous) {
    const commitment = await db.apprenticeSubmission.findFirst({
      where: {
        userId: context.userId,
        activity: { meetingId: previous.id, kind: 'COMMITMENT' },
      },
      select: { values: true },
    })
    const value = commitment ? asApprenticeValues(commitment.values)[APPRENTICE_COMMITMENT_FIELD_ID] : null
    previousCommitment = typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  }

  const meetingRow = {
    id: meeting.id,
    order: meeting.order,
    title: meeting.title,
    deliverable: meeting.deliverable,
    accessReleased: meeting.accessReleased,
  }
  const next = meetings.find((row) => row.order === meeting.order + 1)
  const wall = await wallEntriesFor(
    context.companyId,
    next ? [meetingRow, { ...next, deliverable: next.deliverable }] : [meetingRow],
    people,
  )

  const slideRow = await db.apprenticeMeeting.findFirst({
    where: { id: meetingId },
    select: { slideKey: true, slideFileName: true },
  })
  let slideDownloadUrl: string | null = null
  if (slideRow?.slideKey && s3Config()) {
    try {
      slideDownloadUrl = await presignDocumentDownload({
        key: slideRow.slideKey,
        fileName: slideRow.slideFileName,
      })
    } catch {
      slideDownloadUrl = null
    }
  }

  return {
    meeting,
    slideDownloadUrl,
    materials: await Promise.all(materials.map(toApprenticeMaterialDTO)),
    activities: activities.map((activity) => toApprenticeActivityDTO(activity as ApprenticeActivityRow)),
    submissions: submissions.map((submission) =>
      toApprenticeSubmissionDTO(submission as ApprenticeSubmissionRow),
    ),
    previousCommitment,
    wall: wall.filter((entry) => entry.meetingId === meeting.id),
    surveyOpen: meeting.surveyOpen,
    surveyAnswered: Boolean(receipt),
  }
}

export async function saveApprenticeSubmission(
  context: ApprenticeContext,
  activityId: string,
  values: ApprenticeValues,
  submit: boolean,
): Promise<ApprenticeSubmissionDTO> {
  if (!context.isApprentice) {
    throw new ApprenticeError('Só o aprendiz preenche a ficha.', 403)
  }

  const db = scopedPrisma(context.companyId)
  const activity = await db.apprenticeActivity.findFirst({ where: { id: activityId } })
  if (!activity) throw new ApprenticeError('Ficha não encontrada.', 404)

  // A trava do encontro vale para escrever, e não só para ler: sem isto, um POST
  // direto gravaria ficha de encontro que ainda não foi liberado.
  const meetings = await buildTrackMeetings(context, context.userId)
  const meeting = meetings.find((row) => row.id === activity.meetingId)
  if (!meeting?.unlocked) throw new ApprenticeError('Este encontro ainda não foi liberado.', 403)

  const schema = asApprenticeSchema(activity.schema)
  const cleaned = sanitizeValues(values)
  if (submit && !canSubmitApprenticeActivity(schema, cleaned)) {
    throw new ApprenticeError('Preencha os campos obrigatórios para enviar.', 400)
  }

  const now = new Date()
  const existing = await db.apprenticeSubmission.findFirst({
    where: { activityId, userId: context.userId },
  })

  const saved = existing
    ? await db.apprenticeSubmission.update({
        where: { id: existing.id },
        data: {
          values: cleaned,
          draftSavedAt: now,
          // Enviado não volta a ser rascunho: reenviar atualiza o conteúdo e
          // mantém a data do primeiro envio, que é o que o mural contou.
          ...(submit && !existing.submittedAt ? { submittedAt: now } : {}),
        },
      })
    : await db.apprenticeSubmission.create({
        data: {
          activityId,
          userId: context.userId,
          values: cleaned,
          draftSavedAt: now,
          ...(submit ? { submittedAt: now } : {}),
        },
      })

  return toApprenticeSubmissionDTO(saved as ApprenticeSubmissionRow)
}

/** Corta texto acima do limite e descarta o que não é valor de campo conhecido. */
function sanitizeValues(values: ApprenticeValues): ApprenticeValues {
  const out: ApprenticeValues = {}
  for (const [key, value] of Object.entries(asApprenticeValues(values))) {
    if (typeof value === 'string') out[key] = value.slice(0, APPRENTICE_TEXT_MAX_LENGTH)
    else if (typeof value === 'boolean') out[key] = value
    else if (Array.isArray(value)) {
      out[key] = value.map((item) => {
        const cleaned: Record<string, string> = {}
        for (const [field, fieldValue] of Object.entries(item)) {
          cleaned[field] = String(fieldValue).slice(0, APPRENTICE_TEXT_MAX_LENGTH)
        }
        return cleaned
      })
    }
  }
  return out
}

export async function getApprenticeContract(context: ApprenticeContext): Promise<ApprenticeContractDTO> {
  const db = scopedPrisma(context.companyId)
  const [contract, people] = await Promise.all([
    db.apprenticeContract.findFirst({
      include: { signatures: { orderBy: { signedAt: 'asc' } } },
    }),
    listApprenticePeople(context.companyId),
  ])
  const peopleById = new Map(people.map((person) => [person.id, person]))

  return {
    clauses: contract?.clauses ?? [],
    updatedAt: contract?.updatedAt ? contract.updatedAt.toISOString() : null,
    signatures: (contract?.signatures ?? []).flatMap((signature) => {
      const person = peopleById.get(signature.userId)
      return person ? [{ person, signedAt: signature.signedAt.toISOString() }] : []
    }),
    signedByViewer: (contract?.signatures ?? []).some(
      (signature) => signature.userId === context.userId,
    ),
  }
}

export async function signApprenticeContract(context: ApprenticeContext): Promise<ApprenticeContractDTO> {
  if (!context.isApprentice) {
    throw new ApprenticeError('Só o aprendiz assina o contrato da trilha.', 403)
  }
  const db = scopedPrisma(context.companyId)
  const contract = await db.apprenticeContract.findFirst()
  if (!contract) throw new ApprenticeError('O contrato da trilha ainda não foi publicado.', 400)

  const existing = await db.apprenticeContractSignature.findFirst({
    where: { contractId: contract.id, userId: context.userId },
  })
  if (!existing) {
    await db.apprenticeContractSignature.create({
      data: { contractId: contract.id, userId: context.userId },
    })
  }
  return getApprenticeContract(context)
}

export async function getApprenticePortfolio(
  context: ApprenticeContext,
  targetUserId: string,
): Promise<ApprenticePortfolioDTO> {
  // O conteúdo da ficha é privado: só o próprio aprendiz e o facilitador leem.
  if (targetUserId !== context.userId && !context.isFacilitator) {
    throw new ApprenticeError('Portfólio restrito ao próprio aprendiz e ao facilitador.', 403)
  }

  const db = scopedPrisma(context.companyId)
  const people = await listApprenticePeople(context.companyId)
  const person = people.find((row) => row.id === targetUserId)
  if (!person) throw new ApprenticeError('Aprendiz não encontrado.', 404)

  // O portfólio é o da PESSOA, então a trava e o progresso também são: um
  // facilitador olhando não pode ver o encontro como se fosse dele.
  const meetings = await buildTrackMeetings(
    { ...context, isFacilitator: false, isApprentice: true },
    targetUserId,
  )
  const meetingIds = meetings.map((meeting) => meeting.id)

  const [activities, submissions] = await Promise.all([
    db.apprenticeActivity.findMany({
      where: { meetingId: { in: meetingIds } },
      orderBy: { order: 'asc' },
    }),
    db.apprenticeSubmission.findMany({
      where: { userId: targetUserId, activity: { meetingId: { in: meetingIds } } },
    }),
  ])

  const submissionsByActivity = new Map(submissions.map((row) => [row.activityId, row]))

  return {
    person,
    meetings: meetings.map((meeting) => {
      const own = activities.filter((activity) => activity.meetingId === meeting.id)
      return {
        meeting,
        activities: own.map((activity) => toApprenticeActivityDTO(activity as ApprenticeActivityRow)),
        submissions: own.flatMap((activity) => {
          const submission = submissionsByActivity.get(activity.id)
          return submission ? [toApprenticeSubmissionDTO(submission as ApprenticeSubmissionRow)] : []
        }),
      }
    }),
    completedMeetings: meetings.filter((meeting) => meeting.completed).length,
    totalMeetings: meetings.length,
  }
}

/**
 * O portfólio da TURMA, que é o que o facilitador abre: ele não é aprendiz, não
 * tem portfólio próprio, e pedir o dele devolvia 404 ("Aprendiz não
 * encontrado.") — a tela abria vazia.
 *
 * Só a situação de entrega, nunca o conteúdo das fichas: para ler o que a
 * pessoa escreveu, o facilitador abre o portfólio dela, que já é autorizado
 * caso a caso em `getApprenticePortfolio`.
 *
 * As consultas são da turma inteira de uma vez (uma por tabela, com `in`), e
 * não uma trilha por pessoa: são seis encontros por aprendiz, e o N+1 cresceria
 * com a turma.
 */
export async function getApprenticePortfolioOverview(
  context: ApprenticeContext,
): Promise<ApprenticePortfolioOverviewDTO> {
  if (!context.isFacilitator) {
    throw new ApprenticeError('Só o facilitador vê o portfólio da turma.', 403)
  }

  const db = scopedPrisma(context.companyId)
  const [people, meetings] = await Promise.all([
    listApprenticePeople(context.companyId),
    db.apprenticeMeeting.findMany({
      orderBy: { order: 'asc' },
      select: { id: true, order: true, activities: { select: { id: true } } },
    }),
  ])

  const userIds = people.map((person) => person.id)
  const meetingIds = meetings.map((meeting) => meeting.id)
  const activityCountByMeeting = new Map(
    meetings.map((meeting) => [meeting.id, meeting.activities.length]),
  )
  const activityCount = meetings.reduce((total, meeting) => total + meeting.activities.length, 0)

  const [submissions, receipts] =
    userIds.length > 0 && meetingIds.length > 0
      ? await Promise.all([
          db.apprenticeSubmission.findMany({
            where: {
              userId: { in: userIds },
              submittedAt: { not: null },
              activity: { meetingId: { in: meetingIds } },
            },
            select: { userId: true, activity: { select: { meetingId: true } } },
          }),
          db.apprenticeSurveyReceipt.findMany({
            where: { userId: { in: userIds }, meetingId: { in: meetingIds } },
            select: { userId: true, meetingId: true },
          }),
        ])
      : [[], []]

  const submittedByPerson = new Map<string, Map<string, number>>()
  for (const submission of submissions) {
    const byMeeting = submittedByPerson.get(submission.userId) ?? new Map<string, number>()
    const meetingId = submission.activity.meetingId
    byMeeting.set(meetingId, (byMeeting.get(meetingId) ?? 0) + 1)
    submittedByPerson.set(submission.userId, byMeeting)
  }
  const answered = new Set(receipts.map((receipt) => `${receipt.userId}:${receipt.meetingId}`))

  const rows = people.map((person) => {
    const byMeeting = submittedByPerson.get(person.id) ?? new Map<string, number>()
    const perMeeting = meetings.map((meeting) => {
      const expected = activityCountByMeeting.get(meeting.id) ?? 0
      const submitted = byMeeting.get(meeting.id) ?? 0
      return {
        id: meeting.id,
        order: meeting.order,
        completed:
          expected > 0 && submitted >= expected && answered.has(`${person.id}:${meeting.id}`),
      }
    })
    return {
      person,
      completedMeetings: perMeeting.filter((meeting) => meeting.completed).length,
      submittedCount: [...byMeeting.values()].reduce((total, count) => total + count, 0),
      activityCount,
      meetings: perMeeting,
    }
  })

  return {
    people: rows,
    totalMeetings: meetings.length,
    submittedCount: rows.reduce((total, row) => total + row.submittedCount, 0),
    activityCount: activityCount * people.length,
  }
}

export interface SubmitSurveyInput {
  score: number
  takeaway: string
  improvement: string
  learned: ApprenticeSurveyLearned
}

export async function submitApprenticeSurvey(
  context: ApprenticeContext,
  meetingId: string,
  input: SubmitSurveyInput,
): Promise<void> {
  if (!context.isApprentice) {
    throw new ApprenticeError('Só o aprendiz responde a pesquisa.', 403)
  }
  if (input.score < APPRENTICE_SURVEY_MIN_SCORE || input.score > APPRENTICE_SURVEY_MAX_SCORE) {
    throw new ApprenticeError('Nota fora do intervalo de 0 a 10.', 400)
  }
  if (input.takeaway.trim() === '') {
    throw new ApprenticeError('Conte o que você leva deste encontro.', 400)
  }

  const db = scopedPrisma(context.companyId)
  const meeting = await db.apprenticeMeeting.findFirst({ where: { id: meetingId } })
  if (!meeting) throw new ApprenticeError('Encontro não encontrado.', 404)
  if (!meeting.surveyOpen) throw new ApprenticeError('A pesquisa deste encontro não está aberta.', 400)

  const receipt = await db.apprenticeSurveyReceipt.findFirst({
    where: { meetingId, userId: context.userId },
  })
  if (receipt) throw new ApprenticeError('Você já respondeu a pesquisa deste encontro.', 400)

  // Recibo e resposta são gravados na MESMA transação, mas em tabelas que não se
  // referenciam: uma diz que a pessoa respondeu, a outra o que foi respondido, e
  // não há coluna ligando as duas.
  await db.$transaction([
    db.apprenticeSurveyResponse.create({
      data: {
        meetingId,
        score: input.score,
        takeaway: input.takeaway.trim().slice(0, APPRENTICE_TEXT_MAX_LENGTH),
        improvement: input.improvement.trim().slice(0, APPRENTICE_TEXT_MAX_LENGTH),
        learned: input.learned,
      },
    }),
    db.apprenticeSurveyReceipt.create({ data: { meetingId, userId: context.userId } }),
  ])
}
