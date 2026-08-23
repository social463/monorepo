-- Initial, superseded office map storage. Kept intact so fresh databases can
-- reproduce the migration history; the versioned editor migration replaces it.
CREATE TABLE "OfficeMap" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfficeMap_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficeMapAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfficeMapAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficeMapAsset_objectKey_key" ON "OfficeMapAsset"("objectKey");
CREATE INDEX "OfficeMapAsset_createdAt_idx" ON "OfficeMapAsset"("createdAt");
CREATE INDEX "OfficeMapAsset_createdById_idx" ON "OfficeMapAsset"("createdById");
CREATE INDEX "OfficeMap_updatedById_idx" ON "OfficeMap"("updatedById");

ALTER TABLE "OfficeMap" ADD CONSTRAINT "OfficeMap_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OfficeMapAsset" ADD CONSTRAINT "OfficeMapAsset_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
