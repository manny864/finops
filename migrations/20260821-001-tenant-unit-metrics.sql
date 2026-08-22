-- Unit Economics multi-métrica.
--
-- Contexto: `BusinessMetrics` (20260701-002) soporta una sola métrica de negocio
-- —DAU— en una columna fija. Unit Economics necesita seis tipos (DAU, MAU,
-- TRANSACTIONS, API_CALLS, AI_TOKENS, STORAGE_TB) y un tenant puede seguir más
-- de una a la vez, así que la métrica pasa de columna a fila.
--
-- Esta migración NO borra `BusinessMetrics`: la ruta legacy sigue leyéndola y
-- el paso 3 copia su historial de DAU a la tabla nueva para no perder datos.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, INSERT IGNORE y ALTER condicionados
-- por INFORMATION_SCHEMA.

-- 1. Serie diaria de unidades de negocio, una fila por tenant/fecha/métrica.
CREATE TABLE IF NOT EXISTS TenantUnitMetrics (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id     VARCHAR(36) NOT NULL,
    metric_date   DATE NOT NULL,
    metric_type   ENUM('DAU','MAU','TRANSACTIONS','API_CALLS','AI_TOKENS','STORAGE_TB') NOT NULL,
    -- DECIMAL y no INT: STORAGE_TB y AI_TOKENS (en millones) son fraccionarios,
    -- y Regla Cero prohíbe floats en cualquier magnitud que alimente un cálculo
    -- de costo. El costo unitario divide por este valor.
    unit_count    DECIMAL(20,4) NOT NULL DEFAULT 0,
    -- Trazabilidad del origen: un valor cargado a mano no merece la misma
    -- confianza que uno ingerido por webhook desde el sistema de facturación.
    source        ENUM('Manual','Webhook','Csv') NOT NULL DEFAULT 'Manual',
    notes         VARCHAR(255),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_date_metric (tenant_id, metric_date, metric_type),
    INDEX idx_tenant_metric_date (tenant_id, metric_type, metric_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Configuración de Unit Economics por tenant: métrica primaria, meta de
--    costo unitario y umbral de alerta de desvío.
CREATE TABLE IF NOT EXISTS TenantUnitEconomicsConfig (
    tenant_id                  VARCHAR(36) PRIMARY KEY,
    primary_metric             ENUM('DAU','MAU','TRANSACTIONS','API_CALLS','AI_TOKENS','STORAGE_TB') NOT NULL DEFAULT 'DAU',
    -- DECIMAL(18,8): el costo por llamada API o por token puede ser del orden
    -- de 0.00001 USD. Con menos escala la meta se redondearía a cero.
    target_cost_per_unit_usd   DECIMAL(18,8) NOT NULL DEFAULT 0,
    alert_threshold_percentage DECIMAL(6,2) NOT NULL DEFAULT 15.00,
    ingestion_mode             ENUM('Manual','Webhook','Csv') NOT NULL DEFAULT 'Manual',
    updated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Backfill del historial de DAU existente. INSERT IGNORE respeta la clave
--    única, así que re-ejecutar la migración no duplica ni pisa valores que el
--    tenant haya corregido después en la tabla nueva.
INSERT IGNORE INTO TenantUnitMetrics (tenant_id, metric_date, metric_type, unit_count, source, notes)
SELECT tenant_id, metric_date, 'DAU', dau, 'Manual', 'Migrado desde BusinessMetrics'
FROM BusinessMetrics
WHERE dau IS NOT NULL AND dau > 0;

-- 4. Sembrar la config a partir del DAU estimado que ya tenga cada tenant, para
--    que Unit Economics arranque con la métrica correcta en vez del default.
INSERT IGNORE INTO TenantUnitEconomicsConfig (tenant_id, primary_metric, target_cost_per_unit_usd)
SELECT tenant_id, 'DAU', 0 FROM BusinessMetricsConfig WHERE estimated_dau > 0;

-- 5. `BusinessMetricsConfig` gana el DAU estimado como fallback global de la
--    métrica primaria. Condicionado por INFORMATION_SCHEMA para ser idempotente
--    en MySQL, que no admite ADD COLUMN IF NOT EXISTS.
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'BusinessMetricsConfig'
    AND COLUMN_NAME = 'estimated_units'
);

SET @ddl := IF(
  @has_col = 0,
  'ALTER TABLE BusinessMetricsConfig ADD COLUMN estimated_units DECIMAL(20,4) NOT NULL DEFAULT 0 AFTER estimated_dau',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. Copiar el estimado existente a la columna nueva, sin pisar un valor ya
--    cargado por el usuario.
UPDATE BusinessMetricsConfig
SET estimated_units = estimated_dau
WHERE estimated_units = 0 AND estimated_dau > 0;
