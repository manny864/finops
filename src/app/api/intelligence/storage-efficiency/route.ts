/**
 * GET /api/intelligence/storage-efficiency — tiers Hot/Cool/Cold/Archive y ahorro potencial.
 *
 * RBAC app: requireTenantAccess (tenant-scoped). Tier: Business (routeTiers).
 * Roles Azure requeridos: NINGUNO en el request (sirve datos ya persistidos en
 * CostMeterSnapshots/CostSnapshots). El productor de esos datos es el cron
 * /api/cron/sync, que requiere 'Cost Management Reader' (incluido en el tier
 * Essential del script de onboarding y verificado por /api/admin/check-sp-roles).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { withArgLimit } from "@/lib/argConcurrency";

const MOCK_ACCOUNTS = [
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stappprodwestus01", name: "stappprodwestus01", resourceGroup: "rg-prod-app", subscriptionId: "demo-sub-01", location: "westus2", tier: "Hot", sku: "Standard_LRS", usedGb: 4500.5, monthlyCost: 82.81 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stappprodwestus02", name: "stappprodwestus02", resourceGroup: "rg-prod-app", subscriptionId: "demo-sub-01", location: "westus2", tier: "Hot", sku: "Standard_GRS", usedGb: 3200.0, monthlyCost: 58.88 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-prod-backups/providers/Microsoft.Storage/storageAccounts/stbackupsprod01", name: "stbackupsprod01", resourceGroup: "rg-prod-backups", subscriptionId: "demo-sub-01", location: "eastus", tier: "Cool", sku: "Standard_LRS", usedGb: 8500.0, monthlyCost: 85.00 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-archive-data/providers/Microsoft.Storage/storageAccounts/stbackupsarchive01", name: "stbackupsarchive01", resourceGroup: "rg-archive-data", subscriptionId: "demo-sub-01", location: "eastus2", tier: "Archive", sku: "Standard_LRS", usedGb: 12000.0, monthlyCost: 11.88 },
    { id: "/subscriptions/demo-sub-02/resourceGroups/rg-monitoring/providers/Microsoft.Storage/storageAccounts/stlogsanalytics01", name: "stlogsanalytics01", resourceGroup: "rg-monitoring", subscriptionId: "demo-sub-02", location: "westeurope", tier: "Cool", sku: "Standard_ZRS", usedGb: 2400.0, monthlyCost: 24.00 },
    { id: "/subscriptions/demo-sub-02/resourceGroups/rg-dev-test/providers/Microsoft.Storage/storageAccounts/stdevteststorage", name: "stdevteststorage", resourceGroup: "rg-dev-test", subscriptionId: "demo-sub-02", location: "eastus", tier: "Hot", sku: "Standard_LRS", usedGb: 850.0, monthlyCost: 15.64 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-database-prod/providers/Microsoft.Storage/storageAccounts/stsqlauditlogs", name: "stsqlauditlogs", resourceGroup: "rg-database-prod", subscriptionId: "demo-sub-01", location: "centralus", tier: "Cold", sku: "Standard_GRS", usedGb: 3100.0, monthlyCost: 11.16 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-web-frontend/providers/Microsoft.Storage/storageAccounts/stcdnstaticcontent", name: "stcdnstaticcontent", resourceGroup: "rg-web-frontend", subscriptionId: "demo-sub-01", location: "eastus2", tier: "Hot", sku: "Premium_LRS", usedGb: 1200.0, monthlyCost: 22.08 },
    { id: "/subscriptions/demo-sub-02/resourceGroups/rg-monitoring/providers/Microsoft.Storage/storageAccounts/sttelemetrydata", name: "sttelemetrydata", resourceGroup: "rg-monitoring", subscriptionId: "demo-sub-02", location: "westeurope", tier: "Cool", sku: "Standard_LRS", usedGb: 4800.0, monthlyCost: 48.00 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-media-services/providers/Microsoft.Storage/storageAccounts/stmediauploads", name: "stmediauploads", resourceGroup: "rg-media-services", subscriptionId: "demo-sub-01", location: "southcentralus", tier: "Hot", sku: "Standard_GRS", usedGb: 6200.0, monthlyCost: 114.08 },
    { id: "/subscriptions/demo-sub-02/resourceGroups/rg-data-import/providers/Microsoft.Storage/storageAccounts/sttempimport", name: "sttempimport", resourceGroup: "rg-data-import", subscriptionId: "demo-sub-02", location: "eastus", tier: "Hot", sku: "Standard_LRS", usedGb: 350.0, monthlyCost: 6.44 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-archive-data/providers/Microsoft.Storage/storageAccounts/starchivehist2023", name: "starchivehist2023", resourceGroup: "rg-archive-data", subscriptionId: "demo-sub-01", location: "eastus2", tier: "Archive", sku: "Standard_LRS", usedGb: 25000.0, monthlyCost: 24.75 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-archive-data/providers/Microsoft.Storage/storageAccounts/starchivehist2024", name: "starchivehist2024", resourceGroup: "rg-archive-data", subscriptionId: "demo-sub-01", location: "eastus2", tier: "Archive", sku: "Standard_LRS", usedGb: 18500.0, monthlyCost: 18.32 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-prod-backups/providers/Microsoft.Storage/storageAccounts/stvmdisksbackup", name: "stvmdisksbackup", resourceGroup: "rg-prod-backups", subscriptionId: "demo-sub-01", location: "westus2", tier: "Cool", sku: "Standard_GRS", usedGb: 7200.0, monthlyCost: 72.00 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-prod-app/providers/Microsoft.Storage/storageAccounts/stuserprofiles", name: "stuserprofiles", resourceGroup: "rg-prod-app", subscriptionId: "demo-sub-01", location: "westus2", tier: "Hot", sku: "Standard_LRS", usedGb: 950.0, monthlyCost: 17.48 },
    { id: "/subscriptions/demo-sub-03/resourceGroups/rg-analytics/providers/Microsoft.Storage/storageAccounts/streportingcache", name: "streportingcache", resourceGroup: "rg-analytics", subscriptionId: "demo-sub-03", location: "eastus", tier: "Cold", sku: "Standard_LRS", usedGb: 1800.0, monthlyCost: 6.48 },
    { id: "/subscriptions/demo-sub-03/resourceGroups/rg-data-lake/providers/Microsoft.Storage/storageAccounts/stdatalakestore01", name: "stdatalakestore01", resourceGroup: "rg-data-lake", subscriptionId: "demo-sub-03", location: "eastus2", tier: "Hot", sku: "Premium_LRS", usedGb: 14200.0, monthlyCost: 261.28 },
    { id: "/subscriptions/demo-sub-03/resourceGroups/rg-data-lake/providers/Microsoft.Storage/storageAccounts/stdatalakestore02", name: "stdatalakestore02", resourceGroup: "rg-data-lake", subscriptionId: "demo-sub-03", location: "eastus2", tier: "Cool", sku: "Standard_GRS", usedGb: 9800.0, monthlyCost: 98.00 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-microservices/providers/Microsoft.Storage/storageAccounts/stfunctionapps01", name: "stfunctionapps01", resourceGroup: "rg-microservices", subscriptionId: "demo-sub-01", location: "westus2", tier: "Hot", sku: "Standard_LRS", usedGb: 120.0, monthlyCost: 2.21 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-microservices/providers/Microsoft.Storage/storageAccounts/stfunctionapps02", name: "stfunctionapps02", resourceGroup: "rg-microservices", subscriptionId: "demo-sub-01", location: "westus2", tier: "Hot", sku: "Standard_LRS", usedGb: 85.0, monthlyCost: 1.56 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-aks-cluster/providers/Microsoft.Storage/storageAccounts/stk8spersistentvol", name: "stk8spersistentvol", resourceGroup: "rg-aks-cluster", subscriptionId: "demo-sub-01", location: "westus2", tier: "Hot", sku: "Premium_LRS", usedGb: 2100.0, monthlyCost: 38.64 },
    { id: "/subscriptions/demo-sub-04/resourceGroups/rg-security-audit/providers/Microsoft.Storage/storageAccounts/stsecauditvault", name: "stsecauditvault", resourceGroup: "rg-security-audit", subscriptionId: "demo-sub-04", location: "eastus", tier: "Archive", sku: "Standard_GRS", usedGb: 5400.0, monthlyCost: 5.35 },
    { id: "/subscriptions/demo-sub-04/resourceGroups/rg-ai-models/providers/Microsoft.Storage/storageAccounts/stmlmodelweights", name: "stmlmodelweights", resourceGroup: "rg-ai-models", subscriptionId: "demo-sub-04", location: "eastus2", tier: "Hot", sku: "Premium_ZRS", usedGb: 8900.0, monthlyCost: 163.76 },
    { id: "/subscriptions/demo-sub-04/resourceGroups/rg-ai-models/providers/Microsoft.Storage/storageAccounts/stmltrainingdata", name: "stmltrainingdata", resourceGroup: "rg-ai-models", subscriptionId: "demo-sub-04", location: "eastus2", tier: "Cool", sku: "Standard_GRS", usedGb: 15300.0, monthlyCost: 153.00 },
    { id: "/subscriptions/demo-sub-02/resourceGroups/rg-dev-test/providers/Microsoft.Storage/storageAccounts/ststagingtemp", name: "ststagingtemp", resourceGroup: "rg-dev-test", subscriptionId: "demo-sub-02", location: "eastus", tier: "Hot", sku: "Standard_LRS", usedGb: 420.0, monthlyCost: 7.73 },
    { id: "/subscriptions/demo-sub-03/resourceGroups/rg-analytics/providers/Microsoft.Storage/storageAccounts/stbiexports", name: "stbiexports", resourceGroup: "rg-analytics", subscriptionId: "demo-sub-03", location: "eastus", tier: "Cold", sku: "Standard_LRS", usedGb: 2900.0, monthlyCost: 10.44 },
    { id: "/subscriptions/demo-sub-02/resourceGroups/rg-monitoring/providers/Microsoft.Storage/storageAccounts/stlogsbkup2025", name: "stlogsbkup2025", resourceGroup: "rg-monitoring", subscriptionId: "demo-sub-02", location: "westeurope", tier: "Cool", sku: "Standard_LRS", usedGb: 6400.0, monthlyCost: 64.00 },
    { id: "/subscriptions/demo-sub-01/resourceGroups/rg-web-frontend/providers/Microsoft.Storage/storageAccounts/stwebassetscdn", name: "stwebassetscdn", resourceGroup: "rg-web-frontend", subscriptionId: "demo-sub-01", location: "eastus2", tier: "Hot", sku: "Standard_LRS", usedGb: 1750.0, monthlyCost: 32.20 },
];

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    tiers: {
        hot:     { percent: 62, gb: 12500, cost: 230 },
        cool:    { percent: 25, gb: 5000,  cost: 50 },
        cold:    { percent: 8,  gb: 1600,  cost: 5.76 },
        archive: { percent: 5,  gb: 1000,  cost: 0.99 },
    },
    totalGb: 20100,
    totalCost: 286.75,
    costPerGb: 0.01426,
    recommendation: {
        movableGb: 3500,
        potentialSavings: 65.40,
        fromTier: "hot",
        toTier: "cool",
    },
    accounts: MOCK_ACCOUNTS,
};

// Tier rates $/GB
const TIER_RATES: Record<string, number> = {
    hot:     0.0184,
    cool:    0.01,
    cold:    0.0036,
    archive: 0.00099,
};

function detectTier(...fields: Array<string | null | undefined>): string {
    for (const f of fields) {
        if (!f) continue;
        const m = String(f).toLowerCase();
        if (m.includes("archive")) return "archive";
        if (m.includes("cold"))    return "cold";
        if (m.includes("cool"))    return "cool";
        if (m.includes("hot"))     return "hot";
    }
    return "hot";
}

const STORAGE_SERVICE_FILTER = `(
                service_name LIKE '%Storage%'
             OR service_name LIKE '%Blob%'
             OR service_name LIKE '%File%'
             OR service_name LIKE '%Disk%'
           )`;

// Fuente primaria: filas a nivel de meter (CostMeterSnapshots), que traen la
// subcategoría real (Hot/Cool/Archive/...) necesaria para detectar tiers.
async function queryMeterRows(tenantId: string, days: number) {
    const [rows]: any = await pool.query(
        `SELECT
            subscription_id,
            resource_group,
            MeterName,
            MeterSubCategory,
            MeterCategory,
            service_name,
            COALESCE(Quantity, 0) AS quantity,
            UnitOfMeasure,
            cost_usd AS billedCost
         FROM CostMeterSnapshots
         WHERE tenant_id = ?
           AND (
                LOWER(MeterCategory) IN ('storage','azure storage','disks','disk storage')
             OR MeterSubCategory LIKE '%Blob%'
             OR MeterSubCategory LIKE '%LRS%'
             OR MeterSubCategory LIKE '%GRS%'
             OR MeterSubCategory LIKE '%ZRS%'
             OR ${STORAGE_SERVICE_FILTER}
           )
           AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [tenantId, days]
    );
    return rows as any[];
}

// Fallback: filas de chargeback (CostSnapshots) para tenants cuyos syncs son
// anteriores a la tabla de meters. Sin subcategoría, el tier se infiere del
// nombre del servicio (usualmente cae en 'hot').
async function queryLegacyRows(tenantId: string, days: number) {
    const [rows]: any = await pool.query(
        `SELECT
            subscription_id,
            resource_group,
            MeterName,
            MeterSubCategory,
            MeterCategory,
            ServiceFamily,
            service_name,
            COALESCE(Quantity, 0) AS quantity,
            UnitOfMeasure,
            COALESCE(BilledCost, cost_usd, 0) AS billedCost
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND (
                LOWER(COALESCE(ServiceFamily,'')) = 'storage'
             OR LOWER(COALESCE(MeterCategory,'')) IN ('storage','azure storage','disks','disk storage')
             OR ${STORAGE_SERVICE_FILTER}
           )
           AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [tenantId, days]
    );
    return rows as any[];
}

async function runQuery(tenantId: string, days: number): Promise<{ rows: any[]; source: 'meters' | 'legacy' }> {
    const meterRows = await queryMeterRows(tenantId, days);
    if (meterRows.length > 0) return { rows: meterRows, source: 'meters' };
    return { rows: await queryLegacyRows(tenantId, days), source: 'legacy' };
}

async function getUntruncatedSubscriptions(tenantId: string): Promise<string[]> {
    const { getAzureCredential } = await import('@/lib/azure');
    const cred = await getAzureCredential(tenantId);
    const subs: string[] = [];
    try {
        const tokenResponse = await cred.getToken("https://management.azure.com/.default");
        const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { "Authorization": `Bearer ${tokenResponse.token}` }
        });
        if (fetchRes.ok) {
            const data = await fetchRes.json();
            for (const sub of (data.value || [])) {
                if (sub.subscriptionId) subs.push(sub.subscriptionId);
            }
        }
    } catch (e) {
        console.error(`[storage-efficiency] Error fetching untruncated subscriptions for tenant ${tenantId}:`, e);
    }
    return subs;
}

async function fetchAllStorageAccountsFromARG(tenantId: string, subs: string[]): Promise<any[]> {
    if (!subs || subs.length === 0) return [];
    const argClient = await getResourceGraphClient(tenantId);
    const query = `
        Resources
        | where type =~ 'microsoft.storage/storageaccounts' or type =~ 'microsoft.classicstorage/storageaccounts'
        | project id, name, location, resourceGroup, subscriptionId, sku = tostring(sku.name), kind = tostring(kind), accessTier = tostring(properties.accessTier)
    `;

    const allAccounts: any[] = [];
    let skipToken: string | undefined = undefined;

    do {
        const resARG: any = await withArgLimit(() =>
            argClient.resources({
                subscriptions: subs,
                query,
                options: {
                    resultFormat: "objectArray",
                    top: 1000,
                    ...(skipToken ? { skipToken } : {})
                }
            })
        );

        const pageData = (resARG?.data as any[]) || [];
        allAccounts.push(...pageData);
        skipToken = resARG?.skipToken;
    } while (skipToken);

    return allAccounts;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const days = Math.max(1, Math.min(365, parseInt(searchParams.get("days") || "30", 10)));

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(MOCK_PAYLOAD);
        }

        try {
            // Try requested window first; if empty, widen to 90 days, then 365
            let { rows, source } = await runQuery(tenantId, days);
            let effectiveDays = days;
            let widened = false;
            if (rows.length === 0 && days < 90) {
                ({ rows, source } = await runQuery(tenantId, 90));
                effectiveDays = 90;
                widened = rows.length > 0;
            }
            if (rows.length === 0) {
                ({ rows, source } = await runQuery(tenantId, 365));
                effectiveDays = 365;
                widened = rows.length > 0;
            }

            const tierMap: Record<string, { gb: number; cost: number }> = {
                hot: { gb: 0, cost: 0 },
                cool: { gb: 0, cost: 0 },
                cold: { gb: 0, cost: 0 },
                archive: { gb: 0, cost: 0 },
            };

            for (const row of rows) {
                const tier = detectTier(row.MeterSubCategory, row.MeterName, row.MeterCategory, row.service_name);
                const cost = parseFloat(row.billedCost) || 0;
                // Prefer reported Quantity (in GB-month) if available; else infer from cost / rate
                const uom = String(row.UnitOfMeasure || "").toLowerCase();
                const reportedQty = parseFloat(row.quantity) || 0;
                const inferredGb = TIER_RATES[tier] > 0 ? cost / TIER_RATES[tier] : 0;
                const gb = (reportedQty > 0 && (uom.includes("gb") || uom.includes("byte"))) ? reportedQty : inferredGb;
                tierMap[tier].cost += cost;
                tierMap[tier].gb += gb;
            }

            const totalCost = Object.values(tierMap).reduce((s, t) => s + t.cost, 0);
            const totalGb   = Object.values(tierMap).reduce((s, t) => s + t.gb, 0);
            const costPerGb = totalGb > 0 ? totalCost / totalGb : 0;

            const tiersWithPercent = Object.fromEntries(
                Object.entries(tierMap).map(([k, v]) => [
                    k,
                    { gb: parseFloat(v.gb.toFixed(2)), cost: parseFloat(v.cost.toFixed(2)), percent: totalGb > 0 ? Math.round((v.gb / totalGb) * 100) : 0 },
                ])
            );

            const hotGb = tierMap.hot.gb;
            const movableGb = Math.round(hotGb * 0.28);
            const potentialSavings = parseFloat(
                ((TIER_RATES.hot - TIER_RATES.cool) * movableGb).toFixed(2)
            );

            let accounts: any[] = [];
            try {
                let subs = await getUntruncatedSubscriptions(tenantId);
                if (!subs || subs.length === 0) {
                    subs = Array.from(new Set(rows.map(r => String(r.subscription_id || r.subscriptionId || '')).filter(s => s && s !== 'default')));
                }

                if (subs.length > 0) {
                    const rawAccounts = await fetchAllStorageAccountsFromARG(tenantId, subs);

                    const costByRg = new Map<string, { cost: number; qty: number }>();
                    for (const r of rows) {
                        const rg = (r.resource_group || r.ResourceGroup || "").toLowerCase();
                        if (rg && rg !== '*') {
                            const current = costByRg.get(rg) || { cost: 0, qty: 0 };
                            const cost = parseFloat(r.billedCost) || 0;
                            const tier = detectTier(r.MeterSubCategory, r.MeterName, r.MeterCategory, r.service_name);
                            const uom = String(r.UnitOfMeasure || "").toLowerCase();
                            const reportedQty = parseFloat(r.quantity) || 0;
                            const inferredGb = TIER_RATES[tier] > 0 ? cost / TIER_RATES[tier] : 0;
                            const gb = (reportedQty > 0 && (uom.includes("gb") || uom.includes("byte"))) ? reportedQty : inferredGb;
                            costByRg.set(rg, { cost: current.cost + cost, qty: current.qty + gb });
                        }
                    }

                    accounts = rawAccounts.map((acc: any) => {
                        const rawTier = acc.accessTier || (acc.sku?.toLowerCase().includes("premium") ? "Premium" : "Hot");
                        const tierFormatted = rawTier ? rawTier.charAt(0).toUpperCase() + rawTier.slice(1).toLowerCase() : "Hot";
                        const rg = (acc.resourceGroup || "").toLowerCase();
                        const rgStats = costByRg.get(rg);
                        const countInRg = rawAccounts.filter((a: any) => (a.resourceGroup || "").toLowerCase() === rg).length || 1;
                        
                        const cost = rgStats ? (rgStats.cost / countInRg) : 0;
                        const gb = rgStats ? (rgStats.qty / countInRg) : 0;

                        return {
                            id: acc.id,
                            name: acc.name,
                            resourceGroup: acc.resourceGroup,
                            subscriptionId: acc.subscriptionId,
                            location: acc.location,
                            tier: tierFormatted,
                            kind: acc.kind,
                            sku: acc.sku,
                            usedGb: parseFloat(gb.toFixed(2)),
                            monthlyCost: parseFloat(cost.toFixed(2))
                        };
                    });
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[storage-efficiency] Could not fetch ARG storage accounts for tenant ${tenantId}:`, msg);
            }

            if (rows.length === 0) {
                return NextResponse.json({
                    success: true,
                    mock: false,
                    empty: true,
                    message: "No se encontraron registros de costo de Storage en los últimos 365 días. Verificá que la sincronización de FinOps haya corrido al menos una vez.",
                    tiers: tiersWithPercent,
                    totalGb: 0,
                    totalCost: 0,
                    costPerGb: 0,
                    accounts,
                    diagnostics: { rowsFound: 0, requestedDays: days, effectiveDays: 365, widened: false, source }
                });
            }

            return NextResponse.json({
                success: true,
                mock: false,
                tiers: tiersWithPercent,
                totalGb: parseFloat(totalGb.toFixed(2)),
                totalCost: parseFloat(totalCost.toFixed(2)),
                costPerGb: parseFloat(costPerGb.toFixed(5)),
                recommendation: {
                    movableGb,
                    potentialSavings,
                    fromTier: "hot",
                    toTier: "cool",
                },
                accounts,
                diagnostics: { rowsFound: rows.length, requestedDays: days, effectiveDays, widened, source }
            });
        } catch (dbErr: any) {
            console.error("[storage-efficiency] DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({
                success: false, mock: false,
                topAccounts: [], byTier: [], summary: {
                    totalAccounts: 0, totalGb: 0, totalCost: 0,
                    movableGb: 0, potentialSavings: 0,
                    fromTier: "hot", toTier: "cool",
                },
                error: `Sin datos disponibles: ${dbErr?.message || "error"}`,
            });
        }
    } catch (err: unknown) {
        console.error("[storage-efficiency] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
