-- 20260629-001 — Asegura que AlertRules.budget_id existe en todos los ambientes.
-- Idempotente: si la columna ya existe, el ALTER falla y el runner ignora ER_DUP_FIELDNAME.
-- Si la tabla no existe (instalación nueva), la crea con la columna desde el inicio.

CREATE TABLE IF NOT EXISTS AlertRules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    rule_type ENUM('budget','anomaly','forecast','threshold') NOT NULL,
    scope_subscription_id VARCHAR(100),
    budget_id INT NULL,
    threshold_value DECIMAL(14,4),
    threshold_unit VARCHAR(20) DEFAULT 'USD',
    comparison_operator ENUM('gt','gte','lt','lte','eq') DEFAULT 'gt',
    channel ENUM('email','webhook','teams','slack','servicenow') DEFAULT 'email',
    channel_target VARCHAR(500),
    enabled BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMP NULL,
    trigger_count INT DEFAULT 0,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    INDEX idx_alert_tenant (tenant_id, enabled)
);

-- Para ambientes con la tabla pre-existente que no traían budget_id.
-- El runner ignora ER_DUP_FIELDNAME (la columna ya existe).
ALTER TABLE AlertRules ADD COLUMN budget_id INT NULL AFTER scope_subscription_id;

-- Índice para JOIN rápido con Budgets.
CREATE INDEX idx_alert_budget ON AlertRules (budget_id);
