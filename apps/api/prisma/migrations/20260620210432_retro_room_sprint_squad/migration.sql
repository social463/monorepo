/*
  Warnings:

  - You are about to drop the column `title` on the `RetroRoom` table. All the data in the column will be lost.
  - Added the required column `sprint` to the `RetroRoom` table without a default value. This is not possible if the table is not empty.
  - Added the required column `squadId` to the `RetroRoom` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RetroRoom" DROP COLUMN "title",
ADD COLUMN     "sprint" INTEGER NOT NULL,
ADD COLUMN     "squadId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "RetroRoom_squadId_idx" ON "RetroRoom"("squadId");

-- AddForeignKey
ALTER TABLE "RetroRoom" ADD CONSTRAINT "RetroRoom_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
