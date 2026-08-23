-- Provisiona o catálogo inicial de competências do Mural de Feedbacks.
--
-- As 13 do documento da G&G nasciam só no `db:seed`, que roda em dev e **nunca**
-- em homologação/produção. Resultado: empresa migrada abre a aba "Enviar" com o
-- seletor de categorias vazio — e sem nenhuma categoria o reconhecimento não
-- fecha, porque o envio exige ao menos uma. Vira backfill, como as categorias
-- do calendário.
--
-- Só recebe a lista a empresa que está com ZERO competências: quem já curou o
-- próprio catálogo (renomeou, desativou ou cadastrou as suas) não é reescrito —
-- num produto white label a lista é da empresa, não da EMR.
INSERT INTO "RecognitionCategory" ("id", "name", "order", "active", "companyId", "createdAt", "updatedAt")
SELECT
    'recogcat-' || c."id" || '-' || cat."order",
    cat."name",
    cat."order",
    true,
    c."id",
    NOW(),
    NOW()
FROM "Company" c
CROSS JOIN (VALUES
    ('Trabalho em Equipe e Colaboração', 0),
    ('Liderança',                        1),
    ('Foco no Cliente',                  2),
    ('Inovação',                         3),
    ('Execução Impecável',               4),
    ('Inspiração',                       5),
    ('Gratidão',                         6),
    ('Comunicação',                      7),
    ('Inteligência Emocional',           8),
    ('Adaptabilidade e Resiliência',     9),
    ('Proatividade e Senso de Dono',    10),
    ('Foco em Resultados',              11),
    ('Resolução de Problemas',          12)
) AS cat("name", "order")
WHERE NOT EXISTS (
    SELECT 1 FROM "RecognitionCategory" r WHERE r."companyId" = c."id"
)
ON CONFLICT ("companyId", "name") DO NOTHING;
