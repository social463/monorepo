-- AlterTable
ALTER TABLE "CampaignPost" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "imageWidth" INTEGER;

-- CreateIndex
CREATE INDEX "CampaignPost_status_channel_scheduledFor_idx" ON "CampaignPost"("status", "channel", "scheduledFor");

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: quem criou a campanha responde pelos itens dela. É o que faz a
-- publicação automática valer para o que já estava agendado — sem autor, o tick
-- não tem em nome de quem publicar no Mural e deixa o item para o botão.
-- Item avulso antigo (sem campanha) fica com `createdById` nulo, de propósito:
-- não há de onde tirar quem o criou.
UPDATE "CampaignPost" p
SET "createdById" = c."createdById"
FROM "Campaign" c
WHERE p."campaignId" = c."id" AND p."createdById" IS NULL;
