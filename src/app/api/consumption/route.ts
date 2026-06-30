import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!subscriptionId || !tenantId) {
      return NextResponse.json({ error: "Parámetros faltantes" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    await getAzureCredential(tenantId);
    
    const cacheKey = `consumption:${tenantId}:${subscriptionId}`;
    const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
        return { success: true, tenantId, subscriptionId, costSummary: { amortizedCost: 0, currency: "USD", note: "Falta implementar CostManagementClient." } };
    }, 3600);
    
    return NextResponse.json(data);

  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[consumption] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
