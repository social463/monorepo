-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "imageWidth" INTEGER;

-- AlterTable
ALTER TABLE "ReviewComment" ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "imageWidth" INTEGER;
