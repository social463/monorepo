-- Cobrança do prazo da campanha de férias, para o gestor que ainda tem gente
-- sem programar. É o que substitui a G&G caçando gestor por e-mail.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VACATION_PLAN_DEADLINE';
