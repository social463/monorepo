import { prisma } from './prisma'

/**
 * Models com coluna própria `companyId`. Mantida à mão — todo novo model
 * tenant-scoped precisa ser adicionado aqui manualmente para ganhar isolamento
 * (ver docs/superpowers/specs/2026-07-23-multi-empresa-isolamento-design.md).
 */
export const TENANT_SCOPED_MODELS = new Set([
  'Sector',
  'CompanyResponsible',
  'User',
  'VotingPeriod',
  'Vote',
  'Squad',
  'ThirdPartyInvite',
  'Category',
  'Badge',
  'BadgeCategory',
  'BadgeClaim',
  'UserBadge',
  'Feedback',
  'MonthlyHighlight',
  'BirthdayGreeting',
  'BirthdayGreetingReaction',
  'FeedbackReaction',
  'FeedbackRecipient',
  'FeedbackRecognitionCategory',
  'FeedbackComment',
  'RecognitionCategory',
  'MoodEntry',
  'Vacation',
  'VacationCampaign',
  'VacationEntitlement',
  'VacationPlan',
  'VacationPlanPeriod',
  'VacationRequest',
  'Notification',
  'Review',
  'ReviewComment',
  'ReviewReaction',
  'ReviewCommentReaction',
  'ReviewShare',
  'ReviewMention',
  'ReviewCommentMention',
  'ReviewPoll',
  'ReviewPollOption',
  'ReviewPollVote',
  'CorporatePost',
  'CorporatePostComment',
  'CorporatePostReaction',
  'CorporatePostCommentReaction',
  'CorporatePostMention',
  'CorporatePostCommentMention',
  'CorporatePostRead',
  'CorporatePostSector',
  'CorporatePostTag',
  'CorporatePostPoll',
  'CorporatePostPollOption',
  'CorporatePostPollVote',
  'CalendarEventGuest',
  'CorporatePostAttachment',
  'OfficeMap',
  'OfficeMapDraft',
  'OfficeMapAsset',
  'OfficeMapEditLock',
  'OfficeMapPublication',
  'OfficeMapPublicationAsset',
  'OfficeMapDecorRevision',
  'OfficeRoom',
  'OfficeRoomAccessGrant',
  'OfficeDesk',
  'OfficeDeskClaim',
  'OfficeDeskReminder',
  'OfficeGuestInvite',
  'OfficeMeeting',
  'RetroRoom',
  'RetroRoomSquad',
  'RetroParticipant',
  'RetroCard',
  'RetroVote',
  'RetroReaction',
  'RetroEdit',
  'AdminAuditLog',
  'DevelopmentThursdayEvent',
  'InovaProject',
  'InovaPhaseHistory',
  'InovaDiaryEntry',
  'InovaProjectTask',
  'InovaActivity',
  'InovaGuiaVideo',
  'CalendarEventType',
  'CalendarEvent',
  'CulturePage',
  'CultureManual',
  'CultureBenefit',
  'CoinRule',
  'CoinTransaction',
  'XpRule',
  'XpTransaction',
  'AccessLog',
  'AnalyticsEvent',
  'CourseQuiz',
  'CourseQuestion',
  'QuizAttempt',
  'CertificateTemplate',
  'CertificateRequest',
  'TrainingEvent',
  'TrainingRecord',
  // Eu Aprendiz (spec 2026-09-14). Sem estar aqui, o `findFirst({ where: { id } })`
  // do service alcançaria o encontro de outra empresa.
  'ApprenticeClass',
  'ApprenticeEnrollment',
  'ApprenticeMeeting',
  'ApprenticeMeetingMaterial',
  'ApprenticeActivity',
  'ApprenticeSubmission',
  'ApprenticeAttendance',
  'ApprenticeMakeup',
  'ApprenticeMakeupAttendee',
  'ApprenticeSurveyResponse',
  'ApprenticeSurveyReceipt',
  'ApprenticeContract',
  'ApprenticeContractSignature',
  'Course',
  // Catálogo da Central de Cursos (Documento 4, 9.6 e 9.7). Sem estar aqui, o
  // `findFirst({ where: { id } })` do service alcançaria a categoria de outra
  // empresa — que é exatamente o que este registro existe para impedir.
  'CourseCategory',
  'Competency',
  'Instructor',
  'CourseModule',
  'CourseLesson',
  'CourseEnrollment',
  'LessonProgress',
  'CourseFavorite',
  'CourseRating',
  'LearningTrack',
  'LearningTrackCourse',
  'Certificate',
  'PdiPlan',
  'PdiAction',
  'PdiActionEvidence',
  'PdiActionHistory',
  'HrDashboard',
  'BenchmarkPractice',
  'AgentConversation',
  'AgentMessage',
  'GlassReview',
  'Challenge',
  'ChallengeSubmission',
  'KnowledgeEntry',
  'AssistantQuery',
  'AssistantFeedback',
  'StoreProduct',
  'StoreOrder',
  'Campaign',
  'CampaignPost',
  'EventAlbum',
  'EventPhoto',
  'EventPhotoReaction',
  'EventPhotoComment',
  'OneOnOneSeries',
  'OneOnOneMeeting',
  'OneOnOneTopic',
  'OneOnOnePrivateNote',
  'OneOnOneAction',
  'OneOnOneTopicTemplate',
  // Metas e OKRs (spec 2026-09-17).
  'OkrCycle',
  'OkrObjective',
  'OkrKeyResult',
  'OkrAssignment',
  'OkrCheckIn',
  'OkrKrDependency',
])

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

function injectCompanyIdIntoRow(row: Record<string, unknown>, companyId: string, model: string): Record<string, unknown> {
  if (row.companyId !== undefined && row.companyId !== companyId) {
    throw new TenantScopeError(`Tentativa de criar ${model} com companyId divergente do escopo atual.`)
  }
  return { ...row, companyId }
}

export function scopedPrisma(companyId: string) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args)
          }

          if (operation === 'upsert') {
            throw new TenantScopeError(`upsert não é suportado ainda pela extensão de isolamento para ${model}.`)
          }

          const typedArgs = args as { data?: unknown; where?: Record<string, unknown> }

          if (operation === 'create') {
            const data = injectCompanyIdIntoRow((typedArgs.data ?? {}) as Record<string, unknown>, companyId, model)
            return query({ ...args, data })
          }

          if (operation === 'createMany') {
            const rows = (typedArgs.data ?? []) as Record<string, unknown>[]
            const data = rows.map((row) => injectCompanyIdIntoRow(row, companyId, model))
            return query({ ...args, data })
          }

          return query({ ...args, where: { ...typedArgs.where, companyId } })
        },
      },
    },
  })
}

/**
 * Busca um usuário já filtrado pela empresa informada — usado nas rotas que recebem um
 * :id de usuário-alvo pela URL, pra tratar um id de outra empresa como inexistente (404).
 */
export function findUserInCompany(companyId: string, userId: string) {
  return scopedPrisma(companyId).user.findUnique({ where: { id: userId } })
}
