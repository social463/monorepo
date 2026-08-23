-- CreateEnum
CREATE TYPE "CoinEvent" AS ENUM ('VOTE_CAST', 'FEEDBACK_PUBLISHED', 'FEEDBACK_REACTION', 'MOOD_ANSWERED');

-- CreateEnum
CREATE TYPE "CoinCapWindow" AS ENUM ('NONE', 'DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "CoinTransactionKind" AS ENUM ('EARN', 'MANUAL_CREDIT', 'MANUAL_DEBIT');

-- CreateTable
CREATE TABLE "CoinRule" (
    "id" TEXT NOT NULL,
    "event" "CoinEvent" NOT NULL,
    "amount" INTEGER NOT NULL,
    "capWindow" "CoinCapWindow" NOT NULL DEFAULT 'NONE',
    "capAmount" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CoinTransactionKind" NOT NULL,
    "event" "CoinEvent",
    "ruleId" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoinRule_companyId_idx" ON "CoinRule"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinRule_companyId_event_key" ON "CoinRule"("companyId", "event");

-- CreateIndex
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CoinTransaction_userId_ruleId_day_idx" ON "CoinTransaction"("userId", "ruleId", "day");

-- CreateIndex
CREATE INDEX "CoinTransaction_companyId_idx" ON "CoinTransaction"("companyId");

-- CreateIndex
CREATE INDEX "CoinTransaction_ruleId_idx" ON "CoinTransaction"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_userId_dedupeKey_key" ON "CoinTransaction"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "CoinRule" ADD CONSTRAINT "CoinRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CoinRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

