-- Eu Aprendiz — trilha do programa Jovem Aprendiz.
-- Spec: docs/superpowers/specs/2026-09-14-eu-aprendiz-design.md
--
-- Treze tabelas novas, nenhuma alteração em tabela existente: a área nasce ao
-- lado do produto. O acesso do aprendiz sai de `User.positionCategory`, que já
-- existe — não há coluna nova em `User`.

-- CreateEnum
CREATE TYPE "ApprenticeActivityKind" AS ENUM ('ACTIVITY', 'COMMITMENT', 'REVIEW');

-- CreateEnum
CREATE TYPE "ApprenticeSurveyLearned" AS ENUM ('SIM', 'EM_PARTE', 'NAO');

-- CreateTable
CREATE TABLE "ApprenticeClass" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "name" TEXT NOT NULL,
    "shift" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeEnrollment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeMeeting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT '',
    "objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliverable" TEXT NOT NULL DEFAULT '',
    "scheduledOn" DATE,
    "accessReleased" BOOLEAN NOT NULL DEFAULT false,
    "surveyOpen" BOOLEAN NOT NULL DEFAULT false,
    "slideUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeMeetingMaterial" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "meetingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeMeetingMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeActivity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "meetingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "kind" "ApprenticeActivityKind" NOT NULL DEFAULT 'ACTIVITY',
    "title" TEXT NOT NULL,
    "schema" JSONB NOT NULL DEFAULT '{"blocks":[]}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeSubmission" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3),
    "draftSavedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeAttendance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "present" BOOLEAN,
    "justification" TEXT,
    "needsMakeup" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeMakeup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "meetingId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeMakeup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeMakeupAttendee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "makeupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ApprenticeMakeupAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeSurveyResponse" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "meetingId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "takeaway" TEXT NOT NULL,
    "improvement" TEXT NOT NULL DEFAULT '',
    "learned" "ApprenticeSurveyLearned" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeSurveyReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeSurveyReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "clauses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeContractSignature" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "contractId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeContractSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprenticeClass_companyId_active_idx" ON "ApprenticeClass"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeClass_companyId_name_key" ON "ApprenticeClass"("companyId", "name");

-- CreateIndex
CREATE INDEX "ApprenticeEnrollment_classId_idx" ON "ApprenticeEnrollment"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeEnrollment_companyId_userId_key" ON "ApprenticeEnrollment"("companyId", "userId");

-- CreateIndex
CREATE INDEX "ApprenticeMeeting_companyId_scheduledOn_idx" ON "ApprenticeMeeting"("companyId", "scheduledOn");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeMeeting_companyId_order_key" ON "ApprenticeMeeting"("companyId", "order");

-- CreateIndex
CREATE INDEX "ApprenticeMeetingMaterial_companyId_meetingId_idx" ON "ApprenticeMeetingMaterial"("companyId", "meetingId");

-- CreateIndex
CREATE INDEX "ApprenticeActivity_companyId_meetingId_idx" ON "ApprenticeActivity"("companyId", "meetingId");

-- CreateIndex
CREATE INDEX "ApprenticeSubmission_companyId_userId_idx" ON "ApprenticeSubmission"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeSubmission_activityId_userId_key" ON "ApprenticeSubmission"("activityId", "userId");

-- CreateIndex
CREATE INDEX "ApprenticeAttendance_companyId_meetingId_idx" ON "ApprenticeAttendance"("companyId", "meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeAttendance_meetingId_userId_key" ON "ApprenticeAttendance"("meetingId", "userId");

-- CreateIndex
CREATE INDEX "ApprenticeMakeup_companyId_scheduledAt_idx" ON "ApprenticeMakeup"("companyId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ApprenticeMakeupAttendee_companyId_userId_idx" ON "ApprenticeMakeupAttendee"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeMakeupAttendee_makeupId_userId_key" ON "ApprenticeMakeupAttendee"("makeupId", "userId");

-- CreateIndex
CREATE INDEX "ApprenticeSurveyResponse_companyId_meetingId_idx" ON "ApprenticeSurveyResponse"("companyId", "meetingId");

-- CreateIndex
CREATE INDEX "ApprenticeSurveyReceipt_companyId_meetingId_idx" ON "ApprenticeSurveyReceipt"("companyId", "meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeSurveyReceipt_meetingId_userId_key" ON "ApprenticeSurveyReceipt"("meetingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeContract_companyId_key" ON "ApprenticeContract"("companyId");

-- CreateIndex
CREATE INDEX "ApprenticeContractSignature_companyId_userId_idx" ON "ApprenticeContractSignature"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeContractSignature_contractId_userId_key" ON "ApprenticeContractSignature"("contractId", "userId");

-- AddForeignKey
ALTER TABLE "ApprenticeClass" ADD CONSTRAINT "ApprenticeClass_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeEnrollment" ADD CONSTRAINT "ApprenticeEnrollment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeEnrollment" ADD CONSTRAINT "ApprenticeEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ApprenticeClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeEnrollment" ADD CONSTRAINT "ApprenticeEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMeeting" ADD CONSTRAINT "ApprenticeMeeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMeetingMaterial" ADD CONSTRAINT "ApprenticeMeetingMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMeetingMaterial" ADD CONSTRAINT "ApprenticeMeetingMaterial_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ApprenticeMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeActivity" ADD CONSTRAINT "ApprenticeActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeActivity" ADD CONSTRAINT "ApprenticeActivity_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ApprenticeMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSubmission" ADD CONSTRAINT "ApprenticeSubmission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSubmission" ADD CONSTRAINT "ApprenticeSubmission_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ApprenticeActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSubmission" ADD CONSTRAINT "ApprenticeSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeAttendance" ADD CONSTRAINT "ApprenticeAttendance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeAttendance" ADD CONSTRAINT "ApprenticeAttendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ApprenticeMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeAttendance" ADD CONSTRAINT "ApprenticeAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeAttendance" ADD CONSTRAINT "ApprenticeAttendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMakeup" ADD CONSTRAINT "ApprenticeMakeup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMakeup" ADD CONSTRAINT "ApprenticeMakeup_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ApprenticeMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMakeup" ADD CONSTRAINT "ApprenticeMakeup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMakeupAttendee" ADD CONSTRAINT "ApprenticeMakeupAttendee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMakeupAttendee" ADD CONSTRAINT "ApprenticeMakeupAttendee_makeupId_fkey" FOREIGN KEY ("makeupId") REFERENCES "ApprenticeMakeup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeMakeupAttendee" ADD CONSTRAINT "ApprenticeMakeupAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSurveyResponse" ADD CONSTRAINT "ApprenticeSurveyResponse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSurveyResponse" ADD CONSTRAINT "ApprenticeSurveyResponse_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ApprenticeMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSurveyReceipt" ADD CONSTRAINT "ApprenticeSurveyReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSurveyReceipt" ADD CONSTRAINT "ApprenticeSurveyReceipt_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ApprenticeMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSurveyReceipt" ADD CONSTRAINT "ApprenticeSurveyReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeContract" ADD CONSTRAINT "ApprenticeContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeContract" ADD CONSTRAINT "ApprenticeContract_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeContractSignature" ADD CONSTRAINT "ApprenticeContractSignature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeContractSignature" ADD CONSTRAINT "ApprenticeContractSignature_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ApprenticeContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeContractSignature" ADD CONSTRAINT "ApprenticeContractSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
