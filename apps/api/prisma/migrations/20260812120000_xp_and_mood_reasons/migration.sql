-- CreateEnum
CREATE TYPE "XpEvent" AS ENUM ('VOTE_CAST', 'FEEDBACK_PUBLISHED', 'FEEDBACK_REACTION', 'MOOD_ANSWERED', 'CHALLENGE_APPROVED');

-- CreateEnum
CREATE TYPE "XpCapWindow" AS ENUM ('NONE', 'DAY', 'WEEK', 'MONTH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MoodReason" ADD VALUE 'COMMUNICATION';
ALTER TYPE "MoodReason" ADD VALUE 'TOOLS';

-- CreateTable
CREATE TABLE "XpRule" (
    "id" TEXT NOT NULL,
    "event" "XpEvent" NOT NULL,
    "amount" INTEGER NOT NULL,
    "capWindow" "XpCapWindow" NOT NULL DEFAULT 'NONE',
    "capAmount" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" "XpEvent" NOT NULL,
    "ruleId" TEXT,
    "amount" INTEGER NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "XpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XpRule_companyId_idx" ON "XpRule"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "XpRule_companyId_event_key" ON "XpRule"("companyId", "event");

-- CreateIndex
CREATE INDEX "XpTransaction_userId_createdAt_idx" ON "XpTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "XpTransaction_userId_ruleId_day_idx" ON "XpTransaction"("userId", "ruleId", "day");

-- CreateIndex
CREATE INDEX "XpTransaction_companyId_idx" ON "XpTransaction"("companyId");

-- CreateIndex
CREATE INDEX "XpTransaction_ruleId_idx" ON "XpTransaction"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "XpTransaction_userId_dedupeKey_key" ON "XpTransaction"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "XpRule" ADD CONSTRAINT "XpRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "XpRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
