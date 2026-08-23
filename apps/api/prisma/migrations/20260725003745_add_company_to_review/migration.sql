-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "ReviewComment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "ReviewCommentMention" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "ReviewCommentReaction" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "ReviewMention" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "ReviewReaction" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "ReviewShare" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "Review_companyId_idx" ON "Review"("companyId");

-- CreateIndex
CREATE INDEX "ReviewComment_companyId_idx" ON "ReviewComment"("companyId");

-- CreateIndex
CREATE INDEX "ReviewCommentMention_companyId_idx" ON "ReviewCommentMention"("companyId");

-- CreateIndex
CREATE INDEX "ReviewCommentReaction_companyId_idx" ON "ReviewCommentReaction"("companyId");

-- CreateIndex
CREATE INDEX "ReviewMention_companyId_idx" ON "ReviewMention"("companyId");

-- CreateIndex
CREATE INDEX "ReviewReaction_companyId_idx" ON "ReviewReaction"("companyId");

-- CreateIndex
CREATE INDEX "ReviewShare_companyId_idx" ON "ReviewShare"("companyId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReaction" ADD CONSTRAINT "ReviewReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCommentReaction" ADD CONSTRAINT "ReviewCommentReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewShare" ADD CONSTRAINT "ReviewShare_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMention" ADD CONSTRAINT "ReviewMention_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCommentMention" ADD CONSTRAINT "ReviewCommentMention_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
