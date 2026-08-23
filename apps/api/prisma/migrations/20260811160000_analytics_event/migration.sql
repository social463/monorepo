-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "sectorId" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "source" TEXT NOT NULL DEFAULT 'api',
    "props" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_companyId_occurredAt_idx" ON "AnalyticsEvent"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_companyId_name_occurredAt_idx" ON "AnalyticsEvent"("companyId", "name", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_companyId_sectorId_occurredAt_idx" ON "AnalyticsEvent"("companyId", "sectorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_occurredAt_idx" ON "AnalyticsEvent"("name", "occurredAt");

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

