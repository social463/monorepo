-- Documento 4, seções 11.2 a 11.4.
--
-- Três coisas de uma vez, porque nascem juntas: o TEMA do selo (a prateleira do
-- catálogo), a RECOMPENSA em duas moedas e a REIVINDICAÇÃO feita pelo próprio
-- colaborador.
--
-- ATENÇÃO ao nome: `BadgeCategory` NÃO é `RecognitionCategory`. Aquela é a
-- categoria do feedback, e é ela que `Badge.categorySlug` referencia. Esta só
-- organiza o catálogo. Ver o comentário no schema.

-- CreateEnum
CREATE TYPE "BadgeClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "CoinEvent" ADD VALUE 'BADGE_EARNED';

-- AlterEnum
ALTER TYPE "XpEvent" ADD VALUE 'BADGE_EARNED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BADGE_CLAIM_REJECTED';

-- CreateTable
CREATE TABLE "BadgeCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BadgeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeClaim" (
    "id" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "attachmentKey" TEXT,
    "attachmentKind" "CorporatePostAttachmentKind",
    "link" TEXT,
    "status" "BadgeClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BadgeClaim_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Badge" ADD COLUMN     "badgeCategoryId" TEXT,
ADD COLUMN     "rewardCoins" INTEGER,
ADD COLUMN     "rewardPoints" INTEGER;

-- CreateIndex
CREATE INDEX "BadgeCategory_companyId_order_idx" ON "BadgeCategory"("companyId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeCategory_companyId_slug_key" ON "BadgeCategory"("companyId", "slug");

-- CreateIndex
CREATE INDEX "BadgeClaim_companyId_status_createdAt_idx" ON "BadgeClaim"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BadgeClaim_badgeId_idx" ON "BadgeClaim"("badgeId");

-- CreateIndex
CREATE INDEX "BadgeClaim_userId_idx" ON "BadgeClaim"("userId");

-- CreateIndex
CREATE INDEX "Badge_badgeCategoryId_idx" ON "Badge"("badgeCategoryId");

-- Uma reivindicação ATIVA por (pessoa, selo). Índice PARCIAL, e por isso escrito
-- à mão: o Prisma não sabe representá-lo, e declará-lo no schema faria todo
-- `migrate dev` futuro propor recriá-lo sem o WHERE. Recusada não bloqueia nova
-- tentativa — recusar existe justamente para a pessoa poder tentar de novo com
-- uma comprovação melhor. Mesmo mecanismo de ChallengeSubmission.
CREATE UNIQUE INDEX "BadgeClaim_active_user_badge_key"
  ON "BadgeClaim"("userId", "badgeId")
  WHERE "status" <> 'REJECTED';

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_badgeCategoryId_fkey" FOREIGN KEY ("badgeCategoryId") REFERENCES "BadgeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeCategory" ADD CONSTRAINT "BadgeCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeClaim" ADD CONSTRAINT "BadgeClaim_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeClaim" ADD CONSTRAINT "BadgeClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeClaim" ADD CONSTRAINT "BadgeClaim_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeClaim" ADD CONSTRAINT "BadgeClaim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Os cinco temas que a G&G já usa (Documento 4, seção 11.4), para cada empresa
-- que existir. Nenhum selo é classificado aqui: chutar um tema para o catálogo
-- inteiro seria inventar dado. Selo sem tema cai em "Sem categoria" na tela.
INSERT INTO "BadgeCategory" ("id", "name", "slug", "order", "companyId", "updatedAt")
SELECT
  'badgecat_' || c."id" || '_' || t."slug",
  t."name",
  t."slug",
  t."order",
  c."id",
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (VALUES
  ('Feedback', 'feedback', 0),
  ('Social', 'social', 1),
  ('Desenvolvimento', 'desenvolvimento', 2),
  ('Clima', 'clima', 3),
  ('Cultura', 'cultura', 4)
) AS t("name", "slug", "order")
ON CONFLICT ("companyId", "slug") DO NOTHING;
