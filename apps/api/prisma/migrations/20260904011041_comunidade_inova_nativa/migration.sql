-- CreateEnum
CREATE TYPE "InovaProjectPhase" AS ENUM ('IDEA', 'EXPLORING_SOLUTION', 'TESTING_SOLUTION', 'ROUTINE_USE', 'EXPANDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InovaDiaryEntryType" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "InovaTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "InovaProject" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "problemDescription" TEXT,
    "results" TEXT,
    "hoursSaved" DOUBLE PRECISION,
    "costReduction" DOUBLE PRECISION,
    "otherMetrics" TEXT,
    "projectCosts" TEXT,
    "toolsUsed" TEXT,
    "deadline" DATE,
    "priority" TEXT,
    "leadershipChallenge" TEXT,
    "sectorRepresentative" TEXT,
    "responsible1" TEXT,
    "responsible2" TEXT,
    "phase" "InovaProjectPhase" NOT NULL DEFAULT 'IDEA',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "InovaProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InovaPhaseHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase" "InovaProjectPhase" NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "InovaPhaseHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InovaDiaryEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "learnings" TEXT,
    "tools" TEXT,
    "entryType" "InovaDiaryEntryType" NOT NULL DEFAULT 'MANUAL',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageUrls" TEXT[],
    "videoLinks" TEXT[],
    "externalLinks" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "InovaDiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InovaProjectTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "responsible" TEXT,
    "dueDate" DATE,
    "status" "InovaTaskStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "InovaProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InovaActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "InovaActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InovaProject_companyId_idx" ON "InovaProject"("companyId");

-- CreateIndex
CREATE INDEX "InovaProject_phase_idx" ON "InovaProject"("phase");

-- CreateIndex
CREATE INDEX "InovaPhaseHistory_projectId_idx" ON "InovaPhaseHistory"("projectId");

-- CreateIndex
CREATE INDEX "InovaPhaseHistory_companyId_idx" ON "InovaPhaseHistory"("companyId");

-- CreateIndex
CREATE INDEX "InovaDiaryEntry_projectId_idx" ON "InovaDiaryEntry"("projectId");

-- CreateIndex
CREATE INDEX "InovaDiaryEntry_companyId_idx" ON "InovaDiaryEntry"("companyId");

-- CreateIndex
CREATE INDEX "InovaProjectTask_projectId_idx" ON "InovaProjectTask"("projectId");

-- CreateIndex
CREATE INDEX "InovaProjectTask_companyId_idx" ON "InovaProjectTask"("companyId");

-- CreateIndex
CREATE INDEX "InovaActivity_projectId_idx" ON "InovaActivity"("projectId");

-- CreateIndex
CREATE INDEX "InovaActivity_companyId_idx" ON "InovaActivity"("companyId");

-- AddForeignKey
ALTER TABLE "InovaProject" ADD CONSTRAINT "InovaProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaProject" ADD CONSTRAINT "InovaProject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaPhaseHistory" ADD CONSTRAINT "InovaPhaseHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "InovaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaPhaseHistory" ADD CONSTRAINT "InovaPhaseHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaDiaryEntry" ADD CONSTRAINT "InovaDiaryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "InovaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaDiaryEntry" ADD CONSTRAINT "InovaDiaryEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaDiaryEntry" ADD CONSTRAINT "InovaDiaryEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaProjectTask" ADD CONSTRAINT "InovaProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "InovaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaProjectTask" ADD CONSTRAINT "InovaProjectTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaActivity" ADD CONSTRAINT "InovaActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "InovaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaActivity" ADD CONSTRAINT "InovaActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaActivity" ADD CONSTRAINT "InovaActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
