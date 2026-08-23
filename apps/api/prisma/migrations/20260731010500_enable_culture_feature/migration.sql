-- A área de Cultura é conteúdo institucional da empresa: vale para todo setor.
-- Sem isto a seção nasceria invisível até um admin habilitar setor a setor.
UPDATE "Sector"
SET "enabledFeatures" = "enabledFeatures" || '["cultura"]'::jsonb
WHERE NOT ("enabledFeatures" @> '["cultura"]'::jsonb);

-- Terceirizados NÃO entram no backfill de propósito: manifesto e manuais
-- internos são conteúdo interno, e a allowlist do THIRD_PARTY é individual.
-- Quem quiser liberar para um terceirizado específico faz pelo admin.
