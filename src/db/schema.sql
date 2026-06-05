
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