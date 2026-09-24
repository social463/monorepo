-- Documento 4, seção 9.6 — recompensa ao concluir o curso.
--
-- Até aqui concluir curso rendia SELO, e era o selo que carregava ponto e moeda.
-- Recompensa direta por curso é conceito novo. Os defaults são os do documento:
-- 25 pontos e 10 EMR Coins. Zero = sem recompensa.

-- AlterEnum
ALTER TYPE "CoinEvent" ADD VALUE 'COURSE_COMPLETED';
ALTER TYPE "XpEvent" ADD VALUE 'COURSE_COMPLETED';

-- AlterTable
ALTER TABLE "Course"
  ADD COLUMN "rewardPoints" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "rewardCoins" INTEGER NOT NULL DEFAULT 10;
