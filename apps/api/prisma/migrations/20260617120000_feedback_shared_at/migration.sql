-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN "sharedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Feedback_sharedAt_idx" ON "Feedback"("sharedAt");
