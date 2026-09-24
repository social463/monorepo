-- Regime de contratação, para efeito de férias.
--
-- NÃO é o mesmo que `THIRD_PARTY`, que é acesso restrito por allowlist: o PJ é
-- membro pleno do time, com contrato diferente. Sem esta distinção ele recebia
-- o padrão da CLT — 30 dias e as cinco combinações — que não é o dele.
--
-- `CLT` como padrão: é o caso da esmagadora maioria, e ninguém precisa ser
-- remarcado para continuar como está.

CREATE TYPE "EmploymentType" AS ENUM ('CLT', 'PJ');

ALTER TABLE "User" ADD COLUMN "employmentType" "EmploymentType" NOT NULL DEFAULT 'CLT';
