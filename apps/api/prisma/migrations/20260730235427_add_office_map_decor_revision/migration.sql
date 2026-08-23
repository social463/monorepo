-- AlterTable
ALTER TABLE "OfficeMapPublication" ADD COLUMN     "decorRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OfficeMapDecorRevision" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "mapData" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "OfficeMapDecorRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficeMapDecorRevision_publicationId_idx" ON "OfficeMapDecorRevision"("publicationId");

-- CreateIndex
CREATE INDEX "OfficeMapDecorRevision_createdById_idx" ON "OfficeMapDecorRevision"("createdById");

-- CreateIndex
CREATE INDEX "OfficeMapDecorRevision_companyId_idx" ON "OfficeMapDecorRevision"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeMapDecorRevision_publicationId_revision_key" ON "OfficeMapDecorRevision"("publicationId", "revision");

-- AddForeignKey
ALTER TABLE "OfficeMapDecorRevision" ADD CONSTRAINT "OfficeMapDecorRevision_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "OfficeMapPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeMapDecorRevision" ADD CONSTRAINT "OfficeMapDecorRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeMapDecorRevision" ADD CONSTRAINT "OfficeMapDecorRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
