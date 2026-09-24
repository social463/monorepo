-- CreateTable
CREATE TABLE "InovaGuiaVideo" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "category" TEXT,
    "duration" TEXT,
    "behavior" TEXT,
    "videoUrl" TEXT,
    "storagePath" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "InovaGuiaVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InovaGuiaVideo_companyId_idx" ON "InovaGuiaVideo"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "InovaGuiaVideo_companyId_videoId_key" ON "InovaGuiaVideo"("companyId", "videoId");

-- AddForeignKey
ALTER TABLE "InovaGuiaVideo" ADD CONSTRAINT "InovaGuiaVideo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaGuiaVideo" ADD CONSTRAINT "InovaGuiaVideo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
