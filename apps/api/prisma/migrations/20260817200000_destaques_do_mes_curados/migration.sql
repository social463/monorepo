-- CreateTable
CREATE TABLE "MonthlyHighlight" (
    "id" TEXT NOT NULL,
    "monthRef" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "message" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "MonthlyHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyHighlight_companyId_monthRef_idx" ON "MonthlyHighlight"("companyId", "monthRef");

-- CreateIndex
CREATE INDEX "MonthlyHighlight_userId_idx" ON "MonthlyHighlight"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyHighlight_companyId_monthRef_userId_key" ON "MonthlyHighlight"("companyId", "monthRef", "userId");

-- AddForeignKey
ALTER TABLE "MonthlyHighlight" ADD CONSTRAINT "MonthlyHighlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyHighlight" ADD CONSTRAINT "MonthlyHighlight_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyHighlight" ADD CONSTRAINT "MonthlyHighlight_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyHighlight" ADD CONSTRAINT "MonthlyHighlight_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

