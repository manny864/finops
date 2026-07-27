-- Completa las columnas FOCUS faltantes en CostSnapshots.
--
-- El comentario de 20260629-007-aws-accounts.sql afirmaba que CostSnapshots
-- "ya tiene ProviderName, BillingAccountId, ...". Es falso: la lista
-- focusColumns de src/modules/storage/db.ts nunca incluyo BillingAccountId ni
-- AmortizedCost, y ninguna ruta de sync los escribia. Sin BillingAccountId no
-- se puede distinguir la cuenta pagadora (AWS payer / Azure tenant) del
-- SubAccountId, que es justamente el eje de agrupacion que pide FOCUS para
-- multi-cloud.
--
-- El runner de migraciones ignora ER_DUP_FIELDNAME (ver
-- src/modules/storage/migrations.ts), asi que un ALTER ADD COLUMN plano es
-- idempotente.

ALTER TABLE CostSnapshots ADD COLUMN BillingAccountId VARCHAR(100) NULL;

ALTER TABLE CostSnapshots ADD COLUMN AmortizedCost DECIMAL(12,4) NULL;

CREATE INDEX idx_provider_billing_account ON CostSnapshots (tenant_id, ProviderName, BillingAccountId);
