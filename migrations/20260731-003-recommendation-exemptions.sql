-- Migración 20260731-003: Tabla de Exenciones de Recomendaciones (Rightsizing / Governance)
-- Permite marcar recursos para que sus sugerencias de optimización sean ignoradas con justificación.

CREATE TABLE IF NOT EXISTS recommendation_exemptions (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    resource_id VARCHAR(512) NOT NULL,
    resource_name VARCHAR(255) NOT NULL,
    recommendation_type VARCHAR(64) NOT NULL DEFAULT 'rightsizing',
    reason VARCHAR(255) NOT NULL DEFAULT 'Eximida por el usuario',
    comment TEXT NULL,
    created_by VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_tenant_resource (tenant_id, resource_id(255)),
    INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
