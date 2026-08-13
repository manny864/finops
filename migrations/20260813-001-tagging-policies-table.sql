-- Create TaggingPolicies table for governance/tags mandatory tagging policies
CREATE TABLE IF NOT EXISTS TaggingPolicies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    policy_name VARCHAR(255) NOT NULL,
    is_required TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tenant_policy (tenant_id, policy_name),
    INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default policies for all existing tenants if they don't exist.
-- Intentionally avoid explicit column names to stay compatible with
-- pre-existing camelCase schemas in some environments.
INSERT IGNORE INTO TaggingPolicies
SELECT NULL, tenant_id, 'Environment', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM (SELECT DISTINCT tenant_id FROM Users) t
UNION ALL
SELECT NULL, tenant_id, 'Role', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM (SELECT DISTINCT tenant_id FROM Users) t
UNION ALL
SELECT NULL, tenant_id, 'CostCenter', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM (SELECT DISTINCT tenant_id FROM Users) t
UNION ALL
SELECT NULL, tenant_id, 'Department', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM (SELECT DISTINCT tenant_id FROM Users) t;
