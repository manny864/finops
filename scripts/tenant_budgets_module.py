import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def patch_schema_sql():
    path = os.path.join(base_dir, "src/modules/storage/schema.sql")
    with open(path, "r") as f:
        content = f.read()

    table_stmt = """
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
"""
    if "TenantMonthlyBudgets" not in content:
        with open(path, "a") as f:
            f.write(table_stmt)
        print("schema.sql patched.")
    else:
        print("schema.sql already contains TenantMonthlyBudgets.")

def patch_db_ts():
    path = os.path.join(base_dir, "src/modules/storage/db.ts")
    with open(path, "r") as f:
        content = f.read()

    table_stmt = """
        await connection.query(`
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
        `);
"""
    if "TenantMonthlyBudgets" not in content:
        # Insert before connection.release();
        parts = content.split("connection.release();")
        if len(parts) == 2:
            new_content = parts[0] + table_stmt + "\n        connection.release();" + parts[1]
            with open(path, "w") as f:
                f.write(new_content)
            print("db.ts patched.")
        else:
            print("Could not find connection.release() in db.ts")
    else:
        print("db.ts already contains TenantMonthlyBudgets.")

def create_tenant_budget_service():
    path = os.path.join(base_dir, "src/modules/storage/tenantBudget.service.ts")
    code = """import pool from './db';
import { RowDataPacket } from 'mysql2/promise';

export interface TenantBudget {
    id?: number;
    tenant_id: string;
    budget_month: number;
    budget_year: number;
    budget_usd: number;
    alert_threshold: number;
}

export async function upsertTenantBudget(
    tenant_id: string, 
    month: number, 
    year: number, 
    budget_usd: number, 
    alert_threshold: number = 80.00
): Promise<void> {
    await pool.query(
        `INSERT INTO TenantMonthlyBudgets (tenant_id, budget_month, budget_year, budget_usd, alert_threshold)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
            budget_usd = VALUES(budget_usd),
            alert_threshold = VALUES(alert_threshold)`,
        [tenant_id, month, year, budget_usd, alert_threshold]
    );
}

export async function getTenantBudgetByPeriod(
    tenant_id: string, 
    month: number, 
    year: number
): Promise<TenantBudget | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, tenant_id, budget_month, budget_year, budget_usd, alert_threshold 
         FROM TenantMonthlyBudgets 
         WHERE tenant_id = ? AND budget_month = ? AND budget_year = ?`,
        [tenant_id, month, year]
    );

    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
        id: row.id,
        tenant_id: row.tenant_id,
        budget_month: row.budget_month,
        budget_year: row.budget_year,
        budget_usd: parseFloat(row.budget_usd),
        alert_threshold: parseFloat(row.alert_threshold)
    };
}
"""
    with open(path, "w") as f:
        f.write(code)
    print("tenantBudget.service.ts created.")

def run_db_migration():
    # To assure the DB has this table without needing to restart the NextJS server immediately,
    # we can run a simple migration script in Node.
    migration_path = os.path.join(base_dir, "scripts/db_migrate_tenant_budgets.mjs")
    migration_code = """import mysql from 'mysql2/promise';
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
"""
    with open(migration_path, "w") as f:
        f.write(migration_code)
    
    os.chdir(base_dir)
    os.system(f"node {migration_path}")

if __name__ == "__main__":
    patch_schema_sql()
    patch_db_ts()
    create_tenant_budget_service()
    run_db_migration()
    print("Módulo de presupuestos de tenant creado.")
