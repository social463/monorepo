-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'MEETING_INVITED';
ALTER TYPE "NotificationType" ADD VALUE 'MEETING_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'MEETING_CANCELED';
ALTER TYPE "NotificationType" ADD VALUE 'MEETING_REMINDER';

-- CreateTable
CREATE TABLE "OfficeMeeting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "roomExternalKey" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agenda" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "organizerId" TEXT NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeMeetingParticipant" (
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeMeetingParticipant_pkey" PRIMARY KEY ("meetingId","userId")
);

-- CreateIndex
CREATE INDEX "OfficeMeeting_companyId_roomExternalKey_startsAt_idx" ON "OfficeMeeting"("companyId", "roomExternalKey", "startsAt");

-- CreateIndex
CREATE INDEX "OfficeMeeting_organizerId_idx" ON "OfficeMeeting"("organizerId");

-- CreateIndex
CREATE INDEX "OfficeMeeting_startsAt_idx" ON "OfficeMeeting"("startsAt");

-- CreateIndex
CREATE INDEX "OfficeMeetingParticipant_userId_idx" ON "OfficeMeetingParticipant"("userId");

-- AddForeignKey
ALTER TABLE "OfficeMeeting" ADD CONSTRAINT "OfficeMeeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeMeeting" ADD CONSTRAINT "OfficeMeeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeMeetingParticipant" ADD CONSTRAINT "OfficeMeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "OfficeMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeMeetingParticipant" ADD CONSTRAINT "OfficeMeetingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
