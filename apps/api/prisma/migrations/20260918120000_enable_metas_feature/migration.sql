-- Metas e OKRs entrou sem feature, aberto a todo colaborador interno. Agora é
-- liberado por setor (`metas`); sem isto, o módulo sumiria para todo mundo até
-- um admin ligá-lo setor a setor. Terceirizado não recebe: a API o recusa de
-- qualquer jeito.
UPDATE "Sector"
SET "enabledFeatures" = "enabledFeatures" || '["metas"]'::jsonb
WHERE NOT ("enabledFeatures" @> '["metas"]'::jsonb);
