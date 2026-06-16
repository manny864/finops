import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'finops_user',
    password: process.env.DB_PASSWORD || 'finopspassword',
    database: process.env.DB_NAME || 'finops_app',
    port: Number(process.env.DB_PORT || 3306)
});

let dbInitialized = false;

export async function initializeDatabase() {
    if (dbInitialized) return;
    try {
        const connection = await pool.getConnection();
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS Tenants (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) UNIQUE NOT NULL,
                company_name VARCHAR(255),
                client_id VARCHAR(255),
                client_secret VARCHAR(255),
                status VARCHAR(50) DEFAULT 'active',
                webhook_url VARCHAR(255),
                tier ENUM('Essential', 'Professional', 'Business', 'Enterprise') DEFAULT 'Essential',
                trial_ends_at DATETIME NULL,
                subscription_status ENUM('TRIAL', 'ACTIVE', 'EXPIRED') DEFAULT 'ACTIVE',
                last_sync_at TIMESTAMP NULL,
                sync_status VARCHAR(50) DEFAULT 'OK',
                last_error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Check if webhook_url exists for backward compatibility
        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN webhook_url VARCHAR(255);');
        } catch (e: any) {
            // Ignore Duplicate column error
            if (e.code !== 'ER_DUP_FIELDNAME') {
                console.error("Error adding webhook_url:", e);
            }
        }

        // Add last_sync_at, sync_status, and last_error_message if they don't exist
        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN last_sync_at TIMESTAMP NULL;');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding last_sync_at:", e);
        }

        try {
            await connection.query("ALTER TABLE Tenants ADD COLUMN sync_status VARCHAR(50) DEFAULT 'OK';");
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding sync_status:", e);
        }

        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN last_error_message TEXT NULL;');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding last_error_message:", e);
        }

        // Add client_id and client_secret if they don't exist
        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN client_id VARCHAR(255);');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding client_id:", e);
        }

        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN client_secret VARCHAR(255);');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding client_secret:", e);
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                entra_oid VARCHAR(255) UNIQUE NOT NULL,
                tenant_id VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                role VARCHAR(50) DEFAULT 'admin',
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS TaggingPolicies (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                tag_key VARCHAR(255) NOT NULL,
                required BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS CostCenterBudgets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                cost_center_name VARCHAR(255) NOT NULL,
                monthly_budget_usd DECIMAL(10,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_tenant_costcenter (tenant_id, cost_center_name),
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS SavingsHistory (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                scan_date DATE NOT NULL,
                total_wasted_usd DECIMAL(10,2) NOT NULL,
                potential_savings_usd DECIMAL(10,2) NOT NULL,
                UNIQUE KEY unique_scan (tenant_id, scan_date),
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ActionLogs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                user_email VARCHAR(255) NOT NULL,
                action_type VARCHAR(50) NOT NULL,
                resource_id VARCHAR(255) NOT NULL,
                status VARCHAR(20) NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS GlobalSettings (
                setting_key VARCHAR(50) PRIMARY KEY,
                setting_value TEXT NOT NULL
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS AiCache (
                hash_prompt VARCHAR(64) PRIMARY KEY,
                response_text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS CostSnapshots (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(100) NOT NULL,
                subscription_id VARCHAR(100) DEFAULT 'default',
                date DATE NOT NULL,
                resource_group VARCHAR(100) NOT NULL,
                service_name VARCHAR(100) NOT NULL,
                cost_usd DECIMAL(12, 4) NOT NULL,
                currency VARCHAR(10) DEFAULT 'USD',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY unique_tenant_date_rg_service_sub (tenant_id, subscription_id, date, resource_group, service_name)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS RecommendationsCache (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                recommendation_type VARCHAR(255) NOT NULL,
                potential_savings DECIMAL(12, 4) NOT NULL,
                snapshot_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY unique_tenant_rec_type_date (tenant_id, recommendation_type, snapshot_date)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS cost_snapshots (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255),
                sync_date DATE,
                total_cost_usd DECIMAL(10,2),
                currency VARCHAR(10),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_tenant_sync_date (tenant_id, sync_date)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS tenant_health (
                tenant_id VARCHAR(255) PRIMARY KEY,
                last_sync_at TIMESTAMP,
                sync_status VARCHAR(50),
                last_error TEXT
            )
        `);

        connection.release();
        dbInitialized = true;
        console.log("Database schema validated/initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize database schema:", error);
    }
}

export async function insertCostSnapshot(tenantId: string, date: string, cost: number, currency: string) {
    await pool.query(
        `INSERT INTO cost_snapshots (tenant_id, sync_date, total_cost_usd, currency)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE total_cost_usd = VALUES(total_cost_usd), currency = VALUES(currency)`,
        [tenantId, date, cost, currency]
    );
}

export async function updateTenantHealth(tenantId: string, status: string, errorMsg?: string) {
    await pool.query(
        `INSERT INTO tenant_health (tenant_id, last_sync_at, sync_status, last_error)
         VALUES (?, CURRENT_TIMESTAMP, ?, ?)
         ON DUPLICATE KEY UPDATE last_sync_at = CURRENT_TIMESTAMP, sync_status = VALUES(sync_status), last_error = VALUES(last_error)`,
        [tenantId, status, errorMsg || null]
    );
}

export default pool;
