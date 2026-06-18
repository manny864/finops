import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.development' });
dotenv.config({ path: '.env' });

async function run() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'finops_user',
        password: process.env.DB_PASSWORD || 'finopspassword',
        database: process.env.DB_NAME || 'finops_app',
        port: Number(process.env.DB_PORT || 3307),
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    const query = `
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
        )
    `;
    
    try {
        await pool.query(query);
        console.log("Tabla TenantMonthlyBudgets verificada/creada en MySQL con éxito.");
    } catch (e) {
        console.error("Error al crear tabla:", e);
    }
    process.exit(0);
}

run();
