import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { getNetworkEgressCosts } from "@/services/networkCostService";
import { requireRequestIdentity, requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const subscriptionId = searchParams.get('subscriptionId');

        if (!subscriptionId) {
            return NextResponse.json({ error: "Falta subscriptionId" }, { status: 400 });
        }

        const identity = await requireRequestIdentity(request);
        const tenantId = request.headers.get("x-tenant-id") ?? identity.tenantId;
        await requireTenantAccess(request, tenantId);
        
        const cacheKey = `network:${tenantId}:${subscriptionId}`;
        const processedData = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let rawCosts;
            try {
                const credential = await getAzureCredential(tenantId);
                rawCosts = await getNetworkEgressCosts(credential, subscriptionId);
            } catch (e: any) {
                console.warn(`[Network] Sin credenciales/acceso para ${tenantId}:`, e?.message);
                return [];
            }

            // Process CostManagement Data
            const rows = rawCosts.rows || [];
            const columns = rawCosts.columns || [];
            
            let data: any[] = [];
            
            if (rows.length > 0) {
                const costIndex = columns.findIndex((c: any) => c.name === "PreTaxCost");
                const subcatIndex = columns.findIndex((c: any) => c.name === "MeterSubCategory");
                const rgIndex = columns.findIndex((c: any) => c.name === "ResourceGroup");

                data = rows
                    .map((row: any) => ({
                        cost: Number(row[costIndex]) || 0,
                        subCategory: String(row[subcatIndex] || ''),
                        resourceGroup: String(row[rgIndex] || '(sin grupo)')
                    }))
                    // Only include rows with an identified network subCategory AND positive cost.
                    // Do NOT use `|| item.cost > 0` here — that matches everything and causes
                    // the browser to freeze rendering thousands of irrelevant rows.
                    .filter((item: any) =>
                        item.cost > 0 && item.subCategory.length > 0
                    )
                    .sort((a: any, b: any) => b.cost - a.cost)
                    .slice(0, 300); // Safety cap: max 300 rows to prevent browser freeze
            }
            return data;
        }, 3600);

        return NextResponse.json({ data: processedData });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Network API Error:", error);
        const err = error as { message?: string; code?: string };
        let errorCode = "ERR_INTERNAL_SERVER";
        let status = 500;
        
        const msg = (err.message || "").toLowerCase();
        if (msg.includes("returns null or empty list for id") || err.code === "NotFound") {
            return NextResponse.json({ data: [] });
        }

        if (err.code === "AuthorizationFailed" || err.code === "ScopeNotFound" || msg.includes("authorization") || msg.includes("linkedinvalidpropertyid") || msg.includes("subscriptionnotfound")) {
            errorCode = "ERR_NETWORK_ACCESS_DENIED";
            status = 403;
        }
        return NextResponse.json({ error: errorCode, message: err.message }, { status });
    }
}
