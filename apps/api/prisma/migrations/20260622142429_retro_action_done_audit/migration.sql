-- AlterTable
ALTER TABLE "RetroCard" ADD COLUMN     "actionDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "actionDoneAt" TIMESTAMP(3),
ADD COLUMN     "auditStatus" TEXT,
ADD COLUMN     "auditedAt" TIMESTAMP(3),
ADD COLUMN     "auditedById" TEXT;

-- CreateIndex
CREATE INDEX "RetroCard_actionResponsible_idx" ON "RetroCard"("actionResponsible");

-- AddForeignKey
ALTER TABLE "RetroCard" ADD CONSTRAINT "RetroCard_auditedById_fkey" FOREIGN KEY ("auditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
