-- CreateEnum
ALTER TYPE "NotificationType" ADD VALUE 'DEVELOPMENT_THURSDAY_EVENT';

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DevelopmentThursdayEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sprintStart" DATE NOT NULL,
    "sprintEnd" DATE NOT NULL,
    "eventDate" DATE NOT NULL,
    "presenterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevelopmentThursdayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentThursdayEvent_sprintStart_key" ON "DevelopmentThursdayEvent"("sprintStart");

-- CreateIndex
CREATE INDEX "DevelopmentThursdayEvent_eventDate_idx" ON "DevelopmentThursdayEvent"("eventDate");

-- CreateIndex
CREATE INDEX "DevelopmentThursdayEvent_presenterId_idx" ON "DevelopmentThursdayEvent"("presenterId");

-- AddForeignKey
ALTER TABLE "DevelopmentThursdayEvent" ADD CONSTRAINT "DevelopmentThursdayEvent_presenterId_fkey" FOREIGN KEY ("presenterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
