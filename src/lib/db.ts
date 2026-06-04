import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const pool = mysql.createPool(process.env.DATABASE_URL || 'mysql://finops_user:finopspassword@localhost:3306/finops_app');

let dbInitialized = false;

export async function initializeDatabase() {
    if (dbInitialized) return;
    try {
        const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        const queries = schema.split(';').filter(q => q.trim().length > 0);
        
        const connection = await pool.getConnection();
        for (const query of queries) {
            await connection.query(query);
        }
        connection.release();
        dbInitialized = true;
        console.log("Database schema validated/initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize database schema:", error);
    }
}

export default pool;
