-- Migración 20260822-001: soporte para Alta Disponibilidad, Credenciales de
-- Entra ID y Aprobaciones de Remediación.
--
-- 1. HaExemptions       — exenciones justificadas de recomendaciones de HA
--                         (cargas dev/test que no ameritan redundancia).
-- 2. CredentialAlertRules — reglas de aviso previo al vencimiento de secretos
--                         y certificados de Entra ID.
-- 3. RemediationRequests — se extiende con los campos que el flujo de
--                         aprobación necesita para ejecutar en ARM y dejar
--                         traza: hasta ahora aprobar sólo cambiaba el estado
--                         en la tabla y no ejecutaba nada en Azure.
--
-- Todo idempotente: el runner tolera ER_DUP_FIELDNAME / ER_TABLE_EXISTS_ERROR,
-- pero los ALTER se guardan igual detrás de INFORMATION_SCHEMA para que una
-- reaplicación no ensucie el log con errores esperados.

CREATE TABLE IF NOT EXISTS HaExemptions (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    recommendation_id VARCHAR(512) NOT NULL,
    resource_id VARCHAR(512) NOT NULL,
    resource_name VARCHAR(255) NOT NULL,
    issue_category VARCHAR(64) NOT NULL,
    exemption_reason VARCHAR(500) NOT NULL DEFAULT 'Carga no productiva (dev/test)',
    exempted_by VARCHAR(255) NULL,
    exempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    UNIQUE KEY idx_ha_tenant_rec (tenant_id, recommendation_id(200)),
    INDEX idx_ha_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS CredentialAlertRules (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    -- CSV de umbrales en días, del mayor al menor: "60,30,7".
    warning_thresholds_days VARCHAR(64) NOT NULL DEFAULT '30',
    -- JSON array: ["EMAIL","TEAMS","SLACK","WEBHOOK"].
    notification_channels JSON NOT NULL,
    -- JSON array de destinatarios (mails o URLs de webhook).
    recipients JSON NOT NULL,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_triggered_at DATETIME NULL,
    created_by VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_cred_tenant_name (tenant_id, rule_name),
    INDEX idx_cred_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── RemediationRequests: campos del flujo de aprobación ──────────────────────

SET @db := DATABASE();

SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests' AND COLUMN_NAME = 'resource_type') = 0,
    'ALTER TABLE RemediationRequests ADD COLUMN resource_type VARCHAR(128) NULL AFTER resource_name',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests' AND COLUMN_NAME = 'resource_group') = 0,
    'ALTER TABLE RemediationRequests ADD COLUMN resource_group VARCHAR(128) NULL AFTER resource_type',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests' AND COLUMN_NAME = 'subscription_id') = 0,
    'ALTER TABLE RemediationRequests ADD COLUMN subscription_id VARCHAR(64) NULL AFTER resource_group',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Payload tipado de la acción (nuevo SKU, tier destino, etc.). Lo consume el
-- ejecutor de ARM al aprobar.
SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests' AND COLUMN_NAME = 'action_payload_json') = 0,
    'ALTER TABLE RemediationRequests ADD COLUMN action_payload_json JSON NULL AFTER action_type',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests' AND COLUMN_NAME = 'rejection_reason') = 0,
    'ALTER TABLE RemediationRequests ADD COLUMN rejection_reason VARCHAR(500) NULL AFTER resolved_by',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Resultado crudo de la llamada a ARM: sin esto, una aprobación que Azure
-- rechaza queda indistinguible de una exitosa en el historial.
SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests' AND COLUMN_NAME = 'arm_execution_result_json') = 0,
    'ALTER TABLE RemediationRequests ADD COLUMN arm_execution_result_json JSON NULL AFTER rejection_reason',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ID del snapshot de seguridad creado antes de un borrado, para poder revertir.
SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests' AND COLUMN_NAME = 'backup_snapshot_id') = 0,
    'ALTER TABLE RemediationRequests ADD COLUMN backup_snapshot_id VARCHAR(512) NULL AFTER arm_execution_result_json',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- El enum original no contemplaba 'Failed': una aprobación cuya ejecución en
-- ARM falla quedaba marcada 'Approved', igual que una que sí se aplicó.
SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests'
       AND COLUMN_NAME = 'status' AND COLUMN_TYPE NOT LIKE '%Failed%') = 1,
    'ALTER TABLE RemediationRequests MODIFY COLUMN status ENUM(''Pending'',''Approved'',''Rejected'',''Failed'') DEFAULT ''Pending''',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'RemediationRequests' AND INDEX_NAME = 'idx_rr_tenant_status') = 0,
    'CREATE INDEX idx_rr_tenant_status ON RemediationRequests (tenant_id, status)',
    'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
