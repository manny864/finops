const mysql = require('mysql2/promise');

async function main() {
    try {
        const connection = await mysql.createConnection('mysql://finops_user:finopspassword@localhost:3306/finops_app');
        const [rows] = await connection.query('SELECT tenant_id, company_name, client_id FROM Tenants');
        console.log("Tenants found:", rows);
        await connection.end();
    } catch (e) {
        console.error("Error querying DB:", e);
    }
}

main();
