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
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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

        connection.release();
        dbInitialized = true;
        console.log("Database schema validated/initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize database schema:", error);
    }
}

export default pool;
