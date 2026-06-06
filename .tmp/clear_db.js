require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'finops_user',
        password: process.env.DB_PASSWORD || 'finopspassword',
        database: process.env.DB_NAME || 'finops_app',
        port: Number(process.env.DB_PORT || 3306)
    });
    try {
        await pool.query('SET FOREIGN_KEY_CHECKS = 0');
        await pool.query('TRUNCATE TABLE CostCenterBudgets');
        await pool.query('TRUNCATE TABLE TaggingPolicies');
        await pool.query('TRUNCATE TABLE Users');
        await pool.query('TRUNCATE TABLE Tenants');
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log("Base de datos vaciada exitosamente.");
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
