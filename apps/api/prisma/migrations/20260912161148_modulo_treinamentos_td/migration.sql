-- Módulo de Treinamentos (T&D).
-- Spec: docs/superpowers/specs/2026-09-12-modulo-de-treinamentos-td-design.md
--
-- Escrita À MÃO: o SQL que o `prisma migrate dev` gerou dropava e recriava as
-- três colunas de enum de `CertificateRequest` (perdendo o conteúdo de todo
-- envio de certificado externo já feito) e, claro, não fazia o backfill. Aqui
-- os enums são RENOMEADOS e as colunas convertidas com `USING`, preservando o
-- dado; no fim, os pedidos externos viram registros de treinamento.

-- ---------------------------------------------------------------------------
-- 1. O vocabulário deixa de ser "certificado externo" e passa a ser "treinamento"
-- ---------------------------------------------------------------------------

ALTER TYPE "ExternalTrainingType" RENAME TO "TrainingType";
ALTER TYPE "ExternalTrainingSponsor" RENAME TO "TrainingSponsor";

-- `TrainingReason` ganha LNT, que o formulário antigo não oferecia. Enum novo +
-- conversão com USING (em vez de `ALTER TYPE ... ADD VALUE`), porque adicionar
-- valor a um enum preexistente não pode ser usado na mesma transação da
-- migration — e o Prisma roda tudo em uma só.
CREATE TYPE "TrainingReason" AS ENUM ('INICIATIVA_PROPRIA', 'SOLICITACAO_GESTOR', 'LNT', 'PDI', 'OBRIGATORIO');

ALTER TABLE "CertificateRequest"
  ALTER COLUMN "reasons" DROP DEFAULT,
  ALTER COLUMN "reasons" TYPE "TrainingReason"[] USING "reasons"::text[]::"TrainingReason"[],
  ALTER COLUMN "reasons" SET DEFAULT ARRAY[]::"TrainingReason"[];

DROP TYPE "ExternalTrainingReason";

CREATE TYPE "TrainingValidationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE "TrainingEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "learningType" TEXT NOT NULL DEFAULT 'Evento',
    "modality" TEXT,
    "eventDate" DATE,
    "hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "institution" TEXT,
    "trainingType" "TrainingType",
    "reasons" "TrainingReason"[] DEFAULT ARRAY[]::"TrainingReason"[],
    "priority" TEXT NOT NULL DEFAULT 'Média',
    "defaultInvestmentCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Planejado',
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "userName" TEXT NOT NULL,
    "sectorName" TEXT,
    "squad" TEXT,
    "leaderName" TEXT,
    "position" TEXT,
    "positionCategory" TEXT,
    "employmentType" TEXT,
    "courseTitle" TEXT NOT NULL,
    "learningType" TEXT NOT NULL DEFAULT 'Curso',
    "modality" TEXT,
    "trainingType" "TrainingType",
    "hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "institution" TEXT,
    "sponsor" "TrainingSponsor" NOT NULL DEFAULT 'GRATUITO',
    "sponsorOther" TEXT,
    "investmentCents" INTEGER NOT NULL DEFAULT 0,
    "reasons" "TrainingReason"[] DEFAULT ARRAY[]::"TrainingReason"[],
    "priority" TEXT NOT NULL DEFAULT 'Média',
    "requestDate" DATE NOT NULL,
    "completionDate" DATE,
    "participationStatus" TEXT NOT NULL DEFAULT 'Participou',
    "source" TEXT NOT NULL DEFAULT 'Autoatendimento do colaborador',
    "notes" TEXT,
    "attachmentKey" TEXT,
    "validationStatus" "TrainingValidationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrainingEvent_companyId_eventDate_idx" ON "TrainingEvent"("companyId", "eventDate");
CREATE INDEX "TrainingRecord_companyId_completionDate_idx" ON "TrainingRecord"("companyId", "completionDate");
CREATE INDEX "TrainingRecord_companyId_validationStatus_idx" ON "TrainingRecord"("companyId", "validationStatus");
CREATE INDEX "TrainingRecord_userId_idx" ON "TrainingRecord"("userId");
CREATE INDEX "TrainingRecord_eventId_idx" ON "TrainingRecord"("eventId");

ALTER TABLE "TrainingEvent" ADD CONSTRAINT "TrainingEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingEvent" ADD CONSTRAINT "TrainingEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TrainingEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingRecord" ADD CONSTRAINT "TrainingRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Backfill: o envio de certificado externo VIRA registro de treinamento
-- ---------------------------------------------------------------------------
--
-- Mesmo `id` da solicitação, de propósito: é a mesma coisa mudando de tabela, e
-- guardar o id antigo mantém rastro para quem for conferir depois.
--
-- Três campos o formulário antigo não perguntava e por isso são aproximados,
-- sempre para o lado conservador:
--   - `hours` = 0. Inventar carga horária inflaria o indicador de horas.
--   - `learningType` = 'Curso', que é o que o formulário chamava de curso.
--   - `completionDate` = o dia do envio. Nulo tiraria todo o histórico das
--     séries por mês/ano; o envio é a melhor data disponível, porque ninguém
--     manda certificado antes de concluir.
INSERT INTO "TrainingRecord" (
  "id", "companyId", "userId", "userName", "sectorName", "squad", "leaderName",
  "position", "positionCategory", "employmentType",
  "courseTitle", "learningType", "hours", "trainingType",
  "sponsor", "sponsorOther", "investmentCents", "reasons",
  "requestDate", "completionDate", "participationStatus", "source",
  "attachmentKey", "validationStatus", "reviewedById", "reviewedAt", "rejectionReason",
  "createdById", "createdAt", "updatedAt"
)
SELECT
  cr."id",
  cr."companyId",
  cr."userId",
  u."name",
  s."name",
  u."squad",
  lider."name",
  u."position",
  u."positionCategory",
  u."employmentType"::text,
  COALESCE(NULLIF(cr."externalCourseName", ''), 'Treinamento externo'),
  'Curso',
  0,
  cr."trainingType",
  COALESCE(cr."sponsor", 'GRATUITO'),
  cr."sponsorOther",
  COALESCE(cr."investedAmountCents", 0),
  COALESCE(cr."reasons", ARRAY[]::"TrainingReason"[]),
  COALESCE(cr."requestedAt"::date, cr."createdAt"::date),
  cr."createdAt"::date,
  'Participou',
  'Autoatendimento do colaborador',
  cr."attachmentKey",
  cr."status"::text::"TrainingValidationStatus",
  cr."reviewedById",
  cr."reviewedAt",
  cr."rejectionReason",
  cr."userId",
  cr."createdAt",
  cr."updatedAt"
FROM "CertificateRequest" cr
JOIN "User" u ON u."id" = cr."userId"
LEFT JOIN "Sector" s ON s."id" = u."sectorId"
LEFT JOIN "User" lider ON lider."id" = u."managerId"
WHERE cr."origin" = 'EXTERNAL';

-- Copiadas, saem da fila de certificados: `CertificateRequest` volta a ser só a
-- emissão do certificado INTERNO, a partir de uma matrícula concluída.
DELETE FROM "CertificateRequest" WHERE "origin" = 'EXTERNAL';
