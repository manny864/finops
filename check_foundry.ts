import pool from './src/modules/storage/db';

const tenantId = '81ebe027-e6af-4e09-bc73-58c9012c6408';

async function check() {
  try {
    // Check CostMeterSnapshots for Foundry patterns
    const [rows1]: any = await pool.query(
      `SELECT DISTINCT 
        service_name, MeterCategory, MeterName, MeterSubCategory,
        COUNT(*) as cnt,
        SUM(cost_usd) as total_cost
       FROM CostMeterSnapshots 
       WHERE tenant_id = ? 
       AND (
         LOWER(service_name) LIKE '%foundry%'
         OR LOWER(MeterCategory) LIKE '%foundry%'
         OR LOWER(MeterName) LIKE '%foundry%'
         OR LOWER(MeterSubCategory) LIKE '%foundry%'
       )
       GROUP BY service_name, MeterCategory, MeterName, MeterSubCategory
       LIMIT 50`,
      [tenantId]
    );
    
    console.log("=== Foundry rows in CostMeterSnapshots ===");
    console.log(JSON.stringify(rows1, null, 2));

    // Check AICostSnapshots
    const [rows2]: any = await pool.query(
      `SELECT DISTINCT 
        model_name, resource_name, application,
        COUNT(*) as cnt,
        SUM(COALESCE(billed_cost, effective_cost, 0)) as total_cost
       FROM AICostSnapshots 
       WHERE tenant_id = ?
       GROUP BY model_name, resource_name, application
       LIMIT 50`,
      [tenantId]
    );
    
    console.log("\n=== AICostSnapshots distinct models ===");
    console.log(JSON.stringify(rows2, null, 2));

    // Count rows in each table
    const [cnt1]: any = await pool.query(
      `SELECT COUNT(*) as count FROM CostMeterSnapshots WHERE tenant_id = ?`,
      [tenantId]
    );
    const [cnt2]: any = await pool.query(
      `SELECT COUNT(*) as count FROM AICostSnapshots WHERE tenant_id = ?`,
      [tenantId]
    );
    
    console.log("\n=== Row counts ===");
    console.log("CostMeterSnapshots:", cnt1?.[0]?.count || 0);
    console.log("AICostSnapshots:", cnt2?.[0]?.count || 0);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

check();
