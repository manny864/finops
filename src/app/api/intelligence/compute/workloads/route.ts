import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { isMockTenant } from "@/lib/mockData";
import { redis } from "@/lib/redis";
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

function summarizeNumeric(values: number[]): string {
    if (values.length === 0) return "N/A";
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return Number(avg.toFixed(2)).toString();
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
): Promise<Record<string, string>> {
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
        const result: Record<string, string> = {};
        for (const metric of payload.value || []) {
            const name = String(metric?.name?.value || "");
            const points = (metric.timeseries?.[0]?.data || []) as Array<Record<string, number>>;
            const numbers = points
                .flatMap((p) => [p.average, p.maximum, p.total])
                .filter((v) => typeof v === "number") as number[];
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

        const costTypes = family === "webapps" ? ["microsoft.web/serverfarms"] : FAMILY_TYPES[family];
        const { costByType, dataAvailable } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            costTypes,
        );
        const costPerResource = distributeCostPerResource(resources, costByType);

        const items: ComputeWorkloadItemBase[] = [];
        const topResources = resources.slice(0, 20);
        for (const resource of topResources) {
            const metrics = await getMetricsSummary(credential, resource.id, FAMILY_METRICS[family]);
            const metricValues = Object.values(metrics);
            items.push({
                id: resource.id,
                name: resource.name,
                type: resource.type,
                region: resource.location || "unknown",
                state: resolveState(resource, family),
                sku: resolveSku(resource, family),
                monthlyCostUsd: costPerResource.get(resource.id) || 0,
                metricA: metricValues[0] || "N/A",
                metricB: metricValues[1] || "N/A",
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
