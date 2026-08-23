-- CreateTable
CREATE TABLE "ReviewPoll" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto',

    CONSTRAINT "ReviewPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewPollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto',

    CONSTRAINT "ReviewPollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewPollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto',

    CONSTRAINT "ReviewPollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewPoll_reviewId_key" ON "ReviewPoll"("reviewId");

-- CreateIndex
CREATE INDEX "ReviewPoll_companyId_idx" ON "ReviewPoll"("companyId");

-- CreateIndex
CREATE INDEX "ReviewPoll_sectorId_idx" ON "ReviewPoll"("sectorId");

-- CreateIndex
CREATE INDEX "ReviewPollOption_pollId_idx" ON "ReviewPollOption"("pollId");

-- CreateIndex
CREATE INDEX "ReviewPollOption_companyId_idx" ON "ReviewPollOption"("companyId");

-- CreateIndex
CREATE INDEX "ReviewPollOption_sectorId_idx" ON "ReviewPollOption"("sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewPollOption_pollId_position_key" ON "ReviewPollOption"("pollId", "position");

-- CreateIndex
CREATE INDEX "ReviewPollVote_pollId_idx" ON "ReviewPollVote"("pollId");

-- CreateIndex
CREATE INDEX "ReviewPollVote_optionId_idx" ON "ReviewPollVote"("optionId");

-- CreateIndex
CREATE INDEX "ReviewPollVote_userId_idx" ON "ReviewPollVote"("userId");

-- CreateIndex
CREATE INDEX "ReviewPollVote_companyId_idx" ON "ReviewPollVote"("companyId");

-- CreateIndex
CREATE INDEX "ReviewPollVote_sectorId_idx" ON "ReviewPollVote"("sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewPollVote_pollId_userId_key" ON "ReviewPollVote"("pollId", "userId");

-- AddForeignKey
ALTER TABLE "ReviewPoll" ADD CONSTRAINT "ReviewPoll_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPoll" ADD CONSTRAINT "ReviewPoll_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPoll" ADD CONSTRAINT "ReviewPoll_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPollOption" ADD CONSTRAINT "ReviewPollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "ReviewPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPollOption" ADD CONSTRAINT "ReviewPollOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPollOption" ADD CONSTRAINT "ReviewPollOption_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPollVote" ADD CONSTRAINT "ReviewPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "ReviewPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPollVote" ADD CONSTRAINT "ReviewPollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ReviewPollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPollVote" ADD CONSTRAINT "ReviewPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPollVote" ADD CONSTRAINT "ReviewPollVote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewPollVote" ADD CONSTRAINT "ReviewPollVote_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
