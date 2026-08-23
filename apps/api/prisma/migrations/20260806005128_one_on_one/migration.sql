-- CreateEnum
CREATE TYPE "OneOnOneRecurrence" AS ENUM ('NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "OneOnOneMeetingStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "OneOnOneActionStatus" AS ENUM ('OPEN', 'DONE', 'PROMOTED');

-- CreateEnum
CREATE TYPE "OneOnOneTopicOrigin" AS ENUM ('TEMPLATE', 'CUSTOM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ONE_ON_ONE_INVITED';
ALTER TYPE "NotificationType" ADD VALUE 'ONE_ON_ONE_ACTION_ASSIGNED';

-- CreateTable
CREATE TABLE "OneOnOneSeries" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "recurrence" "OneOnOneRecurrence" NOT NULL DEFAULT 'NONE',
    "recurrenceUntil" TIMESTAMP(3),
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "endedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OneOnOneSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneOnOneMeeting" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "OneOnOneMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OneOnOneMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneOnOneTopic" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "origin" "OneOnOneTopicOrigin" NOT NULL DEFAULT 'CUSTOM',
    "discussed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneOnOneTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneOnOnePrivateNote" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OneOnOnePrivateNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneOnOneAction" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "createdInMeetingId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "OneOnOneActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "promotedPdiActionId" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OneOnOneAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneOnOneTopicTemplate" (
    "id" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OneOnOneTopicTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OneOnOneSeries_companyId_userAId_userBId_idx" ON "OneOnOneSeries"("companyId", "userAId", "userBId");

-- CreateIndex
CREATE INDEX "OneOnOneSeries_companyId_userBId_idx" ON "OneOnOneSeries"("companyId", "userBId");

-- CreateIndex
CREATE INDEX "OneOnOneMeeting_seriesId_startsAt_idx" ON "OneOnOneMeeting"("seriesId", "startsAt");

-- CreateIndex
CREATE INDEX "OneOnOneMeeting_companyId_startsAt_idx" ON "OneOnOneMeeting"("companyId", "startsAt");

-- CreateIndex
CREATE INDEX "OneOnOneTopic_meetingId_sortOrder_idx" ON "OneOnOneTopic"("meetingId", "sortOrder");

-- CreateIndex
CREATE INDEX "OneOnOneTopic_companyId_idx" ON "OneOnOneTopic"("companyId");

-- CreateIndex
CREATE INDEX "OneOnOnePrivateNote_companyId_idx" ON "OneOnOnePrivateNote"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OneOnOnePrivateNote_meetingId_authorId_key" ON "OneOnOnePrivateNote"("meetingId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "OneOnOneAction_promotedPdiActionId_key" ON "OneOnOneAction"("promotedPdiActionId");

-- CreateIndex
CREATE INDEX "OneOnOneAction_seriesId_status_idx" ON "OneOnOneAction"("seriesId", "status");

-- CreateIndex
CREATE INDEX "OneOnOneAction_companyId_ownerId_status_idx" ON "OneOnOneAction"("companyId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "OneOnOneTopicTemplate_companyId_active_sortOrder_idx" ON "OneOnOneTopicTemplate"("companyId", "active", "sortOrder");

-- AddForeignKey
ALTER TABLE "OneOnOneSeries" ADD CONSTRAINT "OneOnOneSeries_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneSeries" ADD CONSTRAINT "OneOnOneSeries_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneSeries" ADD CONSTRAINT "OneOnOneSeries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneSeries" ADD CONSTRAINT "OneOnOneSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneMeeting" ADD CONSTRAINT "OneOnOneMeeting_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "OneOnOneSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneMeeting" ADD CONSTRAINT "OneOnOneMeeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneTopic" ADD CONSTRAINT "OneOnOneTopic_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "OneOnOneMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneTopic" ADD CONSTRAINT "OneOnOneTopic_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneTopic" ADD CONSTRAINT "OneOnOneTopic_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOnePrivateNote" ADD CONSTRAINT "OneOnOnePrivateNote_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "OneOnOneMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOnePrivateNote" ADD CONSTRAINT "OneOnOnePrivateNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOnePrivateNote" ADD CONSTRAINT "OneOnOnePrivateNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneAction" ADD CONSTRAINT "OneOnOneAction_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "OneOnOneSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneAction" ADD CONSTRAINT "OneOnOneAction_createdInMeetingId_fkey" FOREIGN KEY ("createdInMeetingId") REFERENCES "OneOnOneMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneAction" ADD CONSTRAINT "OneOnOneAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneAction" ADD CONSTRAINT "OneOnOneAction_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneAction" ADD CONSTRAINT "OneOnOneAction_promotedPdiActionId_fkey" FOREIGN KEY ("promotedPdiActionId") REFERENCES "PdiAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneAction" ADD CONSTRAINT "OneOnOneAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneOnOneTopicTemplate" ADD CONSTRAINT "OneOnOneTopicTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 1:1 vale para todo setor: sem isto a área nasceria invisível até alguém
-- habilitar setor a setor. Terceirizados ficam de fora (allowlist individual).
UPDATE "Sector"
SET "enabledFeatures" = "enabledFeatures" || '["um-a-um"]'::jsonb
WHERE NOT ("enabledFeatures" @> '["um-a-um"]'::jsonb);
