-- O pedido do colaborador, antes de o gestor programar.
--
-- Pedido, não promessa: quem decide é o gestor. Existir aqui é o que tira a
-- pessoa da posição de descobrir as próprias férias por e-mail, já decididas.
--
-- Um por direito (`entitlementId` único): quem tem dois períodos aquisitivos em
-- aberto pede para cada um, como já programa para cada um.

CREATE TABLE "VacationRequest" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "periods" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "companyId" TEXT NOT NULL DEFAULT 'company-emr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VacationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VacationRequest_entitlementId_key" ON "VacationRequest"("entitlementId");
CREATE INDEX "VacationRequest_companyId_idx" ON "VacationRequest"("companyId");

ALTER TABLE "VacationRequest" ADD CONSTRAINT "VacationRequest_entitlementId_fkey"
    FOREIGN KEY ("entitlementId") REFERENCES "VacationEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacationRequest" ADD CONSTRAINT "VacationRequest_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
