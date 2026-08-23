-- Reconciliação sector (main) x company (multi-tenancy): os 7 models de Review ganham
-- sectorId denormalizado (mesmo padrão do companyId), e UserBadge — nunca tocado por
-- nenhuma fatia de multi-tenancy até aqui — ganha companyId.

-- AlterTable: sectorId nos 7 models de Review
ALTER TABLE "Review" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewComment" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewReaction" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewCommentReaction" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewShare" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewMention" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewCommentMention" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';

-- Backfill: sectorId real do autor da resenha/comentário/reação/etc (o default acima só
-- cobre quem não tiver correspondência, o que não deveria acontecer em dado consistente).
UPDATE "Review" r SET "sectorId" = u."sectorId" FROM "User" u WHERE u.id = r."authorId";
UPDATE "ReviewComment" rc SET "sectorId" = u."sectorId" FROM "User" u WHERE u.id = rc."authorId";
UPDATE "ReviewReaction" rr SET "sectorId" = rv."sectorId" FROM "Review" rv WHERE rv.id = rr."reviewId";
UPDATE "ReviewCommentReaction" rcr SET "sectorId" = rc."sectorId" FROM "ReviewComment" rc WHERE rc.id = rcr."commentId";
UPDATE "ReviewShare" rs SET "sectorId" = rv."sectorId" FROM "Review" rv WHERE rv.id = rs."reviewId";
UPDATE "ReviewMention" rm SET "sectorId" = rv."sectorId" FROM "Review" rv WHERE rv.id = rm."reviewId";
UPDATE "ReviewCommentMention" rcm SET "sectorId" = rc."sectorId" FROM "ReviewComment" rc WHERE rc.id = rcm."commentId";

-- CreateIndex
CREATE INDEX "Review_sectorId_idx" ON "Review"("sectorId");
CREATE INDEX "ReviewComment_sectorId_idx" ON "ReviewComment"("sectorId");
CREATE INDEX "ReviewReaction_sectorId_idx" ON "ReviewReaction"("sectorId");
CREATE INDEX "ReviewCommentReaction_sectorId_idx" ON "ReviewCommentReaction"("sectorId");
CREATE INDEX "ReviewShare_sectorId_idx" ON "ReviewShare"("sectorId");
CREATE INDEX "ReviewMention_sectorId_idx" ON "ReviewMention"("sectorId");
CREATE INDEX "ReviewCommentMention_sectorId_idx" ON "ReviewCommentMention"("sectorId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewReaction" ADD CONSTRAINT "ReviewReaction_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewCommentReaction" ADD CONSTRAINT "ReviewCommentReaction_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewShare" ADD CONSTRAINT "ReviewShare_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewMention" ADD CONSTRAINT "ReviewMention_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewCommentMention" ADD CONSTRAINT "ReviewCommentMention_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: companyId no UserBadge (nunca tinha sido tocado por nenhuma fatia de multi-tenancy)
ALTER TABLE "UserBadge" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- Backfill: companyId real do dono do selo.
UPDATE "UserBadge" ub SET "companyId" = u."companyId" FROM "User" u WHERE u.id = ub."userId";

-- CreateIndex
CREATE INDEX "UserBadge_companyId_idx" ON "UserBadge"("companyId");

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
