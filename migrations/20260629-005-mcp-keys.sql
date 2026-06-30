-- Feature F: MCP API Keys for tenant-scoped agent integrations
CREATE TABLE IF NOT EXISTS MCPApiKeys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    key_hash VARCHAR(128) NOT NULL,
    label VARCHAR(128) NOT NULL,
    created_by_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL,
    revoked_at TIMESTAMP NULL,
    UNIQUE KEY uniq_hash (key_hash),
    INDEX idx_tenant (tenant_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
