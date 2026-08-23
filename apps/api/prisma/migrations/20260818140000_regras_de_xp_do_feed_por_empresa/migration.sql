-- Provisiona as regras de XP do Feed Corporativo.
--
-- As três nasceram no `prisma/seed.ts` junto com a feature, e o seed roda em
-- dev e **nunca** em homologação ou produção. O efeito não era só cosmético:
-- `awardXp` devolve `NO_RULE` quando a linha não existe, então reagir, comentar
-- e ler um comunicado por inteiro **não creditavam nada**. O bloco "Como ganhar
-- pontos" da coluna do Feed some junto, porque ele lista só regra existente —
-- de propósito, para não prometer ponto que o servidor não paga.
--
-- Só entram os três eventos do Feed, e só onde faltam: os cinco antigos já
-- existem em quem foi configurado, e ressuscitar uma regra que o admin apagou
-- de propósito seria pior que o problema. Valor e `active` de quem já tem ficam
-- como estão — a empresa manda no que é dela (Administração › Pontos).
INSERT INTO "XpRule" ("id", "event", "amount", "capWindow", "capAmount", "active", "companyId", "createdAt", "updatedAt")
SELECT
    'xprule-' || c."id" || '-' || r."event",
    r."event"::"XpEvent",
    r."amount",
    'NONE'::"XpCapWindow",
    NULL,
    true,
    c."id",
    NOW(),
    NOW()
FROM "Company" c
CROSS JOIN (VALUES
    ('CORPORATE_POST_REACTION',  1),
    ('CORPORATE_POST_COMMENT',   2),
    ('CORPORATE_POST_READ_FULL', 3)
) AS r("event", "amount")
ON CONFLICT ("companyId", "event") DO NOTHING;
