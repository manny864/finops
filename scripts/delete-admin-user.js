const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env or .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function deleteAdminUser() {
    const args = process.argv.slice(2);
    const email = args[0];

    if (!email) {
        console.error("❌ Error: Missing email address parameter.");
        console.log("Usage: npm run db:delete-admin <user@domain.com>");
        process.exit(1);
    }

    let connection;
    try {
        console.log(`🔌 Connecting to MySQL database...`);
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'finops_user',
            password: process.env.DB_PASSWORD || 'finopspassword',
            database: process.env.DB_NAME || 'finops_app',
            port: Number(process.env.DB_PORT || 3306)
        });

        console.log(`🔍 Searching for user with email: ${email}`);
        
        const [rows] = await connection.execute('SELECT * FROM Users WHERE email = ?', [email]);
        
        if (!rows || rows.length === 0) {
            console.error(`❌ Error: User '${email}' not found in the local Users table.`);
            process.exit(1);
        }

        const user = rows[0];
        console.log(`✅ User found. ID: ${user.id}, Tenant ID: ${user.tenant_id}, Entra OID: ${user.entra_oid}`);
        console.log(`🗑️  Executing deletion...`);

        const [result] = await connection.execute('DELETE FROM Users WHERE email = ?', [email]);

        if (result.affectedRows > 0) {
            console.log(`🎉 Success! User '${email}' has been removed from the local mapping.`);
            console.log(`Upon their next MSAL token evaluation, they will immediately lose platform access.`);
        } else {
            console.error(`❌ Error: Failed to delete user.`);
        }

    } catch (error) {
        console.error("💥 Unexpected database error:", error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log("🔒 Database connection closed.");
        }
    }
}

deleteAdminUser();
