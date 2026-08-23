-- Renomeia em vez de dropar: DROP+ADD perderia o estado de publicação dos desafios.
ALTER TABLE "Challenge" RENAME COLUMN "active" TO "isActive";

ALTER TABLE "Challenge" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Engajamento';
ALTER TABLE "Challenge" ADD COLUMN "detailsMarkdown" TEXT;
ALTER TABLE "Challenge" ADD COLUMN "imageKey" TEXT;
ALTER TABLE "Challenge" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Challenge" ADD COLUMN "requiresReview" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Challenge" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Challenge" ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX "Challenge_companyId_active_idx";
CREATE INDEX "Challenge_companyId_isActive_position_idx"
  ON "Challenge"("companyId", "isActive", "position");
