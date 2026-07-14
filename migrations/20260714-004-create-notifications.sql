-- Bandeja genérica de notificaciones server-side, consumida por el hook de
-- alertas de navegador (ver src/hooks/useBrowserNotifications.ts). Todo
-- feature que genera una alerta para el usuario (no solo email/webhook)
-- inserta una fila acá vía src/lib/notify.ts::createNotification().
CREATE TABLE IF NOT EXISTS Notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message VARCHAR(1000) NOT NULL,
    href VARCHAR(500) NULL,
    severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
    source VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notifications_tenant_created (tenant_id, created_at),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
