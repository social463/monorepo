-- CreateTable
CREATE TABLE "OfficeSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "broadcastEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeSetting_pkey" PRIMARY KEY ("id")
);
