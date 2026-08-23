-- CreateEnum
CREATE TYPE "CalendarRecurrence" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CALENDAR_EVENT_REMINDER';

-- CreateTable
CREATE TABLE "CalendarEventType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'event',
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "typeId" TEXT NOT NULL,
    "recurrence" "CalendarRecurrence" NOT NULL DEFAULT 'NONE',
    "recurrenceUntil" DATE,
    "recurrenceCount" INTEGER,
    "reminderDaysBefore" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdById" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventSector" (
    "eventId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "CalendarEventSector_pkey" PRIMARY KEY ("eventId","sectorId")
);

-- CreateTable
CREATE TABLE "CalendarEventReminderSent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "daysBefore" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventReminderSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEventType_companyId_idx" ON "CalendarEventType"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventType_companyId_slug_key" ON "CalendarEventType"("companyId", "slug");

-- CreateIndex
CREATE INDEX "CalendarEvent_companyId_date_idx" ON "CalendarEvent"("companyId", "date");

-- CreateIndex
CREATE INDEX "CalendarEvent_typeId_idx" ON "CalendarEvent"("typeId");

-- CreateIndex
CREATE INDEX "CalendarEventSector_sectorId_idx" ON "CalendarEventSector"("sectorId");

-- CreateIndex
CREATE INDEX "CalendarEventReminderSent_eventId_idx" ON "CalendarEventReminderSent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventReminderSent_eventId_occurrenceDate_daysBefore_key" ON "CalendarEventReminderSent"("eventId", "occurrenceDate", "daysBefore");

-- AddForeignKey
ALTER TABLE "CalendarEventType" ADD CONSTRAINT "CalendarEventType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CalendarEventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventSector" ADD CONSTRAINT "CalendarEventSector_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventSector" ADD CONSTRAINT "CalendarEventSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventReminderSent" ADD CONSTRAINT "CalendarEventReminderSent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

