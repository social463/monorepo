-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CORPORATE_POST_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE 'CORPORATE_POST_COMMENT_REPLY';
ALTER TYPE "NotificationType" ADD VALUE 'CORPORATE_POST_REACTION';
ALTER TYPE "NotificationType" ADD VALUE 'CORPORATE_POST_MENTION';

-- CreateTable
CREATE TABLE "CorporatePost" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gifUrl" TEXT,
    "gifWidth" INTEGER,
    "gifHeight" INTEGER,
    "imageUrl" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporatePostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gifUrl" TEXT,
    "gifWidth" INTEGER,
    "gifHeight" INTEGER,
    "imageUrl" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporatePostReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporatePostCommentReaction" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostCommentReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporatePostMention" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporatePostCommentMention" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "CorporatePostCommentMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporatePost_createdAt_idx" ON "CorporatePost"("createdAt");

-- CreateIndex
CREATE INDEX "CorporatePost_authorId_idx" ON "CorporatePost"("authorId");

-- CreateIndex
CREATE INDEX "CorporatePost_companyId_idx" ON "CorporatePost"("companyId");

-- CreateIndex
CREATE INDEX "CorporatePostComment_postId_createdAt_idx" ON "CorporatePostComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "CorporatePostComment_authorId_idx" ON "CorporatePostComment"("authorId");

-- CreateIndex
CREATE INDEX "CorporatePostComment_companyId_idx" ON "CorporatePostComment"("companyId");

-- CreateIndex
CREATE INDEX "CorporatePostReaction_postId_idx" ON "CorporatePostReaction"("postId");

-- CreateIndex
CREATE INDEX "CorporatePostReaction_companyId_idx" ON "CorporatePostReaction"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostReaction_postId_userId_emoji_key" ON "CorporatePostReaction"("postId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "CorporatePostCommentReaction_commentId_idx" ON "CorporatePostCommentReaction"("commentId");

-- CreateIndex
CREATE INDEX "CorporatePostCommentReaction_companyId_idx" ON "CorporatePostCommentReaction"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostCommentReaction_commentId_userId_emoji_key" ON "CorporatePostCommentReaction"("commentId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "CorporatePostMention_postId_idx" ON "CorporatePostMention"("postId");

-- CreateIndex
CREATE INDEX "CorporatePostMention_companyId_idx" ON "CorporatePostMention"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostMention_postId_userId_key" ON "CorporatePostMention"("postId", "userId");

-- CreateIndex
CREATE INDEX "CorporatePostCommentMention_commentId_idx" ON "CorporatePostCommentMention"("commentId");

-- CreateIndex
CREATE INDEX "CorporatePostCommentMention_companyId_idx" ON "CorporatePostCommentMention"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporatePostCommentMention_commentId_userId_key" ON "CorporatePostCommentMention"("commentId", "userId");

-- AddForeignKey
ALTER TABLE "CorporatePost" ADD CONSTRAINT "CorporatePost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePost" ADD CONSTRAINT "CorporatePost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostComment" ADD CONSTRAINT "CorporatePostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CorporatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostComment" ADD CONSTRAINT "CorporatePostComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostComment" ADD CONSTRAINT "CorporatePostComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostReaction" ADD CONSTRAINT "CorporatePostReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CorporatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostReaction" ADD CONSTRAINT "CorporatePostReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostReaction" ADD CONSTRAINT "CorporatePostReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostCommentReaction" ADD CONSTRAINT "CorporatePostCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CorporatePostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostCommentReaction" ADD CONSTRAINT "CorporatePostCommentReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostCommentReaction" ADD CONSTRAINT "CorporatePostCommentReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostMention" ADD CONSTRAINT "CorporatePostMention_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CorporatePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostMention" ADD CONSTRAINT "CorporatePostMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostMention" ADD CONSTRAINT "CorporatePostMention_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostCommentMention" ADD CONSTRAINT "CorporatePostCommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CorporatePostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostCommentMention" ADD CONSTRAINT "CorporatePostCommentMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporatePostCommentMention" ADD CONSTRAINT "CorporatePostCommentMention_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
