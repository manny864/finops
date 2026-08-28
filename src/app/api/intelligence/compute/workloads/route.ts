import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { getAzureCredential, getSubscriptionsForTenant, getResourceGraphClient } from "@/lib/azure";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { redis } from "@/lib/redis";
import Decimal from "decimal.js";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { getAzureResourceMetricsSummary } from "@/lib/computeMetricsShared";
import {
    calculateAroCostBreakdown,
    evaluateAroRemediations,
    getOpenShiftLifecycleStatus,
    getManagedRgResourceList,
} from "@/modules/collectors/azure/aroClusterService";
import {
    distributeCostPerResource,
    getMonthlyCostByType,
    getMtdCostByResourceId,
    listResourcesByTypes,
    type ArgResourceRow,
} from "@/app/api/intelligence/databases/diagnosticsShared";
import type {
    ComputeFamily,
    ComputeWorkloadApiResponse,
    ComputeWorkloadItemBase,
} from "@/lib/computeWorkloadTypes";
import { extractResourceCreatedAt, forecastMonthEnd, monthlyRunRate, prorateMonthlyRateToMtd } from "@/lib/costAccrual";

/** Tarifa de referencia estimada (USD/vCore-hora) del ARO service fee de Red Hat. No es tarifa oficial garantizada; usar solo para priorizar, no para facturar. */
const ARO_REDHAT_FEE_PER_VCORE_HOUR = 0.076;
const HOURS_PER_MONTH = 730;
/** Estimación de costo de disco Premium SSD administrado (USD/GB-mes), usada solo para valorizar PVCs huérfanos detectados. */
const PREMIUM_DISK_USD_PER_GB_MONTH = 0.135;

const FAMILY_TYPES: Record<ComputeFamily, string[]> = {
    webapps: ["microsoft.web/serverfarms", "microsoft.web/sites"],
    functions: ["microsoft.web/sites"],
    vms: ["microsoft.compute/virtualmachines"],
    vmss: ["microsoft.compute/virtualmachinescalesets"],
    aro: ["microsoft.redhatopenshift/openshiftclusters"],
};

// Tipos canónicos para Cost Management (dimensión ResourceType).
const FAMILY_COST_TYPES: Record<ComputeFamily, string[]> = {
    webapps: ["Microsoft.Web/serverfarms", "Microsoft.Web/sites"],
    functions: ["Microsoft.Web/sites"],
    vms: ["Microsoft.Compute/virtualMachines"],
    vmss: ["Microsoft.Compute/virtualMachineScaleSets"],
    aro: ["Microsoft.RedHatOpenShift/openShiftClusters"],
};

const FAMILY_COST_FALLBACK_TYPES: Partial<Record<ComputeFamily, string[]>> = {
    vmss: [
        "Microsoft.Compute/virtualMachineScaleSets",
        "microsoft.compute/virtualmachinescalesets",
    ],
    aro: [
        "Microsoft.RedHatOpenShift/openShiftClusters",
        "Microsoft.RedHatOpenShift/OpenShiftClusters",
        "microsoft.redhatopenshift/openshiftclusters",
    ],
};

const FAMILY_EMPTY_MESSAGE: Record<ComputeFamily, string> = {
    webapps: "No se encontraron App Service Plans o Web Apps en el tenant.",
    functions: "No se encontraron Function Apps en el tenant.",
    vms: "No se encontraron máquinas virtuales en el tenant.",
    vmss: "No se encontraron Virtual Machine Scale Sets en el tenant.",
    aro: "No se encontraron clústeres Azure Red Hat OpenShift en el tenant.",
};

const FAMILY_METRICS: Record<ComputeFamily, string[]> = {
    webapps: ["CpuPercentage", "MemoryPercentage", "Requests", "Http5xx"],
    functions: ["FunctionExecutionCount", "FunctionExecutionUnits", "CpuTime", "MemoryWorkingSet"],
    vms: ["Percentage CPU", "Available Memory Bytes", "Network In Total", "Network Out Total"],
    vmss: ["Percentage CPU", "Inbound Flows", "Outbound Flows", "Disk Read Operations/Sec", "Disk Write Operations/Sec"],
    aro: ["node_cpu_utilization_percentage", "node_memory_utilization_percentage"],
};

const WORKLOADS_CACHE_TTL_SECONDS = 900;

async function readWorkloadsCache(key: string): Promise<ComputeWorkloadApiResponse | null> {
    try {
        const cached = await redis.get(key);
        if (!cached) return null;
        return JSON.parse(cached) as ComputeWorkloadApiResponse;
    } catch {
        return null;
    }
}

async function writeWorkloadsCache(key: string, payload: ComputeWorkloadApiResponse): Promise<void> {
    try {
        await redis.set(key, JSON.stringify(payload), "EX", WORKLOADS_CACHE_TTL_SECONDS);
    } catch {
        // Best-effort cache.
    }
}

function round2(val: number): number {
    return Math.round(val * 100) / 100;
}

export function estimateAppServiceMonthlyCost(
    skuName: string,
    tier: string,
    numberOfWorkers: number = 1,
    isLinux: boolean = false,
): number {
    const s = String(skuName || "").toUpperCase();
    const t = String(tier || "").toUpperCase();
    const workers = Math.max(1, numberOfWorkers || 1);

    if (t === "FREE" || s === "F1") return 0;
    if (t === "SHARED" || s === "D1") return round2(9.49 * workers);

    // Elastic Premium y Flex Consumption ANTES de los tiers clásicos: son planes
    // de Functions y sus nombres colisionan por substring con los Premium v2
    // ("EP1".includes("P1")), así que caían en $73 en vez de $153.30. Un plan
    // EP1 mostraba menos de la mitad de su costo real.
    if (s.includes("EP3")) return round2(613.20 * workers);
    if (s.includes("EP2")) return round2(306.60 * workers);
    if (s.includes("EP1") || t.includes("ELASTIC")) return round2(153.30 * workers);
    if (s.startsWith("FC") || t.includes("FLEXCONSUMPTION")) return round2(28.50 * workers);

    // Basic Tier
    if (s.includes("B3")) return round2((isLinux ? 52.56 : 219.00) * workers);
    if (s.includes("B2")) return round2((isLinux ? 26.28 : 109.50) * workers);
    if (s.includes("B1") || t.includes("BASIC")) return round2((isLinux ? 13.14 : 54.75) * workers);

    // Premium v3
    if (s.includes("P3V3") || s.includes("P3_V3")) return round2((isLinux ? 248.20 : 365.00) * workers);
    if (s.includes("P2V3") || s.includes("P2_V3")) return round2((isLinux ? 124.10 : 182.50) * workers);
    if (s.includes("P1V3") || s.includes("P1_V3")) return round2((isLinux ? 62.05 : 91.25) * workers);
    if (s.includes("P0V3") || s.includes("P0_V3")) return round2((isLinux ? 36.50 : 54.75) * workers);

    // Premium v2
    if (s.includes("P3V2") || s.includes("P3")) return round2((isLinux ? 292.00 : 429.24) * workers);
    if (s.includes("P2V2") || s.includes("P2")) return round2((isLinux ? 146.00 : 214.62) * workers);
    if (s.includes("P1V2") || s.includes("P1")) return round2((isLinux ? 73.00 : 107.31) * workers);

    // Standard Tier
    if (s.includes("S3")) return round2((isLinux ? 175.20 : 292.00) * workers);
    if (s.includes("S2")) return round2((isLinux ? 87.60 : 146.00) * workers);
    if (s.includes("S1") || t.includes("STANDARD")) return round2((isLinux ? 43.80 : 73.00) * workers);

    // Isolated v2
    if (s.includes("I3V2") || s.includes("I3")) return round2(1168.00 * workers);
    if (s.includes("I2V2") || s.includes("I2")) return round2(584.00 * workers);
    if (s.includes("I1V2") || s.includes("I1") || t.includes("ISOLATED")) return round2(292.00 * workers);

    return round2((isLinux ? 43.80 : 73.00) * workers);
}

export function estimateFunctionAppMonthlyCost(
    planType: "consumption" | "elastic_premium" | "dedicated" | "flex_consumption",
    skuName: string,
    executionCount: number = 0,
    executionUnits: number = 0,
): number {
    const s = String(skuName || "").toUpperCase();

    if (planType === "elastic_premium") {
        if (s.includes("EP3")) return 613.20;
        if (s.includes("EP2")) return 306.60;
        return 153.30; // EP1 baseline
    }

    if (planType === "flex_consumption") {
        return 28.50;
    }

    if (planType === "dedicated") {
        return estimateAppServiceMonthlyCost(skuName, "Standard", 1, true);
    }

    // Consumption (Y1)
    const billableExecutions = Math.max(0, executionCount - 1_000_000);
    const billableGbs = Math.max(0, executionUnits - 400_000);
    const executionCost = (billableExecutions / 1_000_000) * 0.20;
    const computeCost = billableGbs * 0.000016;
    return round2(2.50 + executionCost + computeCost);
}

function toLowerSafe(value: unknown): string {
    return String(value || "").toLowerCase();
}

function sumCostMap(costByType: Map<string, { toNumber: () => number }>): number {
    return [...costByType.values()].reduce((sum, value) => sum + value.toNumber(), 0);
}

function normalizeState(raw: string): string {
    const v = raw.trim().toLowerCase();
    if (!v) return "unknown";
    if (v.includes("powerstate/")) return v.split("powerstate/")[1] || "unknown";
    if (v.startsWith("vm ")) return v.replace(/^vm\s+/, "");
    return v;
}

function firstString(values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value;
    }
    return null;
}

function resolveState(resource: ArgResourceRow, family: ComputeFamily): string {
    const properties = (resource.properties || {}) as Record<string, any>;
    const instanceViewStatuses = Array.isArray(properties?.instanceView?.statuses)
        ? properties.instanceView.statuses
        : [];
    const stateFromStatuses = firstString(
        instanceViewStatuses.flatMap((status: any) => [status?.code, status?.displayStatus]),
    );

    const candidate = firstString([
        resource.powerState,
        properties?.extended?.instanceView?.powerState?.code,
        stateFromStatuses,
        resource.provisioningState,
        properties?.provisioningState,
        properties?.state,
        properties?.availabilityState,
    ]);

    if (!candidate) return "unknown";

    if (family === "webapps" || family === "functions") {
        const normalized = normalizeState(candidate);
        if (normalized === "ready" || normalized === "running") return "running";
        if (normalized === "stopped") return "stopped";
        return normalized;
    }

    return normalizeState(candidate);
}

function resolveSku(resource: ArgResourceRow, family: ComputeFamily): string {
    const properties = (resource.properties || {}) as Record<string, any>;

    if (family === "aro") {
        const masterSize = properties?.masterProfile?.vmSize || "Standard_D8s_v5";
        const workerProfiles: any[] = Array.isArray(properties?.workerProfiles) ? properties.workerProfiles : [];
        const workerSize = workerProfiles[0]?.vmSize || "Standard_D4s_v5";
        if (masterSize && workerSize) return `Master: ${masterSize} / Worker: ${workerSize}`;
        if (masterSize) return `Master: ${masterSize}`;
        return "Master: Standard_D8s_v5 / Worker: Standard_D4s_v5";
    }

    if (resource.skuName && resource.skuName.trim() && resource.skuName.trim() !== "Unknown") return resource.skuName;

    if (family === "functions") {
        const skuObj = (resource as any).sku || properties?.sku || {};
        const skuName = String(skuObj?.name || properties?.sku || "").toUpperCase();
        const skuTier = String(skuObj?.tier || "").toUpperCase();
        const kind = String((resource as any).kind || "").toLowerCase();

        if (skuName === "Y1" || skuTier === "DYNAMIC" || kind.includes("functionapp,linux") || kind === "functionapp") {
            return "Consumption (Y1)";
        }
        if (skuTier === "ELASTICPREMIUM" || skuName.startsWith("EP")) {
            return `Elastic Premium (${skuName || "EP1"})`;
        }
        if (skuName.startsWith("FC") || kind.includes("flexconsumption")) {
            return "Flex Consumption";
        }
        if (skuName) {
            return `Dedicated (${skuName})`;
        }
        return "Consumption (Y1)";
    }

    if (family === "vms") {
        const vmSize = properties?.hardwareProfile?.vmSize;
        if (typeof vmSize === "string" && vmSize.trim()) return vmSize;
    }

    if (family === "vmss") {
        const vmssSize = properties?.sku?.name || properties?.virtualMachineProfile?.hardwareProfile?.vmSize;
        if (typeof vmssSize === "string" && vmssSize.trim()) return vmssSize;
    }

    return "Unknown";
}

/** Extrae el nombre del Managed Resource Group ("aro-*") desde el ARM resourceId de `clusterProfile.resourceGroupId`. */
function extractResourceGroupName(resourceGroupId: string | undefined | null): string | null {
    if (!resourceGroupId || typeof resourceGroupId !== "string") return null;
    const m = resourceGroupId.match(/resourceGroups\/([^/]+)/i);
    return m?.[1] || null;
}

/**
 * Busca Managed Disks en el Managed Resource Group del clúster que no están
 * adjuntos a ninguna instancia (`managedBy` vacío) — candidatos a PVC
 * huérfano. Best-effort: si Resource Graph falla o el MRG no es legible,
 * devuelve conteo/costo cero sin cortar el resto de la respuesta.
 */
async function fetchOrphanPvcDisks(
    tenantId: string,
    subscriptionId: string | undefined,
    resourceGroupName: string | null,
): Promise<{ count: number; monthlyCostUsd: number }> {
    if (!resourceGroupName || !subscriptionId) return { count: 0, monthlyCostUsd: 0 };
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.compute/disks'
            | where resourceGroup =~ '${resourceGroupName}'
            | where isnull(managedBy) or managedBy == ''
            | project name, diskSizeGB = toint(properties.diskSizeGB), skuName = tostring(sku.name)
        `;
        const response: any = await argClient.resources({
            subscriptions: [subscriptionId],
            query,
            options: { resultFormat: "objectArray", top: 200 },
        });
        const rows: any[] = Array.isArray(response?.data) ? response.data : [];
        const monthlyCostUsd = rows.reduce((sum, r) => sum + (Number(r.diskSizeGB) || 0) * PREMIUM_DISK_USD_PER_GB_MONTH, 0);
        return { count: rows.length, monthlyCostUsd: Number(monthlyCostUsd.toFixed(2)) };
    } catch {
        return { count: 0, monthlyCostUsd: 0 };
    }
}

/**
 * Consulta métricas de CPU y Memoria de las VMs del Managed Resource Group mediante Azure Monitor
 * cuando la API directa de OpenShift no reporta métricas.
 */
async function fetchAroManagedRgVmMetrics(
    tenantId: string,
    subscriptionId: string | undefined,
    managedResourceGroupName: string | null,
    credential: any,
): Promise<{ cpuAvg: number | null; memoryAvgPercent: number | null }> {
    if (!managedResourceGroupName || !subscriptionId) return { cpuAvg: null, memoryAvgPercent: null };
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.compute/virtualmachines'
            | where resourceGroup =~ '${managedResourceGroupName}'
            | where name contains 'worker'
            | project id, name
            | limit 3
        `;
        const response: any = await argClient.resources({
            subscriptions: [subscriptionId],
            query,
            options: { resultFormat: "objectArray", top: 3 },
        });
        const rows: any[] = Array.isArray(response?.data) ? response.data : [];
        if (rows.length === 0) return { cpuAvg: null, memoryAvgPercent: null };

        let totalCpu = 0;
        let cpuCount = 0;
        let totalMem = 0;
        let memCount = 0;

        for (const row of rows) {
            const metrics = await getAzureResourceMetricsSummary(credential, row.id, [
                "Percentage CPU",
                "Available Memory Bytes",
            ]);
            if (typeof metrics["Percentage CPU"] === "number") {
                totalCpu += metrics["Percentage CPU"];
                cpuCount++;
            }
            if (typeof metrics["Available Memory Bytes"] === "number") {
                const availGb = metrics["Available Memory Bytes"] / (1024 * 1024 * 1024);
                const memUsedPct = Math.max(0, Math.min(100, Math.round(((16 - availGb) / 16) * 100)));
                totalMem += memUsedPct;
                memCount++;
            }
        }

        return {
            cpuAvg: cpuCount > 0 ? Number((totalCpu / cpuCount).toFixed(1)) : null,
            memoryAvgPercent: memCount > 0 ? Number((totalMem / memCount).toFixed(1)) : null,
        };
    } catch {
        return { cpuAvg: null, memoryAvgPercent: null };
    }
}

function resolveFunctionHostingPlan(resource: ArgResourceRow): {
    hostingPlan: string;
    hostingPlanType: "consumption" | "elastic_premium" | "dedicated" | "flex_consumption";
} {
    const properties = (resource.properties || {}) as Record<string, any>;
    const skuObj = (resource as any).sku || properties?.sku || {};
    const skuName = String(skuObj?.name || properties?.sku || "").toUpperCase();
    const skuTier = String(skuObj?.tier || "").toUpperCase();
    const kind = String((resource as any).kind || "").toLowerCase();

    if (skuTier === "ELASTICPREMIUM" || skuName.startsWith("EP")) {
        return {
            hostingPlan: `Elastic Premium (${skuName || "EP1"})`,
            hostingPlanType: "elastic_premium",
        };
    }
    if (skuName.startsWith("FC") || kind.includes("flexconsumption")) {
        return {
            hostingPlan: "Flex Consumption",
            hostingPlanType: "flex_consumption",
        };
    }
    if (skuName && skuName !== "Y1" && skuTier !== "DYNAMIC") {
        return {
            hostingPlan: `Dedicated (${skuName})`,
            hostingPlanType: "dedicated",
        };
    }
    return {
        hostingPlan: "Consumption (Y1)",
        hostingPlanType: "consumption",
    };
}

function resolveFunctionRuntime(resource: ArgResourceRow): {
    runtimeStack: string;
    os: "Linux" | "Windows";
} {
    const properties = (resource.properties || {}) as Record<string, any>;
    const siteConfig = properties?.siteConfig || {};
    const linuxFx = String(siteConfig?.linuxFxVersion || "").toLowerCase();
    const netVersion = String(siteConfig?.netFrameworkVersion || "").toLowerCase();
    const isLinux = Boolean(properties?.reserved || linuxFx.length > 0 || String((resource as any).kind || "").includes("linux"));

    if (linuxFx.includes("node")) return { runtimeStack: "Node.js 20", os: isLinux ? "Linux" : "Windows" };
    if (linuxFx.includes("dotnet") || netVersion.includes("v8") || netVersion.includes("v6")) {
        return { runtimeStack: ".NET 8", os: isLinux ? "Linux" : "Windows" };
    }
    if (linuxFx.includes("python")) return { runtimeStack: "Python 3.11", os: isLinux ? "Linux" : "Windows" };
    if (linuxFx.includes("java")) return { runtimeStack: "Java 17", os: isLinux ? "Linux" : "Windows" };

    return {
        runtimeStack: isLinux ? "Node.js (Linux)" : ".NET (Windows)",
        os: isLinux ? "Linux" : "Windows",
    };
}

function resolveVmSpecs(vmSize: string): { vCpu: number; ramGb: number } {
    const size = (vmSize || "").toLowerCase();
    const sizeMap: Record<string, { vCpu: number; ramGb: number }> = {
        standard_b1s: { vCpu: 1, ramGb: 1 },
        standard_b1ms: { vCpu: 1, ramGb: 2 },
        standard_b2s: { vCpu: 2, ramGb: 4 },
        standard_b2ms: { vCpu: 2, ramGb: 8 },
        standard_b4ms: { vCpu: 4, ramGb: 16 },
        standard_b8ms: { vCpu: 8, ramGb: 32 },
        standard_d2s_v3: { vCpu: 2, ramGb: 8 },
        standard_d4s_v3: { vCpu: 4, ramGb: 16 },
        standard_d8s_v3: { vCpu: 8, ramGb: 32 },
        standard_d2s_v5: { vCpu: 2, ramGb: 8 },
        standard_d4s_v5: { vCpu: 4, ramGb: 16 },
        standard_d8s_v5: { vCpu: 8, ramGb: 32 },
        standard_d4ds_v4: { vCpu: 4, ramGb: 16 },
        standard_d8ds_v4: { vCpu: 8, ramGb: 32 },
        standard_e2s_v5: { vCpu: 2, ramGb: 16 },
        standard_e4s_v5: { vCpu: 4, ramGb: 32 },
        standard_e8s_v5: { vCpu: 8, ramGb: 64 },
        standard_e8ds_v5: { vCpu: 8, ramGb: 64 },
        standard_f2s_v2: { vCpu: 2, ramGb: 4 },
        standard_f4s_v2: { vCpu: 4, ramGb: 8 },
        standard_f8s_v2: { vCpu: 8, ramGb: 16 },
    };
    if (sizeMap[size]) return sizeMap[size];

    const match = size.match(/standard_[a-z]+(\d+)/i) || size.match(/[a-z]+_(\d+)/i);
    const vCpu = match ? parseInt(match[1], 10) : 2;
    let ramMult = 4;
    if (size.includes("e") || size.includes("m")) ramMult = 8;
    else if (size.includes("f")) ramMult = 2;
    return { vCpu: isNaN(vCpu) ? 2 : vCpu, ramGb: isNaN(vCpu) ? 8 : vCpu * ramMult };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const family = searchParams.get("family") as ComputeFamily | null;

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!family || !(family in FAMILY_TYPES)) {
            return NextResponse.json({ error: "Parámetro family inválido" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            if (family === "aro") {
                return NextResponse.json(getMockDataForRoute('aro-clusters', tenantId));
            }
            if (family === "vmss") {
                const vmssItems = [
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-prod-web/providers/Microsoft.Compute/virtualMachineScaleSets/cscs-vmss-web-prod",
                        name: "cscs-vmss-web-prod",
                        type: "microsoft.compute/virtualmachinescalesets",
                        region: "westus2",
                        resourceGroup: "rg-prod-web",
                        subscriptionName: "Producción Principal Azure",
                        state: "running",
                        sku: "Standard_D4ads_v5",
                        monthlyCostUsd: 580.40,
                        metricA: "8.4",
                        metricB: "180",
                        capacity: 4,
                        minCapacity: 2,
                        maxCapacity: 10,
                        autoscaleMode: "metric" as const,
                        orchestrationMode: "Uniform" as const,
                        priority: "Regular" as const,
                        spotPercentage: 0,
                        licenseType: "Windows_Server",
                        ahubActive: true,
                        osDiskType: "Premium_LRS",
                        zones: ["1", "2", "3"],
                        cpuAvg: 8.4,
                        cpuMax: 14.2,
                        memoryUsagePercent: 18,
                        iops: 180,
                        networkFlows: 4200,
                        recommendedSku: "Standard_D2ads_v5",
                        potentialSavingUsd: 145.10,
                        remediationActions: [
                            {
                                id: "rec-rightsizing-1",
                                type: "rightsizing" as const,
                                title: "Rightsizing de SKU (Sobredimensionado)",
                                description: "CPU promedio < 10% (8.4%) y RAM < 20% durante 14 días. Reducir de Standard_D4ads_v5 a Standard_D2ads_v5.",
                                monthlySavingsUsd: 145.10,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: "az vmss update --resource-group rg-prod-web --name cscs-vmss-web-prod --set sku.name=Standard_D2ads_v5\naz vmss update-instances --resource-group rg-prod-web --name cscs-vmss-web-prod --instance-ids '*'",
                                commandTerraform: `# En main.tf (azurerm_orchestrated_virtual_machine_scale_set o azurerm_linux_virtual_machine_scale_set)\nsku_name = "Standard_D2ads_v5"`,
                                commandArm: `{\n  "name": "cscs-vmss-web-prod",\n  "type": "Microsoft.Compute/virtualMachineScaleSets",\n  "sku": { "name": "Standard_D2ads_v5", "tier": "Standard" }\n}`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-data-batch/providers/Microsoft.Compute/virtualMachineScaleSets/cscs-vmss-batch-worker",
                        name: "cscs-vmss-batch-worker",
                        type: "microsoft.compute/virtualmachinescalesets",
                        region: "eastus",
                        resourceGroup: "rg-data-batch",
                        subscriptionName: "Producción Principal Azure",
                        state: "running",
                        sku: "Standard_E4s_v5",
                        monthlyCostUsd: 412.00,
                        metricA: "4.1",
                        metricB: "95",
                        capacity: 3,
                        minCapacity: 3,
                        maxCapacity: 3,
                        autoscaleMode: "manual" as const,
                        orchestrationMode: "Flexible" as const,
                        priority: "Regular" as const,
                        spotPercentage: 0,
                        licenseType: "None",
                        ahubActive: false,
                        osDiskType: "Premium_LRS",
                        zones: ["1"],
                        cpuAvg: 4.1,
                        cpuMax: 9.8,
                        memoryUsagePercent: 12,
                        iops: 95,
                        networkFlows: 1100,
                        recommendedSku: "Standard_E2s_v5",
                        potentialSavingUsd: 180.00,
                        remediationActions: [
                            {
                                id: "rec-autoscale-2",
                                type: "autoscale" as const,
                                title: "Activar Autoscale por Calendario (Scale-to-Min)",
                                description: "Capacidad fija (3 VMs) sin tráfico fines de semana ni noches. Configurar regla de escalado a 1 VM fuera de horario laboral.",
                                monthlySavingsUsd: 180.00,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `az monitor autoscale create --resource-group rg-data-batch --resource cscs-vmss-batch-worker --resource-type Microsoft.Compute/virtualMachineScaleSets --name autoscale-batch --min-count 1 --max-count 5 --count 1`,
                                commandTerraform: `resource "azurerm_monitor_autoscale_setting" "batch" {\n  name                = "autoscale-batch"\n  resource_group_name = "rg-data-batch"\n  location            = "eastus"\n  target_resource_id  = azurerm_linux_virtual_machine_scale_set.batch.id\n  profile {\n    name = "NightAndWeekendScaleDown"\n    capacity { default = 1, minimum = 1, maximum = 5 }\n    recurrence { timezone = "UTC", days = ["Saturday", "Sunday"], hours = [0], minutes = [0] }\n  }\n}`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-2/resourceGroups/rg-dev-qa/providers/Microsoft.Compute/virtualMachineScaleSets/cscs-vmss-dev-runner",
                        name: "cscs-vmss-dev-runner",
                        type: "microsoft.compute/virtualmachinescalesets",
                        region: "eastus2",
                        resourceGroup: "rg-dev-qa",
                        subscriptionName: "Suscripción Desarrollo & QA",
                        state: "running",
                        sku: "Standard_D4s_v5",
                        monthlyCostUsd: 280.00,
                        metricA: "12.0",
                        metricB: "120",
                        capacity: 2,
                        minCapacity: 1,
                        maxCapacity: 4,
                        autoscaleMode: "schedule" as const,
                        orchestrationMode: "Flexible" as const,
                        priority: "Regular" as const,
                        spotPercentage: 0,
                        licenseType: "None",
                        ahubActive: false,
                        osDiskType: "StandardSSD_LRS",
                        zones: [],
                        cpuAvg: 12.0,
                        cpuMax: 28.5,
                        memoryUsagePercent: 24,
                        iops: 120,
                        networkFlows: 2300,
                        potentialSavingUsd: 196.00,
                        remediationActions: [
                            {
                                id: "rec-spot-3",
                                type: "spot" as const,
                                title: "Conversión a Instancias Spot (Dev/QA)",
                                description: "Entorno no productivo (rg-dev-qa) sin criticidad SLA. Habilitar prioridad Spot con política de desalojo Deallocate para ahorrar hasta 70%.",
                                monthlySavingsUsd: 196.00,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `# Opción A: Actualizar prioridad Spot y billingProfile en bloque JSON\naz vmss update --resource-group rg-dev-qa --name cscs-vmss-dev-runner --set virtualMachineProfile.priority=Spot virtualMachineProfile.evictionPolicy=Deallocate virtualMachineProfile.billingProfile='{"maxPrice":-1}'\n\n# Nota: Si el VMSS es Uniform o no permite mutar prioridad en caliente, desplegar un pool Spot:\n# az vmss create --resource-group rg-dev-qa --name cscs-vmss-dev-runner-spot --priority Spot --eviction-policy Deallocate --max-price -1 ...`,
                                commandTerraform: `# En azurerm_orchestrated_virtual_machine_scale_set\npriority = "Spot"\neviction_policy = "Deallocate"`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-prod-legacy/providers/Microsoft.Compute/virtualMachineScaleSets/cscs-vmss-legacy-api",
                        name: "cscs-vmss-legacy-api",
                        type: "microsoft.compute/virtualmachinescalesets",
                        region: "westeurope",
                        resourceGroup: "rg-prod-legacy",
                        subscriptionName: "Producción Principal Azure",
                        state: "running",
                        sku: "Standard_D4s_v5",
                        monthlyCostUsd: 384.00,
                        metricA: "22.5",
                        metricB: "320",
                        capacity: 2,
                        minCapacity: 2,
                        maxCapacity: 6,
                        autoscaleMode: "metric" as const,
                        orchestrationMode: "Uniform" as const,
                        priority: "Regular" as const,
                        spotPercentage: 0,
                        licenseType: "None",
                        ahubActive: false,
                        osDiskType: "Standard_LRS",
                        zones: ["2"],
                        cpuAvg: 22.5,
                        cpuMax: 45.0,
                        memoryUsagePercent: 40,
                        iops: 320,
                        networkFlows: 6800,
                        potentialSavingUsd: 153.60,
                        remediationActions: [
                            {
                                id: "rec-ahub-4",
                                type: "ahub" as const,
                                title: "Activar Azure Hybrid Benefit (AHUB)",
                                description: "VMSS Windows pagando tarifa completa de SO. Aplicar licencias locales de Windows Server con Software Assurance para reducir el costo.",
                                monthlySavingsUsd: 153.60,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: "az vmss update --resource-group rg-prod-legacy --name cscs-vmss-legacy-api --set virtualMachineProfile.licenseType=Windows_Server",
                                commandTerraform: `license_type = "Windows_Server"`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-2/resourceGroups/rg-staging/providers/Microsoft.Compute/virtualMachineScaleSets/cscs-vmss-test-runner",
                        name: "cscs-vmss-test-runner",
                        type: "microsoft.compute/virtualmachinescalesets",
                        region: "centralus",
                        resourceGroup: "rg-staging",
                        subscriptionName: "Suscripción Desarrollo & QA",
                        state: "running",
                        sku: "Standard_B2ms",
                        monthlyCostUsd: 148.00,
                        metricA: "6.2",
                        metricB: "80",
                        capacity: 2,
                        minCapacity: 1,
                        maxCapacity: 5,
                        autoscaleMode: "manual" as const,
                        orchestrationMode: "Flexible" as const,
                        priority: "Regular" as const,
                        spotPercentage: 0,
                        licenseType: "None",
                        ahubActive: false,
                        osDiskType: "Premium_LRS",
                        zones: [],
                        cpuAvg: 6.2,
                        cpuMax: 15.0,
                        memoryUsagePercent: 15,
                        iops: 80,
                        networkFlows: 900,
                        potentialSavingUsd: 44.40,
                        remediationActions: [
                            {
                                id: "rec-osdisk-5",
                                type: "os_disk" as const,
                                title: "Optimización de Disco OS (Tier Down)",
                                description: "Discos Premium SSD en instancias con IOPS sostenido < 250 (80 ops/s). Degradar storage tier a Standard SSD.",
                                monthlySavingsUsd: 44.40,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `# 1. Desasignar instancias del VMSS para desbloquear storage engine\naz vmss deallocate --resource-group rg-staging --name cscs-vmss-test-runner\n\n# 2. Actualizar el SKU del disco de cada instancia\nfor disk in $(az disk list --resource-group rg-staging --query "[?contains(managedBy, 'cscs-vmss-test-runner')].name" -o tsv); do\n  az disk update --resource-group rg-staging --name $disk --sku StandardSSD_LRS\ndone\n\n# 3. Iniciar el Scale Set nuevamente\naz vmss start --resource-group rg-staging --name cscs-vmss-test-runner`,
                                commandTerraform: `os_disk {\n  storage_account_type = "StandardSSD_LRS"\n}`,
                            },
                        ],
                    },
                ];

                return NextResponse.json({
                    ok: true,
                    mock: true,
                    resourceExists: true,
                    dataAvailable: true,
                    data: {
                        summary: {
                            resourceCount: vmssItems.length,
                            totalMonthlyCostUsd: Number(vmssItems.reduce((acc, item) => acc + item.monthlyCostUsd, 0).toFixed(2)),
                            advisorRecommendations: vmssItems.reduce((acc, item) => acc + (item.remediationActions?.length || 0), 0),
                        },
                        items: vmssItems,
                    },
                });
            }

            if (family === "webapps") {
                const webAppItems = [
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-peopletrack/providers/Microsoft.Web/serverfarms/ASP-rgpeopletrack-be02",
                        name: "ASP-rgpeopletrack-be02",
                        type: "microsoft.web/serverfarms",
                        region: "eastus2",
                        resourceGroup: "rg-peopletrack",
                        subscriptionName: "Testing CL",
                        state: "running",
                        sku: "Standard_S1",
                        tier: "Standard",
                        monthlyCostUsd: 79.51,
                        metricA: "6.4",
                        metricB: "32.0",
                        os: "Linux" as const,
                        numberOfWorkers: 1,
                        autoscaleMode: "manual" as const,
                        zoneRedundant: false,
                        appsCount: 1,
                        slotsCount: 0,
                        hostedApps: [
                            {
                                name: "peopletrack-be-api",
                                state: "Running",
                                slotsCount: 0,
                                alwaysOn: true,
                                httpRequests: 14200,
                                http5xx: 2,
                                http4xx: 18,
                            },
                        ],
                        cpuAvg: 6.4,
                        cpuMax: 18.2,
                        memoryPercentAvg: 32.0,
                        memoryPercentMax: 48.5,
                        totalRequests: 14200,
                        http5xxRate: 0.01,
                        http4xxRate: 0.13,
                        isZombie: false,
                        potentialSavingUsd: 35.00,
                        remediationActions: [
                            {
                                id: "rec-app-packing-1",
                                type: "app_packing" as const,
                                title: "Consolidación de Aplicaciones (App Packing)",
                                description: "Plan con 1 sola app y CPU < 10% (6.4%). Consolidar con ASP-core-shared en la misma región para dar de baja el plan sobrante.",
                                monthlySavingsUsd: 79.51,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: "az webapp update --resource-group rg-peopletrack --name peopletrack-be-api --plan ASP-core-shared-eastus2\naz appservice plan delete --resource-group rg-peopletrack --name ASP-rgpeopletrack-be02 --yes",
                                commandTerraform: `# En azurerm_linux_web_app\nservice_plan_id = azurerm_service_plan.shared.id`,
                            },
                            {
                                id: "rec-modernize-1",
                                type: "modernize_sku" as const,
                                title: "Modernización a Premium v3 / Downgrade a Basic",
                                description: "Plan en SKU Standard S1 ($79.51/m). Migrar a Premium v3 P0v3 ($54.75/m con 1 vCPU / 4GB) o Basic B1 en Dev ($13.14/m).",
                                monthlySavingsUsd: 35.00,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: "az appservice plan update --resource-group rg-peopletrack --name ASP-rgpeopletrack-be02 --sku P0v3",
                                commandTerraform: `sku_name = "P0v3"`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-peopletrack/providers/Microsoft.Web/serverfarms/ASP-orphan-zombie-01",
                        name: "ASP-orphan-zombie-01",
                        type: "microsoft.web/serverfarms",
                        region: "eastus2",
                        resourceGroup: "rg-peopletrack",
                        subscriptionName: "Testing CL",
                        state: "running",
                        sku: "Standard_S1",
                        tier: "Standard",
                        monthlyCostUsd: 79.51,
                        metricA: "0.2",
                        metricB: "12.0",
                        os: "Linux" as const,
                        numberOfWorkers: 1,
                        autoscaleMode: "manual" as const,
                        zoneRedundant: false,
                        appsCount: 0,
                        slotsCount: 0,
                        hostedApps: [],
                        cpuAvg: 0.2,
                        cpuMax: 0.6,
                        memoryPercentAvg: 12.0,
                        memoryPercentMax: 14.0,
                        totalRequests: 0,
                        http5xxRate: 0,
                        http4xxRate: 0,
                        isZombie: true,
                        potentialSavingUsd: 79.51,
                        remediationActions: [
                            {
                                id: "rec-zombie-2",
                                type: "zombie_plan" as const,
                                title: "Plan Huérfano / Vacío (Zombie ASP)",
                                description: "App Service Plan activo sin ninguna Web App o Function App alojada (numberOfSites = 0). Ahorro del 100% eliminando el contenedor.",
                                monthlySavingsUsd: 79.51,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: "az appservice plan delete --resource-group rg-peopletrack --name ASP-orphan-zombie-01 --yes",
                                commandTerraform: `# Eliminar recurso azurerm_service_plan del state:\nterraform destroy -target=azurerm_service_plan.orphan`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-2/resourceGroups/rg-ecommerce-prod/providers/Microsoft.Web/serverfarms/ASP-ecommerce-prod-weur",
                        name: "ASP-ecommerce-prod-weur",
                        type: "microsoft.web/serverfarms",
                        region: "westeurope",
                        resourceGroup: "rg-ecommerce-prod",
                        subscriptionName: "Producción Principal Azure",
                        state: "running",
                        sku: "PremiumV3_P1v3",
                        tier: "PremiumV3",
                        monthlyCostUsd: 284.00,
                        metricA: "9.5",
                        metricB: "44.0",
                        os: "Linux" as const,
                        numberOfWorkers: 2,
                        autoscaleMode: "manual" as const,
                        zoneRedundant: false,
                        appsCount: 2,
                        slotsCount: 2,
                        hostedApps: [
                            {
                                name: "ecommerce-storefront-web",
                                state: "Running",
                                slotsCount: 1,
                                slotNames: ["staging"],
                                alwaysOn: true,
                                httpRequests: 74200,
                                http5xx: 8,
                                http4xx: 120,
                            },
                            {
                                name: "ecommerce-checkout-api",
                                state: "Running",
                                slotsCount: 1,
                                slotNames: ["staging-idle"],
                                alwaysOn: true,
                                httpRequests: 12300,
                                http5xx: 1,
                                http4xx: 14,
                            },
                        ],
                        cpuAvg: 9.5,
                        cpuMax: 22.0,
                        memoryPercentAvg: 44.0,
                        memoryPercentMax: 56.0,
                        totalRequests: 86500,
                        http5xxRate: 0.01,
                        http4xxRate: 0.15,
                        isZombie: false,
                        potentialSavingUsd: 142.00,
                        remediationActions: [
                            {
                                id: "rec-scale-workers-3",
                                type: "scale_workers" as const,
                                title: "Escalado a 1 Instancia / Autoscale Dinámico",
                                description: "Plan con 2 workers dedicados pero CPU promedio < 10% (9.5%). Reducir a 1 worker base con regla de autoscale por CPU > 75%.",
                                monthlySavingsUsd: 142.00,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: "az appservice plan update --resource-group rg-ecommerce-prod --name ASP-ecommerce-prod-weur --number-of-workers 1",
                                commandTerraform: `# En azurerm_service_plan\nworker_count = 1`,
                            },
                            {
                                id: "rec-idle-slot-3",
                                type: "idle_slots" as const,
                                title: "Limpieza de Deployment Slots Inactivos",
                                description: "Slot 'staging-idle' en ecommerce-checkout-api sin tráfico HTTP en los últimos 14 días. Detener o eliminar slot para liberar memoria.",
                                monthlySavingsUsd: 28.00,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: "az webapp deployment slot stop --resource-group rg-ecommerce-prod --name ecommerce-checkout-api --slot staging-idle\n# O para eliminar:\n# az webapp deployment slot delete --resource-group rg-ecommerce-prod --name ecommerce-checkout-api --slot staging-idle",
                                commandTerraform: `# Eliminar bloque azurerm_linux_web_app_slot "staging_idle"`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-2/resourceGroups/rg-internal-apps/providers/Microsoft.Web/serverfarms/ASP-internal-hr-centralus",
                        name: "ASP-internal-hr-centralus",
                        type: "microsoft.web/serverfarms",
                        region: "centralus",
                        resourceGroup: "rg-internal-apps",
                        subscriptionName: "Producción Principal Azure",
                        state: "running",
                        sku: "Standard_S2",
                        tier: "Standard",
                        monthlyCostUsd: 159.02,
                        metricA: "4.8",
                        metricB: "28.0",
                        os: "Windows" as const,
                        numberOfWorkers: 1,
                        autoscaleMode: "manual" as const,
                        zoneRedundant: false,
                        appsCount: 1,
                        slotsCount: 0,
                        hostedApps: [
                            {
                                name: "portal-internal-hr",
                                state: "Running",
                                slotsCount: 0,
                                alwaysOn: true,
                                httpRequests: 3400,
                                http5xx: 0,
                                http4xx: 6,
                            },
                        ],
                        cpuAvg: 4.8,
                        cpuMax: 11.5,
                        memoryPercentAvg: 28.0,
                        memoryPercentMax: 35.0,
                        totalRequests: 3400,
                        http5xxRate: 0,
                        http4xxRate: 0.17,
                        isZombie: false,
                        potentialSavingUsd: 50.00,
                        remediationActions: [
                            {
                                id: "rec-modernize-4",
                                type: "modernize_sku" as const,
                                title: "Modernización a Premium v3 (P1v3)",
                                description: "Plan Windows Standard S2 ($159.02/m) subutilizado. Migrar a Premium v3 P1v3 ($109.50/m) con mayor CPU, memoria y discos SSD.",
                                monthlySavingsUsd: 49.52,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: "az appservice plan update --resource-group rg-internal-apps --name ASP-internal-hr-centralus --sku P1v3",
                                commandTerraform: `sku_name = "P1v3"`,
                            },
                        ],
                    },
                ];

                return NextResponse.json({
                    ok: true,
                    mock: true,
                    resourceExists: true,
                    dataAvailable: true,
                    data: {
                        summary: {
                            resourceCount: webAppItems.length,
                            totalMonthlyCostUsd: Number(webAppItems.reduce((acc, item) => acc + item.monthlyCostUsd, 0).toFixed(2)),
                            advisorRecommendations: webAppItems.reduce((acc, item) => acc + (item.remediationActions?.length || 0), 0),
                        },
                        items: webAppItems,
                    },
                });
            }

            if (family === "functions") {
                const functionItems = [
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-ecommerce-prod/providers/Microsoft.Web/sites/func-orders-api-prod",
                        name: "func-orders-api-prod",
                        type: "microsoft.web/sites",
                        region: "eastus2",
                        resourceGroup: "rg-ecommerce-prod",
                        subscriptionName: "Producción Principal Azure",
                        state: "running",
                        sku: "Consumption (Y1)",
                        hostingPlan: "Consumption (Y1)",
                        hostingPlanType: "consumption" as const,
                        runtimeStack: "Node.js 20",
                        os: "Linux" as const,
                        monthlyCostUsd: 0.08,
                        computeCostMonthlyUsd: 0.05,
                        storageCostMonthlyUsd: 0.02,
                        appInsightsCostMonthlyUsd: 0.01,
                        totalCostMonthlyUsd: 0.08,
                        executionCountMtd: 1250000,
                        executionUnitsGbs: 18400,
                        avgDurationMs: 128,
                        errorRatePercent: 0.01,
                        http5xxCount: 12,
                        http4xxCount: 84,
                        storageAccountName: "storderseastprod",
                        appInsightsName: "ai-orders-prod",
                        telemetryIngestionGbMonthly: 0.4,
                        metricA: "1.25M",
                        metricB: "18.4k GB-s",
                        isZombie: false,
                        potentialSavingUsd: 0.00,
                        remediationActions: [],
                    },
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-reporting-legacy/providers/Microsoft.Web/sites/func-legacy-reports-ep1",
                        name: "func-legacy-reports-ep1",
                        type: "microsoft.web/sites",
                        region: "westeurope",
                        resourceGroup: "rg-reporting-legacy",
                        subscriptionName: "Producción Principal Azure",
                        state: "running",
                        sku: "Elastic Premium (EP1)",
                        hostingPlan: "Elastic Premium (EP1)",
                        hostingPlanType: "elastic_premium" as const,
                        runtimeStack: ".NET 8",
                        os: "Linux" as const,
                        preWarmedInstances: 1,
                        monthlyCostUsd: 153.35,
                        computeCostMonthlyUsd: 152.00,
                        storageCostMonthlyUsd: 0.15,
                        appInsightsCostMonthlyUsd: 1.20,
                        totalCostMonthlyUsd: 153.35,
                        executionCountMtd: 14200,
                        executionUnitsGbs: 3200,
                        avgDurationMs: 240,
                        errorRatePercent: 0.00,
                        http5xxCount: 0,
                        http4xxCount: 2,
                        storageAccountName: "streportsweur",
                        appInsightsName: "ai-reporting-legacy",
                        telemetryIngestionGbMonthly: 1.1,
                        metricA: "14.2k",
                        metricB: "3.2k GB-s",
                        isZombie: false,
                        isOverprovisioned: true,
                        potentialSavingUsd: 145.00,
                        remediationActions: [
                            {
                                id: "rec-ep-downgrade-1",
                                type: "downgrade_consumption" as const,
                                title: "Migración a Plan Consumption (Baja Carga Serverless)",
                                description: "Function App alojada en Elastic Premium (EP1 ~$152 USD/mes) ejecutando apenas 14.2k invocaciones/mes sin requerir VNet activa. Migrar a Consumption (Y1).",
                                monthlySavingsUsd: 145.00,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `az functionapp plan create --name plan-reports-consumption --resource-group rg-reporting-legacy --consumption-only --location westeurope\naz functionapp update --name func-legacy-reports-ep1 --resource-group rg-reporting-legacy --plan plan-reports-consumption`,
                                commandTerraform: `resource "azurerm_service_plan" "consumption" {\n  name     = "plan-reports-consumption"\n  sku_name = "Y1"\n  os_type  = "Linux"\n}`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-2/resourceGroups/rg-ai-telemetry/providers/Microsoft.Web/sites/func-telemetry-collector-ai",
                        name: "func-telemetry-collector-ai",
                        type: "microsoft.web/sites",
                        region: "eastus",
                        resourceGroup: "rg-ai-telemetry",
                        subscriptionName: "Suscripción Inteligencia Artificial",
                        state: "running",
                        sku: "Consumption (Y1)",
                        hostingPlan: "Consumption (Y1)",
                        hostingPlanType: "consumption" as const,
                        runtimeStack: "Python 3.11",
                        os: "Linux" as const,
                        monthlyCostUsd: 48.70,
                        computeCostMonthlyUsd: 0.02,
                        storageCostMonthlyUsd: 0.18,
                        appInsightsCostMonthlyUsd: 48.50,
                        totalCostMonthlyUsd: 48.70,
                        executionCountMtd: 420000,
                        executionUnitsGbs: 12800,
                        avgDurationMs: 95,
                        errorRatePercent: 0.02,
                        http5xxCount: 8,
                        http4xxCount: 45,
                        storageAccountName: "staicollectoreastus",
                        appInsightsName: "ai-telemetry-collector",
                        telemetryIngestionGbMonthly: 18.2,
                        metricA: "420k",
                        metricB: "12.8k GB-s",
                        isZombie: false,
                        hasTelemetryLeak: true,
                        potentialSavingUsd: 38.80,
                        remediationActions: [
                            {
                                id: "rec-sampling-2",
                                type: "telemetry_sampling" as const,
                                title: "Control de Fuga en Logs & Telemetría (Sampling al 20%)",
                                description: "La ingesta de telemetría en Application Insights ($48.50/mes por 18.2 GB) supera en más de 2000x el costo de cómputo ($0.02/mes) por logs Verbose. Habilitar adaptive sampling al 20%.",
                                monthlySavingsUsd: 38.80,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandHostJson: `{\n  "logging": {\n    "applicationInsights": {\n      "samplingSettings": {\n        "isEnabled": true,\n        "maxTelemetryItemsPerSecond": 5,\n        "evaluationInterval": "00:01:00"\n      }\n    }\n  }\n}`,
                                commandCli: `az functionapp config appsettings set --name func-telemetry-collector-ai --resource-group rg-ai-telemetry --settings AzureFunctionsJobHost__logging__applicationInsights__samplingSettings__isEnabled=true`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-peopletrack/providers/Microsoft.Web/sites/func-batch-sync-zombie",
                        name: "func-batch-sync-zombie",
                        type: "microsoft.web/sites",
                        region: "eastus2",
                        resourceGroup: "rg-peopletrack",
                        subscriptionName: "Testing CL",
                        state: "running",
                        sku: "Dedicated (Standard_S1)",
                        hostingPlan: "Dedicated (App Service Plan)",
                        hostingPlanType: "dedicated" as const,
                        runtimeStack: "Java 17",
                        os: "Linux" as const,
                        monthlyCostUsd: 79.56,
                        computeCostMonthlyUsd: 79.51,
                        storageCostMonthlyUsd: 0.05,
                        appInsightsCostMonthlyUsd: 0.00,
                        totalCostMonthlyUsd: 79.56,
                        executionCountMtd: 0,
                        executionUnitsGbs: 0,
                        avgDurationMs: 0,
                        errorRatePercent: 0.00,
                        http5xxCount: 0,
                        http4xxCount: 0,
                        storageAccountName: "stpeoplesynceastus2",
                        appInsightsName: "ai-people-sync",
                        telemetryIngestionGbMonthly: 0.0,
                        metricA: "0 calls",
                        metricB: "0 GB-s",
                        isZombie: true,
                        potentialSavingUsd: 79.51,
                        remediationActions: [
                            {
                                id: "rec-zombie-func-3",
                                type: "zombie_app" as const,
                                title: "Detección de Function App Ociosa / Zombie",
                                description: "Function App alojada en un plan dedicado Standard S1 ($79.51/mes) con 0 ejecuciones en los últimos 30 días. Detener o eliminar la aplicación y desaprovisionar el plan.",
                                monthlySavingsUsd: 79.51,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `az functionapp stop --name func-batch-sync-zombie --resource-group rg-peopletrack\n# O desaprovisionar:\n# az functionapp delete --name func-batch-sync-zombie --resource-group rg-peopletrack`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-2/resourceGroups/rg-media-dev/providers/Microsoft.Web/sites/func-image-resizer-worker",
                        name: "func-image-resizer-worker",
                        type: "microsoft.web/sites",
                        region: "centralus",
                        resourceGroup: "rg-media-dev",
                        subscriptionName: "Suscripción Desarrollo & QA",
                        state: "running",
                        sku: "Consumption (Y1)",
                        hostingPlan: "Consumption (Y1)",
                        hostingPlanType: "consumption" as const,
                        runtimeStack: "Node.js 20",
                        os: "Linux" as const,
                        monthlyCostUsd: 15.98,
                        computeCostMonthlyUsd: 0.68,
                        storageCostMonthlyUsd: 14.20,
                        appInsightsCostMonthlyUsd: 1.10,
                        totalCostMonthlyUsd: 15.98,
                        executionCountMtd: 85000,
                        executionUnitsGbs: 42500,
                        avgDurationMs: 1200,
                        errorRatePercent: 0.00,
                        http5xxCount: 0,
                        http4xxCount: 5,
                        storageAccountName: "stmediaresizerdev",
                        appInsightsName: "ai-media-resizer",
                        telemetryIngestionGbMonthly: 0.8,
                        metricA: "85k",
                        metricB: "42.5k GB-s",
                        isZombie: false,
                        potentialSavingUsd: 12.50,
                        remediationActions: [
                            {
                                id: "rec-storage-polling-4",
                                type: "storage_polling" as const,
                                title: "Reducción de Polling en Triggers (Storage Queue)",
                                description: "Trigger de Azure Queue Storage consultando cada 100ms generando millones de operaciones de lectura innecesarias ($14.20/mes). Configurar maxPollingInterval a 2 segundos en host.json.",
                                monthlySavingsUsd: 12.50,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandHostJson: `{\n  "extensions": {\n    "queues": {\n      "maxPollingInterval": "00:00:02",\n      "batchSize": 16\n    }\n  }\n}`,
                            },
                        ],
                    },
                ];

                return NextResponse.json({
                    ok: true,
                    mock: true,
                    resourceExists: true,
                    dataAvailable: true,
                    data: {
                        summary: {
                            resourceCount: functionItems.length,
                            totalMonthlyCostUsd: Number(functionItems.reduce((acc, item) => acc + item.monthlyCostUsd, 0).toFixed(2)),
                            advisorRecommendations: functionItems.reduce((acc, item) => acc + (item.remediationActions?.length || 0), 0),
                        },
                        items: functionItems,
                    },
                });
            }

            if (family === "vms") {
                const vmItems = [
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg_desarrollo_cl/providers/Microsoft.Compute/virtualMachines/GPLISERVERv2",
                        name: "GPLISERVERv2",
                        type: "microsoft.compute/virtualmachines",
                        region: "eastus",
                        resourceGroup: "rg_desarrollo_cl",
                        subscriptionName: "Testing CL",
                        state: "running",
                        powerState: "running",
                        sku: "Standard_D4ds_v4",
                        vCpu: 4,
                        ramGb: 16,
                        os: "Windows" as const,
                        osDiskType: "Premium_LRS",
                        osDiskSizeGb: 128,
                        dataDisksCount: 0,
                        dataDisksTotalGb: 0,
                        licenseType: "None",
                        ahubActive: false,
                        priority: "Regular",
                        publicIp: null,
                        hasPublicIp: false,
                        cpuAvg: 1.2,
                        cpuMax: 8.4,
                        memoryInUsePercent: 11.5,
                        memoryTotalGb: 16,
                        memoryAvailableGb: 14.16,
                        uptimePercent: 98,
                        iops: 42,
                        monthlyCostUsd: 32.55,
                        computeCostMonthlyUsd: 18.35,
                        storageCostMonthlyUsd: 14.20,
                        totalCostMonthlyUsd: 32.55,
                        metricA: "1.2% (P95: 8.4%)",
                        metricB: "11.5% RAM (1.8/16 GB)",
                        isZombie: false,
                        potentialSavingUsd: 24.80,
                        remediationActions: [
                            {
                                id: "rec-rs-gpliserver",
                                type: "rightsizing_sku" as const,
                                title: "Rightsizing de SKU: Migrar a Serie B Burstable",
                                description: "CPU promedio de 1.2% (<10%) y memoria utilizada de 11.5% en D4ds_v4 (4 vCPU / 16GB). Migrar a Standard_B2s (2 vCPU / 4GB) para ahorrar 76% de cómputo.",
                                targetSku: "Standard_B2s",
                                monthlySavingsUsd: 24.80,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `az vm resize --resource-group rg_desarrollo_cl --name GPLISERVERv2 --size Standard_B2s`,
                                commandTerraform: `# En módulo azurerm_windows_virtual_machine\nsize = "Standard_B2s"`,
                                commandPowerShell: `Update-AzVM -ResourceGroupName "rg_desarrollo_cl" -VM (Get-AzVM -ResourceGroupName "rg_desarrollo_cl" -Name "GPLISERVERv2" | Set-AzVMOperatingSystem -Size "Standard_B2s")`,
                            },
                            {
                                id: "rec-ahub-gpliserver",
                                type: "ahub" as const,
                                title: "Activar Azure Hybrid Benefit (AHUB)",
                                description: "VM Windows Server sin licencia híbrida activa. Aplicar licencia existente on-premise con Software Assurance para reducir el costo de cómputo en un 40%.",
                                monthlySavingsUsd: 7.34,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `az vm update --resource-group rg_desarrollo_cl --name GPLISERVERv2 --set licenseType=Windows_Server`,
                                commandTerraform: `license_type = "Windows_Server"`,
                                commandPowerShell: `$vm = Get-AzVM -ResourceGroupName "rg_desarrollo_cl" -Name "GPLISERVERv2"\n$vm.LicenseType = "Windows_Server"\nUpdate-AzVM -ResourceGroupName "rg_desarrollo_cl" -VM $vm`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg_produccion_inspeccion/providers/Microsoft.Compute/virtualMachines/inspectorprod",
                        name: "inspectorprod",
                        type: "microsoft.compute/virtualmachines",
                        region: "eastus2",
                        resourceGroup: "rg_produccion_inspeccion",
                        subscriptionName: "Producción Principal Azure",
                        state: "deallocated",
                        powerState: "deallocated",
                        sku: "Standard_D8s_v5",
                        vCpu: 8,
                        ramGb: 32,
                        os: "Linux" as const,
                        osDiskType: "Premium_LRS",
                        osDiskSizeGb: 128,
                        dataDisksCount: 1,
                        dataDisksTotalGb: 256,
                        licenseType: "None",
                        ahubActive: false,
                        priority: "Regular",
                        publicIp: "20.42.18.91",
                        hasPublicIp: true,
                        cpuAvg: 0.0,
                        cpuMax: 0.0,
                        memoryInUsePercent: 0.0,
                        memoryTotalGb: 32,
                        memoryAvailableGb: 32,
                        uptimePercent: 0,
                        iops: 0,
                        monthlyCostUsd: 32.80,
                        computeCostMonthlyUsd: 0.00,
                        storageCostMonthlyUsd: 32.80,
                        totalCostMonthlyUsd: 32.80,
                        metricA: "0.0% (Deallocated)",
                        metricB: "0.0% RAM (Apagada)",
                        isZombie: false,
                        potentialSavingUsd: 17.50,
                        remediationActions: [
                            {
                                id: "rec-disk-inspectorprod",
                                type: "deallocated_disk" as const,
                                title: "Fuga de Almacenamiento en VM Desasignada (Deallocated Waste)",
                                description: "VM apagada pero cobrando tarifa completa por Disco OS Premium SSD 128GB ($18.00/m) y Data Disk 256GB ($14.80/m). Degradar disco OS a Standard HDD (Standard_LRS) mientras permanezca inactiva.",
                                monthlySavingsUsd: 17.50,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `# 1. Obtener nombre del disco administrado\nOS_DISK=$(az vm show -g rg_produccion_inspeccion -n inspectorprod --query "storageProfile.osDisk.managedDisk.id" -o tsv)\n\n# 2. Degradar el tier a Standard HDD\naz disk update --ids $OS_DISK --sku Standard_LRS`,
                                commandTerraform: `os_disk {\n  storage_account_type = "Standard_LRS"\n}`,
                                commandPowerShell: `$disk = Get-AzDisk -ResourceGroupName "rg_produccion_inspeccion" -DiskName "inspectorprod_osdisk"\n$disk.Sku = [Microsoft.Azure.Management.Compute.Models.DiskSku]::new("Standard_LRS")\nUpdate-AzDisk -ResourceGroupName "rg_produccion_inspeccion" -DiskName "inspectorprod_osdisk" -Disk $disk`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-2/resourceGroups/rg-rpa-testing/providers/Microsoft.Compute/virtualMachines/rpa365-test-vm01",
                        name: "rpa365-test-vm01",
                        type: "microsoft.compute/virtualmachines",
                        region: "centralus",
                        resourceGroup: "rg-rpa-testing",
                        subscriptionName: "Suscripción Desarrollo & QA",
                        state: "running",
                        powerState: "running",
                        sku: "Standard_E4s_v5",
                        vCpu: 4,
                        ramGb: 32,
                        os: "Windows" as const,
                        osDiskType: "StandardSSD_LRS",
                        osDiskSizeGb: 128,
                        dataDisksCount: 0,
                        dataDisksTotalGb: 0,
                        licenseType: "Windows_Server",
                        ahubActive: true,
                        priority: "Regular",
                        publicIp: null,
                        hasPublicIp: false,
                        cpuAvg: 14.5,
                        cpuMax: 38.0,
                        memoryInUsePercent: 28.0,
                        memoryTotalGb: 32,
                        memoryAvailableGb: 23.0,
                        uptimePercent: 100,
                        iops: 95,
                        monthlyCostUsd: 155.60,
                        computeCostMonthlyUsd: 146.00,
                        storageCostMonthlyUsd: 9.60,
                        totalCostMonthlyUsd: 155.60,
                        metricA: "14.5% (P95: 38.0%)",
                        metricB: "28.0% RAM (9/32 GB)",
                        isZombie: false,
                        potentialSavingUsd: 94.90,
                        remediationActions: [
                            {
                                id: "rec-schedule-rpa",
                                type: "power_schedule" as const,
                                title: "Programación de Apagado (Dev/Test Schedule 8x5)",
                                description: "VM en grupo de recursos de pruebas/desarrollo corriendo 24/7 (100% uptime). Configurar calendario de apagado automático de 19:00 a 08:00 L-V y fines de semana para ahorrar 65% de cómputo.",
                                monthlySavingsUsd: 94.90,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `az vm auto-shutdown --resource-group rg-rpa-testing --name rpa365-test-vm01 --time 1900 --email-alert false`,
                                commandTerraform: `resource "azurerm_dev_test_global_vm_shutdown_schedule" "schedule" {\n  virtual_machine_id = azurerm_windows_virtual_machine.rpa.id\n  location           = "centralus"\n  enabled            = true\n  daily_recurrence_time = "1900"\n  timezone           = "UTC"\n}`,
                                commandPowerShell: `New-AzAutoShutdown -ResourceGroupName "rg-rpa-testing" -Name "rpa365-test-vm01" -Time "19:00" -TimeZone "UTC"`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-database-prod/providers/Microsoft.Compute/virtualMachines/srv-sql-win01",
                        name: "srv-sql-win01",
                        type: "microsoft.compute/virtualmachines",
                        region: "eastus",
                        resourceGroup: "rg-database-prod",
                        subscriptionName: "Producción Principal Azure",
                        state: "running",
                        powerState: "running",
                        sku: "Standard_E8ds_v5",
                        vCpu: 8,
                        ramGb: 64,
                        os: "Windows" as const,
                        osDiskType: "Premium_LRS",
                        osDiskSizeGb: 256,
                        dataDisksCount: 2,
                        dataDisksTotalGb: 1024,
                        licenseType: "None",
                        ahubActive: false,
                        priority: "Regular",
                        publicIp: null,
                        hasPublicIp: false,
                        cpuAvg: 48.2,
                        cpuMax: 72.5,
                        memoryInUsePercent: 62.0,
                        memoryTotalGb: 64,
                        memoryAvailableGb: 24.3,
                        uptimePercent: 99.9,
                        iops: 840,
                        monthlyCostUsd: 524.50,
                        computeCostMonthlyUsd: 412.00,
                        storageCostMonthlyUsd: 112.50,
                        totalCostMonthlyUsd: 524.50,
                        metricA: "48.2% (P95: 72.5%)",
                        metricB: "62.0% RAM (39.7/64 GB)",
                        isZombie: false,
                        potentialSavingUsd: 164.80,
                        remediationActions: [
                            {
                                id: "rec-ahub-sqlwin",
                                type: "ahub" as const,
                                title: "Activación de Azure Hybrid Benefit (AHUB Windows Server)",
                                description: "Servidor productivo de base de datos con 8 vCPUs pagando licencia completa de Windows Server en Pay-As-You-Go ($412/m compute). Aplicar licencia on-premises para ahorrar 40%.",
                                monthlySavingsUsd: 164.80,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `az vm update --resource-group rg-database-prod --name srv-sql-win01 --set licenseType=Windows_Server`,
                                commandTerraform: `license_type = "Windows_Server"`,
                                commandPowerShell: `$vm = Get-AzVM -ResourceGroupName "rg-database-prod" -Name "srv-sql-win01"\n$vm.LicenseType = "Windows_Server"\nUpdate-AzVM -ResourceGroupName "rg-database-prod" -VM $vm`,
                            },
                        ],
                    },
                    {
                        id: "/subscriptions/mock-sub-1/resourceGroups/rg-legacy-apps-temp/providers/Microsoft.Compute/virtualMachines/srv-abandoned-legacy-01",
                        name: "srv-abandoned-legacy-01",
                        type: "microsoft.compute/virtualmachines",
                        region: "westeurope",
                        resourceGroup: "rg-legacy-apps-temp",
                        subscriptionName: "Testing CL",
                        state: "deallocated",
                        powerState: "deallocated",
                        sku: "Standard_F4s_v2",
                        vCpu: 4,
                        ramGb: 8,
                        os: "Linux" as const,
                        osDiskType: "Premium_LRS",
                        osDiskSizeGb: 128,
                        dataDisksCount: 1,
                        dataDisksTotalGb: 100,
                        licenseType: "None",
                        ahubActive: false,
                        priority: "Regular",
                        publicIp: "52.148.22.10",
                        hasPublicIp: true,
                        cpuAvg: 0.0,
                        cpuMax: 0.0,
                        memoryInUsePercent: 0.0,
                        memoryTotalGb: 8,
                        memoryAvailableGb: 8,
                        uptimePercent: 0,
                        iops: 0,
                        monthlyCostUsd: 22.60,
                        computeCostMonthlyUsd: 0.00,
                        storageCostMonthlyUsd: 22.60,
                        totalCostMonthlyUsd: 22.60,
                        metricA: "0.0% (Inactiva >60d)",
                        metricB: "0.0% RAM",
                        isZombie: true,
                        potentialSavingUsd: 22.60,
                        remediationActions: [
                            {
                                id: "rec-abandoned-vm-1",
                                type: "abandoned_vm" as const,
                                title: "Descarte / Snapshot de VM Abandonada",
                                description: "VM desasignada hace más de 60 días sin actividad de red ni cambios de estado. Crear snapshot de seguridad del disco para archivo y eliminar la VM y su IP pública asociada.",
                                monthlySavingsUsd: 22.60,
                                risk: "low" as const,
                                confidence: "high" as const,
                                commandCli: `# 1. Crear Snapshot de resguardo\naz snapshot create --resource-group rg-legacy-apps-temp --name snap-abandoned-01 --source $(az vm show -g rg-legacy-apps-temp -n srv-abandoned-legacy-01 --query "storageProfile.osDisk.managedDisk.id" -o tsv)\n\n# 2. Eliminar la VM y sus recursos asociados\naz vm delete --resource-group rg-legacy-apps-temp --name srv-abandoned-legacy-01 --yes`,
                                commandTerraform: `# Eliminar recurso de Terraform:\nterraform destroy -target=azurerm_linux_virtual_machine.srv_abandoned`,
                                commandPowerShell: `New-AzSnapshot -ResourceGroupName "rg-legacy-apps-temp" -SnapshotName "snap-abandoned-01" -Snapshot (New-AzSnapshotConfig -SourceResourceId (Get-AzVM -ResourceGroupName "rg-legacy-apps-temp" -Name "srv-abandoned-legacy-01").StorageProfile.OsDisk.ManagedDisk.Id -Location "westeurope" -CreateOption Copy)\nRemove-AzVM -ResourceGroupName "rg-legacy-apps-temp" -Name "srv-abandoned-legacy-01" -Force`,
                            },
                        ],
                    },
                ];

                return NextResponse.json({
                    ok: true,
                    mock: true,
                    resourceExists: true,
                    dataAvailable: true,
                    data: {
                        summary: {
                            resourceCount: vmItems.length,
                            totalMonthlyCostUsd: Number(vmItems.reduce((acc, item) => acc + item.monthlyCostUsd, 0).toFixed(2)),
                            advisorRecommendations: vmItems.reduce((acc, item) => acc + (item.remediationActions?.length || 0), 0),
                        },
                        items: vmItems,
                    },
                });
            }

            return NextResponse.json({
                ok: true,
                mock: true,
                resourceExists: true,
                dataAvailable: true,
                data: {
                    summary: { resourceCount: 2, totalMonthlyCostUsd: 420.5 },
                    items: [
                        {
                            id: `${family}-demo-1`,
                            name: `${family}-demo-1`,
                            type: FAMILY_TYPES[family][0],
                            region: "eastus",
                            resourceGroup: "rg-demo-finops-a",
                            subscriptionName: "Demo Production Subscription",
                            state: "running",
                            sku: "Standard",
                            monthlyCostUsd: 210.25,
                            metricA: "42",
                            metricB: "17",
                        },
                        {
                            id: `${family}-demo-2`,
                            name: `${family}-demo-2`,
                            type: FAMILY_TYPES[family][0],
                            region: "westus2",
                            resourceGroup: "rg-demo-finops-b",
                            subscriptionName: "Demo Sandbox Subscription",
                            state: "running",
                            sku: "Standard",
                            monthlyCostUsd: 210.25,
                            metricA: "39",
                            metricB: "13",
                        },
                    ],
                },
            });
        }

        const cacheKey = `compute:workloads:v1:${tenantId}:${family}`;
        if (searchParams.get("bust") === "1") {
            await redis.del(cacheKey).catch(() => undefined);
        } else {
            const cachedPayload = await readWorkloadsCache(cacheKey);
            if (cachedPayload) {
                return NextResponse.json(cachedPayload);
            }
        }

        const credential = await getAzureCredential(tenantId);
        const subscriptionIds = await getSubscriptionsForTenant(tenantId, credential);
        if (subscriptionIds.length === 0) {
            const payload: ComputeWorkloadApiResponse = {
                ok: true,
                mock: false,
                resourceExists: false,
                dataAvailable: false,
                message: "No existen suscripciones activas para este tenant.",
                data: { summary: { resourceCount: 0, totalMonthlyCostUsd: 0 }, items: [] },
            };
            await writeWorkloadsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        let resources = await listResourcesByTypes(
            tenantId,
            FAMILY_TYPES[family],
            subscriptionIds,
            credential,
        );

        if (family === "functions") {
            resources = resources.filter((r) => toLowerSafe(r.kind).includes("functionapp"));
        }
        let webappSites: ArgResourceRow[] = [];
        if (family === "webapps") {
            const plans = resources.filter((r) => r.type === "microsoft.web/serverfarms");
            webappSites = resources.filter(
                (r) =>
                    r.type === "microsoft.web/sites" &&
                    !toLowerSafe(r.kind).includes("functionapp"),
            );
            // El contenedor de facturación y cómputo de Web Apps en Azure es el App Service Plan (serverfarm).
            // Si existen planes, iteramos sobre ellos y anidamos sus Web Apps alojadas.
            resources = plans.length > 0 ? plans : webappSites;
        }

        if (resources.length === 0) {
            const payload: ComputeWorkloadApiResponse = {
                ok: true,
                mock: false,
                resourceExists: false,
                dataAvailable: true,
                message: FAMILY_EMPTY_MESSAGE[family],
                data: { summary: { resourceCount: 0, totalMonthlyCostUsd: 0 }, items: [] },
            };
            await writeWorkloadsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const primaryCostTypes = family === "webapps" ? ["Microsoft.Web/serverfarms", "Microsoft.Web/sites"] : FAMILY_COST_TYPES[family];
        let { costByType, dataAvailable, errors: costErrors } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            primaryCostTypes,
        );

        // Web Apps can report cost either at plan level (serverfarms) or site level.
        // Consolidate both into plan attribution.
        if (family === "webapps") {
            const webTotal = (costByType.get("microsoft.web/serverfarms") || new Decimal(0))
                .plus(costByType.get("microsoft.web/sites") || new Decimal(0));
            costByType.set("microsoft.web/serverfarms", webTotal);
        }

        const familyFallbackTypes = FAMILY_COST_FALLBACK_TYPES[family];
        if (familyFallbackTypes && sumCostMap(costByType) <= 0) {
            const fallback = await getMonthlyCostByType(
                tenantId,
                credential,
                subscriptionIds,
                familyFallbackTypes,
            );
            if (sumCostMap(fallback.costByType) > 0) {
                costByType = fallback.costByType;
            }
            dataAvailable = dataAvailable && fallback.dataAvailable;
        }

        // Costo exacto por ResourceId; el reparto por tipo queda de respaldo
        // para lo que todavía no tiene facturación propia.
        const exactCostById = await getMtdCostByResourceId(
            tenantId,
            credential,
            family === "webapps" ? [...resources, ...webappSites] : resources,
        );

        // Azure imputa el gasto de Web Apps al plan o al site según el caso. Se
        // suma el de cada site a su App Service Plan, que es el contenedor de
        // facturación real y lo que muestra el cockpit.
        if (family === "webapps") {
            for (const site of webappSites) {
                const siteCost = exactCostById.get(site.id.toLowerCase());
                if (!siteCost) continue;
                const planId = String((site.properties as any)?.serverFarmId || "").toLowerCase();
                if (!planId) continue;
                exactCostById.set(planId, (exactCostById.get(planId) || 0) + siteCost);
            }
        }

        const costPerResource = distributeCostPerResource(resources, costByType, exactCostById);
        const subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);
        // Un único `now` para todo el request: si cada ítem tomara el suyo, dos
        // recursos del mismo listado podrían prorratearse contra instantes
        // distintos y sus totales no cerrarían.
        const now = new Date();

        const items: ComputeWorkloadItemBase[] = [];
        const topResources = resources.slice(0, 20);
        for (const resource of topResources) {
            const metrics = await getAzureResourceMetricsSummary(credential, resource.id, FAMILY_METRICS[family]);
            const metricAName = FAMILY_METRICS[family][0];
            const metricBName = FAMILY_METRICS[family][1];
            const metricAValue = metrics[metricAName];
            const metricBValue = metrics[metricBName];

            if (family === "webapps") {
                const props = (resource.properties || {}) as Record<string, any>;
                // ARG proyecta el SKU como campos planos (skuName/skuTier/
                // skuCapacity), no como objeto. Leer sólo `sku`/`props.sku`
                // daba siempre undefined y el tier caía al literal "Standard":
                // dos planes con SKUs distintos (FC1 y EP1) terminaban con el
                // mismo precio estimado y el mismo costo en pantalla.
                const skuObj = (resource as any).sku || props?.sku || {};
                const skuName = String(resource.skuName || skuObj?.name || "");
                const tier = String(resource.skuTier || skuObj?.tier || "Standard");
                const numberOfWorkers = Number(
                    resource.skuCapacity || skuObj?.capacity || props?.numberOfWorkers || 1,
                );
                const zoneRedundant = Boolean(props?.zoneRedundant);
                const os = props?.reserved ? "Linux" : "Windows";
                const autoscaleMode = (props?.targetWorkerSizeId ? "metric" : "manual") as "manual" | "metric" | "schedule";
                const rawCost = costPerResource.get(resource.id) || 0;
                // `rawCost` ya viene MonthToDate. Cuando Cost Management todavía
                // no tiene datos del recurso (sus primeras horas), se estima
                // desde el precio de lista, pero PRORRATEADO a lo transcurrido:
                // el precio mensual entero bajo la etiqueta "acumulado" hacía
                // que un plan creado hoy figurara con el gasto de un mes.
                const createdAt = extractResourceCreatedAt(props, (resource as any).systemData);
                const skuMonthlyRate = estimateAppServiceMonthlyCost(
                    skuName || tier,
                    tier,
                    numberOfWorkers,
                    os === "Linux"
                );
                // Sin dato de Cost Management NO se inventa un importe: queda en 0
                // y se marca `costDataAvailable: false` para que la UI muestre
                // "sin datos" en vez de un número que parece facturación. Antes
                // se mostraba el precio de lista del SKU como si fuera gasto real.
                const costDataAvailable = rawCost > 0;
                const cost = rawCost;
                // Tarifa MENSUAL sostenida, distinta del acumulado: los ahorros
                // se expresan por mes ("migrar de SKU ahorra $15/mes"). Con el
                // acumulado, un plan nuevo daba ahorros de centavos y los
                // umbrales del tipo `> 40` no se disparaban, así que
                // recomendaciones válidas desaparecían de la pantalla.
                const monthlyRateUsd = rawCost > 0
                    ? monthlyRunRate(rawCost, now, createdAt)
                    : skuMonthlyRate;

                // Match Web Apps hosted on this plan
                const matchedSites = webappSites.filter((s) => {
                    const sfId = String((s.properties as any)?.serverFarmId || "").toLowerCase();
                    return sfId === resource.id.toLowerCase() || sfId.endsWith("/" + resource.name.toLowerCase());
                });

                const hostedApps: any[] = matchedSites.map((site) => ({
                    name: site.name,
                    state: resolveState(site, "webapps"),
                    slotsCount: Array.isArray((site.properties as any)?.slotNames) ? (site.properties as any).slotNames.length : 0,
                    alwaysOn: Boolean((site.properties as any)?.siteConfig?.alwaysOn ?? true),
                    httpRequests: 0,
                    http5xx: 0,
                }));

                const appsCount = hostedApps.length;
                const slotsCount = hostedApps.reduce((acc, a) => acc + (a.slotsCount || 0), 0);
                const isZombie = appsCount === 0;
                const cpuAvg = typeof metricAValue === "number" ? metricAValue : null;
                const memoryPercentAvg = typeof metricBValue === "number" ? metricBValue : null;

                const actions: any[] = [];

                if (isZombie && monthlyRateUsd > 0) {
                    actions.push({
                        id: `rec-zombie-${resource.name}`,
                        type: "zombie_plan",
                        title: "Plan Huérfano / Vacío (Zombie ASP)",
                        description: "App Service Plan activo sin ninguna Web App alojada. Ahorro del 100% al eliminar el plan.",
                        monthlySavingsUsd: Number(monthlyRateUsd.toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az appservice plan delete --resource-group ${resource.resourceGroup} --name ${resource.name} --yes`,
                        commandTerraform: `# Eliminar recurso de Terraform:\nterraform destroy -target=azurerm_service_plan.${resource.name.replace(/[^a-zA-Z0-9]/g, "_")}`,
                    });
                }

                if (appsCount === 1 && cpuAvg !== null && cpuAvg < 15 && monthlyRateUsd > 40) {
                    actions.push({
                        id: `rec-packing-${resource.name}`,
                        type: "app_packing",
                        title: "Consolidación de Aplicaciones (App Packing)",
                        description: `Plan con 1 app y baja utilización (CPU ${cpuAvg}%). Mover app a un plan compartido y eliminar este plan.`,
                        monthlySavingsUsd: Number(monthlyRateUsd.toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az webapp update --resource-group ${resource.resourceGroup} --name ${hostedApps[0]?.name} --plan <TARGET_PLAN>\naz appservice plan delete --resource-group ${resource.resourceGroup} --name ${resource.name} --yes`,
                    });
                }

                if ((tier.toLowerCase().includes("standard") || tier.toLowerCase().includes("premium")) && (cpuAvg === null || cpuAvg < 25) && monthlyRateUsd > 40) {
                    actions.push({
                        id: `rec-modernize-${resource.name}`,
                        type: "modernize_sku",
                        title: "Modernización a Premium v3 / Downgrade a Basic",
                        description: `SKU ${tier} subutilizado. Migrar a P0v3/P1v3 para mejor costo/beneficio o Basic B1 en dev.`,
                        monthlySavingsUsd: Number((monthlyRateUsd * 0.35).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az appservice plan update --resource-group ${resource.resourceGroup} --name ${resource.name} --sku P0v3`,
                        commandTerraform: `sku_name = "P0v3"`,
                    });
                }

                if (numberOfWorkers > 1 && (cpuAvg === null || cpuAvg < 20)) {
                    actions.push({
                        id: `rec-workers-${resource.name}`,
                        type: "scale_workers",
                        title: "Escalado a 1 Instancia / Autoscale Dinámico",
                        description: `${numberOfWorkers} workers asignados con baja carga. Reducir a 1 worker y configurar autoscale.`,
                        monthlySavingsUsd: Number((monthlyRateUsd * (1 - 1 / numberOfWorkers)).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az appservice plan update --resource-group ${resource.resourceGroup} --name ${resource.name} --number-of-workers 1`,
                        commandTerraform: `worker_count = 1`,
                    });
                }

                if (slotsCount > 0) {
                    actions.push({
                        id: `rec-slots-${resource.name}`,
                        type: "idle_slots",
                        title: "Limpieza de Deployment Slots Inactivos",
                        description: `${slotsCount} slots de staging detectados. Detener slots inactivos para liberar capacidad.`,
                        monthlySavingsUsd: Number((slotsCount * 25.0).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az webapp deployment slot stop --resource-group ${resource.resourceGroup} --name ${hostedApps[0]?.name || "app"} --slot staging`,
                    });
                }

                items.push({
                    id: resource.id,
                    name: resource.name,
                    type: resource.type,
                    region: resource.location || "unknown",
                    resourceGroup: resource.resourceGroup || "unknown",
                    subscriptionName: resolveSubscriptionName(resource.subscriptionId, subscriptionNameMap) || "unknown",
                    state: resolveState(resource, family),
                    sku: resolveSku(resource, family),
                    monthlyCostUsd: cost,
                    costDataAvailable,
                    forecastMonthEndUsd: forecastMonthEnd(cost, now, extractResourceCreatedAt((resource.properties || {}) as any, (resource as any).systemData)),
                    metricA: metricAValue === null || metricAValue === undefined ? "N/A" : String(metricAValue),
                    metricB: metricBValue === null || metricBValue === undefined ? "N/A" : String(metricBValue),
                    os,
                    tier,
                    numberOfWorkers,
                    autoscaleMode,
                    zoneRedundant,
                    appsCount,
                    slotsCount,
                    hostedApps,
                    cpuAvg: cpuAvg ?? undefined,
                    cpuMax: cpuAvg ? Number((cpuAvg * 1.6).toFixed(1)) : undefined,
                    memoryPercentAvg: memoryPercentAvg ?? undefined,
                    memoryPercentMax: memoryPercentAvg ? Number((memoryPercentAvg * 1.3).toFixed(1)) : undefined,
                    totalRequests: 0,
                    http5xxRate: 0,
                    http4xxRate: 0,
                    isZombie,
                    potentialSavingUsd: Number(actions.reduce((acc, a) => acc + a.monthlySavingsUsd, 0).toFixed(2)),
                    remediationActions: actions,
                } as any);
                continue;
            }

            if (family === "vmss") {
                const props = (resource.properties || {}) as Record<string, any>;
                const skuObj = (resource as any).sku || props?.sku || {};
                const capacity = Number(skuObj?.capacity || props?.capacity || 1);
                const orchestrationMode = (props?.orchestrationMode === "Flexible" ? "Flexible" : "Uniform") as "Flexible" | "Uniform";
                const priority = (props?.virtualMachineProfile?.priority === "Spot" ? "Spot" : "Regular") as "Regular" | "Spot";
                const licenseType = String(props?.virtualMachineProfile?.licenseType || "None");
                const ahubActive = licenseType.toLowerCase().includes("windows") || licenseType.toLowerCase().includes("rhel") || licenseType.toLowerCase().includes("sles");
                const osDiskType = String(props?.virtualMachineProfile?.storageProfile?.osDisk?.managedDisk?.storageAccountType || "Premium_LRS");
                const autoscaleMode = (props?.automaticRepairsPolicy?.enabled ? "metric" : "manual") as "manual" | "metric" | "schedule";
                const cpuAvg = typeof metricAValue === "number" ? metricAValue : null;
                const iops = typeof metrics["Disk Read Operations/Sec"] === "number" || typeof metrics["Disk Write Operations/Sec"] === "number"
                    ? Number(((metrics["Disk Read Operations/Sec"] || 0) + (metrics["Disk Write Operations/Sec"] || 0)).toFixed(1))
                    : null;

                const cost = costPerResource.get(resource.id) || 0;
                const costDataAvailable = cost > 0;
                // Acumulado vs tarifa mensual: `cost` es lo gastado en el mes,
                // los ahorros se expresan por mes. Ver rama webapps.
                const monthlyRateUsd = monthlyRunRate(
                    cost,
                    now,
                    extractResourceCreatedAt(props, (resource as any).systemData),
                );
                const actions: any[] = [];

                if (cpuAvg !== null && cpuAvg < 15 && monthlyRateUsd > 50) {
                    actions.push({
                        id: `rec-rs-${resource.name}`,
                        type: "rightsizing",
                        title: "Rightsizing de SKU (Sobredimensionado)",
                        description: `CPU promedio de ${cpuAvg}% (<15%). Sugerido reducir tamaño de SKU para optimizar costos.`,
                        monthlySavingsUsd: Number((monthlyRateUsd * 0.25).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az vmss update --resource-group ${resource.resourceGroup} --name ${resource.name} --set sku.name=Standard_D2ads_v5\naz vmss update-instances --resource-group ${resource.resourceGroup} --name ${resource.name} --instance-ids '*'`,
                        commandTerraform: `# En módulo VMSS\nsku_name = "Standard_D2ads_v5"`,
                    });
                }

                if (capacity > 1 && autoscaleMode === "manual" && monthlyRateUsd > 40) {
                    actions.push({
                        id: `rec-auto-${resource.name}`,
                        type: "autoscale",
                        title: "Activar Autoscale por Calendario (Scale-to-Min)",
                        description: `Capacidad fija (${capacity} VMs) sin autoscale. Reducir instancias fuera de horario laboral.`,
                        monthlySavingsUsd: Number((monthlyRateUsd * 0.35).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az monitor autoscale create --resource-group ${resource.resourceGroup} --resource ${resource.name} --resource-type Microsoft.Compute/virtualMachineScaleSets --name autoscale-${resource.name} --min-count 1 --max-count ${capacity} --count 1`,
                        commandTerraform: `resource "azurerm_monitor_autoscale_setting" "as" {\n  name = "autoscale-${resource.name}"\n  target_resource_id = azurerm_linux_virtual_machine_scale_set.main.id\n}`,
                    });
                }

                const rgLower = (resource.resourceGroup || "").toLowerCase();
                if ((rgLower.includes("dev") || rgLower.includes("test") || rgLower.includes("qa") || rgLower.includes("staging")) && priority !== "Spot") {
                    actions.push({
                        id: `rec-spot-${resource.name}`,
                        type: "spot",
                        title: "Conversión a Instancias Spot (Dev/Staging)",
                        description: "Carga en ambiente no productivo. Configurar Spot con desalojo Deallocate para ahorrar hasta 70%.",
                        monthlySavingsUsd: Number((monthlyRateUsd * 0.65).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `# Opción A: Actualizar prioridad Spot con billingProfile estructurado en JSON\naz vmss update --resource-group ${resource.resourceGroup} --name ${resource.name} --set virtualMachineProfile.priority=Spot virtualMachineProfile.evictionPolicy=Deallocate virtualMachineProfile.billingProfile='{"maxPrice":-1}'\n\n# Opción B (Si el modo de orquestación no admite mutar prioridad en caliente):\n# Desplegar un nuevo Scale Set Spot y drenar tráfico hacia el nuevo pool:\n# az vmss create --resource-group ${resource.resourceGroup} --name ${resource.name}-spot --priority Spot --eviction-policy Deallocate --max-price -1`,
                    });
                }

                if (licenseType === "None" && monthlyRateUsd > 60) {
                    actions.push({
                        id: `rec-ahub-${resource.name}`,
                        type: "ahub",
                        title: "Activar Azure Hybrid Benefit (AHUB)",
                        description: "Aplicar licencias locales de Windows Server con Software Assurance para reducir costos.",
                        monthlySavingsUsd: Number((monthlyRateUsd * 0.40).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az vmss update --resource-group ${resource.resourceGroup} --name ${resource.name} --set virtualMachineProfile.licenseType=Windows_Server`,
                    });
                }

                if (osDiskType === "Premium_LRS" && (iops === null || iops < 250)) {
                    actions.push({
                        id: `rec-disk-${resource.name}`,
                        type: "os_disk",
                        title: "Optimización de Disco OS (Tier Down)",
                        description: "Discos Premium SSD con bajo nivel de IOPS. Degradar a Standard SSD.",
                        monthlySavingsUsd: Number((monthlyRateUsd * 0.15).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `# 1. Desasignar instancias del VMSS\naz vmss deallocate --resource-group ${resource.resourceGroup} --name ${resource.name}\n\n# 2. Actualizar el SKU del disco de cada instancia\nfor disk in $(az disk list --resource-group ${resource.resourceGroup} --query "[?contains(managedBy, '${resource.name}')].name" -o tsv); do\n  az disk update --resource-group ${resource.resourceGroup} --name $disk --sku StandardSSD_LRS\ndone\n\n# 3. Iniciar el Scale Set\naz vmss start --resource-group ${resource.resourceGroup} --name ${resource.name}`,
                    });
                }

                items.push({
                    id: resource.id,
                    name: resource.name,
                    type: resource.type,
                    region: resource.location || "unknown",
                    resourceGroup: resource.resourceGroup || "unknown",
                    subscriptionName: resolveSubscriptionName(resource.subscriptionId, subscriptionNameMap) || "unknown",
                    state: resolveState(resource, family),
                    sku: resolveSku(resource, family),
                    monthlyCostUsd: cost,
                    costDataAvailable,
                    forecastMonthEndUsd: forecastMonthEnd(cost, now, extractResourceCreatedAt((resource.properties || {}) as any, (resource as any).systemData)),
                    metricA: metricAValue === null || metricAValue === undefined ? "N/A" : String(metricAValue),
                    metricB: metricBValue === null || metricBValue === undefined ? "N/A" : String(metricBValue),
                    capacity,
                    minCapacity: capacity > 1 ? 1 : capacity,
                    maxCapacity: capacity * 2,
                    autoscaleMode,
                    orchestrationMode,
                    priority,
                    spotPercentage: priority === "Spot" ? 100 : 0,
                    licenseType,
                    ahubActive,
                    osDiskType,
                    zones: (resource as any)?.zones || props?.zones || [],
                    cpuAvg: cpuAvg ?? undefined,
                    cpuMax: cpuAvg ? Number((cpuAvg * 1.5).toFixed(1)) : undefined,
                    iops: iops ?? undefined,
                    potentialSavingUsd: Number(actions.reduce((acc, a) => acc + a.monthlySavingsUsd, 0).toFixed(2)),
                    remediationActions: actions,
                } as any);
                continue;
            }

            if (family === "functions") {
                const props = (resource.properties || {}) as Record<string, any>;
                const planInfo = resolveFunctionHostingPlan(resource);
                const runtimeInfo = resolveFunctionRuntime(resource);
                const executionCount = typeof metricAValue === "number" ? metricAValue : 0;
                const executionUnits = typeof metricBValue === "number" ? metricBValue : 0;
                const rawCost = costPerResource.get(resource.id) || 0;
                // Sin dato de Cost Management no se inventa importe (ver webapps).
                const costDataAvailable = rawCost > 0;
                const cost = rawCost;
                // El precio de lista se usa SÓLO para dimensionar los ahorros,
                // nunca como gasto mostrado.
                const monthlyRateUsd = rawCost > 0
                    ? monthlyRunRate(rawCost, now, extractResourceCreatedAt(props, (resource as any).systemData))
                    : estimateFunctionAppMonthlyCost(
                          planInfo.hostingPlanType,
                          planInfo.hostingPlan,
                          executionCount,
                          executionUnits
                      );
                const http5xx = typeof metrics["Http5xx"] === "number" ? metrics["Http5xx"] : 0;
                const http4xx = typeof metrics["Http4xx"] === "number" ? metrics["Http4xx"] : 0;
                const avgDuration = executionCount > 0 && executionUnits > 0 ? Number(((executionUnits / executionCount) * 1000).toFixed(0)) : 120;

                const isZombie = executionCount === 0 && planInfo.hostingPlanType === "dedicated";
                const isOverprovisioned = planInfo.hostingPlanType === "elastic_premium" && executionCount < 100000;

                const actions: any[] = [];

                if (isOverprovisioned) {
                    actions.push({
                        id: `rec-ep-downgrade-${resource.name}`,
                        type: "downgrade_consumption",
                        title: "Migración a Plan Consumption (Baja Carga Serverless)",
                        description: `Function App en ${planInfo.hostingPlan} con bajo volumen (${executionCount} llamadas/mes). Migrar a Consumption (Y1) para ahorrar ~95%.`,
                        monthlySavingsUsd: Number(Math.max(0, cost - 5).toFixed(2)) || 145.0,
                        risk: "low",
                        confidence: "high",
                        commandCli: `az functionapp plan create --name plan-${resource.name}-consumption --resource-group ${resource.resourceGroup} --consumption-only\naz functionapp update --name ${resource.name} --resource-group ${resource.resourceGroup} --plan plan-${resource.name}-consumption`,
                        commandTerraform: `resource "azurerm_service_plan" "consumption" {\n  name     = "plan-${resource.name}-consumption"\n  sku_name = "Y1"\n  os_type  = "${runtimeInfo.os}"\n}`,
                    });
                }

                if (isZombie && cost > 0) {
                    actions.push({
                        id: `rec-zombie-${resource.name}`,
                        type: "zombie_app",
                        title: "Detección de Function App Ociosa / Zombie",
                        description: "Function App en plan dedicado con 0 ejecuciones en los últimos 30 días. Detener o eliminar la aplicación y desaprovisionar el plan.",
                        monthlySavingsUsd: Number(cost.toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az functionapp stop --name ${resource.name} --resource-group ${resource.resourceGroup}`,
                    });
                }

                if (executionCount > 50000) {
                    actions.push({
                        id: `rec-sampling-${resource.name}`,
                        type: "telemetry_sampling",
                        title: "Control de Fuga en Logs & Telemetría (Sampling al 20%)",
                        description: "Habilitar muestreo adaptativo en Application Insights para reducir el volumen de ingesta de logs en un 80%.",
                        monthlySavingsUsd: 28.5,
                        risk: "low",
                        confidence: "high",
                        commandHostJson: `{\n  "logging": {\n    "applicationInsights": {\n      "samplingSettings": {\n        "isEnabled": true,\n        "maxTelemetryItemsPerSecond": 5\n      }\n    }\n  }\n}`,
                    });
                }

                items.push({
                    id: resource.id,
                    name: resource.name,
                    type: resource.type,
                    region: resource.location || "unknown",
                    resourceGroup: resource.resourceGroup || "unknown",
                    subscriptionName: resolveSubscriptionName(resource.subscriptionId, subscriptionNameMap) || "unknown",
                    state: resolveState(resource, family),
                    sku: planInfo.hostingPlan,
                    hostingPlan: planInfo.hostingPlan,
                    hostingPlanType: planInfo.hostingPlanType,
                    runtimeStack: runtimeInfo.runtimeStack,
                    os: runtimeInfo.os,
                    monthlyCostUsd: cost,
                    costDataAvailable,
                    forecastMonthEndUsd: forecastMonthEnd(cost, now, extractResourceCreatedAt((resource.properties || {}) as any, (resource as any).systemData)),
                    computeCostMonthlyUsd: Number((cost * 0.85).toFixed(2)),
                    storageCostMonthlyUsd: Number((cost * 0.10).toFixed(2)),
                    appInsightsCostMonthlyUsd: Number((cost * 0.05).toFixed(2)),
                    totalCostMonthlyUsd: cost,
                    executionCountMtd: executionCount,
                    executionUnitsGbs: executionUnits,
                    avgDurationMs: avgDuration,
                    errorRatePercent: executionCount > 0 ? Number(((http5xx / executionCount) * 100).toFixed(2)) : 0,
                    http5xxCount: http5xx,
                    http4xxCount: http4xx,
                    storageAccountName: `st${resource.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15)}`,
                    appInsightsName: `ai-${resource.name}`,
                    telemetryIngestionGbMonthly: Number((executionCount * 0.00002).toFixed(2)),
                    metricA: executionCount > 1000 ? `${(executionCount / 1000).toFixed(1)}k` : String(executionCount),
                    metricB: executionUnits > 1000 ? `${(executionUnits / 1000).toFixed(1)}k GB-s` : `${executionUnits} GB-s`,
                    isZombie,
                    isOverprovisioned,
                    potentialSavingUsd: Number(actions.reduce((acc, a) => acc + a.monthlySavingsUsd, 0).toFixed(2)),
                    remediationActions: actions,
                } as any);
                continue;
            }

            if (family === "vms") {
                const props = (resource.properties || {}) as Record<string, any>;
                const sku = resolveSku(resource, family);
                const specs = resolveVmSpecs(sku);
                const cost = costPerResource.get(resource.id) || 0;

                const powerStateRaw = String(props?.extended?.instanceView?.powerState?.code || props?.powerState || resolveState(resource, family)).toLowerCase();
                const powerState = powerStateRaw.includes("deallocated") ? "deallocated" : powerStateRaw.includes("stopped") ? "stopped" : "running";

                const osProfile = props?.osProfile || {};
                const isWindows = Boolean(osProfile?.windowsConfiguration || props?.storageProfile?.osDisk?.osType?.toLowerCase() === "windows");
                const os = isWindows ? "Windows" : "Linux";

                const osDisk = props?.storageProfile?.osDisk || {};
                const osDiskType = String(osDisk?.managedDisk?.storageAccountType || osDisk?.storageAccountType || "Premium_LRS");
                const osDiskSizeGb = Number(osDisk?.diskSizeGB || 128);

                const dataDisks = Array.isArray(props?.storageProfile?.dataDisks) ? props.storageProfile.dataDisks : [];
                const dataDisksCount = dataDisks.length;
                const dataDisksTotalGb = dataDisks.reduce((sum: number, d: any) => sum + (Number(d.diskSizeGB) || 0), 0);

                const licenseType = String(props?.licenseType || "None");
                const ahubActive = licenseType.toLowerCase().includes("windows") || licenseType.toLowerCase().includes("rhel") || licenseType.toLowerCase().includes("sles");
                const priority = String(props?.priority || "Regular");

                const hasPublicIp = Boolean(props?.publicIpAddress || props?.publicIps?.length || false);
                const publicIp = props?.publicIpAddress || (hasPublicIp ? "Asignada" : null);

                const cpuAvg = typeof metricAValue === "number" ? metricAValue : (powerState === "deallocated" ? 0 : 5.0);
                const cpuMax = cpuAvg ? Number((cpuAvg * 1.6).toFixed(1)) : 0;

                const availableBytes = typeof metricBValue === "number" ? metricBValue : null;
                const totalBytes = specs.ramGb * 1024 * 1024 * 1024;
                const memoryInUsePercent = availableBytes !== null && totalBytes > 0
                    ? Number((((totalBytes - availableBytes) / totalBytes) * 100).toFixed(1))
                    : (powerState === "deallocated" ? 0 : 25.0);
                const memoryAvailableGb = availableBytes !== null ? Number((availableBytes / (1024 * 1024 * 1024)).toFixed(1)) : Number((specs.ramGb * 0.75).toFixed(1));

                const iops = typeof metrics["Disk Read Operations/Sec"] === "number" || typeof metrics["Disk Write Operations/Sec"] === "number"
                    ? Number(((metrics["Disk Read Operations/Sec"] || 0) + (metrics["Disk Write Operations/Sec"] || 0)).toFixed(1))
                    : (powerState === "deallocated" ? 0 : 45);

                const uptimePercent = powerState === "running" ? 99 : 0;

                let storageCostMonthlyUsd = 0;
                if (osDiskType === "Premium_LRS") storageCostMonthlyUsd += (osDiskSizeGb / 128) * 18.00;
                else if (osDiskType === "StandardSSD_LRS") storageCostMonthlyUsd += (osDiskSizeGb / 128) * 9.60;
                else storageCostMonthlyUsd += (osDiskSizeGb / 128) * 4.80;
                storageCostMonthlyUsd += (dataDisksTotalGb / 128) * 7.50;
                storageCostMonthlyUsd = Number(storageCostMonthlyUsd.toFixed(2));

                const computeCostMonthlyUsd = powerState === "deallocated" ? 0 : Math.max(0, Number((cost - storageCostMonthlyUsd).toFixed(2)));
                const totalCostMonthlyUsd = powerState === "deallocated" ? storageCostMonthlyUsd : (cost > 0 ? cost : Number((computeCostMonthlyUsd + storageCostMonthlyUsd).toFixed(2)));

                const actions: any[] = [];

                if (powerState === "running" && cpuAvg < 10 && memoryInUsePercent < 30 && totalCostMonthlyUsd > 20) {
                    const targetSku = specs.vCpu > 2 ? "Standard_B2s" : "Standard_B1ms";
                    const savings = Number((computeCostMonthlyUsd * 0.70).toFixed(2)) || 24.80;
                    actions.push({
                        id: `rec-rs-${resource.name}`,
                        type: "rightsizing_sku",
                        title: `Rightsizing de SKU: Migrar a ${targetSku}`,
                        description: `CPU promedio de ${cpuAvg}% (<10%) y RAM en ${memoryInUsePercent}% en ${sku}. Migrar a ${targetSku} para ahorrar ~70% de cómputo.`,
                        targetSku,
                        monthlySavingsUsd: savings,
                        risk: "low",
                        confidence: "high",
                        commandCli: `az vm resize --resource-group ${resource.resourceGroup} --name ${resource.name} --size ${targetSku}`,
                        commandTerraform: `size = "${targetSku}"`,
                        commandPowerShell: `Update-AzVM -ResourceGroupName "${resource.resourceGroup}" -VM (Get-AzVM -ResourceGroupName "${resource.resourceGroup}" -Name "${resource.name}" | Set-AzVMOperatingSystem -Size "${targetSku}")`,
                    });
                }

                if (powerState === "deallocated" && osDiskType === "Premium_LRS") {
                    actions.push({
                        id: `rec-disk-${resource.name}`,
                        type: "deallocated_disk",
                        title: "Fuga de Almacenamiento en VM Desasignada (Deallocated Waste)",
                        description: `VM apagada con Disco OS Premium SSD (${osDiskSizeGb}GB). Degradar a Standard HDD (Standard_LRS) mientras permanezca inactiva.`,
                        monthlySavingsUsd: Number((storageCostMonthlyUsd * 0.65).toFixed(2)) || 14.00,
                        risk: "low",
                        confidence: "high",
                        commandCli: `OS_DISK=$(az vm show -g ${resource.resourceGroup} -n ${resource.name} --query "storageProfile.osDisk.managedDisk.id" -o tsv)\naz disk update --ids $OS_DISK --sku Standard_LRS`,
                        commandTerraform: `os_disk {\n  storage_account_type = "Standard_LRS"\n}`,
                        commandPowerShell: `$disk = Get-AzDisk -ResourceGroupName "${resource.resourceGroup}" -DiskName "${resource.name}_osdisk"\n$disk.Sku = [Microsoft.Azure.Management.Compute.Models.DiskSku]::new("Standard_LRS")\nUpdate-AzDisk -ResourceGroupName "${resource.resourceGroup}" -DiskName "${resource.name}_osdisk" -Disk $disk`,
                    });
                }

                const rgLower = (resource.resourceGroup || "").toLowerCase();
                if (powerState === "running" && (rgLower.includes("dev") || rgLower.includes("test") || rgLower.includes("qa") || rgLower.includes("staging")) && computeCostMonthlyUsd > 30) {
                    actions.push({
                        id: `rec-sched-${resource.name}`,
                        type: "power_schedule",
                        title: "Programación de Apagado (Dev/Test Schedule 8x5)",
                        description: `VM en ambiente no productivo (${resource.resourceGroup}) corriendo 24/7. Configurar horario de apagado fuera de jornada para ahorrar 65% de cómputo.`,
                        monthlySavingsUsd: Number((computeCostMonthlyUsd * 0.65).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az vm auto-shutdown --resource-group ${resource.resourceGroup} --name ${resource.name} --time 1900 --email-alert false`,
                        commandTerraform: `resource "azurerm_dev_test_global_vm_shutdown_schedule" "schedule" {\n  virtual_machine_id = azurerm_virtual_machine.${resource.name}.id\n  enabled = true\n  daily_recurrence_time = "1900"\n  timezone = "UTC"\n}`,
                    });
                }

                if (os === "Windows" && !ahubActive && computeCostMonthlyUsd > 40) {
                    actions.push({
                        id: `rec-ahub-${resource.name}`,
                        type: "ahub",
                        title: "Activación de Azure Hybrid Benefit (AHUB Windows Server)",
                        description: "Aplicar licencia existente de Windows Server con Software Assurance para reducir el costo de cómputo en 40%.",
                        monthlySavingsUsd: Number((computeCostMonthlyUsd * 0.40).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az vm update --resource-group ${resource.resourceGroup} --name ${resource.name} --set licenseType=Windows_Server`,
                        commandTerraform: `license_type = "Windows_Server"`,
                    });
                }

                items.push({
                    id: resource.id,
                    name: resource.name,
                    type: resource.type,
                    region: resource.location || "unknown",
                    resourceGroup: resource.resourceGroup || "unknown",
                    subscriptionName: resolveSubscriptionName(resource.subscriptionId, subscriptionNameMap) || "unknown",
                    state: powerState,
                    powerState,
                    sku,
                    vCpu: specs.vCpu,
                    ramGb: specs.ramGb,
                    os,
                    osDiskType,
                    osDiskSizeGb,
                    dataDisksCount,
                    dataDisksTotalGb,
                    licenseType,
                    ahubActive,
                    priority,
                    publicIp,
                    hasPublicIp,
                    cpuAvg,
                    cpuMax,
                    memoryInUsePercent,
                    memoryTotalGb: specs.ramGb,
                    memoryAvailableGb,
                    uptimePercent,
                    iops,
                    monthlyCostUsd: totalCostMonthlyUsd,
                    computeCostMonthlyUsd,
                    storageCostMonthlyUsd,
                    totalCostMonthlyUsd,
                    isZombie: powerState === "deallocated" && totalCostMonthlyUsd > 10,
                    potentialSavingUsd: Number(actions.reduce((acc, a) => acc + a.monthlySavingsUsd, 0).toFixed(2)),
                    remediationActions: actions,
                    metricA: `${cpuAvg}% (P95: ${cpuMax}%)`,
                    metricB: `${memoryInUsePercent}% RAM`,
                } as any);
                continue;
            }

            if (family === "aro") {
                const props = (resource.properties || {}) as Record<string, any>;
                const masterProfile = {
                    vmSize: String(props?.masterProfile?.vmSize || "Standard_D8s_v5"),
                    count: 3, // fijo por diseño de OpenShift (quorum etcd)
                };
                const rawWorkerProfiles: any[] = Array.isArray(props?.workerProfiles) ? props.workerProfiles : [];
                const workerProfiles = rawWorkerProfiles.map((wp) => ({
                    name: String(wp?.name || "worker"),
                    vmSize: String(wp?.vmSize || "Standard_D4s_v5"),
                    count: Number(wp?.count) || 3,
                    diskSizeGb: typeof wp?.diskSizeGB === "number" ? wp.diskSizeGB : undefined,
                    autoscalerEnabled: false, // Resource Graph no expone MachineAutoscaler (recurso de la API de OpenShift, no ARM)
                }));
                if (workerProfiles.length === 0) {
                    workerProfiles.push({ name: "worker", vmSize: "Standard_D4s_v5", count: 3, diskSizeGb: undefined, autoscalerEnabled: false });
                }
                const totalWorkerCount = workerProfiles.reduce((s, w) => s + w.count, 0);
                const openshiftVersion = String(props?.clusterProfile?.version || "unknown");
                const apiVisibility = String(props?.apiserverProfile?.visibility || "Public");
                const ingressVisibility = String(props?.ingressProfiles?.[0]?.visibility || "Public");
                const managedResourceGroupId = String(props?.clusterProfile?.resourceGroupId || "");
                const managedResourceGroup = extractResourceGroupName(managedResourceGroupId);

                const billedCost = costPerResource.get(resource.id) || 0;
                const costBreakdown = calculateAroCostBreakdown(billedCost, masterProfile, workerProfiles);
                const orphanPvc = await fetchOrphanPvcDisks(tenantId, resource.subscriptionId, managedResourceGroup);

                let cpuAvg = typeof metricAValue === "number" ? metricAValue : null;
                let memoryAvgPercent = typeof metricBValue === "number" ? metricBValue : null;

                // Si no hay métricas desde Container Insights / OpenShift, consultar las VMs en el Managed RG
                if (cpuAvg === null && managedResourceGroup) {
                    const vmMetrics = await fetchAroManagedRgVmMetrics(
                        tenantId,
                        resource.subscriptionId,
                        managedResourceGroup,
                        credential
                    );
                    if (vmMetrics.cpuAvg !== null) cpuAvg = vmMetrics.cpuAvg;
                    if (vmMetrics.memoryAvgPercent !== null) memoryAvgPercent = vmMetrics.memoryAvgPercent;
                }

                const metricsAvailable = cpuAvg !== null || memoryAvgPercent !== null;

                const rgLower = (resource.resourceGroup || "").toLowerCase();
                const nameLower = resource.name.toLowerCase();
                const isDevTestCandidate = /dev|test|qa|staging|sandbox/.test(rgLower) || /dev|test|qa|staging|sandbox/.test(nameLower);

                const actions = evaluateAroRemediations({
                    name: resource.name,
                    resourceGroup: resource.resourceGroup || "unknown",
                    subscriptionId: resource.subscriptionId ?? "unknown",
                    masterProfile,
                    workerProfiles,
                    totalWorkerCount,
                    costBreakdown,
                    cpuAvg,
                    memoryAvgPercent,
                    orphanPvcCount: orphanPvc.count,
                    orphanPvcMonthlyCostUsd: orphanPvc.monthlyCostUsd,
                    managedResourceGroup: managedResourceGroup ?? undefined,
                });

                const openShiftLifecycleStatus = getOpenShiftLifecycleStatus(openshiftVersion);
                const managedRgResources = getManagedRgResourceList(
                    managedResourceGroup ?? resource.resourceGroup ?? "unknown-rg",
                    resource.name,
                    resource.location || "eastus",
                    masterProfile.vmSize,
                    workerProfiles[0]?.vmSize,
                    totalWorkerCount
                );

                items.push({
                    id: resource.id,
                    name: resource.name,
                    type: resource.type,
                    region: resource.location || "unknown",
                    resourceGroup: resource.resourceGroup || "unknown",
                    subscriptionName: resolveSubscriptionName(resource.subscriptionId, subscriptionNameMap) || "unknown",
                    state: resolveState(resource, family),
                    sku: resolveSku(resource, family),
                    monthlyCostUsd: costBreakdown.totalCostMonthlyUsd,
                    openshiftVersion,
                    openShiftLifecycleStatus,
                    apiVisibility,
                    ingressVisibility,
                    provisioningState: String(props?.provisioningState || resource.provisioningState || "unknown"),
                    managedResourceGroup: managedResourceGroup || undefined,
                    managedRgResources,
                    masterProfile,
                    workerProfiles,
                    totalWorkerCount,
                    autoscalerActive: workerProfiles.some((w) => w.autoscalerEnabled),
                    orphanPvcCount: orphanPvc.count,
                    orphanPvcMonthlyCostUsd: orphanPvc.monthlyCostUsd,
                    cpuAvg,
                    cpuMax: cpuAvg !== null ? Number((cpuAvg * 1.4).toFixed(1)) : null,
                    memoryAvgPercent,
                    metricsAvailable,
                    costBreakdown,
                    isDevTestCandidate,
                    potentialSavingUsd: Number(actions.reduce((acc, a) => acc + a.monthlySavingsUsd, 0).toFixed(2)),
                    remediationActions: actions,
                    metricA: cpuAvg === null ? "N/D" : `${cpuAvg}%`,
                    metricB: memoryAvgPercent === null ? "N/D" : `${memoryAvgPercent}%`,
                } as any);
                continue;
            }
            items.push({
                id: resource.id,
                name: resource.name,
                type: resource.type,
                region: resource.location || "unknown",
                resourceGroup: resource.resourceGroup || "unknown",
                subscriptionName: resolveSubscriptionName(resource.subscriptionId, subscriptionNameMap) || "unknown",
                state: resolveState(resource, family),
                sku: resolveSku(resource, family),
                monthlyCostUsd: costPerResource.get(resource.id) || 0,
                metricA: metricAValue === null || metricAValue === undefined ? "N/A" : String(metricAValue),
                metricB: metricBValue === null || metricBValue === undefined ? "N/A" : String(metricBValue),
            });
        }

        let advisorCount = 0;
        if (family === "vms") {
            const token = await credential.getToken("https://management.azure.com/.default");
            if (token?.token) {
                for (const subId of subscriptionIds) {
                    const url = `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/recommendations?api-version=2023-01-01&$filter=Category eq 'Cost'`;
                    const response = await fetch(url, {
                        headers: { Authorization: `Bearer ${token.token}` },
                        cache: "no-store",
                    });
                    if (!response.ok) continue;
                    const payload: any = await response.json();
                    advisorCount += Array.isArray(payload.value) ? payload.value.length : 0;
                }
            }
        }

        const payload: ComputeWorkloadApiResponse = {
            ok: true,
            mock: false,
            resourceExists: true,
            dataAvailable,
            costIssues: costErrors.map((e) => {
                const idx = e.indexOf(": ");
                return { subscriptionId: e.slice(0, idx), reason: e.slice(idx + 2) };
            }),
            data: {
                summary: {
                    resourceCount: resources.length,
                    totalMonthlyCostUsd: Number(
                        items.reduce((sum, item) => sum + item.monthlyCostUsd, 0).toFixed(2),
                    ),
                    advisorRecommendations: advisorCount,
                },
                items,
            },
        };
        await writeWorkloadsCache(cacheKey, payload);
        return NextResponse.json(payload);
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        return NextResponse.json({
            ok: true,
            mock: false,
            resourceExists: false,
            dataAvailable: false,
            message: "No se pudo consultar información de cómputo en este momento.",
            data: { summary: { resourceCount: 0, totalMonthlyCostUsd: 0 }, items: [] },
            errors: [{ code: "COMPUTE_WORKLOADS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
        });
    }
}
