import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'finops_user',
    password: process.env.DB_PASSWORD || 'finopspassword',
    database: process.env.DB_NAME || 'finops_app',
    port: Number(process.env.DB_PORT || 3306)
});

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
