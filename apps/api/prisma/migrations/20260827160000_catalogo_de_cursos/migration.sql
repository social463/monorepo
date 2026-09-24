-- Documento 4, seções 9.6 (abas) e 9.7 — categorias, competências e instrutores
-- deixam de ser texto livre na tabela de curso e viram catálogo administrável.
--
-- A ORDEM IMPORTA, como na migration dos blocos de aula: as tabelas nascem, o
-- que já existe é convertido, e só então as colunas de texto caem.

-- CreateTable
CREATE TABLE "CourseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Instructor" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "photoUrl" TEXT,
    "bio" TEXT,
    "expertise" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Instructor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseCompetency" (
    "courseId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    CONSTRAINT "CourseCompetency_pkey" PRIMARY KEY ("courseId","competencyId")
);

CREATE TABLE "CourseInstructor" (
    "courseId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CourseInstructor_pkey" PRIMARY KEY ("courseId","instructorId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategory_companyId_slug_key" ON "CourseCategory"("companyId", "slug");
CREATE INDEX "CourseCategory_companyId_active_idx" ON "CourseCategory"("companyId", "active");
CREATE UNIQUE INDEX "Competency_companyId_slug_key" ON "Competency"("companyId", "slug");
CREATE INDEX "Competency_companyId_active_idx" ON "Competency"("companyId", "active");
CREATE UNIQUE INDEX "Instructor_companyId_userId_key" ON "Instructor"("companyId", "userId");
CREATE INDEX "Instructor_companyId_active_idx" ON "Instructor"("companyId", "active");
CREATE INDEX "CourseCompetency_competencyId_idx" ON "CourseCompetency"("competencyId");
CREATE INDEX "CourseInstructor_instructorId_idx" ON "CourseInstructor"("instructorId");

-- AddForeignKey
ALTER TABLE "CourseCategory" ADD CONSTRAINT "CourseCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CourseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseCategory" ADD CONSTRAINT "CourseCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Competency" ADD CONSTRAINT "Competency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseCompetency" ADD CONSTRAINT "CourseCompetency_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseCompetency" ADD CONSTRAINT "CourseCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseInstructor" ADD CONSTRAINT "CourseInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: a FK da categoria nasce vazia e é preenchida pelo backfill abaixo.
ALTER TABLE "Course" ADD COLUMN "categoryId" TEXT;

-- ============================================================================
-- BACKFILL
-- ============================================================================
-- `slugify` do repo: minúsculas, sem acento, não-alfanumérico vira hífen.
--
-- Textos DISTINTOS colidem no slug — "Liderança" e "liderança" viram
-- `lideranca` —, e é justamente essa colisão que o catálogo existe para
-- resolver. Por isso cada passo agrupa POR SLUG, não por texto, e elege uma
-- grafia: a mais usada, desempatada pelo nome. As demais convergem para ela.
CREATE OR REPLACE FUNCTION pg_temp.slugify(txt TEXT) RETURNS TEXT AS $$
  SELECT btrim(
    regexp_replace(
      lower(translate(txt, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
      '[^a-z0-9]+', '-', 'g'
    ),
    '-'
  );
$$ LANGUAGE SQL IMMUTABLE;

-- 1. Uma categoria por SLUG em uso, por empresa.
WITH usos AS (
  SELECT "companyId", pg_temp.slugify("category") AS slug, "category" AS nome, count(*) AS qtd
  FROM "Course"
  WHERE btrim("category") <> ''
  GROUP BY 1, 2, 3
), eleita AS (
  SELECT DISTINCT ON ("companyId", slug) "companyId", slug, nome
  FROM usos
  ORDER BY "companyId", slug, qtd DESC, nome
)
INSERT INTO "CourseCategory" ("id", "name", "slug", "companyId", "updatedAt")
SELECT gen_random_uuid()::text, nome, slug, "companyId", now() FROM eleita;

-- Casa pelo SLUG: é o que faz "liderança" e "Liderança" caírem na mesma.
UPDATE "Course" c
SET "categoryId" = cc."id"
FROM "CourseCategory" cc
WHERE cc."companyId" = c."companyId" AND cc."slug" = pg_temp.slugify(c."category");

-- 2. Uma competência por SLUG, pelo mesmo critério.
WITH todas AS (
  SELECT c."companyId", nome
  FROM "Course" c
  CROSS JOIN LATERAL jsonb_array_elements_text(c."competencies"::jsonb) AS nome
  WHERE jsonb_typeof(c."competencies"::jsonb) = 'array' AND btrim(nome) <> ''
), usos AS (
  SELECT "companyId", pg_temp.slugify(nome) AS slug, nome, count(*) AS qtd
  FROM todas GROUP BY 1, 2, 3
), eleita AS (
  SELECT DISTINCT ON ("companyId", slug) "companyId", slug, nome
  FROM usos ORDER BY "companyId", slug, qtd DESC, nome
)
INSERT INTO "Competency" ("id", "name", "slug", "companyId", "updatedAt")
SELECT gen_random_uuid()::text, nome, slug, "companyId", now() FROM eleita;

INSERT INTO "CourseCompetency" ("courseId", "competencyId")
SELECT DISTINCT c."id", comp."id"
FROM "Course" c
CROSS JOIN LATERAL jsonb_array_elements_text(c."competencies"::jsonb) AS nome
JOIN "Competency" comp ON comp."companyId" = c."companyId" AND comp."slug" = pg_temp.slugify(nome)
WHERE jsonb_typeof(c."competencies"::jsonb) = 'array';

-- 3. Um instrutor por nome distinto. Casa com um `User` do mesmo nome quando
--    houver exatamente UM — com dois homônimos, vira instrutor externo, porque
--    escolher no chute ligaria o curso à pessoa errada.
-- Um instrutor por NOME (não por nome+bio): o mesmo instrutor com bios
-- diferentes em dois cursos é uma pessoa só, e duas linhas aqui duplicariam o
-- vínculo do curso mais adiante.
WITH usos AS (
  SELECT "companyId", "instructorName" AS nome, "instructorBio" AS bio, count(*) AS qtd
  FROM "Course"
  WHERE "instructorName" IS NOT NULL AND btrim("instructorName") <> ''
  GROUP BY 1, 2, 3
), eleito AS (
  SELECT DISTINCT ON ("companyId", nome) "companyId", nome, bio
  FROM usos ORDER BY "companyId", nome, qtd DESC, bio NULLS LAST
)
INSERT INTO "Instructor" ("id", "name", "bio", "expertise", "companyId", "userId", "updatedAt")
SELECT
  gen_random_uuid()::text,
  i.nome,
  i.bio,
  ARRAY[]::TEXT[],
  i."companyId",
  (
    -- `max(id)` e não `id`: com o `HAVING count(*) = 1` a linha só existe quando
    -- há exatamente um homônimo, e aí o max É esse único id. Sem agregação o
    -- Postgres recusa a coluna solta junto do HAVING. Com dois homônimos o
    -- instrutor nasce EXTERNO — escolher no chute ligaria o curso à pessoa
    -- errada, e o vínculo é corrigível na tela.
    SELECT max(u."id") FROM "User" u
    WHERE u."companyId" = i."companyId" AND u."name" = i.nome
    HAVING count(*) = 1
  ),
  now()
FROM eleito i;

INSERT INTO "CourseInstructor" ("courseId", "instructorId", "sortOrder")
SELECT c."id", ins."id", 0
FROM "Course" c
JOIN "Instructor" ins ON ins."companyId" = c."companyId" AND ins."name" = c."instructorName"
WHERE c."instructorName" IS NOT NULL AND btrim(c."instructorName") <> '';

-- ============================================================================
-- As colunas de texto saem
-- ============================================================================
DROP INDEX IF EXISTS "Course_companyId_category_idx";
ALTER TABLE "Course" DROP COLUMN "category";
ALTER TABLE "Course" DROP COLUMN "competencies";
ALTER TABLE "Course" DROP COLUMN "instructorName";
ALTER TABLE "Course" DROP COLUMN "instructorBio";

CREATE INDEX "Course_companyId_categoryId_idx" ON "Course"("companyId", "categoryId");
ALTER TABLE "Course" ADD CONSTRAINT "Course_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
