-- Fase 4 de la propuesta de IA (sección 6.7): facturas y contratos de gasto
-- externo (licencias, SaaS, soporte, consultoría) leídos con Azure AI Document
-- Intelligence y revisados por una persona.
--
-- GASTO EXTERNO: nunca va a CostSnapshots ni entra en la detección de
-- anomalías. Sólo lo aprobado aparece en los reportes, siempre etiquetado.
--
-- Importes en DECIMAL y en la moneda del documento. El equivalente en USD se
-- calcula al aprobar y se guarda junto con la tasa y la fecha de esa tasa,
-- para que el número no cambie cuando se actualice FxRates.
CREATE TABLE IF NOT EXISTS ExternalSpendDocuments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    -- COLLATE explícito por la FK, igual que en 20260927-003.
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    doc_type ENUM('invoice', 'contract') NOT NULL,
    status ENUM('uploaded', 'extracting', 'needs_review', 'approved', 'rejected', 'failed') NOT NULL DEFAULT 'uploaded',
    original_name VARCHAR(255) NOT NULL,
    -- <uuid>.<ext> en el container privado. NULL cuando la retención ya borró
    -- el original: lo extraído y lo revisado quedan.
    stored_name VARCHAR(64) NULL,
    mime_type VARCHAR(64) NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
    vendor_name VARCHAR(255) NULL,
    invoice_number VARCHAR(128) NULL,
    invoice_date DATE NULL,
    due_date DATE NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    currency CHAR(3) NULL,
    subtotal DECIMAL(18,4) NULL,
    tax DECIMAL(18,4) NULL,
    total DECIMAL(18,4) NULL,
    total_usd DECIMAL(18,4) NULL,
    -- Unidades de `currency` por 1 USD, como FxRates.rate.
    fx_rate DECIMAL(18,8) NULL,
    fx_rate_date DATE NULL,
    -- Lo que devolvió el modelo, ya mapeado y sin editar: la revisión pisa las
    -- columnas, no este JSON.
    extraction_json JSON NULL,
    validation_issues JSON NULL,
    model_id VARCHAR(64) NULL,
    api_version VARCHAR(32) NULL,
    confidence DECIMAL(5,4) NULL,
    pages SMALLINT UNSIGNED NULL,
    -- URL que devuelve el análisis asíncrono y que consulta el cron.
    operation_location VARCHAR(1024) NULL,
    error_message VARCHAR(500) NULL,
    uploaded_by VARCHAR(255) NULL,
    reviewed_by VARCHAR(255) NULL,
    reviewed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- El mismo archivo dos veces en el mismo tenant es un duplicado.
    UNIQUE KEY uq_esd_tenant_sha256 (tenant_id, sha256),
    KEY idx_esd_status (status, updated_at),
    CONSTRAINT fk_esd_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ExternalSpendLines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT NOT NULL,
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    line_no SMALLINT UNSIGNED NOT NULL,
    description VARCHAR(500) NULL,
    quantity DECIMAL(18,4) NULL,
    unit_price DECIMAL(18,6) NULL,
    amount DECIMAL(18,4) NULL,
    currency CHAR(3) NULL,
    service_category VARCHAR(100) NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    cost_center VARCHAR(100) NULL,
    confidence DECIMAL(5,4) NULL,
    KEY idx_esl_document (document_id, line_no),
    CONSTRAINT fk_esl_document FOREIGN KEY (document_id) REFERENCES ExternalSpendDocuments (id) ON DELETE CASCADE,
    CONSTRAINT fk_esl_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE
);
