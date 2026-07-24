/**
 * Application Insights Cost Service — costo real por recurso Application
 * Insights (Microsoft.Insights/components), separado de Log Analytics.
 *
 * RBAC mínimo (Service Principal del tenant, solo lectura):
 *   - Reader (Resource Graph) para inventariar los recursos.
 *   - Cost Management Reader para el costo MonthToDate por recurso.
 *
 * A diferencia de logAnalyticsCostService.ts (que sí trae motor de optimización
 * — commitment tier, retención, daily cap), este es un gap de visibilidad
 * simple: App Insights hoy se mezcla dentro del costo de Log Analytics porque
 * ambos comparten MeterCategory "Log Analytics" en el billing. Esta vista
 * separa el costo por recurso Application Insights puntual.
 */
import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { isMockTenant } from "@/lib/mockData";

export interface AppInsightsCostRow {
    name: string;
    resourceGroup: string;
    resourceId: string;
    ingestionSamplingPercentage: number | null;
    monthlyCost: number;
}

export interface AppInsightsCostResult {
    items: AppInsightsCostRow[];
    totalMonthlyCost: number;
    costBreakdownAvailable: boolean;
}

const MOCK_ITEMS: AppInsightsCostRow[] = [
    { name: "appi-web-prod", resourceGroup: "rg-prod", resourceId: "mock", ingestionSamplingPercentage: 100, monthlyCost: 145.2 },
    { name: "appi-api-prod", resourceGroup: "rg-prod", resourceId: "mock", ingestionSamplingPercentage: 50, monthlyCost: 62.8 },
    { name: "appi-checkout", resourceGroup: "rg-apps", resourceId: "mock", ingestionSamplingPercentage: 100, monthlyCost: 38.1 },
];

function buildMockResult(): AppInsightsCostResult {
    return { items: MOCK_ITEMS, totalMonthlyCost: Number(MOCK_ITEMS.reduce((s, i) => s + i.monthlyCost, 0).toFixed(2)), costBreakdownAvailable: true };
}

export const getAppInsightsCost = async (tenantId: string, subscriptionId: string): Promise<AppInsightsCostResult> => {
    if (isMockTenant(tenantId)) return buildMockResult();

    let rawResources: any[] = [];
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.insights/components'
            ${subscriptionId ? `| where subscriptionId =~ '${subscriptionId}'` : ""}
            | project name, resourceGroup, resourceId = tolower(id), samplingPercentage = todouble(properties.SamplingPercentage)
        `;
        const resARG: any = await argClient.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        rawResources = (resARG.data as any[]) || [];
    } catch (e: unknown) {
        console.warn(`[App Insights] No se pudo inventariar para ${tenantId}:`, e instanceof Error ? e.message : e);
        return { items: [], totalMonthlyCost: 0, costBreakdownAvailable: false };
    }

    if (rawResources.length === 0) return { items: [], totalMonthlyCost: 0, costBreakdownAvailable: true };

    const costByResourceId: Record<string, number> = {};
    let costBreakdownAvailable = false;
    if (subscriptionId) {
        try {
            const credential = await getAzureCredential(tenantId);
            const costClient = new CostManagementClient(credential);
            const costRes = await costClient.query.usage(`/subscriptions/${subscriptionId}`, {
                type: "ActualCost",
                timeframe: "MonthToDate",
                dataset: {
                    granularity: "None",
                    aggregation: { totalCost: { name: "Cost", function: "Sum" } },
                    grouping: [{ type: "Dimension", name: "ResourceId" }],
                    filter: { dimensions: { name: "ResourceType", operator: "In", values: ["microsoft.insights/components"] } },
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
            console.warn(`[App Insights] Sin costo (Cost Management) para ${tenantId}:`, e instanceof Error ? e.message : e);
        }
    }

    const items: AppInsightsCostRow[] = rawResources.map((r) => ({
        name: r.name,
        resourceGroup: r.resourceGroup,
        resourceId: r.resourceId,
        ingestionSamplingPercentage: typeof r.samplingPercentage === "number" && !Number.isNaN(r.samplingPercentage) ? r.samplingPercentage : null,
        monthlyCost: Number((costByResourceId[String(r.resourceId)] || 0).toFixed(2)),
    }));

    return {
        items: items.sort((a, b) => b.monthlyCost - a.monthlyCost),
        totalMonthlyCost: Number(items.reduce((s, i) => s + i.monthlyCost, 0).toFixed(2)),
        costBreakdownAvailable,
    };
};
