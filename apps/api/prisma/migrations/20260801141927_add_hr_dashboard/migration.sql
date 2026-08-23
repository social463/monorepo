-- CreateTable
CREATE TABLE "HrDashboard" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "embedUrl" TEXT NOT NULL,
    "height" INTEGER NOT NULL DEFAULT 720,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sectorId" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrDashboard_companyId_sectorId_sortOrder_idx" ON "HrDashboard"("companyId", "sectorId", "sortOrder");

-- AddForeignKey
ALTER TABLE "HrDashboard" ADD CONSTRAINT "HrDashboard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDashboard" ADD CONSTRAINT "HrDashboard_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrDashboard" ADD CONSTRAINT "HrDashboard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
