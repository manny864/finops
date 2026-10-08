-- Fase 4 de la propuesta de IA (sección 6.7): compromisos con proveedores
-- (EA, MACC, savings plans, reservas, suscripciones SaaS) cargados a mano o
-- desde un contrato revisado.
--
-- Son fechas y montos firmados, no consumo: no van a CostSnapshots. El cron de
-- gasto externo avisa antes de la fecha de preaviso de la renovación.
CREATE TABLE IF NOT EXISTS Commitments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    -- COLLATE explícito por la FK, igual que en 20260927-003.
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    vendor_name VARCHAR(255) NOT NULL,
    commitment_type ENUM('EA', 'MACC', 'savings_plan', 'reservation', 'saas_subscription', 'other') NOT NULL,
    amount DECIMAL(18,4) NOT NULL,
    currency CHAR(3) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    -- NULL = se renueva (o vence) en end_date.
    renewal_date DATE NULL,
    notice_days SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    auto_renew TINYINT(1) NOT NULL DEFAULT 0,
    source_document_id BIGINT NULL,
    created_by VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_commitments_tenant (tenant_id, end_date),
    CONSTRAINT fk_commitments_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_commitments_document FOREIGN KEY (source_document_id) REFERENCES ExternalSpendDocuments (id) ON DELETE SET NULL
);
