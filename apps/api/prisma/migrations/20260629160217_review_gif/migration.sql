-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "gifHeight" INTEGER,
ADD COLUMN     "gifUrl" TEXT,
ADD COLUMN     "gifWidth" INTEGER;

-- AlterTable
ALTER TABLE "ReviewComment" ADD COLUMN     "gifHeight" INTEGER,
ADD COLUMN     "gifUrl" TEXT,
ADD COLUMN     "gifWidth" INTEGER;
