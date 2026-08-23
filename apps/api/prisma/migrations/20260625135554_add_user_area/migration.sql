-- CreateEnum
CREATE TYPE "Area" AS ENUM ('ENGINEERING', 'PRODUCT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "area" "Area";
