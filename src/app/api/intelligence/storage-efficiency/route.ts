/**
 * GET /api/intelligence/storage-efficiency — Storage Accounts FinOps & Data Governance Cockpit.
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
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import {
    StorageAccountDetail,
    StorageEfficiencyResponse,
    StorageTierDistribution,
    StorageComposition,
} from "@/types/storage.types";
import {
    TIER_RATES,
    BENCHMARK_LRS_RATE,
    detectRedundancyType,
    detectEnvironment,
    buildStorageRemediations,
} from "@/services/azureStorageAccounts.service";
import { errorMessage } from '@/lib/apiErrors';

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEMO_STORAGE_ACCOUNTS: StorageAccountDetail[] = [
    {
        id: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.Storage/storageAccounts/cscsfinopsprodwestus2sa",
        name: "cscsfinopsprodwestus2sa",
        resourceGroup: "rg-finops-prod",
        subscriptionId: "demo-sub-01",
        subscriptionName: "Suscripción Producción Core",
        location: "westus2",
        tier: "Hot",
        skuName: "Standard_ZRS",
        skuTier: "Standard",
        kind: "StorageV2",
        redundancyType: "ZRS",
        isHnsEnabled: true,
        publicAccessAllowed: false,
        minimumTlsVersion: "TLS1_2",
        supportsHttpsTrafficOnly: true,
        hasLifecyclePolicy: false,
        lifecycleRulesCount: 0,
        deleteRetentionEnabled: true,
        deleteRetentionDays: 90,
        isVersioningEnabled: true,
        activeServices: ["blob", "file", "adls_gen2"],
        environmentTag: "prod",
        tags: { env: "prod", workload: "analytics-datalake" },
        usedGb: 0.585, // 599 MB
        monthlyCost: 0.0098,
        billedCost: 0.0098,
        retailRatePerGb: 0.023,
        costSource: "retail-pricing-x-used-capacity",
        capacitySource: "azure-monitor",
        capacityUpdatedAt: new Date().toISOString(),
        metrics: {
            transactionsCount: 142050,
            egressBytes: 450000000,
            ingressBytes: 620000000,
            avgDailyCost: 0.00032,
            apiOperationsCost: 0.0025,
            capacityCost: 0.0065,
            redundancyCost: 0.0008,
        },
        isZombieCandidate: false,
    },
    {
        id: "/subscriptions/demo-sub-01/resourceGroups/rg-mgmt-core/providers/Microsoft.Storage/storageAccounts/cscsfinoosmgmtgak5xmsa",
        name: "cscsfinoosmgmtgak5xmsa",
        resourceGroup: "rg-mgmt-core",
        subscriptionId: "demo-sub-01",
        subscriptionName: "Suscripción Producción Core",
        location: "westus2",
        tier: "Hot",
        skuName: "Standard_LRS",
        skuTier: "Standard",
        kind: "StorageV2",
        redundancyType: "LRS",
        isHnsEnabled: false,
        publicAccessAllowed: false,
        minimumTlsVersion: "TLS1_2",
        supportsHttpsTrafficOnly: true,
        hasLifecyclePolicy: true,
        lifecycleRulesCount: 2,
        deleteRetentionEnabled: true,
        deleteRetentionDays: 7,
        isVersioningEnabled: false,
        activeServices: ["blob", "table", "queue"],
        environmentTag: "prod",
        tags: { env: "prod", role: "management-telemetry" },
        usedGb: 0.065, // ~67 MB
        monthlyCost: 0.0012,
        billedCost: 0.0012,
        retailRatePerGb: 0.0184,
        costSource: "retail-pricing-x-used-capacity",
        capacitySource: "azure-monitor",
        capacityUpdatedAt: new Date().toISOString(),
        metrics: {
            transactionsCount: 89000,
            egressBytes: 120000000,
            ingressBytes: 180000000,
            avgDailyCost: 0.00004,
            apiOperationsCost: 0.0004,
            capacityCost: 0.0007,
            redundancyCost: 0.0001,
        },
        isZombieCandidate: false,
    },
    {
        id: "/subscriptions/demo-sub-02/resourceGroups/rg-staging-env/providers/Microsoft.Storage/storageAccounts/cscsfinopsstgwestus2sa",
        name: "cscsfinopsstgwestus2sa",
        resourceGroup: "rg-staging-env",
        subscriptionId: "demo-sub-02",
        subscriptionName: "Suscripción Preproducción",
        location: "westus2",
        tier: "Hot",
        skuName: "Standard_ZRS",
        skuTier: "Standard",
        kind: "StorageV2",
        redundancyType: "ZRS",
        isHnsEnabled: false,
        publicAccessAllowed: true, // Vulnerabilidad detectada
        minimumTlsVersion: "TLS1_1", // Vulnerabilidad detectada
        supportsHttpsTrafficOnly: true,
        hasLifecyclePolicy: false,
        lifecycleRulesCount: 0,
        deleteRetentionEnabled: false,
        deleteRetentionDays: 0,
        isVersioningEnabled: false,
        activeServices: ["blob"],
        environmentTag: "staging",
        tags: { env: "staging", owner: "qa-team" },
        usedGb: 0.0, // 0 GB / Zombie
        monthlyCost: 0.0001,
        billedCost: 0.0001,
        retailRatePerGb: 0.023,
        costSource: "retail-pricing-x-used-capacity",
        capacitySource: "azure-monitor",
        capacityUpdatedAt: new Date().toISOString(),
        metrics: {
            transactionsCount: 2,
            egressBytes: 0,
            ingressBytes: 0,
            avgDailyCost: 0.000003,
            apiOperationsCost: 0.00005,
            capacityCost: 0.0,
            redundancyCost: 0.00005,
        },
        isZombieCandidate: true,
    },
];

export function getMockStoragePayload(): StorageEfficiencyResponse {
    const totalGb = 0.6503; // ~666 MB
    const totalCost = 0.0111;
    const costPerGb = parseFloat((totalCost / totalGb).toFixed(5));

    const tiers: StorageTierDistribution = {
        hot: { percent: 92, gb: 0.599, cost: 0.0098 },
        cool: { percent: 8, gb: 0.051, cost: 0.0013 },
        cold: { percent: 0, gb: 0.0, cost: 0.0 },
        archive: { percent: 0, gb: 0.0, cost: 0.0 },
    };

    const storageComposition: StorageComposition = {
        blob: { gb: 0.585, cost: 0.0089 },
        files: { gb: 0.045, cost: 0.0012 },
        queue: { gb: 0.012, cost: 0.0005 },
        table: { gb: 0.008, cost: 0.0005 },
    };

    const remediations = buildStorageRemediations(DEMO_STORAGE_ACCOUNTS);

    return {
        success: true,
        mock: true,
        tiers,
        totalGb: parseFloat(totalGb.toFixed(4)),
        totalCost: parseFloat(totalCost.toFixed(4)),
        costPerGb: 0.01698,
        projectedEndOfMonthCost: 0.02,
        benchmarkLrsCostPerGb: BENCHMARK_LRS_RATE,
        accountsCount: DEMO_STORAGE_ACCOUNTS.length,
        redundancyCounts: {
            lrs: 1,
            zrs: 2,
            grs: 0,
            other: 0,
        },
        recommendation: {
            movableGb: 0.35,
            potentialSavings: 0.005,
            fromTier: "hot",
            toTier: "cool",
        },
        remediations,
        storageComposition,
        accounts: DEMO_STORAGE_ACCOUNTS,
    };
}

function detectTier(...fields: Array<string | null | undefined>): string {
    for (const f of fields) {
        if (!f) continue;
        const m = String(f).toLowerCase();
        if (m.includes("archive")) return "archive";
        if (m.includes("cold")) return "cold";
        if (m.includes("cool")) return "cool";
        if (m.includes("hot")) return "hot";
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

function normalizeResourceId(resourceId: string): string {
    return String(resourceId || "").trim().toLowerCase();
}

interface LiveMetricsResult {
    bytes: number;
    timestamp: string | null;
    transactions: number;
    egress: number;
    ingress: number;
    hasCapacityMetric: boolean;
    /**
     * Bytes por tier de acceso (hot/cool/cold/archive), de la métrica
     * `BlobCapacity` con dimensión `Tier`. `UsedCapacity` (arriba) es el total
     * de la CUENTA sin desglose; `properties.accessTier` de la cuenta sólo
     * puede ser Hot o Cool (es el tier por default de blobs nuevos, no la
     * distribución real) — Cold y Archive son tiers a nivel de BLOB, nunca
     * aparecen ahí. Sin esto, el 100% de la capacidad de toda cuenta caía en
     * el bucket de su accessTier y Cold/Archive quedaban siempre en cero
     * aunque la cuenta tuviera blobs en esos tiers.
     */
    tierBytes: Record<string, number>;
}

/**
 * Desglose real de capacidad por tier de una cuenta (Hot/Cool/Cold/Archive),
 * vía `BlobCapacity` en el namespace `blobServices` con `$filter=tier eq '*'`
 * (Azure devuelve una timeserie por cada valor de tier presente). Se emite
 * una sola vez al día, así que hace falta P1D de intervalo — PT1H (usado para
 * UsedCapacity) siempre viene vacío para esta métrica.
 *
 * Falla en silencio (devuelve {}) ante cualquier error: es un enriquecimiento
 * sobre el total de cuenta que ya se tiene, no un dato crítico.
 */
async function fetchBlobTierCapacity(accountId: string, headers: Record<string, string>): Promise<Record<string, number>> {
    const tierBytes: Record<string, number> = {};
    try {
        const end = new Date();
        const start = new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000);
        const query = new URLSearchParams({
            "api-version": "2018-01-01",
            metricnames: "BlobCapacity",
            metricnamespace: "Microsoft.Storage/storageAccounts/blobServices",
            timespan: `${start.toISOString()}/${end.toISOString()}`,
            interval: "P1D",
            aggregation: "Average",
            "$filter": "tier eq '*'",
        });
        const url = `https://management.azure.com${accountId}/blobServices/default/providers/Microsoft.Insights/metrics?${query}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return tierBytes;
        const data = await res.json();

        for (const metric of data.value || []) {
            for (const series of metric.timeseries || []) {
                const tierValue = (series.metadatavalues || []).find(
                    (mv: any) => String(mv.name?.value || mv.name || "").toLowerCase() === "tier"
                )?.value;
                if (!tierValue) continue;
                const tierKey = String(tierValue).toLowerCase();

                const latestPoint = [...(series.data || [])]
                    .reverse()
                    .find((point: any) => point && Number.isFinite(point.average) && point.average >= 0);
                if (latestPoint) {
                    tierBytes[tierKey] = (tierBytes[tierKey] || 0) + latestPoint.average;
                }
            }
        }
    } catch {
        // Enriquecimiento opcional: sin esto, se sigue usando el total de cuenta.
    }
    return tierBytes;
}

async function fetchStorageAccountMetricsBatch(tenantId: string, accounts: any[]): Promise<Map<string, LiveMetricsResult>> {
    const metricsMap = new Map<string, LiveMetricsResult>();
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
                        metricnames: "UsedCapacity,Transactions,Egress,Ingress",
                        metricnamespace: "Microsoft.Storage/storageAccounts",
                        timespan,
                        interval: "PT1H",
                        aggregation: "Average,Total",
                    });
                    const url = `https://management.azure.com${acc.id}/providers/Microsoft.Insights/metrics?${query}`;
                    const res = await fetch(url, { headers });
                    if (res.ok) {
                        const data = await res.json();
                        let bytes = 0;
                        let timestamp: string | null = null;
                        let transactions = 0;
                        let egress = 0;
                        let ingress = 0;
                        let hasCapacityMetric = false;

                        for (const metric of data.value || []) {
                            const name = String(metric.name?.value || metric.name || "").toLowerCase();
                            const isCapacity = !name || name.includes("usedcapacity") || name.includes("capacity");
                            const isTx = name.includes("transactions");
                            const isEg = name.includes("egress");
                            const isIg = name.includes("ingress");

                            if (isCapacity) {
                                for (const series of metric.timeseries || []) {
                                    const latestPoint = [...(series.data || [])]
                                        .reverse()
                                        .find((point: any) => point && Number.isFinite(point.average) && point.average >= 0);
                                    if (latestPoint) {
                                        bytes = latestPoint.average;
                                        timestamp = typeof latestPoint.timeStamp === "string" ? latestPoint.timeStamp : null;
                                        hasCapacityMetric = true;
                                        break;
                                    }
                                }
                            }
                            if (isTx) {
                                for (const series of metric.timeseries || []) {
                                    for (const pt of series.data || []) {
                                        if (Number.isFinite(pt.total)) transactions += pt.total;
                                    }
                                }
                            }
                            if (isEg) {
                                for (const series of metric.timeseries || []) {
                                    for (const pt of series.data || []) {
                                        if (Number.isFinite(pt.total)) egress += pt.total;
                                    }
                                }
                            }
                            if (isIg) {
                                for (const series of metric.timeseries || []) {
                                    for (const pt of series.data || []) {
                                        if (Number.isFinite(pt.total)) ingress += pt.total;
                                    }
                                }
                            }
                        }

                        const tierBytes = await fetchBlobTierCapacity(acc.id, headers);

                        if (hasCapacityMetric || transactions > 0 || egress > 0 || ingress > 0 || Object.keys(tierBytes).length > 0) {
                            metricsMap.set(acc.id, { bytes, timestamp, transactions, egress, ingress, hasCapacityMetric, tierBytes });
                        }
                    }
                } catch {
                    // Ignore single account metric failure
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

async function queryStorageAccountAttributionRows(
    tenantId: string,
    days: number,
    startDate?: string | null,
    endDate?: string | null
) {
    let dateCond = "AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)";
    let params: any[] = [tenantId, days];
    if (startDate && endDate) {
        dateCond = "AND date >= ? AND date <= ?";
        params = [tenantId, startDate, endDate];
    }

    try {
        const [rows]: any = await pool.query(
            `SELECT
                LOWER(COALESCE(ResourceId, '')) AS resourceId,
                LOWER(COALESCE(resource_group, '')) AS resourceGroup,
                MeterName,
                MeterSubCategory,
                UnitOfMeasure,
                COALESCE(Quantity, 0) AS quantity,
                service_name,
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
    } catch {
        return [];
    }
}

async function runQuery(tenantId: string, days: number, startDate?: string | null, endDate?: string | null): Promise<{ rows: any[]; source: 'meters' | 'legacy' }> {
    try {
        const meterRows = await queryMeterRows(tenantId, days, startDate, endDate);
        if (meterRows.length > 0) return { rows: meterRows, source: 'meters' };
    } catch (e) {
        console.error(`[storage-efficiency] Error queryMeterRows para ${tenantId}:`, e);
    }
    const legacyRows = await queryLegacyRows(tenantId, days, startDate, endDate);
    if (legacyRows.length > 0) return { rows: legacyRows, source: 'legacy' };
    return { rows: [], source: 'legacy' };
}

async function getUntruncatedSubscriptions(tenantId: string): Promise<string[]> {
    const cred = await getAzureCredential(tenantId);
    const subs: string[] = [];
    try {
        const tokenResponse = await cred.getToken("https://management.azure.com/.default");
        const headers = { Authorization: `Bearer ${tokenResponse.token}` };
        let nextUrl: string | null = "https://management.azure.com/subscriptions?api-version=2020-01-01";
        const visitedUrls = new Set<string>();

        while (nextUrl && !visitedUrls.has(nextUrl)) {
            visitedUrls.add(nextUrl);
            const fetchRes: Response = await fetch(nextUrl, { headers });
            if (!fetchRes.ok) break;
            const data: { value?: Array<{ subscriptionId?: string }>; nextLink?: string } = await fetchRes.json();
            for (const sub of data.value || []) {
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
        | project id, name, location, resourceGroup, subscriptionId, sku, kind, properties, tags
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
                    ...(skipToken ? { skipToken } : {}),
                },
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

        const requestUrl = (request as any).nextUrl ? (request as any).nextUrl : new URL((request as any).url || "http://localhost", "http://localhost");
        const isMockParam = requestUrl.searchParams?.get("mock") === "true";
        if (isMockTenant(tenantId) || tenantId.startsWith("mock-") || tenantId.startsWith("demo-") || isMockParam) {
            const mockData = getMockDataForRoute("storage_efficiency", tenantId);
            return NextResponse.json(mockData || getMockStoragePayload());
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
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

            let accounts: StorageAccountDetail[] = [];
            // Desglose real por tier (GB) por cuenta — poblado más abajo cuando
            // `fetchBlobTierCapacity` trae datos; usado por la agregación de
            // "Distribución por Tier".
            const tierBreakdownGbByAccountId = new Map<string, Record<string, number>>();
            try {
                let subs = await getUntruncatedSubscriptions(tenantId);
                if (!subs || subs.length === 0) {
                    subs = Array.from(new Set(rows.map((r) => String(r.subscription_id || r.subscriptionId || "")).filter((s) => s && s !== "default")));
                }

                if (subs.length > 0) {
                    const rawAccounts = await fetchAllStorageAccountsFromARG(tenantId, subs);
                    const credential = await getAzureCredential(tenantId);
                    const attributionRows = await queryStorageAccountAttributionRows(tenantId, days, startDate, endDate);
                    const costByResourceId = new Map<string, number>();
                    const costByRg = new Map<string, number>();

                    for (const row of attributionRows) {
                        const cost = parseFloat(row.billedCost) || 0;
                        if (cost <= 0) continue;
                        const rid = normalizeResourceId(row.resourceId || "");
                        const rg = String(row.resourceGroup || "").toLowerCase();
                        if (rid.includes("/providers/microsoft.storage/storageaccounts/")) {
                            costByResourceId.set(rid, (costByResourceId.get(rid) || 0) + cost);
                        }
                        if (rg && rg !== "*") {
                            costByRg.set(rg, (costByRg.get(rg) || 0) + cost);
                        }
                    }

                    const liveMetricsMap = await fetchStorageAccountMetricsBatch(tenantId, rawAccounts);
                    const subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);

                    accounts = rawAccounts.map((acc: any) => {
                        const skuStr = String(acc.sku?.name || acc.sku || "Standard_LRS");
                        const rawTier = acc.properties?.accessTier || (skuStr.toLowerCase().includes("premium") ? "Premium" : "Hot");
                        const rg = (acc.resourceGroup || "").toLowerCase();
                        const normalizedId = normalizeResourceId(acc.id);
                        const directCost = costByResourceId.get(normalizedId) || 0;
                        const countInGroup = rawAccounts.filter((a: any) => (a.resourceGroup || "").toLowerCase() === rg).length || 1;
                        const groupCost = costByRg.get(rg) || 0;
                        const cost = directCost > 0 ? directCost : (groupCost > 0 ? groupCost / countInGroup : 0);

                        const liveMetric = liveMetricsMap.get(acc.id);
                        const hasCapacity = Boolean(liveMetric && liveMetric.hasCapacityMetric);
                        const usedGb = hasCapacity && Number.isFinite(liveMetric!.bytes) && liveMetric!.bytes >= 0
                            ? liveMetric!.bytes / (1024 * 1024 * 1024)
                            : null;

                        if (liveMetric?.tierBytes && Object.keys(liveMetric.tierBytes).length > 0) {
                            const gbByTier: Record<string, number> = {};
                            for (const [tierKey, tierBytesValue] of Object.entries(liveMetric.tierBytes)) {
                                if (Number.isFinite(tierBytesValue) && tierBytesValue >= 0) {
                                    gbByTier[tierKey] = tierBytesValue / (1024 * 1024 * 1024);
                                }
                            }
                            if (Object.values(gbByTier).some((v) => v > 0)) {
                                tierBreakdownGbByAccountId.set(acc.id, gbByTier);
                            }
                        }

                        const redundancy = detectRedundancyType(skuStr);
                        const isHns = Boolean(acc.properties?.isHnsEnabled);
                        const allowPublic = acc.properties?.allowBlobPublicAccess ?? false;
                        const minTls = acc.properties?.minimumTlsVersion || "TLS1_2";
                        const httpsOnly = acc.properties?.supportsHttpsTrafficOnly ?? true;

                        const activeServices: Array<"blob" | "file" | "queue" | "table" | "adls_gen2"> = [];
                        if (isHns) activeServices.push("adls_gen2");
                        activeServices.push("blob");
                        const kindLower = String(acc.kind || "").toLowerCase();
                        if (kindLower.includes("file") || kindLower.includes("storagev2")) activeServices.push("file");
                        if (kindLower.includes("queue") || kindLower.includes("storagev2")) activeServices.push("queue");
                        if (kindLower.includes("table") || kindLower.includes("storagev2")) activeServices.push("table");

                        const retailRate = TIER_RATES[String(rawTier || "hot").toLowerCase()] ?? BENCHMARK_LRS_RATE;
                        const capacityEstimatedCost = usedGb !== null && retailRate > 0 ? usedGb * retailRate : 0;
                        const resolvedMonthlyCost = capacityEstimatedCost > 0 ? capacityEstimatedCost : cost;

                        const txCount = liveMetric?.transactions ?? 0;
                        const isZombie = (usedGb === null || usedGb <= 0.0001) && txCount < 10;

                        return {
                            id: acc.id,
                            name: acc.name,
                            resourceGroup: acc.resourceGroup,
                            subscriptionId: acc.subscriptionId,
                            subscriptionName: resolveSubscriptionName(acc.subscriptionId, subscriptionNameMap) || acc.subscriptionId,
                            location: acc.location,
                            tier: rawTier,
                            skuName: skuStr,
                            skuTier: acc.sku?.tier || "Standard",
                            kind: acc.kind || "StorageV2",
                            redundancyType: redundancy,
                            isHnsEnabled: isHns,
                            publicAccessAllowed: allowPublic,
                            minimumTlsVersion: minTls,
                            supportsHttpsTrafficOnly: httpsOnly,
                            hasLifecyclePolicy: false,
                            lifecycleRulesCount: 0,
                            deleteRetentionEnabled: true,
                            deleteRetentionDays: 14,
                            isVersioningEnabled: false,
                            activeServices,
                            environmentTag: detectEnvironment(acc.tags, acc.name, acc.resourceGroup),
                            tags: acc.tags || {},
                            usedGb: usedGb === null ? null : parseFloat(usedGb.toFixed(4)),
                            monthlyCost: parseFloat(resolvedMonthlyCost.toFixed(4)),
                            billedCost: parseFloat(cost.toFixed(4)),
                            retailRatePerGb: parseFloat(retailRate.toFixed(6)),
                            costSource: capacityEstimatedCost > 0 ? "retail-pricing-x-used-capacity" : "billed-attribution",
                            capacitySource: hasCapacity ? "azure-monitor" : "unavailable",
                            capacityUpdatedAt: hasCapacity ? (liveMetric?.timestamp ?? null) : null,
                            metrics: {
                                transactionsCount: txCount,
                                egressBytes: liveMetric?.egress ?? 0,
                                ingressBytes: liveMetric?.ingress ?? 0,
                                avgDailyCost: resolvedMonthlyCost > 0 ? resolvedMonthlyCost / Math.max(effectiveDays, 1) : 0,
                            },
                            isZombieCandidate: isZombie,
                        };
                    });
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[storage-efficiency] Could not fetch ARG storage accounts for tenant ${tenantId}:`, msg);
            }

            if (accounts.length > 0) {
                for (const k of ["hot", "cool", "cold", "archive"]) {
                    tierMap[k] = { gb: 0, cost: 0 };
                }
                for (const acc of accounts) {
                    const breakdown = tierBreakdownGbByAccountId.get(acc.id);
                    const breakdownTotalGb = breakdown ? Object.values(breakdown).reduce((s, v) => s + v, 0) : 0;

                    if (breakdown && breakdownTotalGb > 0) {
                        // Desglose real por tier (Hot/Cool/Cold/Archive): reparte el
                        // costo de la cuenta proporcional al GB de cada tier, en vez
                        // de volcar el 100% en el único `accessTier` de la cuenta.
                        for (const [tierKey, tierGb] of Object.entries(breakdown)) {
                            const key = tierMap[tierKey] ? tierKey : "hot";
                            const share = tierGb / breakdownTotalGb;
                            tierMap[key].gb += tierGb;
                            tierMap[key].cost += (acc.monthlyCost || 0) * share;
                        }
                    } else {
                        const t = (acc.tier || "hot").toLowerCase();
                        const key = tierMap[t] ? t : "hot";
                        tierMap[key].gb += acc.usedGb ?? 0;
                        tierMap[key].cost += acc.monthlyCost || 0;
                    }
                }
            }

            const totalCost = Object.values(tierMap).reduce((s, t) => s + t.cost, 0);
            const totalGb = Object.values(tierMap).reduce((s, t) => s + t.gb, 0);
            const costPerGb = totalGb > 0 ? totalCost / totalGb : 0;
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const currentDay = Math.max(now.getDate(), 1);
            const projectedEndOfMonthCost = parseFloat(((totalCost / currentDay) * daysInMonth).toFixed(4));

            const storageComposition = {
                blob: {
                    gb: Number(storageCompositionMap.blob.gb.toFixed(4)),
                    cost: Number(storageCompositionMap.blob.cost.toFixed(4)),
                },
                files: {
                    gb: Number(storageCompositionMap.files.gb.toFixed(4)),
                    cost: Number(storageCompositionMap.files.cost.toFixed(4)),
                },
                queue: {
                    gb: Number(storageCompositionMap.queue.gb.toFixed(4)),
                    cost: Number(storageCompositionMap.queue.cost.toFixed(4)),
                },
                table: {
                    gb: Number(storageCompositionMap.table.gb.toFixed(4)),
                    cost: Number(storageCompositionMap.table.cost.toFixed(4)),
                },
            };

            const tiersWithPercent: StorageTierDistribution = Object.fromEntries(
                Object.entries(tierMap).map(([k, v]) => [
                    k,
                    {
                        gb: parseFloat(v.gb.toFixed(4)),
                        cost: parseFloat(v.cost.toFixed(4)),
                        percent: totalGb > 0 ? Math.round((v.gb / totalGb) * 100) : 0,
                    },
                ])
            ) as any;

            const hotGb = tierMap.hot.gb;
            const movableGb = parseFloat((hotGb * 0.28).toFixed(4));
            const potentialSavings = parseFloat(((TIER_RATES.hot - TIER_RATES.cool) * movableGb).toFixed(4));

            const redundancyCounts = {
                lrs: accounts.filter((a) => a.redundancyType === "LRS").length,
                zrs: accounts.filter((a) => a.redundancyType === "ZRS").length,
                grs: accounts.filter((a) => a.redundancyType.includes("GRS")).length,
                other: accounts.filter((a) => !["LRS", "ZRS"].includes(a.redundancyType) && !a.redundancyType.includes("GRS")).length,
            };

            const remediations = buildStorageRemediations(accounts);

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

            const payload: StorageEfficiencyResponse = {
                success: true,
                mock: false,
                tiers: tiersWithPercent,
                totalGb: parseFloat(totalGb.toFixed(4)),
                totalCost: parseFloat(totalCost.toFixed(4)),
                costPerGb: parseFloat(costPerGb.toFixed(5)),
                projectedEndOfMonthCost,
                benchmarkLrsCostPerGb: BENCHMARK_LRS_RATE,
                accountsCount: accounts.length,
                redundancyCounts,
                recommendation: {
                    movableGb,
                    potentialSavings,
                    fromTier: "hot",
                    toTier: "cool",
                },
                remediations,
                storageComposition,
                accounts,
                diagnostics: { rowsFound: rows.length, requestedDays: days, effectiveDays, widened, source },
            };

            return NextResponse.json(payload);
        } catch (dbErr) {
            console.error("[storage-efficiency] DB error for real tenant:", tenantId, errorMessage(dbErr));
            return NextResponse.json(getMockStoragePayload());
        }
    } catch (err: unknown) {
        console.error("[storage-efficiency] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
