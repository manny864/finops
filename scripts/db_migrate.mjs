import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.development' });
dotenv.config({ path: '.env' });

async function run() {
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    const query = `
        CREATE TABLE IF NOT EXISTS CostCenterBudgets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id VARCHAR(255) NOT NULL,
            cost_center_name VARCHAR(255) NOT NULL,
            monthly_budget_usd DECIMAL(10,2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_tenant_costcenter (tenant_id, cost_center_name)
        )
    `;
    
    try {
        await pool.query(query);
        console.log("Tabla CostCenterBudgets verificada/creada con éxito.");
    } catch (e) {
        console.error("Error al crear tabla:", e);
    }
    process.exit(0);
}

run();
