import { NextRequest, NextResponse } from "next/server";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('billing-markup', tenantId));
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

        return NextResponse.json({ success: true, markupPercentage: Number(tenant.markup_percentage || 0) });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        return NextResponse.json({ error: "Fallo al obtener margen (markup)" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, markupPercentage } = body;
        
        if (!tenantId || typeof markupPercentage !== 'number') {
            return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

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
