-- 20260629-002 — User-specific dashboard widget pins.
-- Cada usuario puede pinear widgets de cualquier página al "Mi Dashboard".

CREATE TABLE IF NOT EXISTS UserDashboardPins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_oid VARCHAR(255) NOT NULL,
    widget_key VARCHAR(100) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    settings_json JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_widget (tenant_id, user_oid, widget_key),
    INDEX idx_user (tenant_id, user_oid, position)
);
