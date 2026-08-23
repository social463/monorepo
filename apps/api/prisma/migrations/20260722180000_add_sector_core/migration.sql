-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "enabledFeatures" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorRole" (
    "sectorId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,

    CONSTRAINT "SectorRole_pkey" PRIMARY KEY ("sectorId","role")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sector_slug_key" ON "Sector"("slug");

-- AddForeignKey
ALTER TABLE "SectorRole" ADD CONSTRAINT "SectorRole_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: setor default "Desenvolvimento de Produto" com TODAS as features e TODOS os
-- papéis habilitados, replicando 1:1 o comportamento atual (ninguém perde acesso).
INSERT INTO "Sector" ("id", "name", "slug", "active", "enabledFeatures", "createdAt", "updatedAt")
VALUES (
    'sector-dev-produto',
    'Desenvolvimento de Produto',
    'desenvolvimento-de-produto',
    true,
    '["time","lendas","votar","selos","destaques","notificacoes","resenha","quinta-desenvolvimento","retrospectivas","escritorio"]',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT INTO "SectorRole" ("sectorId", "role") VALUES
    ('sector-dev-produto', 'LEGEND'),
    ('sector-dev-produto', 'LEAD'),
    ('sector-dev-produto', 'MANAGER'),
    ('sector-dev-produto', 'HEAD'),
    ('sector-dev-produto', 'ADMIN'),
    ('sector-dev-produto', 'THIRD_PARTY');

-- AlterTable (User): sectorId com DEFAULT — backfill automático das linhas existentes.
ALTER TABLE "User" ADD COLUMN "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';

-- AlterTable (VotingPeriod): idem, e troca a unicidade de monthRef global para (sectorId, monthRef).
ALTER TABLE "VotingPeriod" ADD COLUMN "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
DROP INDEX "VotingPeriod_monthRef_key";
CREATE UNIQUE INDEX "one_period_per_sector_month" ON "VotingPeriod"("sectorId", "monthRef");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VotingPeriod" ADD CONSTRAINT "VotingPeriod_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
