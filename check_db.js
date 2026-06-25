const mysql = require('mysql2/promise');
require('dotenv').config({ path: '/Users/manuelchavez/Documents/FinOpsProyect/.env' });

async function check() {
    const pool = mysql.createPool(process.env.DATABASE_URL);
    const [rows] = await pool.query('SELECT id, tenant_id, name, tier FROM Tenants');
    console.log(rows);
    process.exit(0);
}
check();
