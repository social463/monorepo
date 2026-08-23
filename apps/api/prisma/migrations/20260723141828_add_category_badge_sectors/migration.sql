-- AlterTable
ALTER TABLE "Badge" ADD COLUMN     "global" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "global" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CategorySector" (
    "categoryId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "CategorySector_pkey" PRIMARY KEY ("categoryId","sectorId")
);

-- CreateTable
CREATE TABLE "BadgeSector" (
    "badgeId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "BadgeSector_pkey" PRIMARY KEY ("badgeId","sectorId")
);

-- AddForeignKey
ALTER TABLE "CategorySector" ADD CONSTRAINT "CategorySector_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorySector" ADD CONSTRAINT "CategorySector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeSector" ADD CONSTRAINT "BadgeSector_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeSector" ADD CONSTRAINT "BadgeSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
