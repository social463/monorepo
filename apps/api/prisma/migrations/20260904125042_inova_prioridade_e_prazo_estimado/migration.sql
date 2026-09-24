/*
  Warnings:

  - The `priority` column on the `InovaProject` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `leadershipChallenge` column on the `InovaProject` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "InovaProject" ADD COLUMN     "estimatedDeadline" TEXT,
DROP COLUMN "priority",
ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false,
DROP COLUMN "leadershipChallenge",
ADD COLUMN     "leadershipChallenge" BOOLEAN NOT NULL DEFAULT false;
