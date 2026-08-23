-- CreateEnum
CREATE TYPE "CultureVisualAssetFit" AS ENUM ('COVER', 'CONTAIN');

-- CreateTable
CREATE TABLE "CultureVisualAsset" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fit" "CultureVisualAssetFit" NOT NULL DEFAULT 'COVER',
    "order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CultureVisualAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CultureVisualAsset_companyId_order_idx" ON "CultureVisualAsset"("companyId", "order");

-- AddForeignKey
ALTER TABLE "CultureVisualAsset" ADD CONSTRAINT "CultureVisualAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

