import mysql from 'mysql2/promise';

const pool = mysql.createPool(process.env.DATABASE_URL || 'mysql://finops_user:finopspassword@localhost:3306/finops_app');

export default pool;
