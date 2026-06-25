import { NextRequest, NextResponse } from "next/server";
import { getAksChargebackCost } from "@/modules/collectors/azure/aksCostService";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        
        if (!tenantId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId" }, { status: 400 });
        }

        // Feature Gate Verification
        const [tenants]: any = await pool.query('SELECT * FROM Tenants WHERE id = ?', [tenantId]);
        if (!tenants || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        
        const tier = tenants[0].tier;
        const normalizedTier = tier.toLowerCase() === 'enterprise' ? 'Enterprise' : tier;
        if (normalizedTier !== 'Enterprise') {
            return NextResponse.json({ error: "Feature bloqueada. Requiere plan Enterprise." }, { status: 403 });
        }

        const data = await getAksChargebackCost(tenantId, "mock-sub", "aks-prod-cluster");
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("AKS Chargeback API Error:", error);
        return NextResponse.json({ error: "Fallo al obtener datos de AKS.", details: error.message }, { status: 500 });
    }
}
