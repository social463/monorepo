/*
  Warnings:

  - A unique constraint covering the columns `[userId,badgeId,periodId]` on the table `UserBadge` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "HighlightStatus" AS ENUM ('NONE', 'DRAFT', 'PUBLISHED');

-- AlterEnum
ALTER TYPE "BadgeKind" ADD VALUE 'HIGHLIGHT';

-- DropIndex
DROP INDEX "UserBadge_userId_badgeId_key";

-- AlterTable
ALTER TABLE "VotingPeriod" ADD COLUMN     "highlightImagePath" TEXT,
ADD COLUMN     "highlightStatus" "HighlightStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "highlightText" TEXT,
ADD COLUMN     "winnerId" TEXT,
ADD COLUMN     "winnerVotes" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeId_periodId_key" ON "UserBadge"("userId", "badgeId", "periodId");

-- AddForeignKey
ALTER TABLE "VotingPeriod" ADD CONSTRAINT "VotingPeriod_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
