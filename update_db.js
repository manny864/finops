require('dotenv').config({ path: '.env.development' });
const mysql = require('mysql2/promise');
async function run() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || '192.168.65.1',
        user: process.env.DB_USER || 'finops_user',
        password: process.env.DB_PASSWORD || 'finops_pass',
        database: process.env.DB_NAME || 'finops_db',
        port: Number(process.env.DB_PORT) || 3307
    });
    try {
        await pool.query("ALTER TABLE Tenants ADD COLUMN tier ENUM('Essential', 'Professional', 'Business', 'Enterprise') DEFAULT 'Essential';");
        await pool.query("ALTER TABLE Tenants ADD COLUMN trial_ends_at DATETIME NULL;");
        await pool.query("ALTER TABLE Tenants ADD COLUMN subscription_status ENUM('TRIAL', 'ACTIVE', 'EXPIRED') DEFAULT 'ACTIVE';");
        console.log("DB altered successfully");
    } catch (e) {
        console.error("Alter error (might already exist):", e.message);
    }
    process.exit(0);
}
run();
