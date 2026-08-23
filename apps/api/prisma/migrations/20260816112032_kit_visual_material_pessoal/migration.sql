-- CreateEnum
CREATE TYPE "CulturePersonalAssetKind" AS ENUM ('IMAGE', 'DOCUMENT');

-- CreateTable
CREATE TABLE "CulturePersonalAsset" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "kind" "CulturePersonalAssetKind" NOT NULL,
    "createdById" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CulturePersonalAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CulturePersonalAsset_companyId_recipientId_createdAt_idx" ON "CulturePersonalAsset"("companyId", "recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "CulturePersonalAsset_createdById_idx" ON "CulturePersonalAsset"("createdById");

-- AddForeignKey
ALTER TABLE "CulturePersonalAsset" ADD CONSTRAINT "CulturePersonalAsset_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CulturePersonalAsset" ADD CONSTRAINT "CulturePersonalAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CulturePersonalAsset" ADD CONSTRAINT "CulturePersonalAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

