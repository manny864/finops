-- Migración 20260821-003: Tablas para Auditoría de Zombis (ZombieExemptions y LocalResourceTagsCache)
-- Permite suprimir zombis con justificación/expiración y caché optimista de tags FinOps.

CREATE TABLE IF NOT EXISTS ZombieExemptions (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    resource_id VARCHAR(512) NOT NULL,
    resource_name VARCHAR(255) NOT NULL,
    resource_type VARCHAR(128) NOT NULL DEFAULT 'unknown',
    exemption_reason VARCHAR(255) NOT NULL DEFAULT 'Eximida por el usuario',
    exempted_by VARCHAR(255) NULL,
    exempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    UNIQUE KEY idx_zombie_tenant_res (tenant_id, resource_id(255)),
    INDEX idx_zombie_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS LocalResourceTagsCache (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    resource_id VARCHAR(512) NOT NULL,
    tags_json JSON NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_tags_tenant_res (tenant_id, resource_id(255)),
    INDEX idx_tags_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
