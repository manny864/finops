const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env.local' });
require('dotenv').config({ path: './.env' });

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: Number(process.env.MYSQL_PORT) || 3306,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("Adding is_onboarded to Tenants...");
        await pool.query("ALTER TABLE Tenants ADD COLUMN is_onboarded BOOLEAN DEFAULT FALSE;");
    } catch(e) { console.log(e.message); }

    try {
        console.log("Adding system_role to Users...");
        await pool.query("ALTER TABLE Users ADD COLUMN system_role VARCHAR(50) DEFAULT 'USER';");
    } catch(e) { console.log(e.message); }

    try {
        console.log("Running user script...");
        await pool.query("UPDATE Users SET system_role = 'SUPERADMIN' WHERE email = 'mchavez@cscloudsolutions.com.ar';");
    } catch(e) { console.log(e.message); }

    console.log("Migration complete.");
    process.exit(0);
}
migrate();
