import { NextRequest, NextResponse } from "next/server";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { enforceMfaIfEnabled } from "@/lib/requireMfaChallenge";

/**
 * Heurística: un tenant está "conectado a CSP" cuando sus snapshots FOCUS traen
 * el contexto Partner Center (billing_profile_id presente en CostSnapshots).
 * Si no, el módulo de Partner Billing no aplica.
 */
async function detectCspConnection(tenantId: string): Promise<boolean> {
    try {
        const [rows]: any = await pool.query(
            `SELECT 1 FROM CostSnapshots
             WHERE tenant_id = ? AND billing_profile_id IS NOT NULL
             LIMIT 1`,
            [tenantId]
        );
        return Array.isArray(rows) && rows.length > 0;
    } catch {
        return false;
    }
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        if (isMockTenant(tenantId)) {
            const mock = getMockDataForRoute('billing-markup', tenantId);
            return NextResponse.json({ ...mock, cspDetected: true });
        }

        const [rows] = await pool.query('SELECT markup_percentage, tier FROM Tenants WHERE tenant_id = ?', [tenantId]);

        if (!Array.isArray(rows) || rows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        const tenant = rows[0] as { markup_percentage?: number; tier?: string };
        const tier = tenant.tier || "";
        if (tier.toLowerCase() !== "enterprise") {
            return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise." }, { status: 403 });
        }

        const cspDetected = await detectCspConnection(tenantId);

        // Respuesta SIEMPRE 200 si el tenant existe y es Enterprise; el flag cspDetected
        // permite al frontend mostrar mensaje informativo en lugar de error rojo.
        return NextResponse.json({
            success: true,
            cspDetected,
            markupPercentage: Number(tenant.markup_percentage || 0),
            message: cspDetected
                ? undefined
                : "Este tenant aún no tiene snapshots con contexto Partner Center (CSP). El motor de margen requiere una conexión activa con Partner Center / Microsoft Customer Agreement para calcular el costo facturado a sus clientes."
        });
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("billing-markup GET error:", error);
        return NextResponse.json({
            error: "Fallo al obtener margen (markup)",
            details: error?.message || String(error)
        }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, markupPercentage } = body;
        
        if (!tenantId || typeof markupPercentage !== 'number') {
            return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // Operación sensible (config de facturación): exige MFA si el usuario tiene 2FA activado.
        await enforceMfaIfEnabled(request, identity.email, identity.tenantId, "change_billing_config", { tenantId });

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, message: "Margen actualizado exitosamente (Mock)" });
        }

        const [rows] = await pool.query('SELECT tier FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (!Array.isArray(rows) || rows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        const tier = ((rows[0] as { tier?: string }).tier || "").toLowerCase();
        if (tier !== "enterprise") {
            return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise." }, { status: 403 });
        }

        await pool.query('UPDATE Tenants SET markup_percentage = ? WHERE tenant_id = ?', [markupPercentage, tenantId]);

        return NextResponse.json({ success: true, message: "Margen de ganancia actualizado en el Tenant." });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        return NextResponse.json({ error: "Fallo al actualizar margen" }, { status: 500 });
    }
}
