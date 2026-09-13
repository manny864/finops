import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { AuthError } from "@/lib/requestAuth";
import { TenantAddonsService } from "@/services/tenantAddons.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/addons/active?tenantId=…
 *
 * Sólo las claves de los add-ons vigentes. Existe aparte de
 * `/api/billing/marketplace` porque lo consume `TenantProvider` en cada sesión
 * y el del marketplace consulta precios a Paddle: pagar ese round-trip para
 * saber qué módulos están desbloqueados sería caro y, peor, ataría el gate de
 * navegación a que Paddle responda.
 *
 * Requiere pertenecer al tenant, no un rol concreto: gatea lo que el usuario
 * VE, y cualquier miembro ve el mismo menú.
 */
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        const activos = await TenantAddonsService.getActiveAddons(tenantId);
        return NextResponse.json({
            success: true,
            addonKeys: [...new Set(activos.filter((a) => a.status === "active").map((a) => a.addonKey))],
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
        }
        console.error("[addons/active] GET:", errorMessage(err));
        // Se responde 200 con lista vacía y no 500: este endpoint alimenta el
        // gate de navegación, y una caída suya no puede dejar al usuario sin
        // menú. Sin add-ons el gate cae al comportamiento por tier, que es el
        // que ya existía.
        return NextResponse.json({ success: false, addonKeys: [] });
    }
}
