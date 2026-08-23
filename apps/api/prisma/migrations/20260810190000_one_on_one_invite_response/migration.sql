-- Aceite de convite do 1:1.
--
-- A resposta mora na SÉRIE; a ocorrência só sobrescreve (coluna nulável, onde
-- `null` significa "segue a série"). Pôr a resposta em cada encontro criaria 52
-- pendências para uma série semanal de um ano — e escondê-las na tela seria
-- paliativo de UI sobre um modelo errado.
CREATE TYPE "OneOnOneInviteResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

ALTER TABLE "OneOnOneSeries"
  ADD COLUMN "inviteeResponse" "OneOnOneInviteResponse" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "inviteeRespondedAt" TIMESTAMP(3);

-- `proposedStartsAt` e `declineNote` são sempre da ocorrência, mesmo quando a
-- recusa vale para a série: o que se propõe é um horário concreto.
ALTER TABLE "OneOnOneMeeting"
  ADD COLUMN "inviteeResponse" "OneOnOneInviteResponse",
  ADD COLUMN "inviteeRespondedAt" TIMESTAMP(3),
  ADD COLUMN "proposedStartsAt" TIMESTAMP(3),
  ADD COLUMN "declineNote" TEXT;

-- Séries que já existem nasceram sem aceite nenhum; tratá-las como pendentes
-- encheria a tela de todo mundo de convite a responder para encontro combinado
-- meses atrás. O passado entra como aceito.
UPDATE "OneOnOneSeries" SET "inviteeResponse" = 'ACCEPTED', "inviteeRespondedAt" = NOW();

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ONE_ON_ONE_RESPONDED';
ALTER TYPE "NotificationType" ADD VALUE 'ONE_ON_ONE_PROPOSAL_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'ONE_ON_ONE_PROPOSAL_DECLINED';
