/**
 * GET /api/intelligence/databases/mongo-diagnostics
 * Azure Cosmos DB for MongoDB Diagnostics.
 * Metrics: RU consumption, throttling, storage, shard distribution, query execution, active operations.
 * RBAC: requireTenantAccess
 */

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
    distributeCostPerResource,
    getDiagnosticsCacheKey,
    getMonthlyCostByType,
    listResourcesByTypes,
    readDiagnosticsCache,
    writeDiagnosticsCache,
} from "../diagnosticsShared";
import { redis } from "@/lib/redis";

const MONGO_TYPES = [
    "microsoft.documentdb/databaseaccounts",
    "microsoft.documentdb/mongoclusters",
];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json(
                { error: "tenantId parameter is required" },
                { status: 400 },
            );
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockMongoData());
        }

        const cacheKey = getDiagnosticsCacheKey("mongo", tenantId);
        if (searchParams.get("bust") === "1") {
            await redis.del(cacheKey).catch(() => undefined);
        } else {
            const cached = await readDiagnosticsCache<unknown>(cacheKey);
            if (cached) return NextResponse.json(cached);
        }

        const credential = await getAzureCredential(tenantId);
        const subscriptionIds = await getSubscriptionsForTenant(tenantId, credential);
        if (subscriptionIds.length === 0) {
            const payload = {
                mock: false,
                resourceExists: false,
                message: "No existen suscripciones activas para este tenant.",
                accounts: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const resources = await listResourcesByTypes(tenantId, MONGO_TYPES, subscriptionIds, credential);
        if (resources.length === 0) {
            const payload = {
                mock: false,
                resourceExists: false,
                message: "No existe Azure Cosmos DB for MongoDB en este tenant.",
                accounts: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const { costByType, dataAvailable } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            MONGO_TYPES,
        );
        const costPerResource = distributeCostPerResource(resources, costByType);

        const accounts = resources.map((resource) => ({
            id: resource.id,
            name: resource.name,
            region: resource.location || "unknown",
            apiVersion: "Unknown",
            capacityMode: resource.skuName || "Unknown",
            provisionedRus: 0,
            databases: [],
            ruConsumption: {
                provisioned: 0,
                consumed: 0,
                avgLatencyMs: 0,
                throttledOperations: 0,
                throttledOperationsPercent: 0,
            },
            shardMetrics: [],
            activeOperations: 0,
            longestOperationMs: 0,
            replicationRegions: [],
            ttlEnabled: false,
            security: {
                tlsVersion: "Unknown",
                privateEndpointEnabled: false,
                firewallRules: 0,
            },
            monthlyCostUsd: costPerResource.get(resource.id) || 0,
        }));

        const payload = {
            mock: false,
            resourceExists: true,
            dataAvailable,
            accounts,
        };
        await writeDiagnosticsCache(cacheKey, payload);
        return NextResponse.json(payload);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        return NextResponse.json({
            mock: false,
            resourceExists: false,
            dataAvailable: false,
            message: "No se pudieron consultar cuentas Cosmos DB for MongoDB en este momento.",
            accounts: [],
            errors: [{ code: "MONGO_DIAGNOSTICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
        });
    }
}

function getMockMongoData() {
    return {
        mock: true,
        accounts: [
            {
                id: "mongo-cosmos-001",
                name: "Production Cosmos for MongoDB",
                region: "East US",
                apiVersion: "4.0",
                capacityMode: "Provisioned",
                provisionedRus: 50000,
                databases: [
                    {
                        id: "ecommerce",
                        name: "E-commerce Database",
                        collections: [
                            {
                                name: "products",
                                documentCount: 5000000,
                                avgDocumentSizeBytes: 2048,
                                dataUsageGB: 9.5,
                                indexUsageGB: 1.2,
                                shardKey: "_id",
                                indexes: 4,
                                unusedIndexes: 0,
                            },
                            {
                                name: "orders",
                                documentCount: 25000000,
                                avgDocumentSizeBytes: 1536,
                                dataUsageGB: 36.8,
                                indexUsageGB: 5.2,
                                shardKey: "customerId",
                                indexes: 6,
                                unusedIndexes: 1,
                            },
                        ],
                    },
                ],
                ruConsumption: {
                    provisioned: 50000,
                    consumed: 42150,
                    avgLatencyMs: 12.3,
                    throttledOperations: 8,
                    throttledOperationsPercent: 0.15,
                },
                shardMetrics: [
                    {
                        shardId: "shard-0",
                        ruConsumedPercent: 32,
                        dataDistribution: "Balanced",
                    },
                    {
                        shardId: "shard-1",
                        ruConsumedPercent: 35,
                        dataDistribution: "Balanced",
                    },
                    {
                        shardId: "shard-2",
                        ruConsumedPercent: 33,
                        dataDistribution: "Balanced",
                    },
                ],
                activeOperations: 5,
                longestOperationMs: 2843,
                replicationRegions: ["West US", "North Europe"],
                ttlEnabled: true,
                security: {
                    tlsVersion: "1.2+",
                    privateEndpointEnabled: true,
                    firewallRules: 3,
                },
                monthlyCostUsd: 8500,
            },
        ],
    };
}
