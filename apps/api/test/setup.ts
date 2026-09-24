import { afterAll, beforeEach } from 'vitest'
import { DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID, INTERNAL_COMPANY_ID } from '@legends/shared'
import { prisma } from '../src/lib/prisma'

beforeEach(async () => {
  await prisma.$transaction([
    prisma.assistantFeedback.deleteMany(),
    prisma.assistantQuery.deleteMany(),
    prisma.knowledgeEntry.deleteMany(),
    prisma.hrDashboard.deleteMany(),
    prisma.agentMessage.deleteMany(),
    prisma.agentConversation.deleteMany(),
    prisma.benchmarkPractice.deleteMany(),
    prisma.glassReview.deleteMany(),
    prisma.campaignPost.deleteMany(),
    prisma.campaign.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.thirdPartyInvite.deleteMany(),
    prisma.characterFavorite.deleteMany(),
    prisma.officeRoomAccessGrant.deleteMany(),
    prisma.officeRoom.deleteMany(),
    prisma.officeMapPublicationAsset.deleteMany(),
    prisma.officeSetting.deleteMany(),
    prisma.officeMapEditLock.deleteMany(),
    prisma.officeMapDraft.deleteMany(),
    prisma.officeMapPublication.deleteMany(),
    prisma.officeMapAsset.deleteMany(),
    prisma.officeMap.deleteMany(),
    prisma.userBadge.deleteMany(),
    prisma.coinTransaction.deleteMany(),
    prisma.coinRule.deleteMany(),
    prisma.xpTransaction.deleteMany(),
    prisma.xpRule.deleteMany(),
    prisma.vote.deleteMany(),
    prisma.developmentThursdayEvent.deleteMany(),
    prisma.appSetting.deleteMany(),
    prisma.culturePage.deleteMany(),
    prisma.cultureManual.deleteMany(),
    prisma.cultureBenefit.deleteMany(),
    prisma.cultureVisualAsset.deleteMany(),
    prisma.culturePersonalAsset.deleteMany(),
    prisma.reviewCommentReaction.deleteMany(),
    prisma.reviewReaction.deleteMany(),
    prisma.reviewShare.deleteMany(),
    prisma.reviewPollVote.deleteMany(),
    prisma.reviewPollOption.deleteMany(),
    prisma.reviewPoll.deleteMany(),
    prisma.reviewCommentMention.deleteMany(),
    prisma.reviewMention.deleteMany(),
    prisma.reviewComment.deleteMany(),
    prisma.review.deleteMany(),
    prisma.corporatePostCommentReaction.deleteMany(),
    prisma.corporatePostReaction.deleteMany(),
    prisma.corporatePostCommentMention.deleteMany(),
    prisma.corporatePostMention.deleteMany(),
    prisma.corporatePostComment.deleteMany(),
    prisma.corporatePost.deleteMany(),
    // Depois do post: a FK é SetNull, mas apagar o catálogo primeiro deixaria
    // o teste seguinte com posts sem categoria por motivo errado.
    prisma.corporatePostTag.deleteMany(),
    prisma.calendarEventGuest.deleteMany(),
    prisma.monthlyHighlight.deleteMany(),
    prisma.feedbackReaction.deleteMany(),
    prisma.feedbackComment.deleteMany(),
    prisma.feedbackRecipient.deleteMany(),
    prisma.feedbackRecognitionCategory.deleteMany(),
    prisma.feedback.deleteMany(),
    // Depois dos feedbacks E dos votos: as duas tabelas de junção apontam para
    // cá desde que o catálogo virou um só.
    prisma.recognitionCategory.deleteMany(),
    prisma.badgeClaim.deleteMany(),
    prisma.badgeSector.deleteMany(),
    prisma.badge.deleteMany(),
    // Depois do selo: é `Badge.badgeCategoryId` que aponta para cá. Os cinco
    // temas semeados pela migration saem junto de propósito — são dado de
    // empresa, como as categorias de reconhecimento, e não infraestrutura
    // como o setor e as duas empresas preservados no fim desta lista.
    prisma.badgeCategory.deleteMany(),
    prisma.votingPeriod.deleteMany(),
    prisma.retroReaction.deleteMany(),
    prisma.retroVote.deleteMany(),
    prisma.retroCard.deleteMany(),
    prisma.retroParticipant.deleteMany(),
    prisma.retroRoomSquad.deleteMany(),
    prisma.retroRoom.deleteMany(),
    prisma.squadMember.deleteMany(),
    prisma.squad.deleteMany(),
    // Metas e OKRs: filhos antes dos pais, e o ciclo antes da empresa (FK RESTRICT).
    prisma.okrKrDependency.deleteMany(),
    prisma.okrCheckIn.deleteMany(),
    prisma.okrAssignment.deleteMany(),
    prisma.okrKeyResult.deleteMany(),
    prisma.okrObjective.deleteMany(),
    prisma.okrCycle.deleteMany(),
    prisma.pdiActionHistory.deleteMany(),
    prisma.pdiActionEvidence.deleteMany(),
    prisma.pdiAction.deleteMany(),
    prisma.pdiPlan.deleteMany(),
    // Quiz, fila e modelos de certificado: filhos antes dos pais. A maioria cairia
    // por cascade do `course.deleteMany()`, mas `CertificateTemplate` é referenciado
    // com ON DELETE SET NULL e sobreviveria entre testes.
    prisma.quizAttempt.deleteMany(),
    prisma.courseQuestion.deleteMany(),
    prisma.courseQuiz.deleteMany(),
    prisma.certificateRequest.deleteMany(),
    prisma.certificate.deleteMany(),
    prisma.learningTrackCourse.deleteMany(),
    prisma.learningTrack.deleteMany(),
    prisma.courseRating.deleteMany(),
    prisma.courseFavorite.deleteMany(),
    prisma.lessonProgress.deleteMany(),
    prisma.courseEnrollment.deleteMany(),
    prisma.courseLesson.deleteMany(),
    prisma.courseModule.deleteMany(),
    prisma.courseAudienceSector.deleteMany(),
    prisma.course.deleteMany(),
    // Catálogo do curso (Documento 4, 9.6 e 9.7). Depois do curso: as ligações
    // caem por cascade dele, e `Course.categoryId` é quem aponta para cá.
    prisma.courseCategory.deleteMany(),
    prisma.competency.deleteMany(),
    prisma.instructor.deleteMany(),
    // Depois do curso: é o `Course.certificateTemplateId` que aponta para cá.
    prisma.certificateTemplate.deleteMany(),
    // Antes do bloco do adminAuditLog de propósito — ver o comentário abaixo.
    prisma.storeOrder.deleteMany(),
    prisma.storeProduct.deleteMany(),
    // `adminAuditLog` fica colado no `user.deleteMany()` de propósito: a gravação
    // de auditoria é best-effort e pode aterrissar depois, de outra conexão —
    // qualquer statement no meio alarga a janela e quebra a FK do actorId.
    prisma.adminAuditLog.deleteMany(),
    prisma.calendarConnection.deleteMany(),
    prisma.vacation.deleteMany(),
    prisma.vacationPlanPeriod.deleteMany(),
    prisma.vacationRequest.deleteMany(),
    prisma.vacationPlan.deleteMany(),
    prisma.vacationEntitlement.deleteMany(),
    prisma.vacationCampaign.deleteMany(),
    prisma.accessLog.deleteMany(),
    prisma.analyticsEvent.deleteMany(),
    prisma.eventPhotoComment.deleteMany(),
    prisma.eventPhotoReaction.deleteMany(),
    prisma.eventPhoto.deleteMany(),
    prisma.eventAlbum.deleteMany(),
    prisma.challengeSubmission.deleteMany(),
    prisma.challenge.deleteMany(),
    // Evento antes do tipo (FK typeId) e antes do user (FK createdById); setores
    // e reivindicações de lembrete saem por cascade do próprio evento.
    prisma.calendarEvent.deleteMany(),
    prisma.calendarEventType.deleteMany(),
    // 1:1: ação → nota → tópico → encontro → série, filhos antes dos pais (a
    // maioria cairia por cascade da série, mas aqui é explícito como o resto do
    // arquivo). Tópico e ação também referenciam User (createdById/ownerId), por
    // isso têm que sair antes do user.deleteMany() logo abaixo.
    prisma.oneOnOneAction.deleteMany(),
    prisma.oneOnOnePrivateNote.deleteMany(),
    prisma.oneOnOneTopic.deleteMany(),
    prisma.oneOnOneMeeting.deleteMany(),
    prisma.oneOnOneSeries.deleteMany(),
    prisma.oneOnOneTopicTemplate.deleteMany(),
    // INOVA: filhos antes do projeto (a maioria cairia por cascade do
    // `inovaProject.deleteMany()`, exceto `InovaActivity`, que também aponta
    // pra User via `actorId`), e o projeto antes do user.deleteMany() por
    // causa de `InovaProject.createdById` / `InovaDiaryEntry.createdById`.
    prisma.inovaPhaseHistory.deleteMany(),
    prisma.inovaDiaryEntry.deleteMany(),
    prisma.inovaProjectTask.deleteMany(),
    prisma.inovaActivity.deleteMany(),
    prisma.inovaProject.deleteMany(),
    // Biblioteca de vídeos do Guia: aponta pra User via `createdById`, igual
    // `InovaProject`/`InovaDiaryEntry` — mesma razão de vir antes do user.deleteMany().
    prisma.inovaGuiaVideo.deleteMany(),
    // Eu Aprendiz: filhos antes dos pais. Quase tudo cairia por cascade do
    // encontro, mas submissão, presença, matrícula, convocação, recibo e
    // assinatura também apontam pra User — por isso vêm antes do
    // user.deleteMany() logo abaixo.
    prisma.apprenticeTaskItem.deleteMany(),
    prisma.apprenticeTask.deleteMany(),
    prisma.apprenticeSectorMove.deleteMany(),
    prisma.apprenticeJourney.deleteMany(),
    prisma.apprenticeContractSignature.deleteMany(),
    prisma.apprenticeContract.deleteMany(),
    prisma.apprenticeSurveyReceipt.deleteMany(),
    prisma.apprenticeSurveyResponse.deleteMany(),
    prisma.apprenticeMakeupAttendee.deleteMany(),
    prisma.apprenticeMakeup.deleteMany(),
    prisma.apprenticeAttendance.deleteMany(),
    prisma.apprenticeSubmission.deleteMany(),
    prisma.apprenticeActivity.deleteMany(),
    prisma.apprenticeMeetingMaterial.deleteMany(),
    prisma.apprenticeMeeting.deleteMany(),
    prisma.apprenticeEnrollment.deleteMany(),
    prisma.apprenticeClass.deleteMany(),
    prisma.user.deleteMany(),
    // Preserva o setor default semeado pela migration (sector-dev-produto); remove só os criados em teste.
    prisma.sector.deleteMany({ where: { id: { not: DEFAULT_SECTOR_ID } } }),
    // Preserva as duas empresas semeadas pela migration; remove só as criadas em teste.
    prisma.company.deleteMany({ where: { id: { notIn: [DEFAULT_COMPANY_ID, INTERNAL_COMPANY_ID] } } }),
  ])
})

afterAll(async () => {
  await prisma.$disconnect()
})
