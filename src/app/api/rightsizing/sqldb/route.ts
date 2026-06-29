import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

const MOCK_ITEMS = [
    { serverName: 'sql-prod-01', dbName: 'orders', subscriptionId: 'sub-1', resourceGroup: 'rg-prod', currentTier: 'S3 Standard 100 DTU', recommendedTier: 'S2 Standard 50 DTU', avgDtuPercent: 18, monthlyCost: 218, estimatedSavings: 109, reason: 'Avg DTU<20% for 30d' },
    { serverName: 'sql-prod-01', dbName: 'analytics', subscriptionId: 'sub-1', resourceGroup: 'rg-prod', currentTier: 'P2 Premium 250 DTU', recommendedTier: 'S6 Standard 400 DTU', avgDtuPercent: 35, monthlyCost: 930, estimatedSavings: 340, reason: 'Workload does not require Premium tier' },
    { serverName: 'sql-dev', dbName: 'sandbox', subscriptionId: 'sub-2', resourceGroup: 'rg-dev', currentTier: 'S1 Standard 20 DTU', recommendedTier: 'Basic 5 DTU', avgDtuPercent: 3, monthlyCost: 30, estimatedSavings: 25, reason: 'Sandbox barely used' },
];

const MOCK_RESPONSE = {
    success: true, mock: true, items: MOCK_ITEMS,
    totalSavings: MOCK_ITEMS.reduce((s, i) => s + i.estimatedSavings, 0),
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded?.tid) return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });

        if (isMockTenant(tenantId)) return NextResponse.json(MOCK_RESPONSE);

        try {
            const [rows]: any = await pool.query(
                'SELECT * FROM SqlDbRecommendations WHERE tenant_id = ? ORDER BY estimated_savings DESC',
                [tenantId]
            );
            const items = rows || [];
            const totalSavings = items.reduce((sum: number, r: any) => sum + Number(r.estimated_savings || 0), 0);
            return NextResponse.json({ success: true, mock: false, items, totalSavings });
        } catch (dbErr: any) {
            console.error("[rightsizing/sqldb] DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({ success: false, mock: false, items: [], totalSavings: 0, error: `Sin datos: ${dbErr?.message || "error"}` });
        }
    } catch (err: any) {
        console.error("[rightsizing/sqldb] handler error:", err?.message);
        return NextResponse.json({ success: false, mock: false, items: [], totalSavings: 0, error: err?.message || "Error interno" }, { status: 500 });
    }
}
