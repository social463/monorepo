-- CreateEnum
CREATE TYPE "CorporatePostStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CorporatePostAudience" AS ENUM ('ALL', 'SECTORS');

-- CreateEnum
CREATE TYPE "CorporatePostAttachmentKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XpEvent" ADD VALUE 'CORPORATE_POST_REACTION';
ALTER TYPE "XpEvent" ADD VALUE 'CORPORATE_POST_COMMENT';
ALTER TYPE "XpEvent" ADD VALUE 'CORPORATE_POST_READ_FULL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CORPORATE_POST_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE 'CORPORATE_POST_AWAITING_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE 'CORPORATE_POST_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'CORPORATE_POST_REJECTED';

-- AlterTable
ALTER TABLE "CorporatePost" ADD COLUMN     "audienceScope" "CorporatePostAudience" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "contentJson" JSONB,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "CorporatePostStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "CorporatePostSector" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostSector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporatePostAttachment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "kind" "CorporatePostAttachmentKind" NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporatePostSector_companyId_sectorId_idx" ON "CorporatePostSector"("companyId", "sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostSector_postId_sectorId_key" ON "CorporatePostSector"("postId", "sectorId");

-- CreateIndex
CREATE INDEX "CorporatePostAttachment_postId_idx" ON "CorporatePostAttachment"("postId");

-- CreateIndex
CREATE INDEX "CorporatePostAttachment_companyId_idx" ON "CorporatePostAttachment"("companyId");

-- CreateIndex
CREATE INDEX "CorporatePost_companyId_status_createdAt_idx" ON "CorporatePost"("companyId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "CorporatePost" ADD CONSTRAINT "CorporatePost_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostSector" ADD CONSTRAINT "CorporatePostSector_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CorporatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostSector" ADD CONSTRAINT "CorporatePostSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostSector" ADD CONSTRAINT "CorporatePostSector_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostAttachment" ADD CONSTRAINT "CorporatePostAttachment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CorporatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostAttachment" ADD CONSTRAINT "CorporatePostAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

