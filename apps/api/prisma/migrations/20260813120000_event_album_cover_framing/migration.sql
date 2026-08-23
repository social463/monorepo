-- CreateEnum
CREATE TYPE "EventAlbumCoverFit" AS ENUM ('COVER', 'CONTAIN');

-- AlterTable
ALTER TABLE "EventAlbum" ADD COLUMN     "coverFit" "EventAlbumCoverFit" NOT NULL DEFAULT 'COVER',
ADD COLUMN     "coverPositionY" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "coverScale" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "coverStorageKey" TEXT;
