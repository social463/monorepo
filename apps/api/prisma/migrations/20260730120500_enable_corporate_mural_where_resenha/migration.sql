-- O Mural corporativo assume a coluna principal da Home no lugar da "Resenha do
-- time". Quem já via a Resenha passa a ver o mural — sem isto, a Home ficaria
-- sem a seção principal até um admin habilitar a feature setor a setor.
UPDATE "Sector"
SET "enabledFeatures" = "enabledFeatures" || '["mural-corporativo"]'::jsonb
WHERE "enabledFeatures" @> '["resenha"]'::jsonb
  AND NOT ("enabledFeatures" @> '["mural-corporativo"]'::jsonb);

-- Terceirizados têm allowlist individual (não herdam a do setor).
UPDATE "User"
SET "enabledFeatures" = "enabledFeatures" || '["mural-corporativo"]'::jsonb
WHERE "role" = 'THIRD_PARTY'
  AND "enabledFeatures" @> '["resenha"]'::jsonb
  AND NOT ("enabledFeatures" @> '["mural-corporativo"]'::jsonb);
