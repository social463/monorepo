-- AlterEnum
BEGIN;
CREATE TYPE "BadgeKind_new" AS ENUM ('CATEGORY', 'RECURRENCE', 'IMPACT');
ALTER TABLE "Badge" ALTER COLUMN "kind" TYPE "BadgeKind_new" USING ("kind"::text::"BadgeKind_new");
ALTER TYPE "BadgeKind" RENAME TO "BadgeKind_old";
ALTER TYPE "BadgeKind_new" RENAME TO "BadgeKind";
DROP TYPE "BadgeKind_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "MonthlyRankingEntry" DROP CONSTRAINT "MonthlyRankingEntry_periodId_fkey";

-- DropForeignKey
ALTER TABLE "MonthlyRankingEntry" DROP CONSTRAINT "MonthlyRankingEntry_userId_fkey";

-- DropTable
DROP TABLE "MonthlyRankingEntry";
