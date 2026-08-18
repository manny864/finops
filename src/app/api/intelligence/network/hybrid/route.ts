import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureHybridConnectivity } from "@/services/azureHybridConnectivity.service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/intelligence/network/hybrid
 * Returns hybrid connectivity inventory, cost breakdown, and FinOps leak remediations.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId") || request.headers.get("x-tenant-id") || "demo-tenant-id";
        const isMockQuery = searchParams.get("mock") === "true";

        // 1. EVALUAR MOCK TENANT PRIMERO (ORDEN CRÍTICO VINCULANTE)
        const isMock =
            isMockTenant(tenantId) ||
            isMockQuery ||
            tenantId.startsWith("demo-") ||
            tenantId.startsWith("mock-") ||
            tenantId === "demo_tenant" ||
            tenantId === "demo-tenant" ||
            tenantId === "demo-tenant-id" ||
            tenantId === "default-tenant" ||
            tenantId === "default";

        if (isMock) {
            const mockData = await getAzureHybridConnectivity(tenantId);
            return NextResponse.json(mockData, {
                status: 200,
                headers: {
                    "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
                },
            });
        }

        // 2. TENANT REAL CONECTADO: VALIDACIÓN OBLIGATORIA DE RBAC
        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) {
                return NextResponse.json({ error: e.message }, { status: e.status });
            }
            throw e;
        }

        // 3. CONSULTA VIVA (TOLERANCIA CERO A FALLBACKS MOCK)
        const liveData = await getAzureHybridConnectivity(tenantId);
        return NextResponse.json(liveData, {
            status: 200,
            headers: {
                "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
            },
        });
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Hybrid Connectivity API Route error:", error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || "Failed to fetch hybrid connectivity metrics",
            },
            { status: 500 }
        );
    }
}
