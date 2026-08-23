-- CreateTable
CREATE TABLE "CharacterFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CharacterFavorite_userId_idx" ON "CharacterFavorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterFavorite_userId_slot_key" ON "CharacterFavorite"("userId", "slot");

-- AddForeignKey
ALTER TABLE "CharacterFavorite" ADD CONSTRAINT "CharacterFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
