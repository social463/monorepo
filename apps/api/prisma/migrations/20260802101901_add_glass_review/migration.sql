-- CreateEnum
CREATE TYPE "GlassSentiment" AS ENUM ('POSITIVO', 'NEUTRO', 'NEGATIVO');

-- CreateTable
CREATE TABLE "GlassReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reviewDate" TIMESTAMP(3),
    "rating" DECIMAL(2,1),
    "role" TEXT,
    "level" TEXT,
    "sector" TEXT,
    "tenure" TEXT,
    "status" TEXT,
    "recommends" BOOLEAN,
    "leadershipApproval" BOOLEAN,
    "title" TEXT,
    "positives" TEXT,
    "negatives" TEXT,
    "advice" TEXT,
    "sentiment" "GlassSentiment",
    "themesPositive" TEXT[],
    "themesNegative" TEXT[],
    "alerts" TEXT[],
    "aiSummary" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlassReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlassReview_companyId_reviewDate_idx" ON "GlassReview"("companyId", "reviewDate");

-- CreateIndex
CREATE INDEX "GlassReview_companyId_sector_idx" ON "GlassReview"("companyId", "sector");

-- AddForeignKey
ALTER TABLE "GlassReview" ADD CONSTRAINT "GlassReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlassReview" ADD CONSTRAINT "GlassReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
