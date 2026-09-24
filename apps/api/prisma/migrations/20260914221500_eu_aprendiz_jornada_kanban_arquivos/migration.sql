-- Eu Aprendiz, Fase 2 — jornada, movimentações de setor, quadro de gestão do RH
-- e arquivo (S3) em material e apresentação.
-- Spec: docs/superpowers/specs/2026-09-14-eu-aprendiz-design.md
--
-- `ApprenticeMeetingMaterial.url` deixa de ser NOT NULL: o material passa a ser
-- link externo OU arquivo no S3, e exatamente um dos dois fica preenchido.

-- CreateEnum
CREATE TYPE "ApprenticeTaskColumn" AS ENUM ('AFAZER', 'ANDAMENTO', 'VALIDACAO', 'CONCLUIDO');

-- AlterTable
ALTER TABLE "ApprenticeMeeting" ADD COLUMN     "slideFileName" TEXT,
ADD COLUMN     "slideKey" TEXT;

-- AlterTable
ALTER TABLE "ApprenticeMeetingMaterial" ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "documentKey" TEXT,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ALTER COLUMN "url" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ApprenticeJourney" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "userId" TEXT NOT NULL,
    "contractEndsOn" DATE,
    "activities" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeJourney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeSectorMove" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "userId" TEXT NOT NULL,
    "fromSector" TEXT NOT NULL DEFAULT '',
    "toSector" TEXT NOT NULL,
    "movedOn" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "responsibles" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeSectorMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Outros',
    "meetingId" TEXT,
    "dueOn" DATE,
    "boardColumn" "ApprenticeTaskColumn" NOT NULL DEFAULT 'AFAZER',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprenticeTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprenticeTaskItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "taskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprenticeTaskItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprenticeJourney_userId_key" ON "ApprenticeJourney"("userId");

-- CreateIndex
CREATE INDEX "ApprenticeJourney_companyId_idx" ON "ApprenticeJourney"("companyId");

-- CreateIndex
CREATE INDEX "ApprenticeSectorMove_companyId_userId_idx" ON "ApprenticeSectorMove"("companyId", "userId");

-- CreateIndex
CREATE INDEX "ApprenticeSectorMove_companyId_movedOn_idx" ON "ApprenticeSectorMove"("companyId", "movedOn");

-- CreateIndex
CREATE INDEX "ApprenticeTask_companyId_boardColumn_idx" ON "ApprenticeTask"("companyId", "boardColumn");

-- CreateIndex
CREATE INDEX "ApprenticeTaskItem_companyId_taskId_idx" ON "ApprenticeTaskItem"("companyId", "taskId");

-- AddForeignKey
ALTER TABLE "ApprenticeJourney" ADD CONSTRAINT "ApprenticeJourney_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeJourney" ADD CONSTRAINT "ApprenticeJourney_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeJourney" ADD CONSTRAINT "ApprenticeJourney_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSectorMove" ADD CONSTRAINT "ApprenticeSectorMove_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSectorMove" ADD CONSTRAINT "ApprenticeSectorMove_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeSectorMove" ADD CONSTRAINT "ApprenticeSectorMove_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeTask" ADD CONSTRAINT "ApprenticeTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeTask" ADD CONSTRAINT "ApprenticeTask_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ApprenticeMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeTask" ADD CONSTRAINT "ApprenticeTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeTaskItem" ADD CONSTRAINT "ApprenticeTaskItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprenticeTaskItem" ADD CONSTRAINT "ApprenticeTaskItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ApprenticeTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

