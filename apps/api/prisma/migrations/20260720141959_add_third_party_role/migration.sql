-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'THIRD_PARTY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "enabledFeatures" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ThirdPartyInvite" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "enabledFeatures" JSONB NOT NULL DEFAULT '[]',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThirdPartyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThirdPartyInvite_tokenHash_key" ON "ThirdPartyInvite"("tokenHash");

-- AddForeignKey
ALTER TABLE "ThirdPartyInvite" ADD CONSTRAINT "ThirdPartyInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
