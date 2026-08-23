-- Mesa reivindicável no mapa legado/default para facilitar teste local da layer `desks`.
-- A migration é idempotente para não duplicar a mesa caso o mapa tenha sido ajustado manualmente.

UPDATE "OfficeMapDraft"
SET
  "document" = jsonb_set(
    "document",
    '{objects}',
    COALESCE("document"->'objects', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'id', 'legacy-desk-padrao-1',
        'layerKey', 'desks',
        'type', 'desk',
        'geometry', jsonb_build_object('kind', 'rectangle', 'x', 624, 'y', 480, 'width', 64, 'height', 32),
        'properties', jsonb_build_object('externalKey', 'mesa-padrao-1', 'name', 'Mesa padrão')
      )
    ),
    true
  ),
  "revision" = "revision" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'legacy-office-draft'
  AND NOT COALESCE("document"->'objects', '[]'::jsonb) @> '[{"type":"desk","properties":{"externalKey":"mesa-padrao-1"}}]'::jsonb;

UPDATE "OfficeMapPublication"
SET
  "mapData" = jsonb_set(
    "mapData",
    '{objects}',
    COALESCE("mapData"->'objects', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'id', 'legacy-desk-padrao-1',
        'layerKey', 'desks',
        'type', 'desk',
        'geometry', jsonb_build_object('kind', 'rectangle', 'x', 624, 'y', 480, 'width', 64, 'height', 32),
        'properties', jsonb_build_object('externalKey', 'mesa-padrao-1', 'name', 'Mesa padrão')
      )
    )
  )
WHERE "id" = 'legacy-office-publication-v1'
  AND NOT COALESCE("mapData"->'objects', '[]'::jsonb) @> '[{"type":"desk","properties":{"externalKey":"mesa-padrao-1"}}]'::jsonb;

INSERT INTO "OfficeDesk" ("id", "mapPublicationId", "name", "externalKey", "createdAt", "updatedAt")
SELECT 'legacy-office-desk-padrao-1', 'legacy-office-publication-v1', 'Mesa padrão', 'mesa-padrao-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "OfficeMapPublication" WHERE "id" = 'legacy-office-publication-v1'
)
ON CONFLICT ("mapPublicationId", "externalKey") DO NOTHING;
