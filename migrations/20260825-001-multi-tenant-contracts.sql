-- Migración: Soporte para Multi-Tenant bajo Contratos y Capacidad Heredada por Tier
-- Agrega parent_tenant_id, contract_id y additional_tenant_slots a la tabla Tenants

ALTER TABLE Tenants ADD COLUMN parent_tenant_id VARCHAR(255) NULL;
ALTER TABLE Tenants ADD COLUMN contract_id VARCHAR(255) NULL;
ALTER TABLE Tenants ADD COLUMN additional_tenant_slots INT NOT NULL DEFAULT 0;

CREATE INDEX idx_tenants_parent_tenant_id ON Tenants (parent_tenant_id);
CREATE INDEX idx_tenants_contract_id ON Tenants (contract_id);
