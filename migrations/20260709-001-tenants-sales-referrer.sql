-- 20260709-001-tenants-sales-referrer.sql
-- Etiquetado de tenants por origen comercial (SUPERADMIN): permite identificar
-- qué comercial/referente vendió o refirió a cada cliente, para tracking de
-- ventas. Solo lectura/escritura vía SUPERADMIN (requireSuperAdmin), nunca
-- expuesto a usuarios del tenant.
--
-- Idempotente: el runner ignora ER_DUP_FIELDNAME (columna ya existe).

ALTER TABLE Tenants
  ADD COLUMN sales_referrer VARCHAR(255) NULL;

ALTER TABLE Tenants
  ADD COLUMN sales_referrer_updated_by VARCHAR(320) NULL;

ALTER TABLE Tenants
  ADD COLUMN sales_referrer_updated_at DATETIME NULL;
