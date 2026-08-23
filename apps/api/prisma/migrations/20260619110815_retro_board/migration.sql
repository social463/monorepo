-- CreateEnum
CREATE TYPE "RetroRoomStatus" AS ENUM ('COLLECTING', 'REVEALED', 'CONCLUDED');

-- CreateEnum
CREATE TYPE "RetroColumn" AS ENUM ('WENT_WELL', 'WENT_BAD', 'START', 'STOP', 'ACTIONS');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RETRO_INVITED';

-- CreateTable
CREATE TABLE "RetroRoom" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "votesPerParticipant" INTEGER NOT NULL,
    "status" "RetroRoomStatus" NOT NULL DEFAULT 'COLLECTING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" TIMESTAMP(3),
    "concludedAt" TIMESTAMP(3),

    CONSTRAINT "RetroRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroParticipant" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetroParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroCard" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "column" "RetroColumn" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetroCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroVote" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetroVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroReaction" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,

    CONSTRAINT "RetroReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetroRoom_createdById_idx" ON "RetroRoom"("createdById");

-- CreateIndex
CREATE INDEX "RetroParticipant_userId_idx" ON "RetroParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RetroParticipant_roomId_userId_key" ON "RetroParticipant"("roomId", "userId");

-- CreateIndex
CREATE INDEX "RetroCard_roomId_idx" ON "RetroCard"("roomId");

-- CreateIndex
CREATE INDEX "RetroCard_authorId_idx" ON "RetroCard"("authorId");

-- CreateIndex
CREATE INDEX "RetroVote_cardId_idx" ON "RetroVote"("cardId");

-- CreateIndex
CREATE INDEX "RetroVote_userId_idx" ON "RetroVote"("userId");

-- CreateIndex
CREATE INDEX "RetroReaction_cardId_idx" ON "RetroReaction"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "RetroReaction_cardId_userId_emoji_key" ON "RetroReaction"("cardId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "RetroRoom" ADD CONSTRAINT "RetroRoom_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroParticipant" ADD CONSTRAINT "RetroParticipant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "RetroRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroParticipant" ADD CONSTRAINT "RetroParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroCard" ADD CONSTRAINT "RetroCard_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "RetroRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroCard" ADD CONSTRAINT "RetroCard_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroVote" ADD CONSTRAINT "RetroVote_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "RetroCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroVote" ADD CONSTRAINT "RetroVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroReaction" ADD CONSTRAINT "RetroReaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "RetroCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroReaction" ADD CONSTRAINT "RetroReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
