-- FOCUS 1.1 Export prometía en el manual "programable para generación diaria
-- automática" — solo existía la búsqueda manual por rango de fechas. Esta
-- tabla guarda, por tenant, si está habilitada la generación diaria y a qué
-- email se manda (adjunto CSV/JSON), evaluada por el cron
-- /api/cron/focus-export-daily.
CREATE TABLE IF NOT EXISTS FocusExportSchedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    format ENUM('csv', 'json') NOT NULL DEFAULT 'csv',
    subscription_id VARCHAR(255) NULL,
    recipient_email VARCHAR(255) NOT NULL,
    last_run_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
