-- Documento 4, seção 12: comunicado com dia e hora marcados. Fica SCHEDULED
-- fora do feed até o scheduler virar para PUBLISHED — que é também quem
-- dispara a notificação.

-- AlterEnum
ALTER TYPE "CorporatePostStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "CorporatePost" ADD COLUMN "publishAt" TIMESTAMP(3);
