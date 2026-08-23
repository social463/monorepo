/*
  Warnings:

  - You are about to drop the column `squadId` on the `RetroRoom` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "RetroRoom" DROP CONSTRAINT "RetroRoom_squadId_fkey";

-- DropIndex
DROP INDEX "RetroRoom_squadId_idx";

-- AlterTable
ALTER TABLE "RetroRoom" DROP COLUMN "squadId";

-- CreateTable
CREATE TABLE "RetroRoomSquad" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,

    CONSTRAINT "RetroRoomSquad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetroRoomSquad_squadId_idx" ON "RetroRoomSquad"("squadId");

-- CreateIndex
CREATE UNIQUE INDEX "RetroRoomSquad_roomId_squadId_key" ON "RetroRoomSquad"("roomId", "squadId");

-- AddForeignKey
ALTER TABLE "RetroRoomSquad" ADD CONSTRAINT "RetroRoomSquad_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "RetroRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroRoomSquad" ADD CONSTRAINT "RetroRoomSquad_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
