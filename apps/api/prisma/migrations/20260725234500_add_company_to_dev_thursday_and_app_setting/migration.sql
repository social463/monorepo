-- DropIndex
DROP INDEX "DevelopmentThursdayEvent_sprintStart_key";

-- AlterTable
ALTER TABLE "AppSetting" DROP CONSTRAINT "AppSetting_pkey",
ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr',
ADD CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key", "companyId");

-- AlterTable
ALTER TABLE "DevelopmentThursdayEvent" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "DevelopmentThursdayEvent_companyId_idx" ON "DevelopmentThursdayEvent"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentThursdayEvent_sprintStart_companyId_key" ON "DevelopmentThursdayEvent"("sprintStart", "companyId");

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentThursdayEvent" ADD CONSTRAINT "DevelopmentThursdayEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: DevelopmentThursdayEvent.companyId a partir do dono real (presenterId -> User.companyId).
UPDATE "DevelopmentThursdayEvent" e SET "companyId" = u."companyId" FROM "User" u WHERE u.id = e."presenterId";

-- AppSetting não tem um dono (é uma tabela de configuração genérica de chave/valor, sem
-- FK de autor) — não há de onde derivar um companyId real para a linha existente. O
-- DEFAULT 'company-emr' já é correto hoje (única empresa em produção); diferente de
-- DevelopmentThursdayEvent/RetroRoom/etc, aqui não existe "ownership real" pra backfillar.
