-- AlterTable
ALTER TABLE "RetroCard" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT;

-- CreateTable
CREATE TABLE "RetroEdit" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetroEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetroEdit_roomId_idx" ON "RetroEdit"("roomId");

-- AddForeignKey
ALTER TABLE "RetroCard" ADD CONSTRAINT "RetroCard_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroEdit" ADD CONSTRAINT "RetroEdit_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "RetroRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroEdit" ADD CONSTRAINT "RetroEdit_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
