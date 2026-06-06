const mysql = require('mysql2/promise');

async function main() {
    console.log("Conectando a la base de datos...");
    const connection = await mysql.createConnection({
        host: '127.0.0.1',
        user: 'finops_user',
        password: 'finopspassword',
        database: 'finops_app',
        port: 3306
    });
    
    console.log("Eliminando registros de la tabla Tenants...");
    const [result] = await connection.execute('DELETE FROM Tenants;');
    console.log(`Registros eliminados: ${result.affectedRows}`);
    
    await connection.end();
}

main().catch(console.error);
