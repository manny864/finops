-- Historial diario genérico ("de todo") con retención >= 1 año.
-- Cada fila es el snapshot del día para un (tenant, subscription_scope, domain).
-- payload: JSON serializado (LONGTEXT) con los datos que la página mostró ese día.
-- Se escribe write-through: cuando una página trae datos frescos, hace upsert de hoy.
-- Sin FK a Tenants a propósito: el registro es best-effort y no debe romper el request
-- principal aunque el tenant no exista aún; la retención por fecha limpia huérfanos.
CREATE TABLE IF NOT EXISTS DailySnapshots (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id          VARCHAR(255) NOT NULL,
    subscription_scope VARCHAR(255) NOT NULL DEFAULT 'All',
    domain             VARCHAR(64)  NOT NULL,
    snapshot_date      DATE         NOT NULL,
    payload            LONGTEXT     NOT NULL,
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_scope_domain_date (tenant_id, subscription_scope, domain, snapshot_date),
    KEY idx_tenant_domain_date (tenant_id, domain, snapshot_date),
    KEY idx_snapshot_date (snapshot_date)
);
