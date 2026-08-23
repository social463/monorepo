-- AlterTable
ALTER TABLE "CalendarEventType" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#6366f1';

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "endDate" DATE,
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "audienceTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isInternalComm" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "CalendarEvent_companyId_isInternalComm_idx" ON "CalendarEvent"("companyId", "isInternalComm");

-- As dez categorias do Calendário Endomarketing 2026, uma linha por empresa.
-- Espelha CALENDAR_EVENT_CATEGORIES em @legends/shared; o `slug` é o mesmo que
-- `slugify(label)` produz no cadastro manual, e o id é determinístico para a
-- semeadura ser idempotente (a unique é (companyId, slug), mas o ON CONFLICT
-- fixo evita reciclar id a cada reexecução).
INSERT INTO "CalendarEventType" ("id", "name", "slug", "icon", "color", "companyId", "createdAt", "updatedAt")
SELECT
    'caltype-' || c."id" || '-' || cat."slug",
    cat."name",
    cat."slug",
    cat."icon",
    cat."color",
    c."id",
    NOW(),
    NOW()
FROM "Company" c
CROSS JOIN (VALUES
    ('Ação',              'acao',              'campaign',    '#8b5cf6'),
    ('Data comemorativa', 'data-comemorativa', 'celebration', '#ec4899'),
    ('Evento',            'evento',            'event',       '#10b981'),
    ('Feriado',           'feriado',           'flag',        '#ef4444'),
    ('Campanha',          'campanha',          'ads_click',   '#f59e0b'),
    ('Reunião',           'reuniao',           'groups',      '#0ea5e9'),
    ('Avaliação',         'avaliacao',         'fact_check',  '#6366f1'),
    ('Cultura',           'cultura',           'diversity_3', '#14b8a6'),
    ('Desenv. Humano',    'desenv-humano',     'school',      '#a855f7'),
    ('Comunicação',       'comunicacao',       'forum',       '#3b82f6')
) AS cat("name", "slug", "icon", "color")
ON CONFLICT ("companyId", "slug") DO NOTHING;

-- Empresa que já tinha a categoria cadastrada à mão fica com a cor do catálogo:
-- sem isto, "Reunião" criada antes ficaria com a cor de fallback e a legenda
-- por categoria mentiria em metade da grade.
UPDATE "CalendarEventType" t
SET "color" = cat."color", "icon" = cat."icon"
FROM (VALUES
    ('acao',              'campaign',    '#8b5cf6'),
    ('data-comemorativa', 'celebration', '#ec4899'),
    ('evento',            'event',       '#10b981'),
    ('feriado',           'flag',        '#ef4444'),
    ('campanha',          'ads_click',   '#f59e0b'),
    ('reuniao',           'groups',      '#0ea5e9'),
    ('avaliacao',         'fact_check',  '#6366f1'),
    ('cultura',           'diversity_3', '#14b8a6'),
    ('desenv-humano',     'school',      '#a855f7'),
    ('comunicacao',       'forum',       '#3b82f6')
) AS cat("slug", "icon", "color")
WHERE t."slug" = cat."slug";
