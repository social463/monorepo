/*
  Warnings:

  - You are about to drop the column `behavior` on the `Feedback` table. All the data in the column will be lost.
  - You are about to drop the column `impact` on the `Feedback` table. All the data in the column will be lost.
  - You are about to drop the column `situation` on the `Feedback` table. All the data in the column will be lost.
  - Added the required column `message` to the `Feedback` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Feedback" DROP COLUMN "behavior",
DROP COLUMN "impact",
DROP COLUMN "situation",
ADD COLUMN     "message" TEXT NOT NULL;
