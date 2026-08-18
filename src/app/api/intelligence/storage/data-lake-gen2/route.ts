import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getSubscriptionsForTenant } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool from "@/modules/storage/db";
import {
    fetchAllDataLakeAccountsFromARG,
    detectDataLakeEnvironment,
    detectDataLakeRedundancy,
    buildDataLakeRemediations,
    computeDataLakeKpis,
    aggregateDataLakeStorage,
} from "@/services/azureDataLakeGen2.service";
import {
    DataLakeAccountDetail,
    DataLakeResponse,
    DataLakeAccessTier,
} from "@/types/dataLakeGen2.types";

function getMockDataLakePayload(multiplier: number = 1): DataLakeResponse {
    const mockAccounts: DataLakeAccountDetail[] = [
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-datalake-prod/providers/Microsoft.Storage/storageAccounts/stfinopslakeprod01",
            name: "stfinopslakeprod01",
            resourceGroup: "rg-datalake-prod",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "eastus2",
            skuName: "Standard_ZRS",
            skuTier: "Standard",
            kind: "StorageV2",
            isHnsEnabled: true,
            accessTier: "Hot",
            redundancyType: "ZRS",
            hasLifecyclePolicy: false,
            lifecycleRulesCount: 0,
            privateEndpointsCount: 2,
            publicAccessBlocked: true,
            storageBreakdown: {
                totalStorageBytes: 48 * 1024 * 1024 * 1024 * 1024, // 48 TB
                totalStorageGB: 48 * 1024,
                totalStorageTB: 48.0,
                hotTierBytes: 38 * 1024 * 1024 * 1024 * 1024, // 38 TB
                coolTierBytes: 8 * 1024 * 1024 * 1024 * 1024,  // 8 TB
                coldTierBytes: 2 * 1024 * 1024 * 1024 * 1024,  // 2 TB
                archiveTierBytes: 0,
                hotTierGB: 38 * 1024,
                coolTierGB: 8 * 1024,
                coldTierGB: 2 * 1024,
                archiveTierGB: 0,
            },
            metrics: {
                transactionsCount: 14500000,
                readOpsCount: 9200000,
                writeOpsCount: 4800000,
                listOpsCount: 500000,
                egressBytes: 12 * 1024 * 1024 * 1024 * 1024,
                ingressBytes: 8 * 1024 * 1024 * 1024 * 1024,
                storageCostUSD: 980.50,
                transactionsCostUSD: 42.10,
                transactionCostRatio: 0.041,
                hasSmallFilesAnomaly: false,
            },
            monthlyCostUsd: parseFloat((1022.60 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((1022.60 * multiplier).toFixed(2)),
            costPerTb: 21.30,
            environmentTag: "prod",
            tags: { env: "prod", domain: "enterprise-analytics", hns: "enabled" },
            recommendations: [],
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-datalake-prod/providers/Microsoft.Storage/storageAccounts/stfinopsbronzelake",
            name: "stfinopsbronzelake",
            resourceGroup: "rg-datalake-prod",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "eastus2",
            skuName: "Standard_LRS",
            skuTier: "Standard",
            kind: "StorageV2",
            isHnsEnabled: true,
            accessTier: "Hot",
            redundancyType: "LRS",
            hasLifecyclePolicy: false,
            lifecycleRulesCount: 0,
            privateEndpointsCount: 1,
            publicAccessBlocked: true,
            storageBreakdown: {
                totalStorageBytes: 65 * 1024 * 1024 * 1024 * 1024, // 65 TB
                totalStorageGB: 65 * 1024,
                totalStorageTB: 65.0,
                hotTierBytes: 65 * 1024 * 1024 * 1024 * 1024, // 65 TB in hot without policy!
                coolTierBytes: 0,
                coldTierBytes: 0,
                archiveTierBytes: 0,
                hotTierGB: 65 * 1024,
                coolTierGB: 0,
                coldTierGB: 0,
                archiveTierGB: 0,
            },
            metrics: {
                transactionsCount: 88000000,
                readOpsCount: 18000000,
                writeOpsCount: 65000000,
                listOpsCount: 5000000,
                egressBytes: 4 * 1024 * 1024 * 1024 * 1024,
                ingressBytes: 25 * 1024 * 1024 * 1024 * 1024,
                storageCostUSD: 1196.00,
                transactionsCostUSD: 360.00,
                transactionCostRatio: 0.231,
                hasSmallFilesAnomaly: false,
            },
            monthlyCostUsd: parseFloat((1556.00 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((1556.00 * multiplier).toFixed(2)),
            costPerTb: 23.94,
            environmentTag: "prod",
            tags: { env: "prod", layer: "bronze-raw-ingestion" },
            recommendations: [],
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-analytics-dev/providers/Microsoft.Storage/storageAccounts/stfinopslakedev01",
            name: "stfinopslakedev01",
            resourceGroup: "rg-analytics-dev",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "westus2",
            skuName: "Standard_GRS",
            skuTier: "Standard",
            kind: "StorageV2",
            isHnsEnabled: true,
            accessTier: "Hot",
            redundancyType: "GRS",
            hasLifecyclePolicy: false,
            lifecycleRulesCount: 0,
            privateEndpointsCount: 0,
            publicAccessBlocked: false,
            storageBreakdown: {
                totalStorageBytes: 12 * 1024 * 1024 * 1024 * 1024, // 12 TB
                totalStorageGB: 12 * 1024,
                totalStorageTB: 12.0,
                hotTierBytes: 12 * 1024 * 1024 * 1024 * 1024,
                coolTierBytes: 0,
                coldTierBytes: 0,
                archiveTierBytes: 0,
                hotTierGB: 12 * 1024,
                coolTierGB: 0,
                coldTierGB: 0,
                archiveTierGB: 0,
            },
            metrics: {
                transactionsCount: 3200000,
                readOpsCount: 2100000,
                writeOpsCount: 900000,
                listOpsCount: 200000,
                egressBytes: 2 * 1024 * 1024 * 1024 * 1024,
                ingressBytes: 2 * 1024 * 1024 * 1024 * 1024,
                storageCostUSD: 441.60,
                transactionsCostUSD: 14.50,
                transactionCostRatio: 0.032,
                hasSmallFilesAnomaly: false,
            },
            monthlyCostUsd: parseFloat((456.10 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((456.10 * multiplier).toFixed(2)),
            costPerTb: 38.01,
            environmentTag: "dev",
            tags: { env: "dev", team: "bi-engineering" },
            recommendations: [],
        },
        {
            id: "/subscriptions/demo-sub-01/resourceGroups/rg-iot-streaming/providers/Microsoft.Storage/storageAccounts/stfinopsiotstream01",
            name: "stfinopsiotstream01",
            resourceGroup: "rg-iot-streaming",
            subscriptionId: "demo-sub-01",
            subscriptionName: "Suscripción Producción Core",
            location: "eastus2",
            skuName: "Standard_LRS",
            skuTier: "Standard",
            kind: "StorageV2",
            isHnsEnabled: true,
            accessTier: "Hot",
            redundancyType: "LRS",
            hasLifecyclePolicy: true,
            lifecycleRulesCount: 2,
            privateEndpointsCount: 1,
            publicAccessBlocked: true,
            storageBreakdown: {
                totalStorageBytes: 6 * 1024 * 1024 * 1024 * 1024, // 6 TB
                totalStorageGB: 6 * 1024,
                totalStorageTB: 6.0,
                hotTierBytes: 2 * 1024 * 1024 * 1024 * 1024,
                coolTierBytes: 3 * 1024 * 1024 * 1024 * 1024,
                coldTierBytes: 1 * 1024 * 1024 * 1024 * 1024,
                archiveTierBytes: 0,
                hotTierGB: 2 * 1024,
                coolTierGB: 3 * 1024,
                coldTierGB: 1 * 1024,
                archiveTierGB: 0,
            },
            metrics: {
                transactionsCount: 120000000,
                readOpsCount: 15000000,
                writeOpsCount: 95000000,
                listOpsCount: 10000000,
                egressBytes: 1 * 1024 * 1024 * 1024 * 1024,
                ingressBytes: 4 * 1024 * 1024 * 1024 * 1024,
                storageCostUSD: 85.00,
                transactionsCostUSD: 520.00,
                transactionCostRatio: 0.860, // 86% of cost is transactions!
                hasSmallFilesAnomaly: true,
            },
            monthlyCostUsd: parseFloat((605.00 * multiplier).toFixed(2)),
            billedCostUsd: parseFloat((605.00 * multiplier).toFixed(2)),
            costPerTb: 100.83,
            environmentTag: "prod",
            tags: { env: "prod", workload: "iot-telemetry-ingestion" },
            recommendations: [],
        },
    ];

    const remediations = buildDataLakeRemediations(mockAccounts);
    const accountsWithRecs = mockAccounts.map((a) => ({
        ...a,
        recommendations: remediations.filter((r) => r.accountId === a.id || r.accountId === "global-reservation"),
    }));

    const kpis = computeDataLakeKpis(accountsWithRecs, remediations);
    const storageBreakdown = aggregateDataLakeStorage(accountsWithRecs);

    return {
        success: true,
        mock: true,
        kpis,
        accounts: accountsWithRecs,
        storageBreakdown,
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
        if (isMockTenant(tenantId) || tenantId.startsWith("mock-") || tenantId.startsWith("demo-") || tenantId === "demo_tenant" || isMockParam) {
            return NextResponse.json(getMockDataLakePayload(1));
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        // Live Connected Tenant Real Data Path
        const cacheKey = `azure-adls-gen2:v2:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(
            cacheKey,
            async () => {
                const subs = await getSubscriptionsForTenant(tenantId);
                if (!subs || subs.length === 0) {
                    const emptyKpis = computeDataLakeKpis([], []);
                    const emptyStorage = aggregateDataLakeStorage([]);
                    return {
                        success: true,
                        mock: false,
                        kpis: emptyKpis,
                        accounts: [],
                        storageBreakdown: emptyStorage,
                        remediations: [],
                    };
                }

                // 1. Fetch ADLS Gen2 Accounts (HNS Enabled) from ARG
                const rawAccounts = await fetchAllDataLakeAccountsFromARG(tenantId, subs);
                if (!rawAccounts || rawAccounts.length === 0) {
                    const emptyKpis = computeDataLakeKpis([], []);
                    const emptyStorage = aggregateDataLakeStorage([]);
                    return {
                        success: true,
                        mock: false,
                        kpis: emptyKpis,
                        accounts: [],
                        storageBreakdown: emptyStorage,
                        remediations: [],
                    };
                }

                // 2. Query DB Cost Attribution for Storage Accounts
                const [costRows]: any = await pool.query(
                    `SELECT resource_id, LOWER(resource_group) AS rg, SUM(cost_usd) AS cost
                     FROM CostCategorySnapshots
                     WHERE tenant_id = ?
                       AND LOWER(resource_type) = 'microsoft.storage/storageaccounts'
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

                // 3. Map accounts with real data
                const mappedAccounts: DataLakeAccountDetail[] = rawAccounts.map((a: any) => {
                    const id = String(a.id || "");
                    const name = String(a.name || "");
                    const rg = String(a.resourceGroup || "");
                    const subId = String(a.subscriptionId || "");
                    const location = String(a.location || "eastus");
                    const skuName = String(a.sku?.name || "Standard_LRS");
                    const skuTier = String(a.sku?.tier || "Standard");
                    const kind = String(a.kind || "StorageV2");
                    const isHns = Boolean(a.properties?.isHnsEnabled);
                    const accessTier = (a.properties?.accessTier || "Hot") as DataLakeAccessTier;
                    const redundancy = detectDataLakeRedundancy(skuName);
                    const env = detectDataLakeEnvironment(a.tags, name, rg);

                    const normId = id.toLowerCase();
                    const directCost = costByResourceId.get(normId) || 0;
                    const groupCost = costByRg.get(rg.toLowerCase()) || 0;
                    const finalCost = directCost > 0 ? directCost : groupCost;

                    // Real storage breakdown defaults (0 if no live Monitor telemetry)
                    const storageBreakdown = {
                        totalStorageBytes: 0,
                        totalStorageGB: 0,
                        totalStorageTB: 0,
                        hotTierBytes: 0,
                        coolTierBytes: 0,
                        coldTierBytes: 0,
                        archiveTierBytes: 0,
                        hotTierGB: 0,
                        coolTierGB: 0,
                        coldTierGB: 0,
                        archiveTierGB: 0,
                    };

                    const metrics = {
                        transactionsCount: 0,
                        readOpsCount: 0,
                        writeOpsCount: 0,
                        listOpsCount: 0,
                        egressBytes: 0,
                        ingressBytes: 0,
                        storageCostUSD: finalCost > 0 ? parseFloat((finalCost * 0.9).toFixed(2)) : 0,
                        transactionsCostUSD: finalCost > 0 ? parseFloat((finalCost * 0.1).toFixed(2)) : 0,
                        transactionCostRatio: 0.1,
                        hasSmallFilesAnomaly: false,
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
                        kind,
                        isHnsEnabled: isHns,
                        accessTier,
                        redundancyType: redundancy,
                        hasLifecyclePolicy: false,
                        lifecycleRulesCount: 0,
                        privateEndpointsCount: Array.isArray(a.properties?.privateEndpointConnections) ? a.properties.privateEndpointConnections.length : 0,
                        publicAccessBlocked: a.properties?.publicNetworkAccess === "Disabled" || a.properties?.allowBlobPublicAccess === false,
                        storageBreakdown,
                        metrics,
                        monthlyCostUsd: parseFloat(finalCost.toFixed(2)),
                        billedCostUsd: parseFloat(finalCost.toFixed(2)),
                        costPerTb: 0,
                        environmentTag: env,
                        tags: a.tags || {},
                        recommendations: [],
                    };
                });

                const remediations = buildDataLakeRemediations(mappedAccounts);
                const accountsWithRecs = mappedAccounts.map((a) => ({
                    ...a,
                    recommendations: remediations.filter((r) => r.accountId === a.id || r.accountId === "global-reservation"),
                }));

                const kpis = computeDataLakeKpis(accountsWithRecs, remediations);
                const storageBreakdown = aggregateDataLakeStorage(accountsWithRecs);

                return {
                    success: true,
                    mock: false,
                    kpis,
                    accounts: accountsWithRecs,
                    storageBreakdown,
                    remediations,
                };
            },
            1800,
            900
        );

        return NextResponse.json(data);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[data-lake-gen2 route] Error:", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
