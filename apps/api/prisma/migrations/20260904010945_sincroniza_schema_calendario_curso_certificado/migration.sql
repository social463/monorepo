-- DropIndex
DROP INDEX "CalendarEvent_companyId_isInternalComm_idx";

-- AlterTable
ALTER TABLE "CertificateRequest" ALTER COLUMN "reasons" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Course" ALTER COLUMN "audiencePositionCategories" DROP DEFAULT,
ALTER COLUMN "recommendedFor" DROP DEFAULT;
