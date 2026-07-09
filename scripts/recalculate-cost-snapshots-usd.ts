/**
 * Recalcula y limpia CostSnapshots / CostMeterSnapshots / CostCategorySnapshots
 * / cost_snapshots (legacy) para eliminar la contaminación por moneda:
 * históricamente estas tablas se poblaron con PreTaxCost (moneda de
 * facturación de la suscripción, p.ej. ARS) etiquetado como si fuera USD
 * (columna `currency` hardcodeada a 'USD' en el INSERT). Ver
 * src/lib/azureCostColumn.ts y el fix en billingService.ts.
 *
 * Para cada tenant activo con credenciales configuradas:
 *   1. Vuelve a consultar Azure Cost Management para la ventana histórica
 *      completa (hasta AZURE_COST_HISTORY_MAX_MONTHS = 13 meses), usando
 *      CostUSD con degradación automática a PreTaxCost si la oferta del
 *      tenant no lo soporta (getHistoricalDetailedCosts /
 *      getHistoricalDailyCosts — ambas ya corregidas).
 *   2. BORRA las filas existentes de ese tenant en la ventana recalculada.
 *   3. Inserta las filas corregidas.
 *
 * IMPORTANTE — correr esto EN EL VPS (donde están las credenciales Azure
 * reales por tenant y la DB de producción), no en un entorno de desarrollo.
 *
 * Uso:
 *   npx tsx scripts/recalculate-cost-snapshots-usd.ts --dry-run
 *   npx tsx scripts/recalculate-cost-snapshots-usd.ts --dry-run --tenant=<tenantId>
 *   npx tsx scripts/recalculate-cost-snapshots-usd.ts --tenant=<tenantId>   # aplica un tenant
 *   npx tsx scripts/recalculate-cost-snapshots-usd.ts                      # aplica TODOS los tenants activos
 *   npx tsx scripts/recalculate-cost-snapshots-usd.ts --months=6           # ventana más corta
 *
 * --dry-run: no borra ni escribe nada. Muestra, por tenant, el total actual
 * en DB vs. el total recalculado desde Azure para la misma ventana — así se
 * puede confirmar la magnitud de la contaminación (y detectar tenants que
 * en realidad SÍ facturan en USD, donde el delta debería ser ~0) antes de
 * aplicar el borrado real.
 *
 * Idempotente: correrlo dos veces sobre el mismo tenant dentro de la ventana
 * no duplica nada (borra e inserta de nuevo con los mismos valores).
 */
import pool, {
    insertCostSnapshot,
    insertCostSnapshotRow,
    insertCostMeterSnapshotRow,
    insertCostCategorySnapshotRow,
} from "../src/modules/storage/db";
import {
    getHistoricalDailyCosts,
    getHistoricalDetailedCosts,
    AZURE_COST_HISTORY_MAX_MONTHS,
    type HistoricalDetailedCostRow,
} from "../src/modules/collectors/azure/billingService";
import { getTenantCredentials } from "../src/lib/secrets/tenantCredentials";

interface TenantRow {
    id: string;
    company_name: string;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const tenantArg = args.find((a) => a.startsWith("--tenant="));
    const monthsArg = args.find((a) => a.startsWith("--months="));
    const tenantId = tenantArg ? tenantArg.split("=")[1] : undefined;
    const months = monthsArg ? Math.max(1, Math.min(AZURE_COST_HISTORY_MAX_MONTHS, parseInt(monthsArg.split("=")[1], 10))) : AZURE_COST_HISTORY_MAX_MONTHS;
    return { dryRun, tenantId, months };
}

async function getTargetTenants(tenantId?: string): Promise<TenantRow[]> {
    if (tenantId) {
        const [rows]: any = await pool.query(
            `SELECT tenant_id as id, company_name FROM Tenants WHERE tenant_id = ?`,
            [tenantId]
        );
        return rows as TenantRow[];
    }
    const [rows]: any = await pool.query(
        `SELECT tenant_id as id, company_name FROM Tenants WHERE status = "active"`
    );
    return rows as TenantRow[];
}

/** Suma actual en DB de las 3 tablas detalladas + la legacy, para el rango dado. */
async function getCurrentDbTotals(tenantId: string, fromDate: string, toDate: string) {
    const [snap]: any = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS rows
         FROM CostSnapshots WHERE tenant_id = ? AND date BETWEEN ? AND ?`,
        [tenantId, fromDate, toDate]
    );
    const [meter]: any = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS rows
         FROM CostMeterSnapshots WHERE tenant_id = ? AND date BETWEEN ? AND ?`,
        [tenantId, fromDate, toDate]
    );
    const [cat]: any = await pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS rows
         FROM CostCategorySnapshots WHERE tenant_id = ? AND date BETWEEN ? AND ?`,
        [tenantId, fromDate, toDate]
    );
    const [legacy]: any = await pool.query(
        `SELECT COALESCE(SUM(total_cost_usd), 0) AS total, COUNT(*) AS rows
         FROM cost_snapshots WHERE tenant_id = ? AND sync_date BETWEEN ? AND ?`,
        [tenantId, fromDate, toDate]
    );
    return {
        chargeback: { total: Number(snap[0]?.total || 0), rows: Number(snap[0]?.rows || 0) },
        meter: { total: Number(meter[0]?.total || 0), rows: Number(meter[0]?.rows || 0) },
        category: { total: Number(cat[0]?.total || 0), rows: Number(cat[0]?.rows || 0) },
        legacy: { total: Number(legacy[0]?.total || 0), rows: Number(legacy[0]?.rows || 0) },
    };
}

async function deleteExistingRows(tenantId: string, fromDate: string, toDate: string) {
    await pool.query(`DELETE FROM CostSnapshots WHERE tenant_id = ? AND date BETWEEN ? AND ?`, [tenantId, fromDate, toDate]);
    await pool.query(`DELETE FROM CostMeterSnapshots WHERE tenant_id = ? AND date BETWEEN ? AND ?`, [tenantId, fromDate, toDate]);
    await pool.query(`DELETE FROM CostCategorySnapshots WHERE tenant_id = ? AND date BETWEEN ? AND ?`, [tenantId, fromDate, toDate]);
    await pool.query(`DELETE FROM cost_snapshots WHERE tenant_id = ? AND sync_date BETWEEN ? AND ?`, [tenantId, fromDate, toDate]);
}

async function insertDetailedRows(tenantId: string, rows: HistoricalDetailedCostRow[]) {
    for (const row of rows) {
        if (row.kind === "meter") {
            await insertCostMeterSnapshotRow(tenantId, row.date, row);
        } else if (row.kind === "category") {
            await insertCostCategorySnapshotRow(tenantId, row.date, row);
        } else {
            await insertCostSnapshotRow(tenantId, row.date, row);
        }
    }
}

async function insertLegacyDailyTotals(tenantId: string, daily: Array<{ date: string; cost: number }>) {
    for (const { date, cost } of daily) {
        await insertCostSnapshot(tenantId, date, cost, "USD");
    }
}

function dateRangeForMonths(months: number): { fromDate: string; toDate: string } {
    const to = new Date();
    to.setDate(to.getDate() - 1); // hasta ayer (hoy está incompleto)
    const from = new Date();
    from.setMonth(from.getMonth() - months);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { fromDate: fmt(from), toDate: fmt(to) };
}

async function processTenant(tenant: TenantRow, months: number, dryRun: boolean) {
    const { fromDate, toDate } = dateRangeForMonths(months);
    console.log(`\n=== Tenant ${tenant.id} (${tenant.company_name || "sin nombre"}) — ventana ${fromDate} a ${toDate} ===`);

    const creds = await getTenantCredentials(tenant.id).catch(() => null);
    if (!creds) {
        console.log(`  SKIP: sin credenciales Azure configuradas.`);
        return;
    }

    const before = await getCurrentDbTotals(tenant.id, fromDate, toDate);
    console.log(`  DB actual  — chargeback: $${before.chargeback.total.toFixed(2)} (${before.chargeback.rows} filas), meter: $${before.meter.total.toFixed(2)} (${before.meter.rows}), category: $${before.category.total.toFixed(2)} (${before.category.rows}), legacy: $${before.legacy.total.toFixed(2)} (${before.legacy.rows})`);

    let detailedRows: HistoricalDetailedCostRow[] = [];
    let dailyTotals: Array<{ date: string; cost: number }> = [];
    try {
        [detailedRows, dailyTotals] = await Promise.all([
            getHistoricalDetailedCosts(tenant.id, months),
            getHistoricalDailyCosts(tenant.id, "All", months),
        ]);
    } catch (e: any) {
        console.error(`  ERROR consultando Azure para ${tenant.id}:`, e?.message || e);
        return;
    }

    const recalculated = {
        chargeback: detailedRows.filter((r) => r.kind === "chargeback").reduce((s, r) => s + r.cost, 0),
        meter: detailedRows.filter((r) => r.kind === "meter").reduce((s, r) => s + r.cost, 0),
        category: detailedRows.filter((r) => r.kind === "category").reduce((s, r) => s + r.cost, 0),
        legacy: dailyTotals.reduce((s, r) => s + r.cost, 0),
    };
    console.log(`  Recalculado — chargeback: $${recalculated.chargeback.toFixed(2)} (${detailedRows.filter((r) => r.kind === "chargeback").length} filas), meter: $${recalculated.meter.toFixed(2)} (${detailedRows.filter((r) => r.kind === "meter").length}), category: $${recalculated.category.toFixed(2)} (${detailedRows.filter((r) => r.kind === "category").length}), legacy: $${recalculated.legacy.toFixed(2)} (${dailyTotals.length})`);

    const deltaPct = before.chargeback.total > 0
        ? (((before.chargeback.total - recalculated.chargeback) / before.chargeback.total) * 100).toFixed(1)
        : "n/a";
    console.log(`  Delta (chargeback): ${deltaPct}% ${before.chargeback.total > recalculated.chargeback ? "(estaba inflado — probable contaminación por moneda)" : "(sin inflación aparente — puede ya facturar en USD)"}`);

    if (dryRun) {
        console.log(`  [DRY RUN] No se modifica la base de datos.`);
        return;
    }

    if (detailedRows.length === 0 && dailyTotals.length === 0) {
        console.warn(`  SKIP escritura: Azure no devolvió datos recalculados (posible fallo de credenciales/permmisos) — se preserva lo existente para no perder datos.`);
        return;
    }

    await deleteExistingRows(tenant.id, fromDate, toDate);
    await insertDetailedRows(tenant.id, detailedRows);
    await insertLegacyDailyTotals(tenant.id, dailyTotals);

    const after = await getCurrentDbTotals(tenant.id, fromDate, toDate);
    console.log(`  DB después — chargeback: $${after.chargeback.total.toFixed(2)} (${after.chargeback.rows} filas), meter: $${after.meter.total.toFixed(2)} (${after.meter.rows}), category: $${after.category.total.toFixed(2)} (${after.category.rows}), legacy: $${after.legacy.total.toFixed(2)} (${after.legacy.rows})`);
    console.log(`  OK: tenant ${tenant.id} recalculado.`);
}

async function main() {
    const { dryRun, tenantId, months } = parseArgs();
    console.log(`[recalculate-cost-snapshots-usd] Modo: ${dryRun ? "DRY RUN (sin escribir)" : "APLICAR CAMBIOS"} — ventana: ${months} meses${tenantId ? ` — tenant: ${tenantId}` : " — TODOS los tenants activos"}`);

    const tenants = await getTargetTenants(tenantId);
    if (tenants.length === 0) {
        console.error("No se encontraron tenants para procesar (¿tenantId incorrecto o sin tenants activos?).");
        process.exit(1);
    }
    console.log(`Tenants a procesar: ${tenants.length}`);

    // Secuencial (no concurrente): cada tenant ya hace varias queries chunked
    // a Azure Cost Management por dentro; correr tenants en paralelo
    // amplificaría el rate limiting (429) de la API.
    for (const tenant of tenants) {
        try {
            await processTenant(tenant, months, dryRun);
        } catch (e: any) {
            console.error(`  ERROR procesando tenant ${tenant.id}:`, e?.message || e);
        }
    }

    console.log("\n[recalculate-cost-snapshots-usd] Listo.");
    process.exit(0);
}

main().catch((e) => {
    console.error("[recalculate-cost-snapshots-usd] Error fatal:", e);
    process.exit(1);
});
