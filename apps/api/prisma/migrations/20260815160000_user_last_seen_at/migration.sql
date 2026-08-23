-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_companyId_lastSeenAt_idx" ON "User"("companyId", "lastSeenAt");
