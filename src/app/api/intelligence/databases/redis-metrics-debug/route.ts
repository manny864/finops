import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

/**
 * DEBUG ENDPOINT: Diagnose why Redis resources aren't being found.
 * Bypasses caching and returns detailed diagnostic info.
 * 
 * Only available in development. Remove in production.
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

        const diagnostics: any = {
            tenant: tenantIdParam,
            subscriptions: subscriptionIds,
            subscriptionCount: subscriptionIds.length,
        };

        // Try raw ARM query
        if (subscriptionIds.length > 0) {
            const subId = subscriptionIds[0];
            const token = await credential.getToken("https://management.azure.com/.default");
            
            diagnostics.armQuery = {
                subscriptionId: subId,
                resourceTypes: ["microsoft.cache/redis", "microsoft.cache/redisenterprise"],
            };

            const results: any = {};
            
            for (const type of ["microsoft.cache/redis", "microsoft.cache/redisenterprise"]) {
                const url = new URL("https://management.azure.com/subscriptions/" + subId + "/resources");
                url.searchParams.set("api-version", "2021-04-01");
                url.searchParams.set("$filter", `resourceType eq '${type}'`);

                const response = await fetch(url.toString(), {
                    headers: {
                        Authorization: `Bearer ${token.token}`,
                        "Content-Type": "application/json",
                    },
                    cache: "no-store",
                });

                const json = await response.json();
                results[type] = {
                    status: response.status,
                    ok: response.ok,
                    count: Array.isArray(json.value) ? json.value.length : 0,
                    items: Array.isArray(json.value) 
                        ? json.value.slice(0, 5).map((r: any) => ({
                            id: r.id,
                            name: r.name,
                            type: r.type,
                            location: r.location,
                            sku: r.sku,
                        }))
                        : [],
                };
            }

            diagnostics.armResults = results;
        }

        return NextResponse.json(diagnostics);
    } catch (err: any) {
        console.error("[redis-debug]", err);
        return NextResponse.json(
            { error: err.message || String(err) },
            { status: err instanceof AuthError ? 401 : 500 }
        );
    }
}
