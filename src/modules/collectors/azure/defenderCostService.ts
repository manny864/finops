/**
 * Defender for Cloud Cost Service — costo por plan de Microsoft Defender for
 * Cloud (Microsoft.Security/pricings) por suscripción.
 *
 * RBAC mínimo (Service Principal del tenant):
 *   - Security Reader (o Reader) para leer Microsoft.Security/pricings.
 *   - Cost Management Reader para el costo real por suscripción.
 *   - Security Admin (solo si se usa setDefenderPlanTier) para cambiar el tier.
 *
 * Punto ciego del reporte: habilitación automática a nivel de suscripción que
 * empieza a cobrar por cada recurso nuevo. Se expone qué planes están en
 * Standard (pago) vs Free por suscripción, con el costo real MonthToDate.
 */
import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { isMockTenant } from "@/lib/mockData";

const ARM_BASE = "https://management.azure.com";
const SECURITY_API_VERSION = "2023-01-01";

export interface DefenderPlanRow {
    subscriptionId: string;
    planName: string;
    pricingTier: "Standard" | "Free";
    subPlan: string | null;
}

export interface DefenderCostResult {
    plans: DefenderPlanRow[];
    standardPlanCount: number;
    totalMonthlyCost: number;
    costBreakdownAvailable: boolean;
}

async function armToken(credential: any): Promise<string> {
    const tokenData = await credential.getToken(`${ARM_BASE}/.default`);
    if (!tokenData) throw new Error("No se pudo obtener el token de acceso de Azure Management");
    return tokenData.token;
}

const MOCK_PLANS: DefenderPlanRow[] = [
    { subscriptionId: "sub-prod", planName: "VirtualMachines", pricingTier: "Standard", subPlan: "P2" },
    { subscriptionId: "sub-prod", planName: "SqlServers", pricingTier: "Standard", subPlan: null },
    { subscriptionId: "sub-prod", planName: "StorageAccounts", pricingTier: "Free", subPlan: null },
    { subscriptionId: "sub-dev", planName: "VirtualMachines", pricingTier: "Standard", subPlan: "P1" },
    { subscriptionId: "sub-dev", planName: "AppServices", pricingTier: "Standard", subPlan: null },
    { subscriptionId: "sub-dev", planName: "KeyVaults", pricingTier: "Free", subPlan: null },
];

function buildMockResult(): DefenderCostResult {
    const standardPlanCount = MOCK_PLANS.filter((p) => p.pricingTier === "Standard").length;
    return { plans: MOCK_PLANS, standardPlanCount, totalMonthlyCost: standardPlanCount * 15 * 3, costBreakdownAvailable: true };
}

export const getDefenderCost = async (tenantId: string, subscriptionIds: string[]): Promise<DefenderCostResult> => {
    if (isMockTenant(tenantId)) return buildMockResult();

    let credential;
    try {
        credential = await getAzureCredential(tenantId);
    } catch {
        return { plans: [], standardPlanCount: 0, totalMonthlyCost: 0, costBreakdownAvailable: false };
    }

    const plans: DefenderPlanRow[] = [];
    for (const subscriptionId of subscriptionIds) {
        try {
            const token = await armToken(credential);
            const url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Security/pricings?api-version=${SECURITY_API_VERSION}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) continue;
            const json: any = await res.json();
            for (const item of json.value || []) {
                const props = item.properties || {};
                plans.push({
                    subscriptionId,
                    planName: String(item.name || "—"),
                    pricingTier: props.pricingTier === "Standard" ? "Standard" : "Free",
                    subPlan: props.subPlan || null,
                });
            }
        } catch (e: unknown) {
            console.warn(`[Defender] No se pudo leer pricings de ${subscriptionId}:`, e instanceof Error ? e.message : e);
        }
    }

    // Costo real (MonthToDate) del servicio "Microsoft Defender for Cloud" —
    // agregado a nivel tenant (no discrimina por plan individualmente, Azure
    // no expone esa granularidad en Cost Management).
    let totalMonthlyCost = 0;
    let costBreakdownAvailable = false;
    if (subscriptionIds.length > 0) {
        try {
            const costClient = new CostManagementClient(credential);
            const costRes = await costClient.query.usage(`/subscriptions/${subscriptionIds[0]}`, {
                type: "ActualCost",
                timeframe: "MonthToDate",
                dataset: {
                    granularity: "None",
                    aggregation: { totalCost: { name: "Cost", function: "Sum" } },
                    filter: { dimensions: { name: "ServiceName", operator: "In", values: ["Microsoft Defender for Cloud", "Security Center"] } },
                },
            });
            const cols = (costRes.columns || []).map((c: any) => String(c.name).toLowerCase());
            const costIdx = cols.indexOf("cost");
            for (const row of costRes.rows || []) {
                totalMonthlyCost += costIdx >= 0 ? Number(row[costIdx]) || 0 : 0;
            }
            costBreakdownAvailable = true;
        } catch (e: unknown) {
            console.warn(`[Defender] Sin costo (Cost Management) para ${tenantId}:`, e instanceof Error ? e.message : e);
        }
    }

    return {
        plans,
        standardPlanCount: plans.filter((p) => p.pricingTier === "Standard").length,
        totalMonthlyCost: Number(totalMonthlyCost.toFixed(2)),
        costBreakdownAvailable,
    };
};

/** Cambia un plan de Defender a Free/Standard. Mutación en Azure — requiere rol Security Admin. */
export const setDefenderPlanTier = async (
    tenantId: string,
    subscriptionId: string,
    planName: string,
    pricingTier: "Standard" | "Free"
): Promise<void> => {
    const credential = await getAzureCredential(tenantId);
    const token = await armToken(credential);
    const url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Security/pricings/${planName}?api-version=${SECURITY_API_VERSION}`;
    const res = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { pricingTier } }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`No se pudo actualizar el plan ${planName}: ${res.status} ${text}`);
    }
};
