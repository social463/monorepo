-- Setor e squad passam a ser únicos POR EMPRESA, e não no banco inteiro.
--
-- Mesma classe do que a migration `20260820160000_selo_unico_por_empresa`
-- corrigiu em `Badge`: os três models ganharam `companyId` no multi-empresa, mas
-- os índices de nome/slug continuaram globais. Na prática um inquilino
-- bloqueava o vocabulário do outro logo no cadastro — `createSector` respondia
-- 409 "Já existe um setor com esse nome" e `createSquad` 409 "Já existe uma
-- squad com esse nome" para um nome que só existia em OUTRA empresa. E
-- "Engenharia", "Produto" ou "Inovação" é o primeiro setor que qualquer cliente
-- novo cadastra.
--
-- Só afrouxa: todo nome/slug hoje é único no banco inteiro, então nenhuma linha
-- existente conflita com os novos índices.
DROP INDEX "Sector_slug_key";
CREATE UNIQUE INDEX "Sector_companyId_slug_key" ON "Sector"("companyId", "slug");

DROP INDEX "Squad_name_key";
DROP INDEX "Squad_slug_key";
CREATE UNIQUE INDEX "Squad_companyId_name_key" ON "Squad"("companyId", "name");
CREATE UNIQUE INDEX "Squad_companyId_slug_key" ON "Squad"("companyId", "slug");
