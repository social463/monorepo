-- Aprendizado e Meu PDI são a aba Desenvolvimento do colaborador: valem para
-- todo setor. Sem isto a seção nasceria invisível até um admin habilitar setor
-- a setor, e as duas features são independentes de propósito (o setor pode
-- desligar uma sem desligar a outra).
UPDATE "Sector"
SET "enabledFeatures" = "enabledFeatures" || '["aprendizado"]'::jsonb
WHERE NOT ("enabledFeatures" @> '["aprendizado"]'::jsonb);

UPDATE "Sector"
SET "enabledFeatures" = "enabledFeatures" || '["pdi"]'::jsonb
WHERE NOT ("enabledFeatures" @> '["pdi"]'::jsonb);

-- Terceirizados NÃO entram no backfill: PDI é dado sensível da pessoa e a
-- allowlist do THIRD_PARTY é individual.
