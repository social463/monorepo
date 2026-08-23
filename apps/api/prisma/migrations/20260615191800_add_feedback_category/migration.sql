-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('POSITIVO', 'ORIENTACAO', 'ELOGIO', 'MELHORIA');

-- AlterTable: adiciona com default para preencher linhas existentes, depois remove o default
ALTER TABLE "Feedback" ADD COLUMN "category" "FeedbackCategory" NOT NULL DEFAULT 'POSITIVO';
ALTER TABLE "Feedback" ALTER COLUMN "category" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Feedback_targetId_category_idx" ON "Feedback"("targetId", "category");
