-- AlterTable
ALTER TABLE "MoodEntry" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "MoodEntry_companyId_idx" ON "MoodEntry"("companyId");

-- AddForeignKey
ALTER TABLE "MoodEntry" ADD CONSTRAINT "MoodEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
