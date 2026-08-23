-- Unifica reconhecimento e feedback.
--
-- Eram dois vocabulários paralelos para a mesma coisa: `Vote` + `Category` de um
-- lado, `Feedback` + `RecognitionCategory` do outro. Esta migration funde os
-- catálogos num só (o da G&G, que é provisionado por empresa) e materializa como
-- feedback o texto dos votos já publicados. Ver
-- `docs/superpowers/specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`.
--
-- Ordem importa: o slug precisa existir e estar acertado ANTES do índice único,
-- e o repontamento de `VoteCategory` depende do catálogo já fundido.

CREATE FUNCTION legends_slugify(txt TEXT) RETURNS TEXT AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(
    translate(lower($1), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '-', 'g'));
$$ LANGUAGE SQL IMMUTABLE;

-- 1. O catálogo de competências ganha o que o catálogo de voto tinha e ele não:
--    slug (é por ele que `Badge.categorySlug` aponta) e descrição.
ALTER TABLE "RecognitionCategory" ADD COLUMN "slug" TEXT;
ALTER TABLE "RecognitionCategory" ADD COLUMN "description" TEXT;
UPDATE "RecognitionCategory" SET "slug" = legends_slugify("name") WHERE "slug" IS NULL;

-- 2a. Categoria de voto que já existe como competência (mesmo nome, ignorando
--     acento e caixa): a competência adota o slug e a descrição dela. O slug
--     antigo prevalece de propósito — é o que os selos de categoria referenciam.
UPDATE "RecognitionCategory" r
SET "slug" = c."slug",
    "description" = COALESCE(r."description", c."description")
FROM "Category" c
WHERE c."companyId" = r."companyId"
  AND legends_slugify(c."name") = legends_slugify(r."name");

-- 2b. O que não casou entra como categoria nova, no fim da ordem. Fica ativa/
--     inativa como estava: desativar é decisão da G&G, não da migration.
INSERT INTO "RecognitionCategory" ("id", "name", "slug", "description", "order", "active", "companyId", "createdAt", "updatedAt")
SELECT
    'unifcat-' || c."id",
    c."name",
    c."slug",
    c."description",
    100 + ROW_NUMBER() OVER (PARTITION BY c."companyId" ORDER BY c."name"),
    c."active",
    c."companyId",
    c."createdAt",
    NOW()
FROM "Category" c
WHERE NOT EXISTS (
    SELECT 1 FROM "RecognitionCategory" r
    WHERE r."companyId" = c."companyId"
      AND legends_slugify(r."name") = legends_slugify(c."name")
);

ALTER TABLE "RecognitionCategory" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "RecognitionCategory_companyId_slug_key" ON "RecognitionCategory"("companyId", "slug");

-- 3. O voto passa a apontar para o catálogo unificado.
ALTER TABLE "VoteCategory" DROP CONSTRAINT "VoteCategory_categoryId_fkey";
UPDATE "VoteCategory" vc
SET "categoryId" = r."id"
FROM "Category" c
JOIN "RecognitionCategory" r ON r."companyId" = c."companyId" AND r."slug" = c."slug"
WHERE vc."categoryId" = c."id";
ALTER TABLE "VoteCategory" ADD CONSTRAINT "VoteCategory_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "RecognitionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Liga o feedback ao voto que o originou. É o que torna a materialização
--    idempotente: ela roda de novo a cada publicação de destaque.
ALTER TABLE "Feedback" ADD COLUMN "voteId" TEXT;
CREATE UNIQUE INDEX "Feedback_voteId_key" ON "Feedback"("voteId");
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_voteId_fkey"
    FOREIGN KEY ("voteId") REFERENCES "Vote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Voto publicado vira feedback. Só publicado: voto de período em aberto
--    continua embargado, e entra quando o destaque do mês for publicado.
--    Nasce privado (`sharedAt` nulo) — jogar o histórico inteiro no mural de uma
--    vez seria spam; quem recebeu decide o que compartilhar.
INSERT INTO "Feedback" ("id", "authorId", "targetId", "voteId", "message", "category", "sharedAt", "createdAt", "updatedAt", "companyId")
SELECT
    'votefb-' || v."id",
    v."voterId",
    v."votedId",
    v."id",
    v."justification",
    'ELOGIO'::"FeedbackCategory",
    NULL,
    v."createdAt",
    NOW(),
    v."companyId"
FROM "Vote" v
JOIN "VotingPeriod" p ON p."id" = v."periodId"
WHERE p."highlightStatus" = 'PUBLISHED'
  AND NOT EXISTS (SELECT 1 FROM "Feedback" f WHERE f."voteId" = v."id");

INSERT INTO "FeedbackRecipient" ("id", "feedbackId", "userId", "createdAt", "companyId")
SELECT 'votefbr-' || f."id", f."id", f."targetId", f."createdAt", f."companyId"
FROM "Feedback" f
WHERE f."voteId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "FeedbackRecipient" r WHERE r."feedbackId" = f."id" AND r."userId" = f."targetId"
  );

INSERT INTO "FeedbackRecognitionCategory" ("id", "feedbackId", "categoryId", "companyId")
SELECT 'votefbc-' || f."id" || '-' || vc."categoryId", f."id", vc."categoryId", f."companyId"
FROM "Feedback" f
JOIN "VoteCategory" vc ON vc."voteId" = f."voteId"
ON CONFLICT ("feedbackId", "categoryId") DO NOTHING;

-- 6. O catálogo de voto está aposentado: tudo que ele guardava vive no catálogo
--    unificado (passo 2) e nos votos repontados (passo 3).
DROP TABLE "CategorySector";
DROP TABLE "Category";

DROP FUNCTION legends_slugify(TEXT);
