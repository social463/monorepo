-- CreateTable
CREATE TABLE "CorporatePostPoll" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporatePostPollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostPollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporatePostPollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostPollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostPoll_postId_key" ON "CorporatePostPoll"("postId");

-- CreateIndex
CREATE INDEX "CorporatePostPoll_companyId_idx" ON "CorporatePostPoll"("companyId");

-- CreateIndex
CREATE INDEX "CorporatePostPollOption_pollId_idx" ON "CorporatePostPollOption"("pollId");

-- CreateIndex
CREATE INDEX "CorporatePostPollOption_companyId_idx" ON "CorporatePostPollOption"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostPollOption_pollId_position_key" ON "CorporatePostPollOption"("pollId", "position");

-- CreateIndex
CREATE INDEX "CorporatePostPollVote_pollId_idx" ON "CorporatePostPollVote"("pollId");

-- CreateIndex
CREATE INDEX "CorporatePostPollVote_optionId_idx" ON "CorporatePostPollVote"("optionId");

-- CreateIndex
CREATE INDEX "CorporatePostPollVote_userId_idx" ON "CorporatePostPollVote"("userId");

-- CreateIndex
CREATE INDEX "CorporatePostPollVote_companyId_idx" ON "CorporatePostPollVote"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostPollVote_pollId_userId_key" ON "CorporatePostPollVote"("pollId", "userId");

-- AddForeignKey
ALTER TABLE "CorporatePostPoll" ADD CONSTRAINT "CorporatePostPoll_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CorporatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostPoll" ADD CONSTRAINT "CorporatePostPoll_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostPollOption" ADD CONSTRAINT "CorporatePostPollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "CorporatePostPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostPollOption" ADD CONSTRAINT "CorporatePostPollOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostPollVote" ADD CONSTRAINT "CorporatePostPollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "CorporatePostPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostPollVote" ADD CONSTRAINT "CorporatePostPollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "CorporatePostPollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostPollVote" ADD CONSTRAINT "CorporatePostPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostPollVote" ADD CONSTRAINT "CorporatePostPollVote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
