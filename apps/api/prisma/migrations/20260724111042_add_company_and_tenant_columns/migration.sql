-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- Seed: empresa padrão (todos os dados atuais migram pra cá) + empresa interna,
-- reservada para o papel SUPER_ADMIN (ver migration add_super_admin_role).
INSERT INTO "Company" ("id", "name", "slug", "active", "createdAt", "updatedAt")
VALUES
  ('company-emr', 'EMR', 'emr', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('company-legends-internal', 'Legends Internal', 'legends-internal', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "Badge" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "Sector" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "Squad" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "ThirdPartyInvite" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "Vote" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- AlterTable
ALTER TABLE "VotingPeriod" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "Badge_companyId_idx" ON "Badge"("companyId");

-- CreateIndex
CREATE INDEX "Category_companyId_idx" ON "Category"("companyId");

-- CreateIndex
CREATE INDEX "Sector_companyId_idx" ON "Sector"("companyId");

-- CreateIndex
CREATE INDEX "Squad_companyId_idx" ON "Squad"("companyId");

-- CreateIndex
CREATE INDEX "ThirdPartyInvite_companyId_idx" ON "ThirdPartyInvite"("companyId");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "Vote_companyId_idx" ON "Vote"("companyId");

-- CreateIndex
CREATE INDEX "VotingPeriod_companyId_idx" ON "VotingPeriod"("companyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThirdPartyInvite" ADD CONSTRAINT "ThirdPartyInvite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VotingPeriod" ADD CONSTRAINT "VotingPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
