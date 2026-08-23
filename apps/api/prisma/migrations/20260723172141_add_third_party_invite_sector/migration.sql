-- AlterTable
ALTER TABLE "ThirdPartyInvite" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';

-- CreateIndex
CREATE INDEX "ThirdPartyInvite_sectorId_idx" ON "ThirdPartyInvite"("sectorId");

-- AddForeignKey
ALTER TABLE "ThirdPartyInvite" ADD CONSTRAINT "ThirdPartyInvite_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
