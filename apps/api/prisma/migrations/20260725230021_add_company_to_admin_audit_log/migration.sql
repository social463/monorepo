-- AlterTable
ALTER TABLE "AdminAuditLog" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "AdminAuditLog_companyId_idx" ON "AdminAuditLog"("companyId");

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: companyId a partir da empresa real do ator (actorId -> User.companyId).
UPDATE "AdminAuditLog" a SET "companyId" = u."companyId" FROM "User" u WHERE u.id = a."actorId";
