/**
 * Container Apps Cost Service — control de costos del dominio "Containers" de
 * Azure:
 *   - Container Apps          (Microsoft.App/containerApps)
 *   - Container Registries    (Microsoft.ContainerRegistry/registries)
 *   - Container Environments  (Microsoft.App/managedEnvironments)
 *
 * RBAC mínimo requerido (Service Principal del tenant):
 *   - Reader (Resource Graph) para inventariar los tres tipos de recurso y leer
 *     la configuración de escalado de los apps (min/maxReplicas, CPU/memoria).
 *     Container Registry NO necesita ningún rol adicional: el inventario y el
 *     SKU salen del plano de control (ARM/Resource Graph), no del data plane
 *     del registry — no se requieren AcrPull/AcrPush/ACR Repository Reader ni
 *     ningún permiso de repositorio.
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
 * Degradación aislada: cada inventario (apps / registries / environments) tiene
 * su propio try/catch. Si falla el de registries o el de environments se loguea
 * y esa sección vuelve vacía con totales en 0, pero la respuesta de apps se
 * sirve igual. Ninguna sección devuelve `undefined`.
 *
 * Regla Cero (precisión): todos los montos se agregan en centavos enteros
 * (helpers de src/lib/money.ts) para evitar drift de floats.
 */
import { getResourceGraphClient } from "@/lib/azure";
import { isMockTenant, MOCK_CONTAINER_DOMAIN } from "@/lib/mockData";
import { decimalToCents, centsToDecimal } from "@/lib/money";
import pool from "@/modules/storage/db";
import { getResourceCostsById } from "./resourceInventoryService";

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

export interface ContainerRegistryCostRow {
    name: string;
    resourceGroup: string;
    sku: string;
    monthlyCost: number;
    location: string;
}

export interface ContainerEnvironmentCostRow {
    name: string;
    resourceGroup: string;
    appCount: number;
    monthlyCost: number;
    location: string;
}

export interface ContainerAppsCostResult {
    subscriptionId: string;
    totalMonthlyCost: number;
    totalPotentialSaving: number;
    scaleToZeroCandidates: number;
    appCount: number;
    apps: ContainerAppCostRow[];
    costBreakdownAvailable: boolean;
    registries: ContainerRegistryCostRow[];
    registryCount: number;
    totalRegistryMonthlyCost: number;
    environments: ContainerEnvironmentCostRow[];
    environmentCount: number;
    totalEnvironmentMonthlyCost: number;
    /** apps + registries + environments. */
    totalContainersMonthlyCost: number;
}

const APPS_TYPE = "microsoft.app/containerapps";
const REGISTRIES_TYPE = "microsoft.containerregistry/registries";
const ENVIRONMENTS_TYPE = "microsoft.app/managedenvironments";

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

function estimateContainerAppMonthlyCost(cpuCores: number, memoryGb: number, minReplicas: number): number {
    const replicas = Math.max(1, minReplicas);
    const perReplica = cpuCores * 18 + memoryGb * 8;
    return centsToDecimal(Math.max(0, decimalToCents(perReplica * replicas)));
}

function estimateRegistryMonthlyCost(sku: string): number {
    const normalized = String(sku || "").toLowerCase();
    if (normalized.includes("premium")) return 95;
    if (normalized.includes("standard")) return 20;
    return 5;
}

function estimateEnvironmentMonthlyCost(appCount: number): number {
    return 12 + Math.max(0, appCount) * 2;
}

async function queryResourceGraph(tenantId: string, query: string): Promise<any[]> {
    const argClient = await getResourceGraphClient(tenantId);
    const res: any = await argClient.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
    return (res.data as any[]) || [];
}

async function getMonthlyContainersCostFromSnapshots(tenantId: string, subscriptionId: string): Promise<number> {
    if (!subscriptionId) return 0;
    const sql = `
      SELECT COALESCE(SUM(cost_usd), 0) AS total
      FROM CostSnapshots
      WHERE tenant_id = ?
        AND subscription_id = ?
        AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        AND (
          LOWER(COALESCE(service_name, '')) LIKE '%container app%'
          OR LOWER(COALESCE(service_name, '')) LIKE '%container registry%'
          OR LOWER(COALESCE(service_name, '')) LIKE '%container environment%'
          OR LOWER(COALESCE(service_name, '')) LIKE '%azure container apps%'
          OR LOWER(COALESCE(service_name, '')) LIKE '%azure container registry%'
        )
    `;

    try {
        const [rows]: any = await pool.query(sql, [tenantId, subscriptionId]);
        const total = Number(rows?.[0]?.total || 0);
        return Number.isFinite(total) ? total : 0;
    } catch (error: any) {
        console.warn(`[Container Apps] Snapshot cost fallback failed for ${tenantId}:`, error?.message);
        return 0;
    }
}

/**
 * Se loguea el error COMPLETO, no sólo `message`. Resource Graph contesta con
 * un mensaje genérico ("Please provide below info when asking for support:
 * timestamp = …, correlationId = …") que no dice nada de la causa: el detalle
 * real viene en e.code y en el body de la respuesta. Con sólo el message,
 * esta tarjeta llevaba días fallando en prod sin que se pudiera diagnosticar.
 */
function logArgFailure(section: string, tenantId: string, e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const err = e as { code?: string; statusCode?: number; details?: unknown; body?: unknown };
    console.warn(
        `[Container Apps] No se pudo inventariar ${section} para ${tenantId}:`,
        message,
        JSON.stringify({
            code: err?.code,
            statusCode: err?.statusCode,
            details: err?.details,
            body: err?.body,
        })
    );
}

const MOCK_TIER_MULTIPLIER: Record<string, number> = {
    "22222222-3333-4444-5555-666666666666": 3, // pro
    "44444444-5555-6666-7777-888888888888": 10, // business
    "33333333-4444-5555-6666-777777777777": 50, // enterprise
};

function buildMockResult(tenantId: string): ContainerAppsCostResult {
    const multiplier = MOCK_TIER_MULTIPLIER[tenantId] || 1;
    // Catálogo base en src/lib/mockData.ts (MOCK_CONTAINER_DOMAIN). El costo
    // escala por tier (multiplier) para reflejar la magnitud de gasto del plan
    // del tenant, siempre en centavos enteros (Regla Cero).
    const scale = (base: number) => centsToDecimal(decimalToCents(base) * multiplier);

    const apps: ContainerAppCostRow[] = MOCK_CONTAINER_DOMAIN.apps.map((b: any) => {
        const potentialSaving = scale(b.baseSaving);
        return {
            name: b.name,
            resourceGroup: b.resourceGroup,
            environment: b.environment,
            cpuCores: b.cpuCores,
            memoryGb: b.memoryGb,
            minReplicas: b.minReplicas,
            maxReplicas: b.maxReplicas,
            monthlyCost: scale(b.baseCost),
            scaleToZeroCandidate: potentialSaving > 0,
            potentialSaving,
        };
    });

    const registries: ContainerRegistryCostRow[] = MOCK_CONTAINER_DOMAIN.registries.map((r: any) => ({
        name: r.name,
        resourceGroup: r.resourceGroup,
        sku: r.sku,
        monthlyCost: scale(r.baseCost),
        location: r.location,
    }));

    const environments: ContainerEnvironmentCostRow[] = MOCK_CONTAINER_DOMAIN.environments.map((e: any) => ({
        name: e.name,
        resourceGroup: e.resourceGroup,
        appCount: countAppsByEnvironment(apps).get(e.name.toLowerCase()) || 0,
        monthlyCost: scale(e.baseCost),
        location: e.location,
    }));

    return buildResult({
        subscriptionId: "mock-sub",
        apps,
        registries,
        environments,
        costBreakdownAvailable: true,
    });
}

/** Cuántos Container Apps corren en cada environment (clave en minúsculas). */
function countAppsByEnvironment(apps: ContainerAppCostRow[]): Map<string, number> {
    const byEnv = new Map<string, number>();
    for (const app of apps) {
        const key = (app.environment || "").toLowerCase();
        if (!key) continue;
        byEnv.set(key, (byEnv.get(key) || 0) + 1);
    }
    return byEnv;
}

/** Arma el payload final con todos los totales sumados en centavos enteros. */
function buildResult(input: {
    subscriptionId: string;
    apps: ContainerAppCostRow[];
    registries: ContainerRegistryCostRow[];
    environments: ContainerEnvironmentCostRow[];
    costBreakdownAvailable: boolean;
}): ContainerAppsCostResult {
    const { subscriptionId, apps, registries, environments, costBreakdownAvailable } = input;
    const totalMonthlyCost = sumMoney(apps.map((a) => a.monthlyCost));
    const totalRegistryMonthlyCost = sumMoney(registries.map((r) => r.monthlyCost));
    const totalEnvironmentMonthlyCost = sumMoney(environments.map((e) => e.monthlyCost));

    return {
        subscriptionId,
        totalMonthlyCost,
        totalPotentialSaving: sumMoney(apps.map((a) => a.potentialSaving)),
        scaleToZeroCandidates: apps.filter((a) => a.scaleToZeroCandidate).length,
        appCount: apps.length,
        apps: apps.sort((a, b) => b.monthlyCost - a.monthlyCost),
        costBreakdownAvailable,
        registries: registries.sort((a, b) => b.monthlyCost - a.monthlyCost),
        registryCount: registries.length,
        totalRegistryMonthlyCost,
        environments: environments.sort((a, b) => b.monthlyCost - a.monthlyCost),
        environmentCount: environments.length,
        totalEnvironmentMonthlyCost,
        totalContainersMonthlyCost: sumMoney([
            totalMonthlyCost,
            totalRegistryMonthlyCost,
            totalEnvironmentMonthlyCost,
        ]),
    };
}

export const getContainerAppsCost = async (
    tenantId: string,
    subscriptionId: string
): Promise<ContainerAppsCostResult> => {
    if (isMockTenant(tenantId)) {
        return buildMockResult(tenantId);
    }

    const subFilter = subscriptionId ? `| where subscriptionId =~ '${subscriptionId}'` : "";

    // --- Inventario de Container Apps vía Resource Graph ---
    let rawApps: any[] = [];
    try {
        rawApps = await queryResourceGraph(
            tenantId,
            `
            Resources
            | where type =~ '${APPS_TYPE}'
            ${subFilter}
            | extend scale = properties.template.scale
            | extend containers = properties.template.containers
            | project name,
                      resourceGroup,
                      resourceId = tolower(id),
                      subscriptionId = tostring(subscriptionId),
                      environmentId = tostring(properties.environmentId),
                      minReplicas = toint(scale.minReplicas),
                      maxReplicas = toint(scale.maxReplicas),
                      cpu = todouble(containers[0].resources.cpu),
                      memory = tostring(containers[0].resources.memory)
        `
        );
    } catch (e: unknown) {
        // Si Resource Graph no responde para el tipo principal, el problema es
        // de credenciales/Reader a nivel tenant: no tiene sentido seguir.
        logArgFailure("Container Apps", tenantId, e);
        return buildResult({
            subscriptionId,
            apps: [],
            registries: [],
            environments: [],
            costBreakdownAvailable: false,
        });
    }

    // --- Inventario de Container Registries (degradación aislada) ---
    let rawRegistries: any[] = [];
    try {
        rawRegistries = await queryResourceGraph(
            tenantId,
            `
            Resources
            | where type =~ '${REGISTRIES_TYPE}'
            ${subFilter}
            | extend skuName = coalesce(tostring(sku.name), tostring(properties.sku.name), '')
            | project name, resourceGroup, location, resourceId = tolower(id), subscriptionId = tostring(subscriptionId), skuName
        `
        );
    } catch (e: unknown) {
        logArgFailure("Container Registries", tenantId, e);
    }

    // --- Inventario de Container Environments (degradación aislada) ---
    let rawEnvironments: any[] = [];
    try {
        rawEnvironments = await queryResourceGraph(
            tenantId,
            `
            Resources
            | where type =~ '${ENVIRONMENTS_TYPE}'
            ${subFilter}
            | project name, resourceGroup, location, resourceId = tolower(id), subscriptionId = tostring(subscriptionId)
        `
        );
    } catch (e: unknown) {
        logArgFailure("Container Environments", tenantId, e);
    }

    // --- Costo por recurso (MonthToDate) vía helper compartido ---
    const costByResourceId: Record<string, number> = {};
    let costBreakdownAvailable = false;
    const resourceRefs = [
        ...rawApps.map((r) => ({ id: String(r.resourceId || "").toLowerCase(), subscriptionId: String(r.subscriptionId || subscriptionId) })),
        ...rawRegistries.map((r) => ({ id: String(r.resourceId || "").toLowerCase(), subscriptionId: String(r.subscriptionId || subscriptionId) })),
        ...rawEnvironments.map((r) => ({ id: String(r.resourceId || "").toLowerCase(), subscriptionId: String(r.subscriptionId || subscriptionId) })),
    ].filter((r) => r.id && r.subscriptionId);

    try {
        const byId = await getResourceCostsById(tenantId, resourceRefs);
        byId.forEach((value, key) => {
            costByResourceId[key] = value;
        });
        costBreakdownAvailable = byId.size > 0;
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[Container Apps] Sin costo (Cost Management) para ${tenantId}:`, message);
    }

    const totalFromCostMgmt = Object.values(costByResourceId).reduce((acc, value) => acc + value, 0);
    const totalResources = rawApps.length + rawRegistries.length + rawEnvironments.length;
    if (totalFromCostMgmt <= 0 && totalResources > 0 && subscriptionId) {
        const fallbackTotal = await getMonthlyContainersCostFromSnapshots(tenantId, subscriptionId);
        if (fallbackTotal > 0) {
            const evenShare = centsToDecimal(Math.round(decimalToCents(fallbackTotal) / totalResources));
            for (const r of rawApps) costByResourceId[String(r.resourceId || "").toLowerCase()] = evenShare;
            for (const r of rawRegistries) costByResourceId[String(r.resourceId || "").toLowerCase()] = evenShare;
            for (const r of rawEnvironments) costByResourceId[String(r.resourceId || "").toLowerCase()] = evenShare;
            costBreakdownAvailable = true;
        }
    }

    const apps: ContainerAppCostRow[] = rawApps.map((a) => {
        const minReplicas = Number(a.minReplicas) || 0;
        const maxReplicas = Number(a.maxReplicas) || 0;
        const monthlyCost = costByResourceId[String(a.resourceId || "").toLowerCase()] || 0;
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

    const registries: ContainerRegistryCostRow[] = rawRegistries.map((r) => ({
        name: String(r.name || ""),
        resourceGroup: String(r.resourceGroup || ""),
        sku: String(r.skuName || ""),
        monthlyCost: costByResourceId[String(r.resourceId || "").toLowerCase()] || 0,
        location: String(r.location || ""),
    }));

    const appsByEnvironment = countAppsByEnvironment(apps);
    const environments: ContainerEnvironmentCostRow[] = rawEnvironments.map((e) => ({
        name: String(e.name || ""),
        resourceGroup: String(e.resourceGroup || ""),
        appCount: appsByEnvironment.get(String(e.name || "").toLowerCase()) || 0,
        monthlyCost: costByResourceId[String(e.resourceId || "").toLowerCase()] || 0,
        location: String(e.location || ""),
    }));

    let finalApps = apps;
    let finalRegistries = registries;
    let finalEnvironments = environments;

    const totalDetectedCost = sumMoney([
        ...apps.map((a) => a.monthlyCost),
        ...registries.map((r) => r.monthlyCost),
        ...environments.map((e) => e.monthlyCost),
    ]);

    // ponytail: fallback de estimación para no dejar KPIs en 0 cuando Azure no atribuye costo por ResourceId.
    if (totalDetectedCost <= 0 && (apps.length > 0 || registries.length > 0 || environments.length > 0)) {
        finalApps = apps.map((a) => {
            const estimatedCost = estimateContainerAppMonthlyCost(a.cpuCores, a.memoryGb, a.minReplicas);
            const idleFraction = a.scaleToZeroCandidate
                ? a.minReplicas / Math.max(a.maxReplicas, a.minReplicas, 1)
                : 0;
            const estimatedSaving = centsToDecimal(Math.round(decimalToCents(estimatedCost) * idleFraction));
            return {
                ...a,
                monthlyCost: estimatedCost,
                potentialSaving: estimatedSaving,
            };
        });

        finalRegistries = registries.map((r) => ({
            ...r,
            monthlyCost: estimateRegistryMonthlyCost(r.sku),
        }));

        finalEnvironments = environments.map((e) => ({
            ...e,
            monthlyCost: estimateEnvironmentMonthlyCost(e.appCount),
        }));
    }

    return buildResult({
        subscriptionId,
        apps: finalApps,
        registries: finalRegistries,
        environments: finalEnvironments,
        costBreakdownAvailable,
    });
};
