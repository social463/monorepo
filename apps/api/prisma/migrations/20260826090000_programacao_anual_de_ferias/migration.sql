-- Programação anual de férias (fase 1).
-- Spec: docs/superpowers/specs/2026-08-25-programacao-anual-de-ferias-design.md
--
-- Quatro tabelas novas e dois campos. Nada é apagado: o `Vacation` que já
-- existe continua sendo o registro de férias, e ganha só o vínculo opcional com
-- o período do plano que o gerou.

CREATE TYPE "VacationPlanStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VALIDATED');

-- Data-base de férias. Null é o caso normal (vale a admissão); só o afastamento
-- pelo INSS acima de 180 dias a preenche, com a data de volta.
ALTER TABLE "User" ADD COLUMN "vacationAnchorDate" DATE;

CREATE TABLE "VacationCampaign" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "opensAt" DATE NOT NULL,
    "deadline" DATE NOT NULL,
    "manuallyLocked" BOOLEAN NOT NULL DEFAULT false,
    "policy" JSONB NOT NULL,
    "noticeTemplate" TEXT NOT NULL DEFAULT '',
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VacationCampaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VacationCampaign_companyId_year_key" ON "VacationCampaign"("companyId", "year");
CREATE INDEX "VacationCampaign_companyId_idx" ON "VacationCampaign"("companyId");

CREATE TABLE "VacationEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acquisitionStart" DATE NOT NULL,
    "acquisitionEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "balanceDays" INTEGER NOT NULL DEFAULT 30,
    "note" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VacationEntitlement_pkey" PRIMARY KEY ("id")
);

-- A chave é (empresa, pessoa, fim do aquisitivo) — e não o nome, como na
-- ferramenta de origem, onde corrigir o nome de alguém órfã a programação dela.
CREATE UNIQUE INDEX "VacationEntitlement_companyId_userId_acquisitionEnd_key"
    ON "VacationEntitlement"("companyId", "userId", "acquisitionEnd");
CREATE INDEX "VacationEntitlement_companyId_dueDate_idx" ON "VacationEntitlement"("companyId", "dueDate");
CREATE INDEX "VacationEntitlement_userId_idx" ON "VacationEntitlement"("userId");

CREATE TABLE "VacationPlan" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "sellDays" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "VacationPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "changeRequested" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "unlockedUntil" TIMESTAMP(3),
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VacationPlan_pkey" PRIMARY KEY ("id")
);

-- Um plano por (campanha, direito) — e não por pessoa: 26 das 86 pessoas da
-- planilha têm DOIS períodos aquisitivos em aberto.
CREATE UNIQUE INDEX "VacationPlan_campaignId_entitlementId_key" ON "VacationPlan"("campaignId", "entitlementId");
CREATE INDEX "VacationPlan_companyId_status_idx" ON "VacationPlan"("companyId", "status");

CREATE TABLE "VacationPlanPeriod" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "soldDays" INTEGER NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VacationPlanPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VacationPlanPeriod_planId_idx" ON "VacationPlanPeriod"("planId");
CREATE INDEX "VacationPlanPeriod_companyId_startDate_idx" ON "VacationPlanPeriod"("companyId", "startDate");

-- O vínculo entre o período programado e o registro de férias que ele gerou.
ALTER TABLE "Vacation" ADD COLUMN "planPeriodId" TEXT;
CREATE UNIQUE INDEX "Vacation_planPeriodId_key" ON "Vacation"("planPeriodId");

ALTER TABLE "VacationCampaign" ADD CONSTRAINT "VacationCampaign_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VacationEntitlement" ADD CONSTRAINT "VacationEntitlement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacationEntitlement" ADD CONSTRAINT "VacationEntitlement_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VacationPlan" ADD CONSTRAINT "VacationPlan_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "VacationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacationPlan" ADD CONSTRAINT "VacationPlan_entitlementId_fkey"
    FOREIGN KEY ("entitlementId") REFERENCES "VacationEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacationPlan" ADD CONSTRAINT "VacationPlan_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VacationPlan" ADD CONSTRAINT "VacationPlan_validatedById_fkey"
    FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VacationPlan" ADD CONSTRAINT "VacationPlan_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VacationPlanPeriod" ADD CONSTRAINT "VacationPlanPeriod_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "VacationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacationPlanPeriod" ADD CONSTRAINT "VacationPlanPeriod_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SetNull, e não Cascade: apagar o plano não pode apagar as férias de alguém
-- que já foram validadas e já estão no calendário do time.
ALTER TABLE "Vacation" ADD CONSTRAINT "Vacation_planPeriodId_fkey"
    FOREIGN KEY ("planPeriodId") REFERENCES "VacationPlanPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Aviso ao colaborador quando a G&G valida a programação dele. É o que a G&G
-- pediu no lugar do recibo assinado, que segue com a Contabilidade.
-- `ADD VALUE` em transação é aceito desde o Postgres 12, contanto que o valor
-- não seja usado no mesmo bloco — e não é.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VACATION_PLAN_VALIDATED';
