-- Lembrete de 10 minutos do 1:1: a coluna é a REIVINDICAÇÃO do lembrete, não um
-- registro informativo — `UPDATE ... WHERE "remindedAt" IS NULL` é atômico no
-- Postgres, e é o que impede dois ticks (ou dois processos) notificarem a mesma
-- ocorrência. Mesmo mecanismo do `OfficeMeeting.remindedAt`.
ALTER TABLE "OneOnOneMeeting" ADD COLUMN "remindedAt" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ONE_ON_ONE_REMINDER';
