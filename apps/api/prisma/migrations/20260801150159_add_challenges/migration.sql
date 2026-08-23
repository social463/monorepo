-- CreateEnum
CREATE TYPE "ChallengeSubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "CoinEvent" ADD VALUE 'CHALLENGE_APPROVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CHALLENGE_SUBMISSION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'CHALLENGE_SUBMISSION_REJECTED';

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rewardCoins" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sectorId" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeSubmission" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ChallengeSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "evidenceKey" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "ChallengeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Challenge_companyId_active_idx" ON "Challenge"("companyId", "active");

-- CreateIndex
CREATE INDEX "Challenge_companyId_sectorId_idx" ON "Challenge"("companyId", "sectorId");

-- CreateIndex
CREATE INDEX "ChallengeSubmission_companyId_status_submittedAt_idx" ON "ChallengeSubmission"("companyId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "ChallengeSubmission_challengeId_idx" ON "ChallengeSubmission"("challengeId");

-- CreateIndex
CREATE INDEX "ChallengeSubmission_userId_idx" ON "ChallengeSubmission"("userId");

-- CreateIndex
-- Índice PARCIAL: uma submissão ativa (pendente ou aprovada) por pessoa/desafio.
-- Rejeitadas ficam de fora, então a pessoa pode tentar de novo e o histórico do
-- motivo permanece.
--
-- Vive só aqui, de propósito: o Prisma 5 não representa índice único parcial no
-- data model (prisma/prisma#3388). Declarar um @@unique equivalente no schema faz
-- todo `migrate dev` futuro propor recriá-lo SEM o WHERE e SEM dropar este antes —
-- uma migration que falha ao aplicar, por nome duplicado. Sem a declaração, o
-- `migrate diff` volta vazio e o Postgres segue aplicando a regra: violação chega
-- ao service como P2002.
CREATE UNIQUE INDEX "ChallengeSubmission_challengeId_userId_key" ON "ChallengeSubmission"("challengeId", "userId") WHERE status <> 'REJECTED';

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeSubmission" ADD CONSTRAINT "ChallengeSubmission_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeSubmission" ADD CONSTRAINT "ChallengeSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeSubmission" ADD CONSTRAINT "ChallengeSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeSubmission" ADD CONSTRAINT "ChallengeSubmission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
