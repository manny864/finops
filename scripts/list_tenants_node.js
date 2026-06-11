const mysql = require('mysql2/promise');

async function main() {
    const configs = [
        'mysql://finops_user:finopspassword@127.0.0.1:3306/finops_app'
    ];
    
    for (const config of configs) {
        try {
            const connection = await mysql.createConnection(config);
            const [rows] = await connection.query('SELECT * FROM Tenants');
            console.log("Tenants:", JSON.stringify(rows, null, 2));
            await connection.end();
            return;
        } catch (e) {
            console.log(`Failed to connect with ${config.split('/').pop()}: ${e.message}`);
        }
    }
}

main();
