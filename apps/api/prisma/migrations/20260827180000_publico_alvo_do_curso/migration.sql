-- Documento 4, seção 9.2 — público-alvo e matrícula automática.
--
-- `Course.sectorId` continua sendo o setor DONO (quem administra, e o recorte
-- que o SUBADMIN escreve). O que entra é o público que ENXERGA, que soma a ele:
-- outros setores e categorias de cargo.
--
-- A categoria do cargo é campo NOVO em `User` — não é derivável do título:
-- "Desenvolvedor(a)" é Analista, "Tech Lead" é Team Leader, "CAO" é Diretor.
-- Ela nasce vazia e é preenchida pela importação de colaboradores.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "positionCategory" TEXT;

ALTER TABLE "Course"
  ADD COLUMN "audiencePositionCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "recommendedFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "autoEnroll" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CourseAudienceSector" (
    "courseId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    CONSTRAINT "CourseAudienceSector_pkey" PRIMARY KEY ("courseId","sectorId")
);

-- CreateIndex
CREATE INDEX "CourseAudienceSector_sectorId_idx" ON "CourseAudienceSector"("sectorId");

-- AddForeignKey
ALTER TABLE "CourseAudienceSector" ADD CONSTRAINT "CourseAudienceSector_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseAudienceSector" ADD CONSTRAINT "CourseAudienceSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
