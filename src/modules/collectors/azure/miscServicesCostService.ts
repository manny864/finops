/**
 * Misc Services Cost Service — visibilidad básica de costo (sin motor de
 * optimización) para servicios de Azure que hoy no aparecen en ninguna
 * página dedicada: AVD, ACI, Batch, Azure NetApp Files, PostgreSQL/MySQL,
 * Synapse/Data Factory, Databricks, Azure Cache for Redis, Key Vault.
 *
 * RBAC mínimo: Cost Management Reader (tier Essential del onboarding, ya
 * otorgado a todos los tenants). Feature gratuita — solo visibilidad, no hay
 * página de optimización dedicada para estos servicios (fuera de alcance).
 */
import { CostManagementClient } from "@azure/arm-costmanagement";
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError } from "@/lib/azureCostColumn";
import { isMockTenant } from "@/lib/mockData";

export const MISC_SERVICE_TYPES: Record<string, string> = {
    "microsoft.desktopvirtualization/hostpools": "Azure Virtual Desktop",
    "microsoft.desktopvirtualization/workspaces": "Azure Virtual Desktop",
    "microsoft.containerinstance/containergroups": "Container Instances (ACI)",
    "microsoft.batch/batchaccounts": "Azure Batch",
    "microsoft.netapp/netappaccounts": "Azure NetApp Files",
    "microsoft.dbforpostgresql/flexibleservers": "PostgreSQL",
    "microsoft.dbforpostgresql/servers": "PostgreSQL",
    "microsoft.dbformysql/flexibleservers": "MySQL",
    "microsoft.dbformysql/servers": "MySQL",
    "microsoft.synapse/workspaces": "Synapse Analytics",
    "microsoft.datafactory/factories": "Data Factory",
    "microsoft.databricks/workspaces": "Databricks",
    "microsoft.cache/redis": "Azure Cache for Redis",
    "microsoft.cache/redisenterprise": "Azure Cache for Redis Enterprise",
    "microsoft.keyvault/vaults": "Key Vault",
};

export interface MiscServiceCostRow {
    resourceType: string;
    serviceLabel: string;
    monthlyCost: number;
}

export interface MiscServicesCostResult {
    items: MiscServiceCostRow[];
    totalMonthlyCost: number;
    dataAvailable: boolean;
}

const MOCK_ITEMS: MiscServiceCostRow[] = [
    { resourceType: "microsoft.dbforpostgresql/flexibleservers", serviceLabel: "PostgreSQL", monthlyCost: 214.6 },
    { resourceType: "microsoft.databricks/workspaces", serviceLabel: "Databricks", monthlyCost: 890.0 },
    { resourceType: "microsoft.cache/redis", serviceLabel: "Azure Cache for Redis", monthlyCost: 76.3 },
    { resourceType: "microsoft.keyvault/vaults", serviceLabel: "Key Vault", monthlyCost: 4.1 },
    { resourceType: "microsoft.datafactory/factories", serviceLabel: "Data Factory", monthlyCost: 58.9 },
];

function buildMockResult(): MiscServicesCostResult {
    return { items: MOCK_ITEMS, totalMonthlyCost: Number(MOCK_ITEMS.reduce((s, i) => s + i.monthlyCost, 0).toFixed(2)), dataAvailable: true };
}

export async function getMiscServicesCost(credential: any, subscriptionId: string, tenantId: string): Promise<MiscServicesCostResult> {
    if (isMockTenant(tenantId)) return buildMockResult();

    const client = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const resourceTypes = Object.keys(MISC_SERVICE_TYPES);
    const buildQuery = (col: string) => ({
        type: "ActualCost",
        timeframe: "Custom",
        timePeriod: { from: thirtyDaysAgo, to: now },
        dataset: {
            granularity: "None",
            aggregation: { totalCost: { name: col, function: "Sum" } },
            grouping: [{ type: "Dimension", name: "ResourceType" }],
            filter: { dimensions: { name: "ResourceType", operator: "In", values: resourceTypes } },
        },
    });

    let activeCol = await resolveCostColumn(tenantId);
    let result;
    try {
        result = await client.query.usage(scope, buildQuery(activeCol) as any);
    } catch (error: any) {
        if (activeCol === "CostUSD" && isCostUsdUnsupportedError(error)) {
            await degradeCostColumn(tenantId);
            try {
                result = await client.query.usage(scope, buildQuery("PreTaxCost") as any);
            } catch (retryError) {
                console.error("[Misc Services Cost] CostManagement error:", retryError);
                return { items: [], totalMonthlyCost: 0, dataAvailable: false };
            }
        } else {
            console.error("[Misc Services Cost] CostManagement error:", error);
            return { items: [], totalMonthlyCost: 0, dataAvailable: false };
        }
    }

    const cols = (result.columns || []).map((c: any) => String(c.name).toLowerCase());
    const costIdx = cols.indexOf("cost");
    const typeIdx = cols.indexOf("resourcetype");

    const items: MiscServiceCostRow[] = [];
    for (const row of result.rows || []) {
        const cost = costIdx >= 0 ? Number(row[costIdx]) || 0 : 0;
        if (cost <= 0) continue;
        const resourceType = typeIdx >= 0 ? String(row[typeIdx]).toLowerCase() : "—";
        items.push({ resourceType, serviceLabel: MISC_SERVICE_TYPES[resourceType] || resourceType, monthlyCost: Number(cost.toFixed(2)) });
    }

    return {
        items: items.sort((a, b) => b.monthlyCost - a.monthlyCost),
        totalMonthlyCost: Number(items.reduce((s, i) => s + i.monthlyCost, 0).toFixed(2)),
        dataAvailable: true,
    };
}
