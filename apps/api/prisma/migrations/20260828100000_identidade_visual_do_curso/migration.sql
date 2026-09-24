-- Documento 4, seção 9.6 (passo 2) — identidade visual do curso.
--
-- Aditiva: `coverUrl` já existia, e os quatro campos novos nascem nulos. Curso
-- sem nada continua com o visual de sempre.
ALTER TABLE "Course"
  ADD COLUMN "bannerUrl" TEXT,
  ADD COLUMN "introVideoUrl" TEXT,
  ADD COLUMN "icon" TEXT,
  ADD COLUMN "primaryColor" TEXT;
