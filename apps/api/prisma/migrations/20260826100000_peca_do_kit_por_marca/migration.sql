-- Documento 4, seção 7: a EMR tem duas identidades visuais em uso ao mesmo
-- tempo, com regras de uso diferentes. A peça passa a declarar de qual é.

-- CreateEnum
CREATE TYPE "CultureVisualAssetBrand" AS ENUM ('CURRENT', 'NEW');

-- AlterTable
-- CURRENT como default é o backfill: toda peça já publicada foi feita antes de
-- a nova marca existir.
ALTER TABLE "CultureVisualAsset" ADD COLUMN "brand" "CultureVisualAssetBrand" NOT NULL DEFAULT 'CURRENT';
