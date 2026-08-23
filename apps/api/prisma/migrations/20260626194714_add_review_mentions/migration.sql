-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_MENTION';

-- CreateTable
CREATE TABLE "ReviewMention" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCommentMention" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCommentMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewMention_reviewId_idx" ON "ReviewMention"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewMention_reviewId_userId_key" ON "ReviewMention"("reviewId", "userId");

-- CreateIndex
CREATE INDEX "ReviewCommentMention_commentId_idx" ON "ReviewCommentMention"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCommentMention_commentId_userId_key" ON "ReviewCommentMention"("commentId", "userId");

-- AddForeignKey
ALTER TABLE "ReviewMention" ADD CONSTRAINT "ReviewMention_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMention" ADD CONSTRAINT "ReviewMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCommentMention" ADD CONSTRAINT "ReviewCommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ReviewComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCommentMention" ADD CONSTRAINT "ReviewCommentMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
