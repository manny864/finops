-- 20260708-001-tenants-partner-link.sql
-- Asociación de partner (PAL/CPOR) por tenant, con aprobación explícita
-- y auditable del cliente antes de tocar nada. Mismo patrón que
-- M365Proyect/saas/migrations/0009_partner_link.sql, portado a la tabla
-- Tenants (acá 1 tenant = 1 credencial Azure, sin tabla de conexiones aparte).
--
-- Idempotente: el runner ignora ER_DUP_FIELDNAME (columna ya existe).

ALTER TABLE Tenants
  ADD COLUMN partner_link_status ENUM('NONE', 'APPROVED', 'LINKED', 'FAILED', 'DECLINED') NOT NULL DEFAULT 'NONE';

ALTER TABLE Tenants
  ADD COLUMN partner_link_approved_by VARCHAR(320) NULL;

ALTER TABLE Tenants
  ADD COLUMN partner_link_approved_at DATETIME NULL;

ALTER TABLE Tenants
  ADD COLUMN partner_link_detail VARCHAR(500) NULL;
