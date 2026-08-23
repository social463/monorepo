-- O slug do selo passa a ser único POR EMPRESA, e não no banco inteiro.
--
-- `Badge` sempre foi tenant-scoped (tem `companyId` e está na allowlist de
-- `scopedPrisma`), mas o índice de slug era global — herança de quando o produto
-- tinha uma empresa só. Num white label isso vaza entre inquilinos de dois
-- jeitos: a empresa A criar "Inovador" faz `createBadgeAdmin` recusar o selo
-- homônimo da empresa B com 409 "Já existe um selo com esse nome", e o
-- `destaque-do-mes` — que `publishHighlight` procura por slug — só pode existir
-- uma vez, então publicar o destaque em qualquer outra empresa morria em
-- 'Selo "destaque-do-mes" não encontrado (rode o seed)'.
--
-- Só afrouxa: todo slug hoje é único no banco inteiro, então nenhuma linha
-- existente conflita com o novo índice.
DROP INDEX "Badge_slug_key";
CREATE UNIQUE INDEX "Badge_companyId_slug_key" ON "Badge"("companyId", "slug");
