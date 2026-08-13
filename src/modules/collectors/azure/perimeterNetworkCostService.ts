/**
 * Perimeter Network Cost Service — costo real por tipo de recurso de red
 * perimetral (Firewall, App Gateway/WAF, NAT Gateway, Front Door, VPN
 * Gateway/ExpressRoute, VNet Peering) vía Cost Management, agrupado por
 * ResourceType + ResourceId.
 *
 * RBAC mínimo (Service Principal del tenant): Cost Management Reader
 * (ya incluido en el tier Essential del script de onboarding).
 *
 * A diferencia de Networking Zombies (que solo detecta recursos SIN uso),
 * esto muestra el costo real de TODO el perímetro de red, esté o no
 * subutilizado — el gap del reporte para estos servicios era "no hay página
 * de costo dedicado", ya que el delete de huérfanos ya existía.
 */
import { CostManagementClient } from "@azure/arm-costmanagement";
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError } from "@/lib/azureCostColumn";
import { isMockTenant } from "@/lib/mockData";

const PERIMETER_RESOURCE_TYPES = [
    "microsoft.network/azurefirewalls",
    "microsoft.network/applicationgateways",
    "microsoft.network/applicationgatewaywebapplicationfirewallpolicies",
    "microsoft.network/frontdoorwebapplicationfirewallpolicies",
    "microsoft.network/natgateways",
    "microsoft.network/frontdoors",
    "microsoft.cdn/profiles",
    "microsoft.network/virtualnetworkgateways",
    "microsoft.network/expressroutecircuits",
    "microsoft.network/trafficmanagerprofiles",
];

export interface PerimeterCostRow {
    resourceType: string;
    resourceGroup: string;
    monthlyCost: number;
}

export interface PerimeterCostResult {
    items: PerimeterCostRow[];
    totalMonthlyCost: number;
    dataAvailable: boolean;
}

const MOCK_ITEMS: PerimeterCostRow[] = [
    { resourceType: "microsoft.network/azurefirewalls", resourceGroup: "rg-security", monthlyCost: 912.4 },
    { resourceType: "microsoft.network/applicationgateways", resourceGroup: "rg-prod", monthlyCost: 340.1 },
    { resourceType: "microsoft.network/virtualnetworkgateways", resourceGroup: "rg-network", monthlyCost: 265.0 },
    { resourceType: "microsoft.network/frontdoors", resourceGroup: "rg-cdn", monthlyCost: 88.5 },
    { resourceType: "microsoft.network/natgateways", resourceGroup: "rg-network", monthlyCost: 64.2 },
];

function buildMockResult(): PerimeterCostResult {
    return { items: MOCK_ITEMS, totalMonthlyCost: Number(MOCK_ITEMS.reduce((s, i) => s + i.monthlyCost, 0).toFixed(2)), dataAvailable: true };
}

export async function getPerimeterNetworkCost(credential: any, subscriptionId: string, tenantId: string): Promise<PerimeterCostResult> {
    if (isMockTenant(tenantId)) return buildMockResult();

    const client = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const buildQuery = (col: string) => ({
        type: "ActualCost",
        timeframe: "Custom",
        timePeriod: { from: thirtyDaysAgo, to: now },
        dataset: {
            granularity: "None",
            aggregation: { totalCost: { name: col, function: "Sum" } },
            grouping: [
                { type: "Dimension", name: "ResourceType" },
                { type: "Dimension", name: "ResourceGroup" },
            ],
            filter: { dimensions: { name: "ResourceType", operator: "In", values: PERIMETER_RESOURCE_TYPES } },
        },
    });

    const activeCol = await resolveCostColumn(tenantId);
    let result;
    try {
        result = await client.query.usage(scope, buildQuery(activeCol) as any);
    } catch (error: any) {
        if (activeCol === "CostUSD" && isCostUsdUnsupportedError(error)) {
            await degradeCostColumn(tenantId);
            try {
                result = await client.query.usage(scope, buildQuery("PreTaxCost") as any);
            } catch (retryError) {
                console.error("[Perimeter Network Cost] CostManagement error:", retryError);
                return { items: [], totalMonthlyCost: 0, dataAvailable: false };
            }
        } else {
            console.error("[Perimeter Network Cost] CostManagement error:", error);
            return { items: [], totalMonthlyCost: 0, dataAvailable: false };
        }
    }

    const cols = (result.columns || []).map((c: any) => String(c.name).toLowerCase());
    const costIdx = cols.indexOf("cost");
    const typeIdx = cols.indexOf("resourcetype");
    const rgIdx = cols.indexOf("resourcegroup");

    const items: PerimeterCostRow[] = [];
    for (const row of result.rows || []) {
        const cost = costIdx >= 0 ? Number(row[costIdx]) || 0 : 0;
        if (cost <= 0) continue;
        items.push({
            resourceType: typeIdx >= 0 ? String(row[typeIdx]).toLowerCase() : "—",
            resourceGroup: rgIdx >= 0 ? String(row[rgIdx]) : "—",
            monthlyCost: Number(cost.toFixed(2)),
        });
    }

    return {
        items: items.sort((a, b) => b.monthlyCost - a.monthlyCost),
        totalMonthlyCost: Number(items.reduce((s, i) => s + i.monthlyCost, 0).toFixed(2)),
        dataAvailable: true,
    };
}
