
CREATE TABLE IF NOT EXISTS Tenants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
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
