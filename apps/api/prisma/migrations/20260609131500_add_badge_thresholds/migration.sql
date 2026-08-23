-- AlterTable
ALTER TABLE "Badge" ADD COLUMN     "categorySlug" TEXT,
ADD COLUMN     "threshold" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeId_key" ON "UserBadge"("userId", "badgeId");

