-- Identidade visual EMR 2026 (Documento 3, seção 10).
--
-- Por que uma migration e não só o preset: `getBranding` lê o que está gravado
-- em `AppSetting`; o `EMR_PRESET` do código é referência versionada e o que o
-- teste de contraste valida, mas não é lido em runtime. Sem esta linha, a
-- paleta nova não chegaria a nenhuma tela.
--
-- É um MERGE de chaves de topo (`||`), não uma substituição do registro. O que
-- a rebrand muda — cor, paleta e tipografia — é reescrito; o que a empresa
-- configurou — nome exibido, assinatura, domínios, esquema padrão e **logos** —
-- fica intacto.
--
-- Os logos ficam de propósito: a marca de 2026 não existe em vetor (o próprio
-- brandbook manda pedir ao estúdio), e uma migration não sobe arquivo para o
-- S3. Trocar a marca antiga por marca NENHUMA seria pior do que a arte antiga
-- conviver alguns dias com a paleta nova.
--
-- Só UPDATE, nunca INSERT: empresa sem registro de marca cai no padrão do
-- produto, e inventar um registro aqui seria cadastrar configuração que ninguém
-- pediu. Nesse caso o caminho é Administração › Marca.
UPDATE "AppSetting"
SET value = (value::jsonb || '{"brandColor":"#6ce190","neutralColor":"#f8f8f8","fonts":{"headline":"Outfit","body":"Outfit"},"overrides":{"light":{"surface":"#ffffff","background":"#f8f8f8","surface-container-lowest":"#ffffff","surface-container-low":"#f8f8f8","surface-container":"#f1f5f2","surface-container-high":"#e8efea","surface-container-highest":"#dce7df","surface-bright":"#ffffff","surface-dim":"#edf2ee","surface-variant":"#f8f8f8","on-surface":"#264641","on-background":"#264641","on-surface-variant":"#526a62","outline":"#526a62","outline-variant":"#e1e8e4","inverse-surface":"#1b322e","inverse-on-surface":"#f8f8f8","surface-tint":"#6ce190","primary":"#16603c","on-primary":"#ffffff","primary-container":"#e4f9eb","on-primary-container":"#0f4a2d","inverse-primary":"#6ce190","secondary":"#4a6b00","on-secondary":"#ffffff","secondary-container":"#f0fdcc","on-secondary-container":"#3a5400","tertiary":"#14618c","on-tertiary":"#ffffff","tertiary-container":"#d6efff","on-tertiary-container":"#0a4a6b","error":"#c4381b","on-error":"#ffffff","error-container":"#fde6e0","on-error-container":"#8f2712"},"dark":{"surface-container-lowest":"#121f1c","surface":"#1b322e","background":"#1b322e","surface-dim":"#1b322e","surface-container-low":"#213934","surface-container":"#264641","surface-container-high":"#2b4d46","surface-container-highest":"#315850","surface-bright":"#315850","surface-variant":"#264641","on-surface":"#ffffff","on-background":"#ffffff","on-surface-variant":"#b9d2c6","outline":"#7e9b92","outline-variant":"#3a5a53","inverse-surface":"#f8f8f8","inverse-on-surface":"#1b322e","surface-tint":"#6ce190","primary":"#6ce190","on-primary":"#1b322e","primary-container":"#2f5d4a","on-primary-container":"#c8f5d8","inverse-primary":"#16603c","secondary":"#b4f900","on-secondary":"#1b322e","secondary-container":"#3f5400","on-secondary-container":"#e8fca8","tertiary":"#50bcff","on-tertiary":"#1b322e","tertiary-container":"#124a6b","on-tertiary-container":"#c4e7ff","error":"#ff9e85","on-error":"#1b322e","error-container":"#6b2415","on-error-container":"#ffd3c6"}}}'::jsonb)::text,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE key = 'branding'
  AND "companyId" = 'company-emr'
  AND value IS NOT NULL
  -- Guarda contra registro corrompido: `::jsonb` estouraria a migration inteira.
  AND value ~ '^\s*\{';
