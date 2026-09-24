-- Documento 4, seção 9.8 — o certificado de curso EXTERNO passa a entrar pelo
-- portal, e o formulário do Notion sai.
--
-- Uma ORIGEM, e não uma segunda entidade: mesma fila, mesma aprovação, mesmo
-- histórico. O que muda é que `enrollmentId` e `courseId` deixam de ser
-- obrigatórios (certificado de fora não tem matrícula nem curso aqui) e entram
-- os campos que o formulário pergunta.

-- CreateEnum
CREATE TYPE "CertificateRequestOrigin" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "ExternalTrainingType" AS ENUM ('COMPLIANCE', 'TECNICO', 'COMPORTAMENTAL');
CREATE TYPE "ExternalTrainingSponsor" AS ENUM ('GRATUITO', 'EMR', 'PROPRIO', 'OUTRO');
CREATE TYPE "ExternalTrainingReason" AS ENUM ('INICIATIVA_PROPRIA', 'SOLICITACAO_GESTOR', 'PDI', 'OBRIGATORIO');

-- AlterTable: a origem nasce INTERNAL, que é o que toda linha existente é.
ALTER TABLE "CertificateRequest"
  ADD COLUMN "origin" "CertificateRequestOrigin" NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN "externalCourseName" TEXT,
  ADD COLUMN "trainingType" "ExternalTrainingType",
  ADD COLUMN "sponsor" "ExternalTrainingSponsor",
  ADD COLUMN "sponsorOther" TEXT,
  ADD COLUMN "investedAmountCents" INTEGER,
  ADD COLUMN "reasons" "ExternalTrainingReason"[] DEFAULT ARRAY[]::"ExternalTrainingReason"[],
  ADD COLUMN "requestedAt" TIMESTAMP(3),
  ADD COLUMN "attachmentKey" TEXT;

-- AlterTable: matrícula e curso viram opcionais. O índice UNIQUE de
-- `enrollmentId` continua valendo — no Postgres, NULL não colide com NULL, então
-- "uma matrícula, no máximo um pedido" segue de pé e vários externos convivem.
ALTER TABLE "CertificateRequest" ALTER COLUMN "enrollmentId" DROP NOT NULL;
ALTER TABLE "CertificateRequest" ALTER COLUMN "courseId" DROP NOT NULL;

-- A FK de curso precisa aceitar o nulo com o mesmo ON DELETE de antes.
ALTER TABLE "CertificateRequest" DROP CONSTRAINT "CertificateRequest_courseId_fkey";
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CertificateRequest" DROP CONSTRAINT "CertificateRequest_enrollmentId_fkey";
ALTER TABLE "CertificateRequest" ADD CONSTRAINT "CertificateRequest_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: a fila do externo é lida por empresa + origem.
CREATE INDEX "CertificateRequest_companyId_origin_status_idx" ON "CertificateRequest"("companyId", "origin", "status");
