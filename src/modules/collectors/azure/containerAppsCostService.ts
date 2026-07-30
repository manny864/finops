/**
 * Container Apps Cost Service — control de costos de Azure Container Apps
 * (Microsoft.App/containerApps).
 *
 * RBAC mínimo requerido (Service Principal del tenant):
 *   - Reader (Resource Graph) para inventariar los Container Apps y leer su
 *     configuración de escalado (min/maxReplicas, CPU/memoria).
 *   - Cost Management Reader para el costo actual (MonthToDate) por recurso.
 * No requiere ningún rol de escritura: es una feature de solo lectura /
 * observabilidad de gasto. Feature de tier Business+ (ver route.ts).
 *
 * Detección de ahorro: un Container App con `minReplicas >= 1` mantiene al
 * menos una réplica encendida 24/7 aunque no reciba tráfico. Habilitar
 * scale-to-zero (minReplicas = 0) elimina el costo de esa réplica idle en
 * workloads con tráfico intermitente. El ahorro potencial se estima como la
 * fracción del costo atribuible a la(s) réplica(s) siempre encendida(s).
 *
 * Regla Cero (precisión): todos los montos se agregan en centavos enteros
 * (helpers de src/lib/money.ts) para evitar drift de floats.
 */
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { isMockTenant } from "@/lib/mockData";
import { decimalToCents, centsToDecimal } from "@/lib/money";

export interface ContainerAppCostRow {
    name: string;
    resourceGroup: string;
    environment: string;
    cpuCores: number;
    memoryGb: number;
    minReplicas: number;
    maxReplicas: number;
    monthlyCost: number;
    scaleToZeroCandidate: boolean;
    potentialSaving: number;
}

export interface ContainerAppsCostResult {
    subscriptionId: string;
    totalMonthlyCost: number;
    totalPotentialSaving: number;
    scaleToZeroCandidates: number;
    appCount: number;
    apps: ContainerAppCostRow[];
    costBreakdownAvailable: boolean;
}

/** Suma exacta de montos decimales usando centavos enteros. */
function sumMoney(values: number[]): number {
    const cents = values.reduce((acc, v) => acc + decimalToCents(v), 0);
    return centsToDecimal(cents);
}

/** "1Gi" | "0.5Gi" | "512Mi" → GiB numérico. */
function parseMemoryToGb(raw: unknown): number {
    if (typeof raw === "number") return raw;
    if (typeof raw !== "string") return 0;
    const m = raw.trim().match(/^([\d.]+)\s*(Gi|Mi)?$/i);
    if (!m) return 0;
    const value = parseFloat(m[1]);
    if (!Number.isFinite(value)) return 0;
    const unit = (m[2] || "Gi").toLowerCase();
    return unit === "mi" ? value / 1024 : value;
}

const MOCK_TIER_MULTIPLIER: Record<string, number> = {
    "11111111-2222-3333-4444-555555555555": 1, // essential
    "22222222-3333-4444-5555-666666666666": 3, // pro
    "44444444-5555-6666-7777-888888888888": 10, // business
    "33333333-4444-5555-6666-777777777777": 50, // enterprise
};

function buildMockResult(tenantId: string): ContainerAppsCostResult {
    const multiplier = MOCK_TIER_MULTIPLIER[tenantId] || 1;
    // Catálogo base de Container Apps de demo. El costo escala por tier
    // (multiplier) para reflejar la magnitud de gasto del plan del tenant.
    const base: Array<Omit<ContainerAppCostRow, "monthlyCost" | "potentialSaving" | "scaleToZeroCandidate"> & { baseCost: number; baseSaving: number }> = [
        { name: "api-gateway", resourceGroup: "rg-apps-prod", environment: "cae-prod", cpuCores: 1, memoryGb: 2, minReplicas: 2, maxReplicas: 10, baseCost: 128.4, baseSaving: 0 },
        { name: "checkout-worker", resourceGroup: "rg-apps-prod", environment: "cae-prod", cpuCores: 0.5, memoryGb: 1, minReplicas: 1, maxReplicas: 5, baseCost: 42.6, baseSaving: 32.1 },
        { name: "report-generator", resourceGroup: "rg-apps-batch", environment: "cae-batch", cpuCores: 1, memoryGb: 2, minReplicas: 1, maxReplicas: 3, baseCost: 61.2, baseSaving: 55.4 },
        { name: "webhook-receiver", resourceGroup: "rg-apps-prod", environment: "cae-prod", cpuCores: 0.25, memoryGb: 0.5, minReplicas: 1, maxReplicas: 2, baseCost: 18.9, baseSaving: 14.2 },
        { name: "frontend-ssr", resourceGroup: "rg-apps-prod", environment: "cae-prod", cpuCores: 1, memoryGb: 2, minReplicas: 3, maxReplicas: 12, baseCost: 154.8, baseSaving: 0 },
        { name: "nightly-etl", resourceGroup: "rg-apps-batch", environment: "cae-batch", cpuCores: 2, memoryGb: 4, minReplicas: 1, maxReplicas: 1, baseCost: 96.0, baseSaving: 88.0 },
    ];

    const apps: ContainerAppCostRow[] = base.map((b) => {
        const monthlyCost = centsToDecimal(decimalToCents(b.baseCost) * multiplier);
        const potentialSaving = centsToDecimal(decimalToCents(b.baseSaving) * multiplier);
        return {
            name: b.name,
            resourceGroup: b.resourceGroup,
            environment: b.environment,
            cpuCores: b.cpuCores,
            memoryGb: b.memoryGb,
            minReplicas: b.minReplicas,
            maxReplicas: b.maxReplicas,
            monthlyCost,
            scaleToZeroCandidate: potentialSaving > 0,
            potentialSaving,
        };
    });

    return {
        subscriptionId: "mock-sub",
        totalMonthlyCost: sumMoney(apps.map((a) => a.monthlyCost)),
        totalPotentialSaving: sumMoney(apps.map((a) => a.potentialSaving)),
        scaleToZeroCandidates: apps.filter((a) => a.scaleToZeroCandidate).length,
        appCount: apps.length,
        apps: apps.sort((a, b) => b.monthlyCost - a.monthlyCost),
        costBreakdownAvailable: true,
    };
}

export const getContainerAppsCost = async (
    tenantId: string,
    subscriptionId: string
): Promise<ContainerAppsCostResult> => {
    if (isMockTenant(tenantId)) {
        return buildMockResult(tenantId);
    }

    // --- Inventario vía Resource Graph ---
    let rawApps: any[] = [];
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.app/containerapps'
            ${subscriptionId ? `| where subscriptionId =~ '${subscriptionId}'` : ""}
            | extend scale = properties.template.scale
            | extend containers = properties.template.containers
            | project name,
                      resourceGroup,
                      resourceId = tolower(id),
                      environmentId = tostring(properties.environmentId),
                      minReplicas = toint(scale.minReplicas),
                      maxReplicas = toint(scale.maxReplicas),
                      cpu = todouble(containers[0].resources.cpu),
                      memory = tostring(containers[0].resources.memory)
        `;
        const resARG: any = await argClient.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        rawApps = (resARG.data as any[]) || [];
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        // Se loguea el error COMPLETO, no sólo `message`. Resource Graph contesta con
        // un mensaje genérico ("Please provide below info when asking for support:
        // timestamp = …, correlationId = …") que no dice nada de la causa: el detalle
        // real viene en e.code y en el body de la respuesta. Con sólo el message,
        // esta tarjeta llevaba días fallando en prod sin que se pudiera diagnosticar.
        const err = e as { code?: string; statusCode?: number; details?: unknown; body?: unknown };
        console.warn(
            `[Container Apps] No se pudo inventariar para ${tenantId}:`,
            message,
            JSON.stringify({
                code: err?.code,
                statusCode: err?.statusCode,
                details: err?.details,
                body: err?.body,
            })
        );
        return {
            subscriptionId,
            totalMonthlyCost: 0,
            totalPotentialSaving: 0,
            scaleToZeroCandidates: 0,
            appCount: 0,
            apps: [],
            costBreakdownAvailable: false,
        };
    }

    // --- Costo por recurso (MonthToDate) vía Cost Management ---
    const costByResourceId: Record<string, number> = {};
    let costBreakdownAvailable = false;
    if (subscriptionId) {
        try {
            const credential = await getAzureCredential(tenantId);
            const costClient = new CostManagementClient(credential);
            const scope = `/subscriptions/${subscriptionId}`;
            const costRes = await costClient.query.usage(scope, {
                type: "ActualCost",
                timeframe: "MonthToDate",
                dataset: {
                    granularity: "None",
                    aggregation: { totalCost: { name: "Cost", function: "Sum" } },
                    grouping: [{ type: "Dimension", name: "ResourceId" }],
                    filter: {
                        dimensions: {
                            name: "ResourceType",
                            operator: "In",
                            values: ["microsoft.app/containerapps"],
                        },
                    },
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
            console.warn(`[Container Apps] Sin costo (Cost Management) para ${tenantId}:`, message);
        }
    }

    const apps: ContainerAppCostRow[] = rawApps.map((a) => {
        const minReplicas = Number(a.minReplicas) || 0;
        const maxReplicas = Number(a.maxReplicas) || 0;
        const monthlyCost = costByResourceId[String(a.resourceId)] || 0;
        // Ahorro por scale-to-zero: fracción del costo atribuible a las réplicas
        // siempre encendidas. Estimación conservadora = (minReplicas / max(maxReplicas,1))
        // aplicada al costo actual, solo cuando minReplicas >= 1.
        const scaleToZeroCandidate = minReplicas >= 1;
        const idleFraction = scaleToZeroCandidate
            ? minReplicas / Math.max(maxReplicas, minReplicas, 1)
            : 0;
        const potentialSaving = centsToDecimal(Math.round(decimalToCents(monthlyCost) * idleFraction));
        return {
            name: a.name,
            resourceGroup: a.resourceGroup,
            environment: (a.environmentId ? String(a.environmentId).split("/").pop() : "") || "",
            cpuCores: Number(a.cpu) || 0,
            memoryGb: parseMemoryToGb(a.memory),
            minReplicas,
            maxReplicas,
            monthlyCost,
            scaleToZeroCandidate,
            potentialSaving,
        };
    });

    return {
        subscriptionId,
        totalMonthlyCost: sumMoney(apps.map((a) => a.monthlyCost)),
        totalPotentialSaving: sumMoney(apps.map((a) => a.potentialSaving)),
        scaleToZeroCandidates: apps.filter((a) => a.scaleToZeroCandidate).length,
        appCount: apps.length,
        apps: apps.sort((a, b) => b.monthlyCost - a.monthlyCost),
        costBreakdownAvailable,
    };
};
