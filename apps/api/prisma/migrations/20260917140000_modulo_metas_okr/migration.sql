-- Metas e OKRs — ciclos, objetivos, key results, papéis, check-ins e KRs calculados.
-- Spec: docs/superpowers/specs/2026-09-17-modulo-metas-okr-design.md
--
-- Seis tabelas novas, nenhuma alteração em tabela existente. Pessoa é `User`:
-- não há tabela de pessoa paralela. O valor atual de um KR NÃO é coluna — é
-- derivado de `OkrCheckIn`, que é a série histórica.
--
-- Os índices únicos em (companyId, externalSource, externalId) sustentam a
-- idempotência do importador da ImpulseUp. NULL é distinto no Postgres, então
-- linha sem origem externa nunca colide — o mesmo efeito do índice parcial.

-- CreateEnum
CREATE TYPE "OkrCycleStatus" AS ENUM ('OPEN', 'CLOSED', 'DRAFT');

-- CreateEnum
CREATE TYPE "OkrScope" AS ENUM ('ORGANIZATION', 'TEAM', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "OkrStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OkrVisibility" AS ENUM ('EVERYONE', 'ASSIGNEES', 'PRIVATE');

-- CreateEnum
CREATE TYPE "OkrAggregation" AS ENUM ('KR_ONLY', 'WEIGHTED_KRS', 'CHILDREN', 'MANUAL');

-- CreateEnum
CREATE TYPE "OkrConfidenceLevel" AS ENUM ('ON_TRACK', 'ATTENTION_REQUIRED', 'AT_RISK', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OkrMetricType" AS ENUM ('PERCENTAGE', 'NUMBER', 'CURRENCY');

-- CreateEnum
CREATE TYPE "OkrDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

-- CreateEnum
CREATE TYPE "OkrSubjectType" AS ENUM ('OBJECTIVE', 'KEY_RESULT');

-- CreateEnum
CREATE TYPE "OkrRole" AS ENUM ('OWNER', 'CREATOR', 'ASSIGNED_TO');

-- CreateEnum
CREATE TYPE "OkrCheckInSource" AS ENUM ('MANUAL', 'AUTOMATION', 'IMPULSEUP_IMPORT');

-- CreateEnum
CREATE TYPE "OkrDependencyStrategy" AS ENUM ('AVERAGE', 'SUM', 'WEIGHTED_AVERAGE');

-- CreateEnum
CREATE TYPE "OkrDependencyCalcType" AS ENUM ('PROGRESS', 'VALUE');

-- CreateTable
CREATE TABLE "OkrCycle" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "OkrCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" DATE NOT NULL,
    "finishDate" DATE NOT NULL,
    "forceCommentOnCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "updateWindowStart" DATE,
    "updateWindowFinish" DATE,
    "progressRanges" JSONB NOT NULL DEFAULT '[]',
    "decimals" JSONB NOT NULL DEFAULT '{}',
    "externalSource" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OkrCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkrObjective" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "cycleId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "OkrScope" NOT NULL,
    "status" "OkrStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibility" "OkrVisibility" NOT NULL DEFAULT 'EVERYONE',
    "finishDate" DATE,
    "weight" DOUBLE PRECISION,
    "aggregation" "OkrAggregation" NOT NULL DEFAULT 'KR_ONLY',
    "manualProgress" DOUBLE PRECISION,
    "confidenceLevel" "OkrConfidenceLevel",
    "path" TEXT[],
    "deletedAt" TIMESTAMP(3),
    "externalSource" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OkrObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkrKeyResult" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "objectiveId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metricType" "OkrMetricType" NOT NULL,
    "unit" TEXT,
    "baseline" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION NOT NULL,
    "direction" "OkrDirection" NOT NULL DEFAULT 'HIGHER_IS_BETTER',
    "weight" DOUBLE PRECISION,
    "status" "OkrStatus" NOT NULL DEFAULT 'ACTIVE',
    "finishDate" DATE,
    "externalSource" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OkrKeyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkrAssignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "subjectType" "OkrSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "OkrRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OkrAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkrCheckIn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "keyResultId" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "comment" TEXT,
    "authorId" TEXT,
    "effectiveAt" DATE NOT NULL,
    "source" "OkrCheckInSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "externalSource" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OkrCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkrKrDependency" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "keyResultId" TEXT NOT NULL,
    "dependsOnKrId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "strategy" "OkrDependencyStrategy" NOT NULL DEFAULT 'AVERAGE',
    "calcType" "OkrDependencyCalcType" NOT NULL DEFAULT 'PROGRESS',

    CONSTRAINT "OkrKrDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OkrCycle_companyId_status_idx" ON "OkrCycle"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OkrCycle_companyId_externalSource_externalId_key" ON "OkrCycle"("companyId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX "OkrObjective_cycleId_scope_idx" ON "OkrObjective"("cycleId", "scope");

-- CreateIndex
CREATE INDEX "OkrObjective_parentId_idx" ON "OkrObjective"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "OkrObjective_companyId_externalSource_externalId_key" ON "OkrObjective"("companyId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX "OkrKeyResult_objectiveId_idx" ON "OkrKeyResult"("objectiveId");

-- CreateIndex
CREATE UNIQUE INDEX "OkrKeyResult_companyId_externalSource_externalId_key" ON "OkrKeyResult"("companyId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX "OkrAssignment_personId_role_idx" ON "OkrAssignment"("personId", "role");

-- CreateIndex
CREATE INDEX "OkrAssignment_subjectType_subjectId_idx" ON "OkrAssignment"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "OkrAssignment_subjectType_subjectId_personId_role_key" ON "OkrAssignment"("subjectType", "subjectId", "personId", "role");

-- CreateIndex
CREATE INDEX "OkrCheckIn_keyResultId_effectiveAt_idx" ON "OkrCheckIn"("keyResultId", "effectiveAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "OkrCheckIn_companyId_externalSource_externalId_key" ON "OkrCheckIn"("companyId", "externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "OkrKrDependency_keyResultId_dependsOnKrId_key" ON "OkrKrDependency"("keyResultId", "dependsOnKrId");

-- AddForeignKey
ALTER TABLE "OkrCycle" ADD CONSTRAINT "OkrCycle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrObjective" ADD CONSTRAINT "OkrObjective_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrObjective" ADD CONSTRAINT "OkrObjective_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OkrCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrObjective" ADD CONSTRAINT "OkrObjective_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OkrObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrKeyResult" ADD CONSTRAINT "OkrKeyResult_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrKeyResult" ADD CONSTRAINT "OkrKeyResult_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "OkrObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrAssignment" ADD CONSTRAINT "OkrAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrAssignment" ADD CONSTRAINT "OkrAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrCheckIn" ADD CONSTRAINT "OkrCheckIn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrCheckIn" ADD CONSTRAINT "OkrCheckIn_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "OkrKeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrCheckIn" ADD CONSTRAINT "OkrCheckIn_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrCheckIn" ADD CONSTRAINT "OkrCheckIn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrKrDependency" ADD CONSTRAINT "OkrKrDependency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrKrDependency" ADD CONSTRAINT "OkrKrDependency_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "OkrKeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkrKrDependency" ADD CONSTRAINT "OkrKrDependency_dependsOnKrId_fkey" FOREIGN KEY ("dependsOnKrId") REFERENCES "OkrKeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

