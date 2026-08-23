-- CreateEnum
CREATE TYPE "BadgeAwardSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "UserBadge" ADD COLUMN     "awardedById" TEXT,
ADD COLUMN     "source" "BadgeAwardSource" NOT NULL DEFAULT 'AUTO';

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
