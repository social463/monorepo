-- CreateTable
CREATE TABLE "FeedbackReaction" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackReaction_feedbackId_idx" ON "FeedbackReaction"("feedbackId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackReaction_feedbackId_userId_emoji_key" ON "FeedbackReaction"("feedbackId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "FeedbackReaction" ADD CONSTRAINT "FeedbackReaction_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReaction" ADD CONSTRAINT "FeedbackReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
