-- Create TaggingPolicies table for governance/tags mandatory tagging policies
CREATE TABLE IF NOT EXISTS TaggingPolicies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(36) NOT NULL,
    policyName VARCHAR(255) NOT NULL,
    isRequired TINYINT(1) DEFAULT 1,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tenant_policy (tenantId, policyName),
    INDEX idx_tenant (tenantId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default policies for all existing tenants if they don't exist
INSERT IGNORE INTO TaggingPolicies (tenantId, policyName, isRequired)
SELECT DISTINCT tenantId, 'Environment', 1 FROM Users
UNION
SELECT DISTINCT tenantId, 'Role', 1 FROM Users
UNION
SELECT DISTINCT tenantId, 'CostCenter', 1 FROM Users
UNION
SELECT DISTINCT tenantId, 'Department', 1 FROM Users;
