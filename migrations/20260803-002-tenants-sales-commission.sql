-- 20260803-002-tenants-sales-commission.sql
-- Metadata comercial por tenant (solo SUPERADMIN): porcentaje de comisión
-- para cálculo operativo de pagos a vendedores/referidos.
--
-- Idempotente: el runner ignora ER_DUP_FIELDNAME si la columna ya existe.

ALTER TABLE Tenants
  ADD COLUMN sales_commission_pct DECIMAL(5,2) NULL;

ALTER TABLE Tenants
  ADD COLUMN sales_commission_updated_by VARCHAR(320) NULL;

ALTER TABLE Tenants
  ADD COLUMN sales_commission_updated_at DATETIME NULL;
