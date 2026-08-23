-- Medición real de la cuota de APIs de Azure (serie temporal por tenant).
--
-- Hasta ahora el panel de Estado de Cuenta mostraba "94%" como literal. Azure
-- publica el remanente en headers de cada respuesta; esta tabla guarda esas
-- observaciones para poder responder tanto "¿cómo estoy ahora?" como "¿desde
-- cuándo vengo ajustado?".
--
-- Tabla nueva y no columnas en `Tenants` porque es append-only con N filas por
-- tenant a lo largo del tiempo (1:N), a diferencia de la configuración que es
-- 1:1. Ninguna tabla existente sirve: `SystemCronRuns` no tiene tenant_id y
-- `tenant_health` tiene PK en tenant_id (estado actual, no histórico).
--
-- La escritura está amortiguada en `src/lib/azureQuotaTracking.ts`: a lo sumo
-- una fila por (tenant, fuente) por minuto, guardando el mínimo observado en la
-- ventana. Con 130 call sites de Resource Graph, una fila por respuesta serían
-- miles por sincronización.

CREATE TABLE IF NOT EXISTS ApiQuotaSamples (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    -- Los tres límites tienen semánticas y magnitudes distintas; se guardan por
    -- separado y se comparan sólo ya normalizados a porcentaje.
    source ENUM('RESOURCE_GRAPH','COST_MANAGEMENT','ARM') NOT NULL,
    -- Remanente crudo tal como lo devolvió Azure.
    remaining INT NOT NULL,
    -- Techo usado para normalizar. NULL cuando Azure no lo publica y todavía no
    -- se observó uno; en ese caso remaining_percentage también es NULL.
    ceiling INT NULL,
    -- NULL = no se pudo normalizar. La UI muestra "Sin medir" en vez de inventar.
    remaining_percentage TINYINT UNSIGNED NULL,
    -- Sólo Resource Graph lo publica.
    resets_after_seconds INT NULL,
    observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- El panel busca la última muestra por fuente dentro de una ventana.
    INDEX idx_tenant_source_observed (tenant_id, source, observed_at),
    -- La purga por retención barre por fecha.
    INDEX idx_observed (observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
