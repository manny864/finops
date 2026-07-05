-- 20260705-002-create-budgets-table.sql
-- Crea la tabla `Budgets`, que el código consulta pero que NUNCA se creaba en
-- ningún lado:
--   - db.ts sólo define CostCenterBudgets y TenantMonthlyBudgets (NO Budgets).
--   - ninguna migración previa la creaba.
-- En prod la tabla no existía → ER_NO_SUCH_TABLE ('finops_db.Budgets') rompiendo:
--   - GET /api/budgets            (SELECT * FROM Budgets)
--   - GET /api/budgets/alerts     (LEFT JOIN Budgets → Alertas Self-Service 500)
--   - POST /api/budgets           (upsert ON DUPLICATE KEY)
--   - /api/mcp y /api/exports/powerbi-feed (FROM Budgets WHERE active=1)
--
-- Esquema derivado de TODAS las queries que la tocan:
--   id, tenant_id, cost_center_tag_value, monthly_limit_usd, alert_threshold, active.
-- El upsert `ON DUPLICATE KEY UPDATE` exige la UNIQUE KEY (tenant_id, cost_center_tag_value).
-- Idempotente: IF NOT EXISTS. FK a Tenants en paridad con AlertRules (probado OK en prod).
CREATE TABLE IF NOT EXISTS Budgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    cost_center_tag_value VARCHAR(255) NOT NULL,
    monthly_limit_usd DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    alert_threshold DECIMAL(5,2) NOT NULL DEFAULT 80.00,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_budget_tenant_cc (tenant_id, cost_center_tag_value),
    INDEX idx_budgets_tenant_active (tenant_id, active),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
