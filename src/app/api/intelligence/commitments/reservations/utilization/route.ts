import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getReservationUtilizationTrend } from "@/services/reservationService";

/**
 * GET /api/intelligence/commitments/reservations/utilization
 * Devuelve la tendencia de utilización (aggregates 1/7/30 días + serie diaria) de una reserva,
 * para el modal que se abre al hacer clic sobre el porcentaje de uso.
 *
 * RBAC: requireTenantAccess (lectura). Rol Azure mínimo: Reservations Reader.
 */
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const orderId = request.nextUrl.searchParams.get("orderId");
        const reservationId = request.nextUrl.searchParams.get("reservationId");

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!orderId || !reservationId) {
            return NextResponse.json({ error: "Faltan orderId o reservationId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, data: getMockDataForRoute("reservation_utilization", tenantId) });
        }

        const credential = await getAzureCredential(tenantId);
        const data = await getReservationUtilizationTrend(credential, orderId, reservationId, tenantId);

        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Reservation utilization Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
