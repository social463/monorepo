-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'STREAK_AT_RISK';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "teamsWebhookUrl" TEXT;
