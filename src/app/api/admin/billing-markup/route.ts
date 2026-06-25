import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { getConnection } from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const userTier = request.nextUrl.searchParams.get('tier') || 'Essential';

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (!hasAccess(userTier, 'Enterprise')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('billing-markup', tenantId));
        }

        const connection = await getConnection();
        const [rows]: any = await connection.query('SELECT markup_percentage FROM Tenants WHERE tenant_id = ?', [tenantId]);

        if (!rows || rows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        return NextResponse.json({ success: true, markupPercentage: Number(rows[0].markup_percentage) });
    } catch (error: any) {
        return NextResponse.json({ error: "Fallo al obtener margen (markup)", details: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, markupPercentage } = body;
        
        if (!tenantId || typeof markupPercentage !== 'number') {
            return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, message: "Margen actualizado exitosamente (Mock)" });
        }

        const connection = await getConnection();
        await connection.query('UPDATE Tenants SET markup_percentage = ? WHERE tenant_id = ?', [markupPercentage, tenantId]);

        return NextResponse.json({ success: true, message: "Margen de ganancia actualizado en el Tenant." });
    } catch (error: any) {
        return NextResponse.json({ error: "Fallo al actualizar margen", details: error.message }, { status: 500 });
    }
}
