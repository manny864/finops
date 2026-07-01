-- Business metrics per tenant per day.
-- dau: Daily Active Users (ingresado manualmente o via API externa del tenant).
-- estimated_dau: valor estimado global cuando no hay dau diario real.
CREATE TABLE IF NOT EXISTS BusinessMetrics (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id     VARCHAR(36) NOT NULL,
    metric_date   DATE NOT NULL,
    dau           INT UNSIGNED,
    notes         VARCHAR(255),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_date (tenant_id, metric_date),
    INDEX idx_tenant_date (tenant_id, metric_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Config global de DAU estimado por tenant (cuando no hay datos diarios).
CREATE TABLE IF NOT EXISTS BusinessMetricsConfig (
    tenant_id       VARCHAR(36) PRIMARY KEY,
    estimated_dau   INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
