-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "customCategory" TEXT;

-- CreateTable
CREATE TABLE "FeedbackRecipient" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "FeedbackRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecognitionCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "RecognitionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackRecognitionCategory" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "FeedbackRecognitionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackComment" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "FeedbackComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackRecipient_userId_idx" ON "FeedbackRecipient"("userId");

-- CreateIndex
CREATE INDEX "FeedbackRecipient_companyId_idx" ON "FeedbackRecipient"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackRecipient_feedbackId_userId_key" ON "FeedbackRecipient"("feedbackId", "userId");

-- CreateIndex
CREATE INDEX "RecognitionCategory_companyId_idx" ON "RecognitionCategory"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RecognitionCategory_companyId_name_key" ON "RecognitionCategory"("companyId", "name");

-- CreateIndex
CREATE INDEX "FeedbackRecognitionCategory_categoryId_idx" ON "FeedbackRecognitionCategory"("categoryId");

-- CreateIndex
CREATE INDEX "FeedbackRecognitionCategory_companyId_idx" ON "FeedbackRecognitionCategory"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackRecognitionCategory_feedbackId_categoryId_key" ON "FeedbackRecognitionCategory"("feedbackId", "categoryId");

-- CreateIndex
CREATE INDEX "FeedbackComment_feedbackId_idx" ON "FeedbackComment"("feedbackId");

-- CreateIndex
CREATE INDEX "FeedbackComment_companyId_idx" ON "FeedbackComment"("companyId");

-- AddForeignKey
ALTER TABLE "FeedbackRecipient" ADD CONSTRAINT "FeedbackRecipient_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRecipient" ADD CONSTRAINT "FeedbackRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRecipient" ADD CONSTRAINT "FeedbackRecipient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionCategory" ADD CONSTRAINT "RecognitionCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRecognitionCategory" ADD CONSTRAINT "FeedbackRecognitionCategory_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRecognitionCategory" ADD CONSTRAINT "FeedbackRecognitionCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "RecognitionCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRecognitionCategory" ADD CONSTRAINT "FeedbackRecognitionCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackComment" ADD CONSTRAINT "FeedbackComment_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackComment" ADD CONSTRAINT "FeedbackComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackComment" ADD CONSTRAINT "FeedbackComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: todo feedback que já existe ganha a linha do destinatário que ele
-- já tinha. É o que faz "Recebidos" poder ler SEMPRE por `FeedbackRecipient`,
-- sem um `OR targetId = :eu` que teria de ser lembrado em cada consulta nova.
-- `gen_random_uuid()` (pgcrypto, embutido no Postgres 13+) serve de id: cuid é
-- do Prisma e não existe em SQL — o formato do id não é lido por ninguém.
INSERT INTO "FeedbackRecipient" ("id", "feedbackId", "userId", "createdAt", "companyId")
SELECT gen_random_uuid()::text, f."id", f."targetId", f."createdAt", f."companyId"
FROM "Feedback" f
ON CONFLICT ("feedbackId", "userId") DO NOTHING;
