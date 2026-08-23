-- CreateEnum
CREATE TYPE "CampaignAudience" AS ENUM ('ALL', 'LEADERSHIP');

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('MURAL', 'TEAMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "CampaignPostStatus" AS ENUM ('SCHEDULED', 'PUBLISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "audience" "CampaignAudience" NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPost" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visualHint" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "audience" "CampaignAudience" NOT NULL,
    "status" "CampaignPostStatus" NOT NULL DEFAULT 'SCHEDULED',
    "responsibleId" TEXT,
    "publishedPostId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_companyId_createdAt_idx" ON "Campaign"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPost_publishedPostId_key" ON "CampaignPost"("publishedPostId");

-- CreateIndex
CREATE INDEX "CampaignPost_companyId_scheduledFor_idx" ON "CampaignPost"("companyId", "scheduledFor");

-- CreateIndex
CREATE INDEX "CampaignPost_companyId_status_idx" ON "CampaignPost"("companyId", "status");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_publishedPostId_fkey" FOREIGN KEY ("publishedPostId") REFERENCES "CorporatePost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
