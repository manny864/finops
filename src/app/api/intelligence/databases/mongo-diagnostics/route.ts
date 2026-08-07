/**
 * GET /api/intelligence/databases/mongo-diagnostics
 * Azure Cosmos DB for MongoDB Diagnostics.
 * Metrics: RU consumption, throttling, storage, shard distribution, query execution, active operations.
 * RBAC: requireTenantAccess
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
        return NextResponse.json(
            { error: "tenantId parameter is required" },
            { status: 400 }
        );
    }

    if (isMockTenant(tenantId)) {
        return NextResponse.json(getMockMongoData());
    }

    await requireTenantAccess(request, tenantId);

    try {
        // TODO: Implement real MongoDB diagnostics via:
        // 1. ARM API: listDatabases, listCollections, shardKeys
        // 2. Azure Monitor Metrics: RU consumption, throttling, storage, partitions
        // 3. Data plane: db.stats(), db.collection.stats(), currentOp(), indexStats
        return NextResponse.json({
            error: "MongoDB diagnostics not yet implemented",
            tenantId,
        }, { status: 501 });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 }
        );
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
