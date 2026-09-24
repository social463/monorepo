-- Segmentação do Feed Corporativo por tipo de comunicação (Documento 3, seção 13).
--
-- Catálogo por empresa, no molde de `CalendarEventType`. A tag é DESATIVADA,
-- nunca apagada: apagar deixaria comunicado órfão e sumiria com a série
-- histórica do painel de Comunicação Interna.
CREATE TABLE "CorporatePostTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6CE190',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CorporatePostTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CorporatePostTag_companyId_slug_key" ON "CorporatePostTag"("companyId", "slug");
CREATE INDEX "CorporatePostTag_companyId_idx" ON "CorporatePostTag"("companyId");

ALTER TABLE "CorporatePostTag"
  ADD CONSTRAINT "CorporatePostTag_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nullable de propósito: comunicado já publicado não tem tipo, e forçar um
-- default classificaria errado o histórico inteiro. O painel trata como
-- "Sem categoria".
ALTER TABLE "CorporatePost" ADD COLUMN "tagId" TEXT;

-- SetNull, e não Cascade: apagar uma tag (o que a tela não oferece, mas o banco
-- permite) não pode levar o comunicado junto.
ALTER TABLE "CorporatePost"
  ADD CONSTRAINT "CorporatePost_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "CorporatePostTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Catálogo inicial: a lista única que a OBS da seção 13 pede, fundindo os dois
-- conjuntos citados no documento (4.8 e 13). "Benefício"/"Benefícios" viram um.
INSERT INTO "CorporatePostTag" ("id", "name", "slug", "color", "order", "companyId", "updatedAt")
SELECT
  gen_random_uuid()::text,
  seed.name,
  seed.slug,
  seed.color,
  seed.order,
  c."id",
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (VALUES
  ('Institucional',  'institucional',  '#264641', 0),
  ('Endomarketing',  'endomarketing',  '#6CE190', 1),
  ('Benefícios',     'beneficios',     '#50BCFF', 2),
  ('Eventos EMR',    'eventos-emr',    '#FF7013', 3),
  ('Avaliação',      'avaliacao',      '#9500DB', 4),
  ('Treinamento',    'treinamento',    '#FFCB05', 5)
) AS seed(name, slug, color, "order")
ON CONFLICT ("companyId", "slug") DO NOTHING;
