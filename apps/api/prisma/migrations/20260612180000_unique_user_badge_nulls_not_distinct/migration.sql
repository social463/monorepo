-- Recreate the unique index with NULLS NOT DISTINCT so that two rows with
-- (userId, badgeId, periodId=NULL) are treated as duplicates. This enforces
-- the constraint for MANUAL badges where periodId is always NULL.
DROP INDEX IF EXISTS "UserBadge_userId_badgeId_periodId_key";
CREATE UNIQUE INDEX "UserBadge_userId_badgeId_periodId_key"
  ON "UserBadge" ("userId", "badgeId", "periodId")
  NULLS NOT DISTINCT;
