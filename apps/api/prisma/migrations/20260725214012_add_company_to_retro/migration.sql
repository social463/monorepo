-- AlterTable
ALTER TABLE "RetroCard" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "RetroEdit" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "RetroParticipant" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "RetroReaction" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "RetroRoom" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "RetroRoomSquad" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "RetroVote" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "RetroCard_companyId_idx" ON "RetroCard"("companyId");

-- CreateIndex
CREATE INDEX "RetroEdit_companyId_idx" ON "RetroEdit"("companyId");

-- CreateIndex
CREATE INDEX "RetroParticipant_companyId_idx" ON "RetroParticipant"("companyId");

-- CreateIndex
CREATE INDEX "RetroReaction_companyId_idx" ON "RetroReaction"("companyId");

-- CreateIndex
CREATE INDEX "RetroRoom_companyId_idx" ON "RetroRoom"("companyId");

-- CreateIndex
CREATE INDEX "RetroRoomSquad_companyId_idx" ON "RetroRoomSquad"("companyId");

-- CreateIndex
CREATE INDEX "RetroVote_companyId_idx" ON "RetroVote"("companyId");

-- AddForeignKey
ALTER TABLE "RetroRoom" ADD CONSTRAINT "RetroRoom_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroRoomSquad" ADD CONSTRAINT "RetroRoomSquad_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroParticipant" ADD CONSTRAINT "RetroParticipant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroCard" ADD CONSTRAINT "RetroCard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroVote" ADD CONSTRAINT "RetroVote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroReaction" ADD CONSTRAINT "RetroReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroEdit" ADD CONSTRAINT "RetroEdit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
