-- Documento 4, seção 9.6 — o curso deixa de ser publicado/não-publicado e passa
-- a ter cinco estados.
--
-- Como nas outras migrations deste documento: a coluna nova nasce, o que existe
-- é convertido, e só então a velha cai.

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'REVIEW', 'PENDING_APPROVAL', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT';

-- Backfill: o booleano só sabia dizer duas coisas, e são estas.
UPDATE "Course" SET "status" = 'PUBLISHED' WHERE "published" = true;

-- O índice acompanha: quem filtra catálogo filtra por status agora.
DROP INDEX IF EXISTS "Course_companyId_published_idx";
ALTER TABLE "Course" DROP COLUMN "published";
CREATE INDEX "Course_companyId_status_idx" ON "Course"("companyId", "status");
