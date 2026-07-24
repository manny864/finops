/**
 * VMSS Rightsizing Service — recomendaciones reales de reducción de capacidad
 * de Virtual Machine Scale Sets basadas en CPU real (Azure Monitor), no mock.
 *
 * RBAC mínimo (Service Principal del tenant, solo lectura):
 *   - Reader (Resource Graph) para inventariar VMSS (capacidad, autoscale).
 *   - Monitoring Reader para Percentage CPU agregada del scale set.
 *   - Cost Management Reader para el costo actual por recurso.
 *
 * Heurística: P95 de CPU <20% sostenido 14 días y sin autoscale configurado
 * (sku.capacity fijo) = sobredimensionado. Ahorro estimado = reducir la
 * capacidad proporcional al headroom libre (mismo enfoque que rightsizingEngine
 * usa para VMs individuales).
 */
import { getResourceGraphClient, getAzureCredential } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { isMockTenant } from "@/lib/mockData";
import { decimalToCents, centsToDecimal } from "@/lib/money";

export interface VmssRightsizingRow {
    vmssName: string;
    resourceGroup: string;
    resourceId: string;
    currentSku: string;
    currentCapacity: number;
    recommendedCapacity: number;
    avgCpuPercent: number;
    hasAutoscale: boolean;
    monthlyCost: number;
    estimatedSavings: number;
    reason: string;
}

export interface VmssRightsizingResult {
    items: VmssRightsizingRow[];
    totalSavings: number;
    dataAvailable: boolean;
}

function sumMoney(values: number[]): number {
    const cents = values.reduce((acc, v) => acc + decimalToCents(v), 0);
    return centsToDecimal(cents);
}

const MOCK_ITEMS: VmssRightsizingRow[] = [
    { vmssName: 'vmss-web-prod', resourceGroup: 'rg-prod', resourceId: 'mock', currentSku: 'Standard_D8s_v5', currentCapacity: 6, recommendedCapacity: 4, avgCpuPercent: 18.5, hasAutoscale: false, monthlyCost: 1840, estimatedSavings: 613, reason: 'CPU P95 <20% en 14 días, sin autoscale configurado' },
    { vmssName: 'vmss-batch', resourceGroup: 'rg-data', resourceId: 'mock', currentSku: 'Standard_F8s_v2', currentCapacity: 4, recommendedCapacity: 2, avgCpuPercent: 8, hasAutoscale: false, monthlyCost: 970, estimatedSavings: 485, reason: 'CPU P95 <20% en 14 días, sin autoscale configurado' },
];

function buildMockResult(): VmssRightsizingResult {
    return { items: MOCK_ITEMS, totalSavings: MOCK_ITEMS.reduce((s, i) => s + i.estimatedSavings, 0), dataAvailable: true };
}

function p95(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx];
}

export const getVmssRightsizingRecommendations = async (tenantId: string, subscriptionId: string): Promise<VmssRightsizingResult> => {
    if (isMockTenant(tenantId)) return buildMockResult();

    let rawVmss: any[] = [];
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.compute/virtualmachinescalesets'
            ${subscriptionId ? `| where subscriptionId =~ '${subscriptionId}'` : ""}
            | project name, resourceGroup, resourceId = tolower(id),
                      skuName = tostring(sku.name), capacity = toint(sku.capacity),
                      hasAutoscale = isnotnull(properties.automaticRepairsPolicy) or isnotnull(properties.upgradePolicy.automaticOSUpgradePolicy)
        `;
        const resARG: any = await argClient.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        rawVmss = (resARG.data as any[]) || [];
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[VMSS Rightsizing] No se pudo inventariar para ${tenantId}:`, message);
        return { items: [], totalSavings: 0, dataAvailable: false };
    }

    if (rawVmss.length === 0) return { items: [], totalSavings: 0, dataAvailable: true };

    let credential;
    try {
        credential = await getAzureCredential(tenantId);
    } catch {
        return { items: [], totalSavings: 0, dataAvailable: false };
    }

    // Costo por recurso (MonthToDate) vía Cost Management.
    const costByResourceId: Record<string, number> = {};
    if (subscriptionId) {
        try {
            const costClient = new CostManagementClient(credential);
            const costRes = await costClient.query.usage(`/subscriptions/${subscriptionId}`, {
                type: "ActualCost",
                timeframe: "MonthToDate",
                dataset: {
                    granularity: "None",
                    aggregation: { totalCost: { name: "Cost", function: "Sum" } },
                    grouping: [{ type: "Dimension", name: "ResourceId" }],
                    filter: { dimensions: { name: "ResourceType", operator: "In", values: ["microsoft.compute/virtualmachinescalesets"] } },
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
        } catch (e: unknown) {
            console.warn(`[VMSS Rightsizing] Sin costo (Cost Management) para ${tenantId}:`, e instanceof Error ? e.message : e);
        }
    }

    const now = new Date();
    const past14Days = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const timespan = `${past14Days.toISOString()}/${now.toISOString()}`;

    const items: VmssRightsizingRow[] = [];
    for (const v of rawVmss) {
        const resourceId = String(v.resourceId);
        const capacity = Number(v.capacity) || 0;
        const hasAutoscale = Boolean(v.hasAutoscale);
        if (capacity <= 1 || hasAutoscale) continue; // autoscale ya se ajusta solo; capacidad mínima no baja más

        try {
            const monitorClient = new MonitorClient(credential, subscriptionId);
            const metrics = await monitorClient.metrics.list(resourceId, {
                timespan,
                interval: "P1D",
                metricnames: "Percentage CPU",
                aggregation: "Average",
            });
            const values: number[] = [];
            for (const metric of metrics.value || []) {
                for (const point of metric.timeseries?.[0]?.data || []) {
                    if (typeof point.average === "number") values.push(point.average);
                }
            }
            if (values.length === 0) continue;
            const p95Cpu = p95(values);
            if (p95Cpu >= 20) continue;

            // Reduce capacidad proporcional al headroom libre (mismo criterio que
            // rightsizingEngine.ts para VMs individuales), con piso de 1 instancia.
            const recommendedCapacity = Math.max(1, Math.floor(capacity * (p95Cpu / 20)));
            if (recommendedCapacity >= capacity) continue;

            const monthlyCost = costByResourceId[resourceId] || 0;
            const estimatedSavings = monthlyCost > 0
                ? Number((monthlyCost * (1 - recommendedCapacity / capacity)).toFixed(2))
                : 0;

            items.push({
                vmssName: v.name,
                resourceGroup: v.resourceGroup,
                resourceId,
                currentSku: String(v.skuName || "—"),
                currentCapacity: capacity,
                recommendedCapacity,
                avgCpuPercent: Math.round(p95Cpu * 10) / 10,
                hasAutoscale,
                monthlyCost,
                estimatedSavings,
                reason: `CPU P95 ${p95Cpu.toFixed(1)}% en 14 días, sin autoscale configurado`,
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`[VMSS Rightsizing] Métricas no disponibles para ${resourceId}:`, message);
        }
    }

    return {
        items: items.sort((a, b) => b.estimatedSavings - a.estimatedSavings),
        totalSavings: sumMoney(items.map((i) => i.estimatedSavings)),
        dataAvailable: true,
    };
};
