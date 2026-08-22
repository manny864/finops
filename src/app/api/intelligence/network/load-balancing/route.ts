import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureLoadBalancing } from "@/services/azureLoadBalancing.service";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/intelligence/network/load-balancing
 * Returns Load Balancing & Ingress inventory, cost breakdown, and FinOps leak remediations.
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
            const mockData = await getAzureLoadBalancing(tenantId);
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
        const liveData = await getAzureLoadBalancing(tenantId);
        return NextResponse.json(liveData, {
            status: 200,
            headers: {
                "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
            },
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("Load Balancing API Route error:", error);
        return NextResponse.json(
            {
                success: false,
                error: errorMessage(error) || "Failed to fetch load balancing metrics",
            },
            { status: 500 }
        );
    }
}
