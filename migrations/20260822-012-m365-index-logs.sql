-- Bitácora de corridas de indexación hacia Microsoft Graph.
--
-- Hasta ahora la integración Copilot M365 no registraba nada: "reindexar" sólo
-- movía `last_index_at` y el contador `indexed_records` era la constante 12500
-- escrita en el provision. Sin histórico no había forma de saber si una
-- indexación publicó items de verdad, cuántos, ni por qué falló.
--
-- Tabla nueva y no columnas en M365CopilotConfig porque es 1:N (N corridas por
-- tenant a lo largo del tiempo), a diferencia de la configuración que es 1:1 y
-- ya vive ahí.
--
-- Los campos que el spec pedía como columnas sueltas —connectionName,
-- lastIndexError, schemaVersion, autoSyncSchedule— van en el `config` JSON que
-- M365CopilotConfig ya tiene, sin ALTER sobre una tabla en uso.

CREATE TABLE IF NOT EXISTS M365IndexLogs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    trigger_type ENUM('MANUAL','SCHEDULED') NOT NULL DEFAULT 'MANUAL',
    -- Items efectivamente aceptados por Graph, no los que se intentaron.
    items_processed_count INT NOT NULL DEFAULT 0,
    duration_ms INT NOT NULL DEFAULT 0,
    -- Último status HTTP devuelto por Graph; NULL si no se llegó a llamar.
    http_status_code SMALLINT NULL,
    status ENUM('SUCCESS','FAILED') NOT NULL DEFAULT 'SUCCESS',
    error_message TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_m365logs_tenant_created (tenant_id, created_at)
    -- Sin FK a Tenants a propósito: es bitácora y debe sobrevivir a la baja del
    -- tenant, igual que ActionLogs tras 20260822-006.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
