-- CreateTable
CREATE TABLE "CompanyResponsible" (
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CompanyResponsible_pkey" PRIMARY KEY ("companyId","userId")
);

-- Preserva o responsável único configurado antes desta migration.
INSERT INTO "CompanyResponsible" ("companyId", "userId")
SELECT "id", "responsibleId"
FROM "Company"
WHERE "responsibleId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Company" DROP CONSTRAINT "Company_responsibleId_fkey";

-- DropIndex
DROP INDEX "Company_responsibleId_idx";

-- AlterTable
ALTER TABLE "Company" DROP COLUMN "responsibleId";

-- CreateIndex
CREATE INDEX "CompanyResponsible_userId_idx" ON "CompanyResponsible"("userId");

-- AddForeignKey
ALTER TABLE "CompanyResponsible" ADD CONSTRAINT "CompanyResponsible_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyResponsible" ADD CONSTRAINT "CompanyResponsible_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
