const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'finops',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

(async () => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT 
        MeterSubCategory, 
        MeterName, 
        service_name,
        MeterCategory
       FROM CostMeterSnapshots 
       WHERE tenant_id = '81ebe027-e6af-4e09-bc73-58c9012c6408'
       AND (
         LOWER(service_name) LIKE '%foundry%'
         OR LOWER(MeterCategory) LIKE '%foundry%'
         OR LOWER(MeterName) LIKE '%foundry%'
         OR LOWER(MeterSubCategory) LIKE '%foundry%'
       )
       LIMIT 20`
    );
    console.log('=== Foundry models in CostMeterSnapshots ===');
    console.table(rows);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
})();
