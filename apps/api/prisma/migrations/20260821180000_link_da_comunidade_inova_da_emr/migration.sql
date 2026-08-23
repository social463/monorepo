-- Comunidade INOVA: o link é dado DA EMPRESA (`AppSetting`), como a URL do
-- ImpulseUP, e não um item fixo no menu. Num produto white label, cravar o
-- destino de um cliente no código o entregaria a todos os outros tenants.
--
-- Aqui só a EMR nasce com a URL preenchida — é dela a comunidade. As demais
-- empresas continuam sem o item até alguém cadastrar o próprio link em
-- Administração › Desenvolvimento.
--
-- `DO NOTHING`: se a empresa já tiver cadastrado uma URL pela tela, ela vale
-- mais que este seed.
INSERT INTO "AppSetting" ("key", "companyId", "value", "updatedAt")
VALUES (
    'inova_community_url',
    'company-emr',
    'https://inovacomunidadeemr.lovable.app/auth',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key", "companyId") DO NOTHING;
