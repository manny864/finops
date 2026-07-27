import mysql from "mysql2/promise";

const globalForPool = globalThis as unknown as {
  __finopsMysqlPool?: mysql.Pool;
};

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "finops_user",
    password: process.env.DB_PASSWORD || "finopspassword",
    database: process.env.DB_NAME || "finops_app",
    port: Number(process.env.DB_PORT || 3306),
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });
}

const pool: mysql.Pool = globalForPool.__finopsMysqlPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalForPool.__finopsMysqlPool = pool;
}

let dbInitialized = false;
let dbInitPromise: Promise<void> | null = null;

export async function initializeDatabase() {
  if (dbInitialized) return;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    const { runMigrations } = await import("./migrations");
    await runMigrations();
    dbInitialized = true;
  })();

  try {
    await dbInitPromise;
  } catch (error) {
    dbInitPromise = null;
    throw error;
  }
}

export async function insertCostSnapshot(tenantId: string, date: string, cost: number, currency: string) {
  await pool.query(
    `INSERT INTO cost_snapshots (tenant_id, sync_date, total_cost_usd, currency)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE total_cost_usd = VALUES(total_cost_usd), currency = VALUES(currency)`,
    [tenantId, date, cost, currency]
  );
}

export async function insertCostSnapshotRow(tenantId: string, date: string, row: {
  subscriptionId: string;
  resourceGroup: string;
  serviceName: string;
  serviceFamily?: string;
  meterCategory?: string;
  meterSubCategory?: string;
  meterName?: string;
  cost: number;
  quantity?: number;
  unitOfMeasure?: string;
}) {
  await pool.query(
    `INSERT INTO CostSnapshots
      (tenant_id, subscription_id, date, resource_group, service_name,
       ServiceFamily, MeterCategory, MeterSubCategory, MeterName,
       cost_usd, BilledCost, Quantity, UnitOfMeasure, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD')
     ON DUPLICATE KEY UPDATE
       cost_usd = VALUES(cost_usd),
       BilledCost = VALUES(BilledCost),
       ServiceFamily = VALUES(ServiceFamily),
       MeterCategory = VALUES(MeterCategory),
       MeterSubCategory = VALUES(MeterSubCategory),
       MeterName = VALUES(MeterName),
       Quantity = VALUES(Quantity),
       UnitOfMeasure = VALUES(UnitOfMeasure)`,
    [
      tenantId,
      row.subscriptionId || "default",
      date,
      row.resourceGroup || "*",
      row.serviceName || "",
      row.serviceFamily || null,
      row.meterCategory || null,
      row.meterSubCategory || null,
      row.meterName || null,
      row.cost,
      row.cost,
      row.quantity ?? null,
      row.unitOfMeasure || null,
    ]
  );
}

export async function insertAICostSnapshotRow(tenantId: string, date: string, row: {
  subscriptionId?: string;
  resourceName: string;
  resourceGroup?: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  billedCost: number;
}) {
  await pool.query(
    `INSERT INTO AICostSnapshots
      (tenant_id, date, subscription_id, resource_name, resource_group, model_name,
       input_tokens, output_tokens, billed_cost, effective_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       input_tokens = VALUES(input_tokens),
       output_tokens = VALUES(output_tokens),
       billed_cost = VALUES(billed_cost),
       effective_cost = VALUES(effective_cost)`,
    [
      tenantId,
      date,
      row.subscriptionId || null,
      row.resourceName || "",
      row.resourceGroup || null,
      row.modelName || "",
      row.inputTokens,
      row.outputTokens,
      row.billedCost,
      row.billedCost,
    ]
  );
}

/**
 * Loggea el uso de un LLM invocado por la propia plataforma (chatbot FinOps,
 * assessment, normalización de CSV) — distinto de AICostSnapshots, que es el
 * gasto en Azure AI de CADA TENANT. `source` distingue si la llamada usó la
 * key propia del tenant (BYOK, gasto del tenant) o la key global de fallback
 * (gasto que paga la plataforma). Best-effort: un fallo acá nunca debe romper
 * la respuesta de IA al usuario.
 */
export async function insertPlatformAiUsage(row: {
  tenantId?: string | null;
  source: 'byok' | 'platform';
  provider: string;
  modelName: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
}) {
  try {
    await pool.query(
      `INSERT INTO PlatformAiUsage
        (tenant_id, source, provider, model_name, feature, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.tenantId || null,
        row.source,
        row.provider,
        row.modelName,
        row.feature,
        row.inputTokens || 0,
        row.outputTokens || 0,
      ]
    );
  } catch (e) {
    console.error('[insertPlatformAiUsage] best-effort log failed:', e);
  }
}

export async function insertCostMeterSnapshotRow(tenantId: string, date: string, row: {
  subscriptionId: string;
  serviceName: string;
  meterCategory?: string;
  meterSubCategory?: string;
  meterName?: string;
  resourceLocation?: string;
  cost: number;
  quantity?: number;
  unitOfMeasure?: string;
}) {
  await pool.query(
    `INSERT INTO CostMeterSnapshots
      (tenant_id, subscription_id, date, service_name,
       MeterCategory, MeterSubCategory, MeterName, resource_location,
       cost_usd, Quantity, UnitOfMeasure, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD')
     ON DUPLICATE KEY UPDATE
       cost_usd = VALUES(cost_usd),
       MeterCategory = VALUES(MeterCategory),
       MeterName = VALUES(MeterName),
       Quantity = VALUES(Quantity),
       UnitOfMeasure = VALUES(UnitOfMeasure)`,
    [
      tenantId,
      row.subscriptionId || "default",
      date,
      row.serviceName || "",
      row.meterCategory || "",
      row.meterSubCategory || "",
      row.meterName || "",
      row.resourceLocation || "",
      row.cost,
      row.quantity ?? null,
      row.unitOfMeasure || null,
    ]
  );
}

export async function insertCostCategorySnapshotRow(tenantId: string, date: string, row: {
  subscriptionId: string;
  resourceType: string;
  cost: number;
}) {
  await pool.query(
    `INSERT INTO CostCategorySnapshots
      (tenant_id, subscription_id, date, resource_type, cost_usd, currency)
     VALUES (?, ?, ?, ?, ?, 'USD')
     ON DUPLICATE KEY UPDATE cost_usd = VALUES(cost_usd)`,
    [
      tenantId,
      row.subscriptionId || "default",
      date,
      row.resourceType || "",
      row.cost,
    ]
  );
}

export async function updateTenantHealth(tenantId: string, status: string, errorMsg?: string) {
  await pool.query(
    `INSERT INTO tenant_health (tenant_id, last_sync_at, sync_status, last_error)
     VALUES (?, CURRENT_TIMESTAMP, ?, ?)
     ON DUPLICATE KEY UPDATE last_sync_at = CURRENT_TIMESTAMP, sync_status = VALUES(sync_status), last_error = VALUES(last_error)`,
    [tenantId, status, errorMsg || null]
  );
}

export default pool;
