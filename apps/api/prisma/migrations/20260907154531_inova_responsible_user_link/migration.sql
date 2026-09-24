-- Troca responsible1/responsible2 (texto livre) por responsible1Id/responsible2Id
-- (FK para User), para o card do Comunidade INOVA mostrar o avatar real do
-- responsável em vez de só o nome digitado.

-- AlterTable: novas colunas de FK, mantendo as antigas por enquanto para o backfill.
ALTER TABLE "InovaProject" ADD COLUMN     "responsible1Id" TEXT,
ADD COLUMN     "responsible2Id" TEXT;

-- Backfill: casa o texto livre existente com um usuário da mesma empresa por
-- nome (case/espaço-insensitive). Só liga quando o nome bate com EXATAMENTE
-- um usuário — nome ambíguo ou sem correspondência fica sem responsável
-- vinculado (perde o texto, mas não há como resolver com segurança).
UPDATE "InovaProject" p
SET "responsible1Id" = matched.id
FROM (
  SELECT lower(trim(name)) AS norm_name, "companyId", MIN(id) AS id, COUNT(*) AS cnt
  FROM "User"
  GROUP BY lower(trim(name)), "companyId"
) matched
WHERE matched."companyId" = p."companyId"
  AND matched.norm_name = lower(trim(p."responsible1"))
  AND matched.cnt = 1
  AND p."responsible1" IS NOT NULL;

UPDATE "InovaProject" p
SET "responsible2Id" = matched.id
FROM (
  SELECT lower(trim(name)) AS norm_name, "companyId", MIN(id) AS id, COUNT(*) AS cnt
  FROM "User"
  GROUP BY lower(trim(name)), "companyId"
) matched
WHERE matched."companyId" = p."companyId"
  AND matched.norm_name = lower(trim(p."responsible2"))
  AND matched.cnt = 1
  AND p."responsible2" IS NOT NULL;

-- AlterTable: agora sim descarta as colunas de texto livre.
ALTER TABLE "InovaProject" DROP COLUMN "responsible1",
DROP COLUMN "responsible2";

-- AddForeignKey
ALTER TABLE "InovaProject" ADD CONSTRAINT "InovaProject_responsible1Id_fkey" FOREIGN KEY ("responsible1Id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InovaProject" ADD CONSTRAINT "InovaProject_responsible2Id_fkey" FOREIGN KEY ("responsible2Id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
