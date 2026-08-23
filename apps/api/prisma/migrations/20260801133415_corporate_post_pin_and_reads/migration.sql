-- AlterTable
ALTER TABLE "CorporatePost" ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "pinnedById" TEXT;

-- CreateTable
CREATE TABLE "CorporatePostRead" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporatePostRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporatePostRead_companyId_postId_idx" ON "CorporatePostRead"("companyId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostRead_postId_userId_key" ON "CorporatePostRead"("postId", "userId");

-- CreateIndex
CREATE INDEX "CorporatePost_companyId_pinnedAt_idx" ON "CorporatePost"("companyId", "pinnedAt");

-- AddForeignKey
ALTER TABLE "CorporatePost" ADD CONSTRAINT "CorporatePost_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostRead" ADD CONSTRAINT "CorporatePostRead_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CorporatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostRead" ADD CONSTRAINT "CorporatePostRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostRead" ADD CONSTRAINT "CorporatePostRead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
