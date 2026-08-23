-- AlterTable
ALTER TABLE "Squad" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';

-- CreateIndex
CREATE INDEX "Squad_sectorId_idx" ON "Squad"("sectorId");

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
