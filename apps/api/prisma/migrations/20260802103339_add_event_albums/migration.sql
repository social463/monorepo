-- CreateTable
CREATE TABLE "EventAlbum" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventDate" TIMESTAMP(3),
    "coverPhotoId" TEXT,
    "createdById" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAlbum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPhoto" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPhotoReaction" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "EventPhotoReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPhotoComment" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',

    CONSTRAINT "EventPhotoComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventAlbum_coverPhotoId_key" ON "EventAlbum"("coverPhotoId");

-- CreateIndex
CREATE INDEX "EventAlbum_companyId_eventDate_idx" ON "EventAlbum"("companyId", "eventDate");

-- CreateIndex
CREATE INDEX "EventPhoto_albumId_createdAt_idx" ON "EventPhoto"("albumId", "createdAt");

-- CreateIndex
CREATE INDEX "EventPhoto_companyId_idx" ON "EventPhoto"("companyId");

-- CreateIndex
CREATE INDEX "EventPhotoReaction_photoId_idx" ON "EventPhotoReaction"("photoId");

-- CreateIndex
CREATE INDEX "EventPhotoReaction_companyId_idx" ON "EventPhotoReaction"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EventPhotoReaction_photoId_userId_emoji_key" ON "EventPhotoReaction"("photoId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "EventPhotoComment_photoId_createdAt_idx" ON "EventPhotoComment"("photoId", "createdAt");

-- CreateIndex
CREATE INDEX "EventPhotoComment_companyId_idx" ON "EventPhotoComment"("companyId");

-- AddForeignKey
ALTER TABLE "EventAlbum" ADD CONSTRAINT "EventAlbum_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "EventPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAlbum" ADD CONSTRAINT "EventAlbum_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAlbum" ADD CONSTRAINT "EventAlbum_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhoto" ADD CONSTRAINT "EventPhoto_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "EventAlbum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhoto" ADD CONSTRAINT "EventPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhoto" ADD CONSTRAINT "EventPhoto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhotoReaction" ADD CONSTRAINT "EventPhotoReaction_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "EventPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhotoReaction" ADD CONSTRAINT "EventPhotoReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhotoReaction" ADD CONSTRAINT "EventPhotoReaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhotoComment" ADD CONSTRAINT "EventPhotoComment_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "EventPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhotoComment" ADD CONSTRAINT "EventPhotoComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPhotoComment" ADD CONSTRAINT "EventPhotoComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
