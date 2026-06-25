import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { getAzureCredential } from "@/lib/azure";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const userTier = request.nextUrl.searchParams.get('tier') || 'Essential';

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (!hasAccess(userTier, 'Enterprise')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Enterprise o superior." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('governance-policies', tenantId));
        }

        // Implementation for Real Azure Policy SDK fetching
        // would query managementGroup or subscription level policy assignments.
        return NextResponse.json({ success: true, data: [] });

    } catch (error: any) {
        return NextResponse.json({ error: "Fallo al obtener estado de políticas", details: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, policyId, action } = body;
        
        if (!tenantId || !policyId || !action) {
            return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            // Simular delay de inyección de políticas ARM
            await new Promise(r => setTimeout(r, 1000));
            return NextResponse.json({ success: true, message: `Política ${action === 'Activate' ? 'Activada' : 'Desactivada'} exitosamente (Mock)` });
        }

        // Implementation for Real Azure Policy Assignment via ARM SDK
        // const credential = await getAzureCredential(tenantId);
        // ... (call PolicyClient to create/delete assignment)

        return NextResponse.json({ success: true, message: "Política aplicada en el Tenant." });
    } catch (error: any) {
        return NextResponse.json({ error: "Fallo al aplicar la política", details: error.message }, { status: 500 });
    }
}
