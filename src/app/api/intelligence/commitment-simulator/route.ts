/**
 * GET /api/intelligence/commitment-simulator — comparación Savings Plan vs Reservation.
 *
 * Devuelve, por término (1 y 3 años), el ahorro mensual estimado por Azure para
 * reservas (RI) y para savings plan (SP), más un veredicto de cuál conviene.
 * Los números son las recomendaciones NATIVAS de Azure (no una heurística nuestra).
 *
 * RBAC app: requireTenantAccess (tenant-scoped). Tier: Enterprise (routeTiers).
 * Roles Azure requeridos: 'Cost Management Reader' (ya en el tier Professional del
 * onboarding) a nivel suscripción — ambas APIs operan por suscripción, no MG.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getCommitmentSimulation } from "@/services/commitmentSimulatorService";
import { errorMessage } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("commitment-simulator", tenantId));
        }

        try {
            const sim = await getCommitmentSimulation(tenantId);
            return NextResponse.json(sim);
        } catch (svcErr) {
            console.error("[commitment-simulator] service error for tenant:", tenantId, errorMessage(svcErr));
            return NextResponse.json({
                success: false, mock: false,
                error: `Sin datos disponibles: ${errorMessage(svcErr) || "error"}`,
                reservation: null, savingsPlan: null,
            });
        }
    } catch (err: unknown) {
        console.error("[commitment-simulator] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
