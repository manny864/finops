import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { bloqueoPorDelegacionDeLectura } from "@/lib/lighthouseAccess";
import { isMockTenant } from "@/lib/mockData";
import { setReservationRenew, parseReservationResourceId } from "@/services/reservationService";
import { redis } from "@/lib/redis";

/**
 * PATCH /api/intelligence/commitments/reservations/renew
 * Body: { tenantId, orderId, reservationId, renew }
 *
 * Activa o deshabilita la auto-renovación de una reserva en Azure (mutación).
 *
 * RBAC:
 *  - App: requireTenantRole(['Admin','Owner']) — solo roles con permiso de escritura.
 *  - Azure: rol "Reservations Contributor" u "Owner" del reservation order (menor privilegio suficiente).
 */
export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const tenantId = String(body?.tenantId || "");
        let orderId = String(body?.orderId || "");
        let reservationId = String(body?.reservationId || "");
        const renew = Boolean(body?.renew);

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Permite recibir el resourceId completo en orderId como alternativa.
        if ((!orderId || !reservationId) && body?.reservationResourceId) {
            const parsed = parseReservationResourceId(String(body.reservationResourceId));
            if (parsed) {
                orderId = parsed.orderId;
                reservationId = parsed.reservationId;
            }
        }
        if (!orderId || !reservationId) {
            return NextResponse.json({ error: "Faltan orderId o reservationId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Delegacion de solo lectura: el PATCH a ARM sobre la reserva necesita permiso de escritura.
        const bloqueo = await bloqueoPorDelegacionDeLectura(tenantId);
        if (bloqueo) return bloqueo;

        // En tenants de demo/mock no se muta Azure: se responde el nuevo estado deseado.
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, data: { renew, provisioningState: "Succeeded" } });
        }

        const credential = await getAzureCredential(tenantId);
        const result = await setReservationRenew(credential, orderId, reservationId, renew);

        // Invalida el cache de commitments para que la tabla refleje el nuevo estado de renovación.
        try {
            await redis.del(`commitments:v3:${tenantId}`);
        } catch (e) {
            console.warn("[Reservation renew] cache invalidation failed:", e);
        }

        return NextResponse.json({ success: true, data: result });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Reservation renew Error:", error);
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
