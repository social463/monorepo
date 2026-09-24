-- Convite a pessoas específicas no calendário (Documento 3, seção 11).
--
-- O convidado enxerga o evento INDEPENDENTEMENTE de setor e de tag — é o ponto
-- todo do convite nominal. As duas regras antigas (CalendarEventSector e
-- audienceTags) continuam valendo e se somam a esta.
CREATE TABLE "CalendarEventGuest" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    CONSTRAINT "CalendarEventGuest_pkey" PRIMARY KEY ("eventId", "userId")
);

CREATE INDEX "CalendarEventGuest_userId_idx" ON "CalendarEventGuest"("userId");
CREATE INDEX "CalendarEventGuest_companyId_idx" ON "CalendarEventGuest"("companyId");

-- Cascade nos dois lados: evento apagado leva os convites junto, e pessoa
-- excluída não deixa linha órfã apontando para id que não existe mais.
ALTER TABLE "CalendarEventGuest"
  ADD CONSTRAINT "CalendarEventGuest_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventGuest"
  ADD CONSTRAINT "CalendarEventGuest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventGuest"
  ADD CONSTRAINT "CalendarEventGuest_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tipo novo de notificação: o convite em si. O lembrete de antecedência
-- (CALENDAR_EVENT_REMINDER) já existia e continua sendo outro aviso.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CALENDAR_EVENT_INVITED';
