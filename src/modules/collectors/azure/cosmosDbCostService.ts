/**
 * Cosmos DB Cost Service — detección de RU/s aprovisionadas (Provisioned Throughput)
 * con consumo real bajo, candidatas a migrar a Serverless o Autoscale.
 *
 * RBAC mínimo requerido (Service Principal del tenant):
 *   - Reader (Resource Graph) para inventariar cuentas/DBs/containers y su modo
 *     de throughput.
 *   - Monitoring Reader para leer NormalizedRUConsumption (Azure Monitor).
 *   - Cost Management Reader para el costo actual (MonthToDate) por recurso.
 * Solo lectura — feature de tier Business+ (ver route.ts).
 *
 * Punto ciego del reporte: bases "Provisioned Throughput" creadas para proyectos
 * temporales que nunca se migran a Serverless. Se detecta cruzando RU/s
 * aprovisionadas contra el % de utilización real (NormalizedRUConsumption
 * promedio de Azure Monitor): consumo bajo y sostenido = candidata clara.
 */
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { MonitorClient } from "@azure/arm-monitor";
import { isMockTenant } from "@/lib/mockData";
import { decimalToCents, centsToDecimal } from "@/lib/money";

export interface CosmosDbAccountRow {
    name: string;
    resourceGroup: string;
    resourceId: string;
    provisionedRUs: number;
    avgUtilizationPct: number | null;
    monthlyCost: number;
    serverlessCandidate: boolean;
    potentialSaving: number;
}

export interface CosmosDbCostResult {
    subscriptionId: string;
    totalMonthlyCost: number;
    totalPotentialSaving: number;
    serverlessCandidates: number;
    accountCount: number;
    accounts: CosmosDbAccountRow[];
    costBreakdownAvailable: boolean;
}

function sumMoney(values: number[]): number {
    const cents = values.reduce((acc, v) => acc + decimalToCents(v), 0);
    return centsToDecimal(cents);
}

const MOCK_TIER_MULTIPLIER: Record<string, number> = {
    "11111111-2222-3333-4444-555555555555": 1,
    "22222222-3333-4444-5555-666666666666": 3,
    "44444444-5555-6666-7777-888888888888": 10,
    "33333333-4444-5555-6666-777777777777": 50,
};

function buildMockResult(tenantId: string): CosmosDbCostResult {
    const multiplier = MOCK_TIER_MULTIPLIER[tenantId] || 1;
    const base: Array<Omit<CosmosDbAccountRow, "monthlyCost" | "potentialSaving" | "serverlessCandidate"> & { baseCost: number }> = [
        { name: "cosmos-orders-prod", resourceGroup: "rg-data-prod", resourceId: "mock", provisionedRUs: 4000, avgUtilizationPct: 62, baseCost: 233.6 },
        { name: "cosmos-catalog-poc", resourceGroup: "rg-data-poc", resourceId: "mock", provisionedRUs: 1000, avgUtilizationPct: 3.1, baseCost: 58.4 },
        { name: "cosmos-sessions-legacy", resourceGroup: "rg-legacy", resourceId: "mock", provisionedRUs: 2000, avgUtilizationPct: 1.8, baseCost: 116.8 },
        { name: "cosmos-analytics-stg", resourceGroup: "rg-data-staging", resourceId: "mock", provisionedRUs: 400, avgUtilizationPct: 45, baseCost: 23.4 },
    ];
    const accounts: CosmosDbAccountRow[] = base.map((b) => {
        const monthlyCost = centsToDecimal(decimalToCents(b.baseCost) * multiplier);
        const serverlessCandidate = (b.avgUtilizationPct ?? 100) < 10;
        const potentialSaving = serverlessCandidate ? centsToDecimal(Math.round(decimalToCents(monthlyCost) * 0.6)) : 0;
        return { ...b, monthlyCost, serverlessCandidate, potentialSaving };
    });
    return {
        subscriptionId: "mock-sub",
        totalMonthlyCost: sumMoney(accounts.map((a) => a.monthlyCost)),
        totalPotentialSaving: sumMoney(accounts.map((a) => a.potentialSaving)),
        serverlessCandidates: accounts.filter((a) => a.serverlessCandidate).length,
        accountCount: accounts.length,
        accounts: accounts.sort((a, b) => b.monthlyCost - a.monthlyCost),
        costBreakdownAvailable: true,
    };
}

export const getCosmosDbCost = async (
    tenantId: string,
    subscriptionId: string
): Promise<CosmosDbCostResult> => {
    if (isMockTenant(tenantId)) {
        return buildMockResult(tenantId);
    }

    // --- Inventario vía Resource Graph: solo cuentas en modo Provisioned ---
    // (capability "EnableServerless" ausente = Provisioned Throughput)
    let rawAccounts: any[] = [];
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.documentdb/databaseaccounts'
            ${subscriptionId ? `| where subscriptionId =~ '${subscriptionId}'` : ""}
            | extend capabilities = properties.capabilities
            | where not(array_length(capabilities) > 0 and capabilities has 'EnableServerless')
            | project name, resourceGroup, resourceId = tolower(id)
        `;
        const resARG: any = await argClient.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        rawAccounts = (resARG.data as any[]) || [];
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[Cosmos DB] No se pudo inventariar para ${tenantId}:`, message);
        return { subscriptionId, totalMonthlyCost: 0, totalPotentialSaving: 0, serverlessCandidates: 0, accountCount: 0, accounts: [], costBreakdownAvailable: false };
    }

    if (rawAccounts.length === 0) {
        return { subscriptionId, totalMonthlyCost: 0, totalPotentialSaving: 0, serverlessCandidates: 0, accountCount: 0, accounts: [], costBreakdownAvailable: true };
    }

    let credential;
    try {
        credential = await getAzureCredential(tenantId);
    } catch {
        console.warn(`[Cosmos DB] Sin credenciales para ${tenantId}`);
        return { subscriptionId, totalMonthlyCost: 0, totalPotentialSaving: 0, serverlessCandidates: 0, accountCount: 0, accounts: [], costBreakdownAvailable: false };
    }

    // --- RU/s aprovisionadas + utilización promedio (NormalizedRUConsumption, 14 días) ---
    const monitorClient = subscriptionId ? new MonitorClient(credential, subscriptionId) : null;
    const now = new Date();
    const past14Days = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const timespan = `${past14Days.toISOString()}/${now.toISOString()}`;

    const ruAndUtilByResourceId: Record<string, { provisionedRUs: number; avgUtilizationPct: number | null }> = {};
    for (const acc of rawAccounts) {
        const resourceId = String(acc.resourceId);
        let provisionedRUs = 0;
        let avgUtilizationPct: number | null = null;
        if (monitorClient) {
            try {
                const metrics = await monitorClient.metrics.list(resourceId, {
                    timespan,
                    interval: "P1D",
                    metricnames: "ProvisionedThroughput,NormalizedRUConsumption",
                    aggregation: "Average",
                });
                const ruSeries: number[] = [];
                const utilSeries: number[] = [];
                for (const metric of metrics.value || []) {
                    const points = metric.timeseries?.[0]?.data || [];
                    for (const p of points) {
                        if (metric.name?.value === "ProvisionedThroughput" && typeof p.average === "number") ruSeries.push(p.average);
                        if (metric.name?.value === "NormalizedRUConsumption" && typeof p.average === "number") utilSeries.push(p.average);
                    }
                }
                if (ruSeries.length > 0) provisionedRUs = Math.round(ruSeries[ruSeries.length - 1]);
                if (utilSeries.length > 0) avgUtilizationPct = utilSeries.reduce((a, b) => a + b, 0) / utilSeries.length;
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                console.warn(`[Cosmos DB] Métricas no disponibles para ${resourceId}:`, message);
            }
        }
        ruAndUtilByResourceId[resourceId] = { provisionedRUs, avgUtilizationPct };
    }

    // --- Costo por recurso (MonthToDate) vía Cost Management ---
    const costByResourceId: Record<string, number> = {};
    let costBreakdownAvailable = false;
    if (subscriptionId) {
        try {
            const costClient = new CostManagementClient(credential);
            const scope = `/subscriptions/${subscriptionId}`;
            const costRes = await costClient.query.usage(scope, {
                type: "ActualCost",
                timeframe: "MonthToDate",
                dataset: {
                    granularity: "None",
                    aggregation: { totalCost: { name: "Cost", function: "Sum" } },
                    grouping: [{ type: "Dimension", name: "ResourceId" }],
                    filter: { dimensions: { name: "ResourceType", operator: "In", values: ["microsoft.documentdb/databaseaccounts"] } },
                },
            });
            const cols = (costRes.columns || []).map((c: any) => String(c.name).toLowerCase());
            const costIdx = cols.indexOf("cost");
            const ridIdx = cols.indexOf("resourceid");
            for (const row of costRes.rows || []) {
                const rid = ridIdx >= 0 ? String(row[ridIdx]).toLowerCase() : "";
                const cost = costIdx >= 0 ? Number(row[costIdx]) || 0 : 0;
                if (rid) costByResourceId[rid] = cost;
            }
            costBreakdownAvailable = true;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`[Cosmos DB] Sin costo (Cost Management) para ${tenantId}:`, message);
        }
    }

    // Umbral: consumo promedio <10% de la capacidad aprovisionada durante 14 días
    // = candidata clara a Serverless/Autoscale. Ahorro estimado conservador: 60%
    // del costo actual (Serverless cobra por RU consumida, no por RU reservada).
    const accounts: CosmosDbAccountRow[] = rawAccounts.map((a) => {
        const resourceId = String(a.resourceId);
        const { provisionedRUs, avgUtilizationPct } = ruAndUtilByResourceId[resourceId] || { provisionedRUs: 0, avgUtilizationPct: null };
        const monthlyCost = costByResourceId[resourceId] || 0;
        const serverlessCandidate = avgUtilizationPct !== null && avgUtilizationPct < 10;
        const potentialSaving = serverlessCandidate ? centsToDecimal(Math.round(decimalToCents(monthlyCost) * 0.6)) : 0;
        return {
            name: a.name,
            resourceGroup: a.resourceGroup,
            resourceId,
            provisionedRUs,
            avgUtilizationPct,
            monthlyCost,
            serverlessCandidate,
            potentialSaving,
        };
    });

    return {
        subscriptionId,
        totalMonthlyCost: sumMoney(accounts.map((a) => a.monthlyCost)),
        totalPotentialSaving: sumMoney(accounts.map((a) => a.potentialSaving)),
        serverlessCandidates: accounts.filter((a) => a.serverlessCandidate).length,
        accountCount: accounts.length,
        accounts: accounts.sort((a, b) => b.monthlyCost - a.monthlyCost),
        costBreakdownAvailable,
    };
};
