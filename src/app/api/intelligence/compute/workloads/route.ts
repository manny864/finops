import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { isMockTenant } from "@/lib/mockData";
import { redis } from "@/lib/redis";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import {
    distributeCostPerResource,
    getMonthlyCostByType,
    listResourcesByTypes,
    type ArgResourceRow,
} from "@/app/api/intelligence/databases/diagnosticsShared";
import type {
    ComputeFamily,
    ComputeWorkloadApiResponse,
    ComputeWorkloadItemBase,
} from "@/lib/computeWorkloadTypes";

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

function toLowerSafe(value: unknown): string {
    return String(value || "").toLowerCase();
}

function summarizeNumeric(values: number[]): number | null {
    if (values.length === 0) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return Number(avg.toFixed(4));
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
    if (resource.skuName && resource.skuName.trim()) return resource.skuName;
    const properties = (resource.properties || {}) as Record<string, any>;

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

async function getMetricsSummary(
    credential: any,
    resourceId: string,
    metricNames: string[],
): Promise<Record<string, number | null>> {
    try {
        const token = await credential.getToken("https://management.azure.com/.default");
        if (!token?.token) return {};
        const now = new Date();
        const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const url = new URL(`https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics`);
        url.searchParams.set("api-version", "2018-01-01");
        url.searchParams.set("metricnames", metricNames.join(","));
        url.searchParams.set("timespan", `${start.toISOString()}/${now.toISOString()}`);
        url.searchParams.set("interval", "PT1H");
        url.searchParams.set("aggregation", "Average,Maximum,Total");

        const response = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token.token}` },
            cache: "no-store",
        });
        if (!response.ok) return {};
        const payload: any = await response.json();
        const result: Record<string, number | null> = {};
        for (const metric of payload.value || []) {
            const name = String(metric?.name?.value || "");
            const points = (metric.timeseries?.[0]?.data || []) as Array<Record<string, number>>;
            const numbers = points
                .map((p) => {
                    if (typeof p.average === "number") return p.average;
                    if (typeof p.maximum === "number") return p.maximum;
                    if (typeof p.total === "number") return p.total;
                    return null;
                })
                .filter((v): v is number => typeof v === "number");
            result[name] = summarizeNumeric(numbers);
        }
        return result;
    } catch {
        return {};
    }
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
        if (family === "webapps") {
            const plans = resources.filter((r) => r.type === "microsoft.web/serverfarms");
            const sites = resources.filter(
                (r) =>
                    r.type === "microsoft.web/sites" &&
                    !toLowerSafe(r.kind).includes("functionapp"),
            );
            resources = [...plans, ...sites];
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

        const primaryCostTypes = family === "webapps" ? ["Microsoft.Web/serverfarms"] : FAMILY_COST_TYPES[family];
        let { costByType, dataAvailable } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            primaryCostTypes,
        );

        // Web Apps can report cost either at plan level (serverfarms) or site level.
        // Keep plan-first attribution, but fallback to full web types when plan-only returns zero.
        if (family === "webapps") {
            const planOnlyTotal = sumCostMap(costByType);
            if (planOnlyTotal <= 0) {
                const fallback = await getMonthlyCostByType(
                    tenantId,
                    credential,
                    subscriptionIds,
                    FAMILY_COST_TYPES.webapps,
                );
                costByType = fallback.costByType;
                dataAvailable = dataAvailable && fallback.dataAvailable;
            }
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

        const costPerResource = distributeCostPerResource(resources, costByType);
        const subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);

        const items: ComputeWorkloadItemBase[] = [];
        const topResources = resources.slice(0, 20);
        for (const resource of topResources) {
            const metrics = await getMetricsSummary(credential, resource.id, FAMILY_METRICS[family]);
            const metricAName = FAMILY_METRICS[family][0];
            const metricBName = FAMILY_METRICS[family][1];
            const metricAValue = metrics[metricAName];
            const metricBValue = metrics[metricBName];

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
                const actions: any[] = [];

                if (cpuAvg !== null && cpuAvg < 15 && cost > 50) {
                    actions.push({
                        id: `rec-rs-${resource.name}`,
                        type: "rightsizing",
                        title: "Rightsizing de SKU (Sobredimensionado)",
                        description: `CPU promedio de ${cpuAvg}% (<15%). Sugerido reducir tamaño de SKU para optimizar costos.`,
                        monthlySavingsUsd: Number((cost * 0.25).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `az vmss update --resource-group ${resource.resourceGroup} --name ${resource.name} --set sku.name=Standard_D2ads_v5\naz vmss update-instances --resource-group ${resource.resourceGroup} --name ${resource.name} --instance-ids '*'`,
                        commandTerraform: `# En módulo VMSS\nsku_name = "Standard_D2ads_v5"`,
                    });
                }

                if (capacity > 1 && autoscaleMode === "manual" && cost > 40) {
                    actions.push({
                        id: `rec-auto-${resource.name}`,
                        type: "autoscale",
                        title: "Activar Autoscale por Calendario (Scale-to-Min)",
                        description: `Capacidad fija (${capacity} VMs) sin autoscale. Reducir instancias fuera de horario laboral.`,
                        monthlySavingsUsd: Number((cost * 0.35).toFixed(2)),
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
                        monthlySavingsUsd: Number((cost * 0.65).toFixed(2)),
                        risk: "low",
                        confidence: "high",
                        commandCli: `# Opción A: Actualizar prioridad Spot con billingProfile estructurado en JSON\naz vmss update --resource-group ${resource.resourceGroup} --name ${resource.name} --set virtualMachineProfile.priority=Spot virtualMachineProfile.evictionPolicy=Deallocate virtualMachineProfile.billingProfile='{"maxPrice":-1}'\n\n# Opción B (Si el modo de orquestación no admite mutar prioridad en caliente):\n# Desplegar un nuevo Scale Set Spot y drenar tráfico hacia el nuevo pool:\n# az vmss create --resource-group ${resource.resourceGroup} --name ${resource.name}-spot --priority Spot --eviction-policy Deallocate --max-price -1`,
                    });
                }

                if (licenseType === "None" && cost > 60) {
                    actions.push({
                        id: `rec-ahub-${resource.name}`,
                        type: "ahub",
                        title: "Activar Azure Hybrid Benefit (AHUB)",
                        description: "Aplicar licencias locales de Windows Server con Software Assurance para reducir costos.",
                        monthlySavingsUsd: Number((cost * 0.40).toFixed(2)),
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
                        monthlySavingsUsd: Number((cost * 0.15).toFixed(2)),
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
