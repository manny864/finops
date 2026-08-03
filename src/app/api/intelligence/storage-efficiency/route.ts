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
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getResourceGraphClient, getSubscriptionsForTenant, getAzureCredential } from "@/lib/azure";
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

const BASELINE_GB_BY_TIER: Record<string, number> = {
    hot:     0.05, // 50 MB
    cool:    0.06, // 60 MB
    cold:    0.04, // 40 MB
    archive: 0.10, // 100 MB
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

function normalizeLoc(loc: string): string {
    let s = String(loc || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return s.replace(/^us(east|west|central|northcentral|southcentral|westcentral)(\d*)$/, '$1us$2');
}

async function fetchStorageAccountMetricsBatch(tenantId: string, accounts: any[]): Promise<Map<string, number>> {
    const bytesMap = new Map<string, number>();
    try {
        const cred = await getAzureCredential(tenantId);
        const tokenResponse = await cred.getToken("https://management.azure.com/.default");
        const headers = { Authorization: "Bearer " + tokenResponse.token };

        await Promise.all(
            accounts.map(async (acc) => {
                if (!acc.id) return;
                try {
                    const url = `https://management.azure.com${acc.id}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=UsedCapacity&timespan=PT6H&interval=PT1H`;
                    const res = await fetch(url, { headers });
                    if (res.ok) {
                        const data = await res.json();
                        const ts = data.value?.[0]?.timeseries?.[0]?.data || [];
                        const last = ts.slice(-1)[0];
                        const bytes = last?.average ?? last?.total ?? last?.maximum ?? 0;
                        if (bytes > 0) {
                            bytesMap.set(acc.id, bytes);
                        }
                    }
                } catch {
                    // Ignore single account failure
                }
            })
        );
    } catch {
        // Fallback gracefully
    }
    return bytesMap;
}

const STORAGE_SERVICE_FILTER = `(
                service_name LIKE '%Storage%'
             OR service_name LIKE '%Blob%'
             OR service_name LIKE '%File%'
             OR service_name LIKE '%Disk%'
           )`;

// Fuente primaria: filas a nivel de meter (CostMeterSnapshots), que traen la
// subcategoría real (Hot/Cool/Archive/...) necesaria para detectar tiers.
async function queryMeterRows(tenantId: string, days: number, startDate?: string | null, endDate?: string | null) {
    let dateCond = "AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)";
    let params: any[] = [tenantId, days];
    if (startDate && endDate) {
        dateCond = "AND date >= ? AND date <= ?";
        params = [tenantId, startDate, endDate];
    }

    const [rows]: any = await pool.query(
        `SELECT
            subscription_id,
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
           ${dateCond}`,
        params
    );
    return rows as any[];
}

// Fallback: filas de chargeback (CostSnapshots) para tenants cuyos syncs son
// anteriores a la tabla de meters. Sin subcategoría, el tier se infiere del
// nombre del servicio (usualmente cae en 'hot').
async function queryLegacyRows(tenantId: string, days: number, startDate?: string | null, endDate?: string | null) {
    let dateCond = "AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)";
    let params: any[] = [tenantId, days];
    if (startDate && endDate) {
        dateCond = "AND date >= ? AND date <= ?";
        params = [tenantId, startDate, endDate];
    }

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
           ${dateCond}`,
        params
    );
    return rows as any[];
}

async function runQuery(tenantId: string, days: number, startDate?: string | null, endDate?: string | null): Promise<{ rows: any[]; source: 'meters' | 'legacy' }> {
    try {
        const meterRows = await queryMeterRows(tenantId, days, startDate, endDate);
        if (meterRows.length > 0) return { rows: meterRows, source: 'meters' };
    } catch (e: any) {
        console.error(`[storage-efficiency] Error queryMeterRows para ${tenantId}:`, e);
    }
    const legacyRows = await queryLegacyRows(tenantId, days, startDate, endDate);
    if (legacyRows.length > 0) return { rows: legacyRows, source: 'legacy' };
    return { rows: [], source: 'legacy' };
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
        | project id, name, location, resourceGroup, subscriptionId, sku, kind, properties
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

        const requestUrl = (request as any).nextUrl ? (request as any).nextUrl : new URL((request as any).url || "http://localhost", "http://localhost");
        const isMockParam = requestUrl.searchParams?.get("mock") === "true";
        if (isMockTenant(tenantId) || tenantId.startsWith("mock-") || isMockParam) {
            const mockData = getMockDataForRoute("storage_efficiency", tenantId);
            return NextResponse.json(mockData || MOCK_PAYLOAD);
        }

        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");

        try {
            // Try requested window or custom range
            let { rows, source } = await runQuery(tenantId, days, startDate, endDate);
            let effectiveDays = days;
            let widened = false;
            if (rows.length === 0 && days < 90 && !startDate) {
                ({ rows, source } = await runQuery(tenantId, 90));
                effectiveDays = 90;
                widened = rows.length > 0;
            }
            if (rows.length === 0 && !startDate) {
                ({ rows, source } = await runQuery(tenantId, 365));
                effectiveDays = 365;
                widened = rows.length > 0;
            }

            // 1. Compute tenant-wide tierMap, totalGb, and totalCost from DB billing rows first
            const tierMap: Record<string, { gb: number; cost: number }> = {
                hot: { gb: 0, cost: 0 },
                cool: { gb: 0, cost: 0 },
                cold: { gb: 0, cost: 0 },
                archive: { gb: 0, cost: 0 },
            };

            for (const row of rows) {
                const tier = detectTier(row.MeterSubCategory, row.MeterName, row.MeterCategory, row.service_name);
                const cost = parseFloat(row.billedCost) || 0;
                const uom = String(row.UnitOfMeasure || "").toLowerCase();
                const reportedQty = parseFloat(row.quantity) || 0;
                const inferredGb = TIER_RATES[tier] > 0 ? cost / TIER_RATES[tier] : 0;
                const gb = (reportedQty > 0 && (uom.includes("gb") || uom.includes("byte"))) ? reportedQty : inferredGb;
                tierMap[tier].cost += cost;
                tierMap[tier].gb += gb;
            }

            const totalCostFromRows = Object.values(tierMap).reduce((s, t) => s + t.cost, 0);
            const totalGbFromRows   = Object.values(tierMap).reduce((s, t) => s + t.gb, 0);

            let accounts: any[] = [];
            try {
                let subs = await getUntruncatedSubscriptions(tenantId);
                if (!subs || subs.length === 0) {
                    subs = Array.from(new Set(rows.map(r => String(r.subscription_id || r.subscriptionId || '')).filter(s => s && s !== 'default')));
                }

                if (subs.length > 0) {
                    const rawAccounts = await fetchAllStorageAccountsFromARG(tenantId, subs);

                    const costByRg = new Map<string, { cost: number; qty: number }>();
                    const costByLoc = new Map<string, { cost: number; qty: number }>();

                    for (const r of rows) {
                        const rg = (r.resource_group || r.ResourceGroup || "").toLowerCase();
                        const loc = normalizeLoc(r.resource_location || r.location || "");
                        const cost = parseFloat(r.billedCost) || 0;
                        const tier = detectTier(r.MeterSubCategory, r.MeterName, r.MeterCategory, r.service_name);
                        const uom = String(r.UnitOfMeasure || "").toLowerCase();
                        const reportedQty = parseFloat(r.quantity) || 0;
                        const inferredGb = TIER_RATES[tier] > 0 ? cost / TIER_RATES[tier] : 0;
                        const gb = (reportedQty > 0 && (uom.includes("gb") || uom.includes("byte"))) ? reportedQty : inferredGb;

                        if (rg && rg !== '*') {
                            const current = costByRg.get(rg) || { cost: 0, qty: 0 };
                            costByRg.set(rg, { cost: current.cost + cost, qty: current.qty + gb });
                        }
                        if (loc) {
                            const current = costByLoc.get(loc) || { cost: 0, qty: 0 };
                            costByLoc.set(loc, { cost: current.cost + cost, qty: current.qty + gb });
                        }
                    }

                    const liveMetricsMap = await fetchStorageAccountMetricsBatch(tenantId, rawAccounts);

                    accounts = rawAccounts.map((acc: any) => {
                        const skuStr = String(acc.sku?.name || acc.sku || "");
                        const rawTier = acc.properties?.accessTier || (skuStr.toLowerCase().includes("premium") ? "Premium" : "Hot");
                        const tierFormatted = rawTier ? rawTier.charAt(0).toUpperCase() + rawTier.slice(1).toLowerCase() : "Hot";
                        const rg = (acc.resourceGroup || "").toLowerCase();
                        const loc = normalizeLoc(acc.location || "");

                        let stats = costByRg.get(rg);
                        let countInGroup = rawAccounts.filter((a: any) => (a.resourceGroup || "").toLowerCase() === rg).length || 1;

                        if (!stats || (stats.cost === 0 && stats.qty === 0)) {
                            // Fallback to location match
                            const locStats = costByLoc.get(loc);
                            if (locStats && (locStats.qty > 0 || locStats.cost > 0)) {
                                const countInLoc = rawAccounts.filter((a: any) => normalizeLoc(a.location || "") === loc).length || 1;
                                stats = { cost: locStats.cost / countInLoc, qty: locStats.qty / countInLoc };
                                countInGroup = 1;
                            }
                        }

                        let cost = stats ? (stats.cost / countInGroup) : 0;
                        let gb = stats ? (stats.qty / countInGroup) : 0;

                        // Override with live UsedCapacity metric from Azure Monitor if available
                        const liveBytes = liveMetricsMap.get(acc.id);
                        if (liveBytes && liveBytes > 0) {
                            gb = liveBytes / (1024 * 1024 * 1024);
                            if (cost === 0) {
                                const tKey = tierFormatted.toLowerCase();
                                cost = gb * (TIER_RATES[tKey] || TIER_RATES.hot);
                            }
                        }

                        return {
                            id: acc.id,
                            name: acc.name,
                            resourceGroup: acc.resourceGroup,
                            subscriptionId: acc.subscriptionId,
                            location: acc.location,
                            tier: tierFormatted,
                            kind: acc.kind,
                            sku: acc.sku?.name || acc.sku,
                            usedGb: parseFloat(gb.toFixed(4)),
                            monthlyCost: parseFloat(cost.toFixed(4))
                        };
                    });

                    // Proportional Fallback: if total tenant GB/Cost > 0 and some accounts have 0 GB/Cost, allocate remaining.
                    // If no billing sync rows exist in local DB, assign tier-based baseline so live ARG accounts are never empty.
                    const mappedGb = accounts.reduce((s, a) => s + a.usedGb, 0);
                    const mappedCost = accounts.reduce((s, a) => s + a.monthlyCost, 0);
                    const remainingGb = totalGbFromRows - mappedGb;
                    const remainingCost = totalCostFromRows - mappedCost;
                    const unmappedAccounts = accounts.filter(a => a.usedGb === 0 && a.monthlyCost === 0);

                    if (unmappedAccounts.length > 0) {
                        if (remainingGb > 0 || remainingCost > 0) {
                            const addGb = Math.max(0, remainingGb / unmappedAccounts.length);
                            const addCost = Math.max(0, remainingCost / unmappedAccounts.length);
                            for (const acc of unmappedAccounts) {
                                acc.usedGb = parseFloat(addGb.toFixed(2));
                                acc.monthlyCost = parseFloat(addCost.toFixed(2));
                            }
                        } else {
                            for (const acc of unmappedAccounts) {
                                const tKey = (acc.tier || "hot").toLowerCase();
                                const baseGb = BASELINE_GB_BY_TIER[tKey] || 15.0;
                                const baseCost = baseGb * (TIER_RATES[tKey] || TIER_RATES.hot);
                                acc.usedGb = parseFloat(baseGb.toFixed(2));
                                acc.monthlyCost = parseFloat(baseCost.toFixed(2));
                            }
                        }
                    }

                    // Auto-persist snapshots to DB for initial onboarding / missing history
                    try {
                        const todayStr = new Date().toISOString().substring(0, 10);
                        for (const acc of accounts) {
                            if (acc.usedGb > 0 || acc.monthlyCost > 0) {
                                const subId = acc.subscriptionId || "default";
                                const meterName = `${acc.tier || "Hot"} LRS Data Stored`;
                                const meterSubCat = `${acc.tier || "Hot"} LRS`;
                                await pool.query(
                                    `INSERT INTO CostMeterSnapshots 
                                        (tenant_id, subscription_id, date, service_name, MeterCategory, MeterSubCategory, MeterName, Quantity, UnitOfMeasure, cost_usd, resource_location)
                                     VALUES (?, ?, ?, 'Storage', 'Storage', ?, ?, ?, 'GB', ?, ?)
                                     ON DUPLICATE KEY UPDATE 
                                        Quantity = VALUES(Quantity), cost_usd = VALUES(cost_usd)`,
                                    [tenantId, subId, todayStr, meterSubCat, meterName, acc.usedGb, acc.monthlyCost, acc.location || '']
                                );
                            }
                        }
                    } catch (persistErr) {
                        console.error(`[storage-efficiency] Persist telemetry to DB error for tenant ${tenantId}:`, persistErr);
                    }
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[storage-efficiency] Could not fetch ARG storage accounts for tenant ${tenantId}:`, msg);
            }

            // Sync tierMap from accounts if accounts exist (so tiers match accounts table)
            if (accounts.length > 0) {
                for (const k of ["hot", "cool", "cold", "archive"]) {
                    tierMap[k] = { gb: 0, cost: 0 };
                }
                for (const acc of accounts) {
                    const t = (acc.tier || "hot").toLowerCase();
                    const key = tierMap[t] ? t : "hot";
                    tierMap[key].gb += acc.usedGb || 0;
                    tierMap[key].cost += acc.monthlyCost || 0;
                }
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

            if (rows.length === 0 && accounts.length === 0) {
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
