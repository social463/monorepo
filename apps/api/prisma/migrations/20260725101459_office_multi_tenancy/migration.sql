-- AlterTable: OfficeSetting deixa de ser singleton (id Int = 1) e vira 1 linha por empresa
ALTER TABLE "OfficeSetting" ADD COLUMN "companyId" TEXT;
UPDATE "OfficeSetting" SET "companyId" = 'company-emr';
ALTER TABLE "OfficeSetting" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "OfficeSetting" DROP CONSTRAINT "OfficeSetting_pkey";
ALTER TABLE "OfficeSetting" DROP COLUMN "id";
ALTER TABLE "OfficeSetting" ADD CONSTRAINT "OfficeSetting_pkey" PRIMARY KEY ("companyId");

-- AlterTable: companyId denormalizado nos outros 10 models
ALTER TABLE "OfficeMap" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapDraft" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapAsset" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapEditLock" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapPublication" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapPublicationAsset" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeRoom" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeRoomAccessGrant" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeDesk" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeDeskClaim" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeGuestInvite" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "OfficeMap_companyId_idx" ON "OfficeMap"("companyId");
CREATE INDEX "OfficeMapDraft_companyId_idx" ON "OfficeMapDraft"("companyId");
CREATE INDEX "OfficeMapAsset_companyId_idx" ON "OfficeMapAsset"("companyId");
CREATE INDEX "OfficeMapEditLock_companyId_idx" ON "OfficeMapEditLock"("companyId");
CREATE INDEX "OfficeMapPublication_companyId_idx" ON "OfficeMapPublication"("companyId");
CREATE INDEX "OfficeMapPublicationAsset_companyId_idx" ON "OfficeMapPublicationAsset"("companyId");
CREATE INDEX "OfficeRoom_companyId_idx" ON "OfficeRoom"("companyId");
CREATE INDEX "OfficeRoomAccessGrant_companyId_idx" ON "OfficeRoomAccessGrant"("companyId");
CREATE INDEX "OfficeDesk_companyId_idx" ON "OfficeDesk"("companyId");
CREATE INDEX "OfficeDeskClaim_companyId_idx" ON "OfficeDeskClaim"("companyId");
CREATE INDEX "OfficeGuestInvite_companyId_idx" ON "OfficeGuestInvite"("companyId");

-- AddForeignKey
ALTER TABLE "OfficeSetting" ADD CONSTRAINT "OfficeSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMap" ADD CONSTRAINT "OfficeMap_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapDraft" ADD CONSTRAINT "OfficeMapDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapAsset" ADD CONSTRAINT "OfficeMapAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapEditLock" ADD CONSTRAINT "OfficeMapEditLock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapPublication" ADD CONSTRAINT "OfficeMapPublication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapPublicationAsset" ADD CONSTRAINT "OfficeMapPublicationAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeRoom" ADD CONSTRAINT "OfficeRoom_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeRoomAccessGrant" ADD CONSTRAINT "OfficeRoomAccessGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeDesk" ADD CONSTRAINT "OfficeDesk_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeDeskClaim" ADD CONSTRAINT "OfficeDeskClaim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeGuestInvite" ADD CONSTRAINT "OfficeGuestInvite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
