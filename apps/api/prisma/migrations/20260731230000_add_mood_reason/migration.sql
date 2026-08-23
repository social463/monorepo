-- CreateEnum
CREATE TYPE "MoodReason" AS ENUM ('WORKLOAD', 'LEADERSHIP', 'RECOGNITION', 'PROCESSES', 'TEAM', 'PERSONAL', 'OTHER');

-- AlterTable
ALTER TABLE "MoodEntry" ADD COLUMN     "reason" "MoodReason";

-- CreateIndex
CREATE INDEX "MoodEntry_companyId_day_idx" ON "MoodEntry"("companyId", "day");

