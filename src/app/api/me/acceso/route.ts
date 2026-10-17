import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireTenantMembership } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/demoTenant";
import { errorMessage } from "@/lib/apiErrors";
import type { AccesoDelTenant } from "@/types/accesoTenant.types";

/**
 * STRIDE-03 — ¿esta persona puede entrar a este tenant y, si no, por qué?
 *
 * Pasa por la MISMA admisión que `requireTenantAccess` (`requireTenantMembership`): ACTIVE entra, DISABLED/INVITED no, y
 * una persona nueva se da de alta como Reader si el plan tiene cupo. Responde 200 con un estado explícito en lugar de un
 * 403 porque el `code` de `AuthError` no viaja en el cuerpo de las demás respuestas, y la pantalla de «sin acceso» necesita
 * el motivo. Una autenticación inválida sigue siendo 401. No expone datos de costo, así que no pasa por el corte por alcance.
 */
export async function GET(request: NextRequest) {
    const noStore = { "Cache-Control": "private, no-store" };
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400, headers: noStore });

        // Los tenants demo/mock nunca tocan la base ni la identidad.
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, acceso: { ok: true } satisfies AccesoDelTenant }, { headers: noStore });
        }

        await initializeDatabase();
        try {
            await requireTenantMembership(request, tenantId);
        } catch (e) {
            // 401 (token inválido) y 5xx (p. ej. SCOPE_LOOKUP_UNAVAILABLE) no son una negativa de membresía.
            if (!(e instanceof AuthError) || e.status !== 403) throw e;
            const acceso: AccesoDelTenant = { ok: false, motivo: e.detalle?.motivo ?? "SIN_ACCESO", ...(e.detalle ?? {}) };
            return NextResponse.json({ success: true, acceso }, { headers: noStore });
        }
        return NextResponse.json({ success: true, acceso: { ok: true } satisfies AccesoDelTenant }, { headers: noStore });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: e.status, headers: noStore });
        }
        console.error("[GET /api/me/acceso] error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500, headers: noStore });
    }
}
