/**
 * GET /api/intelligence/storage-efficiency — tiers Hot/Cool/Cold/Archive y ahorro potencial.
 *
 * RBAC app: requireTenantAccess (tenant-scoped). Tier: Business (routeTiers).
 * Roles Azure requeridos: Reader para inventario ARG y Monitoring Reader para
 * Microsoft.Insights/metrics/read. Los costos provienen del histórico local,
 * cuyo productor requiere Cost Management Reader.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
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
    storageComposition: {
        blob: { gb: 11800, cost: 172.4 },
        files: { gb: 4200, cost: 58.1 },
        queue: { gb: 3200, cost: 31.7 },
        table: { gb: 900, cost: 24.55 },
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

function detectStorageComposition(...fields: Array<string | null | undefined>): "blob" | "files" | "queue" | "table" | null {
    for (const f of fields) {
        if (!f) continue;
        const value = String(f).toLowerCase();
        if (value.includes("blob")) return "blob";
        if (value.includes("file")) return "files";
        if (value.includes("queue")) return "queue";
        if (value.includes("table")) return "table";
    }
    return null;
}

function normalizeLoc(loc: string): string {
    let s = String(loc || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return s.replace(/^us(east|west|central|northcentral|southcentral|westcentral)(\d*)$/, '$1us$2');
}

function quantityToGb(quantity: number, unitOfMeasure: string): number | null {
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    const uom = String(unitOfMeasure || "").toLowerCase();
    if (!uom) return null;
    if (uom.includes("tb")) return quantity * 1024;
    if (uom.includes("gb")) return quantity;
    if (uom.includes("mb")) return quantity / 1024;
    if (uom.includes("kb")) return quantity / (1024 * 1024);
    if (uom.includes("byte")) return quantity / (1024 * 1024 * 1024);
    return null;
}

interface LiveCapacityMetric {
    bytes: number;
    timestamp: string | null;
}

async function fetchStorageAccountMetricsBatch(tenantId: string, accounts: any[]): Promise<Map<string, LiveCapacityMetric>> {
    const metricsMap = new Map<string, LiveCapacityMetric>();
    try {
        const cred = await getAzureCredential(tenantId);
        const tokenResponse = await cred.getToken("https://management.azure.com/.default");
        const headers = { Authorization: "Bearer " + tokenResponse.token };
        const end = new Date();
        const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        const timespan = `${start.toISOString()}/${end.toISOString()}`;

        await Promise.all(
            accounts.map(async (acc) => {
                if (!acc.id) return;
                try {
                    const query = new URLSearchParams({
                        "api-version": "2018-01-01",
                        metricnames: "UsedCapacity",
                        metricnamespace: "Microsoft.Storage/storageAccounts",
                        timespan,
                        interval: "PT1H",
                        aggregation: "Average",
                    });
                    const url = `https://management.azure.com${acc.id}/providers/Microsoft.Insights/metrics?${query}`;
                    const res = await fetch(url, { headers });
                    if (res.ok) {
                        const data = await res.json();
                        for (const metric of data.value || []) {
                            for (const series of metric.timeseries || []) {
                                const latestPoint = [...(series.data || [])]
                                    .reverse()
                                    .find((point: any) => Number.isFinite(point.average) && point.average >= 0);
                                if (latestPoint) {
                                    metricsMap.set(acc.id, {
                                        bytes: latestPoint.average,
                                        timestamp: typeof latestPoint.timeStamp === "string" ? latestPoint.timeStamp : null,
                                    });
                                    return;
                                }
                            }
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
    return metricsMap;
}

const STORAGE_SERVICE_FILTER = `(
                service_name LIKE '%Storage%'
             OR service_name LIKE '%Blob%'
             OR service_name LIKE '%File%'
             OR service_name LIKE '%Queue%'
             OR service_name LIKE '%Table%'
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
                LOWER(MeterCategory) IN ('storage','azure storage')
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
             OR LOWER(COALESCE(MeterCategory,'')) IN ('storage','azure storage')
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
        const headers = { "Authorization": `Bearer ${tokenResponse.token}` };
        let nextUrl: string | null = "https://management.azure.com/subscriptions?api-version=2020-01-01";
        const visitedUrls = new Set<string>();

        while (nextUrl && !visitedUrls.has(nextUrl)) {
            visitedUrls.add(nextUrl);
            const fetchRes: Response = await fetch(nextUrl, { headers });
            if (!fetchRes.ok) break;
            const data: { value?: Array<{ subscriptionId?: string }>; nextLink?: string } = await fetchRes.json();
            for (const sub of (data.value || [])) {
                if (sub.subscriptionId) subs.push(sub.subscriptionId);
            }
            nextUrl = typeof data.nextLink === "string" ? data.nextLink : null;
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
        const daysParam = searchParams.get("days");
        const parsedDays = daysParam ? parseInt(daysParam, 10) : NaN;
        const days = Number.isFinite(parsedDays) ? Math.max(1, Math.min(365, parsedDays)) : 30;

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

        const explicitStartDate = searchParams.get("startDate");
        const explicitEndDate = searchParams.get("endDate");
        const hasExplicitRange = Boolean(explicitStartDate && explicitEndDate);
        const useRollingDays = Boolean(daysParam) && !hasExplicitRange;

        const now = new Date();
        const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const monthStart = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
        const monthEnd = formatDate(now);
        const startDate = hasExplicitRange ? explicitStartDate : (useRollingDays ? null : monthStart);
        const endDate = hasExplicitRange ? explicitEndDate : (useRollingDays ? null : monthEnd);

        try {
            // Try requested window or custom range
            let { rows, source } = await runQuery(tenantId, days, startDate, endDate);
            let effectiveDays = useRollingDays ? days : now.getDate();
            let widened = false;
            if (rows.length === 0 && useRollingDays && days < 90 && !startDate) {
                ({ rows, source } = await runQuery(tenantId, 90));
                effectiveDays = 90;
                widened = rows.length > 0;
            }
            if (rows.length === 0 && useRollingDays && !startDate) {
                ({ rows, source } = await runQuery(tenantId, 365));
                effectiveDays = 365;
                widened = rows.length > 0;
            }

            // Cost history can establish financial totals, but never account capacity.
            const tierMap: Record<string, { gb: number; cost: number }> = {
                hot: { gb: 0, cost: 0 },
                cool: { gb: 0, cost: 0 },
                cold: { gb: 0, cost: 0 },
                archive: { gb: 0, cost: 0 },
            };
            const storageCompositionMap: Record<"blob" | "files" | "queue" | "table", { gb: number; cost: number }> = {
                blob: { gb: 0, cost: 0 },
                files: { gb: 0, cost: 0 },
                queue: { gb: 0, cost: 0 },
                table: { gb: 0, cost: 0 },
            };

            for (const row of rows) {
                const tier = detectTier(row.MeterSubCategory, row.MeterName, row.MeterCategory, row.service_name);
                const cost = parseFloat(row.billedCost) || 0;
                const uom = String(row.UnitOfMeasure || "").toLowerCase();
                const reportedQty = parseFloat(row.quantity) || 0;
                const reportedGb = quantityToGb(reportedQty, uom);
                const gb = reportedGb ?? 0;
                tierMap[tier].cost += cost;
                tierMap[tier].gb += gb;

                const storageType = detectStorageComposition(row.MeterSubCategory, row.MeterName, row.service_name);
                if (storageType) {
                    storageCompositionMap[storageType].cost += cost;
                    storageCompositionMap[storageType].gb += gb;
                }
            }

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
                        const uom = String(r.UnitOfMeasure || "").toLowerCase();
                        const reportedQty = parseFloat(r.quantity) || 0;
                        const reportedGb = quantityToGb(reportedQty, uom);
                        const gb = reportedGb ?? 0;

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

                        const cost = stats ? (stats.cost / countInGroup) : 0;
                        const liveMetric = liveMetricsMap.get(acc.id);
                        const usedGb = liveMetric
                            ? liveMetric.bytes / (1024 * 1024 * 1024)
                            : null;

                        return {
                            id: acc.id,
                            name: acc.name,
                            resourceGroup: acc.resourceGroup,
                            subscriptionId: acc.subscriptionId,
                            location: acc.location,
                            tier: tierFormatted,
                            kind: acc.kind,
                            sku: acc.sku?.name || acc.sku,
                            usedGb: usedGb === null ? null : parseFloat(usedGb.toFixed(4)),
                            monthlyCost: parseFloat(cost.toFixed(4)),
                            capacitySource: liveMetric ? "azure-monitor" : "unavailable",
                            capacityUpdatedAt: liveMetric?.timestamp ?? null,
                        };
                    });

                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[storage-efficiency] Could not fetch ARG storage accounts for tenant ${tenantId}:`, msg);
            }

            const rowsTotalCost = rows.reduce((sum, row) => sum + (parseFloat(row.billedCost) || 0), 0);
            const accountsTotalCost = accounts.reduce((sum, acc) => sum + (Number(acc.monthlyCost) || 0), 0);

            // Cuando la fuente principal es CostMeterSnapshots no hay resource_group/location,
            // por lo que el mapeo directo a cuenta puede quedar en 0 aunque exista costo real.
            // Fallback: distribuir costo por tier (y por capacidad si existe) para evitar KPI en cero.
            if (accounts.length > 0 && accountsTotalCost <= 0 && rowsTotalCost > 0) {
                const distributed = new Array<number>(accounts.length).fill(0);
                const weightedDistribute = (indices: number[], total: number) => {
                    if (indices.length === 0 || total <= 0) return;
                    const totalWeight = indices.reduce((acc, idx) => acc + Math.max(0, Number(accounts[idx].usedGb) || 0), 0);
                    if (totalWeight > 0) {
                        for (const idx of indices) {
                            const weight = Math.max(0, Number(accounts[idx].usedGb) || 0);
                            distributed[idx] += (total * weight) / totalWeight;
                        }
                        return;
                    }
                    const even = total / indices.length;
                    for (const idx of indices) distributed[idx] += even;
                };

                let remainingCost = rowsTotalCost;
                for (const [tier, stats] of Object.entries(tierMap)) {
                    const tierCost = Number(stats.cost || 0);
                    if (tierCost <= 0) continue;
                    const tierIndices: number[] = [];
                    for (let i = 0; i < accounts.length; i++) {
                        const accountTier = String(accounts[i].tier || "hot").toLowerCase();
                        const normalized = accountTier.includes("archive")
                            ? "archive"
                            : accountTier.includes("cold")
                              ? "cold"
                              : accountTier.includes("cool")
                                ? "cool"
                                : "hot";
                        if (normalized === tier) tierIndices.push(i);
                    }
                    if (tierIndices.length === 0) continue;
                    weightedDistribute(tierIndices, tierCost);
                    remainingCost -= tierCost;
                }

                if (remainingCost > 0) {
                    const allIndices = accounts.map((_, index) => index);
                    weightedDistribute(allIndices, remainingCost);
                }

                accounts = accounts.map((acc, index) => ({
                    ...acc,
                    monthlyCost: parseFloat(distributed[index].toFixed(4)),
                }));
            }

            // Reconciliar total de cuentas con total de costos consultados:
            // el mapeo por RG/location puede quedar parcial y dejar costo sin asignar.
            if (accounts.length > 0 && rowsTotalCost > 0) {
                const currentTotal = accounts.reduce((sum, acc) => sum + (Number(acc.monthlyCost) || 0), 0);
                const delta = rowsTotalCost - currentTotal;
                if (Math.abs(delta) > 0.01) {
                    if (delta > 0) {
                        const distributed = accounts.map((acc) => Number(acc.monthlyCost) || 0);
                        const totalWeight = accounts.reduce((acc, item) => acc + Math.max(0, Number(item.usedGb) || 0), 0);
                        if (totalWeight > 0) {
                            for (let i = 0; i < accounts.length; i++) {
                                const weight = Math.max(0, Number(accounts[i].usedGb) || 0);
                                distributed[i] += (delta * weight) / totalWeight;
                            }
                        } else {
                            const evenDelta = delta / accounts.length;
                            for (let i = 0; i < accounts.length; i++) distributed[i] += evenDelta;
                        }
                        accounts = accounts.map((acc, index) => ({
                            ...acc,
                            monthlyCost: parseFloat(Math.max(0, distributed[index]).toFixed(4)),
                        }));
                    } else if (currentTotal > 0) {
                        const factor = rowsTotalCost / currentTotal;
                        accounts = accounts.map((acc) => ({
                            ...acc,
                            monthlyCost: parseFloat((Math.max(0, Number(acc.monthlyCost) || 0) * factor).toFixed(4)),
                        }));
                    }
                }
            }

            // Sync tierMap from accounts if accounts exist (so tiers match accounts table)
            if (accounts.length > 0) {
                for (const k of ["hot", "cool", "cold", "archive"]) {
                    tierMap[k] = { gb: 0, cost: 0 };
                }
                for (const acc of accounts) {
                    const t = (acc.tier || "hot").toLowerCase();
                    const key = tierMap[t] ? t : "hot";
                    tierMap[key].gb += acc.usedGb ?? 0;
                    tierMap[key].cost += acc.monthlyCost || 0;
                }
            }

            const totalCost = Object.values(tierMap).reduce((s, t) => s + t.cost, 0);
            const totalGb   = Object.values(tierMap).reduce((s, t) => s + t.gb, 0);
            const costPerGb = totalGb > 0 ? totalCost / totalGb : 0;
            const storageComposition = {
                blob: {
                    gb: Number(storageCompositionMap.blob.gb.toFixed(2)),
                    cost: Number(storageCompositionMap.blob.cost.toFixed(2)),
                },
                files: {
                    gb: Number(storageCompositionMap.files.gb.toFixed(2)),
                    cost: Number(storageCompositionMap.files.cost.toFixed(2)),
                },
                queue: {
                    gb: Number(storageCompositionMap.queue.gb.toFixed(2)),
                    cost: Number(storageCompositionMap.queue.cost.toFixed(2)),
                },
                table: {
                    gb: Number(storageCompositionMap.table.gb.toFixed(2)),
                    cost: Number(storageCompositionMap.table.cost.toFixed(2)),
                },
            };

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
                    storageComposition,
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
                storageComposition,
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
