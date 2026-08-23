-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_createdById_fkey";

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
