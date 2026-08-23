-- AlterTable
ALTER TABLE "Company" ADD COLUMN "responsibleId" TEXT;

-- AlterTable
ALTER TABLE "Sector" ADD COLUMN "responsibleId" TEXT;

-- CreateIndex
CREATE INDEX "Company_responsibleId_idx" ON "Company"("responsibleId");

-- CreateIndex
CREATE INDEX "Sector_responsibleId_idx" ON "Sector"("responsibleId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
