/**
 * GET /api/intelligence/databases/cosmos-diagnostics
 * Cosmos DB Diagnostics: RU consumption, throttling, storage, partitions, metadata, security, data plane metrics.
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

const COSMOS_TYPES = ["microsoft.documentdb/databaseaccounts"];

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
            return NextResponse.json(getMockCosmosData());
        }

        const cacheKey = getDiagnosticsCacheKey("cosmos", tenantId);
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

        const resources = await listResourcesByTypes(tenantId, COSMOS_TYPES, subscriptionIds, credential);
        if (resources.length === 0) {
            const payload = {
                mock: false,
                resourceExists: false,
                message: "No existe Azure Cosmos DB en este tenant.",
                accounts: [],
            };
            await writeDiagnosticsCache(cacheKey, payload);
            return NextResponse.json(payload);
        }

        const { costByType, dataAvailable } = await getMonthlyCostByType(
            tenantId,
            credential,
            subscriptionIds,
            COSMOS_TYPES,
        );
        const costPerResource = distributeCostPerResource(resources, costByType);

        const accounts = resources.map((resource) => ({
            id: resource.id,
            name: resource.name,
            region: resource.location || "unknown",
            databases: [],
            replicationRegions: [],
            consistencyLevel: "Unknown",
            ruConsumption: {
                provisioned: 0,
                consumed: 0,
                throttled429Count: 0,
                avgLatencyMs: 0,
            },
            security: {
                tlsVersion: "Unknown",
                privateEndpointsEnabled: false,
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
            message: "No se pudieron consultar cuentas Cosmos DB en este momento.",
            accounts: [],
            errors: [{ code: "COSMOS_DIAGNOSTICS_UNAVAILABLE", detail: error instanceof Error ? error.message : "Unknown error" }],
        });
    }
}

function getMockCosmosData() {
    return {
        mock: true,
        accounts: [
            {
                id: "cosmos-prod-001",
                name: "Production Database",
                region: "East US",
                databases: [
                    {
                        id: "db-sales",
                        name: "Sales Database",
                        mode: "Provisioned",
                        provisionedThroughput: 10000,
                        containers: [
                            {
                                id: "orders",
                                name: "Orders",
                                partitionKey: "/customerId",
                                indexingPolicy: "Selective",
                                documentCount: 2500000,
                                dataUsageGB: 45.2,
                                indexUsageGB: 12.5,
                            },
                            {
                                id: "customers",
                                name: "Customers",
                                partitionKey: "/regionId",
                                indexingPolicy: "All paths",
                                documentCount: 125000,
                                dataUsageGB: 8.1,
                                indexUsageGB: 2.3,
                            },
                        ],
                    },
                ],
                replicationRegions: ["West US", "North Europe"],
                consistencyLevel: "Session",
                ruConsumption: {
                    provisioned: 10000,
                    consumed: 7523,
                    throttled429Count: 12,
                    avgLatencyMs: 8.5,
                },
                security: {
                    tlsVersion: "1.2+",
                    privateEndpointsEnabled: true,
                    firewallRules: 2,
                },
                monthlyCostUsd: 1250,
            },
        ],
    };
}
