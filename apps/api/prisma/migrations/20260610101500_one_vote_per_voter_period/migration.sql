-- DropIndex
DROP INDEX "Vote_voterId_votedId_categoryId_periodId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Vote_voterId_periodId_key" ON "Vote"("voterId", "periodId");
