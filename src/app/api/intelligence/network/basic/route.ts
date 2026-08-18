import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import {
    computeLiveBasicNetworking,
    getMockBasicNetworkingResponse,
} from "@/services/azureBasicNetworking.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId") || request.headers.get("x-tenant-id");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta el parámetro tenantId" }, { status: 400 });
        }

        const isMockParam = searchParams.get("mock") === "true";
        const isMock =
            isMockTenant(tenantId) ||
            tenantId.startsWith("mock-") ||
            tenantId.startsWith("demo-") ||
            tenantId === "demo_tenant" ||
            tenantId === "demo-tenant-id" ||
            isMockParam;

        // ✅ PASO 1: Check de Mock PRIMERO (sin autenticación OAuth)
        if (isMock) {
            const mockData = getMockBasicNetworkingResponse(tenantId);
            return NextResponse.json(mockData);
        }

        // ✅ PASO 2: Autenticación estricta SOLO para tenants reales
        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) {
                return NextResponse.json({ error: e.message }, { status: e.status });
            }
            throw e;
        }

        // ✅ PASO 3: Consultar APIs vivas de Azure (Zero-Fallback a Mocks)
        const subscriptionIdsParam = searchParams.get("subscriptions");
        const subscriptionIds = subscriptionIdsParam
            ? subscriptionIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined;

        const data = await getWithStaleWhileRevalidate(
            `network-basic:v1:${tenantId}:${subscriptionIds?.join("-") || "all"}`,
            async () => {
                return computeLiveBasicNetworking(tenantId, subscriptionIds);
            },
            1800,
            600
        );

        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[network/basic] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
