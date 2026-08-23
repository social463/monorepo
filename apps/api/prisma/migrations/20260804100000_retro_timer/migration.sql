-- CreateEnum
CREATE TYPE "RetroTimerMode" AS ENUM ('ELAPSED', 'COUNTDOWN');

-- CreateEnum
CREATE TYPE "RetroTimerStatus" AS ENUM ('IDLE', 'RUNNING', 'PAUSED');

-- AlterTable
ALTER TABLE "RetroRoom"
  ADD COLUMN "timerMode" "RetroTimerMode" NOT NULL DEFAULT 'ELAPSED',
  ADD COLUMN "timerStatus" "RetroTimerStatus" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "timerDurationSeconds" INTEGER,
  ADD COLUMN "timerStartedAt" TIMESTAMP(3),
  ADD COLUMN "timerAccumulatedSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "timerUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "timerUpdatedById" TEXT;

-- CreateIndex
CREATE INDEX "RetroRoom_timerUpdatedById_idx" ON "RetroRoom"("timerUpdatedById");

-- AddForeignKey
ALTER TABLE "RetroRoom" ADD CONSTRAINT "RetroRoom_timerUpdatedById_fkey" FOREIGN KEY ("timerUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
