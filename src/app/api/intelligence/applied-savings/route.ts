import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { baselineForResourceType } from "@/lib/realizedSavings";

/**
 * GET /api/intelligence/applied-savings?tenantId=&days=30
 *
 * "Ahorro Aplicado": a diferencia del ahorro POTENCIAL de Advisor (recomendaciones
 * sin ejecutar), esto suma el ahorro estimado de los recursos zombie que el
 * usuario YA eliminó vía /api/remediation (ActionLogs.action_type='DELETE_RESOURCE',
 * status='SUCCESS'), inferido por tipo de recurso a partir del resource_id.
 * No requiere una columna de costo nueva: reutiliza los mismos estimados por
 * tipo que ya se muestran como "ahorro potencial" en InteractiveDashboard.
 */

/**
 * MEJ-32: el costo sale del catálogo canónico de `realizedSavings`.
 *
 * Acá había un `SAVINGS_BY_ARM_TYPE` de 24 entradas cuyo propio comentario
 * admitía ser una copia del de `InteractiveDashboard`. Ya había divergido del
 * canónico en los tres tipos de zombie más frecuentes --discos 15.00 contra
 * 19.71, planes ASP 45.00 contra 54.75, VMs apagadas 30.00 contra 23.36-- o sea
 * que el mismo recurso reportaba un ahorro distinto según la pantalla.
 *
 * El fallback de 10.0 para tipos no listados se va con la copia. El canónico
 * devuelve 0 cuando no reconoce el tipo, y eso es información: inventar diez
 * dólares por recurso desconocido infla el ahorro reportado con un número que
 * no sale de ninguna lista de precios.
 */
function estimateMonthlySavings(resourceId: string): number {
    return baselineForResourceType(resourceId).monthly;
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 30));
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, appliedSavings: 380.5, actionsCount: 6 });
        }

        const [rows]: any = await pool.query(
            `SELECT resource_id FROM ActionLogs
              WHERE tenant_id = ? AND action_type = 'DELETE_RESOURCE' AND status = 'SUCCESS'
                AND timestamp >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [tenantId, days]
        );

        const appliedSavings = (rows as any[]).reduce(
            (sum, r) => sum + estimateMonthlySavings(r.resource_id), 0
        );

        return NextResponse.json({
            success: true,
            appliedSavings: Math.round(appliedSavings * 100) / 100,
            actionsCount: (rows as any[]).length,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[applied-savings] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
