/*
  Warnings:

  - You are about to drop the column `categoryId` on the `Vote` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "VoteCategory" (
    "voteId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "VoteCategory_pkey" PRIMARY KEY ("voteId","categoryId")
);

-- CreateIndex
CREATE INDEX "VoteCategory_categoryId_idx" ON "VoteCategory"("categoryId");

-- AddForeignKey
ALTER TABLE "VoteCategory" ADD CONSTRAINT "VoteCategory_voteId_fkey" FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteCategory" ADD CONSTRAINT "VoteCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Copia os votos existentes (1 categoria por voto) para a nova join
INSERT INTO "VoteCategory" ("voteId", "categoryId")
SELECT "id", "categoryId" FROM "Vote";

-- DropForeignKey
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_categoryId_fkey";

-- AlterTable
ALTER TABLE "Vote" DROP COLUMN "categoryId";
