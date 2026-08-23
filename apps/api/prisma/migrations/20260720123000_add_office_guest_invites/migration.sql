CREATE TABLE "OfficeGuestInvite" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeGuestInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficeGuestInvite_tokenHash_key" ON "OfficeGuestInvite"("tokenHash");
CREATE INDEX "OfficeGuestInvite_createdById_idx" ON "OfficeGuestInvite"("createdById");
CREATE INDEX "OfficeGuestInvite_expiresAt_idx" ON "OfficeGuestInvite"("expiresAt");

ALTER TABLE "OfficeGuestInvite" ADD CONSTRAINT "OfficeGuestInvite_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
