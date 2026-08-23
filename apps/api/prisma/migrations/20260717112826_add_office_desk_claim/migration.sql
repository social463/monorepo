-- CreateTable
CREATE TABLE "OfficeDesk" (
    "id" TEXT NOT NULL,
    "mapPublicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeDesk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeDeskClaim" (
    "deskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeDeskClaim_pkey" PRIMARY KEY ("deskId")
);

-- CreateIndex
CREATE INDEX "OfficeDesk_mapPublicationId_idx" ON "OfficeDesk"("mapPublicationId");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesk_mapPublicationId_externalKey_key" ON "OfficeDesk"("mapPublicationId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDeskClaim_userId_key" ON "OfficeDeskClaim"("userId");

-- AddForeignKey
ALTER TABLE "OfficeDesk" ADD CONSTRAINT "OfficeDesk_mapPublicationId_fkey" FOREIGN KEY ("mapPublicationId") REFERENCES "OfficeMapPublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDeskClaim" ADD CONSTRAINT "OfficeDeskClaim_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "OfficeDesk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDeskClaim" ADD CONSTRAINT "OfficeDeskClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
