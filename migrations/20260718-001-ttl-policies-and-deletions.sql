-- 20260718-001-ttl-policies-and-deletions.sql
-- Feature completa de "TTL Enforcement" (Limpieza de Nube → Expiraciones TTL):
-- el manual de usuario describía 4 pasos (crear política, etiquetar recursos,
-- alertar antes de eliminar, consultar histórico) pero la página solo hacía
-- lectura + eliminación manual de recursos ya etiquetados directamente en
-- Azure. Estas tablas habilitan los pasos 1 y 4.
--
-- TtlPolicies: regla declarativa "recursos de este tipo viven N días" —
-- usada para (a) sugerir/aplicar el tag ExpireOn a recursos existentes sin
-- etiquetar (ver /api/cleanup/ttl/unlabeled) y (b) informativa en la UI.
--
-- TtlDeletions: histórico dedicado de qué se eliminó por TTL y cuándo,
-- poblado desde /api/remediation cuando domain='ttl' (ActionLogs ya registra
-- el borrado genéricamente, pero sin resource_name/resource_type/expiration
-- necesarios para una vista de histórico útil).
CREATE TABLE IF NOT EXISTS TtlPolicies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    resource_type VARCHAR(255) NOT NULL,
    days_to_live INT NOT NULL,
    description VARCHAR(1000) NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY uq_ttl_policy (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS TtlDeletions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    resource_id VARCHAR(1000) NOT NULL,
    resource_name VARCHAR(500),
    resource_type VARCHAR(255),
    resource_group VARCHAR(255),
    expiration_date VARCHAR(50),
    deleted_by VARCHAR(255),
    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    INDEX idx_ttl_deletions_tenant (tenant_id, deleted_at)
);

-- Nuevo tipo de regla de alerta 'ttl_expiry': notifica cuando algún entorno
-- efímero vence dentro de threshold_value días (o ya venció), mismo patrón
-- que 'credential_expiry'. Evaluado por /api/cron/ttl-expiry-alerts.
ALTER TABLE AlertRules
    MODIFY COLUMN rule_type ENUM('budget','anomaly','forecast','threshold','credential_expiry','ttl_expiry') NOT NULL;
