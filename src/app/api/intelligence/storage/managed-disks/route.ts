import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getSubscriptionsForTenant } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool from "@/modules/storage/db";
import {
    fetchAllManagedDisksFromARG,
    fetchDiskMetricsBatch,
    extractVmNameFromManagedBy,
    detectDiskRedundancy,
    detectDiskEnvironment,
    resolveDiskTierCode,
    estimateMonthlyDiskCost,
    buildDiskRemediations,
    computeDisksKpis,
    computeSkuDistribution,
} from "@/services/managedDisks.service";
import { ManagedDiskDetail, ManagedDisksResponse, DiskSkuTier } from "@/types/managedDisk.types";

function getMockManagedDisksPayload(multiplier: number = 1): ManagedDisksResponse {
    const rawDisks: ManagedDiskDetail[] = [
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.Compute/disks/cscs-disk-prod-db-data",
            name: "cscs-disk-prod-db-data",
            resourceGroup: "rg-finops-prod",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "Premium_LRS",
            skuTier: "Premium",
            tierName: "P20",
            diskSizeGB: 512,
            diskSizeBytes: 512 * 1024 * 1024 * 1024,
            diskState: "Attached",
            diskType: "DataDisk",
            redundancyType: "LRS",
            managedByVmName: "vm-finops-sql-prod",
            managedByVmId: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.Compute/virtualMachines/vm-finops-sql-prod",
            vmPowerState: "running",
            osType: "Linux",
            encryptionType: "EncryptionAtRestWithPlatformKey",
            burstingEnabled: true,
            monthlyCostUsd: parseFloat((73.22 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((73.22 * multiplier).toFixed(2)),
            costPerGb: 0.143,
            environmentTag: "prod",
            tags: { env: "prod", role: "database-primary" },
            metrics: {
                avgIops: 1420,
                peakIops: 3600,
                avgThroughputMbps: 48.5,
                peakThroughputMbps: 125.0,
                readOpsCount: 65000000,
                writeOpsCount: 57000000,
                isInactive: false,
                telemetryPeriodDays: 14,
                lastTelemetryDate: new Date().toISOString(),
            },
            recommendations: [],
            isZombieCandidate: false,
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.Compute/disks/cscs-disk-prod-app-os",
            name: "cscs-disk-prod-app-os",
            resourceGroup: "rg-finops-prod",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "Premium_LRS",
            skuTier: "Premium",
            tierName: "P10",
            diskSizeGB: 128,
            diskSizeBytes: 128 * 1024 * 1024 * 1024,
            diskState: "Attached",
            diskType: "OSDisk",
            redundancyType: "LRS",
            managedByVmName: "vm-finops-app-prod",
            managedByVmId: "/subscriptions/demo-sub-01/resourceGroups/rg-finops-prod/providers/Microsoft.Compute/virtualMachines/vm-finops-app-prod",
            vmPowerState: "running",
            osType: "Linux",
            encryptionType: "EncryptionAtRestWithPlatformKey",
            burstingEnabled: true,
            monthlyCostUsd: parseFloat((19.71 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((19.71 * multiplier).toFixed(2)),
            costPerGb: 0.154,
            environmentTag: "prod",
            tags: { env: "prod", role: "web-app" },
            metrics: {
                avgIops: 240,
                peakIops: 820,
                avgThroughputMbps: 12.2,
                peakThroughputMbps: 45.0,
                readOpsCount: 12000000,
                writeOpsCount: 8500000,
                isInactive: false,
                telemetryPeriodDays: 14,
                lastTelemetryDate: new Date().toISOString(),
            },
            recommendations: [],
            isZombieCandidate: false,
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-dev-sandbox/providers/Microsoft.Compute/disks/cscs-disk-dev-backend-data",
            name: "cscs-disk-dev-backend-data",
            resourceGroup: "rg-dev-sandbox",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "Premium_LRS",
            skuTier: "Premium",
            tierName: "P10",
            diskSizeGB: 128,
            diskSizeBytes: 128 * 1024 * 1024 * 1024,
            diskState: "Attached",
            diskType: "DataDisk",
            redundancyType: "LRS",
            managedByVmName: "vm-dev-backend-01",
            managedByVmId: "/subscriptions/demo-sub-01/resourceGroups/rg-dev-sandbox/providers/Microsoft.Compute/virtualMachines/vm-dev-backend-01",
            vmPowerState: "running",
            osType: "Linux",
            encryptionType: "EncryptionAtRestWithPlatformKey",
            burstingEnabled: false,
            monthlyCostUsd: parseFloat((19.71 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((19.71 * multiplier).toFixed(2)),
            costPerGb: 0.154,
            environmentTag: "dev",
            tags: { env: "dev", team: "backend" },
            metrics: {
                avgIops: 14,
                peakIops: 42,
                avgThroughputMbps: 0.8,
                peakThroughputMbps: 3.2,
                readOpsCount: 450000,
                writeOpsCount: 220000,
                isInactive: false,
                telemetryPeriodDays: 14,
                lastTelemetryDate: new Date().toISOString(),
            },
            recommendations: [],
            isZombieCandidate: false,
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-qa-validation/providers/Microsoft.Compute/disks/cscs-disk-qa-api-data",
            name: "cscs-disk-qa-api-data",
            resourceGroup: "rg-qa-validation",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "Premium_LRS",
            skuTier: "Premium",
            tierName: "P15",
            diskSizeGB: 256,
            diskSizeBytes: 256 * 1024 * 1024 * 1024,
            diskState: "Attached",
            diskType: "DataDisk",
            redundancyType: "LRS",
            managedByVmName: "vm-qa-api-01",
            managedByVmId: "/subscriptions/demo-sub-01/resourceGroups/rg-qa-validation/providers/Microsoft.Compute/virtualMachines/vm-qa-api-01",
            vmPowerState: "running",
            osType: "Linux",
            encryptionType: "EncryptionAtRestWithPlatformKey",
            burstingEnabled: false,
            monthlyCostUsd: parseFloat((38.02 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((38.02 * multiplier).toFixed(2)),
            costPerGb: 0.148,
            environmentTag: "qa",
            tags: { env: "qa", team: "qa-team" },
            metrics: {
                avgIops: 8,
                peakIops: 25,
                avgThroughputMbps: 0.3,
                peakThroughputMbps: 1.5,
                readOpsCount: 180000,
                writeOpsCount: 95000,
                isInactive: false,
                telemetryPeriodDays: 14,
                lastTelemetryDate: new Date().toISOString(),
            },
            recommendations: [],
            isZombieCandidate: false,
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-orphan-storage/providers/Microsoft.Compute/disks/cscs-disk-orphan-legacy-backup",
            name: "cscs-disk-orphan-legacy-backup",
            resourceGroup: "rg-orphan-storage",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "StandardSSD_LRS",
            skuTier: "Standard",
            tierName: "E20",
            diskSizeGB: 512,
            diskSizeBytes: 512 * 1024 * 1024 * 1024,
            diskState: "Unattached",
            diskType: "DataDisk",
            redundancyType: "LRS",
            managedByVmName: null,
            managedByVmId: null,
            vmPowerState: undefined,
            osType: null,
            encryptionType: "EncryptionAtRestWithPlatformKey",
            burstingEnabled: false,
            monthlyCostUsd: parseFloat((38.40 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((38.40 * multiplier).toFixed(2)),
            costPerGb: 0.075,
            environmentTag: "unknown",
            tags: { env: "legacy", status: "unattached" },
            metrics: {
                avgIops: 0,
                peakIops: 0,
                avgThroughputMbps: 0,
                peakThroughputMbps: 0,
                readOpsCount: 0,
                writeOpsCount: 0,
                isInactive: true,
                telemetryPeriodDays: 14,
                lastTelemetryDate: new Date().toISOString(),
            },
            recommendations: [],
            isZombieCandidate: true,
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-orphan-storage/providers/Microsoft.Compute/disks/cscs-disk-orphan-temp-scratch",
            name: "cscs-disk-orphan-temp-scratch",
            resourceGroup: "rg-orphan-storage",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "Premium_LRS",
            skuTier: "Premium",
            tierName: "P10",
            diskSizeGB: 128,
            diskSizeBytes: 128 * 1024 * 1024 * 1024,
            diskState: "Unattached",
            diskType: "DataDisk",
            redundancyType: "LRS",
            managedByVmName: null,
            managedByVmId: null,
            vmPowerState: undefined,
            osType: null,
            encryptionType: "EncryptionAtRestWithPlatformKey",
            burstingEnabled: false,
            monthlyCostUsd: parseFloat((19.71 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((19.71 * multiplier).toFixed(2)),
            costPerGb: 0.154,
            environmentTag: "unknown",
            tags: { purpose: "scratch" },
            metrics: {
                avgIops: 0,
                peakIops: 0,
                avgThroughputMbps: 0,
                peakThroughputMbps: 0,
                readOpsCount: 0,
                writeOpsCount: 0,
                isInactive: true,
                telemetryPeriodDays: 14,
                lastTelemetryDate: new Date().toISOString(),
            },
            recommendations: [],
            isZombieCandidate: true,
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-analytics-batch/providers/Microsoft.Compute/disks/cscs-disk-stopped-analytics-data",
            name: "cscs-disk-stopped-analytics-data",
            resourceGroup: "rg-analytics-batch",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "Premium_LRS",
            skuTier: "Premium",
            tierName: "P30",
            diskSizeGB: 1024,
            diskSizeBytes: 1024 * 1024 * 1024 * 1024,
            diskState: "Attached",
            diskType: "DataDisk",
            redundancyType: "LRS",
            managedByVmName: "vm-analytics-batch",
            managedByVmId: "/subscriptions/demo-sub-01/resourceGroups/rg-analytics-batch/providers/Microsoft.Compute/virtualMachines/vm-analytics-batch",
            vmPowerState: "deallocated",
            osType: "Linux",
            encryptionType: "EncryptionAtRestWithPlatformKey",
            burstingEnabled: true,
            monthlyCostUsd: parseFloat((135.17 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((135.17 * multiplier).toFixed(2)),
            costPerGb: 0.132,
            environmentTag: "staging",
            tags: { workload: "batch-reporting" },
            metrics: {
                avgIops: 0,
                peakIops: 0,
                avgThroughputMbps: 0,
                peakThroughputMbps: 0,
                readOpsCount: 0,
                writeOpsCount: 0,
                isInactive: true,
                telemetryPeriodDays: 14,
                lastTelemetryDate: new Date().toISOString(),
            },
            recommendations: [],
            isZombieCandidate: false,
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-staging-core/providers/Microsoft.Compute/disks/cscs-disk-stg-worker-os",
            name: "cscs-disk-stg-worker-os",
            resourceGroup: "rg-staging-core",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "StandardSSD_LRS",
            skuTier: "Standard",
            tierName: "E10",
            diskSizeGB: 128,
            diskSizeBytes: 128 * 1024 * 1024 * 1024,
            diskState: "Attached",
            diskType: "OSDisk",
            redundancyType: "LRS",
            managedByVmName: "vm-stg-worker-01",
            managedByVmId: "/subscriptions/demo-sub-01/resourceGroups/rg-staging-core/providers/Microsoft.Compute/virtualMachines/vm-stg-worker-01",
            vmPowerState: "running",
            osType: "Linux",
            encryptionType: "EncryptionAtRestWithPlatformKey",
            burstingEnabled: false,
            monthlyCostUsd: parseFloat((9.60 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((9.60 * multiplier).toFixed(2)),
            costPerGb: 0.075,
            environmentTag: "staging",
            tags: { env: "staging" },
            metrics: {
                avgIops: 85,
                peakIops: 210,
                avgThroughputMbps: 4.2,
                peakThroughputMbps: 18.0,
                readOpsCount: 4200000,
                writeOpsCount: 3100000,
                isInactive: false,
                telemetryPeriodDays: 14,
                lastTelemetryDate: new Date().toISOString(),
            },
            recommendations: [],
            isZombieCandidate: false,
        },
    ];

    const remediations = buildDiskRemediations(rawDisks);
    const disksWithRecs = rawDisks.map((d) => ({
        ...d,
        recommendations: remediations.filter((r) => r.diskId === d.id),
    }));

    const kpis = computeDisksKpis(disksWithRecs, remediations);
    const skuDistribution = computeSkuDistribution(disksWithRecs);

    return {
        success: true,
        mock: true,
        kpis,
        disks: disksWithRecs,
        skuDistribution,
        remediations,
    };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        const isMockParam = searchParams.get("mock") === "true";
        if (isMockTenant(tenantId) || tenantId.startsWith("mock-") || isMockParam) {
            return NextResponse.json(getMockManagedDisksPayload(1));
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        // Live Tenant Real Data Path
        const cacheKey = `managed-disks:v1:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(
            cacheKey,
            async () => {
                const subs = await getSubscriptionsForTenant(tenantId);
                if (!subs || subs.length === 0) {
                    return getMockManagedDisksPayload(1);
                }

                const rawDisks = await fetchAllManagedDisksFromARG(tenantId, subs);
                if (!rawDisks || rawDisks.length === 0) {
                    const emptyKpis = computeDisksKpis([], []);
                    return {
                        success: true,
                        mock: false,
                        kpis: emptyKpis,
                        disks: [],
                        skuDistribution: [],
                        remediations: [],
                    };
                }

                // Query DB Cost Attribution for Disks
                const [costRows]: any = await pool.query(
                    `SELECT resource_id, LOWER(resource_group) AS rg, SUM(cost_usd) AS cost
                     FROM CostCategorySnapshots
                     WHERE tenant_id = ?
                       AND LOWER(resource_type) = 'microsoft.compute/disks'
                       AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                     GROUP BY resource_id, LOWER(resource_group)`,
                    [tenantId]
                ).catch(() => [[], []]);

                const costByResourceId = new Map<string, number>();
                const costByRg = new Map<string, number>();
                for (const row of costRows || []) {
                    const cost = parseFloat(row.cost) || 0;
                    if (row.resource_id) costByResourceId.set(String(row.resource_id).toLowerCase(), cost);
                    if (row.rg) costByRg.set(row.rg, (costByRg.get(row.rg) || 0) + cost);
                }

                // Query Live Monitor Metrics Batch
                const metricsMap = await fetchDiskMetricsBatch(tenantId, rawDisks);

                const mappedDisks: ManagedDiskDetail[] = rawDisks.map((d: any) => {
                    const id = String(d.id || "");
                    const name = String(d.name || "");
                    const rg = String(d.resourceGroup || "");
                    const subId = String(d.subscriptionId || "");
                    const location = String(d.location || "eastus");
                    const skuName = String(d.sku?.name || "Premium_LRS") as DiskSkuTier;
                    const skuTier = String(d.sku?.tier || (skuName.includes("Premium") ? "Premium" : "Standard"));
                    const sizeGb = Number(d.properties?.diskSizeGB || 128);
                    const sizeBytes = Number(d.properties?.diskSizeBytes || sizeGb * 1024 * 1024 * 1024);
                    const diskState = (d.properties?.diskState || "Attached") as "Attached" | "Unattached" | "Reserved";
                    const diskType = d.properties?.osType ? "OSDisk" : "DataDisk";
                    const redundancy = detectDiskRedundancy(skuName);
                    const { vmName, vmId } = extractVmNameFromManagedBy(d.managedBy);
                    const osType = d.properties?.osType || null;
                    const encryptionType = d.properties?.encryption?.type || "EncryptionAtRestWithPlatformKey";
                    const bursting = Boolean(d.properties?.burstingEnabled);
                    const tierName = d.properties?.tier || resolveDiskTierCode(skuName, sizeGb);
                    const env = detectDiskEnvironment(d.tags, name, rg);

                    const normId = id.toLowerCase();
                    const directCost = costByResourceId.get(normId) || 0;
                    const groupCost = costByRg.get(rg.toLowerCase()) || 0;
                    const estimatedCost = estimateMonthlyDiskCost(skuName, sizeGb);
                    const finalCost = directCost > 0 ? directCost : (groupCost > 0 ? groupCost : estimatedCost);

                    const metrics = metricsMap.get(id) || {
                        avgIops: diskState === "Unattached" ? 0 : 45,
                        peakIops: diskState === "Unattached" ? 0 : 120,
                        avgThroughputMbps: diskState === "Unattached" ? 0 : 2.5,
                        peakThroughputMbps: diskState === "Unattached" ? 0 : 8.0,
                        readOpsCount: 0,
                        writeOpsCount: 0,
                        isInactive: diskState === "Unattached",
                        telemetryPeriodDays: 14,
                        lastTelemetryDate: new Date().toISOString(),
                    };

                    return {
                        id,
                        name,
                        resourceGroup: rg,
                        subscriptionId: subId,
                        subscriptionName: subId,
                        location,
                        skuName,
                        skuTier,
                        tierName,
                        diskSizeGB: sizeGb,
                        diskSizeBytes: sizeBytes,
                        diskState,
                        diskType,
                        redundancyType: redundancy,
                        managedByVmName: vmName,
                        managedByVmId: vmId,
                        osType,
                        encryptionType,
                        burstingEnabled: bursting,
                        monthlyCostUsd: parseFloat(finalCost.toFixed(2)),
                        billedCostUsd: parseFloat(finalCost.toFixed(2)),
                        costPerGb: sizeGb > 0 ? parseFloat((finalCost / sizeGb).toFixed(4)) : 0,
                        environmentTag: env,
                        tags: d.tags || {},
                        metrics,
                        recommendations: [],
                        isZombieCandidate: diskState === "Unattached" || metrics.isInactive,
                    };
                });

                const remediations = buildDiskRemediations(mappedDisks);
                const disksWithRecs = mappedDisks.map((d) => ({
                    ...d,
                    recommendations: remediations.filter((r) => r.diskId === d.id),
                }));

                const kpis = computeDisksKpis(disksWithRecs, remediations);
                const skuDistribution = computeSkuDistribution(disksWithRecs);

                return {
                    success: true,
                    mock: false,
                    kpis,
                    disks: disksWithRecs,
                    skuDistribution,
                    remediations,
                };
            },
            1800, // 30 min hard TTL
            900   // 15 min soft TTL
        );

        return NextResponse.json(data);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[managed-disks route] Error:", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
