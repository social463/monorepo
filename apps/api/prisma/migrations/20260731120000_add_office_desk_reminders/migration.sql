-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OFFICE_DESK_REMINDER_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OFFICE_DESK_REMINDER_READ';

-- CreateTable
CREATE TABLE "OfficeDeskReminder" (
    "id" TEXT NOT NULL,
    "deskId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "OfficeDeskReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficeDeskReminder_deskId_readAt_idx" ON "OfficeDeskReminder"("deskId", "readAt");

-- CreateIndex
CREATE INDEX "OfficeDeskReminder_recipientId_readAt_idx" ON "OfficeDeskReminder"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "OfficeDeskReminder_senderId_idx" ON "OfficeDeskReminder"("senderId");

-- CreateIndex
CREATE INDEX "OfficeDeskReminder_companyId_idx" ON "OfficeDeskReminder"("companyId");

-- AddForeignKey
ALTER TABLE "OfficeDeskReminder" ADD CONSTRAINT "OfficeDeskReminder_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "OfficeDesk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDeskReminder" ADD CONSTRAINT "OfficeDeskReminder_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDeskReminder" ADD CONSTRAINT "OfficeDeskReminder_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDeskReminder" ADD CONSTRAINT "OfficeDeskReminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
