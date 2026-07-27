-- Bootstrap core schema before incremental migrations.
-- This migration replaces legacy bootstrap DDL previously embedded in db.ts.

CREATE TABLE IF NOT EXISTS Tenants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255),
    client_id VARCHAR(255),
    client_secret VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    webhook_url VARCHAR(1024),
    tier ENUM('Essential', 'Professional', 'Business', 'Enterprise') DEFAULT 'Essential',
    trial_ends_at DATETIME NULL,
    subscription_status ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED') DEFAULT 'ACTIVE',
    is_onboarded BOOLEAN DEFAULT FALSE,
    ai_provider VARCHAR(50) DEFAULT 'system',
    ai_api_key VARCHAR(1024),
    paddle_subscription_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entra_oid VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    display_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'Admin',
    system_role VARCHAR(50) DEFAULT 'USER',
    UNIQUE KEY unique_user_tenant (entra_oid, tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);

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
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS SavingsHistory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    scan_date DATE NOT NULL,
    total_wasted_usd DECIMAL(10,2) NOT NULL,
    potential_savings_usd DECIMAL(10,2) NOT NULL
);

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
    allocation_tag_hash VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY unique_tenant_date_rg_service_sub_tag (tenant_id, subscription_id, date, resource_group, service_name, allocation_tag_hash)
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

CREATE TABLE IF NOT EXISTS tenant_health (
    tenant_id VARCHAR(255) PRIMARY KEY,
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50),
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS TenantMonthlyBudgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    budget_month TINYINT NOT NULL,
    budget_year SMALLINT NOT NULL,
    budget_usd DECIMAL(12,2) NOT NULL,
    alert_threshold DECIMAL(5,2) DEFAULT 80.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY unique_tenant_month_year (tenant_id, budget_month, budget_year)
);
