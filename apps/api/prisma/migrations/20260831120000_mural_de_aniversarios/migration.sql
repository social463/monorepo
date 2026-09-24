-- CreateEnum
CREATE TYPE "CelebrationKind" AS ENUM ('BIRTH', 'WORK');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BIRTHDAY_GREETING_RECEIVED';

-- CreateTable
CREATE TABLE "BirthdayGreeting" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "CelebrationKind" NOT NULL,
    "occurrenceYear" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "BirthdayGreeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayGreetingReaction" (
    "id" TEXT NOT NULL,
    "greetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "BirthdayGreetingReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BirthdayGreeting_companyId_targetId_kind_occurrenceYear_idx" ON "BirthdayGreeting"("companyId", "targetId", "kind", "occurrenceYear");

-- CreateIndex
CREATE INDEX "BirthdayGreeting_authorId_idx" ON "BirthdayGreeting"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayGreeting_companyId_targetId_kind_occurrenceYear_aut_key" ON "BirthdayGreeting"("companyId", "targetId", "kind", "occurrenceYear", "authorId");

-- CreateIndex
CREATE INDEX "BirthdayGreetingReaction_greetingId_idx" ON "BirthdayGreetingReaction"("greetingId");

-- CreateIndex
CREATE INDEX "BirthdayGreetingReaction_companyId_idx" ON "BirthdayGreetingReaction"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayGreetingReaction_greetingId_userId_emoji_key" ON "BirthdayGreetingReaction"("greetingId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "BirthdayGreeting" ADD CONSTRAINT "BirthdayGreeting_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreeting" ADD CONSTRAINT "BirthdayGreeting_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreeting" ADD CONSTRAINT "BirthdayGreeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreetingReaction" ADD CONSTRAINT "BirthdayGreetingReaction_greetingId_fkey" FOREIGN KEY ("greetingId") REFERENCES "BirthdayGreeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreetingReaction" ADD CONSTRAINT "BirthdayGreetingReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayGreetingReaction" ADD CONSTRAINT "BirthdayGreetingReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
