-- Documento 4, seção 9.1 — blocos empilháveis na aula.
--
-- A aula tinha UM formato: `type` era VIDEO ou TEXT, e a tela escolhia qual
-- campo aparecia. Não dava para pôr um texto e, abaixo dele, uma imagem, que é
-- o exemplo do próprio documento. Agora o conteúdo é uma lista ordenada de
-- blocos numa coluna só.
--
-- A ORDEM AQUI IMPORTA: a coluna nova nasce, o conteúdo publicado é convertido
-- e só então as colunas velhas caem. Derrubar antes de converter perderia toda
-- aula que já existe.

-- AlterTable: a coluna nova, com a aula vazia como padrão
ALTER TABLE "CourseLesson" ADD COLUMN "contentBlocks" JSONB NOT NULL DEFAULT '[]';

-- Backfill: cada aula vira uma aula de um ou dois blocos.
--
-- Vídeo primeiro e texto depois porque era assim que o editor antigo os
-- apresentava — a URL do vídeo em cima e o "texto de apoio" embaixo.
--
-- `contentHtml` é nome herdado: o campo era um <textarea> cru, e o que está
-- gravado é texto com quebras de linha, não marcação. Vira bloco de texto, que
-- o player renderiza com `whitespace-pre-wrap`. Se alguma aula tiver colado
-- HTML ali, as tags vão aparecer literais — visível e corrigível no editor
-- novo, ao contrário de sumir em silêncio.
UPDATE "CourseLesson"
SET "contentBlocks" =
  (
    CASE
      WHEN "videoUrl" IS NOT NULL AND btrim("videoUrl") <> '' THEN
        jsonb_build_array(
          jsonb_build_object(
            'id', 'blk_' || replace(gen_random_uuid()::text, '-', ''),
            'type', 'video',
            'url', btrim("videoUrl"),
            'source',
            CASE
              WHEN "videoUrl" ILIKE '%youtube.com%' OR "videoUrl" ILIKE '%youtu.be%' THEN 'youtube'
              WHEN "videoUrl" ILIKE '%vimeo.com%' THEN 'vimeo'
              WHEN "videoUrl" ILIKE '%loom.com%' THEN 'loom'
              ELSE 'upload'
            END
          )
        )
      ELSE '[]'::jsonb
    END
    ||
    CASE
      WHEN "contentHtml" IS NOT NULL AND btrim("contentHtml") <> '' THEN
        jsonb_build_array(
          jsonb_build_object(
            'id', 'blk_' || replace(gen_random_uuid()::text, '-', ''),
            'type', 'text',
            'text', "contentHtml"
          )
        )
      ELSE '[]'::jsonb
    END
  )
WHERE ("videoUrl" IS NOT NULL AND btrim("videoUrl") <> '')
   OR ("contentHtml" IS NOT NULL AND btrim("contentHtml") <> '');

-- AlterTable: o formato único sai
ALTER TABLE "CourseLesson" DROP COLUMN "type";
ALTER TABLE "CourseLesson" DROP COLUMN "videoUrl";
ALTER TABLE "CourseLesson" DROP COLUMN "contentHtml";

-- DropEnum
DROP TYPE "CourseLessonType";
