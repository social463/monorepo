-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "FeedbackReaction" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "Feedback_companyId_idx" ON "Feedback"("companyId");

-- CreateIndex
CREATE INDEX "FeedbackReaction_companyId_idx" ON "FeedbackReaction"("companyId");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReaction" ADD CONSTRAINT "FeedbackReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
