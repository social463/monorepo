-- A duração do curso passa a ser derivada da soma das aulas (`CourseLesson.durationMinutes`).
-- Um total próprio no curso desincroniza na primeira aula editada — mesmo motivo
-- pelo qual nota média e nº de alunos também são agregados por consulta.

-- AlterTable
ALTER TABLE "Course" DROP COLUMN "durationMinutes";

