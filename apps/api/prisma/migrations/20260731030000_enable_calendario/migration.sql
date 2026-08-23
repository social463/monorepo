-- O Calendário absorve a tela de aniversários, que não era gated por feature.
-- Sem isto, quem via os aniversários perderia o acesso até um admin habilitar
-- a feature setor a setor.
UPDATE "Sector"
SET "enabledFeatures" = "enabledFeatures" || '["calendario"]'::jsonb
WHERE NOT ("enabledFeatures" @> '["calendario"]'::jsonb);

-- Terceirizados têm allowlist individual (não herdam a do setor). Só ganham o
-- Calendário quem já via o Time — mesma vizinhança de informação.
UPDATE "User"
SET "enabledFeatures" = "enabledFeatures" || '["calendario"]'::jsonb
WHERE "role" = 'THIRD_PARTY'
  AND "enabledFeatures" @> '["time"]'::jsonb
  AND NOT ("enabledFeatures" @> '["calendario"]'::jsonb);
