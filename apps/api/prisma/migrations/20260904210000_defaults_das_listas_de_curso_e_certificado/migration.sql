-- Devolve o DEFAULT das listas de `Course` e `CertificateRequest`.
--
-- A migration `20260904010945` resolveu o drift no sentido errado: alinhou o
-- banco ao schema DROPANDO os defaults, quando quem estava incompleto era o
-- schema. O efeito é silencioso e grave — o Prisma OMITE coluna de lista
-- escalar no INSERT, então, sem default, a coluna grava NULL; e na leitura o
-- client devolve `[]` para NULL, escondendo o problema do código. Só que o
-- filtro do catálogo é SQL (`audiencePositionCategories: { isEmpty: true }`), e
-- em SQL NULL não é lista vazia: TODO curso criado depois daquela migration
-- sumiria do catálogo de quem depende desse ramo do OR.
--
-- O backfill vem antes do default porque o default só vale para linha nova.

UPDATE "Course" SET "audiencePositionCategories" = ARRAY[]::TEXT[] WHERE "audiencePositionCategories" IS NULL;
UPDATE "Course" SET "recommendedFor" = ARRAY[]::TEXT[] WHERE "recommendedFor" IS NULL;
UPDATE "CertificateRequest" SET "reasons" = ARRAY[]::"ExternalTrainingReason"[] WHERE "reasons" IS NULL;

ALTER TABLE "Course" ALTER COLUMN "audiencePositionCategories" SET DEFAULT ARRAY[]::TEXT[],
                    ALTER COLUMN "recommendedFor" SET DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "CertificateRequest" ALTER COLUMN "reasons" SET DEFAULT ARRAY[]::"ExternalTrainingReason"[];
