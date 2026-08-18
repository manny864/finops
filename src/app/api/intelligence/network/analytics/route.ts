import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import { computeLiveNetworkAnalytics } from "@/services/azureNetworkAnalytics.service";
import { getMockNetworkAnalyticsResponse } from "@/lib/mockNetworkAnalytics";
import { getSubscriptionsForTenant } from "@/lib/azure";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        const isMockParam = searchParams.get("mock") === "true";
        const tier = searchParams.get("tier") || "pro";

        // ✅ PASO 1: Mock check PRIMERO (Bypass de OAuth y Entra ID para demos)
        if (
            isMockTenant(tenantId) ||
            tenantId.startsWith("mock-") ||
            tenantId.startsWith("demo-") ||
            tenantId === "demo_tenant" ||
            isMockParam
        ) {
            return NextResponse.json(getMockNetworkAnalyticsResponse(tier));
        }

        // ✅ PASO 2: Auth estricta SOLO para tenants reales
        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) {
                return NextResponse.json({ error: e.message }, { status: e.status });
            }
            throw e;
        }

        // ✅ PASO 3: Ejecución de telemetría y consultas en tiempo real con Stale-While-Revalidate
        const cacheKey = `network-analytics:v2:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(
            cacheKey,
            async () => {
                const subs = await getSubscriptionsForTenant(tenantId).catch(() => []);
                const subIds = subs?.map((s) => typeof s === "string" ? s : (s as any).subscriptionId || (s as any).id).filter(Boolean) as string[];
                return await computeLiveNetworkAnalytics(tenantId, subIds);
            },
            1800,
            600
        );

        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[api/intelligence/network/analytics] Error:", error);
        return NextResponse.json({ error: "Error interno procesando análisis de red" }, { status: 500 });
    }
}
