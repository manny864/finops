CREATE TABLE IF NOT EXISTS Tenants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255),
    client_id VARCHAR(255),
    client_secret VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    webhook_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entra_oid VARCHAR(255) UNIQUE NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(50) DEFAULT 'admin',
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
\nCREATE TABLE IF NOT EXISTS SavingsHistory (\n    id INT AUTO_INCREMENT PRIMARY KEY,\n    tenant_id VARCHAR(255) NOT NULL,\n    scan_date DATE NOT NULL,\n    total_wasted_usd DECIMAL(10,2) NOT NULL,\n    potential_savings_usd DECIMAL(10,2) NOT NULL\n);\n
CREATE TABLE IF NOT EXISTS ActionLogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);

-- Note: Also ran ALTER TABLE Tenants ADD COLUMN webhook_url VARCHAR(255);

CREATE TABLE IF NOT EXISTS GlobalSettings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Budgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    cost_center_tag_value VARCHAR(255) NOT NULL,
    monthly_limit_usd DECIMAL(12,2) NOT NULL,
    alert_threshold DECIMAL(5,2) DEFAULT 80.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY unique_tenant_costcenter (tenant_id, cost_center_tag_value)
);

CREATE TABLE IF NOT EXISTS AiCache (
    hash_prompt VARCHAR(64) PRIMARY KEY,
    response_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS CostSnapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    subscription_id VARCHAR(255) DEFAULT 'default',
    date DATE NOT NULL,
    resource_group VARCHAR(255) NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    cost_usd DECIMAL(12, 4) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY unique_tenant_date_rg_service_sub (tenant_id, subscription_id, date, resource_group, service_name)
);

CREATE TABLE IF NOT EXISTS RecommendationsCache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    recommendation_type VARCHAR(255) NOT NULL,
    potential_savings DECIMAL(12, 4) NOT NULL,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY unique_tenant_rec_type_date (tenant_id, recommendation_type, snapshot_date)
);
