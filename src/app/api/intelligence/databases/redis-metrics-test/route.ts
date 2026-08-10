import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant, getResourceGraphClient } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

/**
 * TEST endpoint for Redis resource discovery.
 * Tests multiple query methods to identify what works.
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const tenantIdParam = searchParams.get("tenantId");

    if (!tenantIdParam) {
        return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    try {
        await requireTenantAccess(request, tenantIdParam);

        const credential = await getAzureCredential(tenantIdParam);
        const subscriptionIds = await getSubscriptionsForTenant(tenantIdParam, credential);

        const results: any = {
            tenant: tenantIdParam,
            subscriptionIds,
        };

        if (subscriptionIds.length === 0) {
            results.error = "No subscriptions found";
            return NextResponse.json(results);
        }

        const argClient = await getResourceGraphClient(tenantIdParam);

        // Test 1: Query with lowercase types
        try {
            const res1: any = await argClient.resources({
                subscriptions: subscriptionIds,
                query: `
                    Resources
                    | where type in~ ('microsoft.cache/redis', 'microsoft.cache/redisenterprise')
                    | project id, name, type, location
                `,
                options: { resultFormat: "objectArray", top: 1000 },
            });
            results.test1_lowercase_types = {
                success: true,
                count: Array.isArray(res1.data) ? res1.data.length : 0,
                items: Array.isArray(res1.data) ? res1.data.slice(0, 3) : [],
            };
        } catch (e: any) {
            results.test1_lowercase_types = {
                success: false,
                error: e.message,
            };
        }

        // Test 2: Query with exact case
        try {
            const res2: any = await argClient.resources({
                subscriptions: subscriptionIds,
                query: `
                    Resources
                    | where type in ('Microsoft.Cache/Redis', 'Microsoft.Cache/RedisEnterprise')
                    | project id, name, type, location
                `,
                options: { resultFormat: "objectArray", top: 1000 },
            });
            results.test2_exact_case = {
                success: true,
                count: Array.isArray(res2.data) ? res2.data.length : 0,
                items: Array.isArray(res2.data) ? res2.data.slice(0, 3) : [],
            };
        } catch (e: any) {
            results.test2_exact_case = {
                success: false,
                error: e.message,
            };
        }

        // Test 3: Query with like operator
        try {
            const res3: any = await argClient.resources({
                subscriptions: subscriptionIds,
                query: `
                    Resources
                    | where type contains 'cache'
                    | project id, name, type, location
                `,
                options: { resultFormat: "objectArray", top: 1000 },
            });
            results.test3_contains_cache = {
                success: true,
                count: Array.isArray(res3.data) ? res3.data.length : 0,
                items: Array.isArray(res3.data) 
                    ? res3.data
                        .filter((r: any) => r.type?.toLowerCase().includes("cache"))
                        .slice(0, 3)
                    : [],
            };
        } catch (e: any) {
            results.test3_contains_cache = {
                success: false,
                error: e.message,
            };
        }

        // Test 4: All resources count
        try {
            const res4: any = await argClient.resources({
                subscriptions: subscriptionIds,
                query: `Resources | project type | distinct type | sort by type`,
                options: { resultFormat: "objectArray", top: 1000 },
            });
            results.test4_all_types = {
                success: true,
                count: Array.isArray(res4.data) ? res4.data.length : 0,
                types: Array.isArray(res4.data)
                    ? res4.data
                        .filter((r: any) => r.type?.toLowerCase().includes("cache"))
                        .slice(0, 10)
                    : [],
            };
        } catch (e: any) {
            results.test4_all_types = {
                success: false,
                error: e.message,
            };
        }

        return NextResponse.json(results);
    } catch (err: any) {
        console.error("[redis-test]", err);
        return NextResponse.json(
            { error: err.message || String(err) },
            { status: err instanceof AuthError ? 401 : 500 }
        );
    }
}
